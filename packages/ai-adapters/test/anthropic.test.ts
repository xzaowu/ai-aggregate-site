import { describe, expect, it, vi } from "vitest";
import type { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import {
  AIProviderAbortError,
  AIProviderRequestError,
  AIProviderResponseFormatError,
  AIProviderRouteUnavailableError,
  AIProviderTimeoutError,
  createAnthropicChatAdapter
} from "../src/index";

function sseResponse(events: string[]) {
  return new Response(`${events.join("\n\n")}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

const emptyAnthropicUsage = {
  cache_creation: null,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  inference_geo: null,
  input_tokens: 1,
  output_tokens: 0,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: "standard" as const
};

function anthropicSseEvent(event: MessageStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}`;
}

function anthropicStreamEvents(textDeltas: string[]): string[] {
  const events: MessageStreamEvent[] = [
    {
      type: "message_start",
      message: {
        id: "msg-test",
        container: null,
        content: [],
        model: "claude-test",
        role: "assistant",
        stop_details: null,
        stop_reason: null,
        stop_sequence: null,
        type: "message",
        usage: emptyAnthropicUsage
      }
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "", citations: null }
    },
    ...textDeltas.map(
      (text): MessageStreamEvent => ({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text }
      })
    ),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: {
        container: null,
        stop_details: null,
        stop_reason: "end_turn",
        stop_sequence: null
      },
      usage: {
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        input_tokens: 1,
        output_tokens: textDeltas.length,
        output_tokens_details: null,
        server_tool_use: null
      }
    },
    { type: "message_stop" }
  ];
  return events.map(anthropicSseEvent);
}

