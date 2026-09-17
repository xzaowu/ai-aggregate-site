// @vitest-environment jsdom

import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLayoutClient } from "./workspace-layout-client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const layoutState = vi.hoisted(() => ({
  pathname: "/",
  mediaQuery: null as {
    matches: boolean;
    listener: ((event: Event) => void) | null;
  } | null
}));

vi.mock("next/navigation", () => ({
  usePathname: () => layoutState.pathname
}));

vi.mock("../../components/workspace/use-workspace-shell", () => ({
  useWorkspaceShell: () => ({
    siteName: "AI Aggregate",
    logoText: "AI",
    logoUrl: null,
    isLoggedIn: true,
    isAdmin: false,
    navigateToWorkspacePanel: vi.fn(),
    createSession: vi.fn(),
    logout: vi.fn(),
    remainingCredits: 20,
    planName: "free",
    theme: "light",
    toggleTheme: vi.fn()
  })
}));

vi.mock("../../components/workspace/SidebarNav", () => ({
  SidebarNav: () => React.createElement("nav", { "data-test-desktop-sidebar": "true" })
}));

vi.mock("../../components/workspace/workspace-shell-context", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => children;

  return {
    WorkspaceShellProvider: passthrough,
    WorkspaceSurfaceProvider: passthrough,
    WorkspaceShellLoadingShell: () =>
      React.createElement("div", { "data-workspace-surface-loading": "true" }),
    useOptionalWorkspaceShellContext: () => null,
    useWorkspaceShellContext: () => ({
      currentTitle: null,
      currentModelLabel: null,
      sidebar: null,
      createSession: null
    })
  };
});

vi.mock("../../lib/i18n/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let mountedCount = 0;
let cleanupCount = 0;
let activeCount = 0;
let maxActiveCount = 0;

function ProbeChild() {
  useEffect(() => {
    mountedCount += 1;
    activeCount += 1;
    maxActiveCount = Math.max(maxActiveCount, activeCount);

    return () => {
      cleanupCount += 1;
      activeCount -= 1;
    };
  }, []);

  return React.createElement("div", { "data-route-probe": "true" }, "route child");
}

function layoutElement(routeChildren: React.ReactNode = <ProbeChild />) {
  return (
    <WorkspaceLayoutClient gateUntilHydrated={false}>
      {routeChildren}
    </WorkspaceLayoutClient>
  );
}

function installMediaQuery(matches: boolean) {
  const mediaQuery = {
    matches,
    listener: null as ((event: Event) => void) | null
  };
  layoutState.mediaQuery = mediaQuery;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return mediaQuery.matches;
      },
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: (_type: string, listener: (event: Event) => void) => {
        mediaQuery.listener = listener;
      },
      removeEventListener: (_type: string, listener: (event: Event) => void) => {
        if (mediaQuery.listener === listener) {
          mediaQuery.listener = null;
        }
      },
      addListener: (listener: (event: Event) => void) => {
        mediaQuery.listener = listener;
      },
      removeListener: (listener: (event: Event) => void) => {
        if (mediaQuery.listener === listener) {
          mediaQuery.listener = null;
        }
      },
      dispatchEvent: () => true
    }))
  );
}

async function renderLayout(
  matches: boolean,
  routeChildren: React.ReactNode = <ProbeChild />
) {
  installMediaQuery(matches);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);

  await act(async () => {
    root?.render(layoutElement(routeChildren));
    await Promise.resolve();
  });
}

type RouteProbePath = "chat" | "image";

function RouteRequestProbe({ route }: { route: RouteProbePath }) {
  useEffect(() => {
    if (route === "chat") {
      void fetch("/api/auth/me");
      void fetch("/api/models");
      void fetch("/api/chat/sessions");
      void fetch("/api/chat/sessions/chat-route/messages");
      return;
    }

    void fetch("/api/models?surface=image");
    void fetch("/api/tasks?type=image&limit=100");
  }, [route]);

  return React.createElement("div", {
    "data-route-request-probe": route
  });
}

function RouteSwitchHarness({
  onRouteSetter
}: {
  onRouteSetter: (setter: (route: RouteProbePath) => void) => void;
}) {
  const [route, setRoute] = useState<RouteProbePath>("chat");
  onRouteSetter(setRoute);
  return <RouteRequestProbe route={route} />;
}

function countRouteRequests(
  fetchMock: { mock: { calls: unknown[][] } },
  pathname: string,
  search?: string
): number {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = new URL(String(input), "http://localhost");
    return url.pathname === pathname && (search === undefined || url.search === search);
  }).length;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  layoutState.mediaQuery = null;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mountedCount = 0;
  cleanupCount = 0;
  activeCount = 0;
  maxActiveCount = 0;
  layoutState.pathname = "/";
});

