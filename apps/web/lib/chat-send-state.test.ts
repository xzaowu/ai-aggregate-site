import { describe, expect, it } from "vitest";
import {
  buildChatCompletionPayload,
  canSendChatMessage,
  createDeleteSessionNetworkErrorMessage,
  createDeleteSessionRequest,
  createModelChangeState,
  createSessionDeleteState,
  formatModelAccessLabel,
  formatModelCreditCostLabel,
  groupModelsForDisplay,
  isChatCompletionStreamResponseUsable,
  parseChatCompletionStreamChunk,
  validateModelBeforeSend,
  readResponseErrorMessage,
  releaseChatSendLock,
  resolveRequestModel,
  tryAcquireChatSendLock,
  shouldSubmitOnEnter
} from "./chat-send-state";

describe("chat send state", () => {
  it("allows anonymous sends without token or active session", () => {
    expect(
      canSendChatMessage({
        input: " hi ",
        isSending: false,
        selectedModel: "openai/gpt-oss-120b:free"
      })
    ).toBe(true);
  });

  it("allows the default GPT OSS model to send", () => {
    expect(
      canSendChatMessage({
        input: "hi",
        isSending: false,
        selectedModel: "openai/gpt-oss-120b:free"
      })
    ).toBe(true);
  });

  it("only disables sending for empty input, sending state, or missing model", () => {
    expect(
      canSendChatMessage({
        input: "   ",
        isSending: false,
        selectedModel: "openai/gpt-oss-120b:free"
      })
    ).toBe(false);
    expect(
      canSendChatMessage({
        input: "hi",
        isSending: true,
        selectedModel: "openai/gpt-oss-120b:free"
      })
    ).toBe(false);
    expect(
      canSendChatMessage({
        input: "hi",
        isSending: false,
        selectedModel: ""
      })
    ).toBe(false);
  });

  it("omits sessionId from anonymous chat completion payloads", () => {
    expect(
      buildChatCompletionPayload({
        sessionId: null,
        model: "openai/gpt-oss-120b:free",
        messages: [{ role: "user", content: "hi" }]
      })
    ).toEqual({
      model: "openai/gpt-oss-120b:free",
      messages: [{ role: "user", content: "hi" }]
    });
  });

  it("tracks selected model values when switching between chat model IDs", () => {
    const deepseekState = createModelChangeState({
      oldModel: "openai/gpt-oss-120b:free",
      nextModel: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
      isAnonymous: true,
      messages: [],
      currentSessionId: null,
      error: null
    });
    const gptOssState = createModelChangeState({
      oldModel: deepseekState.selectedModel,
      nextModel: "openai/gpt-oss-120b:free",
      isAnonymous: true,
      messages: [],
      currentSessionId: null,
      error: null
    });

    expect(deepseekState.selectedModel).toBe(
      "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B"
    );
    expect(gptOssState.selectedModel).toBe("openai/gpt-oss-120b:free");
  });

  it("clears local anonymous messages when switching models", () => {
    const nextState = createModelChangeState({
      oldModel: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
      nextModel: "openai/gpt-oss-120b:free",
      isAnonymous: true,
      messages: [
        {
          id: "message_1",
          sessionId: "anonymous",
          role: "assistant",
          content: "DeepSeek context",
          model: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
          createdAt: "2026-06-08T00:00:00.000Z"
        }
      ],
      currentSessionId: "session_1",
      error: "previous error"
    });

    expect(nextState.messages).toEqual([]);
    expect(nextState.currentSessionId).toBeNull();
    expect(nextState.error).toBeNull();
  });

  it("uses the selected model canonical slug in payloads, not upstream model IDs or display names", () => {
    const requestModel = resolveRequestModel({
      selectedModel: "openai/gpt-oss-120b:free",
      fallbackModel: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
      selectedModelInfo: {
        slug: "gpt-oss-120b-free"
      }
    });

    expect(requestModel).toBe("gpt-oss-120b-free");
    expect(
      buildChatCompletionPayload({
        sessionId: null,
        model: requestModel,
        messages: [{ role: "user", content: "hi" }]
      }).model
    ).not.toBe("GPT OSS 120B Free");
    expect(requestModel).not.toBe("openai/gpt-oss-120b:free");
  });

  it("parses split SSE chunks and merges stream deltas in order", () => {
    let parsed = parseChatCompletionStreamChunk({
      buffer: "",
      chunk: 'event: meta\ndata: {"sessionId":"session_1","model":"m'
    });

    expect(parsed.events).toEqual([]);
    expect(parsed.buffer).toContain("event: meta");

    parsed = parseChatCompletionStreamChunk({
      buffer: parsed.buffer,
      chunk:
        'odel_1"}\n\nevent: delta\ndata: {"content":"Hel"}\n\nevent: delta\ndata: {"content":"lo"}\n\n'
    });

    const content = parsed.events
      .filter((event) => event.event === "delta")
      .map((event) => event.data.content ?? "")
      .join("");

    expect(parsed.events).toEqual([
      {
        event: "meta",
        data: {
          sessionId: "session_1",
          model: "model_1"
        }
      },
      {
        event: "delta",
        data: {
          content: "Hel"
        }
      },
      {
        event: "delta",
        data: {
          content: "lo"
        }
      }
    ]);
    expect(content).toBe("Hello");
    expect(parsed.buffer).toBe("");
  });

  it("surfaces malformed SSE JSON as a safe parser failure", () => {
    expect(() =>
      parseChatCompletionStreamChunk({
        buffer: "",
        chunk: 'event: delta\ndata: {"content":\n\n'
      })
    ).toThrow(SyntaxError);
  });

  it("uses a synchronous lock to reject rapid duplicate sends and releases after completion", () => {
    const lock = { current: false };

    expect(tryAcquireChatSendLock(lock)).toBe(true);
    expect(tryAcquireChatSendLock(lock)).toBe(false);

    releaseChatSendLock(lock);
    expect(tryAcquireChatSendLock(lock)).toBe(true);
  });

  it.each([404, 405, 501, 429, 500])(
    "treats HTTP %i stream failures as unusable without a client fallback",
    (status) => {
      expect(
        isChatCompletionStreamResponseUsable(
          new Response("raw upstream body", { status })
        )
      ).toBe(false);
    }
  );

  it("treats a successful response without a readable stream as unusable", () => {
    expect(
      isChatCompletionStreamResponseUsable({
        ok: true,
        body: null
      })
    ).toBe(false);
  });

  it("keeps the old non-streaming chat completion payload available", () => {
    expect(
      buildChatCompletionPayload({
        sessionId: "session_1",
        model: "openai/gpt-oss-120b:free",
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
          { role: "user", content: "continue" }
        ]
      })
    ).toEqual({
      sessionId: "session_1",
      model: "openai/gpt-oss-120b:free",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "continue" }
      ]
    });
  });

  it("falls back to the default model only when selectedModel is empty", () => {
    expect(
      resolveRequestModel({
        selectedModel: "",
        fallbackModel: "openai/gpt-oss-120b:free"
      })
    ).toBe("openai/gpt-oss-120b:free");
  });

  it("formats model credit cost and access labels for chat model selection", () => {
    expect(formatModelCreditCostLabel(0, "zh-CN")).toBe("免费");
    expect(formatModelCreditCostLabel(0, "en-US")).toBe("Free");
    expect(formatModelCreditCostLabel(1, "zh-CN")).toBe("消耗 1 额度 / 次");
    expect(formatModelCreditCostLabel(3, "en-US")).toBe(
      "3 credits per message"
    );
    expect(formatModelAccessLabel(true, false, "zh-CN")).toBe("游客可用");
    expect(formatModelAccessLabel(false, false, "en-US")).toBe(
      "Sign-in required"
    );
    expect(formatModelAccessLabel(false, true, "zh-CN")).toBe("登录后可用");
  });

  it("groups recommended models before their model group sections", () => {
    const sections = groupModelsForDisplay(
      [
        {
          id: "model_advanced",
          name: "Advanced",
          slug: "advanced",
          provider: "SUB2API",
          modelId: "advanced-model",
          capability: "chat",
          enabled: true,
          maxReferenceImages: 1,
          creditCost: 4,
          allowGuest: false,
          sortOrder: 3,
          group: "advanced",
          tags: ["analysis"],
          shortDescription: "Advanced model",
          isRecommended: false
        },
        {
          id: "model_free",
          name: "Free",
          slug: "free",
          provider: "SUB2API",
          modelId: "free-model",
          capability: "chat",
          enabled: true,
          maxReferenceImages: 1,
          creditCost: 1,
          allowGuest: true,
          sortOrder: 2,
          group: "free",
          tags: ["free", "chat"],
          shortDescription: "Free model",
          isRecommended: true
        },
        {
          id: "model_reasoning",
          name: "Reasoning",
          slug: "reasoning",
          provider: "SUB2API",
          modelId: "reasoning-model",
          capability: "chat",
          enabled: true,
          maxReferenceImages: 1,
          creditCost: 1,
          allowGuest: true,
          sortOrder: 1,
          group: "reasoning",
          tags: ["reasoning"],
          shortDescription: "Reasoning model",
          isRecommended: true
        }
      ],
      "en-US"
    );

    expect(sections.map((section) => section.title)).toEqual([
      "Recommended",
      "Free Models",
      "Reasoning Models",
      "Advanced Models"
    ]);
    expect(sections[0]?.models.map((model) => model.modelId)).toEqual([
      "reasoning-model",
      "free-model"
    ]);
    expect(sections[1]?.models.map((model) => model.modelId)).toEqual([
      "free-model"
    ]);
  });

  it("blocks guests from sending to sign-in required models before the request", () => {
    expect(
      validateModelBeforeSend({
        isLoggedIn: false,
        remainingCredits: null,
        model: {
          creditCost: 2,
          allowGuest: false
        },
        locale: "en-US"
      })
    ).toEqual("This model requires sign-in");
  });

  it("blocks logged-in sends when remaining credits are below the model credit cost", () => {
    expect(
      validateModelBeforeSend({
        isLoggedIn: true,
        remainingCredits: 1,
        model: {
          creditCost: 2,
          allowGuest: false
        },
        locale: "zh-CN"
      })
    ).toBe("额度不足，当前模型每次需要 2 额度");
  });

  it("submits on Enter and keeps Shift Enter for new lines", () => {
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitOnEnter({ key: "a", shiftKey: false })).toBe(false);
  });

  it("does not submit Enter while the user is composing text", () => {
    expect(
      shouldSubmitOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: true
      })
    ).toBe(false);
  });

  it("selects the next available session when deleting the active session", () => {
    const nextState = createSessionDeleteState({
      deletedSessionId: "session_1",
      currentSessionId: "session_1",
      sessions: [
        {
          id: "session_1",
          userId: "user_1",
          title: "First",
          createdAt: "2026-06-09T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z"
        },
        {
          id: "session_2",
          userId: "user_1",
          title: "Second",
          createdAt: "2026-06-09T00:01:00.000Z",
          updatedAt: "2026-06-09T00:01:00.000Z"
        }
      ]
    });

    expect(nextState.sessions.map((session) => session.id)).toEqual([
      "session_2"
    ]);
    expect(nextState.currentSessionId).toBe("session_2");
    expect(nextState.shouldReloadMessages).toBe(true);
  });

  it("keeps the current session selected when deleting another session", () => {
    const nextState = createSessionDeleteState({
      deletedSessionId: "session_2",
      currentSessionId: "session_1",
      sessions: [
        {
          id: "session_1",
          userId: "user_1",
          title: "First",
          createdAt: "2026-06-09T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z"
        },
        {
          id: "session_2",
          userId: "user_1",
          title: "Second",
          createdAt: "2026-06-09T00:01:00.000Z",
          updatedAt: "2026-06-09T00:01:00.000Z"
        }
      ]
    });

    expect(nextState.sessions.map((session) => session.id)).toEqual([
      "session_1"
    ]);
    expect(nextState.currentSessionId).toBe("session_1");
    expect(nextState.shouldReloadMessages).toBe(false);
  });

  it("clears the active session when deleting the last remaining session", () => {
    const nextState = createSessionDeleteState({
      deletedSessionId: "session_1",
      currentSessionId: "session_1",
      sessions: [
        {
          id: "session_1",
          userId: "user_1",
          title: "First",
          createdAt: "2026-06-09T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z"
        }
      ]
    });

    expect(nextState.sessions).toEqual([]);
    expect(nextState.currentSessionId).toBeNull();
    expect(nextState.shouldReloadMessages).toBe(false);
  });

  it("builds session delete requests with Authorization", () => {
    expect(
      createDeleteSessionRequest({
        apiBaseUrl: "http://localhost:4000",
        sessionId: "session_1",
        token: "token_123"
      })
    ).toEqual({
      url: "http://localhost:4000/chat/sessions/session_1",
      init: {
        method: "DELETE",
        headers: {
          Authorization: "Bearer token_123"
        }
      }
    });
  });

  it("does not build a session delete request without token", () => {
    expect(
      createDeleteSessionRequest({
        apiBaseUrl: "http://localhost:4000",
        sessionId: "session_1",
        token: null
      })
    ).toBeNull();
  });

  it("builds delete-session network error messages from localized labels", () => {
    expect(
      createDeleteSessionNetworkErrorMessage({
        deleteFailedMessage: "Delete failed",
        apiUnreachableMessage: "Unable to connect to API"
      })
    ).toBe("Delete failed: Unable to connect to API");
  });

  it("reads backend JSON and non-JSON error responses safely", async () => {
    await expect(
      readResponseErrorMessage(
        new Response(JSON.stringify({ message: "chat session not found" }), {
          status: 404
        }),
        "Request failed"
      )
    ).resolves.toBe("chat session not found");

    await expect(
      readResponseErrorMessage(
        new Response("upstream down", { status: 502 }),
        "Request failed"
      )
    ).resolves.toBe("upstream down");
  });
});
