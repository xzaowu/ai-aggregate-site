import type {
  AiGenerationCount,
  AiModelSummary
} from "@ai-aggregate/shared";
import {
  aiGenerationCounts
} from "@ai-aggregate/shared";
import type {
  GenericImageGenerationRequestPayload
} from "../../../lib/image-generation-attempt";
import {
  isImageAspectRatio,
  resolveImageGenerationSize,
  type ImageAspectRatio
} from "../../../lib/image-generation-aspect";
import {
  compressReferenceImage,
  isCompressedImageReferenceUsable,
  validateReferenceImageFile,
  withImageReferencePreparationTimeout
} from "../../../lib/image-reference-preparation";
import {
  resolveOwnerImageAssetReference
} from "../../../lib/owner-image-asset-reference";
import { isAbortError } from "../../../lib/private-asset-content";
import type { CreatorNodeComposerContext } from "./creator-node-composer-context";
import {
  CREATOR_IMAGE_COMPOSER_MAX_PROMPT_LENGTH,
  filterCreatorImageModels,
  type CreatorImageComposerDraft,
  type CreatorImageComposerOperation
} from "./creator-image-composer";

export type CreatorImageExecutionIntentError =
  | "TARGET_NOT_IMAGE"
  | "PROMPT_REQUIRED"
  | "PROMPT_TOO_LONG"
  | "MODEL_UNAVAILABLE"
  | "COUNT_INVALID"
  | "ASPECT_INVALID"
  | "OPERATION_INVALID"
  | "REFERENCE_REQUIRED";

export type CreatorImageExecutionIntent = Readonly<{
  targetNodeId: string;
  prompt: string;
  modelId: string;
  count: AiGenerationCount;
  aspectRatio: ImageAspectRatio;
  operation: CreatorImageComposerOperation;
  mode: "text-to-image" | "image-to-image";
  reference: Readonly<{
    nodeId: string;
    assetId: string;
  }> | null;
}>;

export type CompileCreatorImageExecutionIntentResult =
  | Readonly<{ ok: true; intent: CreatorImageExecutionIntent }>
  | Readonly<{ ok: false; error: CreatorImageExecutionIntentError }>;

export type CreatorImageReferencePreparationErrorKey =
  | "multimodal.error.referenceImageUnsupported"
  | "multimodal.error.referenceImageOriginalTooLarge"
  | "multimodal.error.referenceImageCompressFailed"
  | "multimodal.error.referenceImageCompressedTooLarge"
  | "multimodal.image.referencePreparationFailed";

export class CreatorImageReferencePreparationError extends Error {
  readonly errorKey: CreatorImageReferencePreparationErrorKey;

  constructor(errorKey: CreatorImageReferencePreparationErrorKey) {
    super(errorKey);
    this.name = "CreatorImageReferencePreparationError";
    this.errorKey = errorKey;
  }
}

type CreatorImageReferencePreparationTimeout = <T>(
  operation: Promise<T>,
  controller: AbortController
) => Promise<T>;

export type PrepareCreatorImageGenerationPayloadOptions = Readonly<{
  intent: CreatorImageExecutionIntent;
  token: string;
  clientEntryId: string;
  controller: AbortController;
  resolveOwnerImageAssetReferenceImplementation?: typeof resolveOwnerImageAssetReference;
  compressReferenceImageImplementation?: typeof compressReferenceImage;
  withTimeoutImplementation?: CreatorImageReferencePreparationTimeout;
}>;

function readBoundImageReference(
  context: CreatorNodeComposerContext,
  selectedNodeId: string | null
): CreatorImageExecutionIntent["reference"] {
  if (!selectedNodeId || context.node.kind !== "image") {
    return null;
  }
  if (
    context.node.id === selectedNodeId &&
    context.mediaBinding === "bound" &&
    context.node.data.assetId?.trim()
  ) {
    return {
      nodeId: context.node.id,
      assetId: context.node.data.assetId
    };
  }

  const incoming = context.incomingReferences.find(
    (reference) =>
      reference.sourceNode.id === selectedNodeId &&
      reference.sourceNode.kind === "image" &&
      reference.mediaBinding === "bound" &&
      reference.sourceNode.data.assetId?.trim()
  );
  return incoming?.sourceNode.kind === "image" && incoming.sourceNode.data.assetId
    ? {
        nodeId: incoming.sourceNode.id,
        assetId: incoming.sourceNode.data.assetId
      }
    : null;
}

