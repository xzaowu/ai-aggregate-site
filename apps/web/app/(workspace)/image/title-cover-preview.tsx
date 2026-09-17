"use client";

import React, { useEffect, useRef, useState } from "react";
import { fetchImageAssetBlob, isAbortError } from "../../../lib/private-asset-content";
import { ResolvedAssetImage } from "../../../components/workspace/ResolvedAssetImage";
import {
  buildTitleCoverDownloadFilename,
  calculateTitleCoverCoverCrop,
  calculateTitleCoverLayout,
  fitTitleCoverText,
  getTitleCoverFontSizeBounds,
  titleCoverFontFamily,
  defaultTitleCoverTypographyDraft,
  parseTitleCoverCanvasDimensions,
  type TitleCoverTypographyDraft,
  type TitleCoverTextFit,
  type TitleCoverTextBox
} from "./title-cover-composition";

type TitleCoverCompositionStatus =
  | "idle"
  | "loading"
  | "rendering"
  | "ready"
  | "overflow"
  | "load-failed"
  | "render-failed"
  | "exporting"
  | "export-failed";

export type TitleCoverPreviewLabels = {
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

function imageNaturalSize(image: HTMLImageElement) {
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height
  };
}

function createTitleCoverSourceKey(
  sourceIdentity: string | null,
  sourceUrl: string | null
) {
  return `${sourceIdentity ?? ""}\u0000${sourceUrl ?? ""}`;
}

export function createTitleCoverCompositionKey(
  sourceKey: string,
  mainCopy: string,
  secondaryCopy: string,
  typography: TitleCoverTypographyDraft = defaultTitleCoverTypographyDraft,
  targetSize = "1280x720"
) {
  return JSON.stringify([
    sourceKey,
    mainCopy,
    secondaryCopy,
    targetSize,
    typography.preset,
    typography.mainColor,
    typography.secondaryColor,
    typography.mainWeight,
    typography.secondaryWeight,
    typography.scrimStrength,
    typography.mainShadowStrength,
    typography.secondaryShadowStrength
  ]);
}

function clampUnit(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function resolveHexColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
}

function hexToRgba(value: string, alpha: number, fallback: string) {
  const color = resolveHexColor(value, fallback).slice(1);
  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clampUnit(alpha, 1)})`;
}

function drawText(
  context: CanvasRenderingContext2D,
  fit: TitleCoverTextFit,
  textBox: TitleCoverTextBox,
  fontWeight: number,
  color: string,
  shadowStrength: number
) {
  const boundedShadowStrength = clampUnit(shadowStrength, 0);
  context.save();
  context.font = `${fontWeight} ${fit.fontSize}px ${titleCoverFontFamily}`;
  context.fillStyle = color;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.shadowColor = `rgba(0, 0, 0, ${boundedShadowStrength})`;
  context.shadowBlur = boundedShadowStrength > 0 ? 2 + boundedShadowStrength * 19 : 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = boundedShadowStrength > 0 ? 2 : 0;

  let lineIndex = 0;
  for (const paragraph of fit.paragraphs) {
    for (const line of paragraph) {
      context.fillText(
        line,
        textBox.x,
        textBox.y + lineIndex * fit.lineHeightPx
      );
      lineIndex += 1;
    }
  }

  context.restore();
}

function drawReadabilityTreatment(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  direction: "horizontal" | "vertical",
  scrimWidth: number,
  scrimStrength: number
) {
  const gradient =
    direction === "horizontal"
      ? context.createLinearGradient(0, 0, scrimWidth, 0)
      : context.createLinearGradient(0, 0, 0, scrimWidth);
  const boundedScrimStrength = clampUnit(scrimStrength, 0.62);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${boundedScrimStrength})`);
  gradient.addColorStop(
    0.68,
    `rgba(0, 0, 0, ${Math.min(0.6, boundedScrimStrength * 0.32)})`
  );
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.save();
  context.fillStyle = gradient;
  context.fillRect(0, 0, direction === "horizontal" ? scrimWidth : width, direction === "horizontal" ? height : scrimWidth);
  context.restore();
}

