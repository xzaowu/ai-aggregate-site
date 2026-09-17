"use client";

import type {
  AiAssetSummary,
  AiGenerationCount,
  AiGenerationSize,
  AiModelSummary,
  AiTaskSummary,
  ImageGenerationWorkflow,
  ImageGenerationMode,
  ImageGenerationResponse,
  ImageReferenceInput,
  TitleCoverImageRequest,
  TitleCoverVisualStyle
} from "@ai-aggregate/shared";
import {
  aiGenerationCounts,
  getModelDisplayName,
  isImageCapableModel,
  normalizeModelDisplaySurfaces,
  titleCoverStyles
} from "@ai-aggregate/shared";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Grid2X2,
  History,
  Images,
  Plus,
  SendHorizontal,
  Sparkles,
  Star,
  Upload,
  WandSparkles,
  X
} from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelIcon } from "../../../components/workspace/ModelIcon";
import { CreationSurfaceSwitcher } from "../../../components/workspace/CreationSurfaceSwitcher";
import { ConfirmDialog } from "../../../components/workspace/ConfirmDialog";
import { ImagePreviewDialog } from "../../../components/workspace/ImagePreviewDialog";
import { ResolvedAssetImage } from "../../../components/workspace/ResolvedAssetImage";
import { CreationWorkspaceView } from "./creation-workspace-view";
import {
  TRANSCRIPT_MAX_SELECTED_SCENES,
  compileTranscriptImagePrompt,
  segmentTranscript,
  validateTranscriptInput,
  type TranscriptSceneDraft,
  type TranscriptSceneStatus,
  type TranscriptSceneView
} from "./transcript-segmentation";
import {
  createTitleCoverTypographyDraft,
  defaultTitleCoverTypographyDraft,
  titleCoverTypographyPresets,
  type TitleCoverTypographyDraft,
  type TitleCoverTypographyPreset
} from "./title-cover-composition";
import {
  SecondarySidebarHeader,
  SidebarNewSessionButton,
  SidebarSectionLabel,
  WorkspaceHistoryItem
} from "../../../components/workspace/shared-sidebar";
import { resolveModelIdentity } from "../../../components/workspace/message-model-identity";
import { UserAvatar } from "../../../components/workspace/UserAvatar";
import { getUserSeed } from "../../../components/workspace/user-identity";
import { useOptionalWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";
import {
  parseImagePromptCards,
  type ImagePromptCard,
  type WorkspacePromptCard
} from "../../../components/workspace/workspace-settings";
import { Button } from "../../../components/workspace/ui";
import {
  createImageGenerationAttempt,
  createSecureUuid,
  type ImageGenerationAttempt as GenericImageGenerationAttempt,
  type QuickImageGenerationRequestPayload
} from "../../../lib/image-generation-attempt";
import {
  imageAspectRatios,
  inferAspectRatioFromPrompt,
  isImageAspectRatio,
  resolveImageGenerationSize,
  type ImageAspectRatio,
  type ImageReferenceDimensions
} from "../../../lib/image-generation-aspect";
import { submitAndReconcileImageGeneration } from "../../../lib/image-generation-reconciliation";
import {
  compressReferenceImage,
  estimateDataUrlBytes,
  imageReferencePreparationTimeoutMs,
  isCompressedImageReferenceUsable,
  validateReferenceImageFile,
  withImageReferencePreparationTimeout,
  type ReferenceImageCompressionState
} from "../../../lib/image-reference-preparation";
import { useI18n } from "../../../lib/i18n/use-i18n";
import {
  OwnerImageAssetReferenceError,
  resolveOwnerImageAssetReference
} from "../../../lib/owner-image-asset-reference";
import { apiUrl } from "../../../lib/site-config";
import {
  fetchPrivateAssetBlob,
  isAbortError,
  isPrivateAssetContentUrl
} from "../../../lib/private-asset-content";
import { generateImageSessionTitle } from "../../../lib/session-title";
import { usePublicSettings } from "../../../lib/use-public-settings";
import {
  clearImageCreationHandoff,
  getImageCreationHandoffStorageKey,
  imageCreationHandoffChangeEvent,
  readImageCreationHandoff,
  type ImageCreationHandoffV1
} from "../../image-creation-handoff";

const buildTranscriptImageRequestPayload = buildImageGenerateRequestPayload;
const createTranscriptGenerationAttempt = createImageGenerationAttempt;
type ImageGenerationAttempt = GenericImageGenerationAttempt<
  QuickImageGenerationRequestPayload
>;
export const imageSessionsStorageKey = "ai-aggregate:image-sessions:v1";
export const imagePromptDraftStorageKey =
  "ai-aggregate:image-prompt-draft:v1";
export const imageScrollStorageKey = "ai-aggregate:image-scroll:v1";
export {
  compressReferenceImage,
  estimateDataUrlBytes,
  imageReferencePreparationTimeoutMs,
  inferAspectRatioFromPrompt,
  resolveImageGenerationSize,
  validateReferenceImageFile
};
export type { ImageAspectRatio, ReferenceImageCompressionState };
export {
  findImageTaskForFailedFetchReconcile,
  findImageTaskForPollingReconcile
} from "../../../lib/image-generation-reconciliation";
export const imageModelHandoffStorageKey =
  "ai-aggregate:image-selected-model-handoff:v1";
export const imageModelHandoffMaxAgeMs = 5 * 60 * 1000;
export const dismissedImageSessionsStorageKey =
  "ai-aggregate:image-dismissed-sessions:v1";
const imageSessionsStorageVersion = 1;
const imagePromptDraftStorageVersion = 1;
const backendImageHistorySessionId = "image-history-backend";
const maxStoredImageStreamEntries = 20;
export const backendImageHistoryReloadDebounceMs = 5000;
export const backendImageHistoryReloadEvents = {
  visibilitychange: "visibilitychange",
  focus: "focus"
} as const;

type BackendImageHistoryRequest = {
  accountIdentity: string;
  token: string;
  accountRequestSequence: number;
  controller: AbortController;
  promise: Promise<void>;
};
const imageScrollKeyboardIntentKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar"
]);
const imageScrollPageKeyboardIntentKeys = new Set([
  "PageUp",
  "PageDown",
  "Home",
  "End"
]);
const imageScrollArrowKeyboardIntentKeys = new Set(["ArrowUp", "ArrowDown"]);
const imageScrollSpaceKeyboardIntentKeys = new Set([" ", "Spacebar"]);

export function getImageSessionsStorageKey(
  accountIdentity: string | null | undefined
): string {
  const identity = accountIdentity?.trim() || "guest";
  return `${imageSessionsStorageKey}:account-${encodeURIComponent(identity)}`;
}

export function getDismissedImageSessionsStorageKey(
  accountIdentity: string | null | undefined
): string {
  const identity = accountIdentity?.trim() || "guest";
  return `${dismissedImageSessionsStorageKey}:account-${encodeURIComponent(identity)}`;
}

export function resolveImageLocalStorageIdentity(
  authStatus: "unknown" | "guest" | "authenticated" | null | undefined,
  token: string | null | undefined,
  userId: string | null | undefined
): string | null {
  if (authStatus === "guest") {
    return "guest";
  }

  if (authStatus !== "authenticated" || !token) {
    return null;
  }

  const normalizedUserId = userId?.trim();
  return normalizedUserId ? `user:${normalizedUserId}` : null;
}

type ImagePromptDraftStorage = {
  version: typeof imagePromptDraftStorageVersion;
  identity: string;
  prompt: string;
  updatedAt: number;
};

type ImageScrollRuntimeOwner = {
  identity: string;
  sessionId: string | null;
  key: string;
  top: number;
};

type ImageScrollPendingRestore = {
  identity: string;
  sessionId: string | null;
  key: string;
  targetTop: number;
};

export function getImagePromptDraftStorageKey(
  accountIdentity: string | null | undefined
): string | null {
  const identity = accountIdentity?.trim();
  return identity
    ? `${imagePromptDraftStorageKey}:account-${encodeURIComponent(identity)}`
    : null;
}

export function readImagePromptDraft(
  accountIdentity: string | null | undefined
): string {
  const identity = accountIdentity?.trim();
  const key = getImagePromptDraftStorageKey(identity);
  if (!identity || !key || typeof window === "undefined") {
    return "";
  }

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return "";
    }

    const parsed = JSON.parse(raw) as Partial<ImagePromptDraftStorage>;
    return parsed.version === imagePromptDraftStorageVersion &&
      parsed.identity === identity &&
      typeof parsed.prompt === "string" &&
      parsed.prompt.length <= 4000
      ? parsed.prompt
      : "";
  } catch {
    return "";
  }
}

export function writeImagePromptDraft(
  accountIdentity: string | null | undefined,
  prompt: string
): void {
  const identity = accountIdentity?.trim();
  const key = getImagePromptDraftStorageKey(identity);
  if (!identity || !key || typeof window === "undefined") {
    return;
  }

  try {
    if (prompt.length === 0) {
      window.sessionStorage.removeItem(key);
      return;
    }

    const record: ImagePromptDraftStorage = {
      version: imagePromptDraftStorageVersion,
      identity,
      prompt: prompt.slice(0, 4000),
      updatedAt: Date.now()
    };
    window.sessionStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Browser storage can be unavailable without affecting in-memory drafting.
  }
}

export function shouldClearImagePromptDraftAfterSubmit({
  currentIdentity,
  loadedDraftIdentity,
  persistenceIdentityAtSubmit,
  currentPrompt,
  draftAtSubmit,
  currentPromptRevision,
  promptRevisionAtSubmit
}: {
  currentIdentity: string | null;
  loadedDraftIdentity: string | null | undefined;
  persistenceIdentityAtSubmit: string | null;
  currentPrompt: string;
  draftAtSubmit: string;
  currentPromptRevision: number;
  promptRevisionAtSubmit: number;
}): boolean {
  return Boolean(
    persistenceIdentityAtSubmit &&
      currentIdentity === persistenceIdentityAtSubmit &&
      loadedDraftIdentity === persistenceIdentityAtSubmit &&
      currentPrompt === draftAtSubmit &&
      currentPromptRevision === promptRevisionAtSubmit
  );
}

export function getImageScrollStorageKey(
  accountIdentity: string | null | undefined,
  sessionId: string | null | undefined
): string | null {
  const identity = accountIdentity?.trim();
  const sessionScope = sessionId?.trim()
    ? `session:${sessionId.trim()}`
    : "session:new";
  return identity
    ? `${imageScrollStorageKey}:account-${encodeURIComponent(identity)}:surface-image:${encodeURIComponent(sessionScope)}`
    : null;
}

export function readImageScrollTop(
  accountIdentity: string | null | undefined,
  sessionId: string | null | undefined
): number | null {
  const key = getImageScrollStorageKey(accountIdentity, sessionId);
  if (!key || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    const top = Number(raw);
    return Number.isFinite(top) && top >= 0 ? top : null;
  } catch {
    return null;
  }
}

export function writeImageScrollTop(
  accountIdentity: string | null | undefined,
  sessionId: string | null | undefined,
  top: number
): void {
  const key = getImageScrollStorageKey(accountIdentity, sessionId);
  if (!key || typeof window === "undefined" || !Number.isFinite(top) || top < 0) {
    return;
  }

  try {
    window.sessionStorage.setItem(key, String(top));
  } catch {
    // Browser storage can be unavailable without affecting scroll behavior.
  }
}

export function clampImageScrollTop(
  savedTop: number | null,
  scrollHeight: number,
  clientHeight: number
): number | null {
  if (savedTop === null || !Number.isFinite(savedTop) || savedTop < 0) {
    return null;
  }

  const maxTop = Math.max(0, scrollHeight - clientHeight);
  return Math.min(Math.max(0, savedTop), maxTop);
}

export const imagePreFetchFailureMessage =
  "当前浏览器暂时无法提交，请刷新或更换浏览器后重试";

export { titleCoverStyles };
export type TitleCoverStyle = TitleCoverVisualStyle;

export type TitleCoverDraft = {
  originalTitle: string;
  mainCopy: string;
  secondaryCopy: string;
  style: TitleCoverVisualStyle;
};

export type ImageCreatorWorkflow =
  | "free-create"
  | "precision-edit"
  | "title-cover"
  | "transcript-images";

export const defaultTitleCoverStyle: TitleCoverVisualStyle = "minimal-modern";

export function createDefaultTitleCoverDraft(): TitleCoverDraft {
  return {
    originalTitle: "",
    mainCopy: "",
    secondaryCopy: "",
    style: defaultTitleCoverStyle
  };
}

type ImageInspirationCard = {
  id: string;
  titleKey: string;
  categoryKey: string;
  promptKey: string;
  aspectRatio: ImageAspectRatio;
  accentClassName: string;
  coverClassName: string;
};

export const defaultImageGenerationCount: AiGenerationCount = 1;

export type ImageCreationMode = "quick" | "workspace";

export type ImageCreationHandoffReceiverState =
  | "IDLE"
  | "CONFLICT"
  | "PREPARING_REFERENCE"
  | "READY"
  | "TRANSIENT_FAILURE"
  | "TERMINAL_FAILURE";

class TerminalReferencePreparationError extends Error {
  constructor() {
    super("terminal reference preparation failure");
    this.name = "TerminalReferencePreparationError";
  }
}

export function parseImageCreationMode(
  rawValue: string | null | undefined
): ImageCreationMode {
  return rawValue === "workspace" ? "workspace" : "quick";
}

function readImageCreationMode(): ImageCreationMode {
  if (typeof window === "undefined") {
    return "quick";
  }

  return parseImageCreationMode(
    new URLSearchParams(window.location.search).get("mode")
  );
}

export function parseImageModelHandoff(
  rawValue: string | null,
  now = Date.now()
): string | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("modelId" in parsed) ||
      !("createdAt" in parsed)
    ) {
      return null;
    }

    const handoff = parsed as { modelId: unknown; createdAt: unknown };

    if (
      typeof handoff.modelId !== "string" ||
      handoff.modelId.trim().length === 0 ||
      typeof handoff.createdAt !== "number" ||
      !Number.isFinite(handoff.createdAt) ||
      now - handoff.createdAt > imageModelHandoffMaxAgeMs ||
      handoff.createdAt - now > imageModelHandoffMaxAgeMs
    ) {
      return null;
    }

    return handoff.modelId;
  } catch {
    return null;
  }
}

function isImageSelectableModel(model: AiModelSummary) {
  return (
    model.enabled &&
    isImageCapableModel(model) &&
    normalizeModelDisplaySurfaces(
      model.displaySurfaces,
      model.capability
    ).includes("image")
  );
}

export function resolveImageSelectableModel(
  identifier: string,
  models: AiModelSummary[]
): AiModelSummary | null {
  const normalizedIdentifier = identifier.trim();
  if (!normalizedIdentifier) {
    return null;
  }

  const slugMatch = models.find(
    (model) =>
      model.slug === normalizedIdentifier && isImageSelectableModel(model)
  );
  if (slugMatch) {
    return slugMatch;
  }

  const legacyMatches = models.filter(
    (model) =>
      model.modelId === normalizedIdentifier && isImageSelectableModel(model)
  );
  return legacyMatches.length === 1 ? legacyMatches[0] ?? null : null;
}

export const imageInspirationPresets: ImageInspirationCard[] = [
  {
    id: "commerce-product",
    titleKey: "multimodal.image.inspiration.title.commerce",
    categoryKey: "multimodal.image.inspiration.category.commerce",
    promptKey: "multimodal.image.inspiration.prompt.commerce",
    aspectRatio: "1:1",
    accentClassName: "bg-cyan-500",
    coverClassName: "from-cyan-100 via-white to-amber-100"
  },
  {
    id: "fashion-editorial",
    titleKey: "multimodal.image.inspiration.title.fashion",
    categoryKey: "multimodal.image.inspiration.category.fashion",
    promptKey: "multimodal.image.inspiration.prompt.fashion",
    aspectRatio: "3:4",
    accentClassName: "bg-rose-500",
    coverClassName: "from-rose-100 via-fuchsia-50 to-slate-100"
  },
  {
    id: "poster-design",
    titleKey: "multimodal.image.inspiration.title.poster",
    categoryKey: "multimodal.image.inspiration.category.poster",
    promptKey: "multimodal.image.inspiration.prompt.poster",
    aspectRatio: "16:9",
    accentClassName: "bg-emerald-500",
    coverClassName: "from-emerald-100 via-white to-sky-100"
  },
  {
    id: "ip-character",
    titleKey: "multimodal.image.inspiration.title.character",
    categoryKey: "multimodal.image.inspiration.category.character",
    promptKey: "multimodal.image.inspiration.prompt.character",
    aspectRatio: "1:1",
    accentClassName: "bg-violet-500",
    coverClassName: "from-violet-100 via-white to-lime-100"
  },
  {
    id: "academic-diagram",
    titleKey: "multimodal.image.inspiration.title.academic",
    categoryKey: "multimodal.image.inspiration.category.academic",
    promptKey: "multimodal.image.inspiration.prompt.academic",
    aspectRatio: "4:3",
    accentClassName: "bg-teal-500",
    coverClassName: "from-slate-100 via-white to-teal-100"
  },
  {
    id: "brand-key-visual",
    titleKey: "multimodal.image.inspiration.title.brand",
    categoryKey: "multimodal.image.inspiration.category.brand",
    promptKey: "multimodal.image.inspiration.prompt.brand",
    aspectRatio: "16:9",
    accentClassName: "bg-orange-500",
    coverClassName: "from-orange-100 via-white to-indigo-100"
  }
];

function getAspectRatioCssValue(ratio: ImageAspectRatio): string {
  const map: Record<ImageAspectRatio, string> = {
    auto: "1 / 1",
    "1:1": "1 / 1",
    "4:3": "4 / 3",
    "3:4": "3 / 4",
    "16:9": "16 / 9",
    "9:16": "9 / 16",
    "2:3": "2 / 3",
    "3:2": "3 / 2"
  };
  return map[ratio];
}

function getAspectRatioIconClassName(ratio: ImageAspectRatio) {
  const classNames: Record<ImageAspectRatio, string> = {
    auto: "h-4 w-4",
    "1:1": "h-4 w-4",
    "4:3": "h-3.5 w-5",
    "3:4": "h-5 w-3.5",
    "16:9": "h-3 w-6",
    "9:16": "h-6 w-3",
    "2:3": "h-5 w-3.5",
    "3:2": "h-3.5 w-5"
  };

  return classNames[ratio];
}

export type SelectedReferenceImage = {
  id: string;
  image: ImageReferenceInput;
  dimensions: ImageReferenceDimensions | null;
};

type ReferenceImageStateTarget = {
  currentImages: SelectedReferenceImage[];
  maxReferences: number;
  replaceExisting: boolean;
  setImages: React.Dispatch<React.SetStateAction<SelectedReferenceImage[]>>;
  setCompression: React.Dispatch<
    React.SetStateAction<ReferenceImageCompressionState>
  >;
  isCurrent?: () => boolean;
  maySurfaceFeedback?: () => boolean;
};

export function resolveModelMaxReferenceImages(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 4
    ? (value as number)
    : 1;
}

export function moveSelectedReferenceImage(
  references: readonly SelectedReferenceImage[],
  id: string,
  direction: -1 | 1
): SelectedReferenceImage[] {
  const index = references.findIndex((reference) => reference.id === id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= references.length) {
    return [...references];
  }

  const next = [...references];
  const current = next[index];
  const target = next[targetIndex];
  if (!current || !target) return next;
  next[index] = target;
  next[targetIndex] = current;
  return next;
}

type ImagePageError = {
  message: string;
  persistent: boolean;
  workflow: ImageCreatorWorkflow;
};

type RetryableImageGenerationSnapshot = Readonly<{
  clientEntryId: string;
  payload: ImageGenerationAttempt["payload"];
  workflow: ImageCreatorWorkflow;
}>;

export type ImageStreamReference = {
  dataUrl: string;
  name: string;
};

export type ImageStreamReferenceMetadata = {
  name: string | null;
};

export type ImageStreamEntry = {
  id: string;
  workflow?: ImageCreatorWorkflow;
  workflowContextId?: string | null;
  clientEntryId?: string | null;
  imageSessionId?: string | null;
  imageSessionTitle?: string | null;
  createdAt?: string | null;
  prompt: string;
  modelName: string;
  modelId?: string | null;
  aspectRatio: ImageAspectRatio;
  mode: ImageGenerationMode;
  referenceImages?: ImageStreamReference[];
  referenceImagesMetadata?: ImageStreamReferenceMetadata[];
  referenceImage: ImageStreamReference | null;
  referenceImageMetadata?: ImageStreamReferenceMetadata | null;
  requestedCount?: AiGenerationCount;
  assetCountContractViolation?: boolean;
  status: "loading" | "checking" | "succeeded" | "failed";
  result: ImageGenerationResponse | null;
  error: string | null;
};

export type ImageResultVersion = {
  entry: ImageStreamEntry;
  asset: AiAssetSummary;
  versionNumber: number;
  resultEntryId: string;
  batchId: string;
  taskId: string;
  imageOutputIndex: number | null;
  displayUrl: string;
  mimeType: string | null;
};

function getReusableImageResultPrompt(
  selectedVersion: ImageResultVersion | null
) {
  if (!selectedVersion) {
    return null;
  }

  const entryPrompt = selectedVersion.entry.prompt;
  if (entryPrompt.trim().length > 0) {
    return entryPrompt;
  }

  const taskPrompt = selectedVersion.entry.result?.task.prompt;
  return typeof taskPrompt === "string" && taskPrompt.trim().length > 0
    ? taskPrompt
    : null;
}

export type ImageResultBatch = {
  batchId: string;
  taskId: string;
  prompt: string;
  requestedCount: AiGenerationCount;
  acceptedAssetCount: number;
  assets: ImageResultVersion[];
  createdAt: string;
  partialSuccess: boolean;
  entry: ImageStreamEntry;
  versionNumber: number;
};

export function isRealImageResultAsset(
  asset: AiAssetSummary,
  taskId: string
) {
  return (
    Boolean(asset) &&
    typeof asset === "object" &&
    asset.type === "image" &&
    typeof asset.id === "string" &&
    asset.id.trim().length > 0 &&
    asset.taskId === taskId &&
    !asset.id.startsWith(`${taskId}-history-asset-`) &&
    typeof asset.url === "string" &&
    asset.url.trim().length > 0
  );
}

function readAcceptedImageResultAssets(
  assets: AiAssetSummary[],
  taskId: string
) {
  return Array.isArray(assets)
    ? assets.filter((asset) => isRealImageResultAsset(asset, taskId))
    : [];
}

function readHistoricalImageResultAssets(
  assets: AiAssetSummary[],
  taskId: string
) {
  return Array.isArray(assets)
    ? assets.filter(
        (asset) =>
          Boolean(asset) &&
          typeof asset === "object" &&
          asset.type === "image" &&
          typeof asset.id === "string" &&
          asset.id.startsWith(`${taskId}-history-asset-`) &&
          typeof asset.url === "string" &&
          asset.url.trim().length > 0
      )
    : [];
}

function readQuickImageResultAssets(result: ImageGenerationResponse) {
  if (
    !result ||
    typeof result !== "object" ||
    !result.task ||
    typeof result.task.id !== "string" ||
    !Array.isArray(result.assets)
  ) {
    return [];
  }

  const acceptedAssets = readAcceptedImageResultAssets(
    result.assets,
    result.task.id
  );

  if (acceptedAssets.length > 0) {
    return acceptedAssets;
  }

  return readHistoricalImageResultAssets(result.assets, result.task.id);
}

export function resolveImageEntryDisplayState(
  entry: ImageStreamEntry,
  options: { allowHistoricalFallback: boolean }
): ImageStreamEntry {
  if (entry.status !== "succeeded") {
    return entry;
  }

  const result = entry.result;
  if (!result || typeof result !== "object") {
    return {
      ...entry,
      status: "failed",
      result: null
    };
  }

  const taskId =
    result.task && typeof result.task.id === "string" ? result.task.id : null;
  const acceptedAssets = taskId
    ? readAcceptedImageResultAssets(result.assets, taskId)
    : [];
  const quickAssets = readQuickImageResultAssets(result);

  if (
    quickAssets.length === 0 ||
    (!options.allowHistoricalFallback && acceptedAssets.length === 0)
  ) {
    return {
      ...entry,
      status: "failed",
      result: null
    };
  }

  return entry;
}

export function readImageGenerationCount(value: unknown): AiGenerationCount {
  return value === 2 || value === 4 ? value : 1;
}

export function readImageOutputIndex(asset: AiAssetSummary): number | null {
  const value = asset.metadata?.imageOutputIndex;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

export function createImageResultEntryId(
  batchId: string,
  asset: AiAssetSummary,
  seenIds = new Map<string, number>()
) {
  const baseId = `${batchId}:${asset.id}`;
  const occurrence = seenIds.get(baseId) ?? 0;
  seenIds.set(baseId, occurrence + 1);
  return occurrence === 0 ? baseId : `${baseId}:duplicate-${occurrence}`;
}

function readAssetMimeType(asset: AiAssetSummary) {
  const mimeType = asset.metadata?.mimeType;
  return typeof mimeType === "string" && mimeType.trim().length > 0
    ? mimeType
    : null;
}

export function deriveImageResultBatches(
  entries: ImageStreamEntry[]
): ImageResultBatch[] {
  let versionNumber = 0;

  return entries.flatMap((entry) => {
    if (entry.status !== "succeeded" || !entry.result) {
      return [];
    }

    const result = entry.result;
    const seenIds = new Map<string, number>();
    const acceptedAssets = readAcceptedImageResultAssets(
      result.assets,
      result.task.id
    );
    // The unified Creator uses the already-established display fallback: real
    // current Assets win, while owner-readable historical Assets remain a
    // usable result projection when no current Asset is present.
    const displayableAssets =
      acceptedAssets.length > 0
        ? acceptedAssets
        : readHistoricalImageResultAssets(result.assets, result.task.id);
    const resultEntries = displayableAssets
      .map((asset) => {
        const resultEntryId = createImageResultEntryId(
          result.task.id,
          asset,
          seenIds
        );

        return {
          entry,
          asset,
          versionNumber: versionNumber + 1,
          resultEntryId,
          batchId: result.task.id,
          taskId: result.task.id,
          imageOutputIndex: readImageOutputIndex(asset),
          displayUrl: asset.url,
          mimeType: readAssetMimeType(asset)
        };
      });

    if (resultEntries.length === 0) {
      return [];
    }

    versionNumber += 1;
    const requestedCount = readStoredImageEntryRequestedCount(entry);
    const acceptedAssetCount = resultEntries.length;

    return [
      {
        batchId: result.task.id,
        taskId: result.task.id,
        prompt: entry.prompt || result.task.prompt,
        requestedCount,
        acceptedAssetCount,
        assets: resultEntries.map((resultEntry) => ({
          ...resultEntry,
          versionNumber
        })),
        createdAt: entry.createdAt ?? result.task.createdAt,
        partialSuccess:
          acceptedAssetCount > 0 && acceptedAssetCount < requestedCount,
        entry,
        versionNumber
      }
    ];
  });
}

/**
 * Derives versions from the active session timeline. The entry and asset
 * references remain the source of truth; this projection is never persisted.
 */
export function deriveImageResultVersions(
  entries: ImageStreamEntry[]
): ImageResultVersion[] {
  return deriveImageResultBatches(entries).flatMap((batch) => batch.assets);
}

export function resolveSelectedImageResultVersion(
  versions: ImageResultVersion[],
  selectedEntryId: string | null
) {
  return (
    versions.find(
      (version) =>
        version.resultEntryId === selectedEntryId ||
        version.entry.id === selectedEntryId
    ) ??
    (versions.length > 0
      ? versions.find(
          (version) => version.batchId === versions[versions.length - 1]?.batchId
        )
      : null) ??
    null
  );
}

export function resolveImageResultBatch(
  batches: ImageResultBatch[],
  selectedResultEntry: ImageResultVersion | null
) {
  return selectedResultEntry
    ? batches.find((batch) => batch.batchId === selectedResultEntry.batchId) ?? null
    : null;
}

export type ImageSession = {
  id: string;
  title: string;
  entries: ImageStreamEntry[];
  titleCoverCreationId?: string | null;
};

export type StoredImageSessions = {
  version: typeof imageSessionsStorageVersion;
  activeSessionId: string;
  firstPageLoadedAt: string;
  backendHistoryDismissed: boolean;
  sessions: ImageSession[];
};

export type ImagePromptEnterBehaviorInput = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  isMobileLayout: boolean;
};

export function shouldSubmitImagePromptOnEnter({
  key,
  shiftKey,
  isComposing,
  isMobileLayout
}: ImagePromptEnterBehaviorInput) {
  return key === "Enter" && !shiftKey && !isComposing && !isMobileLayout;
}

export type ImagePromptPresetId =
  | "general-square"
  | "bilibili-cover-169"
  | "bilibili-cover-43"
  | "website-article-cover"
  | "wechat-article-image"
  | "vertical-social-cover";

export type ImagePromptPreset = {
  id: ImagePromptPresetId;
  size: AiGenerationSize;
  labelKey: string;
  hintKey: string;
  templateKey: string;
};

export const imagePromptPresets: ImagePromptPreset[] = [
  {
    id: "general-square",
    size: "1024x1024",
    labelKey: "multimodal.image.preset.generalSquare",
    hintKey: "multimodal.image.presetHint.generalSquare",
    templateKey: "multimodal.image.presetTemplate.generalSquare"
  },
  {
    id: "bilibili-cover-169",
    size: "1280x720",
    labelKey: "multimodal.image.preset.bilibili169",
    hintKey: "multimodal.image.presetHint.bilibili169",
    templateKey: "multimodal.image.presetTemplate.bilibili169"
  },
  {
    id: "bilibili-cover-43",
    size: "1024x768",
    labelKey: "multimodal.image.preset.bilibili43",
    hintKey: "multimodal.image.presetHint.bilibili43",
    templateKey: "multimodal.image.presetTemplate.bilibili43"
  },
  {
    id: "website-article-cover",
    size: "1280x720",
    labelKey: "multimodal.image.preset.websiteArticleCover",
    hintKey: "multimodal.image.presetHint.websiteArticleCover",
    templateKey: "multimodal.image.presetTemplate.websiteArticleCover"
  },
  {
    id: "wechat-article-image",
    size: "768x1024",
    labelKey: "multimodal.image.preset.wechatArticleImage",
    hintKey: "multimodal.image.presetHint.wechatArticleImage",
    templateKey: "multimodal.image.presetTemplate.wechatArticleImage"
  },
  {
    id: "vertical-social-cover",
    size: "720x1280",
    labelKey: "multimodal.image.preset.verticalSocialCover",
    hintKey: "multimodal.image.presetHint.verticalSocialCover",
    templateKey: "multimodal.image.presetTemplate.verticalSocialCover"
  }
];

export function applyImagePromptPreset(
  preset: ImagePromptPreset,
  template: string
) {
  return {
    prompt: template,
    size: preset.size
  };
}

