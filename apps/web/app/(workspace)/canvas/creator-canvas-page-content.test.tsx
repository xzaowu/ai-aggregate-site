// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceSurfaceProvider,
  type WorkspaceSurface
} from "../../../components/workspace/workspace-shell-context";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import { CreatorCanvasPageContent } from "./creator-canvas-page-content";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./creator-canvas", () => ({
  CreatorCanvas: () => <div data-mock-creator-canvas="true" />
}));

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(surface: WorkspaceSurface): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <WorkspaceSurfaceProvider surface={surface}>
          <CreatorCanvasPageContent />
        </WorkspaceSurfaceProvider>
      </I18nContext.Provider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CreatorCanvasPageContent", () => {
  it("renders a full-height desktop Creator Canvas without a transitional escape link", async () => {
    await mount("desktop");

    const page = host?.querySelector('[data-creator-canvas-page="true"]');
    expect(page?.className).toContain("flex-1");
    expect(page?.className).toContain("min-h-0");
    expect(page?.className).toContain("min-w-0");
    expect(page?.className).toContain("overflow-hidden");
    expect(host?.querySelector('[data-mock-creator-canvas="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-mobile-fence="true"]')).toBeNull();
    expect(host?.querySelector('[data-creator-canvas-back-link="true"]')).toBeNull();
    expect(host?.querySelector('a[href="/image"]')).toBeNull();
    expect(host?.textContent).not.toContain("Back to creation");
    expect(host?.textContent).not.toContain("Video Workspace");
    expect(host?.textContent).not.toContain("Quick Creation");
    expect(page?.className).not.toContain("max-w-5xl");
  });

  it("renders the explicit mobile fence without mounting the editable canvas", async () => {
    await mount("mobile");

    expect(host?.querySelector('[data-creator-canvas-mobile-fence="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-mock-creator-canvas="true"]')).toBeNull();
    expect(host?.textContent).toContain("Creator Canvas requires desktop");
    expect(host?.querySelector('[data-creation-surface-switcher="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creation-surface-active="canvas"]')).toBeTruthy();
    expect(host?.querySelector('a[href="/image"]')).toBeTruthy();
    expect(host?.querySelector('a[href="/video"]')).toBeTruthy();
    expect(host?.querySelector('a[href="/canvas"]')?.getAttribute("aria-current"))
      .toBe("page");
    expect(host?.textContent).not.toContain("Back to creation");
    expect(host?.textContent).toContain("Canvas workspace");
    expect(host?.querySelector('[data-creator-canvas-mobile-back-link="true"]')).toBeNull();
  });

  it("consumes the existing workspace surface without defining another media query", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "app/(workspace)/canvas/creator-canvas-page-content.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("useOptionalWorkspaceSurface");
    expect(source).not.toContain("matchMedia");
    expect(source).not.toContain("CREATOR_CANVAS_DESKTOP_QUERY");
  });
});
