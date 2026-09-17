import type {
  AiGenerationCount,
  AiModelSummary
} from "@ai-aggregate/shared";
import {
  aiGenerationCounts,
  isImageCapableModel,
  normalizeModelDisplaySurfaces
} from "@ai-aggregate/shared";
import {
  imageAspectRatios,
  type ImageAspectRatio
} from "../../../lib/image-generation-aspect";
import type {
  CreatorNodeComposerContext,
  CreatorNodeIncomingReference
} from "./creator-node-composer-context";

export const CREATOR_IMAGE_COMPOSER_MAX_PROMPT_LENGTH = 4000;
export const creatorImageComposerOperations = ["generate", "edit"] as const;
export type CreatorImageComposerOperation =
  (typeof creatorImageComposerOperations)[number];

export interface CreatorImageComposerDraft {
  prompt: string;
  modelId: string;
  aspectRatio: ImageAspectRatio;
  count: AiGenerationCount;
  operation: CreatorImageComposerOperation;
  selectedImageReferenceNodeId: string | null;
  promptSeedSourceNodeId: string | null;
  promptDirty: boolean;
}

export interface CreatorImageReferenceCandidate {
  nodeId: string;
  source: "current" | "incoming";
}

export function createCreatorImageComposerDraft(
  defaultModelId = ""
): CreatorImageComposerDraft {
  return {
    prompt: "",
    modelId: defaultModelId,
    aspectRatio: "auto",
    count: 1,
    operation: "generate",
    selectedImageReferenceNodeId: null,
    promptSeedSourceNodeId: null,
    promptDirty: false
  };
}

export function pruneCreatorImageComposerDrafts(
  drafts: ReadonlyMap<string, CreatorImageComposerDraft>,
  existingNodeIds: ReadonlySet<string>
): Map<string, CreatorImageComposerDraft> {
  return new Map(
    Array.from(drafts).filter(([nodeId]) => existingNodeIds.has(nodeId))
  );
}

export function filterCreatorImageModels(
  models: readonly AiModelSummary[]
): AiModelSummary[] {
  return models.filter(
    (model) =>
      model.enabled &&
      isImageCapableModel(model) &&
      normalizeModelDisplaySurfaces(
        model.displaySurfaces,
        model.capability
      ).includes("image")
  );
}

export function getCreatorImageComposerTextReferences(
  context: CreatorNodeComposerContext
): CreatorNodeIncomingReference[] {
  return context.incomingReferences.filter(
    (reference) => reference.sourceNode.kind === "text"
  );
}

export function getCreatorImageComposerImageReferences(
  context: CreatorNodeComposerContext
): CreatorNodeIncomingReference[] {
  return context.incomingReferences.filter(
    (reference) => reference.sourceNode.kind === "image"
  );
}

export function getCreatorImageReferenceCandidates(
  context: CreatorNodeComposerContext
): CreatorImageReferenceCandidate[] {
  if (context.node.kind !== "image") return [];
  const candidates: CreatorImageReferenceCandidate[] = [];
  if (context.mediaBinding === "bound") {
    candidates.push({ nodeId: context.node.id, source: "current" });
  }
  for (const reference of getCreatorImageComposerImageReferences(context)) {
    if (reference.mediaBinding === "bound") {
      candidates.push({
        nodeId: reference.sourceNode.id,
        source: "incoming"
      });
    }
  }
  return candidates;
}

function readNonBlankTextReference(
  reference: CreatorNodeIncomingReference
): string | null {
  if (reference.sourceNode.kind !== "text") return null;
  const text = reference.sourceNode.data.text.trim();
  return text.length > 0 ? text : null;
}

export function seedCreatorImagePromptOnce(
  draft: CreatorImageComposerDraft,
  context: CreatorNodeComposerContext
): CreatorImageComposerDraft {
  if (draft.promptDirty || draft.prompt.length > 0 || draft.promptSeedSourceNodeId) {
    return draft;
  }
  const usableReferences = getCreatorImageComposerTextReferences(context)
    .map((reference) => ({
      reference,
      text: readNonBlankTextReference(reference)
    }))
    .filter(
      (entry): entry is { reference: CreatorNodeIncomingReference; text: string } =>
        entry.text !== null
    );
  if (usableReferences.length !== 1) return draft;
  const source = usableReferences[0];
  if (!source) return draft;
  return {
    ...draft,
    prompt: source.text,
    promptSeedSourceNodeId: source.reference.sourceNode.id
  };
}

export function selectCreatorImagePromptSeed(
  draft: CreatorImageComposerDraft,
  reference: CreatorNodeIncomingReference
): CreatorImageComposerDraft {
  const text = readNonBlankTextReference(reference);
  if (draft.promptDirty || text === null) return draft;
  return {
    ...draft,
    prompt: text,
    promptSeedSourceNodeId: reference.sourceNode.id
  };
}

export function editCreatorImagePrompt(
  draft: CreatorImageComposerDraft,
  prompt: string
): CreatorImageComposerDraft {
  return { ...draft, prompt, promptDirty: true };
}

export function resetCreatorImagePrompt(
  draft: CreatorImageComposerDraft
): CreatorImageComposerDraft {
  return {
    ...draft,
    prompt: "",
    promptSeedSourceNodeId: null,
    promptDirty: false
  };
}

export function setCreatorImageComposerOperation(
  draft: CreatorImageComposerDraft,
  operation: CreatorImageComposerOperation,
  context: CreatorNodeComposerContext
): CreatorImageComposerDraft {
  if (operation === "generate") {
    return {
      ...draft,
      operation,
      selectedImageReferenceNodeId: null
    };
  }
  const candidates = getCreatorImageReferenceCandidates(context);
  return {
    ...draft,
    operation,
    selectedImageReferenceNodeId:
      candidates.length === 1 ? candidates[0]?.nodeId ?? null : null
  };
}

export function reconcileCreatorImageComposerDraft(
  draft: CreatorImageComposerDraft,
  context: CreatorNodeComposerContext,
  models: readonly AiModelSummary[]
): CreatorImageComposerDraft {
  let next = seedCreatorImagePromptOnce(draft, context);
  const modelId = models.some((model) => model.slug === next.modelId)
    ? next.modelId
    : models[0]?.slug ?? "";
  const candidates = getCreatorImageReferenceCandidates(context);
  const selectedImageReferenceNodeId =
    next.operation === "edit" &&
    candidates.some(
      (candidate) => candidate.nodeId === next.selectedImageReferenceNodeId
    )
      ? next.selectedImageReferenceNodeId
      : next.operation === "edit" && candidates.length === 1
        ? candidates[0]?.nodeId ?? null
        : null;
  if (
    next.modelId === modelId &&
    next.selectedImageReferenceNodeId === selectedImageReferenceNodeId
  ) {
    return next;
  }
  next = { ...next, modelId, selectedImageReferenceNodeId };
  return next;
}

export function isCreatorImagePromptTooLong(prompt: string): boolean {
  return prompt.length > CREATOR_IMAGE_COMPOSER_MAX_PROMPT_LENGTH;
}

export function getCreatorImageEstimatedCost(
  model: Pick<AiModelSummary, "creditCost"> | null,
  count: AiGenerationCount
): number | null {
  return model ? model.creditCost * count : null;
}

export function getCreatorTextSourcePreview(text: string, maxLength = 48): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
    : normalized;
}

export { aiGenerationCounts as creatorImageGenerationCounts };
export { imageAspectRatios as creatorImageAspectRatios };
