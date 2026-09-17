// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import { CreatorCanvasRecipeStarter } from "./creator-canvas-recipe-starter";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedHost: HTMLDivElement | null = null;

function renderStarter(locale: "en-US" | "zh-CN"): string {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{ locale, setLocale: vi.fn(), t: createTranslator(locale) }}
    >
      <CreatorCanvasRecipeStarter onApply={vi.fn()} />
    </I18nContext.Provider>
  );
}

afterEach(() => {
  mountedHost?.remove();
  mountedHost = null;
  vi.unstubAllGlobals();
});

describe("CreatorCanvasRecipeStarter", () => {
  it("renders the localized flagship recipe card and keeps the blank-start note", () => {
    const english = renderStarter("en-US");
    const chinese = renderStarter("zh-CN");

    expect(english).toContain("Product Ad Short Video");
    expect(english).toContain("Start with a workflow");
    expect(english).toContain("Use workflow");
    expect(english).toContain("Text, Image, and Video buttons below");
    expect(chinese).toContain("产品广告短视频");
    expect(chinese).toContain("从工作流开始");
    expect(chinese).toContain("使用工作流");
    expect(chinese).toContain("文本、图片和视频按钮");
    expect(english).toContain('data-creator-canvas-recipe-flow="true"');
    expect(english).toContain('data-creator-canvas-recipe-apply="product-ad-short-video"');
  });

  it("calls the apply callback once without execution or persistence behavior", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onApply = vi.fn();
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);
    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
        >
          <CreatorCanvasRecipeStarter onApply={onApply} />
        </I18nContext.Provider>
      );
    });

    const button = mountedHost.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-recipe-apply="product-ad-short-video"]'
    );
    if (!button) throw new Error("RECIPE_STARTER_CTA_MISSING");
    await act(async () => button.click());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mountedHost.querySelector('[data-creator-canvas-persistence-action]')).toBeNull();
    expect(mountedHost.querySelector('[data-creator-text-ai-execute]')).toBeNull();
    expect(mountedHost.querySelector('[data-creator-image-execute]')).toBeNull();
    expect(mountedHost.querySelector('[data-creator-video-execute]')).toBeNull();
    await act(async () => root.unmount());
  });
});
