import React from "react";
import type { LinkEntry } from "@ai-aggregate/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "../../lib/i18n/types";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  SidebarNav,
  WorkspaceLanguageSwitch,
  getNextWorkspaceLocale
} from "./SidebarNav";
import type { WorkspacePanel } from "./workspace-navigation";
import { invokeWorkspaceBillingAction } from "./workspace-shell-context";

const publicLinksState = vi.hoisted(() => ({
  links: [] as LinkEntry[],
  workspaceLinksLabel: null as string | null,
  pathname: "/chat",
  routerPush: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: () => publicLinksState.pathname,
  useRouter: () => ({
    push: publicLinksState.routerPush
  })
}));

vi.mock("../../lib/use-public-links", () => ({
  publicWorkspaceLinks: (links: LinkEntry[]) =>
    links
      .filter(
        (link) =>
          link.enabled && ["api", "resource", "friend"].includes(link.category)
      )
      .sort((a, b) => a.sortOrder - b.sortOrder),
  usePublicLinks: () => publicLinksState.links
}));

vi.mock("../../lib/use-public-settings", () => ({
  usePublicSettings: () =>
    publicLinksState.workspaceLinksLabel
      ? { workspaceLinksLabel: publicLinksState.workspaceLinksLabel }
      : {}
}));

function renderWithLocale(node: React.ReactNode, locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      {node}
    </I18nContext.Provider>
  );
}

function renderSidebar({
  isLoggedIn = false,
  isAdmin = false,
  locale = "en-US",
  siteName,
  logoText,
  logoUrl
}: {
  isLoggedIn?: boolean;
  isAdmin?: boolean;
  locale?: Locale;
  siteName?: string;
  logoText?: string;
  logoUrl?: string | null;
} = {}) {
  return renderWithLocale(
    <SidebarNav
      isLoggedIn={isLoggedIn}
      isAdmin={isAdmin}
      onLogout={vi.fn()}
      siteName={siteName}
      logoText={logoText}
      logoUrl={logoUrl}
    />,
    locale
  );
}

