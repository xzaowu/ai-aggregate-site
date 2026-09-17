"use client";

import { Expand, Maximize2, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CreatorNodeWorkspaceKind = "text" | "image" | "video";
export type CreatorNodeWorkspaceRenderMode = "workspace" | "focus";
export type CreatorNodeWorkspacePlacement = "below" | "above" | "center";

export interface CreatorNodeWorkspaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreatorNodeWorkspacePlacementInput {
  anchorRect: CreatorNodeWorkspaceRect;
  viewportRect: CreatorNodeWorkspaceRect;
  workspaceSize: Pick<CreatorNodeWorkspaceRect, "width" | "height">;
  gap?: number;
  inset?: number;
}

export interface CreatorNodeWorkspacePlacementResult {
  x: number;
  y: number;
  placement: CreatorNodeWorkspacePlacement;
}

export interface CreatorNodeWorkspaceEffectiveSize {
  width: number;
  height: number;
}

export const CREATOR_NODE_WORKSPACE_DEFAULT_SIZE = Object.freeze({
  width: 448,
  height: 600
});

export const CREATOR_NODE_WORKSPACE_GAP = 16;
export const CREATOR_NODE_WORKSPACE_INSET = 12;

function isFiniteRect(rect: CreatorNodeWorkspaceRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, value));
}

function getSafeInset(span: number, inset: number): number {
  return Math.min(Math.max(0, inset), span / 2);
}

export function getCreatorNodeWorkspaceEffectiveSize({
  viewportRect,
  workspaceSize,
  inset = CREATOR_NODE_WORKSPACE_INSET
}: {
  viewportRect: CreatorNodeWorkspaceRect;
  workspaceSize: Pick<CreatorNodeWorkspaceRect, "width" | "height">;
  inset?: number;
}): CreatorNodeWorkspaceEffectiveSize {
  if (
    !isFiniteRect(viewportRect) ||
    !Number.isFinite(workspaceSize.width) ||
    !Number.isFinite(workspaceSize.height) ||
    workspaceSize.width <= 0 ||
    workspaceSize.height <= 0
  ) {
    return {
      width: Math.max(0, workspaceSize.width),
      height: Math.max(0, workspaceSize.height)
    };
  }

  const normalizedInset = Number.isFinite(inset) ? Math.max(0, inset) : 0;
  const insetX = getSafeInset(viewportRect.width, normalizedInset);
  const insetY = getSafeInset(viewportRect.height, normalizedInset);
  return {
    width: Math.min(workspaceSize.width, Math.max(0, viewportRect.width - insetX * 2)),
    height: Math.min(workspaceSize.height, Math.max(0, viewportRect.height - insetY * 2))
  };
}

/**
 * Places a fixed-CSS-size workspace in screen coordinates. The result is
 * independent from the React Flow transform; callers only convert it to
 * their local viewport coordinates when rendering the overlay.
 */
