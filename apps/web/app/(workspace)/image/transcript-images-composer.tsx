"use client";

import React from "react";
import type { AiModelSummary } from "@ai-aggregate/shared";
import { getModelDisplayName } from "@ai-aggregate/shared";
import { ChevronDown } from "lucide-react";
import { ResolvedAssetImage } from "../../../components/workspace/ResolvedAssetImage";
import { Button } from "../../../components/workspace/ui";
import {
  TRANSCRIPT_MAX_CODE_POINTS,
  TRANSCRIPT_MAX_SELECTED_SCENES,
  countTranscriptCodePoints,
  type TranscriptSceneStatus,
  type TranscriptSceneView
} from "./transcript-segmentation";

const parameterControlClassName =
  "relative flex min-h-11 min-w-0 items-center rounded-xl border border-slate-200 bg-white transition hover:border-slate-400 focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-indigo-600 focus-within:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 dark:focus-within:ring-offset-slate-950";
const parameterSelectClassName =
  "min-h-11 min-w-0 w-full flex-1 appearance-none bg-transparent px-3 pr-9 text-sm font-semibold text-slate-800 outline-none transition dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60";
const parameterChevronClassName =
  "pointer-events-none absolute right-3 size-4 shrink-0 text-slate-500 dark:text-slate-400";

export type TranscriptImagesComposerLabels = {
  title: string;
  description: string;
  transcriptLabel: string;
  transcriptPlaceholder: string;
  transcriptLength: (current: number, max: number) => string;
  plan: string;
  planning: string;
  planHint: string;
  sceneLabel: (index: number) => string;
  sourceLabel: string;
  promptLabel: string;
  promptPlaceholder: string;
  selectedCount: (selected: number, max: number) => string;
  generateSelected: string;
  generatingSelected: string;
  selectionHint: string;
  imageAlt: string;
  status: (status: TranscriptSceneStatus) => string;
};

