import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@ai-aggregate/shared";
import { authTokenKey, authUserKey } from "../auth-state";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  getInitialWorkspaceShellState,
  resolveWorkspaceAuthState,
  WorkspaceShellProvider,
  useWorkspaceShellContext
} from "./workspace-shell-context";

const user: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  role: "USER",
  credits: 12
};

function createStorage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    })
  };
}

function AuthProbe() {
  const { shell } = useWorkspaceShellContext();

  return (
    <output
      data-auth-status={shell.authStatus}
      data-hydrated={String(shell.hydrated)}
      data-is-logged-in={String(shell.isLoggedIn)}
      data-token={shell.token ?? ""}
      data-user-email={shell.user?.email ?? ""}
    />
  );
}

function renderProbe(gateUntilHydrated = false) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      <WorkspaceShellProvider gateUntilHydrated={gateUntilHydrated}>
        <AuthProbe />
      </WorkspaceShellProvider>
    </I18nContext.Provider>
  );
}

function withWindowStorage<T>(storage: ReturnType<typeof createStorage>, fn: () => T): T {
  const previousWindow = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage }
  });

  try {
    return fn();
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow
      });
    }
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("WorkspaceShellProvider authentication hydration", () => {
  it("starts SSR and the first client render in the same auth-unknown state", () => {
    const serverHtml = renderProbe();
    const storage = createStorage({
      [authTokenKey]: "stored-token",
      [authUserKey]: JSON.stringify(user)
    });
    const clientFirstRenderHtml = withWindowStorage(storage, renderProbe);

    expect(serverHtml).toBe(clientFirstRenderHtml);
    expect(serverHtml).toContain('data-auth-status="unknown"');
    expect(serverHtml).toContain('data-hydrated="false"');
    expect(serverHtml).toContain('data-is-logged-in="false"');
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("does not read localStorage while rendering on the server", () => {
    const storage = createStorage({ [authTokenKey]: "server-must-not-read" });
    const previousWindow = (globalThis as { window?: unknown }).window;
    Reflect.deleteProperty(globalThis, "window");

    try {
      renderProbe();
      expect(storage.getItem).not.toHaveBeenCalled();
    } finally {
      if (previousWindow !== undefined) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow
        });
      }
    }
  });

  it("uses the same stable loading shell on SSR and the first client render", () => {
    const serverHtml = renderProbe(true);
    const clientFirstRenderHtml = withWindowStorage(
      createStorage({ [authTokenKey]: "stored-token" }),
      () => renderProbe(true)
    );

    expect(serverHtml).toBe(clientFirstRenderHtml);
    expect(serverHtml).toContain('data-workspace-auth-loading="true"');
    expect(serverHtml).not.toContain('data-auth-status="authenticated"');
  });

  it("resolves a stored token to authenticated state after hydration", () => {
    const storage = createStorage({
      [authTokenKey]: "stored-token",
      [authUserKey]: JSON.stringify(user)
    });

    expect(resolveWorkspaceAuthState(storage)).toMatchObject({
      authStatus: "authenticated",
      hydrated: true,
      isLoggedIn: true,
      isAdmin: false,
      token: "stored-token",
      user
    });
  });

  it("resolves missing storage auth to guest state after hydration", () => {
    expect(resolveWorkspaceAuthState(createStorage())).toMatchObject({
      authStatus: "guest",
      hydrated: true,
      isLoggedIn: false,
      isAdmin: false,
      token: null,
      user: null
    });
  });

  it("uses an auth-unknown initial state that cannot trigger authenticated redirects", () => {
    const initial = getInitialWorkspaceShellState();

    expect(initial.authStatus).toBe("unknown");
    expect(initial.hydrated).toBe(false);
    expect(initial.token).toBeNull();
    expect(initial.isLoggedIn).toBe(false);
  });
});
