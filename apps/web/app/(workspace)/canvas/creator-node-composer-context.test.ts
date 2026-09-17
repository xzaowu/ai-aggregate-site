import { describe, expect, it } from "vitest";
import type {
  CreatorCanvasDocumentV1,
  CreatorContentNode
} from "./creator-canvas-document";
import {
  buildCreatorNodeComposerContext,
  getCreatorCanvasMediaBindingState,
  getCreatorCanvasNode,
  getCreatorNodeIncomingReferences
} from "./creator-node-composer-context";

const nodes: CreatorContentNode[] = [
  { id: "text", kind: "text", position: { x: 0, y: 0 }, data: { text: "A scene at dawn" } },
  { id: "image-empty", kind: "image", position: { x: 100, y: 0 }, data: { assetId: null } },
  { id: "image-bound", kind: "image", position: { x: 200, y: 0 }, data: { assetId: "asset-image" } },
  { id: "video-empty", kind: "video", position: { x: 300, y: 0 }, data: { assetId: null } },
  { id: "video-bound", kind: "video", position: { x: 400, y: 0 }, data: { assetId: "asset-video" } }
];

const document: CreatorCanvasDocumentV1 = {
  version: 1,
  nodes,
  edges: [
    {
      id: "text-to-video",
      sourceNodeId: "text",
      targetNodeId: "video-empty",
      relationship: "reference"
    },
    {
      id: "image-to-video",
      sourceNodeId: "image-bound",
      targetNodeId: "video-empty",
      relationship: "reference"
    },
    {
      id: "video-outgoing",
      sourceNodeId: "video-empty",
      targetNodeId: "video-bound",
      relationship: "reference"
    }
  ],
  viewport: { x: 0, y: 0, zoom: 1 }
};

describe("CreatorNodeComposerContext", () => {
  it.each([
    ["text", "text", "not-applicable"],
    ["image-empty", "image", "empty"],
    ["image-bound", "image", "bound"],
    ["video-empty", "video", "empty"],
    ["video-bound", "video", "bound"]
  ] as const)("builds selected %s content context", (nodeId, kind, mediaBinding) => {
    const context = buildCreatorNodeComposerContext(document, nodeId);
    expect(context?.node.id).toBe(nodeId);
    expect(context?.node.kind).toBe(kind);
    expect(context?.mediaBinding).toBe(mediaBinding);
  });

  it("resolves every incoming reference to its source content node in edge order", () => {
    const context = buildCreatorNodeComposerContext(document, "video-empty");

    expect(context?.incomingReferences.map((reference) => ({
      edgeId: reference.edgeId,
      nodeId: reference.sourceNode.id,
      kind: reference.sourceNode.kind,
      mediaBinding: reference.mediaBinding
    }))).toEqual([
      {
        edgeId: "text-to-video",
        nodeId: "text",
        kind: "text",
        mediaBinding: "not-applicable"
      },
      {
        edgeId: "image-to-video",
        nodeId: "image-bound",
        kind: "image",
        mediaBinding: "bound"
      }
    ]);
  });

  it("does not mistake an outgoing edge for an incoming source", () => {
    expect(getCreatorNodeIncomingReferences(document, "video-empty").map(
      (reference) => reference.edgeId
    )).toEqual(["text-to-video", "image-to-video"]);
    expect(getCreatorNodeIncomingReferences(document, "text")).toEqual([]);
  });

  it("returns safe null or empty results for a missing selection", () => {
    expect(getCreatorCanvasNode(document, "missing")).toBeNull();
    expect(getCreatorNodeIncomingReferences(document, "missing")).toEqual([]);
    expect(buildCreatorNodeComposerContext(document, "missing")).toBeNull();
  });

  it("distinguishes empty and bound media without exposing runtime fields", () => {
    expect(getCreatorCanvasMediaBindingState(nodes[1]!)).toBe("empty");
    expect(getCreatorCanvasMediaBindingState(nodes[2]!)).toBe("bound");
    const serialized = JSON.stringify(buildCreatorNodeComposerContext(document, "video-empty"));
    for (const forbidden of [
      "providerId",
      "routeId",
      "billing",
      "credits",
      "quota",
      "AiTask",
      "signedUrl",
      "File",
      "Blob",
      "base64",
      "reactFlow",
      "HTMLElement"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