describe("WorkspaceLayoutClient responsive surface ownership", () => {
  it("keeps route children out of the SSR and hydration-unknown surface", () => {
    const html = renderToStaticMarkup(layoutElement());

    expect(html).toContain('data-workspace-surface-loading="true"');
    expect(html).not.toContain('data-route-probe="true"');
  });

  it("mounts exactly one mobile route tree", async () => {
    await renderLayout(false);

    expect(mountedCount).toBe(1);
    expect(activeCount).toBe(1);
    expect(maxActiveCount).toBe(1);
    expect(host?.querySelectorAll('[data-route-probe="true"]')).toHaveLength(1);
    expect(host?.querySelector('[data-mobile-workspace-shell="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-desktop-workspace-shell="true"]')).toBeNull();
  });

  it("mounts exactly one desktop route tree", async () => {
    await renderLayout(true);

    expect(mountedCount).toBe(1);
    expect(activeCount).toBe(1);
    expect(maxActiveCount).toBe(1);
    expect(host?.querySelectorAll('[data-route-probe="true"]')).toHaveLength(1);
    expect(host?.querySelector('[data-desktop-workspace-shell="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-mobile-workspace-shell="true"]')).toBeNull();
  });

  it("gives the canonical canvas route fullscreen editor ownership", async () => {
    layoutState.pathname = "/canvas";
    await renderLayout(true);

    const fullscreenShell = host?.querySelector('[data-canvas-fullscreen-editor-shell="true"]');
    expect(fullscreenShell).toBeTruthy();
    expect(fullscreenShell?.className).toContain("h-[100dvh]");
    expect(host?.querySelector('[data-route-probe="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-desktop-workspace-shell="true"]')).toBeNull();
    expect(host?.querySelector('[data-test-desktop-sidebar="true"]')).toBeNull();
    expect(host?.querySelector('[data-mobile-workspace-shell="true"]')).toBeNull();
    expect(host?.querySelector('[data-mobile-bottom-nav="true"]')).toBeNull();
  });

  it("keeps canonical canvas fenced inside the shared four-item mobile shell", async () => {
    layoutState.pathname = "/canvas";
    await renderLayout(false);

    expect(host?.querySelector('[data-canvas-fullscreen-editor-shell="true"]')).toBeNull();
    expect(host?.querySelector('[data-mobile-workspace-shell="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-mobile-bottom-nav="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-mobile-bottom-nav-count="4"]')).toBeTruthy();
    expect(host?.querySelector('[data-desktop-workspace-shell="true"]')).toBeNull();
  });

  it.each(["/video", "/video/workspace", "/image", "/tasks", "/assets", "/canvas/library", "/"])(
    "keeps normal desktop AppShell ownership for %s",
    async (pathname) => {
      layoutState.pathname = pathname;
      await renderLayout(true);

      expect(host?.querySelector('[data-canvas-fullscreen-editor-shell="true"]')).toBeNull();
      expect(host?.querySelector('[data-desktop-workspace-shell="true"]')).toBeTruthy();
      expect(host?.querySelector('[data-test-desktop-sidebar="true"]')).toBeTruthy();
    }
  );

  it("remounts once across a real breakpoint change without overlap", async () => {
    await renderLayout(false);

    const mediaQuery = layoutState.mediaQuery;
    expect(mediaQuery?.listener).toBeTypeOf("function");

    await act(async () => {
      if (mediaQuery) {
        mediaQuery.matches = true;
        mediaQuery.listener?.(new Event("change"));
      }
      await Promise.resolve();
    });

    expect(cleanupCount).toBe(1);
    expect(mountedCount).toBe(2);
    expect(activeCount).toBe(1);
    expect(maxActiveCount).toBe(1);
    expect(host?.querySelectorAll('[data-route-probe="true"]')).toHaveLength(1);
    expect(host?.querySelector('[data-desktop-workspace-shell="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-mobile-workspace-shell="true"]')).toBeNull();
  });

  it("keeps Chat/Image route bootstrap requests linear across repeated switches", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    let setRoute: ((route: RouteProbePath) => void) | null = null;

    await renderLayout(
      true,
      <RouteSwitchHarness onRouteSetter={(setter) => { setRoute = setter; }} />
    );

    const switchRoute = async (route: RouteProbePath) => {
      await act(async () => {
        setRoute?.(route);
        await Promise.resolve();
      });
    };

    for (let index = 0; index < 5; index += 1) {
      await switchRoute("image");
      await switchRoute("chat");
    }

    expect(countRouteRequests(fetchMock, "/api/auth/me")).toBe(6);
    expect(countRouteRequests(fetchMock, "/api/models", "")).toBe(6);
    expect(countRouteRequests(fetchMock, "/api/chat/sessions")).toBe(6);
    expect(
      countRouteRequests(fetchMock, "/api/chat/sessions/chat-route/messages")
    ).toBe(6);
    expect(
      countRouteRequests(fetchMock, "/api/tasks", "?type=image&limit=100")
    ).toBe(5);
    expect(
      countRouteRequests(fetchMock, "/api/models", "?surface=image")
    ).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(6 * 4 + 5 * 2);
  });
});
