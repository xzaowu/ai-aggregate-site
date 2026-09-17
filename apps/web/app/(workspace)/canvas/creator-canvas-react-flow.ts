import type { Connection, Edge } from "@xyflow/react";
import type {
  CreatorCanvasConnection,
  CreatorCanvasDocumentV1
} from "./creator-canvas-document";
import {
  CREATOR_CANVAS_NODE_DEFINITIONS,
  type CreatorCanvasViewActions,
  type CreatorCanvasViewEdge,
  type CreatorCanvasViewNode
} from "./creator-canvas-node-registry";
import type { CreatorImageAssetDisplayState } from "./creator-image-asset-display";
import type { CreatorTextAiComposerView } from "./creator-text-ai-panel";
import type { CreatorVideoNodeExecutionView } from "./creator-video-composer-panel";
import {
  toCreatorImageNodeExecutionView,
  type CreatorImageExecutionStatus
} from "./creator-image-execution-state";

export interface CreatorCanvasNodeRendererState {
  dragging?: boolean;
  measured?: { width?: number; height?: number };
  resizing?: boolean;
  width?: number;
  height?: number;
}

export function toCreatorCanvasReactFlowNodes(
  document: CreatorCanvasDocumentV1,
  actions: CreatorCanvasViewActions,
  selectedNodeIds: ReadonlySet<string>,
  getNodeAriaLabel: (kind: CreatorCanvasViewNode["type"]) => string = (kind) =>
    CREATOR_CANVAS_NODE_DEFINITIONS[kind].labelKey,
  rendererStateByNodeId: ReadonlyMap<string, CreatorCanvasNodeRendererState> = new Map(),
  assetToken: string | null = null,
  imageAssetDisplayByNodeId: ReadonlyMap<string, CreatorImageAssetDisplayState> = new Map(),
  imageExecutionStatusByNodeId: ReadonlyMap<string, CreatorImageExecutionStatus> = new Map(),
  textAiComposerByNodeId: ReadonlyMap<string, CreatorTextAiComposerView> = new Map(),
  videoExecutionByNodeId: ReadonlyMap<string, CreatorVideoNodeExecutionView> = new Map()
): CreatorCanvasViewNode[] {
  return document.nodes.map((domainNode) => {
    const rendererState = rendererStateByNodeId.get(domainNode.id);
    return {
      id: domainNode.id,
      type: domainNode.kind,
      position: domainNode.position,
      selected: selectedNodeIds.has(domainNode.id),
      dragging: rendererState?.dragging,
      measured: rendererState?.measured,
      resizing: rendererState?.resizing,
      width: rendererState?.width,
      height: rendererState?.height,
      style: { width: CREATOR_CANVAS_NODE_DEFINITIONS[domainNode.kind].defaultWidth },
      data: {
        domainNode,
        actions,
        assetToken,
        imageAssetDisplay: domainNode.kind === "image"
          ? imageAssetDisplayByNodeId.get(domainNode.id)
          : undefined,
        textAiComposer: textAiComposerByNodeId.get(domainNode.id) ?? null,
        imageExecution: domainNode.kind === "image"
          ? toCreatorImageNodeExecutionView(
              imageExecutionStatusByNodeId.get(domainNode.id)
            )
          : null,
        videoExecution: domainNode.kind === "video"
          ? videoExecutionByNodeId.get(domainNode.id) ?? null
          : null
      },
      ariaLabel: getNodeAriaLabel(domainNode.kind)
    };
  });
}

export function toCreatorCanvasReactFlowEdges(
  document: CreatorCanvasDocumentV1,
  selectedEdgeIds: ReadonlySet<string>
): CreatorCanvasViewEdge[] {
  return document.edges.map((domainEdge) => ({
    id: domainEdge.id,
    type: "smoothstep",
    source: domainEdge.sourceNodeId,
    sourceHandle: "source",
    target: domainEdge.targetNodeId,
    targetHandle: "target",
    selected: selectedEdgeIds.has(domainEdge.id),
    reconnectable: true,
    style: { strokeWidth: 2 }
  }));
}

export function fromCreatorCanvasReactFlowConnection(
  connection: Connection | Edge
): CreatorCanvasConnection | null {
  if (!connection.source || !connection.target) return null;
  return {
    sourceNodeId: connection.source,
    targetNodeId: connection.target,
    relationship: "reference"
  };
}