export function TranscriptImagesComposer({
  transcript,
  onTranscriptChange,
  scenes,
  selectedCount,
  onPlan,
  onToggleScene,
  onPromptChange,
  onGenerateSelected,
  isGenerating,
  error,
  token,
  models,
  selectedModelId,
  onSelectModel,
  modelLabel,
  noModelsLabel,
  labels
}: {
  transcript: string;
  onTranscriptChange: (value: string) => void;
  scenes: TranscriptSceneView[];
  selectedCount: number;
  onPlan: () => void;
  onToggleScene: (sceneId: string) => void;
  onPromptChange: (sceneId: string, value: string) => void;
  onGenerateSelected: () => void;
  isGenerating: boolean;
  error: string | null;
  token: string | null;
  models: AiModelSummary[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  modelLabel: string;
  noModelsLabel: string;
  labels: TranscriptImagesComposerLabels;
}) {
  return (
    <section
      className="grid min-w-0 gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 lg:order-1 lg:gap-5 lg:border-r lg:border-t-0 lg:pr-7 lg:pt-0"
      data-image-workbench-editor="true"
      data-image-creator-input="true"
      data-transcript-images-composer="true"
    >
      <div className="grid min-w-0 gap-1">
        <h2 className="text-base font-semibold text-slate-950 dark:text-slate-100">
          {labels.title}
        </h2>
        <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
          {labels.description}
        </p>
      </div>

      <label className="grid min-w-0 gap-2">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {labels.transcriptLabel}
        </span>
        <textarea
          className="min-h-40 w-full min-w-0 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[15px] leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          value={transcript}
          onChange={(event) => onTranscriptChange(event.target.value)}
          placeholder={labels.transcriptPlaceholder}
          disabled={isGenerating}
          rows={7}
          data-transcript-input="true"
        />
        <span className="text-xs text-slate-500 dark:text-slate-400" data-transcript-length="true">
          {labels.transcriptLength(
            countTranscriptCodePoints(transcript),
            TRANSCRIPT_MAX_CODE_POINTS
          )}
        </span>
      </label>

      <label className="grid min-w-0 gap-1.5" data-transcript-model-control="true">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {modelLabel}
        </span>
        <span className={`${parameterControlClassName} ${models.length === 0 ? "opacity-60" : ""}`}>
          <select
            className={parameterSelectClassName}
            value={selectedModelId}
            onChange={(event) => onSelectModel(event.target.value)}
            aria-label={modelLabel}
            title={models.length === 0 ? noModelsLabel : modelLabel}
            disabled={isGenerating || models.length === 0}
            data-transcript-model="true"
          >
            {models.length === 0 ? (
              <option value="">{noModelsLabel}</option>
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

      <div className="grid min-w-0 gap-2">
        <Button
          type="button"
          className="min-h-11 w-full rounded-lg"
          onClick={onPlan}
          disabled={isGenerating}
          data-transcript-plan="true"
        >
          {isGenerating ? labels.planning : labels.plan}
        </Button>
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400" data-transcript-plan-hint="true">
          {labels.planHint}
        </p>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          role="alert"
          data-transcript-error="true"
        >
          {error}
        </p>
      ) : null}

      {scenes.length > 0 ? (
        <section className="grid min-w-0 gap-3" data-transcript-scenes="true">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100" data-transcript-selected-count="true">
              {labels.selectedCount(selectedCount, TRANSCRIPT_MAX_SELECTED_SCENES)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {labels.selectionHint}
            </span>
          </div>

          <div className="grid min-w-0 gap-3">
            {scenes.map((scene, index) => {
              const selectionDisabled =
                isGenerating ||
                (!scene.selected && selectedCount >= TRANSCRIPT_MAX_SELECTED_SCENES);

              return (
                <article
                  key={scene.id}
                  className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                  data-transcript-scene-card="true"
                  data-transcript-scene-id={scene.id}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <label className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <input
                        type="checkbox"
                        checked={scene.selected}
                        onChange={() => onToggleScene(scene.id)}
                        disabled={selectionDisabled}
                        className="size-4 shrink-0 accent-indigo-600"
                        data-transcript-scene-select="true"
                      />
                      <span className="truncate">{labels.sceneLabel(index + 1)}</span>
                    </label>
                    <span
                      className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      data-transcript-scene-status={scene.status}
                    >
                      {labels.status(scene.status)}
                    </span>
                  </div>

                  <div className="grid min-w-0 gap-1.5">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {labels.sourceLabel}
                    </span>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200" data-transcript-scene-source="true">
                      {scene.sourceText}
                    </p>
                  </div>

                  <label className="grid min-w-0 gap-1.5">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {labels.promptLabel}
                    </span>
                    <textarea
                      className="min-h-24 w-full min-w-0 resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                      value={scene.prompt}
                      onChange={(event) => onPromptChange(scene.id, event.target.value)}
                      placeholder={labels.promptPlaceholder}
                      maxLength={4000}
                      rows={4}
                      disabled={isGenerating}
                      data-transcript-scene-prompt="true"
                    />
                  </label>

                  {scene.resultUrl ? (
                    <div className="grid min-w-0 gap-2" data-transcript-scene-result="true">
                      <ResolvedAssetImage
                        src={scene.resultUrl}
                        token={token}
                        alt={labels.imageAlt}
                        className="max-h-64 w-full rounded-lg object-contain"
                      />
                    </div>
                  ) : null}

                  {scene.error ? (
                    <p className="text-xs leading-5 text-red-700 dark:text-red-300" data-transcript-scene-error="true">
                      {scene.error}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div className="grid min-w-0 gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <Button
              type="button"
              className="min-h-12 w-full rounded-lg"
              onClick={onGenerateSelected}
              disabled={isGenerating || selectedCount === 0 || models.length === 0}
              aria-busy={isGenerating}
              data-transcript-generate-selected="true"
            >
              {isGenerating ? labels.generatingSelected : labels.generateSelected}
            </Button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
