import type { AiModelSummary } from "@ai-aggregate/shared";
import { describe, expect, it, vi } from "vitest";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import {
  compileCreatorImageExecutionIntent,
  prepareCreatorImageGenerationPayload
} from "./creator-image-execution";
import {
  createCreatorImageComposerDraft,
  type CreatorImageComposerDraft
} from "./creator-image-composer";
import { buildCreatorNodeComposerContext } from "./creator-node-composer-context";

const model = {
  id: "canvas-model",
  name: "Canvas Image",
  displayName: "Canvas Image",
  slug: "canvas-image",
  provider: "OPENAI_COMPATIBLE",
  modelId: "upstream-canvas-image",
  capability: "image",
  displaySurfaces: ["image"],
  group: "image",
  tags: ["image"],
  enabled: true,
  maxReferenceImages: 1,
  creditCost: 2,
  allowGuest: false,
  sortOrder: 0,
  isRecommended: true
} satisfies AiModelSummary;

function createDocument(targetAssetId: string | null): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "incoming-image",
        kind: "image",
        position: { x: 0, y: 0 },
        data: { assetId: "incoming-asset" }
      },
      {
        id: "target-image",
        kind: "image",
        position: { x: 400, y: 0 },
        data: { assetId: targetAssetId }
      }
    ],
    edges: [
      {
        id: "incoming-edge",
        sourceNodeId: "incoming-image",
        targetNodeId: "target-image",
        relationship: "reference"
      }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function compile(
  draftOverrides: Partial<CreatorImageComposerDraft> = {},
  targetAssetId: string | null = null,
  models: readonly AiModelSummary[] = [model]
) {
  const context = buildCreatorNodeComposerContext(
    createDocument(targetAssetId),
    "target-image"
  );
  if (!context) throw new Error("EXECUTION_CONTEXT_MISSING");
  return compileCreatorImageExecutionIntent({
    context,
    models,
    draft: {
      ...createCreatorImageComposerDraft(model.slug),
      prompt: "Canvas execution prompt",
      ...draftOverrides
    }
  });
}

describe("Creator Image execution intent", () => {
  it("compiles Generate as text-to-image with no reference source", () => {
    const result = compile();

    expect(result).toMatchObject({
      ok: true,
      intent: {
        targetNodeId: "target-image",
        prompt: "Canvas execution prompt",
        modelId: "canvas-image",
        mode: "text-to-image",
        reference: null
      }
    });
  });

  it("selects the current bound Image for Edit", () => {
    const result = compile(
      {
        operation: "edit",
        selectedImageReferenceNodeId: "target-image"
      },
      "current-asset"
    );

    expect(result).toMatchObject({
      ok: true,
      intent: {
        mode: "image-to-image",
        reference: { nodeId: "target-image", assetId: "current-asset" }
      }
    });
  });

  it("selects one bound incoming Image for Edit", () => {
    const result = compile({
      operation: "edit",
      selectedImageReferenceNodeId: "incoming-image"
    });

    expect(result).toMatchObject({
      ok: true,
      intent: {
        reference: { nodeId: "incoming-image", assetId: "incoming-asset" }
      }
    });
  });

  it("rejects Edit without a selected bound source before any preparation", () => {
    const result = compile({ operation: "edit", selectedImageReferenceNodeId: null });

    expect(result).toEqual({ ok: false, error: "REFERENCE_REQUIRED" });
  });

  it("rejects blank and over-4000 prompts", () => {
    expect(compile({ prompt: "   " })).toEqual({
      ok: false,
      error: "PROMPT_REQUIRED"
    });
    expect(compile({ prompt: "x".repeat(4001) })).toEqual({
      ok: false,
      error: "PROMPT_TOO_LONG"
    });
  });

  it("rejects a model slug outside the public Image model list", () => {
    expect(compile({ modelId: "upstream-canvas-image" })).toEqual({
      ok: false,
      error: "MODEL_UNAVAILABLE"
    });
    expect(compile({}, null, [])).toEqual({
      ok: false,
      error: "MODEL_UNAVAILABLE"
    });
  });

  it("rejects invalid count, aspect, and operation runtime values", () => {
    expect(compile({ count: 3 as 1 })).toEqual({ ok: false, error: "COUNT_INVALID" });
    expect(compile({ aspectRatio: "wide" as "auto" })).toEqual({
      ok: false,
      error: "ASPECT_INVALID"
    });
    expect(compile({ operation: "blend" as "generate" })).toEqual({
      ok: false,
      error: "OPERATION_INVALID"
    });
  });

  it("uses the shared explicit aspect resolver for Generate", async () => {
    const result = compile({ aspectRatio: "16:9" });
    if (!result.ok) throw new Error("GENERATE_INTENT_INVALID");

    const payload = await prepareCreatorImageGenerationPayload({
      intent: result.intent,
      token: "token",
      clientEntryId: "client-entry",
      controller: new AbortController()
    });

    expect(payload).toEqual({
      prompt: "Canvas execution prompt",
      modelId: "canvas-image",
      size: "1280x720",
      count: 1,
      mode: "text-to-image",
      clientEntryId: "client-entry"
    });
  });

  it("prepares one owner Image reference and lets dimensions drive auto Edit size", async () => {
    const result = compile({
      operation: "edit",
      selectedImageReferenceNodeId: "incoming-image",
      aspectRatio: "auto"
    });
    if (!result.ok) throw new Error("EDIT_INTENT_INVALID");
    const blob = new Blob(["original-image"], { type: "image/png" });
    const resolveOwner = vi.fn(async () => ({
      asset: {
        id: "incoming-asset",
        userId: "user-1",
        taskId: "task-1",
        type: "image" as const,
        url: "/assets/incoming-asset/content",
        thumbnailUrl: null,
        title: "Incoming image",
        metadata: null,
        createdAt: "2026-08-24T00:00:00.000Z"
      },
      task: null,
      blob
    }));
    const compress = vi.fn(async () => ({
      dataUrl: "data:image/jpeg;base64,Y2FudmFz",
      compressedBytes: 6,
      sourceWidth: 1600,
      sourceHeight: 900
    }));

    const payload = await prepareCreatorImageGenerationPayload({
      intent: result.intent,
      token: "owner-token",
      clientEntryId: "client-entry-edit",
      controller: new AbortController(),
      resolveOwnerImageAssetReferenceImplementation: resolveOwner,
      compressReferenceImageImplementation: compress
    });

    expect(resolveOwner).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "incoming-asset",
      token: "owner-token",
      signal: expect.any(AbortSignal)
    }));
    expect(payload).toEqual({
      prompt: "Canvas execution prompt",
      modelId: "canvas-image",
      size: "1280x720",
      count: 1,
      mode: "image-to-image",
      clientEntryId: "client-entry-edit",
      referenceImage: {
        dataUrl: "data:image/jpeg;base64,Y2FudmFz",
        mimeType: "image/jpeg",
        name: "Incoming image",
        originalBytes: blob.size,
        compressedBytes: 6
      }
    });
  });
});
