// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { CanvasWorkspaceShell } from "./CanvasWorkspaceShell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ usePathname: () => "/canvas" }));
vi.mock("./SidebarNav", () => ({
  SidebarNav: () => (
    <nav data-reused-sidebar-nav="true">
      <a href="/image">Image Creation</a>
      <a href="/video">Video Creation</a>
      <a href="/canvas" aria-current="page">Creator Canvas</a>
    </nav>
  )
}));

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(currentTitle?: string | null): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <CanvasWorkspaceShell
          isLoggedIn={false}
          isAdmin={false}
          onLogout={vi.fn()}
          currentTitle={currentTitle}
          siteName="AI Aggregate"
        >
          <div data-canvas-graph="true" />
        </CanvasWorkspaceShell>
      </I18nContext.Provider>
    );
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("CanvasWorkspaceShell", () => {
  it("shows the current Canvas identity and uses the localized Untitled fallback", async () => {
    await mount("Quarterly launch Canvas");
    expect(host?.querySelector('[data-creator-canvas-current-title="true"]')
      ?.textContent).toBe("Quarterly launch Canvas");
    expect(host?.querySelector('[data-creator-canvas-current-title="true"]')
      ?.textContent).not.toBe("Creator Canvas");

    await act(async () => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    await mount(null);
    const fallbackHost = host as HTMLDivElement | null;
    expect(fallbackHost?.querySelector('[data-creator-canvas-current-title="true"]')
      ?.textContent).toBe("Untitled Canvas");
  });

  it("keeps Canvas fullscreen without permanent sidebar width consumption", async () => {
    await mount();

    expect(host?.querySelector('[data-canvas-fullscreen-editor-shell="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-canvas-permanent-sidebar="false"]')).toBeTruthy();
    expect(host?.querySelector('[data-canvas-graph="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-canvas-nav-trigger="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-canvas-nav-drawer="true"]')).toBeNull();
    expect(host?.textContent).not.toContain("Back to creation");
  });

  it("opens an accessible overlay that directly reuses SidebarNav", async () => {
    await mount();
    const trigger = host?.querySelector<HTMLButtonElement>('[data-canvas-nav-trigger="true"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-controls")).toBe("creator-canvas-navigation-drawer");

    await act(async () => trigger?.click());

    const drawer = host?.querySelector('[data-canvas-nav-drawer="true"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(drawer?.getAttribute("role")).toBe("dialog");
    expect(drawer?.getAttribute("aria-modal")).toBe("true");
    expect(host?.querySelector('[data-reused-sidebar-nav="true"]')).toBeTruthy();
    expect(host?.querySelector('a[href="/canvas"]')?.getAttribute("aria-current")).toBe("page");
  });

  it("closes from the backdrop and Escape", async () => {
    await mount();
    const trigger = host?.querySelector<HTMLButtonElement>('[data-canvas-nav-trigger="true"]');

    await act(async () => trigger?.click());
    await act(async () => host?.querySelector<HTMLButtonElement>('[data-canvas-nav-backdrop="true"]')?.click());
    expect(host?.querySelector('[data-canvas-nav-drawer="true"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => trigger?.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host?.querySelector('[data-canvas-nav-drawer="true"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
