"use client";

import type {
  CreatorCanvasDocumentPagedListResponse,
  CreatorCanvasDocumentSummary
} from "@ai-aggregate/shared";
import {
  ChevronLeft,
  ChevronRight,
  Copy as CopyIcon,
  FilePlus2,
  FolderOpen,
  Pencil,
  Trash2
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalWorkspaceShellContext } from "../../../../components/workspace/workspace-shell-context";
import { useI18n } from "../../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../../lib/site-config";
import { CREATOR_CANVAS_TITLE_MAX_LENGTH } from "../creator-canvas-saved-documents-dialog";

export const CREATOR_CANVAS_LIBRARY_PAGE_SIZE = 20;

type LibraryStatus =
  | "loading"
  | "unauthenticated"
  | "error"
  | "empty"
  | "ready";

type LibraryViewState = CreatorCanvasDocumentPagedListResponse & {
  status: LibraryStatus;
  ownerKey: string | null;
};

type LibraryMutationError = "conflict" | "error" | null;

interface CreatorCanvasDocumentDetailForDuplicate {
  document: CreatorCanvasDocumentSummary;
  state: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanvasDocumentSummary(value: unknown): value is CreatorCanvasDocumentSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    (value.title === null || typeof value.title === "string") &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    typeof value.createdAt === "string" &&
    value.createdAt.trim().length > 0 &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.trim().length > 0
  );
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function parseCreatorCanvasLibraryPage(
  value: unknown
): CreatorCanvasDocumentPagedListResponse {
  if (!isRecord(value) || !Array.isArray(value.documents)) {
    throw new Error("CREATOR_CANVAS_LIBRARY_RESPONSE_INVALID");
  }
  const page = readPositiveInteger(value.page);
  const pageSize = readPositiveInteger(value.pageSize);
  const total = typeof value.total === "number" && Number.isSafeInteger(value.total) && value.total >= 0
    ? value.total
    : null;
  const totalPages = readPositiveInteger(value.totalPages);
  if (
    page === null ||
    pageSize === null ||
    pageSize > 50 ||
    total === null ||
    totalPages === null
  ) {
    throw new Error("CREATOR_CANVAS_LIBRARY_RESPONSE_INVALID");
  }
  return {
    documents: value.documents.filter(isCanvasDocumentSummary),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, totalPages)
  };
}

function parseCreatorCanvasDocumentSummary(value: unknown): CreatorCanvasDocumentSummary {
  if (!isRecord(value) || !isCanvasDocumentSummary(value.document)) {
    throw new Error("CREATOR_CANVAS_DOCUMENT_RESPONSE_INVALID");
  }
  return value.document;
}

function parseCreatorCanvasDocumentDetailForDuplicate(
  value: unknown
): CreatorCanvasDocumentDetailForDuplicate {
  if (
    !isRecord(value) ||
    !isCanvasDocumentSummary(value.document) ||
    !Object.prototype.hasOwnProperty.call(value.document, "state")
  ) {
    throw new Error("CREATOR_CANVAS_DOCUMENT_RESPONSE_INVALID");
  }
  const document = value.document as CreatorCanvasDocumentSummary & {
    state: unknown;
  };
  return {
    document,
    state: document.state
  };
}

function deriveDuplicateCanvasTitle(
  sourceTitle: string | null,
  untitledFallback: string,
  copySuffix: string
): string {
  const suffix = copySuffix.trim();
  const fallback = untitledFallback.trim() || "Canvas";
  const base = sourceTitle?.trim() || fallback;
  const availableBaseLength = Math.max(
    1,
    CREATOR_CANVAS_TITLE_MAX_LENGTH - suffix.length - 1
  );
  const boundedBase = base.slice(0, availableBaseLength).trimEnd() || fallback;
  return `${boundedBase} ${suffix}`;
}

function createLibraryViewState(
  ownerKey: string | null,
  status: LibraryStatus,
  page = 1
): LibraryViewState {
  return {
    status,
    ownerKey,
    documents: [],
    page: Math.max(1, page),
    pageSize: CREATOR_CANVAS_LIBRARY_PAGE_SIZE,
    total: 0,
    totalPages: 1
  };
}

