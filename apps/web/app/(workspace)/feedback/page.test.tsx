import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FeedbackPage from "./page";
import { getFeedbackScreenshotUrlError } from "./feedback-page-content";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import type { Locale } from "../../../lib/i18n/types";
import type { PublicSiteSettings } from "@ai-aggregate/shared";

const publicSettingsState = vi.hoisted(() => ({
  settings: {} as PublicSiteSettings
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) =>
    React.createElement("a", { href, ...props }, children)
}));

vi.mock("../../../lib/use-public-settings", () => ({
  usePublicSettings: () => publicSettingsState.settings
}));

vi.mock("../../../components/workspace/workspace-shell-context", () => ({
  WorkspaceShellProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useWorkspaceShellContext: () => ({
    shell: {
      token: "mock-token",
      isLoggedIn: true,
      user: { id: "u1", email: "test@example.com" },
      isAdmin: false,
      remainingCredits: 100,
      planName: "Free",
      logout: vi.fn(),
      refreshQuota: vi.fn()
    }
  }),
  useOptionalWorkspaceShellContext: () => null
}));

vi.mock("../../../lib/i18n/i18n-provider", () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  )
}));

function renderWithLocale(
  locale: Locale = "en-US",
  settings: PublicSiteSettings = {}
) {
  publicSettingsState.settings = settings;
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <FeedbackPage />
    </I18nContext.Provider>
  );
}

describe("feedback page", () => {
  it("renders a bounded workspace page scroll container", () => {
    const html = renderWithLocale();

    expect(html).toContain('data-workspace-page-scroll="feedback"');
    expect(html).toContain("min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto");
  });
  it("renders feedback form with translated labels", () => {
    const html = renderWithLocale("en-US");

    expect(html).toContain("Submit feedback");
    expect(html).toContain("Feedback type");
    expect(html).toContain("Feedback content");
    expect(html).toContain("Screenshot URL");
  });

  it("allows empty and HTTP(S) screenshot URLs but blocks unsafe values", () => {
    expect(getFeedbackScreenshotUrlError("")).toBeNull();
    expect(getFeedbackScreenshotUrlError("   ")).toBeNull();
    expect(getFeedbackScreenshotUrlError("https://example.com/screenshot")).toBeNull();
    expect(getFeedbackScreenshotUrlError("http://example.com/screenshot")).toBeNull();
    expect(getFeedbackScreenshotUrlError("javascript:alert(1)")).toBe("invalid");
    expect(getFeedbackScreenshotUrlError("data:image/png;base64,AA==")).toBe("invalid");
    expect(getFeedbackScreenshotUrlError("https://user:password@example.com/image")).toBe(
      "invalid"
    );
    expect(getFeedbackScreenshotUrlError("x".repeat(501))).toBe("tooLong");
  });

  it("contains complete Chinese and English screenshot URL error copy", () => {
    const zh = createTranslator("zh-CN");
    const en = createTranslator("en-US");

    expect(zh("feedback.screenshotUrlInvalid")).toContain("HTTP 或 HTTPS");
    expect(zh("feedback.screenshotUrlTooLong")).toContain("500");
    expect(en("feedback.screenshotUrlInvalid")).toContain("HTTP or HTTPS");
    expect(en("feedback.screenshotUrlTooLong")).toContain("500");
  });

  it("renders contact info from public settings", () => {
    const html = renderWithLocale("en-US", {
      contactDescription: "We are here to help.",
      contactEmail: "support@example.com",
      contactWechat: "mywechat",
      contactPublicAccount: "MyAccount",
      contactNotes: "Available 24/7"
    });

    expect(html).toContain("We are here to help.");
    expect(html).toContain("support@example.com");
    expect(html).toContain("mywechat");
    expect(html).toContain("MyAccount");
    expect(html).toContain("Available 24/7");
  });

  it("renders contact email as mailto link", () => {
    const html = renderWithLocale("en-US", {
      contactEmail: "support@example.com"
    });

    expect(html).toContain('href="mailto:support@example.com"');
  });

  it("renders external links with safe attributes", () => {
    const html = renderWithLocale("en-US", {
      contactExternalLinks: JSON.stringify([
        { label: "Discord", url: "https://discord.gg/test" }
      ])
    });

    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Discord");
    expect(html).toContain("https://discord.gg/test");
  });

  it("shows empty state when no contact configured", () => {
    const html = renderWithLocale("en-US", {});

    expect(html).toContain("No additional contact methods configured.");
  });

  it("renders only configured contact fields in card", () => {
    const html = renderWithLocale("en-US", {
      contactEmail: "support@example.com"
    });

    expect(html).toContain("support@example.com");
  });

  it("shows QR code image when URL provided", () => {
    const html = renderWithLocale("en-US", {
      contactQrImageUrl: "https://example.com/qr.png"
    });

    expect(html).toContain('src="https://example.com/qr.png"');
  });

  it("renders wechat copy button", () => {
    const html = renderWithLocale("en-US", {
      contactWechat: "mywechat"
    });

    expect(html).toContain("Copy WeChat ID");
    expect(html).toContain("mywechat");
  });

  it("renders community URL as external link with safe attrs", () => {
    const html = renderWithLocale("en-US", {
      contactCommunityUrl: "https://community.example.com"
    });

    expect(html).toContain('href="https://community.example.com"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });

  it("renders public account text", () => {
    const html = renderWithLocale("en-US", {
      contactPublicAccount: "MyPublicAccount"
    });

    expect(html).toContain("MyPublicAccount");
  });

  it("handles invalid external links JSON gracefully", () => {
    const html = renderWithLocale("en-US", {
      contactExternalLinks: "not-valid-json"
    });

    expect(html).not.toContain("not-valid-json");
  });
});
