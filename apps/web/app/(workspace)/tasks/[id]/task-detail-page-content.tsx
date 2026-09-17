"use client";

import type {
  AiAssetSummary,
  AiModelSummary,
  AiTaskDetailResponse,
  AiTaskSummary
} from "@ai-aggregate/shared";
import { getModelDisplayName } from "@ai-aggregate/shared";
import { ChevronLeft, FileWarning, ListChecks } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { ImagePreviewDialog } from "../../../../components/workspace/ImagePreviewDialog";
import { MultimodalWorkspacePage } from "../../../../components/workspace/MultimodalWorkspacePage";
import { ResolvedAssetImage } from "../../../../components/workspace/ResolvedAssetImage";
import { ResolvedAssetVideo } from "../../../../components/workspace/ResolvedAssetVideo";
import { Button } from "../../../../components/workspace/ui";
import { useI18n } from "../../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../../lib/site-config";
import { useOptionalWorkspaceShellContext } from "../../../../components/workspace/workspace-shell-context";
import {
  formatMetadataBytes,
  getTaskReuseParams
} from "../../../multimodal-reuse";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function resolveTaskDetailModelLabel(
  task: AiTaskSummary,
  models: AiModelSummary[],
  fallbackLabel: string
): string {
  const rawModelId = getTaskReuseParams(task).modelId ?? task.modelId;
  const matchedModel = models.find(
    (model) => model.modelId === rawModelId || model.id === rawModelId
  );

  return matchedModel ? getModelDisplayName(matchedModel) : fallbackLabel;
}

