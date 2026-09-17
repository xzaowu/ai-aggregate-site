import { describe, expect, it, vi } from "vitest";
import {
  AIProviderAbortError,
  AIProviderRequestError,
  AIProviderResponseFormatError,
  AIProviderRouteUnavailableError,
  AIProviderTimeoutError,
  createAgnesImageAdapter,
  createOpenAICompatibleAdapter,
  ImageTransportConfigError,
  resolveImageTransport
} from "../src/index";

function sseResponse(events: string[]) {
  return new Response(`${events.join("\n\n")}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

function openAIStreamData(
  content?: string,
  finishReason: "stop" | null = null
): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-test",
    choices: [
      {
        index: 0,
        delta: content === undefined ? {} : { content },
        finish_reason: finishReason,
        logprobs: null
      }
    ]
  })}`;
}

describe("image transport resolution", () => {
  it.each([
    ["OPENAI_COMPATIBLE", {}, "openai-images"],
    ["SUB2API", {}, "openai-images"],
    ["AGNES_IMAGE", {}, "legacy-extra-body-v1"],
    ["AGNES_IMAGE", { imageTransport: "openai-images" }, "openai-images"],
    ["OPENAI_COMPATIBLE", { imageTransport: "legacy-extra-body-v1" }, "legacy-extra-body-v1"]
  ])("resolves %s config %j", (providerType, configJson, expected) => {
    expect(resolveImageTransport({ providerType, configJson })).toBe(expected);
  });

  it("fails closed for an explicit invalid transport", () => {
    expect(() =>
      resolveImageTransport({
        providerType: "OPENAI_COMPATIBLE",
        configJson: { imageTransport: "unknown-transport" }
      })
    ).toThrow(ImageTransportConfigError);
  });

  it("does not dispatch by provider name", () => {
    expect(
      resolveImageTransport({ providerType: "AGNES", configJson: {} })
    ).toBe("openai-images");
  });
});

describe("createOpenAICompatibleAdapter", () => {
  it("sends OpenAI-compatible chat completion requests", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "gpt-test",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Hello from adapter"
              }
            }
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 7,
            total_tokens: 12
          }
        }),
        { status: 200 }
      );
    });

    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1/",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const result = await adapter.createChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://provider.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST"
      })
    );
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(result.content).toBe("Hello from adapter");
    expect(result.model).toBe("gpt-test");
    expect(result.usage).toEqual({
      promptTokens: 5,
      completionTokens: 7,
      totalTokens: 12
    });
  });

  it("applies safe custom chat headers while retaining platform ownership", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "OK" } }]
        }),
        { status: 200 }
      );
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      headersJson: {
        "X-Provider-Trace": "first",
        "x-provider-trace": "last",
        authorization: "custom-auth-must-be-ignored",
        "Content-Type": "custom-content-type-must-be-ignored",
        Host: "custom-host-must-be-ignored",
        "X-Control": "bad\nvalue"
      },
      fetchImpl
    });

    await adapter.createChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-provider-trace")).toBe("last");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-control")).toBeNull();
  });

  it.each([
    ["https://provider.example", "https://provider.example/chat/completions"],
    ["https://provider.example/v1/", "https://provider.example/v1/chat/completions"],
    [
      "https://provider.example/gateway/custom/",
      "https://provider.example/gateway/custom/chat/completions"
    ]
  ])("preserves the configured chat endpoint prefix for %s", async (baseUrl, expectedUrl) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "OK" } }]
        }),
        { status: 200 }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl,
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await adapter.createChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expectedUrl,
      expect.any(Object)
    );
  });

  it("fails closed for an invalid chat base URL before network access", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "not-a-url",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.message).toBe("AI provider request failed");
    expect(error.endpointPath).toBe("/chat/completions");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an API key before calling the provider", async () => {
    const fetchImpl = vi.fn();
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toThrow("AI_API_KEY is required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires a base URL before calling the provider", async () => {
    const fetchImpl = vi.fn();
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toThrow("AI_BASE_URL is required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the configured default model when request model is empty", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          model: "default-model",
          choices: [{ message: { role: "assistant", content: "OK" } }]
        }),
        { status: 200 }
      );
    });

    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "default-model",
      fetchImpl
    });

    await adapter.createChatCompletion({
      model: "",
      messages: [{ role: "user", content: "Hi" }]
    });

    const request = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body)
    ) as { model: string };
    expect(request.model).toBe("default-model");
  });

  it("normalizes upstream request failures without leaking the body", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("provider down", { status: 502 });
    });

    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.message).toBe("AI provider request failed");
    expect(error.statusCode).toBe(502);
    expect(error.endpointPath).toBe("/chat/completions");
    expect(JSON.stringify(error)).not.toContain("provider down");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 429, 503])(
    "normalizes OpenAI SDK HTTP %s without retries",
    async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          error: {
            type: status === 429 ? "rate_limit_error" : "api_error",
            message: "upstream request failed"
          }
        }),
        { status, headers: { "Content-Type": "application/json" } }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error).not.toBeInstanceOf(AIProviderRouteUnavailableError);
    expect(error.statusCode).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it("preserves OpenAI model-unavailable classification from structured SDK errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "model_not_found",
            message: "requested model is unavailable",
            type: "invalid_request_error"
          }
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRouteUnavailableError);
    expect(error.statusCode).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed upstream responses", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });

    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toThrow("AI provider response format is invalid");
  });

  it.each([
    "not-json",
    JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [{ message: { role: "user", content: "bad" } }] })
  ])("normalizes malformed chat JSON payload %j", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(body, { status: 200 })
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderResponseFormatError);
    expect(error.message).toBe("AI provider response format is invalid");
  });

  it("normalizes chat network failures without leaking transport details", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed https://secret.example/?api_key=secret");
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.message).toBe("AI provider request failed");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("maps the SDK request timeout to a provider timeout", async () => {
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
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      timeoutMs: 10,
      fetchImpl
    });

    const error = await adapter
      .createChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderTimeoutError);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("maps a parent JSON abort to a safe non-timeout cancellation", async () => {
    let upstreamSignal: AbortSignal | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
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
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      timeoutMs: 1_000,
      fetchImpl
    });
    const pending = adapter.createChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hi" }],
      signal: parent.signal
    });

    await started;
    parent.abort();
    const error = await pending.catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderAbortError);
    expect(error).not.toBeInstanceOf(AIProviderTimeoutError);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("sends OpenAI-compatible image generation requests", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          created: 1,
          data: [
            {
              url: "https://cdn.example.com/image-1.png",
              revised_prompt: "A calm mountain lake"
            }
          ]
        }),
        { status: 200 }
      );
    });

    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1/",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const signal = new AbortController().signal;
    const result = await adapter.createImageGeneration({
      model: "image-model",
      prompt: "A mountain lake",
      size: "1024x1024",
      count: 1,
      signal
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://provider.example/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "image-model",
          prompt: "A mountain lake",
          size: "1024x1024",
          n: 1,
          response_format: "url"
        })
      })
    );
    const sentInit = (
      fetchImpl.mock.calls[0] as unknown as
        | [unknown, RequestInit?]
        | undefined
    )?.[1];
    expect(sentInit?.method).toBe("POST");
    expect(new Headers(sentInit?.headers).get("content-type")).toBe(
      "application/json"
    );
    expect(new Headers(sentInit?.headers).get("authorization")).toBe(
      "Bearer test-key"
    );
    expect(sentInit?.signal).not.toBe(signal);
    expect(result.images).toEqual([
      {
        sourceType: "url",
        url: "https://cdn.example.com/image-1.png",
        revisedPrompt: "A calm mountain lake"
      }
    ]);
  });

  it.each([
    {
      label: "PNG",
      mimeType: "image/png" as const,
      fileName: "reference.png",
      bytes: [137, 80, 78, 71, 13, 10, 26, 10] as const
    },
    {
      label: "JPEG",
      mimeType: "image/jpeg" as const,
      fileName: "reference.jpg",
      bytes: [255, 216, 255, 224, 0, 16, 74, 70] as const
    },
    {
      label: "WEBP",
      mimeType: "image/webp" as const,
      fileName: "reference.webp",
      bytes: [82, 73, 70, 70, 24, 0, 0, 0] as const
    }
  ])(
    "sends $label image-to-image requests through the edit multipart contract",
    async ({ mimeType, fileName, bytes }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: "iVBORw0KGgo=" }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
      const adapter = createOpenAICompatibleAdapter({
        baseUrl: "https://provider.example/v1",
        apiKey: "test-key",
        defaultModel: "gpt-test",
        imageResponseFormat: "b64_json",
        headersJson: { "X-Provider-Trace": "edit-trace" },
        fetchImpl
      });
      const expectedBytes = Uint8Array.from(bytes);
      const dataUrl = `data:${mimeType};base64,${Buffer.from(expectedBytes).toString("base64")}`;

      const result = await adapter.createImageGeneration({
        model: "image-edit-model",
        prompt: "Restyle this room",
        size: "1280x720",
        count: 2,
        referenceImages: [{
          dataUrl,
          mimeType,
          name: "user-supplied-name-without-path"
        }]
      });

      const editCalls = fetchImpl.mock.calls.filter(([input]) =>
        String(input).endsWith("/images/edits")
      );
      expect(editCalls).toHaveLength(1);
      expect(fetchImpl.mock.calls.some(([input]) =>
        String(input).endsWith("/images/generations")
      )).toBe(false);
      const [url, init] = editCalls[0] ?? [];
      expect(url).toBe("https://provider.example/v1/images/edits");
      expect(init?.method).toBe("POST");
      const rawHeaders = new Headers(init?.headers);
      expect(rawHeaders.get("content-type")).toBeNull();
      const headers = new Request(String(url), init).headers;
      expect(headers.get("content-type")).toMatch(
        /^multipart\/form-data; boundary=/u
      );
      expect(headers.get("content-type")).not.toBe("application/json");
      expect(headers.get("authorization")).toBe("Bearer test-key");
      expect(headers.get("x-provider-trace")).toBe("edit-trace");

      const form = init?.body;
      expect(form).toBeInstanceOf(FormData);
      if (!(form instanceof FormData)) {
        throw new Error("EXPECTED_OPENAI_EDIT_FORM_DATA");
      }
      expect(form.get("model")).toBe("image-edit-model");
      expect(form.get("prompt")).toBe("Restyle this room");
      expect(form.get("size")).toBe("1280x720");
      expect(form.get("n")).toBe("2");
      expect(form.get("response_format")).toBe("b64_json");
      const image = form.get("image");
      if (image === null || typeof image === "string") {
        throw new Error("EXPECTED_OPENAI_EDIT_IMAGE_UPLOAD");
      }
      expect(image.name).toBe(fileName);
      expect(image.type).toBe(mimeType);
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(expectedBytes);
      expect(result.images).toEqual([
        { sourceType: "base64", base64: "iVBORw0KGgo=" }
      ]);
    }
  );

  it("sends ordered multi-reference images through one OpenAI edit request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      imageResponseFormat: "b64_json",
      headersJson: { "X-Provider-Trace": "multi-edit-trace" },
      fetchImpl
    });
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const jpegBytes = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70]);

    await adapter.createImageGeneration({
      model: "image-edit-model",
      prompt: "Blend the subjects",
      size: "720x1280",
      count: 4,
      referenceImages: [
        {
          dataUrl: `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`,
          mimeType: "image/png",
          name: "first-user-name"
        },
        {
          dataUrl: `data:image/jpeg;base64,${Buffer.from(jpegBytes).toString("base64")}`,
          mimeType: "image/jpeg",
          name: "second-user-name"
        }
      ]
    });

    const editCalls = fetchImpl.mock.calls.filter(([input]) =>
      String(input).endsWith("/images/edits")
    );
    expect(editCalls).toHaveLength(1);
    expect(fetchImpl.mock.calls.some(([input]) =>
      String(input).endsWith("/images/generations")
    )).toBe(false);
    const [url, init] = editCalls[0] ?? [];
    const rawHeaders = new Headers(init?.headers);
    expect(rawHeaders.get("content-type")).toBeNull();
    const headers = new Request(String(url), init).headers;
    expect(headers.get("content-type")).toMatch(
      /^multipart\/form-data; boundary=/u
    );
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("x-provider-trace")).toBe("multi-edit-trace");

    const form = init?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) {
      throw new Error("EXPECTED_OPENAI_EDIT_FORM_DATA");
    }
    expect(form.get("model")).toBe("image-edit-model");
    expect(form.get("prompt")).toBe("Blend the subjects");
    expect(form.get("size")).toBe("720x1280");
    expect(form.get("n")).toBe("4");
    const images = form.getAll("image[]");
    expect(images).toHaveLength(2);
    expect(form.getAll("image")).toHaveLength(0);
    const [firstImage, secondImage] = images;
    if (
      !firstImage ||
      typeof firstImage === "string" ||
      !secondImage ||
      typeof secondImage === "string"
    ) {
      throw new Error("EXPECTED_ORDERED_OPENAI_EDIT_IMAGE_UPLOADS");
    }
    expect(firstImage.name).toBe("reference.png");
    expect(firstImage.type).toBe("image/png");
    expect(new Uint8Array(await firstImage.arrayBuffer())).toEqual(pngBytes);
    expect(secondImage.name).toBe("reference.jpg");
    expect(secondImage.type).toBe("image/jpeg");
    expect(new Uint8Array(await secondImage.arrayBuffer())).toEqual(jpegBytes);
  });

  it("normalizes OpenAI edit failures with the edit endpoint path", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ error: { message: "secret edit provider body" } }),
        { status: 503, headers: { "content-type": "application/json" } }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      imageResponseFormat: "b64_json",
      fetchImpl
    });

    const error = await adapter
      .createImageGeneration({
        model: "image-edit-model",
        prompt: "Restyle this room",
        size: "1024x1024",
        count: 1,
        referenceImages: [{
          dataUrl: "data:image/png;base64,aW1hZ2U=",
          mimeType: "image/png"
        }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.statusCode).toBe(503);
    expect(error.endpointPath).toBe("/images/edits");
    expect(error.message).toBe("AI provider request failed");
    expect(JSON.stringify(error)).not.toContain("secret edit provider body");
  });

  it("maps an aborted OpenAI edit signal to a safe cancellation", async () => {
    const controller = new AbortController();
    let sdkSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      sdkSignal = init?.signal ?? undefined;
      if (String(input) === "data:,") {
        return new Response("probe", { status: 200 });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("secret edit abort", "AbortError")),
          { once: true }
        );
      });
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      timeoutMs: 1_000,
      fetchImpl
    });
    const pending = adapter.createImageGeneration({
      model: "image-edit-model",
      prompt: "Restyle this room",
      size: "1024x1024",
      count: 1,
      referenceImages: [{
        dataUrl: "data:image/png;base64,aW1hZ2U=",
        mimeType: "image/png"
      }],
      signal: controller.signal
    });

    await vi.waitFor(() =>
      expect(
        fetchImpl.mock.calls.filter(([input]) =>
          String(input).endsWith("/images/edits")
        )
      ).toHaveLength(1)
    );
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AIProviderAbortError);
    expect(sdkSignal?.aborted).toBe(true);
  });

  it("maps an OpenAI edit request timeout to a provider timeout", async () => {
    let sdkSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "data:,") {
        return new Response("probe", { status: 200 });
      }

      sdkSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("provider request timed out", "AbortError")),
          { once: true }
        );
      });
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      timeoutMs: 20,
      fetchImpl
    });

    const error = await adapter
      .createImageGeneration({
        model: "image-edit-model",
        prompt: "Restyle this room",
        size: "1024x1024",
        count: 1,
        referenceImages: [{
          dataUrl: "data:image/png;base64,aW1hZ2U=",
          mimeType: "image/png"
        }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderTimeoutError);
    expect(error).not.toBeInstanceOf(AIProviderAbortError);
    expect(sdkSignal?.aborted).toBe(true);
    expect(fetchImpl.mock.calls.some(([input]) =>
      String(input).endsWith("/images/edits")
    )).toBe(true);
  });

  it("maps an invalid OpenAI edit response to a typed format error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: "not-base64" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      imageResponseFormat: "b64_json",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-edit-model",
        prompt: "Restyle this room",
        size: "1024x1024",
        count: 1,
        referenceImages: [{
          dataUrl: "data:image/png;base64,aW1hZ2U=",
          mimeType: "image/png"
        }]
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
  });

  it("sends the configured b64_json response format", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              url: "https://cdn.example.com/image-1.png",
              b64_json: "iVBORw0KGgo="
            }
          ]
        }),
        { status: 200 }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      imageResponseFormat: "b64_json",
      fetchImpl
    });

    const result = await adapter.createImageGeneration({
      model: "image-model",
      prompt: "A mountain lake",
      size: "1024x1024",
      count: 1
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.response_format).toBe("b64_json");
    expect(result.images).toEqual([
      { sourceType: "base64", base64: "iVBORw0KGgo=" }
    ]);
  });

  it("sends safe custom image headers and keeps platform headers authoritative", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example/image.png" }] }), {
        status: 200
      })
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      headersJson: {
        "X-Provider-Trace": "trace-1",
        authorization: "blocked",
        "Content-Type": "blocked",
        Host: "blocked",
        "X-Control": "bad\nvalue"
      },
      fetchImpl
    });

    await adapter.createImageGeneration({
      model: "image-model",
      prompt: "A mountain lake",
      size: "1024x1024",
      count: 1
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-provider-trace")).toBe("trace-1");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-control")).toBeNull();
  });

  it("collapses case-insensitive safe custom header collisions", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example/image.png" }] }), {
        status: 200
      })
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      headersJson: {
        "X-Provider-Trace": "trace-1",
        "x-provider-trace": "trace-2"
      },
      fetchImpl
    });

    await adapter.createImageGeneration({
      model: "image-model",
      prompt: "A mountain lake",
      size: "1024x1024",
      count: 1
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-provider-trace")).toBe("trace-2");
  });

  it("isolates image SDK transport from ambient OpenAI env and retries once", async () => {
    const envKeys = [
      "OPENAI_CUSTOM_HEADERS",
      "OPENAI_ORG_ID",
      "OPENAI_PROJECT_ID",
      "OPENAI_ADMIN_KEY",
      "OPENAI_WEBHOOK_SECRET",
      "OPENAI_LOG"
    ] as const;
    const originalEnv = { ...process.env };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { message: "upstream failure" } }), {
        status: 500,
        headers: { "content-type": "application/json" }
      })
    );

    try {
      process.env.OPENAI_CUSTOM_HEADERS = "X-Ambient-Secret: MUST_NOT_LEAK";
      process.env.OPENAI_ORG_ID = "ambient-org";
      process.env.OPENAI_PROJECT_ID = "ambient-project";
      process.env.OPENAI_ADMIN_KEY = "ambient-admin-key";
      process.env.OPENAI_WEBHOOK_SECRET = "ambient-webhook-secret";
      process.env.OPENAI_LOG = "debug";

      const adapter = createOpenAICompatibleAdapter({
        baseUrl: "https://provider.example/v1",
        apiKey: "ProviderAccountKey",
        defaultModel: "gpt-test",
        headersJson: { "X-Provider-Tenant": "tenant-a" },
        fetchImpl
      });

      await expect(
        adapter.createImageGeneration({
          model: "image-model",
          prompt: "A mountain lake",
          size: "1024x1024",
          count: 1
        })
      ).rejects.toBeInstanceOf(AIProviderRequestError);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
      expect(headers.get("x-ambient-secret")).toBeNull();
      expect(headers.get("openai-organization")).toBeNull();
      expect(headers.get("openai-project")).toBeNull();
      expect(headers.get("x-provider-tenant")).toBe("tenant-a");
      expect(headers.get("authorization")).toBe("Bearer ProviderAccountKey");
      expect(headers.get("content-type")).toBe("application/json");
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) {
          delete process.env[key];
        }
      }
      for (const [key, value] of Object.entries(originalEnv)) {
        process.env[key] = value;
      }
    }
  });

  it("normalizes SDK HTTP and connection failures without unsafe details", async () => {
    const httpFetch = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ error: { message: "secret upstream body and prompt" } }),
        { status: 401, headers: { "content-type": "application/json" } }
      )
    );
    const httpAdapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl: httpFetch
    });
    const httpError = await httpAdapter
      .createImageGeneration({
        model: "image-model",
        prompt: "secret prompt",
        size: "1024x1024",
        count: 1
      })
      .catch((error) => error);

    expect(httpError).toBeInstanceOf(AIProviderRequestError);
    expect(httpError.statusCode).toBe(401);
    expect(httpError.message).toBe("AI provider request failed");
    expect(JSON.stringify(httpError)).not.toContain("secret");

    const connectionFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("secret socket and prompt");
    });
    const connectionAdapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl: connectionFetch
    });
    const connectionError = await connectionAdapter
      .createImageGeneration({
        model: "image-model",
        prompt: "secret prompt",
        size: "1024x1024",
        count: 1
      })
      .catch((error) => error);

    expect(connectionError).toBeInstanceOf(AIProviderRequestError);
    expect(connectionError.statusCode).toBeUndefined();
    expect(connectionError.message).toBe("AI provider request failed");
    expect(JSON.stringify(connectionError)).not.toContain("secret");
    expect(connectionFetch).toHaveBeenCalledTimes(1);
  });

  it("does not dual-send through the legacy transport after an SDK failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ error: { message: "legacy fallback must not run" } }),
        { status: 500, headers: { "content-type": "application/json" } }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 1
      })
    ).rejects.toBeInstanceOf(AIProviderRequestError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(requestBody).toHaveProperty("response_format", "url");
    expect(requestBody).not.toHaveProperty("extra_body");
  });

  it("propagates platform abort to the SDK fetch and maps it to timeout", async () => {
    const controller = new AbortController();
    let sdkSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      sdkSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      });
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      timeoutMs: 1000,
      fetchImpl
    });

    const pending = adapter.createImageGeneration({
      model: "image-model",
      prompt: "A mountain lake",
      size: "1024x1024",
      count: 1,
      signal: controller.signal
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AIProviderTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sdkSignal?.aborted).toBe(true);
  });

  it("does not fall back to url when b64_json is configured but missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: [{ url: "https://cdn.example.com/image-1.png" }]
        }),
        { status: 200 }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      imageResponseFormat: "b64_json",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 1
      })
    ).rejects.toThrow("AI provider response format is invalid");
  });

  it.each([2, 4] as const)(
    "uses one native batch request and returns count=%s outputs",
    async (count) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            data: Array.from({ length: count }, (_, index) => ({
              url: `https://cdn.example.com/image-${index + 1}.png`
            }))
          }),
          { status: 200 }
        )
      );
      const adapter = createOpenAICompatibleAdapter({
        baseUrl: "https://provider.example/v1",
        apiKey: "test-key",
        defaultModel: "gpt-test",
        fetchImpl
      });

      const result = await adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        fetchImpl.mock.calls[0]?.[1]?.body as string
      ) as Record<string, unknown>;
      expect(body).toMatchObject({
        n: count,
        response_format: "url"
      });
      expect(body.prompt).toBe("A mountain lake");
      expect(result.images).toHaveLength(count);
    }
  );

  it("accepts at most the requested number of native outputs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: [1, 2, 3].map((index) => ({
            url: `https://cdn.example.com/image-${index}.png`
          }))
        }),
        { status: 200 }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 2
      })
    ).resolves.toMatchObject({
      images: [
        { sourceType: "url", url: "https://cdn.example.com/image-1.png" },
        { sourceType: "url", url: "https://cdn.example.com/image-2.png" }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a native 429 response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("duplicate prompt", { status: 429 })
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 4
      })
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("filters invalid image entries without truncating valid outputs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: [
            { url: "" },
            { b64_json: "iVBORw0KGgo=" },
            { url: "https://cdn.example.com/image-2.png" },
            { url: "https://cdn.example.com/image-3.png" }
          ]
        }),
        { status: 200 }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 4
      })
    ).resolves.toEqual({
      images: [
        { sourceType: "base64", base64: "iVBORw0KGgo=" },
        { sourceType: "url", url: "https://cdn.example.com/image-2.png" },
        { sourceType: "url", url: "https://cdn.example.com/image-3.png" }
      ]
    });
  });

  it("keeps valid image elements around unknown provider entries", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: [
            { url: "https://cdn.example.com/image-a.png" },
            null,
            42,
            "warning",
            [],
            { url: 123 },
            { url: "https://cdn.example.com/image-b.png" }
          ]
        }),
        { status: 200 }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 2
      })
    ).resolves.toEqual({
      images: [
        { sourceType: "url", url: "https://cdn.example.com/image-a.png" },
        { sourceType: "url", url: "https://cdn.example.com/image-b.png" }
      ]
    });
  });

  it.each([
    null,
    "provider warning",
    { data: "not-an-array" },
    { data: [null, 42, "warning", [], { url: 123 }] }
  ])("returns a safe format error for malformed image payload %j", async (payload) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(payload), { status: 200 })
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 2
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
  });

  it("returns OpenAI-compatible b64_json images as naked base64 outputs", async () => {
    const validBase64 = "iVBORw0KGgo=";
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ data: [{ b64_json: validBase64 }] }), {
        status: 200
      });
    });

    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 1
      })
    ).resolves.toEqual({
      images: [{ sourceType: "base64", base64: validBase64 }]
    });
  });

  it("converts legacy data URL image outputs to naked base64 outputs", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ url: "data:image/png;base64,iVBORw0KGgo=" }]
        }),
        { status: 200 }
      );
    });

    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "image-model",
        prompt: "A mountain lake",
        size: "1024x1024",
        count: 1
      })
    ).resolves.toEqual({
      images: [{ sourceType: "base64", base64: "iVBORw0KGgo=" }]
    });
  });

  it("streams OpenAI-compatible delta content and merges the final text", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return sseResponse([
        openAIStreamData("Hello"),
        openAIStreamData(),
        openAIStreamData(" from"),
        openAIStreamData(" stream", "stop"),
        "data: [DONE]"
      ]);
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });
    const deltas: string[] = [];

    const result = await adapter.createStreamingChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hi" }],
      onDelta: (delta) => {
        deltas.push(delta.content);
      }
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.stream).toBe(true);
    expect(result).toEqual({
      content: "Hello from stream",
      model: "gpt-test"
    });
    expect(deltas).toEqual(["Hello", " from", " stream"]);
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
                encoder.encode(`${openAIStreamData("Hello")}\n\n`)
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
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "gpt-test",
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

  it("rejects malformed OpenAI-compatible delta chunks", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([
        'data: {"choices":null}'
      ])
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    await expect(
      adapter.createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
  });

  it("classifies a structured streaming model-unavailable response", async () => {
    const body = JSON.stringify({
      error: {
        code: "model_not_found",
        message: "requested model is unavailable",
        type: "invalid_request_error"
      }
    });
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(body, {
        status: 404,
        headers: { "Content-Type": "application/json" }
      })
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRouteUnavailableError);
    expect(error.message).toBe("AI provider request failed");
    expect(JSON.stringify(error)).not.toContain(body);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies safe headers to streaming chat requests and accepts clean EOF", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return sseResponse([openAIStreamData("EOF", "stop"), "data: [DONE]"]);
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/gateway/v1/",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      headersJson: {
        "X-Provider-Trace": "stream-trace",
        Authorization: "ignored",
        "content-type": "ignored"
      },
      fetchImpl
    });

    const result = await adapter.createStreamingChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hi" }]
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://provider.example/gateway/v1/chat/completions",
      expect.any(Object)
    );
    expect(headers.get("x-provider-trace")).toBe("stream-trace");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(result.content).toBe("EOF");
    expect(upstreamSignal?.aborted).toBe(false);
  });

  it("normalizes malformed streaming events and missing response bodies", async () => {
    const encoder = new TextEncoder();
    let upstreamSignal: AbortSignal | undefined;
    let streamCancelled = false;
    let releasePendingRead: (() => void) | undefined;
    const malformedFetch = vi.fn<typeof fetch>(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
      let malformedSent = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!malformedSent) {
              malformedSent = true;
              controller.enqueue(encoder.encode("data: {not-json}\n\n"));
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
    const malformedAdapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl: malformedFetch
    });

    const malformedError = await malformedAdapter
      .createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(malformedError).toBeInstanceOf(AIProviderResponseFormatError);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(streamCancelled).toBe(true);

    const missingBodyFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 200 })
    );
    const missingBodyAdapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl: missingBodyFetch
    });

    await expect(
      missingBodyAdapter.createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
  });

  it("normalizes streaming reader failures without leaking the cause", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("secret reader failure"));
          }
        }),
        { status: 200 }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.message).toBe("AI provider request failed");
    expect(JSON.stringify(error)).not.toContain("secret reader failure");
  });

  it("aborts a pre-response streaming request on provider timeout", async () => {
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
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      timeoutMs: 10,
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderTimeoutError);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("passes a parent streaming abort through to the provider fetch", async () => {
    let upstreamSignal: AbortSignal | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
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
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      timeoutMs: 1_000,
      fetchImpl
    });
    const pending = adapter.createStreamingChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hi" }],
      signal: parent.signal
    });

    await started;
    parent.abort();
    const error = await pending.catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderAbortError);
    expect(error).not.toBeInstanceOf(AIProviderTimeoutError);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("keeps the provider fetch signal live through an active stream abort", async () => {
    const encoder = new TextEncoder();
    const parent = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    let fetchCalled = false;
    let responseReturned = false;
    let streamActive = false;
    let bodyObservedAbort = false;
    let sent = false;
    let releasePendingRead: (() => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      fetchCalled = true;
      upstreamSignal = init?.signal ?? undefined;
      let removeAbortListener = () => undefined;
      const response = new Response(
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
              streamActive = true;
              controller.enqueue(
                encoder.encode(`${openAIStreamData("before abort")}\n\n`)
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
      responseReturned = true;
      return response;
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }],
        signal: parent.signal,
        onDelta: () => {
          expect(fetchCalled).toBe(true);
          expect(responseReturned).toBe(true);
          expect(streamActive).toBe(true);
          parent.abort();
          expect(upstreamSignal?.aborted).toBe(true);
        }
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderAbortError);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(bodyObservedAbort).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not apply provider timeout to an active streaming response", async () => {
    const encoder = new TextEncoder();
    let sent = false;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent) {
              return;
            }
            sent = true;
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    `${openAIStreamData("long", "stop")}\n\ndata: [DONE]\n\n`
                  )
                );
                controller.close();
                resolve();
              }, 25);
            });
          }
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      timeoutMs: 5,
      fetchImpl
    });

    await expect(
      adapter.createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).resolves.toMatchObject({ content: "long" });
  });

  it("throws a safe error for OpenAI-compatible stream HTTP failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response("provider raw failure with secret details", { status: 502 });
    });
    const adapter = createOpenAICompatibleAdapter({
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      fetchImpl
    });

    const error = await adapter
      .createStreamingChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "full user prompt should not leak" }]
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.message).toBe("AI provider request failed");
    expect(error.statusCode).toBe(502);
    expect(error.endpointPath).toBe("/chat/completions");
    expect(JSON.stringify(error)).not.toContain("secret details");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createAgnesImageAdapter", () => {
  it("keeps valid image elements around unknown provider entries", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: [
            { b64_json: "iVBORw0KGgo=" },
            null,
            42,
            "warning",
            [],
            { b64_json: 123 },
            { b64_json: "UklGRg==" }
          ]
        }),
        { status: 200 }
      )
    );
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 1
      })
    ).resolves.toEqual({
      images: [{ sourceType: "base64", base64: "iVBORw0KGgo=" }]
    });
  });

  it.each([
    null,
    "provider warning",
    { data: "not-an-array" },
    { data: [null, 42, "warning", [], { b64_json: 123 }] }
  ])("returns a safe format error for malformed image payload %j", async (payload) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(payload), { status: 200 })
    );
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 2
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
  });

  it("normalizes an Agnes network rejection without leaking its cause", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("secret network detail");
    });
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    const error = await adapter
      .createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 1
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.message).toBe("AI provider request failed");
    expect(error.statusCode).toBeUndefined();
    expect(error.endpointPath).toBe("/v1/images/generations");
    expect(String(error)).not.toContain("secret network detail");
    expect(JSON.stringify(error)).not.toContain("secret network detail");
  });

  it("normalizes malformed Agnes JSON without leaking the parse failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("secret malformed json detail", { status: 200 })
    );
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    const error = await adapter
      .createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 1
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderResponseFormatError);
    expect(error.message).toBe("AI provider response format is invalid");
    expect(String(error)).not.toContain("secret malformed json detail");
    expect(String(error)).not.toContain("SyntaxError");
    expect(JSON.stringify(error)).not.toContain("secret malformed json detail");
  });

  it("normalizes a 2xx Agnes body-read rejection without leaking its cause", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("secret body read detail");
      }
    }) as unknown as Response);
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    const error = await adapter
      .createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 1
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderResponseFormatError);
    expect(error.message).toBe("AI provider response format is invalid");
    expect(String(error)).not.toContain("secret body read detail");
    expect(JSON.stringify(error)).not.toContain("secret body read detail");
  });

  it("chooses b64_json when Agnes returns both image fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              url: "https://agnes-cdn.example.com/image.png",
              b64_json: "iVBORw0KGgo="
            }
          ]
        }),
        { status: 200 }
      )
    );
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 1
      })
    ).resolves.toEqual({
      images: [{ sourceType: "base64", base64: "iVBORw0KGgo=" }]
    });
  });

  it("requests and parses Agnes text-to-image URL output", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          data: [{ url: "https://agnes-cdn.example.com/image.png" }]
        }),
        { status: 200 }
      );
    });

    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api/",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      headersJson: {
        "X-Tenant": "tenant-a",
        "x-tenant": "tenant-b",
        Authorization: "blocked",
        "Content-Type": "blocked"
      },
      fetchImpl
    });

    const result = await adapter.createImageGeneration({
      model: "agnes-model",
      prompt: "A quiet reading room",
      size: "1024x1024",
      count: 1
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://agnes.example/api/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer agnes-key"
        })
      })
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-tenant")).toBe("tenant-b");
    expect(headers.get("authorization")).toBe("Bearer agnes-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-tenant")).not.toContain(",");

    const body = JSON.parse(
      fetchImpl.mock.calls[0]?.[1]?.body as string
    ) as Record<string, unknown>;

    expect(body).toMatchObject({
      model: "agnes-model",
      prompt: "A quiet reading room",
      size: "1024x1024",
      extra_body: {
        response_format: "url"
      }
    });
    expect(result).toEqual({
      images: [
        {
          sourceType: "url",
          url: "https://agnes-cdn.example.com/image.png"
        }
      ]
    });
    expect(body).not.toHaveProperty("n");
    expect(body).not.toHaveProperty("image");
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("tags");
  });

  it("passes an image AbortSignal through to Agnes fetch without changing the request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({ data: [{ url: "https://agnes-cdn.example.com/image.png" }] }),
        { status: 200 }
      );
    });
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api/",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });
    const signal = new AbortController().signal;

    await adapter.createImageGeneration({
      model: "agnes-model",
      prompt: "A quiet reading room",
      size: "1024x1024",
      count: 1,
      signal
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://agnes.example/api/v1/images/generations",
      expect.objectContaining({
        signal,
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer agnes-key" })
      })
    );
  });

  it("normalizes a parent Agnes AbortSignal as a cancellation", async () => {
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      resolveStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("secret abort detail", "AbortError")),
          { once: true }
        );
      });
    });
    const parent = new AbortController();
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      timeoutMs: 1_000,
      fetchImpl
    });
    const pending = adapter.createImageGeneration({
      model: "agnes-model",
      prompt: "A quiet reading room",
      size: "1024x1024",
      count: 1,
      signal: parent.signal
    });

    await started;
    parent.abort();
    const error = await pending.catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderAbortError);
    expect(error).not.toBeInstanceOf(AIProviderRequestError);
    expect(error).not.toBeInstanceOf(AIProviderTimeoutError);
    expect(String(error)).not.toContain("secret abort detail");
  });

  it("requests and parses Agnes image-to-image URL output", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          data: [{ url: "https://agnes-cdn.example.com/restyled.png" }]
        }),
        { status: 200 }
      );
    });

    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });
    const referenceImage = {
      dataUrl: "data:image/png;base64,aW1hZ2U=",
      mimeType: "image/png" as const,
      name: "reference.png"
    };

    const result = await adapter.createImageGeneration({
      model: "agnes-model",
      prompt: "Restyle this room",
      size: "1024x1024",
      count: 1,
      referenceImages: [referenceImage]
    });

    const body = JSON.parse(
      fetchImpl.mock.calls[0]?.[1]?.body as string
    ) as Record<string, unknown>;

    expect(body).toMatchObject({
      model: "agnes-model",
      prompt: "Restyle this room",
      size: "1024x1024",
      extra_body: {
        image: [referenceImage.dataUrl],
        response_format: "url"
      }
    });
    expect(result).toEqual({
      images: [
        {
          sourceType: "url",
          url: "https://agnes-cdn.example.com/restyled.png"
        }
      ]
    });
    expect(body).not.toHaveProperty("n");
    expect(body).not.toHaveProperty("image");
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("tags");
  });

  it("rejects multi-reference Agnes requests without a provider fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "Blend the subjects",
        size: "1024x1024",
        count: 1,
        referenceImages: [
          {
            dataUrl: "data:image/png;base64,AQID",
            mimeType: "image/png"
          },
          {
            dataUrl: "data:image/jpeg;base64,BAUG",
            mimeType: "image/jpeg"
          }
        ]
      })
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([2, 4] as const)(
    "issues sequential single-output requests for count=%s",
    async (count) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
        JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
        { status: 200 }
      ));
      const prompt = "secret prompt that must not leak";
      const base64 = "secret-base64-that-must-not-leak";
      const adapter = createAgnesImageAdapter({
        baseUrl: "https://agnes.example/api",
        apiKey: "agnes-key",
        defaultModel: "agnes-default",
        fetchImpl
      });

      const result = await adapter
        .createImageGeneration({
          model: "agnes-model",
          prompt,
          size: "1024x1024",
          count,
          referenceImages: [{
            dataUrl: `data:image/png;base64,${base64}`,
            mimeType: "image/png"
          }]
        });

      expect(fetchImpl).toHaveBeenCalledTimes(count);
      expect(result).toEqual({
        images: Array.from({ length: count }, () => ({
          sourceType: "base64",
          base64: "iVBORw0KGgo="
        }))
      });
      const bodies = fetchImpl.mock.calls.map((call) =>
        JSON.parse(call[1]?.body as string) as Record<string, unknown>
      );
      const prompts = bodies.map((body) => String(body.prompt));
      expect(prompts[0]).toBe(prompt);
      expect(new Set(prompts).size).toBe(count);
      expect(prompts.every((value) => value.includes(prompt))).toBe(true);
      expect(prompts.slice(1).every((value, index) =>
        value.includes(`[Batch variation ${index + 2}:`)
      )).toBe(true);
      expect(bodies.every((body) =>
        JSON.stringify(body).includes(base64)
      )).toBe(true);
    }
  );

  it("stops after a later Agnes candidate fails and keeps prior outputs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const callIndex = fetchImpl.mock.calls.length;
      if (callIndex === 3) {
        return new Response("provider failure", { status: 503 });
      }
      return new Response(
        JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
        { status: 200 }
      );
    });
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    await expect(
      adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A red product with fixed text",
        size: "1024x1024",
        count: 4
      })
    ).resolves.toMatchObject({ images: expect.any(Array) });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not issue a second Agnes request after the first candidate fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("provider failure", { status: 429 })
    );
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    const error = await adapter
      .createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 2
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.statusCode).toBe(429);
    expect(error.endpointPath).toBe("/v1/images/generations");
    expect(error.message).toBe("AI provider request failed");
    expect(String(error)).not.toContain("provider failure");
    expect(JSON.stringify(error)).not.toContain("provider failure");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("normalizes a non-2xx Agnes body-read rejection with its status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error("secret upstream read error");
      }
    }) as unknown as Response);
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      fetchImpl
    });

    const error = await adapter
      .createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 1
      })
      .catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error.statusCode).toBe(502);
    expect(error.endpointPath).toBe("/v1/images/generations");
    expect(error.message).toBe("AI provider request failed");
    expect(String(error)).not.toContain("secret upstream read error");
    expect(JSON.stringify(error)).not.toContain("secret upstream read error");
  });

  it("applies the timeout independently to sequential Agnes candidates", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 40);
        });
        return new Response(
          JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
          { status: 200 }
        );
      });
      const adapter = createAgnesImageAdapter({
        baseUrl: "https://agnes.example/api",
        apiKey: "agnes-key",
        defaultModel: "agnes-default",
        timeoutMs: 50,
        fetchImpl
      });

      const pending = adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 2
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(40);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(40);

      await expect(pending).resolves.toMatchObject({
        images: [
          { sourceType: "base64", base64: "iVBORw0KGgo=" },
          { sourceType: "base64", base64: "iVBORw0KGgo=" }
        ]
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps prior Agnes outputs when a later candidate times out", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const callIndex = fetchImpl.mock.calls.length;
        if (callIndex === 3) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            );
          });
        }
        return new Response(
          JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
          { status: 200 }
        );
      });
      const adapter = createAgnesImageAdapter({
        baseUrl: "https://agnes.example/api",
        apiKey: "agnes-key",
        defaultModel: "agnes-default",
        timeoutMs: 50,
        fetchImpl
      });

      const pending = adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A red product with fixed text",
        size: "1024x1024",
        count: 4
      });
      await vi.advanceTimersByTimeAsync(50);
      const result = await pending;

      expect(result.images).toHaveLength(2);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("parent abort after a prior Agnes output does not return partial success", async () => {
    let resolveSecondStarted: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStarted = resolve;
    });
    const parent = new AbortController();
    const firstImage = "iVBORw0KGgo=";
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (fetchImpl.mock.calls.length === 2) {
        resolveSecondStarted?.();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        });
      }

      return new Response(
        JSON.stringify({ data: [{ b64_json: firstImage }] }),
        { status: 200 }
      );
    });
    const adapter = createAgnesImageAdapter({
      baseUrl: "https://agnes.example/api",
      apiKey: "agnes-key",
      defaultModel: "agnes-default",
      timeoutMs: 1_000,
      fetchImpl
    });

    const pending = adapter.createImageGeneration({
      model: "agnes-model",
      prompt: "A red product with fixed text",
      size: "1024x1024",
      count: 2,
      signal: parent.signal
    });

    await secondStarted;
    parent.abort();
    const error = await pending.catch((value) => value);

    expect(error).toBeInstanceOf(AIProviderAbortError);
    expect(error).not.toBeInstanceOf(AIProviderTimeoutError);
    expect(error).not.toBeInstanceOf(AIProviderRequestError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails the Agnes batch on a first-candidate timeout without a second call", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true }
          );
        })
      );
      const adapter = createAgnesImageAdapter({
        baseUrl: "https://agnes.example/api",
        apiKey: "agnes-key",
        defaultModel: "agnes-default",
        timeoutMs: 50,
        fetchImpl
      });

      const pending = adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 2
      });
      const rejection = expect(pending).rejects.toBeInstanceOf(
        AIProviderTimeoutError
      );
      await vi.advanceTimersByTimeAsync(50);

      await rejection;
      expect(aborted).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the full per-request timeout for an explicit count=1 request", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      let settled = false;
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true }
          );
        })
      );
      const adapter = createAgnesImageAdapter({
        baseUrl: "https://agnes.example/api",
        apiKey: "agnes-key",
        defaultModel: "agnes-default",
        timeoutMs: 600000,
        batchTimeoutMs: 600000,
        fetchImpl
      });

      const pending = adapter
        .createImageGeneration({
          model: "agnes-model",
          prompt: "A quiet reading room",
          size: "1024x1024",
          count: 1
        })
        .then(
          () => undefined,
          (error) => error
        )
        .finally(() => {
          settled = true;
        });

      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(240000);
      expect(settled).toBe(false);
      expect(aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(360000);
      const result = await pending;

      expect(result).toBeInstanceOf(AIProviderTimeoutError);
      expect(aborted).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out an Agnes candidate when the response body hangs after headers", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => ({
        ok: true,
        status: 200,
        text: async () => "",
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true }
            );
          })
      }) as Response);
      const adapter = createAgnesImageAdapter({
        baseUrl: "https://agnes.example/api",
        apiKey: "agnes-key",
        defaultModel: "agnes-default",
        timeoutMs: 50,
        batchTimeoutMs: 100,
        fetchImpl
      });

      const pending = adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 2
      });
      const rejection = expect(pending).rejects.toBeInstanceOf(
        AIProviderTimeoutError
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);

      await rejection;
      expect(aborted).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns prior Agnes outputs when the batch deadline aborts a later body", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const callIndex = fetchImpl.mock.calls.length;
        if (callIndex === 3) {
          return {
            ok: true,
            status: 200,
            text: async () => "",
            json: () =>
              new Promise<unknown>((_resolve, reject) => {
                init?.signal?.addEventListener(
                  "abort",
                  () => {
                    aborted = true;
                    reject(new DOMException("aborted", "AbortError"));
                  },
                  { once: true }
                );
              })
          } as Response;
        }

        return new Response(
          JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
          { status: 200 }
        );
      });
      const adapter = createAgnesImageAdapter({
        baseUrl: "https://agnes.example/api",
        apiKey: "agnes-key",
        defaultModel: "agnes-default",
        timeoutMs: 200,
        batchTimeoutMs: 50,
        fetchImpl
      });

      const pending = adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A red product with fixed text",
        size: "1024x1024",
        count: 4
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toEqual({
        images: [
          { sourceType: "base64", base64: "iVBORw0KGgo=" },
          { sourceType: "base64", base64: "iVBORw0KGgo=" }
        ]
      });
      expect(aborted).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails without outputs when the Agnes batch deadline aborts the first body", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => ({
        ok: true,
        status: 200,
        text: async () => "",
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true }
            );
          })
      }) as Response);
      const adapter = createAgnesImageAdapter({
        baseUrl: "https://agnes.example/api",
        apiKey: "agnes-key",
        defaultModel: "agnes-default",
        timeoutMs: 200,
        batchTimeoutMs: 50,
        fetchImpl
      });

      const pending = adapter.createImageGeneration({
        model: "agnes-model",
        prompt: "A quiet reading room",
        size: "1024x1024",
        count: 2
      });
      const rejection = expect(pending).rejects.toBeInstanceOf(
        AIProviderTimeoutError
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);

      await rejection;
      expect(aborted).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
