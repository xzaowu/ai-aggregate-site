// @vitest-environment jsdom

import type { AuthUser } from "@ai-aggregate/shared";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../../lib/i18n/use-i18n";
import {
  CreatorCanvasLibraryPageContent,
  CREATOR_CANVAS_LIBRARY_PAGE_SIZE
} from "./creator-canvas-library-page-content";
import { CREATOR_CANVAS_TITLE_MAX_LENGTH } from "../creator-canvas-saved-documents-dialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type Session = { token: string; user: AuthUser } | null;

const libraryContextState = vi.hoisted(() => ({
  session: null as Session | null,
  authStatus: "guest" as "unknown" | "guest" | "authenticated"
}));
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock })
}));

vi.mock("../../../../components/workspace/workspace-shell-context", () => ({
  useOptionalWorkspaceShellContext: () => ({
    shell: {
      authStatus: libraryContextState.authStatus,
      token: libraryContextState.session?.token ?? null,
      user: libraryContextState.session?.user ?? null
    }
  })
}));

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

function summary(
  id: string,
  title: string | null,
  revision = 1
) {
  return {
    id,
    title,
    revision,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z"
  };
}

function pageResponse(
  documents: ReturnType<typeof summary>[],
  page = 1,
  total = documents.length,
  totalPages = Math.max(1, Math.ceil(total / CREATOR_CANVAS_LIBRARY_PAGE_SIZE))
) {
  return {
    documents,
    page,
    pageSize: CREATOR_CANVAS_LIBRARY_PAGE_SIZE,
    total,
    totalPages
  };
}

function documentResponse(
  document: ReturnType<typeof summary>,
  state: unknown = { schemaVersion: 1, nodes: [], edges: [] }
) {
  return {
    document: {
      ...document,
      state
    }
  };
}

function requestBody(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  callIndex: number
): Record<string, unknown> {
  const body = fetchMock.mock.calls[callIndex]?.[1]?.body;
  if (typeof body !== "string") throw new Error("CANVAS_LIBRARY_REQUEST_BODY_MISSING");
  return JSON.parse(body) as Record<string, unknown>;
}

function setInputValue(element: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    element,
    value
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function libraryDocumentElement(documentId: string): HTMLElement {
  const element = Array.from(
    host?.querySelectorAll<HTMLElement>("[data-creator-canvas-library-document]") ?? []
  ).find((candidate) => candidate.dataset.creatorCanvasLibraryDocument === documentId);
  if (!element) throw new Error("CANVAS_LIBRARY_DOCUMENT_MISSING:" + documentId);
  return element;
}

function libraryDocumentButton(
  documentId: string,
  action: string
): HTMLButtonElement {
  const button = libraryDocumentElement(documentId).querySelector<HTMLButtonElement>(
    "[data-creator-canvas-library-" + action + "='true']"
  );
  if (!button) throw new Error("CANVAS_LIBRARY_BUTTON_MISSING:" + documentId + ":" + action);
  return button;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let setSessionForTest: ((session: Session) => void) | null = null;

function SessionHarness({
  initialSession,
  initialAuthStatus,
  children
}: {
  initialSession: Session;
  initialAuthStatus?: "unknown" | "guest" | "authenticated";
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<Session>(initialSession);
  libraryContextState.session = session;
  libraryContextState.authStatus = initialAuthStatus ?? (session ? "authenticated" : "guest");
  setSessionForTest = setSession;
  return <>{React.cloneElement(children as React.ReactElement)}</>;
}

function authenticatedSession(id = "owner-a", token = "owner-a-token"): Session {
  return {
    token,
    user: {
      id,
      email: `${id}@example.test`,
      role: "USER",
      credits: 20,
      name: id
    }
  };
}

async function mount(
  fetchImplementation: typeof fetch,
  initialSession: Session = authenticatedSession(),
  locale: "en-US" | "zh-CN" = "en-US",
  initialAuthStatus?: "unknown" | "guest" | "authenticated"
): Promise<void> {
  vi.stubGlobal("fetch", fetchImplementation);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nContext.Provider
        value={{ locale, setLocale: vi.fn(), t: createTranslator(locale) }}
      >
        <SessionHarness initialSession={initialSession} initialAuthStatus={initialAuthStatus}>
          <CreatorCanvasLibraryPageContent />
        </SessionHarness>
      </I18nContext.Provider>
    );
  });
}

