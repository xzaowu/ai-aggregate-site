"use client";

import type { AiModelSummary, AiTaskSummary } from "@ai-aggregate/shared";
import {
  ChevronLeft,
  ChevronRight,
  Images,
  Plus,
  RefreshCw,
  Trash2
} from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ResolvedAssetImage } from "../../../components/workspace/ResolvedAssetImage";
import { useOptionalWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../lib/site-config";
import {
  dismissedImageSessionsStorageKey,
  createImageSessionId,
  getDismissedImageSessionsStorageKey,
  getImageSessionsStorageKey,
  imageSessionsStorageKey,
  mergeImageSessionsWithBackendHistory,
  normalizeImageSessionsForDisplay,
  parseDismissedImageSessionIds,
  parseStoredImageSessions,
  writeImagePromptDraft,
  resolveImageLocalStorageIdentity,
  serializeDismissedImageSessionIds,
  serializeImageSessionsForStorage,
  taskToImageStreamEntry,
  type ImageSession
} from "./image-page-content";

export type ImageSessionHistoryGroup = "today" | "yesterday" | "earlier";

export type ImageSessionHistorySummary = {
  session: ImageSession;
  title: string;
  updatedAt: string | null;
  modelName: string | null;
  imageCount: number | null;
  coverUrl: string | null;
  referenceNames: Array<string | null>;
};

const fallbackSessionTitles = new Set([
  "新建画图",
  "新建创作",
  "New drawing",
  "New creation",
  "图像创作",
  "Image creation",
  "历史会话",
  "History",
  "创作记录",
  "Creation history",
  "Creation History"
]);

function validTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function truncateHistoryText(value: string, maxLength = 42) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}…`
    : normalized;
}

function getEntryUpdatedAt(entry: ImageSession["entries"][number]) {
  return (
    entry.result?.task.updatedAt ??
    entry.result?.task.completedAt ??
    entry.createdAt ??
    null
  );
}

export function getImageSessionUpdatedAt(session: ImageSession): string | null {
  return (
    [...session.entries]
      .reverse()
      .map(getEntryUpdatedAt)
      .find((value) => validTimestamp(value) !== null) ?? null
  );
}

export function getImageSessionTitle(
  session: ImageSession,
  fallback = "Image creation"
): string {
  const storedTitle = session.title.trim();
  if (storedTitle && !fallbackSessionTitles.has(storedTitle)) {
    return truncateHistoryText(storedTitle);
  }

  const firstFreeCreatePrompt = session.entries
    .filter((entry) => (entry.workflow ?? "free-create") === "free-create")
    .map((entry) => entry.prompt.trim())
    .find((prompt) => prompt.length > 0);
  const titleCoverTitle = session.entries
    .filter((entry) => entry.workflow === "title-cover")
    .map((entry) => entry.imageSessionTitle?.trim() ?? "")
    .find((title) => title.length > 0);

  return truncateHistoryText(
    firstFreeCreatePrompt || titleCoverTitle || storedTitle || fallback
  );
}

export function getImageSessionModelName(
  session: ImageSession
): string | null {
  for (const entry of [...session.entries].reverse()) {
    const modelName = entry.modelName.trim();
    if (modelName && modelName !== entry.modelId) {
      return modelName;
    }
  }

  return null;
}

export function getImageSessionImageCount(session: ImageSession): number | null {
  let count = 0;
  let hasAccurateResult = false;

  for (const entry of session.entries) {
    if (entry.status !== "succeeded" || !entry.result) {
      continue;
    }

    hasAccurateResult = true;
    count += entry.result.assets.length;
  }

  return hasAccurateResult ? count : null;
}

export function getImageSessionCoverUrl(session: ImageSession): string | null {
  for (const entry of [...session.entries].reverse()) {
    if (entry.status !== "succeeded" || !entry.result) {
      continue;
    }

    for (const asset of [...entry.result.assets].reverse()) {
      const url = asset.url;
      if (typeof url === "string" && url.trim().length > 0) {
        return url;
      }
    }
  }

  return null;
}

export function getImageSessionReferenceNames(
  session: ImageSession
): Array<string | null> {
  for (const entry of [...session.entries].reverse()) {
    if (entry.referenceImagesMetadata?.length) {
      return entry.referenceImagesMetadata.map((reference) => reference.name);
    }
    if (entry.referenceImages?.length) {
      return entry.referenceImages.map((reference) => reference.name || null);
    }
    if (entry.referenceImageMetadata) {
      return [entry.referenceImageMetadata.name];
    }
    if (entry.referenceImage) {
      return [entry.referenceImage.name || null];
    }
  }
  return [];
}

export function summarizeImageSession(
  session: ImageSession,
  fallbackTitle = "Image creation"
): ImageSessionHistorySummary {
  return {
    session,
    title: getImageSessionTitle(session, fallbackTitle),
    updatedAt: getImageSessionUpdatedAt(session),
    modelName: getImageSessionModelName(session),
    imageCount: getImageSessionImageCount(session),
    coverUrl: getImageSessionCoverUrl(session),
    referenceNames: getImageSessionReferenceNames(session)
  };
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function groupImageSessionSummaries(
  summaries: ImageSessionHistorySummary[],
  now = new Date()
): Record<ImageSessionHistoryGroup, ImageSessionHistorySummary[]> {
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const groups: Record<
    ImageSessionHistoryGroup,
    ImageSessionHistorySummary[]
  > = { today: [], yesterday: [], earlier: [] };

  const sorted = [...summaries].sort(
    (left, right) =>
      (validTimestamp(right.updatedAt) ?? 0) -
      (validTimestamp(left.updatedAt) ?? 0)
  );

  for (const summary of sorted) {
    const timestamp = validTimestamp(summary.updatedAt);
    if (timestamp === null || timestamp < yesterdayStart) {
      groups.earlier.push(summary);
    } else if (timestamp < todayStart) {
      groups.yesterday.push(summary);
    } else {
      groups.today.push(summary);
    }
  }

  return groups;
}

function HistoryCover({
  src,
  token,
  alt
}: {
  src: string | null;
  token: string | null;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  const placeholder = (
    <div
      className="flex size-full items-center justify-center text-slate-300 dark:text-slate-600"
      data-image-history-cover-placeholder="true"
    >
      <Images className="size-7" aria-hidden="true" />
    </div>
  );

  return (
    <div
      className="flex h-[72px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800"
      data-image-history-cover="true"
    >
      {src && !failed ? (
        <ResolvedAssetImage
          src={src}
          token={token}
          alt={alt}
          className="max-h-full max-w-full object-contain object-center"
          onError={() => setFailed(true)}
          fallback={placeholder}
        />
      ) : (
        placeholder
      )}
    </div>
  );
}

function formatHistoryTime(value: string | null, locale: string) {
  if (!value || validTimestamp(value) === null) {
    return "";
  }

  return new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function HistorySkeleton() {
  return (
    <div className="grid gap-3" data-image-history-loading="true">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex min-w-0 animate-pulse items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          data-image-history-skeleton="true"
        >
          <div className="h-[72px] w-[88px] shrink-0 rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="h-4 w-3/5 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3 w-2/5 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HistorySessionCard({
  summary,
  token,
  locale,
  imageCountLabel,
  referenceCountLabel,
  removeLabel,
  onRemove
}: {
  summary: ImageSessionHistorySummary;
  token: string | null;
  locale: string;
  imageCountLabel: (count: number) => string;
  referenceCountLabel: (count: number) => string;
  removeLabel: string;
  onRemove: (sessionId: string) => void;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-1 rounded-2xl border border-slate-200 bg-white p-2 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
      data-image-history-session-card="true"
    >
      <Link
        href={`/image/history/${encodeURIComponent(summary.session.id)}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-label={summary.title}
      >
        <HistoryCover src={summary.coverUrl} token={token} alt={summary.title} />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-semibold text-slate-950 dark:text-slate-100"
            title={summary.title}
            data-image-history-session-title="true"
          >
            {summary.title}
          </span>
          <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">
            {formatHistoryTime(summary.updatedAt, locale)}
          </span>
          <span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            {summary.modelName ? (
              <span className="max-w-[12rem] truncate" data-image-history-model="true">
                {summary.modelName}
              </span>
            ) : null}
            {summary.imageCount !== null ? (
              <span data-image-history-image-count="true">
                {imageCountLabel(summary.imageCount)}
              </span>
            ) : null}
          </span>
          {summary.referenceNames.length > 0 ? (
            <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400" data-image-history-reference-summary="true">
              {referenceCountLabel(summary.referenceNames.length)}
              {summary.referenceNames.some(Boolean)
                ? ` · ${summary.referenceNames.map((name, index) => name ?? `#${index + 1}`).join(" · ")}`
                : ""}
            </span>
          ) : null}
        </span>
        <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={() => onRemove(summary.session.id)}
        data-image-history-remove={summary.session.id}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ImageHistoryPageContent() {
  const { locale, t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const shellToken = workspaceShell?.shell.token ?? null;
  const shellAuthStatus = workspaceShell?.shell.authStatus ?? null;
  const currentImageStorageIdentity = workspaceShell
    ? resolveImageLocalStorageIdentity(
        workspaceShell.shell.authStatus,
        shellToken,
        workspaceShell.shell.user?.id
      )
    : "guest";
  const [token, setToken] = useState<string | null>(shellToken);
  const [sessions, setSessions] = useState<ImageSession[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState(false);
  const historyRequestSequenceRef = useRef(0);
  const historyIdentityRef = useRef(currentImageStorageIdentity);
  const historyTokenRef = useRef(shellToken);

  if (
    historyIdentityRef.current !== currentImageStorageIdentity ||
    historyTokenRef.current !== shellToken
  ) {
    historyIdentityRef.current = currentImageStorageIdentity;
    historyTokenRef.current = shellToken;
    historyRequestSequenceRef.current += 1;
  }

  const loadHistory = useCallback(async () => {
    const requestIdentity = currentImageStorageIdentity;
    const requestToken = shellToken;
    if (
      historyIdentityRef.current !== requestIdentity ||
      historyTokenRef.current !== requestToken
    ) {
      return;
    }
    const requestSequence = historyRequestSequenceRef.current + 1;
    historyRequestSequenceRef.current = requestSequence;
    const isCurrentHistoryRequest = () =>
      historyRequestSequenceRef.current === requestSequence &&
      historyIdentityRef.current === requestIdentity &&
      historyTokenRef.current === requestToken;

    setStatus("loading");
    setError(false);
    const authToken = requestToken;
    setToken(authToken);

    let stored = null;
    try {
      if (currentImageStorageIdentity) {
        stored = parseStoredImageSessions(
          window.sessionStorage.getItem(
            getImageSessionsStorageKey(currentImageStorageIdentity)
          )
        );
      }
    } catch {
      stored = null;
    }
    try {
      window.sessionStorage.removeItem(imageSessionsStorageKey);
    } catch {
      // Browser storage can be unavailable.
    }

    let dismissed = new Set<string>();
    try {
      if (currentImageStorageIdentity) {
        dismissed = parseDismissedImageSessionIds(
          window.localStorage.getItem(
            getDismissedImageSessionsStorageKey(currentImageStorageIdentity)
          )
        );
      }
    } catch {
      dismissed = new Set<string>();
    }
    try {
      window.localStorage.removeItem(dismissedImageSessionsStorageKey);
    } catch {
      // Browser storage can be unavailable.
    }

    const localSessions = (stored?.sessions ?? []).filter(
      (session) => !dismissed.has(session.id)
    );
    if (!authToken) {
      if (!isCurrentHistoryRequest()) {
        return;
      }
      setSessions(normalizeImageSessionsForDisplay(localSessions));
      setStatus("ready");
      return;
    }

    try {
      const [tasksResponse, modelsResponse] = await Promise.all([
        fetch(apiUrl("/tasks?type=image&limit=100"), {
          headers: { Authorization: `Bearer ${authToken}` }
        }),
        fetch(apiUrl("/models?surface=image"))
      ]);

      if (!tasksResponse.ok) {
        throw new Error("history load failed");
      }

      const taskData = (await tasksResponse.json()) as { tasks?: AiTaskSummary[] };
      const tasks = Array.isArray(taskData.tasks)
        ? taskData.tasks.filter((task) => task.type === "image")
        : [];
      const modelData = modelsResponse.ok
        ? ((await modelsResponse.json()) as { models?: AiModelSummary[] })
        : { models: [] };
      const modelMap = new Map(
        (Array.isArray(modelData.models) ? modelData.models : []).map((model) => [
          model.modelId,
          model
        ])
      );
      const entries = tasks
        .slice()
        .reverse()
        .map((task) => taskToImageStreamEntry(task, modelMap, t))
        .filter((entry) => Boolean(entry.imageSessionId));
      const merged = mergeImageSessionsWithBackendHistory(
        localSessions,
        entries,
        t("multimodal.image.backendHistory"),
        20,
        {
          backendHistoryDismissed: stored?.backendHistoryDismissed ?? false,
          firstPageLoadedAt: new Date(0).toISOString(),
          dismissedSessionIds: dismissed,
          imageSessionFallbackTitle: t("multimodal.image.creationFallback")
        }
      );
      if (!isCurrentHistoryRequest()) {
        return;
      }
      setSessions(normalizeImageSessionsForDisplay(merged));
      setStatus("ready");
    } catch {
      if (!isCurrentHistoryRequest()) {
        return;
      }
      setStatus("error");
      setError(true);
    }
  }, [currentImageStorageIdentity, shellToken, t]);

  const createNewImageSession = useCallback(() => {
    const storageIdentity = currentImageStorageIdentity;
    if (!storageIdentity) {
      return false;
    }

    try {
      const stored = parseStoredImageSessions(
        window.sessionStorage.getItem(getImageSessionsStorageKey(storageIdentity))
      );
      const nextSession: ImageSession = {
        id: createImageSessionId(),
        title: t("multimodal.image.newDrawing"),
        entries: []
      };
      window.sessionStorage.setItem(
        getImageSessionsStorageKey(storageIdentity),
        serializeImageSessionsForStorage(
          [nextSession, ...(stored?.sessions ?? [])],
          nextSession.id,
          undefined,
          {
            firstPageLoadedAt: stored?.firstPageLoadedAt,
            backendHistoryDismissed: stored?.backendHistoryDismissed
          }
        )
      );
      writeImagePromptDraft(storageIdentity, "");
      return true;
    } catch {
      // Browser storage can be unavailable; do not cross-write another scope.
      return false;
    }
  }, [currentImageStorageIdentity, t]);

  const handleNewImageSessionClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!createNewImageSession()) {
        event.preventDefault();
      }
    },
    [createNewImageSession]
  );

  const removeImageSession = useCallback(
    (sessionId: string) => {
      const storageIdentity = currentImageStorageIdentity;
      if (!storageIdentity) {
        return;
      }

      try {
        const storageKey = getDismissedImageSessionsStorageKey(storageIdentity);
        const dismissed = parseDismissedImageSessionIds(
          window.localStorage.getItem(storageKey)
        );
        dismissed.add(sessionId);
        window.localStorage.setItem(
          storageKey,
          serializeDismissedImageSessionIds(dismissed)
        );
        setSessions((currentSessions) =>
          currentSessions.filter((session) => session.id !== sessionId)
        );
      } catch {
        // Keep the visible list unchanged when browser storage is unavailable.
      }
    },
    [currentImageStorageIdentity]
  );

  useEffect(() => {
    if (shellAuthStatus === "unknown") {
      return;
    }

    void loadHistory();
  }, [loadHistory, shellAuthStatus]);

  const summaries = useMemo(
    () => sessions.map((session) => summarizeImageSession(session, t("multimodal.image.creationFallback"))),
    [sessions, t]
  );
  const groups = useMemo(() => groupImageSessionSummaries(summaries), [summaries]);
  const groupLabels: Record<ImageSessionHistoryGroup, string> = {
    today: t("multimodal.image.historyToday"),
    yesterday: t("multimodal.image.historyYesterday"),
    earlier: t("multimodal.image.historyEarlier")
  };
  const hasSessions = summaries.length > 0;

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-slate-50 px-3 pb-8 pt-3 dark:bg-slate-950 sm:px-5 md:px-8 md:py-6"
      data-image-history-page="true"
      data-image-history-scroll-owner="true"
    >
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex min-w-0 items-center gap-2 border-b border-slate-200 pb-4 dark:border-slate-800">
          <Link
            href="/image"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
            aria-label={t("multimodal.image.historyBack")}
            data-image-history-back="true"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-950 dark:text-slate-100">
            {t("multimodal.image.historyTitle")}
          </h1>
          <Link
            href="/image"
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            data-image-history-new="true"
            onClick={handleNewImageSessionClick}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>{t("multimodal.image.newDrawing")}</span>
          </Link>
        </header>

        <div className="pt-5">
          {status === "loading" ? <HistorySkeleton /> : null}
          {status === "error" ? (
            <div
              className="rounded-2xl border border-red-100 bg-white p-6 text-center dark:border-red-900/60 dark:bg-slate-900"
              data-image-history-error="true"
            >
              <p className="text-sm text-red-700 dark:text-red-400">
                {error ? t("multimodal.image.historyLoadFailed") : null}
              </p>
              <button
                type="button"
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                onClick={() => void loadHistory()}
                data-image-history-retry="true"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                {t("multimodal.image.historyRetry")}
              </button>
            </div>
          ) : null}
          {status === "ready" && !hasSessions ? (
            <div
              className="flex min-h-[48vh] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center dark:border-slate-800 dark:bg-slate-900"
              data-image-history-empty="true"
            >
              <div className="flex size-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                <Images className="size-7" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-bold text-slate-950 dark:text-slate-100">
                {t("multimodal.image.historyEmptyTitle")}
              </h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500 dark:text-slate-400">
                {t("multimodal.image.historyEmptyDescription")}
              </p>
              <Link
                href="/image"
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
                data-image-history-empty-start="true"
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("multimodal.image.historyEmptyAction")}
              </Link>
            </div>
          ) : null}
          {status === "ready" && hasSessions ? (
            <div className="grid gap-6" data-image-history-groups="true">
              {(["today", "yesterday", "earlier"] as const).map((group) =>
                groups[group].length > 0 ? (
                  <section key={group} data-image-history-group={group}>
                    <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {groupLabels[group]}
                    </h2>
                    <div className="grid min-w-0 gap-3">
                      {groups[group].map((summary) => (
                        <HistorySessionCard
                          key={summary.session.id}
                          summary={summary}
                          token={token}
                          locale={locale}
                          imageCountLabel={(count) =>
                            t("multimodal.image.historyImageCount", { count })
                          }
                          referenceCountLabel={(count) =>
                            t("multimodal.image.multipleReferencesHistory", { count })
                          }
                          removeLabel={t("multimodal.image.historyRemove")}
                          onRemove={removeImageSession}
                        />
                      ))}
                    </div>
                  </section>
                ) : null
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
