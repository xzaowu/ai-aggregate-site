"use client";

import { FileImage } from "lucide-react";
import React from "react";
import { ResolvedAssetImage } from "../../../components/workspace/ResolvedAssetImage";
import { useI18n } from "../../../lib/i18n/use-i18n";
import type { CreatorNodeWorkspaceRenderMode } from "./creator-node-workspace";
import {
  CreatorImageComposerPanel,
  type CreatorImageComposerView
} from "./creator-image-composer-panel";
import type { CreatorImageAssetDisplayState } from "./creator-image-asset-display";

export interface CreatorImageWorkspaceProps {
  assetId: string | null;
  assetToken: string | null;
  assetDisplay: CreatorImageAssetDisplayState;
  imageComposer: CreatorImageComposerView;
  mode?: CreatorNodeWorkspaceRenderMode;
  onChooseExistingImageAsset: () => void;
  onReplaceExistingImageAsset: () => void;
}

function stopCanvasPropagation(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

export function CreatorImageWorkspace({
  assetId,
  assetToken,
  assetDisplay,
  imageComposer,
  mode = "workspace",
  onChooseExistingImageAsset,
  onReplaceExistingImageAsset
}: CreatorImageWorkspaceProps) {
  const { t } = useI18n();
  const isBound = assetId !== null;
  const replaceBlockedByExecution =
    imageComposer.execution.status !== "idle" &&
    imageComposer.execution.status !== "failed";
  const replaceDisabled = !assetToken || replaceBlockedByExecution;
  const previewState = isBound ? assetDisplay.status : "empty";
  const boundFallback = (
    <span data-creator-image-workspace-preview-fallback="true">
      {t("creator.canvas.imageBound")}
    </span>
  );

  return (
    <div
      className="nodrag nopan nowheel flex min-w-0 flex-col gap-4 text-slate-900 dark:text-slate-100"
      data-creator-image-workspace="true"
      data-creator-image-workspace-mode={mode}
      onKeyDown={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <section
        className={`nodrag nopan nowheel min-w-0 ${
          mode === "focus"
            ? "grid gap-5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:items-start"
            : "flex flex-col gap-3"
        }`}
        aria-labelledby="creator-image-workspace-preview-label"
        data-creator-image-workspace-preview-section="true"
      >
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="creator-image-workspace-preview-label"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              {t("creator.canvas.imageWorkspace.preview")}
            </h2>
            <span
              className="text-[10px] text-slate-400 dark:text-slate-500"
              data-creator-image-workspace-binding={isBound ? "bound" : "empty"}
            >
              {isBound ? t("creator.canvas.imageBound") : t("creator.canvas.imageEmpty")}
            </span>
          </div>
          <div
            className={`relative mt-2 flex min-w-0 items-center justify-center overflow-hidden rounded-xl border bg-slate-50 text-center text-xs leading-5 text-slate-500 dark:bg-slate-800/70 dark:text-slate-400 ${
              mode === "focus"
                ? "aspect-[16/10] min-h-64 border-slate-200 dark:border-slate-700"
                : "aspect-[4/3] border-slate-200 dark:border-slate-700"
            } ${isBound ? "border-solid" : "border-dashed border-slate-300 dark:border-slate-700"}`}
            data-creator-image-workspace-preview="true"
            data-creator-image-workspace-preview-state={previewState}
          >
            {isBound && assetDisplay.status === "ready" ? (
              <ResolvedAssetImage
                src={assetDisplay.logicalUrl}
                token={assetToken}
                alt={t("creator.canvas.imagePreview")}
                className="size-full object-contain"
                draggable={false}
                fallback={boundFallback}
              />
            ) : isBound ? (
              boundFallback
            ) : (
              <div className="flex flex-col items-center gap-2 px-4">
                <FileImage className="size-7 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                <span>{t("creator.canvas.imageEmpty")}</span>
              </div>
            )}
          </div>
          <div className="nodrag nopan nowheel mt-2 flex flex-wrap items-center gap-2">
            {!isBound ? (
              <button
                type="button"
                className="nodrag nopan nowheel inline-flex min-h-9 items-center rounded-lg bg-indigo-600 px-3 text-[11px] font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={t("creator.canvas.assetPicker.choose")}
                disabled={!assetToken}
                title={assetToken ? undefined : t("creator.canvas.assetPicker.loginRequired")}
                data-creator-image-workspace-asset-picker-action="choose"
                onClick={onChooseExistingImageAsset}
              >
                {t("creator.canvas.assetPicker.choose")}
              </button>
            ) : (
              <button
                type="button"
                className="nodrag nopan nowheel inline-flex min-h-9 items-center rounded-lg border border-indigo-200 px-3 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
                aria-label={t("creator.canvas.assetPicker.replace")}
                disabled={replaceDisabled}
                title={!assetToken
                  ? t("creator.canvas.assetPicker.loginRequired")
                  : replaceBlockedByExecution
                    ? t("creator.canvas.assetPicker.replaceUnavailable")
                    : undefined}
                data-creator-image-workspace-asset-picker-action="replace"
                onClick={onReplaceExistingImageAsset}
              >
                {t("creator.canvas.assetPicker.replace")}
              </button>
            )}
            {!assetToken ? (
              <span
                className="text-[10px] text-slate-400 dark:text-slate-500"
                data-creator-image-workspace-login-required="true"
              >
                {t("creator.canvas.assetPicker.loginRequired")}
              </span>
            ) : replaceBlockedByExecution && isBound ? (
              <span
                className="text-[10px] text-slate-400 dark:text-slate-500"
                data-creator-image-workspace-replace-unavailable="true"
              >
                {t("creator.canvas.assetPicker.replaceUnavailable")}
              </span>
            ) : null}
          </div>
        </div>
        <div className={mode === "focus" ? "min-w-0 lg:pt-0.5" : "min-w-0"}>
          <CreatorImageComposerPanel
            {...imageComposer}
            presentation="workspace"
          />
        </div>
      </section>
    </div>
  );
}
