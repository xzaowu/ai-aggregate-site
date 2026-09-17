// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateCreatorNodeWorkspacePlacement,
  CreatorNodeWorkspace,
  getCreatorNodeWorkspaceEffectiveSize
} from "./creator-node-workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("CreatorNodeWorkspace placement", () => {
  const viewport = { x: 100, y: 50, width: 1000, height: 700 };
  const size = { width: 400, height: 300 };

  it("places below when the selected node has room below", () => {
    expect(calculateCreatorNodeWorkspacePlacement({
      anchorRect: { x: 300, y: 100, width: 220, height: 120 },
      viewportRect: viewport,
      workspaceSize: size
    })).toEqual({ x: 210, y: 236, placement: "below" });
  });

  it("places above when below is unavailable but above fits", () => {
    expect(calculateCreatorNodeWorkspacePlacement({
      anchorRect: { x: 300, y: 600, width: 220, height: 60 },
      viewportRect: viewport,
      workspaceSize: size
    })).toEqual({ x: 210, y: 284, placement: "above" });
  });

  it("clamps horizontal and vertical coordinates inside the viewport", () => {
    const result = calculateCreatorNodeWorkspacePlacement({
      anchorRect: { x: 980, y: 0, width: 50, height: 500 },
      viewportRect: viewport,
      workspaceSize: size
    });

    expect(result.placement).toBe("below");
    expect(result.x).toBe(688);
    expect(result.y).toBe(438);
  });

  it("uses a safe centered fallback when the workspace cannot fit", () => {
    const viewportRect = { x: 0, y: 0, width: 320, height: 240 };
    const workspaceSize = { width: 400, height: 500 };
    const effectiveSize = getCreatorNodeWorkspaceEffectiveSize({
      viewportRect,
      workspaceSize
    });
    const result = calculateCreatorNodeWorkspacePlacement({
      anchorRect: { x: 200, y: 200, width: 100, height: 100 },
      viewportRect,
      workspaceSize
    });

    expect(effectiveSize).toEqual({ width: 296, height: 216 });
    expect(result).toEqual({ x: 12, y: 12, placement: "center" });
    expect(result.x).toBeGreaterThanOrEqual(12);
    expect(result.y).toBeGreaterThanOrEqual(12);
    expect(result.x + effectiveSize.width).toBeLessThanOrEqual(308);
    expect(result.y + effectiveSize.height).toBeLessThanOrEqual(228);
    const headerHeight = 64;
    expect(effectiveSize.height).toBeGreaterThanOrEqual(headerHeight);
    expect(result.y + headerHeight).toBeLessThanOrEqual(228);

    expect(calculateCreatorNodeWorkspacePlacement({
      anchorRect: { x: Number.NaN, y: 0, width: 1, height: 1 },
      viewportRect: viewport,
      workspaceSize: size
    })).toEqual({ x: 0, y: 0, placement: "center" });
  });

});

describe("CreatorNodeWorkspace lifecycle", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    document.body.style.overflow = "";
    vi.restoreAllMocks();
  });

  async function mountWorkspaceWithGeometry({
    anchorRect,
    viewportRect,
    workspaceSize
  }: {
    anchorRect: { x: number; y: number; width: number; height: number };
    viewportRect: { x: number; y: number; width: number; height: number };
    workspaceSize: { width: number; height: number };
  }) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.dataset.creatorNodeWorkspace === "true") {
        return {
          x: 0,
          y: 0,
          width: workspaceSize.width,
          height: workspaceSize.height,
          top: 0,
          right: workspaceSize.width,
          bottom: workspaceSize.height,
          left: 0,
          toJSON: () => ({})
        };
      }
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({})
      };
    });
    await act(async () => {
      root?.render(
        <CreatorNodeWorkspace
          kind="text"
          title="Text workspace"
          typeLabel="Text"
          closeLabel="Close"
          expandLabel="Focus"
          focusTitle="Focused text"
          focusCloseLabel="Close focus"
          anchorRect={anchorRect}
          viewportRect={viewportRect}
          onClose={vi.fn()}
        >
          {(mode) => <div data-workspace-render-mode={mode}>Shared content</div>}
        </CreatorNodeWorkspace>
      );
    });
  }

  async function mount() {
    await mountWorkspaceWithGeometry({
      anchorRect: { x: 200, y: 100, width: 320, height: 220 },
      viewportRect: { x: 0, y: 0, width: 1000, height: 800 },
      workspaceSize: { width: 448, height: 600 }
    });
  }

  it("bounds the normal shell size when the Canvas viewport is smaller than its natural size", async () => {
    await mountWorkspaceWithGeometry({
      anchorRect: { x: 120, y: 100, width: 120, height: 80 },
      viewportRect: { x: 0, y: 0, width: 320, height: 240 },
      workspaceSize: { width: 400, height: 500 }
    });

    const shell = host?.querySelector<HTMLElement>('[data-creator-node-workspace="true"]');
    expect(shell?.style.left).toBe("12px");
    expect(shell?.style.top).toBe("12px");
    expect(shell?.style.width).toBe("296px");
    expect(shell?.style.maxWidth).toBe("296px");
    expect(shell?.style.maxHeight).toBe("216px");
    expect(shell?.querySelector('[data-creator-node-workspace-expand="true"]')).toBeTruthy();
    expect(shell?.querySelector('[data-creator-node-workspace-close="true"]')).toBeTruthy();
  });

  it("keeps the shell viewport-level and switches to Focus through a portal", async () => {
    await mount();
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-workspace-render-mode="workspace"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-node-workspace-focus="true"]')).toBeNull();

    const expand = host?.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-expand="true"]'
    );
    await act(async () => expand?.click());
    expect(document.body.querySelector('[data-creator-node-workspace-focus="true"]'))
      .toBeTruthy();
    expect(document.body.querySelector('[data-workspace-render-mode="focus"]'))
      .toBeTruthy();
    expect(host?.querySelector('[data-creator-node-workspace-size]')?.getAttribute("style"))
      ?.toContain("left:");
  });

  it("closes Focus with Escape and restores focus to Expand", async () => {
    await mount();
    const expand = host?.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-expand="true"]'
    );
    await act(async () => expand?.click());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector('[data-creator-node-workspace-focus="true"]'))
      .toBeNull();
    expect(document.activeElement).toBe(expand);
  });
});