function safeGenerationError(message: string, fallback: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("ai provider") ||
    normalized.includes("provider.") ||
    normalized.includes("http://") ||
    normalized.includes("https://") ||
    normalized.includes("sk-")
  ) {
    return fallback;
  }

  return message || fallback;
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function isImageGenerationMode(value: unknown): value is ImageGenerationMode {
  return value === "text-to-image" || value === "image-to-image";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

let fallbackImageIdCounter = 0;

function createStableImageId(prefix: string) {
  try {
    return `${prefix}-${createSecureUuid()}`;
  } catch {
    fallbackImageIdCounter += 1;
    return `${prefix}-${Date.now()}-${fallbackImageIdCounter}`;
  }
}

export function createImageSessionId() {
  return createStableImageId("image-session");
}

export function createImageEntryId() {
  return createStableImageId("image-entry");
}

function isBackendImageHistorySessionId(sessionId: string | null | undefined) {
  return sessionId === backendImageHistorySessionId;
}

function readCappedString(value: unknown, maxLength: number): string | null {
  const trimmed = readOptionalString(value);
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function readTaskInputString(
  task: AiTaskSummary,
  key: "imageSessionId" | "clientEntryId" | "imageSessionTitle",
  maxLength: number
) {
  return readCappedString(task.input[key], maxLength);
}

function readTaskImageWorkflow(task: AiTaskSummary): ImageCreatorWorkflow {
  return task.input.workflow === "precision-edit" ||
    task.input.workflow === "title-cover" ||
    task.input.workflow === "transcript-images"
    ? task.input.workflow
    : "free-create";
}

function readImageCreatorWorkflow(value: unknown): ImageCreatorWorkflow {
  return value === "precision-edit" ||
    value === "title-cover" ||
    value === "transcript-images"
    ? value
    : "free-create";
}

function readImageStreamReferenceMetadata(
  value: unknown
): ImageStreamReferenceMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readOptionalString(value.name);

  return name ? { name } : { name: null };
}

function readImageStreamReferencesMetadata(
  pluralValue: unknown,
  scalarValue: unknown
): ImageStreamReferenceMetadata[] {
  if (Array.isArray(pluralValue)) {
    const references = pluralValue
      .map((value) => readImageStreamReferenceMetadata(value))
      .filter((value): value is ImageStreamReferenceMetadata => value !== null);
    if (references.length > 0) return references;
  }
  const scalar = readImageStreamReferenceMetadata(scalarValue);
  return scalar ? [scalar] : [];
}

function sanitizeReferenceMetadataRecord(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const sanitized: Record<string, unknown> = {};
  if (typeof value.name === "string" && value.name.trim().length > 0) {
    sanitized.name = value.name.trim();
  }
  if (typeof value.mimeType === "string" && value.mimeType.trim().length > 0) {
    sanitized.mimeType = value.mimeType.trim();
  }
  for (const key of ["originalBytes", "compressedBytes"] as const) {
    const bytes = value[key];
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0) {
      sanitized[key] = bytes;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeReferenceFields(value: Record<string, unknown>) {
  const sanitized = { ...value };

  if (Object.prototype.hasOwnProperty.call(sanitized, "referenceImage")) {
    const referenceImage = sanitizeReferenceMetadataRecord(
      sanitized.referenceImage
    );
    if (referenceImage) {
      sanitized.referenceImage = referenceImage;
    } else {
      delete sanitized.referenceImage;
    }
  }

  if (Object.prototype.hasOwnProperty.call(sanitized, "referenceImages")) {
    const referenceImages = Array.isArray(sanitized.referenceImages)
      ? sanitized.referenceImages
          .map((reference) => sanitizeReferenceMetadataRecord(reference))
          .filter((reference): reference is Record<string, unknown> => Boolean(reference))
      : [];

    if (referenceImages.length > 0) {
      sanitized.referenceImages = referenceImages;
    } else {
      delete sanitized.referenceImages;
    }
  }

  return sanitized;
}

function sanitizeTaskForStorage(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const sanitized = sanitizeReferenceFields(value);
  if (isRecord(sanitized.input)) {
    sanitized.input = sanitizeReferenceFields(sanitized.input);
  }

  if (isRecord(sanitized.output)) {
    sanitized.output = sanitizeReferenceFields(sanitized.output);
  }

  return sanitized;
}

function sanitizeImageResultForStorage(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const sanitized = sanitizeReferenceFields(value);
  if (Object.prototype.hasOwnProperty.call(sanitized, "task")) {
    sanitized.task = sanitizeTaskForStorage(sanitized.task);
  }

  if (Array.isArray(sanitized.assets)) {
    sanitized.assets = sanitized.assets
      .filter((asset): asset is Record<string, unknown> => isRecord(asset))
      .map((asset) => {
        const sanitizedAsset = { ...asset };
        if (isRecord(sanitizedAsset.metadata)) {
          sanitizedAsset.metadata = sanitizeReferenceFields(
            sanitizedAsset.metadata
          );
        }
        return sanitizedAsset;
      });
  }

  return sanitized;
}

function readResultReferencesMetadata(value: unknown) {
  if (!isRecord(value) || !isRecord(value.task)) {
    return [];
  }

  const input = value.task.input;
  return isRecord(input)
    ? readImageStreamReferencesMetadata(
        input.referenceImages,
        input.referenceImage
      )
    : [];
}

function sanitizeImageStreamEntryForStorage(
  entry: ImageStreamEntry
): ImageStreamEntry {
  const referenceImagesMetadata =
    entry.referenceImagesMetadata?.length
      ? entry.referenceImagesMetadata
      : entry.referenceImages?.length
        ? entry.referenceImages.map((reference) => ({ name: reference.name }))
        : readImageStreamReferencesMetadata(
            undefined,
            entry.referenceImageMetadata ?? entry.referenceImage
          );
  const referenceImageMetadata = referenceImagesMetadata[0] ?? null;

  return {
    ...entry,
    referenceImages: undefined,
    referenceImagesMetadata,
    referenceImage: null,
    referenceImageMetadata,
    result:
      (sanitizeImageResultForStorage(entry.result) as ImageGenerationResponse | null) ??
      null
  };
}

function sanitizeStoredImageSessions(
  stored: StoredImageSessions
): StoredImageSessions {
  return {
    ...stored,
    sessions: stored.sessions.map((session) => {
      const entries = session.entries.map((entry) =>
        sanitizeImageStreamEntryForStorage(entry)
      );

      if (entries.some((entry) => entry.workflow === "title-cover")) {
        return { ...session, entries };
      }

      const { titleCoverCreationId: _titleCoverCreationId, ...sessionWithoutTitleCoverContext } =
        session;
      return { ...sessionWithoutTitleCoverContext, entries };
    })
  };
}

function readStoredImageEntryRequestedCount(
  entry: Partial<ImageStreamEntry>
): AiGenerationCount {
  if (Object.prototype.hasOwnProperty.call(entry, "requestedCount")) {
    return readImageGenerationCount(entry.requestedCount);
  }

  const result = entry.result;
  if (
    result &&
    typeof result === "object" &&
    result.task &&
    typeof result.task === "object" &&
    result.task.input &&
    typeof result.task.input === "object"
  ) {
    return readImageGenerationCount(result.task.input.count);
  }

  return defaultImageGenerationCount;
}

function parseImageStreamEntry(value: unknown): ImageStreamEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<ImageStreamEntry>;

  if (
    typeof entry.id !== "string" ||
    typeof entry.prompt !== "string" ||
    typeof entry.modelName !== "string" ||
    !isImageAspectRatio(entry.aspectRatio) ||
    !isImageGenerationMode(entry.mode) ||
    (entry.status !== "loading" &&
      entry.status !== "checking" &&
      entry.status !== "succeeded" &&
      entry.status !== "failed")
  ) {
    return null;
  }

  const sanitizedResult = sanitizeImageResultForStorage(entry.result);
  const storedReferencesMetadata = readImageStreamReferencesMetadata(
    entry.referenceImagesMetadata,
    entry.referenceImageMetadata ?? entry.referenceImage
  );
  const referenceImagesMetadata = storedReferencesMetadata.length > 0
    ? storedReferencesMetadata
    : readResultReferencesMetadata(sanitizedResult);
  const referenceImageMetadata = referenceImagesMetadata[0] ?? null;

  const parsedEntry: ImageStreamEntry = {
    id: entry.id,
    workflow: readImageCreatorWorkflow(entry.workflow),
    workflowContextId: readCappedString(entry.workflowContextId, 128),
    clientEntryId: readCappedString(entry.clientEntryId, 128),
    imageSessionId: readCappedString(entry.imageSessionId, 128),
    imageSessionTitle: readCappedString(entry.imageSessionTitle, 120),
    createdAt: readCappedString(entry.createdAt, 64),
    prompt: entry.prompt,
    modelName: entry.modelName,
    modelId: typeof entry.modelId === "string" && entry.modelId.length <= 128
      ? entry.modelId
      : null,
    aspectRatio: entry.aspectRatio,
    mode: entry.mode,
    referenceImages: undefined,
    referenceImagesMetadata,
    referenceImage: null,
    referenceImageMetadata,
    requestedCount: readStoredImageEntryRequestedCount(entry),
    assetCountContractViolation: entry.assetCountContractViolation === true,
    status: entry.status,
    result: (sanitizedResult as ImageGenerationResponse | null) ?? null,
    error: typeof entry.error === "string" ? entry.error : null
  };

  return resolveImageEntryDisplayState(parsedEntry, {
    allowHistoricalFallback: true
  });
}

function parseImageSession(value: unknown): ImageSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const session = value as Partial<ImageSession>;

  if (
    typeof session.id !== "string" ||
    typeof session.title !== "string" ||
    !Array.isArray(session.entries)
  ) {
    return null;
  }

  const titleCoverCreationId = readCappedString(session.titleCoverCreationId, 128);

  return {
    id: session.id,
    title: session.title,
    ...(titleCoverCreationId ? { titleCoverCreationId } : {}),
    entries: session.entries
      .map((entry) => parseImageStreamEntry(entry))
      .filter((entry): entry is ImageStreamEntry => Boolean(entry))
  };
}

function getLatestTitleCoverCreationId(entries: ImageStreamEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.workflow === "title-cover" && entry.workflowContextId) {
      return entry.workflowContextId;
    }
  }

  return null;
}

function normalizeImageSessionWorkflowContexts(sessions: ImageSession[]) {
  return sessions.map((session) => {
    const hasTitleCoverEntries = session.entries.some(
      (entry) => entry.workflow === "title-cover"
    );

    if (!hasTitleCoverEntries && !session.titleCoverCreationId) {
      return session;
    }

    const titleCoverCreationId =
      session.titleCoverCreationId ??
      getLatestTitleCoverCreationId(session.entries) ??
      createImageEntryId();

    return {
      ...session,
      titleCoverCreationId,
      entries: session.entries.map((entry) =>
        entry.workflow === "title-cover" && !entry.workflowContextId
          ? { ...entry, workflowContextId: titleCoverCreationId }
          : entry
      )
    };
  });
}

export function trimStoredImageSessions(
  stored: StoredImageSessions,
  maxEntries = maxStoredImageStreamEntries
): StoredImageSessions {
  return {
    ...stored,
    sessions: stored.sessions.map((session) => ({
      ...session,
      entries: trimImageStreamEntries(session.entries, maxEntries)
    }))
  };
}

const maxImageResultBatches = 5;

function isSuccessfulImageBatchEntry(entry: ImageStreamEntry) {
  return (
    entry.status === "succeeded" &&
    Boolean(
      entry.result?.assets.some((asset) =>
        isRealImageResultAsset(asset, entry.result?.task.id ?? "")
      )
    )
  );
}

export function trimImageStreamEntries(
  entries: ImageStreamEntry[],
  maxEntries = maxStoredImageStreamEntries
) {
  const successfulEntriesByWorkflow = new Map<
    ImageCreatorWorkflow,
    ImageStreamEntry[]
  >();

  for (const entry of entries) {
    if (!isSuccessfulImageBatchEntry(entry)) {
      continue;
    }

    const workflow = entry.workflow ?? "free-create";
    successfulEntriesByWorkflow.set(workflow, [
      ...(successfulEntriesByWorkflow.get(workflow) ?? []),
      entry
    ]);
  }

  const retainedSuccessfulIds = new Set<string>();
  for (const successfulEntries of successfulEntriesByWorkflow.values()) {
    for (const entry of successfulEntries.slice(-maxImageResultBatches)) {
      retainedSuccessfulIds.add(entry.id);
    }
  }
  let retained = entries.filter(
    (entry) =>
      !isSuccessfulImageBatchEntry(entry) || retainedSuccessfulIds.has(entry.id)
  );

  if (retained.length <= maxEntries) {
    return retained;
  }

  const nonSuccessfulIds = retained
    .filter((entry) => !isSuccessfulImageBatchEntry(entry))
    .map((entry) => entry.id);
  const idsToRemove = new Set(
    nonSuccessfulIds.slice(0, Math.max(0, retained.length - maxEntries))
  );
  retained = retained.filter((entry) => !idsToRemove.has(entry.id));

  return retained;
}

function readIsoTimestampOrNow(value: unknown) {
  return typeof value === "string" && readTimestamp(value) !== null
    ? value
    : new Date().toISOString();
}

export function parseStoredImageSessions(
  storedValue: string | null,
  maxEntries = maxStoredImageStreamEntries
): StoredImageSessions | null {
  if (!storedValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedValue) as Partial<StoredImageSessions>;

    if (
      parsed.version !== imageSessionsStorageVersion ||
      typeof parsed.activeSessionId !== "string" ||
      !Array.isArray(parsed.sessions)
    ) {
      return null;
    }

    const sessions = parsed.sessions
      .map((session) => parseImageSession(session))
      .filter(
        (session): session is ImageSession =>
          session !== null && !isBackendImageHistorySessionId(session.id)
      );

    if (sessions.length === 0) {
      return null;
    }

    const firstSession = sessions[0];

    if (!firstSession) {
      return null;
    }

    return trimStoredImageSessions(
      {
        version: imageSessionsStorageVersion,
        activeSessionId: sessions.some(
          (session) => session.id === parsed.activeSessionId
        )
          ? parsed.activeSessionId
          : firstSession.id,
        firstPageLoadedAt: readIsoTimestampOrNow(parsed.firstPageLoadedAt),
        backendHistoryDismissed: parsed.backendHistoryDismissed === true,
        sessions: normalizeImageSessionWorkflowContexts(sessions)
      },
      maxEntries
    );
  } catch {
    return null;
  }
}

export function serializeImageSessionsForStorage(
  sessions: ImageSession[],
  activeSessionId: string,
  maxEntries = maxStoredImageStreamEntries,
  options?: {
    firstPageLoadedAt?: string;
    backendHistoryDismissed?: boolean;
  }
) {
  return JSON.stringify(
    sanitizeStoredImageSessions(
      trimStoredImageSessions({
        version: imageSessionsStorageVersion,
        activeSessionId,
        firstPageLoadedAt: readIsoTimestampOrNow(options?.firstPageLoadedAt),
        backendHistoryDismissed: options?.backendHistoryDismissed === true,
        sessions
      }, maxEntries)
    )
  );
}

export function parseDismissedImageSessionIds(storedValue: string | null) {
  if (!storedValue) {
    return new Set<string>();
  }

  try {
    const parsed = JSON.parse(storedValue);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter(
            (sessionId): sessionId is string =>
              typeof sessionId === "string" && sessionId.trim().length > 0
          )
        : []
    );
  } catch {
    return new Set<string>();
  }
}

export function serializeDismissedImageSessionIds(sessionIds: Iterable<string>) {
  return JSON.stringify(
    Array.from(new Set(sessionIds)).filter(
      (sessionId) => !isBackendImageHistorySessionId(sessionId)
    )
  );
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export function readTaskOutputImages(task: AiTaskSummary): string[] {
  const output = task.output ?? {};
  const images = readStringArray(output.images);
  const imageUrl = readOptionalString(output.imageUrl);

  return imageUrl && !images.includes(imageUrl) ? [...images, imageUrl] : images;
}

function readTaskImageMode(task: AiTaskSummary): ImageGenerationMode {
  const inputMode = task.input.mode;
  const outputMode = task.output?.mode;

  if (isImageGenerationMode(inputMode)) {
    return inputMode;
  }

  if (isImageGenerationMode(outputMode)) {
    return outputMode;
  }

  return "text-to-image";
}

function readTaskAspectRatio(task: AiTaskSummary): ImageAspectRatio {
  const aspectRatio = task.input.aspectRatio ?? task.output?.aspectRatio;

  return isImageAspectRatio(aspectRatio) ? aspectRatio : "auto";
}

function readTaskReferencesMetadata(task: AiTaskSummary) {
  return readImageStreamReferencesMetadata(
    task.input.referenceImages,
    task.input.referenceImage
  );
}

function getTaskModelName(
  task: AiTaskSummary,
  modelMap: Map<string, AiModelSummary>
) {
  const model = task.modelId ? modelMap.get(task.modelId) : null;
  return model ? getModelDisplayName(model) : task.modelId ?? "";
}

function createHistoryAsset(task: AiTaskSummary, url: string, index: number) {
  const createdAt = task.completedAt ?? task.updatedAt ?? task.createdAt;

  return {
    id: `${task.id}-history-asset-${index}`,
    userId: task.userId,
    taskId: task.id,
    type: "image" as const,
    url,
    thumbnailUrl: null,
    title: task.prompt || null,
    metadata: {
      restoredFromTask: true,
      modelId: task.modelId,
      mode: readTaskImageMode(task)
    },
    createdAt,
    taskPrompt: task.prompt
  };
}

export function taskToImageStreamEntry(
  task: AiTaskSummary,
  modelMap: Map<string, AiModelSummary>,
  t: (key: string, values?: Record<string, string | number>) => string,
  persistedAssets?: AiAssetSummary[]
): ImageStreamEntry {
  const images = readTaskOutputImages(task);
  const referenceImagesMetadata = readTaskReferencesMetadata(task);
  const referenceImageMetadata = referenceImagesMetadata[0] ?? null;
  const imageSessionId = readTaskInputString(task, "imageSessionId", 128);
  const clientEntryId = readTaskInputString(task, "clientEntryId", 128);
  const imageSessionTitle = readTaskInputString(task, "imageSessionTitle", 120);
  const baseEntry = {
    id: task.id,
    workflow: readTaskImageWorkflow(task),
    clientEntryId,
    imageSessionId,
    imageSessionTitle,
    createdAt: task.createdAt,
    prompt: task.prompt || "",
    modelName: getTaskModelName(task, modelMap),
    modelId: task.modelId,
    aspectRatio: readTaskAspectRatio(task),
    mode: readTaskImageMode(task),
    referenceImages: undefined,
    referenceImagesMetadata,
    referenceImage: null,
    referenceImageMetadata,
    requestedCount: readImageGenerationCount(task.input.count),
    assetCountContractViolation: false,
    error: null
  };

  if (task.status === "failed") {
    return {
      ...baseEntry,
      status: "failed",
      result: null,
      error: task.errorMessage || t("multimodal.error.generateFailed")
    };
  }

  if (task.status === "pending" || task.status === "running") {
    return {
      ...baseEntry,
      status: "loading",
      result: null
    };
  }

  const assets =
    persistedAssets ?? images.map((url, index) => createHistoryAsset(task, url, index));
  const acceptedAssetCount = readAcceptedImageResultAssets(assets, task.id).length;
  const displayableAssetCount =
    acceptedAssetCount > 0
      ? acceptedAssetCount
      : persistedAssets === undefined
        ? readHistoricalImageResultAssets(assets, task.id).length
        : 0;

  if (displayableAssetCount === 0) {
    return {
      ...baseEntry,
      status: "failed",
      result: null,
      error: t("multimodal.error.generateFailed")
    };
  }

  return {
    ...baseEntry,
    status: "succeeded",
    assetCountContractViolation:
      acceptedAssetCount > readImageGenerationCount(task.input.count),
    result: { task, assets }
  };
}

function readTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function filterTasksCreatedBefore(
  tasks: AiTaskSummary[],
  cutoff: Date
): AiTaskSummary[] {
  const cutoffTime = cutoff.getTime();

  return tasks.filter((task) => {
    const createdAt = readTimestamp(task.createdAt);
    return createdAt !== null && createdAt < cutoffTime;
  });
}

export function filterTasksCreatedBeforeIso(
  tasks: AiTaskSummary[],
  cutoffIso: string
): AiTaskSummary[] {
  const cutoff = readTimestamp(cutoffIso);
  return cutoff === null ? [] : filterTasksCreatedBefore(tasks, new Date(cutoff));
}

function getImageStreamEntryClientEntryId(entry: ImageStreamEntry) {
  return readCappedString(entry.clientEntryId, 128) ?? readCappedString(entry.id, 128);
}

export function shouldReloadBackendImageHistory(
  lastReloadedAt: number | null,
  now: number,
  debounceMs = backendImageHistoryReloadDebounceMs
) {
  return lastReloadedAt === null || now - lastReloadedAt >= debounceMs;
}

export function isFailedFetchError(error: unknown) {
  return error instanceof Error && error.message === "Failed to fetch";
}

export function reconcileImageStreamEntryFromTask(
  entry: ImageStreamEntry,
  task: AiTaskSummary,
  modelMap: Map<string, AiModelSummary>,
  t: (key: string, values?: Record<string, string | number>) => string,
  persistedAssets?: AiAssetSummary[]
): ImageStreamEntry {
  const reconciledEntry = taskToImageStreamEntry(
    task,
    modelMap,
    t,
    persistedAssets
  );

  if (task.status === "failed") {
    return {
      ...entry,
      modelName: reconciledEntry.modelName || entry.modelName,
      aspectRatio: reconciledEntry.aspectRatio,
      mode: reconciledEntry.mode,
      referenceImagesMetadata:
        reconciledEntry.referenceImagesMetadata?.length
          ? reconciledEntry.referenceImagesMetadata
          : entry.referenceImagesMetadata,
      referenceImageMetadata:
        reconciledEntry.referenceImageMetadata ?? entry.referenceImageMetadata,
      status: "failed",
      result: null,
      error: reconciledEntry.error || t("multimodal.error.generateFailed")
    };
  }

  return {
    ...entry,
    modelName: reconciledEntry.modelName || entry.modelName,
    aspectRatio: reconciledEntry.aspectRatio,
    mode: reconciledEntry.mode,
    referenceImagesMetadata:
      reconciledEntry.referenceImagesMetadata?.length
        ? reconciledEntry.referenceImagesMetadata
        : entry.referenceImagesMetadata,
    referenceImageMetadata:
      reconciledEntry.referenceImageMetadata ?? entry.referenceImageMetadata,
    status: reconciledEntry.status,
    result: reconciledEntry.result,
    assetCountContractViolation: reconciledEntry.assetCountContractViolation,
    error: reconciledEntry.error
  };
}

export function markImageStreamEntryChecking(
  entry: ImageStreamEntry,
  message: string
): ImageStreamEntry {
  return {
    ...entry,
    status: "checking",
    result: null,
    error: message
  };
}

export function buildImageGenerateRequestPayload({
  prompt,
  modelId,
  size,
  count,
  mode,
  imageSessionId,
  clientEntryId,
  imageSessionTitle,
  referenceImages,
  workflow,
  titleCover
}: {
  prompt: string;
  modelId: string;
  size: AiGenerationSize;
  count: AiGenerationCount;
  mode: ImageGenerationMode;
  imageSessionId: string;
  clientEntryId: string;
  imageSessionTitle: string;
  referenceImages?: readonly ImageReferenceInput[];
  workflow?: ImageGenerationWorkflow;
  titleCover?: TitleCoverImageRequest;
}): QuickImageGenerationRequestPayload {
  return {
    prompt,
    modelId,
    size,
    count,
    mode,
    imageSessionId,
    clientEntryId,
    imageSessionTitle,
    ...(workflow ? { workflow } : {}),
    ...(workflow === "title-cover" && titleCover ? { titleCover } : {}),
    ...(mode === "image-to-image" && referenceImages?.length
      ? { referenceImages: [...referenceImages] }
      : {})
  };
}

export function updateImageSessionEntries(
  sessions: ImageSession[],
  targetSessionId: string,
  update: (currentEntries: ImageStreamEntry[]) => ImageStreamEntry[],
  options?: { titleGenerator?: (firstPrompt: string) => string }
): ImageSession[] {
  return sessions.map((session) => {
    if (session.id !== targetSessionId) {
      return session;
    }

    const nextEntries = trimImageStreamEntries(update(session.entries));
    const firstPrompt = nextEntries[0]?.prompt.trim();
    const hasTitleCoverEntries = nextEntries.some(
      (entry) => (entry.workflow ?? "free-create") === "title-cover"
    );
    const hasFreeCreateEntries = nextEntries.some(
      (entry) => (entry.workflow ?? "free-create") === "free-create"
    );
    const firstTitleCoverTitle = nextEntries
      .filter((entry) => (entry.workflow ?? "free-create") === "title-cover")
      .map((entry) => entry.imageSessionTitle?.trim() ?? "")
      .find((entryTitle) => entryTitle.length > 0);
    let title = session.title;

    if (hasTitleCoverEntries && !hasFreeCreateEntries) {
      title = firstTitleCoverTitle || session.title;
    } else if (hasTitleCoverEntries && hasFreeCreateEntries) {
      // Mixed sessions retain the existing Free Create title. The Title Cover
      // visual prompt is internal generation data and must not rename it.
    } else if (firstPrompt && options?.titleGenerator) {
      const generated = options.titleGenerator(firstPrompt);
      if (generated) {
        title = generated;
      }
    } else if (firstPrompt) {
      title = firstPrompt || session.title;
    }

    return {
      ...session,
      title,
      entries: nextEntries
    };
  });
}

export function reconcilePendingImageSessionEntriesWithBackend(
  localSessions: ImageSession[],
  backendEntries: ImageStreamEntry[]
): ImageSession[] {
  const backendByClientEntryId = new Map<string, ImageStreamEntry>();

  for (const entry of backendEntries) {
    const clientEntryId =
      entry.clientEntryId ??
      (entry.result?.task
        ? readTaskInputString(entry.result.task, "clientEntryId", 128)
        : null);

    if (clientEntryId) {
      backendByClientEntryId.set(clientEntryId, entry);
    }
  }

  return localSessions.map((session) => ({
    ...session,
    entries: session.entries.map((entry) => {
      const localClientEntryId = getImageStreamEntryClientEntryId(entry);
      const backendEntry = localClientEntryId
        ? backendByClientEntryId.get(localClientEntryId)
        : null;

      if (
        (entry.status !== "loading" && entry.status !== "checking") ||
        !backendEntry ||
        !(
          backendEntry.status === "failed" ||
          (backendEntry.status === "succeeded" &&
            (backendEntry.result?.assets.length ?? 0) > 0)
        )
      ) {
        return entry;
      }

      return {
        ...entry,
        modelName: backendEntry.modelName || entry.modelName,
        createdAt: backendEntry.createdAt ?? entry.createdAt,
        aspectRatio: backendEntry.aspectRatio,
        mode: backendEntry.mode,
        referenceImagesMetadata:
          backendEntry.referenceImagesMetadata?.length
            ? backendEntry.referenceImagesMetadata
            : entry.referenceImagesMetadata,
        referenceImageMetadata:
          backendEntry.referenceImageMetadata ?? entry.referenceImageMetadata,
        status: backendEntry.status,
        result: backendEntry.result,
        error: backendEntry.error
      };
    })
  }));
}

export function mergeImageSessionsWithBackendHistory(
  localSessions: ImageSession[],
  backendEntries: ImageStreamEntry[],
  historyTitle = "History",
  maxEntries = maxStoredImageStreamEntries,
  options?: {
    backendHistoryDismissed?: boolean;
    firstPageLoadedAt?: string;
    dismissedSessionIds?: Iterable<string>;
    imageSessionFallbackTitle?: string;
  }
): ImageSession[] {
  const firstPageLoadedAt = readIsoTimestampOrNow(options?.firstPageLoadedAt);
  const backendHistoryDismissed = options?.backendHistoryDismissed === true;
  const dismissedSessionIds = new Set(options?.dismissedSessionIds ?? []);
  const fallbackSessionTitle = options?.imageSessionFallbackTitle ?? "Image session";
  const backendEntriesWithSession = backendEntries.filter(
    (entry) => Boolean(entry.imageSessionId)
  );
  const reconciledLocalSessions = reconcilePendingImageSessionEntriesWithBackend(
    localSessions.filter(
      (session) => !isBackendImageHistorySessionId(session.id)
    ),
    backendEntriesWithSession
  );

  const existingTaskIds = new Set<string>();
  const existingClientEntryIds = new Set<string>();
  for (const session of reconciledLocalSessions) {
    for (const entry of session.entries) {
      existingTaskIds.add(entry.id);
      const resultTaskId = entry.result?.task?.id;
      if (resultTaskId) {
        existingTaskIds.add(resultTaskId);
      }
      const localClientEntryId =
        getImageStreamEntryClientEntryId(entry) ??
        (entry.result?.task
          ? readTaskInputString(entry.result.task, "clientEntryId", 128)
          : null);
      if (localClientEntryId) {
        existingClientEntryIds.add(localClientEntryId);
      }
    }
  }

  const dedupedBackendEntries = backendEntriesWithSession.filter((entry) => {
    const taskId = entry.result?.task?.id ?? entry.id;
    const clientEntryId =
      entry.clientEntryId ??
      (entry.result?.task
        ? readTaskInputString(entry.result.task, "clientEntryId", 128)
        : null);

    if (existingTaskIds.has(taskId)) {
      return false;
    }

    if (clientEntryId && existingClientEntryIds.has(clientEntryId)) {
      return false;
    }

    existingTaskIds.add(taskId);
    if (clientEntryId) {
      existingClientEntryIds.add(clientEntryId);
    }
    return true;
  });

  const groupedEntries = dedupedBackendEntries.filter((entry) => {
    if (!entry.imageSessionId) {
      return false;
    }

    return !dismissedSessionIds.has(entry.imageSessionId);
  });
  const entriesBySessionId = new Map<string, ImageStreamEntry[]>();

  for (const entry of groupedEntries) {
    const sessionId = entry.imageSessionId;

    if (!sessionId) {
      continue;
    }

    entriesBySessionId.set(sessionId, [
      ...(entriesBySessionId.get(sessionId) ?? []),
      entry
    ]);
  }

  if (
    entriesBySessionId.size === 0
  ) {
    return trimStoredImageSessions(
      {
        version: imageSessionsStorageVersion,
        activeSessionId: reconciledLocalSessions[0]?.id ?? createImageSessionId(),
        firstPageLoadedAt,
        backendHistoryDismissed,
        sessions: reconciledLocalSessions
      },
      maxEntries
    ).sessions;
  }

  const localById = new Map(
    reconciledLocalSessions.map((session) => [session.id, session])
  );
  const sessionLatestTime = new Map<string, number>();
  const nextSessionsById = new Map<string, ImageSession>();

  for (const session of reconciledLocalSessions) {
    if (dismissedSessionIds.has(session.id)) {
      continue;
    }

    nextSessionsById.set(session.id, session);
  }

  for (const [sessionId, entries] of entriesBySessionId) {
    const localSession = localById.get(sessionId);
    const sortedEntries = [...entries].sort(
      (left, right) =>
        (readTimestamp(left.createdAt ?? left.result?.task?.createdAt) ?? 0) -
        (readTimestamp(right.createdAt ?? right.result?.task?.createdAt) ?? 0)
    );
    const firstEntry = sortedEntries[0];
    const latestEntry = sortedEntries.at(-1);
    const latestCreatedAt =
      readTimestamp(latestEntry?.createdAt ?? latestEntry?.result?.task?.createdAt) ??
      0;
    const derivedTitle =
      localSession?.title ||
      firstEntry?.imageSessionTitle ||
      firstEntry?.prompt.trim().slice(0, 30) ||
      fallbackSessionTitle;

    sessionLatestTime.set(sessionId, latestCreatedAt);
    nextSessionsById.set(sessionId, {
      id: sessionId,
      title: derivedTitle,
      titleCoverCreationId:
        localSession?.titleCoverCreationId ??
        getLatestTitleCoverCreationId(localSession?.entries ?? []) ??
        getLatestTitleCoverCreationId(entries) ??
        createImageEntryId(),
      entries: [...(localSession?.entries ?? []), ...sortedEntries]
    });
  }

  let nextSessions = Array.from(nextSessionsById.values());

  nextSessions.sort((left, right) => {
    const leftLatest =
      sessionLatestTime.get(left.id) ??
      readTimestamp(
        left.entries.at(-1)?.createdAt ??
          left.entries.at(-1)?.result?.task?.createdAt
      ) ??
      0;
    const rightLatest =
      sessionLatestTime.get(right.id) ??
      readTimestamp(
        right.entries.at(-1)?.createdAt ??
          right.entries.at(-1)?.result?.task?.createdAt
      ) ??
      0;

    if (leftLatest !== rightLatest) {
      return rightLatest - leftLatest;
    }

    if (left.entries.length !== right.entries.length) {
      return right.entries.length - left.entries.length;
    }

    return (
      reconciledLocalSessions.findIndex((session) => session.id === left.id) -
      reconciledLocalSessions.findIndex((session) => session.id === right.id)
    );
  });

  return trimStoredImageSessions(
    {
      version: imageSessionsStorageVersion,
      activeSessionId: nextSessions[0]?.id ?? createImageSessionId(),
      firstPageLoadedAt,
      backendHistoryDismissed,
      sessions: nextSessions
    },
    maxEntries
  ).sessions;
}

export function normalizeImageSessionsForDisplay(
  sessions: ImageSession[],
  historyTitle = "History"
): ImageSession[] {
  void historyTitle;
  return normalizeImageSessionWorkflowContexts(
    sessions.filter((session) => !isBackendImageHistorySessionId(session.id))
  );
}

export function selectActiveImageSessionId(
  sessions: ImageSession[],
  preferredSessionId: string | null | undefined
) {
  if (
    preferredSessionId &&
    !isBackendImageHistorySessionId(preferredSessionId) &&
    sessions.some((session) => session.id === preferredSessionId)
  ) {
    return preferredSessionId;
  }

  const latestNonHistory = sessions.find(
    (session) =>
      !isBackendImageHistorySessionId(session.id) && session.entries.length > 0
  );

  return latestNonHistory?.id ?? sessions[0]?.id ?? createImageSessionId();
}

function readImageGenerationErrorMessage(
  status: number | null,
  body: unknown,
  fallback: string,
  insufficientCredits: string
) {
  if (status === 402) {
    return insufficientCredits;
  }

  if (
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return safeGenerationError(body.message, fallback);
  }

  return fallback;
}

export type ImagePromptCardAspectCategory =
  | "portrait"
  | "square"
  | "landscape"
  | "extreme";

export function getImagePromptCardAspectCategory(
  naturalWidth: number,
  naturalHeight: number
): ImagePromptCardAspectCategory {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return "square";
  }

  const ratio = naturalWidth / naturalHeight;

  if (ratio <= 0.5 || ratio >= 2) {
    return "extreme";
  }

  if (ratio < 0.85) {
    return "portrait";
  }

  if (ratio > 1.18) {
    return "landscape";
  }

  return "square";
}

