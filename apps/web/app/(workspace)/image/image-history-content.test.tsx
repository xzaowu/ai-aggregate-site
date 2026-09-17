// @vitest-environment jsdom

import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { AiTaskSummary } from "@ai-aggregate/shared";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import { authTokenKey, authUserKey } from "../../../components/auth-state";
import {
  useWorkspaceShellContext,
  WorkspaceShellProvider
} from "../../../components/workspace/workspace-shell-context";
import type { ImageSession, ImageStreamEntry } from "./image-page-content";
import {
  getImageSessionCoverUrl,
  getImageSessionImageCount,
  getImageSessionModelName,
  getImageSessionTitle,
  groupImageSessionSummaries,
  ImageHistoryPageContent,
  summarizeImageSession
} from "./image-history-content";
import {
  dismissedImageSessionsStorageKey,
  getDismissedImageSessionsStorageKey,
  getImageSessionsStorageKey,
  imageSessionsStorageKey,
  parseDismissedImageSessionIds,
  parseStoredImageSessions,
  readImagePromptDraft,
  serializeDismissedImageSessionIds,
  serializeImageSessionsForStorage,
  writeImagePromptDraft
} from "./image-page-content";

let historyRoot: Root | null = null;
let historyHost: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => historyRoot?.unmount());
  historyHost?.remove();
  historyRoot = null;
  historyHost = null;
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const historyUserA = {
  id: "history-user-a",
  email: "history-a@example.test",
  role: "USER" as const,
  credits: 20,
  name: "History user A"
};

const historyUserB = {
  id: "history-user-b",
  email: "history-b@example.test",
  role: "USER" as const,
  credits: 20,
  name: "History user B"
};

function HistoryAuthProbe() {
  const { setAuthSession } = useWorkspaceShellContext();

  return (
    <button
      type="button"
      data-history-switch-account="b"
      onClick={() =>
        setAuthSession({ token: "history-token-b", user: historyUserB })
      }
    >
      Switch history account
    </button>
  );
}

