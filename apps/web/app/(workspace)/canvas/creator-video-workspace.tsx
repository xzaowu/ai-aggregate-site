"use client";

import { Video } from "lucide-react";
import React from "react";
import { ResolvedAssetVideo } from "../../../components/workspace/ResolvedAssetVideo";
import { useI18n } from "../../../lib/i18n/use-i18n";
import type { CreatorNodeWorkspaceRenderMode } from "./creator-node-workspace";
import {
  CreatorVideoComposerPanel,
  type CreatorVideoComposerView
} from "./creator-video-composer-panel";
import type { CreatorVideoAssetDisplayState } from "./creator-video-asset-display";

export interface CreatorVideoWorkspaceProps {
  assetId: string | null;
  assetToken: string | null;
  assetDisplay: CreatorVideoAssetDisplayState;
  videoComposer: CreatorVideoComposerView;
  mode?: CreatorNodeWorkspaceRenderMode;
}

function stopCanvasPropagation(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

export function CreatorVideoWorkspace({
  assetId,
  assetToken,
  assetDisplay,
  videoComposer,
  mode = "workspace"
}: CreatorVideoWorkspaceProps) {
  const { t } = useI18n();
  const isBound = assetId !== null;
  const expectedLogicalUrl = isBound ? `/assets/${assetId}/content` : null;
  const hasCurrentPrivatePreview = Boolean(
    isBound &&
    assetDisplay.status === "ready" &&
    assetDisplay.logicalUrl === expectedLogicalUrl
  );
  const previewState = !isBound
    ? "empty"
    : assetDisplay.status === "ready" && !hasCurrentPrivatePreview
      ? "loading"
      : assetDisplay.status;
  const boundFallback = (
    <span data-creator-video-workspace-preview-fallback="true">
      {t("creator.canvas.videoBound")}
    </span>
  );

  return (
    <div
      className="nodrag nopan nowheel flex min-w-0 flex-col gap-4 text-slate-900 dark:text-slate-100"
      data-creator-video-workspace="true"
      data-creator-video-workspace-mode={mode}
      onKeyDown={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <section
        className={`nodrag nopan nowheel min-w-0 ${
          mode === "focus"
            ? "grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.85fr)] lg:items-start"
            : "flex flex-col gap-3"
        }`}
        aria-labelledby="creator-video-workspace-preview-label"
        data-creator-video-workspace-preview-section="true"
      >
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="creator-video-workspace-preview-label"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              {t("creator.canvas.videoWorkspace.preview")}
            </h2>
            <span
              className="text-[10px] text-slate-400 dark:text-slate-500"
              data-creator-video-workspace-binding={isBound ? "bound" : "empty"}
            >
              {isBound ? t("creator.canvas.videoBound") : t("creator.canvas.videoEmpty")}
            </span>
          </div>
          <div
            className={`relative mt-2 flex min-w-0 items-center justify-center overflow-hidden rounded-xl border bg-slate-950 text-center text-xs leading-5 text-slate-400 ${
              mode === "focus"
                ? "aspect-video min-h-64 border-slate-700"
                : "aspect-video border-slate-700"
            } ${isBound ? "border-solid" : "border-dashed border-slate-700"}`}
            data-creator-video-workspace-preview="true"
            data-creator-video-workspace-preview-state={previewState}
            data-creator-video-workspace-preview-renderer={
              hasCurrentPrivatePreview ? "full" : "fallback"
            }
          >
            {hasCurrentPrivatePreview ? (
              <ResolvedAssetVideo
                src={assetDisplay.logicalUrl}
                token={assetToken}
                controls
                playsInline
                preload="metadata"
                className="size-full object-contain"
                fallback={boundFallback}
              />
            ) : isBound ? (
              boundFallback
            ) : (
              <div className="flex flex-col items-center gap-2 px-4">
                <Video className="size-7 text-slate-500" aria-hidden="true" />
                <span>{t("creator.canvas.videoEmpty")}</span>
              </div>
            )}
          </div>
        </div>
        <div className={mode === "focus" ? "min-w-0 lg:pt-0.5" : "min-w-0"}>
          <CreatorVideoComposerPanel
            {...videoComposer}
            presentation="workspace"
          />
        </div>
      </section>
    </div>
  );
}