function DetailRow({
  label,
  value,
  title
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="grid min-w-0 gap-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-normal text-slate-500">
        {label}
      </dt>
      <dd
        className="min-w-0 break-words text-sm font-medium text-slate-900"
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

function TaskDetailLinkedAsset({
  asset,
  token,
  alt,
  onPreview
}: {
  asset: AiAssetSummary;
  token: string | null;
  alt: string;
  onPreview: (resolvedUrl: string, alt: string) => void;
}) {
  const source = asset.thumbnailUrl ?? asset.url;

  if (asset.type === "video") {
    return (
      <article
        className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm"
        data-task-detail-linked-asset="true"
        data-task-detail-asset-id={asset.id}
      >
        <ResolvedAssetVideo
          src={source}
          token={token}
          controls
          playsInline
          className="max-h-[min(65vh,640px)] min-h-56 w-full object-contain"
          fallback={
            <div
              className="flex min-h-56 items-center justify-center animate-pulse bg-slate-900 px-4 text-center text-xs text-slate-200"
              data-task-detail-video-fallback="true"
            >
              {alt}
            </div>
          }
        />
      </article>
    );
  }

  return (
    <article
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      data-task-detail-linked-asset="true"
      data-task-detail-asset-id={asset.id}
    >
      <button
        type="button"
        className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        data-task-detail-image-button="true"
        aria-label={alt}
      >
        <ResolvedAssetImage
          src={source}
          token={token}
          alt={alt}
          className="max-h-[min(65vh,640px)] min-h-56 w-full object-contain"
          onResolvedClick={(resolvedUrl) => onPreview(resolvedUrl, alt)}
          fallback={
            <div
              className="flex min-h-56 items-center justify-center animate-pulse bg-slate-50 px-4 text-center text-xs text-slate-500"
              data-task-detail-image-fallback="true"
            >
              {alt}
            </div>
          }
        />
      </button>
    </article>
  );
}

export function TaskDetailPageContent({
  taskId,
  initialToken,
  initialTask = null,
  initialAssets = [],
  initialModels = []
}: {
  taskId: string;
  initialToken?: string | null;
  initialTask?: AiTaskSummary | null;
  initialAssets?: AiAssetSummary[];
  initialModels?: AiModelSummary[];
}) {
  const { t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [hasCheckedToken, setHasCheckedToken] = useState(initialToken !== undefined);
  const [task, setTask] = useState<AiTaskSummary | null>(initialTask);
  const [assets, setAssets] = useState<AiAssetSummary[]>(initialAssets);
  const [models, setModels] = useState<AiModelSummary[]>(initialModels);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  useEffect(() => {
    const shellToken = workspaceShell?.shell?.token ?? null;
    const storedToken = initialToken ?? shellToken;
    setToken(storedToken);
    setHasCheckedToken(true);

    void loadModels();

    if (!storedToken || initialTask) {
      return;
    }

    async function load() {
      try {
        const response = await fetch(apiUrl(`/tasks/${taskId}`), {
          headers: { Authorization: `Bearer ${storedToken}` }
        });

        if (!response.ok) {
          throw new Error(t("multimodal.error.loadFailed"));
        }

        const data = (await response.json()) as AiTaskDetailResponse;
        setTask(data.task);
        setAssets(data.assets);
      } catch (loadError) {
        void loadError;
        setError(t("multimodal.error.loadFailed"));
      }
    }

    void load();
  }, [initialTask, initialToken, t, taskId]);

  async function loadModels() {
    try {
      const response = await fetch(apiUrl("/models?capability=image"));

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { models?: AiModelSummary[] };
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch {
      // Model labels are presentation-only; task detail loading should stay independent.
    }
  }

  const reuseParams = task ? getTaskReuseParams(task) : null;
  const modelLabel = task
    ? resolveTaskDetailModelLabel(task, models, t("multimodal.tasks.modelFallback"))
    : t("multimodal.tasks.modelFallback");

  async function copyPrompt() {
    if (!task) {
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }

      await navigator.clipboard.writeText(task.prompt);
      setCopyFeedback(t("multimodal.copyPromptSuccess"));
    } catch {
      setCopyFeedback(t("multimodal.copyPromptFailed"));
    }
  }

  async function copyReferenceFileName(name: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }

      await navigator.clipboard.writeText(name);
      setCopyFeedback(t("multimodal.copyFileNameSuccess"));
    } catch {
      setCopyFeedback(t("multimodal.copyPromptFailed"));
    }
  }

  const imageAssets = assets.filter((asset) => asset.type === "image");
  const videoAssets = assets.filter((asset) => asset.type === "video");
  const linkedAssets = [...imageAssets, ...videoAssets];
  const linkedAsset = linkedAssets[0] ?? null;

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6"
      data-task-detail-scroll-owner="true"
    >
      <MultimodalWorkspacePage
      icon={ListChecks}
      eyebrowKey="multimodal.tasks.eyebrow"
      titleKey="multimodal.taskDetail.title"
      descriptionKey="multimodal.taskDetail.description"
      hideMobileHeader
    >
      <div className="hidden flex-wrap gap-2 md:flex">
        <Link
          href="/tasks"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:text-indigo-700"
        >
          {t("multimodal.backToTasks")}
        </Link>
        <Link
          href="/assets"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:text-indigo-700"
        >
          {t("multimodal.backToAssets")}
        </Link>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!hasCheckedToken || token ? (
        task && reuseParams ? (
          <div className="flex flex-col gap-4" data-task-detail-content="true">
            <section className="grid gap-4" data-mobile-task-detail="true">
              <header className="flex min-h-11 items-center gap-2 md:hidden">
                <Link
                  href="/tasks"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm hover:text-indigo-700"
                  aria-label={t("multimodal.backToTasks")}
                >
                  <ChevronLeft className="size-5" aria-hidden="true" />
                </Link>
                <h1 className="min-w-0 flex-1 truncate text-base font-bold text-slate-950">
                  {t("multimodal.taskDetail.title")}
                </h1>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {t(`multimodal.status.${task.status}`)}
                </span>
              </header>

              {task.status === "succeeded" && linkedAssets.length > 0 ? (
                <section
                  className="grid gap-3"
                  data-desktop-task-detail-linked-assets="true"
                  data-mobile-task-detail-result="asset"
                  data-task-detail-result="asset"
                >
                  <h2 className="sr-only text-sm font-semibold text-slate-900 md:not-sr-only">
                    {t("multimodal.linkedAssets")}
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {linkedAssets.map((asset) => (
                      <TaskDetailLinkedAsset
                        key={asset.id}
                        asset={asset}
                        token={token}
                        alt={asset.title ?? t(`multimodal.asset.${asset.type}`)}
                        onPreview={(src, alt) => setPreviewImage({ src, alt })}
                      />
                    ))}
                  </div>
                </section>
              ) : task.status === "pending" || task.status === "running" ? (
                <section
                  className="flex min-h-24 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  data-mobile-task-detail-result="loading"
                  data-task-detail-result="loading"
                >
                  <div className="size-3 animate-pulse rounded-full bg-indigo-500" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-700">
                    {t(`multimodal.status.${task.status}`)}
                  </p>
                </section>
              ) : task.status === "failed" ? (
                <section
                  className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
                  data-mobile-task-detail-result="failed"
                  data-task-detail-result="failed"
                >
                  <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">{t("multimodal.failureReason")}</div>
                    <p className="mt-1 leading-6">{t("multimodal.error.generateFailed")}</p>
                  </div>
                </section>
              ) : (
                <section
                  className="flex min-h-24 items-center rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600 shadow-sm"
                  data-mobile-task-detail-result="unavailable"
                  data-task-detail-result="unavailable"
                >
                  {t("multimodal.resultUnavailable")}
                </section>
              )}

              {task.status === "succeeded" && linkedAsset ? (
                <section
                  className="flex"
                  data-mobile-task-detail-actions="true"
                  data-task-detail-actions="true"
                >
                  <Link
                    href={`/assets/${linkedAsset.id}`}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-center text-sm font-semibold text-slate-800 shadow-sm hover:text-indigo-700 md:w-auto"
                    data-task-view-artwork-details="true"
                  >
                    {t("multimodal.viewArtworkDetails")}
                  </Link>
                </section>
              ) : null}
            </section>

            <section
              className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4"
              data-task-detail-prompt-card="true"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("multimodal.prompt")}
                </h2>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-10 shrink-0 px-3 py-2 text-xs"
                  onClick={() => void copyPrompt()}
                  data-task-copy-prompt="true"
                >
                  {t("multimodal.copyPrompt")}
                </Button>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                {task.prompt}
              </p>
              {copyFeedback ? (
                <p className="mt-2 text-xs font-semibold text-emerald-700">
                  {copyFeedback}
                </p>
              ) : null}
            </section>

            <section
              className="grid gap-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
              data-task-detail-info-card="true"
            >
              <h2 className="text-sm font-semibold text-slate-900">
                {t("multimodal.taskInformation")}
              </h2>
              <dl
                className="grid grid-cols-2 gap-2 lg:grid-cols-4"
                data-mobile-task-detail-info-grid="true"
              >
                <DetailRow label={t("multimodal.type")} value={t(`multimodal.type.${task.type}`)} />
                <DetailRow
                  label={t("multimodal.mode")}
                  value={
                    task.type === "video"
                      ? t(
                          task.input.mode === "image-to-video"
                            ? "multimodal.video.imageToVideo"
                            : "multimodal.video.textToVideo"
                        )
                      : t(`multimodal.image.mode.${reuseParams.mode}`)
                  }
                />
                <DetailRow label={t("multimodal.model")} value={modelLabel} title={modelLabel} />
                <DetailRow label={t("multimodal.size")} value={reuseParams.size ?? "-"} />
                <DetailRow label={t("multimodal.count")} value={reuseParams.count} />
                <DetailRow
                  label={t("multimodal.status")}
                  value={t(`multimodal.status.${task.status}`)}
                />
                <DetailRow label={t("multimodal.createdAt")} value={formatDate(task.createdAt)} />
                <DetailRow label={t("multimodal.completedAt")} value={formatDate(task.completedAt)} />
              </dl>

              {reuseParams.referenceImages.length > 0 ? (
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t("multimodal.referenceImageMetadata")}
                  </h3>
                  <div className="mt-3 grid gap-3" data-reference-metadata-groups="true">
                  {reuseParams.referenceImages.map((reference, index) => (
                  <section key={`${reference.name ?? "reference"}-${index}`} className="rounded-xl border border-slate-200 p-3" data-reference-metadata-group={String(index)}>
                  <h4 className="mb-2 text-xs font-semibold text-slate-500">
                    {t("multimodal.image.referenceNumber", { index: index + 1 })}
                  </h4>
                  <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-reference-metadata-grid="true">
                    <DetailRow
                      label={t("multimodal.referenceImageName")}
                      title={reference.name ?? undefined}
                      value={
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 break-all">
                            {reference.name ?? "-"}
                          </span>
                          {reference.name ? (
                            <button
                              type="button"
                              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:text-indigo-700"
                              onClick={() =>
                                void copyReferenceFileName(reference.name ?? "")
                              }
                              aria-label={t("multimodal.copyFileName")}
                              title={t("multimodal.copyFileName")}
                            >
                              {t("multimodal.copyFileName")}
                            </button>
                          ) : null}
                        </span>
                      }
                    />
                    <DetailRow
                      label={t("multimodal.referenceImageMime")}
                      title={reference.mimeType ?? undefined}
                      value={
                        <span className="min-w-0 break-all">
                          {reference.mimeType ?? "-"}
                        </span>
                      }
                    />
                    <DetailRow
                      label={t("multimodal.referenceImageOriginalBytes")}
                      value={formatMetadataBytes(reference.originalBytes)}
                    />
                    <DetailRow
                      label={t("multimodal.referenceImageCompressedBytes")}
                      value={formatMetadataBytes(
                        reference.compressedBytes
                      )}
                    />
                  </dl>
                  </section>
                  ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        ) : (
          <section className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
            <div className="text-base font-semibold text-slate-900">
              {t("multimodal.taskDetail.notFoundTitle")}
            </div>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              {t("multimodal.taskDetail.notFoundDescription")}
            </p>
          </section>
        )
      ) : (
        <section className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
          <div className="text-base font-semibold text-slate-900">
            {t("multimodal.loginRequiredTitle")}
          </div>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            {t("multimodal.loginRequiredDescription")}
          </p>
        </section>
      )}
      {previewImage ? (
        <ImagePreviewDialog
          src={previewImage.src}
          alt={previewImage.alt}
          closeLabel={t("multimodal.image.closePreview")}
          zoomInLabel={t("multimodal.image.zoomIn")}
          zoomOutLabel={t("multimodal.image.zoomOut")}
          fitLabel={t("multimodal.image.fitPreview")}
          loadingLabel={t("multimodal.image.loadingPreview")}
          loadFailedLabel={t("multimodal.image.loadFailedPreview")}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
      </MultimodalWorkspacePage>
    </div>
  );
}
