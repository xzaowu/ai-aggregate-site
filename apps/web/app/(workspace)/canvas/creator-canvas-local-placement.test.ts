import { describe, expect, it } from "vitest";
import {
  CREATOR_CANVAS_LOCAL_PLACEMENT_MAX_RINGS,
  planCreatorCanvasResultSiblingPositions,
  type CreatorCanvasLocalPlacementOptions,
  type CreatorCanvasRect
} from "./creator-canvas-local-placement";

const targetRect = Object.freeze({ x: 100, y: 200, width: 320, height: 320 });
const resultSize = Object.freeze({ width: 320, height: 320 });
const clearance = 48;

function plan(
  siblingCount: number,
  occupiedRects: readonly CreatorCanvasRect[] = [targetRect],
  overrides: Partial<CreatorCanvasLocalPlacementOptions> = {}
) {
  return planCreatorCanvasResultSiblingPositions({
    targetRect,
    occupiedRects,
    resultSize,
    siblingCount,
    clearance,
    ...overrides
  });
}

function groupBounds(positions: readonly { x: number; y: number }[]) {
  return {
    left: Math.min(...positions.map((position) => position.x)),
    right: Math.max(...positions.map((position) => position.x + resultSize.width)),
    top: Math.min(...positions.map((position) => position.y)),
    bottom: Math.max(...positions.map((position) => position.y + resultSize.height))
  };
}

describe("planCreatorCanvasResultSiblingPositions", () => {
  it("returns no positions for zero siblings", () => {
    expect(plan(0)).toEqual([]);
  });

  it("places one sibling below with right edges aligned", () => {
    expect(plan(1)).toEqual([{ x: 100, y: 568 }]);
  });

  it("places two siblings in one column with an exact 48-unit gap", () => {
    const positions = plan(2);
    expect(positions).toEqual([
      { x: 100, y: 568 },
      { x: 100, y: 936 }
    ]);
    expect(positions[1]!.y - (positions[0]!.y + resultSize.height)).toBe(48);
  });

  it("places three siblings column-major in a 2x2 group with one empty slot", () => {
    expect(plan(3)).toEqual([
      { x: -268, y: 568 },
      { x: -268, y: 936 },
      { x: 100, y: 568 }
    ]);
  });

  it("places four siblings column-major in a compact 2x2 group", () => {
    expect(plan(4)).toEqual([
      { x: -268, y: 568 },
      { x: -268, y: 936 },
      { x: 100, y: 568 },
      { x: 100, y: 936 }
    ]);
  });

  it("preserves deterministic result order", () => {
    const positions = plan(4);
    expect(positions.map((position) => `${position.x}:${position.y}`)).toEqual([
      "-268:568",
      "-268:936",
      "100:568",
      "100:936"
    ]);
  });

  it("uses LEFT when direct BELOW is occupied", () => {
    expect(plan(1, [
      targetRect,
      { x: 100, y: 568, width: 320, height: 320 }
    ])).toEqual([{ x: -268, y: 200 }]);
  });

  it("uses ABOVE when direct BELOW and LEFT are occupied", () => {
    expect(plan(1, [
      targetRect,
      { x: 100, y: 568, width: 320, height: 320 },
      { x: -268, y: 200, width: 320, height: 320 }
    ])).toEqual([{ x: 100, y: -168 }]);
  });

  it("scans outward by complete group pitches after base directions collide", () => {
    expect(plan(1, [
      targetRect,
      { x: 100, y: 568, width: 320, height: 320 },
      { x: -268, y: 200, width: 320, height: 320 },
      { x: 100, y: -168, width: 320, height: 320 }
    ])).toEqual([{ x: 100, y: 936 }]);
  });

  it("uses the deterministic global-below fallback when the local scan is exhausted", () => {
    const occupied: CreatorCanvasRect[] = [targetRect];
    for (let ring = 0; ring < CREATOR_CANVAS_LOCAL_PLACEMENT_MAX_RINGS; ring += 1) {
      occupied.push(
        { x: 100, y: 568 + ring * 368, width: 320, height: 320 },
        { x: -268 - ring * 368, y: 200, width: 320, height: 320 },
        { x: 100, y: -168 - ring * 368, width: 320, height: 320 }
      );
    }

    const positions = plan(1, occupied);
    const maxBottom = Math.max(...occupied.map((rect) => rect.y + rect.height));
    expect(positions).toEqual([{ x: 100, y: maxBottom + clearance }]);
  });

  it("supports negative target coordinates", () => {
    expect(plan(1, [{ x: -800, y: -600, width: 320, height: 320 }], {
      targetRect: { x: -800, y: -600, width: 320, height: 320 }
    })).toEqual([{ x: -800, y: -232 }]);
  });

  it("supports targets far from the origin", () => {
    expect(plan(1, [{ x: 1_000_000, y: 2_000_000, width: 320, height: 320 }], {
      targetRect: { x: 1_000_000, y: 2_000_000, width: 320, height: 320 }
    })).toEqual([{ x: 1_000_000, y: 2_000_368 }]);
  });

  it("avoids mixed Text, Image, and Video occupied rectangles as one group", () => {
    expect(plan(2, [
      targetRect,
      { x: 100, y: 568, width: 320, height: 180 },
      { x: -268, y: 200, width: 320, height: 282 },
      { x: 100, y: -536, width: 336, height: 240 }
    ])).toEqual([{ x: 100, y: 1_304 }, { x: 100, y: 1_672 }]);
  });

  it("rejects a 47-unit gap", () => {
    expect(plan(1, [
      targetRect,
      { x: 467, y: 568, width: 100, height: 320 }
    ])).toEqual([{ x: -268, y: 200 }]);
  });

  it("accepts an exact 48-unit gap", () => {
    expect(plan(1, [
      targetRect,
      { x: 468, y: 568, width: 100, height: 320 }
    ])).toEqual([{ x: 100, y: 568 }]);
  });

  it("rejects exact edge touching without clearance", () => {
    expect(plan(1, [
      targetRect,
      { x: 420, y: 568, width: 100, height: 320 }
    ])).toEqual([{ x: -268, y: 200 }]);
  });

  it("does not mutate input objects", () => {
    const occupied = [
      { ...targetRect },
      { x: 100, y: 568, width: 320, height: 320 }
    ];
    const input = {
      targetRect: { ...targetRect },
      occupiedRects: occupied,
      resultSize: { ...resultSize },
      siblingCount: 2,
      clearance
    };
    const before = JSON.stringify(input);

    planCreatorCanvasResultSiblingPositions(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it("returns byte-equivalent positions for the same input", () => {
    const input = {
      targetRect,
      occupiedRects: [targetRect],
      resultSize,
      siblingCount: 4,
      clearance
    };
    expect(JSON.stringify(planCreatorCanvasResultSiblingPositions(input)))
      .toBe(JSON.stringify(planCreatorCanvasResultSiblingPositions(input)));
  });

  it("keeps every BELOW or ABOVE group at or left of the target right edge", () => {
    const targetRight = targetRect.x + targetRect.width;
    for (const siblingCount of [1, 2, 3, 4]) {
      const below = plan(siblingCount);
      expect(groupBounds(below).right).toBeLessThanOrEqual(targetRight);

      const group = groupBounds(below);
      const above = plan(siblingCount, [
        targetRect,
        { x: group.left, y: group.top, width: group.right - group.left, height: group.bottom - group.top },
        { x: targetRect.x - clearance - (group.right - group.left), y: targetRect.y, width: group.right - group.left, height: group.bottom - group.top }
      ]);
      expect(groupBounds(above).right).toBeLessThanOrEqual(targetRight);
    }
  });
});