async function renderHistoryPage(
  identity: "guest" | "a" | "b" = "guest",
  tasks: AiTaskSummary[] = []
) {
  if (identity === "guest") {
    window.localStorage.removeItem(authTokenKey);
    window.localStorage.removeItem(authUserKey);
  } else {
    const user = identity === "a" ? historyUserA : historyUserB;
    window.localStorage.setItem(authTokenKey, `history-token-${identity}`);
    window.localStorage.setItem(authUserKey, JSON.stringify(user));
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/tasks?type=image")) {
      return new Response(JSON.stringify({ tasks }), { status: 200 });
    }
    if (url.includes("/models?surface=image")) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ remainingCredits: 20, planName: "free" }),
      { status: 200 }
    );
  });
  vi.stubGlobal("fetch", fetchMock);

  historyHost = document.createElement("div");
  document.body.append(historyHost);
  historyRoot = createRoot(historyHost);

  await act(async () => {
    historyRoot?.render(
      <I18nContext.Provider
        value={{ locale: "zh-CN", setLocale: vi.fn(), t: createTranslator("zh-CN") }}
      >
        {identity === "guest" ? (
          <ImageHistoryPageContent />
        ) : (
          <WorkspaceShellProvider gateUntilHydrated={false}>
            <ImageHistoryPageContent />
          </WorkspaceShellProvider>
        )}
      </I18nContext.Provider>
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  return fetchMock;
}

function clickHistoryNewCreation(element: HTMLAnchorElement | null | undefined) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  let defaultPreventedBeforeTestNavigationGuard: boolean | null = null;
  const preventTestNavigation = (clickEvent: MouseEvent) => {
    defaultPreventedBeforeTestNavigationGuard = clickEvent.defaultPrevented;
    clickEvent.preventDefault();
  };
  document.addEventListener("click", preventTestNavigation);
  element?.dispatchEvent(event);
  document.removeEventListener("click", preventTestNavigation);

  if (defaultPreventedBeforeTestNavigationGuard === null) {
    throw new Error("New creation click did not reach the document");
  }

  return defaultPreventedBeforeTestNavigationGuard;
}

function getHistoryHost() {
  if (!historyHost) {
    throw new Error("History host is not mounted");
  }

  return historyHost;
}

function task(overrides: Partial<AiTaskSummary> = {}): AiTaskSummary {
  return {
    id: "task-1",
    userId: "user-1",
    type: "image",
    modelId: "model-1",
    prompt: "A portrait prompt",
    status: "succeeded",
    input: { imageSessionId: "session-1", mode: "text-to-image" },
    output: { images: ["data:image/png;base64,portrait"] },
    costCredits: 1,
    errorMessage: null,
    createdAt: "2026-07-30T01:00:00.000Z",
    updatedAt: "2026-07-30T02:00:00.000Z",
    completedAt: "2026-07-30T02:00:00.000Z",
    ...overrides
  };
}

function session(
  overrides: Partial<ImageSession> = {},
  entries: ImageSession["entries"] = []
): ImageSession {
  return {
    id: "session-1",
    title: "新建画图",
    entries,
    ...overrides
  };
}

function succeededEntry(
  imageUrls: string[],
  overrides: Partial<ImageSession["entries"][number]> = {}
): ImageStreamEntry {
  const sourceTask = task({
    output: { images: imageUrls },
    updatedAt: overrides.createdAt ?? "2026-07-30T02:00:00.000Z",
    completedAt: overrides.createdAt ?? "2026-07-30T02:00:00.000Z"
  });

  const completedAt = sourceTask.completedAt ?? sourceTask.createdAt ?? "2026-07-30T02:00:00.000Z";

  return {
    id: sourceTask.id,
    imageSessionId: "session-1",
    prompt: sourceTask.prompt,
    modelName: "Studio Image",
    modelId: sourceTask.modelId,
    aspectRatio: "9:16" as const,
    mode: "text-to-image" as const,
    referenceImage: null,
    status: "succeeded" as const,
    result: {
      task: sourceTask,
      assets: imageUrls.map((url, index) => ({
        id: `asset-${index}`,
        userId: "user-1",
        taskId: sourceTask.id,
        type: "image" as const,
        url,
        thumbnailUrl: null,
        title: sourceTask.prompt,
        metadata: null,
        createdAt: completedAt,
        taskPrompt: sourceTask.prompt
      }))
    },
    error: null,
    ...overrides
  };
}

describe("image history summaries", () => {
  it("uses the existing session title and falls back to the first valid prompt", () => {
    expect(getImageSessionTitle(session({ title: "A saved session" }))).toBe(
      "A saved session"
    );
    expect(
      getImageSessionTitle(
        session({}, [
          {
            ...succeededEntry(["data:image/png;base64,one"]),
            prompt: "   A long but useful first prompt for the session   "
          }
        ])
      )
    ).toBe("A long but useful first prompt for the ses…");
  });

  it("uses Title Cover user-facing metadata instead of the internal visual prompt", () => {
    const internalPrompt =
      "Create a visual background candidate. Visual style: minimal modern. Do not render copy.";
    const titleCoverSession = session(
      { title: "新建画图" },
      [
        {
          ...succeededEntry(["https://cdn.example.test/title-cover.png"]),
          workflow: "title-cover" as const,
          prompt: internalPrompt,
          imageSessionTitle: "My Book Cover"
        }
      ]
    );

    const title = getImageSessionTitle(titleCoverSession, "Image creation");

    expect(title).toBe("My Book Cover");
    expect(title).not.toContain("Create a visual background candidate");
    expect(title).not.toContain("Do not render");
  });

  it("preserves a real Free Create title in a mixed workflow session", () => {
    const mixedSession = session(
      { title: "Free Create session title" },
      [
        {
          ...succeededEntry(["https://cdn.example.test/free.png"]),
          workflow: "free-create" as const,
          prompt: "A real Free Create prompt"
        },
        {
          ...succeededEntry(["https://cdn.example.test/title-cover.png"]),
          workflow: "title-cover" as const,
          prompt: "Create a visual background candidate. Do not render copy.",
          imageSessionTitle: "Title Cover metadata"
        }
      ]
    );

    expect(getImageSessionTitle(mixedSession, "Image creation")).toBe(
      "Free Create session title"
    );
  });

  it("chooses the latest succeeded readable asset without changing its URL", () => {
    const portrait = "data:image/png;base64,portrait-9-16";
    const summary = summarizeImageSession(
      session({}, [
        succeededEntry(["data:image/png;base64,older"]),
        succeededEntry([portrait])
      ])
    );

    expect(getImageSessionCoverUrl(summary.session)).toBe(portrait);
    expect(summary.coverUrl).toBe(portrait);
    expect(summary.session.entries[1]?.aspectRatio).toBe("9:16");
  });

  it("omits the cover and image count when no accurate successful result exists", () => {
    const failed = {
      ...succeededEntry([]),
      status: "failed" as const,
      result: null,
      error: "Safe failure"
    };
    const current = session({}, [failed]);

    expect(getImageSessionCoverUrl(current)).toBeNull();
    expect(getImageSessionImageCount(current)).toBeNull();
  });

  it("counts only successful generated assets and shows a real display model", () => {
    const current = session({}, [succeededEntry(["one", "two"])]);

    expect(getImageSessionImageCount(current)).toBe(2);
    expect(getImageSessionModelName(current)).toBe("Studio Image");
    expect(
      getImageSessionModelName(
        session({}, [succeededEntry(["one"], { modelName: "", modelId: "internal-route" })])
      )
    ).toBeNull();
  });

  it("sorts sessions by recent update and groups today, yesterday, and earlier", () => {
    const today = summarizeImageSession(
      session({ id: "today", title: "Today" }, [
        succeededEntry(["today"], { createdAt: "2026-07-30T04:00:00.000Z" })
      ])
    );
    const yesterday = summarizeImageSession(
      session({ id: "yesterday", title: "Yesterday" }, [
        succeededEntry(["yesterday"], { createdAt: "2026-07-29T04:00:00.000Z" })
      ])
    );
    const earlier = summarizeImageSession(
      session({ id: "earlier", title: "Earlier" }, [
        succeededEntry(["earlier"], { createdAt: "2026-07-20T04:00:00.000Z" })
      ])
    );
    const groups = groupImageSessionSummaries(
      [earlier, today, yesterday],
      new Date("2026-07-30T08:00:00.000Z")
    );

    expect(groups.today.map((item) => item.session.id)).toEqual(["today"]);
    expect(groups.yesterday.map((item) => item.session.id)).toEqual(["yesterday"]);
    expect(groups.earlier.map((item) => item.session.id)).toEqual(["earlier"]);
  });
});

describe("image history page", () => {
  it("uses the exact parallel account-scoped session and dismissed key families", () => {
    expect(getImageSessionsStorageKey("guest")).toBe(
      "ai-aggregate:image-sessions:v1:account-guest"
    );
    expect(getImageSessionsStorageKey("user:A")).toBe(
      "ai-aggregate:image-sessions:v1:account-user%3AA"
    );
    expect(getDismissedImageSessionsStorageKey("guest")).toBe(
      "ai-aggregate:image-dismissed-sessions:v1:account-guest"
    );
    expect(getDismissedImageSessionsStorageKey("user:A")).toBe(
      "ai-aggregate:image-dismissed-sessions:v1:account-user%3AA"
    );
  });

  it("renders an independent route shell with loading skeleton before browser data is read", () => {
    const html = renderToStaticMarkup(
      <I18nContext.Provider
        value={{ locale: "zh-CN", setLocale: () => {}, t: createTranslator("zh-CN") }}
      >
        <ImageHistoryPageContent />
      </I18nContext.Provider>
    );

    expect(html).toContain('data-image-history-page="true"');
    expect(html).toContain('data-image-history-scroll-owner="true"');
    expect(html).toContain("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto");
    expect(html).toContain('data-image-history-loading="true"');
    expect(html).not.toContain('data-image-history-empty="true"');
    expect(html).toContain('href="/image"');
    expect(html).toContain("创作记录");
    expect(html).not.toContain("历史会话");
    expect(html).toContain("新建创作");
  });

  it("keeps cover rendering contain-based for portrait, landscape, and square assets", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/(workspace)/image/image-history-content.tsx"),
      "utf8"
    );

    expect(source).toContain("object-contain");
    expect(source).toContain("h-[72px] w-[88px]");
    expect(source).not.toContain("object-cover");
  });

  it("reads the same session storage contract used by the image workspace", async () => {
    const storedSession = session(
      { id: "shared-session", title: "Shared image history" },
      [succeededEntry(["data:image/png;base64,shared"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([storedSession], storedSession.id)
    );
    historyHost = document.createElement("div");
    document.body.append(historyHost);
    historyRoot = createRoot(historyHost);

    await act(async () => {
      historyRoot?.render(
        <I18nContext.Provider
          value={{ locale: "zh-CN", setLocale: vi.fn(), t: createTranslator("zh-CN") }}
        >
          <ImageHistoryPageContent />
        </I18nContext.Provider>
      );
      await Promise.resolve();
    });

    expect(historyHost.textContent).toContain("Shared image history");
    expect(historyHost.querySelector('[data-image-history-session-card="true"]')).toBeTruthy();
    expect(historyHost.querySelector('[data-image-history-image-count="true"]')?.textContent).toContain("1");
    expect(historyHost.querySelector('a[href="/image/history/shared-session"]')).toBeTruthy();
  });

  it("creates a new empty local session from the scoped stored sessions before navigating to image", async () => {
    const existing = session(
      { id: "creation-a", title: "Creation A" },
      [succeededEntry(["https://cdn.example.test/creation-a.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([existing], existing.id, undefined, {
        firstPageLoadedAt: "2026-08-01T00:00:00.000Z",
        backendHistoryDismissed: true
      })
    );
    writeImagePromptDraft("guest", "old guest draft");

    const fetchMock = await renderHistoryPage();
    const newCreation = historyHost?.querySelector<HTMLAnchorElement>(
      '[data-image-history-new="true"]'
    );

    let wasNavigationPrevented = true;
    await act(async () => {
      wasNavigationPrevented = clickHistoryNewCreation(newCreation);
    });

    const stored = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    expect(stored).not.toBeNull();
    expect(stored?.sessions).toHaveLength(2);
    expect(stored?.sessions.some((item) => item.id === existing.id)).toBe(true);
    expect(stored?.activeSessionId).not.toBe(existing.id);
    const created = stored?.sessions.find((item) => item.id === stored.activeSessionId);
    expect(created?.entries).toEqual([]);
    expect(created?.title).toBe("新建创作");
    expect(stored?.firstPageLoadedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(stored?.backendHistoryDismissed).toBe(true);
    expect(readImagePromptDraft("guest")).toBe("");
    expect(newCreation?.getAttribute("href")).toBe("/image");
    expect(wasNavigationPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps new creation storage isolated across guest and account scopes", async () => {
    const guest = session({ id: "guest-a", title: "Guest creation" });
    const accountA = session({ id: "account-a", title: "Account A creation" });
    const accountB = session({ id: "account-b", title: "Account B creation" });
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([guest], guest.id)
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      serializeImageSessionsForStorage([accountA], accountA.id)
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-b"),
      serializeImageSessionsForStorage([accountB], accountB.id)
    );
    writeImagePromptDraft("guest", "Guest draft");
    writeImagePromptDraft("user:history-user-a", "A draft");
    writeImagePromptDraft("user:history-user-b", "B draft");

    await renderHistoryPage("a");
    let wasNavigationPrevented = true;
    await act(async () => {
      wasNavigationPrevented = clickHistoryNewCreation(
        historyHost?.querySelector<HTMLAnchorElement>('[data-image-history-new="true"]')
      );
    });

    expect(
      parseStoredImageSessions(
        window.sessionStorage.getItem(getImageSessionsStorageKey("user:history-user-a"))
      )?.sessions
    ).toHaveLength(2);
    expect(
      parseStoredImageSessions(
        window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
      )?.sessions
    ).toEqual([guest]);
    expect(
      parseStoredImageSessions(
        window.sessionStorage.getItem(getImageSessionsStorageKey("user:history-user-b"))
      )?.sessions
    ).toEqual([accountB]);
    expect(readImagePromptDraft("user:history-user-a")).toBe("");
    expect(readImagePromptDraft("user:history-user-b")).toBe("B draft");
    expect(readImagePromptDraft("guest")).toBe("Guest draft");
    expect(wasNavigationPrevented).toBe(false);
  });

  it("does not create a guest session while authenticated identity is unresolved", async () => {
    const guest = session({ id: "guest-a", title: "Guest creation" });
    const guestStored = serializeImageSessionsForStorage([guest], guest.id);
    window.localStorage.setItem(authTokenKey, "history-token-a");
    window.localStorage.removeItem(authUserKey);
    window.sessionStorage.setItem(getImageSessionsStorageKey("guest"), guestStored);
    writeImagePromptDraft("guest", "Guest draft");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/tasks?type=image")) {
        return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    historyHost = document.createElement("div");
    document.body.append(historyHost);
    historyRoot = createRoot(historyHost);

    await act(async () => {
      historyRoot?.render(
        <I18nContext.Provider
          value={{ locale: "zh-CN", setLocale: vi.fn(), t: createTranslator("zh-CN") }}
        >
          <WorkspaceShellProvider gateUntilHydrated={false}>
            <ImageHistoryPageContent />
          </WorkspaceShellProvider>
        </I18nContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    let wasNavigationPrevented = false;
    await act(async () => {
      wasNavigationPrevented = clickHistoryNewCreation(
        historyHost?.querySelector<HTMLAnchorElement>('[data-image-history-new="true"]')
      );
    });

    expect(window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))).toBe(
      guestStored
    );
    expect(readImagePromptDraft("guest")).toBe("Guest draft");
    expect(wasNavigationPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("keeps the current guest draft and history page when new-session persistence fails", async () => {
    const existing = session({ id: "creation-a", title: "Creation A" });
    const sessionsKey = getImageSessionsStorageKey("guest");
    const existingStored = serializeImageSessionsForStorage([existing], existing.id);
    window.sessionStorage.setItem(sessionsKey, existingStored);
    writeImagePromptDraft("guest", "old draft");
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (this === window.sessionStorage && key === sessionsKey) {
        throw new Error("session persistence failed");
      }
      return originalSetItem.call(this, key, value);
    });

    await renderHistoryPage();
    let wasNavigationPrevented = false;
    await act(async () => {
      wasNavigationPrevented = clickHistoryNewCreation(
        historyHost?.querySelector<HTMLAnchorElement>('[data-image-history-new="true"]')
      );
    });

    expect(window.sessionStorage.getItem(sessionsKey)).toBe(existingStored);
    expect(parseStoredImageSessions(window.sessionStorage.getItem(sessionsKey))?.sessions).toEqual([
      existing
    ]);
    expect(readImagePromptDraft("guest")).toBe("old draft");
    expect(wasNavigationPrevented).toBe(true);
    expect(historyHost?.querySelector('[data-image-history-page="true"]')).toBeTruthy();
  });

  it("shows ordered multi-reference metadata in history without raw source data", async () => {
    const entry = succeededEntry(["https://cdn.example.test/result.png"], {
      mode: "image-to-image",
      referenceImages: [
        { dataUrl: "data:image/png;base64,FIRST", name: "A.png" },
        { dataUrl: "data:image/jpeg;base64,SECOND", name: "B.jpg" }
      ],
      referenceImage: null
    });
    const current = session(
      { id: "multi-reference", title: "Multi reference" },
      [entry]
    );
    const serialized = serializeImageSessionsForStorage([current], current.id);
    expect(serialized).not.toContain("data:image/");
    window.sessionStorage.setItem(getImageSessionsStorageKey("guest"), serialized);

    await renderHistoryPage();
    const summary = getHistoryHost().querySelector(
      '[data-image-history-reference-summary="true"]'
    );
    expect(summary?.textContent).toContain("使用了 2 张参考图");
    expect(summary?.textContent?.indexOf("A.png")).toBeLessThan(
      summary?.textContent?.indexOf("B.jpg") ?? -1
    );
  });

  it("removes a creation record immediately and persists only its scoped dismissal", async () => {
    const creationA = session(
      { id: "creation-a", title: "Creation A" },
      [succeededEntry(["https://cdn.example.test/creation-a.png"])]
    );
    const creationB = session(
      { id: "creation-b", title: "Creation B" },
      [succeededEntry(["https://cdn.example.test/creation-b.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([creationA, creationB], creationA.id)
    );

    const fetchMock = await renderHistoryPage();
    const card = historyHost?.querySelector('[data-image-history-session-card="true"]');
    expect(card?.querySelector("a button")).toBeNull();

    await act(async () => {
      historyHost
        ?.querySelector<HTMLButtonElement>('[data-image-history-remove="creation-a"]')
        ?.click();
    });

    expect(historyHost?.textContent).not.toContain("Creation A");
    expect(historyHost?.textContent).toContain("Creation B");
    expect(
      parseDismissedImageSessionIds(
        window.localStorage.getItem(getDismissedImageSessionsStorageKey("guest"))
      )
    ).toEqual(new Set(["creation-a"]));
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => historyRoot?.unmount());
    historyHost?.remove();
    historyRoot = null;
    historyHost = null;

    await renderHistoryPage();
    expect(getHistoryHost().textContent).not.toContain("Creation A");
    expect(getHistoryHost().textContent).toContain("Creation B");
  });

  it("keeps dismissed creation records isolated when an account removes its own record", async () => {
    const guestDismissed = ["guest-dismissed"];
    const accountBDismissed = ["account-b-dismissed"];
    const accountA = session(
      { id: "account-a-creation", title: "Account A creation" },
      [succeededEntry(["https://cdn.example.test/account-a.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      serializeImageSessionsForStorage([accountA], accountA.id)
    );
    window.localStorage.setItem(
      getDismissedImageSessionsStorageKey("guest"),
      serializeDismissedImageSessionIds(guestDismissed)
    );
    window.localStorage.setItem(
      getDismissedImageSessionsStorageKey("user:history-user-b"),
      serializeDismissedImageSessionIds(accountBDismissed)
    );

    await renderHistoryPage("a");
    await act(async () => {
      historyHost
        ?.querySelector<HTMLButtonElement>(
          '[data-image-history-remove="account-a-creation"]'
        )
        ?.click();
    });

    expect(
      parseDismissedImageSessionIds(
        window.localStorage.getItem(
          getDismissedImageSessionsStorageKey("user:history-user-a")
        )
      )
    ).toEqual(new Set(["account-a-creation"]));
    expect(
      parseDismissedImageSessionIds(
        window.localStorage.getItem(getDismissedImageSessionsStorageKey("guest"))
      )
    ).toEqual(new Set(guestDismissed));
    expect(
      parseDismissedImageSessionIds(
        window.localStorage.getItem(
          getDismissedImageSessionsStorageKey("user:history-user-b")
        )
      )
    ).toEqual(new Set(accountBDismissed));
  });

  it("shows only the current account scoped local history", async () => {
    const accountSession = session(
      { id: "account-a-session", title: "Account A history" },
      [succeededEntry(["https://cdn.example.test/account-a.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      serializeImageSessionsForStorage([accountSession], accountSession.id)
    );

    await renderHistoryPage("a");
    expect(historyHost?.textContent).toContain("Account A history");

    await act(async () => historyRoot?.unmount());
    historyHost?.remove();
    historyRoot = null;
    historyHost = null;

    await renderHistoryPage("b");
    expect(historyHost!.textContent).not.toContain("Account A history");
    expect(historyHost!.querySelector('[data-image-history-empty="true"]')).toBeTruthy();
  });

  it("does not expose account local history to guest history", async () => {
    const accountSession = session(
      { id: "account-a-session", title: "Private account history" },
      [succeededEntry(["https://cdn.example.test/account-a.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      serializeImageSessionsForStorage([accountSession], accountSession.id)
    );

    await renderHistoryPage("guest");
    expect(historyHost?.textContent).not.toContain("Private account history");
    expect(historyHost?.querySelector('[data-image-history-empty="true"]')).toBeTruthy();
  });

  it("does not reappear guest local history after account hydration", async () => {
    const guestSession = session(
      { id: "guest-session", title: "Guest-only history" },
      [succeededEntry(["https://cdn.example.test/guest.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([guestSession], guestSession.id)
    );

    await renderHistoryPage("a");
    expect(historyHost?.textContent).not.toContain("Guest-only history");
    expect(historyHost?.querySelector('[data-image-history-empty="true"]')).toBeTruthy();
  });

  it("waits for auth hydration before choosing a guest local history scope", async () => {
    const guestSession = session(
      { id: "guest-session", title: "Guest history must wait" },
      [succeededEntry(["https://cdn.example.test/guest.png"])]
    );
    const accountSession = session(
      { id: "account-a-session", title: "Hydrated account history" },
      [succeededEntry(["https://cdn.example.test/account-a.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([guestSession], guestSession.id)
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      serializeImageSessionsForStorage([accountSession], accountSession.id)
    );

    await renderHistoryPage("a");
    expect(historyHost?.textContent).not.toContain("Guest history must wait");
    expect(historyHost?.textContent).toContain("Hydrated account history");
  });

  it("keeps token-present user-missing history memory-only while loading owner-scoped backend history", async () => {
    const guestSession = session(
      {
        id: "token-user-missing-session",
        title: "Guest private marker"
      },
      [succeededEntry(["https://cdn.example.test/guest-private.png"])]
    );
    const guestSessionsRaw = serializeImageSessionsForStorage(
      [guestSession],
      guestSession.id
    );
    const guestDismissedRaw = serializeDismissedImageSessionIds([guestSession.id]);
    const backendTask = task({
      id: "token-user-missing-backend-task",
      userId: "history-user-a",
      prompt: "Account A backend marker",
      input: {
        imageSessionId: guestSession.id,
        imageSessionTitle: "Account A backend marker",
        mode: "text-to-image"
      },
      output: { images: ["https://cdn.example.test/account-a-backend.png"] }
    });
    const taskAuthorizations: string[] = [];

    window.localStorage.setItem(authTokenKey, "history-token-a");
    window.localStorage.removeItem(authUserKey);
    window.sessionStorage.setItem(getImageSessionsStorageKey("guest"), guestSessionsRaw);
    window.localStorage.setItem(
      getDismissedImageSessionsStorageKey("guest"),
      guestDismissedRaw
    );
    window.sessionStorage.setItem(
      imageSessionsStorageKey,
      serializeImageSessionsForStorage(
        [session({ id: "legacy-global-session", title: "Legacy global marker" })],
        "legacy-global-session"
      )
    );
    window.localStorage.setItem(
      dismissedImageSessionsStorageKey,
      serializeDismissedImageSessionIds(["legacy-dismissed-marker"])
    );

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/tasks?type=image")) {
          taskAuthorizations.push(
            new Headers(init?.headers).get("Authorization") ?? ""
          );
          return new Response(JSON.stringify({ tasks: [backendTask] }), {
            status: 200
          });
        }
        if (url.includes("/models?surface=image")) {
          return new Response(JSON.stringify({ models: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ remainingCredits: 20, planName: "free" }),
          { status: 200 }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    historyHost = document.createElement("div");
    document.body.append(historyHost);
    historyRoot = createRoot(historyHost);

    await act(async () => {
      historyRoot?.render(
        <I18nContext.Provider
          value={{ locale: "zh-CN", setLocale: vi.fn(), t: createTranslator("zh-CN") }}
        >
          <WorkspaceShellProvider gateUntilHydrated={false}>
            <ImageHistoryPageContent />
          </WorkspaceShellProvider>
        </I18nContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(taskAuthorizations).toEqual(["Bearer history-token-a"]);
    expect(historyHost?.textContent).toContain("Account A backend marker");
    expect(historyHost?.textContent).not.toContain("Guest private marker");
    expect(window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))).toBe(
      guestSessionsRaw
    );
    expect(window.localStorage.getItem(getDismissedImageSessionsStorageKey("guest"))).toBe(
      guestDismissedRaw
    );
    expect(window.sessionStorage.getItem(imageSessionsStorageKey)).toBeNull();
    expect(window.localStorage.getItem(dismissedImageSessionsStorageKey)).toBeNull();
    expect(
      [
        ...Array.from(
          { length: window.sessionStorage.length },
          (_, index) => window.sessionStorage.key(index) ?? ""
        ),
        ...Array.from(
          { length: window.localStorage.length },
          (_, index) => window.localStorage.key(index) ?? ""
        )
      ].some(
        (key) =>
          key.includes("history-token-a") || key.includes("authenticated-unknown")
      )
    ).toBe(false);
  });

  it("drops the legacy global session key without migrating it for guest history", async () => {
    const legacySession = session(
      { id: "legacy-session", title: "Legacy global history" },
      [succeededEntry(["https://cdn.example.test/legacy.png"])]
    );
    window.sessionStorage.setItem(
      imageSessionsStorageKey,
      serializeImageSessionsForStorage([legacySession], legacySession.id)
    );

    await renderHistoryPage("guest");
    expect(historyHost?.textContent).not.toContain("Legacy global history");
    expect(window.sessionStorage.getItem(imageSessionsStorageKey)).toBeNull();
    expect(window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))).toBeNull();
  });

  it("drops the legacy global session key without migrating it for account history", async () => {
    const legacySession = session(
      { id: "legacy-session", title: "Legacy global account history" },
      [succeededEntry(["https://cdn.example.test/legacy.png"])]
    );
    window.sessionStorage.setItem(
      imageSessionsStorageKey,
      serializeImageSessionsForStorage([legacySession], legacySession.id)
    );

    await renderHistoryPage("a");
    expect(historyHost?.textContent).not.toContain("Legacy global account history");
    expect(window.sessionStorage.getItem(imageSessionsStorageKey)).toBeNull();
    expect(window.sessionStorage.getItem(getImageSessionsStorageKey("user:history-user-a"))).toBeNull();
  });

  it("drops the legacy dismissed key without migrating dismissal state", async () => {
    window.localStorage.setItem(
      dismissedImageSessionsStorageKey,
      serializeDismissedImageSessionIds(["legacy-session"])
    );

    await renderHistoryPage("guest");
    expect(window.localStorage.getItem(dismissedImageSessionsStorageKey)).toBeNull();
    expect(window.localStorage.getItem(getDismissedImageSessionsStorageKey("guest"))).toBeNull();
  });

  it("uses scoped dismissed IDs only for the matching account", async () => {
    const accountSession = session(
      { id: "account-a-session", title: "Dismissed account session" },
      [succeededEntry(["https://cdn.example.test/account-a.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      serializeImageSessionsForStorage([accountSession], accountSession.id)
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-b"),
      serializeImageSessionsForStorage([accountSession], accountSession.id)
    );
    window.localStorage.setItem(
      getDismissedImageSessionsStorageKey("user:history-user-a"),
      serializeDismissedImageSessionIds([accountSession.id])
    );

    await renderHistoryPage("a");
    expect(historyHost?.textContent).not.toContain("Dismissed account session");

    await act(async () => historyRoot?.unmount());
    historyHost?.remove();
    historyRoot = null;
    historyHost = null;

    await renderHistoryPage("b");
    expect(historyHost!.textContent).toContain("Dismissed account session");
    expect(historyHost!.querySelector('[data-image-history-session-card="true"]')).toBeTruthy();
  });

  it("keeps guest dismissal state isolated from authenticated local history", async () => {
    const sharedSession = session(
      { id: "shared-local-session", title: "Shared local history" },
      [succeededEntry(["https://cdn.example.test/shared.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([sharedSession], sharedSession.id)
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      serializeImageSessionsForStorage([sharedSession], sharedSession.id)
    );
    window.localStorage.setItem(
      getDismissedImageSessionsStorageKey("guest"),
      serializeDismissedImageSessionIds([sharedSession.id])
    );

    await renderHistoryPage("guest");
    expect(historyHost?.textContent).not.toContain("Shared local history");

    await act(async () => historyRoot?.unmount());
    historyHost?.remove();
    historyRoot = null;
    historyHost = null;

    await renderHistoryPage("a");
    expect(historyHost!.textContent).toContain("Shared local history");
  });

  it("keeps backend owner-scoped history merge and display working", async () => {
    const backendTask = task({
      id: "account-a-task",
      userId: "history-user-a",
      prompt: "Backend account A history",
      input: {
        imageSessionId: "backend-account-a-session",
        imageSessionTitle: "Backend account A session",
        mode: "text-to-image"
      },
      output: { images: ["https://cdn.example.test/backend-a.png"] }
    });

    await renderHistoryPage("a", [backendTask]);
    expect(historyHost?.textContent).toContain("Backend account A session");
    expect(historyHost?.querySelector('a[href="/image/history/backend-account-a-session"]')).toBeTruthy();
  });

  it("fences a stale account A backend response after switching to account B in place", async () => {
    const accountALocalSession = session(
      { id: "account-a-local-session", title: "Account A local marker" },
      [succeededEntry(["https://cdn.example.test/account-a-local.png"])]
    );
    const accountBLocalSession = session(
      { id: "account-b-local-session", title: "Account B local marker" },
      [succeededEntry(["https://cdn.example.test/account-b-local.png"])]
    );
    const accountATask = task({
      id: "account-a-backend-task",
      userId: historyUserA.id,
      prompt: "Account A backend marker",
      input: {
        imageSessionId: "account-a-backend-session",
        imageSessionTitle: "Account A backend marker",
        mode: "text-to-image"
      },
      output: { images: ["https://cdn.example.test/account-a-backend.png"] }
    });
    const accountBTask = task({
      id: "account-b-backend-task",
      userId: historyUserB.id,
      prompt: "Account B backend marker",
      input: {
        imageSessionId: "account-b-backend-session",
        imageSessionTitle: "Account B backend marker",
        mode: "text-to-image"
      },
      output: { images: ["https://cdn.example.test/account-b-backend.png"] }
    });

    window.localStorage.setItem(authTokenKey, "history-token-a");
    window.localStorage.setItem(authUserKey, JSON.stringify(historyUserA));
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      serializeImageSessionsForStorage([accountALocalSession], accountALocalSession.id)
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-b"),
      serializeImageSessionsForStorage([accountBLocalSession], accountBLocalSession.id)
    );

    let resolveAccountATasks!: (response: Response) => void;
    const accountATasks = new Promise<Response>((resolve) => {
      resolveAccountATasks = resolve;
    });
    const taskRequestAuthorizations: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/tasks?type=image")) {
          const authorization = new Headers(init?.headers).get("Authorization");
          taskRequestAuthorizations.push(authorization ?? "");
          if (authorization === "Bearer history-token-a") {
            return accountATasks;
          }
          if (authorization === "Bearer history-token-b") {
            return new Response(JSON.stringify({ tasks: [accountBTask] }), {
              status: 200
            });
          }
          throw new Error(`unexpected history authorization: ${authorization}`);
        }
        if (url.includes("/models?surface=image")) {
          return new Response(JSON.stringify({ models: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ remainingCredits: 20, planName: "free" }),
          { status: 200 }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    historyHost = document.createElement("div");
    document.body.append(historyHost);
    historyRoot = createRoot(historyHost);

    await act(async () => {
      historyRoot?.render(
        <I18nContext.Provider
          value={{ locale: "zh-CN", setLocale: vi.fn(), t: createTranslator("zh-CN") }}
        >
          <WorkspaceShellProvider gateUntilHydrated={false}>
            <HistoryAuthProbe />
            <ImageHistoryPageContent />
          </WorkspaceShellProvider>
        </I18nContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(taskRequestAuthorizations).toEqual(["Bearer history-token-a"]);

    await act(async () => {
      historyHost
        ?.querySelector<HTMLButtonElement>('[data-history-switch-account="b"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(taskRequestAuthorizations).toEqual([
      "Bearer history-token-a",
      "Bearer history-token-b"
    ]);
    expect(historyHost?.textContent).toContain("Account B local marker");
    expect(historyHost?.textContent).toContain("Account B backend marker");
    expect(historyHost?.textContent).not.toContain("Account A local marker");
    expect(historyHost?.textContent).not.toContain("Account A backend marker");

    await act(async () => {
      resolveAccountATasks(
        new Response(JSON.stringify({ tasks: [accountATask] }), { status: 200 })
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(historyHost?.textContent).toContain("Account B local marker");
    expect(historyHost?.textContent).toContain("Account B backend marker");
    expect(historyHost?.textContent).not.toContain("Account A local marker");
    expect(historyHost?.textContent).not.toContain("Account A backend marker");
  });

  it("reads backendHistoryDismissed from the current scoped stored session", async () => {
    const stored = session(
      { id: "local-session", title: "Local history" },
      [succeededEntry(["https://cdn.example.test/local.png"])]
    );
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("user:history-user-a"),
      JSON.stringify({
        version: 1,
        activeSessionId: stored.id,
        firstPageLoadedAt: "2026-07-30T00:00:00.000Z",
        backendHistoryDismissed: true,
        sessions: [stored]
      })
    );
    const legacyBackendTask = task({
      id: "legacy-backend-after-dismiss",
      userId: "history-user-a",
      prompt: "Legacy backend history must stay hidden",
      input: { mode: "text-to-image" }
    });

    await renderHistoryPage("a", [legacyBackendTask]);
    expect(historyHost?.textContent).toContain("Local history");
    expect(historyHost?.textContent).not.toContain("Legacy backend history must stay hidden");
    expect(
      JSON.parse(
        window.sessionStorage.getItem(
          getImageSessionsStorageKey("user:history-user-a")
        ) ?? "{}"
      ).backendHistoryDismissed
    ).toBe(true);
  });

  it("continues to display sanitized C4-0A stored sessions and ordinary text-to-image history", async () => {
    const stored = session(
      { id: "sanitized-session", title: "Sanitized text history" },
      [
        {
          ...succeededEntry(["https://cdn.example.test/text-output.png"]),
          prompt: "Ordinary text-to-image prompt",
          mode: "text-to-image",
          referenceImage: null,
          referenceImageMetadata: undefined
        }
      ]
    );
    const serialized = serializeImageSessionsForStorage([stored], stored.id);
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serialized
    );

    await renderHistoryPage("guest");
    expect(serialized).not.toContain("data:image");
    expect(historyHost?.textContent).toContain("Sanitized text history");
    expect(historyHost?.textContent).toContain("1");
  });
});
