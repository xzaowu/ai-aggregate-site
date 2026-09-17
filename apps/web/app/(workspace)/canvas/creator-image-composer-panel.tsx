"use client";

import type { AiGenerationCount, AiModelSummary } from "@ai-aggregate/shared";
import { getModelDisplayName } from "@ai-aggregate/shared";
import { ImageIcon, Type } from "lucide-react";
import React from "react";
import { useI18n } from "../../../lib/i18n/use-i18n";
import type { ImageAspectRatio } from "../../../lib/image-generation-aspect";
import type { CreatorNodeComposerContext } from "./creator-node-composer-context";
import {
  CREATOR_IMAGE_COMPOSER_MAX_PROMPT_LENGTH,
  creatorImageAspectRatios,
  creatorImageGenerationCounts,
  getCreatorImageComposerImageReferences,
  getCreatorImageComposerTextReferences,
  getCreatorImageEstimatedCost,
  getCreatorImageReferenceCandidates,
  getCreatorTextSourcePreview,
  isCreatorImagePromptTooLong,
  type CreatorImageComposerDraft,
  type CreatorImageComposerOperation
} from "./creator-image-composer";
import type { CreatorImageExecutionStatus } from "./creator-image-execution-state";

export interface CreatorImageComposerView {
  context: CreatorNodeComposerContext;
  draft: CreatorImageComposerDraft;
  models: readonly AiModelSummary[];
  modelsLoading: boolean;
  onPromptChange: (prompt: string) => void;
  onPromptReset: () => void;
  onTextSourceSelect: (nodeId: string) => void;
  onOperationChange: (operation: CreatorImageComposerOperation) => void;
  onImageReferenceSelect: (nodeId: string) => void;
  onModelChange: (modelId: string) => void;
  onAspectRatioChange: (aspectRatio: ImageAspectRatio) => void;
  onCountChange: (count: AiGenerationCount) => void;
  presentation?: "card" | "workspace";
  execution: CreatorImageComposerExecutionView;
}

export type CreatorImageComposerExecutionStatus = CreatorImageExecutionStatus;

export interface CreatorImageComposerExecutionView {
  status: CreatorImageComposerExecutionStatus;
  authenticated: boolean;
  errorMessage: string | null;
  onExecute: () => void;
  onResume: () => void;
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
      data-creator-image-source-chip={testId}
      data-selected={selected ? "true" : "false"}
    >
      {children}
    </button>
  );
}

