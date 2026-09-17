import type { PublicVideoModelSummary } from "@ai-aggregate/shared";
import { describe, expect, it } from "vitest";
import {
  buildCreatorNodeComposerContext,
  type CreatorNodeComposerContext
} from "./creator-node-composer-context";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import {
  cloneCreatorVideoComposerDraft,
  createCreatorVideoComposerDraft,
  editCreatorVideoPrompt,
  filterCreatorVideoModels,
  getCreatorVideoCompatibleModels,
  getCreatorVideoEffectiveModelId,
  getCreatorVideoEstimatedCost,
  getCreatorVideoImageReferenceCandidates,
  getCreatorVideoTextReferences,
  reconcileCreatorVideoComposerDraft,
  resetCreatorVideoPrompt,
  seedCreatorVideoPromptOnce,
  selectCreatorVideoImageReference,
  selectCreatorVideoPromptSeed,
  setCreatorVideoComposerMode,
  validateCreatorVideoComposerDraft
} from "./creator-video-composer";
import type { CreatorVideoComposerDraft } from "./creator-video-composer";

function model(
  slug: string,
  supportsTextToVideo = true,
  supportsImageToVideo = true,
  creditCost = 8
): PublicVideoModelSummary {
  return {
    id: `model-${slug}`,
    name: slug,
    displayName: slug,
    slug,
    capability: "video",
    displaySurfaces: ["video"],
    group: "video",
    tags: [],
    enabled: true,
    creditCost,
    allowGuest: false,
    sortOrder: 0,
    isRecommended: false,
    videoProfile: {
      id: `profile-${slug}`,
      supportsTextToVideo,
      supportsImageToVideo,
      durationSeconds: 5,
      resolution: "1280x720",
      aspectRatio: "16:9"
    }
  };
}

const videoModels = [
  model("both", true, true, 11),
  model("text-only", true, false, 4),
  model("image-only", false, true, 7)
];

