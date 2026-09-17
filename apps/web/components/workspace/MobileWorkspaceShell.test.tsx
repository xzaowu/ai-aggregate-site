import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "../../lib/i18n/types";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { MobileWorkspaceShell } from "./MobileWorkspaceShell";
import {
  getWorkspacePanelUrl,
  mobileBottomWorkspaceNavItems
} from "./workspace-navigation";
import { WorkspaceShellProvider } from "./workspace-shell-context";

const navigationState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname
}));

function renderWithLocale(node: React.ReactNode, locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{ locale, setLocale: vi.fn(), t: createTranslator(locale) }}
    >
      <WorkspaceShellProvider gateUntilHydrated={false}>
        {node}
      </WorkspaceShellProvider>
    </I18nContext.Provider>
  );
}

function renderShell() {
  return renderWithLocale(
    <MobileWorkspaceShell
      siteName="AI"
      currentTitle="Conversation"
      currentModelLabel="GPT Test"
      activePanel={null}
      compactChatHeader
      compactMenuOnly
      mobileDrawerPanelOverride={<div data-old-drawer="true" />}
      isLoggedIn
      isAdmin
      onNavigate={vi.fn()}
      onCreateSession={vi.fn()}
      onLogout={vi.fn()}
    >
      <div>Workspace content</div>
    </MobileWorkspaceShell>
  );
}

describe("MobileWorkspaceShell", () => {
  beforeEach(() => {
    navigationState.pathname = "/";
  });

  it("renders exactly four mobile entries and no duplicate menu or drawer", () => {
    const html = renderShell();

    expect(html).toContain('data-mobile-workspace-shell="true"');
    expect(html).toContain('data-mobile-bottom-nav="true"');
    expect(html).toContain('data-mobile-bottom-nav-count="4"');
    expect(html.match(/data-mobile-nav-key=/g)).toHaveLength(4);
    expect(html).toContain("Chat");
    expect(html).toContain("Create");
    expect(html).toContain("Works");
    expect(html).toContain("Me");
    expect(html).not.toContain('data-mobile-menu-button="true"');
    expect(html).not.toContain('data-mobile-drawer="true"');
    expect(html).not.toContain('data-mobile-drawer-backdrop="true"');
    expect(html).not.toContain("Video Creation");
    expect(html).not.toContain("PPT Generation");
    expect(html).not.toContain("Creator Canvas");
  });

  it.each([
    ["/image", "creation"],
    ["/video", "creation"],
    ["/canvas", "creation"],
    ["/ppt", "creation"],
    ["/tasks", "works"],
    ["/tasks/task-1", "works"],
    ["/assets", "works"],
    ["/assets/asset-1", "works"],
    ["/account", "account"]
  ] as const)("selects the grouped entry for %s", (pathname, key) => {
    navigationState.pathname = pathname;
    const html = renderShell();

    expect(html).toContain(`data-active-panel="${key}"`);
    expect(html).toContain(`data-mobile-nav-key="${key}"`);
    expect(html).toContain('aria-current="page"');
  });

  it.each([
    ["/models", "account"],
    ["/feedback", "account"],
    ["/help", "account"],
    ["/links", "account"],
    ["/chat/history", "chat"]
  ] as const)("maps secondary route %s to mobile entry %s", (pathname, key) => {
    navigationState.pathname = pathname;
    const html = renderShell();
    expect(html).toContain(`data-active-panel="${key}"`);
  });

  it("keeps content below the fixed bottom navigation and uses safe-area padding", () => {
    const html = renderShell();

    expect(html).toContain("pb-[calc(5.5rem+env(safe-area-inset-bottom))]");
    expect(html).toContain(
      "pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
    );
    expect(html).toContain("min-h-12");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("Workspace content");
  });

  it("keeps clean panel URL helpers available for desktop and account routes", () => {
    expect(getWorkspacePanelUrl(null)).toBe("/");
    expect(getWorkspacePanelUrl("account")).toBe("/account");
    expect(mobileBottomWorkspaceNavItems).toHaveLength(4);
    expect(mobileBottomWorkspaceNavItems.map((item) => item.key)).toEqual([
      "chat",
      "creation",
      "works",
      "account"
    ]);
  });
});