export function compileCreatorImageExecutionIntent({
  draft,
  context,
  models
}: {
  draft: CreatorImageComposerDraft;
  context: CreatorNodeComposerContext;
  models: readonly AiModelSummary[];
}): CompileCreatorImageExecutionIntentResult {
  if (context.node.kind !== "image") {
    return { ok: false, error: "TARGET_NOT_IMAGE" };
  }
  const prompt = draft.prompt.trim();
  if (!prompt) {
    return { ok: false, error: "PROMPT_REQUIRED" };
  }
  if (draft.prompt.length > CREATOR_IMAGE_COMPOSER_MAX_PROMPT_LENGTH) {
    return { ok: false, error: "PROMPT_TOO_LONG" };
  }
  if (!filterCreatorImageModels(models).some((model) => model.slug === draft.modelId)) {
    return { ok: false, error: "MODEL_UNAVAILABLE" };
  }
  if (!aiGenerationCounts.some((count) => count === draft.count)) {
    return { ok: false, error: "COUNT_INVALID" };
  }
  if (!isImageAspectRatio(draft.aspectRatio)) {
    return { ok: false, error: "ASPECT_INVALID" };
  }
  if (draft.operation !== "generate" && draft.operation !== "edit") {
    return { ok: false, error: "OPERATION_INVALID" };
  }

  const reference = draft.operation === "edit"
    ? readBoundImageReference(context, draft.selectedImageReferenceNodeId)
    : null;
  if (draft.operation === "edit" && !reference) {
    return { ok: false, error: "REFERENCE_REQUIRED" };
  }

  return {
    ok: true,
    intent: {
      targetNodeId: context.node.id,
      prompt,
      modelId: draft.modelId,
      count: draft.count,
      aspectRatio: draft.aspectRatio,
      operation: draft.operation,
      mode: draft.operation === "edit" ? "image-to-image" : "text-to-image",
      reference
    }
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export async function prepareCreatorImageGenerationPayload({
  intent,
  token,
  clientEntryId,
  controller,
  resolveOwnerImageAssetReferenceImplementation = resolveOwnerImageAssetReference,
  compressReferenceImageImplementation = compressReferenceImage,
  withTimeoutImplementation = withImageReferencePreparationTimeout
}: PrepareCreatorImageGenerationPayloadOptions): Promise<
  GenericImageGenerationRequestPayload
> {
  throwIfAborted(controller.signal);

  if (intent.mode === "text-to-image") {
    return {
      prompt: intent.prompt,
      modelId: intent.modelId,
      size: resolveImageGenerationSize(
        intent.aspectRatio,
        "text-to-image",
        null,
        intent.prompt
      ),
      count: intent.count,
      mode: "text-to-image",
      clientEntryId
    };
  }

  const reference = intent.reference;
  if (!reference) {
    throw new CreatorImageReferencePreparationError(
      "multimodal.image.referencePreparationFailed"
    );
  }

  try {
    const prepared = await withTimeoutImplementation(
      (async () => {
        const resolved = await resolveOwnerImageAssetReferenceImplementation({
          assetId: reference.assetId,
          token,
          signal: controller.signal
        });
        throwIfAborted(controller.signal);
        const validation = validateReferenceImageFile(resolved.blob);
        if (!validation.valid) {
          throw new CreatorImageReferencePreparationError(validation.errorKey);
        }

        let compressed: Awaited<ReturnType<typeof compressReferenceImage>>;
        try {
          compressed = await compressReferenceImageImplementation(resolved.blob);
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) {
            throw error;
          }
          throw new CreatorImageReferencePreparationError(
            "multimodal.error.referenceImageCompressFailed"
          );
        }
        throwIfAborted(controller.signal);
        if (!isCompressedImageReferenceUsable(compressed)) {
          throw new CreatorImageReferencePreparationError(
            "multimodal.error.referenceImageCompressedTooLarge"
          );
        }
        return { resolved, compressed };
      })(),
      controller
    );
    throwIfAborted(controller.signal);

    const sourceName = prepared.resolved.asset.title?.trim();
    return {
      prompt: intent.prompt,
      modelId: intent.modelId,
      size: resolveImageGenerationSize(
        intent.aspectRatio,
        "image-to-image",
        {
          width: prepared.compressed.sourceWidth,
          height: prepared.compressed.sourceHeight
        },
        intent.prompt
      ),
      count: intent.count,
      mode: "image-to-image",
      clientEntryId,
      referenceImage: {
        dataUrl: prepared.compressed.dataUrl,
        mimeType: "image/jpeg",
        ...(sourceName ? { name: sourceName } : {}),
        originalBytes: prepared.resolved.blob.size,
        compressedBytes: prepared.compressed.compressedBytes
      }
    };
  } catch (error) {
    if (isAbortError(error) || error instanceof CreatorImageReferencePreparationError) {
      throw error;
    }
    throw new CreatorImageReferencePreparationError(
      "multimodal.image.referencePreparationFailed"
    );
  }
}