export function CreatorImageComposerPanel({
  context,
  draft,
  models,
  modelsLoading,
  onPromptChange,
  onPromptReset,
  onTextSourceSelect,
  onOperationChange,
  onImageReferenceSelect,
  onModelChange,
  onAspectRatioChange,
  onCountChange,
  execution,
  presentation = "card"
}: CreatorImageComposerView) {
  const { t } = useI18n();
  const textReferences = getCreatorImageComposerTextReferences(context);
  const imageReferences = getCreatorImageComposerImageReferences(context);
  const imageCandidates = getCreatorImageReferenceCandidates(context);
  const selectedModel =
    models.find((model) => model.slug === draft.modelId) ?? null;
  const estimatedCost = getCreatorImageEstimatedCost(selectedModel, draft.count);
  const promptTooLong = isCreatorImagePromptTooLong(draft.prompt);
  const selectedImageReferenceIsUsable = imageCandidates.some(
    (candidate) => candidate.nodeId === draft.selectedImageReferenceNodeId
  );
  const isBusy =
    execution.status === "preparing" ||
    execution.status === "submitting" ||
    execution.status === "checking";
  const isUnresolved = execution.status === "unresolved";
  const controlsLocked = isBusy || isUnresolved;
  const executionInvalid =
    !execution.authenticated ||
    !draft.prompt.trim() ||
    promptTooLong ||
    !selectedModel ||
    (draft.operation === "edit" && !selectedImageReferenceIsUsable);
  const actionDisabled = isBusy || (!isUnresolved && executionInvalid) ||
    (isUnresolved && !execution.authenticated);
  const statusMessage = execution.status === "checking"
    ? t("creator.canvas.composer.status.checking")
    : execution.status === "unresolved"
      ? t("creator.canvas.composer.status.unresolved")
      : execution.status === "preparing" || execution.status === "submitting"
        ? t("multimodal.image.generatingMessage")
        : execution.status === "failed"
          ? execution.errorMessage
          : null;
  const isWorkspacePresentation = presentation === "workspace";

  return (
    <section
      className={isWorkspacePresentation
        ? "nodrag nopan nowheel w-full min-w-0 text-slate-900 dark:text-slate-100"
        : "nodrag nopan nowheel w-[22.5rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white/95 p-3.5 text-slate-900 shadow-2xl shadow-slate-950/20 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"}
      aria-label={t("creator.canvas.composer.title")}
      data-creator-image-composer="true"
      data-creator-image-composer-presentation={presentation}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold">
            {t("creator.canvas.composer.title")}
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
            {t("creator.canvas.composer.transient")}
          </p>
        </div>
        <div
          className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
          aria-label={t("creator.canvas.composer.operation")}
        >
          {(["generate", "edit"] as const).map((operation) => (
            <button
              key={operation}
              type="button"
              className={`nodrag nopan rounded-md px-2.5 py-1.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                draft.operation === operation
                  ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-indigo-200"
                  : "text-slate-500 dark:text-slate-400"
              }`}
              disabled={controlsLocked}
              onClick={() => onOperationChange(operation)}
              aria-pressed={draft.operation === operation}
              data-creator-image-operation={operation}
            >
              {t(`creator.canvas.composer.operation.${operation}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-3 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        {t("creator.canvas.composer.prompt")}
        <textarea
          className={`nodrag nopan nowheel mt-1.5 min-h-24 w-full resize-none rounded-xl border bg-slate-50 px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 dark:bg-slate-950 ${
            promptTooLong
              ? "border-red-400 focus-visible:ring-red-200 dark:border-red-500 dark:focus-visible:ring-red-950"
              : "border-slate-200 focus-visible:border-indigo-400 focus-visible:ring-indigo-200 dark:border-slate-700 dark:focus-visible:ring-indigo-900"
          }`}
          value={draft.prompt}
          disabled={controlsLocked}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={t("creator.canvas.composer.promptPlaceholder")}
          aria-invalid={promptTooLong}
          aria-describedby="creator-image-composer-prompt-count"
          data-creator-image-prompt="true"
        />
      </label>
      <div className="mt-1 flex items-center justify-between gap-3 text-[10px]">
        <button
          type="button"
          className="nodrag nopan font-medium text-slate-500 underline-offset-2 hover:text-indigo-700 hover:underline dark:text-slate-400 dark:hover:text-indigo-300"
          disabled={controlsLocked}
          onClick={onPromptReset}
          data-creator-image-prompt-reset="true"
        >
          {t("creator.canvas.composer.promptReset")}
        </button>
        <span
          id="creator-image-composer-prompt-count"
          className={promptTooLong ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-400"}
          data-creator-image-prompt-validation={promptTooLong ? "too-long" : "valid"}
        >
          {draft.prompt.length}/{CREATOR_IMAGE_COMPOSER_MAX_PROMPT_LENGTH}
        </span>
      </div>

      {textReferences.length > 0 ? (
        <div className="mt-3" data-creator-image-text-references="true">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Type className="size-3" aria-hidden="true" />
            {t("creator.canvas.composer.textReferences")}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {textReferences.map((reference) => {
              const text = reference.sourceNode.kind === "text"
                ? reference.sourceNode.data.text
                : "";
              const preview = getCreatorTextSourcePreview(text);
              return (
                <SourceChip
                  key={reference.edgeId}
                  testId="text"
                  disabled={
                    controlsLocked || draft.promptDirty || preview.length === 0
                  }
                  selected={
                    draft.promptSeedSourceNodeId === reference.sourceNode.id
                  }
                  onClick={() => onTextSourceSelect(reference.sourceNode.id)}
                >
                  {preview || t("creator.canvas.composer.emptyText")}
                </SourceChip>
              );
            })}
          </div>
          {draft.promptDirty ? (
            <p className="mt-1 text-[10px] text-slate-400">
              {t("creator.canvas.composer.promptAuthoritative")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3" data-creator-image-image-references="true">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <ImageIcon className="size-3" aria-hidden="true" />
          {t("creator.canvas.composer.imageReferences")}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {context.node.kind === "image" ? (
            <SourceChip
              testId="current-image"
              disabled={
                controlsLocked ||
                draft.operation !== "edit" ||
                context.mediaBinding !== "bound"
              }
              selected={draft.selectedImageReferenceNodeId === context.node.id}
              onClick={() => onImageReferenceSelect(context.node.id)}
            >
              {context.mediaBinding === "bound"
                ? t("creator.canvas.composer.currentImageBound")
                : t("creator.canvas.composer.currentImageEmpty")}
            </SourceChip>
          ) : null}
          {imageReferences.map((reference, index) => (
            <SourceChip
              key={reference.edgeId}
              testId="incoming-image"
              disabled={
                controlsLocked ||
                draft.operation !== "edit" ||
                reference.mediaBinding !== "bound"
              }
              selected={
                draft.selectedImageReferenceNodeId === reference.sourceNode.id
              }
              onClick={() => onImageReferenceSelect(reference.sourceNode.id)}
            >
              {t("creator.canvas.composer.incomingImage", { index: index + 1 })}
              {" · "}
              {t(
                reference.mediaBinding === "bound"
                  ? "creator.canvas.composer.bound"
                  : "creator.canvas.composer.empty"
              )}
            </SourceChip>
          ))}
        </div>
        <p
          className={`mt-1.5 text-[10px] ${
            draft.operation === "edit" && !selectedImageReferenceIsUsable
              ? "font-medium text-amber-700 dark:text-amber-300"
              : "text-slate-400"
          }`}
          data-creator-image-edit-validation={
            draft.operation === "generate"
              ? "not-required"
              : selectedImageReferenceIsUsable
                ? "valid"
                : imageCandidates.length === 0
                  ? "missing"
                  : "choose-one"
          }
        >
          {draft.operation === "generate"
            ? t("creator.canvas.composer.generateReferenceHint")
            : selectedImageReferenceIsUsable
              ? t("creator.canvas.composer.editReferenceReady")
              : imageCandidates.length === 0
                ? t("creator.canvas.composer.editReferenceRequired")
                : t("creator.canvas.composer.editReferenceChoose")}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-2">
        <label className="min-w-0 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          {t("creator.canvas.composer.model")}
          <select
            className="nodrag nopan nowheel mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus-visible:ring-indigo-900"
            value={draft.modelId}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={controlsLocked || models.length === 0}
            data-creator-image-model="true"
          >
            {models.length === 0 ? (
              <option value="">
                {t(
                  modelsLoading
                    ? "creator.canvas.composer.modelsLoading"
                    : "creator.canvas.composer.modelsEmpty"
                )}
              </option>
            ) : null}
            {models.map((model) => (
              <option key={model.slug} value={model.slug}>
                {getModelDisplayName(model)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          {t("creator.canvas.composer.aspect")}
          <select
            className="nodrag nopan nowheel mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus-visible:ring-indigo-900"
            value={draft.aspectRatio}
            disabled={controlsLocked}
            onChange={(event) =>
              onAspectRatioChange(event.target.value as ImageAspectRatio)
            }
            data-creator-image-aspect="true"
          >
            {creatorImageAspectRatios.map((ratio) => (
              <option key={ratio} value={ratio}>{ratio}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          {t("creator.canvas.composer.count")}
          <select
            className="nodrag nopan nowheel mt-1 h-9 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus-visible:ring-indigo-900"
            value={draft.count}
            disabled={controlsLocked}
            onChange={(event) =>
              onCountChange(Number(event.target.value) as AiGenerationCount)
            }
            data-creator-image-count="true"
          >
            {creatorImageGenerationCounts.map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </label>
      </div>

      {estimatedCost !== null ? (
        <p
          className="mt-2 text-right text-[10px] text-slate-500 dark:text-slate-400"
          data-creator-image-estimated-cost={estimatedCost}
        >
          {t("creator.canvas.composer.estimatedCost", { cost: estimatedCost })}
        </p>
      ) : null}

      {statusMessage ? (
        <p
          className={`mt-2 text-[11px] leading-4 ${
            execution.status === "failed"
              ? "text-red-600 dark:text-red-300"
              : execution.status === "unresolved"
                ? "text-amber-700 dark:text-amber-300"
                : "text-slate-500 dark:text-slate-400"
          }`}
          role={execution.status === "failed" ? "alert" : "status"}
          data-creator-image-execution-status={execution.status}
        >
          {statusMessage}
        </p>
      ) : null}

      <button
        type="button"
        className="nodrag nopan mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        disabled={actionDisabled}
        onClick={isUnresolved ? execution.onResume : execution.onExecute}
        data-creator-image-execute={isUnresolved ? undefined : draft.operation}
        data-creator-image-resume={isUnresolved ? "true" : undefined}
      >
        {isBusy
          ? t("multimodal.image.generatingMessage")
          : isUnresolved
            ? t("multimodal.image.resumeRequest")
            : draft.operation === "generate"
              ? t("multimodal.image.generate")
              : t("creator.canvas.composer.operation.edit")}
      </button>
    </section>
  );
}
