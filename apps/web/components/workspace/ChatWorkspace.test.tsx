// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@ai-aggregate/shared";
import { AppShell } from "./AppShell";
import { AssistantMarkdown } from "./AssistantMarkdown";
import {
  canPersistChatScrollRuntime,
  canRestoreChatScrollForSession,
  consumeChatScrollRestoreFollowSuppression,
  createChatSessionScrollState,
  createChatScrollRuntimeState,
  getChatSurfaceOwnership,
  getChatScrollRestorePlan,
  getChatScrollStorageKey,
  getChatTurnAnchorId,
  readChatDraft,
  readChatScrollTop,
  resetChatScrollRestoreOwnership,
  resolveChatPersistenceIdentity,
  ownsChatPersistenceIdentity,
  ownsChatSurface,
  shouldClearChatDraftAfterSend,
  shouldRestoreChatScrollSurface,
  shouldAutoFollowChat,
  writeChatDraft,
  writeChatScrollTop,
  ChatWorkspace
} from "./ChatWorkspace";
import { authTokenKey, authUserKey } from "../auth-state";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  useWorkspaceShellContext,
  WorkspaceShellProvider
} from "./workspace-shell-context";

const chatBootstrapTestState = vi.hoisted(() => ({
  publicSettings: null as { defaultModel?: string } | null,
  routerPush: vi.fn(),
  router: null as { push: ReturnType<typeof vi.fn> } | null
}));

chatBootstrapTestState.router = { push: chatBootstrapTestState.routerPush };

vi.mock("next/navigation", () => ({
  useRouter: () => chatBootstrapTestState.router,
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("../../lib/use-public-settings", () => ({
  usePublicSettings: () => chatBootstrapTestState.publicSettings
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chatWorkspaceSource = fs.readFileSync(
  path.join(process.cwd(), "components/workspace/ChatWorkspace.tsx"),
  "utf8"
);
const globalStyles = fs.readFileSync(
  path.join(process.cwd(), "app/globals.css"),
  "utf8"
);
const workspaceRouteLayoutSources = [
  "app/(workspace)/page.tsx",
  "app/(workspace)/models/models-page-content.tsx",
  "app/(workspace)/tasks/tasks-page-content.tsx",
  "app/(workspace)/assets/assets-page-content.tsx",
  "app/(workspace)/image/image-page-content.tsx"
].map((filePath) => fs.readFileSync(path.join(process.cwd(), filePath), "utf8"));

const chatBootstrapUserA: AuthUser = {
  id: "chat-bootstrap-user-a",
  email: "chat-bootstrap-a@example.test",
  role: "USER",
  credits: 20,
  name: "Chat Bootstrap A"
};
const chatBootstrapUserB: AuthUser = {
  ...chatBootstrapUserA,
  id: "chat-bootstrap-user-b",
  email: "chat-bootstrap-b@example.test",
  name: "Chat Bootstrap B"
};

function chatJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function chatRequestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function createChatBootstrapFetch(options: {
  onRequest?: (url: URL, init: RequestInit | undefined) => void;
  override?: (
    url: URL,
    init: RequestInit | undefined
  ) => Response | Promise<Response> | undefined;
} = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = chatRequestUrl(input);
    options.onRequest?.(url, init);
    const overrideResponse = options.override?.(url, init);
    if (overrideResponse) {
      return overrideResponse;
    }

    const authorization = new Headers(init?.headers).get("Authorization");
    const user = authorization === "Bearer token-b"
      ? chatBootstrapUserB
      : chatBootstrapUserA;

    if (url.pathname.endsWith("/quota/me")) {
      return chatJsonResponse({ remainingCredits: 20 });
    }

    if (url.pathname.endsWith("/auth/me")) {
      return chatJsonResponse({ user });
    }

    if (url.pathname.endsWith("/models")) {
      return chatJsonResponse({
        models: [
          {
            id: "chat-model-default",
            name: "Chat Default",
            displayName: "Chat Default",
            slug: "chat-default",
            provider: "OPENAI_COMPATIBLE",
            capability: "chat",
            displaySurfaces: ["chat"],
            modelId: "chat-default",
            group: "chat",
            tags: ["chat"],
            enabled: true,
            creditCost: 1,
            allowGuest: true,
            sortOrder: 0,
            isRecommended: false
          },
          {
            id: "chat-model-configured",
            name: "Configured Chat Model",
            displayName: "Configured Chat Model",
            slug: "chat-configured",
            provider: "OPENAI_COMPATIBLE",
            capability: "chat",
            displaySurfaces: ["chat"],
            modelId: "chat-configured",
            group: "chat",
            tags: ["chat"],
            enabled: true,
            creditCost: 1,
            allowGuest: true,
            sortOrder: 1,
            isRecommended: false
          }
        ]
      });
    }

    if (url.pathname.endsWith("/chat/sessions")) {
      return chatJsonResponse({
        sessions: [
          {
            id: "chat-bootstrap-session",
            userId: user.id,
            title: "Bootstrap session",
            createdAt: "2026-08-12T00:00:00.000Z",
            updatedAt: "2026-08-12T00:00:00.000Z"
          }
        ]
      });
    }

    if (url.pathname.endsWith("/chat-bootstrap-session/messages")) {
      return chatJsonResponse({
        messages: [
          {
            id: `message-${user.id}`,
            sessionId: "chat-bootstrap-session",
            role: "user",
            content: `loaded for ${user.id}`,
            model: "chat-default",
            createdAt: "2026-08-12T00:00:01.000Z"
          }
        ]
      });
    }

    throw new Error(`Unexpected Chat bootstrap request: ${url.pathname}`);
  });
}

function countChatRequests(
  fetchMock: { mock: { calls: unknown[][] } },
  pathname: string
): number {
  return fetchMock.mock.calls.filter(([input]) =>
    chatRequestUrl(input as RequestInfo | URL).pathname.endsWith(pathname)
  ).length;
}

function TokenSwitchProbe() {
  const { setAuthSession } = useWorkspaceShellContext();

  return (
    <button
      type="button"
      data-chat-bootstrap-switch-token="true"
      onClick={() => setAuthSession({ token: "token-b", user: chatBootstrapUserB })}
    >
      Switch account
    </button>
  );
}

function chatBootstrapElement(includeSwitchProbe = false) {
  return (
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      <WorkspaceShellProvider gateUntilHydrated>
        {includeSwitchProbe ? <TokenSwitchProbe /> : null}
        <ChatWorkspace />
      </WorkspaceShellProvider>
    </I18nContext.Provider>
  );
}

let chatBootstrapRoot: Root | null = null;
let chatBootstrapHost: HTMLDivElement | null = null;
const chatScrollToDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo"
);

async function mountChatBootstrap(
  fetchMock: { mock: { calls: unknown[][] } } & ((...args: never[]) => unknown),
  includeSwitchProbe = false
) {
  window.localStorage.clear();
  window.localStorage.setItem(authTokenKey, "token-a");
  window.localStorage.setItem(authUserKey, JSON.stringify(chatBootstrapUserA));
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn()
  });
  vi.stubGlobal("fetch", fetchMock);
  chatBootstrapHost = document.createElement("div");
  document.body.append(chatBootstrapHost);
  chatBootstrapRoot = createRoot(chatBootstrapHost);

  await act(async () => {
    chatBootstrapRoot?.render(chatBootstrapElement(includeSwitchProbe));
    await Promise.resolve();
  });
  await settleChatBootstrap();
}

async function settleChatBootstrap() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createDeferredResponse() {
  let resolvePromise: (response: Response) => void = () => {
    throw new Error("Deferred response resolver was not initialized");
  };
  const promise = new Promise<Response>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(response: Response) {
      resolvePromise(response);
    }
  };
}

