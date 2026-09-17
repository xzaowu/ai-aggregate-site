import { describe, expect, it } from "vitest";
import {
  CREATOR_CANVAS_RESULT_REVEAL_SAFE_INSET,
  canCreatorCanvasFlowBoundsFitAtZoom,
  createCreatorCanvasSafeViewportRect,
  getCreatorCanvasBoundedZoomFloor,
  getCreatorCanvasMinimalPanDelta,
  isCreatorCanvasRectFullyVisible
} from "./creator-canvas-result-reveal";

describe("creator-canvas-result-reveal", () => {
  const viewport = { x: 100, y: 50, width: 1_000, height: 800 };
  const safe = createCreatorCanvasSafeViewportRect(viewport);

  it("treats a rectangle fully inside the safe viewport as visible", () => {
    expect(isCreatorCanvasRectFullyVisible(
      { x: 200, y: 150, width: 320, height: 240 },
      safe
    )).toBe(true);
  });

  it("rejects a rectangle clipped on the left", () => {
    expect(isCreatorCanvasRectFullyVisible(
      { x: 147, y: 150, width: 320, height: 240 },
      safe
    )).toBe(false);
  });

  it("rejects a rectangle clipped on the right", () => {
    expect(isCreatorCanvasRectFullyVisible(
      { x: 733, y: 150, width: 320, height: 240 },
      safe
    )).toBe(false);
  });

  it("rejects a rectangle clipped on the top", () => {
    expect(isCreatorCanvasRectFullyVisible(
      { x: 200, y: 97, width: 320, height: 240 },
      safe
    )).toBe(false);
  });

  it("rejects a rectangle clipped on the bottom", () => {
    expect(isCreatorCanvasRectFullyVisible(
      { x: 200, y: 563, width: 320, height: 240 },
      safe
    )).toBe(false);
  });

  it("accepts exact 48 pixel inset boundaries", () => {
    expect(safe).toEqual({ x: 148, y: 98, width: 904, height: 704 });
    expect(isCreatorCanvasRectFullyVisible(
      { x: 148, y: 98, width: 904, height: 704 },
      safe
    )).toBe(true);
  });

  it("returns the correct horizontal pan signs", () => {
    expect(getCreatorCanvasMinimalPanDelta(
      { x: 120, y: 150, width: 320, height: 240 },
      safe
    )).toEqual({ x: 28, y: 0 });
    expect(getCreatorCanvasMinimalPanDelta(
      { x: 760, y: 150, width: 320, height: 240 },
      safe
    )).toEqual({ x: -28, y: 0 });
  });

  it("returns the correct vertical pan signs", () => {
    expect(getCreatorCanvasMinimalPanDelta(
      { x: 200, y: 70, width: 320, height: 240 },
      safe
    )).toEqual({ x: 0, y: 28 });
    expect(getCreatorCanvasMinimalPanDelta(
      { x: 200, y: 590, width: 320, height: 240 },
      safe
    )).toEqual({ x: 0, y: -28 });
  });

  it("moves only the axis that needs correction", () => {
    expect(getCreatorCanvasMinimalPanDelta(
      { x: 200, y: 600, width: 320, height: 240 },
      safe
    )).toEqual({ x: 0, y: -38 });
  });

  it("detects flow bounds that fit at the current zoom", () => {
    expect(canCreatorCanvasFlowBoundsFitAtZoom(
      { width: 452, height: 352 },
      viewport,
      1.5
    )).toBe(true);
  });

  it("detects flow bounds that do not fit at the current zoom", () => {
    expect(canCreatorCanvasFlowBoundsFitAtZoom(
      { width: 700, height: 500 },
      viewport,
      1.5
    )).toBe(false);
  });

  it("uses the 20 percent zoom-out floor", () => {
    expect(getCreatorCanvasBoundedZoomFloor(1.5, 0.25)).toBeCloseTo(1.2);
  });

  it("honors the Canvas minimum zoom floor", () => {
    expect(getCreatorCanvasBoundedZoomFloor(0.3, 0.25)).toBe(0.25);
  });

  it("centers an oversized axis deterministically", () => {
    expect(getCreatorCanvasMinimalPanDelta(
      { x: -100, y: 150, width: 1_200, height: 240 },
      safe
    )).toEqual({ x: 100, y: 0 });
  });

  it("does not mutate inputs", () => {
    const viewportInput = Object.freeze({ ...viewport });
    const contentInput = Object.freeze({ x: 120, y: 70, width: 320, height: 240 });
    const viewportBefore = JSON.stringify(viewportInput);
    const contentBefore = JSON.stringify(contentInput);

    const safeRect = createCreatorCanvasSafeViewportRect(viewportInput);
    getCreatorCanvasMinimalPanDelta(contentInput, safeRect);
    canCreatorCanvasFlowBoundsFitAtZoom(contentInput, viewportInput, 1);

    expect(JSON.stringify(viewportInput)).toBe(viewportBefore);
    expect(JSON.stringify(contentInput)).toBe(contentBefore);
  });

  it("returns byte-equivalent output for the same input", () => {
    const input = { x: 760, y: 590, width: 320, height: 240 };
    const first = getCreatorCanvasMinimalPanDelta(input, safe);
    const second = getCreatorCanvasMinimalPanDelta(input, safe);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(CREATOR_CANVAS_RESULT_REVEAL_SAFE_INSET).toBe(48);
  });
});
