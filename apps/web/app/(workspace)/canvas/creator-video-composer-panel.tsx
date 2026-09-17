"use client";

import type { PublicVideoModelSummary } from "@ai-aggregate/shared";
import { getModelDisplayName } from "@ai-aggregate/shared";
import { ImageIcon, LoaderCircle, RefreshCw, Type, Video } from "lucide-react";
import React from "react";
import { useI18n } from "../../../lib/i18n/use-i18n";
import type { CreatorNodeComposerContext } from "./creator-node-composer-context";
import {
  CREATOR_VIDEO_COMPOSER_MAX_PROMPT_LENGTH,
  creatorVideoComposerModes,
  getCreatorVideoImageReferenceCandidates,
  getCreatorVideoTextReferences,
  getCreatorVideoTextSourcePreview,
  type CreatorVideoComposerDraft,
  type CreatorVideoComposerMode
} from "./creator-video-composer";

export type CreatorVideoExecutionStatus =
  | "idle"
  | "preparing"
  | "submitting"
  | "checking"
  | "unresolved"
  | "failed";

export type CreatorVideoNodeExecutionView = Readonly<{
  status: CreatorVideoExecutionStatus;
  progress: number | null;
  taskId: string | null;
  errorMessage: string | null;
}>;

export interface CreatorVideoComposerExecutionView extends CreatorVideoNodeExecutionView {
  authenticated: boolean;
  onExecute: () => void;
  onResume: () => void;
}

export interface CreatorVideoComposerView {
  context: CreatorNodeComposerContext;
  draft: CreatorVideoComposerDraft;
  models: readonly PublicVideoModelSummary[];
  modelsLoading: boolean;
  effectiveModel: PublicVideoModelSummary | null;
  onPromptChange: (prompt: string) => void;
  onPromptReset: () => void;
  onTextSourceSelect: (nodeId: string) => void;
  onImageReferenceSelect: (nodeId: string) => void;
  onModeChange: (mode: CreatorVideoComposerMode) => void;
  onModelChange: (modelId: string) => void;
  presentation?: "card" | "workspace";
  execution: CreatorVideoComposerExecutionView;
}

function SourceChip({
  children,
  disabled = false,
  selected = false,
  onClick,
  testId
}: {
  children: React.ReactNode;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      className={`nodrag nopan nowheel max-w-full rounded-full border px-2.5 py-1 text-left text-[11px] leading-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
        selected
          ? "border-indigo-500 bg-indigo-50 font-semibold text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-200"
          : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-600 dark:hover:text-indigo-200"
      } disabled:cursor-not-allowed disabled:opacity-45`}
      disabled={disabled}
      onClick={onClick}
      data-creator-video-source-chip={testId}
      data-selected={selected ? "true" : "false"}
    >
      {children}
    </button>
  );
}

function statusMessage(
  execution: CreatorVideoComposerExecutionView,
  t: (key: string, values?: Record<string, string | number>) => string
): string | null {
  switch (execution.status) {
    case "preparing":
      return t("creator.canvas.videoComposer.status.preparing");
    case "submitting":
      return t("creator.canvas.videoComposer.status.submitting");
    case "checking":
      return t("creator.canvas.videoComposer.status.checking");
    case "unresolved":
      return t("creator.canvas.videoComposer.status.unresolved");
    case "failed":
      return execution.errorMessage ?? t("creator.canvas.videoComposer.status.failed");
    case "idle":
      return null;
  }
}

