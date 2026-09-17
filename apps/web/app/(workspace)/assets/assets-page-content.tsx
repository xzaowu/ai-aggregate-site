"use client";

import type { AiAssetSummary } from "@ai-aggregate/shared";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePreviewDialog } from "../../../components/workspace/ImagePreviewDialog";
import {
  LazyResolvedAssetImage,
  ResolvedAssetImage
} from "../../../components/workspace/ResolvedAssetImage";
import { ResolvedAssetVideo } from "../../../components/workspace/ResolvedAssetVideo";
import { MobileWorksSwitcher } from "../../../components/workspace/MobileWorksSwitcher";
import { Badge } from "../../../components/workspace/ui";
import { useI18n } from "../../../lib/i18n/use-i18n";
import {
  isAbortError,
  isPrivateAssetContentUrl
} from "../../../lib/private-asset-content";
import { apiUrl } from "../../../lib/site-config";
import { useOptionalWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";
import { useResponsiveWorkspaceMode } from "../../../hooks/use-responsive-workspace-mode";

type AssetFilter = "all" | "text-to-image" | "image-to-image";

const assetFilters: Array<{ key: AssetFilter; labelKey: string }> = [
  { key: "all", labelKey: "multimodal.filter.all" },
  { key: "text-to-image", labelKey: "multimodal.filter.textToImage" },
  { key: "image-to-image", labelKey: "multimodal.filter.imageToImage" },
];

const GENERATION_MODE_META_KEY = "mode";
const TEXT_TO_IMAGE = "text-to-image" as const;
const IMAGE_TO_IMAGE = "image-to-image" as const;

// ---------------------------------------------------------------------------
// Pure helpers – exported for testing
// ---------------------------------------------------------------------------

export const adaptiveAssetPageSizeConfig = {
  minCardWidth: 240,
  estimatedCardHeight: 300,
  gap: 16,
  minPageSize: 6,
  maxPageSize: 24,
  fallbackPageSize: 12,
} as const;

export interface AssetPageSizeParams {
  containerWidth: number;
  containerHeight: number;
  minCardWidth?: number;
  estimatedCardHeight?: number;
  gap?: number;
  minPageSize?: number;
  maxPageSize?: number;
}

export function calculateAssetPageSize(params: AssetPageSizeParams): number {
  const {
    containerWidth,
    containerHeight,
    minCardWidth = adaptiveAssetPageSizeConfig.minCardWidth,
    estimatedCardHeight = adaptiveAssetPageSizeConfig.estimatedCardHeight,
    gap = adaptiveAssetPageSizeConfig.gap,
    minPageSize = adaptiveAssetPageSizeConfig.minPageSize,
    maxPageSize = adaptiveAssetPageSizeConfig.maxPageSize,
  } = params;

  if (
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return minPageSize;
  }

  const columns = Math.max(1, Math.floor((containerWidth + gap) / (minCardWidth + gap)));
  const rows = Math.max(1, Math.floor((containerHeight + gap) / (estimatedCardHeight + gap)));
  const raw = columns * rows;
  return Math.min(maxPageSize, Math.max(minPageSize, raw));
}

export function getAssetTotalPages(totalAssets: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalAssets / Math.max(1, pageSize)));
}

export function clampAssetPage(
  page: number,
  totalAssets: number,
  pageSize: number = adaptiveAssetPageSizeConfig.fallbackPageSize,
): number {
  const totalPages = getAssetTotalPages(totalAssets, pageSize);
  return Math.min(Math.max(1, page), totalPages);
}

export function paginateAssets(
  assets: AiAssetSummary[],
  page: number,
  pageSize: number = adaptiveAssetPageSizeConfig.fallbackPageSize,
): AiAssetSummary[] {
  if (assets.length === 0) return [];
  const safePage = clampAssetPage(page, assets.length, pageSize);
  const start = (safePage - 1) * pageSize;
  return assets.slice(start, start + pageSize);
}

