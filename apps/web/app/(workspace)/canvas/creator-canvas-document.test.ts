import { describe, expect, it } from "vitest";
import {
  CREATOR_CANVAS_DOCUMENT_VERSION,
  CREATOR_CANVAS_MAX_ZOOM,
  CREATOR_CANVAS_MIN_ZOOM,
  bindCreatorCanvasImageAsset,
  canConnectCreatorCanvasNodes,
  connectCreatorCanvasNodes,
  createInitialCreatorCanvasDocument,
  isCreatorCanvasReferenceCompatible,
  parseCreatorCanvasDocument,
  reconnectCreatorCanvasEdge,
  replaceCreatorCanvasImageAsset,
  removeCreatorCanvasNode,
  updateCreatorCanvasNodePosition,
  updateCreatorCanvasText,
  updateCreatorCanvasViewport,
  type CreatorCanvasConnection,
  type CreatorCanvasDocumentV1,
  type CreatorCanvasEdge,
  type CreatorContentNode
} from "./creator-canvas-document";

const nodes: CreatorContentNode[] = [
  { id: "text-a", kind: "text", position: { x: 0, y: 0 }, data: { text: "A" } },
  { id: "text-b", kind: "text", position: { x: 20, y: 20 }, data: { text: "B" } },
  { id: "image-a", kind: "image", position: { x: 100, y: 0 }, data: { assetId: null } },
  { id: "image-b", kind: "image", position: { x: 140, y: 30 }, data: { assetId: "asset-1" } },
  { id: "video-a", kind: "video", position: { x: 220, y: 0 }, data: { assetId: null } },
  { id: "video-b", kind: "video", position: { x: 260, y: 30 }, data: { assetId: "asset-2" } }
];

