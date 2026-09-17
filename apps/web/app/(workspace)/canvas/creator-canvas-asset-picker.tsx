"use client";

import type { AiAssetSummary } from "@ai-aggregate/shared";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { LazyResolvedAssetImage } from "../../../components/workspace/ResolvedAssetImage";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { isAbortError, isPrivateAssetContentUrl } from "../../../lib/private-asset-content";
import { apiUrl } from "../../../lib/site-config";

export type CreatorCanvasAssetPickerState =
  | "idle"
  | "unauthenticated"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export interface CreatorCanvasAssetPickerProps {
  isOpen: boolean;
  targetNodeId: string | null;
  token: string | null;
  excludedAssetId?: string | null;
  onClose: () => void;
  onSelectAsset: (assetId: string) => void;
}

interface CreatorCanvasAssetPickerViewState {
  status: CreatorCanvasAssetPickerState;
  assets: AiAssetSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSelectableCreatorCanvasImageAsset(value: unknown): value is AiAssetSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    value.type === "image" &&
    isPrivateAssetContentUrl(value.url) &&
    typeof value.createdAt === "string" &&
    value.createdAt.trim().length > 0 &&
    (value.title === null || typeof value.title === "string") &&
    (value.taskPrompt === undefined || value.taskPrompt === null || typeof value.taskPrompt === "string")
  );
}

export function filterCreatorCanvasImageAssets(
  value: unknown,
  excludedAssetId: string | null = null
): AiAssetSummary[] {
  if (!isRecord(value) || !Array.isArray(value.assets)) return [];
  const normalizedExcludedAssetId = excludedAssetId?.trim() ?? "";
  return value.assets
    .filter(isSelectableCreatorCanvasImageAsset)
    .filter((asset) => asset.id.trim() !== normalizedExcludedAssetId);
}

function parseCreatorCanvasAssetResponse(
  value: unknown,
  excludedAssetId: string | null
): AiAssetSummary[] {
  if (!isRecord(value) || !Array.isArray(value.assets)) {
    throw new Error("CREATOR_CANVAS_ASSET_RESPONSE_INVALID");
  }
  return filterCreatorCanvasImageAssets(value, excludedAssetId);
}

function getAssetTitle(asset: AiAssetSummary, untitledLabel: string): string {
  const title = typeof asset.title === "string" ? asset.title.trim() : "";
  if (title) return title;
  const prompt = typeof asset.taskPrompt === "string" ? asset.taskPrompt.trim() : "";
  return prompt || untitledLabel;
}

function formatAssetCreatedAt(value: string, locale: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(locale).format(new Date(timestamp));
}

