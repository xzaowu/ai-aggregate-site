// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { CreationSurfaceSwitcher } from "./CreationSurfaceSwitcher";
import {
  workspaceCreationSurfaceNavItems,
  type WorkspaceCreationSurfaceKey
} from "./workspace-navigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(activeSurface: WorkspaceCreationSurfaceKey): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <CreationSurfaceSwitcher activeSurface={activeSurface} />
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

describe("CreationSurfaceSwitcher", () => {
  it("uses the exact shared Image, Video, and Canvas navigation contract", () => {
    expect(workspaceCreationSurfaceNavItems.map(({ key, href }) => ({ key, href })))
      .toEqual([
        { key: "image", href: "/image" },
        { key: "video", href: "/video" },
        { key: "canvas", href: "/canvas" }
      ]);
  });

  it.each([
    ["image", "Image Creation"],
    ["video", "Video Creation"],
    ["canvas", "Creator Canvas"]
  ] as const)("marks %s active and exposes all three routes", async (activeSurface, label) => {
    await mount(activeSurface);

    expect(host?.querySelector('[data-creation-surface-trigger="true"]')?.textContent)
      .toContain(label);
    expect(host?.querySelector(`[data-creation-surface-option="${activeSurface}"]`)?.getAttribute("aria-current"))
      .toBe("page");
    expect(host?.querySelector('[data-creation-surface-option="image"]')?.getAttribute("href"))
      .toBe("/image");
    expect(host?.querySelector('[data-creation-surface-option="video"]')?.getAttribute("href"))
      .toBe("/video");
    expect(host?.querySelector('[data-creation-surface-option="canvas"]')?.getAttribute("href"))
      .toBe("/canvas");
    expect(host?.textContent).not.toContain("PPT");
  });

  it("opens from the trigger and closes with Escape", async () => {
    await mount("image");
    const trigger = host?.querySelector<HTMLButtonElement>(
      '[data-creation-surface-trigger="true"]'
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });
});