function renderTitleCoverCanvas({
  canvas,
  image,
  mainCopy,
  secondaryCopy,
  typography,
  targetSize
}: {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  mainCopy: string;
  secondaryCopy: string;
  typography: TitleCoverTypographyDraft;
  targetSize: string;
}) {
  const source = imageNaturalSize(image);
  if (source.width <= 0 || source.height <= 0) {
    throw new Error("INVALID_SOURCE_DIMENSIONS");
  }
  const target = parseTitleCoverCanvasDimensions(targetSize);
  if (!target) {
    throw new Error("INVALID_TARGET_DIMENSIONS");
  }
  const crop = calculateTitleCoverCoverCrop({
    sourceWidth: source.width,
    sourceHeight: source.height,
    targetWidth: target.width,
    targetHeight: target.height
  });

  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("CANVAS_CONTEXT_UNAVAILABLE");
  }

  const { width, height } = target;
  const layout = calculateTitleCoverLayout(width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(
    image,
    0,
    0,
    source.width,
    source.height,
    crop.x,
    crop.y,
    crop.width,
    crop.height
  );
  drawReadabilityTreatment(
    context,
    width,
    height,
    layout.scrimDirection,
    layout.scrimWidth,
    typography.scrimStrength
  );

  const fontBounds = getTitleCoverFontSizeBounds(layout, width, height);
  const mainFit = fitTitleCoverText({
    context,
    text: mainCopy,
    canvasWidth: width,
    canvasHeight: height,
    textBox: layout.mainTextBox,
    fontFamily: titleCoverFontFamily,
    fontWeight: typography.mainWeight,
    maxFontSize: fontBounds.main.maxFontSize,
    minFontSize: fontBounds.main.minFontSize,
    lineHeight: 1.14,
    maxLines: layout.mainMaxLines
  });
  const secondaryFit = secondaryCopy.trim()
    ? fitTitleCoverText({
        context,
        text: secondaryCopy,
        canvasWidth: width,
        canvasHeight: height,
        textBox: layout.secondaryTextBox,
        fontFamily: titleCoverFontFamily,
        fontWeight: typography.secondaryWeight,
        maxFontSize: fontBounds.secondary.maxFontSize,
        minFontSize: fontBounds.secondary.minFontSize,
        lineHeight: 1.2,
        maxLines: layout.secondaryMaxLines
      })
    : null;

  if (mainFit.overflow || secondaryFit?.overflow) {
    return { overflow: true, width, height };
  }

  drawText(
    context,
    mainFit,
    layout.mainTextBox,
    typography.mainWeight,
    resolveHexColor(typography.mainColor, "#ffffff"),
    typography.mainShadowStrength
  );
  if (secondaryFit) {
    drawText(
      context,
      secondaryFit,
      layout.secondaryTextBox,
      typography.secondaryWeight,
      hexToRgba(typography.secondaryColor, 0.86, "#ffffff"),
      typography.secondaryShadowStrength
    );
  }

  return { overflow: false, width, height };
}