function documentWithIncomingReferences(): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "text-first",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "First shot prompt" }
      },
      {
        id: "text-blank",
        kind: "text",
        position: { x: 0, y: 100 },
        data: { text: "   " }
      },
      {
        id: "text-second",
        kind: "text",
        position: { x: 0, y: 200 },
        data: { text: "Second shot prompt" }
      },
      {
        id: "image-empty",
        kind: "image",
        position: { x: 200, y: 0 },
        data: { assetId: null }
      },
      {
        id: "image-bound-a",
        kind: "image",
        position: { x: 200, y: 100 },
        data: { assetId: "asset-a" }
      },
      {
        id: "image-bound-b",
        kind: "image",
        position: { x: 200, y: 200 },
        data: { assetId: "asset-b" }
      },
      {
        id: "video-target",
        kind: "video",
        position: { x: 500, y: 100 },
        data: { assetId: null }
      }
    ],
    edges: [
      { id: "edge-first", sourceNodeId: "text-first", targetNodeId: "video-target", relationship: "reference" },
      { id: "edge-blank", sourceNodeId: "text-blank", targetNodeId: "video-target", relationship: "reference" },
      { id: "edge-image-empty", sourceNodeId: "image-empty", targetNodeId: "video-target", relationship: "reference" },
      { id: "edge-image-a", sourceNodeId: "image-bound-a", targetNodeId: "video-target", relationship: "reference" },
      { id: "edge-second", sourceNodeId: "text-second", targetNodeId: "video-target", relationship: "reference" },
      { id: "edge-image-b", sourceNodeId: "image-bound-b", targetNodeId: "video-target", relationship: "reference" }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function contextFor(
  document: CreatorCanvasDocumentV1 = documentWithIncomingReferences()
): CreatorNodeComposerContext {
  const context = buildCreatorNodeComposerContext(document, "video-target");
  if (!context) throw new Error("VIDEO_CONTEXT_MISSING");
  return context;
}

function draft(overrides: Partial<CreatorVideoComposerDraft> = {}): CreatorVideoComposerDraft {
  return {
    ...createCreatorVideoComposerDraft("both"),
    prompt: "Animate the product",
    ...overrides
  };
}

describe("Creator Video Composer", () => {
  it("creates the bounded default draft and deep-clones it", () => {
    const initial = createCreatorVideoComposerDraft("video-slug");
    expect(initial).toEqual({
      prompt: "",
      modelId: "video-slug",
      mode: "text-to-video",
      selectedImageReferenceNodeId: null,
      promptSeedSourceNodeId: null,
      promptDirty: false
    });
    const cloned = cloneCreatorVideoComposerDraft(initial);
    expect(cloned).toEqual(initial);
    expect(cloned).not.toBe(initial);
    cloned.prompt = "changed";
    expect(initial.prompt).toBe("");
  });

  it("filters models and reconciles T2V/I2V compatibility", () => {
    expect(getCreatorVideoCompatibleModels(videoModels, "text-to-video").map((item) => item.slug))
      .toEqual(["both", "text-only"]);
    expect(getCreatorVideoCompatibleModels(videoModels, "image-to-video").map((item) => item.slug))
      .toEqual(["both", "image-only"]);
    expect(getCreatorVideoEffectiveModelId("both", "text-to-video", videoModels)).toBe("both");
    expect(getCreatorVideoEffectiveModelId("image-only", "text-to-video", videoModels)).toBe("both");
    expect(getCreatorVideoEffectiveModelId("missing", "image-to-video", videoModels)).toBe("both");
    expect(getCreatorVideoEffectiveModelId("missing", "text-to-video", [])).toBeNull();
    expect(filterCreatorVideoModels([videoModels[0]!])).toEqual([videoModels[0]]);

    const invalid = {
      ...videoModels[0],
      enabled: false
    } as unknown as PublicVideoModelSummary;
    expect(filterCreatorVideoModels([invalid])).toEqual([]);
  });

  it("keeps incoming references in graph edge order and excludes blank Text", () => {
    const context = contextFor();
    expect(getCreatorVideoTextReferences(context).map((item) => item.nodeId)).toEqual([
      "text-first",
      "text-second"
    ]);
    expect(getCreatorVideoTextReferences(context).map((item) => item.text)).toEqual([
      "First shot prompt",
      "Second shot prompt"
    ]);
    expect(getCreatorVideoImageReferenceCandidates(context).map((item) => item.nodeId)).toEqual([
      "image-bound-a",
      "image-bound-b"
    ]);
    expect(getCreatorVideoImageReferenceCandidates(context).map((item) => item.assetId)).toEqual([
      "asset-a",
      "asset-b"
    ]);
  });

  it("seeds one Text source, requires an explicit choice for multiple, and preserves manual authority", () => {
    const context = contextFor();
    const untouched = createCreatorVideoComposerDraft();
    expect(seedCreatorVideoPromptOnce(untouched, context)).toEqual(untouched);

    const oneTextContext = contextFor({
      ...documentWithIncomingReferences(),
      edges: [{
        id: "edge-first",
        sourceNodeId: "text-first",
        targetNodeId: "video-target",
        relationship: "reference"
      }]
    });
    const seeded = seedCreatorVideoPromptOnce(untouched, oneTextContext);
    expect(seeded.prompt).toBe("First shot prompt");
    expect(seeded.promptSeedSourceNodeId).toBe("text-first");
    expect(reconcileCreatorVideoComposerDraft(untouched, context, videoModels).prompt).toBe("");

    const selected = selectCreatorVideoPromptSeed(untouched, context.incomingReferences[0]!);
    expect(selected.prompt).toBe("First shot prompt");
    expect(selected.promptSeedSourceNodeId).toBe("text-first");

    const manuallyEdited = editCreatorVideoPrompt(seeded, "Manual prompt");
    const changedSource = contextFor({
      ...documentWithIncomingReferences(),
      nodes: documentWithIncomingReferences().nodes.map((node) =>
        node.id === "text-first" && node.kind === "text"
          ? { ...node, data: { text: "Changed upstream" } }
          : node
      ),
      edges: oneTextContext.incomingReferences.map((reference) => ({
        id: reference.edgeId,
        sourceNodeId: reference.sourceNode.id,
        targetNodeId: "video-target",
        relationship: "reference" as const
      }))
    });
    expect(reconcileCreatorVideoComposerDraft(manuallyEdited, changedSource, videoModels).prompt)
      .toBe("Manual prompt");
    expect(resetCreatorVideoPrompt(manuallyEdited)).toMatchObject({
      prompt: "",
      promptDirty: false,
      promptSeedSourceNodeId: null
    });
  });

  it("reconciles image references without choosing arbitrarily", () => {
    const context = contextFor();
    const untouched = createCreatorVideoComposerDraft();
    const i2v = setCreatorVideoComposerMode(untouched, "image-to-video", context);
    expect(i2v.selectedImageReferenceNodeId).toBeNull();
    expect(selectCreatorVideoImageReference(i2v, "image-bound-b", context).selectedImageReferenceNodeId)
      .toBe("image-bound-b");

    const onlyImage = contextFor({
      ...documentWithIncomingReferences(),
      edges: [{
        id: "edge-image-a",
        sourceNodeId: "image-bound-a",
        targetNodeId: "video-target",
        relationship: "reference"
      }]
    });
    expect(setCreatorVideoComposerMode(untouched, "image-to-video", onlyImage)
      .selectedImageReferenceNodeId).toBe("image-bound-a");
    expect(reconcileCreatorVideoComposerDraft({
      ...i2v,
      selectedImageReferenceNodeId: "stale"
    }, onlyImage, videoModels).selectedImageReferenceNodeId).toBe("image-bound-a");
    expect(reconcileCreatorVideoComposerDraft({
      ...i2v,
      selectedImageReferenceNodeId: "stale"
    }, context, videoModels).selectedImageReferenceNodeId).toBeNull();
    expect(setCreatorVideoComposerMode(i2v, "text-to-video", context)
      .selectedImageReferenceNodeId).toBeNull();
  });

  it("estimates cost, validates executable state, and does not mutate inputs", () => {
    const context = contextFor();
    const sourceDraft = draft();
    const sourceContext = JSON.stringify(context);
    const sourceDraftValue = JSON.stringify(sourceDraft);
    expect(getCreatorVideoEstimatedCost(videoModels[0]!)).toBe(11);
    expect(getCreatorVideoEstimatedCost(null)).toBeNull();
    expect(validateCreatorVideoComposerDraft({
      draft: sourceDraft,
      context,
      models: videoModels
    })).toEqual({ ok: true });
    expect(validateCreatorVideoComposerDraft({
      draft: { ...sourceDraft, prompt: "   " },
      context,
      models: videoModels
    })).toEqual({ ok: false, error: "PROMPT_REQUIRED" });
    expect(validateCreatorVideoComposerDraft({
      draft: { ...sourceDraft, modelId: "missing" },
      context,
      models: videoModels
    })).toEqual({ ok: false, error: "MODEL_UNAVAILABLE" });
    expect(validateCreatorVideoComposerDraft({
      draft: { ...sourceDraft, mode: "image-to-video", selectedImageReferenceNodeId: null },
      context,
      models: videoModels
    })).toEqual({ ok: false, error: "REFERENCE_REQUIRED" });
    expect(JSON.stringify(context)).toBe(sourceContext);
    expect(JSON.stringify(sourceDraft)).toBe(sourceDraftValue);
  });
});