function formatCanvasDate(value: string, locale: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(locale).format(new Date(timestamp));
}

function displayCanvasTitle(
  document: CreatorCanvasDocumentSummary,
  fallback: string
): string {
  return document.title?.trim() || fallback;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

export function CreatorCanvasLibraryPageContent() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const authStatus = workspaceShell?.shell.authStatus ?? "guest";
  const token = workspaceShell?.shell.token?.trim() || null;
  const userId = workspaceShell?.shell.user?.id ?? null;
  const ownerKey = authStatus === "authenticated" && token && userId
    ? `${userId}:${token}`
    : null;
  const currentOwnerKeyRef = useRef(ownerKey);
  currentOwnerKeyRef.current = ownerKey;
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const mutationIdRef = useRef(0);
  const activeDuplicateDocumentIdRef = useRef<string | null>(null);
  const [pageState, setPageState] = useState<{
    ownerKey: string | null;
    page: number;
  }>({ ownerKey: null, page: 1 });
  const currentPage = pageState.ownerKey === ownerKey ? pageState.page : 1;
  const [retryRevision, setRetryRevision] = useState(0);
  const [viewState, setViewState] = useState<LibraryViewState>(() =>
    createLibraryViewState(null, "loading")
  );
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<LibraryMutationError>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [duplicatingDocumentId, setDuplicatingDocumentId] = useState<string | null>(null);
  const [duplicateErrorDocumentId, setDuplicateErrorDocumentId] = useState<string | null>(null);

  const visibleViewState = viewState.ownerKey === ownerKey
    ? viewState
    : createLibraryViewState(
        ownerKey,
        authStatus === "unknown"
          ? "loading"
          : ownerKey
            ? "loading"
            : "unauthenticated",
        currentPage
      );
  const mutationBusy =
    renameSaving ||
    deletingDocumentId !== null ||
    duplicatingDocumentId !== null;
  const mutationBusyNow = mutationBusy || activeDuplicateDocumentIdRef.current !== null;

  useEffect(() => {
    setRenamingDocumentId(null);
    setRenameDraft("");
    setRenameSaving(false);
    setRenameError(null);
    setDeletingDocumentId(null);
    setDeleteError(false);
    activeDuplicateDocumentIdRef.current = null;
    setDuplicatingDocumentId(null);
    setDuplicateErrorDocumentId(null);
    mutationIdRef.current += 1;
  }, [ownerKey]);

  useEffect(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    const requestId = ++requestIdRef.current;

    if (authStatus !== "authenticated" || !token || !userId || !ownerKey) {
      setViewState(createLibraryViewState(
        ownerKey,
        authStatus === "unknown" ? "loading" : "unauthenticated",
        currentPage
      ));
      return;
    }

    const requestedPage = currentPage;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setPageState((current) => current.ownerKey === ownerKey
      ? current
      : { ownerKey, page: 1 });
    setViewState(createLibraryViewState(ownerKey, "loading", requestedPage));

    void fetch(apiUrl(
      `/canvas/documents?page=${requestedPage}&pageSize=${CREATOR_CANVAS_LIBRARY_PAGE_SIZE}`
    ), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("CREATOR_CANVAS_LIBRARY_UNAVAILABLE");
        return parseCreatorCanvasLibraryPage(await response.json() as unknown);
      })
      .then((parsed) => {
        if (
          requestIdRef.current !== requestId ||
          currentOwnerKeyRef.current !== ownerKey ||
          controller.signal.aborted
        ) {
          return;
        }
        if (requestedPage > parsed.totalPages) {
          setPageState({ ownerKey, page: parsed.totalPages });
          setViewState(createLibraryViewState(ownerKey, "loading", parsed.totalPages));
          return;
        }
        setPageState({ ownerKey, page: parsed.page });
        setViewState({
          ...parsed,
          ownerKey,
          status: parsed.documents.length > 0 ? "ready" : "empty"
        });
      })
      .catch((error: unknown) => {
        if (
          requestIdRef.current !== requestId ||
          currentOwnerKeyRef.current !== ownerKey ||
          isAbortError(error) ||
          controller.signal.aborted
        ) {
          return;
        }
        setViewState(createLibraryViewState(ownerKey, "error", requestedPage));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          requestControllerRef.current = null;
        }
      });

    return () => {
      controller.abort();
    };
  }, [authStatus, currentPage, ownerKey, retryRevision, token, userId]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    requestControllerRef.current?.abort();
    activeDuplicateDocumentIdRef.current = null;
    mutationIdRef.current += 1;
  }, []);

  const retry = useCallback(() => {
    if (!ownerKey) return;
    setRetryRevision((current) => current + 1);
  }, [ownerKey]);

  const goToPage = useCallback((nextPage: number) => {
    if (
      !ownerKey ||
      mutationBusyNow ||
      visibleViewState.status === "loading" ||
      visibleViewState.totalPages <= 1
    ) {
      return;
    }
    const safePage = Math.min(
      Math.max(1, nextPage),
      visibleViewState.totalPages
    );
    if (safePage === currentPage) return;
    setPageState({ ownerKey, page: safePage });
    setViewState((current) => current.ownerKey === ownerKey
      ? createLibraryViewState(ownerKey, "loading", safePage)
      : current);
  }, [
    currentPage,
    mutationBusyNow,
    ownerKey,
    visibleViewState.status,
    visibleViewState.totalPages
  ]);

  const openDocument = useCallback((documentId: string) => {
    if (mutationBusyNow) return;
    router.push(`/canvas?canvasId=${encodeURIComponent(documentId)}`);
  }, [mutationBusyNow, router]);

  const startNewCanvas = useCallback(() => {
    if (mutationBusyNow) return;
    router.push("/canvas");
  }, [mutationBusyNow, router]);

  const beginRename = useCallback((document: CreatorCanvasDocumentSummary) => {
    if (mutationBusyNow || visibleViewState.status !== "ready") return;
    setRenamingDocumentId(document.id);
    setRenameDraft(document.title?.trim() ?? "");
    setRenameError(null);
    setDeleteError(false);
    setDuplicateErrorDocumentId(null);
  }, [mutationBusyNow, visibleViewState.status]);

  const cancelRename = useCallback(() => {
    if (renameSaving) return;
    setRenamingDocumentId(null);
    setRenameDraft("");
    setRenameError(null);
  }, [renameSaving]);

  const saveRename = useCallback(async (document: CreatorCanvasDocumentSummary) => {
    if (
      !ownerKey ||
      !token ||
      visibleViewState.status !== "ready" ||
      renameSaving ||
      deletingDocumentId !== null ||
      activeDuplicateDocumentIdRef.current !== null ||
      renamingDocumentId !== document.id
    ) {
      return;
    }
    const mutationId = ++mutationIdRef.current;
    setRenameSaving(true);
    setRenameError(null);
    try {
      const response = await fetch(
        apiUrl(`/canvas/documents/${encodeURIComponent(document.id)}`),
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            expectedRevision: document.revision,
            title: renameDraft.trim() || null
          })
        }
      );
      if (
        mutationIdRef.current !== mutationId ||
        currentOwnerKeyRef.current !== ownerKey
      ) {
        return;
      }
      if (response.status === 409) {
        setRenameError("conflict");
        return;
      }
      if (!response.ok) {
        setRenameError("error");
        return;
      }
      const summary = parseCreatorCanvasDocumentSummary(
        await response.json() as unknown
      );
      setViewState((current) => current.ownerKey === ownerKey
        ? {
            ...current,
            documents: current.documents.map((candidate) =>
              candidate.id === summary.id ? summary : candidate
            )
          }
        : current);
      setRenamingDocumentId(null);
      setRenameDraft("");
      setRenameError(null);
    } catch {
      if (
        mutationIdRef.current === mutationId &&
        currentOwnerKeyRef.current === ownerKey
      ) {
        setRenameError("error");
      }
    } finally {
      if (mutationIdRef.current === mutationId) {
        setRenameSaving(false);
      }
    }
  }, [
    deletingDocumentId,
    ownerKey,
    renameDraft,
    renameSaving,
    renamingDocumentId,
    token,
    visibleViewState.status
  ]);

  const duplicateDocument = useCallback(async (
    document: CreatorCanvasDocumentSummary
  ) => {
    if (
      !ownerKey ||
      !token ||
      visibleViewState.status !== "ready" ||
      mutationBusyNow ||
      activeDuplicateDocumentIdRef.current !== null
    ) {
      return;
    }

    const mutationId = ++mutationIdRef.current;
    const mutationOwnerKey = ownerKey;
    const mutationToken = token;
    activeDuplicateDocumentIdRef.current = document.id;
    setDuplicatingDocumentId(document.id);
    setDuplicateErrorDocumentId(null);

    const isCurrentMutation = () => (
      mutationIdRef.current === mutationId &&
      currentOwnerKeyRef.current === mutationOwnerKey &&
      activeDuplicateDocumentIdRef.current === document.id
    );

    try {
      const detailResponse = await fetch(
        apiUrl(`/canvas/documents/${encodeURIComponent(document.id)}`),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${mutationToken}` }
        }
      );
      if (!detailResponse.ok) {
        throw new Error("CREATOR_CANVAS_DUPLICATE_DETAIL_UNAVAILABLE");
      }
      const sourceDetail = parseCreatorCanvasDocumentDetailForDuplicate(
        await detailResponse.json() as unknown
      );
      if (!isCurrentMutation()) return;

      const copyTitle = deriveDuplicateCanvasTitle(
        sourceDetail.document.title,
        t("creator.canvas.persistence.untitled"),
        t("creator.canvas.library.copySuffix")
      );
      const createResponse = await fetch(apiUrl("/canvas/documents"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mutationToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          state: sourceDetail.state,
          title: copyTitle
        })
      });
      if (!createResponse.ok) {
        throw new Error("CREATOR_CANVAS_DUPLICATE_CREATE_UNAVAILABLE");
      }
      const createdDocument = parseCreatorCanvasDocumentDetailForDuplicate(
        await createResponse.json() as unknown
      );
      if (!isCurrentMutation()) return;
      router.push(
        `/canvas?canvasId=${encodeURIComponent(createdDocument.document.id)}`
      );
    } catch (error: unknown) {
      if (isCurrentMutation() && !isAbortError(error)) {
        setDuplicateErrorDocumentId(document.id);
      }
    } finally {
      if (mutationIdRef.current === mutationId) {
        activeDuplicateDocumentIdRef.current = null;
        setDuplicatingDocumentId(null);
      }
    }
  }, [
    mutationBusyNow,
    ownerKey,
    router,
    t,
    token,
    visibleViewState.status
  ]);

  const deleteDocument = useCallback(async (document: CreatorCanvasDocumentSummary) => {
    if (
      !ownerKey ||
      !token ||
      visibleViewState.status !== "ready" ||
      mutationBusyNow
    ) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("creator.canvas.library.confirmDelete"))
    ) {
      return;
    }
    const mutationId = ++mutationIdRef.current;
    setDeletingDocumentId(document.id);
    setDeleteError(false);
    setDuplicateErrorDocumentId(null);
    try {
      const response = await fetch(
        apiUrl(`/canvas/documents/${encodeURIComponent(document.id)}`),
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (
        mutationIdRef.current !== mutationId ||
        currentOwnerKeyRef.current !== ownerKey
      ) {
        return;
      }
      if (!response.ok) {
        setDeleteError(true);
        return;
      }
      const nextTotal = Math.max(0, visibleViewState.total - 1);
      const nextTotalPages = Math.max(
        1,
        Math.ceil(nextTotal / CREATOR_CANVAS_LIBRARY_PAGE_SIZE)
      );
      if (currentPage > nextTotalPages) {
        setPageState({ ownerKey, page: nextTotalPages });
        setViewState(createLibraryViewState(ownerKey, "loading", nextTotalPages));
      } else {
        setViewState((current) => {
          if (current.ownerKey !== ownerKey) return current;
          const documents = current.documents.filter(
            (candidate) => candidate.id !== document.id
          );
          return {
            ...current,
            documents,
            total: nextTotal,
            totalPages: nextTotalPages,
            status: documents.length > 0 ? "ready" : "empty"
          };
        });
      }
    } catch {
      if (
        mutationIdRef.current === mutationId &&
        currentOwnerKeyRef.current === ownerKey
      ) {
        setDeleteError(true);
      }
    } finally {
      if (mutationIdRef.current === mutationId) {
        setDeletingDocumentId(null);
      }
    }
  }, [
    currentPage,
    mutationBusyNow,
    ownerKey,
    t,
    token,
    visibleViewState.status,
    visibleViewState.total
  ]);

  const status = visibleViewState.status;
  const showPagination = status === "ready" && visibleViewState.totalPages > 1;
  const paginationLabel = useMemo(() => t(
    "creator.canvas.library.page",
    {
      page: visibleViewState.page,
      totalPages: visibleViewState.totalPages
    }
  ), [t, visibleViewState.page, visibleViewState.totalPages]);

  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-slate-50 px-4 py-6 dark:bg-slate-950 sm:px-6 lg:px-8"
      data-creator-canvas-library-page="true"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              {t("creator.canvas.library.title")}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t("creator.canvas.library.description")}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={startNewCanvas}
            disabled={mutationBusy}
            data-creator-canvas-library-new="true"
          >
            <FilePlus2 className="size-4" aria-hidden="true" />
            {t("creator.canvas.library.new")}
          </button>
        </header>

        <section
          className="min-h-0"
          aria-live="polite"
          data-creator-canvas-library-state={status}
        >
          {status === "unauthenticated" ? (
            <p
              className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-8 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              data-creator-canvas-library-login-required="true"
            >
              {t("creator.canvas.library.loginRequired")}
            </p>
          ) : status === "loading" ? (
            <div
              className="grid gap-3"
              aria-label={t("creator.canvas.library.loading")}
              data-creator-canvas-library-loading="true"
            >
              {Array.from({ length: 5 }, (_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800"
                />
              ))}
            </div>
          ) : status === "error" ? (
            <div
              className="rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
              role="alert"
              data-creator-canvas-library-error="true"
            >
              <p>{t("creator.canvas.library.loadFailed")}</p>
              <button
                type="button"
                className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-red-300 px-4 text-xs font-semibold transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:border-red-700 dark:hover:bg-red-950"
                onClick={retry}
                data-creator-canvas-library-retry="true"
              >
                {t("creator.canvas.persistence.retry")}
              </button>
            </div>
          ) : status === "empty" ? (
            <p
              className="rounded-2xl border border-dashed border-slate-300 px-5 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
              data-creator-canvas-library-empty="true"
            >
              {t("creator.canvas.library.empty")}
            </p>
          ) : (
            <div className="grid gap-3" role="list" data-creator-canvas-library-list="true">
              {visibleViewState.documents.map((document) => {
                const editing = renamingDocumentId === document.id;
                const deleting = deletingDocumentId === document.id;
                const duplicating = duplicatingDocumentId === document.id;
                const updatedAt = formatCanvasDate(document.updatedAt, locale);
                return (
                  <article
                    key={document.id}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                    role="listitem"
                    data-creator-canvas-library-document={document.id}
                  >
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <form
                          className="flex min-w-0 flex-wrap items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveRename(document);
                          }}
                          data-creator-canvas-library-rename-form="true"
                        >
                          <input
                            type="text"
                            className="min-h-11 min-w-[14rem] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:focus:border-indigo-400 dark:focus:ring-indigo-950"
                            value={renameDraft}
                            maxLength={CREATOR_CANVAS_TITLE_MAX_LENGTH}
                            aria-label={t("creator.canvas.library.renameInput")}
                            data-creator-canvas-library-rename-input="true"
                            onChange={(event) => {
                              setRenameDraft(
                                event.target.value.slice(0, CREATOR_CANVAS_TITLE_MAX_LENGTH)
                              );
                              setRenameError(null);
                            }}
                            autoFocus
                          />
                          <button
                            type="submit"
                            className="inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={renameSaving || deletingDocumentId !== null}
                            data-creator-canvas-library-rename-save="true"
                          >
                            {renameSaving
                              ? t("creator.canvas.library.renaming")
                              : t("creator.canvas.library.renameSave")}
                          </button>
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                            disabled={renameSaving}
                            onClick={cancelRename}
                            data-creator-canvas-library-rename-cancel="true"
                          >
                            {t("creator.canvas.library.renameCancel")}
                          </button>
                          {renameError ? (
                            <p
                              className="basis-full text-xs text-red-700 dark:text-red-300"
                              role="alert"
                              data-creator-canvas-library-rename-error="true"
                            >
                              {renameError === "conflict"
                                ? t("creator.canvas.library.renameConflict")
                                : t("creator.canvas.library.renameFailed")}
                            </p>
                          ) : null}
                        </form>
                      ) : (
                        <>
                          <h2 className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
                            {displayCanvasTitle(
                              document,
                              t("creator.canvas.persistence.untitled")
                            )}
                          </h2>
                          {updatedAt ? (
                            <time
                              className="mt-1 block text-xs text-slate-500 dark:text-slate-400"
                              dateTime={document.updatedAt}
                            >
                              {updatedAt}
                            </time>
                          ) : null}
                        </>
                      )}
                    </div>
                    {!editing ? (
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          disabled={mutationBusy}
                          onClick={() => void duplicateDocument(document)}
                          data-creator-canvas-library-duplicate="true"
                        >
                          <CopyIcon className="size-3.5" aria-hidden="true" />
                          {duplicating
                            ? t("creator.canvas.library.duplicating")
                            : t("creator.canvas.library.duplicate")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          disabled={mutationBusy}
                          onClick={() => beginRename(document)}
                          data-creator-canvas-library-rename="true"
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          {t("creator.canvas.persistence.rename")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={mutationBusy}
                          onClick={() => openDocument(document.id)}
                          data-creator-canvas-library-open="true"
                        >
                          <FolderOpen className="size-3.5" aria-hidden="true" />
                          {t("creator.canvas.persistence.open")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          disabled={mutationBusy}
                          onClick={() => void deleteDocument(document)}
                          data-creator-canvas-library-delete="true"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          {deleting
                            ? t("creator.canvas.library.deleting")
                            : t("creator.canvas.library.delete")}
                        </button>
                        {duplicateErrorDocumentId === document.id ? (
                          <p
                            className="basis-full text-xs text-red-700 dark:text-red-300"
                            role="alert"
                            data-creator-canvas-library-duplicate-error="true"
                          >
                            {t("creator.canvas.library.duplicateFailed")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
          {deleteError ? (
            <p
              className="mt-3 text-center text-xs text-red-700 dark:text-red-300"
              role="alert"
              data-creator-canvas-library-delete-error="true"
            >
              {t("creator.canvas.library.deleteFailed")}
            </p>
          ) : null}
        </section>

        {showPagination ? (
          <nav
            className="flex items-center justify-center gap-3"
            aria-label={t("creator.canvas.library.page", {
              page: visibleViewState.page,
              totalPages: visibleViewState.totalPages
            })}
            data-creator-canvas-library-pagination="true"
          >
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={t("creator.canvas.library.previous")}
              disabled={currentPage <= 1 || mutationBusy}
              onClick={() => goToPage(currentPage - 1)}
              data-creator-canvas-library-previous="true"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              {t("creator.canvas.library.previous")}
            </button>
            <span
              className="text-xs font-medium text-slate-500 dark:text-slate-400"
              data-creator-canvas-library-page-label="true"
            >
              {paginationLabel}
            </span>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={t("creator.canvas.library.next")}
              disabled={currentPage >= visibleViewState.totalPages || mutationBusy}
              onClick={() => goToPage(currentPage + 1)}
              data-creator-canvas-library-next="true"
            >
              {t("creator.canvas.library.next")}
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </nav>
        ) : null}
      </div>
    </main>
  );
}
