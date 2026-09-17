"use client";

import type { AiGenerationCount, AiModelSummary } from "@ai-aggregate/shared";
import { aiGenerationCounts, getModelDisplayName } from "@ai-aggregate/shared";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, ImagePlus, Plus, SendHorizontal, Shuffle, SlidersHorizontal, Upload, X } from "lucide-react";
import Link from "next/link";
import React, { type ChangeEvent, type FormEventHandler, type RefObject } from "react";
import { ModelIcon } from "../../../components/workspace/ModelIcon";
import { ResolvedAssetImage } from "../../../components/workspace/ResolvedAssetImage";
import { Button } from "../../../components/workspace/ui";
import { useResolvedAssetUrl } from "../../../hooks/use-resolved-asset-url";
import { TitleCoverPreview } from "./title-cover-preview";
import {
  TranscriptImagesComposer,
  type TranscriptImagesComposerLabels
} from "./transcript-images-composer";
import type { TranscriptSceneView } from "./transcript-segmentation";
import type {
  TitleCoverTypographyDraft,
  TitleCoverTypographyPreset
} from "./title-cover-composition";
import type {
  ImageAspectRatio,
  ImageResultBatch,
  ImageResultVersion,
  ImageStreamEntry,
  ReferenceImageCompressionState,
  ImageCreatorWorkflow,
  SelectedReferenceImage,
  TitleCoverDraft,
  TitleCoverStyle
} from "./image-page-content";

type WorkspaceResultEntry = Pick<
  ImageStreamEntry,
  "status" | "result" | "error" | "requestedCount"
>;

const parameterControlClassName =
  "relative flex min-h-11 min-w-0 items-center rounded-xl border border-slate-200 bg-white transition hover:border-slate-400 focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-indigo-600 focus-within:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 dark:focus-within:ring-offset-slate-950";
const parameterSelectClassName =
  "min-h-11 min-w-0 w-full flex-1 appearance-none bg-transparent px-3 pr-9 text-sm font-semibold text-slate-800 outline-none transition dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60";
const parameterChevronClassName =
  "pointer-events-none absolute right-3 size-4 shrink-0 text-slate-500 dark:text-slate-400";
const parameterOptionClassName =
  "min-h-11 rounded-xl border px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60";

function ResolvedResultPreviewButton({
  logicalUrl,
  token,
  alt,
  ariaLabel,
  downloadLabel,
  showDownload = true,
  onOpen
}: {
  logicalUrl: string;
  token: string | null;
  alt: string;
  ariaLabel: string;
  downloadLabel: string;
  showDownload?: boolean;
  onOpen: (resolvedUrl: string) => void;
}) {
  const { resolvedUrl } = useResolvedAssetUrl({
    src: logicalUrl,
    token,
    enabled: showDownload
  });
  const openPreview = () => {
    if (resolvedUrl) onOpen(resolvedUrl);
  };

  if (!showDownload) {
    return null;
  }

  return (
    <div className="grid min-w-0 gap-3">
      <button
        type="button"
        className="grid min-h-72 min-w-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-950"
        onClick={openPreview}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPreview();
          }
        }}
        aria-label={ariaLabel}
        data-image-workbench-result-image="true"
        data-image-creator-result-hero="true"
      >
        {resolvedUrl ? (
          <img
            src={resolvedUrl}
            alt={alt}
            className="max-h-[min(58vh,36rem)] w-full rounded-[0.55rem] object-contain"
            data-image-workbench-result-image-content="true"
          />
        ) : null}
      </button>
      {showDownload ? (
        <a
          href={resolvedUrl ?? "#"}
          download
          aria-disabled={resolvedUrl ? undefined : "true"}
          className={`inline-flex min-h-11 w-fit items-center justify-center rounded-lg border px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 ${
            resolvedUrl
              ? "border-slate-200 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"
              : "cursor-not-allowed border-slate-100 text-slate-400 dark:border-slate-800 dark:text-slate-600"
          }`}
          onClick={(event) => {
            if (!resolvedUrl) event.preventDefault();
          }}
          data-image-workbench-download="true"
        >
          {downloadLabel}
        </a>
      ) : null}
    </div>
  );
}

