import { describe, expect, it, vi } from "vitest";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import type { CreatorImageAssetDisplayState } from "./creator-image-asset-display";
import type { CreatorVideoNodeExecutionView } from "./creator-video-composer-panel";
import {
  fromCreatorCanvasReactFlowConnection,
  toCreatorCanvasReactFlowEdges,
  toCreatorCanvasReactFlowNodes
} from "./creator-canvas-react-flow";

const document: CreatorCanvasDocumentV1 = {
  version: 1,
  nodes: [
    { id: "text", kind: "text", position: { x: 1, y: 2 }, data: { text: "hello" } },
    { id: "image", kind: "image", position: { x: 3, y: 4 }, data: { assetId: null } },
    { id: "video", kind: "video", position: { x: 5, y: 6 }, data: { assetId: null } }
  ],
  edges: [
    {
      id: "edge",
      sourceNodeId: "text",
      targetNodeId: "image",
      relationship: "reference"
    }
  ],
  viewport: { x: 0, y: 0, zoom: 1 }
};

describe("Creator Canvas React Flow projection", () => {
  it("projects domain nodes with actions and renderer-only state", () => {
    const actions = { onTextChange: vi.fn() };
    const result = toCreatorCanvasReactFlowNodes(
      document,
      actions,
      new Set(["image"]),
      (kind) => `label:${kind}`,
      new Map([["image", { dragging: true, measured: { width: 320, height: 180 } }]])
    );

    expect(result.map((node) => node.type)).toEqual(["text", "image", "video"]);
    expect(result[1]).toMatchObject({
      id: "image",
      selected: true,
      dragging: true,
      measured: { width: 320, height: 180 },
      ariaLabel: "label:image",
      data: { domainNode: document.nodes[1], actions }
    });
    expect(document.nodes[1]).not.toHaveProperty("selected");
    expect(document.nodes[1]).not.toHaveProperty("measured");
    expect(result[1]?.data.imageExecution).toBeNull();
    expect(result[1]?.data).not.toHaveProperty("imageComposer");
    expect(result[1]?.data.imageAssetDisplay).toBeUndefined();
  });

  it("projects selected Image private display state without changing node semantics", () => {
    const display: CreatorImageAssetDisplayState = {
      status: "ready",
      logicalUrl: "/assets/image/content"
    };
    const result = toCreatorCanvasReactFlowNodes(
      document,
      { onTextChange: vi.fn() },
      new Set(["image"]),
      undefined,
      undefined,
      "owner-token",
      new Map([["image", display]])
    );

    expect(result[1]?.data.imageAssetDisplay).toBe(display);
    expect(result[1]?.data.domainNode).toBe(document.nodes[1]);
    expect(result[1]?.data).not.toHaveProperty("imageComposer");
  });

  it("projects independent presentation-only execution state to matching Image nodes", () => {
    const documentWithTwoImages: CreatorCanvasDocumentV1 = {
      ...document,
      nodes: [
        ...document.nodes,
        {
          id: "image-two",
          kind: "image",
          position: { x: 7, y: 8 },
          data: { assetId: "asset-two" }
        }
      ]
    };
    const result = toCreatorCanvasReactFlowNodes(
      documentWithTwoImages,
      { onTextChange: vi.fn() },
      new Set(),
      undefined,
      undefined,
      null,
      undefined,
      new Map([
        ["text", "failed"],
        ["image", "preparing"],
        ["video", "checking"],
        ["image-two", "unresolved"]
      ])
    );

    expect(result.find((node) => node.id === "image")?.data.imageExecution)
      .toEqual({ status: "generating" });
    expect(result.find((node) => node.id === "image-two")?.data.imageExecution)
      .toEqual({ status: "unresolved" });
    expect(result.find((node) => node.id === "text")?.data.imageExecution).toBeNull();
    expect(result.find((node) => node.id === "video")?.data.imageExecution).toBeNull();
    expect(documentWithTwoImages.nodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ executionStatus: expect.anything() })
    ]));
  });

  it("projects independent Video execution state only to the Video node", () => {
    const videoExecution: CreatorVideoNodeExecutionView = {
      status: "checking",
      progress: 42,
      taskId: "task-video",
      errorMessage: null
    };
    const result = toCreatorCanvasReactFlowNodes(
      document,
      { onTextChange: vi.fn() },
      new Set(),
      undefined,
      undefined,
      null,
      undefined,
      new Map(),
      new Map(),
      new Map([["video", videoExecution]])
    );

    expect(result.find((node) => node.id === "video")?.data.videoExecution)
      .toBe(videoExecution);
    expect(result.find((node) => node.id === "video")?.data)
      .not.toHaveProperty("videoComposer");
    expect(result.find((node) => node.id === "image")?.data.videoExecution).toBeNull();
  });

  it("projects reference edges through generic renderer handles", () => {
    expect(toCreatorCanvasReactFlowEdges(document, new Set(["edge"]))).toEqual([
      expect.objectContaining({
        id: "edge",
        source: "text",
        sourceHandle: "source",
        target: "image",
        targetHandle: "target",
        selected: true,
        reconnectable: true
      })
    ]);
    expect(document.edges[0]).not.toHaveProperty("sourceHandle");
    expect(document.edges[0]).not.toHaveProperty("targetHandle");
  });

  it("maps renderer connections to the manual reference relationship", () => {
    expect(fromCreatorCanvasReactFlowConnection({
      source: "text",
      sourceHandle: "source",
      target: "image",
      targetHandle: "target"
    })).toEqual({
      sourceNodeId: "text",
      targetNodeId: "image",
      relationship: "reference"
    });
    expect(fromCreatorCanvasReactFlowConnection({
      source: "",
      sourceHandle: null,
      target: "image",
      targetHandle: "target"
    })).toBeNull();
  });
});
