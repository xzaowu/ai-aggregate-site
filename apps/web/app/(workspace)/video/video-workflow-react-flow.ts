import type { Connection, Edge, Node } from "@xyflow/react";
import type {
  VideoWorkflowEdge,
  VideoWorkflowGraphV1,
  VideoWorkflowNode
} from "./video-workflow-graph";

export interface VideoWorkflowNodeActions {
  onPromptChange: (prompt: string) => void;
  onReferenceFileNameChange: (fileName: string | null) => void;
}

export interface VideoWorkflowViewData extends Record<string, unknown> {
  domainNode: VideoWorkflowNode;
  actions: VideoWorkflowNodeActions;
}

export type VideoWorkflowViewNode = Node<VideoWorkflowViewData, VideoWorkflowNode["kind"]>;
export type VideoWorkflowViewEdge = Edge<Record<string, never>, "smoothstep">;

export function toReactFlowNodes(
  graph: VideoWorkflowGraphV1,
  actions: VideoWorkflowNodeActions,
  selectedNodeIds: ReadonlySet<string>
): VideoWorkflowViewNode[] {
  return graph.nodes.map((domainNode) => ({
    id: domainNode.id,
    type: domainNode.kind,
    position: domainNode.position,
    data: { domainNode, actions },
    selected: selectedNodeIds.has(domainNode.id),
    deletable: false,
    ariaLabel: `${domainNode.kind} workflow node`
  }));
}

export function toReactFlowEdges(
  graph: VideoWorkflowGraphV1,
  selectedEdgeIds: ReadonlySet<string>
): VideoWorkflowViewEdge[] {
  return graph.edges.map((domainEdge) => ({
    id: domainEdge.id,
    type: "smoothstep",
    source: domainEdge.sourceNodeId,
    sourceHandle: domainEdge.sourcePort,
    target: domainEdge.targetNodeId,
    targetHandle: domainEdge.targetPort,
    selected: selectedEdgeIds.has(domainEdge.id),
    reconnectable: true,
    style: { strokeWidth: 2 }
  }));
}

export function fromReactFlowConnection(
  connection: Connection | Edge
): Omit<VideoWorkflowEdge, "id"> | null {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return null;
  }
  return {
    sourceNodeId: connection.source,
    sourcePort: connection.sourceHandle,
    targetNodeId: connection.target,
    targetPort: connection.targetHandle
  };
}