export function CreatorCanvasAssetPicker({
  isOpen,
  targetNodeId,
  token,
  excludedAssetId = null,
  onClose,
  onSelectAsset
}: CreatorCanvasAssetPickerProps) {
  const { locale, t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const [viewState, setViewState] = useState<CreatorCanvasAssetPickerViewState>({
    status: "idle",
    assets: []
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const returnFocusToOpener = useCallback(() => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, []);

  const invalidateRequest = useCallback(() => {
    requestIdRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
  }, []);

  const loadAssets = useCallback(() => {
    const authToken = token?.trim() ?? "";
    if (!isOpen || !targetNodeId || !authToken) return;

    requestControllerRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setViewState({ status: "loading", assets: [] });

    void fetch(apiUrl("/assets?type=image&limit=50"), {
      method: "GET",
      headers: { Authorization: `Bearer ${authToken}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("CREATOR_CANVAS_ASSET_LIST_UNAVAILABLE");
        return parseCreatorCanvasAssetResponse(
          await response.json() as unknown,
          excludedAssetId
        );
      })
      .then((assets) => {
        if (requestIdRef.current !== requestId) return;
        setViewState({ status: assets.length > 0 ? "ready" : "empty", assets });
      })
      .catch((error: unknown) => {
        if (
          requestIdRef.current !== requestId ||
          isAbortError(error) ||
          controller.signal.aborted
        ) {
          return;
        }
        setViewState({ status: "error", assets: [] });
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          requestControllerRef.current = null;
        }
      });
  }, [excludedAssetId, isOpen, targetNodeId, token]);

  useEffect(() => {
    if (!isOpen) {
      invalidateRequest();
      setViewState({ status: "idle", assets: [] });
      const dialog = dialogRef.current;
      if (dialog?.open) dialog.close();
      returnFocusToOpener();
      return;
    }

    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialog.showModal();
      dialog.focus();
    }

    if (!token?.trim()) {
      invalidateRequest();
      setViewState({ status: "unauthenticated", assets: [] });
      return;
    }

    if (!targetNodeId) {
      invalidateRequest();
      setViewState({ status: "error", assets: [] });
      return;
    }

    loadAssets();
    return () => invalidateRequest();
  }, [
    invalidateRequest,
    isOpen,
    loadAssets,
    returnFocusToOpener,
    targetNodeId,
    token
  ]);

  useEffect(() => () => {
    invalidateRequest();
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    returnFocusToOpener();
  }, [invalidateRequest, returnFocusToOpener]);

  const requestClose = useCallback(() => {
    onCloseRef.current();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-labelledby="creator-canvas-asset-picker-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] max-w-none rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl shadow-slate-950/20 outline-none [&::backdrop]:bg-slate-950/50 [&::backdrop]:backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      data-creator-canvas-asset-picker="true"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      tabIndex={-1}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h2
              id="creator-canvas-asset-picker-title"
              className="text-base font-semibold"
            >
              {t("creator.canvas.assetPicker.title")}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t("creator.canvas.assetPicker.description")}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-10 shrink-0 items-center rounded-xl px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label={t("creator.canvas.assetPicker.close")}
            data-creator-canvas-asset-picker-close="true"
            onClick={requestClose}
          >
            {t("creator.canvas.assetPicker.close")}
          </button>
        </header>

        <div
          className="min-h-0 overflow-y-auto px-5 py-5"
          data-creator-canvas-asset-picker-state={viewState.status}
        >
          {viewState.status === "unauthenticated" ? (
            <p
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              data-creator-canvas-asset-picker-login-required="true"
            >
              {t("creator.canvas.assetPicker.loginRequired")}
            </p>
          ) : viewState.status === "loading" ? (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              aria-label={t("creator.canvas.assetPicker.loading")}
              data-creator-canvas-asset-picker-loading="true"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="aspect-[4/3] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          ) : viewState.status === "error" ? (
            <div
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-center text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
              data-creator-canvas-asset-picker-error="true"
              role="alert"
            >
              <p>{t("creator.canvas.assetPicker.loadError")}</p>
              <button
                type="button"
                className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-red-300 px-4 text-xs font-semibold transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:border-red-700 dark:hover:bg-red-950"
                data-creator-canvas-asset-picker-retry="true"
                onClick={() => loadAssets()}
              >
                {t("creator.canvas.assetPicker.retry")}
              </button>
            </div>
          ) : viewState.status === "empty" ? (
            <p
              className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
              data-creator-canvas-asset-picker-empty="true"
            >
              {t(excludedAssetId?.trim()
                ? "creator.canvas.assetPicker.noOther"
                : "creator.canvas.assetPicker.empty")}
            </p>
          ) : viewState.status === "ready" ? (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              role="list"
              data-creator-canvas-asset-picker-grid="true"
            >
              {viewState.assets.map((asset) => {
                const title = getAssetTitle(
                  asset,
                  t("creator.canvas.assetPicker.untitled")
                );
                const createdAt = formatAssetCreatedAt(asset.createdAt, locale);
                return (
                  <article
                    key={asset.id}
                    className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    role="listitem"
                    data-creator-canvas-asset-item="true"
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-800">
                      <LazyResolvedAssetImage
                        src={asset.url}
                        token={token}
                        alt={t("creator.canvas.assetPicker.previewAlt")}
                        containerClassName="size-full"
                        className="size-full object-cover"
                        draggable={false}
                        fallback={(
                          <div
                            className="flex size-full items-center justify-center px-3 text-center text-xs text-slate-400"
                            data-creator-canvas-asset-preview-loading="true"
                          >
                            {t("creator.canvas.assetPicker.previewLoading")}
                          </div>
                        )}
                      />
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
                      <h3 className="line-clamp-2 break-words text-xs font-semibold leading-5">
                        {title}
                      </h3>
                      {createdAt ? (
                        <time
                          className="text-[11px] text-slate-400 dark:text-slate-500"
                          dateTime={asset.createdAt}
                        >
                          {createdAt}
                        </time>
                      ) : null}
                      <button
                        type="button"
                        className="nodrag nopan nowheel mt-auto inline-flex min-h-10 items-center justify-center rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                        data-creator-canvas-asset-select="true"
                        onClick={() => onSelectAsset(asset.id)}
                      >
                        {t("creator.canvas.assetPicker.select")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
