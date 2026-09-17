import type { CreatorCanvasPosition } from "./creator-canvas-document";

export const CREATOR_CANVAS_LOCAL_PLACEMENT_CLEARANCE = 48;
export const CREATOR_CANVAS_LOCAL_PLACEMENT_MAX_RINGS = 16;

export interface CreatorCanvasRect extends CreatorCanvasPosition {
  width: number;
  height: number;
}

export interface CreatorCanvasSize {
  width: number;
  height: number;
}

export interface CreatorCanvasLocalPlacementOptions {
  targetRect: CreatorCanvasRect;
  occupiedRects: readonly CreatorCanvasRect[];
  resultSize: CreatorCanvasSize;
  siblingCount: number;
  clearance: number;
}

interface CreatorCanvasResultGroupShape extends CreatorCanvasSize {
  rows: number;
}

type CreatorCanvasPlacementDirection = "below" | "left" | "above";

function getResultGroupShape(
  siblingCount: number,
  resultSize: CreatorCanvasSize,
  clearance: number
): CreatorCanvasResultGroupShape {
  if (siblingCount <= 0) {
    return { width: 0, height: 0, rows: 0 };
  }
  const rows = siblingCount === 1 ? 1 : 2;
  const columns = siblingCount <= 2 ? 1 : Math.ceil(siblingCount / rows);
  return {
    width: columns * resultSize.width + (columns - 1) * clearance,
    height: rows * resultSize.height + (rows - 1) * clearance,
    rows
  };
}

function createCandidateGroupRect(
  direction: CreatorCanvasPlacementDirection,
  ring: number,
  targetRect: CreatorCanvasRect,
  groupSize: CreatorCanvasSize,
  clearance: number
): CreatorCanvasRect {
  const targetRight = targetRect.x + targetRect.width;
  const targetBottom = targetRect.y + targetRect.height;
  switch (direction) {
    case "below":
      return {
        x: targetRight - groupSize.width,
        y: targetBottom + clearance + ring * (groupSize.height + clearance),
        ...groupSize
      };
    case "left":
      return {
        x: targetRect.x - clearance - groupSize.width -
          ring * (groupSize.width + clearance),
        y: targetRect.y,
        ...groupSize
      };
    case "above":
      return {
        x: targetRight - groupSize.width,
        y: targetRect.y - clearance - groupSize.height -
          ring * (groupSize.height + clearance),
        ...groupSize
      };
  }
}

function hasRequiredClearance(
  candidate: CreatorCanvasRect,
  occupied: CreatorCanvasRect,
  clearance: number
): boolean {
  const candidateRight = candidate.x + candidate.width;
  const candidateBottom = candidate.y + candidate.height;
  const occupiedRight = occupied.x + occupied.width;
  const occupiedBottom = occupied.y + occupied.height;
  return candidateRight + clearance <= occupied.x ||
    occupiedRight + clearance <= candidate.x ||
    candidateBottom + clearance <= occupied.y ||
    occupiedBottom + clearance <= candidate.y;
}

function isGroupPositionAvailable(
  candidate: CreatorCanvasRect,
  occupiedRects: readonly CreatorCanvasRect[],
  clearance: number
): boolean {
  return occupiedRects.every((occupied) =>
    hasRequiredClearance(candidate, occupied, clearance)
  );
}

function createSiblingPositions(
  groupPosition: CreatorCanvasPosition,
  groupRows: number,
  resultSize: CreatorCanvasSize,
  siblingCount: number,
  clearance: number
): CreatorCanvasPosition[] {
  return Array.from({ length: siblingCount }, (_, index) => {
    const column = Math.floor(index / groupRows);
    const row = index % groupRows;
    return {
      x: groupPosition.x + column * (resultSize.width + clearance),
      y: groupPosition.y + row * (resultSize.height + clearance)
    };
  });
}

export function planCreatorCanvasResultSiblingPositions({
  targetRect,
  occupiedRects,
  resultSize,
  siblingCount,
  clearance
}: CreatorCanvasLocalPlacementOptions): CreatorCanvasPosition[] {
  if (siblingCount <= 0) return [];

  const group = getResultGroupShape(siblingCount, resultSize, clearance);
  const directions = ["below", "left", "above"] as const;
  let groupPosition: CreatorCanvasPosition | null = null;

  for (let ring = 0; ring < CREATOR_CANVAS_LOCAL_PLACEMENT_MAX_RINGS; ring += 1) {
    for (const direction of directions) {
      const candidate = createCandidateGroupRect(
        direction,
        ring,
        targetRect,
        group,
        clearance
      );
      if (isGroupPositionAvailable(candidate, occupiedRects, clearance)) {
        groupPosition = { x: candidate.x, y: candidate.y };
        break;
      }
    }
    if (groupPosition) break;
  }

  if (!groupPosition) {
    const maxBottom = occupiedRects.reduce(
      (currentMax, occupied) =>
        Math.max(currentMax, occupied.y + occupied.height),
      targetRect.y + targetRect.height
    );
    groupPosition = {
      x: targetRect.x + targetRect.width - group.width,
      y: maxBottom + clearance
    };
  }

  return createSiblingPositions(
    groupPosition,
    group.rows,
    resultSize,
    siblingCount,
    clearance
  );
}
