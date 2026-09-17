export const VIDEO_WORKFLOW_GRAPH_VERSION = 1 as const;

export type VideoWorkflowMode = "text-to-video" | "image-to-video";
export type VideoWorkflowNodeKind =
  | "prompt"
  | "reference-image"
  | "video-generate"
  | "video-result";

export interface VideoWorkflowPosition {
  x: number;
  y: number;
}

interface VideoWorkflowNodeBase<
  Kind extends VideoWorkflowNodeKind,
  Data extends Record<string, unknown>
> {
  id: string;
  kind: Kind;
  position: VideoWorkflowPosition;
  data: Data;
}

export type VideoWorkflowPromptNode = VideoWorkflowNodeBase<
  "prompt",
  { prompt: string }
>;

export type VideoWorkflowReferenceNode = VideoWorkflowNodeBase<
  "reference-image",
  { fileName: string | null }
>;

export type VideoWorkflowGenerateNode = VideoWorkflowNodeBase<
  "video-generate",
  {
    modelLabel: string;
    mode: VideoWorkflowMode;
    executionStatus: "pending-integration";
  }
>;

export type VideoWorkflowResultNode = VideoWorkflowNodeBase<
  "video-result",
  { status: "waiting-for-execution-integration" }
>;

export type VideoWorkflowNode =
  | VideoWorkflowPromptNode
  | VideoWorkflowReferenceNode
  | VideoWorkflowGenerateNode
  | VideoWorkflowResultNode;

export interface VideoWorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

export interface VideoWorkflowGraphV1 {
  version: typeof VIDEO_WORKFLOW_GRAPH_VERSION;
  nodes: VideoWorkflowNode[];
  edges: VideoWorkflowEdge[];
}

export interface VideoWorkflowValidationResult {
  valid: boolean;
  errors: string[];
}

const ALLOWED_CONNECTIONS = new Set([
  "prompt:output>video-generate:prompt",
  "reference-image:output>video-generate:reference",
  "video-generate:video>video-result:input"
]);

const PROMPT_NODE_ID = "workflow-prompt";
const REFERENCE_NODE_ID = "workflow-reference";
const GENERATE_NODE_ID = "workflow-generate";
const RESULT_NODE_ID = "workflow-result";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinitePosition(value: unknown): value is VideoWorkflowPosition {
  return isRecord(value) &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y);
}

function isVideoWorkflowMode(value: unknown): value is VideoWorkflowMode {
  return value === "text-to-video" || value === "image-to-video";
}

function isVideoWorkflowNodeKind(value: unknown): value is VideoWorkflowNodeKind {
  return value === "prompt" ||
    value === "reference-image" ||
    value === "video-generate" ||
    value === "video-result";
}

function connectionKey(
  sourceKind: VideoWorkflowNodeKind,
  sourcePort: string,
  targetKind: VideoWorkflowNodeKind,
  targetPort: string
): string {
  return `${sourceKind}:${sourcePort}>${targetKind}:${targetPort}`;
}

