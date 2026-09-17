import type { AiModelSummary } from "@ai-aggregate/shared";
import { describe, expect, it } from "vitest";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import {
  CREATOR_IMAGE_COMPOSER_MAX_PROMPT_LENGTH,
  createCreatorImageComposerDraft,
  creatorImageAspectRatios,
  creatorImageGenerationCounts,
  editCreatorImagePrompt,
  filterCreatorImageModels,
  getCreatorImageEstimatedCost,
  getCreatorImageReferenceCandidates,
  isCreatorImagePromptTooLong,
  pruneCreatorImageComposerDrafts,
  reconcileCreatorImageComposerDraft,
  resetCreatorImagePrompt,
  seedCreatorImagePromptOnce,
  selectCreatorImagePromptSeed,
  setCreatorImageComposerOperation
} from "./creator-image-composer";
import { buildCreatorNodeComposerContext } from "./creator-node-composer-context";

const imageModel = {
  id: "model-image",
  name: "Internal Image Model",
  displayName: "Canvas Image",
  slug: "canvas-image",
  provider: "OPENAI_COMPATIBLE",
  modelId: "upstream/hidden-image-id",
  capability: "image",
  displaySurfaces: ["image"],
  group: "image",
  tags: ["image"],
  enabled: true,
  maxReferenceImages: 1,
  creditCost: 3,
  allowGuest: true,
  sortOrder: 0,
  isRecommended: true
} satisfies AiModelSummary;

