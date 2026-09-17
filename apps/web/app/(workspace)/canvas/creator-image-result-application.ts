import type {
  CreatorCanvasDocumentV1,
  CreatorCanvasPosition,
  CreatorImageNode
} from "./creator-canvas-document";

export type CreatorImageResultApplicationResult =
  | Readonly<{
      ok: true;
      document: CreatorCanvasDocumentV1;
      targetNodeId: string;
      targetWasEmpty: boolean;
      boundTargetAssetId: string | null;
      createdNodeIds: string[];
    }>
  | Readonly<{
      ok: false;
      document: CreatorCanvasDocumentV1;
      error: "NO_IMAGE_RESULTS" | "TARGET_NOT_FOUND" | "TARGET_NOT_IMAGE" |
        "SIBLING_POSITIONS_INVALID" | "NODE_ID_INVALID";
    }>;

export type ApplyCreatorImageResultsOptions = Readonly<{
  document: CreatorCanvasDocumentV1;
  targetNodeId: string;
  orderedAssetIds: readonly string[];
  siblingPositions: readonly CreatorCanvasPosition[];
  createNodeId: (assetId: string, index: number) => string;
}>;

function readOrderedAssetIds(assetIds: readonly string[]): string[] {
  return assetIds.flatMap((assetId) => {
    const normalized = assetId.trim();
    return normalized ? [normalized] : [];
  });
}

export function applyCreatorImageResults({
  document,
  targetNodeId,
  orderedAssetIds,
  siblingPositions,
  createNodeId
}: ApplyCreatorImageResultsOptions): CreatorImageResultApplicationResult {
  const assetIds = readOrderedAssetIds(orderedAssetIds);
  if (assetIds.length === 0) {
    return { ok: false, document, error: "NO_IMAGE_RESULTS" };
  }

  const target = document.nodes.find((node) => node.id === targetNodeId);
  if (!target) {
    return { ok: false, document, error: "TARGET_NOT_FOUND" };
  }
  if (target.kind !== "image") {
    return { ok: false, document, error: "TARGET_NOT_IMAGE" };
  }

  const targetWasEmpty = target.data.assetId === null;
  const boundTargetAssetId = targetWasEmpty ? assetIds[0] ?? null : null;
  const siblingAssetIds = targetWasEmpty ? assetIds.slice(1) : assetIds;
  if (
    siblingPositions.length !== siblingAssetIds.length ||
    siblingPositions.some((position) =>
      !Number.isFinite(position.x) || !Number.isFinite(position.y)
    )
  ) {
    return { ok: false, document, error: "SIBLING_POSITIONS_INVALID" };
  }
  const usedNodeIds = new Set(document.nodes.map((node) => node.id));
  const siblings: CreatorImageNode[] = [];

  for (let index = 0; index < siblingAssetIds.length; index += 1) {
    const assetId = siblingAssetIds[index];
    if (!assetId) continue;
    const nodeId = createNodeId(assetId, index).trim();
    if (!nodeId || usedNodeIds.has(nodeId)) {
      return { ok: false, document, error: "NODE_ID_INVALID" };
    }
    usedNodeIds.add(nodeId);
    const position = siblingPositions[index];
    if (!position) {
      return { ok: false, document, error: "SIBLING_POSITIONS_INVALID" };
    }
    siblings.push({
      id: nodeId,
      kind: "image",
      position: { ...position },
      data: { assetId }
    });
  }

  const nodes = targetWasEmpty
    ? document.nodes.map((node) =>
        node.id === targetNodeId
          ? { ...target, data: { assetId: boundTargetAssetId } }
          : node
      )
    : document.nodes;

  return {
    ok: true,
    document: {
      ...document,
      nodes: [...nodes, ...siblings]
    },
    targetNodeId,
    targetWasEmpty,
    boundTargetAssetId,
    createdNodeIds: siblings.map((node) => node.id)
  };
}