function hasCycle(nodes: VideoWorkflowNode[], edges: VideoWorkflowEdge[]): boolean {
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const targetId of adjacency.get(nodeId) ?? []) {
      if (visit(targetId)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  return nodes.some((node) => visit(node.id));
}

function parseVideoWorkflowNode(
  id: string,
  kind: VideoWorkflowNodeKind,
  position: unknown,
  data: unknown,
  errors: string[]
): VideoWorkflowNode | null {
  const validPosition = isFinitePosition(position);
  if (!validPosition) {
    errors.push(`NODE_POSITION_INVALID:${id}`);
  }
  if (!isRecord(data)) {
    errors.push(`NODE_DATA_INVALID:${id}`);
    return null;
  }

  switch (kind) {
    case "prompt":
      if (typeof data.prompt !== "string") {
        errors.push(`PROMPT_DATA_INVALID:${id}`);
        return null;
      }
      return validPosition ? { id, kind, position, data: { prompt: data.prompt } } : null;
    case "reference-image":
      if (data.fileName !== null && typeof data.fileName !== "string") {
        errors.push(`REFERENCE_DATA_INVALID:${id}`);
        return null;
      }
      return validPosition ? { id, kind, position, data: { fileName: data.fileName } } : null;
    case "video-generate":
      if (
        typeof data.modelLabel !== "string" ||
        !isVideoWorkflowMode(data.mode) ||
        data.executionStatus !== "pending-integration"
      ) {
        errors.push(`GENERATE_DATA_INVALID:${id}`);
        return null;
      }
      return validPosition
        ? {
            id,
            kind,
            position,
            data: {
              modelLabel: data.modelLabel,
              mode: data.mode,
              executionStatus: data.executionStatus
            }
          }
        : null;
    case "video-result":
      if (data.status !== "waiting-for-execution-integration") {
        errors.push(`RESULT_DATA_INVALID:${id}`);
        return null;
      }
      return validPosition ? { id, kind, position, data: { status: data.status } } : null;
  }
}

export function validateVideoWorkflowGraph(graph: unknown): VideoWorkflowValidationResult {
  const errors: string[] = [];
  if (!isRecord(graph) || graph.version !== VIDEO_WORKFLOW_GRAPH_VERSION) {
    return { valid: false, errors: ["GRAPH_VERSION_INVALID"] };
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { valid: false, errors: ["GRAPH_SHAPE_INVALID"] };
  }

  const rawNodes = graph.nodes;
  const rawEdges = graph.edges;
  const nodeIds = new Set<string>();
  const kindCounts = new Map<VideoWorkflowNodeKind, number>();
  const nodes: VideoWorkflowNode[] = [];

  for (const rawNode of rawNodes) {
    if (!isRecord(rawNode) || typeof rawNode.id !== "string" || rawNode.id.length === 0) {
      errors.push("NODE_SHAPE_INVALID");
      continue;
    }
    if (!isVideoWorkflowNodeKind(rawNode.kind)) {
      errors.push(`NODE_KIND_INVALID:${rawNode.id}`);
      continue;
    }
    if (nodeIds.has(rawNode.id)) errors.push(`NODE_ID_DUPLICATE:${rawNode.id}`);
    nodeIds.add(rawNode.id);
    const kind = rawNode.kind;
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    const node = parseVideoWorkflowNode(
      rawNode.id,
      kind,
      rawNode.position,
      rawNode.data,
      errors
    );
    if (node) {
      nodes.push(node);
    }
  }

  if ((kindCounts.get("prompt") ?? 0) !== 1) errors.push("PROMPT_COUNT_INVALID");
  if ((kindCounts.get("video-generate") ?? 0) !== 1) errors.push("GENERATE_COUNT_INVALID");
  if ((kindCounts.get("video-result") ?? 0) !== 1) errors.push("RESULT_COUNT_INVALID");
  if ((kindCounts.get("reference-image") ?? 0) > 1) errors.push("REFERENCE_COUNT_INVALID");

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeIds = new Set<string>();
  const targetPorts = new Set<string>();
  const sourcePorts = new Set<string>();
  const edges: VideoWorkflowEdge[] = [];

  for (const rawEdge of rawEdges) {
    if (!isRecord(rawEdge) ||
      typeof rawEdge.id !== "string" ||
      typeof rawEdge.sourceNodeId !== "string" ||
      typeof rawEdge.sourcePort !== "string" ||
      typeof rawEdge.targetNodeId !== "string" ||
      typeof rawEdge.targetPort !== "string"
    ) {
      errors.push("EDGE_SHAPE_INVALID");
      continue;
    }
    const edge: VideoWorkflowEdge = {
      id: rawEdge.id,
      sourceNodeId: rawEdge.sourceNodeId,
      sourcePort: rawEdge.sourcePort,
      targetNodeId: rawEdge.targetNodeId,
      targetPort: rawEdge.targetPort
    };
    edges.push(edge);
    if (edgeIds.has(edge.id)) errors.push(`EDGE_ID_DUPLICATE:${edge.id}`);
    edgeIds.add(edge.id);

    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) {
      errors.push(`EDGE_NODE_MISSING:${edge.id}`);
      continue;
    }
    if (!ALLOWED_CONNECTIONS.has(connectionKey(source.kind, edge.sourcePort, target.kind, edge.targetPort))) {
      errors.push(`EDGE_PORT_INVALID:${edge.id}`);
    }

    const targetPortKey = `${edge.targetNodeId}:${edge.targetPort}`;
    if (targetPorts.has(targetPortKey)) errors.push(`TARGET_PORT_OCCUPIED:${targetPortKey}`);
    targetPorts.add(targetPortKey);

    const sourcePortKey = `${edge.sourceNodeId}:${edge.sourcePort}`;
    if (sourcePorts.has(sourcePortKey)) errors.push(`BRANCHING_NOT_ALLOWED:${sourcePortKey}`);
    sourcePorts.add(sourcePortKey);
  }

  if (hasCycle(nodes, edges)) errors.push("CYCLE_NOT_ALLOWED");

  const generateNode = nodes.find((node): node is VideoWorkflowGenerateNode => node.kind === "video-generate");
  const hasReference = (kindCounts.get("reference-image") ?? 0) === 1;
  if (generateNode) {
    if (generateNode.data.mode === "image-to-video" && !hasReference) {
      errors.push("I2V_REFERENCE_REQUIRED");
    }
    if (generateNode.data.mode === "text-to-video" && hasReference) {
      errors.push("T2V_REFERENCE_NOT_ALLOWED");
    }
  }

  const requiredConnections = [
    "prompt:output>video-generate:prompt",
    "video-generate:video>video-result:input",
    ...(hasReference ? ["reference-image:output>video-generate:reference"] : [])
  ];
  const presentConnections = new Set(edges.flatMap((edge) => {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    return source && target
      ? [connectionKey(source.kind, edge.sourcePort, target.kind, edge.targetPort)]
      : [];
  }));
  for (const requiredConnection of requiredConnections) {
    if (!presentConnections.has(requiredConnection)) {
      errors.push(`REQUIRED_EDGE_MISSING:${requiredConnection}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function promptNode(prompt: string): VideoWorkflowPromptNode {
  return {
    id: PROMPT_NODE_ID,
    kind: "prompt",
    position: { x: 0, y: 110 },
    data: { prompt }
  };
}

function referenceNode(): VideoWorkflowReferenceNode {
  return {
    id: REFERENCE_NODE_ID,
    kind: "reference-image",
    position: { x: 0, y: 300 },
    data: { fileName: null }
  };
}

function generateNode(mode: VideoWorkflowMode, modelLabel: string): VideoWorkflowGenerateNode {
  return {
    id: GENERATE_NODE_ID,
    kind: "video-generate",
    position: { x: 360, y: 150 },
    data: { modelLabel, mode, executionStatus: "pending-integration" }
  };
}

function resultNode(): VideoWorkflowResultNode {
  return {
    id: RESULT_NODE_ID,
    kind: "video-result",
    position: { x: 720, y: 150 },
    data: { status: "waiting-for-execution-integration" }
  };
}

function edge(
  id: string,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string
): VideoWorkflowEdge {
  return { id, sourceNodeId, sourcePort, targetNodeId, targetPort };
}

export function createVideoWorkflowGraph(
  mode: VideoWorkflowMode,
  modelLabel: string,
  prompt = ""
): VideoWorkflowGraphV1 {
  const nodes: VideoWorkflowNode[] = [
    promptNode(prompt),
    ...(mode === "image-to-video" ? [referenceNode()] : []),
    generateNode(mode, modelLabel),
    resultNode()
  ];
  const edges = [
    edge("edge-prompt-generate", PROMPT_NODE_ID, "output", GENERATE_NODE_ID, "prompt"),
    ...(mode === "image-to-video"
      ? [edge("edge-reference-generate", REFERENCE_NODE_ID, "output", GENERATE_NODE_ID, "reference")]
      : []),
    edge("edge-generate-result", GENERATE_NODE_ID, "video", RESULT_NODE_ID, "input")
  ];
  return { version: VIDEO_WORKFLOW_GRAPH_VERSION, nodes, edges };
}

export function setVideoWorkflowMode(
  graph: VideoWorkflowGraphV1,
  mode: VideoWorkflowMode
): VideoWorkflowGraphV1 {
  const hasReference = graph.nodes.some((node) => node.kind === "reference-image");
  const nodes = graph.nodes
    .filter((node) => mode === "image-to-video" || node.kind !== "reference-image")
    .map((node) => node.kind === "video-generate"
      ? { ...node, data: { ...node.data, mode } }
      : node);
  if (mode === "image-to-video" && !hasReference) {
    nodes.splice(Math.max(1, nodes.findIndex((node) => node.kind === "video-generate")), 0, referenceNode());
  }

  const edges = graph.edges.filter((candidate) =>
    candidate.sourceNodeId !== REFERENCE_NODE_ID && candidate.targetNodeId !== REFERENCE_NODE_ID
  );
  if (mode === "image-to-video") {
    const resultEdgeIndex = edges.findIndex((candidate) => candidate.targetNodeId === RESULT_NODE_ID);
    edges.splice(resultEdgeIndex < 0 ? edges.length : resultEdgeIndex, 0,
      edge("edge-reference-generate", REFERENCE_NODE_ID, "output", GENERATE_NODE_ID, "reference"));
  }

  return { ...graph, nodes, edges };
}

export function updateVideoWorkflowNodePosition(
  graph: VideoWorkflowGraphV1,
  nodeId: string,
  position: VideoWorkflowPosition
): VideoWorkflowGraphV1 {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === nodeId ? { ...node, position } : node)
  };
}

export function updateVideoWorkflowPrompt(
  graph: VideoWorkflowGraphV1,
  prompt: string
): VideoWorkflowGraphV1 {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.kind === "prompt"
      ? { ...node, data: { ...node.data, prompt } }
      : node)
  };
}

export function updateVideoWorkflowReferenceFileName(
  graph: VideoWorkflowGraphV1,
  fileName: string | null
): VideoWorkflowGraphV1 {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.kind === "reference-image"
      ? { ...node, data: { ...node.data, fileName } }
      : node)
  };
}

export function updateVideoWorkflowModelLabel(
  graph: VideoWorkflowGraphV1,
  modelLabel: string
): VideoWorkflowGraphV1 {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.kind === "video-generate"
      ? { ...node, data: { ...node.data, modelLabel } }
      : node)
  };
}

export function canConnectVideoWorkflowEdge(
  graph: VideoWorkflowGraphV1,
  candidate: Omit<VideoWorkflowEdge, "id">,
  replacingEdgeId?: string
): boolean {
  const source = graph.nodes.find((node) => node.id === candidate.sourceNodeId);
  const target = graph.nodes.find((node) => node.id === candidate.targetNodeId);
  if (!source || !target || source.id === target.id) return false;
  if (!ALLOWED_CONNECTIONS.has(connectionKey(source.kind, candidate.sourcePort, target.kind, candidate.targetPort))) {
    return false;
  }

  const retainedEdges = graph.edges.filter((existing) => existing.id !== replacingEdgeId);
  if (retainedEdges.some((existing) =>
    existing.targetNodeId === candidate.targetNodeId && existing.targetPort === candidate.targetPort
  )) return false;
  if (retainedEdges.some((existing) =>
    existing.sourceNodeId === candidate.sourceNodeId && existing.sourcePort === candidate.sourcePort
  )) return false;

  return !hasCycle(graph.nodes, [
    ...retainedEdges,
    { id: "candidate", ...candidate }
  ]);
}

export function connectVideoWorkflowEdge(
  graph: VideoWorkflowGraphV1,
  candidate: Omit<VideoWorkflowEdge, "id">
): VideoWorkflowGraphV1 {
  if (!canConnectVideoWorkflowEdge(graph, candidate)) return graph;
  return {
    ...graph,
    edges: [
      ...graph.edges,
      {
        id: `edge-${candidate.sourceNodeId}-${candidate.sourcePort}-${candidate.targetNodeId}-${candidate.targetPort}`,
        ...candidate
      }
    ]
  };
}

export function reconnectVideoWorkflowEdge(
  graph: VideoWorkflowGraphV1,
  edgeId: string,
  candidate: Omit<VideoWorkflowEdge, "id">
): VideoWorkflowGraphV1 {
  if (!graph.edges.some((existing) => existing.id === edgeId) ||
    !canConnectVideoWorkflowEdge(graph, candidate, edgeId)
  ) return graph;
  return {
    ...graph,
    edges: graph.edges.map((existing) => existing.id === edgeId
      ? { id: edgeId, ...candidate }
      : existing)
  };
}

export function removeVideoWorkflowEdges(
  graph: VideoWorkflowGraphV1,
  edgeIds: ReadonlySet<string>
): VideoWorkflowGraphV1 {
  return {
    ...graph,
    edges: graph.edges.filter((candidate) => !edgeIds.has(candidate.id))
  };
}
