import type {
  AiAssetSummary,
  AiTaskDetailResponse,
  AiTaskSummary,
  ImageReferenceInput,
  PublicVideoModelSummary
} from "@ai-aggregate/shared";
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
import { createSecureUuid } from "../../../lib/image-generation-attempt";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import type { CreatorNodeComposerContext } from "./creator-node-composer-context";
import {
  getCreatorVideoCompatibleModels,
  getCreatorVideoImageReferenceCandidates,
  validateCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft,
  type CreatorVideoComposerMode
} from "./creator-video-composer";

export const CREATOR_VIDEO_POLL_MAX_ATTEMPTS = 12;
export const CREATOR_VIDEO_POLL_INTERVAL_MS = 1_500;
export const CREATOR_VIDEO_SUBMISSION_REPLAY_DELAY_MS = 2_000;
export const CREATOR_VIDEO_MAX_RETRY_AFTER_MS = 10_000;

export type CreatorVideoExecutionReference = Readonly<{
  sourceNodeId: string;
  assetId: string;
}>;

export type CreatorVideoExecutionIntent = Readonly<{
  targetNodeId: string;
  prompt: string;
  modelId: string;
  mode: CreatorVideoComposerMode;
  reference: CreatorVideoExecutionReference | null;
}>;

export type CreatorVideoExecutionIntentError =
  | "TARGET_NOT_VIDEO"
  | "PROMPT_REQUIRED"
  | "PROMPT_TOO_LONG"
  | "MODEL_UNAVAILABLE"
  | "REFERENCE_REQUIRED";

export type CompileCreatorVideoExecutionIntentResult =
  | Readonly<{ ok: true; intent: CreatorVideoExecutionIntent }>
  | Readonly<{ ok: false; error: CreatorVideoExecutionIntentError }>;

export type CreatorVideoSubmissionPayload = Readonly<{
  modelId: string;
  mode: CreatorVideoComposerMode;
  prompt: string;
  referenceImage?: ImageReferenceInput;
}>;

export type CreatorVideoExecutionAttempt = Readonly<{
  key: string;
  payload: CreatorVideoSubmissionPayload;
}>;

export type CreatorVideoSubmissionResult =
  | Readonly<{
      kind: "accepted";
      taskId: string | null;
      retryAfterMs: number;
    }>
  | Readonly<{
      kind: "replayed";
      detail: AiTaskDetailResponse;
    }>
  | Readonly<{
      kind: "failed";
      reason: "conflict" | "unavailable" | "malformed";
    }>;

export type CreatorVideoTaskStatus = "pending" | "running" | "succeeded" | "failed";

export type CreatorVideoTaskDetail = Readonly<{
  task: AiTaskSummary;
  assets: readonly AiAssetSummary[];
}>;

export type CreatorVideoTerminalAsset = Readonly<{
  taskId: string;
  asset: AiAssetSummary;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isVideoMode(value: unknown): value is CreatorVideoComposerMode {
  return value === "text-to-video" || value === "image-to-video";
}

function isTaskStatus(value: unknown): value is CreatorVideoTaskStatus {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed";
}

function isAiTaskSummary(value: unknown): value is AiTaskSummary {
  if (!isRecord(value)) return false;
  return (
    isNonBlankString(value.id) &&
    isNonBlankString(value.type) &&
    value.type === "video" &&
    isTaskStatus(value.status) &&
    (value.modelId === null || typeof value.modelId === "string") &&
    typeof value.prompt === "string" &&
    isRecord(value.input) &&
    (value.output === null || isRecord(value.output)) &&
    typeof value.costCredits === "number" &&
    Number.isFinite(value.costCredits) &&
    (value.errorMessage === null || typeof value.errorMessage === "string") &&
    isNonBlankString(value.createdAt) &&
    isNonBlankString(value.updatedAt) &&
    (value.completedAt === null || typeof value.completedAt === "string")
  );
}

function isAiAssetSummary(value: unknown): value is AiAssetSummary {
  if (!isRecord(value)) return false;
  return (
    isNonBlankString(value.id) &&
    isNonBlankString(value.userId) &&
    (value.taskId === null || isNonBlankString(value.taskId)) &&
    (value.type === "image" || value.type === "video" || value.type === "document") &&
    typeof value.url === "string" &&
    (value.thumbnailUrl === null || typeof value.thumbnailUrl === "string") &&
    (value.title === null || typeof value.title === "string") &&
    (value.metadata === null || isRecord(value.metadata)) &&
    isNonBlankString(value.createdAt) &&
    (value.taskPrompt === undefined || value.taskPrompt === null || typeof value.taskPrompt === "string")
  );
}

function isTaskDetail(value: unknown): value is AiTaskDetailResponse {
  if (!isRecord(value) || !isAiTaskSummary(value.task) || !Array.isArray(value.assets)) {
    return false;
  }
  return value.assets.every(isAiAssetSummary);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    value.forEach((item) => deepFreeze(item));
  } else {
    Object.values(value as Record<string, unknown>).forEach((item) => deepFreeze(item));
  }
  return value;
}