export function TitleCoverPreview({
  sourceUrl,
  sourceIdentity,
  token,
  mainCopy,
  secondaryCopy,
  originalTitle,
  typography = defaultTitleCoverTypographyDraft,
  targetSize,
  labels
}: {
  sourceUrl: string | null;
  sourceIdentity: string | null;
  token: string | null;
  mainCopy: string;
  secondaryCopy: string;
  originalTitle: string;
  typography?: TitleCoverTypographyDraft;
  targetSize: string;
  labels: TitleCoverPreviewLabels;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const sourceRequestSequenceRef = useRef(0);
  const renderSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const currentSourceKeyRef = useRef("");
  const currentCompositionKeyRef = useRef("");
  const observedCompositionKeyRef = useRef<string | null>(null);
  const renderedCompositionKeyRef = useRef<string | null>(null);
  const isExportingRef = useRef(false);
  const exportSequenceRef = useRef(0);
  const [sourceStatus, setSourceStatus] = useState<"idle" | "loading" | "ready" | "load-failed">("idle");
  const [compositionStatus, setCompositionStatus] =
    useState<TitleCoverCompositionStatus>("idle");
  const [, setRenderRevision] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sourceKey = createTitleCoverSourceKey(sourceIdentity, sourceUrl);
  const compositionKey = createTitleCoverCompositionKey(
    sourceKey,
    mainCopy,
    secondaryCopy,
    typography,
    targetSize
  );
  const needsCompositionSource = mainCopy.trim().length > 0;

  currentSourceKeyRef.current = sourceKey;
  currentCompositionKeyRef.current = compositionKey;
  if (observedCompositionKeyRef.current !== compositionKey) {
    observedCompositionKeyRef.current = compositionKey;
    renderedCompositionKeyRef.current = null;
    exportSequenceRef.current += 1;
    isExportingRef.current = false;
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      exportSequenceRef.current += 1;
      isExportingRef.current = false;
    };
  }, []);

  useEffect(() => {
    const requestSequence = ++sourceRequestSequenceRef.current;
    const capturedSourceKey = sourceKey;
    const abortController = new AbortController();
    let active = true;
    let sourceObjectUrl: string | null = null;

    sourceImageRef.current = null;
    setErrorMessage(null);
    setCompositionStatus("idle");

    if (!sourceUrl || !needsCompositionSource) {
      setSourceStatus("idle");
      return () => {
        active = false;
        abortController.abort();
      };
    }

    setSourceStatus("loading");

    const isCurrentSource = () =>
      mountedRef.current &&
      active &&
      requestSequence === sourceRequestSequenceRef.current &&
      currentSourceKeyRef.current === capturedSourceKey;

    const revokeSourceObjectUrl = () => {
      if (sourceObjectUrl !== null) {
        URL.revokeObjectURL(sourceObjectUrl);
        sourceObjectUrl = null;
      }
    };

    void fetchImageAssetBlob({
      logicalUrl: sourceUrl,
      token,
      signal: abortController.signal
    })
      .then((blob) => {
        if (!isCurrentSource()) return;

        sourceObjectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          if (!isCurrentSource()) return;
          const { width, height } = imageNaturalSize(image);
          if (width <= 0 || height <= 0) {
            setSourceStatus("load-failed");
            setErrorMessage(labels.loadFailed);
            revokeSourceObjectUrl();
            return;
          }
          sourceImageRef.current = image;
          setSourceStatus("ready");
          revokeSourceObjectUrl();
        };
        image.onerror = () => {
          if (!isCurrentSource()) return;
          setSourceStatus("load-failed");
          setErrorMessage(labels.loadFailed);
          revokeSourceObjectUrl();
        };
        image.src = sourceObjectUrl;
      })
      .catch((error: unknown) => {
        if (!isCurrentSource() || isAbortError(error)) return;
        setSourceStatus("load-failed");
        setErrorMessage(labels.loadFailed);
      });

    return () => {
      active = false;
      abortController.abort();
      revokeSourceObjectUrl();
      sourceImageRef.current = null;
    };
  }, [labels.loadFailed, needsCompositionSource, sourceKey, sourceUrl, token]);

  useEffect(() => {
    const renderSequence = ++renderSequenceRef.current;
    const capturedSourceKey = sourceKey;
    const capturedCompositionKey = compositionKey;
    const image = sourceImageRef.current;
    const canvas = canvasRef.current;

    const isCurrentRender = () =>
      mountedRef.current &&
      renderSequence === renderSequenceRef.current &&
      currentSourceKeyRef.current === capturedSourceKey &&
      currentCompositionKeyRef.current === capturedCompositionKey;

    if (sourceStatus !== "ready" || !image || !canvas || !needsCompositionSource) {
      if (!needsCompositionSource && sourceStatus === "ready") {
        setCompositionStatus("idle");
      }
      return;
    }

    setCompositionStatus("rendering");
    setErrorMessage(null);

    void (async () => {
      try {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }
        if (!isCurrentRender() || sourceImageRef.current !== image) return;

        const result = renderTitleCoverCanvas({
          canvas,
          image,
          mainCopy,
          secondaryCopy,
          typography,
          targetSize
        });
        if (!isCurrentRender() || sourceImageRef.current !== image) return;
        if (result.overflow) {
          renderedCompositionKeyRef.current = null;
          setCompositionStatus("overflow");
          return;
        }
        renderedCompositionKeyRef.current = capturedCompositionKey;
        setRenderRevision((current) => current + 1);
        setCompositionStatus("ready");
      } catch {
        if (!isCurrentRender()) return;
        renderedCompositionKeyRef.current = null;
        setCompositionStatus("render-failed");
        setErrorMessage(labels.renderFailed);
      }
    })();
  }, [
    compositionKey,
    labels.renderFailed,
    mainCopy,
    needsCompositionSource,
    secondaryCopy,
    sourceKey,
    sourceStatus,
    targetSize
  ]);

  const hasCurrentRenderedComposition =
    needsCompositionSource &&
    sourceStatus === "ready" &&
    renderedCompositionKeyRef.current === currentCompositionKeyRef.current;
  const isExportRetryableState =
    compositionStatus === "ready" || compositionStatus === "export-failed";

  async function downloadCover() {
    const canvas = canvasRef.current;
    if (
      isExportingRef.current ||
      !canvas ||
      !hasCurrentRenderedComposition ||
      !isExportRetryableState
    ) {
      return;
    }

    const exportCompositionKey = currentCompositionKeyRef.current;
    const exportSourceKey = currentSourceKeyRef.current;
    const exportSequence = ++exportSequenceRef.current;
    isExportingRef.current = true;

    setCompositionStatus("exporting");
    setErrorMessage(null);

    const isCurrentExport = () =>
      mountedRef.current &&
      exportSequenceRef.current === exportSequence &&
      currentSourceKeyRef.current === exportSourceKey &&
      currentCompositionKeyRef.current === exportCompositionKey &&
      renderedCompositionKeyRef.current === exportCompositionKey;
    let exportCompleted = false;

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) {
            resolve(nextBlob);
          } else {
            reject(new Error("PNG_EXPORT_FAILED"));
          }
        }, "image/png");
      });
      if (!isCurrentExport()) return;

      const downloadUrl = URL.createObjectURL(blob);
      if (!isCurrentExport()) {
        URL.revokeObjectURL(downloadUrl);
        return;
      }

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = buildTitleCoverDownloadFilename(mainCopy, originalTitle);
      link.click();
      URL.revokeObjectURL(downloadUrl);

      if (!isCurrentExport()) return;
      exportCompleted = true;
    } catch {
      if (isCurrentExport()) {
        setCompositionStatus("export-failed");
        setErrorMessage(labels.exportFailed);
      }
    } finally {
      if (exportSequenceRef.current === exportSequence) {
        isExportingRef.current = false;
        if (exportCompleted && isCurrentExport()) {
          setCompositionStatus("ready");
        }
      }
    }
  }

  const canDownload =
    hasCurrentRenderedComposition &&
    isExportRetryableState &&
    !isExportingRef.current;

  if (!sourceUrl) {
    return null;
  }

  const isHistoricalVisualOnly = mainCopy.trim().length === 0;
  const status = isHistoricalVisualOnly
    ? "idle"
    : sourceStatus === "loading"
      ? "loading"
      : sourceStatus === "load-failed"
        ? "load-failed"
        : compositionStatus;

  return (
    <section
      className="grid min-w-0 gap-3"
      data-image-title-cover-composed-preview="true"
      data-image-title-cover-composition-state={status}
      data-image-title-cover-source={sourceUrl}
      data-image-title-cover-source-identity={sourceIdentity ?? undefined}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">
            {isHistoricalVisualOnly ? labels.historicalVisualBase : labels.preview}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {isHistoricalVisualOnly ? labels.noCopy : labels.previewDescription}
          </p>
        </div>
        {!isHistoricalVisualOnly ? (
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
            onClick={() => void downloadCover()}
            disabled={!canDownload}
            aria-busy={isExportingRef.current || compositionStatus === "exporting"}
            data-image-title-cover-download="true"
          >
            {compositionStatus === "exporting" ? labels.exporting : labels.download}
          </button>
        ) : null}
      </div>
      {isHistoricalVisualOnly ? (
        <div className="grid min-h-48 min-w-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-950" data-image-title-cover-historical-visual-base="true">
          <ResolvedAssetImage
            src={sourceUrl}
            token={token}
            alt={labels.historicalVisualBase}
            className="max-h-[min(58vh,36rem)] w-full rounded-[0.55rem] object-contain"
          />
        </div>
      ) : (
        <div className="grid min-w-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-950">
          <canvas
            ref={canvasRef}
            className="h-auto max-w-full rounded-[0.55rem]"
            aria-label={labels.preview}
            data-image-title-cover-canvas="true"
          />
        </div>
      )}
      {!isHistoricalVisualOnly && (status === "loading" || status === "rendering") ? (
        <p className="text-xs text-slate-500 dark:text-slate-400" role="status" data-image-title-cover-composition-message="true">
          {status === "loading" ? labels.loading : labels.rendering}
        </p>
      ) : null}
      {!isHistoricalVisualOnly && status === "overflow" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" role="alert" data-image-title-cover-overflow="true">
          {labels.overflow}
        </p>
      ) : null}
      {!isHistoricalVisualOnly && (status === "load-failed" || status === "render-failed" || status === "export-failed") ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert" data-image-title-cover-composition-error="true">
          {errorMessage ?? labels.renderFailed}
        </p>
      ) : null}
    </section>
  );
}
