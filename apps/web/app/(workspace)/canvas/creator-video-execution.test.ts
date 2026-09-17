import type {
  AiAssetSummary,
  AiTaskDetailResponse,
  AiTaskSummary,
  PublicVideoModelSummary
} from "@ai-aggregate/shared";
import { describe, expect, it, vi } from "vitest";
import { buildCreatorNodeComposerContext } from "./creator-node-composer-context";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import {
  compileCreatorVideoExecutionIntent,
  createCreatorVideoExecutionAttempt,
  createCreatorVideoSubmissionPayload,
  CREATOR_VIDEO_POLL_MAX_ATTEMPTS,
  parseCreatorVideoSubmissionResponse,
  parseCreatorVideoTaskDetail,
  prepareCreatorVideoSubmissionPayload,
  readCreatorVideoTaskProgress,
  selectCreatorVideoTerminalAsset,
  waitForCreatorVideoDelay,
  type CreatorVideoExecutionIntent
} from "./creator-video-execution";
import { createCreatorVideoComposerDraft } from "./creator-video-composer";

const model: PublicVideoModelSummary = {
  id: "video-model-id",
  name: "Canvas Video",
  displayName: "Canvas Video",
  slug: "canvas-video",
  capability: "video",
  displaySurfaces: ["video"],
  group: "video",
  tags: ["video"],
  enabled: true,
  creditCost: 12,
  allowGuest: false,
  sortOrder: 0,
  isRecommended: true,
  videoProfile: {
    id: "video-profile",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 6,
    resolution: "1280x720",
    aspectRatio: "16:9"
  }
};

const imageModel: PublicVideoModelSummary = {
  ...model,
  id: "image-video-model-id",
  slug: "image-video",
  videoProfile: {
    ...model.videoProfile,
    supportsTextToVideo: false,
    supportsImageToVideo: true
  }
};

function documentWithVideo(): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "image-source",
        kind: "image",
        position: { x: 0, y: 0 },
        data: { assetId: "asset-source" }
      },
      {
        id: "video-target",
        kind: "video",
        position: { x: 300, y: 0 },
        data: { assetId: null }
      }
    ],
    edges: [{
      id: "image-video",
      sourceNodeId: "image-source",
      targetNodeId: "video-target",
      relationship: "reference"
    }],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function videoContext() {
  const context = buildCreatorNodeComposerContext(documentWithVideo(), "video-target");
  if (!context) throw new Error("VIDEO_CONTEXT_MISSING");
  return context;
}

function task(
  status: AiTaskSummary["status"] = "succeeded",
  overrides: Partial<AiTaskSummary> = {}
): AiTaskSummary {
  return {
    id: "task-video-1",
    userId: "user-1",
    type: "video",
    status,
    modelId: model.slug,
    prompt: "Animate the product",
    input: { mode: "text-to-video", videoProgress: status === "succeeded" ? 100 : 48 },
    output: status === "succeeded" ? { videos: ["asset-video-1"] } : null,
    costCredits: model.creditCost,
    errorMessage: status === "failed" ? "internal failure" : null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:02.000Z",
    completedAt: status === "succeeded" || status === "failed"
      ? "2026-09-03T00:00:02.000Z"
      : null,
    ...overrides
  };
}

function asset(
  id = "asset-video-1",
  type: AiAssetSummary["type"] = "video"
): AiAssetSummary {
  return {
    id,
    userId: "user-1",
    taskId: "task-video-1",
    type,
    url: `/assets/${id}/content`,
    thumbnailUrl: null,
    title: "Generated video",
    metadata: { mimeType: "video/mp4" },
    createdAt: "2026-09-03T00:00:02.000Z",
    taskPrompt: "Animate the product"
  };
}

function detail(
  status: AiTaskSummary["status"] = "succeeded",
  assets: AiAssetSummary[] = [asset()]
): AiTaskDetailResponse {
  return { task: task(status), assets };
}

function t2vIntent(): CreatorVideoExecutionIntent {
  const context = buildCreatorNodeComposerContext({
    ...documentWithVideo(),
    edges: []
  }, "video-target");
  if (!context) throw new Error("T2V_CONTEXT_MISSING");
  const compiled = compileCreatorVideoExecutionIntent({
    draft: {
      ...createCreatorVideoComposerDraft(model.slug),
      prompt: "  Animate the product  "
    },
    context,
    models: [model]
  });
  if (!compiled.ok) throw new Error("T2V_INTENT_MISSING");
  return compiled.intent;
}

