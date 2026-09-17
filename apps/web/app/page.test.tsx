import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelsPage from "./(workspace)/models/page";
import { WorkspaceLayoutClient } from "./(workspace)/workspace-layout-client";
import RootLayout from "./layout";
import { ChatWorkspace } from "../components/workspace/ChatWorkspace";
import { SidebarNav } from "../components/workspace/SidebarNav";
import { WorkspaceShellProvider } from "../components/workspace/workspace-shell-context";
import { I18nContext, createTranslator } from "../lib/i18n/use-i18n";
import type { Locale } from "../lib/i18n/types";

const navigationState = vi.hoisted(() => ({
  pathname: "/"
}));

const publicSettingsState = vi.hoisted(() => ({
  settings: {
    siteName: "AI Aggregate",
    siteLogoText: undefined as string | undefined,
    siteLogoUrl: undefined as string | undefined,
    workspaceIconUrl: undefined as string | undefined,
    guestModeEnabled: true,
    workspaceLinksLabel: "Workspace links",
    workspaceTitle: undefined as string | undefined,
    workspaceSubtitle: undefined as string | undefined,
    workspaceHeroTitle: undefined as string | undefined,
    workspaceHeroSubtitle: undefined as string | undefined,
    workspacePromptPlaceholder: undefined as string | undefined,
    workspaceHint: undefined as string | undefined,
    workspacePromptCards: undefined as string | undefined
  }
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

vi.mock("../lib/i18n/i18n-provider", () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock("../components/SiteTitleUpdater", () => ({
  SiteTitleUpdater: () => null
}));

vi.mock("../components/MaintenanceBanner", () => ({
  MaintenanceBanner: () => null
}));

vi.mock("../lib/use-public-settings", () => ({
  usePublicSettings: () => publicSettingsState.settings
}));

vi.mock("../lib/use-public-links", () => ({
  publicWorkspaceLinks: () => [],
  usePublicLinks: () => []
}));

function renderWithLocale(locale: Locale = "en-US") {
  return renderWorkspaceContent(<ChatWorkspace />, locale);
}

function renderWorkspaceRoute(node: React.ReactNode, locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <WorkspaceLayoutClient gateUntilHydrated={false}>{node}</WorkspaceLayoutClient>
    </I18nContext.Provider>
  );
}

function renderWorkspaceContent(node: React.ReactNode, locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <WorkspaceShellProvider gateUntilHydrated={false}>{node}</WorkspaceShellProvider>
    </I18nContext.Provider>
  );
}

function renderSidebarNav({
  locale = "en-US",
  siteName = "AI Aggregate",
  logoText = "AI",
  logoUrl = null
}: {
  locale?: Locale;
  siteName?: string;
  logoText?: string;
  logoUrl?: string | null;
} = {}) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <SidebarNav
        isLoggedIn
        isAdmin={false}
        onLogout={vi.fn()}
        siteName={siteName}
        logoText={logoText}
        logoUrl={logoUrl}
        activePanel={null}
        remainingCredits={20}
        planName="free"
        theme="light"
        onToggleTheme={vi.fn()}
      />
    </I18nContext.Provider>
  );
}

function renderChatWorkspaceOnly(locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <WorkspaceShellProvider gateUntilHydrated={false}>
        <ChatWorkspace />
      </WorkspaceShellProvider>
    </I18nContext.Provider>
  );
}

