"use client";

import {
  aiGenerationSizes,
  imageGenerationModes,
  type AiAssetDetailResponse,
  type AiAssetSummary,
  type AiTaskSummary,
  type ImageGenerationMode
} from "@ai-aggregate/shared";
import { ArrowLeft, Copy, Download, Expand, Link as LinkIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { ImagePreviewDialog } from "../../../../components/workspace/ImagePreviewDialog";
import { MultimodalWorkspacePage } from "../../../../components/workspace/MultimodalWorkspacePage";
import { ResolvedAssetImage } from "../../../../components/workspace/ResolvedAssetImage";
import { ResolvedAssetVideo } from "../../../../components/workspace/ResolvedAssetVideo";
import { useI18n } from "../../../../lib/i18n/use-i18n";
import {
  fetchPrivateAssetBlob,
  isPrivateAssetContentUrl
} from "../../../../lib/private-asset-content";
import { apiUrl } from "../../../../lib/site-config";
import { writeImageCreationHandoff } from "../../../image-creation-handoff";
import { useOptionalWorkspaceShellContext } from "../../../../components/workspace/workspace-shell-context";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readMode(value: unknown): ImageGenerationMode | null {
  return imageGenerationModes.includes(value as ImageGenerationMode)
    ? (value as ImageGenerationMode)
    : null;
}

function readSize(value: unknown): string | null {
  return aiGenerationSizes.includes(value as (typeof aiGenerationSizes)[number])
    ? String(value)
    : null;
}

function getMetadata(asset: AiAssetSummary, task: AiTaskSummary | null) {
  const metadata = asset.metadata ?? {};
  const input = task?.input ?? {};
  const output = task?.output ?? {};
  return {
    prompt: readString(asset.taskPrompt) ?? readString(task?.prompt),
    model: readString(metadata.modelId) ?? readString(task?.modelId) ?? readString(input.modelId),
    size: readSize(metadata.size) ?? readSize(input.size) ?? readSize(output.size),
    mode: readMode(metadata.mode) ?? readMode(input.mode) ?? readMode(output.mode)
  };
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function DetailRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-b border-slate-100 py-3 last:border-b-0 dark:border-slate-700">
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function safeAssetImageUrl(asset: AiAssetSummary): string | null {
  if (isPrivateAssetContentUrl(asset.thumbnailUrl)) return asset.thumbnailUrl;
  return isPrivateAssetContentUrl(asset.url) ? asset.url : null;
}

function safeAssetVideoUrl(asset: AiAssetSummary): string | null {
  return asset.type === "video" && isPrivateAssetContentUrl(asset.url)
    ? asset.url
    : null;
}

export function AssetDetailPageContent({
  assetId,
  initialToken,
  initialAsset = null,
  initialTask = null
}: {
  assetId: string;
  initialToken?: string | null;
  initialAsset?: AiAssetSummary | null;
  initialTask?: AiTaskSummary | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [hasCheckedToken, setHasCheckedToken] = useState(initialToken !== undefined);
  const [asset, setAsset] = useState<AiAssetSummary | null>(initialAsset);
  const [task, setTask] = useState<AiTaskSummary | null>(initialTask);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const isContinuingRef = useRef(false);
  const isDownloadingRef = useRef(false);
  const previewHistoryRef = useRef(false);

  useEffect(() => {
    const storedToken = initialToken ?? workspaceShell?.shell?.token ?? null;
    setToken(storedToken);
    setHasCheckedToken(true);

    if (!storedToken || initialAsset) return;

    void (async () => {
      try {
        const response = await fetch(apiUrl(`/assets/${assetId}`), {
          headers: { Authorization: `Bearer ${storedToken}` }
        });
        if (!response.ok) throw new Error("load failed");
        const data = (await response.json()) as AiAssetDetailResponse;
        setAsset(data.asset);
        setTask(data.task);
      } catch {
        setError(t("multimodal.error.loadFailed"));
      }
    })();
  }, [assetId, initialAsset, initialToken, t, workspaceShell]);

  useEffect(() => {
    if (!isPreviewOpen) return;

    const onPopState = () => {
      previewHistoryRef.current = false;
      setIsPreviewOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isPreviewOpen]);

  function openPreview() {
    if (!asset || !safeAssetImageUrl(asset)) return;
    window.history.pushState({ assetPreview: true }, "", window.location.href);
    previewHistoryRef.current = true;
    setIsPreviewOpen(true);
  }

  function closePreview() {
    if (previewHistoryRef.current) {
      previewHistoryRef.current = false;
      window.history.back();
      return;
    }
    setIsPreviewOpen(false);
  }

  async function copyPrompt(prompt: string) {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyFeedback(t("multimodal.copyPromptSuccess"));
      window.setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setError(t("multimodal.error.loadFailed"));
    }
  }

  async function copyUrl() {
    if (!asset || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(
        new URL(`/assets/${asset.id}`, window.location.origin).toString()
      );
      setCopyFeedback(t("multimodal.mobileWorks.copyLinkSuccess"));
      window.setTimeout(() => setCopyFeedback(null), 2500);
    } catch {
      setError(t("multimodal.error.loadFailed"));
    }
  }

  async function downloadAsset() {
    if (isDownloadingRef.current || isDownloading || !asset || !token) return;
    const logicalUrl = asset.url;
    if (!isPrivateAssetContentUrl(logicalUrl)) {
      setError(t("multimodal.error.loadFailed"));
      return;
    }

    isDownloadingRef.current = true;
    setIsDownloading(true);
    try {
      const blob = await fetchPrivateAssetBlob({ logicalUrl, token });
      const extension =
        blob.type === "video/mp4"
          ? "mp4"
          : blob.type === "image/jpeg"
            ? "jpg"
            : blob.type === "image/webp"
              ? "webp"
              : "png";
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `asset-${asset.id}.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setError(t("multimodal.error.loadFailed"));
    } finally {
      isDownloadingRef.current = false;
      setIsDownloading(false);
    }
  }

  async function deleteAsset() {
    if (isDeleting || !asset || !token) return;
    if (!isDeleteConfirmOpen) {
      setIsDeleteConfirmOpen(true);
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/assets/${asset.id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("delete failed");
      router.push("/assets");
    } catch {
      setError(t("multimodal.deleteAssetFailed"));
      setIsDeleteConfirmOpen(false);
      setIsDeleting(false);
    }
  }

  function continueCreating() {
    if (
      isContinuingRef.current ||
      !asset ||
      asset.type !== "image" ||
      !isPrivateAssetContentUrl(asset.url)
    ) {
      return;
    }

    isContinuingRef.current = true;
    setIsContinuing(true);
    setError(null);
    try {
      if (!writeImageCreationHandoff(asset.id)) {
        setError(t("multimodal.image.continueCreatingWriteFailed"));
        isContinuingRef.current = false;
        setIsContinuing(false);
        return;
      }
      router.push("/image");
    } catch {
      setError(t("multimodal.image.continueCreatingWriteFailed"));
      isContinuingRef.current = false;
      setIsContinuing(false);
    }
  }

  const imageUrl = asset ? safeAssetImageUrl(asset) : null;
  const videoUrl = asset ? safeAssetVideoUrl(asset) : null;
  const mediaUrl = imageUrl ?? videoUrl;
  const metadata = asset ? getMetadata(asset, task) : null;
  const detailRows = metadata
    ? [
        metadata.model ? { label: t("multimodal.model"), value: metadata.model } : null,
        metadata.size ? { label: t("multimodal.size"), value: metadata.size } : null,
        metadata.mode
          ? { label: t("multimodal.mode"), value: t(`multimodal.image.mode.${metadata.mode}`) }
          : null,
        asset ? { label: t("multimodal.createdAt"), value: formatDate(asset.createdAt) } : null
      ].filter((row): row is { label: string; value: string } => row !== null)
    : [];

  return (
    <MultimodalWorkspacePage
      icon={LinkIcon}
      eyebrowKey="multimodal.assets.eyebrow"
      titleKey="multimodal.assetDetail.title"
      descriptionKey="multimodal.assetDetail.description"
      hideMobileHeader
      className="min-h-0 flex-1 overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:overflow-visible md:pb-5"
    >
      <div className="md:hidden">
        <div className="mb-4 flex items-center gap-3">
          <Link href="/assets" aria-label={t("multimodal.mobileWorks.back")} className="flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-center text-2xl font-bold text-slate-950">
            {t("multimodal.mobileWorks.detailTitle")}
          </h1>
          <div className="size-10 shrink-0" aria-hidden="true" />
        </div>
      </div>

      {error ? <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700" role="alert">{error}</p> : null}

      {!hasCheckedToken ? null : !token ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <h2 className="text-base font-semibold text-slate-950">{t("multimodal.loginRequiredTitle")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("multimodal.loginRequiredDescription")}</p>
        </section>
      ) : asset && metadata ? (
        <section className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]" data-asset-detail-layout="responsive-split">
          {videoUrl ? (
            <div
              className="relative flex min-h-[280px] max-h-[min(72vh,680px)] min-w-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-2 lg:min-h-[560px]"
              data-asset-detail-video-frame="true"
            >
              <ResolvedAssetVideo
                src={videoUrl}
                token={token}
                controls
                playsInline
                className="max-h-full max-w-full object-contain object-center"
              />
            </div>
          ) : (
            <button
              type="button"
              className="group relative flex min-h-[280px] max-h-[min(72vh,680px)] min-w-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-2 text-left lg:min-h-[560px]"
              onClick={openPreview}
              disabled={!imageUrl}
              aria-label={t("multimodal.mobileWorks.preview")}
              data-asset-detail-image-button="true"
            >
              {imageUrl ? (
                <ResolvedAssetImage
                  src={imageUrl}
                  token={token}
                  alt={metadata.prompt ?? t("multimodal.mobileWorks.preview")}
                  className="max-h-full max-w-full object-contain object-center"
                />
              ) : (
                <span className="text-sm text-slate-500">{t("multimodal.mobileWorks.noPreview")}</span>
              )}
              {imageUrl ? <Expand className="absolute right-3 top-3 size-5 rounded-full bg-white/90 p-1 text-slate-700 shadow" aria-hidden="true" /> : null}
            </button>
          )}

          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            {metadata.prompt ? (
              <section className="border-b border-slate-100 pb-5 dark:border-slate-700" data-asset-detail-prompt="true">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t("multimodal.prompt")}</h2>
                  <button type="button" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-indigo-600" onClick={() => void copyPrompt(metadata.prompt!)}>
                    <Copy className="size-4" aria-hidden="true" />
                    {t("multimodal.copyPrompt")}
                  </button>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-300">{metadata.prompt}</p>
                {copyFeedback && copyFeedback === t("multimodal.copyPromptSuccess") ? <p className="mt-2 text-xs font-semibold text-emerald-700">{copyFeedback}</p> : null}
              </section>
            ) : null}

            <section className={`${metadata.prompt ? "pt-5" : ""}`} data-asset-detail-info="true">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t("multimodal.mobileWorks.infoTitle")}</h2>
              <dl className="mt-2 grid min-w-0 gap-x-6 sm:grid-cols-2">
                {detailRows.map((row) => <DetailRow key={row.label} label={row.label} value={row.value} />)}
              </dl>
            </section>

            {asset.type === "image" && isPrivateAssetContentUrl(asset.url) ? (
              <button
                type="button"
                className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={continueCreating}
                disabled={isContinuing}
                aria-busy={isContinuing}
                aria-label={`${t("multimodal.image.continueCreating")}: ${t("multimodal.image.useAsReference")}`}
                data-asset-detail-continue-creating="true"
              >
                {isContinuing ? "..." : t("multimodal.image.continueCreating")}
              </button>
            ) : null}
            <div className="mt-3 grid grid-cols-3 gap-2" data-asset-detail-actions="true">
              <button type="button" className="inline-flex min-h-12 min-w-0 items-center justify-center gap-1 rounded-xl bg-indigo-600 px-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60 sm:gap-2 sm:text-sm" onClick={() => void downloadAsset()} disabled={isDownloading || !mediaUrl} aria-busy={isDownloading}>
                <Download className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("multimodal.download")}</span>
              </button>
              <button type="button" className="inline-flex min-h-12 min-w-0 items-center justify-center gap-1 rounded-xl border border-indigo-600 bg-white px-2 text-xs font-semibold text-indigo-700 sm:gap-2 sm:text-sm" onClick={() => void copyUrl()}>
                <Copy className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("multimodal.copyUrl")}</span>
              </button>
              <button type="button" className="inline-flex min-h-12 min-w-0 items-center justify-center gap-1 rounded-xl bg-red-50 px-2 text-xs font-semibold text-red-600 sm:gap-2 sm:text-sm" onClick={() => void deleteAsset()} disabled={isDeleting} aria-busy={isDeleting}>
                <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("multimodal.mobileWorks.delete")}</span>
              </button>
            </div>
            {isDeleteConfirmOpen ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3" role="alert" data-asset-delete-confirm="true">
                <p className="text-sm font-medium leading-5 text-red-700">{t("multimodal.mobileWorks.deleteConfirm")}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="min-h-10 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700" onClick={() => setIsDeleteConfirmOpen(false)} disabled={isDeleting}>{t("admin.cancel")}</button>
                  <button type="button" className="min-h-10 flex-1 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white" onClick={() => void deleteAsset()} disabled={isDeleting}>{t("multimodal.mobileWorks.delete")}</button>
                </div>
              </div>
            ) : null}
            {copyFeedback && copyFeedback !== t("multimodal.copyPromptSuccess") ? <p className="mt-3 text-center text-xs font-semibold text-emerald-700">{copyFeedback}</p> : null}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <h2 className="text-base font-semibold text-slate-950">{t("multimodal.assetDetail.notFoundTitle")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("multimodal.assetDetail.notFoundDescription")}</p>
        </section>
      )}

      <ImagePreviewDialog
        src={isPreviewOpen ? imageUrl : null}
        token={token}
        alt={t("multimodal.mobileWorks.preview")}
        closeLabel={t("multimodal.mobileWorks.closePreview")}
        zoomInLabel={t("multimodal.image.zoomIn")}
        zoomOutLabel={t("multimodal.image.zoomOut")}
        fitLabel={t("multimodal.image.fitPreview")}
        loadingLabel={t("multimodal.image.loadingPreview")}
        loadFailedLabel={t("multimodal.image.loadFailedPreview")}
        onClose={closePreview}
      />
    </MultimodalWorkspacePage>
  );
}
