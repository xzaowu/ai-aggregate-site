import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Locale } from "../../../lib/i18n/types";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import HelpPage from "./page";

function renderWithLocale(locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <HelpPage />
    </I18nContext.Provider>
  );
}

describe("help page", () => {
  it("renders the help page title and intro", () => {
    const html = renderWithLocale();

    expect(html).toContain("Help &amp; FAQ");
    expect(html).toContain("Welcome to AI Aggregate");
  });

  it("renders one bounded page scroll container inside the workspace frame", () => {
    const html = renderWithLocale();

    expect(html).toContain(
      '<div class="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto'
    );
    expect(html).toContain('data-workspace-page-scroll="help"');
    expect(html.match(/data-workspace-page-scroll=/g)).toHaveLength(1);
  });

  it("renders hero stat cards", () => {
    const html = renderWithLocale();

    expect(html).toContain("Chat");
    expect(html).toContain("Image Creation");
    expect(html).toContain("Remaining Credits");
  });

  it("renders the quick start section with 3 steps", () => {
    const html = renderWithLocale();

    expect(html).toContain("Quick Start");
    expect(html).toContain("Choosing Models");
    expect(html).toContain("1");
    expect(html).toContain("2");
    expect(html).toContain("3");
  });

  it("renders the features section", () => {
    const html = renderWithLocale();

    expect(html).toContain("Services");
    expect(html).toContain("Model Library");
    expect(html).toContain("Image Creation");
    expect(html).toContain("Account");
    expect(html).toContain("Recharge");
    expect(html).toContain("Links");
  });

  it("renders the FAQ section with collapsible items", () => {
    const html = renderWithLocale();

    expect(html).toContain("FAQ");
    expect(html).toContain("What can guest users do?");
    expect(html).toContain("Do credits expire?");
    expect(html).toContain("Can I get a refund?");
    expect(html).toContain("How do I contact support or submit feedback?");
    expect(html).toContain("What payment methods are supported?");
    expect(html).toContain("Are my conversations saved?");
  });

  it("renders Chinese labels when locale is zh-CN", () => {
    const html = renderWithLocale("zh-CN");

    expect(html).toContain("使用说明");
    expect(html).toContain("快速开始");
    expect(html).toContain("对话");
    expect(html).toContain("图像创作");
    expect(html).toContain("剩余额度");
    expect(html).toContain("常见问题");
    expect(html).toContain("游客可以使用哪些功能？");
    expect(html).toContain("额度会过期吗？");
  });
});