export function compileCreatorVideoExecutionIntent({
  draft,
  context,
  models
}: {
  draft: CreatorVideoComposerDraft;
  context: CreatorNodeComposerContext;
  models: readonly PublicVideoModelSummary[];
}): CompileCreatorVideoExecutionIntentResult {
  const validation = validateCreatorVideoComposerDraft({ draft, context, models });
  if (!validation.ok) return validation;

  if (context.node.kind !== "video") return { ok: false, error: "TARGET_NOT_VIDEO" };
  const compatible = getCreatorVideoCompatibleModels(models, draft.mode);
  const model = compatible.find((candidate) => candidate.slug === draft.modelId);
  if (!model) return { ok: false, error: "MODEL_UNAVAILABLE" };

  const reference = draft.mode === "image-to-video"
    ? getCreatorVideoImageReferenceCandidates(context).find(
        (candidate) => candidate.nodeId === draft.selectedImageReferenceNodeId
      )
    : null;
  if (draft.mode === "image-to-video" && !reference) {
    return { ok: false, error: "REFERENCE_REQUIRED" };
  }

  return {
    ok: true,
    intent: {
      targetNodeId: context.node.id,
      prompt: draft.prompt.trim(),
      modelId: model.slug,
      mode: draft.mode,
      reference: reference
        ? { sourceNodeId: reference.nodeId, assetId: reference.assetId }
        : null
    }
  };
}

export function createCreatorVideoSubmissionPayload(
  intent: CreatorVideoExecutionIntent,
  referenceImage?: ImageReferenceInput
): CreatorVideoSubmissionPayload {
  return {
    modelId: intent.modelId,
    mode: intent.mode,
    prompt: intent.prompt.trim(),
    ...(intent.mode === "image-to-video" && referenceImage ? { referenceImage: { ...referenceImage } } : {})
  };
}

export function createCreatorVideoExecutionAttempt(
  payload: CreatorVideoSubmissionPayload,
  createKey: () => string = createSecureUuid
): CreatorVideoExecutionAttempt {
  const key = createKey();
  if (!isNonBlankString(key) || key.trim().length < 16 || key.trim().length > 128) {
    throw new Error("CREATOR_VIDEO_IDEMPOTENCY_KEY_INVALID");
  }
  const snapshot = {
    modelId: payload.modelId,
    mode: payload.mode,
    prompt: payload.prompt,
    ...(payload.referenceImage ? { referenceImage: { ...payload.referenceImage } } : {})
  } satisfies CreatorVideoSubmissionPayload;
  return deepFreeze({ key: key.trim(), payload: snapshot });
}

export type CreatorVideoReferencePreparationErrorKey =
  | "multimodal.error.referenceImageUnsupported"
  | "multimodal.error.referenceImageOriginalTooLarge"
  | "multimodal.error.referenceImageCompressFailed"
  | "multimodal.error.referenceImageCompressedTooLarge"
  | "creator.canvas.videoComposer.referencePreparationFailed";

export class CreatorVideoReferencePreparationError extends Error {
  readonly errorKey: CreatorVideoReferencePreparationErrorKey;

  constructor(errorKey: CreatorVideoReferencePreparationErrorKey) {
    super(errorKey);
    this.name = "CreatorVideoReferencePreparationError";
    this.errorKey = errorKey;
  }
}

type CreatorVideoReferencePreparationTimeout = <T>(
  operation: Promise<T>,
  controller: AbortController
) => Promise<T>;

export type PrepareCreatorVideoSubmissionPayloadOptions = Readonly<{
  intent: CreatorVideoExecutionIntent;
  token: string;
  controller: AbortController;
  resolveOwnerImageAssetReferenceImplementation?: typeof resolveOwnerImageAssetReference;
  compressReferenceImageImplementation?: typeof compressReferenceImage;
  withTimeoutImplementation?: CreatorVideoReferencePreparationTimeout;
}>;

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