export function GenerationCountPicker({
  quantity,
  onSelect,
  disabled,
  label,
  optionLabel
}: {
  quantity: AiGenerationCount;
  onSelect: (quantity: AiGenerationCount) => void;
  disabled: boolean;
  label: string;
  optionLabel: (quantity: AiGenerationCount) => string;
}) {
  return (
    <div className="grid min-w-0 gap-2" role="group" aria-label={label} data-image-generation-count-picker="true" data-image-parameter-family="true">
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      <div className="grid min-w-0 grid-cols-3 gap-2" role="radiogroup" aria-label={label} data-image-generation-count-options="true">
        {aiGenerationCounts.map((nextQuantity) => {
          const selected = quantity === nextQuantity;
          return (
            <button
              key={nextQuantity}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-pressed={selected}
              disabled={disabled}
              className={`${parameterOptionClassName} ${
                selected
                  ? "border-slate-950 bg-slate-950 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              }`}
              onClick={() => onSelect(nextQuantity)}
              data-image-generation-count-option={String(nextQuantity)}
              data-image-generation-count-selected={selected ? "true" : "false"}
            >
              {optionLabel(nextQuantity)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReferenceImageCollection({
  references,
  onRemove,
  onMove,
  labels,
  disabled,
  dataPrefix
}: {
  references: SelectedReferenceImage[];
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  labels: {
    removeReference: string;
    moveReferenceEarlier: (index: number) => string;
    moveReferenceLater: (index: number) => string;
    referenceNumber: (index: number) => string;
  };
  disabled: boolean;
  dataPrefix: "image" | "title-cover";
}) {
  return (
    <div
      className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4"
      data-image-reference-list="true"
      data-image-reference-count={String(references.length)}
    >
      {references.map((reference, index) => (
        <article
          key={reference.id}
          className="grid min-w-0 gap-1.5 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
          data-image-reference-item={reference.id}
          data-image-reference-index={String(index)}
          data-image-reference-kind={dataPrefix}
        >
          <div className="relative aspect-square overflow-hidden rounded-md bg-slate-100 dark:bg-slate-900">
            <img
              src={reference.image.dataUrl}
              alt={labels.referenceNumber(index + 1)}
              className="h-full w-full object-cover"
            />
            <span className="absolute left-1 top-1 rounded bg-slate-950/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {index + 1}
            </span>
          </div>
          <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200" title={reference.image.name}>
            {reference.image.name || labels.referenceNumber(index + 1)}
          </p>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => onMove(reference.id, -1)}
              disabled={disabled || index === 0}
              aria-label={labels.moveReferenceEarlier(index + 1)}
              title={labels.moveReferenceEarlier(index + 1)}
              className="grid min-h-10 place-items-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-35 dark:border-slate-700 dark:text-slate-300"
              data-image-reference-move-earlier="true"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onMove(reference.id, 1)}
              disabled={disabled || index === references.length - 1}
              aria-label={labels.moveReferenceLater(index + 1)}
              title={labels.moveReferenceLater(index + 1)}
              className="grid min-h-10 place-items-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-35 dark:border-slate-700 dark:text-slate-300"
              data-image-reference-move-later="true"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(reference.id)}
              disabled={disabled}
              aria-label={`${labels.removeReference}: ${labels.referenceNumber(index + 1)}`}
              title={`${labels.removeReference}: ${labels.referenceNumber(index + 1)}`}
              className="grid min-h-10 place-items-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-35 dark:border-slate-700 dark:text-slate-300"
              data-image-workbench-reference-remove="true"
              data-image-title-cover-reference-remove={dataPrefix === "title-cover" ? "true" : undefined}
            >
              <X className="size-4" />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function CreationWorkspaceView({
  workflow,
  onSelectWorkflow,
  titleCoverDraft,
  titleCoverMainCopyDirty,
  onTitleCoverOriginalTitleChange,
  onTitleCoverMainCopyChange,
  onTitleCoverSecondaryCopyChange,
  onTitleCoverStyleChange,
  titleCoverTypographyDraft,
  onTitleCoverTypographyPresetChange,
  onTitleCoverMainColorChange,
  onTitleCoverSecondaryColorChange,
  titleCoverReferenceImages,
  titleCoverReferenceImageCompression,
  titleCoverReferenceMutationLocked,
  titleCoverReferenceInputRef,
  onTitleCoverReferenceImageChange,
  onTitleCoverReferenceDragOver,
  onTitleCoverReferenceDragLeave,
  onTitleCoverReferenceDrop,
  isTitleCoverReferenceDragActive,
  onRemoveTitleCoverReferenceImage,
  onMoveTitleCoverReferenceImage,
  prompt,
  onPromptChange,
  onPromptKeyDown,
  onRandomInspiration,
  onSubmit,
  onStartNewDrawing,
  isNewDrawingBlocked,
  referenceImages,
  referenceLimit,
  referenceLimitExceeded,
  referenceImageStatusText,
  referenceImageCompression,
  referenceMutationLocked,
  referenceInputRef,
  onReferenceImageChange,
  onReferenceDragOver,
  onReferenceDragLeave,
  onReferenceDrop,
  isReferenceDragActive,
  onRemoveReferenceImage,
  onMoveReferenceImage,
  isLoggedIn,
  models,
  selectedModelId,
  onSelectModel,
  aspectRatio,
  aspectRatios,
  size,
  quantity,
  onSelectQuantity,
  onSelectAspectRatio,
  generationMode,
  estimatedCost,
  credits,
  canGenerate,
  isLoading,
  latestEntry,
  resultBatches,
  selectedResultBatch,
  selectedResultVersion,
  continuationSourceVersion,
  isPreparingContinuation,
  referencePreparationState,
  onRetryReferencePreparation,
  onDiscardReferencePreparation,
  canContinueFromResult,
  onSelectResultVersion,
  onContinueEditing,
  canReusePrompt,
  onReusePrompt,
  canResumeRequest,
  onResumeRequest,
  canRetryAsNewRequest,
  onRetryAsNewRequest,
  promptInputRef,
  transcript,
  onTranscriptChange,
  transcriptScenes,
  selectedTranscriptSceneCount,
  onTranscriptPlan,
  onToggleTranscriptScene,
  onTranscriptScenePromptChange,
  onGenerateSelectedTranscriptImages,
  isTranscriptGenerating,
  transcriptError,
  token,
  onPreviewImage,
  isMobileLayout,
  labels
}: {
  workflow: ImageCreatorWorkflow;
  onSelectWorkflow: (workflow: ImageCreatorWorkflow) => void;
  titleCoverDraft: TitleCoverDraft;
  titleCoverMainCopyDirty: boolean;
  onTitleCoverOriginalTitleChange: (value: string) => void;
  onTitleCoverMainCopyChange: (value: string) => void;
  onTitleCoverSecondaryCopyChange: (value: string) => void;
  onTitleCoverStyleChange: (value: TitleCoverStyle) => void;
  titleCoverTypographyDraft: TitleCoverTypographyDraft;
  onTitleCoverTypographyPresetChange: (value: TitleCoverTypographyPreset) => void;
  onTitleCoverMainColorChange: (value: string) => void;
  onTitleCoverSecondaryColorChange: (value: string) => void;
  titleCoverReferenceImages: SelectedReferenceImage[];
  titleCoverReferenceImageCompression: ReferenceImageCompressionState;
  titleCoverReferenceMutationLocked: boolean;
  titleCoverReferenceInputRef: RefObject<HTMLInputElement | null>;
  onTitleCoverReferenceImageChange: (files: readonly File[]) => void;
  onTitleCoverReferenceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onTitleCoverReferenceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onTitleCoverReferenceDrop: (event: React.DragEvent<HTMLElement>) => void;
  isTitleCoverReferenceDragActive: boolean;
  onRemoveTitleCoverReferenceImage: (id: string) => void;
  onMoveTitleCoverReferenceImage: (id: string, direction: -1 | 1) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onRandomInspiration: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onStartNewDrawing: () => void;
  isNewDrawingBlocked: boolean;
  referenceImages: SelectedReferenceImage[];
  referenceLimit: number;
  referenceLimitExceeded: boolean;
  referenceImageStatusText: string;
  referenceImageCompression: ReferenceImageCompressionState;
  referenceMutationLocked: boolean;
  referenceInputRef: RefObject<HTMLInputElement | null>;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  transcript: string;
  onTranscriptChange: (value: string) => void;
  transcriptScenes: TranscriptSceneView[];
  selectedTranscriptSceneCount: number;
  onTranscriptPlan: () => void;
  onToggleTranscriptScene: (sceneId: string) => void;
  onTranscriptScenePromptChange: (sceneId: string, value: string) => void;
  onGenerateSelectedTranscriptImages: () => void;
  isTranscriptGenerating: boolean;
  transcriptError: string | null;
  onReferenceImageChange: (files: readonly File[]) => void;
  onReferenceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onReferenceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onReferenceDrop: (event: React.DragEvent<HTMLElement>) => void;
  isReferenceDragActive: boolean;
  onRemoveReferenceImage: (id: string) => void;
  onMoveReferenceImage: (id: string, direction: -1 | 1) => void;
  isLoggedIn: boolean;
  models: AiModelSummary[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  aspectRatio: ImageAspectRatio;
  aspectRatios: readonly ImageAspectRatio[];
  size: string;
  quantity: AiGenerationCount;
  onSelectQuantity: (quantity: AiGenerationCount) => void;
  onSelectAspectRatio: (ratio: ImageAspectRatio) => void;
  generationMode: "text-to-image" | "image-to-image";
  estimatedCost: number;
  credits: number | null;
  canGenerate: boolean;
  isLoading: boolean;
  latestEntry: WorkspaceResultEntry | null;
  resultBatches: ImageResultBatch[];
  selectedResultBatch: ImageResultBatch | null;
  selectedResultVersion: ImageResultVersion | null;
  continuationSourceVersion: ImageResultVersion | null;
  isPreparingContinuation: boolean;
  referencePreparationState: "IDLE" | "CONFLICT" | "PREPARING_REFERENCE" | "READY" | "TRANSIENT_FAILURE" | "TERMINAL_FAILURE";
  onRetryReferencePreparation: () => void;
  onDiscardReferencePreparation: () => void;
  canContinueFromResult: boolean;
  onSelectResultVersion: (entryId: string) => void;
  onContinueEditing: () => void;
  canReusePrompt: boolean;
  onReusePrompt: () => void;
  canResumeRequest: boolean;
  onResumeRequest: () => void;
  canRetryAsNewRequest: boolean;
  onRetryAsNewRequest: () => void;
  token: string | null;
  onPreviewImage: (url: string, alt: string) => void;
  isMobileLayout: boolean;
  labels: {
    freeCreation: string;
    parameters: string;
    prompt: string;
    promptPlaceholder: string;
    reference: string;
    referenceOptional: string;
    referenceFileHint: string;
    addReference: string;
    replaceReference: string;
    uploadReference: string;
    removeReference: string;
    references: string;
    addReferences: string;
    referenceCount: (count: number, max: number) => string;
    moveReferenceEarlier: (index: number) => string;
    moveReferenceLater: (index: number) => string;
    referenceNumber: (index: number) => string;
    modelDoesNotSupportReferences: string;
    referenceLimitExceeded: string;
    model: string;
    noModels: string;
    mobileNoModelAvailable: string;
    mobileReference: string;
    mobileGenerate: string;
    aspectRatio: string;
    pixelSize: string;
    size: string;
    cost: string;
    balance: string;
    generate: string;
    regenerate: string;
    generating: string;
    result: string;
    empty: string;
    loading: string;
    checking: string;
    failed: string;
    quantity: string;
    quantityOption: (quantity: AiGenerationCount) => string;
    randomInspiration: string;
    imageAlt: string;
    viewTask: string;
    viewAsset: string;
    download: string;
    batchResults: string;
    versions: string;
    selected: string;
    saved: string;
    resultLabel: (index: number) => string;
    selectResult: (index: number) => string;
    partialSuccess: (actual: number, requested: number) => string;
    resultCountViolation: (requested: number, actual: number) => string;
    versionLabel: string;
    selectVersion: string;
    continueEditing: string;
    reusePrompt: string;
    useAsReference: string;
    preparingContinuation: string;
    preparingReference: string;
    referencePreparationFailed: string;
    retryReference: string;
    discardReference: string;
    basedOnVersion: string;
    generatingNewVersion: string;
    resumeRequest: string;
    retryAsNewRequest: string;
    workflows: { freeCreate: string; referenceEdit: string; titleCover: string; transcriptImages: string };
    transcriptImages: TranscriptImagesComposerLabels;
    precisionEdit: {
      instruction: string;
      promptPlaceholder: string;
      sourceLabel: string;
      sourceHint: string;
      sourceEmpty: string;
      resultLabel: string;
      resultDescription: string;
    };
    titleCover: {
      originalTitle: string;
      originalTitlePlaceholder: string;
      mainCopy: string;
      mainCopyPlaceholder: string;
      secondaryCopy: string;
      secondaryCopyPlaceholder: string;
      reference: string;
      referenceHint: string;
      referenceEmpty: string;
      referenceCompressing: string;
      referenceSelected: (name: string) => string;
      referenceCompressFailed: string;
      referenceOriginalTooLarge: string;
      referenceCompressedTooLarge: string;
      style: string;
      styleOptions: ReadonlyArray<{ value: TitleCoverStyle; label: string }>;
      typographyPreset: string;
      typographyPresetOptions: ReadonlyArray<{
        value: TitleCoverTypographyPreset;
        label: string;
      }>;
      mainColor: string;
      secondaryColor: string;
      advancedSettings: string;
      generate: string;
      resultLabel: string;
      resultDescription: string;
      resultEmpty: string;
      visualCandidates: string;
      preview: string;
      previewDescription: string;
      historicalVisualBase: string;
      noCopy: string;
      loading: string;
      rendering: string;
      loadFailed: string;
      renderFailed: string;
      overflow: string;
      download: string;
      exporting: string;
      exportFailed: string;
    };
    history: string;
    comingSoon: string;
    workflowSoon: string;
    newDrawing: string;
    loginRequired: string;
  };
}) {
  const [isMobileParametersOpen, setIsMobileParametersOpen] = React.useState(false);
  const [isMobileTitleCoverAdvancedOpen, setIsMobileTitleCoverAdvancedOpen] =
    React.useState(false);
  const isTitleCoverWorkflow = workflow === "title-cover";
  const isPrecisionEditWorkflow = workflow === "precision-edit";
  const isTranscriptImagesWorkflow = workflow === "transcript-images";
  const titleCoverReferenceImage = titleCoverReferenceImages[0]?.image ?? null;
  const titleCoverReferenceImageLabel = titleCoverReferenceImage?.name ?? "";
  const promptLabel = isPrecisionEditWorkflow
    ? labels.precisionEdit.instruction
    : labels.prompt;
  const promptPlaceholder = isPrecisionEditWorkflow
    ? labels.precisionEdit.promptPlaceholder
    : labels.promptPlaceholder;
  const referenceSectionLabel = isPrecisionEditWorkflow
    ? labels.precisionEdit.sourceLabel
    : labels.referenceOptional;
  const referenceHint = isPrecisionEditWorkflow
    ? labels.precisionEdit.sourceHint
    : labels.referenceFileHint;
  const referenceEmptyLabel = isPrecisionEditWorkflow
    ? labels.precisionEdit.sourceEmpty
    : labels.addReference;
  const resultLabel = isPrecisionEditWorkflow
    ? labels.precisionEdit.resultLabel
    : labels.result;
  const handleReferenceChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!referenceMutationLocked) {
      onReferenceImageChange(Array.from(event.target.files ?? []));
    }
    event.target.value = "";
  };
  const handleTitleCoverReferenceChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    if (!titleCoverReferenceMutationLocked) {
      onTitleCoverReferenceImageChange(Array.from(event.target.files ?? []));
    }
    event.target.value = "";
  };
  const resultAsset = selectedResultVersion?.asset ?? null;
  const resultTaskId = selectedResultVersion?.entry.result?.task.id ?? "";
  const resultEntries = selectedResultBatch?.assets ?? [];
  const batchAlternatives = resultEntries.length > 1 ? resultEntries : [];
  const previousBatches = resultBatches.length > 1 ? resultBatches : [];
  const hasOwnerReadableResultAsset = Boolean(
    resultAsset &&
      resultTaskId &&
      resultAsset.taskId === resultTaskId &&
      resultAsset.id &&
      !resultAsset.id.startsWith(`${resultTaskId}-history-asset-`)
  );
  const referencePreparationLocked =
    isPreparingContinuation ||
    referencePreparationState === "PREPARING_REFERENCE" ||
    referencePreparationState === "TRANSIENT_FAILURE" ||
    referencePreparationState === "CONFLICT";
  const referenceCapacityFull =
    !isPrecisionEditWorkflow &&
    referenceLimit > 0 &&
    referenceImages.length >= referenceLimit;
  const titleCoverReferenceCapacityFull =
    referenceLimit > 0 &&
    titleCoverReferenceImages.length >= referenceLimit;
  const referenceInputDisabled =
    referenceMutationLocked || referenceLimit === 0 || referenceCapacityFull;
  const titleCoverReferenceInputDisabled =
    titleCoverReferenceMutationLocked ||
    referenceLimit === 0 ||
    titleCoverReferenceCapacityFull;
  const titleCoverReferenceStatusText =
    titleCoverReferenceImageCompression.status === "compressing"
      ? labels.titleCover.referenceCompressing
      : titleCoverReferenceImageCompression.status === "failed"
        ? labels.titleCover.referenceCompressFailed
        : titleCoverReferenceImageCompression.status === "too-large-original"
          ? labels.titleCover.referenceOriginalTooLarge
          : titleCoverReferenceImageCompression.status ===
              "too-large-compressed"
            ? labels.titleCover.referenceCompressedTooLarge
            : titleCoverReferenceImageLabel
              ? labels.titleCover.referenceSelected(titleCoverReferenceImageLabel)
              : labels.titleCover.referenceHint;
  const titleCoverReferenceEmptyHint =
    titleCoverReferenceImageCompression.status === "failed" ||
    titleCoverReferenceImageCompression.status === "too-large-original" ||
    titleCoverReferenceImageCompression.status === "too-large-compressed"
      ? titleCoverReferenceStatusText
      : labels.titleCover.referenceHint;
  const requestedCount = latestEntry?.requestedCount ?? 1;
  const resultDescription =
    selectedResultVersion &&
    (latestEntry?.status === "loading" || latestEntry?.status === "checking")
      ? labels.generatingNewVersion
      : "";
  const hasReadyResult = Boolean(resultAsset && selectedResultVersion);
  const isMobileTitleCoverReady = isMobileLayout && isTitleCoverWorkflow && hasReadyResult;
  const titleCoverMobileResultHeroOrder = isMobileTitleCoverReady
    ? "order-1"
    : isMobileLayout && isTitleCoverWorkflow
      ? "order-2"
      : "";
  const titleCoverMobileResultDetailsOrder = isMobileTitleCoverReady
    ? "order-3"
    : isMobileLayout && isTitleCoverWorkflow
      ? "order-2"
      : "";
  const selectedModel = models.find((model) => model.slug === selectedModelId) ?? null;
  const mobileModelAccessibleLabel =
    models.length === 0
      ? labels.mobileNoModelAvailable
      : selectedModel
        ? `${labels.model} · ${getModelDisplayName(selectedModel)}`
        : labels.model;
  const renderPlaceholders = (count: number, checking = false) => (
    <div className={`grid min-w-0 gap-3 ${count > 1 ? "grid-cols-2" : ""}`} data-image-workbench-result-placeholders={String(count)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={`min-h-44 animate-pulse rounded-xl ${checking ? "bg-amber-100 dark:bg-amber-950/40" : "bg-slate-100 dark:bg-slate-800"}`} data-image-workbench-result-placeholder="true" data-image-workbench-result-placeholder-index={String(index)} />
      ))}
    </div>
  );
  const renderMobileComposer = () => (
    <form className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900" onSubmit={onSubmit} data-image-mobile-compact-composer="true" data-image-creator-mobile-composer="true">
        <label className="grid min-w-0 gap-1.5">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{promptLabel}</span>
        <textarea className="min-h-16 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-[15px] leading-6 text-slate-950 outline-none placeholder:text-slate-400 focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500" placeholder={promptPlaceholder} ref={promptInputRef} value={prompt} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={onPromptKeyDown} maxLength={4000} rows={2} data-image-workbench-prompt="true" data-image-composer-prompt="true" data-image-mobile-compact-prompt="true" />
      </label>
      {isPrecisionEditWorkflow && referenceImages.length === 0 ? <p className="border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400" data-image-precision-edit-source-required="true">{referenceEmptyLabel}</p> : null}
      {referenceImages.length > 0 ? <div className="grid min-w-0 gap-2 border-t border-slate-100 pt-2 dark:border-slate-800" data-image-workbench-reference="true"><ReferenceImageCollection references={referenceImages} onRemove={onRemoveReferenceImage} onMove={onMoveReferenceImage} labels={labels} disabled={referenceMutationLocked} dataPrefix="image" /></div> : null}
      {referenceLimitExceeded ? <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" role="alert" data-image-reference-limit-error="true">{labels.referenceLimitExceeded}</p> : null}
      {referenceLimit === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400" data-image-reference-unsupported="true">{labels.modelDoesNotSupportReferences}</p> : null}
      <div className="flex min-w-0 items-center gap-1 border-t border-slate-100 pt-2 dark:border-slate-800" data-image-mobile-compact-controls="true">
        <label className={`inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 px-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200 ${referenceInputDisabled ? "pointer-events-none opacity-60" : "cursor-pointer"}`}><ImagePlus className="size-4" />{isPrecisionEditWorkflow && referenceImages.length ? labels.replaceReference : referenceLimit > 1 ? labels.addReferences : labels.mobileReference}<input ref={referenceInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple={!isPrecisionEditWorkflow && referenceLimit > 1} onChange={handleReferenceChange} disabled={referenceInputDisabled} data-image-workbench-reference-input="true" data-image-mobile-reference-input="true" /></label>
        <label className={`${parameterControlClassName} flex-1 overflow-hidden px-2 pr-7 ${models.length === 0 ? "opacity-60" : ""}`} title={mobileModelAccessibleLabel} data-image-mobile-model-control="true" data-image-parameter-control="model" data-image-parameter-focus-surface="wrapper"><span className="flex min-w-0 items-center gap-0.5 text-xs text-slate-800 dark:text-slate-200" data-image-mobile-model-label="true"><span className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400" data-image-mobile-model-base-label="true">{labels.model}</span>{selectedModel ? <><span aria-hidden="true" className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400" data-image-mobile-model-separator="true">·</span><span className="min-w-0 flex-1 truncate text-[11px] font-semibold" data-image-mobile-model-value="true">{getModelDisplayName(selectedModel)}</span></> : null}</span><ChevronDown aria-hidden="true" className={parameterChevronClassName} data-image-parameter-chevron="true" /><select className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" value={selectedModelId} onChange={(event) => onSelectModel(event.target.value)} aria-label={mobileModelAccessibleLabel} title={mobileModelAccessibleLabel} disabled={models.length === 0} data-image-workbench-model="true">{models.length === 0 ? <option value="">{labels.noModels}</option> : models.map((model) => <option key={model.id} value={model.slug}>{getModelDisplayName(model)}</option>)}</select></label>
        <button type="button" onClick={() => setIsMobileParametersOpen((open) => !open)} aria-expanded={isMobileParametersOpen} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-2 text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:border-slate-700 dark:text-slate-200" data-image-mobile-parameters-toggle="true"><SlidersHorizontal className="size-4" />{labels.parameters}</button>
        <Button type="submit" className="min-h-11 shrink-0 rounded-xl !px-2 text-xs" disabled={!canGenerate} aria-busy={isLoading} aria-label={isLoading ? labels.generating : resultBatches.length > 0 ? labels.regenerate : labels.generate} data-image-workbench-generate="true" data-image-generate-button="true" data-image-mobile-generate-button="true" data-image-generate-request-flow="unchanged" data-image-logged-out-guard={isLoggedIn ? undefined : "toast-no-generate"}><SendHorizontal className="size-4" />{labels.mobileGenerate}</Button>
      </div>
      {referenceImageCompression.status === "compressing" ? <p className="text-xs text-slate-500 dark:text-slate-400" data-image-mobile-reference-compressing="true">{referenceImageStatusText}</p> : null}
      {referencePreparationState === "PREPARING_REFERENCE" ? <div className="flex items-center justify-between gap-2 rounded-lg bg-indigo-50 px-2.5 py-2 text-xs text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" role="status" aria-live="polite" data-image-reference-preparation="PREPARING_REFERENCE" data-image-mobile-reference-preparation="PREPARING_REFERENCE"><span>{labels.preparingReference}</span><button type="button" className="min-h-10 shrink-0 rounded-lg px-2 font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" onClick={onDiscardReferencePreparation} data-image-mobile-reference-discard="true">{labels.discardReference}</button></div> : null}
      {referencePreparationState === "TRANSIENT_FAILURE" ? <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-300" role="alert" data-image-reference-preparation="TRANSIENT_FAILURE" data-image-mobile-reference-preparation="TRANSIENT_FAILURE"><span className="min-w-0 flex-1">{labels.referencePreparationFailed}</span><button type="button" className="min-h-10 rounded-lg px-2 font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600" onClick={onRetryReferencePreparation} data-image-mobile-reference-retry="true">{labels.retryReference}</button><button type="button" className="min-h-10 rounded-lg px-2 font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600" onClick={onDiscardReferencePreparation} data-image-mobile-reference-discard="true">{labels.discardReference}</button></div> : null}
      {isMobileParametersOpen ? <section className="grid gap-3 border-t border-slate-100 pt-3 dark:border-slate-800" data-image-mobile-parameters="true" data-image-workbench-structured-settings="true"><label className="grid min-w-0 self-start gap-1.5"><span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{labels.aspectRatio}</span><span className={`${parameterControlClassName} ${referencePreparationLocked ? "opacity-60" : ""}`} data-image-parameter-control="aspect" data-image-parameter-focus-surface="wrapper"><select className={parameterSelectClassName} value={aspectRatio} disabled={referencePreparationLocked} onChange={(event) => onSelectAspectRatio(event.target.value as ImageAspectRatio)} aria-label={labels.aspectRatio} data-image-workbench-size="true">{aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select><ChevronDown aria-hidden="true" className={parameterChevronClassName} data-image-parameter-chevron="true" /></span><span className="text-xs text-slate-500 dark:text-slate-400">{labels.pixelSize}: {size}</span></label><GenerationCountPicker quantity={quantity} onSelect={onSelectQuantity} disabled={isLoading || referencePreparationLocked} label={labels.quantity} optionLabel={labels.quantityOption} /></section> : null}
    </form>
  );

  const renderTranscriptImagesComposer = () => (
    <TranscriptImagesComposer
      transcript={transcript}
      onTranscriptChange={onTranscriptChange}
      scenes={transcriptScenes}
      selectedCount={selectedTranscriptSceneCount}
      onPlan={onTranscriptPlan}
      onToggleScene={onToggleTranscriptScene}
      onPromptChange={onTranscriptScenePromptChange}
      onGenerateSelected={onGenerateSelectedTranscriptImages}
      isGenerating={isTranscriptGenerating}
      error={transcriptError}
      token={token}
      models={models}
      selectedModelId={selectedModelId}
      onSelectModel={onSelectModel}
      modelLabel={labels.model}
      noModelsLabel={labels.noModels}
      labels={labels.transcriptImages}
    />
  );

  const renderTitleCoverReference = () => (
    <section
      className="grid min-w-0 gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"
      data-image-title-cover-reference="true"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {labels.titleCover.reference}
        </span>
        {titleCoverReferenceImage ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {titleCoverReferenceStatusText}
          </span>
        ) : null}
      </div>
      <div
        className={`grid min-w-0 gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-900/60 ${isTitleCoverReferenceDragActive ? "ring-2 ring-indigo-600 ring-offset-2" : ""}`}
        onDragOver={onTitleCoverReferenceDragOver}
        onDragLeave={onTitleCoverReferenceDragLeave}
        onDrop={onTitleCoverReferenceDrop}
        data-image-title-cover-reference-preview={titleCoverReferenceImages.length ? "true" : undefined}
        data-image-title-cover-reference-empty={titleCoverReferenceImages.length ? undefined : "true"}
        data-image-title-cover-reference-drag-active={isTitleCoverReferenceDragActive ? "true" : "false"}
      >
        {titleCoverReferenceImages.length > 0 ? (
          <ReferenceImageCollection references={titleCoverReferenceImages} onRemove={onRemoveTitleCoverReferenceImage} onMove={onMoveTitleCoverReferenceImage} labels={labels} disabled={titleCoverReferenceMutationLocked} dataPrefix="title-cover" />
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">{titleCoverReferenceEmptyHint}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {labels.referenceCount(titleCoverReferenceImages.length, referenceLimit)}
          </span>
          <label className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 focus-within:ring-2 focus-within:ring-indigo-600 dark:text-slate-200 ${titleCoverReferenceInputDisabled ? "pointer-events-none opacity-60" : "cursor-pointer hover:bg-white dark:hover:bg-slate-800"}`}>
            <Upload className="mr-2 size-4" />
            {referenceLimit > 1 ? labels.addReferences : labels.addReference}
            <input ref={titleCoverReferenceInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple={referenceLimit > 1} onChange={handleTitleCoverReferenceChange} disabled={titleCoverReferenceInputDisabled} data-image-title-cover-reference-input="true" />
          </label>
        </div>
      </div>
      {referenceLimit === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400" data-image-reference-unsupported="true">{labels.modelDoesNotSupportReferences}</p> : null}
      {referenceLimitExceeded ? <p className="text-xs text-amber-700 dark:text-amber-300" role="alert" data-image-reference-limit-error="true">{labels.referenceLimitExceeded}</p> : null}
      {titleCoverReferenceImageCompression.status === "compressing" ? (
        <p
          className="text-xs text-slate-500 dark:text-slate-400"
          data-image-title-cover-reference-compressing="true"
        >
          {titleCoverReferenceStatusText}
        </p>
      ) : null}
    </section>
  );

  const renderTitleCoverStyle = () => (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {labels.titleCover.style}
      </span>
      <span className={parameterControlClassName}>
        <select
          className={parameterSelectClassName}
          value={titleCoverDraft.style}
          onChange={(event) =>
            onTitleCoverStyleChange(event.target.value as TitleCoverStyle)
          }
          aria-label={labels.titleCover.style}
          disabled={isLoading}
          data-image-title-cover-style="true"
        >
          {labels.titleCover.styleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className={parameterChevronClassName}
        />
      </span>
    </label>
  );

  const renderTitleCoverTypographyPreset = () => (
    <label className="grid min-w-0 gap-1.5" data-image-title-cover-typography="true">
      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {labels.titleCover.typographyPreset}
      </span>
      <span className={parameterControlClassName}>
        <select
          className={parameterSelectClassName}
          value={titleCoverTypographyDraft.preset}
          onChange={(event) =>
            onTitleCoverTypographyPresetChange(
              event.target.value as TitleCoverTypographyPreset
            )
          }
          aria-label={labels.titleCover.typographyPreset}
          data-image-title-cover-typography-preset="true"
        >
          {labels.titleCover.typographyPresetOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className={parameterChevronClassName}
        />
      </span>
    </label>
  );

  const renderTitleCoverColorOverrides = () => (
    <section
      className="grid min-w-0 gap-2"
      data-image-title-cover-color-overrides="true"
    >
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <label className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <span className="min-w-0 truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
            {labels.titleCover.mainColor}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <code className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400" data-image-title-cover-main-color-value="true">
              {titleCoverTypographyDraft.mainColor}
            </code>
            <input
              type="color"
              value={titleCoverTypographyDraft.mainColor}
              onChange={(event) => onTitleCoverMainColorChange(event.target.value)}
              aria-label={labels.titleCover.mainColor}
              className="size-8 cursor-pointer rounded-md border-0 bg-transparent p-0"
              data-image-title-cover-main-color="true"
            />
          </span>
        </label>
        <label className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <span className="min-w-0 truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
            {labels.titleCover.secondaryColor}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <code className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400" data-image-title-cover-secondary-color-value="true">
              {titleCoverTypographyDraft.secondaryColor}
            </code>
            <input
              type="color"
              value={titleCoverTypographyDraft.secondaryColor}
              onChange={(event) => onTitleCoverSecondaryColorChange(event.target.value)}
              aria-label={labels.titleCover.secondaryColor}
              className="size-8 cursor-pointer rounded-md border-0 bg-transparent p-0"
              data-image-title-cover-secondary-color="true"
            />
          </span>
        </label>
      </div>
    </section>
  );

  const renderTitleCoverGenerateAction = () => (
    <div className="grid gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
      <Button
        type="submit"
        className="min-h-12 w-full rounded-lg"
        disabled={!canGenerate || isLoading}
        aria-busy={isLoading}
        data-image-title-cover-generate="true"
        data-image-generate-button="true"
        data-image-generate-request-flow="unchanged"
      >
        <SendHorizontal className="size-4" />
        {labels.titleCover.generate}
      </Button>
    </div>
  );

  const renderTitleCoverComposer = (mobile = false) => (
    <form
      className={`${mobile ? `${isTitleCoverWorkflow && hasReadyResult ? "order-2" : "order-1"} grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900` : "order-2 grid min-w-0 gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 lg:order-1 lg:gap-5 lg:border-r lg:border-t-0 lg:pr-7 lg:pt-0"}`}
      onSubmit={onSubmit}
      data-image-title-cover-form="true"
      data-image-title-cover-main-copy-dirty={
        titleCoverMainCopyDirty ? "true" : "false"
      }
      data-image-creator-input="true"
    >
      <label className="grid min-w-0 gap-1.5">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {labels.titleCover.originalTitle} *
        </span>
        <input
          required
          value={titleCoverDraft.originalTitle}
          onChange={(event) =>
            onTitleCoverOriginalTitleChange(event.target.value)
          }
          placeholder={labels.titleCover.originalTitlePlaceholder}
          className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          maxLength={4000}
          data-image-title-cover-original-title="true"
        />
      </label>
      <label className="grid min-w-0 gap-1.5">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {labels.titleCover.mainCopy} *
        </span>
        <textarea
          required
          value={titleCoverDraft.mainCopy}
          onChange={(event) => onTitleCoverMainCopyChange(event.target.value)}
          placeholder={labels.titleCover.mainCopyPlaceholder}
          className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[15px] leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          maxLength={200}
          data-image-title-cover-main-copy="true"
        />
      </label>
      <label className="grid min-w-0 gap-1.5">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {labels.titleCover.secondaryCopy}
        </span>
        <textarea
          value={titleCoverDraft.secondaryCopy}
          onChange={(event) =>
            onTitleCoverSecondaryCopyChange(event.target.value)
          }
          placeholder={labels.titleCover.secondaryCopyPlaceholder}
          className="min-h-16 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[15px] leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          maxLength={200}
          data-image-title-cover-secondary-copy="true"
        />
      </label>
      {mobile ? (
        <>
          {renderTitleCoverStyle()}
          {renderTitleCoverTypographyPreset()}
          {renderTitleCoverGenerateAction()}
          <section
            className="grid min-w-0 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
            data-image-title-cover-mobile-advanced="true"
          >
            <button
              type="button"
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-1 text-left text-sm font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:text-slate-200"
              aria-expanded={isMobileTitleCoverAdvancedOpen}
              onClick={() =>
                setIsMobileTitleCoverAdvancedOpen((open) => !open)
              }
              data-image-title-cover-mobile-advanced-toggle="true"
            >
              <span>{labels.titleCover.advancedSettings}</span>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 transition ${isMobileTitleCoverAdvancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isMobileTitleCoverAdvancedOpen ? (
              <div
                className="grid min-w-0 gap-3"
                data-image-title-cover-mobile-advanced-content="true"
              >
                {renderTitleCoverReference()}
                <label className="grid min-w-0 gap-1.5">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {labels.model}
                  </span>
                  <span className={parameterControlClassName}>
                    <select
                      className={parameterSelectClassName}
                      value={selectedModelId}
                      onChange={(event) => onSelectModel(event.target.value)}
                      aria-label={mobileModelAccessibleLabel}
                      disabled={isLoading || models.length === 0}
                      data-image-title-cover-model="true"
                    >
                      {models.length === 0 ? (
                        <option value="">{labels.noModels}</option>
                      ) : (
                        models.map((model) => (
                          <option key={model.id} value={model.slug}>
                            {getModelDisplayName(model)}
                          </option>
                        ))
                      )}
                    </select>
                    <ChevronDown
                      aria-hidden="true"
                      className={parameterChevronClassName}
                    />
                  </span>
                </label>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <label className="grid min-w-0 gap-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {labels.aspectRatio}
                    </span>
                    <span className={parameterControlClassName}>
                      <select
                        className={parameterSelectClassName}
                        value={aspectRatio}
                        onChange={(event) =>
                          onSelectAspectRatio(event.target.value as ImageAspectRatio)
                        }
                        aria-label={labels.aspectRatio}
                        disabled={isLoading}
                        data-image-title-cover-aspect="true"
                      >
                        {aspectRatios.map((ratio) => (
                          <option key={ratio} value={ratio}>
                            {ratio}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        aria-hidden="true"
                        className={parameterChevronClassName}
                      />
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {labels.pixelSize}: {size}
                    </span>
                  </label>
                  <GenerationCountPicker
                    quantity={quantity}
                    onSelect={onSelectQuantity}
                    disabled={isLoading}
                    label={labels.quantity}
                    optionLabel={labels.quantityOption}
                  />
                </div>
                {renderTitleCoverColorOverrides()}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <>
          {renderTitleCoverReference()}
          {renderTitleCoverStyle()}
          {renderTitleCoverTypographyPreset()}
          {renderTitleCoverColorOverrides()}
          <div className="grid min-w-0 gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label className="grid min-w-0 self-start gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {labels.model}
              </span>
              <span className={parameterControlClassName}>
                {selectedModel ? (
                  <ModelIcon
                    model={selectedModel}
                    selected
                    className="ml-2 size-7 shrink-0 rounded-md"
                    imageClassName="size-4"
                  />
                ) : null}
                <select
                  className={parameterSelectClassName}
                  value={selectedModelId}
                  onChange={(event) => onSelectModel(event.target.value)}
                  aria-label={labels.model}
                  disabled={isLoading || models.length === 0}
                  data-image-title-cover-model="true"
                >
                  {models.length === 0 ? (
                    <option value="">{labels.noModels}</option>
                  ) : (
                    models.map((model) => (
                      <option key={model.id} value={model.slug}>
                        {getModelDisplayName(model)}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className={parameterChevronClassName}
                />
              </span>
            </label>
            <label className="grid min-w-0 self-start gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {labels.aspectRatio}
              </span>
              <span className={parameterControlClassName}>
                <select
                  className={parameterSelectClassName}
                  value={aspectRatio}
                  onChange={(event) =>
                    onSelectAspectRatio(event.target.value as ImageAspectRatio)
                  }
                  aria-label={labels.aspectRatio}
                  disabled={isLoading}
                  data-image-title-cover-aspect="true"
                >
                  {aspectRatios.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className={parameterChevronClassName}
                />
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {labels.pixelSize}: {size}
              </span>
            </label>
          </div>
          <section className="border-t border-slate-100 pt-3 dark:border-slate-800">
            <GenerationCountPicker
              quantity={quantity}
              onSelect={onSelectQuantity}
              disabled={isLoading}
              label={labels.quantity}
              optionLabel={labels.quantityOption}
            />
          </section>
          {renderTitleCoverGenerateAction()}
        </>
      )}
    </form>
  );

  return (
    <section className="mx-auto grid w-full min-w-0 max-w-[96rem] gap-4 md:gap-5" data-image-creation-workspace="true" data-image-creator-workspace="true" data-image-workbench-generation-mode={generationMode}>
      <header className="flex min-w-0 items-center gap-3 border-b border-slate-200 pb-3 dark:border-slate-800 md:justify-between" data-image-workflow-switcher="true">
        <div className="flex min-w-0 flex-1 snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain pb-1 pr-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={labels.freeCreation} data-image-workflow-scroller="true">
          <button type="button" role="tab" aria-selected={workflow === "free-create"} aria-disabled={false} onClick={() => onSelectWorkflow("free-create")} className={`min-h-11 shrink-0 snap-start rounded-full px-2.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 sm:px-3 sm:text-sm ${workflow === "free-create" ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`} data-image-workflow="free-create" data-image-workflow-active-treatment={workflow === "free-create" ? "pill" : undefined}>
            {labels.workflows.freeCreate}
          </button>
          <button type="button" role="tab" aria-selected={workflow === "precision-edit"} aria-disabled={false} onClick={() => onSelectWorkflow("precision-edit")} className={`inline-flex min-h-11 shrink-0 snap-start items-center gap-1 rounded-full px-2.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 sm:px-3 sm:text-sm ${workflow === "precision-edit" ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`} data-image-workflow="reference-edit" data-image-workflow-active-treatment={workflow === "precision-edit" ? "pill" : undefined}>
            {labels.workflows.referenceEdit}
          </button>
          <button type="button" role="tab" aria-selected={workflow === "title-cover"} aria-disabled={false} onClick={() => onSelectWorkflow("title-cover")} className={`inline-flex min-h-11 shrink-0 snap-start items-center gap-1 rounded-full px-2.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 sm:px-3 sm:text-sm ${workflow === "title-cover" ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`} data-image-workflow="title-cover" data-image-workflow-active-treatment={workflow === "title-cover" ? "pill" : undefined}>
            {labels.workflows.titleCover}
          </button>
          <button type="button" role="tab" aria-selected={workflow === "transcript-images"} aria-disabled={false} onClick={() => onSelectWorkflow("transcript-images")} className={`inline-flex min-h-11 shrink-0 snap-start items-center gap-1 rounded-full px-2.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 sm:px-3 sm:text-sm ${workflow === "transcript-images" ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`} data-image-workflow="transcript-images" data-image-workflow-active-treatment={workflow === "transcript-images" ? "pill" : undefined}>
            {labels.workflows.transcriptImages}
          </button>
        </div>
        <div className="hidden shrink-0 items-center gap-1 md:flex" data-image-desktop-utility-actions="true">
          <Button
            type="button"
            variant="ghost"
            className="min-h-10 rounded-lg px-3 py-2 text-sm"
            onClick={onStartNewDrawing}
            disabled={isNewDrawingBlocked}
            aria-label={labels.newDrawing}
            title={labels.newDrawing}
            data-image-desktop-new-drawing="true"
            data-image-new-drawing-btn="true"
          >
            <Plus className="size-4" aria-hidden="true" />
            {labels.newDrawing}
          </Button>
          <Link href="/image/history" className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-800" data-image-creator-history="true">
            {labels.history}
          </Link>
        </div>
      </header>

      <div className={`grid min-w-0 items-start gap-5 ${isMobileLayout ? "max-w-full" : "lg:grid-cols-[minmax(19rem,0.72fr)_minmax(0,1.68fr)] lg:gap-7"}`} data-image-creator-main="left-input-right-result">
        {isMobileLayout
          ? isTitleCoverWorkflow
            ? renderTitleCoverComposer(true)
            : isTranscriptImagesWorkflow
              ? renderTranscriptImagesComposer()
              : !hasReadyResult
                ? renderMobileComposer()
                : null
          : null}
        {!isMobileLayout ? (
        isTitleCoverWorkflow ? renderTitleCoverComposer() : isTranscriptImagesWorkflow ? renderTranscriptImagesComposer() : (
        <form className="order-2 grid min-w-0 gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 lg:order-1 lg:gap-5 lg:border-r lg:border-t-0 lg:pr-7 lg:pt-0" onSubmit={onSubmit} data-image-workbench-editor="true" data-image-creator-input="true" data-image-creator-desktop-composer="true">
          <label className="grid min-w-0 gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{promptLabel}</span>
            <textarea className="min-h-24 w-full min-w-0 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[15px] leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 lg:min-h-36 lg:py-3" placeholder={promptPlaceholder} ref={promptInputRef} value={prompt} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={onPromptKeyDown} maxLength={4000} data-image-workbench-prompt="true" data-image-composer-prompt="true" />
          </label>
          <div className="flex items-center gap-2 text-sm"><button type="button" onClick={onRandomInspiration} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:text-slate-300 dark:hover:bg-slate-800" data-image-random-inspiration="true"><Shuffle className="size-4" />{labels.randomInspiration}</button></div>

          <section className="grid min-w-0 gap-2 border-t border-slate-100 pt-4 dark:border-slate-800" data-image-workbench-reference="true">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{referenceSectionLabel}</span><span className="text-xs text-slate-500 dark:text-slate-400">{labels.referenceCount(referenceImages.length, referenceLimit)}</span></div>
            <div className={`grid min-w-0 gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-900/60 ${isReferenceDragActive ? "ring-2 ring-indigo-600 ring-offset-2" : ""}`} onDragOver={onReferenceDragOver} onDragLeave={onReferenceDragLeave} onDrop={onReferenceDrop} data-image-drag-upload="reference-image" data-image-drag-active={isReferenceDragActive ? "true" : "false"} data-image-drag-uses-existing-validation="true" data-reference-image-preview={referenceImages.length ? "true" : undefined} data-image-reference-empty-upload={referenceImages.length ? undefined : "true"} data-image-precision-edit-source-required={isPrecisionEditWorkflow && !referenceImages.length ? "true" : undefined}>
              {referenceImages.length > 0 ? <ReferenceImageCollection references={referenceImages} onRemove={onRemoveReferenceImage} onMove={onMoveReferenceImage} labels={labels} disabled={referenceMutationLocked} dataPrefix="image" /> : <div className="flex items-center gap-2"><div className="grid size-12 shrink-0 place-items-center rounded-md border border-dashed border-slate-300 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-950"><ImagePlus className="size-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{referenceEmptyLabel}</p><p className="text-xs text-slate-500 dark:text-slate-400">{referenceHint}</p></div></div>}
              {continuationSourceVersion ? <p className="truncate text-xs text-slate-500 dark:text-slate-400" data-image-workbench-continuation-source="true">{labels.basedOnVersion.replace("{version}", String(continuationSourceVersion.versionNumber))}</p> : null}
              <label className={`inline-flex min-h-11 w-fit items-center rounded-lg px-3 text-sm font-semibold text-slate-700 focus-within:ring-2 focus-within:ring-indigo-600 dark:text-slate-200 ${referenceInputDisabled ? "pointer-events-none opacity-60" : "cursor-pointer hover:bg-white dark:hover:bg-slate-800"}`}><Upload className="mr-2 size-4" />{isPrecisionEditWorkflow && referenceImages.length ? labels.replaceReference : referenceLimit > 1 ? labels.addReferences : labels.addReference}<input ref={referenceInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple={!isPrecisionEditWorkflow && referenceLimit > 1} onChange={handleReferenceChange} disabled={referenceInputDisabled} data-image-workbench-reference-input="true" /></label>
            </div>
            {referenceLimit === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400" data-image-reference-unsupported="true">{labels.modelDoesNotSupportReferences}</p> : null}
            {referenceLimitExceeded ? <p className="text-xs text-amber-700 dark:text-amber-300" role="alert" data-image-reference-limit-error="true">{labels.referenceLimitExceeded}</p> : null}
            {referenceImageCompression.status === "compressing" ? <p className="text-xs text-slate-500 dark:text-slate-400">{referenceImageStatusText}</p> : null}
            {referencePreparationState === "PREPARING_REFERENCE" ? <div className="flex items-center gap-2 text-sm text-indigo-700 dark:text-indigo-300" role="status" aria-live="polite" data-image-reference-preparation="PREPARING_REFERENCE"><span>{labels.preparingReference}</span><button type="button" className="min-h-10 rounded-lg px-2 font-semibold underline" onClick={onDiscardReferencePreparation}>{labels.discardReference}</button></div> : null}
            {referencePreparationState === "TRANSIENT_FAILURE" ? <div className="flex flex-wrap items-center gap-2 text-sm text-red-700 dark:text-red-300" role="alert" data-image-reference-preparation="TRANSIENT_FAILURE"><span>{labels.referencePreparationFailed}</span><button type="button" className="min-h-10 rounded-lg px-2 font-semibold underline" onClick={onRetryReferencePreparation}>{labels.retryReference}</button><button type="button" className="min-h-10 rounded-lg px-2 font-semibold underline" onClick={onDiscardReferencePreparation}>{labels.discardReference}</button></div> : null}
          </section>

          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label className="grid min-w-0 self-start gap-2"><span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{labels.model}</span><span className={parameterControlClassName} data-image-parameter-control="model" data-image-parameter-focus-surface="wrapper">{selectedModel ? <ModelIcon model={selectedModel} selected className="ml-2 size-7 shrink-0 rounded-md" imageClassName="size-4" /> : null}<select className={parameterSelectClassName} value={selectedModelId} onChange={(event) => onSelectModel(event.target.value)} aria-label={labels.model} data-image-workbench-model="true">{models.length === 0 ? <option value="">{labels.noModels}</option> : models.map((model) => <option key={model.id} value={model.slug} data-image-model-current={model.slug === selectedModelId ? "true" : undefined}>{getModelDisplayName(model)}</option>)}</select><ChevronDown aria-hidden="true" className={parameterChevronClassName} data-image-parameter-chevron="true" /></span></label>
            <label className="grid min-w-0 self-start gap-2"><span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{labels.aspectRatio}</span><span className={`${parameterControlClassName} ${referencePreparationLocked ? "opacity-60" : ""}`} data-image-parameter-control="aspect" data-image-parameter-focus-surface="wrapper"><select className={parameterSelectClassName} value={aspectRatio} disabled={referencePreparationLocked} onChange={(event) => onSelectAspectRatio(event.target.value as ImageAspectRatio)} aria-label={labels.aspectRatio} data-image-workbench-size="true">{aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select><ChevronDown aria-hidden="true" className={parameterChevronClassName} data-image-parameter-chevron="true" /></span><span className="text-xs text-slate-500 dark:text-slate-400">{labels.pixelSize}: {size}</span></label>
          </div>

          <section className="border-t border-slate-100 pt-3 dark:border-slate-800" data-image-workbench-structured-settings="true"><GenerationCountPicker quantity={quantity} onSelect={onSelectQuantity} disabled={isLoading || referencePreparationLocked} label={labels.quantity} optionLabel={labels.quantityOption} /></section>

          <div className="grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800"><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400"><span data-image-workbench-cost="true">{labels.cost}: {estimatedCost}</span><span data-image-workbench-balance="true">{labels.balance}: {credits ?? "-"}</span></div>{!isLoggedIn ? <p className="text-xs text-slate-500 dark:text-slate-400" data-image-login-required-hint="true">{labels.loginRequired}</p> : null}<Button type="submit" className="min-h-12 w-full rounded-lg" disabled={!canGenerate} aria-busy={isLoading} data-image-workbench-generate="true" data-image-generate-button="true" data-image-generate-request-flow="unchanged" data-image-logged-out-guard={isLoggedIn ? undefined : "toast-no-generate"}><SendHorizontal className="size-4" />{isLoading ? labels.generating : resultBatches.length > 0 ? labels.regenerate : labels.generate}</Button></div>
        </form>
        )
        ) : null}

        <section className={`grid min-w-0 content-start gap-4 ${isMobileLayout && isTitleCoverWorkflow ? "contents" : isMobileLayout ? "" : "order-1 lg:order-2"}`} data-image-workbench-result="true" data-image-creator-result="true">
          <div className={`flex items-start justify-between gap-3 ${titleCoverMobileResultHeroOrder}`} data-image-title-cover-result-header="true"><div><h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">{isTitleCoverWorkflow ? labels.titleCover.resultLabel : resultLabel}</h2>{isTitleCoverWorkflow ? <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400" data-image-title-cover-result-description="true">{labels.titleCover.resultDescription}</p> : isPrecisionEditWorkflow ? <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400" data-image-precision-edit-result-description="true">{labels.precisionEdit.resultDescription}</p> : resultDescription ? <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{resultDescription}</p> : null}</div>{!isTitleCoverWorkflow && selectedResultVersion ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-image-creator-selected-result="true"><Check className="size-3.5" />{labels.selected}</span> : null}</div>
          {isTitleCoverWorkflow && selectedResultVersion && resultAsset ? <div className={titleCoverMobileResultHeroOrder} data-image-title-cover-result-hero="true"><TitleCoverPreview sourceUrl={resultAsset.url} sourceIdentity={selectedResultVersion.resultEntryId} token={token} mainCopy={titleCoverDraft.mainCopy} secondaryCopy={titleCoverDraft.secondaryCopy} originalTitle={titleCoverDraft.originalTitle} typography={titleCoverTypographyDraft} targetSize={size} labels={labels.titleCover} /></div> : null}
          {isTitleCoverWorkflow && !latestEntry ? (
            <div
              className={`grid place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center dark:border-slate-700 dark:bg-slate-900/50 ${isMobileLayout ? "min-h-28 py-5" : "min-h-72 py-10"} ${titleCoverMobileResultDetailsOrder}`}
              data-image-title-cover-result-empty="true"
              data-image-result-empty="true"
              data-image-empty-state="true"
            >
              <div className="grid max-w-sm justify-items-center gap-2">
                <ImagePlus className="size-7 text-slate-400" />
                <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {labels.titleCover.resultEmpty}
                </p>
              </div>
            </div>
          ) : !latestEntry ? <div className={`grid place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center dark:border-slate-700 dark:bg-slate-900/50 ${isMobileLayout ? "min-h-28 py-5" : "min-h-72 py-10"} ${titleCoverMobileResultDetailsOrder}`} data-image-workbench-result-empty="true" data-image-result-empty="true" data-image-empty-state="true"><div className="grid max-w-xs justify-items-center gap-2"><ImagePlus className="size-7 text-slate-400" /><p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{labels.empty}</p></div></div> : latestEntry.status === "loading" && !selectedResultVersion ? <div className={`grid content-center gap-3 ${isMobileLayout ? "min-h-36" : "min-h-72"} ${titleCoverMobileResultDetailsOrder}`} data-image-workbench-result-loading="true" data-image-ai-status="loading" data-image-ai-loading="true" data-image-loading-skeleton="true"><p className="text-sm text-slate-600 dark:text-slate-400">{labels.loading}</p>{renderPlaceholders(requestedCount)}</div> : latestEntry.status === "checking" && !selectedResultVersion ? <div className={`grid content-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300 ${isMobileLayout ? "min-h-36" : "min-h-72"} ${titleCoverMobileResultDetailsOrder}`} data-image-workbench-result-checking="true" data-image-ai-status="checking"><p>{latestEntry.error || labels.checking}</p>{renderPlaceholders(requestedCount, true)}{canResumeRequest ? <Button type="button" className="w-fit" onClick={onResumeRequest} data-image-resume-request-button="true">{labels.resumeRequest}</Button> : null}</div> : latestEntry.status === "failed" && !selectedResultVersion ? <div className={`grid place-items-center rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 ${isMobileLayout ? "min-h-36" : "min-h-72"} ${titleCoverMobileResultDetailsOrder}`} data-image-workbench-result-failed="true" data-image-ai-status="failed"><p data-image-ai-error="true">{latestEntry.error || labels.failed}</p>{canRetryAsNewRequest ? <Button type="button" className="w-fit" onClick={onRetryAsNewRequest} data-image-retry-as-new-request-button="true">{labels.retryAsNewRequest}</Button> : null}</div> : resultAsset && selectedResultVersion ? <div className={`grid min-w-0 gap-4 ${titleCoverMobileResultDetailsOrder}`} data-image-workbench-result-success="true" data-image-ai-status="succeeded" data-image-ai-result="true"><ResolvedResultPreviewButton logicalUrl={resultAsset.url} token={token} alt={labels.imageAlt} ariaLabel={resultAsset.title || labels.imageAlt} downloadLabel={labels.download} showDownload={!isTitleCoverWorkflow} onOpen={(resolvedUrl) => onPreviewImage(resolvedUrl, resultAsset.title || labels.imageAlt)} />
            {batchAlternatives.length > 0 ? <section className="grid min-w-0 gap-2 border-t border-slate-200 pt-3 dark:border-slate-800" data-image-workbench-result-entries="true" data-image-creator-batch="true"><h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">{labels.batchResults}</h3><div className="flex min-w-0 gap-2 overflow-x-auto">{batchAlternatives.map((entry, index) => { const selected = entry.resultEntryId === selectedResultVersion.resultEntryId; return <button key={entry.resultEntryId} type="button" className={`grid w-20 shrink-0 gap-1 rounded-lg border p-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${selected ? "border-slate-950 ring-2 ring-slate-950 dark:border-slate-100 dark:ring-slate-100" : "border-slate-200 dark:border-slate-700"}`} onClick={() => onSelectResultVersion(entry.resultEntryId)} aria-label={labels.selectResult(index + 1)} aria-current={selected ? "true" : undefined} aria-pressed={selected} data-image-workbench-result-entry={entry.resultEntryId} data-image-workbench-result-entry-selected={selected ? "true" : "false"}><ResolvedAssetImage src={entry.asset.thumbnailUrl ?? entry.displayUrl} token={token} alt={labels.resultLabel(index + 1)} className="h-14 w-full rounded-md object-cover" /><span className="truncate px-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">{labels.resultLabel(index + 1)}</span></button>; })}</div></section> : null}
            {previousBatches.length > 0 ? <section className="grid min-w-0 gap-2 border-t border-slate-200 pt-3 dark:border-slate-800" data-image-workbench-result-versions="true" data-image-creator-versions="true"><h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">{labels.versions}</h3><div className="flex min-w-0 gap-2 overflow-x-auto">{previousBatches.map((batch) => { const first = batch.assets[0]; if (!first) return null; const selected = batch.batchId === selectedResultVersion.batchId; const representativeEntryId = selected ? selectedResultVersion.resultEntryId : first.resultEntryId; return <button key={batch.batchId} type="button" className={`grid w-20 shrink-0 gap-1 rounded-lg border p-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${selected ? "border-slate-950 ring-2 ring-slate-950 dark:border-slate-100 dark:ring-slate-100" : "border-slate-200 dark:border-slate-700"}`} onClick={() => onSelectResultVersion(representativeEntryId)} aria-label={labels.selectVersion.replace("{version}", String(batch.versionNumber))} aria-pressed={selected} data-image-workbench-version={batch.versionNumber} data-image-workbench-result-batch={batch.batchId} data-image-workbench-version-selected={selected ? "true" : "false"}><ResolvedAssetImage src={first.asset.thumbnailUrl ?? first.displayUrl} token={token} alt={labels.versionLabel.replace("{version}", String(batch.versionNumber))} className="h-14 w-full rounded-md object-cover" /><span className="truncate px-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">{labels.versionLabel.replace("{version}", String(batch.versionNumber))}</span></button>; })}</div></section> : null}
            {selectedResultBatch?.partialSuccess ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" data-image-workbench-partial-success="true">{labels.partialSuccess(selectedResultBatch.assets.length, selectedResultBatch.requestedCount)}</p> : null}
            {selectedResultBatch && selectedResultBatch.acceptedAssetCount > selectedResultBatch.requestedCount ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-image-workbench-result-count-violation="true">{labels.resultCountViolation(selectedResultBatch.requestedCount, selectedResultBatch.acceptedAssetCount)}</p> : null}
            {latestEntry.status === "loading" && resultBatches.length > 0 ? <div className="grid gap-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-image-workbench-generating-new="true"><p>{labels.generatingNewVersion}</p>{renderPlaceholders(requestedCount)}</div> : null}
            {latestEntry.status === "checking" && resultBatches.length > 0 ? <div className="grid gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-image-workbench-generating-new="true" data-image-workbench-result-checking="true"><p>{latestEntry.error || labels.generatingNewVersion}</p>{renderPlaceholders(requestedCount, true)}{canResumeRequest ? <Button type="button" className="w-fit" onClick={onResumeRequest} data-image-resume-request-button="true">{labels.resumeRequest}</Button> : null}</div> : null}
            {latestEntry.status === "failed" && resultBatches.length > 0 ? <div className="grid gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-300" data-image-workbench-result-latest-failed="true"><p>{latestEntry.error || labels.failed}</p>{canRetryAsNewRequest ? <Button type="button" className="w-fit" onClick={onRetryAsNewRequest} data-image-retry-as-new-request-button="true">{labels.retryAsNewRequest}</Button> : null}</div> : null}
            <div className="flex min-w-0 flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">{canContinueFromResult ? <Button type="button" className="min-h-11 rounded-lg" disabled={referencePreparationLocked} aria-busy={referencePreparationLocked} onClick={onContinueEditing} aria-label={`${labels.continueEditing}: ${labels.useAsReference}`} data-image-workbench-continue-editing="true">{referencePreparationLocked ? labels.preparingContinuation : labels.continueEditing}</Button> : null}{canReusePrompt ? <Button type="button" className="min-h-11 rounded-lg" onClick={onReusePrompt} data-image-workbench-reuse-prompt="true">{labels.reusePrompt}</Button> : null}{!isTitleCoverWorkflow && hasOwnerReadableResultAsset ? <Link href={`/assets/${resultAsset.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:border-slate-700 dark:text-slate-200" data-image-workbench-asset-link="true"><span>{labels.viewAsset}</span><span className="ml-1 text-xs text-slate-500 dark:text-slate-400">{labels.saved}</span></Link> : null}{resultTaskId ? <Link href={`/tasks/${resultTaskId}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-800" data-image-workbench-task-link="true"><ExternalLink className="size-4" />{labels.viewTask}</Link> : null}</div>
          </div> : <div className="rounded-xl border border-slate-200 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400" data-image-workbench-result-unavailable="true">{labels.failed}</div>}
        </section>
        {isMobileLayout && !isTitleCoverWorkflow && !isTranscriptImagesWorkflow && hasReadyResult
          ? renderMobileComposer()
          : null}
      </div>
    </section>
  );
}