export function calculateCreatorNodeWorkspacePlacement({
  anchorRect,
  viewportRect,
  workspaceSize,
  gap = CREATOR_NODE_WORKSPACE_GAP,
  inset = CREATOR_NODE_WORKSPACE_INSET
}: CreatorNodeWorkspacePlacementInput): CreatorNodeWorkspacePlacementResult {
  const invalid =
    !isFiniteRect(anchorRect) ||
    !isFiniteRect(viewportRect) ||
    !Number.isFinite(workspaceSize.width) ||
    !Number.isFinite(workspaceSize.height) ||
    workspaceSize.width <= 0 ||
    workspaceSize.height <= 0 ||
    !Number.isFinite(gap) ||
    !Number.isFinite(inset);

  if (invalid) {
    return { x: 0, y: 0, placement: "center" };
  }

  const normalizedInset = Math.max(0, inset);
  const insetX = getSafeInset(viewportRect.width, normalizedInset);
  const insetY = getSafeInset(viewportRect.height, normalizedInset);
  const effectiveWorkspaceSize = getCreatorNodeWorkspaceEffectiveSize({
    viewportRect,
    workspaceSize,
    inset: normalizedInset
  });
  const viewportRight = viewportRect.x + viewportRect.width;
  const viewportBottom = viewportRect.y + viewportRect.height;
  const minimumX = viewportRect.x + insetX;
  const maximumX = viewportRight - insetX - effectiveWorkspaceSize.width;
  const minimumY = viewportRect.y + insetY;
  const maximumY = viewportBottom - insetY - effectiveWorkspaceSize.height;

  // A centered fallback is still useful when adjacency is impossible because
  // the natural workspace is larger than the actual Canvas viewport. The
  // caller uses the same effective size, so this remains fully actionable.
  if (
    workspaceSize.width > effectiveWorkspaceSize.width ||
    workspaceSize.height > effectiveWorkspaceSize.height
  ) {
    return {
      x: minimumX,
      y: minimumY,
      placement: "center"
    };
  }

  const belowY = anchorRect.y + anchorRect.height + gap;
  const aboveY = anchorRect.y - gap - effectiveWorkspaceSize.height;
  const belowAvailable = viewportBottom - insetY - belowY;
  const aboveAvailable = aboveY + effectiveWorkspaceSize.height - (viewportRect.y + insetY);
  const belowFits = belowAvailable >= effectiveWorkspaceSize.height;
  const aboveFits = aboveAvailable >= effectiveWorkspaceSize.height;
  const placement: Exclude<CreatorNodeWorkspacePlacement, "center"> = belowFits
    ? "below"
    : aboveFits
      ? "above"
      : belowAvailable >= aboveAvailable
        ? "below"
        : "above";
  const preferredY = placement === "below" ? belowY : aboveY;
  const centeredX = anchorRect.x + (anchorRect.width - effectiveWorkspaceSize.width) / 2;

  return {
    x: clamp(centeredX, minimumX, maximumX),
    y: clamp(preferredY, minimumY, maximumY),
    placement
  };
}

