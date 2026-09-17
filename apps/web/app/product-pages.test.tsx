import React from "react";
import type { LinkEntry, PublicSiteSettings } from "@ai-aggregate/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AboutPage from "./about/page";
import ContactPage from "./contact/page";
import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";
import { I18nContext, createTranslator } from "../lib/i18n/use-i18n";
import type { Locale } from "../lib/i18n/types";

const publicState = vi.hoisted(() => ({
  settings: null as PublicSiteSettings | null,
  links: [] as LinkEntry[]
}));

vi.mock("../lib/use-public-settings", () => ({
  usePublicSettings: () => publicState.settings
}));

vi.mock("../lib/use-public-links", () => ({
  publicLinksByCategory: (links: LinkEntry[], categories: string[]) =>
    links
      .filter((link) => link.enabled && categories.includes(link.category))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  usePublicLinks: () => publicState.links
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

describe("product pages", () => {
  beforeEach(() => {
    publicState.settings = null;
    publicState.links = [];
  });

  it("renders the about page in English", () => {
    const html = renderWithLocale(<AboutPage />);

    expect(html).toContain("About");
    expect(html).toContain("multi-model AI assistant platform");
  });

  it("renders the terms page in English", () => {
    expect(renderWithLocale(<TermsPage />)).toContain("Terms of Service");
  });

  it("renders the privacy page in English", () => {
    expect(renderWithLocale(<PrivacyPage />)).toContain("Privacy Policy");
  });

  it("renders the contact page without NEXT_PUBLIC_CONTACT_EMAIL", () => {
    const html = renderWithLocale(<ContactPage />);

    expect(html).toContain("Contact");
    expect(html).toContain("Not configured");
  });
});