function ImagePromptRecommendationCarousel({
  cards,
  workspaceTitle,
  workspaceDescription,
  usePromptLabel,
  promptExpandLabel,
  promptCollapseLabel,
  previousLabel,
  nextLabel,
  previewLabels,
  onUsePrompt
}: {
  cards: ImagePromptCard[];
  workspaceTitle: string;
  workspaceDescription: string;
  usePromptLabel: string;
  promptExpandLabel: string;
  promptCollapseLabel: string;
  previousLabel: string;
  nextLabel: string;
  previewLabels: {
    close: string;
    zoomIn: string;
    zoomOut: string;
    fit: string;
    loading: string;
    loadFailed: string;
  };
  onUsePrompt: (prompt: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [naturalDimensions, setNaturalDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveIndex((currentIndex) =>
      Math.min(currentIndex, Math.max(0, cards.length - 1))
    );
  }, [cards.length]);

  const safeActiveIndex = Math.min(activeIndex, cards.length - 1);
  const activeCard = cards[safeActiveIndex];
  const activeCardKey = activeCard
    ? `${safeActiveIndex}-${activeCard.title}-${activeCard.imageUrl ?? ""}`
    : null;

  useEffect(() => {
    if (!activeCardKey) {
      return;
    }

    setImageLoaded(false);
    setNaturalDimensions(null);
    setIsPromptExpanded(false);
    setPreviewUrl(null);
  }, [activeCardKey]);

  if (!activeCard || cards.length === 0) {
    return null;
  }

  const hasImage = Boolean(activeCard.imageUrl) && failedImageKey !== activeCardKey;
  const aspectCategory = naturalDimensions
    ? getImagePromptCardAspectCategory(
        naturalDimensions.width,
        naturalDimensions.height
      )
    : "square";
  const layoutClassName =
    aspectCategory === "landscape"
      ? "lg:grid-cols-[minmax(440px,1.35fr)_minmax(300px,0.85fr)]"
      : aspectCategory === "portrait"
        ? "lg:grid-cols-[minmax(300px,0.8fr)_minmax(380px,1.2fr)]"
        : aspectCategory === "extreme"
          ? "lg:grid-cols-[minmax(280px,0.75fr)_minmax(380px,1.25fr)]"
          : "lg:grid-cols-[minmax(380px,1fr)_minmax(340px,1fr)]";
  const promptNeedsToggle = activeCard.prompt.length > 220;

  function selectCard(index: number) {
    setActiveIndex(index);
    setImageLoaded(false);
    setNaturalDimensions(null);
    setPreviewUrl(null);
  }

  function selectRelativeCard(delta: number) {
    selectCard((safeActiveIndex + delta + cards.length) % cards.length);
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX;
    touchStartXRef.current = null;

    if (startX === null || endX === undefined || Math.abs(endX - startX) < 40) {
      return;
    }

    selectRelativeCard(endX < startX ? 1 : -1);
  }

  return (
    <section
      className="mx-auto grid w-full max-w-6xl min-w-0 gap-4"
      aria-label={activeCard.title}
      data-image-inspiration-carousel="true"
      data-image-inspiration-visible-count={String(cards.length)}
      data-image-prompt-card-index={String(safeActiveIndex)}
      data-image-prompt-card-variant={hasImage ? "image" : "text"}
      data-image-prompt-card-aspect={aspectCategory}
      data-image-prompt-card-layout={aspectCategory}
    >
      <div
        className={`grid min-w-0 items-center gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.85fr)] lg:gap-x-8 ${layoutClassName}`}
        data-image-prompt-card-layout-grid="true"
      >
        <div
          className="order-1 min-w-0 text-center md:col-start-2 md:row-start-1 md:self-end md:text-left"
          data-image-prompt-card-guidance="true"
        >
          <span className="hidden text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-400 md:block">
            IMAGE STUDIO
          </span>
          <h2 className="mt-1 text-[28px] font-bold leading-tight tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
            {workspaceTitle}
          </h2>
          <p className="mx-auto mt-2 max-w-[32rem] text-sm leading-5 text-slate-500 dark:text-slate-400 sm:text-base md:mx-0">
            {workspaceDescription}
          </p>
        </div>

        <div
          className="group order-2 relative min-w-0 overflow-hidden rounded-xl md:col-start-1 md:row-start-1 md:row-span-4"
          data-image-prompt-card-main="true"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          style={{ touchAction: "pan-y" }}
        >
          <div className="relative flex h-[min(72vw,520px)] min-h-[220px] max-h-[520px] items-center justify-center md:h-[min(60vh,520px)] md:min-h-[260px]">
            {hasImage && activeCard.imageUrl ? (
              <button
                type="button"
                className="relative flex size-full items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                onClick={() => setPreviewUrl(activeCard.imageUrl ?? null)}
                aria-label={activeCard.title}
                data-image-prompt-card-preview-trigger="true"
              >
                {!imageLoaded ? (
                  <div
                    className="absolute inset-6 animate-pulse rounded-xl bg-slate-100/80 dark:bg-slate-900/80"
                    data-image-prompt-card-skeleton="true"
                    aria-hidden="true"
                  />
                ) : null}
                <img
                  src={activeCard.imageUrl}
                  alt={activeCard.title}
                  className="relative max-h-full max-w-full rounded-xl object-contain"
                  onLoad={(event) => {
                    setImageLoaded(true);
                    setNaturalDimensions({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight
                    });
                  }}
                  onError={() => {
                    setFailedImageKey(activeCardKey);
                    setImageLoaded(false);
                  }}
                  data-image-prompt-card-image="true"
                  data-image-natural-width={naturalDimensions?.width}
                  data-image-natural-height={naturalDimensions?.height}
                />
              </button>
            ) : (
              <div
                className="grid w-full gap-2 px-6 py-8 text-center"
                data-image-prompt-card-text-fallback="true"
              >
                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {activeCard.title}
                </h4>
                <p className="mx-auto line-clamp-5 max-w-xl whitespace-pre-wrap break-words text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {activeCard.prompt}
                </p>
              </div>
            )}

            {cards.length > 1 ? (
              <>
                <button
                  type="button"
                  className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/45 text-white opacity-0 shadow-sm transition-opacity duration-200 hover:bg-slate-950/65 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:inline-flex"
                  onClick={() => selectRelativeCard(-1)}
                  aria-label={previousLabel}
                  data-image-prompt-card-previous="true"
                >
                  <ChevronLeft className="size-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/45 text-white opacity-0 shadow-sm transition-opacity duration-200 hover:bg-slate-950/65 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:inline-flex"
                  onClick={() => selectRelativeCard(1)}
                  aria-label={nextLabel}
                  data-image-prompt-card-next="true"
                >
                  <ChevronRight className="size-5" aria-hidden="true" />
                </button>
              </>
            ) : null}
            <span
              className="absolute bottom-3 right-3 rounded-full bg-slate-950/55 px-2.5 py-1 text-xs font-semibold text-white"
              data-image-prompt-card-index-label="true"
            >
              {safeActiveIndex + 1} / {cards.length}
            </span>
          </div>
        </div>

        <h3
          className="order-3 min-w-0 break-words text-lg font-semibold text-slate-950 dark:text-slate-100 md:col-start-2 md:row-start-2 md:self-start"
          data-image-prompt-card-title="true"
        >
          {activeCard.title}
        </h3>

        <div className="order-4 min-w-0 md:col-start-2 md:row-start-3 md:self-start" data-image-prompt-card-prompt="true">
          <p
            className={`whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 dark:text-slate-300 md:line-clamp-none ${!isPromptExpanded && promptNeedsToggle ? "line-clamp-5" : ""}`}
          >
            {activeCard.prompt}
          </p>
          {promptNeedsToggle ? (
            <button
              type="button"
              className="mt-1 text-sm font-semibold text-indigo-600 hover:text-indigo-700 md:hidden dark:text-indigo-400"
              onClick={() => setIsPromptExpanded((expanded) => !expanded)}
              data-image-prompt-card-prompt-toggle="true"
            >
              {isPromptExpanded ? promptCollapseLabel : promptExpandLabel}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="order-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:col-start-2 md:row-start-4 md:self-start"
          onClick={() => onUsePrompt(activeCard.prompt)}
          data-use-inspiration-prompt="true"
        >
          {usePromptLabel}
        </button>

        <div
          className="order-6 flex min-w-0 gap-2 overflow-x-auto pb-1 md:col-span-2 md:row-start-5"
          data-image-prompt-card-thumbnails="true"
        >
          {cards.map((card, index) => {
            const cardKey = `${index}-${card.title}-${card.imageUrl ?? ""}`;
            const thumbnailHasImage = Boolean(card.imageUrl) && failedImageKey !== cardKey;

            return (
              <button
                key={cardKey}
                type="button"
                className={`grid w-28 shrink-0 gap-1 rounded-xl border p-1.5 text-left transition sm:w-36 ${
                  index === safeActiveIndex
                    ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200 dark:bg-indigo-950/50 dark:ring-indigo-900"
                    : "border-slate-200 bg-white hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900"
                }`}
                onClick={() => selectCard(index)}
                aria-current={index === safeActiveIndex ? "true" : undefined}
                aria-label={card.title}
                data-image-prompt-card-thumbnail="true"
                data-image-prompt-card-thumbnail-selected={
                  index === safeActiveIndex ? "true" : "false"
                }
              >
                <span className="flex h-16 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                  {thumbnailHasImage && card.imageUrl ? (
                    <img
                      src={card.imageUrl}
                      alt=""
                      className="size-full object-contain"
                      onError={() => setFailedImageKey(cardKey)}
                      data-image-prompt-card-thumbnail-image="true"
                    />
                  ) : (
                    <span className="line-clamp-2 px-2 text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {card.title}
                    </span>
                  )}
                </span>
                <span className="truncate px-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {card.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ImagePreviewDialog
        src={previewUrl}
        alt={activeCard.title}
        closeLabel={previewLabels.close}
        zoomInLabel={previewLabels.zoomIn}
        zoomOutLabel={previewLabels.zoomOut}
        fitLabel={previewLabels.fit}
        loadingLabel={previewLabels.loading}
        loadFailedLabel={previewLabels.loadFailed}
        onClose={() => setPreviewUrl(null)}
      />
    </section>
  );
}

export function ImagePageContent({
  initialToken,
  initialCredits = null,
  initialModels = [],
  initialAssets = [],
  initialResult = null,
  initialPrompt = "",
  initialGenerationMode = "text-to-image",
  initialIsLoading = false,
  initialError = null,
  initialErrorPersistent = false,
  initialReferenceImage = null,
  initialSessionId = null,
  historyDetail = false
}: {
  initialToken?: string | null;
  initialCredits?: number | null;
  initialModels?: AiModelSummary[];
  initialAssets?: AiAssetSummary[];
  initialResult?: ImageGenerationResponse | null;
  initialPrompt?: string;
  initialGenerationMode?: ImageGenerationMode;
  initialIsLoading?: boolean;
  initialError?: string | null;
  initialErrorPersistent?: boolean;
  initialReferenceImage?: ImageReferenceInput | null;
  initialSessionId?: string | null;
  historyDetail?: boolean;
}) {
  const { locale, t } = useI18n();
  const publicSettings = usePublicSettings();
  const requestedModelId =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("model")?.trim() ?? "";
  const workspaceShell = useOptionalWorkspaceShellContext();
  const closeMobileDrawer = workspaceShell?.closeMobileDrawer;
  const workspaceUser = workspaceShell?.shell?.user;
  const workspaceAuthHydrated = workspaceShell
    ? workspaceShell.shell.hydrated
    : true;
  const currentAuthToken = workspaceShell
    ? workspaceShell.shell.token
    : initialToken ?? null;
  const currentAuthIdentity = workspaceShell
    ? workspaceUser?.id
      ? `user:${workspaceUser.id}`
      : currentAuthToken
        ? `token:${currentAuthToken}`
        : "guest"
    : initialToken
      ? `standalone:${initialToken}`
      : "guest";
  const currentImageStorageIdentity = workspaceShell
    ? resolveImageLocalStorageIdentity(
        workspaceShell.shell.authStatus,
        currentAuthToken,
        workspaceUser?.id
      )
    : "guest";
  const currentHandoffAccountId = workspaceShell
    ? workspaceUser?.id ?? null
    : undefined;
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const isLoggedInForSidebar = workspaceShell?.shell?.isLoggedIn ?? Boolean(token);
  const authIdentityRef = useRef<string | null>(null);
  const authTokenRef = useRef<string | null>(currentAuthToken);
  authTokenRef.current = currentAuthToken;
  const backendHistoryAccountIdentityRef = useRef(currentAuthIdentity);
  backendHistoryAccountIdentityRef.current = currentAuthIdentity;
  const authHandoffAccountIdRef = useRef<string | null | undefined>(undefined);
  const accountRequestSequenceRef = useRef(0);
  const requestedSessionIdRef = useRef(initialSessionId);
  const [prompt, setPrompt] = useState(initialPrompt);
  const promptRevisionRef = useRef(0);
  const promptValueRef = useRef(initialPrompt);
  const imagePromptMemoryEditRef = useRef<{
    identity: string | null;
    revision: number;
    prompt: string;
  } | null>(null);
  const [referenceImages, setReferenceImages] = useState<SelectedReferenceImage[]>(
    () =>
      initialReferenceImage
        ? [{
            id: "initial-reference",
            image: initialReferenceImage,
            dimensions: null
          }]
        : []
  );
  const referenceImage = referenceImages[0]?.image ?? null;
  const referenceImageLabel = referenceImage?.name ?? "";
  const [referenceImageCompression, setReferenceImageCompression] =
    useState<ReferenceImageCompressionState>({ status: "idle" });
  const referenceSelectionIdRef = useRef(0);
  const initialImageModels = initialModels.filter(
    (model) =>
      model.enabled &&
      isImageCapableModel(model) &&
      normalizeModelDisplaySurfaces(
        model.displaySurfaces,
        model.capability
      ).includes("image")
  );
  const [models, setModels] = useState<AiModelSummary[]>(initialImageModels);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const backendHistoryTokenRef = useRef(token);
  backendHistoryTokenRef.current = token;
  const [credits, setCredits] = useState<number | null>(initialCredits);
  const [creatorWorkflow, setCreatorWorkflow] =
    useState<ImageCreatorWorkflow>("free-create");
  const creatorWorkflowRef = useRef<ImageCreatorWorkflow>("free-create");
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [transcriptScenes, setTranscriptScenes] = useState<TranscriptSceneDraft[]>(
    []
  );
  const [isTranscriptGenerating, setIsTranscriptGenerating] = useState(false);
  const [transcriptActiveSceneId, setTranscriptActiveSceneId] = useState<
    string | null
  >(null);
  const transcriptQueueRunIdRef = useRef(0);
  const [titleCoverDraft, setTitleCoverDraft] = useState<TitleCoverDraft>(() =>
    createDefaultTitleCoverDraft()
  );
  const [titleCoverTypographyDraft, setTitleCoverTypographyDraft] =
    useState<TitleCoverTypographyDraft>(() => defaultTitleCoverTypographyDraft);
  const [titleCoverMainCopyDirty, setTitleCoverMainCopyDirty] = useState(false);
  const [titleCoverReferenceImages, setTitleCoverReferenceImages] =
    useState<SelectedReferenceImage[]>([]);
  const titleCoverReferenceImage = titleCoverReferenceImages[0]?.image ?? null;
  const [titleCoverReferenceImageCompression, setTitleCoverReferenceImageCompression] =
    useState<ReferenceImageCompressionState>({ status: "idle" });
  const titleCoverReferenceSelectionIdRef = useRef(0);
  const [isTitleCoverReferenceDragActive, setIsTitleCoverReferenceDragActive] =
    useState(false);
  const [selectedModelSlug, setSelectedModelSlug] = useState(() => {
    const requestedModel = resolveImageSelectableModel(
      requestedModelId,
      initialImageModels
    );
    return requestedModel?.slug ?? initialImageModels[0]?.slug ?? "";
  });
  const [freeCreateAspectRatio, setFreeCreateAspectRatio] =
    useState<ImageAspectRatio>(
    initialGenerationMode === "image-to-image" ? "auto" : "auto"
    );
  const [titleCoverAspectRatio, setTitleCoverAspectRatio] =
    useState<ImageAspectRatio>("16:9");
  const [freeCreateCount, setFreeCreateCount] = useState<AiGenerationCount>(
    defaultImageGenerationCount
  );
  const [titleCoverCount, setTitleCoverCount] =
    useState<AiGenerationCount>(defaultImageGenerationCount);
  const [isLoading, setIsLoading] = useState(initialIsLoading);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isRatioPickerOpen, setIsRatioPickerOpen] = useState(false);
  const [isCountPickerOpen, setIsCountPickerOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<ImageCreationMode>(
    readImageCreationMode
  );
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
  const [isMobilePromptLayout, setIsMobilePromptLayout] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const ratioPickerRef = useRef<HTMLDivElement | null>(null);
  const quickModelPickerRef = useRef<HTMLDivElement | null>(null);
  const quickRatioPickerRef = useRef<HTMLDivElement | null>(null);
  const countPickerRef = useRef<HTMLDivElement | null>(null);
  const quickCountPickerRef = useRef<HTMLDivElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const titleCoverReferenceInputRef = useRef<HTMLInputElement | null>(null);
  const imageMainScrollRef = useRef<HTMLElement | null>(null);
  const pendingSubmittedEntryScrollRef = useRef<string | null>(null);
  const creatingImageSessionRef = useRef(false);
  const imageGenerationPostInFlightRef = useRef(false);
  const imageGenerationPostLockOwnerRunIdRef = useRef<number | null>(null);
  const imageGenerationRunIdRef = useRef(0);
  const imageGenerationAbortControllerRef = useRef<AbortController | null>(null);
  const activeImageGenerationAttemptRef =
    useRef<ImageGenerationAttempt | null>(null);
  const activeImageGenerationWorkflowRef =
    useRef<ImageCreatorWorkflow>("free-create");
  const [canResumeImageGenerationRequest, setCanResumeImageGenerationRequest] =
    useState(false);
  const retryableImageGenerationSnapshotRef =
    useRef<RetryableImageGenerationSnapshot | null>(null);
  const [
    retryableImageGenerationClientEntryId,
    setRetryableImageGenerationClientEntryId
  ] = useState<string | null>(null);
  const isDiscardDraftOpenRef = useRef(false);
  const [isDiscardImageDraftOpen, setIsDiscardImageDraftOpen] = useState(false);
  const [isImageSidebarCollapsed, setIsImageSidebarCollapsed] = useState(false);
  const imageSidebarCollapsedKey = "ai-aggregate:image-secondary-sidebar-collapsed";
  const isMountedRef = useRef(false);
  const initialPageLoadedAt = useRef(new Date().toISOString());
  const [firstPageLoadedAt, setFirstPageLoadedAt] = useState(
    initialPageLoadedAt.current
  );
  const firstPageLoadedAtRef = useRef(initialPageLoadedAt.current);
  const backendHistoryDismissedRef = useRef(false);
  const [backendHistoryDismissed, setBackendHistoryDismissed] = useState(false);
  const dismissedImageSessionIdsRef = useRef<Set<string>>(new Set());
  const lastBackendHistoryReloadedAtRef = useRef<number | null>(null);
  const [error, setError] = useState<ImagePageError | null>(
    initialError
    ? {
        message: initialError,
        persistent: initialErrorPersistent,
        workflow: "free-create"
      }
      : null
  );
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageAlt, setPreviewImageAlt] = useState("");
  const [selectedResultEntryId, setSelectedResultEntryId] = useState<string | null>(
    null
  );
  const [continuationSourceEntryId, setContinuationSourceEntryId] = useState<
    string | null
  >(null);
  const [pendingContinuationEntryId, setPendingContinuationEntryId] = useState<
    string | null
  >(null);
  const [isPreparingContinuation, setIsPreparingContinuation] = useState(false);
  const [imageCreationHandoffState, setImageCreationHandoffState] =
    useState<ImageCreationHandoffReceiverState>("IDLE");
  const [pendingImageCreationHandoff, setPendingImageCreationHandoff] =
    useState<ImageCreationHandoffV1 | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [pendingPromptReusePrompt, setPendingPromptReusePrompt] = useState<
    string | null
  >(null);
  const continuationRequestIdRef = useRef(0);
  const continuationAbortControllerRef = useRef<AbortController | null>(null);
  const imageCreationHandoffRef = useRef<ImageCreationHandoffV1 | null>(null);
  const imageCreationHandoffInitializedRef = useRef<string | null>(null);
  const [imageCreationHandoffChangeVersion, setImageCreationHandoffChangeVersion] =
    useState(0);
  const imageSessionsStorageScopeRef = useRef(currentImageStorageIdentity);
  const imageSessionsStorageLoadedScopeRef = useRef<string | null>(null);
  const imageSessionsStorageWriteEpochRef = useRef(-1);
  const imagePromptStorageIdentityRef = useRef(currentImageStorageIdentity);
  const imagePromptDraftLoadedIdentityRef = useRef<string | null | undefined>(
    undefined
  );
  const imagePromptDraftReadyRef = useRef(false);
  const imageScrollRestoreKeyRef = useRef<string | null>(null);
  const imageScrollPendingRestoreRef = useRef<ImageScrollPendingRestore | null>(
    null
  );
  const imageScrollRuntimeOwnerRef = useRef<ImageScrollRuntimeOwner | null>(null);
  const imageScrollTopRef = useRef<number | null>(null);
  const [imageSessionsStorageEpoch, setImageSessionsStorageEpoch] = useState(0);
  const [isImageSessionStorageReady, setIsImageSessionStorageReady] =
    useState(false);
  const backendHistoryStorageReadyRef = useRef(isImageSessionStorageReady);
  backendHistoryStorageReadyRef.current = isImageSessionStorageReady;
  const backendHistoryRequestRef = useRef<BackendImageHistoryRequest | null>(
    null
  );
  const backendHistoryTranslatorRef = useRef(t);
  backendHistoryTranslatorRef.current = t;
  const imageSessionStorageRestoredActiveSessionIdRef = useRef<string | null>(
    null
  );
  imageSessionsStorageScopeRef.current = currentImageStorageIdentity;
  imagePromptStorageIdentityRef.current = currentImageStorageIdentity;
  const incomingReferenceAssetIdRef = useRef<string | null>(null);
  const referenceImageRef = useRef(referenceImage);
  referenceImageRef.current = referenceImage;
  const latestResultEntryIdRef = useRef<string | null>(null);
  // Legacy URLs remain readable and retain their established runtime meaning.
  // A separate presentation fence prevents this compatibility state from
  // recreating two visible Creator products.
  const isQuickCreateMode = creationMode === "quick";
  const showLegacyModePresentation = false;
  const showLegacyImageSidebar = false;
  const imageSessionStorageAuthReady = workspaceShell
    ? workspaceAuthHydrated
    : initialToken !== undefined;
  const isTitleCoverWorkflow = creatorWorkflow === "title-cover";
  const isPrecisionEditWorkflow = creatorWorkflow === "precision-edit";
  const isTranscriptImagesWorkflow = creatorWorkflow === "transcript-images";
  creatorWorkflowRef.current = creatorWorkflow;
  const aspectRatio = isTitleCoverWorkflow
    ? titleCoverAspectRatio
    : freeCreateAspectRatio;
  const count = isTitleCoverWorkflow ? titleCoverCount : freeCreateCount;

  function setActiveAspectRatio(nextRatio: ImageAspectRatio) {
    if (isTitleCoverWorkflow) {
      setTitleCoverAspectRatio(nextRatio);
    } else {
      setFreeCreateAspectRatio(nextRatio);
    }
  }

  function setActiveGenerationCount(nextCount: AiGenerationCount) {
    if (isTitleCoverWorkflow) {
      setTitleCoverCount(nextCount);
    } else {
      setFreeCreateCount(nextCount);
    }
  }

  function clearTitleCoverGenerationRecoveryContext() {
    if (retryableImageGenerationSnapshotRef.current?.workflow === "title-cover") {
      clearRetryableImageGenerationSnapshot();
    }

    if (activeImageGenerationWorkflowRef.current === "title-cover") {
      activeImageGenerationAttemptRef.current = null;
      setCanResumeImageGenerationRequest(false);
    }
  }

  function resetTitleCoverWorkflow() {
    const nextTitleCoverCreationId = createImageEntryId();
    clearTitleCoverGenerationRecoveryContext();
    setImageSessions((currentSessions) =>
      currentSessions.map((session) => {
        if (session.id !== activeSessionIdRef.current) {
          return session;
        }

        const currentTitleCoverCreationId =
          session.titleCoverCreationId ??
          getLatestTitleCoverCreationId(session.entries) ??
          createImageEntryId();

        return {
          ...session,
          titleCoverCreationId: nextTitleCoverCreationId,
          entries: session.entries.map((entry) =>
            (entry.workflow ?? "free-create") === "title-cover" &&
            (!entry.workflowContextId ||
              entry.workflowContextId === currentTitleCoverCreationId)
              ? { ...entry, workflowContextId: currentTitleCoverCreationId }
              : entry
          )
        };
      })
    );
    setSelectedResultEntryId(null);
    setTitleCoverDraft(createDefaultTitleCoverDraft());
    setTitleCoverTypographyDraft(defaultTitleCoverTypographyDraft);
    setTitleCoverMainCopyDirty(false);
    titleCoverReferenceSelectionIdRef.current += 1;
    setTitleCoverReferenceImages([]);
    setTitleCoverReferenceImageCompression({ status: "idle" });
    setIsTitleCoverReferenceDragActive(false);
    setTitleCoverAspectRatio("16:9");
    setTitleCoverCount(defaultImageGenerationCount);
  }

  function resetTranscriptWorkflow() {
    transcriptQueueRunIdRef.current += 1;
    setIsTranscriptGenerating(false);
    setTranscriptActiveSceneId(null);
    setTranscriptDraft("");
    setTranscriptScenes([]);
  }

  function updateTitleCoverOriginalTitle(value: string) {
    setTitleCoverDraft((current) => ({
      ...current,
      originalTitle: value,
      mainCopy: titleCoverMainCopyDirty ? current.mainCopy : value
    }));
  }

  function updateTitleCoverMainCopy(value: string) {
    setTitleCoverMainCopyDirty(true);
    setTitleCoverDraft((current) => ({ ...current, mainCopy: value }));
  }

  function updateTitleCoverSecondaryCopy(value: string) {
    setTitleCoverDraft((current) => ({ ...current, secondaryCopy: value }));
  }

  function updateTitleCoverStyle(value: TitleCoverStyle) {
    setTitleCoverDraft((current) => ({ ...current, style: value }));
  }

  function updateTitleCoverTypographyPreset(value: TitleCoverTypographyPreset) {
    setTitleCoverTypographyDraft(createTitleCoverTypographyDraft(value));
  }

  function updateTitleCoverTypographyColor(
    key: "mainColor" | "secondaryColor",
    value: string
  ) {
    setTitleCoverTypographyDraft((current) => ({
      ...current,
      [key]: value
    }));
  }

  useEffect(() => {
    const onHandoffChange = () => {
      setImageCreationHandoffChangeVersion((current) => current + 1);
    };

    window.addEventListener(imageCreationHandoffChangeEvent, onHandoffChange);
    return () =>
      window.removeEventListener(imageCreationHandoffChangeEvent, onHandoffChange);
  }, []);

  useEffect(() => {
    function syncCreationModeFromUrl() {
      setCreationMode(readImageCreationMode());
    }

    window.addEventListener("popstate", syncCreationModeFromUrl);
    return () => window.removeEventListener("popstate", syncCreationModeFromUrl);
  }, []);

  function selectCreationMode(nextMode: ImageCreationMode) {
    setCreationMode(nextMode);

    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", nextMode);
    window.history.pushState({}, "", nextUrl);
  }

  function isGenerationFeedbackVisibleFor(workflow: ImageCreatorWorkflow) {
    return creatorWorkflowRef.current === workflow;
  }

  function showError(
    message: string,
    options?: { persistent?: boolean },
    workflow = creatorWorkflowRef.current
  ) {
    if (!isGenerationFeedbackVisibleFor(workflow)) {
      return;
    }

    setError({
      message,
      persistent: options?.persistent ?? false,
      workflow
    });
  }

  function clearError(workflow = creatorWorkflowRef.current) {
    if (!isGenerationFeedbackVisibleFor(workflow)) {
      return;
    }

    setError((current) =>
      current?.workflow === workflow ? null : current
    );
  }

  function checkingSyncMessage() {
    return locale === "zh-CN"
      ? "请求已提交，正在同步任务结果..."
      : "Request submitted. Syncing task result...";
  }

  function checkingTimeoutMessage() {
    return locale === "zh-CN"
      ? "任务可能仍在生成，请到任务页查看"
      : "The task may still be running. Check the Tasks page.";
  }

  function markBackendHistoryDismissed() {
    backendHistoryDismissedRef.current = true;
    setBackendHistoryDismissed(true);
  }

  function persistDismissedImageSessionIds(nextIds: Set<string>) {
    dismissedImageSessionIdsRef.current = nextIds;
    const storageScope = imageSessionsStorageScopeRef.current;
    if (!storageScope) {
      return;
    }

    try {
      window.localStorage.setItem(
        getDismissedImageSessionsStorageKey(storageScope),
        serializeDismissedImageSessionIds(nextIds)
      );
    } catch {
      // Browser storage can be unavailable; deletion remains local in memory.
    }
  }

  function markImageSessionDismissed(sessionId: string) {
    if (isBackendImageHistorySessionId(sessionId)) {
      markBackendHistoryDismissed();
      return;
    }

    const nextIds = new Set(dismissedImageSessionIdsRef.current);
    nextIds.add(sessionId);
    persistDismissedImageSessionIds(nextIds);
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      imageGenerationRunIdRef.current += 1;
      imageGenerationAbortControllerRef.current?.abort();
      imageGenerationAbortControllerRef.current = null;
      continuationRequestIdRef.current += 1;
      continuationAbortControllerRef.current?.abort();
      continuationAbortControllerRef.current = null;
      backendHistoryRequestRef.current?.controller.abort();
      backendHistoryRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(imageSidebarCollapsedKey);
    if (stored) {
      setIsImageSidebarCollapsed(stored === "true");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(imageSidebarCollapsedKey, String(isImageSidebarCollapsed));
  }, [isImageSidebarCollapsed]);

  useEffect(() => {
    if (!error || error.persistent) {
      return;
    }

    const timer = window.setTimeout(() => {
      setError(null);
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!previewImageUrl) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewImageUrl(null);
        setPreviewImageAlt("");
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [previewImageUrl]);

  useEffect(() => {
    if (!workspaceAuthHydrated) {
      return;
    }

    const previousAuthIdentity = authIdentityRef.current;
    const previousHandoffAccountId = authHandoffAccountIdRef.current;
    authIdentityRef.current = currentAuthIdentity;
    authHandoffAccountIdRef.current = currentHandoffAccountId;
    setToken(currentAuthToken);

    if (
      previousAuthIdentity === null ||
      previousAuthIdentity === currentAuthIdentity
    ) {
      return;
    }

    accountRequestSequenceRef.current += 1;
    backendHistoryRequestRef.current?.controller.abort();
    backendHistoryRequestRef.current = null;
    if (previousHandoffAccountId !== undefined) {
      clearImageCreationHandoff(previousHandoffAccountId);
    }
    setCredits(null);
    stopImageGenerationRun();
    resetTranscriptWorkflow();
    cancelContinuationPreparation();
    clearIncomingImageCreationHandoff();
    setPendingImageCreationHandoff(null);
    imageCreationHandoffInitializedRef.current = null;
    setImageCreationHandoffState("IDLE");
    setReferenceImages([]);
    setReferenceImageCompression({ status: "idle" });
    const unresolvedTokenHydratingToUser =
      previousAuthIdentity?.startsWith("token:") === true &&
      currentAuthIdentity.startsWith("user:") &&
      currentImageStorageIdentity !== null;
    if (!unresolvedTokenHydratingToUser) {
      updatePrompt("", { persist: false });
      resetTitleCoverWorkflow();
    }
    setFreeCreateCount(defaultImageGenerationCount);
    setFreeCreateAspectRatio("auto");
    setSelectedResultEntryId(null);
    setContinuationSourceEntryId(null);
    setPendingContinuationEntryId(null);
    clearRetryableImageGenerationSnapshot();
    setIsDiscardImageDraftOpen(false);
    isDiscardDraftOpenRef.current = false;
    setError(null);

    const nextSession: ImageSession = {
      id: createImageSessionId(),
      title: t("multimodal.image.newDrawing"),
      entries: [],
      titleCoverCreationId: createImageEntryId()
    };
    setImageSessions([nextSession]);
    setActiveSessionId(nextSession.id);
    const nextPageLoadedAt = new Date().toISOString();
    setFirstPageLoadedAt(nextPageLoadedAt);
    firstPageLoadedAtRef.current = nextPageLoadedAt;
    backendHistoryDismissedRef.current = false;
    setBackendHistoryDismissed(false);
    dismissedImageSessionIdsRef.current = new Set();
    lastBackendHistoryReloadedAtRef.current = null;
    imageSessionsStorageLoadedScopeRef.current = null;
    imageSessionsStorageWriteEpochRef.current = -1;
    imageSessionStorageRestoredActiveSessionIdRef.current = null;
    setIsImageSessionStorageReady(false);
  }, [
    currentAuthIdentity,
    currentAuthToken,
    workspaceAuthHydrated
  ]);

  useEffect(() => {
    if (!workspaceAuthHydrated) {
      return;
    }

    const controller = new AbortController();
    const storedToken = currentAuthToken;
    const requestIdentity = currentAuthIdentity;
    const requestSequence = accountRequestSequenceRef.current;

    function isCurrentBootstrap() {
      return (
        !controller.signal.aborted &&
        isMountedRef.current &&
        accountRequestSequenceRef.current === requestSequence &&
        authIdentityRef.current === requestIdentity &&
        authTokenRef.current === storedToken
      );
    }

    if (!isCurrentBootstrap()) {
      return () => controller.abort();
    }

    setToken(storedToken);

    async function load() {
      try {
        const headers = storedToken
          ? { Authorization: `Bearer ${storedToken}` }
          : undefined;
        const [modelsRes, quotaRes] = await Promise.all([
          fetch(apiUrl("/models?surface=image"), {
            signal: controller.signal
          }),
          storedToken
            ? fetch(apiUrl("/quota/me"), {
                headers,
                signal: controller.signal
              })
            : Promise.resolve(null)
        ]);

        if (modelsRes.ok) {
          const data = (await modelsRes.json()) as { models: AiModelSummary[] };
          const imageModels = data.models.filter(
            (model) =>
              model.enabled &&
              isImageCapableModel(model) &&
              normalizeModelDisplaySurfaces(
                model.displaySurfaces,
                model.capability
              ).includes("image")
          );
          if (!isCurrentBootstrap()) {
            return;
          }
          setModels(imageModels);
          setSelectedModelSlug((current) => {
            const currentModel = resolveImageSelectableModel(current, imageModels);
            if (currentModel) {
              return currentModel.slug;
            }

            const requestedModel = resolveImageSelectableModel(
              requestedModelId,
              imageModels
            );
            if (requestedModel) {
              return requestedModel.slug;
            }

            return imageModels[0]?.slug || "";
          });
        }

        if (!isCurrentBootstrap()) {
          return;
        }
        setModelsLoaded(true);

        if (quotaRes?.ok) {
          const data = (await quotaRes.json()) as { remainingCredits: number };
          if (!isCurrentBootstrap()) {
            return;
          }
          setCredits(data.remainingCredits);
        }
      } catch (loadError) {
        if (isAbortError(loadError) || !isCurrentBootstrap()) {
          return;
        }
        setModelsLoaded(true);
        showError(t("multimodal.error.loadFailed"));
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [
    currentAuthIdentity,
    currentAuthToken,
    requestedModelId,
    t,
    workspaceAuthHydrated
  ]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");

    function updateMobilePromptLayout() {
      setIsMobilePromptLayout(mediaQuery.matches);
    }

    updateMobilePromptLayout();
    mediaQuery.addEventListener("change", updateMobilePromptLayout);

    return () => mediaQuery.removeEventListener("change", updateMobilePromptLayout);
  }, []);

  useEffect(() => {
    let rawHandoff: string | null = null;

    try {
      rawHandoff = window.sessionStorage.getItem(imageModelHandoffStorageKey);
    } catch {
      return;
    }

    if (!rawHandoff) {
      return;
    }

    const handoffModelId = parseImageModelHandoff(rawHandoff);

    // Invalid or expired handoff — clean up and stop.
    if (!handoffModelId) {
      try {
        window.sessionStorage.removeItem(imageModelHandoffStorageKey);
      } catch {
        // Browser storage can be unavailable.
      }
      return;
    }

    // Valid handoff — wait for models to load before attempting a match.
    if (models.length === 0) {
      return;
    }

    const matchingModel = resolveImageSelectableModel(handoffModelId, models);

    if (matchingModel) {
      // Match found — consume the handoff and update the selection.
      setSelectedModelSlug(matchingModel.slug);
      try {
        window.sessionStorage.removeItem(imageModelHandoffStorageKey);
      } catch {
        // Browser storage can be unavailable; the in-memory selection
        // remains valid.
      }
      return;
    }

    // Models are loaded but the target model is not an image-capable
    // model in the current list.  Clean up without switching.
    try {
      window.sessionStorage.removeItem(imageModelHandoffStorageKey);
    } catch {
      // Browser storage can be unavailable.
    }
  }, [models, modelsLoaded]);

  useEffect(() => {
    const authContextReady =
      workspaceShell ? workspaceAuthHydrated : initialToken !== undefined;
    if (
      !authContextReady ||
      token !== currentAuthToken ||
      !isImageSessionStorageReady
    ) {
      return;
    }

    let rawHandoff: string | null = null;
    try {
      rawHandoff = window.sessionStorage.getItem(
        getImageCreationHandoffStorageKey()
      );
    } catch {
      return;
    }

    const handoff = readImageCreationHandoff();

    if (!rawHandoff) {
      imageCreationHandoffInitializedRef.current = null;
      return;
    }

    const descriptorKey = handoff
      ? `${handoff.assetId}:${handoff.issuedAt}`
      : `invalid:${rawHandoff}`;
    if (imageCreationHandoffInitializedRef.current === descriptorKey) {
      return;
    }
    imageCreationHandoffInitializedRef.current = descriptorKey;

    if (!handoff) {
      clearIncomingImageCreationHandoff();
      setImageCreationHandoffState("TERMINAL_FAILURE");
      showError(t("multimodal.image.referencePreparationFailed"), {
        persistent: true
      });
      return;
    }

    imageCreationHandoffRef.current = handoff;
    if (!token) {
      clearIncomingImageCreationHandoff();
      setImageCreationHandoffState("TERMINAL_FAILURE");
      showError(t("multimodal.image.referencePreparationFailed"), {
        persistent: true
      });
      return;
    }

    if (referenceImageRef.current) {
      setPendingImageCreationHandoff(handoff);
      setImageCreationHandoffState("CONFLICT");
      return;
    }

    void prepareImageCreationHandoff(handoff);
  }, [
    currentAuthToken,
    imageCreationHandoffChangeVersion,
    initialToken,
    t,
    token,
    isImageSessionStorageReady,
    workspaceAuthHydrated,
    workspaceShell
  ]);

  const selectedModel = useMemo(
    () => models.find((model) => model.slug === selectedModelSlug) ?? null,
    [models, selectedModelSlug]
  );
  const selectedModelMaxReferenceImages = resolveModelMaxReferenceImages(
    selectedModel?.maxReferenceImages
  );
  const activeReferenceImages = isTitleCoverWorkflow
    ? titleCoverReferenceImages
    : isPrecisionEditWorkflow
      ? referenceImages.slice(0, 1)
      : referenceImages;
  const activeReferenceLimit = isPrecisionEditWorkflow
    ? Math.min(1, selectedModelMaxReferenceImages)
    : isTranscriptImagesWorkflow
      ? 0
      : selectedModelMaxReferenceImages;
  const isReferenceLimitExceeded =
    activeReferenceImages.length > activeReferenceLimit;
  const isReferenceCapacityFull =
    !isPrecisionEditWorkflow &&
    activeReferenceLimit > 0 &&
    activeReferenceImages.length >= activeReferenceLimit;
  const fallbackQuickInspirationCards = useMemo<WorkspacePromptCard[]>(
    () =>
      imageInspirationPresets.map((card) => ({
        title: t(card.titleKey),
        description: t(card.promptKey),
        prompt: t(card.promptKey)
      })),
    [t]
  );
  const quickInspirationCards = useMemo(
    () =>
      parseImagePromptCards(
        publicSettings?.imagePromptCards,
        fallbackQuickInspirationCards
      ),
    [fallbackQuickInspirationCards, publicSettings?.imagePromptCards]
  );
  const visibleQuickInspirationCards = quickInspirationCards.slice(0, 3);
  const imageModelMap = useMemo(() => {
    const map = new Map<string, AiModelSummary>();
    const legacyMatches = new Map<string, AiModelSummary[]>();
    models.forEach((model) => {
      const matches = legacyMatches.get(model.modelId) ?? [];
      matches.push(model);
      legacyMatches.set(model.modelId, matches);
    });
    legacyMatches.forEach((matches, modelId) => {
      if (matches.length === 1 && matches[0]) {
        map.set(modelId, matches[0]);
      }
    });
    models.forEach((model) => map.set(model.slug, model));
    return map;
  }, [models]);
  const imageModelMapRef = useRef(imageModelMap);
  imageModelMapRef.current = imageModelMap;

  const resolveImageEntryModelIdentity = useCallback(
    (entry: ImageStreamEntry) => {
      const fallbackLabel = t("chat.aiAssistant");
      if (entry.modelId) {
        const canonicalModel = resolveImageSelectableModel(entry.modelId, models);
        if (canonicalModel) {
          return resolveModelIdentity(canonicalModel.slug, models, fallbackLabel);
        }
        if (models.some((model) => model.modelId === entry.modelId)) {
          return resolveModelIdentity(undefined, models, fallbackLabel);
        }
        const result = resolveModelIdentity(entry.modelId, models, fallbackLabel);
        if (result.model) return result;
      }
      if (entry.modelName) {
        return resolveModelIdentity(entry.modelName, models, fallbackLabel);
      }
      return resolveModelIdentity(undefined, models, fallbackLabel);
    },
    [models, t]
  );
  const generationMode: ImageGenerationMode =
    isTranscriptImagesWorkflow
      ? "text-to-image"
      : activeReferenceImages.length > 0
      ? "image-to-image"
      : "text-to-image";
  const showQuickMobileComposer =
    showLegacyModePresentation && isMobilePromptLayout && isQuickCreateMode;
  const size = resolveImageGenerationSize(
    aspectRatio,
    generationMode,
    isTranscriptImagesWorkflow
      ? null
      : isTitleCoverWorkflow
      ? titleCoverReferenceImages[0]?.dimensions ?? null
      : referenceImages[0]?.dimensions ?? null,
    isTitleCoverWorkflow || isTranscriptImagesWorkflow ? "" : prompt
  );
  const generationCount: AiGenerationCount = count;
  const estimatedCost = (selectedModel?.creditCost ?? 0) * generationCount;
  const hasInsufficientCredits =
    selectedModel !== null && credits !== null && estimatedCost > credits;
  const insufficientCredits = t("multimodal.error.insufficientCredits", {
    cost: estimatedCost,
    credits: credits ?? 0
  });
  const initialImageStream = useMemo<ImageStreamEntry[]>(() => {
    const initialModel = initialImageModels[0] ?? null;
    const initialModelName = initialModel
      ? getModelDisplayName(initialModel)
      : initialResult?.task.modelId || "";
    const initialStreamPrompt = initialResult?.task.prompt || initialPrompt.trim();

    if (initialResult) {
      const initialAcceptedAssetCount = readAcceptedImageResultAssets(
        initialResult.assets,
        initialResult.task.id
      ).length;
      const initialDisplayableAssetCount =
        readQuickImageResultAssets(initialResult).length;
      const initialResultHasAssets = initialDisplayableAssetCount > 0;
      const initialRequestedCount = readImageGenerationCount(
        initialResult.task.input.count
      );
      return [
        {
          id: initialResult.task.id,
          workflow: readTaskImageWorkflow(initialResult.task),
          prompt: initialResult.task.prompt,
          modelName: initialModelName,
          modelId: initialModel ? initialModel.slug : null,
          aspectRatio,
          mode: initialGenerationMode,
          referenceImages: initialReferenceImage
            ? [{
                dataUrl: initialReferenceImage.dataUrl,
                name:
                  initialReferenceImage.name ||
                  t("multimodal.image.referenceLabel")
              }]
            : undefined,
          referenceImage: initialReferenceImage
            ? {
                dataUrl: initialReferenceImage.dataUrl,
                name:
                  initialReferenceImage.name ||
                  t("multimodal.image.referenceLabel")
              }
            : null,
          referenceImagesMetadata: initialReferenceImage
            ? undefined
            : readTaskReferencesMetadata(initialResult.task),
          referenceImageMetadata: initialReferenceImage
            ? null
            : readTaskReferencesMetadata(initialResult.task)[0] ?? null,
          requestedCount: initialRequestedCount,
          assetCountContractViolation:
            initialAcceptedAssetCount > initialRequestedCount,
          status: initialResultHasAssets ? "succeeded" : "failed",
          result: initialResultHasAssets ? initialResult : null,
          error: initialResultHasAssets
            ? null
            : t("multimodal.error.generateFailed")
        }
      ];
    }

    if (initialIsLoading && initialStreamPrompt) {
      return [
        {
          id: "initial-loading",
          prompt: initialStreamPrompt,
          modelName: initialModelName,
          aspectRatio,
          mode: initialGenerationMode,
          referenceImage: initialReferenceImage
            ? {
                dataUrl: initialReferenceImage.dataUrl,
                name:
                  initialReferenceImage.name ||
                  t("multimodal.image.referenceLabel")
              }
            : null,
          status: "loading",
          result: null,
          error: null
        }
      ];
    }

    if (initialError && initialStreamPrompt) {
      return [
        {
          id: "initial-error",
          prompt: initialStreamPrompt,
          modelName: initialModelName,
          aspectRatio,
          mode: initialGenerationMode,
          referenceImage: initialReferenceImage
            ? {
                dataUrl: initialReferenceImage.dataUrl,
                name:
                  initialReferenceImage.name ||
                  t("multimodal.image.referenceLabel")
              }
            : null,
          status: "failed",
          result: null,
          error: initialError
        }
      ];
    }

    return [];
  }, [
    aspectRatio,
    initialError,
    initialGenerationMode,
    initialImageModels,
    initialIsLoading,
    initialPrompt,
    initialReferenceImage,
    initialResult,
    t
  ]);
  const [imageSessions, setImageSessions] = useState<ImageSession[]>(() => {
    const initialSessionId = createImageSessionId();
    return [
      {
        id: initialSessionId,
        title:
          initialImageStream[0]?.prompt ||
          initialPrompt.trim() ||
          t("multimodal.image.newDrawing"),
        entries: initialImageStream,
        titleCoverCreationId: createImageEntryId()
      }
    ];
  });
  const [activeSessionId, setActiveSessionId] = useState(
    () => imageSessions[0]?.id ?? createImageSessionId()
  );
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const activeSessionContinuationGuardInitializedRef = useRef(false);
  const activeSession =
    imageSessions.find((session) => session.id === activeSessionId) ??
    imageSessions[0];
  const imageStream = activeSession?.entries ?? [];
  const displayImageStream = useMemo(
    () =>
      imageStream.map((entry) =>
        resolveImageEntryDisplayState(entry, {
          allowHistoricalFallback: isQuickCreateMode
        })
      ),
    [imageStream, isQuickCreateMode]
  );
  const effectiveTitleCoverDisplayContextId = useMemo(() => {
    const currentContextId = activeSession?.titleCoverCreationId ?? null;

    if (
      !historyDetail ||
      !requestedSessionIdRef.current ||
      activeSession?.id !== requestedSessionIdRef.current
    ) {
      return currentContextId;
    }

    for (const entry of [...(activeSession?.entries ?? [])].reverse()) {
      if (
        entry.workflow === "title-cover" &&
        entry.workflowContextId &&
        isSuccessfulImageBatchEntry(entry)
      ) {
        return entry.workflowContextId;
      }
    }

    return currentContextId;
  }, [
    activeSession?.entries,
    activeSession?.id,
    activeSession?.titleCoverCreationId,
    historyDetail
  ]);
  const workflowDisplayImageStream = useMemo(
    () =>
      displayImageStream.filter(
        (entry) => {
          if ((entry.workflow ?? "free-create") !== creatorWorkflow) {
            return false;
          }

          if (
            creatorWorkflow !== "title-cover" ||
            !effectiveTitleCoverDisplayContextId
          ) {
            return true;
          }

          return (
            !entry.workflowContextId ||
            entry.workflowContextId === effectiveTitleCoverDisplayContextId
          );
        }
      ),
    [
      creatorWorkflow,
      displayImageStream,
      effectiveTitleCoverDisplayContextId
    ]
  );
  const imageResultBatches = useMemo(
    () => deriveImageResultBatches(workflowDisplayImageStream),
    [workflowDisplayImageStream]
  );
  const imageResultVersions = useMemo(
    () => imageResultBatches.flatMap((batch) => batch.assets),
    [imageResultBatches]
  );
  const transcriptSceneViews = useMemo<TranscriptSceneView[]>(() => {
    return transcriptScenes.map((scene) => {
      const entry = scene.entryId
        ? displayImageStream.find(
            (candidate) => candidate.clientEntryId === scene.entryId
          ) ?? null
        : null;
      const resultVersion = entry
        ? imageResultVersions.find(
            (version) => version.entry.clientEntryId === entry.clientEntryId
          ) ?? null
        : null;
      let status: TranscriptSceneStatus = "draft";

      if (entry?.status === "loading") {
        status = "generating";
      } else if (entry?.status === "checking") {
        status = "checking";
      } else if (entry?.status === "succeeded") {
        status = "succeeded";
      } else if (entry?.status === "failed") {
        status = "failed";
      } else if (transcriptActiveSceneId === scene.id) {
        status = "generating";
      } else if (isTranscriptGenerating && scene.selected) {
        status = "queued";
      }

      return {
        ...scene,
        status,
        resultUrl: resultVersion?.asset.url ?? null,
        resultAssetId: resultVersion?.asset.id ?? null,
        error: entry?.error ?? null
      };
    });
  }, [
    displayImageStream,
    imageResultVersions,
    isTranscriptGenerating,
    transcriptActiveSceneId,
    transcriptScenes
  ]);
  const imageResultVersionsRef = useRef(imageResultVersions);
  imageResultVersionsRef.current = imageResultVersions;
  const latestImageResultBatch =
    imageResultBatches[imageResultBatches.length - 1] ?? null;
  const latestImageResultVersion = latestImageResultBatch?.assets[0] ?? null;
  const selectedImageResultVersion = resolveSelectedImageResultVersion(
    imageResultVersions,
    selectedResultEntryId
  );
  const selectedImageResultBatch = resolveImageResultBatch(
    imageResultBatches,
    selectedImageResultVersion
  );
  const visibleImageResultBatches = imageResultBatches.slice(-5);
  const continuationSourceVersion = continuationSourceEntryId
    ? imageResultVersions.find(
        (version) => version.resultEntryId === continuationSourceEntryId
      ) ?? null
    : null;

  useEffect(() => {
    const latestId = latestImageResultVersion?.resultEntryId ?? null;
    const latestChanged = latestResultEntryIdRef.current !== latestId;

    setSelectedResultEntryId((currentId) => {
      if (!latestId) {
        return null;
      }

      if (
        latestChanged ||
        !currentId ||
        !imageResultVersions.some(
          (version) =>
            version.resultEntryId === currentId || version.entry.id === currentId
        )
      ) {
        return latestId;
      }

      return currentId;
    });
    latestResultEntryIdRef.current = latestId;
  }, [activeSessionId, imageResultVersions, latestImageResultVersion]);

  useEffect(() => {
    if (!activeSessionContinuationGuardInitializedRef.current) {
      activeSessionContinuationGuardInitializedRef.current = true;
      return;
    }
    if (
      imageSessionStorageRestoredActiveSessionIdRef.current === activeSessionId
    ) {
      imageSessionStorageRestoredActiveSessionIdRef.current = null;
      return;
    }
    cancelContinuationPreparation();
    setPendingContinuationEntryId(null);
    setContinuationSourceEntryId(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!continuationSourceEntryId) {
      return;
    }

    const focusPrompt = () => {
      promptInputRef.current?.focus();
      promptInputRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center"
      });
    };
    const focusFrame =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(focusPrompt)
        : window.setTimeout(focusPrompt, 0);

    return () => {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(focusFrame);
      } else {
        window.clearTimeout(focusFrame);
      }
    };
  }, [continuationSourceEntryId]);

  useEffect(() => {
    if (!imageSessionStorageAuthReady) {
      return;
    }

    const storageScope = imageSessionsStorageScopeRef.current;
    imageSessionsStorageLoadedScopeRef.current = null;
    const nextStorageEpoch = imageSessionsStorageEpoch + 1;
    imageSessionsStorageWriteEpochRef.current = nextStorageEpoch;
    setImageSessionsStorageEpoch(nextStorageEpoch);

    dismissedImageSessionIdsRef.current = new Set();
    backendHistoryDismissedRef.current = false;
    setBackendHistoryDismissed(false);

    if (storageScope) {
      try {
        const dismissedIds = parseDismissedImageSessionIds(
          window.localStorage.getItem(
            getDismissedImageSessionsStorageKey(storageScope)
          )
        );
        dismissedImageSessionIdsRef.current = dismissedIds;
      } catch {
        // Browser storage can be unavailable; default to no dismissed sessions.
      }

      try {
        const stored = parseStoredImageSessions(
          window.sessionStorage.getItem(getImageSessionsStorageKey(storageScope))
        );

        if (stored) {
          const normalizedSessions = normalizeImageSessionsForDisplay(
            stored.sessions,
            t("multimodal.image.backendHistory")
          );
          const requestedSessionId = requestedSessionIdRef.current;
          const restoredActiveSessionId =
            requestedSessionId &&
            normalizedSessions.some((session) => session.id === requestedSessionId)
              ? requestedSessionId
              : stored.activeSessionId &&
                  normalizedSessions.some((s) => s.id === stored.activeSessionId)
                ? stored.activeSessionId
                : selectActiveImageSessionId(normalizedSessions, null);
          imageSessionStorageRestoredActiveSessionIdRef.current =
            restoredActiveSessionId !== activeSessionIdRef.current
              ? restoredActiveSessionId
              : null;
          setImageSessions(normalizedSessions);
          setActiveSessionId(restoredActiveSessionId);
          setFirstPageLoadedAt(stored.firstPageLoadedAt);
          firstPageLoadedAtRef.current = stored.firstPageLoadedAt;
          backendHistoryDismissedRef.current = stored.backendHistoryDismissed;
          setBackendHistoryDismissed(stored.backendHistoryDismissed);
        }
      } catch {
        // Browser storage can be unavailable; default to the in-memory session.
      }
    }

    try {
      // The pre-fix key is cleanup-only. Never read it into an account draft.
      window.sessionStorage.removeItem(imageSessionsStorageKey);
    } catch {
      // Browser storage can be unavailable.
    }
    try {
      window.localStorage.removeItem(dismissedImageSessionsStorageKey);
    } catch {
      // Browser storage can be unavailable.
    } finally {
      imageSessionsStorageLoadedScopeRef.current = storageScope;
      setIsImageSessionStorageReady(true);
    }
  }, [
    currentAuthIdentity,
    imageSessionStorageAuthReady
  ]);

  useEffect(() => {
    if (!historyDetail || !requestedSessionIdRef.current) {
      return;
    }

    const restoredSession = imageSessions.find(
      (session) => session.id === requestedSessionIdRef.current
    );
    if (!restoredSession) {
      return;
    }

    const latestEntry = [...restoredSession.entries]
      .reverse()
      .find((entry) => entry.status !== "loading");
    const nextWorkflow = readImageCreatorWorkflow(latestEntry?.workflow);

    if (creatorWorkflowRef.current === nextWorkflow) {
      return;
    }

    creatorWorkflowRef.current = nextWorkflow;
    setCreatorWorkflow(nextWorkflow);
  }, [historyDetail, imageSessions]);

  useEffect(() => {
    if (!imageSessionStorageAuthReady) {
      return;
    }

    const identity = currentImageStorageIdentity;
    imagePromptDraftReadyRef.current = false;
    imagePromptDraftLoadedIdentityRef.current = undefined;
    const restoredDraft = readImagePromptDraft(identity);
    const memoryEdit = imagePromptMemoryEditRef.current;
    const hasCurrentMemoryEdit = Boolean(
      memoryEdit &&
        memoryEdit.revision === promptRevisionRef.current &&
        memoryEdit.prompt === promptValueRef.current &&
        (memoryEdit.identity === null || memoryEdit.identity === identity)
    );

    if (hasCurrentMemoryEdit && identity) {
      // A real edit made while auth was unresolved owns the newly resolved
      // account, even when that account already has an older persisted draft.
      writeImagePromptDraft(identity, promptValueRef.current);
    } else if (
      !hasCurrentMemoryEdit &&
      restoredDraft &&
      promptValueRef.current.trim().length === 0
    ) {
      promptRevisionRef.current += 1;
      promptValueRef.current = restoredDraft;
      setPrompt(restoredDraft);
    } else if (
      !hasCurrentMemoryEdit &&
      !restoredDraft &&
      promptRevisionRef.current > 0 &&
      promptValueRef.current.length > 0
    ) {
      // A user can type before auth hydration completes. Once the owned
      // identity is known, persist that in-memory edit under only that key.
      writeImagePromptDraft(identity, promptValueRef.current);
    }

    if (identity) {
      imagePromptMemoryEditRef.current = null;
    }
    imagePromptDraftLoadedIdentityRef.current = identity;
    imagePromptDraftReadyRef.current = true;
  }, [currentImageStorageIdentity, imageSessionStorageAuthReady]);

  useEffect(() => {
    if (
      !isImageSessionStorageReady ||
      !imageSessionsStorageScopeRef.current ||
      imageSessionsStorageLoadedScopeRef.current !==
        imageSessionsStorageScopeRef.current ||
      imageSessionsStorageWriteEpochRef.current !== imageSessionsStorageEpoch
    ) {
      return;
    }

    try {
      window.sessionStorage.setItem(
        getImageSessionsStorageKey(imageSessionsStorageScopeRef.current),
        serializeImageSessionsForStorage(
          imageSessions,
          activeSessionId,
          maxStoredImageStreamEntries,
          { firstPageLoadedAt, backendHistoryDismissed }
        )
      );
    } catch {
      // Quota or private-mode failures should not break image generation.
    }
  }, [
    activeSessionId,
    backendHistoryDismissed,
    firstPageLoadedAt,
    imageSessions,
    imageSessionsStorageEpoch,
    isImageSessionStorageReady
  ]);

  function getImageScrollRuntimeOwner(): ImageScrollRuntimeOwner | null {
    const identity = imageSessionsStorageScopeRef.current?.trim() || null;
    const sessionId = activeSessionIdRef.current?.trim() || null;
    const key = getImageScrollStorageKey(identity, sessionId);
    if (!identity || !key) {
      return null;
    }

    return { identity, sessionId, key, top: 0 };
  }

  function updateImageMainScrollRuntime(top: number) {
    if (!Number.isFinite(top) || top < 0) {
      return;
    }

    const owner = getImageScrollRuntimeOwner();
    if (!owner) {
      return;
    }

    owner.top = top;
    imageScrollTopRef.current = top;
    imageScrollRuntimeOwnerRef.current = owner;
  }

  function flushImageScrollRuntimeOwner(
    owner = imageScrollRuntimeOwnerRef.current
  ) {
    if (!owner) {
      return;
    }

    writeImageScrollTop(owner.identity, owner.sessionId, owner.top);
    if (imageScrollRuntimeOwnerRef.current?.key === owner.key) {
      imageScrollRuntimeOwnerRef.current = null;
      imageScrollTopRef.current = null;
    }
  }

  function handleImageMainScroll(event: React.UIEvent<HTMLElement>) {
    updateImageMainScrollRuntime(event.currentTarget.scrollTop);
    attemptImageScrollRestore();
  }

  function cancelImageScrollPendingRestore() {
    const pending = imageScrollPendingRestoreRef.current;
    if (!pending) {
      return;
    }

    imageScrollPendingRestoreRef.current = null;
    imageScrollRestoreKeyRef.current = pending.key;
  }

  function completeImageScrollRestore(
    pending: ImageScrollPendingRestore,
    top: number
  ) {
    if (imageScrollPendingRestoreRef.current?.key !== pending.key) {
      return;
    }

    imageScrollPendingRestoreRef.current = null;
    imageScrollRestoreKeyRef.current = pending.key;
    updateImageMainScrollRuntime(top);
    imageMainScrollRef.current?.scrollTo({ top, behavior: "auto" });
  }

  function hasReliableImageScrollFinalContent(
    scrollContainer: HTMLElement
  ): boolean {
    // A private logical asset does not render an <img> until its Blob URL has
    // resolved. The only authoritative finality contract is the slots the
    // current Creator projection actually renders: hero, selected-batch
    // alternatives, and one representative per version. Historical assets
    // that are not rendered must not keep route restoration pending, while a
    // rendered-but-unresolved hero must still block final clamping.
    const resultSlots = Array.from(
      scrollContainer.querySelectorAll<HTMLElement>(
        [
          '[data-image-workbench-result-image="true"]',
          '[data-image-workbench-result-entry]',
          '[data-image-workbench-version]',
          '[data-image-result-card]'
        ].join(",")
      )
    );

    return resultSlots.every((slot) => {
      const image = slot.querySelector<HTMLImageElement>("img");
      return Boolean(image?.complete);
    });
  }

  function attemptImageScrollRestore(options?: {
    allowFinalClamp?: boolean;
  }): boolean {
    const pending = imageScrollPendingRestoreRef.current;
    const scrollContainer = imageMainScrollRef.current;
    if (!pending || !scrollContainer) {
      return false;
    }

    const currentKey = getImageScrollStorageKey(
      imageSessionsStorageScopeRef.current,
      activeSessionIdRef.current
    );
    if (currentKey !== pending.key) {
      imageScrollPendingRestoreRef.current = null;
      return false;
    }

    const maxTop = Math.max(
      0,
      scrollContainer.scrollHeight - scrollContainer.clientHeight
    );
    if (pending.targetTop > maxTop) {
      if (
        options?.allowFinalClamp &&
        hasReliableImageScrollFinalContent(scrollContainer)
      ) {
        completeImageScrollRestore(pending, maxTop);
        return true;
      }
      return false;
    }

    completeImageScrollRestore(pending, pending.targetTop);
    return true;
  }

  function handleImageMainContentLoad() {
    attemptImageScrollRestore({ allowFinalClamp: true });
  }

  function handleImageMainKeyboardInteraction(
    event: React.KeyboardEvent<HTMLElement>
  ) {
    if (!imageScrollPendingRestoreRef.current) {
      return;
    }

    // ARIA roles do not implement keyboard behavior. A descendant that has
    // actually consumed a key can signal that through preventDefault(), which
    // this bubbled handler must respect before assigning outer-scroll intent.
    if (event.defaultPrevented) {
      return;
    }

    if (!imageScrollKeyboardIntentKeys.has(event.key)) {
      return;
    }

    const target = event.target;
    const targetElement = target instanceof Element ? target : null;
    const isEditingTarget = Boolean(
      targetElement?.closest("textarea,input,select,[contenteditable='true']")
    );
    if (isEditingTarget) {
      return;
    }

    const isNativeButton = Boolean(targetElement?.closest("button"));

    if (imageScrollSpaceKeyboardIntentKeys.has(event.key)) {
      // Space activates native buttons. It remains a scroll intent on links,
      // including download anchors, and on custom widgets that did not
      // explicitly consume it.
      if (isNativeButton) {
        return;
      }
      handleImageMainUserInteraction();
      return;
    }

    if (imageScrollPageKeyboardIntentKeys.has(event.key)) {
      handleImageMainUserInteraction();
      return;
    }

    if (imageScrollArrowKeyboardIntentKeys.has(event.key)) {
      // A role alone never consumes Arrow keys. Real widgets prevent default
      // in their own handler; otherwise Arrow keys retain outer-scroll intent.
      handleImageMainUserInteraction();
    }
  }

  function handleImageMainUserInteraction() {
    if (!imageScrollPendingRestoreRef.current) {
      return;
    }

    cancelImageScrollPendingRestore();
    const top = imageMainScrollRef.current?.scrollTop;
    if (typeof top === "number") {
      updateImageMainScrollRuntime(top);
    }
  }

  useEffect(() => {
    const currentKey = getImageScrollStorageKey(
      imageSessionsStorageScopeRef.current,
      activeSessionId
    );
    const runtimeOwner = imageScrollRuntimeOwnerRef.current;
    const pendingRestore = imageScrollPendingRestoreRef.current;

    if (runtimeOwner && runtimeOwner.key !== currentKey) {
      // Flush the previous owner before the new identity/session can claim
      // the runtime scalar. Never re-key the old value under the new owner.
      flushImageScrollRuntimeOwner(runtimeOwner);
    }

    if (pendingRestore && pendingRestore.key !== currentKey) {
      imageScrollPendingRestoreRef.current = null;
    }

    if (imageScrollRestoreKeyRef.current !== currentKey) {
      imageScrollRestoreKeyRef.current = null;
    }
  }, [activeSessionId, currentImageStorageIdentity]);

  useEffect(() => {
    const identity = imageSessionsStorageScopeRef.current?.trim() || null;
    const restoreKey = getImageScrollStorageKey(identity, activeSessionId);
    if (
      !imageSessionStorageAuthReady ||
      !isImageSessionStorageReady ||
      imageSessionsStorageLoadedScopeRef.current !== identity ||
      !identity ||
      !restoreKey ||
      imageScrollRestoreKeyRef.current === restoreKey
    ) {
      return;
    }

    let cancelled = false;
    const restore = () => {
      if (cancelled) {
        return;
      }

      const scrollContainer = imageMainScrollRef.current;
      if (!scrollContainer) {
        return;
      }

      // A real submission owns the next scroll. Do not let route restoration
      // win that arbitration, even if both effects are scheduled together.
      if (pendingSubmittedEntryScrollRef.current) {
        imageScrollRestoreKeyRef.current = restoreKey;
        return;
      }

      if (imageScrollPendingRestoreRef.current?.key !== restoreKey) {
        const savedTop = readImageScrollTop(identity, activeSessionId);
        if (savedTop === null) {
          imageScrollRestoreKeyRef.current = restoreKey;
          return;
        }

        imageScrollPendingRestoreRef.current = {
          identity,
          sessionId: activeSessionId?.trim() || null,
          key: restoreKey,
          targetTop: savedTop
        };
      }

      attemptImageScrollRestore({ allowFinalClamp: true });
    };

    const frame =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(restore)
        : window.setTimeout(restore, 0);

    return () => {
      cancelled = true;
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
      } else {
        window.clearTimeout(frame);
      }
    };
  }, [
    activeSessionId,
    imageSessionStorageAuthReady,
    imageStream.length,
    isImageSessionStorageReady
  ]);

  useEffect(() => {
    return () => {
      if (imageScrollPendingRestoreRef.current) {
        return;
      }
      flushImageScrollRuntimeOwner();
    };
  }, []);

  const loadBackendImageHistory = useCallback(
    async (options?: { force?: boolean }) => {
      const requestToken = backendHistoryTokenRef.current;
      const requestIdentity = backendHistoryAccountIdentityRef.current;

      if (!backendHistoryStorageReadyRef.current || !requestToken) {
        return;
      }

      const requestSequence = accountRequestSequenceRef.current;
      const isCurrentAccountRequest = () =>
        isMountedRef.current &&
        accountRequestSequenceRef.current === requestSequence &&
        authIdentityRef.current === requestIdentity &&
        authTokenRef.current === requestToken &&
        backendHistoryAccountIdentityRef.current === requestIdentity &&
        backendHistoryTokenRef.current === requestToken;

      if (!isCurrentAccountRequest()) {
        return;
      }

      const inFlightRequest = backendHistoryRequestRef.current;
      if (inFlightRequest) {
        const sameAccountRequest =
          inFlightRequest.accountIdentity === requestIdentity &&
          inFlightRequest.token === requestToken &&
          inFlightRequest.accountRequestSequence === requestSequence &&
          !inFlightRequest.controller.signal.aborted;

        if (sameAccountRequest) {
          await inFlightRequest.promise;
          return;
        }

        inFlightRequest.controller.abort();
        backendHistoryRequestRef.current = null;
      }

      const now = Date.now();
      if (
        !options?.force &&
        !shouldReloadBackendImageHistory(
          lastBackendHistoryReloadedAtRef.current,
          now
        )
      ) {
        return;
      }

      lastBackendHistoryReloadedAtRef.current = now;

      const controller = new AbortController();
      let requestPromise = Promise.resolve();
      const request: BackendImageHistoryRequest = {
        accountIdentity: requestIdentity,
        token: requestToken,
        accountRequestSequence: requestSequence,
        controller,
        promise: requestPromise
      };
      backendHistoryRequestRef.current = request;

      requestPromise = (async () => {
        try {
          const response = await fetch(apiUrl("/tasks?type=image&limit=100"), {
            headers: { Authorization: `Bearer ${requestToken}` },
            signal: controller.signal
          });

          if (!response.ok || !isCurrentAccountRequest()) {
            return;
          }

          const data = (await response.json()) as { tasks?: AiTaskSummary[] };
          if (!isCurrentAccountRequest()) {
            return;
          }
          const tasks = Array.isArray(data.tasks) ? data.tasks : [];
          const translator = backendHistoryTranslatorRef.current;
          const allBackendEntries = tasks
            .slice()
            .reverse()
            .map((task) =>
              taskToImageStreamEntry(task, imageModelMapRef.current, translator)
            )
            .filter((entry) => Boolean(entry.imageSessionId));
          const historyBackendEntries = tasks
            .filter(
              (task) =>
                filterTasksCreatedBeforeIso([task], firstPageLoadedAtRef.current)
                  .length > 0 ||
                (requestedSessionIdRef.current &&
                  readTaskInputString(task, "imageSessionId", 128) ===
                    requestedSessionIdRef.current)
            )
            .slice()
            .reverse()
            .map((task) =>
              taskToImageStreamEntry(task, imageModelMapRef.current, translator)
            )
            .filter((entry) => Boolean(entry.imageSessionId));

          if (!isCurrentAccountRequest() || allBackendEntries.length === 0) {
            return;
          }

          setImageSessions((currentSessions) => {
            const reconciledSessions =
              reconcilePendingImageSessionEntriesWithBackend(
                currentSessions,
                allBackendEntries
              );
            const mergedSessions = mergeImageSessionsWithBackendHistory(
              reconciledSessions,
              historyBackendEntries,
              translator("multimodal.image.backendHistory"),
              maxStoredImageStreamEntries,
              {
                backendHistoryDismissed: backendHistoryDismissedRef.current,
                firstPageLoadedAt: firstPageLoadedAtRef.current,
                dismissedSessionIds: dismissedImageSessionIdsRef.current,
                imageSessionFallbackTitle: translator("multimodal.image.newDrawing")
              }
            );
            const normalizedSessions = normalizeImageSessionsForDisplay(
              mergedSessions,
              translator("multimodal.image.backendHistory")
            );

            setActiveSessionId((currentActiveSessionId) =>
              selectActiveImageSessionId(
                normalizedSessions,
                requestedSessionIdRef.current ?? currentActiveSessionId
              )
            );

            return normalizedSessions;
          });
        } catch {
          // Backend history is best-effort and should not block local sessions.
        } finally {
          if (backendHistoryRequestRef.current === request) {
            backendHistoryRequestRef.current = null;
          }
        }
      })();
      request.promise = requestPromise;
      await requestPromise;
    },
    []
  );

  useEffect(() => {
    if (!isImageSessionStorageReady || !token) {
      return;
    }

    void loadBackendImageHistory({ force: true });
  }, [isImageSessionStorageReady, loadBackendImageHistory, token]);

  useEffect(() => {
    if (!isImageSessionStorageReady || !token) {
      return;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void loadBackendImageHistory();
      }
    }

    function handleFocus() {
      void loadBackendImageHistory();
    }

    document.addEventListener(
      backendImageHistoryReloadEvents.visibilitychange,
      handleVisibilityChange
    );
    window.addEventListener(backendImageHistoryReloadEvents.focus, handleFocus);

    return () => {
      document.removeEventListener(
        backendImageHistoryReloadEvents.visibilitychange,
        handleVisibilityChange
      );
      window.removeEventListener(
        backendImageHistoryReloadEvents.focus,
        handleFocus
      );
    };
  }, [isImageSessionStorageReady, loadBackendImageHistory, token]);

  useEffect(() => {
    const pendingEntryId = pendingSubmittedEntryScrollRef.current;

    if (!pendingEntryId || !imageStream.some((entry) => entry.id === pendingEntryId)) {
      return;
    }

    cancelImageScrollPendingRestore();
    pendingSubmittedEntryScrollRef.current = null;
    const scrollContainer = imageMainScrollRef.current;
    const targetTop = scrollContainer?.scrollHeight ?? 0;

    if (scrollContainer) {
      updateImageMainScrollRuntime(targetTop);
    }

    scrollContainer?.scrollTo({
      top: targetTop,
      behavior: "smooth"
    });
  }, [imageStream]);

  const referencePreparationLocked =
    isPreparingContinuation ||
    imageCreationHandoffState === "PREPARING_REFERENCE" ||
    imageCreationHandoffState === "TRANSIENT_FAILURE" ||
    imageCreationHandoffState === "CONFLICT";
  const referenceMutationLocked =
    referencePreparationLocked ||
    referenceImageCompression.status === "compressing";
  const titleCoverReferenceMutationLocked =
    titleCoverReferenceImageCompression.status === "compressing";
  const titleCoverReferenceReady =
    titleCoverReferenceImageCompression.status !== "compressing" &&
    (titleCoverReferenceImages.length > 0 ||
      titleCoverReferenceImageCompression.status === "idle");
  const canResumeCurrentWorkflow =
    canResumeImageGenerationRequest &&
    activeImageGenerationWorkflowRef.current === creatorWorkflow;
  const hasActiveImageGenerationAttempt = Boolean(
    activeImageGenerationAttemptRef.current
  );
  const isForeignWorkflowGenerationActive = Boolean(
    hasActiveImageGenerationAttempt &&
      activeImageGenerationWorkflowRef.current !== creatorWorkflow
  );
  const isTitleCoverGenerationActive =
    isTitleCoverWorkflow &&
    isLoading &&
    activeImageGenerationWorkflowRef.current === "title-cover" &&
    hasActiveImageGenerationAttempt;
  const isTranscriptGenerationActive =
    isTranscriptGenerating ||
    (isLoading &&
      activeImageGenerationWorkflowRef.current === "transcript-images" &&
      hasActiveImageGenerationAttempt);
  const canGenerate = isTitleCoverWorkflow
    ? Boolean(token) &&
      Boolean(selectedModel) &&
      titleCoverDraft.originalTitle.trim().length > 0 &&
      titleCoverDraft.mainCopy.trim().length > 0 &&
      titleCoverReferenceReady &&
      !isReferenceLimitExceeded &&
      !hasInsufficientCredits &&
      !canResumeCurrentWorkflow &&
      !hasActiveImageGenerationAttempt &&
      !isLoading
    : isTranscriptImagesWorkflow
      ? false
      : Boolean(selectedModel) &&
      prompt.trim().length > 0 &&
      (!isPrecisionEditWorkflow || activeReferenceImages.length === 1) &&
      !isReferenceLimitExceeded &&
      referenceImageCompression.status !== "compressing" &&
      !hasInsufficientCredits &&
      !canResumeCurrentWorkflow &&
      !hasActiveImageGenerationAttempt &&
      !referencePreparationLocked &&
      !isLoading;

  function beginImageGenerationRun() {
    imageGenerationRunIdRef.current += 1;
    imageGenerationAbortControllerRef.current?.abort();
    const controller = new AbortController();
    imageGenerationAbortControllerRef.current = controller;
    return {
      runId: imageGenerationRunIdRef.current,
      controller
    };
  }

  function isImageGenerationRunActive(runId: number) {
    return isMountedRef.current && imageGenerationRunIdRef.current === runId;
  }

  function stopImageGenerationRun() {
    const stoppedRunId = imageGenerationRunIdRef.current;
    imageGenerationRunIdRef.current += 1;
    imageGenerationAbortControllerRef.current?.abort();
    imageGenerationAbortControllerRef.current = null;
    releaseImageGenerationPostLock(stoppedRunId);
    activeImageGenerationAttemptRef.current = null;
    pendingSubmittedEntryScrollRef.current = null;
    setCanResumeImageGenerationRequest(false);
    setIsLoading(false);
    transcriptQueueRunIdRef.current += 1;
    setIsTranscriptGenerating(false);
    setTranscriptActiveSceneId(null);
  }

  function updatePrompt(
    nextPrompt: string,
    options?: { memoryEdit?: boolean; persist?: boolean }
  ) {
    promptRevisionRef.current += 1;
    promptValueRef.current = nextPrompt;
    imagePromptMemoryEditRef.current = options?.memoryEdit
      ? {
          identity: imagePromptStorageIdentityRef.current,
          revision: promptRevisionRef.current,
          prompt: nextPrompt
        }
      : null;
    setPrompt(nextPrompt);
    if (
      options?.persist !== false &&
      imagePromptDraftReadyRef.current &&
      imagePromptDraftLoadedIdentityRef.current ===
        imagePromptStorageIdentityRef.current
    ) {
      writeImagePromptDraft(imagePromptStorageIdentityRef.current, nextPrompt);
    }
  }

  function focusPromptInput() {
    promptInputRef.current?.focus();
    promptInputRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "center"
    });
  }

  function reuseSelectedPrompt() {
    const sourcePrompt = getReusableImageResultPrompt(selectedImageResultVersion);
    if (!sourcePrompt) {
      return;
    }

    const currentPrompt = promptValueRef.current;
    if (currentPrompt.trim().length === 0 || currentPrompt === sourcePrompt) {
      if (currentPrompt.trim().length === 0) {
        updatePrompt(sourcePrompt, { memoryEdit: true });
      }
      focusPromptInput();
      return;
    }

    setPendingPromptReusePrompt(sourcePrompt);
  }

  function confirmPromptReuse() {
    const sourcePrompt = pendingPromptReusePrompt;
    setPendingPromptReusePrompt(null);
    if (!sourcePrompt) {
      return;
    }

    updatePrompt(sourcePrompt, { memoryEdit: true });
    focusPromptInput();
  }

  function cancelPromptReuse() {
    setPendingPromptReusePrompt(null);
  }

  function restoreSubmittedPromptIfUnchanged(
    submittedPrompt: string,
    promptRevisionAtFetchStart: number
  ) {
    if (promptRevisionRef.current === promptRevisionAtFetchStart) {
      updatePrompt(submittedPrompt);
    }
  }

  function clearSubmittedPromptIfUnchanged({
    draftAtSubmit,
    promptRevisionAtSubmit,
    persistenceIdentityAtSubmit
  }: {
    draftAtSubmit: string;
    promptRevisionAtSubmit: number;
    persistenceIdentityAtSubmit: string | null;
  }) {
    const currentIdentity = imagePromptStorageIdentityRef.current;
    const ownsCurrentDraft =
      promptValueRef.current === draftAtSubmit &&
      promptRevisionRef.current === promptRevisionAtSubmit &&
      currentIdentity === persistenceIdentityAtSubmit;

    if (!ownsCurrentDraft) {
      return;
    }

    // Keep the existing failure-restore revision contract: clearing the
    // submitted prompt is not itself a user edit.
    promptValueRef.current = "";
    setPrompt("");
    if (
      shouldClearImagePromptDraftAfterSubmit({
        currentIdentity,
        loadedDraftIdentity: imagePromptDraftLoadedIdentityRef.current,
        persistenceIdentityAtSubmit,
        currentPrompt: draftAtSubmit,
        draftAtSubmit,
        currentPromptRevision: promptRevisionRef.current,
        promptRevisionAtSubmit
      })
    ) {
      writeImagePromptDraft(persistenceIdentityAtSubmit, "");
    }
  }

  function setSessionEntries(
    targetSessionId: string,
    update: (currentEntries: ImageStreamEntry[]) => ImageStreamEntry[]
  ) {
    setImageSessions((currentSessions) =>
      updateImageSessionEntries(currentSessions, targetSessionId, update, {
        titleGenerator: (firstPrompt: string) =>
          generateImageSessionTitle(firstPrompt, locale)
      })
    );
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        isModelPickerOpen &&
        modelPickerRef.current &&
        !modelPickerRef.current.contains(target) &&
        !quickModelPickerRef.current?.contains(target)
      ) {
        setIsModelPickerOpen(false);
      }

      if (
        isRatioPickerOpen &&
        ratioPickerRef.current &&
        !ratioPickerRef.current.contains(target) &&
        !quickRatioPickerRef.current?.contains(target)
      ) {
        setIsRatioPickerOpen(false);
      }

      if (
        isCountPickerOpen &&
        !countPickerRef.current?.contains(target) &&
        !quickCountPickerRef.current?.contains(target)
      ) {
        setIsCountPickerOpen(false);
      }

    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsModelPickerOpen(false);
        setIsRatioPickerOpen(false);
        setIsCountPickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCountPickerOpen, isModelPickerOpen, isRatioPickerOpen]);

  function acquireImageGenerationPostLock(runId: number) {
    if (imageGenerationPostInFlightRef.current) {
      return false;
    }

    imageGenerationPostInFlightRef.current = true;
    imageGenerationPostLockOwnerRunIdRef.current = runId;
    return true;
  }

  function releaseImageGenerationPostLock(runId: number) {
    if (imageGenerationPostLockOwnerRunIdRef.current !== runId) {
      return;
    }

    imageGenerationPostInFlightRef.current = false;
    imageGenerationPostLockOwnerRunIdRef.current = null;
  }

  function clearActiveImageGenerationAttempt(attempt: ImageGenerationAttempt) {
    if (activeImageGenerationAttemptRef.current === attempt) {
      activeImageGenerationAttemptRef.current = null;
    }
    setCanResumeImageGenerationRequest(false);
  }

  function clearRetryableImageGenerationSnapshot(
    workflow?: ImageCreatorWorkflow
  ) {
    if (
      workflow &&
      retryableImageGenerationSnapshotRef.current?.workflow !== workflow
    ) {
      return;
    }

    retryableImageGenerationSnapshotRef.current = null;
    setRetryableImageGenerationClientEntryId(null);
  }

  function saveRetryableImageGenerationSnapshot(
    attempt: ImageGenerationAttempt
  ) {
    if (activeImageGenerationAttemptRef.current !== attempt) {
      return;
    }

    const clientEntryId = attempt.payload.clientEntryId;
    retryableImageGenerationSnapshotRef.current = {
      clientEntryId,
      payload: attempt.payload,
      workflow: activeImageGenerationWorkflowRef.current
    };
    setRetryableImageGenerationClientEntryId(clientEntryId);
  }

  async function sendAndReconcileImageGenerationAttempt({
    attempt,
    targetSessionId,
    targetEntryId,
    submittedPrompt,
    workflow,
    requestStartedAt,
    requestToken,
    runId,
    signal,
    keepLoading = false,
    saveRetrySnapshot = true
  }: {
    attempt: ImageGenerationAttempt;
    targetSessionId: string;
    targetEntryId: string;
    submittedPrompt: string;
    workflow: ImageCreatorWorkflow;
    requestStartedAt: Date;
    requestToken: string;
    runId: number;
    signal: AbortSignal;
    keepLoading?: boolean;
    saveRetrySnapshot?: boolean;
  }): Promise<"succeeded" | "failed" | "checking" | "cancelled"> {
    setCanResumeImageGenerationRequest(false);
    const promptRevisionAtFetchStart = promptRevisionRef.current;
    const draftAtFetchStart = promptValueRef.current;
    const persistenceIdentityAtFetchStart =
      imagePromptStorageIdentityRef.current;
    const managesFreeCreatePrompt =
      workflow === "free-create" || workflow === "precision-edit";

    let submissionSettled = false;
    try {
      const outcome = await submitAndReconcileImageGeneration({
        attempt,
        token: requestToken,
        submissionEndpoint: apiUrl("/image/generate"),
        tasksEndpoint: apiUrl("/tasks?type=image&limit=20"),
        taskDetailEndpoint: (taskId) => apiUrl(`/tasks/${taskId}`),
        fetchImplementation: fetch,
        requestStartedAt,
        signal,
        onFetchStarted: () => {
          if (managesFreeCreatePrompt) {
            clearSubmittedPromptIfUnchanged({
              draftAtSubmit: draftAtFetchStart,
              promptRevisionAtSubmit: promptRevisionAtFetchStart,
              persistenceIdentityAtSubmit: persistenceIdentityAtFetchStart
            });
          }
        },
        onSubmissionSettled: () => {
          submissionSettled = true;
          releaseImageGenerationPostLock(runId);
        },
        onPollingStarted: () => {
          if (!isImageGenerationRunActive(runId)) {
            return;
          }
          setSessionEntries(targetSessionId, (currentEntries) =>
            currentEntries.map((entry) =>
              entry.id === targetEntryId
                ? markImageStreamEntryChecking(entry, checkingSyncMessage())
                : entry
            )
          );
          clearError(workflow);
        }
      });

      if (
        !isImageGenerationRunActive(runId) ||
        outcome.kind === "aborted"
      ) {
        return "cancelled";
      }

      if (outcome.kind === "succeeded" && outcome.source === "submission") {
        const data: ImageGenerationResponse = {
          task: outcome.task,
          assets: outcome.assets
        };
        const actualAssets = outcome.assets;
        const requestedCount = readImageGenerationCount(attempt.payload.count);
        const acceptedAssetCount = readAcceptedImageResultAssets(
          actualAssets,
          data.task.id
        ).length;

        if (acceptedAssetCount === 0) {
          setSessionEntries(targetSessionId, (current) =>
            current.map((entry) =>
              entry.id === targetEntryId
                ? {
                    ...entry,
                    status: "failed",
                    result: null,
                    error: t("multimodal.error.generateFailed")
                  }
                : entry
            )
          );
          showError(t("multimodal.error.generateFailed"), undefined, workflow);
          if (saveRetrySnapshot) {
            saveRetryableImageGenerationSnapshot(attempt);
          } else {
            clearRetryableImageGenerationSnapshot(workflow);
          }
          clearActiveImageGenerationAttempt(attempt);
          return "failed";
        }

        setSessionEntries(targetSessionId, (current) =>
          current.map((entry) =>
            entry.id === targetEntryId
              ? {
                  ...entry,
                  status: "succeeded",
                  result: { ...data, assets: actualAssets },
                  assetCountContractViolation: acceptedAssetCount > requestedCount,
                  error: null
                }
              : entry
          )
        );
        clearError(workflow);
        setCredits((current) =>
          current === null ? current : Math.max(current - data.task.costCredits, 0)
        );
        clearRetryableImageGenerationSnapshot(workflow);
        clearActiveImageGenerationAttempt(attempt);
        return "succeeded";
      }

      if (outcome.kind === "failed" && outcome.source === "submission") {
        const requestResult = outcome.submission;
        const message = readImageGenerationErrorMessage(
          requestResult.status,
          requestResult.body,
          t("multimodal.error.generateFailed"),
          insufficientCredits
        );

        if (managesFreeCreatePrompt) {
          restoreSubmittedPromptIfUnchanged(
            submittedPrompt,
            promptRevisionAtFetchStart
          );
        }
        setSessionEntries(targetSessionId, (current) =>
          current.map((entry) =>
            entry.id === targetEntryId
              ? { ...entry, status: "failed", result: null, error: message }
              : entry
          )
        );
        showError(message, undefined, workflow);
        if (!saveRetrySnapshot) {
          clearRetryableImageGenerationSnapshot(workflow);
        } else if (
          requestResult.decision.kind === "structured_failure" &&
          !requestResult.decision.retryable
        ) {
          clearRetryableImageGenerationSnapshot(workflow);
        } else {
          saveRetryableImageGenerationSnapshot(attempt);
        }
        clearActiveImageGenerationAttempt(attempt);
        return "failed";
      }

      if (outcome.kind === "succeeded" && outcome.source === "reconciliation") {
        const reconciledEntry = taskToImageStreamEntry(
          outcome.task,
          imageModelMap,
          t,
          outcome.assets
        );
        if (!reconciledEntry.result && reconciledEntry.status !== "failed") {
          return "cancelled";
        }

        setSessionEntries(targetSessionId, (currentEntries) =>
          currentEntries.map((entry) =>
            entry.id === targetEntryId
              ? reconcileImageStreamEntryFromTask(
                  entry,
                  outcome.task,
                  imageModelMap,
                  t,
                  outcome.assets
                )
              : entry
          )
        );
        clearError(workflow);

        if (outcome.phase === "immediate") {
          clearRetryableImageGenerationSnapshot(workflow);
          clearActiveImageGenerationAttempt(attempt);
          return "succeeded";
        }

        if (reconciledEntry.status === "failed") {
          if (managesFreeCreatePrompt) {
            restoreSubmittedPromptIfUnchanged(
              submittedPrompt,
              promptRevisionAtFetchStart
            );
          }
          if (saveRetrySnapshot) {
            saveRetryableImageGenerationSnapshot(attempt);
          } else {
            clearRetryableImageGenerationSnapshot(workflow);
          }
          clearActiveImageGenerationAttempt(attempt);
          return "failed";
        }

        clearRetryableImageGenerationSnapshot(workflow);
        clearActiveImageGenerationAttempt(attempt);
        return "succeeded";
      }

      if (outcome.kind === "failed" && outcome.source === "reconciliation") {
        setSessionEntries(targetSessionId, (currentEntries) =>
          currentEntries.map((entry) =>
            entry.id === targetEntryId
              ? reconcileImageStreamEntryFromTask(
                  entry,
                  outcome.task,
                  imageModelMap,
                  t
                )
              : entry
          )
        );
        showError(
          outcome.task.errorMessage || t("multimodal.error.generateFailed"),
          undefined,
          workflow
        );
        if (managesFreeCreatePrompt) {
          restoreSubmittedPromptIfUnchanged(
            submittedPrompt,
            promptRevisionAtFetchStart
          );
        }
        if (saveRetrySnapshot) {
          saveRetryableImageGenerationSnapshot(attempt);
        } else {
          clearRetryableImageGenerationSnapshot(workflow);
        }
        clearActiveImageGenerationAttempt(attempt);
        return "failed";
      }

      if (outcome.kind === "unresolved") {
        setSessionEntries(targetSessionId, (currentEntries) =>
          currentEntries.map((entry) =>
            entry.id === targetEntryId
              ? markImageStreamEntryChecking(entry, checkingTimeoutMessage())
              : entry
          )
        );
        if (managesFreeCreatePrompt) {
          restoreSubmittedPromptIfUnchanged(
            submittedPrompt,
            promptRevisionAtFetchStart
          );
        }
        if (activeImageGenerationAttemptRef.current === attempt) {
          setCanResumeImageGenerationRequest(true);
        }
        return "checking";
      }

      return "cancelled";
    } finally {
      if (!submissionSettled) {
        releaseImageGenerationPostLock(runId);
      }
      if (isImageGenerationRunActive(runId) && !keepLoading) {
        imageGenerationAbortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }

  async function resumeImageGenerationRequest() {
    const attempt = activeImageGenerationAttemptRef.current;

    if (
      !attempt ||
      activeImageGenerationWorkflowRef.current !== creatorWorkflowRef.current ||
      !token ||
      !canResumeImageGenerationRequest ||
      isLoading
    ) {
      return;
    }

    const targetSession = imageSessions.find(
      (session) => session.id === attempt.payload.imageSessionId
    );
    const targetEntry = targetSession?.entries.find(
      (entry) =>
        entry.clientEntryId === attempt.payload.clientEntryId &&
        entry.status === "checking"
    );

    if (!targetEntry || imageGenerationPostInFlightRef.current) {
      return;
    }

    const { runId, controller } = beginImageGenerationRun();
    if (!acquireImageGenerationPostLock(runId)) {
      return;
    }

    setCanResumeImageGenerationRequest(false);
    setIsLoading(true);
    clearError();
    const storedRequestStartedAt = targetEntry.createdAt
      ? new Date(targetEntry.createdAt)
      : new Date();
    const requestStartedAt = Number.isNaN(storedRequestStartedAt.getTime())
      ? new Date()
      : storedRequestStartedAt;

    await sendAndReconcileImageGenerationAttempt({
      attempt,
      targetSessionId: attempt.payload.imageSessionId,
      targetEntryId: attempt.payload.clientEntryId,
      submittedPrompt: attempt.payload.prompt,
      workflow: activeImageGenerationWorkflowRef.current,
      requestStartedAt,
      requestToken: token,
      runId,
      signal: controller.signal
    });
  }

  function updateTranscriptDraft(value: string) {
    if (isTranscriptGenerationActive) {
      return;
    }

    if (value !== transcriptDraft && transcriptScenes.length > 0) {
      transcriptQueueRunIdRef.current += 1;
      setTranscriptScenes([]);
      setTranscriptActiveSceneId(null);
    }
    setTranscriptDraft(value);
    if (error?.workflow === "transcript-images") {
      setError(null);
    }
  }

  function planTranscriptImages() {
    if (isTranscriptGenerationActive) {
      return;
    }

    const validation = validateTranscriptInput(transcriptDraft);
    if (validation === "empty") {
      showError(t("multimodal.error.transcriptEmpty"), undefined, "transcript-images");
      return;
    }
    if (validation === "too-long") {
      showError(t("multimodal.error.transcriptTooLong"), undefined, "transcript-images");
      return;
    }

    const segments = segmentTranscript(transcriptDraft);
    if (segments.length === 0) {
      showError(t("multimodal.error.transcriptEmpty"), undefined, "transcript-images");
      return;
    }

    const transcriptLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
    setTranscriptScenes(
      segments.map((sourceText, index) => ({
        id: `transcript-scene-${index + 1}`,
        sourceText,
        prompt: compileTranscriptImagePrompt(sourceText, transcriptLocale),
        selected: index < TRANSCRIPT_MAX_SELECTED_SCENES,
        entryId: null
      }))
    );
    clearError("transcript-images");
  }

  function toggleTranscriptScene(sceneId: string) {
    if (isTranscriptGenerationActive) {
      return;
    }

    const scene = transcriptScenes.find((candidate) => candidate.id === sceneId);
    if (!scene) {
      return;
    }

    if (
      !scene.selected &&
      transcriptScenes.filter((candidate) => candidate.selected).length >=
        TRANSCRIPT_MAX_SELECTED_SCENES
    ) {
      showError(
        t("multimodal.error.transcriptSelectionLimit"),
        undefined,
        "transcript-images"
      );
      return;
    }

    setTranscriptScenes((currentScenes) =>
      currentScenes.map((candidate) =>
        candidate.id === sceneId
          ? { ...candidate, selected: !candidate.selected }
          : candidate
      )
    );
    clearError("transcript-images");
  }

  function updateTranscriptScenePrompt(sceneId: string, promptValue: string) {
    if (isTranscriptGenerationActive) {
      return;
    }

    setTranscriptScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId ? { ...scene, prompt: promptValue } : scene
      )
    );
  }

  async function generateTranscriptScene(scene: TranscriptSceneDraft) {
    if (!token || !selectedModel) {
      showError(t("multimodal.error.loginRequired"), { persistent: true }, "transcript-images");
      return "failed" as const;
    }

    const { runId, controller } = beginImageGenerationRun();
    if (!acquireImageGenerationPostLock(runId)) {
      return "cancelled" as const;
    }

    let targetEntryId: string | null = null;
    try {
      const targetSessionId = activeSessionIdRef.current;
      const streamEntryId = createImageEntryId();
      targetEntryId = streamEntryId;
      const submittedPrompt = scene.prompt.trim();
      if (!submittedPrompt) {
        throw new Error("TRANSCRIPT_SCENE_PROMPT_EMPTY");
      }
      const targetSessionTitle =
        activeSession?.title ||
        scene.sourceText.trim().slice(0, 30) ||
        t("multimodal.image.newDrawing");
      const requestStartedAt = new Date();
      const payload = buildTranscriptImageRequestPayload({
        prompt: submittedPrompt,
        modelId: selectedModel.slug,
        size,
        count: 1,
        mode: "text-to-image",
        imageSessionId: targetSessionId,
        clientEntryId: targetEntryId,
        imageSessionTitle: targetSessionTitle,
        workflow: "transcript-images"
      });
      const attempt = createTranscriptGenerationAttempt(payload);
      activeImageGenerationAttemptRef.current = attempt;
      activeImageGenerationWorkflowRef.current = "transcript-images";

      setTranscriptScenes((currentScenes) =>
        currentScenes.map((candidate) =>
          candidate.id === scene.id
            ? { ...candidate, entryId: targetEntryId }
            : candidate
        )
      );
      const nextStreamEntry: ImageStreamEntry = {
        id: streamEntryId,
        workflow: "transcript-images",
        workflowContextId: null,
        clientEntryId: targetEntryId,
        imageSessionId: targetSessionId,
        imageSessionTitle: targetSessionTitle,
        createdAt: requestStartedAt.toISOString(),
        prompt: submittedPrompt,
        modelName: getModelDisplayName(selectedModel),
        modelId: selectedModel.slug,
        aspectRatio,
        mode: "text-to-image",
        referenceImage: null,
        requestedCount: 1,
        assetCountContractViolation: false,
        status: "loading",
        result: null,
        error: null
      };
      pendingSubmittedEntryScrollRef.current = targetEntryId;
      setSessionEntries(targetSessionId, (currentEntries) => [
        ...currentEntries,
        nextStreamEntry
      ]);
      setContinuationSourceEntryId(null);

      return await sendAndReconcileImageGenerationAttempt({
        attempt,
        targetSessionId,
        targetEntryId,
        submittedPrompt,
        workflow: "transcript-images",
        requestStartedAt,
        requestToken: token,
        runId,
        signal: controller.signal,
        keepLoading: true,
        saveRetrySnapshot: false
      });
    } catch {
      releaseImageGenerationPostLock(runId);
      if (activeImageGenerationAttemptRef.current) {
        activeImageGenerationAttemptRef.current = null;
      }
      if (targetEntryId) {
        setSessionEntries(activeSessionIdRef.current, (currentEntries) =>
          currentEntries.map((entry) =>
            entry.id === targetEntryId
              ? {
                  ...entry,
                  status: "failed",
                  result: null,
                  error: t("multimodal.error.generateFailed")
                }
              : entry
          )
        );
      }
      showError(t("multimodal.error.generateFailed"), undefined, "transcript-images");
      return "failed" as const;
    }
  }

  async function generateSelectedTranscriptImages() {
    if (
      isTranscriptGenerationActive ||
      isTranscriptGenerating ||
      isLoading ||
      imageGenerationPostInFlightRef.current ||
      activeImageGenerationAttemptRef.current
    ) {
      return;
    }

    const selectedScenes = transcriptScenes.filter((scene) => scene.selected);
    if (selectedScenes.length === 0) {
      showError(t("multimodal.error.transcriptNoSelection"), undefined, "transcript-images");
      return;
    }
    if (selectedScenes.length > TRANSCRIPT_MAX_SELECTED_SCENES) {
      showError(
        t("multimodal.error.transcriptSelectionLimit"),
        undefined,
        "transcript-images"
      );
      return;
    }
    if (!token || !selectedModel) {
      showError(t("multimodal.error.loginRequired"), { persistent: true }, "transcript-images");
      return;
    }

    const estimatedTranscriptCost = selectedModel.creditCost * selectedScenes.length;
    if (credits !== null && estimatedTranscriptCost > credits) {
      showError(
        t("multimodal.error.insufficientCredits", {
          cost: estimatedTranscriptCost,
          credits
        }),
        { persistent: true },
        "transcript-images"
      );
      return;
    }

    const queueRunId = transcriptQueueRunIdRef.current + 1;
    transcriptQueueRunIdRef.current = queueRunId;
    setIsTranscriptGenerating(true);
    setIsLoading(true);
    setTranscriptActiveSceneId(null);
    clearError("transcript-images");
    clearRetryableImageGenerationSnapshot("transcript-images");
    clearIncomingImageCreationHandoff();

    try {
      for (const scene of selectedScenes) {
        if (transcriptQueueRunIdRef.current !== queueRunId) {
          break;
        }
        setTranscriptActiveSceneId(scene.id);
        const outcome = await generateTranscriptScene(scene);
        if (outcome === "checking" || outcome === "cancelled") {
          break;
        }
      }
    } finally {
      if (transcriptQueueRunIdRef.current === queueRunId) {
        imageGenerationAbortControllerRef.current = null;
        setTranscriptActiveSceneId(null);
        setIsTranscriptGenerating(false);
        setIsLoading(false);
      }
    }
  }

  async function generate() {
    if (
      isLoading ||
      imageGenerationPostInFlightRef.current ||
      activeImageGenerationAttemptRef.current
    ) {
      return;
    }

    if (!token || !selectedModel) {
      showError(t("multimodal.error.loginRequired"), { persistent: true });
      return;
    }

    const requestedWorkflow = creatorWorkflowRef.current;
    const submittedPrompt =
      requestedWorkflow === "title-cover"
        ? titleCoverDraft.originalTitle.trim()
        : prompt.trim();

    if (
      requestedWorkflow === "title-cover" &&
      (titleCoverDraft.originalTitle.trim().length === 0 ||
        titleCoverDraft.mainCopy.trim().length === 0)
    ) {
      showError(t("multimodal.error.promptRequired"));
      return;
    }

    if (!submittedPrompt) {
      showError(t("multimodal.error.promptRequired"));
      return;
    }

    if (hasInsufficientCredits) {
      showError(insufficientCredits, { persistent: true });
      return;
    }

    const submittedReferenceImages =
      requestedWorkflow === "title-cover"
        ? titleCoverReferenceImages
        : requestedWorkflow === "precision-edit"
          ? referenceImages.slice(0, 1)
          : referenceImages;
    if (submittedReferenceImages.length > activeReferenceLimit) {
      showError(t("multimodal.error.tooManyReferences", {
        max: activeReferenceLimit
      }));
      return;
    }
    if (
      (requestedWorkflow === "precision-edit" ||
        generationMode === "image-to-image") &&
      submittedReferenceImages.length === 0
    ) {
      showError(
        requestedWorkflow === "precision-edit"
          ? t("multimodal.error.precisionEditReferenceRequired")
          : t("multimodal.error.referenceImageRequired")
      );
      return;
    }

    if (
      requestedWorkflow === "title-cover" &&
      !titleCoverReferenceReady
    ) {
      showError(t("multimodal.error.referenceImageCompressFailed"));
      return;
    }

    const requestCount: AiGenerationCount = generationCount;

    clearRetryableImageGenerationSnapshot(requestedWorkflow);
    setCanResumeImageGenerationRequest(false);
    clearError();
    cancelImageScrollPendingRestore();
    const { runId, controller } = beginImageGenerationRun();
    if (!acquireImageGenerationPostLock(runId)) {
      return;
    }
    clearIncomingImageCreationHandoff();
    let attempt: ImageGenerationAttempt;
    let targetSessionId: string;
    let targetEntryId: string;
    let requestedModelId: string;
    let requestStartedAt: Date;

    try {
      targetSessionId = activeSessionId;
      const streamEntryId = createImageEntryId();
      targetEntryId = streamEntryId;
      const targetSessionTitle =
        requestedWorkflow === "title-cover"
          ? titleCoverDraft.originalTitle.trim().slice(0, 120) ||
            activeSession?.title ||
            t("multimodal.image.newDrawing")
          : activeSession?.title ||
            submittedPrompt.slice(0, 30) ||
            t("multimodal.image.newDrawing");
      requestStartedAt = new Date();
      requestedModelId = selectedModel.slug;
      const nextReferenceImages = submittedReferenceImages.map((reference) => ({
            dataUrl: reference.image.dataUrl,
            name:
              reference.image.name ||
              t("multimodal.image.referenceLabel")
          }));
      const payload = buildImageGenerateRequestPayload({
        prompt: submittedPrompt,
        modelId: requestedModelId,
        size,
        count: requestCount,
        mode: generationMode,
        imageSessionId: targetSessionId,
        clientEntryId: targetEntryId,
        imageSessionTitle: targetSessionTitle,
        referenceImages: submittedReferenceImages.map(
          (reference) => reference.image
        ),
        ...(requestedWorkflow === "title-cover" ||
        requestedWorkflow === "precision-edit"
          ? {
              workflow: requestedWorkflow,
              ...(requestedWorkflow === "title-cover"
                ? {
                    titleCover: {
                      originalTitle: titleCoverDraft.originalTitle.trim(),
                      style: titleCoverDraft.style
                    }
                  }
                : {})
            }
          : {})
      });
      attempt = createImageGenerationAttempt(payload);
      activeImageGenerationAttemptRef.current = attempt;
      activeImageGenerationWorkflowRef.current = requestedWorkflow;
      setIsLoading(true);
      const nextStreamEntry: ImageStreamEntry = {
        id: streamEntryId,
        workflow: requestedWorkflow,
        workflowContextId:
          requestedWorkflow === "title-cover"
            ? activeSession?.titleCoverCreationId ?? null
            : null,
        clientEntryId: targetEntryId,
        imageSessionId: targetSessionId,
        imageSessionTitle: targetSessionTitle,
        createdAt: requestStartedAt.toISOString(),
        prompt: submittedPrompt,
        modelName: getModelDisplayName(selectedModel),
        modelId: selectedModel.slug,
        aspectRatio,
        mode: generationMode,
        referenceImages: nextReferenceImages,
        referenceImage: null,
        requestedCount: requestCount,
        assetCountContractViolation: false,
        status: "loading",
        result: null,
        error: null
      };

      pendingSubmittedEntryScrollRef.current = targetEntryId;
      setSessionEntries(targetSessionId, (currentEntries) => [
        ...currentEntries,
        nextStreamEntry
      ]);
      if (requestedWorkflow === "free-create") {
        setReferenceImages([]);
        setReferenceImageCompression({ status: "idle" });
      }
      setContinuationSourceEntryId(null);
    } catch {
      pendingSubmittedEntryScrollRef.current = null;
      releaseImageGenerationPostLock(runId);
      activeImageGenerationAttemptRef.current = null;
      setCanResumeImageGenerationRequest(false);
      setIsLoading(false);
      imageGenerationAbortControllerRef.current = null;
      showError(imagePreFetchFailureMessage, { persistent: true });
      return;
    }

    await sendAndReconcileImageGenerationAttempt({
      attempt,
      targetSessionId,
      targetEntryId,
      submittedPrompt,
      workflow: requestedWorkflow,
      requestStartedAt,
      requestToken: token,
      runId,
      signal: controller.signal
    });
  }

  async function retryImageGenerationAsNewRequest() {
    const snapshot = retryableImageGenerationSnapshotRef.current;

    if (
      !snapshot ||
      snapshot.workflow !== creatorWorkflowRef.current ||
      !token ||
      isLoading ||
      activeImageGenerationAttemptRef.current ||
      imageGenerationPostInFlightRef.current ||
      retryableImageGenerationClientEntryId !== snapshot.clientEntryId
    ) {
      return;
    }

    const targetSession = imageSessions.find(
      (session) => session.id === snapshot.payload.imageSessionId
    );
    const targetEntry = targetSession?.entries.find(
      (entry) =>
        entry.clientEntryId === snapshot.clientEntryId &&
        entry.status === "failed"
    );

    if (!targetEntry) {
      return;
    }

    const { runId, controller } = beginImageGenerationRun();
    if (!acquireImageGenerationPostLock(runId)) {
      return;
    }

    setCanResumeImageGenerationRequest(false);
    setIsLoading(true);
    clearError();
    cancelImageScrollPendingRestore();
    let attempt: ImageGenerationAttempt;

    try {
      attempt = createImageGenerationAttempt(snapshot.payload);
    } catch {
      releaseImageGenerationPostLock(runId);
      setIsLoading(false);
      imageGenerationAbortControllerRef.current = null;
      showError(imagePreFetchFailureMessage, { persistent: true });
      return;
    }

    activeImageGenerationAttemptRef.current = attempt;
    activeImageGenerationWorkflowRef.current = snapshot.workflow;
    clearRetryableImageGenerationSnapshot(snapshot.workflow);
    const storedRequestStartedAt = targetEntry.createdAt
      ? new Date(targetEntry.createdAt)
      : new Date();
    const requestStartedAt = Number.isNaN(storedRequestStartedAt.getTime())
      ? new Date()
      : storedRequestStartedAt;

    await sendAndReconcileImageGenerationAttempt({
      attempt,
      targetSessionId: attempt.payload.imageSessionId,
      targetEntryId: attempt.payload.clientEntryId,
      submittedPrompt: attempt.payload.prompt,
      workflow: snapshot.workflow,
      requestStartedAt,
      requestToken: token,
      runId,
      signal: controller.signal
    });
  }

  function handlePromptKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      !shouldSubmitImagePromptOnEnter({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
        isMobileLayout: isMobilePromptLayout
      })
    ) {
      return;
    }

    event.preventDefault();

    if (!prompt.trim() || isLoading) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  function handleGenerateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void generate();
  }

  function selectCreatorWorkflow(nextWorkflow: ImageCreatorWorkflow) {
    if (nextWorkflow === "transcript-images") {
      cancelContinuationPreparation();
      clearIncomingImageCreationHandoff();
      setPendingContinuationEntryId(null);
      setContinuationSourceEntryId(null);
    }
    creatorWorkflowRef.current = nextWorkflow;
    setCreatorWorkflow(nextWorkflow);
    clearError();
  }

  function clearIncomingImageCreationHandoff() {
    clearImageCreationHandoff();
    imageCreationHandoffRef.current = null;
    incomingReferenceAssetIdRef.current = null;
  }

  function cancelContinuationPreparation() {
    continuationRequestIdRef.current += 1;
    continuationAbortControllerRef.current?.abort();
    continuationAbortControllerRef.current = null;
    setIsPreparingContinuation(false);
    setImageCreationHandoffState((current) =>
      current === "PREPARING_REFERENCE" || current === "TRANSIENT_FAILURE"
        ? "IDLE"
        : current
    );
  }

  async function readOwnerImageAssetReference(
    assetId: string,
    signal: AbortSignal
  ) {
    try {
      return await resolveOwnerImageAssetReference({
        assetId,
        token: token ?? "",
        signal
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (
        error instanceof OwnerImageAssetReferenceError &&
        error.terminal
      ) {
        throw new TerminalReferencePreparationError();
      }
      throw error;
    }
  }

  async function prepareImageCreationHandoff(
    handoff: ImageCreationHandoffV1
  ) {
    cancelContinuationPreparation();
    const requestId = continuationRequestIdRef.current + 1;
    continuationRequestIdRef.current = requestId;
    const controller = new AbortController();
    continuationAbortControllerRef.current = controller;
    const sourceSessionId = activeSessionId;
    imageCreationHandoffRef.current = handoff;
    setImageCreationHandoffState("PREPARING_REFERENCE");
    setIsPreparingContinuation(true);

    try {
      const prepared = await withImageReferencePreparationTimeout(
        (async () => {
          const { asset, blob } = await readOwnerImageAssetReference(
            handoff.assetId,
            controller.signal
          );
          let compressed: Awaited<ReturnType<typeof compressReferenceImage>>;
          try {
            compressed = await compressReferenceImage(blob);
          } catch {
            throw new TerminalReferencePreparationError();
          }

          if (!isCompressedImageReferenceUsable(compressed)) {
            throw new TerminalReferencePreparationError();
          }

          return { asset, blob, compressed };
        })(),
        controller
      );
      const { asset, blob, compressed } = prepared;

      if (
        !isMountedRef.current ||
        continuationRequestIdRef.current !== requestId ||
        activeSessionIdRef.current !== sourceSessionId
      ) {
        return;
      }

      const dimensions = {
        width: compressed.sourceWidth,
        height: compressed.sourceHeight
      };
      setReferenceImages([{
        id: createStableImageId("reference"),
        image: {
          dataUrl: compressed.dataUrl,
          mimeType: "image/jpeg",
          name: asset.title?.trim() || t("multimodal.image.referenceLabel"),
          originalBytes: blob.size,
          compressedBytes: compressed.compressedBytes
        },
        dimensions
      }]);
      setReferenceImageCompression({
        status: "compressed",
        originalBytes: blob.size,
        compressedBytes: compressed.compressedBytes
      });
      setFreeCreateCount(1);
      setFreeCreateAspectRatio("auto");
      incomingReferenceAssetIdRef.current = asset.id;
      setContinuationSourceEntryId(null);
      clearError();
      setImageCreationHandoffState("READY");
    } catch (error) {
      if (
        isAbortError(error) ||
        !isMountedRef.current ||
        continuationRequestIdRef.current !== requestId ||
        activeSessionIdRef.current !== sourceSessionId
      ) {
        return;
      }

      if (error instanceof TerminalReferencePreparationError) {
        clearIncomingImageCreationHandoff();
        setPendingImageCreationHandoff(null);
        setImageCreationHandoffState("TERMINAL_FAILURE");
      } else {
        setImageCreationHandoffState("TRANSIENT_FAILURE");
      }
      showError(t("multimodal.image.referencePreparationFailed"), {
        persistent: true
      });
    } finally {
      if (continuationRequestIdRef.current === requestId) {
        continuationAbortControllerRef.current = null;
        setIsPreparingContinuation(false);
      }
    }
  }

  function discardImageCreationReferencePreparation() {
    cancelContinuationPreparation();
    clearIncomingImageCreationHandoff();
    setPendingImageCreationHandoff(null);
    setImageCreationHandoffState("IDLE");
    clearError();
  }

  function retryImageCreationReferencePreparation() {
    const handoff = imageCreationHandoffRef.current;
    if (handoff) {
      const currentHandoff = readImageCreationHandoff();
      if (
        !currentHandoff ||
        currentHandoff.assetId !== handoff.assetId ||
        currentHandoff.issuedAt !== handoff.issuedAt
      ) {
        cancelContinuationPreparation();
        clearIncomingImageCreationHandoff();
        setPendingImageCreationHandoff(null);
        setImageCreationHandoffState("TERMINAL_FAILURE");
        showError(t("multimodal.image.referencePreparationFailed"), {
          persistent: true
        });
        return;
      }

      void prepareImageCreationHandoff(currentHandoff);
      return;
    }

    const source = selectedImageResultVersion;
    if (source) {
      void prepareContinuation(source);
    }
  }

  function keepCurrentImageCreationReference() {
    clearIncomingImageCreationHandoff();
    setPendingImageCreationHandoff(null);
    setImageCreationHandoffState("IDLE");
    clearError();
  }

  async function prepareContinuation(source: ImageResultVersion) {
    cancelContinuationPreparation();
    const requestId = continuationRequestIdRef.current + 1;
    continuationRequestIdRef.current = requestId;
    const controller = new AbortController();
    continuationAbortControllerRef.current = controller;
    const sourceSessionId = activeSessionId;
    const promptRevisionAtStart = promptRevisionRef.current;
    const promptWasEmptyAtStart = promptValueRef.current.trim().length === 0;
    setImageCreationHandoffState("PREPARING_REFERENCE");
    setIsPreparingContinuation(true);

    try {
      if (!isPrivateAssetContentUrl(source.asset.url)) {
        throw new TerminalReferencePreparationError();
      }
      const prepared = await withImageReferencePreparationTimeout(
        (async () => {
          const blob = await fetchPrivateAssetBlob({
            logicalUrl: source.asset.url,
            token: token ?? "",
            signal: controller.signal
          });
          const compressed = await compressReferenceImage(blob);

          if (!isCompressedImageReferenceUsable(compressed)) {
            throw new Error("reference image unavailable");
          }

          return { blob, compressed };
        })(),
        controller
      );
      const { blob, compressed } = prepared;

      if (
        !isMountedRef.current ||
        continuationRequestIdRef.current !== requestId ||
        activeSessionIdRef.current !== sourceSessionId ||
        !imageResultVersionsRef.current.some(
          (version) => version.resultEntryId === source.resultEntryId
        )
      ) {
        return;
      }

      const sourceName =
        source.asset.title?.trim() ||
        t("multimodal.image.versionLabel", { version: source.versionNumber });
      const dimensions = {
        width: compressed.sourceWidth,
        height: compressed.sourceHeight
      };
      setReferenceImages([{
        id: createStableImageId("reference"),
        image: {
          dataUrl: compressed.dataUrl,
          mimeType: "image/jpeg",
          name: sourceName,
          originalBytes: blob.size,
          compressedBytes: compressed.compressedBytes
        },
        dimensions
      }]);
      setReferenceImageCompression({
        status: "compressed",
        originalBytes: blob.size,
        compressedBytes: compressed.compressedBytes
      });
      setFreeCreateCount(1);
      setFreeCreateAspectRatio("auto");
      if (
        promptWasEmptyAtStart &&
        promptRevisionRef.current === promptRevisionAtStart &&
        promptValueRef.current.trim().length === 0
      ) {
        updatePrompt(source.entry.prompt, { memoryEdit: true });
      }
      setContinuationSourceEntryId(source.resultEntryId);
      clearError();
      setImageCreationHandoffState("READY");
    } catch (error) {
      if (
        isAbortError(error) ||
        !isMountedRef.current ||
        continuationRequestIdRef.current !== requestId ||
        activeSessionIdRef.current !== sourceSessionId
      ) {
        return;
      }

      if (error instanceof TerminalReferencePreparationError) {
        setImageCreationHandoffState("TERMINAL_FAILURE");
      } else {
        setImageCreationHandoffState("TRANSIENT_FAILURE");
      }
      showError(
        error instanceof TerminalReferencePreparationError
          ? t("multimodal.image.referencePreparationFailed")
          : t("multimodal.image.continueEditingReadFailed"),
        {
        persistent: true
        }
      );
    } finally {
      if (continuationRequestIdRef.current === requestId) {
        continuationAbortControllerRef.current = null;
        setIsPreparingContinuation(false);
      }
    }
  }

  function selectResultVersion(entryId: string) {
    cancelContinuationPreparation();
    setPendingContinuationEntryId(null);
    if (
      imageResultVersions.some(
        (version) =>
          version.resultEntryId === entryId || version.entry.id === entryId
      )
    ) {
      setSelectedResultEntryId(entryId);
    }
  }

  function continueEditingVersion(selectedVersion: ImageResultVersion) {
    if (
      referencePreparationLocked ||
      !isPrivateAssetContentUrl(selectedVersion.asset.url)
    ) {
      return;
    }

    if (referenceImage) {
      setPendingContinuationEntryId(selectedVersion.resultEntryId);
      setImageCreationHandoffState("CONFLICT");
      return;
    }

    void prepareContinuation(selectedVersion);
  }

  function continueEditingSelectedVersion() {
    if (selectedImageResultVersion) {
      continueEditingVersion(selectedImageResultVersion);
    }
  }

  function confirmContinuation() {
    const pendingEntryId = pendingContinuationEntryId;
    setPendingContinuationEntryId(null);
    const source = imageResultVersions.find(
      (version) => version.resultEntryId === pendingEntryId
    );

    if (source) {
      void prepareContinuation(source);
    }
  }

  function confirmImageCreationHandoffReplacement() {
    const handoff = pendingImageCreationHandoff;
    setPendingImageCreationHandoff(null);
    if (handoff) {
      void prepareImageCreationHandoff(handoff);
    }
  }

  function cancelContinuationConfirmation() {
    setPendingContinuationEntryId(null);
    setImageCreationHandoffState("IDLE");
  }

  async function selectReferenceImageForTarget(
    files: readonly File[],
    target: ReferenceImageStateTarget
  ) {
    if (files.length === 0) return;

    const existing = target.replaceExisting ? [] : target.currentImages;
    if (target.maxReferences === 0) {
      if (!target.maySurfaceFeedback || target.maySurfaceFeedback()) {
        showError(t("multimodal.error.modelDoesNotSupportReferences"));
      }
      return;
    }
    if (existing.length + files.length > target.maxReferences) {
      if (!target.maySurfaceFeedback || target.maySurfaceFeedback()) {
        showError(t("multimodal.error.tooManyReferences", {
          max: target.maxReferences
        }));
      }
      return;
    }

    for (const file of files) {
      const validation = validateReferenceImageFile(file);
      if (!validation.valid) {
        target.setCompression(validation.state);
        if (!target.maySurfaceFeedback || target.maySurfaceFeedback()) {
          showError(t(validation.errorKey));
        }
        return;
      }
    }

    target.setCompression({ status: "compressing" });
    const prepared: SelectedReferenceImage[] = [];
    try {
      for (const file of files) {
        const compressed = await compressReferenceImage(file);
        if (target.isCurrent && !target.isCurrent()) return;
        if (!isCompressedImageReferenceUsable(compressed)) {
          target.setCompression({ status: "too-large-compressed" });
          if (!target.maySurfaceFeedback || target.maySurfaceFeedback()) {
            showError(t("multimodal.error.referenceImageCompressedTooLarge"));
          }
          return;
        }
        prepared.push({
          id: createStableImageId("reference"),
          image: {
            dataUrl: compressed.dataUrl,
            mimeType: "image/jpeg",
            name: file.name,
            originalBytes: file.size,
            compressedBytes: compressed.compressedBytes
          },
          dimensions: {
            width: compressed.sourceWidth,
            height: compressed.sourceHeight
          }
        });
      }

      target.setImages([...existing, ...prepared]);
      const last = prepared[prepared.length - 1];
      target.setCompression(last ? {
        status: "compressed",
        originalBytes: last.image.originalBytes ?? 0,
        compressedBytes: last.image.compressedBytes ?? 0
      } : { status: "idle" });
      if (!target.maySurfaceFeedback || target.maySurfaceFeedback()) clearError();
    } catch {
      if (target.isCurrent && !target.isCurrent()) return;
      target.setCompression({ status: "failed" });
      if (!target.maySurfaceFeedback || target.maySurfaceFeedback()) {
        showError(t("multimodal.error.referenceImageCompressFailed"));
      }
    }
  }

  async function selectReferenceImage(files: readonly File[]) {
    if (referenceMutationLocked) {
      return;
    }
    cancelContinuationPreparation();
    setImageCreationHandoffState("IDLE");
    if (incomingReferenceAssetIdRef.current) {
      clearIncomingImageCreationHandoff();
    }
    setContinuationSourceEntryId(null);
    clearError();
    const selectionId = ++referenceSelectionIdRef.current;
    await selectReferenceImageForTarget(files, {
      currentImages: referenceImages,
      maxReferences: activeReferenceLimit,
      replaceExisting: isPrecisionEditWorkflow,
      setImages: setReferenceImages,
      setCompression: setReferenceImageCompression,
      isCurrent: () => referenceSelectionIdRef.current === selectionId
    });
  }

  async function selectTitleCoverReferenceImage(files: readonly File[]) {
    if (titleCoverReferenceMutationLocked) {
      return;
    }
    if (creatorWorkflowRef.current === "title-cover") {
      clearError();
    }
    const selectionId = ++titleCoverReferenceSelectionIdRef.current;
    await selectReferenceImageForTarget(files, {
      currentImages: titleCoverReferenceImages,
      maxReferences: selectedModelMaxReferenceImages,
      replaceExisting: false,
      setImages: setTitleCoverReferenceImages,
      setCompression: setTitleCoverReferenceImageCompression,
      isCurrent: () => titleCoverReferenceSelectionIdRef.current === selectionId,
      maySurfaceFeedback: () => creatorWorkflowRef.current === "title-cover"
    });
  }

  const referenceImageStatusText =
    referenceImageCompression.status === "compressing"
      ? t("multimodal.image.referenceCompressing")
      : referenceImageLabel
        ? t("multimodal.image.referenceSelected", {
            name: referenceImageLabel
          })
        : t("multimodal.image.referenceHint");

  function applyQuickInspiration(promptValue: string) {
    clearError();
    updatePrompt(promptValue, { memoryEdit: true });
  }

  function applyRandomInspiration() {
    const prompts = quickInspirationCards
      .map((card) => card.prompt.trim())
      .filter((promptValue) => promptValue.length > 0);
    const promptValue = prompts[Math.floor(Math.random() * prompts.length)];

    if (promptValue) {
      applyQuickInspiration(promptValue);
    }
  }

  function removeReferenceImage(id?: string) {
    cancelContinuationPreparation();
    if (incomingReferenceAssetIdRef.current) {
      clearIncomingImageCreationHandoff();
    }
    setPendingContinuationEntryId(null);
    setContinuationSourceEntryId(null);
    clearError();
    setReferenceImages((current) =>
      id ? current.filter((reference) => reference.id !== id) : []
    );
    setReferenceImageCompression({ status: "idle" });
    setImageCreationHandoffState("IDLE");
  }

  function removeTitleCoverReferenceImage(id?: string) {
    titleCoverReferenceSelectionIdRef.current += 1;
    setTitleCoverReferenceImages((current) =>
      id ? current.filter((reference) => reference.id !== id) : []
    );
    setTitleCoverReferenceImageCompression({ status: "idle" });
    setIsTitleCoverReferenceDragActive(false);
    clearError();
  }

  function moveReferenceImage(id: string, direction: -1 | 1) {
    setReferenceImages((current) =>
      moveSelectedReferenceImage(current, id, direction)
    );
    clearError();
  }

  function moveTitleCoverReferenceImage(id: string, direction: -1 | 1) {
    setTitleCoverReferenceImages((current) =>
      moveSelectedReferenceImage(current, id, direction)
    );
    clearError();
  }

  function startNewDrawing() {
    if (creatingImageSessionRef.current) {
      return;
    }

    if (isTitleCoverGenerationActive || isForeignWorkflowGenerationActive) {
      return;
    }

    if (isTitleCoverWorkflow) {
      const hasTitleCoverDraft =
        titleCoverDraft.originalTitle.trim().length > 0 ||
        titleCoverDraft.mainCopy.trim().length > 0 ||
        titleCoverDraft.secondaryCopy.trim().length > 0 ||
        titleCoverDraft.style !== defaultTitleCoverStyle ||
        titleCoverAspectRatio !== "16:9" ||
        titleCoverCount !== defaultImageGenerationCount ||
        Boolean(titleCoverReferenceImage);

      if (hasTitleCoverDraft) {
        if (isDiscardDraftOpenRef.current) {
          return;
        }
        isDiscardDraftOpenRef.current = true;
        setIsDiscardImageDraftOpen(true);
        return;
      }

      resetTitleCoverWorkflow();
      clearError();
      setIsModelPickerOpen(false);
      setIsRatioPickerOpen(false);
      setIsCountPickerOpen(false);
      closeMobileDrawer?.();
      return;
    }

    const currentEntries = (activeSession?.entries ?? []).filter(
      (entry) => (entry.workflow ?? "free-create") !== "title-cover"
    );
    const isCurrentSessionEmpty = currentEntries.length === 0;
    const hasDraft = isTitleCoverWorkflow
      ? titleCoverDraft.originalTitle.trim().length > 0 ||
        titleCoverDraft.mainCopy.trim().length > 0 ||
        titleCoverDraft.secondaryCopy.trim().length > 0 ||
        Boolean(titleCoverReferenceImage)
      : prompt.trim().length > 0;

    if (isCurrentSessionEmpty && !hasDraft) {
      if (isTitleCoverWorkflow) {
        resetTitleCoverWorkflow();
      } else {
        removeReferenceImage();
      }
      clearRetryableImageGenerationSnapshot();
      clearError();
      setIsModelPickerOpen(false);
      setIsRatioPickerOpen(false);
      setIsCountPickerOpen(false);
      setSelectedResultEntryId(null);
      setPendingContinuationEntryId(null);
      closeMobileDrawer?.();
      return;
    }

    if (hasDraft) {
      if (isDiscardDraftOpenRef.current) {
        return;
      }
      isDiscardDraftOpenRef.current = true;
      setIsDiscardImageDraftOpen(true);
      return;
    }

    creatingImageSessionRef.current = true;

    try {
      const nextSessionId = createImageSessionId();
      stopImageGenerationRun();
      clearRetryableImageGenerationSnapshot();
      clearError();
      if (isTitleCoverWorkflow) {
        resetTitleCoverWorkflow();
      } else {
        updatePrompt("");
        removeReferenceImage();
      }
      setSelectedResultEntryId(null);
      setPendingContinuationEntryId(null);
      setImageSessions((currentSessions) => [
        {
          id: nextSessionId,
          title: t("multimodal.image.newDrawing"),
          entries: [],
          titleCoverCreationId: createImageEntryId()
        },
        ...currentSessions
      ]);
      setActiveSessionId(nextSessionId);
      if (!isTitleCoverWorkflow) {
        setFreeCreateAspectRatio("auto");
      }
      setIsModelPickerOpen(false);
      setIsRatioPickerOpen(false);
      closeMobileDrawer?.();
    } finally {
      creatingImageSessionRef.current = false;
    }
  }

  function handleDiscardImageDraftConfirm() {
    isDiscardDraftOpenRef.current = false;
    setIsDiscardImageDraftOpen(false);
    if (isTitleCoverGenerationActive || isForeignWorkflowGenerationActive) {
      return;
    }
    if (isTitleCoverWorkflow) {
      resetTitleCoverWorkflow();
      clearError();
      setIsModelPickerOpen(false);
      setIsRatioPickerOpen(false);
      setIsCountPickerOpen(false);
      closeMobileDrawer?.();
      return;
    }

    stopImageGenerationRun();
    clearRetryableImageGenerationSnapshot();
    clearError();
    updatePrompt("");
    removeReferenceImage();
    setSelectedResultEntryId(null);
    setPendingContinuationEntryId(null);

    const currentEntries = (activeSession?.entries ?? []).filter(
      (entry) => (entry.workflow ?? "free-create") !== "title-cover"
    );
    if (currentEntries.length > 0) {
      const nextSessionId = createImageSessionId();
      setImageSessions((currentSessions) => [
        {
          id: nextSessionId,
          title: t("multimodal.image.newDrawing"),
          entries: [],
          titleCoverCreationId: createImageEntryId()
        },
        ...currentSessions
      ]);
      setActiveSessionId(nextSessionId);
    }
    if (!isTitleCoverWorkflow) {
      setFreeCreateAspectRatio("auto");
    }
    setIsModelPickerOpen(false);
    setIsRatioPickerOpen(false);
    setIsCountPickerOpen(false);
    closeMobileDrawer?.();
  }

  function handleDiscardImageDraftCancel() {
    isDiscardDraftOpenRef.current = false;
    setIsDiscardImageDraftOpen(false);
  }

  function deleteImageSession(
    sessionId: string,
    event: React.MouseEvent<HTMLButtonElement>
  ) {
    event.stopPropagation();
    cancelContinuationPreparation();
    setSelectedResultEntryId(null);
    setPendingContinuationEntryId(null);
    clearError();
    setImageSessions((currentSessions) => {
      if (
        isBackendImageHistorySessionId(sessionId) ||
        currentSessions.length <= 1
      ) {
        markBackendHistoryDismissed();
      }

      if (!isBackendImageHistorySessionId(sessionId)) {
        markImageSessionDismissed(sessionId);
      }

      const remainingSessions = currentSessions.filter(
        (session) => session.id !== sessionId
      );

      if (sessionId !== activeSessionId) {
        return remainingSessions;
      }

      const nextActiveSession =
        remainingSessions[0] ?? {
          id: createImageSessionId(),
          title: t("multimodal.image.newDrawing"),
          entries: [],
          titleCoverCreationId: createImageEntryId()
        };
      const nextSessions =
        remainingSessions.length > 0 ? remainingSessions : [nextActiveSession];

      setActiveSessionId(nextActiveSession.id);
      updatePrompt("");
      setReferenceImages([]);
      setReferenceImageCompression({ status: "idle" });
      setContinuationSourceEntryId(null);
      setPendingContinuationEntryId(null);
      return nextSessions;
    });
  }

  function switchImageSession(session: ImageSession) {
    clearError();
    setActiveSessionId(session.id);
    updatePrompt("");
    removeReferenceImage();
    setSelectedResultEntryId(null);
    setPendingContinuationEntryId(null);
    setIsModelPickerOpen(false);
    setIsRatioPickerOpen(false);
    closeMobileDrawer?.();
  }

  function selectModel(modelSlug: string) {
    setSelectedModelSlug(modelSlug);
    setIsModelPickerOpen(false);
  }

  function selectAspectRatio(ratio: ImageAspectRatio) {
    if (isLoading || (!isTitleCoverWorkflow && referencePreparationLocked)) {
      return;
    }
    setActiveAspectRatio(ratio);
    setIsRatioPickerOpen(false);
  }

  function selectGenerationCount(nextCount: AiGenerationCount) {
    if (isLoading || (!isTitleCoverWorkflow && referencePreparationLocked)) {
      return;
    }
    setActiveGenerationCount(nextCount);
    setIsCountPickerOpen(false);
  }

  function handleReferenceDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    if (referenceMutationLocked) {
      event.dataTransfer.dropEffect = "none";
      setIsReferenceDragActive(false);
      return;
    }
    event.dataTransfer.dropEffect = "copy";
    setIsReferenceDragActive(true);
  }

  function handleReferenceDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsReferenceDragActive(false);
    }
  }

  function handleReferenceDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsReferenceDragActive(false);
    if (referenceMutationLocked) {
      return;
    }
    void selectReferenceImage(Array.from(event.dataTransfer.files ?? []));
  }

  function handleTitleCoverReferenceDragOver(
    event: React.DragEvent<HTMLElement>
  ) {
    event.preventDefault();
    if (titleCoverReferenceMutationLocked) {
      event.dataTransfer.dropEffect = "none";
      setIsTitleCoverReferenceDragActive(false);
      return;
    }
    event.dataTransfer.dropEffect = "copy";
    setIsTitleCoverReferenceDragActive(true);
  }

  function handleTitleCoverReferenceDragLeave(
    event: React.DragEvent<HTMLElement>
  ) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsTitleCoverReferenceDragActive(false);
    }
  }

  function handleTitleCoverReferenceDrop(
    event: React.DragEvent<HTMLElement>
  ) {
    event.preventDefault();
    setIsTitleCoverReferenceDragActive(false);
    if (titleCoverReferenceMutationLocked) {
      return;
    }
    void selectTitleCoverReferenceImage(Array.from(event.dataTransfer.files ?? []));
  }

  const workspaceLabels = {
    title: t("multimodal.image.workbenchTitle"),
    description: t("multimodal.image.workbenchDescription"),
    freeCreation: t("multimodal.image.freeCreation"),
    parameters: t("multimodal.image.parameters"),
    prompt: t("multimodal.image.workbenchPrompt"),
    promptPlaceholder: t("multimodal.image.promptPlaceholder"),
    reference: t("multimodal.image.workbenchReference"),
    referenceOptional: t("multimodal.image.referenceOptional"),
    referenceFileHint: t("multimodal.image.referenceFileHint"),
    addReference: t("multimodal.image.addReference"),
    replaceReference: t("multimodal.image.replaceReference"),
    uploadReference: t("multimodal.image.uploadReference"),
    removeReference: t("multimodal.image.removeReference"),
    references: t("multimodal.image.references"),
    addReferences: t("multimodal.image.addReferences"),
    referenceCount: (count: number, max: number) =>
      t("multimodal.image.referenceCount", { count, max }),
    moveReferenceEarlier: (index: number) =>
      t("multimodal.image.moveReferenceEarlier", { index }),
    moveReferenceLater: (index: number) =>
      t("multimodal.image.moveReferenceLater", { index }),
    referenceNumber: (index: number) =>
      t("multimodal.image.referenceNumber", { index }),
    modelDoesNotSupportReferences: t(
      "multimodal.image.modelDoesNotSupportReferences"
    ),
    referenceLimitExceeded: t("multimodal.image.referenceLimitExceeded", {
      max: activeReferenceLimit
    }),
    model: t("multimodal.model"),
    noModels: t("multimodal.image.noModels"),
    mobileNoModelAvailable: t("multimodal.image.mobileNoModelAvailable"),
    mobileReference: t("multimodal.image.mobileReference"),
    mobileGenerate: t("multimodal.image.mobileGenerate"),
    aspectRatio: t("multimodal.image.aspectRatio"),
    pixelSize: t("multimodal.image.pixelSize"),
    size: t("multimodal.size"),
    parameterHint: t("multimodal.image.workbenchParameterHint"),
    quantity: t("multimodal.count"),
    quantityOption: (quantity: AiGenerationCount) =>
      t("multimodal.image.quantityOption", { count: quantity }),
    randomInspiration: t("multimodal.image.randomInspiration"),
    newDrawing: t("multimodal.image.newDrawing"),
    cost: t("multimodal.image.workbenchCost"),
    balance: t("multimodal.image.workbenchBalance"),
    generate: t("multimodal.image.generate"),
    regenerate: t("multimodal.image.regenerate"),
    reusePrompt: t("multimodal.image.reusePrompt"),
    resumeRequest: t("multimodal.image.resumeRequest"),
    retryAsNewRequest: t("multimodal.image.retryAsNewRequest"),
    generating: t("multimodal.generating"),
    result: t("multimodal.image.workbenchResult"),
    empty: t("multimodal.image.workbenchEmpty"),
    loading: t("multimodal.image.workbenchLoading"),
    checking: t("multimodal.image.workbenchChecking"),
    failed: t("multimodal.error.generateFailed"),
    imageAlt: t("multimodal.asset.image"),
    viewTask: t("multimodal.viewTaskDetail"),
    viewAsset: t("multimodal.image.viewWork"),
    download: t("multimodal.image.download"),
    batchResults: isTitleCoverWorkflow
      ? t("multimodal.image.titleCover.visualCandidates")
      : t("multimodal.image.batchResults"),
    versions: isTitleCoverWorkflow
      ? t("multimodal.image.titleCover.visualCandidates")
      : t("multimodal.image.versions"),
    selected: t("multimodal.image.selectedResult"),
    saved: t("multimodal.image.saved"),
    resultLabel: (index: number) =>
      t("multimodal.image.resultLabel", { index }),
    selectResult: (index: number) =>
      t("multimodal.image.selectResult", { index }),
    partialSuccess: (actual: number, requested: number) =>
      t("multimodal.image.partialSuccess", { actual, requested }),
    resultCountViolation: (requested: number, actual: number) =>
      t("multimodal.image.resultCountViolation", { requested, actual }),
    versionLabel: t("multimodal.image.versionLabel"),
    selectVersion: t("multimodal.image.selectVersion"),
    continueEditing: t("multimodal.image.continueEditing"),
    useAsReference: t("multimodal.image.useAsReference"),
    preparingContinuation: t("multimodal.image.preparingContinuation"),
    preparingReference: t("multimodal.image.preparingReference"),
    referencePreparationFailed: t(
      "multimodal.image.referencePreparationFailed"
    ),
    retryReference: t("multimodal.image.retryReference"),
    discardReference: t("multimodal.image.discardReference"),
    basedOnVersion: t("multimodal.image.basedOnVersion"),
    generatingNewVersion: t("multimodal.image.generatingNewVersion"),
    workflows: {
      freeCreate: t("multimodal.image.workflow.freeCreate"),
      referenceEdit: t("multimodal.image.workflow.referenceEdit"),
      titleCover: t("multimodal.image.workflow.titleCover"),
      transcriptImages: t("multimodal.image.workflow.transcriptImages")
    },
    transcriptImages: {
      title: t("multimodal.image.transcriptImages.title"),
      description: t("multimodal.image.transcriptImages.description"),
      transcriptLabel: t("multimodal.image.transcriptImages.transcriptLabel"),
      transcriptPlaceholder: t(
        "multimodal.image.transcriptImages.transcriptPlaceholder"
      ),
      transcriptLength: (current: number, max: number) =>
        t("multimodal.image.transcriptImages.transcriptLength", {
          current,
          max
        }),
      plan: t("multimodal.image.transcriptImages.plan"),
      planning: t("multimodal.image.transcriptImages.planning"),
      planHint: t("multimodal.image.transcriptImages.planHint"),
      sceneLabel: (index: number) =>
        t("multimodal.image.transcriptImages.sceneLabel", { index }),
      sourceLabel: t("multimodal.image.transcriptImages.sourceLabel"),
      promptLabel: t("multimodal.image.transcriptImages.promptLabel"),
      promptPlaceholder: t(
        "multimodal.image.transcriptImages.promptPlaceholder"
      ),
      selectedCount: (selected: number, max: number) =>
        t("multimodal.image.transcriptImages.selectedCount", {
          selected,
          max
        }),
      generateSelected: t(
        "multimodal.image.transcriptImages.generateSelected"
      ),
      generatingSelected: t(
        "multimodal.image.transcriptImages.generatingSelected"
      ),
      selectionHint: t("multimodal.image.transcriptImages.selectionHint"),
      imageAlt: t("multimodal.asset.image"),
      status: (status: TranscriptSceneStatus) =>
        t(`multimodal.image.transcriptImages.status.${status}`)
    },
    precisionEdit: {
      instruction: t("multimodal.image.precisionEdit.instruction"),
      promptPlaceholder: t("multimodal.image.precisionEdit.promptPlaceholder"),
      sourceLabel: t("multimodal.image.precisionEdit.sourceLabel"),
      sourceHint: t("multimodal.image.precisionEdit.sourceHint"),
      sourceEmpty: t("multimodal.image.precisionEdit.sourceEmpty"),
      resultLabel: t("multimodal.image.precisionEdit.resultLabel"),
      resultDescription: t("multimodal.image.precisionEdit.resultDescription")
    },
    titleCover: {
      originalTitle: t("multimodal.image.titleCover.originalTitle"),
      originalTitlePlaceholder: t(
        "multimodal.image.titleCover.originalTitlePlaceholder"
      ),
      mainCopy: t("multimodal.image.titleCover.mainCopy"),
      mainCopyPlaceholder: t(
        "multimodal.image.titleCover.mainCopyPlaceholder"
      ),
      secondaryCopy: t("multimodal.image.titleCover.secondaryCopy"),
      secondaryCopyPlaceholder: t(
        "multimodal.image.titleCover.secondaryCopyPlaceholder"
      ),
      reference: t("multimodal.image.titleCover.reference"),
      referenceHint: t("multimodal.image.titleCover.referenceHint"),
      referenceEmpty: t("multimodal.image.titleCover.referenceEmpty"),
      referenceCompressing: t(
        "multimodal.image.titleCover.referenceCompressing"
      ),
      referenceSelected: (name: string) =>
        t("multimodal.image.titleCover.referenceSelected", { name }),
      referenceCompressFailed: t(
        "multimodal.error.referenceImageCompressFailed"
      ),
      referenceOriginalTooLarge: t(
        "multimodal.error.referenceImageOriginalTooLarge"
      ),
      referenceCompressedTooLarge: t(
        "multimodal.error.referenceImageCompressedTooLarge"
      ),
      style: t("multimodal.image.titleCover.style"),
      styleOptions: titleCoverStyles.map((value) => ({
        value,
        label: t(`multimodal.image.titleCover.style.${value}`)
      })),
      typographyPreset: t("multimodal.image.titleCover.typographyPreset"),
      typographyPresetOptions: titleCoverTypographyPresets.map((value) => ({
        value,
        label: t(`multimodal.image.titleCover.typographyPreset.${value}`)
      })),
      mainColor: t("multimodal.image.titleCover.mainColor"),
      secondaryColor: t("multimodal.image.titleCover.secondaryColor"),
      advancedSettings: t("multimodal.image.titleCover.advancedSettings"),
      generate: t("multimodal.image.titleCover.generate"),
      resultLabel: t("multimodal.image.titleCover.resultLabel"),
      resultDescription: t("multimodal.image.titleCover.resultDescription"),
      resultEmpty: t("multimodal.image.titleCover.resultEmpty"),
      visualCandidates: t("multimodal.image.titleCover.visualCandidates"),
      preview: t("multimodal.image.titleCover.preview"),
      previewDescription: t("multimodal.image.titleCover.previewDescription"),
      historicalVisualBase: t("multimodal.image.titleCover.historicalVisualBase"),
      noCopy: t("multimodal.image.titleCover.noCopy"),
      loading: t("multimodal.image.titleCover.loading"),
      rendering: t("multimodal.image.titleCover.rendering"),
      loadFailed: t("multimodal.image.titleCover.loadFailed"),
      renderFailed: t("multimodal.image.titleCover.renderFailed"),
      overflow: t("multimodal.image.titleCover.overflow"),
      download: t("multimodal.image.titleCover.download"),
      exporting: t("multimodal.image.titleCover.exporting"),
      exportFailed: t("multimodal.image.titleCover.exportFailed")
    },
    history: t("multimodal.image.mobileHistory"),
    comingSoon: t("multimodal.image.comingSoon"),
    workflowSoon: t("multimodal.image.workflowSoon"),
    loginRequired: t("multimodal.error.loginRequired")
  };
  const visibleError =
    error && isGenerationFeedbackVisibleFor(error.workflow) ? error : null;

  return (
      <div
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-visible bg-white px-0 py-0 dark:bg-slate-950 md:overflow-hidden md:bg-slate-50 md:px-5 md:py-4 md:dark:bg-slate-950 lg:px-6"
      data-image-workspace-root="true"
      data-image-creation-mode={creationMode}
      data-image-reference-preparation-state={imageCreationHandoffState}
      data-image-mobile-top-card="absent"
      data-image-mobile-full-bleed="true"
      data-image-mobile-outer-frame="absent"
    >
      <header
        className="relative z-30 shrink-0 bg-white px-3 pb-2 pt-3 dark:bg-slate-950 md:hidden"
        data-image-mobile-header="true"
      >
        <div className="flex min-w-0 items-start gap-2">
          <div className="relative min-w-0 flex-1">
            <CreationSurfaceSwitcher activeSurface="image" />
          </div>
          <button
            type="button"
            disabled
            className="inline-flex min-h-10 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full border border-slate-200 px-2.5 text-slate-400 dark:border-slate-700"
            aria-label={t("multimodal.image.inspirationLibrary")}
            data-image-mobile-inspiration-disabled="true"
          >
            <Star className="size-4" aria-hidden="true" />
            <span className="text-xs font-semibold">{t("multimodal.image.inspirationLibrary")}</span>
            <span className="rounded-full bg-slate-100 px-1 py-0.5 text-[9px] font-semibold dark:bg-slate-800">{t("multimodal.image.workflowSoon")}</span>
          </button>
          {historyDetail ? (
            <Link
              href="/image/history"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-800 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={t("multimodal.image.historyBack")}
              data-image-history-detail-back="true"
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
            </Link>
          ) : null}
          <Link
            href="/image/history"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-800 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            aria-label={t("multimodal.image.mobileHistory")}
            data-image-mobile-history-button="true"
          >
            <History className="size-6" aria-hidden="true" />
          </Link>
          <button
            type="button"
            disabled={
              isTitleCoverGenerationActive || isForeignWorkflowGenerationActive
            }
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-indigo-600 transition hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            onClick={startNewDrawing}
            aria-label={t("multimodal.image.newDrawing")}
            title={t("multimodal.image.newDrawing")}
            data-image-mobile-new-drawing="true"
            data-image-new-drawing-btn="true"
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div
        className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
        data-image-workspace-grid="true"
      >
        {showLegacyImageSidebar ? (
          <aside
            className={`hidden h-full min-h-0 min-w-0 shrink-0 overflow-x-hidden overflow-y-auto bg-slate-50/80 dark:bg-slate-950 lg:flex lg:flex-col lg:content-start lg:gap-5 ${
              isImageSidebarCollapsed
                ? "lg:items-center px-2 py-4"
                : "px-1 py-4"
            }`}
            data-image-secondary-sidebar="true"
            data-image-secondary-sidebar-collapsed={isImageSidebarCollapsed ? "true" : "false"}
        >
          <SecondarySidebarHeader
            icon={WandSparkles}
            title={t("multimodal.image.sidebarTitle")}
            collapsed={isImageSidebarCollapsed}
            onToggle={() => setIsImageSidebarCollapsed(!isImageSidebarCollapsed)}
            toggleLabel={
              isImageSidebarCollapsed
                ? t("workspace.expandSidebar")
                : t("workspace.collapseSidebar")
            }
            dataCollapseAttr="data-image-sidebar-collapse"
            dataExpandAttr="data-image-sidebar-expand"
          />

          {!isImageSidebarCollapsed ? (
            <div
              className="grid min-w-0 grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
              data-image-desktop-mode-switch="true"
            >
              <button
                type="button"
                className={`min-w-0 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                  isQuickCreateMode
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
                onClick={() => selectCreationMode("quick")}
                data-image-desktop-mode="quick"
                data-image-desktop-mode-active={isQuickCreateMode ? "true" : "false"}
              >
                {t("multimodal.image.quickCreate")}
              </button>
              <button
                type="button"
                className={`min-w-0 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                  !isQuickCreateMode
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
                onClick={() => selectCreationMode("workspace")}
                data-image-desktop-mode="workspace"
                data-image-desktop-mode-active={!isQuickCreateMode ? "true" : "false"}
              >
                {t("multimodal.image.workbench")}
              </button>
            </div>
          ) : null}

          <div className={isImageSidebarCollapsed ? "flex justify-center" : ""}>
            <SidebarNewSessionButton
              label={t("multimodal.image.newDrawing")}
              collapsed={isImageSidebarCollapsed}
              isLoggedIn={isLoggedInForSidebar}
              loginHint={t("chat.loginToSave")}
              loginLabel={t("nav.login")}
              onCreateSession={startNewDrawing}
              dataAttr="data-image-new-drawing-btn"
            />
          </div>

          {!isImageSidebarCollapsed ? (
            <>
              <section className="grid min-w-0 gap-2">
                <SidebarSectionLabel
                  icon={Sparkles}
                  label={t("multimodal.image.featuredModels")}
                />
                {models.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-4 text-sm text-slate-500 dark:text-slate-400">
                    {t("multimodal.image.noModels")}
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-1">
                    {models.map((model) => {
                      const isSelected = selectedModelSlug === model.slug;

                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                            isSelected
                              ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 ring-1 ring-indigo-100 dark:ring-indigo-900"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-950 dark:hover:text-slate-100"
                          }`}
                          onClick={() => setSelectedModelSlug(model.slug)}
                          data-image-model-option="true"
                          data-image-model-current={isSelected ? "true" : undefined}
                        >
                          <ModelIcon
                            model={model}
                            selected={isSelected}
                            className="size-8 rounded-xl"
                            imageClassName="size-4"
                          />
                          <span className="min-w-0 flex-1 truncate font-semibold">
                            {getModelDisplayName(model)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <Link
                  href="/models"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400"
                  data-more-models-link="true"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t("multimodal.image.moreModels")}</span>
                </Link>
              </section>

              <section className="grid min-w-0 gap-2">
                <SidebarSectionLabel
                  icon={Clock3}
                  label={t("multimodal.image.records")}
                />
                {imageSessions.length > 0 ? (
                  <div
                    className="grid min-w-0 gap-1 overflow-x-hidden"
                    data-image-history-sessions="true"
                    data-image-session-update="append-results"
                    data-image-session-switch="shows-session-results"
                    data-image-records-list="true"
                  >
                    {imageSessions.map((session) => (
                      <WorkspaceHistoryItem
                        key={session.id}
                        id={session.id}
                        title={session.title}
                        isActive={session.id === activeSessionId}
                        deleteLabel={t("multimodal.image.deleteSession")}
                        onSelect={() => switchImageSession(session)}
                        onDelete={() => {
                          const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent<HTMLButtonElement>;
                          deleteImageSession(session.id, fakeEvent);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-4 text-sm text-slate-500 dark:text-slate-400">
                    {t("multimodal.image.recordsEmpty")}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </aside>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible md:overflow-hidden">
          <section
            ref={imageMainScrollRef}
            className={`min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950 sm:p-5 md:pb-4 ${
              showLegacyModePresentation && isQuickCreateMode ? "pb-44" : "pb-6"
            }`}
            data-image-main-scroll="true"
            data-image-mobile-single-scroll="true"
            data-image-mobile-rounded-shell="absent"
            data-image-scroll-policy="submitted-entry-only"
            onScroll={handleImageMainScroll}
            onLoadCapture={handleImageMainContentLoad}
            onErrorCapture={handleImageMainContentLoad}
            onKeyDown={handleImageMainKeyboardInteraction}
            onWheel={handleImageMainUserInteraction}
            onPointerDown={handleImageMainUserInteraction}
            onTouchMove={handleImageMainUserInteraction}
          >
            {showLegacyModePresentation && isQuickCreateMode ? (
              imageStream.length === 0 ? (
              <div
                className="mx-auto flex min-h-full max-w-5xl min-w-0 flex-col justify-center gap-4 py-2 md:gap-5 md:py-4"
                data-image-empty-state="true"
              >
                {!isQuickCreateMode || visibleQuickInspirationCards.length === 0 ? (
                  <div
                    className="mx-auto grid max-w-4xl min-w-0 justify-items-center gap-2 text-center"
                    data-image-empty-guidance="true"
                  >
                    <div className="hidden h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 md:flex">
                      <Images className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <h2 className="text-2xl font-semibold tracking-normal text-slate-950 dark:text-slate-100 sm:text-3xl">
                      {t("multimodal.image.workspaceTitle")}
                    </h2>
                    <p className="max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400 md:text-base">
                      {t("multimodal.image.workspaceDescription")}
                    </p>
                  </div>
                ) : null}

                {isQuickCreateMode && visibleQuickInspirationCards.length > 0 ? (
                  <div
                    className="min-w-0"
                    data-image-quick-inspiration="true"
                  >
                    <ImagePromptRecommendationCarousel
                      cards={visibleQuickInspirationCards}
                      workspaceTitle={t("multimodal.image.workspaceTitle")}
                      workspaceDescription={t("multimodal.image.workspaceDescription")}
                      usePromptLabel={t("multimodal.image.usePrompt")}
                      promptExpandLabel={t("multimodal.image.promptExpand")}
                      promptCollapseLabel={t("multimodal.image.promptCollapse")}
                      previousLabel={t("multimodal.image.previousImage")}
                      nextLabel={t("multimodal.image.nextImage")}
                      previewLabels={{
                        close: t("multimodal.image.closePreview"),
                        zoomIn: t("multimodal.image.zoomIn"),
                        zoomOut: t("multimodal.image.zoomOut"),
                        fit: t("multimodal.image.fitPreview"),
                        loading: t("multimodal.image.loadingPreview"),
                        loadFailed: t("multimodal.image.loadFailedPreview")
                      }}
                      onUsePrompt={applyQuickInspiration}
                    />
                  </div>
                ) : null}
              </div>
              ) : (
              <div
                className="mx-auto grid max-w-4xl min-w-0 gap-5 pb-4"
                data-image-conversation-stream="true"
                data-image-mobile-result-flow="minimal"
              >
                {displayImageStream.map((entry) => {
                  const entryWorkflow = entry.workflow ?? "free-create";
                  const entryFeedbackVisible =
                    isGenerationFeedbackVisibleFor(entryWorkflow);
                  const userSeed = workspaceUser ? getUserSeed(workspaceUser) : "guest";
                  const modelIdentity = resolveImageEntryModelIdentity(entry);
                  const ModelIdentityIcon = modelIdentity.Icon;
                  const resultEntryIds = new Map<string, number>();
                  const loadingCount = readImageGenerationCount(entry.requestedCount);
                  const acceptedAssets = entry.result
                    ? readAcceptedImageResultAssets(
                        entry.result.assets,
                        entry.result.task.id
                      )
                    : [];
                  const displayAssets = entry.result
                    ? readQuickImageResultAssets(entry.result)
                    : [];

                  return (
                  <div key={entry.id} className="grid min-w-0 gap-4">
                    <div
                      className="flex items-start justify-end gap-2"
                      data-image-user-message="true"
                      data-image-user-message-row="true"
                    >
                      <div className="grid max-w-[min(34rem,85%)] min-w-0 overflow-hidden gap-3 rounded-3xl rounded-tr-lg bg-indigo-600 px-4 py-3 text-sm leading-7 text-white shadow-sm dark:bg-indigo-700 dark:shadow-none">
                        {(entry.referenceImages?.length
                          ? entry.referenceImages
                          : entry.referenceImage
                            ? [entry.referenceImage]
                            : []).length > 0 ? (
                          <div className="flex max-w-full flex-wrap gap-2" data-image-user-reference-thumbnails="true">
                            {(entry.referenceImages?.length
                              ? entry.referenceImages
                              : entry.referenceImage
                                ? [entry.referenceImage]
                                : []).map((reference, index) => (
                              <button
                                key={`${reference.name}-${index}`}
                                type="button"
                                onClick={() => {
                                  setPreviewImageUrl(reference.dataUrl);
                                  setPreviewImageAlt(reference.name);
                                }}
                                className="relative block"
                                data-image-user-reference-thumbnail="true"
                                data-image-user-reference-preview-button="true"
                              >
                                <img
                                  src={reference.dataUrl}
                                  alt={reference.name}
                                  className="h-24 w-24 rounded-xl border border-white/15 object-cover"
                                />
                                <span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1.5 text-[10px] text-white">
                                  {index + 1}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {!entry.referenceImages?.length && !entry.referenceImage &&
                        (entry.referenceImagesMetadata?.length || entry.referenceImageMetadata) ? (
                          <div
                            className="max-w-full rounded-lg border border-white/10 bg-white/10 px-2.5 py-1.5 text-xs leading-5 text-slate-200"
                            data-image-user-reference-metadata="true"
                          >
                            {t("multimodal.image.multipleReferencesHistory", {
                              count: entry.referenceImagesMetadata?.length ?? 1
                            })}
                            {(entry.referenceImagesMetadata?.length
                              ? entry.referenceImagesMetadata
                              : entry.referenceImageMetadata
                                ? [entry.referenceImageMetadata]
                                : []).map((reference, index) => (
                              <div key={`${reference.name ?? "reference"}-${index}`} className="truncate">
                                {index + 1}. {reference.name ?? t("multimodal.image.referenceLabel")}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words">{entry.prompt}</p>
                      </div>
                      <UserAvatar
                        seed={userSeed}
                        displayName={workspaceUser?.name}
                        avatarUrl={workspaceUser?.avatarUrl}
                        token={token}
                        isGuest={!token}
                        size="sm"
                      />
                    </div>
                    <article
                      className="mr-auto grid w-full max-w-3xl min-w-0 gap-3 px-0 py-1"
                      data-image-ai-message="true"
                      data-image-ai-status={entry.status}
                    >
                      <div
                        className="flex items-center gap-2"
                        data-image-ai-model-identity="true"
                      >
                        {modelIdentity.model ? (
                          <ModelIcon
                            model={modelIdentity.model}
                            className="size-8 rounded-xl"
                            imageClassName="size-4"
                          />
                        ) : (
                          <span
                            className="flex size-8 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold text-white"
                            style={{ backgroundColor: modelIdentity.color }}
                            aria-hidden="true"
                          >
                            <modelIdentity.Icon className="size-4" />
                          </span>
                        )}
                        <span
                          className="block max-w-48 truncate text-sm font-semibold text-slate-700 dark:text-slate-300"
                          title={modelIdentity.displayName}
                        >
                          {modelIdentity.displayName}
                        </span>
                      </div>
                      {entry.status === "loading" ? (
                        <div
                          className="grid gap-3 text-sm text-slate-600 dark:text-slate-400"
                          data-image-ai-loading="true"
                        >
                          <div>{t("multimodal.image.generatingMessage")}</div>
                          <div
                            className={`grid min-w-0 gap-3 ${loadingCount > 1 ? "grid-cols-2" : ""}`}
                            data-image-loading-placeholders={String(loadingCount)}
                          >
                            {Array.from({ length: loadingCount }, (_, placeholderIndex) => (
                              <div
                                key={`${entry.id}:loading:${placeholderIndex}`}
                                className="w-full max-w-[28rem] animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700"
                                style={{ aspectRatio: getAspectRatioCssValue(entry.aspectRatio) }}
                                data-image-loading-skeleton="true"
                                data-image-loading-skeleton-index={String(placeholderIndex)}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {entry.status === "checking" ? (
                        <div
                          className="grid gap-3 rounded-xl border border-amber-100 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-400"
                          data-image-ai-checking="true"
                        >
                          <div>{entry.error || checkingSyncMessage()}</div>
                          <div
                            className={`grid min-w-0 gap-3 ${loadingCount > 1 ? "grid-cols-2" : ""}`}
                            data-image-checking-placeholders={String(loadingCount)}
                          >
                            {Array.from({ length: loadingCount }, (_, placeholderIndex) => (
                              <div
                                key={`${entry.id}:checking:${placeholderIndex}`}
                                className="h-40 animate-pulse rounded-xl bg-amber-100/70 dark:bg-amber-900/50"
                                data-image-checking-placeholder="true"
                                data-image-checking-placeholder-index={String(placeholderIndex)}
                              />
                            ))}
                          </div>
                          {entryFeedbackVisible &&
                          canResumeImageGenerationRequest &&
                          !isLoading &&
                          !imageGenerationPostInFlightRef.current &&
                          activeImageGenerationWorkflowRef.current === entryWorkflow &&
                          activeImageGenerationAttemptRef.current?.payload
                            .clientEntryId === entry.clientEntryId ? (
                            <Button
                              type="button"
                              className="w-fit"
                              onClick={() => void resumeImageGenerationRequest()}
                              data-image-resume-request-button="true"
                            >
                              {t("multimodal.image.resumeRequest")}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {entry.status === "failed" ? (
                        <div className="grid gap-3">
                          <p
                            className="rounded-xl border border-red-100 dark:border-red-900 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-red-700 dark:text-red-400"
                            data-image-ai-error="true"
                          >
                            {entry.error || t("multimodal.error.generateFailed")}
                          </p>
                          {entryFeedbackVisible &&
                          retryableImageGenerationSnapshotRef.current &&
                          retryableImageGenerationSnapshotRef.current.workflow ===
                            entryWorkflow &&
                          retryableImageGenerationClientEntryId ===
                            entry.clientEntryId &&
                          retryableImageGenerationSnapshotRef.current
                            .clientEntryId === entry.clientEntryId &&
                          !isLoading &&
                          !imageGenerationPostInFlightRef.current &&
                          !activeImageGenerationAttemptRef.current ? (
                            <Button
                              type="button"
                              className="w-fit"
                              onClick={() =>
                                void retryImageGenerationAsNewRequest()
                              }
                              data-image-retry-as-new-request-button="true"
                            >
                              {t("multimodal.image.retryAsNewRequest")}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {entry.status === "succeeded" && entry.result ? (
                        <div
                          className="grid min-w-0 gap-3"
                          data-image-ai-result="true"
                          data-image-result-batch={entry.result.task.id}
                        >
                          <div
                            className="grid min-w-0 gap-5 sm:grid-cols-2"
                            data-image-result-images-only="true"
                            data-image-result-appends="chronological"
                          >
                            {displayAssets.map((asset) => {
                              const resultEntryId = createImageResultEntryId(
                                entry.result?.task.id ?? entry.id,
                                asset,
                                resultEntryIds
                              );
                              const resultVersion = imageResultVersions.find(
                                (version) => version.resultEntryId === resultEntryId
                              );

                              return (
                                <div key={resultEntryId} className="grid min-w-0 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedResultEntryId(resultEntryId);
                                      setPreviewImageUrl(asset.url);
                                      setPreviewImageAlt(asset.title || t("multimodal.asset.image"));
                                    }}
                                    className="mx-auto block min-w-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm dark:shadow-none transition hover:shadow-md dark:hover:shadow-md"
                                    data-image-result-card="image-only"
                                  >
                                    <ResolvedAssetImage
                                      src={asset.thumbnailUrl ?? asset.url}
                                      token={token}
                                      alt={t("multimodal.asset.image")}
                                      className="max-w-full h-auto object-contain"
                                    />
                                  </button>
                                  {resultVersion && isPrivateAssetContentUrl(resultVersion.asset.url) ? (
                                    <Button
                                      type="button"
                                      className="min-h-11 w-full rounded-xl"
                                      disabled={referencePreparationLocked}
                                      aria-label={`${t("multimodal.image.continueCreating")}: ${t("multimodal.image.useAsReference")}`}
                                      onClick={() => continueEditingVersion(resultVersion)}
                                      data-image-result-continue-creating="true"
                                    >
                                      {t("multimodal.image.continueCreating")}
                                    </Button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                          {acceptedAssets.length > 0 &&
                          acceptedAssets.length < loadingCount ? (
                            <p
                              className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300"
                              data-image-ai-partial-success="true"
                            >
                              {t("multimodal.image.partialSuccess", {
                                actual: acceptedAssets.length,
                                requested: loadingCount
                              })}
                            </p>
                          ) : null}
                          {acceptedAssets.length > loadingCount ? (
                            <p
                              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
                              data-image-result-count-violation="true"
                            >
                              {t("multimodal.image.resultCountViolation", {
                                requested: loadingCount,
                                actual: acceptedAssets.length
                              })}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  </div>
                );})}
              </div>
              )
            ) : (
              <CreationWorkspaceView
                workflow={creatorWorkflow}
                onSelectWorkflow={selectCreatorWorkflow}
                titleCoverDraft={titleCoverDraft}
                titleCoverMainCopyDirty={titleCoverMainCopyDirty}
                onTitleCoverOriginalTitleChange={updateTitleCoverOriginalTitle}
                onTitleCoverMainCopyChange={updateTitleCoverMainCopy}
                onTitleCoverSecondaryCopyChange={updateTitleCoverSecondaryCopy}
                onTitleCoverStyleChange={updateTitleCoverStyle}
                titleCoverTypographyDraft={titleCoverTypographyDraft}
                onTitleCoverTypographyPresetChange={
                  updateTitleCoverTypographyPreset
                }
                onTitleCoverMainColorChange={(value) =>
                  updateTitleCoverTypographyColor("mainColor", value)
                }
                onTitleCoverSecondaryColorChange={(value) =>
                  updateTitleCoverTypographyColor("secondaryColor", value)
                }
                titleCoverReferenceImages={titleCoverReferenceImages}
                titleCoverReferenceImageCompression={
                  titleCoverReferenceImageCompression
                }
                titleCoverReferenceMutationLocked={
                  titleCoverReferenceMutationLocked
                }
                titleCoverReferenceInputRef={titleCoverReferenceInputRef}
                onTitleCoverReferenceImageChange={(file) =>
                  void selectTitleCoverReferenceImage(file)
                }
                onTitleCoverReferenceDragOver={
                  handleTitleCoverReferenceDragOver
                }
                onTitleCoverReferenceDragLeave={
                  handleTitleCoverReferenceDragLeave
                }
                onTitleCoverReferenceDrop={handleTitleCoverReferenceDrop}
                isTitleCoverReferenceDragActive={
                  isTitleCoverReferenceDragActive
                }
                onRemoveTitleCoverReferenceImage={
                  (id) => {
                    if (!titleCoverReferenceMutationLocked) {
                      removeTitleCoverReferenceImage(id);
                    }
                  }
                }
                onMoveTitleCoverReferenceImage={
                  (id, direction) => {
                    if (!titleCoverReferenceMutationLocked) {
                      moveTitleCoverReferenceImage(id, direction);
                    }
                  }
                }
                prompt={prompt}
                onPromptChange={(value) => {
                  clearError();
                  updatePrompt(value, { memoryEdit: true });
                }}
                onPromptKeyDown={handlePromptKeyDown}
                onRandomInspiration={applyRandomInspiration}
                onSubmit={handleGenerateSubmit}
                onStartNewDrawing={startNewDrawing}
                isNewDrawingBlocked={
                  isTitleCoverGenerationActive ||
                  isTranscriptGenerationActive ||
                  isForeignWorkflowGenerationActive
                }
                referenceImages={activeReferenceImages}
                referenceLimit={activeReferenceLimit}
                referenceLimitExceeded={isReferenceLimitExceeded}
                referenceImageStatusText={referenceImageStatusText}
                referenceImageCompression={referenceImageCompression}
                referenceMutationLocked={referenceMutationLocked}
                referenceInputRef={referenceInputRef}
                promptInputRef={promptInputRef}
                onReferenceImageChange={(files) => void selectReferenceImage(files)}
                onReferenceDragOver={handleReferenceDragOver}
                onReferenceDragLeave={handleReferenceDragLeave}
                onReferenceDrop={handleReferenceDrop}
                isReferenceDragActive={isReferenceDragActive}
                onRemoveReferenceImage={(id) => {
                  if (!referenceMutationLocked) {
                    removeReferenceImage(id);
                  }
                }}
                onMoveReferenceImage={(id, direction) => {
                  if (!referenceMutationLocked) {
                    moveReferenceImage(id, direction);
                  }
                }}
                isLoggedIn={isLoggedInForSidebar}
                models={models}
                selectedModelId={selectedModelSlug}
                onSelectModel={selectModel}
                aspectRatio={aspectRatio}
                aspectRatios={imageAspectRatios}
                size={size}
                quantity={generationCount}
                onSelectQuantity={selectGenerationCount}
                onSelectAspectRatio={selectAspectRatio}
                generationMode={generationMode}
                estimatedCost={estimatedCost}
                credits={credits}
                canGenerate={canGenerate}
                isLoading={isLoading}
                latestEntry={
                  workflowDisplayImageStream[
                    workflowDisplayImageStream.length - 1
                  ] ?? null
                }
                resultBatches={visibleImageResultBatches}
                selectedResultBatch={selectedImageResultBatch}
                selectedResultVersion={selectedImageResultVersion}
                continuationSourceVersion={continuationSourceVersion}
                isPreparingContinuation={isPreparingContinuation}
                referencePreparationState={imageCreationHandoffState}
                onRetryReferencePreparation={retryImageCreationReferencePreparation}
                onDiscardReferencePreparation={discardImageCreationReferencePreparation}
                canContinueFromResult={Boolean(
                  !isTitleCoverWorkflow &&
                    selectedImageResultVersion &&
                    isPrivateAssetContentUrl(selectedImageResultVersion.asset.url)
                )}
                onSelectResultVersion={selectResultVersion}
                onContinueEditing={continueEditingSelectedVersion}
                canReusePrompt={Boolean(
                  !isTitleCoverWorkflow &&
                    getReusableImageResultPrompt(selectedImageResultVersion)
                )}
                onReusePrompt={reuseSelectedPrompt}
                canResumeRequest={
                  canResumeCurrentWorkflow &&
                  !isLoading &&
                  !imageGenerationPostInFlightRef.current
                }
                onResumeRequest={() => void resumeImageGenerationRequest()}
                canRetryAsNewRequest={Boolean(
                  retryableImageGenerationSnapshotRef.current &&
                    retryableImageGenerationSnapshotRef.current.workflow ===
                      creatorWorkflow &&
                    retryableImageGenerationClientEntryId &&
                    !isLoading &&
                    !imageGenerationPostInFlightRef.current &&
                    !activeImageGenerationAttemptRef.current
                )}
                onRetryAsNewRequest={() => void retryImageGenerationAsNewRequest()}
                transcript={transcriptDraft}
                onTranscriptChange={updateTranscriptDraft}
                transcriptScenes={transcriptSceneViews}
                selectedTranscriptSceneCount={transcriptScenes.filter(
                  (scene) => scene.selected
                ).length}
                onTranscriptPlan={planTranscriptImages}
                onToggleTranscriptScene={toggleTranscriptScene}
                onTranscriptScenePromptChange={updateTranscriptScenePrompt}
                onGenerateSelectedTranscriptImages={() =>
                  void generateSelectedTranscriptImages()
                }
                isTranscriptGenerating={isTranscriptGenerationActive}
                transcriptError={
                  visibleError?.workflow === "transcript-images"
                    ? visibleError.message
                    : null
                }
                token={token}
                onPreviewImage={(url, alt) => {
                  setPreviewImageUrl(url);
                  setPreviewImageAlt(alt);
                }}
                isMobileLayout={isMobilePromptLayout}
                labels={workspaceLabels}
              />
            )}
          </section>
          {showLegacyModePresentation && isQuickCreateMode ? <section
            className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 min-w-0 shrink-0 rounded-none border-x-0 border-b-0 border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 p-2 shadow-lg backdrop-blur sm:p-3 md:static md:rounded-b-2xl md:border-x md:border-b md:dark:border-slate-700"
            data-image-composer="true"
            data-image-mobile-composer-fixed="above-bottom-nav"
            data-image-drag-upload="reference-image"
            data-image-drag-active={isReferenceDragActive ? "true" : "false"}
            data-image-drag-uses-existing-validation="true"
            onDragEnter={handleReferenceDragOver}
            onDragOver={handleReferenceDragOver}
            onDragLeave={handleReferenceDragLeave}
            onDrop={handleReferenceDrop}
          >
            <form onSubmit={handleGenerateSubmit}>
            <div className="mx-auto w-full max-w-4xl">
            {imageCreationHandoffState === "PREPARING_REFERENCE" ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700" role="status" aria-live="polite" data-image-reference-preparation="PREPARING_REFERENCE">
                <span>{t("multimodal.image.preparingReference")}</span>
                <button type="button" className="min-h-10 rounded-lg px-3 font-semibold" onClick={discardImageCreationReferencePreparation}>
                  {t("multimodal.image.discardReference")}
                </button>
              </div>
            ) : null}
            {imageCreationHandoffState === "TRANSIENT_FAILURE" ? (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-image-reference-preparation="TRANSIENT_FAILURE">
                <span className="min-w-0 flex-1">{t("multimodal.image.referencePreparationFailed")}</span>
                <button type="button" className="min-h-10 rounded-lg border border-red-200 bg-white px-3 font-semibold" onClick={retryImageCreationReferencePreparation}>
                  {t("multimodal.image.retryReference")}
                </button>
                <button type="button" className="min-h-10 rounded-lg px-3 font-semibold" onClick={discardImageCreationReferencePreparation}>
                  {t("multimodal.image.discardReference")}
                </button>
              </div>
            ) : null}
            {isQuickCreateMode && referenceImage ? (
              <div
                className="mb-2 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1 md:hidden"
                data-image-mobile-reference-thumbnails="true"
              >
                <div className="relative size-16 shrink-0">
                  <img
                    src={referenceImage.dataUrl}
                    alt={referenceImageLabel || t("multimodal.image.referenceLabel")}
                    className="size-16 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                  />
                  <button
                    type="button"
                    className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    onClick={() => removeReferenceImage()}
                    disabled={referenceMutationLocked}
                    aria-label={t("multimodal.image.removeReferenceShort")}
                    data-image-mobile-reference-remove="true"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}
            <div
              className={`relative rounded-2xl border bg-white dark:bg-slate-900 p-2 focus-within:border-indigo-300 dark:focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-900 ${
                isReferenceDragActive
                  ? "border-indigo-300 dark:border-indigo-600 ring-4 ring-indigo-100 dark:ring-indigo-900"
                  : "border-slate-200 dark:border-slate-700"
              }`}
            >
            {isQuickCreateMode && !referenceImage ? (
              <button
                type="button"
                className="absolute -left-1.5 -top-5 z-10 flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-2xl font-light leading-none text-slate-700 shadow-md transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-500 dark:hover:text-indigo-400 md:hidden"
                onClick={() => referenceInputRef.current?.click()}
                disabled={
                  referenceMutationLocked || activeReferenceLimit === 0
                }
                aria-label={t("multimodal.image.uploadReference")}
                data-image-mobile-floating-reference-add="true"
              >
                <Plus className="size-5" aria-hidden="true" />
              </button>
            ) : null}
            <label className="grid min-w-0 gap-2">
              <span className="sr-only">{t("multimodal.prompt")}</span>
              <textarea
                className={`max-h-28 min-h-12 w-full min-w-0 resize-none overflow-y-auto rounded-xl border-0 bg-transparent py-2 pr-3 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500 sm:px-4 md:max-h-40 md:min-h-20 md:py-2.5 lg:min-h-24 lg:py-3 ${
                  showQuickMobileComposer ? "pl-12" : "pl-3"
                }`}
                placeholder={t("multimodal.image.promptPlaceholder")}
                ref={promptInputRef}
                value={prompt}
                onChange={(event) => {
                  clearError();
                  updatePrompt(event.target.value, { memoryEdit: true });
                }}
                onKeyDown={handlePromptKeyDown}
                maxLength={4000}
                data-image-composer-prompt="true"
                data-image-enter-send="desktop-only"
                data-image-mobile-enter="newline"
                data-image-desktop-enter="send"
                data-image-shift-enter="newline"
                data-image-composition-enter-guard="true"
                data-image-prompt-clears-after-fetch="true"
                data-image-prompt-restores-on-failure="true"
              />
            </label>

            {referenceImage ? (
              <div
                className="mt-3 hidden min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800 md:flex"
                data-reference-image-preview="true"
              >
                <img
                  src={referenceImage.dataUrl}
                  alt={referenceImageLabel || t("multimodal.image.referenceLabel")}
                  className="h-12 w-12 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {referenceImageLabel || t("multimodal.image.referenceLabel")}
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100"
                  onClick={() => removeReferenceImage()}
                  disabled={referenceMutationLocked}
                  aria-label={t("multimodal.image.removeReference")}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : referenceImageCompression.status === "compressing" ? (
              <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                {referenceImageStatusText}
              </div>
            ) : null}

            <div
              className={`mt-2 min-w-0 flex-nowrap items-center gap-1.5 border-t border-slate-100 px-1 pt-2 dark:border-slate-700 sm:px-2 md:flex-wrap md:gap-2 ${
                showQuickMobileComposer ? "hidden md:flex" : "flex"
              }`}
              data-image-composer-actions="true"
              data-image-mobile-composer-actions="reference-model-ratio-generate"
            >
              <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 md:h-10 md:px-3">
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only md:not-sr-only">
                  {t("multimodal.image.uploadReference")}
                </span>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  ref={referenceInputRef}
                  multiple={activeReferenceLimit > 1}
                  onChange={(event) =>
                    void selectReferenceImage(Array.from(event.target.files ?? []))
                  }
                  disabled={
                    referenceMutationLocked ||
                    activeReferenceLimit === 0 ||
                    isReferenceCapacityFull
                  }
                />
              </label>

              <div
                className="relative min-w-0 shrink-0"
                data-image-model-picker="true"
                data-image-popover-click-away="true"
                data-image-popover-escape-close="true"
                ref={modelPickerRef}
              >
                <button
                  type="button"
                  className="inline-flex h-9 max-w-24 items-center gap-2 whitespace-nowrap rounded-xl px-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 md:h-10 md:max-w-52 md:px-3"
                  onClick={() => setIsModelPickerOpen((open) => !open)}
                  aria-expanded={isModelPickerOpen}
                  data-image-composer-model-popover-trigger="true"
                >
                  <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {selectedModel ? getModelDisplayName(selectedModel) : t("multimodal.image.noModels")}
                  </span>
                </button>
                <div
                  className={`absolute bottom-12 left-0 z-50 grid w-[min(18rem,calc(100vw-2rem))] gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-lg ${
                    isModelPickerOpen ? "" : "hidden"
                  }`}
                  aria-hidden={isModelPickerOpen ? "false" : "true"}
                  data-image-model-popover="true"
                >
                  {models.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">
                      {t("multimodal.image.noModels")}
                    </div>
                  ) : null}
                  {models.map((model) => {
                    const isSelected = selectedModelSlug === model.slug;

                    return (
                      <button
                        key={model.id}
                        type="button"
                        className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                          isSelected
                            ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 ring-1 ring-indigo-100 dark:ring-indigo-900"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-950 dark:hover:text-slate-100"
                        }`}
                        onClick={() => selectModel(model.slug)}
                        data-image-model-popover-option="true"
                        data-image-model-current={isSelected ? "true" : undefined}
                      >
                        <ModelIcon
                          model={model}
                          selected={isSelected}
                          className="size-8 rounded-xl"
                          imageClassName="size-4"
                        />
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {getModelDisplayName(model)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className="relative shrink-0"
                data-image-ratio-menu="true"
                data-image-popover-click-away="true"
                data-image-popover-escape-close="true"
                ref={ratioPickerRef}
              >
                <button
                  type="button"
                  className="inline-flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => setIsRatioPickerOpen((open) => !open)}
                  aria-expanded={isRatioPickerOpen}
                  disabled={referencePreparationLocked}
                  data-image-ratio-popover-trigger="true"
                >
                  <span
                    className={`inline-block rounded-sm border-2 border-current ${getAspectRatioIconClassName(aspectRatio)}`}
                    aria-hidden="true"
                  />
                  <span>{aspectRatio}</span>
                </button>
                <div
                  className={`absolute bottom-12 left-0 z-50 grid w-56 max-w-[calc(100vw-2rem)] grid-cols-2 gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-lg ${
                    isRatioPickerOpen ? "" : "hidden"
                  }`}
                  aria-hidden={isRatioPickerOpen ? "false" : "true"}
                  data-image-ratio-popover="true"
                >
                  {imageAspectRatios.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold ${
                        aspectRatio === ratio
                          ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                          : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      }`}
                      onClick={() => selectAspectRatio(ratio)}
                      data-image-ratio-option={ratio}
                    >
                      <span
                        className={`inline-block rounded-sm border-2 border-current ${getAspectRatioIconClassName(ratio)}`}
                        aria-hidden="true"
                      />
                      <span>{ratio}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="relative min-w-0 shrink-0"
                ref={countPickerRef}
                data-image-count-picker="true"
              >
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-1 whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={() => setIsCountPickerOpen((open) => !open)}
                  aria-expanded={isCountPickerOpen}
                  aria-label={t("multimodal.count")}
                  disabled={isLoading}
                  data-image-count-trigger="true"
                >
                  <span>{t("multimodal.image.quantityOption", { count })}</span>
                  <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                </button>
                {isCountPickerOpen ? (
                  <div
                    className="absolute bottom-12 left-0 z-50 grid w-28 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                    role="radiogroup"
                    aria-label={t("multimodal.count")}
                    data-image-count-menu="true"
                  >
                    {aiGenerationCounts.map((nextCount) => (
                      <button
                        key={nextCount}
                        type="button"
                        role="radio"
                        aria-checked={count === nextCount}
                        aria-pressed={count === nextCount}
                        disabled={isLoading}
                        className="rounded-lg px-2 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => selectGenerationCount(nextCount)}
                        data-image-count-option={String(nextCount)}
                      >
                        {t("multimodal.image.quantityOption", { count: nextCount })}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div
                className="hidden min-w-0 shrink-0 whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400 md:block md:flex-1"
                data-image-credit-estimate="true"
                data-image-mobile-credit-estimate="hidden"
              >
                <span>{t("multimodal.estimatedCostShort", { cost: estimatedCost })}</span>
                <span className="mx-2">/</span>
                <span>{t("multimodal.remainingCreditsShort", { credits: credits ?? "-" })}</span>
              </div>

              <Button
                type="submit"
                className="ml-auto h-9 min-w-0 shrink-0 rounded-2xl px-3 md:h-10 md:min-w-28"
                disabled={!canGenerate}
                aria-busy={isLoading}
                data-image-generate-button="true"
                data-image-generate-request-flow="unchanged"
                data-image-logged-out-guard="toast-no-generate"
              >
                <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only md:not-sr-only">
                  {isLoading
                    ? t("multimodal.generating")
                    : t("multimodal.image.generate")}
                </span>
              </Button>
            </div>

            <div
              className={`mt-2 min-w-0 flex-nowrap items-center gap-0.5 overflow-visible border-t border-slate-100 px-0 pt-2 dark:border-slate-700 ${
                showQuickMobileComposer ? "flex" : "hidden"
              }`}
              data-image-mobile-quick-toolbar="true"
              data-image-mobile-toolbar-single-row="true"
              data-image-mobile-toolbar-overflow="visible"
            >
              <div className="relative min-w-0 flex-1" ref={quickModelPickerRef} data-image-quick-model-picker="true">
                <button
                  type="button"
                  className="flex min-w-0 max-w-full items-center gap-1 rounded-lg px-1.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200"
                  onClick={() => setIsModelPickerOpen((open) => !open)}
                  aria-expanded={isModelPickerOpen}
                  data-image-quick-model-trigger="true"
                >
                  <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {selectedModel ? getModelDisplayName(selectedModel) : t("multimodal.image.noModels")}
                  </span>
                  <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                </button>
                {isModelPickerOpen ? (
                  <div
                    className="absolute bottom-11 left-0 z-50 grid w-52 max-w-[calc(100vw-1.5rem)] gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                    data-image-quick-model-menu="true"
                  >
                    {models.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className="truncate rounded-lg px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => selectModel(model.slug)}
                        data-image-quick-model-option={model.slug}
                      >
                        {getModelDisplayName(model)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="relative shrink-0" ref={quickRatioPickerRef} data-image-quick-ratio-picker="true">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg px-1.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200"
                  onClick={() => setIsRatioPickerOpen((open) => !open)}
                  aria-expanded={isRatioPickerOpen}
                  disabled={referencePreparationLocked}
                  data-image-quick-ratio-trigger="true"
                >
                  <span>{aspectRatio}</span>
                  <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                </button>
                {isRatioPickerOpen ? (
                  <div
                    className="absolute bottom-11 right-0 z-50 grid w-40 max-w-[calc(100vw-1.5rem)] grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                    data-image-quick-ratio-menu="true"
                  >
                    {imageAspectRatios.map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        className="rounded-lg px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => selectAspectRatio(ratio)}
                        data-image-quick-ratio-option={ratio}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="relative shrink-0" ref={quickCountPickerRef} data-image-quick-count-picker="true">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg px-1.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200"
                  onClick={() => setIsCountPickerOpen((open) => !open)}
                  aria-expanded={isCountPickerOpen}
                  aria-label={t("multimodal.count")}
                  disabled={isLoading || referencePreparationLocked}
                  data-image-quick-count-trigger="true"
                >
                  <span>{t("multimodal.image.quantityOption", { count })}</span>
                  <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                </button>
                {isCountPickerOpen ? (
                  <div
                    className="absolute bottom-11 right-0 z-50 grid w-24 max-w-[calc(100vw-1.5rem)] gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                    role="radiogroup"
                    aria-label={t("multimodal.count")}
                    data-image-quick-count-menu="true"
                  >
                    {aiGenerationCounts.map((nextCount) => (
                      <button
                        key={nextCount}
                        type="button"
                        role="radio"
                        aria-checked={count === nextCount}
                        aria-pressed={count === nextCount}
                        disabled={isLoading || referencePreparationLocked}
                        className="rounded-lg px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => selectGenerationCount(nextCount)}
                        data-image-quick-count-option={String(nextCount)}
                      >
                        {t("multimodal.image.quantityOption", { count: nextCount })}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <span
                className="shrink-0 whitespace-nowrap px-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400"
                data-image-mobile-cost-per-generation="true"
              >
                {t("multimodal.image.costPerGeneration", { cost: estimatedCost })}
              </span>
              <Button
                type="submit"
                className="ml-auto size-11 shrink-0 rounded-full p-0"
                disabled={!canGenerate}
                aria-busy={isLoading}
                data-image-mobile-generate-button="true"
              >
                <SendHorizontal className="size-5 shrink-0" aria-hidden="true" />
                <span className="sr-only">{t("multimodal.image.generate")}</span>
              </Button>
            </div>

            {hasInsufficientCredits ? (
              <p className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-400">
                {insufficientCredits}
              </p>
            ) : null}
            {!token ? (
              <p
                className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-600 dark:text-slate-400"
                data-image-login-required-hint="true"
              >
                {t("multimodal.error.loginRequired")}
              </p>
            ) : null}
            </div>
            </div>
            </form>

          </section> : null}
        </div>
      </div>
      {visibleError ? (
        <div
          className="absolute right-3 top-3 z-30 flex max-w-[min(24rem,calc(100vw-1.5rem))] items-start justify-between gap-3 rounded-xl border border-red-100 dark:border-red-900 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-red-700 dark:text-red-400 shadow-lg ring-1 ring-red-100 dark:ring-red-900"
          data-image-error-toast="true"
          data-image-error-auto-dismiss={visibleError.persistent ? "false" : "true"}
          data-image-error-timeout-ms={visibleError.persistent ? undefined : "10000"}
        >
          <p className="min-w-0 break-words">{visibleError.message}</p>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => clearError(visibleError.workflow)}
            aria-label={t("multimodal.closeError")}
          >
            {t("multimodal.closeError")}
          </button>
        </div>
      ) : null}
      <ImagePreviewDialog
        src={previewImageUrl}
        token={token}
        alt={previewImageAlt || t("multimodal.asset.image")}
        closeLabel={t("multimodal.image.closePreview")}
        zoomInLabel={t("multimodal.image.zoomIn")}
        zoomOutLabel={t("multimodal.image.zoomOut")}
        fitLabel={t("multimodal.image.fitPreview")}
        loadingLabel={t("multimodal.image.loadingPreview")}
        loadFailedLabel={t("multimodal.image.loadFailedPreview")}
        onClose={() => {
          setPreviewImageUrl(null);
          setPreviewImageAlt("");
        }}
      />
      <ConfirmDialog
        isOpen={isDiscardImageDraftOpen}
        title={t("multimodal.image.confirmDiscardTitle")}
        message={t("multimodal.image.confirmDiscardMessage")}
        confirmLabel={t("multimodal.image.confirm")}
        cancelLabel={t("multimodal.image.cancel")}
        onConfirm={handleDiscardImageDraftConfirm}
        onCancel={handleDiscardImageDraftCancel}
      />
      <ConfirmDialog
        isOpen={pendingContinuationEntryId !== null || pendingImageCreationHandoff !== null}
        title={t("multimodal.image.replaceCurrentReferenceTitle")}
        message={t("multimodal.image.replaceCurrentReferenceMessage")}
        confirmLabel={t("multimodal.image.replaceReference")}
        cancelLabel={t("multimodal.image.keepCurrentReference")}
        onConfirm={
          pendingImageCreationHandoff
            ? confirmImageCreationHandoffReplacement
            : confirmContinuation
        }
        onCancel={
          pendingImageCreationHandoff
            ? keepCurrentImageCreationReference
            : cancelContinuationConfirmation
        }
      />
      <ConfirmDialog
        isOpen={pendingPromptReusePrompt !== null}
        title={t("multimodal.image.replaceCurrentPromptTitle")}
        message={t("multimodal.image.replaceCurrentPromptMessage")}
        confirmLabel={t("multimodal.image.confirmReplacePrompt")}
        cancelLabel={t("multimodal.image.cancel")}
        onConfirm={confirmPromptReuse}
        onCancel={cancelPromptReuse}
      />
    </div>
  );
}
