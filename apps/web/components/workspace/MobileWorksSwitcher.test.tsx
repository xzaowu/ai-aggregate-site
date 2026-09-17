import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { MobileWorksSwitcher } from "./MobileWorksSwitcher";

function renderSwitcher(active: "assets" | "tasks") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: vi.fn(), t: createTranslator("zh-CN") }}
    >
      <MobileWorksSwitcher active={active} />
    </I18nContext.Provider>
  );
}

describe("MobileWorksSwitcher", () => {
  it("uses real works/history routes and marks the works tab active", () => {
    const html = renderSwitcher("assets");

    expect(html).toContain('data-mobile-works-tab="assets"');
    expect(html).toContain('href="/assets"');
    expect(html).toContain('data-mobile-works-tab="tasks"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('data-mobile-works-tab-active="true"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("作品");
    expect(html).toContain("生成记录");
  });

  it("marks generation history active without adding a creation action", () => {
    const html = renderSwitcher("tasks");

    expect(html).toContain('data-mobile-works-tab="tasks"');
    expect(html).toContain('data-mobile-works-tab-active="true"');
    expect(html).not.toContain("＋创作");
    expect(html).not.toContain("搜索");
    expect(html).not.toContain("历史");
  });
});