function documentWith(
  edges: CreatorCanvasEdge[] = [],
  documentNodes: CreatorContentNode[] = nodes
): CreatorCanvasDocumentV1 {
  return {
    version: CREATOR_CANVAS_DOCUMENT_VERSION,
    nodes: documentNodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function reference(
  id: string,
  sourceNodeId: string,
  targetNodeId: string
): CreatorCanvasEdge {
  return { id, sourceNodeId, targetNodeId, relationship: "reference" };
}

const textNode = nodes[0] as Extract<CreatorContentNode, { kind: "text" }>;

describe("CreatorCanvasDocumentV1 parsing", () => {
  it("parses the exact document and Text/Image/Video node shapes", () => {
    const value = documentWith([
      reference("edge-1", "text-a", "image-a"),
      reference("edge-2", "image-a", "video-a")
    ]);

    expect(parseCreatorCanvasDocument(value)).toEqual({ ok: true, document: value });
    expect(value.nodes.map((node) => node.kind)).toEqual([
      "text",
      "text",
      "image",
      "image",
      "video",
      "video"
    ]);
  });

  it("keeps legacy Text data valid and parses the optional AI configuration", () => {
    const legacy = parseCreatorCanvasDocument(documentWith());
    expect(legacy).toMatchObject({ ok: true });

    const aiConfig = {
      instruction: "Write a short script",
      modelId: "chat-model"
    };
    const aiDocument = documentWith([], [{
      ...textNode,
      data: { text: "generated output", ai: aiConfig }
    }]);
    const parsed = parseCreatorCanvasDocument(aiDocument);

    expect(parsed).toEqual({
      ok: true,
      document: {
        ...aiDocument,
        nodes: [{ ...textNode, data: { text: "generated output", ai: aiConfig } }]
      }
    });
    if (parsed.ok) {
      const parsedText = parsed.document.nodes[0];
      if (parsedText?.kind === "text") {
        expect(parsedText.data.ai).not.toBe(aiConfig);
      }
    }
  });

  it("rejects malformed or expanded Text AI data", () => {
    for (const ai of [
      { instruction: "only one field" },
      { instruction: "ok", modelId: 3 },
      { instruction: "ok", modelId: "model", extra: true },
      null,
      "model"
    ]) {
      const result = parseCreatorCanvasDocument(documentWith([], [{
        ...textNode,
        data: { text: "output", ai }
      } as unknown as CreatorContentNode]));
      expect(result.ok).toBe(false);
    }
  });

  it("rejects extra document, node, data, edge, position, and viewport keys", () => {
    const cases: unknown[] = [
      { ...documentWith(), extra: true },
      documentWith([], [{ ...nodes[0]!, extra: true } as unknown as CreatorContentNode]),
      documentWith([], [{
        ...nodes[0]!,
        data: { text: "", extra: true }
      } as unknown as CreatorContentNode]),
      {
        ...documentWith(),
        edges: [{ ...reference("edge-1", "text-a", "image-a"), extra: true }]
      },
      documentWith([], [{
        ...nodes[0]!,
        position: { x: 0, y: 0, z: 0 }
      } as unknown as CreatorContentNode]),
      { ...documentWith(), viewport: { x: 0, y: 0, zoom: 1, extra: true } }
    ];

    for (const value of cases) expect(parseCreatorCanvasDocument(value).ok).toBe(false);
  });

  it("rejects invalid text and asset content", () => {
    expect(parseCreatorCanvasDocument(documentWith([], [
      { id: "text", kind: "text", position: { x: 0, y: 0 }, data: { text: 1 } } as unknown as CreatorContentNode
    ])).ok).toBe(false);
    expect(parseCreatorCanvasDocument(documentWith([], [
      { id: "image", kind: "image", position: { x: 0, y: 0 }, data: { assetId: "" } } as CreatorContentNode
    ])).ok).toBe(false);
    expect(parseCreatorCanvasDocument(documentWith([], [
      { id: "video", kind: "video", position: { x: 0, y: 0 }, data: { assetId: 3 } } as unknown as CreatorContentNode
    ])).ok).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite node positions: %s",
    (coordinate) => {
      const result = parseCreatorCanvasDocument(documentWith([], [
        { ...nodes[0]!, position: { x: coordinate, y: 0 } }
      ]));
      expect(result.ok).toBe(false);
    }
  );

  it("enforces the established bounded viewport", () => {
    expect(parseCreatorCanvasDocument({
      ...documentWith(),
      viewport: { x: 1, y: -2, zoom: CREATOR_CANVAS_MIN_ZOOM }
    }).ok).toBe(true);
    expect(parseCreatorCanvasDocument({
      ...documentWith(),
      viewport: { x: 1, y: -2, zoom: CREATOR_CANVAS_MAX_ZOOM }
    }).ok).toBe(true);

    for (const viewport of [
      { x: Number.NaN, y: 0, zoom: 1 },
      { x: 0, y: Number.POSITIVE_INFINITY, zoom: 1 },
      { x: 0, y: 0, zoom: CREATOR_CANVAS_MIN_ZOOM - 0.01 },
      { x: 0, y: 0, zoom: CREATOR_CANVAS_MAX_ZOOM + 0.01 }
    ]) {
      expect(parseCreatorCanvasDocument({ ...documentWith(), viewport }).ok).toBe(false);
    }
  });

  it("rejects duplicate node and edge ids", () => {
    const duplicateNodes = documentWith([], [nodes[0]!, { ...nodes[0]! }]);
    expect(parseCreatorCanvasDocument(duplicateNodes)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["NODE_ID_DUPLICATE:text-a"])
    });

    const duplicateEdges = documentWith([
      reference("edge-1", "text-a", "image-a"),
      reference("edge-1", "text-b", "video-a")
    ]);
    expect(parseCreatorCanvasDocument(duplicateEdges)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["EDGE_ID_DUPLICATE:edge-1"])
    });
  });

  it("rejects missing edge endpoints and exact duplicate relationships", () => {
    expect(parseCreatorCanvasDocument(documentWith([
      reference("missing", "text-a", "missing")
    ]))).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["EDGE_NODE_MISSING:missing"])
    });

    expect(parseCreatorCanvasDocument(documentWith([
      reference("edge-1", "text-a", "image-a"),
      reference("edge-2", "text-a", "image-a")
    ]))).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["EDGE_RELATIONSHIP_DUPLICATE:edge-2"])
    });
  });
});