describe("SidebarNav workspace navigation", () => {
  beforeEach(() => {
    publicLinksState.links = [];
    publicLinksState.workspaceLinksLabel = null;
    publicLinksState.pathname = "/chat";
    publicLinksState.routerPush.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders a Plans link for desktop guests in the main sidebar", () => {
    const html = renderSidebar();

    expect(html).toContain('href="/plans"');
    expect(html).toContain("Plans &amp; pricing");
    expect(html).not.toContain('href="/pricing"');
  });

  it("renders Models as a workspace panel link", () => {
    const html = renderSidebar();

    expect(html).toContain('href="/models"');
    expect(html).toContain("Model Library");
  });

  it("renders final workspace navigation groups and naming", () => {
    const html = renderSidebar();

    expect(html).toContain("w-[260px]");
    expect(html).toContain("Creative workspace");
    expect(html).toContain("Create");
    expect(html).toContain("Manage");
    expect(html).toContain("Services");
    expect(html).toContain("Links");
    expect(html).toContain("Image Creation");
    expect(html).toContain("Video Creation");
    expect(html).toContain("Creator Canvas");
    expect(html).not.toContain("PPT Generation");
    expect(html).toContain("Model Library");
    expect(html).toContain("Asset Library");
  });

  it("renders a compact language toggle in the workspace rail", () => {
    const html = renderSidebar();

    // Language switch is now a compact icon button, not full text buttons
    // Language is now a compact icon button; check for language-related ARIA label
    expect(html).toContain("aria-label");
    // The Language text label may still appear in aria-label attributes
    expect(html).toContain("Language");
  });

  it("renders a configured logo image and falls back to logo text", () => {
    const withLogo = renderSidebar({
      siteName: "Brand Console",
      logoText: "BC",
      logoUrl: "https://example.com/logo.png"
    });
    const withoutLogo = renderSidebar({
      siteName: "Brand Console",
      logoText: "BC",
      logoUrl: null
    });

    expect(withLogo).toContain('src="https://example.com/logo.png"');
    expect(withLogo).toContain('alt="Brand Console"');
    expect(withoutLogo).toContain("BC");
    expect(withoutLogo).not.toContain('src="https://example.com/logo.png"');
  });

  it("changes the next visible locale when the language switch is clicked", () => {
    expect(getNextWorkspaceLocale("zh-CN")).toBe("en-US");
    expect(getNextWorkspaceLocale("en-US")).toBe("zh-CN");
  });

  it("renders a Login entry for logged-out users", () => {
    const html = renderSidebar();

    expect(html).not.toContain('href="/login"');
    expect(html).toContain("Login");
    expect(html).not.toContain('href="/account"');
  });

  it("renders an Account entry in account card for logged-in users", () => {
    const html = renderSidebar({ isLoggedIn: true });

    expect(html).not.toContain('href="/account"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('href="/login"');
  });

  it("renders an Admin entry for admin users", () => {
    const html = renderSidebar({ isLoggedIn: true, isAdmin: true });

    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain("Admin Panel");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("renders a Help link in the account card menu for logged-in users", () => {
    const html = renderSidebar({ isLoggedIn: true });

    expect(html).not.toContain('href="/help"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("renders a Help link in account card for logged-in users and hides it for guests", () => {
    const loggedOut = renderSidebar({ isLoggedIn: false });
    const loggedIn = renderSidebar({ isLoggedIn: true });

    expect(loggedOut).not.toContain('href="/help"');
    expect(loggedIn).not.toContain('href="/help"');
    expect(loggedOut).not.toContain('aria-haspopup="menu"');
  });

  it("renders multimodal workspace entries as route links", () => {
    const html = renderSidebar();

    expect(html).toContain('href="/image"');
    expect(html).toContain('href="/video"');
    expect(html).toContain('href="/canvas"');
    expect(html).not.toContain('href="/ppt"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('href="/assets"');
    expect(html).toContain("Creator Canvas");
    expect(html).not.toContain("PPT Generation");
    expect(html).toContain("Image Creation");
    expect(html).toContain("Video Creation");
    expect(html).toContain("Tasks");
    expect(html).toContain("Asset Library");
    expect(html).toContain("Coming soon");
  });

  it("renders Video and Creator Canvas as routes without advertising PPT", () => {
    const html = renderSidebar({ locale: "zh-CN" });

    expect(html).toContain("视频创作");
    expect(html).toContain('href="/video"');
    expect(html).toContain("创作画布");
    expect(html).toContain('href="/canvas"');
    expect(html).toContain("套餐与价格");
    expect(html).toContain('href="/plans"');
    expect(html).not.toContain("PPT 生成");
  });

  it("marks the current route active in standalone workspace navigation", () => {
    publicLinksState.pathname = "/image";

    const html = renderSidebar();

    expect(html).toContain('href="/image"');
    expect(html).toContain("bg-indigo-50");
  });

  it("marks Creator Canvas as the current page in reused navigation", () => {
    publicLinksState.pathname = "/canvas";

    const html = renderSidebar();

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/canvas"');
  });

  it("renders enabled external workspace links and hides disabled links", () => {
    publicLinksState.links = [
      {
        id: "api",
        title: "API console",
        url: "https://api.example.test",
        description: null,
        category: "api",
        enabled: true,
        sortOrder: 2,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z"
      },
      {
        id: "friend",
        title: "Partner",
        url: "https://partner.example.test",
        description: null,
        category: "friend",
        enabled: true,
        sortOrder: 1,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z"
      },
      {
        id: "hidden",
        title: "Hidden link",
        url: "https://hidden.example.test",
        description: null,
        category: "resource",
        enabled: false,
        sortOrder: 0,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z"
      }
    ];

    const html = renderSidebar();

    // External links no longer expanded as individual entries
    // Instead, a single "Links" nav entry navigates to the Links panel/page
    expect(html).toContain("Links");
    expect(html).not.toContain("Partner");
    expect(html).not.toContain("API console");
    expect(html).not.toContain("Hidden link");
    publicLinksState.links = [];
  });

  it("keeps the Links nav label stable regardless of external link count", () => {
    publicLinksState.workspaceLinksLabel = "Useful links";
    publicLinksState.links = [
      {
        id: "useful",
        title: "Useful resource",
        url: "https://useful.example.test",
        description: null,
        category: "resource",
        enabled: true,
        sortOrder: 1,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z"
      }
    ];

    const html = renderSidebar();

    // Links nav entry should still use the stable i18n label
    expect(html).toContain("Links");
    expect(html).not.toContain("Useful links");
  });

  it("renders nav items with justify-start for consistent left alignment", () => {
    const html = renderSidebar();

    // Every nav item (Link or button with railItemClass) should have justify-start
    expect(html).toContain("justify-start");
    // Labels should enforce text-left to resist inherited text-center
    expect(html).toContain("text-left");
  });

  it("renders tasks and assets entries with accessible labels", () => {
    const html = renderSidebar();

    // Tasks and Assets have accessible labels on parent links
    expect(html).toContain('aria-label="Tasks"');
    expect(html).toContain('aria-label="Asset Library"');
  });
});

function renderPanelSidebar({
  isLoggedIn = false,
  isAdmin = false,
  activePanel = null as WorkspacePanel,
  locale = "en-US" as Locale
} = {}) {
  const html = renderWithLocale(
    <SidebarNav
      isLoggedIn={isLoggedIn}
      isAdmin={isAdmin}
      onLogout={vi.fn()}
      activePanel={activePanel}
    />,
    locale
  );
  return { html };
}

describe("SidebarNav clean route anchor routing (no panel mode)", () => {
  beforeEach(() => {
    publicLinksState.links = [];
    publicLinksState.workspaceLinksLabel = null;
    publicLinksState.pathname = "/chat";
  });

  it("renders Chat as anchor href=/ when activePanel=models", () => {
    const { html } = renderPanelSidebar({ activePanel: "models" });

    expect(html).toContain("Chat");
    expect(html).toContain('href="/"');
  });

  it("renders Models as anchor href=/models when activePanel=models", () => {
    const { html } = renderPanelSidebar({ activePanel: "models" });

    expect(html).toContain("Model Library");
    expect(html).toContain('href="/models"');
  });

  it("renders Image as anchor href=/image when activePanel=models", () => {
    const { html } = renderPanelSidebar({ activePanel: "models" });

    expect(html).toContain('href="/image"');
  });

  it("renders Tasks as anchor href=/tasks when activePanel=models", () => {
    const { html } = renderPanelSidebar({ activePanel: "models" });

    expect(html).toContain('href="/tasks"');
  });

  it("renders Assets as anchor href=/assets when activePanel=models", () => {
    const { html } = renderPanelSidebar({ activePanel: "models" });

    expect(html).toContain('href="/assets"');
  });

  it("renders Feedback in account card menu when logged in and activePanel=models", () => {
    const { html } = renderPanelSidebar({ isLoggedIn: true, activePanel: "models" });

    expect(html).not.toContain('href="/feedback"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("renders Account in account card menu when activePanel=models and logged in", () => {
    const { html } = renderPanelSidebar({ isLoggedIn: true, activePanel: "models" });

    expect(html).not.toContain('href="/account"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('href="/login"');
  });

  it("renders Links as anchor href=/links when activePanel=models", () => {
    const { html } = renderPanelSidebar({ activePanel: "models" });

    expect(html).toContain("Links");
    expect(html).toContain('href="/links"');
  });

  it("renders Feedback, Account, and Links in new locations when activePanel non-null", () => {
    const { html } = renderPanelSidebar({ isLoggedIn: true, activePanel: "feedback" });

    expect(html).not.toContain('href="/feedback"');
    expect(html).not.toContain('href="/account"');
    expect(html).toContain('href="/links"');
  });

  it("highlights Chat on /", () => {
    publicLinksState.pathname = "/";
    const { html } = renderPanelSidebar({ activePanel: null });

    expect(html).toContain("bg-indigo-50");
    expect(html).toContain("Chat");
    expect(html).toContain('href="/"');
  });

  it("highlights Image on /image", () => {
    publicLinksState.pathname = "/image";
    const { html } = renderPanelSidebar({ activePanel: null });

    expect(html).toContain("bg-indigo-50");
    expect(html).toContain('href="/image"');
  });

  it("highlights Tasks on /tasks", () => {
    publicLinksState.pathname = "/tasks";
    const { html } = renderPanelSidebar({ activePanel: null });

    expect(html).toContain("bg-indigo-50");
    expect(html).not.toContain('href="/chat"');
  });

  it("highlights Assets on /assets", () => {
    publicLinksState.pathname = "/assets";
    const { html } = renderPanelSidebar({ activePanel: null });

    expect(html).toContain("bg-indigo-50");
  });

  it("highlights Models on /models", () => {
    publicLinksState.pathname = "/models";
    const { html } = renderPanelSidebar({ activePanel: null });

    expect(html).toContain("bg-indigo-50");
    expect(html).toContain('href="/models"');
  });

  it("still contains account card on /feedback for logged-in users", () => {
    publicLinksState.pathname = "/feedback";
    const { html } = renderPanelSidebar({ isLoggedIn: true, activePanel: null });

    expect(html).not.toContain('href="/feedback"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("still contains account card on /account", () => {
    publicLinksState.pathname = "/account";
    const { html } = renderPanelSidebar({ isLoggedIn: true, activePanel: null });

    expect(html).not.toContain('href="/account"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("highlights Links on /links", () => {
    publicLinksState.pathname = "/links";
    const { html } = renderPanelSidebar({ activePanel: null });

    // Links highlight in More section via pathname.startsWith("/links")
    expect(html).toContain("bg-indigo-50");
    expect(html).toContain('href="/links"');
  });

  it("does not highlight Chat on /image when activePanel is null", () => {
    publicLinksState.pathname = "/image";
    const { html } = renderPanelSidebar({ activePanel: null });

    expect(html).toContain("bg-indigo-50");
    expect(html).toContain("Chat");
    expect(html).toContain('href="/image"');
  });

  it("does not highlight Chat on /tasks when activePanel is null", () => {
    publicLinksState.pathname = "/tasks";
    const { html } = renderPanelSidebar({ activePanel: null });

    expect(html).toContain("bg-indigo-50");
    expect(html).toContain("Chat");
  });

  it("does not highlight Chat on /assets when activePanel is null", () => {
    publicLinksState.pathname = "/assets";
    const { html } = renderPanelSidebar({ activePanel: null });

    expect(html).toContain("bg-indigo-50");
    expect(html).toContain("Chat");
  });

  it("renders Chinese labels when locale is zh-CN", () => {
    const { html } = renderPanelSidebar({ locale: "zh-CN", isLoggedIn: true });

    expect(html).toContain("对话");
    expect(html).toContain("图像创作");
    expect(html).toContain("视频创作");
    expect(html).toContain("创作画布");
    expect(html).not.toContain("PPT 生成");
    expect(html).toContain("模型库");
    expect(html).not.toContain("套餐额度");
    expect(html).toContain("资产库");
    expect(html).toContain("外部链接");
    expect(html).toContain("充值");
  });

  it("renders multimodal route links", () => {
    const { html } = renderPanelSidebar();

    expect(html).toContain('href="/image"');
    expect(html).toContain('href="/video"');
    expect(html).toContain('href="/canvas"');
    expect(html).not.toContain('href="/ppt"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('href="/assets"');
    expect(html).toContain("Image Creation");
    expect(html).toContain("Video Creation");
    expect(html).toContain("Creator Canvas");
    expect(html).not.toContain("PPT Generation");
    expect(html).toContain("Tasks");
    expect(html).toContain("Asset Library");
    expect(html).toContain("Coming soon");
  });

  it("uses the single Links entry rather than expanding external links", () => {
    publicLinksState.links = [
      {
        id: "api-1",
        title: "API Reference",
        url: "https://api.example.test",
        description: null,
        category: "api",
        enabled: true,
        sortOrder: 1,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z"
      }
    ];

    const { html } = renderPanelSidebar();

    expect(html).toContain("Links");
    expect(html).not.toContain("API Reference");
    publicLinksState.links = [];
  });

  it("renders tasks and assets entries with accessible labels", () => {
    const { html } = renderPanelSidebar();

    expect(html).toContain('href="/tasks"');
    expect(html).toContain('href="/assets"');
    expect(html).toContain('aria-label="Tasks"');
    expect(html).toContain('aria-label="Asset Library"');
  });

  it("does not use the custom links display name for the sidebar entry", () => {
    publicLinksState.workspaceLinksLabel = "Resource hub";

    const { html } = renderPanelSidebar();

    expect(html).toContain("Links");
    expect(html).not.toContain("Resource hub");
  });

  it("renders a stable three-section sidebar with full-height container", () => {
    const { html } = renderPanelSidebar();

    expect(html).toContain("h-[100dvh]");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("flex-1");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("shrink-0");
  });

  it("renders account card and bottom toolbar on /tasks", () => {
    publicLinksState.pathname = "/tasks";
    const { html } = renderPanelSidebar({ isLoggedIn: true });

    expect(html).not.toContain('href="/account"');
    expect(html).toContain('href="/links"');
    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("shows account card and bottom toolbar on /tasks", () => {
    publicLinksState.pathname = "/tasks";
    const { html } = renderPanelSidebar({
      isLoggedIn: true,
      activePanel: null,
    });

    expect(html).toContain("Recharge");
    expect(html).toContain("Logout");
  });

  it("shows language button and logout on /tasks", () => {
    publicLinksState.pathname = "/tasks";
    const { html } = renderPanelSidebar({ isLoggedIn: true });

    expect(html).toContain('aria-label="Language"');
    expect(html).toContain("Logout");
  });

  it("renders admin menu item inside account card for admin users", () => {
    const { html } = renderPanelSidebar({ isLoggedIn: true, isAdmin: true });

    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain("Admin");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("does not render Admin entry in sidebar nav for non-admin users", () => {
    const { html } = renderPanelSidebar({ isLoggedIn: true, isAdmin: false });

    expect(html).not.toContain('href="/admin"');
  });

  it("renders a Help link in the account card menu for logged-in users", () => {
    const { html } = renderPanelSidebar({ isLoggedIn: true, isAdmin: false });

    expect(html).not.toContain('href="/help"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("renders Login link for logged-out users", () => {
    const { html } = renderPanelSidebar({ isLoggedIn: false, activePanel: "models" });

    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/account"');
  });

  it("renders all desktop primary nav entries as clean route links", () => {
    publicLinksState.pathname = "/chat";
    const { html } = renderPanelSidebar({ isLoggedIn: true, activePanel: null });

    expect(html).toContain('href="/image"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('href="/assets"');
    expect(html).toContain('href="/models"');
    expect(html).toContain('href="/plans"');
    expect(html).not.toContain('href="/feedback"');
    expect(html).not.toContain('href="/account"');
    expect(html).toContain('href="/links"');
    expect(html).not.toContain('href="/help"');
  });
});

describe("SidebarNav collapsed state", () => {
  beforeEach(() => {
    publicLinksState.links = [];
    publicLinksState.pathname = "/";
  });

  it("renders collapsed width and hides labels", () => {
    const html = renderWithLocale(
      <SidebarNav
        isLoggedIn={false}
        isAdmin={false}
        onLogout={vi.fn()}
        isCollapsed
      />,
      "en-US"
    );

    expect(html).toContain("w-[72px]");
    expect(html).toContain('data-sidebar-collapsed="true"');
  });

  it("renders toggle button with aria-label", () => {
    const html = renderWithLocale(
      <SidebarNav
        isLoggedIn={false}
        isAdmin={false}
        onLogout={vi.fn()}
        isCollapsed
        onToggleCollapsed={vi.fn()}
      />,
      "en-US"
    );

    expect(html).toContain('data-sidebar-toggle="true"');
    expect(html).toContain('aria-label="Expand"');
  });

  it("renders expanded width and full labels", () => {
    const html = renderWithLocale(
      <SidebarNav
        isLoggedIn={false}
        isAdmin={false}
        onLogout={vi.fn()}
        isCollapsed={false}
      />,
      "en-US"
    );

    expect(html).toContain("w-[260px]");
    expect(html).toContain('data-sidebar-collapsed="false"');
    expect(html).toContain("Manage");
  });

  it("renders collapsed account card with avatar for logged-in users", () => {
    const html = renderWithLocale(
      <SidebarNav
        isLoggedIn
        isAdmin={false}
        onLogout={vi.fn()}
        isCollapsed
        remainingCredits={1234}
      />,
      "en-US"
    );

    expect(html).toContain('href="/plans"');
    expect(html).toContain("cursor-pointer");
  });

  it("renders expanded account card with credits and recharge for logged-in users", () => {
    const html = renderWithLocale(
      <SidebarNav
        isLoggedIn
        isAdmin={false}
        onLogout={vi.fn()}
        remainingCredits={5678}
      />,
      "en-US"
    );

    expect(html).toContain("5,678");
    expect(html).toContain('href="/plans"');
    expect(html).toContain("Recharge");
    expect(html).toContain("focus-visible:ring-indigo-500");
  });

  it("has recharge button rendered in account card", () => {
    const html = renderWithLocale(
      <SidebarNav
        isLoggedIn
        isAdmin={false}
        onLogout={vi.fn()}
      />
    );

    expect(html).toContain("Recharge");
    expect(html).toContain('href="/plans"');
  });
});

describe("WorkspaceLanguageSwitch", () => {
  it("uses existing i18n labels for both locales", () => {
    const english = renderWithLocale(<WorkspaceLanguageSwitch />);
    const chinese = renderWithLocale(<WorkspaceLanguageSwitch />, "zh-CN");

    expect(english).toContain("中文");
    expect(english).toContain("English");
    expect(chinese).toContain("中文");
    expect(chinese).toContain("English");
  });
});
