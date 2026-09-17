"use client";

import React, { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { useResolvedAssetUrl } from "../../hooks/use-resolved-asset-url";

type ImagePreviewPoint = {
  x: number;
  y: number;
};

export function calculateImagePreviewFitScale(
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number
) {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return 1;
  }

  return Math.min(1, viewportWidth / naturalWidth, viewportHeight / naturalHeight);
}

export function clampImagePreviewScale(scale: number, fitScale: number) {
  return Math.min(4, Math.max(fitScale, scale));
}

function distanceBetweenPoints(first: ImagePreviewPoint, second: ImagePreviewPoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpointBetweenPoints(first: ImagePreviewPoint, second: ImagePreviewPoint) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

export function ImagePreviewDialog({
  src,
  alt,
  closeLabel,
  onClose,
  token,
  zoomOutLabel = "Zoom out",
  zoomInLabel = "Zoom in",
  fitLabel = "Fit to window",
  loadingLabel = "Loading image",
  loadFailedLabel = "Image could not be loaded"
}: {
  src: string | null;
  alt: string;
  closeLabel: string;
  onClose: () => void;
  token?: string | null;
  zoomOutLabel?: string;
  zoomInLabel?: string;
  fitLabel?: string;
  loadingLabel?: string;
  loadFailedLabel?: string;
}) {
  const { resolvedUrl, loading, error } = useResolvedAssetUrl({
    src,
    token
  });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const previousOverflowRef = useRef<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const suppressNextSurfaceClickRef = useRef(false);
  const suppressSurfaceClickTimeoutRef = useRef<number | null>(null);
  const pointerMapRef = useRef(new Map<number, ImagePreviewPoint>());
  const dragRef = useRef<{
    pointerId: number;
    point: ImagePreviewPoint;
    offset: ImagePreviewPoint;
  } | null>(null);
  const pinchRef = useRef<{
    distance: number;
    scale: number;
    midpoint: ImagePreviewPoint;
  } | null>(null);
  const naturalSizeRef = useRef({ width: 0, height: 0 });
  const fitScaleRef = useRef(1);
  const scaleRef = useRef(1);
  const offsetRef = useRef<ImagePreviewPoint>({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<ImagePreviewPoint>({ x: 0, y: 0 });
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const isOpen = Boolean(src);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    naturalSizeRef.current = { width: 0, height: 0 };
    fitScaleRef.current = 1;
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setNaturalSize({ width: 0, height: 0 });
    setFitScale(1);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setImageLoadFailed(false);
    pointerMapRef.current.clear();
    dragRef.current = null;
    pinchRef.current = null;
    clearSuppressedSurfaceClick();
  }, [src]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusDialog = () => dialogRef.current?.focus();
    const focusDialogTimeout = window.setTimeout(focusDialog, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(0.25);
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        zoomBy(-0.25);
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        fitImage();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "[data-image-preview-control=true]:not(:disabled)"
        ) ?? []
      );
      if (controls.length === 0) {
        return;
      }

      const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? controls.length - 1
          : currentIndex - 1
        : currentIndex === controls.length - 1
          ? 0
          : currentIndex + 1;
      event.preventDefault();
      controls[nextIndex]?.focus();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusDialogTimeout);
      clearSuppressedSurfaceClick();
      document.body.style.overflow = previousOverflowRef.current ?? "";
      previousOverflowRef.current = null;
      if (openerRef.current?.isConnected) {
        openerRef.current.focus();
      }
      openerRef.current = null;
    };
  }, [isOpen]);

  function clearSuppressedSurfaceClick() {
    if (suppressSurfaceClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressSurfaceClickTimeoutRef.current);
      suppressSurfaceClickTimeoutRef.current = null;
    }
    suppressNextSurfaceClickRef.current = false;
  }

  function markSurfaceClickSuppressed() {
    if (suppressSurfaceClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressSurfaceClickTimeoutRef.current);
      suppressSurfaceClickTimeoutRef.current = null;
    }
    suppressNextSurfaceClickRef.current = true;
  }

  function scheduleSurfaceClickSuppressionReset() {
    if (!suppressNextSurfaceClickRef.current) {
      return;
    }
    if (suppressSurfaceClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressSurfaceClickTimeoutRef.current);
    }
    suppressSurfaceClickTimeoutRef.current = window.setTimeout(() => {
      suppressNextSurfaceClickRef.current = false;
      suppressSurfaceClickTimeoutRef.current = null;
    }, 0);
  }

  function viewportSize() {
    const viewport = viewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    const width = viewport?.clientWidth || rect?.width || window.innerWidth - 32;
    const height = viewport?.clientHeight || rect?.height || window.innerHeight - 112;
    return { width: Math.max(width, 1), height: Math.max(height, 1) };
  }

  function clampOffset(nextOffset: ImagePreviewPoint, nextScale = scaleRef.current) {
    const { width, height } = viewportSize();
    const scaledWidth = naturalSizeRef.current.width * nextScale;
    const scaledHeight = naturalSizeRef.current.height * nextScale;
    const maxX = Math.max(0, (scaledWidth - width) / 2);
    const maxY = Math.max(0, (scaledHeight - height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y))
    };
  }

  function setView(nextScale: number, nextOffset: ImagePreviewPoint) {
    const clampedScale = clampImagePreviewScale(nextScale, fitScaleRef.current);
    const clampedOffset = clampOffset(nextOffset, clampedScale);
    scaleRef.current = clampedScale;
    offsetRef.current = clampedOffset;
    setScale(clampedScale);
    setOffset(clampedOffset);
  }

  function applyZoom(nextScale: number, anchor?: ImagePreviewPoint) {
    const currentScale = scaleRef.current;
    const clampedScale = clampImagePreviewScale(nextScale, fitScaleRef.current);
    let nextOffset = offsetRef.current;

    if (anchor && currentScale > 0 && clampedScale !== currentScale) {
      const viewport = viewportRef.current;
      const rect = viewport?.getBoundingClientRect();
      const centerX = (rect?.left ?? 0) + viewportSize().width / 2;
      const centerY = (rect?.top ?? 0) + viewportSize().height / 2;
      const imagePoint = {
        x: (anchor.x - centerX - offsetRef.current.x) / currentScale,
        y: (anchor.y - centerY - offsetRef.current.y) / currentScale
      };
      nextOffset = {
        x: offsetRef.current.x + imagePoint.x * (currentScale - clampedScale),
        y: offsetRef.current.y + imagePoint.y * (currentScale - clampedScale)
      };
    }

    setView(clampedScale, nextOffset);
  }

  function zoomBy(delta: number) {
    applyZoom(scaleRef.current + delta);
  }

  function fitImage() {
    setView(fitScaleRef.current, { x: 0, y: 0 });
  }

  function recalculateFit(image: HTMLImageElement) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      return;
    }

    naturalSizeRef.current = { width, height };
    setNaturalSize({ width, height });
    const viewport = viewportSize();
    const nextFitScale = calculateImagePreviewFitScale(
      width,
      height,
      viewport.width,
      viewport.height
    );
    fitScaleRef.current = nextFitScale;
    setFitScale(nextFitScale);
    setView(nextFitScale, { x: 0, y: 0 });
  }

  useEffect(() => {
    if (!src || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return;
    }

    function handleResize() {
      const image = imageRef.current;
      if (image) {
        recalculateFit(image);
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [naturalSize.height, naturalSize.width, src]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    pointerMapRef.current.set(event.pointerId, point);

    if (pointerMapRef.current.size >= 2) {
      markSurfaceClickSuppressed();
      const points = Array.from(pointerMapRef.current.values()).slice(0, 2);
      const first = points[0];
      const second = points[1];
      if (first && second) {
        pinchRef.current = {
          distance: Math.max(distanceBetweenPoints(first, second), 1),
          scale: scaleRef.current,
          midpoint: midpointBetweenPoints(first, second)
        };
      }
      dragRef.current = null;
      return;
    }

    if (scaleRef.current > fitScaleRef.current + 0.001) {
      dragRef.current = {
        pointerId: event.pointerId,
        point,
        offset: offsetRef.current
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointerMapRef.current.has(event.pointerId)) {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    pointerMapRef.current.set(event.pointerId, point);
    const pointers = Array.from(pointerMapRef.current.values()).slice(0, 2);
    const pinch = pinchRef.current;
    const first = pointers[0];
    const second = pointers[1];

    if (pinch && first && second) {
      markSurfaceClickSuppressed();
      const nextDistance = Math.max(distanceBetweenPoints(first, second), 1);
      const nextMidpoint = midpointBetweenPoints(first, second);
      applyZoom(pinch.scale * (nextDistance / pinch.distance), nextMidpoint);
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (
      Math.abs(event.clientX - drag.point.x) > 3 ||
      Math.abs(event.clientY - drag.point.y) > 3
    ) {
      markSurfaceClickSuppressed();
    }

    setView(scaleRef.current, {
      x: drag.offset.x + event.clientX - drag.point.x,
      y: drag.offset.y + event.clientY - drag.point.y
    });
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointerMapRef.current.delete(event.pointerId);
    if (pointerMapRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    scheduleSurfaceClickSuppressionReset();
  }

  if (!src) {
    return null;
  }

  const displayUrl = resolvedUrl;
  const showLoadError = imageLoadFailed || Boolean(error) || (!loading && !displayUrl);
  const controlsDisabled = !displayUrl || showLoadError || naturalSize.width <= 0;
  const zoomPercent = Math.round(scale * 100);

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/80 p-4 backdrop-blur-sm"
      data-image-preview-dialog="true"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="relative h-full w-full outline-none"
        tabIndex={-1}
        onClick={(event) => {
          if (suppressNextSurfaceClickRef.current) {
            clearSuppressedSurfaceClick();
            return;
          }
          if (
            event.target === event.currentTarget ||
            event.target === viewportRef.current
          ) {
            onCloseRef.current();
          }
        }}
      >
        <div
          ref={viewportRef}
          className="absolute inset-x-0 bottom-20 top-0 flex items-center justify-center overflow-hidden touch-none"
          data-image-preview-viewport="true"
          data-image-preview-zoom={zoomPercent}
          onWheel={(event) => {
            event.preventDefault();
            if (!controlsDisabled) {
              const nextScale = scaleRef.current + (event.deltaY < 0 ? 0.25 : -0.25);
              applyZoom(nextScale, { x: event.clientX, y: event.clientY });
            }
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onDragStart={(event) => event.preventDefault()}
        >
          {displayUrl && !showLoadError ? (
            <img
              ref={imageRef}
              key={displayUrl}
              src={displayUrl}
              alt={alt}
              draggable={false}
              className="block max-w-none select-none motion-reduce:transition-none"
              style={{
                ...(naturalSize.width > 0
                  ? {
                      width: `${naturalSize.width}px`,
                      height: `${naturalSize.height}px`
                    }
                  : {}),
                transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                transformOrigin: "center center"
              }}
              data-image-preview-image="true"
              onLoad={(event) => recalculateFit(event.currentTarget)}
              onError={() => setImageLoadFailed(true)}
            />
          ) : (
            <p
              className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white/80"
              data-image-preview-load-state={showLoadError ? "failed" : "loading"}
            >
              {showLoadError ? loadFailedLabel : loadingLabel}
            </p>
          )}
        </div>

        <div
          className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl bg-slate-950/75 p-1.5 text-white shadow-lg"
          data-image-preview-controls="true"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-xl transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={controlsDisabled || scale <= fitScale + 0.001}
            aria-label={zoomOutLabel}
            data-image-preview-control="true"
            data-image-preview-zoom-out="true"
            onClick={() => zoomBy(-0.25)}
          >
            <Minus className="size-5" aria-hidden="true" />
          </button>
          <output
            className="min-w-16 px-2 text-center text-sm font-semibold tabular-nums"
            aria-live="polite"
            aria-label={`${zoomPercent}%`}
            data-image-preview-zoom-value="true"
          >
            {zoomPercent}%
          </output>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-xl transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={controlsDisabled || scale >= 4 - 0.001}
            aria-label={zoomInLabel}
            data-image-preview-control="true"
            data-image-preview-zoom-in="true"
            onClick={() => zoomBy(0.25)}
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={controlsDisabled || (scale <= fitScale + 0.001 && offset.x === 0 && offset.y === 0)}
            aria-label={fitLabel}
            data-image-preview-control="true"
            data-image-preview-fit="true"
            onClick={fitImage}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{fitLabel}</span>
          </button>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-xl transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label={closeLabel}
            data-image-preview-control="true"
            data-image-preview-close="true"
            onClick={() => onCloseRef.current()}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
