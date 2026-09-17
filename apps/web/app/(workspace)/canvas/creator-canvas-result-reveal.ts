export const CREATOR_CANVAS_RESULT_REVEAL_SAFE_INSET = 48;
export const CREATOR_CANVAS_RESULT_REVEAL_ZOOM_FLOOR_RATIO = 0.8;
export const CREATOR_CANVAS_RESULT_REVEAL_DURATION_MS = 250;

export interface CreatorCanvasRevealPosition {
  x: number;
  y: number;
}

export interface CreatorCanvasRevealSize {
  width: number;
  height: number;
}

export interface CreatorCanvasRevealRect
  extends CreatorCanvasRevealPosition, CreatorCanvasRevealSize {}

function getSafeInset(viewportSpan: number, inset: number): number {
  return Math.min(Math.max(inset, 0), Math.max(viewportSpan, 0) / 2);
}

export function createCreatorCanvasSafeViewportRect(
  viewportRect: CreatorCanvasRevealRect,
  inset = CREATOR_CANVAS_RESULT_REVEAL_SAFE_INSET
): CreatorCanvasRevealRect {
  const horizontalInset = getSafeInset(viewportRect.width, inset);
  const verticalInset = getSafeInset(viewportRect.height, inset);
  return {
    x: viewportRect.x + horizontalInset,
    y: viewportRect.y + verticalInset,
    width: Math.max(0, viewportRect.width - horizontalInset * 2),
    height: Math.max(0, viewportRect.height - verticalInset * 2)
  };
}

export function isCreatorCanvasRectFullyVisible(
  contentRect: CreatorCanvasRevealRect,
  safeViewportRect: CreatorCanvasRevealRect
): boolean {
  return contentRect.x >= safeViewportRect.x &&
    contentRect.y >= safeViewportRect.y &&
    contentRect.x + contentRect.width <=
      safeViewportRect.x + safeViewportRect.width &&
    contentRect.y + contentRect.height <=
      safeViewportRect.y + safeViewportRect.height;
}

function getMinimalAxisDelta(
  contentStart: number,
  contentSpan: number,
  safeStart: number,
  safeSpan: number
): number {
  if (contentSpan > safeSpan) {
    return safeStart + safeSpan / 2 - (contentStart + contentSpan / 2);
  }
  if (contentStart < safeStart) {
    return safeStart - contentStart;
  }
  const contentEnd = contentStart + contentSpan;
  const safeEnd = safeStart + safeSpan;
  return contentEnd > safeEnd ? safeEnd - contentEnd : 0;
}

export function getCreatorCanvasMinimalPanDelta(
  contentRect: CreatorCanvasRevealRect,
  safeViewportRect: CreatorCanvasRevealRect
): CreatorCanvasRevealPosition {
  return {
    x: getMinimalAxisDelta(
      contentRect.x,
      contentRect.width,
      safeViewportRect.x,
      safeViewportRect.width
    ),
    y: getMinimalAxisDelta(
      contentRect.y,
      contentRect.height,
      safeViewportRect.y,
      safeViewportRect.height
    )
  };
}

export function canCreatorCanvasFlowBoundsFitAtZoom(
  flowBounds: CreatorCanvasRevealSize,
  viewportSize: CreatorCanvasRevealSize,
  zoom: number,
  inset = CREATOR_CANVAS_RESULT_REVEAL_SAFE_INSET
): boolean {
  const horizontalInset = getSafeInset(viewportSize.width, inset);
  const verticalInset = getSafeInset(viewportSize.height, inset);
  return flowBounds.width * zoom <= viewportSize.width - horizontalInset * 2 &&
    flowBounds.height * zoom <= viewportSize.height - verticalInset * 2;
}

export function getCreatorCanvasBoundedZoomFloor(
  currentZoom: number,
  minimumZoom: number,
  floorRatio = CREATOR_CANVAS_RESULT_REVEAL_ZOOM_FLOOR_RATIO
): number {
  return Math.min(currentZoom, Math.max(minimumZoom, currentZoom * floorRatio));
}
