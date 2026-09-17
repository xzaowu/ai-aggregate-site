import { describe, expect, it } from "vitest";
import {
  createVideoWorkflowGraph,
  setVideoWorkflowMode,
  validateVideoWorkflowGraph,
  type VideoWorkflowGraphV1
} from "./video-workflow-graph";

function cloneGraph(graph: VideoWorkflowGraphV1): VideoWorkflowGraphV1 {
  return structuredClone(graph);
}

describe("VideoWorkflowGraphV1", () => {
  it("accepts the bounded T2V graph", () => {
    const graph = createVideoWorkflowGraph("text-to-video", "Seedance", "A calm ocean");

    expect(graph.version).toBe(1);
    expect(graph.nodes.map((node) => node.kind)).toEqual([
      "prompt",
      "video-generate",
      "video-result"
    ]);
    expect(validateVideoWorkflowGraph(graph)).toEqual({ valid: true, errors: [] });
  });

  it("accepts the bounded one-reference I2V graph", () => {
    const graph = createVideoWorkflowGraph("image-to-video", "Seedance");

    expect(graph.nodes.map((node) => node.kind)).toEqual([
      "prompt",
      "reference-image",
      "video-generate",
      "video-result"
    ]);
    expect(validateVideoWorkflowGraph(graph)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a cycle", () => {
    const graph = cloneGraph(createVideoWorkflowGraph("text-to-video", "Seedance"));
    graph.edges.push({
      id: "edge-result-prompt-cycle",
      sourceNodeId: "workflow-result",
      sourcePort: "output",
      targetNodeId: "workflow-prompt",
      targetPort: "input"
    });

    expect(validateVideoWorkflowGraph(graph).errors).toContain("CYCLE_NOT_ALLOWED");
  });

  it("rejects an unknown node kind", () => {
    const graph = cloneGraph(createVideoWorkflowGraph("text-to-video", "Seedance"));
    (graph.nodes[0] as unknown as { kind: string }).kind = "arbitrary-script";

    expect(validateVideoWorkflowGraph(graph).errors).toContain("NODE_KIND_INVALID:workflow-prompt");
  });

  it("rejects a Generate node with missing data without throwing", () => {
    const graph = createVideoWorkflowGraph("text-to-video", "Seedance");
    const malformedGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.kind === "video-generate"
        ? { id: node.id, kind: node.kind, position: node.position }
        : node)
    };

    expect(() => validateVideoWorkflowGraph(malformedGraph)).not.toThrow();
    const result = validateVideoWorkflowGraph(malformedGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("NODE_DATA_INVALID:workflow-generate");
  });

  it("rejects a Generate node with null data without throwing", () => {
    const graph = createVideoWorkflowGraph("text-to-video", "Seedance");
    const malformedGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.kind === "video-generate"
        ? { ...node, data: null }
        : node)
    };

    expect(() => validateVideoWorkflowGraph(malformedGraph)).not.toThrow();
    const result = validateVideoWorkflowGraph(malformedGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("NODE_DATA_INVALID:workflow-generate");
  });

  it("rejects malformed Prompt data without throwing", () => {
    const graph = createVideoWorkflowGraph("text-to-video", "Seedance");
    const malformedGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.kind === "prompt"
        ? { ...node, data: { prompt: 42 } }
        : node)
    };

    expect(() => validateVideoWorkflowGraph(malformedGraph)).not.toThrow();
    const result = validateVideoWorkflowGraph(malformedGraph);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("PROMPT_DATA_INVALID:workflow-prompt");
  });

  it("rejects duplicate Generate nodes", () => {
    const graph = cloneGraph(createVideoWorkflowGraph("text-to-video", "Seedance"));
    const generate = graph.nodes.find((node) => node.kind === "video-generate");
    if (!generate) throw new Error("GENERATE_NODE_MISSING");
    graph.nodes.push({ ...generate, id: "workflow-generate-duplicate" });

    expect(validateVideoWorkflowGraph(graph).errors).toContain("GENERATE_COUNT_INVALID");
  });

  it("rejects duplicate Result nodes", () => {
    const graph = cloneGraph(createVideoWorkflowGraph("text-to-video", "Seedance"));
    const result = graph.nodes.find((node) => node.kind === "video-result");
    if (!result) throw new Error("RESULT_NODE_MISSING");
    graph.nodes.push({ ...result, id: "workflow-result-duplicate" });

    expect(validateVideoWorkflowGraph(graph).errors).toContain("RESULT_COUNT_INVALID");
  });

  it("rejects illegal typed ports", () => {
    const graph = cloneGraph(createVideoWorkflowGraph("text-to-video", "Seedance"));
    const promptEdge = graph.edges.find((edge) => edge.id === "edge-prompt-generate");
    if (!promptEdge) throw new Error("PROMPT_EDGE_MISSING");
    promptEdge.targetPort = "reference";

    expect(validateVideoWorkflowGraph(graph).errors).toContain("EDGE_PORT_INVALID:edge-prompt-generate");
  });

  it("rejects more than one incoming edge for a target port", () => {
    const graph = cloneGraph(createVideoWorkflowGraph("text-to-video", "Seedance"));
    graph.edges.push({
      id: "edge-prompt-generate-duplicate",
      sourceNodeId: "workflow-prompt",
      sourcePort: "output",
      targetNodeId: "workflow-generate",
      targetPort: "prompt"
    });

    expect(validateVideoWorkflowGraph(graph).errors).toContain(
      "TARGET_PORT_OCCUPIED:workflow-generate:prompt"
    );
  });

  it("removes the reference node and edge when returning to T2V", () => {
    const i2v = createVideoWorkflowGraph("image-to-video", "Seedance");
    const t2v = setVideoWorkflowMode(i2v, "text-to-video");

    expect(t2v.nodes.some((node) => node.kind === "reference-image")).toBe(false);
    expect(t2v.edges.some((edge) => edge.sourceNodeId === "workflow-reference")).toBe(false);
    expect(validateVideoWorkflowGraph(t2v)).toEqual({ valid: true, errors: [] });
  });
});
