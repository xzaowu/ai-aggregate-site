import type {
  CreatorCanvasDocumentV1,
  CreatorCanvasPosition,
  CreatorVideoNode
} from "./creator-canvas-document";

export type CreatorVideoResultApplicationResult =
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
      error:
        | "TARGET_NOT_FOUND"
        | "TARGET_NOT_VIDEO"
        | "ASSET_ID_INVALID"
        | "SIBLING_POSITION_INVALID"
        | "NODE_ID_INVALID";
    }>;

export type ApplyCreatorVideoResultOptions = Readonly<{
  document: CreatorCanvasDocumentV1;
  targetNodeId: string;
  assetId: string;
  siblingPosition?: CreatorCanvasPosition;
  createNodeId?: () => string;
}>;

export function applyCreatorVideoResult({
  document,
  targetNodeId,
  assetId,
  siblingPosition,
  createNodeId = () => ""
}: ApplyCreatorVideoResultOptions): CreatorVideoResultApplicationResult {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    return { ok: false, document, error: "ASSET_ID_INVALID" };
  }

  const target = document.nodes.find((node) => node.id === targetNodeId);
  if (!target) {
    return { ok: false, document, error: "TARGET_NOT_FOUND" };
  }
  if (target.kind !== "video") {
    return { ok: false, document, error: "TARGET_NOT_VIDEO" };
  }

  if (target.data.assetId === null) {
    return {
      ok: true,
      document: {
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === targetNodeId && node.kind === "video"
            ? { ...node, data: { assetId: normalizedAssetId } }
            : node
        )
      },
      targetNodeId,
      targetWasEmpty: true,
      boundTargetAssetId: normalizedAssetId,
      createdNodeIds: []
    };
  }

  if (
    !siblingPosition ||
    !Number.isFinite(siblingPosition.x) ||
    !Number.isFinite(siblingPosition.y)
  ) {
    return { ok: false, document, error: "SIBLING_POSITION_INVALID" };
  }
  const siblingId = createNodeId().trim();
  if (!siblingId || document.nodes.some((node) => node.id === siblingId)) {
    return { ok: false, document, error: "NODE_ID_INVALID" };
  }
  const sibling: CreatorVideoNode = {
    id: siblingId,
    kind: "video",
    position: { ...siblingPosition },
    data: { assetId: normalizedAssetId }
  };
  return {
    ok: true,
    document: {
      ...document,
      nodes: [...document.nodes, sibling]
    },
    targetNodeId,
    targetWasEmpty: false,
    boundTargetAssetId: null,
    createdNodeIds: [siblingId]
  };
}
