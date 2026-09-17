import type { PublicVideoModelSummary } from "@ai-aggregate/shared";
import type {
  CreatorNodeComposerContext,
  CreatorNodeIncomingReference
} from "./creator-node-composer-context";

export const creatorVideoComposerModes = [
  "text-to-video",
  "image-to-video"
] as const;
export type CreatorVideoComposerMode = (typeof creatorVideoComposerModes)[number];

export const CREATOR_VIDEO_COMPOSER_MAX_PROMPT_LENGTH = 4_000;

export interface CreatorVideoComposerDraft {
  prompt: string;
  modelId: string;
  mode: CreatorVideoComposerMode;
  selectedImageReferenceNodeId: string | null;
  promptSeedSourceNodeId: string | null;
  promptDirty: boolean;
}

export interface CreatorVideoTextReference {
  edgeId: string;
  nodeId: string;
  text: string;
  reference: CreatorNodeIncomingReference;
}

export interface CreatorVideoImageReferenceCandidate {
  edgeId: string;
  nodeId: string;
  assetId: string;
  reference: CreatorNodeIncomingReference;
}

export type CreatorVideoComposerValidationError =
  | "TARGET_NOT_VIDEO"
  | "PROMPT_REQUIRED"
  | "PROMPT_TOO_LONG"
  | "MODEL_UNAVAILABLE"
  | "REFERENCE_REQUIRED";

export function createCreatorVideoComposerDraft(
  defaultModelId = ""
): CreatorVideoComposerDraft {
  return {
    prompt: "",
    modelId: defaultModelId,
    mode: "text-to-video",
    selectedImageReferenceNodeId: null,
    promptSeedSourceNodeId: null,
    promptDirty: false
  };
}

export function cloneCreatorVideoComposerDraft(
  draft: CreatorVideoComposerDraft
): CreatorVideoComposerDraft {
  return {
    prompt: draft.prompt,
    modelId: draft.modelId,
    mode: draft.mode,
    selectedImageReferenceNodeId: draft.selectedImageReferenceNodeId,
    promptSeedSourceNodeId: draft.promptSeedSourceNodeId,
    promptDirty: draft.promptDirty
  };
}

export function pruneCreatorVideoComposerDrafts(
  drafts: ReadonlyMap<string, CreatorVideoComposerDraft>,
  existingNodeIds: ReadonlySet<string>
): Map<string, CreatorVideoComposerDraft> {
  return new Map(
    Array.from(drafts)
      .filter(([nodeId]) => existingNodeIds.has(nodeId))
      .map(([nodeId, draft]) => [nodeId, cloneCreatorVideoComposerDraft(draft)] as const)
  );
}

export function filterCreatorVideoModels(
  models: readonly PublicVideoModelSummary[]
): PublicVideoModelSummary[] {
  return models.filter((model) =>
    model.enabled === true &&
    model.capability === "video" &&
    Array.isArray(model.displaySurfaces) &&
    model.displaySurfaces.includes("video") &&
    typeof model.slug === "string" &&
    model.slug.trim().length > 0 &&
    model.videoProfile !== null &&
    typeof model.videoProfile === "object"
  );
}

export function getCreatorVideoCompatibleModels(
  models: readonly PublicVideoModelSummary[],
  mode: CreatorVideoComposerMode
): PublicVideoModelSummary[] {
  return filterCreatorVideoModels(models).filter((model) =>
    mode === "text-to-video"
      ? model.videoProfile.supportsTextToVideo
      : model.videoProfile.supportsImageToVideo
  );
}

export function resolveCreatorVideoModel(
  savedModelId: string | undefined,
  mode: CreatorVideoComposerMode,
  models: readonly PublicVideoModelSummary[]
): PublicVideoModelSummary | null {
  const compatible = getCreatorVideoCompatibleModels(models, mode);
  const configured = savedModelId?.trim() ?? "";
  return compatible.find((model) => model.slug === configured) ?? compatible[0] ?? null;
}

export function getCreatorVideoEffectiveModelId(
  savedModelId: string | undefined,
  mode: CreatorVideoComposerMode,
  models: readonly PublicVideoModelSummary[]
): string | null {
  return resolveCreatorVideoModel(savedModelId, mode, models)?.slug ?? null;
}

export function getCreatorVideoTextReferences(
  context: CreatorNodeComposerContext
): CreatorVideoTextReference[] {
  return context.incomingReferences.flatMap((reference) => {
    if (reference.sourceNode.kind !== "text") return [];
    const text = reference.sourceNode.data.text.trim();
    return text.length > 0
      ? [{
          edgeId: reference.edgeId,
          nodeId: reference.sourceNode.id,
          text,
          reference
        }]
      : [];
  });
}

export function getCreatorVideoImageReferenceCandidates(
  context: CreatorNodeComposerContext
): CreatorVideoImageReferenceCandidate[] {
  return context.incomingReferences.flatMap((reference) => {
    if (
      reference.sourceNode.kind !== "image" ||
      reference.mediaBinding !== "bound" ||
      !reference.sourceNode.data.assetId?.trim()
    ) {
      return [];
    }
    return [{
      edgeId: reference.edgeId,
      nodeId: reference.sourceNode.id,
      assetId: reference.sourceNode.data.assetId,
      reference
    }];
  });
}

