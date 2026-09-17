import { describe, expect, it } from "vitest";
import type {
  CreatorCanvasDocumentV1,
  CreatorCanvasPosition,
  CreatorContentNode
} from "./creator-canvas-document";
import { applyCreatorImageResults } from "./creator-image-result-application";

function createDocument(targetAssetId: string | null): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "text-source",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "Reference" }
      },
      {
        id: "image-source",
        kind: "image",
        position: { x: 0, y: 180 },
        data: { assetId: "source-asset" }
      },
      {
        id: "image-target",
        kind: "image",
        position: { x: 400, y: 120 },
        data: { assetId: targetAssetId }
      }
    ],
    edges: [
      {
        id: "edge-text",
        sourceNodeId: "text-source",
        targetNodeId: "image-target",
        relationship: "reference"
      },
      {
        id: "edge-image",
        sourceNodeId: "image-source",
        targetNodeId: "image-target",
        relationship: "reference"
      }
    ],
    viewport: { x: -20, y: 35, zoom: 1.25 }
  };
}

function apply(
  document: CreatorCanvasDocumentV1,
  orderedAssetIds: readonly string[],
  targetNodeId = "image-target",
  suppliedPositions?: readonly CreatorCanvasPosition[]
) {
  const validAssetCount = orderedAssetIds.filter((assetId) => assetId.trim()).length;
  const target = document.nodes.find((node) => node.id === targetNodeId);
  const siblingCount = target?.kind === "image" && target.data.assetId === null
    ? Math.max(0, validAssetCount - 1)
    : validAssetCount;
  let sequence = 0;
  return applyCreatorImageResults({
    document,
    targetNodeId,
    orderedAssetIds,
    siblingPositions: suppliedPositions ?? Array.from(
      { length: siblingCount },
      (_, index) => ({ x: 900 + index * 400, y: 700 + index * 400 })
    ),
    createNodeId: () => `generated-${++sequence}`
  });
}

function imageNodes(document: CreatorCanvasDocumentV1) {
  return document.nodes.filter((node) => node.kind === "image");
}

describe("applyCreatorImageResults", () => {
  it("binds one result to an EMPTY target without creating a sibling", () => {
    const document = createDocument(null);
    const result = apply(document, ["asset-a"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.find((node) => node.id === "image-target"))
      .toMatchObject({ data: { assetId: "asset-a" } });
    expect(result.document.nodes.find((node) => node.id === "image-target")?.position)
      .toEqual({ x: 400, y: 120 });
    expect(result.createdNodeIds).toEqual([]);
    expect(result.document.edges).toEqual(document.edges);
    expect(result.document.viewport).toEqual(document.viewport);
  });

  it("binds the first EMPTY result and creates ordered siblings for the rest", () => {
    const result = apply(createDocument(null), ["asset-a", "asset-b", "asset-c", "asset-d"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(imageNodes(result.document).map((node) => node.data.assetId)).toEqual([
      "source-asset",
      "asset-a",
      "asset-b",
      "asset-c",
      "asset-d"
    ]);
    expect(result.createdNodeIds).toEqual(["generated-1", "generated-2", "generated-3"]);
  });

  it("preserves a BOUND target and creates one sibling for one result", () => {
    const document = createDocument("original-asset");
    const target = document.nodes.find((node) => node.id === "image-target");
    const result = apply(document, ["asset-a"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.find((node) => node.id === "image-target")).toBe(target);
    expect(result.document.nodes.at(-1)).toMatchObject({
      kind: "image",
      data: { assetId: "asset-a" }
    });
  });

  it("preserves a BOUND target and creates all four results in order", () => {
    const result = apply(
      createDocument("original-asset"),
      ["asset-a", "asset-b", "asset-c", "asset-d"]
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(imageNodes(result.document).map((node) => node.data.assetId)).toEqual([
      "source-asset",
      "original-asset",
      "asset-a",
      "asset-b",
      "asset-c",
      "asset-d"
    ]);
  });

  it("leaves source/reference nodes and every edge unchanged", () => {
    const document = createDocument(null);
    const sourceNodes = document.nodes.slice(0, 2);
    const result = apply(document, ["asset-a", "asset-b"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.slice(0, 2)).toEqual(sourceNodes);
    expect(result.document.nodes.slice(0, 2)).toStrictEqual(sourceNodes);
    expect(result.document.edges).toEqual(document.edges);
    expect(result.document.edges).toBe(document.edges);
    expect(result.document.edges.every((edge, index) => edge === document.edges[index]))
      .toBe(true);
    expect(result.document.viewport).toBe(document.viewport);
  });

  it("returns the exact document when there are zero valid results", () => {
    const document = createDocument(null);
    const result = apply(document, ["", "   "]);

    expect(result).toEqual({ ok: false, document, error: "NO_IMAGE_RESULTS" });
    expect(result.document).toBe(document);
  });

  it("fails for a missing target id", () => {
    const document = createDocument(null);
    const result = apply(document, ["asset-a"], "missing");

    expect(result).toEqual({ ok: false, document, error: "TARGET_NOT_FOUND" });
  });

  it("fails for a non-Image target", () => {
    const document = createDocument(null);
    const result = apply(document, ["asset-a"], "text-source");

    expect(result).toEqual({ ok: false, document, error: "TARGET_NOT_IMAGE" });
  });

  it("requires unique injected sibling IDs and preserves the document on failure", () => {
    const document = createDocument("original-asset");
    const result = applyCreatorImageResults({
      document,
      targetNodeId: "image-target",
      orderedAssetIds: ["asset-a", "asset-b"],
      siblingPositions: [{ x: 900, y: 700 }, { x: 1_300, y: 1_100 }],
      createNodeId: () => "duplicate-id"
    });

    expect(result).toEqual({ ok: false, document, error: "NODE_ID_INVALID" });
  });

  it("places ordered siblings at the exact supplied positions", () => {
    const suppliedPositions = [
      { x: -400, y: 900 },
      { x: -32, y: 900 },
      { x: -400, y: 1_268 }
    ];
    const result = apply(
      createDocument("original-asset"),
      ["asset-a", "asset-b", "asset-c"],
      "image-target",
      suppliedPositions
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.slice(-3).map((node) => node.position))
      .toEqual(suppliedPositions);
    expect(imageNodes(result.document).slice(-3).map((node) => node.data.assetId))
      .toEqual(["asset-a", "asset-b", "asset-c"]);
  });

  it("rejects missing or non-finite sibling positions without changing the document", () => {
    const document = createDocument("original-asset");
    expect(apply(document, ["asset-a", "asset-b"], "image-target", [
      { x: 900, y: 700 }
    ])).toEqual({
      ok: false,
      document,
      error: "SIBLING_POSITIONS_INVALID"
    });
    expect(apply(document, ["asset-a"], "image-target", [
      { x: Number.POSITIVE_INFINITY, y: 700 }
    ])).toEqual({
      ok: false,
      document,
      error: "SIBLING_POSITIONS_INVALID"
    });
  });

  it("keeps the document schema limited to content asset IDs", () => {
    const result = apply(createDocument(null), ["asset-a", "asset-b"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.document);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("taskId");
    expect(serialized).not.toContain("providerId");
    expect(serialized).not.toContain("idempotency");
    expect(result.document.nodes.every((node: CreatorContentNode) =>
      Object.keys(node).sort().join(",") === "data,id,kind,position"
    )).toBe(true);
  });
});
