import {
  parseCreatorCanvasDocument,
  type CreatorCanvasDocumentV1
} from "./creator-canvas-document";
import {
  creatorImageAspectRatios,
  creatorImageComposerOperations,
  creatorImageGenerationCounts,
  type CreatorImageComposerDraft
} from "./creator-image-composer";
import {
  creatorVideoComposerModes,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";

export const CREATOR_CANVAS_PERSISTED_STATE_LEGACY_SCHEMA_VERSION = 1 as const;
export const CREATOR_CANVAS_PERSISTED_STATE_SCHEMA_VERSION = 2 as const;

export interface CreatorCanvasPersistedStateV1 {
  schemaVersion: typeof CREATOR_CANVAS_PERSISTED_STATE_LEGACY_SCHEMA_VERSION;
  document: CreatorCanvasDocumentV1;
  imageComposerDrafts: Record<string, CreatorImageComposerDraft>;
}

export interface CreatorCanvasPersistedStateV2 {
  schemaVersion: typeof CREATOR_CANVAS_PERSISTED_STATE_SCHEMA_VERSION;
  document: CreatorCanvasDocumentV1;
  imageComposerDrafts: Record<string, CreatorImageComposerDraft>;
  videoComposerDrafts: Record<string, CreatorVideoComposerDraft>;
}

export type CreatorCanvasPersistedState = CreatorCanvasPersistedStateV2;

export type CreatorCanvasPersistedStateParseResult =
  | {
      ok: true;
      state: CreatorCanvasPersistedStateV2;
      imageComposerDrafts: Map<string, CreatorImageComposerDraft>;
      videoComposerDrafts: Map<string, CreatorVideoComposerDraft>;
    }
  | { ok: false; errors: string[] };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string")) {
    return false;
  }
  const expected = new Set(expectedKeys);
  return keys.every((key) => typeof key === "string" && expected.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAllowedValue<T>(value: unknown, values: readonly T[]): value is T {
  return (
    (typeof value === "string" || typeof value === "number") &&
    values.includes(value as T)
  );
}

function isNullableNodeReference(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function parseImageDraft(
  value: unknown,
  nodeId: string,
  errors: string[]
): CreatorImageComposerDraft | null {
  if (!isPlainRecord(value)) {
    errors.push(`DRAFT_SHAPE_INVALID:${nodeId}`);
    return null;
  }
  if (
    !hasExactKeys(value, [
      "prompt",
      "modelId",
      "aspectRatio",
      "count",
      "operation",
      "selectedImageReferenceNodeId",
      "promptSeedSourceNodeId",
      "promptDirty"
    ])
  ) {
    errors.push(`DRAFT_KEYS_INVALID:${nodeId}`);
  }

  const selectedImageReferenceNodeId = value.selectedImageReferenceNodeId;
  const promptSeedSourceNodeId = value.promptSeedSourceNodeId;
  if (typeof value.prompt !== "string") {
    errors.push(`DRAFT_PROMPT_INVALID:${nodeId}`);
  }
  if (typeof value.modelId !== "string") {
    errors.push(`DRAFT_MODEL_INVALID:${nodeId}`);
  }
  if (!isAllowedValue(value.aspectRatio, creatorImageAspectRatios)) {
    errors.push(`DRAFT_ASPECT_RATIO_INVALID:${nodeId}`);
  }
  if (!isAllowedValue(value.count, creatorImageGenerationCounts)) {
    errors.push(`DRAFT_COUNT_INVALID:${nodeId}`);
  }
  if (!isAllowedValue(value.operation, creatorImageComposerOperations)) {
    errors.push(`DRAFT_OPERATION_INVALID:${nodeId}`);
  }
  if (!isNullableNodeReference(selectedImageReferenceNodeId)) {
    errors.push(`DRAFT_IMAGE_REFERENCE_INVALID:${nodeId}`);
  }
  if (!isNullableNodeReference(promptSeedSourceNodeId)) {
    errors.push(`DRAFT_PROMPT_SEED_INVALID:${nodeId}`);
  }
  if (typeof value.promptDirty !== "boolean") {
    errors.push(`DRAFT_PROMPT_DIRTY_INVALID:${nodeId}`);
  }

  if (
    typeof value.prompt !== "string" ||
    typeof value.modelId !== "string" ||
    !isAllowedValue(value.aspectRatio, creatorImageAspectRatios) ||
    !isAllowedValue(value.count, creatorImageGenerationCounts) ||
    !isAllowedValue(value.operation, creatorImageComposerOperations) ||
    !isNullableNodeReference(selectedImageReferenceNodeId) ||
    !isNullableNodeReference(promptSeedSourceNodeId) ||
    typeof value.promptDirty !== "boolean"
  ) {
    return null;
  }

  return {
    prompt: value.prompt,
    modelId: value.modelId,
    aspectRatio: value.aspectRatio,
    count: value.count,
    operation: value.operation,
    selectedImageReferenceNodeId,
    promptSeedSourceNodeId,
    promptDirty: value.promptDirty
  };
}

function parseVideoDraft(
  value: unknown,
  nodeId: string,
  errors: string[]
): CreatorVideoComposerDraft | null {
  if (!isPlainRecord(value)) {
    errors.push(`VIDEO_DRAFT_SHAPE_INVALID:${nodeId}`);
    return null;
  }
  if (
    !hasExactKeys(value, [
      "prompt",
      "modelId",
      "mode",
      "selectedImageReferenceNodeId",
      "promptSeedSourceNodeId",
      "promptDirty"
    ])
  ) {
    errors.push(`VIDEO_DRAFT_KEYS_INVALID:${nodeId}`);
  }

  const selectedImageReferenceNodeId = value.selectedImageReferenceNodeId;
  const promptSeedSourceNodeId = value.promptSeedSourceNodeId;
  if (typeof value.prompt !== "string") {
    errors.push(`VIDEO_DRAFT_PROMPT_INVALID:${nodeId}`);
  }
  if (typeof value.modelId !== "string") {
    errors.push(`VIDEO_DRAFT_MODEL_INVALID:${nodeId}`);
  }
  if (!isAllowedValue(value.mode, creatorVideoComposerModes)) {
    errors.push(`VIDEO_DRAFT_MODE_INVALID:${nodeId}`);
  }
  if (!isNullableNodeReference(selectedImageReferenceNodeId)) {
    errors.push(`VIDEO_DRAFT_IMAGE_REFERENCE_INVALID:${nodeId}`);
  }
  if (!isNullableNodeReference(promptSeedSourceNodeId)) {
    errors.push(`VIDEO_DRAFT_PROMPT_SEED_INVALID:${nodeId}`);
  }
  if (typeof value.promptDirty !== "boolean") {
    errors.push(`VIDEO_DRAFT_PROMPT_DIRTY_INVALID:${nodeId}`);
  }

  if (
    typeof value.prompt !== "string" ||
    typeof value.modelId !== "string" ||
    !isAllowedValue(value.mode, creatorVideoComposerModes) ||
    !isNullableNodeReference(selectedImageReferenceNodeId) ||
    !isNullableNodeReference(promptSeedSourceNodeId) ||
    typeof value.promptDirty !== "boolean"
  ) {
    return null;
  }

  return {
    prompt: value.prompt,
    modelId: value.modelId,
    mode: value.mode,
    selectedImageReferenceNodeId,
    promptSeedSourceNodeId,
    promptDirty: value.promptDirty
  };
}

function cloneImageDraft(draft: CreatorImageComposerDraft): CreatorImageComposerDraft {
  return { ...draft };
}

function cloneVideoDraft(draft: CreatorVideoComposerDraft): CreatorVideoComposerDraft {
  return { ...draft };
}

function getImageNodeIds(document: CreatorCanvasDocumentV1): Set<string> {
  return new Set(
    document.nodes
      .filter((node) => node.kind === "image")
      .map((node) => node.id)
  );
}

function getVideoNodeIds(document: CreatorCanvasDocumentV1): Set<string> {
  return new Set(
    document.nodes
      .filter((node) => node.kind === "video")
      .map((node) => node.id)
  );
}

function sortedImageDraftRecord(
  drafts: ReadonlyMap<string, CreatorImageComposerDraft>,
  imageNodeIds: ReadonlySet<string>
): Record<string, CreatorImageComposerDraft> {
  return Object.fromEntries(
    Array.from(drafts)
      .filter(([nodeId]) => imageNodeIds.has(nodeId))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([nodeId, draft]) => [nodeId, cloneImageDraft(draft)])
  );
}

function sortedVideoDraftRecord(
  drafts: ReadonlyMap<string, CreatorVideoComposerDraft>,
  videoNodeIds: ReadonlySet<string>
): Record<string, CreatorVideoComposerDraft> {
  return Object.fromEntries(
    Array.from(drafts)
      .filter(([nodeId]) => videoNodeIds.has(nodeId))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([nodeId, draft]) => [nodeId, cloneVideoDraft(draft)])
  );
}