export async function prepareCreatorVideoSubmissionPayload({
  intent,
  token,
  controller,
  resolveOwnerImageAssetReferenceImplementation = resolveOwnerImageAssetReference,
  compressReferenceImageImplementation = compressReferenceImage,
  withTimeoutImplementation = withImageReferencePreparationTimeout
}: PrepareCreatorVideoSubmissionPayloadOptions): Promise<CreatorVideoSubmissionPayload> {
  throwIfAborted(controller.signal);
  if (intent.mode === "text-to-video") return createCreatorVideoSubmissionPayload(intent);
  if (!intent.reference) {
    throw new CreatorVideoReferencePreparationError(
      "creator.canvas.videoComposer.referencePreparationFailed"
    );
  }

  try {
    const prepared = await withTimeoutImplementation(
      (async () => {
        const resolved = await resolveOwnerImageAssetReferenceImplementation({
          assetId: intent.reference!.assetId,
          token,
          signal: controller.signal
        });
        throwIfAborted(controller.signal);
        const validation = validateReferenceImageFile(resolved.blob);
        if (!validation.valid) {
          throw new CreatorVideoReferencePreparationError(validation.errorKey);
        }
        let compressed: Awaited<ReturnType<typeof compressReferenceImage>>;
        try {
          compressed = await compressReferenceImageImplementation(resolved.blob);
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) throw error;
          throw new CreatorVideoReferencePreparationError(
            "multimodal.error.referenceImageCompressFailed"
          );
        }
        throwIfAborted(controller.signal);
        if (!isCompressedImageReferenceUsable(compressed)) {
          throw new CreatorVideoReferencePreparationError(
            "multimodal.error.referenceImageCompressedTooLarge"
          );
        }
        return { resolved, compressed };
      })(),
      controller
    );
    throwIfAborted(controller.signal);
    const sourceName = prepared.resolved.asset.title?.trim();
    return createCreatorVideoSubmissionPayload(intent, {
      dataUrl: prepared.compressed.dataUrl,
      mimeType: "image/jpeg",
      ...(sourceName ? { name: sourceName } : {}),
      originalBytes: prepared.resolved.blob.size,
      compressedBytes: prepared.compressed.compressedBytes
    });
  } catch (error) {
    if (isAbortError(error) || error instanceof CreatorVideoReferencePreparationError) {
      throw error;
    }
    throw new CreatorVideoReferencePreparationError(
      "creator.canvas.videoComposer.referencePreparationFailed"
    );
  }
}

export function parseCreatorVideoSubmissionResponse(
  status: number,
  value: unknown
): CreatorVideoSubmissionResult {
  if (status === 409) return { kind: "failed", reason: "conflict" };
  if (status === 202) {
    if (
      !isRecord(value) ||
      value.status !== "in_progress" ||
      (value.taskId !== null && !isNonBlankString(value.taskId)) ||
      typeof value.retryAfterMs !== "number" ||
      !Number.isFinite(value.retryAfterMs) ||
      value.retryAfterMs < 0
    ) {
      return { kind: "failed", reason: "malformed" };
    }
    return {
      kind: "accepted",
      taskId: value.taskId === null ? null : value.taskId.trim(),
      retryAfterMs: Math.min(CREATOR_VIDEO_MAX_RETRY_AFTER_MS, Math.floor(value.retryAfterMs))
    };
  }
  if (status === 200 && isTaskDetail(value)) {
    return { kind: "replayed", detail: value };
  }
  if (status >= 400 && status < 500) return { kind: "failed", reason: "unavailable" };
  return { kind: "failed", reason: "malformed" };
}

export function parseCreatorVideoTaskDetail(value: unknown): CreatorVideoTaskDetail | null {
  return isTaskDetail(value)
    ? { task: value.task, assets: value.assets }
    : null;
}

export function readCreatorVideoTaskProgress(task: Pick<AiTaskSummary, "input">): number | null {
  const progress = task.input.videoProgress;
  return typeof progress === "number" && Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.round(progress)))
    : null;
}

export function selectCreatorVideoTerminalAsset(
  detail: CreatorVideoTaskDetail,
  observedTaskId: string
): CreatorVideoTerminalAsset | null {
  if (
    detail.task.id !== observedTaskId ||
    detail.task.type !== "video" ||
    detail.task.status !== "succeeded"
  ) {
    return null;
  }
  const asset = detail.assets.find(
    (candidate) => candidate.type === "video" && candidate.id.trim().length > 0
  );
  return asset ? { taskId: observedTaskId, asset } : null;
}

export function clampCreatorVideoRetryAfterMs(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(CREATOR_VIDEO_MAX_RETRY_AFTER_MS, Math.floor(value)))
    : CREATOR_VIDEO_POLL_INTERVAL_MS;
}

export function waitForCreatorVideoDelay(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, Math.max(0, delayMs));
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function getCreatorVideoTaskStatus(
  detail: CreatorVideoTaskDetail
): CreatorVideoTaskStatus {
  return detail.task.status === "cancelled" ? "failed" : detail.task.status;
}

export function isCreatorVideoExecutionNode(
  document: CreatorCanvasDocumentV1,
  nodeId: string
): boolean {
  return document.nodes.some((node) => node.id === nodeId && node.kind === "video");
}