function createDocument({
  targetBound = false,
  textValues = [],
  incomingImages = []
}: {
  targetBound?: boolean;
  textValues?: string[];
  incomingImages?: Array<string | null>;
} = {}): CreatorCanvasDocumentV1 {
  const textNodes = textValues.map((text, index) => ({
    id: `text-${index + 1}`,
    kind: "text" as const,
    position: { x: index * 100, y: 0 },
    data: { text }
  }));
  const imageNodes = incomingImages.map((assetId, index) => ({
    id: `image-source-${index + 1}`,
    kind: "image" as const,
    position: { x: index * 100, y: 100 },
    data: { assetId }
  }));
  return {
    version: 1,
    nodes: [
      ...textNodes,
      ...imageNodes,
      {
        id: "image-target",
        kind: "image",
        position: { x: 400, y: 0 },
        data: { assetId: targetBound ? "asset-current" : null }
      }
    ],
    edges: [
      ...textNodes.map((node, index) => ({
        id: `edge-text-${index + 1}`,
        sourceNodeId: node.id,
        targetNodeId: "image-target",
        relationship: "reference" as const
      })),
      ...imageNodes.map((node, index) => ({
        id: `edge-image-${index + 1}`,
        sourceNodeId: node.id,
        targetNodeId: "image-target",
        relationship: "reference" as const
      }))
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function contextFor(document: CreatorCanvasDocumentV1) {
  const context = buildCreatorNodeComposerContext(document, "image-target");
  if (!context) throw new Error("COMPOSER_CONTEXT_MISSING");
  return context;
}

describe("Creator Image Composer draft contract", () => {
  it("uses transient defaults and the shared aspect/count vocabularies", () => {
    expect(createCreatorImageComposerDraft("canvas-image")).toEqual({
      prompt: "",
      modelId: "canvas-image",
      aspectRatio: "auto",
      count: 1,
      operation: "generate",
      selectedImageReferenceNodeId: null,
      promptSeedSourceNodeId: null,
      promptDirty: false
    });
    expect(creatorImageAspectRatios).toEqual([
      "auto", "1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2"
    ]);
    expect(creatorImageGenerationCounts).toEqual([1, 2, 4]);
  });

  it("keeps separate drafts by node and prunes a deleted node", () => {
    const first = { ...createCreatorImageComposerDraft(), prompt: "first" };
    const second = { ...createCreatorImageComposerDraft(), prompt: "second" };
    const drafts = new Map([["image-a", first], ["image-b", second]]);
    const pruned = pruneCreatorImageComposerDrafts(drafts, new Set(["image-b"]));
    expect(pruned).toEqual(new Map([["image-b", second]]));
    expect(drafts.size).toBe(2);
  });

  it("seeds exactly one nonblank Text reference once", () => {
    const firstContext = contextFor(createDocument({ textValues: ["  Dawn over water  "] }));
    const seeded = seedCreatorImagePromptOnce(
      createCreatorImageComposerDraft(),
      firstContext
    );
    expect(seeded.prompt).toBe("Dawn over water");
    expect(seeded.promptSeedSourceNodeId).toBe("text-1");

    const changedContext = contextFor(createDocument({ textValues: ["Changed upstream"] }));
    expect(seedCreatorImagePromptOnce(seeded, changedContext)).toBe(seeded);
  });

  it("never overwrites a dirty prompt and never concatenates multiple Text sources", () => {
    const multipleContext = contextFor(createDocument({
      textValues: ["First source", "Second source"]
    }));
    const initial = seedCreatorImagePromptOnce(
      createCreatorImageComposerDraft(),
      multipleContext
    );
    expect(initial.prompt).toBe("");
    const dirty = editCreatorImagePrompt(initial, "Authoritative prompt");
    expect(seedCreatorImagePromptOnce(dirty, multipleContext)).toBe(dirty);
    expect(dirty.prompt).not.toContain("First source");
  });

  it("allows explicit Text source selection only while untouched or reset", () => {
    const context = contextFor(createDocument({ textValues: ["First", "Second"] }));
    const secondReference = context.incomingReferences[1];
    if (!secondReference) throw new Error("SECOND_TEXT_REFERENCE_MISSING");
    const selected = selectCreatorImagePromptSeed(
      createCreatorImageComposerDraft(),
      secondReference
    );
    expect(selected).toMatchObject({
      prompt: "Second",
      promptSeedSourceNodeId: "text-2",
      promptDirty: false
    });
    const dirty = editCreatorImagePrompt(selected, "Custom");
    expect(selectCreatorImagePromptSeed(dirty, context.incomingReferences[0]!)).toBe(dirty);
    const reset = resetCreatorImagePrompt(dirty);
    expect(selectCreatorImagePromptSeed(reset, context.incomingReferences[0]!)).toMatchObject({
      prompt: "First",
      promptSeedSourceNodeId: "text-1"
    });
  });

  it("validates above 4000 characters without truncating", () => {
    const prompt = "x".repeat(CREATOR_IMAGE_COMPOSER_MAX_PROMPT_LENGTH + 1);
    const draft = editCreatorImagePrompt(createCreatorImageComposerDraft(), prompt);
    expect(draft.prompt).toHaveLength(4001);
    expect(isCreatorImagePromptTooLong(draft.prompt)).toBe(true);
    expect(isCreatorImagePromptTooLong("x".repeat(4000))).toBe(false);
  });

  it("keeps Generate image-free and requires one executable source for Edit", () => {
    const noSource = contextFor(createDocument());
    const generate = setCreatorImageComposerOperation(
      createCreatorImageComposerDraft(),
      "generate",
      noSource
    );
    expect(generate.selectedImageReferenceNodeId).toBeNull();
    expect(setCreatorImageComposerOperation(generate, "edit", noSource))
      .toMatchObject({ operation: "edit", selectedImageReferenceNodeId: null });

    const currentBound = contextFor(createDocument({ targetBound: true }));
    expect(getCreatorImageReferenceCandidates(currentBound)).toEqual([
      { nodeId: "image-target", source: "current" }
    ]);
    expect(setCreatorImageComposerOperation(generate, "edit", currentBound)
      .selectedImageReferenceNodeId).toBe("image-target");
  });

  it("excludes empty incoming images and requires an explicit choice for multiple candidates", () => {
    const context = contextFor(createDocument({
      targetBound: true,
      incomingImages: [null, "asset-incoming"]
    }));
    expect(getCreatorImageReferenceCandidates(context)).toEqual([
      { nodeId: "image-target", source: "current" },
      { nodeId: "image-source-2", source: "incoming" }
    ]);
    const edit = setCreatorImageComposerOperation(
      createCreatorImageComposerDraft(),
      "edit",
      context
    );
    expect(edit.selectedImageReferenceNodeId).toBeNull();
    const selected = reconcileCreatorImageComposerDraft(
      { ...edit, selectedImageReferenceNodeId: "image-source-2" },
      context,
      []
    );
    expect(selected.selectedImageReferenceNodeId).toBe("image-source-2");
    expect(reconcileCreatorImageComposerDraft(
      { ...edit, selectedImageReferenceNodeId: "image-source-1" },
      context,
      []
    ).selectedImageReferenceNodeId).toBeNull();
  });

  it("uses only public Image models, defaults to the first slug, and multiplies cost by count", () => {
    const hiddenSurface: AiModelSummary = {
      ...imageModel,
      id: "hidden",
      slug: "hidden",
      displaySurfaces: ["chat"]
    };
    const disabled: AiModelSummary = {
      ...imageModel,
      id: "disabled",
      slug: "disabled",
      enabled: false
    };
    const models = filterCreatorImageModels([hiddenSurface, disabled, imageModel]);
    expect(models).toEqual([imageModel]);
    const draft = reconcileCreatorImageComposerDraft(
      createCreatorImageComposerDraft("arbitrary-upstream-id"),
      contextFor(createDocument()),
      models
    );
    expect(draft.modelId).toBe("canvas-image");
    expect(draft.modelId).not.toBe(imageModel.modelId);
    expect(getCreatorImageEstimatedCost(imageModel, 4)).toBe(12);
  });
});
