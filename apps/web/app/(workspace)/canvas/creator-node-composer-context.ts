import {
  parseCreatorCanvasDocument,
  type CreatorCanvasDocumentV1,
  type CreatorCanvasRelationship,
  type CreatorContentNode
} from "./creator-canvas-document";

export type CreatorNodeMediaBindingState = "not-applicable" | "empty" | "bound";

export interface CreatorNodeIncomingReference {
  edgeId: string;
  relationship: CreatorCanvasRelationship;
  sourceNode: CreatorContentNode;
  mediaBinding: CreatorNodeMediaBindingState;
}

export interface CreatorNodeComposerContext {
  node: CreatorContentNode;
  mediaBinding: CreatorNodeMediaBindingState;
  incomingReferences: CreatorNodeIncomingReference[];
}

export function getCreatorCanvasMediaBindingState(
  node: CreatorContentNode
): CreatorNodeMediaBindingState {
  if (node.kind === "text") return "not-applicable";
  return node.data.assetId === null ? "empty" : "bound";
}

export function getCreatorCanvasNode(
  document: CreatorCanvasDocumentV1,
  nodeId: string
): CreatorContentNode | null {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return null;
  return parsed.document.nodes.find((node) => node.id === nodeId) ?? null;
}

export function getCreatorNodeIncomingReferences(
  document: CreatorCanvasDocumentV1,
  nodeId: string
): CreatorNodeIncomingReference[] {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok || !parsed.document.nodes.some((node) => node.id === nodeId)) return [];
  const nodeById = new Map(parsed.document.nodes.map((node) => [node.id, node]));

  return parsed.document.edges.flatMap((edge) => {
    if (edge.targetNodeId !== nodeId || edge.relationship !== "reference") return [];
    const sourceNode = nodeById.get(edge.sourceNodeId);
    return sourceNode
      ? [{
          edgeId: edge.id,
          relationship: edge.relationship,
          sourceNode,
          mediaBinding: getCreatorCanvasMediaBindingState(sourceNode)
        }]
      : [];
  });
}

export function buildCreatorNodeComposerContext(
  document: CreatorCanvasDocumentV1,
  nodeId: string
): CreatorNodeComposerContext | null {
  const node = getCreatorCanvasNode(document, nodeId);
  if (!node) return null;
  return {
    node,
    mediaBinding: getCreatorCanvasMediaBindingState(node),
    incomingReferences: getCreatorNodeIncomingReferences(document, nodeId)
  };
}