function stopCanvasPropagation(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

export interface CreatorNodeWorkspaceProps {
  kind: CreatorNodeWorkspaceKind;
  title: string;
  typeLabel: string;
  closeLabel: string;
  expandLabel: string;
  focusTitle: string;
  focusCloseLabel: string;
  anchorRect: CreatorNodeWorkspaceRect;
  viewportRect: CreatorNodeWorkspaceRect;
  onClose: () => void;
  onBeforeClose?: () => void;
  onBeforeFocusOpen?: () => void;
  onBeforeFocusClose?: () => void;
  children: (mode: CreatorNodeWorkspaceRenderMode) => React.ReactNode;
}

export function CreatorNodeWorkspace({
  kind,
  title,
  typeLabel,
  closeLabel,
  expandLabel,
  focusTitle,
  focusCloseLabel,
  anchorRect,
  viewportRect,
  onClose,
  onBeforeClose,
  onBeforeFocusOpen,
  onBeforeFocusClose,
  children
}: CreatorNodeWorkspaceProps) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const focusDialogRef = useRef<HTMLElement | null>(null);
  const expandTriggerRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onBeforeCloseRef = useRef(onBeforeClose);
  const onBeforeFocusCloseRef = useRef(onBeforeFocusClose);
  const [focusOpen, setFocusOpen] = useState(false);
  const [workspaceSize, setWorkspaceSize] = useState<{
    width: number;
    height: number;
  }>(() => CREATOR_NODE_WORKSPACE_DEFAULT_SIZE);

  useEffect(() => {
    onCloseRef.current = onClose;
    onBeforeCloseRef.current = onBeforeClose;
    onBeforeFocusCloseRef.current = onBeforeFocusClose;
  }, [onBeforeClose, onBeforeFocusClose, onClose]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setWorkspaceSize((current) =>
        current.width >= rect.width && current.height >= rect.height
          ? current
          : {
              width: Math.max(current.width, rect.width),
              height: Math.max(current.height, rect.height)
            }
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchorRect, viewportRect, focusOpen]);

  useEffect(() => {
    if (!focusOpen) return;
    const previousOverflow = document.body.style.overflow;
    const opener = expandTriggerRef.current;
    document.body.style.overflow = "hidden";

    const focusDialog = () => focusDialogRef.current?.focus();
    const focusTimer = window.setTimeout(focusDialog, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFocusOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      onBeforeFocusCloseRef.current?.();
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, [focusOpen]);

  const placement = calculateCreatorNodeWorkspacePlacement({
    anchorRect,
    viewportRect,
    workspaceSize
  });
  const effectiveWorkspaceSize = getCreatorNodeWorkspaceEffectiveSize({
    viewportRect,
    workspaceSize
  });
  const style = {
    left: Math.round(placement.x - viewportRect.x),
    top: Math.round(placement.y - viewportRect.y),
    width: `${Math.round(effectiveWorkspaceSize.width)}px`,
    maxWidth: `${Math.round(effectiveWorkspaceSize.width)}px`,
    maxHeight: `${Math.round(effectiveWorkspaceSize.height)}px`
  };

  const closeWorkspace = () => {
    onBeforeCloseRef.current?.();
    onCloseRef.current();
  };

  const openFocus = () => {
    onBeforeFocusOpen?.();
    setFocusOpen(true);
  };

  const closeFocus = () => {
    setFocusOpen(false);
  };

  const focusOverlay = focusOpen && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 sm:p-6"
          role="presentation"
          data-creator-node-workspace-focus-overlay="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeFocus();
          }}
        >
          <section
            ref={focusDialogRef}
            className="nodrag nopan nowheel flex h-[min(90dvh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-950 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            role="dialog"
            aria-modal="true"
            aria-label={focusTitle}
            tabIndex={-1}
            data-creator-node-workspace-focus="true"
            onKeyDown={stopCanvasPropagation}
            onPointerDown={stopCanvasPropagation}
            onWheel={stopCanvasPropagation}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400">
                  {typeLabel}
                </p>
                <h2 className="mt-1 truncate text-base font-semibold sm:text-lg">{focusTitle}</h2>
              </div>
              <button
                type="button"
                className="nodrag nopan nowheel inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label={focusCloseLabel}
                title={focusCloseLabel}
                onClick={closeFocus}
                data-creator-node-workspace-focus-close="true"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-6"
              onKeyDown={stopCanvasPropagation}
              onPointerDown={stopCanvasPropagation}
              onWheel={stopCanvasPropagation}
            >
              {children("focus")}
            </div>
          </section>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <section
        ref={workspaceRef}
        className="nodrag nopan nowheel absolute z-40 flex max-h-[calc(100dvh-1.5rem)] w-[min(28rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-950 shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        style={style}
        aria-label={title}
        data-creator-node-workspace="true"
        data-creator-node-workspace-kind={kind}
        data-creator-node-workspace-placement={placement.placement}
        data-creator-node-workspace-size={`${Math.round(workspaceSize.width)}x${Math.round(workspaceSize.height)}`}
        onKeyDown={stopCanvasPropagation}
        onPointerDown={stopCanvasPropagation}
        onWheel={stopCanvasPropagation}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3.5 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400">
              {typeLabel}
            </p>
            <h2 className="mt-1 truncate text-sm font-semibold">{title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              ref={expandTriggerRef}
              type="button"
              className="nodrag nopan nowheel inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-indigo-300 dark:hover:bg-indigo-950"
              aria-label={expandLabel}
              title={expandLabel}
              onClick={openFocus}
              data-creator-node-workspace-expand="true"
            >
              <Expand className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{expandLabel}</span>
            </button>
            <button
              type="button"
              className="nodrag nopan nowheel inline-flex size-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={closeWorkspace}
              data-creator-node-workspace-close="true"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5"
          onKeyDown={stopCanvasPropagation}
          onPointerDown={stopCanvasPropagation}
          onWheel={stopCanvasPropagation}
        >
          {!focusOpen ? children("workspace") : (
            <div className="flex min-h-24 items-center justify-center text-xs text-slate-400" aria-hidden="true">
              <Maximize2 className="mr-2 size-4" aria-hidden="true" />
              {focusTitle}
            </div>
          )}
        </div>
      </section>
      {focusOverlay}
    </>
  );
}
