// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../lib/site-config";
import { CreatorCanvasSavedDocumentsDialog } from "./creator-canvas-saved-documents-dialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setInputValue(element: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    element,
    value
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let originalShowModal: PropertyDescriptor | undefined;
let originalClose: PropertyDescriptor | undefined;
let dialogMocks: { showModal: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } | null = null;

function installDialogMocks() {
  originalShowModal = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal"
  );
  originalClose = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close"
  );
  const showModal = vi.fn(function(this: HTMLDialogElement) {
    this.open = true;
  });
  const close = vi.fn(function(this: HTMLDialogElement) {
    this.open = false;
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: showModal
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: close
  });
  dialogMocks = { showModal, close };
}

function restoreDialogMocks() {
  if (originalShowModal) {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  } else {
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  }
  if (originalClose) {
    Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  } else {
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  }
  dialogMocks = null;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof CreatorCanvasSavedDocumentsDialog>> = {}
) {
  return (
    <I18nContext.Provider
      value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
    >
      <CreatorCanvasSavedDocumentsDialog
      isOpen
      token="owner-token"
      onClose={vi.fn()}
      onOpenDocument={vi.fn()}
      onRenameDocument={vi.fn(async () => ({ ok: false as const, reason: "error" as const }))}
      onDeleteDocument={vi.fn(async () => true)}
        {...props}
      />
    </I18nContext.Provider>
  );
}

