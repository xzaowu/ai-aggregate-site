"use client";

import {
  getModelDisplayName,
  type AiModelSummary,
  type AiTaskSummary
} from "@ai-aggregate/shared";
import { ChevronLeft, ChevronRight, ImageIcon, ListChecks, RefreshCw } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LazyResolvedAssetImage,
  ResolvedAssetImage
} from "../../../components/workspace/ResolvedAssetImage";
import { ResolvedAssetVideo } from "../../../components/workspace/ResolvedAssetVideo";
import { MobileWorksSwitcher } from "../../../components/workspace/MobileWorksSwitcher";
import { Badge } from "../../../components/workspace/ui";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../lib/site-config";
import {
  isAbortError,
  isPrivateAssetContentUrl
} from "../../../lib/private-asset-content";
import { useOptionalWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";
import { useResponsiveWorkspaceMode } from "../../../hooks/use-responsive-workspace-mode";
import { getTaskReuseParams } from "../../multimodal-reuse";
type TaskFilter = "all" | "succeeded" | "failed" | "generating" | "text-to-image" | "image-to-image";
type MobileTaskStatusFilter = "all" | "generating" | "succeeded" | "failed";

const taskFilters: Array<{ key: TaskFilter; labelKey: string }> = [
  { key: "all", labelKey: "multimodal.filter.all" },
  { key: "succeeded", labelKey: "multimodal.filter.succeeded" },
  { key: "failed", labelKey: "multimodal.filter.failed" },
  { key: "generating", labelKey: "multimodal.filter.generating" },
  { key: "text-to-image", labelKey: "multimodal.filter.textToImage" },
  { key: "image-to-image", labelKey: "multimodal.filter.imageToImage" }
];

type TaskSort = "newest" | "oldest";
type TaskStats = {
  total: number;
  succeeded: number;
  generating: number;
  failed: number;
};

export type TaskViewportMode = "desktop" | "mobile";

export const adaptiveTaskPageSizeConfig = {
  desktop: { min: 3, max: 8, fallback: 4, cardHeight: 116, gap: 12 },
  mobile: { min: 2, max: 6, fallback: 3, cardHeight: 104, gap: 12 }
} as const;

export function getTaskPageSizeFallback(mode: TaskViewportMode): number {
  return adaptiveTaskPageSizeConfig[mode].fallback;
}

export function getAdaptiveTaskPageSize(
  availableHeight: number | null | undefined,
  mode: TaskViewportMode
): number {
  const config = adaptiveTaskPageSizeConfig[mode];

  if (!availableHeight || !Number.isFinite(availableHeight) || availableHeight <= 0) {
    return config.fallback;
  }

  const visibleCards = Math.floor((availableHeight + config.gap) / (config.cardHeight + config.gap));
  return Math.min(config.max, Math.max(config.min, visibleCards));
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function promptPreview(prompt: string): string {
  return prompt.length > 96 ? `${prompt.slice(0, 96)}...` : prompt;
}

function isGeneratingStatus(status: AiTaskSummary["status"]): boolean {
  return status === "pending" || status === "running";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export function getTaskPreviewImage(task: AiTaskSummary): string | null {
  const output = task.output ?? {};
  const images = readStringArray(output.images);
  if (images[0] && isPrivateAssetContentUrl(images[0])) {
    return images[0];
  }

  return typeof output.imageUrl === "string" && isPrivateAssetContentUrl(output.imageUrl)
    ? output.imageUrl
    : null;
}

export function getSafeTaskPreviewImage(task: AiTaskSummary): string | null {
  return getTaskPreviewImage(task);
}

export function getTaskPreviewVideo(task: AiTaskSummary): string | null {
  if (task.type !== "video") return null;
  const output = task.output ?? {};
  const videos = readStringArray(output.videos);
  if (videos[0] && isPrivateAssetContentUrl(videos[0])) {
    return videos[0];
  }

  return typeof output.videoUrl === "string" && isPrivateAssetContentUrl(output.videoUrl)
    ? output.videoUrl
    : null;
}

export function getTaskImageCount(task: AiTaskSummary): number | null {
  const outputCount = task.output?.count;
  if (typeof outputCount === "number" && Number.isInteger(outputCount) && outputCount > 0) {
    return outputCount;
  }

  const outputImages = task.output?.images;
  if (Array.isArray(outputImages)) {
    const count = outputImages.filter(
      (image): image is string => typeof image === "string" && image.trim().length > 0
    ).length;
    return count > 0 ? count : null;
  }

  return null;
}

function filterMobileTasks(
  tasks: AiTaskSummary[],
  filter: MobileTaskStatusFilter
): AiTaskSummary[] {
  return sortTasks(
    tasks.filter((task) => {
      if (filter === "all") return true;
      if (filter === "generating") return isGeneratingStatus(task.status);
      return task.status === filter;
    }),
    "newest"
  );
}

export function getTaskGeneratedSize(task: AiTaskSummary): string | null {
  if (typeof task.input.size === "string" && task.input.size.length > 0) {
    return task.input.size;
  }

  if (typeof task.output?.size === "string" && task.output.size.length > 0) {
    return task.output.size;
  }

  return null;
}

export function getDefaultSelectedTaskId(tasks: AiTaskSummary[]): string | null {
  return sortTasksByNewest(tasks)[0]?.id ?? null;
}

export function sortTasks(tasks: AiTaskSummary[], sort: TaskSort): AiTaskSummary[] {
  return [...tasks].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return sort === "oldest" ? diff : -diff;
  });
}

function sortTasksByNewest(tasks: AiTaskSummary[]): AiTaskSummary[] {
  return sortTasks(tasks, "newest");
}

export function filterTasks(
  tasks: AiTaskSummary[],
  filter: TaskFilter,
  sort: TaskSort = "newest"
): AiTaskSummary[] {
  return sortTasks(
    tasks.filter((task) => {
      if (filter === "all") return true;
      if (filter === "generating") {
        return isGeneratingStatus(task.status);
      }
      if (filter === "succeeded" || filter === "failed") {
        return task.status === filter;
      }

      return getTaskReuseParams(task).mode === filter;
    }),
    sort
  );
}

export function selectTaskForPanel(
  tasks: AiTaskSummary[],
  selectedTaskId: string | null
): AiTaskSummary | null {
  if (tasks.length === 0) {
    return null;
  }

  return tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;
}

export function getTaskTotalPages(
  totalTasks: number,
  pageSize: number = adaptiveTaskPageSizeConfig.desktop.fallback
): number {
  return Math.max(1, Math.ceil(totalTasks / pageSize));
}

export function clampTaskPage(
  page: number,
  totalTasks: number,
  pageSize: number = adaptiveTaskPageSizeConfig.desktop.fallback
): number {
  const totalPages = getTaskTotalPages(totalTasks, pageSize);
  return Math.min(Math.max(1, page), totalPages);
}

export function paginateTasks(
  tasks: AiTaskSummary[],
  page: number,
  pageSize: number = adaptiveTaskPageSizeConfig.desktop.fallback
): AiTaskSummary[] {
  const safePage = clampTaskPage(page, tasks.length, pageSize);
  const start = (safePage - 1) * pageSize;
  return tasks.slice(start, start + pageSize);
}

export function getTaskPageAfterDelta(
  currentPage: number,
  totalTasks: number,
  delta: number,
  pageSize: number = adaptiveTaskPageSizeConfig.desktop.fallback
): number {
  return clampTaskPage(currentPage + delta, totalTasks, pageSize);
}

export function getTaskStats(tasks: AiTaskSummary[]): TaskStats {
  return tasks.reduce<TaskStats>(
    (stats, task) => ({
      total: stats.total + 1,
      succeeded: stats.succeeded + (task.status === "succeeded" ? 1 : 0),
      generating: stats.generating + (isGeneratingStatus(task.status) ? 1 : 0),
      failed: stats.failed + (task.status === "failed" ? 1 : 0)
    }),
    { total: 0, succeeded: 0, generating: 0, failed: 0 }
  );
}

export function resolveTaskModelLabel(
  task: AiTaskSummary,
  models: AiModelSummary[],
  fallbackLabel: string
): string {
  const rawModelId = getTaskReuseParams(task).modelId ?? task.modelId;
  const matchedModel = models.find(
    (model) => model.modelId === rawModelId || model.id === rawModelId
  );

  if (matchedModel) {
    return getModelDisplayName(matchedModel);
  }

  if (!rawModelId) {
    return fallbackLabel;
  }

  return fallbackLabel;
}

export function TasksPageContent({
  initialToken,
  initialTasks = [],
  initialModels = []
}: {
  initialToken?: string | null;
  initialTasks?: AiTaskSummary[];
  initialModels?: AiModelSummary[];
}) {
  const { t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const viewportMode = useResponsiveWorkspaceMode();
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [hasCheckedToken, setHasCheckedToken] = useState(initialToken !== undefined);
  const [tasks, setTasks] = useState<AiTaskSummary[]>(initialTasks);
  const [models, setModels] = useState<AiModelSummary[]>(initialModels);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [sort, setSort] = useState<TaskSort>("newest");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    getDefaultSelectedTaskId(initialTasks)
  );
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(
    initialTasks.length === 0
  );
  const [taskPageSize, setTaskPageSize] = useState(() => getTaskPageSizeFallback("desktop"));
  const [taskViewportMode, setTaskViewportMode] = useState<TaskViewportMode>("desktop");
  const taskListMeasureRef = useRef<HTMLDivElement | null>(null);
  const taskRequestSeqRef = useRef(0);
  const taskRequestAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const shellToken = workspaceShell?.shell?.token ?? null;
    const storedToken = initialToken ?? shellToken;
    setToken(storedToken);
    setHasCheckedToken(true);

    void loadModels();

    if (storedToken) {
      void loadTasks(storedToken);
    } else {
      setIsInitialLoading(false);
    }
  }, [initialToken, t]);

  useEffect(() => () => {
    taskRequestSeqRef.current += 1;
    taskRequestAbortRef.current?.abort();
  }, []);

  async function loadModels() {
    try {
      const response = await fetch(apiUrl("/models?capability=image"));

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { models?: AiModelSummary[] };
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch {
      // Model names are display-only on this page; keep task loading independent.
    }
  }

  async function loadTasks(authToken: string) {
    taskRequestAbortRef.current?.abort();
    const requestId = taskRequestSeqRef.current + 1;
    taskRequestSeqRef.current = requestId;
    const abortController = new AbortController();
    taskRequestAbortRef.current = abortController;
    setIsRefreshing(true);
    try {
      const response = await fetch(apiUrl("/tasks?limit=50"), {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(t("multimodal.error.loadFailed"));
      }

      const data = (await response.json()) as { tasks: AiTaskSummary[] };
      if (taskRequestSeqRef.current !== requestId) {
        return;
      }
      setTasks(data.tasks);
      setSelectedTaskId((current) => current ?? getDefaultSelectedTaskId(data.tasks));
      setError(null);
    } catch (loadError) {
      if (taskRequestSeqRef.current !== requestId || isAbortError(loadError)) {
        return;
      }
      setError(t("multimodal.error.loadFailed"));
    } finally {
      if (taskRequestSeqRef.current !== requestId) {
        return;
      }
      setIsRefreshing(false);
      setIsInitialLoading(false);
    }
  }

  async function refreshTasks() {
    if (!token) {
      setError(t("multimodal.error.loginRequired"));
      return;
    }

    await loadTasks(token);
  }

  const filteredTasks = useMemo(
    () => filterTasks(tasks, filter, sort),
    [filter, sort, tasks]
  );
  const [mobileStatusFilter, setMobileStatusFilter] = useState<MobileTaskStatusFilter>("all");
  const mobileTasks = useMemo(
    () => filterMobileTasks(tasks, mobileStatusFilter),
    [mobileStatusFilter, tasks]
  );
  const [taskPage, setTaskPage] = useState(1);
  const totalTaskPages = getTaskTotalPages(filteredTasks.length, taskPageSize);
  const currentTaskPage = clampTaskPage(taskPage, filteredTasks.length, taskPageSize);
  const pageTasks = useMemo(
    () => paginateTasks(filteredTasks, currentTaskPage, taskPageSize),
    [currentTaskPage, filteredTasks, taskPageSize]
  );
  const selectedTask = selectTaskForPanel(pageTasks, selectedTaskId);
  const stats = useMemo(() => getTaskStats(tasks), [tasks]);
  const statsCards = [
    { key: "total", label: t("multimodal.tasks.stats.total"), value: stats.total },
    { key: "succeeded", label: t("multimodal.tasks.stats.succeeded"), value: stats.succeeded },
    { key: "generating", label: t("multimodal.tasks.stats.generating"), value: stats.generating },
    { key: "failed", label: t("multimodal.tasks.stats.failed"), value: stats.failed }
  ];

  useEffect(() => {
    setTaskPage(1);
  }, [filter, sort]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const getMode = (): TaskViewportMode => (window.innerWidth < 768 ? "mobile" : "desktop");
    const updatePageSize = () => {
      const mode = getMode();
      const nextPageSize = getAdaptiveTaskPageSize(
        taskListMeasureRef.current?.getBoundingClientRect().height,
        mode
      );

      setTaskViewportMode(mode);
      setTaskPageSize(nextPageSize);
    };

    updatePageSize();
    window.addEventListener("resize", updatePageSize);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => updatePageSize());

    if (taskListMeasureRef.current && observer) {
      observer.observe(taskListMeasureRef.current);
    }

    return () => {
      window.removeEventListener("resize", updatePageSize);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (taskPage !== currentTaskPage) {
      setTaskPage(currentTaskPage);
    }
  }, [currentTaskPage, taskPage]);

  useEffect(() => {
    const firstPageTask = pageTasks[0];

    if (!firstPageTask) {
      setSelectedTaskId(null);
      return;
    }

    if (!selectedTaskId || !pageTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(firstPageTask.id);
    }
  }, [pageTasks, selectedTaskId]);

  function selectTaskPage(nextPage: number) {
    const safePage = clampTaskPage(nextPage, filteredTasks.length, taskPageSize);
    const nextPageTasks = paginateTasks(filteredTasks, safePage, taskPageSize);

    setTaskPage(safePage);
    setSelectedTaskId(nextPageTasks[0]?.id ?? null);
  }

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto px-3 py-3 pb-6 md:overflow-hidden sm:px-5 lg:px-6"
      data-tasks-workspace-root="full-width"
      data-tasks-overflow-root="mobile:overflow-y-auto md:overflow-hidden"
      data-mobile-tasks-scroll-owner="true"
    >
      {viewportMode !== "desktop" ? <div className="flex min-w-0 flex-col gap-4" data-mobile-works-tasks="true">
        <MobileWorksSwitcher active="tasks" />
        <div
          className="flex min-w-0 gap-2 overflow-x-auto pb-1"
          data-mobile-task-status-filters="true"
          aria-label={t("multimodal.tasks.filters")}
        >
          {([
            ["all", t("multimodal.filter.all")],
            ["generating", t("multimodal.mobileWorks.statusGenerating")],
            ["succeeded", t("multimodal.mobileWorks.statusSucceeded")],
            ["failed", t("multimodal.mobileWorks.statusFailed")]
          ] as Array<[MobileTaskStatusFilter, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={
                mobileStatusFilter === key
                  ? "min-h-10 shrink-0 rounded-full border border-indigo-100 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700"
                  : "min-h-10 shrink-0 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600"
              }
              aria-pressed={mobileStatusFilter === key}
              data-mobile-task-status-filter={key}
              onClick={() => setMobileStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700" role="alert">
            <p>{t("multimodal.assets.loadFailedShort")}</p>
            <button
              type="button"
              className="mt-2 font-semibold text-red-800 underline underline-offset-2"
              onClick={() => token && void loadTasks(token)}
              disabled={!token || isRefreshing}
            >
              {t("multimodal.mobileWorks.retry")}
            </button>
          </div>
        ) : null}

        {isInitialLoading ? (
          <div className="grid gap-3" data-mobile-tasks-loading="true">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex h-32 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="size-24 shrink-0 animate-pulse rounded-xl bg-slate-100" />
                <div className="min-w-0 flex-1">
                  <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
                  <div className="mt-3 h-4 animate-pulse rounded bg-slate-100" />
                  <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : mobileTasks.length > 0 ? (
          <div className="grid gap-3 pb-2" data-mobile-task-list="true">
            {mobileTasks.map((task) => (
              <MobileTaskCard
                key={task.id}
                task={task}
                token={token}
                modelLabel={getMobileTaskModelLabel(task, models)}
                t={t}
              />
            ))}
          </div>
        ) : (
          <section className="flex min-h-72 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm" data-mobile-tasks-empty="true">
            <div className="max-w-xs">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <ListChecks className="size-6" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-950">
                {hasCheckedToken && token ? t("multimodal.tasks.emptyTitle") : t("multimodal.loginRequiredTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {hasCheckedToken && token ? t("multimodal.tasks.emptyDescription") : t("multimodal.loginRequiredDescription")}
              </p>
              {hasCheckedToken && token ? (
                <Link href="/image" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white">
                  {t("multimodal.mobileWorks.startCreating")}
                </Link>
              ) : null}
            </div>
          </section>
        )}
      </div> : null}

      {viewportMode === "desktop" ? <div className="min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-slate-200 dark:border-slate-700 pb-3" data-tasks-compact-header="true">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-normal text-indigo-600 dark:text-indigo-400">
              {t("multimodal.tasks.eyebrow")}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-100">
              {t("multimodal.tasks.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              {t("multimodal.tasks.description")}
            </p>
          </div>
        </div>

        <div
          className="mt-4 hidden grid-cols-4 gap-3 lg:grid"
          data-tasks-stats-cards="desktop"
        >
          {statsCards.map((card) => (
            <div
              key={card.key}
              className="min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 shadow-sm dark:shadow-none"
              data-tasks-stat-card={card.key}
            >
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{card.label}</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-100">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="flex min-w-0 flex-wrap gap-2"
            data-tasks-filter-chips="true"
            data-tasks-mobile-no-horizontal-scroll="true"
            aria-label={t("multimodal.tasks.filters")}
          >
            {taskFilters.map((item) => (
              <button
                key={item.key}
                type="button"
                className={
                  filter === item.key
                    ? "shrink-0 rounded-full border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-400"
                    : "shrink-0 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 transition hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-400"
                }
                data-task-filter-chip={item.key}
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2" data-tasks-sort-refresh="true">
            <label className="sr-only" htmlFor="tasks-sort">
              {t("multimodal.tasks.sort.label")}
            </label>
            <select
              id="tasks-sort"
              className="h-9 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-700 dark:text-slate-100 shadow-sm dark:shadow-none"
              value={sort}
              data-tasks-sort-control="true"
              onChange={(event) => setSort(event.target.value as TaskSort)}
            >
              <option value="newest">{t("multimodal.tasks.sort.newest")}</option>
              <option value="oldest">{t("multimodal.tasks.sort.oldest")}</option>
            </select>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-700 dark:text-slate-100 shadow-sm dark:shadow-none transition hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-400 disabled:opacity-60"
              data-tasks-refresh-button="true"
              data-tasks-refresh-load="/tasks"
              onClick={() => void refreshTasks()}
              disabled={isRefreshing}
              aria-busy={isRefreshing}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t("multimodal.tasks.refresh")}
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <p className="mt-3 shrink-0 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <main
        className="mt-3 flex min-h-0 flex-1 gap-4 overflow-hidden"
        data-tasks-content-layout="desktop-list-detail"
        data-tasks-content-min-height="min-h-0"
        data-tasks-mobile-detail-panel="absent"
      >
        {isInitialLoading ? (
          <div
            className="flex min-h-0 flex-1 items-center justify-center px-4 py-12"
            data-tasks-loading-state="true"
          >
            <div className="w-full max-w-md text-center">
              <div className="mx-auto h-14 w-14 animate-pulse rounded-2xl bg-indigo-100 dark:bg-indigo-950/50" />
              <h3 className="mt-5 text-xl font-semibold text-slate-950 dark:text-slate-100">
                {t("multimodal.tasks.loadingTasks")}
              </h3>
            </div>
          </div>
        ) : filteredTasks.length > 0 ? (
          <>
            <section
              className="flex min-h-0 flex-1 flex-col overflow-hidden pr-0 lg:max-w-[430px] lg:shrink-0 lg:pr-1 xl:max-w-[460px]"
              data-tasks-list-region="adaptive-pagination"
              data-tasks-list-height-constraint="min-h-0 overflow-hidden"
              data-tasks-mobile-card-list="true"
              data-tasks-adaptive-page-size={String(taskPageSize)}
              data-tasks-adaptive-mode={taskViewportMode}
            >
              <div
                ref={taskListMeasureRef}
                className="grid min-h-0 flex-1 auto-rows-[104px] gap-3 overflow-hidden lg:auto-rows-[116px]"
                data-tasks-current-page-list="true"
                data-tasks-current-page-size={String(pageTasks.length)}
                data-tasks-adaptive-page-size-helper="true"
                data-tasks-list-overflow="hidden"
                data-tasks-mobile-single-column="true"
              >
                {pageTasks.map((task) => (
                  <TaskListItem
                    key={task.id}
                    task={task}
                    token={token}
                    selected={selectedTask?.id === task.id}
                    modelLabel={resolveTaskModelLabel(
                      task,
                      models,
                      t("multimodal.tasks.modelFallback")
                    )}
                    onSelect={() => setSelectedTaskId(task.id)}
                  />
                ))}
              </div>
              <TaskPagination
                currentPage={currentTaskPage}
                totalPages={totalTaskPages}
                totalTasks={filteredTasks.length}
                onPrevious={() =>
                  selectTaskPage(
                    getTaskPageAfterDelta(currentTaskPage, filteredTasks.length, -1, taskPageSize)
                  )
                }
                onNext={() =>
                  selectTaskPage(
                    getTaskPageAfterDelta(currentTaskPage, filteredTasks.length, 1, taskPageSize)
                  )
                }
              />
            </section>
            <aside
              className="hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm dark:shadow-none lg:block"
              data-tasks-detail-panel="preview"
              data-tasks-detail-scroll="false"
              data-tasks-detail-overflow="hidden"
            >
              <TaskDetailPanel task={selectedTask} models={models} token={token} />
            </aside>
          </>
        ) : (
          <EmptyTasksState hasToken={!hasCheckedToken || Boolean(token)} />
        )}
      </main>
      </div> : null}
    </div>
  );
}

function getMobileTaskModelLabel(task: AiTaskSummary, models: AiModelSummary[]): string | null {
  const rawModelId = getTaskReuseParams(task).modelId ?? task.modelId;
  if (!rawModelId) return null;
  const matchedModel = models.find(
    (model) => model.modelId === rawModelId || model.id === rawModelId
  );
  return matchedModel ? getModelDisplayName(matchedModel) : null;
}

function MobileTaskCard({
  task,
  token,
  modelLabel,
  t
}: {
  task: AiTaskSummary;
  token: string | null;
  modelLabel: string | null;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const previewImage = getSafeTaskPreviewImage(task);
  const previewVideo = getTaskPreviewVideo(task);
  const status = isGeneratingStatus(task.status)
    ? "generating"
    : task.status;
  const count = getTaskImageCount(task);
  const statusLabel =
    status === "generating"
      ? t("multimodal.mobileWorks.statusGenerating")
      : status === "succeeded"
        ? t("multimodal.mobileWorks.statusSucceeded")
        : status === "failed"
          ? t("multimodal.mobileWorks.statusFailed")
          : t("multimodal.mobileWorks.statusCancelled");

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex min-w-0 min-h-32 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-200"
      data-mobile-task-card="true"
      data-task-id={task.id}
    >
      <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
        {previewVideo ? (
          <ResolvedAssetVideo
            src={previewVideo}
            token={token}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            fallback={<div className="size-full animate-pulse bg-slate-200" data-task-thumbnail-loading="true" />}
          />
        ) : previewImage ? (
          <LazyResolvedAssetImage
            src={previewImage}
            token={token}
            alt={t("multimodal.tasks.previewAlt")}
            containerClassName="h-full w-full"
            className="h-full w-full object-contain"
            fallback={<div className="size-full animate-pulse bg-slate-200" data-task-thumbnail-loading="true" />}
          />
        ) : (
          <div className="grid justify-items-center gap-1 px-2 text-center text-slate-400">
            <ImageIcon className="size-6" aria-hidden="true" />
            <span className="text-[11px] font-medium">{status === "failed" ? t("multimodal.mobileWorks.generationFailed") : t("multimodal.mobileWorks.noPreview")}</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <TaskStatusBadge status={status}>{statusLabel}</TaskStatusBadge>
        </div>
        <p className="mt-2 line-clamp-2 break-words text-[15px] font-semibold leading-5 text-slate-950">
          {promptPreview(task.prompt)}
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500">
          {modelLabel ? <span className="max-w-full truncate">{modelLabel}</span> : null}
          {count ? <span>{t("multimodal.mobileWorks.imageCount", { count: String(count) })}</span> : null}
          <time dateTime={task.createdAt}>{formatDate(task.createdAt)}</time>
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
    </Link>
  );
}

function TaskListItem({
  task,
  token,
  selected,
  modelLabel,
  onSelect
}: {
  task: AiTaskSummary;
  token: string | null;
  selected: boolean;
  modelLabel: string;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const taskMode = getTaskReuseParams(task).mode;
  const previewImage = getTaskPreviewImage(task);
  const previewVideo = getTaskPreviewVideo(task);
  const status = isGeneratingStatus(task.status) ? "generating" : task.status;

  return (
    <button
      type="button"
      className={
        selected
          ? "h-full w-full overflow-hidden rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50/80 dark:bg-indigo-950/30 p-2.5 text-left shadow-sm dark:shadow-none outline-none ring-2 ring-indigo-100 dark:ring-indigo-900 sm:p-3"
          : "h-full w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-left shadow-sm dark:shadow-none transition hover:border-indigo-200 dark:hover:border-indigo-700 hover:bg-slate-50 dark:hover:bg-slate-800 focus:border-indigo-300 dark:focus:border-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 sm:p-3"
      }
      data-task-card="true"
      data-task-card-clickable="button"
      data-task-card-height="stable"
      data-task-card-selected={selected ? "true" : "false"}
      data-task-id={task.id}
      onClick={onSelect}
    >
      <div className="grid h-full min-w-0 grid-cols-[72px_minmax(0,1fr)_auto] gap-3 sm:grid-cols-[88px_minmax(0,1fr)_auto]">
        <TaskThumbnail imageUrl={previewImage} videoUrl={previewVideo} token={token} />
        <div className="min-w-0 overflow-hidden">
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <TaskStatusBadge status={status}>
              {isGeneratingStatus(task.status)
                ? t("multimodal.filter.generating")
                : t(`multimodal.status.${task.status}`)}
            </TaskStatusBadge>
            <Badge tone={task.type === "video" && task.input.mode === "image-to-video" ? "indigo" : "slate"}>
              {task.type === "video"
                ? t(
                    task.input.mode === "image-to-video"
                      ? "multimodal.video.imageToVideo"
                      : "multimodal.video.textToVideo"
                  )
                : t(`multimodal.image.mode.${taskMode}`)}
            </Badge>
            <span className="hidden max-w-[140px] truncate text-xs font-medium text-slate-500 dark:text-slate-400 sm:inline" title={modelLabel}>
              {modelLabel}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100" data-task-card-prompt-clamp="2">
            {promptPreview(task.prompt)}
          </p>
          <div className="mt-1.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
            {formatDate(task.createdAt)}
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      </div>
    </button>
  );
}

function TaskDetailPanel({
  task,
  models,
  token
}: {
  task: AiTaskSummary | null;
  models: AiModelSummary[];
  token: string | null;
}) {
  const { t } = useI18n();

  if (!task) {
    return null;
  }

  const previewImage = getTaskPreviewImage(task);
  const previewVideo = getTaskPreviewVideo(task);
  const status = isGeneratingStatus(task.status) ? "generating" : task.status;
  const generatedSize = getTaskGeneratedSize(task);
  const modelLabel = resolveTaskModelLabel(
    task,
    models,
    t("multimodal.tasks.modelFallback")
  );

  const isGenerating = isGeneratingStatus(task.status);
  const completedAtIso = task.completedAt;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto p-4"
      data-task-detail-panel="true"
      data-task-detail-selected-id={task.id}
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-normal text-slate-500 dark:text-slate-400">
            {t("multimodal.tasks.previewPanel")}
          </div>
        </div>
        <TaskStatusBadge status={status}>
          {isGenerating
            ? t("multimodal.filter.generating")
            : t(`multimodal.status.${task.status}`)}
        </TaskStatusBadge>
      </div>

      {/* Body: left-right split on desktop, stacked on mobile */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        {/* Left info column */}
        <div
          className="flex min-h-0 flex-col gap-3"
          data-task-detail-info="true"
        >
          {/* Prompt */}
          <div
            className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5"
            data-task-prompt-panel="true"
          >
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("multimodal.prompt")}
            </div>
            <p
              className="mt-1 break-words text-sm font-medium text-slate-900 dark:text-slate-100"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 6,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
              data-task-prompt-clamp="6"
            >
              {task.prompt}
            </p>
          </div>

          {/* Error message (failed only) */}
          {task.status === "failed" && task.errorMessage ? (
            <div className="shrink-0 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2.5">
              <div className="text-xs font-semibold text-red-500 dark:text-red-400">
                {t("multimodal.failureReason")}
              </div>
              <p
                className="mt-1 break-words text-sm font-medium text-red-600 dark:text-red-400"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
                data-task-error-message="true"
              >
                {task.errorMessage}
              </p>
            </div>
          ) : null}

          {/* Essential metadata */}
          <div className="shrink-0 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="min-w-0 overflow-hidden">
              <div className="truncate text-xs text-slate-500 dark:text-slate-400">{t("multimodal.model")}</div>
              <div className="mt-0.5 truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={modelLabel}>
                {modelLabel}
              </div>
            </div>
            {generatedSize ? (
              <div className="min-w-0 overflow-hidden" data-task-generated-size="true">
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{t("multimodal.size")}</div>
                <div className="mt-0.5 truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={generatedSize}>
                  {generatedSize}
                </div>
              </div>
            ) : null}
            <div className="min-w-0 overflow-hidden">
              <div className="truncate text-xs text-slate-500 dark:text-slate-400">{t("multimodal.cost")}</div>
              <div className="mt-0.5 truncate text-sm font-medium text-slate-800 dark:text-slate-200">{String(task.costCredits)}</div>
            </div>
            {completedAtIso ? (
              <div className="min-w-0 overflow-hidden">
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{t("multimodal.completedAt")}</div>
                <div className="mt-0.5 truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={formatDate(completedAtIso)}>
                  {formatDate(completedAtIso)}
                </div>
              </div>
            ) : null}
          </div>

          {/* Actions */}
          {task.status === "succeeded" ? (
            <div className="shrink-0">
              <Link
                href={`/tasks/${task.id}`}
                className="inline-flex items-center rounded-lg bg-indigo-600 dark:bg-indigo-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 dark:hover:bg-indigo-600"
                data-task-detail-task-link="true"
              >
                {t("multimodal.viewTaskDetails")}
              </Link>
            </div>
          ) : null}
        </div>

        {/* Right preview column */}
        <div
          className="flex min-h-0 items-center justify-center"
          data-task-detail-preview="true"
        >
          {isGenerating ? (
            <div
              className="flex w-full items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900 py-16"
              data-task-preview-frame="true"
              data-task-generating-state="true"
            >
              <div className="grid justify-items-center gap-3 px-4 text-center">
                <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  {t("multimodal.filter.generating")}
                </span>
              </div>
            </div>
          ) : task.status === "failed" ? (
            <div
              className="flex w-full flex-col gap-3 rounded-2xl bg-red-50 dark:bg-red-950/30 p-5"
              data-task-preview-frame="true"
              data-task-failed-state="true"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                  <ImageIcon className="h-4 w-4 text-red-500 dark:text-red-400" aria-hidden="true" />
                </div>
                <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                  {t(`multimodal.status.${task.status}`)}
                </span>
              </div>
              {task.errorMessage ? (
                <p className="line-clamp-3 text-sm text-red-600 dark:text-red-400" data-task-error-message="true">
                  {task.errorMessage}
                </p>
              ) : null}
            </div>
          ) : previewVideo ? (
            <div
              className="flex w-full items-center justify-center rounded-2xl bg-slate-950 p-3"
              data-task-preview-frame="true"
            >
              <ResolvedAssetVideo
                src={previewVideo}
                token={token}
                controls
                playsInline
                className="max-h-[min(58vh,520px)] max-w-full rounded-xl object-contain"
                data-task-preview-video="true"
              />
            </div>
          ) : previewImage ? (
            <div
              className="flex items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900 p-3"
              data-task-preview-frame="true"
            >
              <ResolvedAssetImage
                src={previewImage}
                token={token}
                alt={t("multimodal.tasks.previewAlt")}
                className="max-h-[min(58vh,520px)] max-w-full rounded-xl object-contain"
                style={{
                  maxHeight: "min(58vh, 520px)",
                }}
                data-task-preview-image="true"
              />
            </div>
          ) : (
            <div
              className="flex w-full items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900 py-14"
              data-task-preview-frame="true"
              data-task-no-preview="true"
            >
              <div className="grid justify-items-center gap-2 px-4 text-center text-slate-400 dark:text-slate-500">
                <ImageIcon className="h-6 w-6" aria-hidden="true" />
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  {t("multimodal.tasks.noPreview")}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskPagination({
  currentPage,
  totalPages,
  totalTasks,
  onPrevious,
  onNext
}: {
  currentPage: number;
  totalPages: number;
  totalTasks: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const isSinglePage = totalPages <= 1;

  return (
    <nav
      className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-700 pt-3"
      data-tasks-pagination="desktop"
      data-tasks-mobile-pagination="compact"
      data-tasks-pagination-page={`${currentPage}/${totalPages}`}
      data-tasks-pagination-total={String(totalTasks)}
      aria-label={t("multimodal.tasks.pagination.label")}
    >
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-semibold text-slate-600 dark:text-slate-400 shadow-sm dark:shadow-none transition hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        data-tasks-pagination-prev="true"
        onClick={onPrevious}
        disabled={currentPage <= 1}
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" />
        {t("multimodal.tasks.pagination.previous")}
      </button>
      <div className="min-w-0 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
        <span data-tasks-pagination-current="true">
          {t("multimodal.tasks.pagination.page", {
            current: String(currentPage),
            total: String(totalPages)
          })}
        </span>
        <span className="hidden sm:inline" data-tasks-pagination-total-copy="true">
          {" · "}
          {t("multimodal.tasks.pagination.total", {
            total: String(totalTasks)
          })}
        </span>
      </div>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-semibold text-slate-600 dark:text-slate-400 shadow-sm dark:shadow-none transition hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        data-tasks-pagination-next="true"
        onClick={onNext}
        disabled={isSinglePage || currentPage >= totalPages}
      >
        {t("multimodal.tasks.pagination.next")}
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </button>
    </nav>
  );
}

function TaskThumbnail({
  imageUrl,
  videoUrl,
  token
}: {
  imageUrl: string | null;
  videoUrl?: string | null;
  token: string | null;
}) {
  const { t } = useI18n();

  if (videoUrl) {
    return (
      <div
        className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-950 sm:h-[88px] sm:w-[88px]"
        data-task-result-video="thumbnail"
        data-task-preview-height="fixed-thumbnail"
      >
        <ResolvedAssetVideo
          src={videoUrl}
          token={token}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (imageUrl) {
    return (
      <div
        className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 sm:h-[88px] sm:w-[88px]"
        data-task-result-image="thumbnail"
        data-task-preview-height="fixed-thumbnail"
      >
        <ResolvedAssetImage
          src={imageUrl}
          token={token}
          alt={t("multimodal.tasks.previewAlt")}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 sm:h-[88px] sm:w-[88px]"
      data-task-result-placeholder="true"
      data-task-preview-height="fixed-thumbnail"
    >
      <div className="grid justify-items-center gap-2 px-3 text-center text-slate-400 dark:text-slate-500">
        <ImageIcon className="h-5 w-5" aria-hidden="true" />
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {t("multimodal.tasks.noPreview")}
        </span>
      </div>
    </div>
  );
}

function EmptyTasksState({ hasToken }: { hasToken: boolean }) {
  const { t } = useI18n();

  return (
    <section
      className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center shadow-sm dark:shadow-none"
      data-tasks-empty-state="true"
    >
      <div className="max-w-md">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
          <ListChecks className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
          {hasToken
            ? t("multimodal.tasks.emptyTitle")
            : t("multimodal.loginRequiredTitle")}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {hasToken
            ? t("multimodal.tasks.emptyDescription")
            : t("multimodal.loginRequiredDescription")}
        </p>
        {hasToken ? (
          <Link
            href="/image"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-indigo-600 dark:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 dark:hover:bg-indigo-600"
          >
            {t("multimodal.goToImageCreation")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function TaskStatusBadge({
  status,
  children,
}: {
  status: string;
  children: React.ReactNode;
}) {
  const className =
    status === "succeeded"
      ? "inline-flex rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-900"
      : status === "failed"
        ? "inline-flex rounded-full bg-red-50 dark:bg-red-950/30 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-900"
        : status === "generating"
          ? "inline-flex rounded-full bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-900"
          : "inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700";
  return <span className={className}>{children}</span>;
}
