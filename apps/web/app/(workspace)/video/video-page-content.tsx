"use client";

import type {
  AiAssetSummary,
  AiTaskDetailResponse,
  AiTaskSummary,
  ImageReferenceInput,
  PublicVideoModelSummary
} from "@ai-aggregate/shared";
import { Download, ImagePlus, LoaderCircle, Video } from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreationSurfaceSwitcher } from "../../../components/workspace/CreationSurfaceSwitcher";
import { MultimodalWorkspacePage } from "../../../components/workspace/MultimodalWorkspacePage";
import { ResolvedAssetVideo } from "../../../components/workspace/ResolvedAssetVideo";
import { Button } from "../../../components/workspace/ui";
import { useOptionalWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { fetchPrivateAssetBlob, isPrivateAssetContentUrl } from "../../../lib/private-asset-content";
import { apiUrl } from "../../../lib/site-config";

const VIDEO_TASK_STORAGE_KEY = "ai-aggregate:video-task:v1";
const VIDEO_REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_POLL_INTERVAL_MS = 1_500;

type VideoMode = "text-to-video" | "image-to-video";

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `video-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function readVideoProgress(task: AiTaskSummary | null): number | null {
  const value = task?.input.videoProgress;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function statusLabel(task: AiTaskSummary | null, t: (key: string) => string): string {
  if (!task) return t("multimodal.video.status.idle");
  return t(`multimodal.video.status.${task.status}`);
}

export function VideoPageContent() {
  const { t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const token = workspaceShell?.shell?.token ?? null;
  const [models, setModels] = useState<PublicVideoModelSummary[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [mode, setMode] = useState<VideoMode>("text-to-video");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [referenceImage, setReferenceImage] = useState<ImageReferenceInput | null>(null);
  const [task, setTask] = useState<AiTaskSummary | null>(null);
  const [assets, setAssets] = useState<AiAssetSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTask, setIsLoadingTask] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const pollingTaskIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);

  const selectedModel = useMemo(
    () => models.find((model) => model.slug === selectedModelId || model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );
  const compatibleModels = useMemo(
    () => models.filter((model) =>
      mode === "text-to-video"
        ? model.videoProfile.supportsTextToVideo
        : model.videoProfile.supportsImageToVideo
    ),
    [mode, models]
  );
  const videoAsset = assets.find((asset) => asset.type === "video") ?? null;
  const progress = readVideoProgress(task);

  const applyTaskDetail = useCallback((detail: AiTaskDetailResponse) => {
    setTask(detail.task);
    setAssets(Array.isArray(detail.assets) ? detail.assets : []);
    setIsLoadingTask(detail.task.status === "pending" || detail.task.status === "running");
    if (detail.task.status === "failed") {
      setError(detail.task.errorMessage || "Video generation failed.");
    } else if (detail.task.status === "succeeded") {
      setError(null);
    }
  }, []);

  const fetchTaskDetail = useCallback(async (taskId: string): Promise<AiTaskDetailResponse | null> => {
    if (!token) return null;
    const response = await fetch(apiUrl(`/tasks/${taskId}`), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<AiTaskDetailResponse>;
    return data.task && Array.isArray(data.assets)
      ? { task: data.task, assets: data.assets }
      : null;
  }, [token]);

  const observeTask = useCallback(async (taskId: string) => {
    if (!token || pollingTaskIdRef.current === taskId) return;
    pollingTaskIdRef.current = taskId;
    setIsLoadingTask(true);
    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const detail = await fetchTaskDetail(taskId);
        if (detail) {
          applyTaskDetail(detail);
          if (detail.task.status !== "pending" && detail.task.status !== "running") {
            return;
          }
        }
        await wait(VIDEO_POLL_INTERVAL_MS);
      }
    } catch {
      setError(t("multimodal.video.error.pollFailed"));
    } finally {
      if (pollingTaskIdRef.current === taskId) {
        pollingTaskIdRef.current = null;
      }
      setIsLoadingTask(false);
    }
  }, [applyTaskDetail, fetchTaskDetail, t, token]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(apiUrl("/models?capability=video&surface=video"), {
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("models unavailable");
        const data = (await response.json()) as { models?: PublicVideoModelSummary[] };
        const nextModels = Array.isArray(data.models) ? data.models : [];
        setModels(nextModels);
        setSelectedModelId((current) =>
          nextModels.some((model) => model.slug === current || model.id === current)
            ? current
            : nextModels[0]?.slug ?? ""
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t("multimodal.video.error.modelsFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelsLoaded(true);
      });
    return () => controller.abort();
  }, [t]);

  useEffect(() => {
    if (!compatibleModels.some((model) => model.slug === selectedModelId || model.id === selectedModelId)) {
      setSelectedModelId(compatibleModels[0]?.slug ?? "");
    }
  }, [compatibleModels, selectedModelId]);

  useEffect(() => {
    if (!token) return;
    let storedTaskId: string | null = null;
    try {
      storedTaskId = window.sessionStorage.getItem(`${VIDEO_TASK_STORAGE_KEY}:${token.slice(0, 12)}`);
    } catch {
      storedTaskId = null;
    }

    if (storedTaskId) {
      void observeTask(storedTaskId);
      return;
    }

    void fetch(apiUrl("/tasks?type=video&limit=10"), {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { tasks?: AiTaskSummary[] };
        const existing = data.tasks?.find(
          (candidate) => candidate.status === "pending" || candidate.status === "running"
        );
        if (existing) void observeTask(existing.id);
      })
      .catch(() => undefined);
  }, [observeTask, token]);

  useEffect(() => () => {
    pollingTaskIdRef.current = null;
  }, []);

  function storeTaskId(taskId: string) {
    if (!token) return;
    try {
      window.sessionStorage.setItem(`${VIDEO_TASK_STORAGE_KEY}:${token.slice(0, 12)}`, taskId);
    } catch {
      // Session storage is only a reload convenience; task polling still works.
    }
  }

  async function handleReferenceChange(file: File | undefined) {
    setError(null);
    if (!file) {
      setReferenceImage(null);
      return;
    }
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
      setError(t("multimodal.error.referenceImageUnsupported"));
      return;
    }
    if (file.size <= 0 || file.size > VIDEO_REFERENCE_MAX_BYTES) {
      setError(t("multimodal.error.referenceImageOriginalTooLarge"));
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read"));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });
      setReferenceImage({
        dataUrl,
        mimeType: file.type,
        name: file.name,
        originalBytes: file.size,
        compressedBytes: file.size
      });
    } catch {
      setError(t("multimodal.error.referenceImageReadFailed"));
    }
  }

  async function handleGenerate() {
    if (submitLockRef.current || !token) {
      if (!token) setError(t("multimodal.error.loginRequired"));
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError(t("multimodal.error.promptRequired"));
      return;
    }
    if (!selectedModel || !compatibleModels.some((model) => model.slug === selectedModel.slug)) {
      setError(t("multimodal.video.error.modelUnavailable"));
      return;
    }
    if (mode === "image-to-video" && !referenceImage) {
      setError(t("multimodal.error.referenceImageRequired"));
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setTask(null);
    setAssets([]);
    try {
      const response = await fetch(apiUrl("/video/generate"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey()
        },
        body: JSON.stringify({
          modelId: selectedModel.slug,
          mode,
          prompt: trimmedPrompt,
          ...(referenceImage ? { referenceImage } : {})
        })
      });
      const data = (await response.json().catch(() => ({}))) as {
        taskId?: string;
        task?: AiTaskSummary;
        assets?: AiAssetSummary[];
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || t("multimodal.video.error.generateFailed"));
      }
      if (data.task && Array.isArray(data.assets)) {
        applyTaskDetail({ task: data.task, assets: data.assets });
      }
      if (!data.taskId) {
        if (data.task?.id) {
          storeTaskId(data.task.id);
          void observeTask(data.task.id);
        } else {
          throw new Error(t("multimodal.video.error.generateFailed"));
        }
      } else {
        storeTaskId(data.taskId);
        void observeTask(data.taskId);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("multimodal.video.error.generateFailed"));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function downloadVideo() {
    if (!token || !videoAsset || isDownloading || !isPrivateAssetContentUrl(videoAsset.url)) return;
    setIsDownloading(true);
    try {
      const blob = await fetchPrivateAssetBlob({ logicalUrl: videoAsset.url, token });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `video-${videoAsset.id}.mp4`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("multimodal.video.error.downloadFailed"));
    } finally {
      setIsDownloading(false);
    }
  }

  const effectiveProfile = selectedModel?.videoProfile;
  const canGenerate = Boolean(token && selectedModel && prompt.trim() && !isSubmitting && !isLoadingTask);

  return (
    <>
      <header
        className="relative z-30 shrink-0 bg-white px-3 pb-2 pt-3 dark:bg-slate-950 md:hidden"
        data-video-mobile-creation-header="true"
      >
        <CreationSurfaceSwitcher activeSurface="video" />
      </header>
      <MultimodalWorkspacePage
        icon={Video}
        eyebrowKey="multimodal.video.eyebrow"
        titleKey="multimodal.video.title"
        descriptionKey="multimodal.video.description"
        hideMobileHeader
        className="pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {!token ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-950 dark:text-slate-100">{t("multimodal.loginRequiredTitle")}</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("multimodal.loginRequiredDescription")}</p>
        </section>
      ) : !modelsLoaded ? (
        <section className="flex min-h-56 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <LoaderCircle className="size-5 animate-spin text-indigo-600" aria-label={t("multimodal.assets.loadingAssets")} />
        </section>
      ) : models.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
          <Video className="mx-auto size-8 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-slate-950 dark:text-slate-100">{t("multimodal.video.noModels")}</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("multimodal.video.noModelsDescription")}</p>
        </section>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-5">
          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
            <div className="grid min-w-0 gap-4">
              <div className="grid min-w-0 gap-2">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t("multimodal.video.mode")}</span>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2" role="group" aria-label={t("multimodal.video.mode")}>
                  {(["text-to-video", "image-to-video"] as const).map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      className={mode === candidate
                        ? "min-h-11 rounded-xl border border-indigo-300 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                        : "min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"}
                      aria-pressed={mode === candidate}
                      onClick={() => setMode(candidate)}
                    >
                      {candidate === "text-to-video" ? t("multimodal.video.textToVideo") : t("multimodal.video.imageToVideo")}
                    </button>
                  ))}
                </div>
              </div>

              <label className="grid min-w-0 gap-2">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t("multimodal.model")}</span>
                <select
                  className="h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  value={selectedModelId}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {compatibleModels.map((model) => (
                    <option key={model.id} value={model.slug}>{model.displayName ?? model.name}</option>
                  ))}
                </select>
                {effectiveProfile ? (
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {effectiveProfile.durationSeconds}s
                    {effectiveProfile.resolution
                      ? ` · ${effectiveProfile.resolution}`
                      : ""} · {effectiveProfile.aspectRatio}
                  </span>
                ) : null}
              </label>

              <label className="grid min-w-0 gap-2">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t("multimodal.prompt")}</span>
                <textarea
                  className="min-h-32 w-full min-w-0 resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={t("multimodal.video.promptPlaceholder")}
                  maxLength={4000}
                />
              </label>

              {mode === "image-to-video" ? (
                <label className="grid min-w-0 gap-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-600">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    <ImagePlus className="size-4 text-indigo-600" aria-hidden="true" />
                    {t("multimodal.video.referenceImage")}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="min-w-0 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-semibold file:text-indigo-700"
                    onChange={(event) => void handleReferenceChange(event.target.files?.[0])}
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">{referenceImage?.name ?? t("multimodal.video.referenceRequired")}</span>
                </label>
              ) : null}

              <Button type="button" onClick={() => void handleGenerate()} disabled={!canGenerate} className="min-h-12 w-full sm:w-auto">
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Video className="size-4" aria-hidden="true" />}
                {t("multimodal.video.generate")}
              </Button>
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5" aria-live="polite">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{t("multimodal.video.resultEyebrow")}</div>
                <h2 className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">{statusLabel(task, t)}</h2>
              </div>
              {task ? <span className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">{task.status}</span> : null}
            </div>
            {task && (task.status === "pending" || task.status === "running") ? (
              <div className="mt-5 grid gap-2">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${progress ?? 12}%` }} />
                </div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {progress === null ? t("multimodal.video.progressWorking") : `${progress}%`}
                </p>
              </div>
            ) : null}
            {videoAsset ? (
              <div className="mt-5 min-w-0 overflow-hidden rounded-xl bg-slate-950">
                <ResolvedAssetVideo
                  src={videoAsset.url}
                  token={token}
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-video h-auto max-h-[min(62vh,640px)] w-full object-contain"
                  fallback={<div className="flex aspect-video items-center justify-center text-sm text-slate-400">{t("multimodal.video.loadingPreview")}</div>}
                />
              </div>
            ) : task?.status === "succeeded" ? (
              <div className="mt-5 flex aspect-video items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t("multimodal.video.previewUnavailable")}</div>
            ) : (
              <div className="mt-5 flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-300 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{t("multimodal.video.emptyDescription")}</div>
            )}
            {videoAsset ? (
              <div className="mt-4 flex min-w-0 flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => void downloadVideo()} disabled={isDownloading}>
                  <Download className="size-4" aria-hidden="true" />
                  {isDownloading ? t("multimodal.video.downloading") : t("multimodal.download")}
                </Button>
                <Link href={`/assets/${videoAsset.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  {t("multimodal.video.openAsset")}
                </Link>
                {task ? <Link href={`/tasks/${task.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">{t("multimodal.video.openTask")}</Link> : null}
              </div>
            ) : null}
          </section>
        </div>
        )}
      </MultimodalWorkspacePage>
    </>
  );
}