export function seedCreatorVideoPromptOnce(
  draft: CreatorVideoComposerDraft,
  context: CreatorNodeComposerContext
): CreatorVideoComposerDraft {
  if (
    draft.promptDirty ||
    draft.prompt.trim().length > 0 ||
    draft.promptSeedSourceNodeId !== null
  ) {
    return draft;
  }
  const references = getCreatorVideoTextReferences(context);
  if (references.length !== 1) return draft;
  const source = references[0];
  if (!source) return draft;
  return {
    ...draft,
    prompt: source.text,
    promptSeedSourceNodeId: source.nodeId
  };
}

export function selectCreatorVideoPromptSeed(
  draft: CreatorVideoComposerDraft,
  reference: CreatorNodeIncomingReference
): CreatorVideoComposerDraft {
  if (draft.promptDirty || reference.sourceNode.kind !== "text") return draft;
  const prompt = reference.sourceNode.data.text.trim();
  if (!prompt) return draft;
  return {
    ...draft,
    prompt,
    promptSeedSourceNodeId: reference.sourceNode.id
  };
}

export function editCreatorVideoPrompt(
  draft: CreatorVideoComposerDraft,
  prompt: string
): CreatorVideoComposerDraft {
  return { ...draft, prompt, promptDirty: true };
}

export function resetCreatorVideoPrompt(
  draft: CreatorVideoComposerDraft
): CreatorVideoComposerDraft {
  return {
    ...draft,
    prompt: "",
    promptSeedSourceNodeId: null,
    promptDirty: false
  };
}

export function selectCreatorVideoImageReference(
  draft: CreatorVideoComposerDraft,
  nodeId: string | null,
  context: CreatorNodeComposerContext
): CreatorVideoComposerDraft {
  const candidate = nodeId === null
    ? null
    : getCreatorVideoImageReferenceCandidates(context)
      .find((item) => item.nodeId === nodeId) ?? null;
  return {
    ...draft,
    selectedImageReferenceNodeId: candidate?.nodeId ?? null
  };
}

export function setCreatorVideoComposerMode(
  draft: CreatorVideoComposerDraft,
  mode: CreatorVideoComposerMode,
  context: CreatorNodeComposerContext
): CreatorVideoComposerDraft {
  if (mode === "text-to-video") {
    return { ...draft, mode, selectedImageReferenceNodeId: null };
  }
  const candidates = getCreatorVideoImageReferenceCandidates(context);
  const selected = candidates.some(
    (candidate) => candidate.nodeId === draft.selectedImageReferenceNodeId
  )
    ? draft.selectedImageReferenceNodeId
    : candidates.length === 1
      ? candidates[0]?.nodeId ?? null
      : null;
  return { ...draft, mode, selectedImageReferenceNodeId: selected };
}

export function reconcileCreatorVideoComposerDraft(
  draft: CreatorVideoComposerDraft,
  context: CreatorNodeComposerContext,
  models: readonly PublicVideoModelSummary[]
): CreatorVideoComposerDraft {
  let next = seedCreatorVideoPromptOnce(draft, context);
  const modelId = getCreatorVideoEffectiveModelId(next.modelId, next.mode, models) ?? "";
  const textReferences = getCreatorVideoTextReferences(context);
  const promptSeedSourceNodeId = textReferences.some(
    (reference) => reference.nodeId === next.promptSeedSourceNodeId
  )
    ? next.promptSeedSourceNodeId
    : !next.promptDirty && textReferences.length === 1
      ? textReferences[0]?.nodeId ?? null
      : null;
  const imageCandidates = getCreatorVideoImageReferenceCandidates(context);
  const selectedImageReferenceNodeId = next.mode === "image-to-video"
    ? imageCandidates.some(
        (candidate) => candidate.nodeId === next.selectedImageReferenceNodeId
      )
      ? next.selectedImageReferenceNodeId
      : imageCandidates.length === 1
        ? imageCandidates[0]?.nodeId ?? null
        : null
    : null;

  if (
    next.modelId === modelId &&
    next.promptSeedSourceNodeId === promptSeedSourceNodeId &&
    next.selectedImageReferenceNodeId === selectedImageReferenceNodeId
  ) {
    return next;
  }
  next = {
    ...next,
    modelId,
    promptSeedSourceNodeId,
    selectedImageReferenceNodeId
  };
  return next;
}

export function getCreatorVideoEstimatedCost(
  model: Pick<PublicVideoModelSummary, "creditCost"> | null
): number | null {
  return model?.creditCost ?? null;
}

export function getCreatorVideoTextSourcePreview(
  text: string,
  maxLength = 56
): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
    : normalized;
}

export function validateCreatorVideoComposerDraft({
  draft,
  context,
  models
}: {
  draft: CreatorVideoComposerDraft;
  context: CreatorNodeComposerContext;
  models: readonly PublicVideoModelSummary[];
}): { ok: true } | { ok: false; error: CreatorVideoComposerValidationError } {
  if (context.node.kind !== "video") return { ok: false, error: "TARGET_NOT_VIDEO" };
  if (!draft.prompt.trim()) return { ok: false, error: "PROMPT_REQUIRED" };
  if (draft.prompt.length > CREATOR_VIDEO_COMPOSER_MAX_PROMPT_LENGTH) {
    return { ok: false, error: "PROMPT_TOO_LONG" };
  }
  if (!getCreatorVideoCompatibleModels(models, draft.mode).some(
    (model) => model.slug === draft.modelId
  )) {
    return { ok: false, error: "MODEL_UNAVAILABLE" };
  }
  if (
    draft.mode === "image-to-video" &&
    !getCreatorVideoImageReferenceCandidates(context).some(
      (candidate) => candidate.nodeId === draft.selectedImageReferenceNodeId
    )
  ) {
    return { ok: false, error: "REFERENCE_REQUIRED" };
  }
  return { ok: true };
}
