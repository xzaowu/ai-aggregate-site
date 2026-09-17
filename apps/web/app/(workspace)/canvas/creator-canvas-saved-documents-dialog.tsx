"use client";

import type { CreatorCanvasDocumentSummary } from "@ai-aggregate/shared";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../lib/site-config";

type SavedDocumentsState =
  | "idle"
  | "unauthenticated"
  | "loading"
  | "error"
  | "empty"
  | "ready";

interface SavedDocumentsViewState {
  status: SavedDocumentsState;
  documents: CreatorCanvasDocumentSummary[];
}

export const CREATOR_CANVAS_TITLE_MAX_LENGTH = 200;

export type CreatorCanvasDocumentRenameResult =
  | { ok: true; document: CreatorCanvasDocumentSummary }
  | { ok: false; reason: "conflict" | "error" };

export interface CreatorCanvasSavedDocumentsDialogProps {
  isOpen: boolean;
  token: string | null;
  actionsDisabled?: boolean;
  onClose: () => void;
  onOpenDocument: (documentId: string) => void;
  onRenameDocument: (
    documentId: string,
    expectedRevision: number,
    title: string | null
  ) => Promise<CreatorCanvasDocumentRenameResult>;
  onDeleteDocument: (documentId: string) => Promise<boolean>;
  onViewAllCanvases?: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSavedDocuments(value: unknown): CreatorCanvasDocumentSummary[] {
  if (!isRecord(value) || !Array.isArray(value.documents)) {
    throw new Error("CREATOR_CANVAS_DOCUMENT_LIST_INVALID");
  }
  return value.documents.filter((document): document is CreatorCanvasDocumentSummary => {
    if (!isRecord(document)) return false;
    return (
      typeof document.id === "string" &&
      document.id.trim().length > 0 &&
      (document.title === null || typeof document.title === "string") &&
      typeof document.revision === "number" &&
      Number.isSafeInteger(document.revision) &&
      document.revision > 0 &&
      typeof document.createdAt === "string" &&
      document.createdAt.trim().length > 0 &&
      typeof document.updatedAt === "string" &&
      document.updatedAt.trim().length > 0
    );
  });
}

function formatSavedDocumentDate(value: string, locale: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(locale).format(new Date(timestamp));
}

function savedDocumentTitle(
  document: CreatorCanvasDocumentSummary,
  fallback: string
): string {
  const title = document.title?.trim() ?? "";
  return title || fallback;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

export function CreatorCanvasSavedDocumentsDialog({
  isOpen,
  token,
  actionsDisabled = false,
  onClose,
  onOpenDocument,
  onRenameDocument,
  onDeleteDocument,
  onViewAllCanvases
}: CreatorCanvasSavedDocumentsDialogProps) {
  const { locale, t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const [viewState, setViewState] = useState<SavedDocumentsViewState>({
    status: "idle",
    documents: []
  });
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<"conflict" | "error" | null>(null);

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

  const loadDocuments = useCallback(() => {
    const authToken = token?.trim() ?? "";
    if (!isOpen || !authToken) return;

    requestControllerRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setDeleteError(false);
    setViewState({ status: "loading", documents: [] });

    void fetch(apiUrl("/canvas/documents?limit=50"), {
      method: "GET",
      headers: { Authorization: `Bearer ${authToken}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("CREATOR_CANVAS_DOCUMENT_LIST_UNAVAILABLE");
        return parseSavedDocuments(await response.json() as unknown);
      })
      .then((documents) => {
        if (requestIdRef.current !== requestId) return;
        setViewState({
          status: documents.length > 0 ? "ready" : "empty",
          documents
        });
      })
      .catch((error: unknown) => {
        if (
          requestIdRef.current !== requestId ||
          isAbortError(error) ||
          controller.signal.aborted
        ) {
          return;
        }
        setViewState({ status: "error", documents: [] });
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          requestControllerRef.current = null;
        }
      });
  }, [isOpen, token]);

  useEffect(() => {
    if (!isOpen) {
      invalidateRequest();
      setViewState({ status: "idle", documents: [] });
      setDeletingDocumentId(null);
      setDeleteError(false);
      setRenamingDocumentId(null);
      setRenameDraft("");
      setRenameSaving(false);
      setRenameError(null);
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
      setViewState({ status: "unauthenticated", documents: [] });
      setRenamingDocumentId(null);
      setRenameDraft("");
      setRenameSaving(false);
      setRenameError(null);
      return;
    }

    loadDocuments();
    return () => invalidateRequest();
  }, [
    invalidateRequest,
    isOpen,
    loadDocuments,
    returnFocusToOpener,
    token
  ]);

  useEffect(() => () => {
    invalidateRequest();
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    returnFocusToOpener();
  }, [invalidateRequest, returnFocusToOpener]);

  const requestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleDelete = useCallback(async (documentId: string) => {
    setDeletingDocumentId(documentId);
    setDeleteError(false);
    const deleted = await onDeleteDocument(documentId);
    if (deleted) {
      setViewState((current) => {
        const documents = current.documents.filter(
          (document) => document.id !== documentId
        );
        return {
          status: documents.length > 0 ? "ready" : "empty",
          documents
        };
      });
    } else {
      setDeleteError(true);
    }
    setDeletingDocumentId(null);
  }, [onDeleteDocument]);

  const beginRename = useCallback((document: CreatorCanvasDocumentSummary) => {
    setRenamingDocumentId(document.id);
    setRenameDraft(document.title?.trim() ?? "");
    setRenameError(null);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingDocumentId(null);
    setRenameDraft("");
    setRenameError(null);
  }, []);

  const handleRename = useCallback(async (
    document: CreatorCanvasDocumentSummary
  ) => {
    if (
      actionsDisabled ||
      renameSaving ||
      renamingDocumentId !== document.id
    ) {
      return;
    }

    setRenameSaving(true);
    setRenameError(null);
    try {
      const result = await onRenameDocument(
        document.id,
        document.revision,
        renameDraft.trim() || null
      );
      if (!result.ok) {
        setRenameError(result.reason);
        return;
      }
      setViewState((current) => ({
        ...current,
        documents: current.documents.map((candidate) =>
          candidate.id === result.document.id ? result.document : candidate
        )
      }));
      cancelRename();
    } catch {
      setRenameError("error");
    } finally {
      setRenameSaving(false);
    }
  }, [
    actionsDisabled,
    cancelRename,
    onRenameDocument,
    renameDraft,
    renameSaving,
    renamingDocumentId
  ]);

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-labelledby="creator-canvas-saved-documents-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] max-w-none rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl shadow-slate-950/20 outline-none [&::backdrop]:bg-slate-950/50 [&::backdrop]:backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      data-creator-canvas-saved-documents-dialog="true"
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
              id="creator-canvas-saved-documents-title"
              className="text-base font-semibold"
            >
              {t("creator.canvas.persistence.openTitle")}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t("creator.canvas.persistence.openDescription")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onViewAllCanvases ? (
              <button
                type="button"
                className="inline-flex min-h-10 items-center rounded-xl px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950"
                disabled={actionsDisabled || !token?.trim()}
                data-creator-canvas-saved-documents-view-all="true"
                onClick={onViewAllCanvases}
              >
                {t("creator.canvas.persistence.viewAll")}
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex min-h-10 items-center rounded-xl px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={t("creator.canvas.persistence.close")}
              data-creator-canvas-saved-documents-close="true"
              onClick={requestClose}
            >
              {t("creator.canvas.persistence.close")}
            </button>
          </div>
        </header>

        <div
          className="min-h-0 overflow-y-auto px-5 py-5"
          data-creator-canvas-saved-documents-state={viewState.status}
        >
          {viewState.status === "unauthenticated" ? (
            <p
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              data-creator-canvas-saved-documents-login-required="true"
            >
              {t("creator.canvas.persistence.loginRequired")}
            </p>
          ) : viewState.status === "loading" ? (
            <div
              className="grid gap-3"
              aria-label={t("creator.canvas.persistence.loading")}
              data-creator-canvas-saved-documents-loading="true"
            >
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          ) : viewState.status === "error" ? (
            <div
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-center text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
              data-creator-canvas-saved-documents-error="true"
              role="alert"
            >
              <p>{t("creator.canvas.persistence.loadFailed")}</p>
              <button
                type="button"
                className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-red-300 px-4 text-xs font-semibold transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:border-red-700 dark:hover:bg-red-950"
                data-creator-canvas-saved-documents-retry="true"
                onClick={loadDocuments}
              >
                {t("creator.canvas.persistence.retry")}
              </button>
            </div>
          ) : viewState.status === "empty" ? (
            <p
              className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
              data-creator-canvas-saved-documents-empty="true"
            >
              {t("creator.canvas.persistence.empty")}
            </p>
          ) : viewState.status === "ready" ? (
            <div className="grid gap-3" role="list" data-creator-canvas-saved-documents-list="true">
              {viewState.documents.map((document) => {
                const updatedAt = formatSavedDocumentDate(document.updatedAt, locale);
                const busy = deletingDocumentId === document.id;
                const editing = renamingDocumentId === document.id;
                return (
                  <article
                    key={document.id}
                    className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                    role="listitem"
                    data-creator-canvas-saved-document-item="true"
                  >
                    <div className="min-w-0">
                      {editing ? (
                        <form
                          className="flex min-w-0 flex-wrap items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleRename(document);
                          }}
                          data-creator-canvas-saved-document-rename-form="true"
                        >
                          <input
                            type="text"
                            className="min-h-10 min-w-[12rem] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:focus:border-indigo-400 dark:focus:ring-indigo-950"
                            value={renameDraft}
                            maxLength={CREATOR_CANVAS_TITLE_MAX_LENGTH}
                            aria-label={t("creator.canvas.persistence.renameInput")}
                            data-creator-canvas-saved-document-rename-input="true"
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
                            className="inline-flex min-h-10 items-center rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={actionsDisabled || renameSaving}
                            data-creator-canvas-saved-document-rename-save="true"
                          >
                            {renameSaving
                              ? t("creator.canvas.persistence.renaming")
                              : t("creator.canvas.persistence.renameSave")}
                          </button>
                          <button
                            type="button"
                            className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                            disabled={renameSaving}
                            data-creator-canvas-saved-document-rename-cancel="true"
                            onClick={cancelRename}
                          >
                            {t("creator.canvas.persistence.renameCancel")}
                          </button>
                          {renameError ? (
                            <p
                              className="basis-full text-xs text-red-700 dark:text-red-300"
                              role="alert"
                              data-creator-canvas-saved-documents-rename-error="true"
                            >
                              {renameError === "conflict"
                                ? t("creator.canvas.persistence.renameConflict")
                                : t("creator.canvas.persistence.renameFailed")}
                            </p>
                          ) : null}
                        </form>
                      ) : (
                        <>
                          <h3 className="truncate text-sm font-semibold">
                            {savedDocumentTitle(
                              document,
                              t("creator.canvas.persistence.untitled")
                            )}
                          </h3>
                          {updatedAt ? (
                            <time
                              className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500"
                              dateTime={document.updatedAt}
                            >
                              {updatedAt}
                            </time>
                          ) : null}
                        </>
                      )}
                    </div>
                    {!editing ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          disabled={actionsDisabled || busy || renamingDocumentId !== null}
                          data-creator-canvas-saved-document-rename="true"
                          onClick={() => beginRename(document)}
                        >
                          {t("creator.canvas.persistence.rename")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-10 items-center rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={actionsDisabled || busy || renamingDocumentId !== null}
                          data-creator-canvas-saved-document-open="true"
                          onClick={() => onOpenDocument(document.id)}
                        >
                          {t("creator.canvas.persistence.open")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          disabled={actionsDisabled || busy || renamingDocumentId !== null}
                          data-creator-canvas-saved-document-delete="true"
                          onClick={() => void handleDelete(document.id)}
                        >
                          {busy
                            ? t("creator.canvas.persistence.deleting")
                            : t("creator.canvas.persistence.delete")}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
          {deleteError ? (
            <p
              className="mt-3 text-center text-xs text-red-700 dark:text-red-300"
              role="alert"
              data-creator-canvas-saved-documents-delete-error="true"
            >
              {t("creator.canvas.persistence.deleteFailed")}
            </p>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