export function CreatorVideoComposerPanel({
  context,
  draft,
  models,
  modelsLoading,
  effectiveModel,
  onPromptChange,
  onPromptReset,
  onTextSourceSelect,
  onImageReferenceSelect,
  onModeChange,
  onModelChange,
  execution,
  presentation = "card"
}: CreatorVideoComposerView) {
  const { t } = useI18n();
  const textReferences = getCreatorVideoTextReferences(context);
  const imageCandidates = getCreatorVideoImageReferenceCandidates(context);
  const promptTooLong = draft.prompt.length > CREATOR_VIDEO_COMPOSER_MAX_PROMPT_LENGTH;
  const busy = execution.status === "preparing" ||
    execution.status === "submitting" || execution.status === "checking";
  const unresolved = execution.status === "unresolved";
  const controlsLocked = busy || unresolved;
  const canExecute = Boolean(
    execution.authenticated &&
    draft.prompt.trim() &&
    !promptTooLong &&
    effectiveModel &&
    (draft.mode === "text-to-video" ||
      imageCandidates.some((candidate) => candidate.nodeId === draft.selectedImageReferenceNodeId))
  );
  const message = statusMessage(execution, t);
  const isWorkspacePresentation = presentation === "workspace";

  return (
    <section
      className={isWorkspacePresentation
        ? "nodrag nopan nowheel w-full min-w-0 text-slate-900 dark:text-slate-100"
        : "nodrag nopan nowheel w-[23rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white/95 p-3.5 text-slate-900 shadow-2xl shadow-slate-950/20 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"}
      aria-label={t("creator.canvas.videoComposer.title")}
      data-creator-video-composer="true"
      data-creator-video-composer-presentation={presentation}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold">{t("creator.canvas.videoComposer.title")}</h2>
          <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
            {t("creator.canvas.videoComposer.transient")}
          </p>
        </div>
        <Video className="size-4 text-violet-600 dark:text-violet-300" aria-hidden="true" />
      </div>

      <div
        className="mt-3 flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
        aria-label={t("creator.canvas.videoComposer.mode")}
      >
        {creatorVideoComposerModes.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`nodrag nopan flex-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
              draft.mode === mode
                ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-indigo-200"
                : "text-slate-500 dark:text-slate-400"
            }`}
            disabled={controlsLocked}
            onClick={() => onModeChange(mode)}
            aria-pressed={draft.mode === mode}
            data-creator-video-mode={mode}
          >
            {t(`creator.canvas.videoComposer.mode.${mode}`)}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        {t("creator.canvas.videoComposer.prompt")}
        <textarea
          className={`nodrag nopan nowheel mt-1.5 min-h-24 w-full resize-none rounded-xl border bg-slate-50 px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 dark:bg-slate-950 ${
            promptTooLong
              ? "border-red-400 focus-visible:ring-red-200 dark:border-red-500 dark:focus-visible:ring-red-950"
              : "border-slate-200 focus-visible:border-indigo-400 focus-visible:ring-indigo-200 dark:border-slate-700 dark:focus-visible:ring-indigo-900"
          }`}
          value={draft.prompt}
          disabled={controlsLocked}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={t("creator.canvas.videoComposer.promptPlaceholder")}
          aria-invalid={promptTooLong}
          aria-describedby="creator-video-composer-prompt-count"
          data-creator-video-prompt="true"
        />
      </label>
      <div className="mt-1 flex items-center justify-between gap-3 text-[10px]">
        <button
          type="button"
          className="nodrag nopan inline-flex items-center gap-1 font-medium text-slate-500 underline-offset-2 hover:text-indigo-700 hover:underline dark:text-slate-400 dark:hover:text-indigo-300"
          disabled={controlsLocked}
          onClick={onPromptReset}
          data-creator-video-prompt-reset="true"
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          {t("creator.canvas.videoComposer.promptReset")}
        </button>
        <span
          id="creator-video-composer-prompt-count"
          className={promptTooLong ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-400"}
        >
          {draft.prompt.length}/{CREATOR_VIDEO_COMPOSER_MAX_PROMPT_LENGTH}
        </span>
      </div>

      {textReferences.length > 0 ? (
        <div className="mt-3" data-creator-video-text-references="true">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Type className="size-3" aria-hidden="true" />
            {t("creator.canvas.videoComposer.textReferences")}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {textReferences.map((reference) => (
              <SourceChip
                key={reference.edgeId}
                testId="text"
                disabled={controlsLocked || draft.promptDirty}
                selected={draft.promptSeedSourceNodeId === reference.nodeId}
                onClick={() => onTextSourceSelect(reference.nodeId)}
              >
                {getCreatorVideoTextSourcePreview(reference.text) ||
                  t("creator.canvas.videoComposer.emptyText")}
              </SourceChip>
            ))}
          </div>
          {draft.promptDirty ? (
            <p className="mt-1 text-[10px] text-slate-400">
              {t("creator.canvas.videoComposer.promptAuthoritative")}
            </p>
          ) : textReferences.length > 1 && draft.promptSeedSourceNodeId === null ? (
            <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
              {t("creator.canvas.videoComposer.chooseTextSource")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3" data-creator-video-image-references="true">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <ImageIcon className="size-3" aria-hidden="true" />
          {t("creator.canvas.videoComposer.imageReferences")}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {imageCandidates.length === 0 ? (
            <span className="text-[10px] text-slate-400">
              {t("creator.canvas.videoComposer.noImageReference")}
            </span>
          ) : imageCandidates.map((candidate, index) => (
            <SourceChip
              key={candidate.edgeId}
              testId="image"
              disabled={controlsLocked || draft.mode !== "image-to-video"}
              selected={draft.selectedImageReferenceNodeId === candidate.nodeId}
              onClick={() => onImageReferenceSelect(candidate.nodeId)}
            >
              {t("creator.canvas.videoComposer.incomingImage", { index: index + 1 })}
            </SourceChip>
          ))}
        </div>
        {draft.mode === "image-to-video" && draft.selectedImageReferenceNodeId === null ? (
          <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
            {t("creator.canvas.videoComposer.chooseImageReference")}
          </p>
        ) : null}
      </div>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {t("creator.canvas.videoComposer.model")}
        <select
          className="nodrag nopan nowheel mt-1.5 min-h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-indigo-900"
          value={draft.modelId}
          onChange={(event) => onModelChange(event.target.value)}
          disabled={controlsLocked || modelsLoading || models.length === 0}
          aria-label={t("creator.canvas.videoComposer.model")}
          data-creator-video-model="true"
        >
          {models.length === 0 ? (
            <option value="">
              {t(modelsLoading ? "creator.canvas.videoComposer.modelsLoading" : "creator.canvas.videoComposer.noModels")}
            </option>
          ) : null}
          {models.map((model) => (
            <option key={model.slug} value={model.slug}>
              {getModelDisplayName(model)}
            </option>
          ))}
        </select>
      </label>

      {effectiveModel ? (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400" data-creator-video-model-profile="true">
          <span>{t("creator.canvas.videoComposer.duration", { value: effectiveModel.videoProfile.durationSeconds })}</span>
          <span>{t("creator.canvas.videoComposer.resolution", { value: effectiveModel.videoProfile.resolution ?? "—" })}</span>
          <span>{t("creator.canvas.videoComposer.aspectRatio", { value: effectiveModel.videoProfile.aspectRatio })}</span>
          <span className="text-right font-semibold text-indigo-700 dark:text-indigo-300" data-creator-video-estimated-cost={effectiveModel.creditCost}>
            {t("creator.canvas.videoComposer.estimatedCost", { cost: effectiveModel.creditCost })}
          </span>
        </div>
      ) : null}

      {!execution.authenticated ? (
        <p className="mt-2 text-[10px] font-medium text-amber-700 dark:text-amber-300" role="status">
          {t("creator.canvas.videoComposer.loginRequired")}
        </p>
      ) : null}
      {message ? (
        <p
          className={`mt-2 text-[11px] leading-4 ${execution.status === "failed" ? "text-red-600 dark:text-red-300" : "text-slate-500 dark:text-slate-400"}`}
          role={execution.status === "failed" ? "alert" : "status"}
          data-creator-video-execution-status={execution.status}
        >
          {message}
          {execution.progress !== null && (execution.status === "checking" || execution.status === "unresolved")
            ? ` · ${execution.progress}%`
            : ""}
        </p>
      ) : null}

      <button
        type="button"
        className="nodrag nopan nowheel mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={unresolved ? execution.onResume : execution.onExecute}
        disabled={unresolved ? !execution.authenticated : !canExecute || busy}
        data-creator-video-execute="true"
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Video className="size-3.5" aria-hidden="true" />}
        {busy
          ? t("creator.canvas.videoComposer.executing")
          : unresolved
            ? t("creator.canvas.videoComposer.resume")
            : t("creator.canvas.videoComposer.execute")}
      </button>
    </section>
  );
}
