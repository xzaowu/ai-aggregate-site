"use client";

import { ArrowRight, GitBranch, WandSparkles } from "lucide-react";
import React from "react";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { PRODUCT_AD_SHORT_VIDEO_RECIPE } from "./creator-canvas-recipes";

export function CreatorCanvasRecipeStarter({
  onApply
}: {
  onApply: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[3] flex items-start justify-center overflow-y-auto px-4 pb-24 pt-5 sm:items-center sm:py-8"
      data-creator-canvas-recipe-starter="true"
    >
      <section className="pointer-events-auto w-full max-w-xl rounded-2xl border border-indigo-200 bg-white/95 p-4 shadow-xl shadow-indigo-950/10 backdrop-blur dark:border-indigo-900 dark:bg-slate-900/95 dark:shadow-black/30 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <WandSparkles className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
              {t(PRODUCT_AD_SHORT_VIDEO_RECIPE.eyebrowKey)}
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {t(PRODUCT_AD_SHORT_VIDEO_RECIPE.titleKey)}
            </h2>
            <p className="mt-1.5 text-xs leading-5 text-slate-600 dark:text-slate-300">
              {t(PRODUCT_AD_SHORT_VIDEO_RECIPE.descriptionKey)}
            </p>
          </div>
        </div>

        <ol
          className="mt-4 grid grid-cols-2 gap-2 border-y border-slate-200 py-3 dark:border-slate-700"
          aria-label={t(PRODUCT_AD_SHORT_VIDEO_RECIPE.flowLabelKey)}
          data-creator-canvas-recipe-flow="true"
        >
          {PRODUCT_AD_SHORT_VIDEO_RECIPE.flowStepKeys.map((key, index) => (
            <li
              key={key}
              className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {index + 1}
              </span>
              <span className="min-w-0 truncate">{t(key)}</span>
              {index < PRODUCT_AD_SHORT_VIDEO_RECIPE.flowStepKeys.length - 1 ? (
                <ArrowRight className="ml-auto size-3 shrink-0 text-slate-400" aria-hidden="true" />
              ) : (
                <GitBranch className="ml-auto size-3 shrink-0 text-slate-400" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            {t(PRODUCT_AD_SHORT_VIDEO_RECIPE.blankStartKey)}
          </p>
          <button
            type="button"
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            onClick={onApply}
            data-creator-canvas-recipe-apply={PRODUCT_AD_SHORT_VIDEO_RECIPE.id}
          >
            {t(PRODUCT_AD_SHORT_VIDEO_RECIPE.useWorkflowKey)}
          </button>
        </div>
      </section>
    </div>
  );
}
