export const CREATOR_CANVAS_DOCUMENT_VERSION = 1 as const;
/** Matches the production Canvas renderer's established zoom contract. */
export const CREATOR_CANVAS_MIN_ZOOM = 0.25;
export const CREATOR_CANVAS_MAX_ZOOM = 2;

export type CreatorContentNodeKind = "text" | "image" | "video";
export type CreatorCanvasRelationship = "reference";

export interface CreatorCanvasPosition {
  x: number;
  y: number;
}

export interface CreatorCanvasViewport extends CreatorCanvasPosition {
  zoom: number;
}

interface CreatorContentNodeBase<
  Kind extends CreatorContentNodeKind,
  Data extends Record<string, unknown>
> {
  id: string;
  kind: Kind;
  position: CreatorCanvasPosition;
  data: Data;
}

export interface CreatorTextAiConfig {
  instruction: string;
  modelId: string;
}

export type CreatorTextNode = CreatorContentNodeBase<
  "text",
  { text: string; ai?: CreatorTextAiConfig }
>;
export type CreatorImageNode = CreatorContentNodeBase<"image", { assetId: string | null }>;
export type CreatorVideoNode = CreatorContentNodeBase<"video", { assetId: string | null }>;

export type CreatorContentNode =
  | CreatorTextNode
  | CreatorImageNode
  | CreatorVideoNode;

export interface CreatorCanvasEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: CreatorCanvasRelationship;
}

export type CreatorCanvasConnection = Omit<CreatorCanvasEdge, "id">;

export interface CreatorCanvasDocumentV1 {
  version: typeof CREATOR_CANVAS_DOCUMENT_VERSION;
  nodes: CreatorContentNode[];
  edges: CreatorCanvasEdge[];
  viewport: CreatorCanvasViewport;
}

export const CREATOR_CANVAS_REFERENCE_COMPATIBILITY = Object.freeze({
  text: Object.freeze(["text", "image", "video"] as const),
  image: Object.freeze(["image", "video"] as const),
  video: Object.freeze(["video"] as const)
}) satisfies Readonly<Record<CreatorContentNodeKind, readonly CreatorContentNodeKind[]>>;

export type CreatorCanvasDocumentParseResult =
  | { ok: true; document: CreatorCanvasDocumentV1 }
  | { ok: false; errors: string[] };

export interface CreatorCanvasConnectionValidationResult {
  valid: boolean;
  errors: string[];
}

export type CreatorCanvasDocumentCommandResult =
  | { ok: true; document: CreatorCanvasDocumentV1 }
  | { ok: false; document: CreatorCanvasDocumentV1; errors: string[] };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key) => typeof key !== "string")) {
    return false;
  }
  const expected = new Set(expectedKeys);
  return actualKeys.every((key) => typeof key === "string" && expected.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCreatorContentNodeKind(value: unknown): value is CreatorContentNodeKind {
  return value === "text" || value === "image" || value === "video";
}

function isCreatorCanvasRelationship(value: unknown): value is CreatorCanvasRelationship {
  return value === "reference";
}

function parsePosition(
  value: unknown,
  errorPrefix: string,
  errors: string[]
): CreatorCanvasPosition | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["x", "y"])) {
    errors.push(`${errorPrefix}_SHAPE_INVALID`);
    return null;
  }
  if (typeof value.x !== "number" || !Number.isFinite(value.x)) {
    errors.push(`${errorPrefix}_X_INVALID`);
  }
  if (typeof value.y !== "number" || !Number.isFinite(value.y)) {
    errors.push(`${errorPrefix}_Y_INVALID`);
  }
  return typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y)
    ? { x: value.x, y: value.y }
    : null;
}

function parseViewport(value: unknown, errors: string[]): CreatorCanvasViewport | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["x", "y", "zoom"])) {
    errors.push("VIEWPORT_SHAPE_INVALID");
    return null;
  }
  if (typeof value.x !== "number" || !Number.isFinite(value.x)) {
    errors.push("VIEWPORT_X_INVALID");
  }
  if (typeof value.y !== "number" || !Number.isFinite(value.y)) {
    errors.push("VIEWPORT_Y_INVALID");
  }
  if (
    typeof value.zoom !== "number" ||
    !Number.isFinite(value.zoom) ||
    value.zoom < CREATOR_CANVAS_MIN_ZOOM ||
    value.zoom > CREATOR_CANVAS_MAX_ZOOM
  ) {
    errors.push("VIEWPORT_ZOOM_INVALID");
  }
  return typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y) &&
    typeof value.zoom === "number" && Number.isFinite(value.zoom) &&
    value.zoom >= CREATOR_CANVAS_MIN_ZOOM && value.zoom <= CREATOR_CANVAS_MAX_ZOOM
    ? { x: value.x, y: value.y, zoom: value.zoom }
    : null;
}