export function getAssetPageAfterDelta(
  currentPage: number,
  totalAssets: number,
  delta: number,
  pageSize: number = adaptiveAssetPageSizeConfig.fallbackPageSize,
): number {
  return clampAssetPage(currentPage + delta, totalAssets, pageSize);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterAssets(assets: AiAssetSummary[], filter: AssetFilter): AiAssetSummary[] {
  if (filter === "all") return assets;

  return assets.filter((asset) => {
    const mode = getAssetGenerationMode(asset);
    if (filter === TEXT_TO_IMAGE) return mode === TEXT_TO_IMAGE;
    if (filter === IMAGE_TO_IMAGE) return mode === IMAGE_TO_IMAGE;
    return true;
  });
}

function getAssetGenerationMode(asset: AiAssetSummary): string | null {
  const metadata = asset.metadata as Record<string, unknown> | null | undefined;
  if (!metadata) return null;
  const mode = metadata[GENERATION_MODE_META_KEY];
  return typeof mode === "string" && mode.length > 0 ? mode : null;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function assetTitle(asset: AiAssetSummary): string {
  return asset.title ?? asset.taskPrompt ?? "Untitled";
}

function mobileAssetTitle(asset: AiAssetSummary): string | null {
  const value = asset.title?.trim() || asset.taskPrompt?.trim();
  return value || null;
}

function mobileAssetAspectRatio(asset: AiAssetSummary): string {
  const metadataAspectRatio = asset.metadata?.aspectRatio;
  if (
    asset.type === "video" &&
    typeof metadataAspectRatio === "string" &&
    /^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/u.test(metadataAspectRatio)
  ) {
    const [width, height] = metadataAspectRatio.split(":").map(Number);
    if (width && height) return `${width} / ${height}`;
  }

  const size = asset.metadata?.size;
  if (typeof size !== "string") {
    return "1 / 1";
  }

  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) {
    return "1 / 1";
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1 / 1";
  }

  const ratio = width / height;
  if (ratio > 1.5) return "4 / 3";
  if (ratio < 0.8) return "3 / 4";
  return `${width} / ${height}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssetsPageContent({
  initialToken,
  initialAssets = [],
}: {
  initialToken?: string | null;
  initialAssets?: AiAssetSummary[];
}) {
  const { t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const viewportMode = useResponsiveWorkspaceMode();

  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [hasCheckedToken, setHasCheckedToken] = useState(initialToken !== undefined);
  const [assets, setAssets] = useState<AiAssetSummary[]>(initialAssets);
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(
    initialToken !== null && initialAssets.length === 0
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  // --- adaptive page size state ---
  const [pageSize, setPageSize] = useState<number>(adaptiveAssetPageSizeConfig.fallbackPageSize);
  const gridMeasureRef = useRef<HTMLDivElement | null>(null);
  const assetRequestSeqRef = useRef(0);
  const assetRequestAbortRef = useRef<AbortController | null>(null);

  // --- load token & assets ---
  useEffect(() => {
    const shellToken = workspaceShell?.shell?.token ?? null;
    const storedToken = initialToken ?? shellToken;
    setToken(storedToken);
    setHasCheckedToken(true);

    if (storedToken) {
      void loadAssets(storedToken);
    } else {
      setIsInitialLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  useEffect(() => () => {
    assetRequestSeqRef.current += 1;
    assetRequestAbortRef.current?.abort();
  }, []);

  async function loadAssets(authToken: string) {
    assetRequestAbortRef.current?.abort();
    const requestId = assetRequestSeqRef.current + 1;
    assetRequestSeqRef.current = requestId;
    const abortController = new AbortController();
    assetRequestAbortRef.current = abortController;
    setIsRefreshing(true);
    try {
      const response = await fetch(apiUrl("/assets?limit=50"), {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(t("multimodal.error.loadFailed"));
      }

      const data = (await response.json()) as { assets?: AiAssetSummary[] };
      if (assetRequestSeqRef.current !== requestId) {
        return;
      }
      setAssets(Array.isArray(data.assets) ? data.assets : []);
      setError(null);
    } catch (loadError) {
      if (assetRequestSeqRef.current !== requestId || isAbortError(loadError)) {
        return;
      }
      setError(t("multimodal.error.loadFailed"));
    } finally {
      if (assetRequestSeqRef.current !== requestId) {
        return;
      }
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  }

  // --- filter & pagination ---
  const readableAssets = useMemo(
    () =>
      assets
        .filter(
          (asset) =>
            (asset.type === "image" || asset.type === "video") &&
            isPrivateAssetContentUrl(asset.url)
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [assets]
  );
  const filteredAssets = useMemo(() => filterAssets(readableAssets, filter), [filter, readableAssets]);
  const mobileAssets = readableAssets;

  const [currentPage, setCurrentPage] = useState(1);
  const safeCurrentPage = clampAssetPage(currentPage, filteredAssets.length, pageSize);
  const totalPages = getAssetTotalPages(filteredAssets.length, pageSize);

  const pageAssets = useMemo(
    () => paginateAssets(filteredAssets, safeCurrentPage, pageSize),
    [filteredAssets, safeCurrentPage, pageSize],
  );

  // filter change → reset page
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  // pageSize change → re-clamp page
  useEffect(() => {
    if (currentPage !== safeCurrentPage) {
      setCurrentPage(safeCurrentPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeCurrentPage]);

  // delete → re-clamp if page is now empty
  useEffect(() => {
    const clamped = clampAssetPage(currentPage, filteredAssets.length, pageSize);
    if (currentPage !== clamped) {
      setCurrentPage(clamped);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredAssets.length]);

  // --- adaptive sizing ---
  useEffect(() => {
    if (typeof window === "undefined") return;

    function measure() {
      const el = gridMeasureRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = calculateAssetPageSize({
        containerWidth: rect.width,
        containerHeight: rect.height,
      });
      setPageSize(next);
    }

    measure();
    window.addEventListener("resize", measure);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => measure());
      if (gridMeasureRef.current) observer.observe(gridMeasureRef.current);
      return () => {
        window.removeEventListener("resize", measure);
        observer.disconnect();
      };
    }

    return () => {
      window.removeEventListener("resize", measure);
    };
  }, []);

  function goToPage(nextPage: number) {
    const clamped = clampAssetPage(nextPage, filteredAssets.length, pageSize);
    setCurrentPage(clamped);
  }

  // --- image preview modal ---
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function openPreview(url: string) {
    setPreviewUrl(url);
  }

  const closePreview = useCallback(() => {
    setPreviewUrl(null);
  }, []);

  useEffect(() => {
    if (!previewUrl) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePreview();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewUrl, closePreview]);

  const showEmpty = !isInitialLoading && filteredAssets.length === 0;
  const showGrid = filteredAssets.length > 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto px-3 py-3 pb-6 md:overflow-hidden sm:px-5 lg:px-6" data-mobile-assets-scroll-owner="true">
      {viewportMode !== "desktop" ? <div className="flex min-w-0 flex-col gap-4" data-mobile-works-assets="true">
        <MobileWorksSwitcher active="assets" />

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700" role="alert">
            <p>{t("multimodal.assets.loadFailedShort")}</p>
            <button
              type="button"
              className="mt-2 font-semibold text-red-800 underline underline-offset-2"
              onClick={() => token && void loadAssets(token)}
              disabled={!token || isRefreshing}
            >
              {t("multimodal.mobileWorks.retry")}
            </button>
          </div>
        ) : null}

        {isInitialLoading ? (
          <div className="grid grid-cols-2 gap-3" data-mobile-works-assets-loading="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                <div className="aspect-square animate-pulse rounded-xl bg-slate-100" />
                <div className="mt-3 h-4 animate-pulse rounded bg-slate-100" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : mobileAssets.length > 0 ? (
          <div className="grid min-w-0 grid-cols-2 gap-3 pb-2" data-mobile-works-gallery="true">
            {mobileAssets.map((asset) => (
              <MobileAssetCard
                key={asset.id}
                asset={asset}
                token={token}
                t={t}
              />
            ))}
          </div>
        ) : (
          <section className="flex min-h-72 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm" data-mobile-works-empty="true">
            <div className="max-w-xs">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <ImageIcon className="size-6" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-950">
                {t("multimodal.mobileWorks.emptyAssetsTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {t("multimodal.mobileWorks.emptyAssetsDescription")}
              </p>
              <Link href="/image" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white">
                {t("multimodal.mobileWorks.startCreating")}
              </Link>
            </div>
          </section>
        )}
      </div> : null}

      {viewportMode === "desktop" ? <div className="min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header + filters */}
      <header className="shrink-0 border-b border-slate-200 dark:border-slate-700 pb-3">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-100">
              {t("multimodal.assets.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              {t("multimodal.assets.description")}
            </p>
          </div>
        </div>

        <div
          className="mt-3 flex min-w-0 flex-wrap gap-2"
          data-asset-filter-panel="true"
          aria-label={t("multimodal.assets.filters")}
        >
          {assetFilters.map((item) => (
            <button
              key={item.key}
              type="button"
              className={
                filter === item.key
                  ? "shrink-0 rounded-full border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-400"
                  : "shrink-0 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 transition hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-400"
              }
              data-asset-filter-chip={item.key}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      </header>

      {/* Error */}
      {error ? (
        <p className="mt-3 shrink-0 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {/* Loading */}
      {isInitialLoading ? (
        <div className="mt-3 flex min-h-0 flex-1 items-center justify-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("multimodal.assets.loadingAssets")}</p>
        </div>
      ) : showEmpty ? (
        /* Empty */
        <section
          className="mt-3 flex min-h-0 flex-1 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center shadow-sm dark:shadow-none"
          data-asset-grid="true"
        >
          <div className="max-w-md">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
              <ImageIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
              {t("multimodal.assets.emptyTitleEnhanced")}
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("multimodal.assets.emptyDescriptionEnhanced")}
            </p>
            <Link
              href="/image"
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-indigo-600 dark:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 dark:hover:bg-indigo-600"
            >
              {t("multimodal.goToImageCreation")}
            </Link>
          </div>
        </section>
      ) : showGrid ? (
        /* Asset grid + pagination */
        <>
          <div ref={gridMeasureRef} className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
            <section
              className="grid flex-1 auto-rows-max content-start gap-4 overflow-auto sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              data-asset-grid="true"
            >
              {pageAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onPreview={() => openPreview(asset.url)}
                  token={token}
                  t={t}
                />
              ))}
            </section>
          </div>

          {/* Pagination */}
          <AssetPagination
            currentPage={safeCurrentPage}
            totalPages={totalPages}
            totalAssets={filteredAssets.length}
            pageSize={pageSize}
            onPrevious={() =>
              goToPage(
                getAssetPageAfterDelta(safeCurrentPage, filteredAssets.length, -1, pageSize),
              )
            }
            onNext={() =>
              goToPage(
                getAssetPageAfterDelta(safeCurrentPage, filteredAssets.length, 1, pageSize),
              )
            }
            t={t}
          />
        </>
      ) : null}

      </div> : null}

      <ImagePreviewDialog
        src={previewUrl}
        token={token}
        alt={t("multimodal.tasks.previewAlt")}
        closeLabel={t("multimodal.image.closePreview")}
        zoomInLabel={t("multimodal.image.zoomIn")}
        zoomOutLabel={t("multimodal.image.zoomOut")}
        fitLabel={t("multimodal.image.fitPreview")}
        loadingLabel={t("multimodal.image.loadingPreview")}
        loadFailedLabel={t("multimodal.image.loadFailedPreview")}
        onClose={closePreview}
      />
    </div>
  );
}

function MobileAssetCard({
  asset,
  token,
  t
}: {
  asset: AiAssetSummary;
  token: string | null;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const title = mobileAssetTitle(asset);

  return (
    <Link
      href={`/assets/${asset.id}`}
      className="group block min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition hover:border-indigo-200"
      data-mobile-asset-card="true"
      data-asset-id={asset.id}
    >
      <div
        className="flex w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100 p-1.5"
        style={{ aspectRatio: mobileAssetAspectRatio(asset) }}
        data-mobile-asset-image-frame="true"
      >
        {asset.type === "video" ? (
          <ResolvedAssetVideo
            src={asset.url}
            token={token}
            controls
            playsInline
            className="h-full w-full object-contain object-center"
            fallback={<div className="size-full animate-pulse rounded-xl bg-slate-200" data-asset-thumbnail-loading="true" />}
          />
        ) : (
          <LazyResolvedAssetImage
            src={asset.url}
            token={token}
            alt={title ?? t("multimodal.mobileWorks.preview")}
            containerClassName="h-full w-full"
            className="h-full w-full object-contain object-center"
            loading="lazy"
            fallback={<div className="size-full animate-pulse rounded-xl bg-slate-200" data-asset-thumbnail-loading="true" />}
          />
        )}
      </div>
      {title ? (
        <h2 className="mt-2 line-clamp-2 break-words px-1 text-[15px] font-semibold leading-5 text-slate-950">
          {title}
        </h2>
      ) : null}
      <time className="mt-1 block px-1 text-xs font-medium text-slate-400" dateTime={asset.createdAt}>
        {formatDate(asset.createdAt)}
      </time>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Asset card
// ---------------------------------------------------------------------------

function AssetCard({
  asset,
  onPreview,
  token,
  t,
}: {
  asset: AiAssetSummary;
  onPreview: () => void;
  token: string | null;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const mode = getAssetGenerationMode(asset);

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm dark:shadow-none transition hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md dark:hover:shadow-none"
      data-asset-card="true"
    >
      {/* Image area – clickable for preview */}
      {asset.type === "video" ? (
        <div
          className="flex min-h-[160px] max-h-[240px] min-w-0 items-center justify-center overflow-hidden bg-slate-950 p-2"
          data-asset-video-frame="true"
        >
          <ResolvedAssetVideo
            src={asset.url}
            token={token}
            controls
            playsInline
            className="max-h-full max-w-full rounded-lg object-contain"
            fallback={<div className="min-h-[160px] w-full animate-pulse rounded-lg bg-slate-800" data-asset-thumbnail-loading="true" />}
          />
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center justify-center bg-slate-50 dark:bg-slate-800 p-3 min-h-[160px] max-h-[240px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          data-asset-image-button="true"
          aria-label={t("multimodal.image.closePreview")}
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
        >
          <LazyResolvedAssetImage
            src={asset.url}
            token={token}
            alt={assetTitle(asset)}
            containerClassName="h-full w-full"
            className="max-h-full max-w-full h-auto w-auto rounded-lg object-contain transition group-hover:scale-[1.02]"
            loading="lazy"
            fallback={<div className="min-h-[160px] size-full animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" data-asset-thumbnail-loading="true" />}
          />
        </button>
      )}

      {/* Body – the primary card area opens the detail page. */}
      <Link
        href={`/assets/${asset.id}`}
        className="flex flex-1 flex-col gap-1.5 p-3"
        data-asset-card-detail-trigger="true"
      >
        {/* Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {mode ? (
            <Badge tone={mode === IMAGE_TO_IMAGE ? "indigo" : "slate"}>
              {t(`multimodal.image.mode.${mode}`)}
            </Badge>
          ) : null}
          <Badge tone="slate">
            {t(`multimodal.type.${asset.type}`)}
          </Badge>
        </div>

        {/* Title */}
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">
          {assetTitle(asset)}
        </h3>

        {/* Date */}
        <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(asset.createdAt)}</p>

      </Link>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function AssetPagination({
  currentPage,
  totalPages,
  totalAssets,
  pageSize,
  onPrevious,
  onNext,
  t,
}: {
  currentPage: number;
  totalPages: number;
  totalAssets: number;
  pageSize: number;
  onPrevious: () => void;
  onNext: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const isSinglePage = totalPages <= 1;

  return (
    <nav
      className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-700 pt-3"
      data-asset-pagination="true"
      data-asset-page-size={String(pageSize)}
      aria-label={t("multimodal.tasks.pagination.label")}
    >
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-semibold text-slate-600 dark:text-slate-400 shadow-sm dark:shadow-none transition hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        data-asset-prev-page="true"
        onClick={onPrevious}
        disabled={currentPage <= 1}
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" />
        {t("multimodal.tasks.pagination.previous")}
      </button>
      <div className="min-w-0 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
        <span data-asset-page-indicator="true">
          {t("multimodal.tasks.pagination.page", {
            current: String(currentPage),
            total: String(totalPages),
          })}
        </span>
        <span className="hidden sm:inline">
          {" · "}
          {t("multimodal.tasks.pagination.total", {
            total: String(totalAssets),
          })}
        </span>
      </div>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-semibold text-slate-600 dark:text-slate-400 shadow-sm dark:shadow-none transition hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        data-asset-next-page="true"
        onClick={onNext}
        disabled={isSinglePage || currentPage >= totalPages}
      >
        {t("multimodal.tasks.pagination.next")}
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </button>
    </nav>
  );
}