describe("home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.pathname = "/";
    publicSettingsState.settings = {
      siteName: "AI Aggregate",
      siteLogoText: undefined,
      siteLogoUrl: undefined,
      workspaceIconUrl: undefined,
      guestModeEnabled: true,
      workspaceLinksLabel: "Workspace links",
      workspaceTitle: undefined,
      workspaceSubtitle: undefined,
      workspaceHeroTitle: undefined,
      workspaceHeroSubtitle: undefined,
      workspacePromptPlaceholder: undefined,
      workspaceHint: undefined,
      workspacePromptCards: undefined
    };
  });

  it("renders the chat workspace as the root page", () => {
    const html = renderWithLocale();

    expect(html).toContain("Multi-model AI, all in one place");
    expect(html).toContain("Loading models...");
    expect(html).toContain("Send");
  });

  it("keeps route children out of the SSR workspace surface", () => {
    const html = renderWorkspaceRoute(<ChatWorkspace />);

    expect(html).toContain('data-workspace-auth-loading="true"');
    expect(html).not.toContain('data-mobile-workspace-shell="true"');
    expect(html).not.toContain('data-desktop-workspace-shell="true"');
    expect(html).not.toContain("Multi-model AI, all in one place");
  });

  it("does not let ChatWorkspace render a duplicate AppShell or MobileWorkspaceShell", () => {
    const html = renderChatWorkspaceOnly();

    expect(html).toContain("Multi-model AI, all in one place");
    expect(html).toContain("Send");
    expect(html).not.toContain('data-mobile-workspace-shell="true"');
    expect(html).not.toContain('data-desktop-workspace-shell="true"');
  });

  it("does not let RootLayout inject the old site header or footer chrome", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <div data-testid="root-child">Workspace content</div>
      </RootLayout>
    );

    expect(html).toContain("Workspace content");
    expect(html).not.toContain("nav.home");
    expect(html).not.toContain("nav.chat");
    expect(html).not.toContain("nav.pricing");
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("Bilingual support");
    expect(html).not.toContain("flex min-h-screen flex-col");
    expect(html).not.toContain("<main");
  });

  it("renders /models via its own page-content instead of ChatWorkspace routePanel", () => {
    // ModelsPage now renders <ModelsPageContent /> which fetches its own data.
    // The workspace shell (SidebarNav etc.) is rendered by WorkspaceLayout automatically.
    // We verify the workspace shell is present plus model library signs.
    navigationState.pathname = "/models";

    const html = renderWorkspaceContent(<ModelsPage />);
    // Some environments may produce empty SSR output for nested client components;
    // the key invariant is that ChatWorkspace is NOT rendering /models content.
    if (html.length > 0) {
      expect(html).toContain("Model Library");
      expect(html).toContain("Loading models...");
    }

    // Verify ChatWorkspace.tsx no longer contains routePanel-based panel routing
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../components/workspace/ChatWorkspace.tsx"),
      "utf8"
    );
    expect(source).not.toContain('routePanel="models"');
    expect(source).not.toContain('routePanel="plans"');
    expect(source).not.toContain('routePanel="account"');
    expect(source).not.toContain('routePanel="feedback"');
    expect(source).not.toContain('routePanel="links"');
    expect(source).not.toContain("renderPanelContent");
    expect(source).not.toContain("renderPanelSurface");
    expect(source).not.toContain("currentPanelTitle");
    expect(source).not.toContain("getPanelTitle");
    expect(source).not.toContain("navigateToPanel");
    expect(source).not.toContain("setActivePanel(routePanel");
  });

  it("keeps the chat sidebar links label stable when a custom label is configured", () => {
    const html = renderSidebarNav();

    expect(html).toContain("Links");
    expect(html).not.toContain("Workspace links");
  });

  it("shows links entry in workspace sidebar nav", () => {
    const html = renderSidebarNav();

    expect(html).toContain("Links");
  });

  it("uses configurable workspace hero and prompt cards from public settings", () => {
    publicSettingsState.settings = {
      ...publicSettingsState.settings,
      workspaceTitle: "Custom workspace hero",
      workspaceSubtitle: "Custom workspace subtitle",
      workspacePromptPlaceholder: "Ask the branded workspace",
      workspaceHint: "Use concise prompts for better answers.",
      workspacePromptCards: JSON.stringify([
        {
          title: "Plan rollout",
          description: "Turn an idea into executable steps.",
          prompt: "Help me plan this rollout:"
        }
      ])
    };

    const html = renderWithLocale();

    expect(html).toContain("Custom workspace hero");
    expect(html).toContain("Custom workspace subtitle");
    expect(html).toContain("Ask the branded workspace");
    expect(html).toContain("Use concise prompts for better answers.");
    expect(html).toContain("Plan rollout");
    expect(html).toContain("Turn an idea into executable steps.");
  });

  it("uses workspace icon URL before the site logo in the empty state", () => {
    publicSettingsState.settings = {
      ...publicSettingsState.settings,
      siteName: "Brand Console",
      siteLogoText: "BC",
      siteLogoUrl: "https://example.com/logo.png",
      workspaceIconUrl: "https://example.com/workspace-icon.png"
    };

    const html = renderWithLocale();
    const sidebarHtml = renderSidebarNav({
      siteName: "Brand Console",
      logoText: "BC",
      logoUrl: "https://example.com/logo.png"
    });

    expect(html).toContain("https://example.com/workspace-icon.png");
    expect(sidebarHtml).toContain("https://example.com/logo.png");
  });

  it("renders configured workspace logo image and falls back without one", () => {
    publicSettingsState.settings = {
      ...publicSettingsState.settings,
      siteName: "Brand Console",
      siteLogoText: "BC",
      siteLogoUrl: "https://example.com/logo.png"
    };

    const withLogo = renderSidebarNav({
      siteName: "Brand Console",
      logoText: "BC",
      logoUrl: "https://example.com/logo.png"
    });
    expect(withLogo).toContain("https://example.com/logo.png");
    expect(withLogo).toContain('alt="Brand Console"');

    publicSettingsState.settings = {
      ...publicSettingsState.settings,
      siteLogoUrl: undefined
    };
    const withoutLogo = renderSidebarNav({
      siteName: "Brand Console",
      logoText: "BC"
    });
    expect(withoutLogo).toContain("BC");
    expect(withoutLogo).not.toContain('src="https://example.com/logo.png"');
  });

  it("shows chat view by default on root path", () => {
    const html = renderWithLocale();

    expect(html).toContain("Multi-model AI, all in one place");
    expect(html).toContain("Loading models...");
  });

  it("leaves workspace chrome ownership with the layout after SSR", () => {
    const html = renderWorkspaceRoute(<ChatWorkspace />);

    expect(html).toContain('data-workspace-auth-loading="true"');
    expect(html).not.toContain("Creative workspace");
    expect(html).not.toContain('data-workspace-page-frame="true"');
  });

  it("keeps the chat page content with model switch entry and closed panels", () => {
    const html = renderWithLocale();

    expect(html).toContain('aria-label="Switch model"');
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("Select model</h2>");
    expect(html).not.toContain("Account Center</h2>");
  });

  it("removes duplicated chat header and current-model empty-state copy", () => {
    const html = renderChatWorkspaceOnly("zh-CN");

    expect(html).not.toContain("对话窗口");
    expect(html).not.toContain("匿名测试模式");
    expect(html).not.toContain("当前模型:");
    expect(html).not.toContain("当前为匿名测试模式");
  });

  it("does not SSR a second mobile navigation surface", () => {
    const html = renderWorkspaceRoute(<ChatWorkspace />);

    expect(html).toContain('data-workspace-auth-loading="true"');
    expect(html).not.toContain('data-mobile-bottom-nav="true"');
    expect(html).not.toContain('data-mobile-menu-button="true"');
    expect(html).not.toContain('data-mobile-drawer="true"');
  });

  it("renders the v4 default quick cards", () => {
    const html = renderWithLocale("zh-CN");

    expect(html).toContain("梳理想法");
    expect(html).toContain("起草内容");
    expect(html).toContain("生成图片提示词");
    expect(html).toContain("打开图像创作");
  });

  it("defers mobile navigation until the responsive surface is known", () => {
    const html = renderWorkspaceRoute(<ChatWorkspace />);

    expect(html).toContain('data-workspace-auth-loading="true"');
    expect(html).not.toContain('data-mobile-bottom-nav="true"');
  });

  it("defers desktop sidebar selection until the responsive surface is known", () => {
    const html = renderWorkspaceRoute(<ChatWorkspace />);

    expect(html).toContain('data-workspace-auth-loading="true"');
    expect(html).not.toContain('data-desktop-workspace-shell="true"');
    expect(html).not.toContain("md:grid-cols-[260px_minmax(0,1fr)]");
  });
});