afterEach(async () => {
  await act(async () => chatBootstrapRoot?.unmount());
  chatBootstrapHost?.remove();
  chatBootstrapRoot = null;
  chatBootstrapHost = null;
  chatBootstrapTestState.publicSettings = null;
  chatBootstrapTestState.routerPush.mockReset();
  window.localStorage.clear();
  if (chatScrollToDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", chatScrollToDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  }
  vi.unstubAllGlobals();
});

describe("ChatWorkspace hotfix contracts", () => {
  it("runs one authenticated core bootstrap and keeps default-model hydration local", async () => {
    const fetchMock = createChatBootstrapFetch();
    await mountChatBootstrap(fetchMock);

    expect(countChatRequests(fetchMock, "/auth/me")).toBe(1);
    expect(countChatRequests(fetchMock, "/models")).toBe(1);
    expect(countChatRequests(fetchMock, "/chat/sessions")).toBe(1);
    expect(
      countChatRequests(
        fetchMock,
        "/chat/sessions/chat-bootstrap-session/messages"
      )
    ).toBe(1);

    chatBootstrapTestState.publicSettings = {
      defaultModel: "chat-configured"
    };
    await act(async () => {
      chatBootstrapRoot?.render(chatBootstrapElement());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleChatBootstrap();

    expect(countChatRequests(fetchMock, "/auth/me")).toBe(1);
    expect(countChatRequests(fetchMock, "/models")).toBe(1);
    expect(countChatRequests(fetchMock, "/chat/sessions")).toBe(1);
    expect(
      countChatRequests(
        fetchMock,
        "/chat/sessions/chat-bootstrap-session/messages"
      )
    ).toBe(1);
    expect(chatBootstrapHost?.textContent).toContain("Configured Chat Model");
  });

  it("aborts an unmounted bootstrap and ignores its late completion", async () => {
    const deferredAuth = createDeferredResponse();
    let authRequestInit: RequestInit | undefined;
    const fetchMock = createChatBootstrapFetch({
      onRequest: (url, init) => {
        if (url.pathname.endsWith("/auth/me")) {
          authRequestInit = init;
        }
      },
      override: (url) =>
        url.pathname.endsWith("/auth/me") ? deferredAuth.promise : undefined
    });

    await mountChatBootstrap(fetchMock);
    expect(authRequestInit?.signal).toBeInstanceOf(AbortSignal);

    await act(async () => {
      chatBootstrapRoot?.unmount();
      await Promise.resolve();
    });
    expect(authRequestInit?.signal?.aborted).toBe(true);

    deferredAuth.resolve(chatJsonResponse({ user: chatBootstrapUserA }));
    await settleChatBootstrap();
    expect(chatBootstrapHost?.textContent ?? "").not.toContain(
      "Bootstrap session"
    );
  });

  it("fences an old account bootstrap when the token changes", async () => {
    const deferredAuthA = createDeferredResponse();
    let authACall = 0;
    let authARequestInit: RequestInit | undefined;
    const fetchMock = createChatBootstrapFetch({
      onRequest: (url, init) => {
        if (url.pathname.endsWith("/auth/me")) {
          authACall += 1;
          if (authACall === 1) {
            authARequestInit = init;
          }
        }
      },
      override: (url, init) => {
        if (url.pathname.endsWith("/auth/me") && authACall === 1) {
          return deferredAuthA.promise;
        }
        return undefined;
      }
    });

    await mountChatBootstrap(fetchMock, true);
    const switchButton = chatBootstrapHost?.querySelector<HTMLButtonElement>(
      '[data-chat-bootstrap-switch-token="true"]'
    );
    expect(switchButton).toBeTruthy();

    await act(async () => {
      switchButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(authARequestInit?.signal?.aborted).toBe(true);
    await settleChatBootstrap();

    deferredAuthA.resolve(chatJsonResponse({ user: chatBootstrapUserA }));
    await settleChatBootstrap();

    expect(chatBootstrapHost?.textContent).toContain(
      `loaded for ${chatBootstrapUserB.id}`
    );
    expect(chatBootstrapHost?.textContent ?? "").not.toContain(
      `loaded for ${chatBootstrapUserA.id}`
    );
  });

  it("bounds the desktop workspace to the viewport and keeps main content shrinkable", () => {
    const html = renderToStaticMarkup(
      <AppShell nav={<nav />} sidebar={null}>
        <div>content</div>
      </AppShell>
    );

    expect(html).toContain("h-[100dvh]");
    expect(html).toContain("min-h-0");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain(
      '<main class="flex min-h-0 min-w-0 flex-col overflow-hidden">'
    );
    expect(html).toContain(
      '<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-workspace-page-frame="true"><div>content</div></div>'
    );
  });

  it("bounds the mobile workspace and image root without changing global body scrolling", () => {
    expect(globalStyles).toContain("[data-mobile-workspace-shell]");
    expect(globalStyles).toContain("height: 100dvh");
    expect(globalStyles).toContain("[data-mobile-content-safe-bottom]");
    expect(globalStyles).toContain("[data-image-workspace-root]");
    expect(globalStyles).not.toContain("body {\n  overflow: hidden");
  });

  it("does not repeat viewport-height ownership inside workspace routes", () => {
    for (const source of workspaceRouteLayoutSources) {
      expect(source).not.toContain("h-[100dvh]");
      expect(source).not.toContain("min-h-[100dvh]");
      expect(source).not.toContain("max-h-screen");
      expect(source).not.toMatch(/calc\(100(?:d?vh|%)\s*-/);
    }
  });

  it("uses a synchronous send ref before starting a chat request", () => {
    expect(chatWorkspaceSource).toContain("const sendingRef = useRef(false)");
    expect(chatWorkspaceSource).toContain("tryAcquireChatSendLock(sendingRef)");
    expect(chatWorkspaceSource).toContain("releaseChatSendLock(sendingRef)");
  });

  it("top-aligns the user avatar and reuses ModelIcon for matched assistant models", () => {
    expect(chatWorkspaceSource).toContain(
      'data-message-user-row="true" className="flex min-w-0 max-w-[90%] items-start'
    );
    expect(chatWorkspaceSource).toContain('data-message-user-avatar="true"');
    expect(chatWorkspaceSource).toContain("<ModelIcon");
    expect(chatWorkspaceSource).not.toContain("items-end gap-2 sm:max-w-[76%]");
  });

  it("keeps stable message IDs as React keys and truncates long model names", () => {
    expect(chatWorkspaceSource).toContain("key={message.id}");
    expect(chatWorkspaceSource).toContain("truncate");
  });

  it("uses one shrinkable message viewport and floating outline without end-anchor scrolling", () => {
    expect(chatWorkspaceSource).toContain(
      "const messageViewportRef = useRef<HTMLDivElement | null>(null)"
    );
    expect(chatWorkspaceSource).toContain("relative flex min-h-0 min-w-0 flex-1");
    expect(chatWorkspaceSource).toContain(
      "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
    );
    expect(chatWorkspaceSource).toContain("onBeforeNavigate");
    expect(chatWorkspaceSource).not.toContain("messagesEndRef.current?.scrollIntoView");
    expect(chatWorkspaceSource).not.toContain("<ChatOutline messages={messages} />");
  });

  it("keeps an initial empty chat blank without an automatic bottom animation", () => {
    expect(getChatScrollRestorePlan({
      hasMessages: false,
      savedTop: null,
      scrollHeight: 800,
      clientHeight: 400
    })).toBeNull();
    expect(shouldAutoFollowChat(false, true)).toBe(false);
    expect(chatWorkspaceSource).toContain('behavior: "auto"');
  });

  it("initializes an existing chat at the bottom immediately when no position is saved", () => {
    expect(getChatScrollRestorePlan({
      hasMessages: true,
      savedTop: null,
      scrollHeight: 1200,
      clientHeight: 400
    })).toEqual({
      top: 800,
      behavior: "auto",
      shouldFollowBottom: true
    });
  });

  it("restores a saved chat position without smooth behavior", () => {
    expect(getChatScrollRestorePlan({
      hasMessages: true,
      savedTop: 260,
      scrollHeight: 1200,
      clientHeight: 400
    })).toEqual({
      top: 260,
      behavior: "auto",
      shouldFollowBottom: false
    });
    expect(shouldAutoFollowChat(true, false)).toBe(false);
  });

  it("restores a near-bottom saved position exactly before allowing later follow", () => {
    const plan = getChatScrollRestorePlan({
      hasMessages: true,
      savedTop: 750,
      scrollHeight: 1200,
      clientHeight: 400
    });
    const suppressionRef = { current: plan?.shouldFollowBottom ?? false };

    expect(plan).toEqual({
      top: 750,
      behavior: "auto",
      shouldFollowBottom: true
    });
    expect(consumeChatScrollRestoreFollowSuppression(suppressionRef)).toBe(true);
    expect(suppressionRef.current).toBe(false);
    expect(consumeChatScrollRestoreFollowSuppression(suppressionRef)).toBe(false);
    expect(shouldAutoFollowChat(true, true)).toBe(true);
  });

  it("uses the existing near-bottom follow contract and keeps surfaces independent", () => {
    expect(shouldAutoFollowChat(true, true)).toBe(true);
    expect(chatWorkspaceSource).toContain("shouldFollowDesktopBottomRef");
    expect(chatWorkspaceSource).toContain("shouldFollowMobileBottomRef");
    expect(chatWorkspaceSource).not.toContain("const shouldFollowBottomRef = useRef(true)");
  });

  it("gives each provider-backed ChatWorkspace one surface-owned persistence scope", () => {
    expect(getChatSurfaceOwnership("mobile")).toEqual(["mobile"]);
    expect(getChatSurfaceOwnership("desktop")).toEqual(["desktop"]);
    expect(ownsChatSurface("mobile", "mobile")).toBe(true);
    expect(ownsChatSurface("mobile", "desktop")).toBe(false);
    expect(ownsChatSurface("desktop", "desktop")).toBe(true);
    expect(ownsChatSurface("desktop", "mobile")).toBe(false);

    const hiddenSiblingWrites = (["desktop", "mobile"] as const).filter((surface) =>
      ownsChatSurface("mobile", surface)
    );
    expect(hiddenSiblingWrites).toEqual(["mobile"]);

    // Isolated renders retain the explicit legacy fallback for both surfaces.
    expect(getChatSurfaceOwnership(null)).toEqual(["desktop", "mobile"]);
    expect(ownsChatSurface(null, "desktop")).toBe(true);
    expect(ownsChatSurface(null, "mobile")).toBe(true);
  });

  it("does not lock a new session restore while old-session messages are still present", () => {
    const loadedA = {
      ...createChatSessionScrollState("A"),
      loadedMessagesSessionId: "A",
      hasMessages: true
    };
    const pendingB = createChatSessionScrollState("B");

    expect(canRestoreChatScrollForSession(loadedA)).toBe(true);
    expect(canRestoreChatScrollForSession({
      ...pendingB,
      hasMessages: true
    })).toBe(false);
    expect(canRestoreChatScrollForSession({
      activeSessionId: "B",
      loadedMessagesSessionId: "A",
      hasMessages: true
    })).toBe(false);
    expect(canRestoreChatScrollForSession({
      activeSessionId: "B",
      loadedMessagesSessionId: "B",
      hasMessages: true
    })).toBe(true);
  });

  it("fences scroll persistence across identity transitions, including memory-only auth", () => {
    const userARuntime = {
      ...createChatScrollRuntimeState("user:A", "session-A"),
      lastDesktopScrollTop: 620,
      hasDesktopScrollPosition: true
    };

    expect(ownsChatPersistenceIdentity("user:A", "guest")).toBe(false);
    expect(ownsChatPersistenceIdentity("guest", "user:B")).toBe(false);
    expect(ownsChatPersistenceIdentity("user:A", "user:B")).toBe(false);
    expect(canPersistChatScrollRuntime(
      userARuntime,
      "guest",
      "session-A",
      "desktop"
    )).toBe(false);
    expect(canPersistChatScrollRuntime(
      userARuntime,
      "user:B",
      "session-A",
      "desktop"
    )).toBe(false);
    expect(canPersistChatScrollRuntime(
      userARuntime,
      null,
      "session-A",
      "desktop"
    )).toBe(false);
    expect(canPersistChatScrollRuntime(
      userARuntime,
      "user:A",
      "session-A",
      "desktop"
    )).toBe(true);

    const authenticatedUnknownRuntime = {
      ...createChatScrollRuntimeState(null, "session-A"),
      hasDesktopScrollPosition: true
    };
    expect(canPersistChatScrollRuntime(
      authenticatedUnknownRuntime,
      "user:B",
      "session-A",
      "desktop"
    )).toBe(false);
  });

  it("resets incoming session scroll runtime without carrying outgoing state", () => {
    const outgoingA = {
      ...createChatScrollRuntimeState("user:A", "A"),
      shouldFollowDesktopBottom: false,
      lastDesktopScrollTop: 620,
      hasDesktopScrollPosition: true
    };
    const incomingEmptyB = createChatScrollRuntimeState("user:A", "B");

    expect(canPersistChatScrollRuntime(
      outgoingA,
      "user:A",
      "A",
      "desktop"
    )).toBe(true);
    expect(incomingEmptyB.shouldFollowDesktopBottom).toBe(true);
    expect(incomingEmptyB.lastDesktopScrollTop).toBe(0);
    expect(incomingEmptyB.hasDesktopScrollPosition).toBe(false);
    expect(canPersistChatScrollRuntime(
      incomingEmptyB,
      "user:A",
      "B",
      "desktop"
    )).toBe(false);

    const existingBPlan = getChatScrollRestorePlan({
      hasMessages: true,
      savedTop: 250,
      scrollHeight: 1200,
      clientHeight: 400
    });
    expect(existingBPlan).toEqual({
      top: 250,
      behavior: "auto",
      shouldFollowBottom: false
    });
    const restoredB = {
      ...incomingEmptyB,
      shouldFollowDesktopBottom: existingBPlan?.shouldFollowBottom ?? true,
      lastDesktopScrollTop: existingBPlan?.top ?? 0,
      hasDesktopScrollPosition: true
    };
    expect(canPersistChatScrollRuntime(
      restoredB,
      "user:A",
      "B",
      "desktop"
    )).toBe(true);
    expect(restoredB.lastDesktopScrollTop).toBe(250);
    expect(restoredB.shouldFollowDesktopBottom).toBe(false);
  });

  it("invalidates restore ownership across empty-session round trips", () => {
    const restoreKeyRefs = {
      desktop: { current: "user:A:A:messages" },
      mobile: { current: "user:A:A:messages" }
    };
    const desktopRestoreKey = "user:A:A:messages";
    const loadedA = {
      ...createChatSessionScrollState("A"),
      loadedMessagesSessionId: "A",
      hasMessages: true
    };
    const emptyB = createChatSessionScrollState("B");

    expect(canRestoreChatScrollForSession(loadedA)).toBe(true);
    expect(shouldRestoreChatScrollSurface(
      desktopRestoreKey,
      restoreKeyRefs.desktop.current
    )).toBe(false);

    // A -> empty B: the incoming B runtime must not retain A's completion marker.
    resetChatScrollRestoreOwnership(restoreKeyRefs, ["desktop", "mobile"]);
    expect(restoreKeyRefs.desktop.current).toBeNull();
    expect(restoreKeyRefs.mobile.current).toBeNull();
    expect(shouldRestoreChatScrollSurface(
      desktopRestoreKey,
      restoreKeyRefs.desktop.current
    )).toBe(true);

    // B has no messages, so no restore occurs; B -> A must still allow A's restore.
    expect(canRestoreChatScrollForSession(emptyB)).toBe(false);
    expect(shouldRestoreChatScrollSurface(
      null,
      restoreKeyRefs.desktop.current
    )).toBe(false);
    resetChatScrollRestoreOwnership(restoreKeyRefs, ["desktop", "mobile"]);
    expect(canRestoreChatScrollForSession(loadedA)).toBe(true);
    expect(shouldRestoreChatScrollSurface(
      desktopRestoreKey,
      restoreKeyRefs.desktop.current
    )).toBe(true);
    expect(getChatScrollRestorePlan({
      hasMessages: true,
      savedTop: 620,
      scrollHeight: 1200,
      clientHeight: 400
    })?.top).toBe(620);
  });

  it("keeps existing-session restore markers independent across A/B round trips", () => {
    const restoreKeyRefs = {
      desktop: { current: "user:A:A:messages" },
      mobile: { current: "user:A:A:messages" }
    };
    const desktopAKey = "user:A:A:messages";
    const desktopBKey = "user:A:B:messages";
    const loadedA = {
      ...createChatSessionScrollState("A"),
      loadedMessagesSessionId: "A",
      hasMessages: true
    };
    const loadedB = {
      ...createChatSessionScrollState("B"),
      loadedMessagesSessionId: "B",
      hasMessages: true
    };

    // A -> existing B: B gets a fresh marker and can restore its own saved position.
    resetChatScrollRestoreOwnership(restoreKeyRefs, ["desktop"]);
    expect(canRestoreChatScrollForSession(loadedB)).toBe(true);
    expect(shouldRestoreChatScrollSurface(desktopBKey, restoreKeyRefs.desktop.current)).toBe(true);
    restoreKeyRefs.desktop.current = desktopBKey;
    expect(shouldRestoreChatScrollSurface(desktopBKey, restoreKeyRefs.desktop.current)).toBe(false);
    expect(getChatScrollRestorePlan({
      hasMessages: true,
      savedTop: 250,
      scrollHeight: 1200,
      clientHeight: 400
    })?.top).toBe(250);

    // B -> A: A is eligible again instead of inheriting B's completion marker.
    resetChatScrollRestoreOwnership(restoreKeyRefs, ["desktop"]);
    expect(canRestoreChatScrollForSession(loadedA)).toBe(true);
    expect(shouldRestoreChatScrollSurface(desktopAKey, restoreKeyRefs.desktop.current)).toBe(true);
    expect(getChatScrollRestorePlan({
      hasMessages: true,
      savedTop: 620,
      scrollHeight: 1200,
      clientHeight: 400
    })?.top).toBe(620);

    // Provider-owned mobile marker is unaffected by a desktop-only transition.
    expect(restoreKeyRefs.mobile.current).toBe("user:A:A:messages");
  });

  it("does not let loading, streaming, or error force follow after the user leaves bottom", () => {
    expect(chatWorkspaceSource).toContain("setIsMobileAwayFromBottom(!shouldFollow)");
    expect(chatWorkspaceSource).toContain("setIsDesktopAwayFromBottom(!shouldFollow)");
    expect(chatWorkspaceSource).toContain('data-chat-return-to-bottom={mode}');
    expect(chatWorkspaceSource).toContain('behavior: "smooth"');
    expect(chatWorkspaceSource).toContain('behavior: "auto"');
    expect(chatWorkspaceSource).not.toContain("shouldFollowMobileBottomRef.current = true;\n\n    const isFirstUserMessage");
  });

  it("persists only a scalar scroll position per account, session, and rendered surface", () => {
    window.sessionStorage.clear();
    const identity = "user:user-a";
    writeChatScrollTop(identity, "session-a", "mobile", 240);

    expect(readChatScrollTop(identity, "session-a", "mobile")).toBe(240);
    expect(readChatScrollTop(identity, "session-a", "desktop")).toBeNull();
    expect(readChatScrollTop("user:user-b", "session-a", "mobile")).toBeNull();
    expect(getChatScrollStorageKey(identity, "session-a", "mobile")).not.toContain("content");
  });

  it("keeps drafts across route remounts while separating guest and accounts", () => {
    window.sessionStorage.clear();
    writeChatDraft("guest", "guest draft");
    writeChatDraft("user:user-a", "A draft");
    writeChatDraft("user:user-b", "B draft");

    expect(readChatDraft("guest")).toBe("guest draft");
    expect(readChatDraft("user:user-a")).toBe("A draft");
    expect(readChatDraft("user:user-b")).toBe("B draft");
    expect(readChatDraft(null)).toBe("");
  });

  it("clears a draft by removing its storage record", () => {
    window.sessionStorage.clear();
    writeChatDraft("user:user-a", "draft");
    writeChatDraft("user:user-a", "");

    expect(readChatDraft("user:user-a")).toBe("");
  });

  it("enforces guest, user, and authenticated user-missing persistence identities", () => {
    const base = {
      hydrated: true,
      authStatus: "guest" as const,
      isLoggedIn: false,
      token: null,
      user: null
    };

    expect(resolveChatPersistenceIdentity(base)).toBe("guest");
    expect(resolveChatPersistenceIdentity({
      ...base,
      authStatus: "authenticated",
      isLoggedIn: true,
      token: "token-a",
      user: { id: "a" }
    })).toBe("user:a");
    expect(resolveChatPersistenceIdentity({
      ...base,
      authStatus: "authenticated",
      isLoggedIn: true,
      token: "token-unknown",
      user: null
    })).toBeNull();
    expect(resolveChatPersistenceIdentity({ ...base, hydrated: false })).toBeNull();
  });

  it("keeps token-present user-missing drafts memory-only without touching guest storage", () => {
    window.sessionStorage.clear();
    writeChatDraft("guest", "guest draft");
    writeChatDraft(null, "private draft");

    expect(readChatDraft(null)).toBe("");
    expect(readChatDraft("guest")).toBe("guest draft");
    expect(getChatScrollStorageKey(null, "session-a", "mobile")).toBeNull();
  });

  it("does not clear a guest draft after a user A send completes", () => {
    expect(shouldClearChatDraftAfterSend({
      currentIdentity: "guest",
      loadedDraftIdentity: "guest",
      persistenceIdentityAtSend: "user:A",
      currentDraft: "same",
      draftAtSend: "same"
    })).toBe(false);
  });

  it("does not clear a user B draft after a user A send completes", () => {
    expect(shouldClearChatDraftAfterSend({
      currentIdentity: "user:B",
      loadedDraftIdentity: "user:B",
      persistenceIdentityAtSend: "user:A",
      currentDraft: "same",
      draftAtSend: "same"
    })).toBe(false);
  });

  it("clears an unchanged draft when send identity remains owned", () => {
    expect(shouldClearChatDraftAfterSend({
      currentIdentity: "user:A",
      loadedDraftIdentity: "user:A",
      persistenceIdentityAtSend: "user:A",
      currentDraft: "same",
      draftAtSend: "same"
    })).toBe(true);
  });

  it("does not clear newer draft content from the same identity", () => {
    expect(shouldClearChatDraftAfterSend({
      currentIdentity: "user:A",
      loadedDraftIdentity: "user:A",
      persistenceIdentityAtSend: "user:A",
      currentDraft: "new content",
      draftAtSend: "same"
    })).toBe(false);
  });

  it("keeps markdown overflow at block boundaries", () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown
        content={"| A | B |\n|---|---|\n| long | value |\n\n```ts\nconst longCode = true;\n```\n\n`inline`"}
        messageId="markdown-contract"
      />
    );

    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("min-w-[36rem]");
    expect(html).toContain("whitespace-pre");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(globalStyles).toContain(".chat-markdown :not(pre) > code");
    expect(globalStyles).not.toContain("body {\n  overflow-x: hidden");
  });

  it("uses the same max-w-4xl content contract for chat and composer", () => {
    expect(chatWorkspaceSource).toContain("CHAT_CONTENT_CLASS_NAME");
    expect(chatWorkspaceSource).toContain('data-chat-message-scroll-container="true"');
  });

  it("guards concurrent session creation with a ref-based lock", () => {
    expect(chatWorkspaceSource).toContain(
      "const creatingSessionRef = useRef(false)"
    );
    expect(chatWorkspaceSource).toContain(
      "if (creatingSessionRef.current)"
    );
    expect(chatWorkspaceSource).toContain(
      "creatingSessionRef.current = true"
    );
    expect(chatWorkspaceSource).toContain(
      "creatingSessionRef.current = false"
    );
  });

  it("reuses the current empty chat session instead of creating a new one", () => {
    expect(chatWorkspaceSource).toContain(
      "isCurrentSessionEmpty = messages.length === 0"
    );
    expect(chatWorkspaceSource).toContain(
      "isCurrentSessionEmpty"
    );
    expect(chatWorkspaceSource).toContain(
      "desktopTextareaRef.current?.focus()"
    );
  });

  it("imports session-title utilities for short title generation", () => {
    expect(chatWorkspaceSource).toContain(
      "shouldRegenerateTitle"
    );
    expect(chatWorkspaceSource).toContain(
      "coordinateSessionTitle"
    );
  });

  it("defines an updateSessionTitle helper that uses coordinateSessionTitle", () => {
    expect(chatWorkspaceSource).toContain(
      "coordinateSessionTitle"
    );
    expect(chatWorkspaceSource).toContain(
      "updateSessionTitle"
    );
    expect(chatWorkspaceSource).toContain(
      "onTitleUpdated"
    );
    // PATCH method is delegated to coordinator
    const coordinatorSource = fs.readFileSync(
      path.join(process.cwd(), "lib/chat-title-coordinator.ts"),
      "utf8"
    );
    expect(coordinatorSource).toContain('method: "PATCH"');
    expect(coordinatorSource).toContain("title");
  });

  it("uses isFirstUserMessage flag and hasUserMessage helper", () => {
    expect(chatWorkspaceSource).toContain("isFirstUserMessage");
    expect(chatWorkspaceSource).toContain("hasUserMessage");
  });

  it("captures firstUserPrompt at send time for title generation", () => {
    expect(chatWorkspaceSource).toContain(
      "firstUserPrompt"
    );
    expect(chatWorkspaceSource).toContain(
      "shouldRegenerateTitle"
    );
  });

  it("delegates title update to coordinateSessionTitle", () => {
    expect(chatWorkspaceSource).toContain(
      "coordinateSessionTitle"
    );
  });

  it("wraps title update in void call so errors are silent", () => {
    expect(chatWorkspaceSource).toContain(
      "void coordinateSessionTitle"
    );
  });

  it("renders ConfirmDialog for draft discard protection", () => {
    expect(chatWorkspaceSource).toContain(
      "ConfirmDialog"
    );
    expect(chatWorkspaceSource).toContain(
      "isDiscardDraftOpen"
    );
    expect(chatWorkspaceSource).toContain(
      'title={t("chat.confirmDiscardTitle")}'
    );
    expect(chatWorkspaceSource).toContain(
      'message={t("chat.confirmDiscardMessage")}'
    );
  });

  it("protects against sending while creating new session", () => {
    expect(chatWorkspaceSource).toContain(
      "if (sendingRef.current || isLoading)"
    );
  });

  it("renders the mobile chat header with icon-only history and new-chat actions", () => {
    expect(chatWorkspaceSource).toContain('data-mobile-chat-header="true"');
    expect(chatWorkspaceSource).toContain('href="/chat/history"');
    expect(chatWorkspaceSource).toContain('aria-label={t("chat.history")}');
    expect(chatWorkspaceSource).toContain('aria-label={t("chat.newChat")}');
    expect(chatWorkspaceSource).toContain("<History");
    expect(chatWorkspaceSource).toContain("<Plus");
    expect(chatWorkspaceSource).not.toContain('data-mobile-menu-button="true"');
    expect(chatWorkspaceSource).not.toContain('type="file"');
  });

  it("uses public prompt cards and the configured public logo for the empty state", () => {
    expect(chatWorkspaceSource).toContain("parseWorkspacePromptCards");
    expect(chatWorkspaceSource).toContain("publicSettings?.workspacePromptCards");
    expect(chatWorkspaceSource).toContain("getPublicWorkspaceIconUrl(publicSettings)");
    expect(chatWorkspaceSource).toContain("getPublicLogoText(publicSettings)");
  });

  it("hands off a stable modelId from the model library and consumes it in chat", () => {
    expect(chatWorkspaceSource).toContain("chatModelHandoffStorageKey");
    expect(chatWorkspaceSource).toContain("readChatModelHandoff");
    expect(chatWorkspaceSource).toContain("handoffModelId");
    expect(chatWorkspaceSource).toContain("clearChatModelHandoff");
  });
});

describe("ChatWorkspace draft protection contracts", () => {
  it("detects draft via input.trim()", () => {
    expect(chatWorkspaceSource).toContain(
      "hasDraft = input.trim().length > 0"
    );
  });

  it("shows confirm dialog when draft exists before creating", () => {
    expect(chatWorkspaceSource).toContain(
      "if (hasDraft)"
    );
    expect(chatWorkspaceSource).toContain(
      "setIsDiscardDraftOpen(true)"
    );
  });

  it("prevents double dialog via isDiscardDraftOpen guard", () => {
    expect(chatWorkspaceSource).toContain(
      "if (isDiscardDraftOpen)"
    );
  });

  it("clears input and reuses session on discard confirm for empty session", () => {
    expect(chatWorkspaceSource).toContain(
      'setInput("")'
    );
    expect(chatWorkspaceSource).toContain(
      "pendingCreateAfterDiscardRef"
    );
  });

  it("creates session after discard confirm when current session has content", () => {
    expect(chatWorkspaceSource).toContain(
      "pendingCreateAfterDiscardRef.current = !isCurrentSessionEmpty"
    );
  });
});

describe("ChatWorkspace explicit-only Chat retry contract", () => {
  const nonStreamingSenderName = ["sendMessage", "NonStreaming"].join("");
  const fallbackHelperName = ["shouldFallbackTo", "NonStreaming"].join("");
  const streamFunctionSource = chatWorkspaceSource.slice(
    chatWorkspaceSource.indexOf("async function sendMessageStreaming"),
    chatWorkspaceSource.indexOf("async function sendMessage()")
  );
  const sendFunctionSource = chatWorkspaceSource.slice(
    chatWorkspaceSource.indexOf("async function sendMessage()"),
    chatWorkspaceSource.indexOf("function handleInputKeyDown")
  );

  it("has exactly one stream Chat HTTP entry and no non-stream fallback entry", () => {
    expect(chatWorkspaceSource).toContain(
      'fetch(apiUrl("/chat/completions/stream"),'
    );
    expect(
      chatWorkspaceSource.match(/fetch\(apiUrl\("\/chat\/completions\/stream"\),/g)
    ).toHaveLength(1);
    expect(chatWorkspaceSource).not.toContain(
      'apiUrl("/chat/completions"),'
    );
    expect(chatWorkspaceSource).not.toContain(nonStreamingSenderName);
    expect(chatWorkspaceSource).not.toContain(fallbackHelperName);
  });

  it.each([404, 405, 501])(
    "treats stream HTTP %i as the same safe terminal error path",
    (status) => {
      expect(streamFunctionSource).not.toContain(String(status));
      expect(streamFunctionSource).toContain("showAssistantError();");
      expect(streamFunctionSource).not.toContain(
        "readResponseErrorMessage(response"
      );
    }
  );

  it.each([429, 500])(
    "does not add an automatic second request for stream HTTP %i",
    (status) => {
      expect(streamFunctionSource).not.toContain(String(status));
      expect(sendFunctionSource).not.toContain(nonStreamingSenderName);
    }
  );

  it("ends loading and preserves the optimistic user plus safe assistant error state", () => {
    expect(sendFunctionSource).toContain("optimisticUserMessage");
    expect(sendFunctionSource).toContain("optimisticAssistantMessage");
    expect(sendFunctionSource).toContain("setMessages((current) => [");
    expect(streamFunctionSource).toContain("showAssistantError");
    expect(sendFunctionSource).toContain("releaseChatSendLock(sendingRef)");
    expect(sendFunctionSource).toContain("setIsLoading(false)");
    expect(streamFunctionSource).not.toContain('content: data.content');
  });

  it("allows a second request only through a new explicit composer action", () => {
    expect(sendFunctionSource).toContain(
      "clearInputDraft(draftAtSend, persistenceIdentityAtSend)"
    );
    expect(sendFunctionSource).toContain(
      "const persistenceIdentityAtSend = persistenceIdentity"
    );
    expect(sendFunctionSource).toContain("await sendMessageStreaming");
    expect(sendFunctionSource).not.toContain("setTimeout");
    expect(sendFunctionSource).not.toContain("setInterval");
    expect(sendFunctionSource).not.toContain(nonStreamingSenderName);
    expect(chatWorkspaceSource).toContain("onSend={() => void sendMessage()}");
    expect(chatWorkspaceSource).toContain("if (canSendMessage) {");
    expect(chatWorkspaceSource).toContain("void sendMessage();");
  });

  it("does not hide retry in effects, recursion, abort handling, or a retry counter", () => {
    expect(sendFunctionSource).not.toContain("useEffect");
    expect(sendFunctionSource).not.toContain("sendMessage();");
    expect(sendFunctionSource).not.toContain("retry");
    expect(sendFunctionSource).not.toContain("streamResult");
    expect(sendFunctionSource).not.toContain(nonStreamingSenderName);
    expect(streamFunctionSource).not.toContain("AbortController");
    expect(streamFunctionSource).not.toContain("signal:");
  });

  it("uses the same send handler for both mobile and desktop composers", () => {
    expect(chatWorkspaceSource).toContain(
      'renderChatSurface(mobileTextareaRef, "mobile")'
    );
    expect(chatWorkspaceSource).toContain(
      'renderChatSurface(desktopTextareaRef, "desktop")'
    );
    expect(chatWorkspaceSource.match(/onSend=\{\(\) => void sendMessage\(\)\}/g)).toHaveLength(1);
  });

  it("keeps the existing streaming, model, and send/stop contracts in the bounded slice", () => {
    expect(chatWorkspaceSource).toContain('apiUrl("/chat/completions/stream")');
    expect(chatWorkspaceSource).toContain("parseChatCompletionStreamChunk");
    expect(chatWorkspaceSource).toContain("selectModelAndReturnToChat");
    expect(chatWorkspaceSource).toContain("releaseChatSendLock(sendingRef)");
    expect(chatWorkspaceSource).toContain('onSend={() => void sendMessage()}');
  });
});

describe("ChatWorkspace dual-surface message anchors", () => {
  it("renders mobile and desktop message surfaces with duplicate data anchors but unique ids", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <>
          <div className="md:hidden" data-testid="mobile-container">
            {[
              { id: "u1", content: "First" },
              { id: "u2", content: "Second" }
            ].map((message) => (
              <div
                key={message.id}
                id={getChatTurnAnchorId("mobile", message.id)}
                data-chat-turn-anchor={message.id}
              >
                {message.content}
              </div>
            ))}
          </div>
          <div className="hidden md:block" data-testid="desktop-container">
            {[
              { id: "u1", content: "First" },
              { id: "u2", content: "Second" }
            ].map((message) => (
              <div
                key={message.id}
                id={getChatTurnAnchorId("desktop", message.id)}
                data-chat-turn-anchor={message.id}
              >
                {message.content}
              </div>
            ))}
          </div>
        </>
      );
    });

    const mobile = host.querySelector<HTMLElement>('[data-testid="mobile-container"]')!;
    const desktop = host.querySelector<HTMLElement>('[data-testid="desktop-container"]')!;
    const u1Targets = host.querySelectorAll('[data-chat-turn-anchor="u1"]');
    const ids = Array.from(host.querySelectorAll<HTMLElement>("[id]"), (node) => node.id);

    expect(mobile).toBeTruthy();
    expect(desktop).toBeTruthy();
    expect(u1Targets).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(mobile.querySelector("#chat-turn-mobile-u1")).toBeTruthy();
    expect(desktop.querySelector("#chat-turn-desktop-u1")).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