function parseAssetData(
  id: string,
  kind: "image" | "video",
  value: unknown,
  errors: string[]
): { assetId: string | null } | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["assetId"]) ||
    (value.assetId !== null && !isNonEmptyString(value.assetId))
  ) {
    errors.push(`${kind.toUpperCase()}_DATA_INVALID:${id}`);
    return null;
  }
  return { assetId: value.assetId };
}

function parseNode(
  value: unknown,
  index: number,
  errors: string[]
): CreatorContentNode | null {
  if (!isPlainRecord(value)) {
    errors.push(`NODE_SHAPE_INVALID:${index}`);
    return null;
  }
  const id = isNonEmptyString(value.id) ? value.id : null;
  const errorId = id ?? String(index);
  if (!hasExactKeys(value, ["id", "kind", "position", "data"])) {
    errors.push(`NODE_KEYS_INVALID:${errorId}`);
  }
  if (!id) errors.push(`NODE_ID_INVALID:${index}`);
  if (!isCreatorContentNodeKind(value.kind)) {
    errors.push(`NODE_KIND_INVALID:${errorId}`);
    return null;
  }
  const position = parsePosition(value.position, `NODE_POSITION_INVALID:${errorId}`, errors);
  if (!id || !position) return null;

  if (value.kind === "text") {
    if (
      !isPlainRecord(value.data) ||
      !(hasExactKeys(value.data, ["text"]) || hasExactKeys(value.data, ["text", "ai"])) ||
      typeof value.data.text !== "string"
    ) {
      errors.push(`TEXT_DATA_INVALID:${id}`);
      return null;
    }
    if ("ai" in value.data && (
      !isPlainRecord(value.data.ai) ||
      !hasExactKeys(value.data.ai, ["instruction", "modelId"]) ||
      typeof value.data.ai.instruction !== "string" ||
      typeof value.data.ai.modelId !== "string"
    )) {
      errors.push(`TEXT_AI_DATA_INVALID:${id}`);
      return null;
    }
    return {
      id,
      kind: value.kind,
      position,
      data: {
        text: value.data.text,
        ...(isPlainRecord(value.data.ai)
          ? {
              ai: {
                instruction: value.data.ai.instruction as string,
                modelId: value.data.ai.modelId as string
              }
            }
          : {})
      }
    };
  }

  const data = parseAssetData(id, value.kind, value.data, errors);
  return data ? { id, kind: value.kind, position, data } : null;
}

function parseEdge(value: unknown, index: number, errors: string[]): CreatorCanvasEdge | null {
  if (!isPlainRecord(value)) {
    errors.push(`EDGE_SHAPE_INVALID:${index}`);
    return null;
  }
  const id = isNonEmptyString(value.id) ? value.id : null;
  const errorId = id ?? String(index);
  if (!hasExactKeys(value, ["id", "sourceNodeId", "targetNodeId", "relationship"])) {
    errors.push(`EDGE_KEYS_INVALID:${errorId}`);
  }
  if (!id) errors.push(`EDGE_ID_INVALID:${index}`);
  if (!isNonEmptyString(value.sourceNodeId)) errors.push(`EDGE_SOURCE_NODE_INVALID:${errorId}`);
  if (!isNonEmptyString(value.targetNodeId)) errors.push(`EDGE_TARGET_NODE_INVALID:${errorId}`);
  if (!isCreatorCanvasRelationship(value.relationship)) {
    errors.push(`EDGE_RELATIONSHIP_INVALID:${errorId}`);
  }

  return id && isNonEmptyString(value.sourceNodeId) &&
    isNonEmptyString(value.targetNodeId) && isCreatorCanvasRelationship(value.relationship)
    ? {
        id,
        sourceNodeId: value.sourceNodeId,
        targetNodeId: value.targetNodeId,
        relationship: value.relationship
      }
    : null;
}

function endpointRelationshipKey(edge: CreatorCanvasConnection): string {
  return JSON.stringify([edge.sourceNodeId, edge.targetNodeId, edge.relationship]);
}

