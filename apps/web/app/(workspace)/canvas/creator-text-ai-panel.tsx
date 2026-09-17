"use client";

import type { AiModelSummary } from "@ai-aggregate/shared";
import { getModelDisplayName } from "@ai-aggregate/shared";
import { LoaderCircle, Sparkles, Type } from "lucide-react";
import React from "react";
import { useI18n } from "../../../lib/i18n/use-i18n";

export type CreatorTextAiExecutionStatus = "idle" | "executing" | "failed";

export interface CreatorTextAiComposerView {
  presentation?: "card" | "workspace";
  instruction: string;
  modelId: string;
  models: readonly AiModelSummary[];
  modelsLoading: boolean;
  incomingTextCount: number;
  authenticated: boolean;
  execution: {
    status: CreatorTextAiExecutionStatus;
    errorMessage: string | null;
    onExecute: () => void;
  };
  onInstructionChange: (instruction: string) => void;
  onModelChange: (modelId: string) => void;
}

export function CreatorTextAiComposerPanel({
  presentation = "card",
  instruction,
  modelId,
  models,
  modelsLoading,
  incomingTextCount,
  authenticated,
  execution,
  onInstructionChange,
  onModelChange
}: CreatorTextAiComposerView) {
  const { t } = useI18n();
  const selectedModel = models.find((model) => model.modelId === modelId) ?? null;
  const isBusy = execution.status === "executing";
  const executeDisabled =
    isBusy ||
    modelsLoading ||
    !authenticated ||
    instruction.trim().length === 0 ||
    !selectedModel;

  return (
    <section
      className={presentation === "workspace"
        ? "nodrag nopan nowheel w-full min-w-0 text-slate-900 dark:text-slate-100"
        : "nodrag nopan nowheel w-[22.5rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white/95 p-3.5 text-slate-900 shadow-2xl shadow-slate-950/20 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"}
      aria-label={t("creator.canvas.textAi.title")}
      data-creator-text-ai-composer="true"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Sparkles className="size-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <h2>{t("creator.canvas.textAi.title")}</h2>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
            {t("creator.canvas.textAi.description")}
          </p>
        </div>
        <Type className="mt-0.5 size-4 text-slate-400" aria-hidden="true" />
      </div>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {t("creator.canvas.textAi.instruction")}
        <textarea
          className="nodrag nowheel mt-1.5 min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs leading-5 text-slate-900 outline-none placeholder:text-slate-400 focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-indigo-900"
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value)}
          placeholder={t("creator.canvas.textAi.instructionPlaceholder")}
          aria-label={t("creator.canvas.textAi.instruction")}
          data-creator-text-ai-instruction="true"
          disabled={isBusy}
        />
      </label>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {t("creator.canvas.textAi.model")}
        <select
          className="nodrag nopan nowheel mt-1.5 min-h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-indigo-900"
          value={modelId}
          onChange={(event) => onModelChange(event.target.value)}
          aria-label={t("creator.canvas.textAi.model")}
          data-creator-text-ai-model="true"
          disabled={isBusy || modelsLoading || models.length === 0}
        >
          {models.length === 0 ? (
            <option value="">{modelsLoading
              ? t("creator.canvas.textAi.modelsLoading")
              : t("creator.canvas.textAi.noModels")}</option>
          ) : null}
          {models.map((model) => (
            <option key={model.modelId} value={model.modelId}>
              {getModelDisplayName(model)}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span>
          {incomingTextCount > 0
            ? t("creator.canvas.textAi.contextCount", { count: incomingTextCount })
            : t("creator.canvas.textAi.noContext")}
        </span>
        <span data-creator-text-ai-cost="true">
          {selectedModel
            ? t("creator.canvas.textAi.cost", { count: selectedModel.creditCost })
            : t("creator.canvas.textAi.costUnavailable")}
        </span>
      </div>

      {!authenticated ? (
        <p className="mt-2 text-[10px] font-medium text-amber-700 dark:text-amber-300" role="status">
          {t("creator.canvas.textAi.loginRequired")}
        </p>
      ) : null}
      {execution.errorMessage ? (
        <p
          className="mt-2 text-[10px] font-medium text-red-700 dark:text-red-300"
          role="alert"
          data-creator-text-ai-error="true"
        >
          {execution.errorMessage}
        </p>
      ) : null}

      <button
        type="button"
        className="nodrag nopan nowheel mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={execution.onExecute}
        disabled={executeDisabled}
        data-creator-text-ai-execute="true"
      >
        {isBusy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
        {isBusy ? t("creator.canvas.textAi.executing") : t("creator.canvas.textAi.execute")}
      </button>
    </section>
  );
}