describe("createAnthropicChatAdapter", () => {
  function okAnthropicResponse() {
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "OK" }]
      }),
      { status: 200 }
    );
  }

  it("sends Anthropic Messages API requests with normalized /v1 path", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          model: "claude-3-5-sonnet",
          content: [
            { type: "text", text: "Hello " },
            { type: "tool_use", name: "ignored" },
            { type: "text", text: "from Claude" }
          ],
          usage: {
            input_tokens: 11,
            output_tokens: 13
          }
        }),
        { status: 200 }
      );
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/",
      apiKey: "anthropic-key",
      defaultModel: "claude-3-5-sonnet",
      fetchImpl
    });

    const result = await adapter.createChatCompletion({
      model: "claude-3-5-sonnet",
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "system", content: "Use Chinese when asked." },
        { role: "user", content: "Continue" }
      ]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST"
      })
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-api-key")).toBe("anthropic-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      model: "claude-3-5-sonnet",
      max_tokens: 4096,
      system: "You are concise.\n\nUse Chinese when asked.",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Continue" }
      ]
    });
    expect(result).toEqual({
      content: "Hello from Claude",
      model: "claude-3-5-sonnet",
      usage: {
        promptTokens: 11,
        completionTokens: 13,
        totalTokens: 24
      }
    });
  });

  it("sends x-api-key by default", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okAnthropicResponse());
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    await adapter.createChatCompletion({
      model: "claude-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-api-key")).toBe("anthropic-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("authorization")).toBeNull();
  });

  it("applies safe custom headers while retaining Anthropic platform ownership", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okAnthropicResponse());
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      headersJson: {
        "X-Provider-Trace": "first",
        "x-provider-trace": "last",
        "x-api-key": "custom-auth-must-be-ignored",
        Authorization: "custom-auth-must-be-ignored",
        "anthropic-version": "custom-version-must-be-ignored",
        "Content-Type": "custom-content-type-must-be-ignored",
        Host: "custom-host-must-be-ignored",
        "X-Control": "bad\nvalue"
      },
      fetchImpl
    });

    await adapter.createChatCompletion({
      model: "claude-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-provider-trace")).toBe("last");
    expect(headers.get("x-api-key")).toBe("anthropic-key");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-control")).toBeNull();
  });

  it("does not duplicate /v1 and supports max token override", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "OK" }]
        }),
        { status: 200 }
      );
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1/",
      apiKey: "anthropic-key",
      defaultModel: "claude-default",
      maxTokens: 2048,
      fetchImpl
    });

    const result = await adapter.createChatCompletion({
      model: "",
      messages: [{ role: "user", content: "Hi" }]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.any(Object)
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("claude-default");
    expect(body.max_tokens).toBe(2048);
    expect(result.model).toBe("claude-default");
  });

  it.each([
    {
      name: "keeps the configured provider cap when the request is higher",
      configuredMaxTokens: 128,
      requestedMaxTokens: 256,
      expectedMaxTokens: 128
    },
    {
      name: "uses the lower request cap when the provider cap is higher",
      configuredMaxTokens: 4096,
      requestedMaxTokens: 256,
      expectedMaxTokens: 256
    },
    {
      name: "preserves the configured provider cap when the request omits one",
      configuredMaxTokens: 128,
      requestedMaxTokens: undefined,
      expectedMaxTokens: 128
    }
  ])(
    "$name",
    async ({ configuredMaxTokens, requestedMaxTokens, expectedMaxTokens }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => okAnthropicResponse());
      const adapter = createAnthropicChatAdapter({
        baseUrl: "https://api.anthropic.com",
        apiKey: "anthropic-key",
        defaultModel: "claude-test",
        maxTokens: configuredMaxTokens,
        fetchImpl
      });

      await adapter.createChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }],
        ...(requestedMaxTokens === undefined
          ? {}
          : { maxTokens: requestedMaxTokens })
      });

      const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
      expect(body.max_tokens).toBe(expectedMaxTokens);
    }
  );

  it("uses /v1/messages for a root domain baseUrl", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okAnthropicResponse());
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://gateway.example",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    await adapter.createChatCompletion({
      model: "claude-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example/v1/messages",
      expect.any(Object)
    );
  });

  it("uses /messages for a /v1 baseUrl", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okAnthropicResponse());
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://gateway.example/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    await adapter.createChatCompletion({
      model: "claude-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example/v1/messages",
      expect.any(Object)
    );
  });

  it("rejects malformed Anthropic responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ content: [] }), { status: 200 });
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    await expect(
      adapter.createChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toThrow("AI provider response format is invalid");
  });

  it("rejects an Anthropic JSON response whose joined text is empty", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "" }] }),
        { status: 200 }
      )
    );
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    await expect(
      adapter.createChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
  });

  it("normalizes malformed Anthropic JSON and network failures", async () => {
    const malformedFetch = vi.fn<typeof fetch>(async () =>
      new Response("not-json", { status: 200 })
    );
    const malformedAdapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl: malformedFetch
    });

    await expect(
      malformedAdapter.createChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);

    const networkFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed https://secret.example/?api_key=secret");
    });
    const networkAdapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl: networkFetch
    });
    const error = await networkAdapter
      .createChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.message).toBe("AI provider request failed");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it.each([400, 401, 429, 503])(
    "normalizes Anthropic SDK HTTP %s without retries",
    async (status) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: status === 429 ? "rate_limit_error" : "api_error",
              message: "upstream request failed"
            }
          }),
          { status, headers: { "Content-Type": "application/json" } }
        )
      );
      const adapter = createAnthropicChatAdapter({
        baseUrl: "https://api.anthropic.com",
        apiKey: "anthropic-key",
        defaultModel: "claude-test",
        fetchImpl
      });

      const error = await adapter
        .createChatCompletion({
          model: "claude-test",
          messages: [{ role: "user", content: "Hi" }]
        })
        .catch((value) => value);

      expect(error).toBeInstanceOf(AIProviderRequestError);
      expect(error.statusCode).toBe(status);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it("preserves Anthropic model-unavailable classification from structured SDK errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "not_found_error",
            message: "requested model not found"
          }
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    );
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    const error = await adapter
      .createChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRouteUnavailableError);
    expect(error.statusCode).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps Anthropic timeout and parent abort to distinct safe errors", async () => {
    let timeoutSignal: AbortSignal | undefined;
    const timeoutFetch = vi.fn<typeof fetch>(async (_input, init) => {
      timeoutSignal = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      });
    });
    const timeoutAdapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      timeoutMs: 10,
      fetchImpl: timeoutFetch
    });
    const timeoutError = await timeoutAdapter
      .createChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(timeoutError).toBeInstanceOf(AIProviderTimeoutError);
    expect(timeoutSignal?.aborted).toBe(true);

    let abortSignal: AbortSignal | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const abortFetch = vi.fn<typeof fetch>(async (_input, init) => {
      abortSignal = init?.signal ?? undefined;
      resolveStarted?.();
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      });
    });
    const parent = new AbortController();
    const abortAdapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      timeoutMs: 1_000,
      fetchImpl: abortFetch
    });
    const pending = abortAdapter.createChatCompletion({
      model: "claude-test",
      messages: [{ role: "user", content: "Hi" }],
      signal: parent.signal
    });

    await started;
    parent.abort();
    const abortError = await pending.catch((value) => value);
    expect(abortError).toBeInstanceOf(AIProviderAbortError);
    expect(abortError).not.toBeInstanceOf(AIProviderTimeoutError);
    expect(abortSignal?.aborted).toBe(true);
  });

  it("streams Anthropic text deltas and merges the final text", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return sseResponse(
        anthropicStreamEvents(["Hello", " from", " Claude"])
      );
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });
    const deltas: string[] = [];

    const result = await adapter.createStreamingChatCompletion({
      model: "claude-test",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" }
      ],
      onDelta: (delta) => {
        deltas.push(delta.content);
      }
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.stream).toBe(true);
    expect(body.system).toBe("Be concise.");
    expect(body.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" }
    ]);
    expect(result).toEqual({
      content: "Hello from Claude",
      model: "claude-test"
    });
    expect(deltas).toEqual(["Hello", " from", " Claude"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the configured Anthropic provider cap for streaming requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse(anthropicStreamEvents(["OK"]))
    );
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      maxTokens: 128,
      fetchImpl
    });

    await adapter.createStreamingChatCompletion({
      model: "claude-test",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 256
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.max_tokens).toBe(128);
    expect(body.stream).toBe(true);
  });

  it("passes platform onDelta errors through without provider normalization", async () => {
    const platformError = new Error("CHAT_STREAM_SETTLE_FAILED");
    const encoder = new TextEncoder();
    let upstreamSignal: AbortSignal | undefined;
    let streamCancelled = false;
    let releasePendingRead: (() => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
      let deltaSent = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!deltaSent) {
              deltaSent = true;
              controller.enqueue(
                encoder.encode(
                  `${anthropicStreamEvents(["Hello"])[2]}\n\n`
                )
              );
              return;
            }
            return new Promise<void>((resolve) => {
              releasePendingRead = resolve;
            });
          },
          cancel() {
            streamCancelled = true;
            releasePendingRead?.();
          }
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }],
        onDelta: () => {
          throw platformError;
        }
      })
      .catch((value) => value);

    expect(error).toBe(platformError);
    expect(error).not.toBeInstanceOf(AIProviderRequestError);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(streamCancelled).toBe(true);
  });

  it("rejects malformed Anthropic delta chunks", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":null}'
      ])
    );
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    await expect(
      adapter.createStreamingChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
  });

  it("preserves structured Anthropic streaming model-unavailable classification", async () => {
    const body = JSON.stringify({
      type: "error",
      error: {
        type: "not_found_error",
        message: "requested model not found"
      }
    });
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(body, {
        status: 404,
        headers: { "Content-Type": "application/json" }
      })
    );
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRouteUnavailableError);
    expect(error.message).toBe("AI provider request failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses safe streaming headers with a standard Messages event sequence", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return sseResponse(anthropicStreamEvents(["EOF"]));
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://gateway.example/custom",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      headersJson: {
        "X-Provider-Trace": "stream-trace",
        "x-api-key": "ignored",
        Authorization: "ignored",
        "anthropic-version": "ignored",
        "Content-Type": "ignored"
      },
      fetchImpl
    });

    const result = await adapter.createStreamingChatCompletion({
      model: "claude-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example/custom/v1/messages",
      expect.any(Object)
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-provider-trace")).toBe("stream-trace");
    expect(headers.get("x-api-key")).toBe("anthropic-key");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("content-type")).toBe("application/json");
    expect(result.content).toBe("EOF");
    expect(upstreamSignal?.aborted).toBe(false);
  });

  it("fails closed when an Anthropic stream yields no usable text", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse(anthropicStreamEvents([]))
    );
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    await expect(
      adapter.createStreamingChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("normalizes malformed Anthropic stream events and reader failures", async () => {
    const cases = [
      () => sseResponse(["event: content_block_delta\ndata: {not-json}"]),
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error("secret anthropic reader failure"));
            }
          }),
          { status: 200 }
        )
    ];

    for (const makeResponse of cases) {
      const fetchImpl = vi.fn<typeof fetch>(async () => makeResponse());
      const adapter = createAnthropicChatAdapter({
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "anthropic-key",
        defaultModel: "claude-test",
        fetchImpl
      });
      const error = await adapter
        .createStreamingChatCompletion({
          model: "claude-test",
          messages: [{ role: "user", content: "Hi" }]
        })
        .catch((value) => value);

      expect(error).toBeInstanceOf(
        makeResponse === cases[0]
          ? AIProviderResponseFormatError
          : AIProviderRequestError
      );
      expect(JSON.stringify(error)).not.toContain("secret anthropic reader failure");
    }
  });

  it("aborts a pre-response Anthropic stream on timeout", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      });
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      timeoutMs: 10,
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderTimeoutError);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("maps an active Anthropic stream caller abort without hanging", async () => {
    const encoder = new TextEncoder();
    const parent = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    let bodyObservedAbort = false;
    let sent = false;
    let releasePendingRead: (() => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
      let removeAbortListener = () => undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const onAbort = () => {
              bodyObservedAbort = upstreamSignal?.aborted === true;
              controller.error(new DOMException("aborted", "AbortError"));
              releasePendingRead?.();
            };
            upstreamSignal?.addEventListener("abort", onAbort, { once: true });
            removeAbortListener = () => {
              upstreamSignal?.removeEventListener("abort", onAbort);
            };
          },
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(
                encoder.encode(`${anthropicStreamEvents(["before abort"])[2]}\n\n`)
              );
              return;
            }
            return new Promise<void>((resolve) => {
              releasePendingRead = resolve;
            });
          },
          cancel() {
            removeAbortListener();
            releasePendingRead?.();
          }
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "claude-test",
        messages: [{ role: "user", content: "Hi" }],
        signal: parent.signal,
        onDelta: () => {
          parent.abort();
          expect(upstreamSignal?.aborted).toBe(true);
        }
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderAbortError);
    expect(error).not.toBeInstanceOf(AIProviderTimeoutError);
    expect(bodyObservedAbort).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws a safe error for Anthropic stream HTTP failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response("anthropic raw failure with secret details", {
        status: 529
      });
    });
    const adapter = createAnthropicChatAdapter({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "claude-test",
        messages: [
          { role: "system", content: "internal system prompt should not leak" },
          { role: "user", content: "full user prompt should not leak" }
        ]
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.message).toBe("AI provider request failed");
    expect(error.statusCode).toBe(529);
    expect(error.endpointPath).toBe("/v1/messages");
    expect(JSON.stringify(error)).not.toContain("secret details");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