function hasCycle(
  nodeIds: Iterable<string>,
  edges: readonly CreatorCanvasConnection[]
): boolean {
  const adjacency = new Map(Array.from(nodeIds, (nodeId) => [nodeId, new Array<string>()]));
  for (const edge of edges) {
    if (adjacency.has(edge.sourceNodeId) && adjacency.has(edge.targetNodeId)) {
      adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const targetNodeId of adjacency.get(nodeId) ?? []) {
      if (visit(targetNodeId)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return Array.from(adjacency.keys()).some(visit);
}

export function isCreatorCanvasReferenceCompatible(
  sourceKind: CreatorContentNodeKind,
  targetKind: CreatorContentNodeKind
): boolean {
  return CREATOR_CANVAS_REFERENCE_COMPATIBILITY[sourceKind].some(
    (compatibleKind) => compatibleKind === targetKind
  );
}

function validateEdges(
  nodes: readonly CreatorContentNode[],
  edges: readonly CreatorCanvasEdge[],
  errors: string[]
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const endpointRelationships = new Set<string>();

  for (const edge of edges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) {
      errors.push(`EDGE_NODE_MISSING:${edge.id}`);
      continue;
    }
    if (source.id === target.id) errors.push(`SELF_EDGE_NOT_ALLOWED:${edge.id}`);
    if (!isCreatorCanvasReferenceCompatible(source.kind, target.kind)) {
      errors.push(`EDGE_CONNECTION_INVALID:${edge.id}`);
    }

    const key = endpointRelationshipKey(edge);
    if (endpointRelationships.has(key)) {
      errors.push(`EDGE_RELATIONSHIP_DUPLICATE:${edge.id}`);
    }
    endpointRelationships.add(key);
  }

  if (hasCycle(nodeById.keys(), edges)) errors.push("CYCLE_NOT_ALLOWED");
}

export function parseCreatorCanvasDocument(value: unknown): CreatorCanvasDocumentParseResult {
  if (!isPlainRecord(value)) return { ok: false, errors: ["DOCUMENT_SHAPE_INVALID"] };

  const errors: string[] = [];
  if (!hasExactKeys(value, ["version", "nodes", "edges", "viewport"])) {
    errors.push("DOCUMENT_KEYS_INVALID");
  }
  if (value.version !== CREATOR_CANVAS_DOCUMENT_VERSION) {
    errors.push("DOCUMENT_VERSION_INVALID");
  }
  if (!Array.isArray(value.nodes)) errors.push("DOCUMENT_NODES_INVALID");
  if (!Array.isArray(value.edges)) errors.push("DOCUMENT_EDGES_INVALID");
  const viewport = parseViewport(value.viewport, errors);

  const nodes: CreatorContentNode[] = [];
  const nodeIds = new Set<string>();
  if (Array.isArray(value.nodes)) {
    for (let index = 0; index < value.nodes.length; index += 1) {
      const node = parseNode(value.nodes[index], index, errors);
      if (!node) continue;
      if (nodeIds.has(node.id)) errors.push(`NODE_ID_DUPLICATE:${node.id}`);
      nodeIds.add(node.id);
      nodes.push(node);
    }
  }

  const edges: CreatorCanvasEdge[] = [];
  const edgeIds = new Set<string>();
  if (Array.isArray(value.edges)) {
    for (let index = 0; index < value.edges.length; index += 1) {
      const edge = parseEdge(value.edges[index], index, errors);
      if (!edge) continue;
      if (edgeIds.has(edge.id)) errors.push(`EDGE_ID_DUPLICATE:${edge.id}`);
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  }
  validateEdges(nodes, edges, errors);

  if (errors.length > 0 || !viewport) return { ok: false, errors };
  return {
    ok: true,
    document: {
      version: CREATOR_CANVAS_DOCUMENT_VERSION,
      nodes,
      edges,
      viewport
    }
  };
}

function validateConnectionCandidate(
  document: CreatorCanvasDocumentV1,
  candidate: CreatorCanvasConnection,
  replacingEdgeId?: string
): CreatorCanvasConnectionValidationResult {
  const errors: string[] = [];
  const source = document.nodes.find((node) => node.id === candidate.sourceNodeId);
  const target = document.nodes.find((node) => node.id === candidate.targetNodeId);
  if (!source || !target) return { valid: false, errors: ["CONNECTION_NODE_MISSING"] };
  if (source.id === target.id) errors.push("SELF_EDGE_NOT_ALLOWED");
  if (
    candidate.relationship !== "reference" ||
    !isCreatorCanvasReferenceCompatible(source.kind, target.kind)
  ) {
    errors.push("CONNECTION_INVALID");
  }

  const retainedEdges = document.edges.filter((edge) => edge.id !== replacingEdgeId);
  const exactKey = endpointRelationshipKey(candidate);
  if (retainedEdges.some((edge) => endpointRelationshipKey(edge) === exactKey)) {
    errors.push("EDGE_RELATIONSHIP_DUPLICATE");
  }
  if (hasCycle(document.nodes.map((node) => node.id), [...retainedEdges, candidate])) {
    errors.push("CYCLE_NOT_ALLOWED");
  }
  return { valid: errors.length === 0, errors };
}

export function canConnectCreatorCanvasNodes(
  document: CreatorCanvasDocumentV1,
  candidate: CreatorCanvasConnection
): CreatorCanvasConnectionValidationResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { valid: false, errors: parsed.errors };
  return validateConnectionCandidate(parsed.document, candidate);
}

export function connectCreatorCanvasNodes(
  document: CreatorCanvasDocumentV1,
  edge: CreatorCanvasEdge
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { ok: false, document, errors: parsed.errors };
  if (!isNonEmptyString(edge.id)) return { ok: false, document, errors: ["EDGE_ID_INVALID"] };
  if (parsed.document.edges.some((existing) => existing.id === edge.id)) {
    return { ok: false, document, errors: [`EDGE_ID_DUPLICATE:${edge.id}`] };
  }
  const validation = validateConnectionCandidate(parsed.document, edge);
  if (!validation.valid) return { ok: false, document, errors: validation.errors };
  return {
    ok: true,
    document: { ...parsed.document, edges: [...parsed.document.edges, edge] }
  };
}

export function reconnectCreatorCanvasEdge(
  document: CreatorCanvasDocumentV1,
  edgeId: string,
  candidate: CreatorCanvasConnection
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { ok: false, document, errors: parsed.errors };
  if (!parsed.document.edges.some((edge) => edge.id === edgeId)) {
    return { ok: false, document, errors: [`EDGE_NOT_FOUND:${edgeId}`] };
  }
  const validation = validateConnectionCandidate(parsed.document, candidate, edgeId);
  if (!validation.valid) return { ok: false, document, errors: validation.errors };
  return {
    ok: true,
    document: {
      ...parsed.document,
      edges: parsed.document.edges.map((edge) =>
        edge.id === edgeId ? { id: edgeId, ...candidate } : edge
      )
    }
  };
}

export function removeCreatorCanvasNode(
  document: CreatorCanvasDocumentV1,
  nodeId: string
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { ok: false, document, errors: parsed.errors };
  if (!parsed.document.nodes.some((node) => node.id === nodeId)) {
    return { ok: false, document, errors: [`NODE_NOT_FOUND:${nodeId}`] };
  }
  return {
    ok: true,
    document: {
      ...parsed.document,
      nodes: parsed.document.nodes.filter((node) => node.id !== nodeId),
      edges: parsed.document.edges.filter((edge) =>
        edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId
      )
    }
  };
}

export function removeCreatorCanvasEdge(
  document: CreatorCanvasDocumentV1,
  edgeId: string
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { ok: false, document, errors: parsed.errors };
  if (!parsed.document.edges.some((edge) => edge.id === edgeId)) {
    return { ok: false, document, errors: [`EDGE_NOT_FOUND:${edgeId}`] };
  }
  return {
    ok: true,
    document: {
      ...parsed.document,
      edges: parsed.document.edges.filter((edge) => edge.id !== edgeId)
    }
  };
}

export function updateCreatorCanvasNodePosition(
  document: CreatorCanvasDocumentV1,
  nodeId: string,
  position: CreatorCanvasPosition
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { ok: false, document, errors: parsed.errors };
  if (!parsed.document.nodes.some((node) => node.id === nodeId)) {
    return { ok: false, document, errors: [`NODE_NOT_FOUND:${nodeId}`] };
  }
  const next = parseCreatorCanvasDocument({
    ...parsed.document,
    nodes: parsed.document.nodes.map((node) =>
      node.id === nodeId ? { ...node, position } : node
    )
  });
  return next.ok
    ? { ok: true, document: next.document }
    : { ok: false, document, errors: next.errors };
}

export function updateCreatorCanvasText(
  document: CreatorCanvasDocumentV1,
  nodeId: string,
  text: string
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { ok: false, document, errors: parsed.errors };
  const node = parsed.document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { ok: false, document, errors: [`NODE_NOT_FOUND:${nodeId}`] };
  if (node.kind !== "text") {
    return { ok: false, document, errors: [`NODE_KIND_INVALID_FOR_TEXT:${nodeId}`] };
  }
  return {
    ok: true,
    document: {
      ...parsed.document,
      nodes: parsed.document.nodes.map((candidate) =>
        candidate.id === nodeId ? { ...node, data: { ...node.data, text } } : candidate
      )
    }
  };
}

export function bindCreatorCanvasImageAsset(
  document: CreatorCanvasDocumentV1,
  targetNodeId: string,
  assetId: string
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { ok: false, document, errors: parsed.errors };

  const target = parsed.document.nodes.find((node) => node.id === targetNodeId);
  if (!target) {
    return { ok: false, document, errors: [`NODE_NOT_FOUND:${targetNodeId}`] };
  }
  if (target.kind !== "image") {
    return {
      ok: false,
      document,
      errors: [`NODE_KIND_INVALID_FOR_IMAGE_BIND:${targetNodeId}`]
    };
  }
  if (target.data.assetId !== null) {
    return { ok: false, document, errors: [`IMAGE_ALREADY_BOUND:${targetNodeId}`] };
  }

  const normalizedAssetId = typeof assetId === "string" ? assetId.trim() : "";
  if (!normalizedAssetId) {
    return { ok: false, document, errors: ["ASSET_ID_INVALID"] };
  }

  return {
    ok: true,
    document: {
      ...parsed.document,
      nodes: parsed.document.nodes.map((node) =>
        node.id === targetNodeId && node.kind === "image"
          ? { ...node, data: { assetId: normalizedAssetId } }
          : node
      )
    }
  };
}

export function replaceCreatorCanvasImageAsset(
  document: CreatorCanvasDocumentV1,
  targetNodeId: string,
  expectedCurrentAssetId: string,
  replacementAssetId: string
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument(document);
  if (!parsed.ok) return { ok: false, document, errors: parsed.errors };

  const target = parsed.document.nodes.find((node) => node.id === targetNodeId);
  if (!target) {
    return { ok: false, document, errors: [`NODE_NOT_FOUND:${targetNodeId}`] };
  }
  if (target.kind !== "image") {
    return {
      ok: false,
      document,
      errors: [`NODE_KIND_INVALID_FOR_IMAGE_REPLACE:${targetNodeId}`]
    };
  }
  if (target.data.assetId === null) {
    return { ok: false, document, errors: [`IMAGE_NOT_BOUND_FOR_REPLACE:${targetNodeId}`] };
  }

  const normalizedExpectedCurrentAssetId = typeof expectedCurrentAssetId === "string"
    ? expectedCurrentAssetId.trim()
    : "";
  if (!normalizedExpectedCurrentAssetId) {
    return { ok: false, document, errors: ["EXPECTED_CURRENT_ASSET_ID_INVALID"] };
  }

  const normalizedReplacementAssetId = typeof replacementAssetId === "string"
    ? replacementAssetId.trim()
    : "";
  if (!normalizedReplacementAssetId) {
    return { ok: false, document, errors: ["REPLACEMENT_ASSET_ID_INVALID"] };
  }
  if (target.data.assetId !== normalizedExpectedCurrentAssetId) {
    return {
      ok: false,
      document,
      errors: [`IMAGE_CURRENT_ASSET_MISMATCH:${targetNodeId}`]
    };
  }
  if (normalizedReplacementAssetId === target.data.assetId) {
    return {
      ok: false,
      document,
      errors: [`IMAGE_REPLACEMENT_SAME_AS_CURRENT:${targetNodeId}`]
    };
  }

  return {
    ok: true,
    document: {
      ...parsed.document,
      nodes: parsed.document.nodes.map((node) =>
        node.id === targetNodeId && node.kind === "image"
          ? { ...node, data: { assetId: normalizedReplacementAssetId } }
          : node
      )
    }
  };
}

export function updateCreatorCanvasViewport(
  document: CreatorCanvasDocumentV1,
  viewport: CreatorCanvasViewport
): CreatorCanvasDocumentCommandResult {
  const parsed = parseCreatorCanvasDocument({ ...document, viewport });
  return parsed.ok
    ? { ok: true, document: parsed.document }
    : { ok: false, document, errors: parsed.errors };
}

export function createInitialCreatorCanvasDocument(): CreatorCanvasDocumentV1 {
  return {
    version: CREATOR_CANVAS_DOCUMENT_VERSION,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}