function getState(): HTMLElement {
  const state = host?.querySelector<HTMLElement>(
    "[data-creator-canvas-library-state]"
  );
  if (!state) throw new Error("CANVAS_LIBRARY_STATE_MISSING");
  return state;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  setSessionForTest = null;
  libraryContextState.session = null;
  libraryContextState.authStatus = "guest";
  routerPushMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

beforeEach(() => {
  libraryContextState.session = null;
  libraryContextState.authStatus = "guest";
});

describe("CreatorCanvasLibraryPageContent", () => {
  it("does not request a private list for a guest and keeps New on the editor route", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await mount(fetchMock, null);
    await flushEffects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("unauthenticated");
    expect(host?.querySelector("[data-creator-canvas-library-duplicate='true']")).toBeNull();
    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-creator-canvas-library-new='true']")?.click();
    });
    expect(routerPushMock).toHaveBeenCalledWith("/canvas");
  });

  it("loads summary pages, renders the Untitled fallback, and opens an encoded editor URL", async () => {
    const documents = [
      ...Array.from({ length: 20 }, (_, index) =>
        summary(`canvas-${index}`, index === 0 ? null : `Canvas ${index}`)
      )
    ];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse(documents, 1, 21, 2)))
      .mockResolvedValueOnce(jsonResponse(pageResponse([
        summary("canvas/last", "Last Canvas")
      ], 2, 21, 2)));
    await mount(fetchMock);
    await flushEffects();

    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("ready");
    expect(host?.textContent).toContain("Untitled Canvas");
    expect(host?.textContent).toContain("Canvas 1");
    expect(host?.textContent).not.toContain("schemaVersion");
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `/canvas/documents?page=1&pageSize=${CREATOR_CANVAS_LIBRARY_PAGE_SIZE}`
    );
    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-creator-canvas-library-next='true']")?.click();
    });
    await flushEffects();
    expect(host?.textContent).toContain("Last Canvas");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-creator-canvas-library-open='true']")?.click();
    });
    expect(routerPushMock).toHaveBeenCalledWith("/canvas?canvasId=canvas%2Flast");
  });

  it("exposes loading, empty, error, and explicit retry states", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    await mount(fetchMock);
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("loading");
    expect(host?.querySelector("[data-creator-canvas-library-duplicate='true']")).toBeNull();
    await act(async () => pending.resolve(jsonResponse(pageResponse([]))));
    await flushEffects();
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("empty");

    const errorFetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse(pageResponse([summary("retry", "Retry Canvas")])))
      ;
    await act(async () => {
      root?.unmount();
      root = null;
    });
    host?.remove();
    host = null;
    await mount(errorFetchMock);
    await flushEffects();
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("error");
    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-creator-canvas-library-retry='true']")?.click();
    });
    await flushEffects();
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("ready");
    expect((host as HTMLDivElement | null)?.textContent).toContain("Retry Canvas");
    expect(errorFetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not expose Duplicate while auth is unknown", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await mount(fetchMock, authenticatedSession(), "en-US", "unknown");
    await flushEffects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("loading");
    expect(host?.querySelector("[data-creator-canvas-library-duplicate='true']")).toBeNull();
  });

  it("duplicates from fresh owner detail and opens the returned Canvas identity", async () => {
    const source = summary("source/canvas", "Stale list title", 7);
    const fresh = summary("source/canvas", "Fresh detail title", 9);
    const state = {
      schemaVersion: 1,
      nodes: [
        { id: "image-1", type: "image", data: { assetId: "asset-private-1" } },
        { id: "video-1", type: "video", data: { assetId: "asset-private-2" } }
      ],
      edges: [],
      imageComposerDrafts: {
        "image-1": {
          prompt: "preserved draft",
          modelId: "image-model",
          aspectRatio: "1:1",
          count: 1,
          operation: "generate",
          promptDirty: true
        }
      }
    };
    const created = summary("new/canvas", "Fresh detail title · Copy", 1);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([source])))
      .mockResolvedValueOnce(jsonResponse(documentResponse(fresh, state)))
      .mockResolvedValueOnce(jsonResponse(documentResponse(created, state), 201));

    await mount(fetchMock);
    await flushEffects();
    expect(host?.textContent).toContain("Duplicate");

    await act(async () => {
      libraryDocumentButton("source/canvas", "duplicate").click();
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      "/canvas/documents/source%2Fcanvas"
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer owner-a-token" }
    }));
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/canvas/documents");
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer owner-a-token",
        "Content-Type": "application/json"
      }
    }));
    const body = requestBody(fetchMock, 2);
    expect(Object.keys(body).sort()).toEqual(["state", "title"]);
    expect(body.state).toEqual(state);
    expect(body.title).toBe("Fresh detail title · Copy");
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("revision");
    expect(body).not.toHaveProperty("createdAt");
    expect(body).not.toHaveProperty("updatedAt");
    expect(body).not.toHaveProperty("expectedRevision");
    expect(body).not.toHaveProperty("sourceId");
    expect(body).not.toHaveProperty("duplicateOf");
    expect(routerPushMock).toHaveBeenCalledWith(
      "/canvas?canvasId=new%2Fcanvas"
    );
    expect(libraryDocumentElement("source/canvas")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });

  it("uses the localized copy suffix and Untitled fallback for null or blank detail titles", async () => {
    const first = summary("null-source", "Stale title");
    const second = summary("blank-source", "Another stale title");
    const firstCopy = summary("null-copy", "Untitled Canvas · Copy");
    const secondCopy = summary("blank-copy", "Untitled Canvas · Copy");
    const state = { schemaVersion: 1, nodes: [], edges: [] };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([first, second])))
      .mockResolvedValueOnce(jsonResponse(documentResponse(
        summary("null-source", null),
        state
      )))
      .mockResolvedValueOnce(jsonResponse(documentResponse(firstCopy, state), 201))
      .mockResolvedValueOnce(jsonResponse(documentResponse(
        summary("blank-source", "   "),
        state
      )))
      .mockResolvedValueOnce(jsonResponse(documentResponse(secondCopy, state), 201));

    await mount(fetchMock);
    await flushEffects();
    await act(async () => {
      libraryDocumentButton("null-source", "duplicate").click();
    });
    await flushEffects();
    await act(async () => {
      libraryDocumentButton("blank-source", "duplicate").click();
    });
    await flushEffects();

    expect(requestBody(fetchMock, 2).title).toBe("Untitled Canvas · Copy");
    expect(requestBody(fetchMock, 4).title).toBe("Untitled Canvas · Copy");
    expect(routerPushMock).toHaveBeenNthCalledWith(
      1,
      "/canvas?canvasId=null-copy"
    );
    expect(routerPushMock).toHaveBeenNthCalledWith(
      2,
      "/canvas?canvasId=blank-copy"
    );
  });

  it("derives the Chinese localized copy title", async () => {
    const source = summary("zh-source", "营销画布");
    const state = { schemaVersion: 1, nodes: [], edges: [] };
    const created = summary("zh-copy", "营销画布 · 副本");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([source])))
      .mockResolvedValueOnce(jsonResponse(documentResponse(source, state)))
      .mockResolvedValueOnce(jsonResponse(documentResponse(created, state), 201));

    await mount(fetchMock, authenticatedSession(), "zh-CN");
    await flushEffects();
    expect(host?.textContent).toContain("创建副本");
    await act(async () => {
      libraryDocumentButton("zh-source", "duplicate").click();
    });
    await flushEffects();

    expect(requestBody(fetchMock, 2).title).toBe("营销画布 · 副本");
  });

  it("keeps the localized copy suffix within the existing title limit", async () => {
    const sourceTitle = "X".repeat(CREATOR_CANVAS_TITLE_MAX_LENGTH + 60);
    const source = summary("long-source", sourceTitle);
    const state = { schemaVersion: 1, nodes: [], edges: [] };
    const created = summary("long-copy", "ignored");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([source])))
      .mockResolvedValueOnce(jsonResponse(documentResponse(source, state)))
      .mockResolvedValueOnce(jsonResponse(documentResponse(created, state), 201));

    await mount(fetchMock);
    await flushEffects();
    await act(async () => {
      libraryDocumentButton("long-source", "duplicate").click();
    });
    await flushEffects();

    const title = requestBody(fetchMock, 2).title;
    if (typeof title !== "string") throw new Error("CANVAS_LIBRARY_COPY_TITLE_MISSING");
    expect(title.length).toBeLessThanOrEqual(CREATOR_CANVAS_TITLE_MAX_LENGTH);
    expect(title.endsWith(" · Copy")).toBe(true);
    expect(title).toBe(
      "X".repeat(CREATOR_CANVAS_TITLE_MAX_LENGTH - "· Copy".length - 1) + " · Copy"
    );
  });

  it("keeps one GET-to-POST duplicate chain and disables competing library actions while busy", async () => {
    const source = summary("duplicate-source", "Source Canvas");
    const documents = [
      source,
      ...Array.from({ length: 19 }, (_, index) =>
        summary("canvas-" + index, "Canvas " + index)
      )
    ];
    const pendingDetail = deferred<Response>();
    const state = { schemaVersion: 1, nodes: [], edges: [] };
    const created = summary("duplicate-copy", "Source Canvas · Copy");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse(documents, 1, 21, 2)))
      .mockReturnValueOnce(pendingDetail.promise)
      .mockResolvedValueOnce(jsonResponse(documentResponse(created, state), 201));

    await mount(fetchMock);
    await flushEffects();
    const duplicate = libraryDocumentButton("duplicate-source", "duplicate");
    await act(async () => {
      duplicate.click();
      duplicate.click();
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(duplicate.disabled).toBe(true);
    expect(duplicate.textContent).toContain("Duplicating");
    expect(libraryDocumentButton("duplicate-source", "rename").disabled).toBe(true);
    expect(libraryDocumentButton("duplicate-source", "open").disabled).toBe(true);
    expect(libraryDocumentButton("duplicate-source", "delete").disabled).toBe(true);
    expect(host?.querySelector<HTMLButtonElement>(
      "[data-creator-canvas-library-new='true']"
    )?.disabled).toBe(true);
    expect(host?.querySelector<HTMLButtonElement>(
      "[data-creator-canvas-library-next='true']"
    )?.disabled).toBe(true);

    await act(async () => {
      pendingDetail.resolve(jsonResponse(documentResponse(source, state)));
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer owner-a-token" }
    }));
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "POST"
    }));
    expect(routerPushMock).toHaveBeenCalledWith(
      "/canvas?canvasId=duplicate-copy"
    );
  });

  it("keeps the source list unchanged and reports detail validation failures without POST", async () => {
    const documents = [
      summary("not-found", "Not Found"),
      summary("server-error", "Server Error"),
      summary("malformed", "Malformed"),
      summary("missing-state", "Missing State"),
      summary("network-error", "Network Error")
    ];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse(documents)))
      .mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: "failed" }, 500))
      .mockResolvedValueOnce(jsonResponse({
        document: { id: "malformed" }
      }))
      .mockResolvedValueOnce(jsonResponse({
        document: summary("missing-state", "Missing State")
      }))
      .mockRejectedValueOnce(new Error("network failed"));

    await mount(fetchMock);
    await flushEffects();
    for (const [index, document] of documents.entries()) {
      await act(async () => {
        libraryDocumentButton(document.id, "duplicate").click();
      });
      await flushEffects();
      expect(host?.textContent).toContain(document.title as string);
      expect(host?.querySelector(
        "[data-creator-canvas-library-duplicate-error='true']"
      )?.textContent).toContain("Could not duplicate this Canvas document");
      expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("ready");
      expect(fetchMock).toHaveBeenCalledTimes(index + 2);
    }
    expect(fetchMock.mock.calls.slice(1).every(([, init]) => init?.method === "GET"))
      .toBe(true);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("does not retry a failed create and does not navigate for a malformed create response", async () => {
    const first = summary("first-source", "First Source");
    const second = summary("second-source", "Second Source");
    const state = { schemaVersion: 1, nodes: [], edges: [] };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([first, second])))
      .mockResolvedValueOnce(jsonResponse(documentResponse(first, state)))
      .mockResolvedValueOnce(jsonResponse({ message: "create failed" }, 503))
      .mockResolvedValueOnce(jsonResponse(documentResponse(second, state)))
      .mockResolvedValueOnce(jsonResponse({
        document: summary("malformed-copy", "Malformed Copy")
      }, 201));

    await mount(fetchMock);
    await flushEffects();
    await act(async () => {
      libraryDocumentButton("first-source", "duplicate").click();
    });
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(host?.querySelector(
      "[data-creator-canvas-library-duplicate-error='true']"
    )?.textContent).toContain("Could not duplicate this Canvas document");
    expect(libraryDocumentElement("first-source")).toBeTruthy();
    expect(libraryDocumentElement("second-source")).toBeTruthy();
    expect(routerPushMock).not.toHaveBeenCalled();
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      libraryDocumentButton("second-source", "duplicate").click();
    });
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(libraryDocumentElement("first-source")).toBeTruthy();
    expect(libraryDocumentElement("second-source")).toBeTruthy();
  });

  it("fences a delayed User A duplicate when the authenticated owner changes to User B", async () => {
    const source = summary("private-source", "User A Private Canvas");
    const userBDocument = summary("user-b-canvas", "User B Canvas");
    const pendingDetail = deferred<Response>();
    const state = { schemaVersion: 1, nodes: [], edges: [] };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([source])))
      .mockReturnValueOnce(pendingDetail.promise)
      .mockResolvedValueOnce(jsonResponse(pageResponse([userBDocument])));

    await mount(fetchMock, authenticatedSession("user-a", "user-a-token"));
    await flushEffects();
    await act(async () => {
      libraryDocumentButton("private-source", "duplicate").click();
    });
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer user-a-token" }
    }));

    if (!setSessionForTest) throw new Error("CANVAS_LIBRARY_SESSION_PROBE_MISSING");
    await act(async () => {
      setSessionForTest?.(authenticatedSession("user-b", "user-b-token"));
    });
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer user-b-token" }
    }));
    expect(host?.textContent).not.toContain("User A Private Canvas");

    await act(async () => {
      pendingDetail.resolve(jsonResponse(documentResponse(source, state)));
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(host?.textContent).not.toContain("User A Private Canvas");
    expect(host?.textContent).toContain("User B Canvas");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });

  it("fences a delayed duplicate after logout", async () => {
    const source = summary("logout-source", "Private Before Logout");
    const pendingDetail = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([source])))
      .mockReturnValueOnce(pendingDetail.promise);

    await mount(fetchMock, authenticatedSession("user-a", "user-a-token"));
    await flushEffects();
    await act(async () => {
      libraryDocumentButton("logout-source", "duplicate").click();
    });
    await flushEffects();
    if (!setSessionForTest) throw new Error("CANVAS_LIBRARY_SESSION_PROBE_MISSING");
    await act(async () => {
      setSessionForTest?.(null);
    });
    await flushEffects();
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("unauthenticated");
    expect(host?.textContent).not.toContain("Private Before Logout");

    await act(async () => {
      pendingDetail.resolve(jsonResponse(documentResponse(source)));
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("fences a delayed duplicate after Library unmount", async () => {
    const source = summary("unmount-source", "Unmount Source");
    const pendingDetail = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([source])))
      .mockReturnValueOnce(pendingDetail.promise);

    await mount(fetchMock);
    await flushEffects();
    await act(async () => {
      libraryDocumentButton("unmount-source", "duplicate").click();
    });
    await flushEffects();
    await act(async () => {
      root?.unmount();
      root = null;
    });
    await act(async () => {
      pendingDetail.resolve(jsonResponse(documentResponse(source)));
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("keeps Rename usable after a duplicate chain returns idle", async () => {
    const source = summary("idle-source", "Idle Source");
    const fresh = summary("idle-source", "Fresh Idle Source");
    const copy = summary("idle-copy", "Fresh Idle Source · Copy");
    const renamed = summary("idle-source", "Renamed After Copy", 2);
    const state = { schemaVersion: 1, nodes: [], edges: [] };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([source])))
      .mockResolvedValueOnce(jsonResponse(documentResponse(fresh, state)))
      .mockResolvedValueOnce(jsonResponse(documentResponse(copy, state), 201))
      .mockResolvedValueOnce(jsonResponse(documentResponse(renamed, state)));

    await mount(fetchMock);
    await flushEffects();
    await act(async () => {
      libraryDocumentButton("idle-source", "duplicate").click();
    });
    await flushEffects();
    expect(libraryDocumentButton("idle-source", "duplicate").disabled).toBe(false);

    await act(async () => {
      libraryDocumentButton("idle-source", "rename").click();
    });
    const input = host?.querySelector<HTMLInputElement>(
      "[data-creator-canvas-library-rename-input='true']"
    );
    const save = host?.querySelector<HTMLButtonElement>(
      "[data-creator-canvas-library-rename-save='true']"
    );
    if (!input || !save) throw new Error("CANVAS_LIBRARY_RENAME_FORM_MISSING");
    await act(async () => setInputValue(input, "Renamed After Copy"));
    await act(async () => save.click());
    await flushEffects();

    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner-a-token",
        "Content-Type": "application/json"
      }
    }));
    expect(host?.textContent).toContain("Renamed After Copy");
  });

  it("renames inline with OCC revision, bounds input, and reports a conflict truthfully", async () => {
    const original = summary("rename-canvas", "Original Canvas", 4);
    const updated = summary("rename-canvas", "Renamed Canvas", 5);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([original])))
      .mockResolvedValueOnce(jsonResponse({
        document: { ...updated, state: { schemaVersion: 1, private: true } }
      }))
      .mockResolvedValueOnce(jsonResponse({ code: "CANVAS_DOCUMENT_REVISION_CONFLICT" }, 409));
    await mount(fetchMock);
    await flushEffects();
    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-creator-canvas-library-rename='true']")?.click();
    });
    const input = host?.querySelector<HTMLInputElement>(
      "[data-creator-canvas-library-rename-input='true']"
    );
    const save = host?.querySelector<HTMLButtonElement>(
      "[data-creator-canvas-library-rename-save='true']"
    );
    if (!input || !save) throw new Error("CANVAS_LIBRARY_RENAME_FORM_MISSING");
    expect(input.maxLength).toBe(200);
    await act(async () => setInputValue(input, `${"x".repeat(250)}`));
    await act(async () => setInputValue(input, "Renamed Canvas"));
    await act(async () => save.click());
    await flushEffects();
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner-a-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ expectedRevision: 4, title: "Renamed Canvas" })
    }));
    expect(host?.textContent).toContain("Renamed Canvas");

    const renameAgain = host?.querySelector<HTMLButtonElement>(
      "[data-creator-canvas-library-rename='true']"
    );
    if (!renameAgain) throw new Error("CANVAS_LIBRARY_RENAME_AGAIN_MISSING");
    await act(async () => renameAgain.click());
    const conflictSave = host?.querySelector<HTMLButtonElement>(
      "[data-creator-canvas-library-rename-save='true']"
    );
    if (!conflictSave) throw new Error("CANVAS_LIBRARY_CONFLICT_SAVE_MISSING");
    await act(async () => conflictSave.click());
    await flushEffects();
    expect(host?.querySelector('[data-creator-canvas-library-rename-error="true"]')?.textContent)
      .toContain("updated elsewhere");
  });

  it("confirms delete, removes the row, and reloads the previous page when the page becomes invalid", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      summary(`canvas-${index}`, `Canvas ${index}`)
    );
    const lastPage = [summary("canvas-last", "Last Canvas")];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse(firstPage, 1, 21, 2)))
      .mockResolvedValueOnce(jsonResponse(pageResponse(lastPage, 2, 21, 2)))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse(pageResponse(firstPage, 1, 20, 1)));
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount(fetchMock);
    await flushEffects();
    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-creator-canvas-library-next='true']")?.click();
    });
    await flushEffects();
    expect(host?.textContent).toContain("Last Canvas");
    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-creator-canvas-library-delete='true']")?.click();
    });
    await flushEffects();
    expect(confirmMock).toHaveBeenCalledWith("Delete this saved Canvas document?");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/canvas/documents/canvas-last");
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({ method: "DELETE" }));
    expect(fetchMock.mock.calls[3]?.[0]).toContain("/canvas/documents?page=1&pageSize=20");
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({ method: "GET" }));
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("ready");
    expect(host?.querySelector('[data-creator-canvas-library-document="canvas-0"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-library-pagination="true"]')).toBeNull();
    expect(host?.textContent).not.toContain("Last Canvas");
    expect(host?.querySelector('[data-creator-canvas-library-error="true"]')).toBeNull();
    expect(host?.querySelector('[data-creator-canvas-library-delete-error="true"]')).toBeNull();
  });

  it("fences a direct authenticated owner transition before the new list response resolves", async () => {
    const pendingB = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pageResponse([
        summary("private-a", "User A Private Canvas")
      ])))
      .mockReturnValueOnce(pendingB.promise);
    await mount(fetchMock, authenticatedSession("user-a", "user-a-token"));
    await flushEffects();
    expect(host?.textContent).toContain("User A Private Canvas");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    if (!setSessionForTest) throw new Error("CANVAS_LIBRARY_SESSION_PROBE_MISSING");
    await act(async () => setSessionForTest?.(authenticatedSession("user-b", "user-b-token")));
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      headers: { Authorization: "Bearer user-b-token" },
      signal: expect.any(AbortSignal)
    }));
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("loading");
    expect(host?.textContent).not.toContain("User A Private Canvas");

    await act(async () => pendingB.resolve(jsonResponse(pageResponse([]))));
    await flushEffects();
    expect(getState().getAttribute("data-creator-canvas-library-state")).toBe("empty");
    expect(host?.textContent).not.toContain("User A Private Canvas");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });
});
