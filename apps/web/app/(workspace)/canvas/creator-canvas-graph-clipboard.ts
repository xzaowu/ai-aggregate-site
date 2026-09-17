import type {
  CreatorCanvasDocumentV1,
  CreatorCanvasEdge,
  CreatorCanvasPosition,
  CreatorContentNode
} from "./creator-canvas-document";
import {
  parseCreatorCanvasDocument
} from "./creator-canvas-document";
import type { CreatorImageComposerDraft } from "./creator-image-composer";
import { cloneCreatorTextAiConfig } from "./creator-text-ai";
import {
  cloneCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";

export const CREATOR_CANVAS_GRAPH_PASTE_CASCADE_OFFSET = Object.freeze({
  x: 32,
  y: 32
}) satisfies CreatorCanvasPosition;

export type CreatorCanvasGraphClipboard = Readonly<{
  nodes: readonly CreatorContentNode[];
  edges: readonly CreatorCanvasEdge[];
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>;
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft>;
}>;

export type CreatorCanvasGraphIdFactory = (
  prefix: string,
  existingIds: ReadonlySet<string>
) => string;

export type CreatorCanvasGraphPasteResult = Readonly<{
  document: CreatorCanvasDocumentV1;
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>;
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft>;
  pastedNodeIds: readonly string[];
  pastedEdgeIds: readonly string[];
  placementOffset: CreatorCanvasPosition;
}>;

function cloneNode(node: CreatorContentNode): CreatorContentNode {
  switch (node.kind) {
    case "text":
      return {
        id: node.id,
        kind: node.kind,
        position: { ...node.position },
        data: {
          text: node.data.text,
          ...(node.data.ai ? { ai: cloneCreatorTextAiConfig(node.data.ai) } : {})
        }
      };
    case "image":
      return {
        id: node.id,
        kind: node.kind,
        position: { ...node.position },
        data: { assetId: node.data.assetId }
      };
    case "video":
      return {
        id: node.id,
        kind: node.kind,
        position: { ...node.position },
        data: { assetId: node.data.assetId }
      };
  }
}

function cloneEdge(edge: CreatorCanvasEdge): CreatorCanvasEdge {
  return { ...edge };
}

function cloneDraft(draft: CreatorImageComposerDraft): CreatorImageComposerDraft {
  return { ...draft };
}

function cloneDraftMap(
  drafts: ReadonlyMap<string, CreatorImageComposerDraft>
): Map<string, CreatorImageComposerDraft> {
  return new Map(
    Array.from(drafts, ([nodeId, draft]) => [nodeId, cloneDraft(draft)] as const)
  );
}

function cloneVideoDraftMap(
  drafts: ReadonlyMap<string, CreatorVideoComposerDraft>
): Map<string, CreatorVideoComposerDraft> {
  return new Map(
    Array.from(drafts, ([nodeId, draft]) => [
      nodeId,
      cloneCreatorVideoComposerDraft(draft)
    ] as const)
  );
}

export function captureCreatorCanvasGraphClipboard(
  document: CreatorCanvasDocumentV1,
  selectedNodeIds: ReadonlySet<string>,
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>,
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
): CreatorCanvasGraphClipboard | null {
  if (selectedNodeIds.size === 0) return null;

  const nodes = document.nodes.filter((node) => selectedNodeIds.has(node.id));
  if (nodes.length === 0) return null;

  const copiedNodeIds = new Set(nodes.map((node) => node.id));
  const edges = document.edges.filter(
    (edge) => copiedNodeIds.has(edge.sourceNodeId) && copiedNodeIds.has(edge.targetNodeId)
  );
  const copiedDrafts = new Map<string, CreatorImageComposerDraft>();
  for (const node of nodes) {
    if (node.kind !== "image") continue;
    const draft = imageComposerDrafts.get(node.id);
    if (draft) copiedDrafts.set(node.id, cloneDraft(draft));
  }
  const copiedVideoDrafts = new Map<string, CreatorVideoComposerDraft>();
  for (const node of nodes) {
    if (node.kind !== "video") continue;
    const draft = videoComposerDrafts.get(node.id);
    if (draft) copiedVideoDrafts.set(node.id, cloneCreatorVideoComposerDraft(draft));
  }

  return {
    nodes: nodes.map(cloneNode),
    edges: edges.map(cloneEdge),
    imageComposerDrafts: copiedDrafts,
    videoComposerDrafts: copiedVideoDrafts
  };
}

function getNodePositionBounds(nodes: readonly CreatorContentNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return nodes.reduce(
    (bounds, node) => ({
      minX: Math.min(bounds.minX, node.position.x),
      minY: Math.min(bounds.minY, node.position.y),
      maxX: Math.max(bounds.maxX, node.position.x),
      maxY: Math.max(bounds.maxY, node.position.y)
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    }
  );
}

export function calculateCreatorCanvasPasteOffset(
  nodes: readonly CreatorContentNode[],
  anchor: CreatorCanvasPosition,
  pasteIndex = 0,
  cascadeOffset: CreatorCanvasPosition = CREATOR_CANVAS_GRAPH_PASTE_CASCADE_OFFSET
): CreatorCanvasPosition {
  if (nodes.length === 0) {
    return {
      x: anchor.x + cascadeOffset.x * Math.max(0, pasteIndex),
      y: anchor.y + cascadeOffset.y * Math.max(0, pasteIndex)
    };
  }

  const bounds = getNodePositionBounds(nodes);
  const cascadeIndex = Math.max(0, pasteIndex);
  return {
    x: anchor.x - (bounds.minX + bounds.maxX) / 2 + cascadeOffset.x * cascadeIndex,
    y: anchor.y - (bounds.minY + bounds.maxY) / 2 + cascadeOffset.y * cascadeIndex
  };
}

function createFreshId(
  prefix: string,
  existingIds: Set<string>,
  createId: CreatorCanvasGraphIdFactory
): string {
  const id = createId(prefix, existingIds);
  if (typeof id !== "string" || id.trim().length === 0 || existingIds.has(id)) {
    throw new Error("CREATOR_CANVAS_GRAPH_ID_INVALID");
  }
  existingIds.add(id);
  return id;
}

function remapDraftReference(
  nodeId: string | null,
  nodeIdMap: ReadonlyMap<string, string>
): string | null {
  if (nodeId === null) return null;
  return nodeIdMap.get(nodeId) ?? null;
}

function remapDraft(
  draft: CreatorImageComposerDraft,
  nodeIdMap: ReadonlyMap<string, string>
): CreatorImageComposerDraft {
  return {
    ...draft,
    selectedImageReferenceNodeId: remapDraftReference(
      draft.selectedImageReferenceNodeId,
      nodeIdMap
    ),
    promptSeedSourceNodeId: remapDraftReference(
      draft.promptSeedSourceNodeId,
      nodeIdMap
    )
  };
}

function remapVideoDraft(
  draft: CreatorVideoComposerDraft,
  nodeIdMap: ReadonlyMap<string, string>
): CreatorVideoComposerDraft {
  return {
    ...cloneCreatorVideoComposerDraft(draft),
    selectedImageReferenceNodeId: remapDraftReference(
      draft.selectedImageReferenceNodeId,
      nodeIdMap
    ),
    promptSeedSourceNodeId: remapDraftReference(
      draft.promptSeedSourceNodeId,
      nodeIdMap
    )
  };
}

export function cloneCreatorCanvasGraphForPaste(
  clipboard: CreatorCanvasGraphClipboard,
  document: CreatorCanvasDocumentV1,
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>,
  options: {
    anchor: CreatorCanvasPosition;
    pasteIndex?: number;
    cascadeOffset?: CreatorCanvasPosition;
    createId: CreatorCanvasGraphIdFactory;
  },
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
): CreatorCanvasGraphPasteResult | null {
  if (clipboard.nodes.length === 0) return null;

  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return null;

  const existingNodeIds = new Set(parsed.document.nodes.map((node) => node.id));
  const nodeIdMap = new Map<string, string>();
  const placementOffset = calculateCreatorCanvasPasteOffset(
    clipboard.nodes,
    options.anchor,
    options.pasteIndex ?? 0,
    options.cascadeOffset
  );
  const pastedNodes = clipboard.nodes.map((sourceNode) => {
    const nextId = createFreshId(sourceNode.kind, existingNodeIds, options.createId);
    nodeIdMap.set(sourceNode.id, nextId);
    const nextNode = cloneNode(sourceNode);
    nextNode.id = nextId;
    nextNode.position = {
      x: nextNode.position.x + placementOffset.x,
      y: nextNode.position.y + placementOffset.y
    };
    return nextNode;
  });

  const existingEdgeIds = new Set(parsed.document.edges.map((edge) => edge.id));
  const pastedEdges = clipboard.edges.map((sourceEdge) => ({
    ...cloneEdge(sourceEdge),
    id: createFreshId("edge", existingEdgeIds, options.createId),
    sourceNodeId: nodeIdMap.get(sourceEdge.sourceNodeId) ?? "",
    targetNodeId: nodeIdMap.get(sourceEdge.targetNodeId) ?? ""
  }));
  if (pastedEdges.some((edge) => edge.sourceNodeId.length === 0 || edge.targetNodeId.length === 0)) {
    return null;
  }

  const nextDrafts = cloneDraftMap(imageComposerDrafts);
  for (const [sourceNodeId, sourceDraft] of clipboard.imageComposerDrafts) {
    const pastedNodeId = nodeIdMap.get(sourceNodeId);
    if (!pastedNodeId) continue;
    const pastedNode = pastedNodes.find((node) => node.id === pastedNodeId);
    if (!pastedNode || pastedNode.kind !== "image") continue;
    nextDrafts.set(pastedNodeId, remapDraft(sourceDraft, nodeIdMap));
  }

  const nextVideoDrafts = cloneVideoDraftMap(videoComposerDrafts);
  for (const [sourceNodeId, sourceDraft] of clipboard.videoComposerDrafts) {
    const pastedNodeId = nodeIdMap.get(sourceNodeId);
    if (!pastedNodeId) continue;
    const pastedNode = pastedNodes.find((node) => node.id === pastedNodeId);
    if (!pastedNode || pastedNode.kind !== "video") continue;
    nextVideoDrafts.set(pastedNodeId, remapVideoDraft(sourceDraft, nodeIdMap));
  }

  const next = parseCreatorCanvasDocument({
    ...parsed.document,
    nodes: [...parsed.document.nodes, ...pastedNodes],
    edges: [...parsed.document.edges, ...pastedEdges]
  });
  if (!next.ok) return null;

  return {
    document: next.document,
    imageComposerDrafts: nextDrafts,
    videoComposerDrafts: nextVideoDrafts,
    pastedNodeIds: pastedNodes.map((node) => node.id),
    pastedEdgeIds: pastedEdges.map((edge) => edge.id),
    placementOffset
  };
}