describe("Creator Canvas reference relationships", () => {
  it.each([
    ["text", "text", true],
    ["text", "image", true],
    ["text", "video", true],
    ["image", "text", false],
    ["image", "image", true],
    ["image", "video", true],
    ["video", "text", false],
    ["video", "image", false],
    ["video", "video", true]
  ] as const)("%s -> %s compatibility is %s", (source, target, expected) => {
    expect(isCreatorCanvasReferenceCompatible(source, target)).toBe(expected);
  });

  it("allows source fan-out", () => {
    const first = connectCreatorCanvasNodes(
      documentWith(),
      reference("edge-1", "text-a", "image-a")
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = connectCreatorCanvasNodes(
      first.document,
      reference("edge-2", "text-a", "video-a")
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.document.edges).toHaveLength(2);
  });

  it("allows multiple compatible incoming references", () => {
    const value = documentWith([
      reference("edge-1", "text-a", "video-a"),
      reference("edge-2", "text-b", "video-a"),
      reference("edge-3", "image-a", "video-a")
    ]);
    expect(parseCreatorCanvasDocument(value)).toEqual({ ok: true, document: value });
  });

  it("allows a Text chain into Text and still rejects self edges and cycles", () => {
    const chainNodes: CreatorContentNode[] = [
      ...nodes,
      { id: "text-c", kind: "text", position: { x: 40, y: 40 }, data: { text: "C" } }
    ];
    const chain = documentWith([
      reference("text-edge-a", "text-a", "text-b"),
      reference("text-edge-b", "text-b", "text-c"),
      reference("text-edge-image", "text-c", "image-a")
    ], chainNodes);
    expect(parseCreatorCanvasDocument(chain)).toMatchObject({ ok: true });

    const selfEdgeResult = parseCreatorCanvasDocument(documentWith([
      reference("text-self", "text-a", "text-a")
    ]));
    expect(selfEdgeResult.ok).toBe(false);
    if (!selfEdgeResult.ok) {
      expect(selfEdgeResult.errors).toEqual(
        expect.arrayContaining(["SELF_EDGE_NOT_ALLOWED:text-self"])
      );
    }

    const cycle = documentWith([
      reference("text-cycle-a", "text-a", "text-b"),
      reference("text-cycle-b", "text-b", "text-a")
    ]);
    expect(parseCreatorCanvasDocument(cycle)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["CYCLE_NOT_ALLOWED"])
    });
  });

  it("rejects incompatible, duplicate, self, and cyclic connections", () => {
    const incompatible: CreatorCanvasConnection = {
      sourceNodeId: "video-a",
      targetNodeId: "image-a",
      relationship: "reference"
    };
    expect(canConnectCreatorCanvasNodes(documentWith(), incompatible)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["CONNECTION_INVALID"])
    });

    const existing = documentWith([reference("edge-1", "text-a", "image-a")]);
    expect(canConnectCreatorCanvasNodes(existing, {
      sourceNodeId: "text-a",
      targetNodeId: "image-a",
      relationship: "reference"
    })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["EDGE_RELATIONSHIP_DUPLICATE"])
    });

    expect(canConnectCreatorCanvasNodes(documentWith(), {
      sourceNodeId: "image-a",
      targetNodeId: "image-a",
      relationship: "reference"
    })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["SELF_EDGE_NOT_ALLOWED"])
    });

    const oneWay = documentWith([reference("edge-1", "image-a", "image-b")]);
    expect(canConnectCreatorCanvasNodes(oneWay, {
      sourceNodeId: "image-b",
      targetNodeId: "image-a",
      relationship: "reference"
    })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["CYCLE_NOT_ALLOWED"])
    });
  });
});