describe("Creator Video execution", () => {
  it("compiles immutable T2V and I2V intents and payloads", () => {
    const t2v = t2vIntent();
    expect(t2v).toEqual({
      targetNodeId: "video-target",
      prompt: "Animate the product",
      modelId: model.slug,
      mode: "text-to-video",
      reference: null
    });
    expect(createCreatorVideoSubmissionPayload(t2v)).toEqual({
      modelId: model.slug,
      mode: "text-to-video",
      prompt: "Animate the product"
    });

    const context = videoContext();
    const compiled = compileCreatorVideoExecutionIntent({
      draft: {
        ...createCreatorVideoComposerDraft(model.slug),
        prompt: "Animate this image",
        mode: "image-to-video",
        selectedImageReferenceNodeId: "image-source"
      },
      context,
      models: [model]
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.intent.reference).toEqual({
      sourceNodeId: "image-source",
      assetId: "asset-source"
    });
    expect(createCreatorVideoSubmissionPayload(compiled.intent, {
      dataUrl: "data:image/jpeg;base64,AAAA",
      mimeType: "image/jpeg",
      name: "source.jpg",
      originalBytes: 100,
      compressedBytes: 80
    })).toMatchObject({
      modelId: model.slug,
      mode: "image-to-video",
      prompt: "Animate this image",
      referenceImage: {
        dataUrl: "data:image/jpeg;base64,AAAA",
        mimeType: "image/jpeg"
      }
    });
  });

  it("rejects invalid executable intents without mutating source inputs", () => {
    const context = videoContext();
    const sourceDraft = {
      ...createCreatorVideoComposerDraft(model.slug),
      prompt: " ",
      mode: "image-to-video" as const,
      selectedImageReferenceNodeId: null
    };
    const before = JSON.stringify(sourceDraft);
    expect(compileCreatorVideoExecutionIntent({
      draft: sourceDraft,
      context,
      models: [model]
    })).toEqual({ ok: false, error: "PROMPT_REQUIRED" });
    expect(compileCreatorVideoExecutionIntent({
      draft: {
        ...sourceDraft,
        prompt: "valid",
        modelId: "missing",
        mode: "text-to-video"
      },
      context,
      models: [model]
    })).toEqual({ ok: false, error: "MODEL_UNAVAILABLE" });
    expect(compileCreatorVideoExecutionIntent({
      draft: {
        ...sourceDraft,
        prompt: "valid",
        modelId: model.slug
      },
      context,
      models: [model]
    })).toEqual({ ok: false, error: "REFERENCE_REQUIRED" });
    expect(JSON.stringify(sourceDraft)).toBe(before);
  });

  it("prepares an owner-private I2V reference and fences abort/failure", async () => {
    const intent: CreatorVideoExecutionIntent = {
      targetNodeId: "video-target",
      prompt: "Animate this image",
      modelId: imageModel.slug,
      mode: "image-to-video",
      reference: { sourceNodeId: "image-source", assetId: "asset-source" }
    };
    const blob = new Blob(["image"], { type: "image/png" });
    const resolve = vi.fn(async ({ assetId, token }: { assetId: string; token: string }) => ({
      asset: { ...asset("asset-source", "image"), title: "source.png", id: assetId },
      task: null,
      blob
    }));
    const compress = vi.fn(async () => ({
      dataUrl: "data:image/jpeg;base64,COMPRESSED",
      compressedBytes: 80,
      sourceWidth: 640,
      sourceHeight: 480
    }));
    const payload = await prepareCreatorVideoSubmissionPayload({
      intent,
      token: "current-token",
      controller: new AbortController(),
      resolveOwnerImageAssetReferenceImplementation: resolve as never,
      compressReferenceImageImplementation: compress as never,
      withTimeoutImplementation: async (operation) => operation
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset-source",
      token: "current-token"
    }));
    expect(compress).toHaveBeenCalledWith(blob);
    expect(payload).toEqual({
      modelId: imageModel.slug,
      mode: "image-to-video",
      prompt: "Animate this image",
      referenceImage: {
        dataUrl: "data:image/jpeg;base64,COMPRESSED",
        mimeType: "image/jpeg",
        name: "source.png",
        originalBytes: blob.size,
        compressedBytes: 80
      }
    });

    const aborted = new AbortController();
    aborted.abort();
    await expect(prepareCreatorVideoSubmissionPayload({
      intent,
      token: "token",
      controller: aborted,
      withTimeoutImplementation: async (operation) => operation
    })).rejects.toMatchObject({ name: "AbortError" });

    await expect(prepareCreatorVideoSubmissionPayload({
      intent,
      token: "token",
      controller: new AbortController(),
      resolveOwnerImageAssetReferenceImplementation: vi.fn(async () => {
        throw new Error("asset unavailable");
      }) as never,
      withTimeoutImplementation: async (operation) => operation
    })).rejects.toMatchObject({
      name: "CreatorVideoReferencePreparationError",
      errorKey: "creator.canvas.videoComposer.referencePreparationFailed"
    });
  });

  it("freezes the immutable payload and reuses one idempotency key for replay", () => {
    const payload = {
      modelId: model.slug,
      mode: "image-to-video" as const,
      prompt: "Animate",
      referenceImage: {
        dataUrl: "data:image/jpeg;base64,AAAA",
        mimeType: "image/jpeg",
        name: "original.jpg",
        originalBytes: 100,
        compressedBytes: 80
      }
    };
    const attempt = createCreatorVideoExecutionAttempt(payload, () => "1234567890abcdef");
    payload.prompt = "mutated";
    payload.referenceImage.name = "mutated.jpg";
    expect(attempt.key).toBe("1234567890abcdef");
    expect(attempt.payload.prompt).toBe("Animate");
    expect(attempt.payload.referenceImage?.name).toBe("original.jpg");
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(Object.isFrozen(attempt.payload)).toBe(true);
    expect(Object.isFrozen(attempt.payload.referenceImage)).toBe(true);
    expect(createCreatorVideoExecutionAttempt(payload, () => "1234567890abcdef").key)
      .toBe(attempt.key);
  });

  it("parses accepted, null-task replay, idempotent replay, and bounded failures", () => {
    expect(parseCreatorVideoSubmissionResponse(202, {
      status: "in_progress",
      taskId: "task-video-1",
      retryAfterMs: 1_000
    })).toEqual({ kind: "accepted", taskId: "task-video-1", retryAfterMs: 1_000 });
    expect(parseCreatorVideoSubmissionResponse(202, {
      status: "in_progress",
      taskId: null,
      retryAfterMs: 999_999
    })).toEqual({ kind: "accepted", taskId: null, retryAfterMs: 10_000 });
    expect(parseCreatorVideoSubmissionResponse(200, detail()).kind).toBe("replayed");
    expect(parseCreatorVideoSubmissionResponse(409, {})).toEqual({
      kind: "failed",
      reason: "conflict"
    });
    expect(parseCreatorVideoSubmissionResponse(202, { status: "in_progress", taskId: 5, retryAfterMs: 0 }))
      .toEqual({ kind: "failed", reason: "malformed" });
    expect(parseCreatorVideoSubmissionResponse(500, {})).toEqual({
      kind: "failed",
      reason: "malformed"
    });
  });

  it("parses task progress/status and selects only a matching successful Video asset", () => {
    const pending = parseCreatorVideoTaskDetail(detail("pending"));
    const running = parseCreatorVideoTaskDetail(detail("running"));
    const succeeded = parseCreatorVideoTaskDetail(detail());
    const failed = parseCreatorVideoTaskDetail(detail("failed", []));
    expect(pending?.task.status).toBe("pending");
    expect(running?.task.status).toBe("running");
    expect(failed?.task.status).toBe("failed");
    expect(readCreatorVideoTaskProgress(task("running"))).toBe(48);
    expect(readCreatorVideoTaskProgress(task("running", { input: {} }))).toBeNull();
    expect(succeeded).not.toBeNull();
    if (!succeeded) return;
    expect(selectCreatorVideoTerminalAsset(succeeded, "task-video-1")?.asset.id)
      .toBe("asset-video-1");
    expect(selectCreatorVideoTerminalAsset(succeeded, "other-task")).toBeNull();
    expect(selectCreatorVideoTerminalAsset(
      { task: task("succeeded"), assets: [asset("image-1", "image")] },
      "task-video-1"
    )).toBeNull();
    expect(parseCreatorVideoTaskDetail({ task: { ...task(), status: "weird" }, assets: [] })).toBeNull();
    expect(parseCreatorVideoTaskDetail({ task: task(), assets: [{ id: "bad" }] })).toBeNull();
    expect(CREATOR_VIDEO_POLL_MAX_ATTEMPTS).toBeGreaterThan(0);
  });

  it("keeps delay abortable and bounded", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitForCreatorVideoDelay(0, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
    await expect(waitForCreatorVideoDelay(0)).resolves.toBeUndefined();
  });
});