function getDialog(): HTMLDialogElement {
  const dialog = host?.querySelector<HTMLDialogElement>(
    '[data-creator-canvas-saved-documents-dialog="true"]'
  );
  if (!dialog) throw new Error("SAVED_DOCUMENTS_DIALOG_MISSING");
  return dialog;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  restoreDialogMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

beforeEach(() => {
  installDialogMocks();
});

describe("CreatorCanvasSavedDocumentsDialog", () => {
  it("does not request saved documents without an authenticated token", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(renderDialog({ token: null })));
    await flushEffects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDialog().open).toBe(true);
    expect(host.textContent).toContain("Login required");
  });

  it("loads the owner summary list and supports open/delete actions", async () => {
    const onOpenDocument = vi.fn();
    const onDeleteDocument = vi.fn(async () => true);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      documents: [
        {
          id: "canvas-secret-id",
          title: null,
          revision: 2,
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-02T10:00:00.000Z"
        }
      ]
    }));
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(renderDialog({ onOpenDocument, onDeleteDocument }));
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      apiUrl("/canvas/documents?limit=50"),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer owner-token" },
        signal: expect.any(AbortSignal)
      })
    );
    expect(host.textContent).toContain("Untitled Canvas");
    expect(host.textContent).not.toContain("canvas-secret-id");

    const open = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-open="true"]'
    );
    const remove = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-delete="true"]'
    );
    if (!open || !remove) throw new Error("SAVED_DOCUMENT_ACTION_MISSING");
    await act(async () => open.click());
    await act(async () => remove.click());
    expect(onOpenDocument).toHaveBeenCalledWith("canvas-secret-id");
    expect(onDeleteDocument).toHaveBeenCalledWith("canvas-secret-id");
    await flushEffects();
    expect(host.querySelector('[data-creator-canvas-saved-documents-empty="true"]'))
      .toBeTruthy();
  });

  it("renames a saved document inline, bounds the client input, and updates the row", async () => {
    const current = {
      id: "current-canvas",
      title: "Current Canvas",
      revision: 8,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z"
    };
    const original = {
      id: "canvas-to-rename",
      title: "Original Canvas",
      revision: 4,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z"
    };
    const updated = {
      ...original,
      title: "Renamed Canvas",
      revision: 5,
      updatedAt: "2026-09-02T11:00:00.000Z"
    };
    const onOpenDocument = vi.fn();
    const onRenameDocument = vi.fn(async (
      documentId: string,
      expectedRevision: number,
      title: string | null
    ) => {
      expect({ documentId, expectedRevision, title }).toEqual({
        documentId: original.id,
        expectedRevision: original.revision,
        title: "Renamed Canvas"
      });
      return { ok: true as const, document: updated };
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ documents: [current, original] })
    );
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(renderDialog({ onOpenDocument, onRenameDocument }));
    });
    await flushEffects();

    const rename = Array.from(host.querySelectorAll<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename="true"]'
    )).at(-1);
    if (!rename) throw new Error("SAVED_DOCUMENT_RENAME_MISSING");
    await act(async () => rename.click());
    const input = host.querySelector<HTMLInputElement>(
      '[data-creator-canvas-saved-document-rename-input="true"]'
    );
    const cancel = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename-cancel="true"]'
    );
    if (!input || !cancel) throw new Error("SAVED_DOCUMENT_RENAME_FORM_MISSING");
    expect(input.maxLength).toBe(200);
    await act(async () => {
      setInputValue(input, `${"x".repeat(250)}`);
      setInputValue(input, "Renamed Canvas");
    });
    const save = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename-save="true"]'
    );
    if (!save) throw new Error("SAVED_DOCUMENT_RENAME_SAVE_MISSING");
    await act(async () => save.click());
    await flushEffects();

    expect(onRenameDocument).toHaveBeenCalledTimes(1);
    expect(onOpenDocument).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Current Canvas");
    expect(host.textContent).toContain("Renamed Canvas");
    expect(host.textContent).not.toContain("Original Canvas");

    const renameAgain = Array.from(host.querySelectorAll<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename="true"]'
    )).find((button) => button.closest(
      '[data-creator-canvas-saved-document-item="true"]'
    )?.textContent?.includes("Renamed Canvas"));
    if (!renameAgain) throw new Error("SAVED_DOCUMENT_RENAME_AGAIN_MISSING");
    await act(async () => renameAgain.click());
    const cancelAgain = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename-cancel="true"]'
    );
    if (!cancelAgain) throw new Error("SAVED_DOCUMENT_RENAME_CANCEL_MISSING");
    await act(async () => cancelAgain.click());
    expect(onRenameDocument).toHaveBeenCalledTimes(1);
  });

  it("sends an empty inline title as null and reports a server conflict truthfully", async () => {
    const documentSummary = {
      id: "canvas-empty-title",
      title: "Named Canvas",
      revision: 2,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z"
    };
    const onRenameDocument = vi.fn(async (
      _documentId: string,
      _expectedRevision: number,
      title: string | null
    ) => {
      expect(title).toBeNull();
      return { ok: false as const, reason: "conflict" as const };
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ documents: [documentSummary] })
    );
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(renderDialog({ onRenameDocument }));
    });
    await flushEffects();

    const rename = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename="true"]'
    );
    if (!rename) throw new Error("SAVED_DOCUMENT_RENAME_MISSING");
    await act(async () => rename.click());
    const input = host.querySelector<HTMLInputElement>(
      '[data-creator-canvas-saved-document-rename-input="true"]'
    );
    const save = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename-save="true"]'
    );
    if (!input || !save) throw new Error("SAVED_DOCUMENT_RENAME_FORM_MISSING");
    await act(async () => setInputValue(input, "   "));
    await act(async () => save.click());
    await flushEffects();
    expect(host.querySelector('[data-creator-canvas-saved-documents-rename-error="true"]')
      ?.textContent).toContain("updated elsewhere");
    expect(host.querySelector('[data-creator-canvas-saved-document-rename-input="true"]'))
      .toBeTruthy();
  });

  it("keeps rename controls fenced while persistence actions are disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      documents: [{
        id: "canvas-active",
        title: "Active Canvas",
        revision: 1,
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z"
      }]
    }));
    const onRenameDocument = vi.fn(async () => ({
      ok: true as const,
      document: {
        id: "canvas-active",
        title: "Should not happen",
        revision: 2,
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onViewAllCanvases = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(renderDialog({
        actionsDisabled: true,
        onRenameDocument,
        onViewAllCanvases
      }));
    });
    await flushEffects();
    const rename = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename="true"]'
    );
    if (!rename) throw new Error("SAVED_DOCUMENT_RENAME_MISSING");
    expect(rename.disabled).toBe(true);
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-documents-view-all="true"]'
    )?.disabled).toBe(true);
    await act(async () => rename.click());
    expect(onRenameDocument).not.toHaveBeenCalled();
    expect(onViewAllCanvases).not.toHaveBeenCalled();
  });

  it("offers View all canvases as a native action", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ documents: [] }));
    const onViewAllCanvases = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(renderDialog({ onViewAllCanvases }));
    });
    await flushEffects();

    const viewAll = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-documents-view-all="true"]'
    );
    if (!viewAll) throw new Error("SAVED_DOCUMENTS_VIEW_ALL_MISSING");
    await act(async () => viewAll.click());
    expect(onViewAllCanvases).toHaveBeenCalledTimes(1);
  });

  it("shows an error and retries only after an explicit action", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ documents: [] }));
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(renderDialog()));
    await flushEffects();

    expect(host.querySelector('[data-creator-canvas-saved-documents-state="error"]'))
      .toBeTruthy();
    const retry = host.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-documents-retry="true"]'
    );
    if (!retry) throw new Error("SAVED_DOCUMENT_RETRY_MISSING");
    await act(async () => retry.click());
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-creator-canvas-saved-documents-empty="true"]'))
      .toBeTruthy();
  });

  it("uses the native dialog lifecycle and returns focus to the exact opener", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ documents: [] }));
    vi.stubGlobal("fetch", fetchMock);

    function Harness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button type="button" data-saved-opener="true" onClick={() => setIsOpen(true)}>
            Open saved
          </button>
          <I18nContext.Provider
            value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
          >
            <CreatorCanvasSavedDocumentsDialog
              isOpen={isOpen}
              token="owner-token"
              onClose={() => setIsOpen(false)}
              onOpenDocument={vi.fn()}
              onRenameDocument={vi.fn(async () => ({ ok: false as const, reason: "error" as const }))}
              onDeleteDocument={vi.fn(async () => true)}
            />
          </I18nContext.Provider>
        </>
      );
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<Harness />));
    const opener = host.querySelector<HTMLButtonElement>('[data-saved-opener="true"]');
    if (!opener) throw new Error("SAVED_DOCUMENT_OPENER_MISSING");
    opener.focus();
    await act(async () => opener.click());
    await flushEffects();

    const dialog = getDialog();
    expect(dialogMocks?.showModal).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      "creator-canvas-saved-documents-title"
    );

    await act(async () => {
      dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    });
    await flushEffects();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("aborts a stale list request when closing", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(renderDialog()));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => root?.render(renderDialog({ isOpen: false })));
    await flushEffects();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(jsonResponse({ documents: [] })));
    await flushEffects();
    expect(host.querySelector('[data-creator-canvas-saved-documents-state="ready"]'))
      .toBeNull();
  });
});