describe("CreatorCanvasDocumentV1 commands", () => {
  it("binds an existing Asset to an EMPTY Image without changing graph structure", () => {
    const value = documentWith([
      reference("edge-1", "text-a", "image-a"),
      reference("edge-2", "image-a", "video-a")
    ]);
    const result = bindCreatorCanvasImageAsset(value, "image-a", " asset-existing ");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.version).toBe(value.version);
    expect(result.document.nodes).toHaveLength(value.nodes.length);
    expect(result.document.nodes.find((node) => node.id === "image-a")).toEqual({
      ...nodes[2],
      data: { assetId: "asset-existing" }
    });
    expect(result.document.nodes.find((node) => node.id === "image-a")?.position)
      .toEqual(nodes[2]?.position);
    expect(result.document.nodes.filter((node) => node.id !== "image-a"))
      .toEqual(value.nodes.filter((node) => node.id !== "image-a"));
    expect(result.document.edges).toEqual(value.edges);
    expect(result.document.viewport).toEqual(value.viewport);
  });

  it.each([
    ["missing target", "missing", "asset-1", "NODE_NOT_FOUND:missing"],
    ["Text target", "text-a", "asset-1", "NODE_KIND_INVALID_FOR_IMAGE_BIND:text-a"],
    ["Video target", "video-a", "asset-1", "NODE_KIND_INVALID_FOR_IMAGE_BIND:video-a"],
    ["already bound target", "image-b", "asset-1", "IMAGE_ALREADY_BOUND:image-b"],
    ["blank asset id", "image-a", "   ", "ASSET_ID_INVALID"]
  ] as const)("rejects %s without mutating the document", (_case, targetNodeId, assetId, error) => {
    const value = documentWith();
    const result = bindCreatorCanvasImageAsset(value, targetNodeId, assetId);

    expect(result).toEqual({ ok: false, document: value, errors: [error] });
  });

  it("allows the same Asset to bind to separate EMPTY Image nodes", () => {
    const value = documentWith([], [
      nodes[2]!,
      { id: "image-c", kind: "image", position: { x: 480, y: 0 }, data: { assetId: null } }
    ]);
    const first = bindCreatorCanvasImageAsset(value, "image-a", "asset-shared");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = bindCreatorCanvasImageAsset(first.document, "image-c", "asset-shared");
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(
        second.document.nodes
          .filter((node) => node.kind === "image")
          .map((node) => node.data.assetId)
      ).toEqual([
        "asset-shared",
        "asset-shared"
      ]);
    }
  });

  it("replaces a BOUND Image Asset without changing its identity or graph", () => {
    const value = {
      ...documentWith([
        reference("edge-1", "text-a", "image-b"),
        reference("edge-2", "image-b", "video-a")
      ]),
      viewport: { x: -42, y: 18, zoom: 1.25 }
    };
    const result = replaceCreatorCanvasImageAsset(
      value,
      "image-b",
      " asset-1 ",
      " asset-replacement "
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.version).toBe(value.version);
    expect(result.document.nodes).toHaveLength(value.nodes.length);
    expect(result.document.nodes.find((node) => node.id === "image-b")).toEqual({
      ...nodes[3],
      data: { assetId: "asset-replacement" }
    });
    expect(result.document.nodes.find((node) => node.id === "image-b")?.position)
      .toEqual(nodes[3]?.position);
    expect(result.document.nodes.filter((node) => node.id !== "image-b"))
      .toEqual(value.nodes.filter((node) => node.id !== "image-b"));
    expect(result.document.edges).toEqual(value.edges);
    expect(result.document.viewport).toEqual(value.viewport);
  });

  it.each([
    ["missing target", "missing", "asset-1", "asset-2", "NODE_NOT_FOUND:missing"],
    ["Text target", "text-a", "asset-1", "asset-2", "NODE_KIND_INVALID_FOR_IMAGE_REPLACE:text-a"],
    ["Video target", "video-a", "asset-1", "asset-2", "NODE_KIND_INVALID_FOR_IMAGE_REPLACE:video-a"],
    ["EMPTY Image target", "image-a", "asset-1", "asset-2", "IMAGE_NOT_BOUND_FOR_REPLACE:image-a"],
    ["blank expected Asset id", "image-b", "   ", "asset-2", "EXPECTED_CURRENT_ASSET_ID_INVALID"],
    ["blank replacement Asset id", "image-b", "asset-1", "   ", "REPLACEMENT_ASSET_ID_INVALID"],
    ["stale expected Asset id", "image-b", "asset-old", "asset-2", "IMAGE_CURRENT_ASSET_MISMATCH:image-b"],
    ["same Asset", "image-b", "asset-1", "asset-1", "IMAGE_REPLACEMENT_SAME_AS_CURRENT:image-b"]
  ] as const)("rejects %s without mutating the document", (
    _case,
    targetNodeId,
    expectedCurrentAssetId,
    replacementAssetId,
    error
  ) => {
    const value = documentWith();
    const result = replaceCreatorCanvasImageAsset(
      value,
      targetNodeId,
      expectedCurrentAssetId,
      replacementAssetId
    );

    expect(result).toEqual({ ok: false, document: value, errors: [error] });
  });

  it("removes a node and cascades its incident edges", () => {
    const value = documentWith([
      reference("edge-1", "text-a", "image-a"),
      reference("edge-2", "image-a", "video-a"),
      reference("edge-3", "text-b", "video-a")
    ]);
    const result = removeCreatorCanvasNode(value, "image-a");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.some((node) => node.id === "image-a")).toBe(false);
    expect(result.document.edges).toEqual([
      reference("edge-3", "text-b", "video-a")
    ]);
  });

  it("reconnects validly with a stable edge id", () => {
    const value = documentWith([reference("stable-edge", "text-a", "image-a")]);
    const result = reconnectCreatorCanvasEdge(value, "stable-edge", {
      sourceNodeId: "image-a",
      targetNodeId: "video-a",
      relationship: "reference"
    });
    expect(result).toMatchObject({
      ok: true,
      document: {
        edges: [reference("stable-edge", "image-a", "video-a")]
      }
    });
  });

  it("preserves the old edge on invalid reconnect", () => {
    const value = documentWith([reference("stable-edge", "text-a", "image-a")]);
    const result = reconnectCreatorCanvasEdge(value, "stable-edge", {
      sourceNodeId: "video-a",
      targetNodeId: "image-a",
      relationship: "reference"
    });
    expect(result.ok).toBe(false);
    expect(result.document).toBe(value);
    expect(result.document.edges).toEqual([
      reference("stable-edge", "text-a", "image-a")
    ]);
  });

  it("updates text without changing non-text nodes", () => {
    const value = documentWith();
    const result = updateCreatorCanvasText(value, "text-a", "Updated");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.find((node) => node.id === "text-a")).toMatchObject({
      kind: "text",
      data: { text: "Updated" }
    });
    expect(result.document.nodes.find((node) => node.id === "image-a")).toEqual(nodes[2]);
  });

  it("updates Text output without dropping its AI configuration", () => {
    const value = documentWith([], [{
      ...textNode,
      data: {
        text: "old output",
        ai: { instruction: "Rewrite this", modelId: "chat-model" }
      }
    }]);
    const result = updateCreatorCanvasText(value, "text-a", "new output");

    expect(result).toMatchObject({
      ok: true,
      document: {
        nodes: [{
          data: {
            text: "new output",
            ai: { instruction: "Rewrite this", modelId: "chat-model" }
          }
        }]
      }
    });
  });

  it("accepts arbitrary Canvas Text length without a renderer-only limit", () => {
    const text = "x".repeat(4_001);
    const result = updateCreatorCanvasText(documentWith(), "text-a", text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.find((node) => node.id === "text-a")).toMatchObject({
      kind: "text",
      data: { text }
    });
  });

  it("updates finite positions and rejects non-finite positions", () => {
    const value = documentWith();
    const valid = updateCreatorCanvasNodePosition(value, "image-a", { x: -12, y: 48 });
    expect(valid).toMatchObject({
      ok: true,
      document: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "image-a", position: { x: -12, y: 48 } })
        ])
      }
    });

    const invalid = updateCreatorCanvasNodePosition(value, "image-a", {
      x: Number.NaN,
      y: 0
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.document).toBe(value);
  });

  it("updates a bounded viewport and preserves the document when invalid", () => {
    const value = documentWith();
    expect(updateCreatorCanvasViewport(value, { x: -90, y: 45, zoom: 1.5 }))
      .toMatchObject({ ok: true, document: { viewport: { x: -90, y: 45, zoom: 1.5 } } });

    const invalid = updateCreatorCanvasViewport(value, { x: 0, y: 0, zoom: 5 });
    expect(invalid.ok).toBe(false);
    expect(invalid.document).toBe(value);
  });

  it("starts with an exact blank document", () => {
    expect(createInitialCreatorCanvasDocument()).toEqual({
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    });
  });
});
