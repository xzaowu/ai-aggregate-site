import { describe, expect, it, vi } from "vitest";
import {
  AIProviderRequestError,
  AIProviderResponseFormatError,
  AIProviderSubmissionUncertainError,
  AIProviderTimeoutError,
  createApimartVideoAdapter,
  listApimartVideoProfiles,
  resolveApimartVideoProfile
} from "../src/index";

const BASE_URL = "https://api.apimart.ai";

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function startResponse(taskId = "task-video-1") {
  return jsonResponse({
    code: 200,
    data: [{ status: "submitted", task_id: taskId }]
  });
}

function startRequest(
  profileModel: string,
  profileId: Parameters<typeof resolveApimartVideoProfile>[0] = profileModel
) {
  const profile =
    resolveApimartVideoProfile(profileId) ??
    listApimartVideoProfiles().find((candidate) => candidate.id === profileId) ??
    null;
  if (!profile) throw new Error(`missing profile for ${profileId}`);
  return {
    model: profileModel,
    prompt: "A quiet river at sunrise",
    mode: "text-to-video" as const,
    profile
  };
}

describe("APIMART_VIDEO_TASK_V1", () => {
  it("maps only verified upstream model families to bounded profiles", () => {
    expect(listApimartVideoProfiles().map((profile) => profile.id)).toEqual([
      "seedance",
      "veo3",
      "veo3-text-only",
      "minimax-hailuo",
      "wan",
      "kling",
      "grok-imagine-1",
      "grok-imagine-1-5"
    ]);
    expect(resolveApimartVideoProfile("doubao-seedance-1-0-pro-fast")).toMatchObject({
      id: "seedance",
      supportsImageToVideo: true,
      referenceField: "image_with_roles",
      durationSeconds: 5,
      resolution: "720p"
    });
    expect(resolveApimartVideoProfile("veo3.1-fast-ext")).toMatchObject({
      id: "veo3",
      durationSeconds: 8,
      supportsImageToVideo: true
    });
    expect(resolveApimartVideoProfile("veo3.1-quality")).toMatchObject({
      id: "veo3-text-only",
      supportsImageToVideo: false
    });
    expect(resolveApimartVideoProfile("MiniMax-Hailuo-02")).toMatchObject({
      id: "minimax-hailuo",
      referenceField: "first_frame_image",
      resolution: "768p"
    });
    expect(resolveApimartVideoProfile("wan2.6")).toMatchObject({
      id: "wan",
      referenceField: "image_urls"
    });
    expect(resolveApimartVideoProfile("kling-v3")).toMatchObject({
      id: "kling",
      resolution: null,
      fixedFields: { mode: "std" }
    });
    expect(resolveApimartVideoProfile("grok-imagine-1.5-video-ext")).toMatchObject({
      id: "grok-imagine-1-5",
      durationSeconds: 6,
      referenceField: "image_urls"
    });
    expect(resolveApimartVideoProfile("unsupported-video-model")).toBeNull();
  });

  it("creates a Seedance text-to-video task with fixed fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => startResponse());
    const adapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "secret-provider-key",
      fetchImpl
    });
    const request = startRequest(
      "doubao-seedance-1-0-pro-fast",
      "doubao-seedance-1-0-pro-fast"
    );

    await expect(adapter.startVideoGeneration(request)).resolves.toEqual({
      status: "accepted",
      operationId: "task-video-1"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apimart.ai/v1/videos/generations",
      expect.objectContaining({ method: "POST" })
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer secret-provider-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      model: "doubao-seedance-1-0-pro-fast",
      prompt: "A quiet river at sunrise",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9"
    });
  });

  it("parses the Grok Imagine 1.0 object/id create response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        code: 200,
        data: {
          id: "task-grok-1-0",
          status: "submitted",
          progress: 0,
          type: "video"
        }
      })
    );
    const adapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "key",
      fetchImpl
    });

    await expect(
      adapter.startVideoGeneration(
        startRequest("grok-imagine-1.0-video-apimart", "grok-imagine-1")
      )
    ).resolves.toEqual({
      status: "accepted",
      operationId: "task-grok-1-0"
    });
    expect(resolveApimartVideoProfile("grok-imagine-1.0-video-apimart")).toMatchObject({
      id: "grok-imagine-1",
      fixedFields: { quality: "720p" }
    });
    expect(resolveApimartVideoProfile("grok-imagine-1.0-video-ext")).toBeNull();
  });

  it.each([
    "https://api.apimart.ai",
    "https://api.apimart.ai/",
    "https://api.apimart.ai/v1",
    "https://api.apimart.ai/v1/"
  ] as const)("normalizes APIMart base URL %s", async (baseUrl) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ url: "https://upload.apimart.ai/f/image/reference.png" })
      )
      .mockResolvedValueOnce(startResponse("task-url-normalization"))
      .mockResolvedValueOnce(
        jsonResponse({ code: 200, data: { status: "pending", progress: 5 } })
      );
    const adapter = createApimartVideoAdapter({
      baseUrl,
      apiKey: "key",
      fetchImpl
    });
    const profile = resolveApimartVideoProfile("MiniMax-Hailuo-02");
    if (!profile) throw new Error("missing Hailuo profile");

    await adapter.startVideoGeneration({
      model: "MiniMax-Hailuo-02",
      prompt: "Animate the subject",
      mode: "image-to-video",
      profile,
      referenceImage: {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png"
      }
    });
    await adapter.pollVideoGeneration({ operationId: "task-url-normalization" });

    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.apimart.ai/v1/uploads/images",
      "https://api.apimart.ai/v1/videos/generations",
      "https://api.apimart.ai/v1/tasks/task-url-normalization"
    ]);
  });

  it.each([
    [
      "veo3.1-fast",
      "veo3",
      { duration: 8, resolution: "720p", aspect_ratio: "16:9" },
      []
    ],
    [
      "MiniMax-Hailuo-02",
      "minimax-hailuo",
      {
        duration: 5,
        resolution: "768p",
        prompt_optimizer: true,
        fast_pretreatment: false,
        watermark: false
      },
      ["aspect_ratio"]
    ],
    [
      "wan2.6",
      "wan",
      { duration: 5, resolution: "720p", aspect_ratio: "16:9" },
      []
    ],
    [
      "kling-v3",
      "kling",
      { duration: 5, mode: "std", aspect_ratio: "16:9" },
      ["resolution"]
    ],
    [
      "grok-imagine-1.5-video-apimart",
      "grok-imagine-1-5",
      { duration: 6, resolution: "720p", size: "16:9" },
      ["aspect_ratio"]
    ]
  ] as const)("uses a model-specific %s payload", async (model, profileId, expected, absent) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => startResponse());
    const adapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "key",
      fetchImpl
    });
    await adapter.startVideoGeneration(startRequest(model, profileId));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      model,
      prompt: "A quiet river at sunrise",
      ...expected
    });
    for (const key of absent) expect(body).not.toHaveProperty(key);
  });

  it("uploads one bounded reference and maps image-to-video fields", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ url: "https://upload.apimart.ai/f/image/reference.png" })
      )
      .mockResolvedValueOnce(startResponse("task-i2v"));
    const adapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "key",
      fetchImpl
    });
    const profile = resolveApimartVideoProfile("MiniMax-Hailuo-02");
    if (!profile) throw new Error("missing Hailuo profile");

    await adapter.startVideoGeneration({
      model: "MiniMax-Hailuo-02",
      prompt: "Animate the subject",
      mode: "image-to-video",
      profile,
      referenceImage: {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png",
        filename: "reference.png"
      }
    });

    const uploadCall = fetchImpl.mock.calls[0];
    expect(uploadCall?.[0]).toBe("https://api.apimart.ai/v1/uploads/images");
    expect(uploadCall?.[1]?.method).toBe("POST");
    expect(uploadCall?.[1]?.body).toBeInstanceOf(FormData);
    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      model: "MiniMax-Hailuo-02",
      prompt: "Animate the subject",
      duration: 5,
      resolution: "768p",
      first_frame_image: "https://upload.apimart.ai/f/image/reference.png"
    });
    expect(body).not.toHaveProperty("image_urls");
    expect(body).not.toHaveProperty("aspect_ratio");
  });

  it("maps Seedance image-to-video to its documented first-frame field", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ url: "https://upload.apimart.ai/f/image/reference.png" })
      )
      .mockResolvedValueOnce(startResponse("task-seedance-i2v"));
    const adapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "key",
      fetchImpl
    });
    const profile = resolveApimartVideoProfile("doubao-seedance-1-0-pro-fast");
    if (!profile) throw new Error("missing Seedance profile");

    await adapter.startVideoGeneration({
      model: "doubao-seedance-1-0-pro-fast",
      prompt: "Animate the subject",
      mode: "image-to-video",
      profile,
      referenceImage: {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png"
      }
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      model: "doubao-seedance-1-0-pro-fast",
      image_with_roles: [
        {
          url: "https://upload.apimart.ai/f/image/reference.png",
          role: "first_frame"
        }
      ]
    });
    expect(body).not.toHaveProperty("image_urls");
  });

  it("polls pending, processing, completed, failed, and cancelled states", async () => {
    const responses = [
      jsonResponse({ code: 200, data: { status: "pending", progress: 10 } }),
      jsonResponse({ code: 200, data: { status: "processing", progress: 55 } }),
      jsonResponse({
        code: 200,
        data: {
          status: "completed",
          progress: 100,
          result: { videos: [{ url: ["https://cdn.apimart.ai/video.mp4"] }] }
        }
      }),
      jsonResponse({ code: 200, data: { status: "failed", error: "nope" } }),
      jsonResponse({ code: 200, data: { status: "cancelled", error: "stopped" } })
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const adapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "key",
      fetchImpl
    });

    await expect(adapter.pollVideoGeneration({ operationId: "task_1" })).resolves.toEqual({
      status: "pending",
      progress: 10
    });
    await expect(adapter.pollVideoGeneration({ operationId: "task_1" })).resolves.toEqual({
      status: "processing",
      progress: 55
    });
    await expect(adapter.pollVideoGeneration({ operationId: "task_1" })).resolves.toEqual({
      status: "completed",
      progress: 100,
      resultUrl: "https://cdn.apimart.ai/video.mp4"
    });
    await expect(adapter.pollVideoGeneration({ operationId: "task_1" })).resolves.toEqual({
      status: "failed",
      message: "nope"
    });
    await expect(adapter.pollVideoGeneration({ operationId: "task_1" })).resolves.toEqual({
      status: "cancelled",
      message: "stopped"
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.apimart.ai/v1/tasks/task_1"
    );
  });

  it("fails closed for malformed responses and redacts provider details", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ code: 200, data: [{ status: "submitted" }] })
    );
    const adapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "super-secret-key",
      fetchImpl
    });

    await expect(
      adapter.startVideoGeneration(
        startRequest("doubao-seedance-1-0-pro-fast", "doubao-seedance-1-0-pro-fast")
      )
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);

    const malformedGrok = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "super-secret-key",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        jsonResponse({ code: 200, data: { status: "submitted" } })
      )
    });
    await expect(
      malformedGrok.startVideoGeneration(
        startRequest("grok-imagine-1.0-video-apimart", "grok-imagine-1")
      )
    ).rejects.toBeInstanceOf(AIProviderResponseFormatError);

    const rateLimited = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "super-secret-key",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response("provider secret body", {
          status: 429,
          headers: { "retry-after": "2" }
        })
      )
    });
    const error = await rateLimited
      .pollVideoGeneration({ operationId: "task-1" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIProviderRequestError);
    expect(error).toMatchObject({ statusCode: 429, retryAfterMs: 2000 });
    expect(String(error)).not.toContain("super-secret-key");
    expect(String(error)).not.toContain("provider secret body");
  });

  it("classifies an aborted provider request as a timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true
        });
      })
    );
    const adapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "key",
      timeoutMs: 5,
      fetchImpl
    });

    await expect(
      adapter.pollVideoGeneration({ operationId: "task-1" })
    ).rejects.toBeInstanceOf(AIProviderTimeoutError);
  });

  it("marks create transport failures as uncertain submissions", async () => {
    const timeoutFetch = vi.fn<typeof fetch>(async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), {
          once: true
        });
      })
    );
    const timeoutAdapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "key",
      timeoutMs: 5,
      fetchImpl: timeoutFetch
    });
    await expect(
      timeoutAdapter.startVideoGeneration(
        startRequest("doubao-seedance-1-0-pro-fast", "doubao-seedance-1-0-pro-fast")
      )
    ).rejects.toBeInstanceOf(AIProviderSubmissionUncertainError);

    const networkAdapter = createApimartVideoAdapter({
      baseUrl: BASE_URL,
      apiKey: "key",
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error("connection reset");
      })
    });
    await expect(
      networkAdapter.startVideoGeneration(
        startRequest("doubao-seedance-1-0-pro-fast", "doubao-seedance-1-0-pro-fast")
      )
    ).rejects.toBeInstanceOf(AIProviderSubmissionUncertainError);
  });
});