export function serializeCreatorCanvasPersistedState(
  document: CreatorCanvasDocumentV1,
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>,
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
): CreatorCanvasPersistedStateV2 {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) {
    throw new Error("CREATOR_CANVAS_DOCUMENT_NOT_SERIALIZABLE");
  }

  return {
    schemaVersion: CREATOR_CANVAS_PERSISTED_STATE_SCHEMA_VERSION,
    document: parsed.document,
    imageComposerDrafts: sortedImageDraftRecord(
      imageComposerDrafts,
      getImageNodeIds(parsed.document)
    ),
    videoComposerDrafts: sortedVideoDraftRecord(
      videoComposerDrafts,
      getVideoNodeIds(parsed.document)
    )
  };
}

export function parseCreatorCanvasPersistedState(
  value: unknown
): CreatorCanvasPersistedStateParseResult {
  if (!isPlainRecord(value)) {
    return { ok: false, errors: ["PERSISTED_STATE_SHAPE_INVALID"] };
  }

  const errors: string[] = [];
  const schemaVersion = value.schemaVersion;
  const isLegacy = schemaVersion === CREATOR_CANVAS_PERSISTED_STATE_LEGACY_SCHEMA_VERSION;
  const isCurrent = schemaVersion === CREATOR_CANVAS_PERSISTED_STATE_SCHEMA_VERSION;
  if (!isLegacy && !isCurrent) {
    errors.push("PERSISTED_STATE_VERSION_INVALID");
  }

  const expectedKeys = isLegacy
    ? ["schemaVersion", "document", "imageComposerDrafts"]
    : isCurrent
      ? ["schemaVersion", "document", "imageComposerDrafts", "videoComposerDrafts"]
      : [];
  if (expectedKeys.length > 0 && !hasExactKeys(value, expectedKeys)) {
    errors.push("PERSISTED_STATE_KEYS_INVALID");
  }

  const parsedDocument = parseCreatorCanvasDocument(value.document);
  if (!parsedDocument.ok) {
    errors.push(...parsedDocument.errors.map((error) => `DOCUMENT_${error}`));
  }
  if (!isPlainRecord(value.imageComposerDrafts)) {
    errors.push("PERSISTED_DRAFTS_INVALID");
  }
  if (isCurrent && !isPlainRecord(value.videoComposerDrafts)) {
    errors.push("PERSISTED_VIDEO_DRAFTS_INVALID");
  }
  if (
    errors.length > 0 ||
    !parsedDocument.ok ||
    !isPlainRecord(value.imageComposerDrafts) ||
    (isCurrent && !isPlainRecord(value.videoComposerDrafts))
  ) {
    return { ok: false, errors };
  }

  const imageNodeIds = getImageNodeIds(parsedDocument.document);
  const videoNodeIds = getVideoNodeIds(parsedDocument.document);
  const imageComposerDrafts = new Map<string, CreatorImageComposerDraft>();
  const videoComposerDrafts = new Map<string, CreatorVideoComposerDraft>();

  for (const [nodeId, rawDraft] of Object.entries(value.imageComposerDrafts)) {
    if (!imageNodeIds.has(nodeId)) continue;
    const draftErrors: string[] = [];
    const draft = parseImageDraft(rawDraft, nodeId, draftErrors);
    if (draftErrors.length > 0 || !draft) {
      errors.push(...draftErrors);
      continue;
    }
    imageComposerDrafts.set(nodeId, draft);
  }

  if (isCurrent && isPlainRecord(value.videoComposerDrafts)) {
    for (const [nodeId, rawDraft] of Object.entries(value.videoComposerDrafts)) {
      if (!videoNodeIds.has(nodeId)) continue;
      const draftErrors: string[] = [];
      const draft = parseVideoDraft(rawDraft, nodeId, draftErrors);
      if (draftErrors.length > 0 || !draft) {
        errors.push(...draftErrors);
        continue;
      }
      videoComposerDrafts.set(nodeId, draft);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const state: CreatorCanvasPersistedStateV2 = {
    schemaVersion: CREATOR_CANVAS_PERSISTED_STATE_SCHEMA_VERSION,
    document: parsedDocument.document,
    imageComposerDrafts: sortedImageDraftRecord(imageComposerDrafts, imageNodeIds),
    videoComposerDrafts: sortedVideoDraftRecord(videoComposerDrafts, videoNodeIds)
  };
  return {
    ok: true,
    state,
    imageComposerDrafts,
    videoComposerDrafts
  };
}

export function getCreatorCanvasPersistedStateFingerprint(
  document: CreatorCanvasDocumentV1,
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>,
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
): string {
  return JSON.stringify(
    serializeCreatorCanvasPersistedState(
      document,
      imageComposerDrafts,
      videoComposerDrafts
    )
  );
}

export function areCreatorCanvasPersistedStatesEqual(
  left: CreatorCanvasPersistedState,
  right: CreatorCanvasPersistedState
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
