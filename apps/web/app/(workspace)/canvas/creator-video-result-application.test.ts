import { describe, expect, it } from "vitest";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import {
  applyCreatorVideoResult
} from "./creator-video-result-application";

function documentWithVideo(assetId: string | null = null): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "text-source",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "source" }
      },
      {
        id: "video-target",
        kind: "video",
        position: { x: 320, y: 0 },
        data: { assetId }
      }
    ],
    edges: [{
      id: "edge-source-target",
      sourceNodeId: "text-source",
      targetNodeId: "video-target",
      relationship: "reference"
    }],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

describe("Creator Video result application", () => {
  it("binds an EMPTY target in place without changing edges", () => {
    const document = documentWithVideo();
    const result = applyCreatorVideoResult({
      document,
      targetNodeId: "video-target",
      assetId: " asset-video-1 "
    });

    expect(result).toMatchObject({
      ok: true,
      targetWasEmpty: true,
      boundTargetAssetId: "asset-video-1",
      createdNodeIds: []
    });
    if (!result.ok) return;
    expect(result.document.nodes.find((node) => node.id === "video-target")).toMatchObject({
      data: { assetId: "asset-video-1" }
    });
    expect(result.document.edges).toEqual(document.edges);
    expect(document.nodes.find((node) => node.id === "video-target")).toMatchObject({
      data: { assetId: null }
    });
  });

  it("keeps a BOUND target and creates exactly one deterministic sibling", () => {
    const document = documentWithVideo("old-video");
    const before = JSON.stringify(document);
    const result = applyCreatorVideoResult({
      document,
      targetNodeId: "video-target",
      assetId: "new-video",
      siblingPosition: { x: 700, y: 20 },
      createNodeId: () => "video-result-1"
    });

    expect(result).toMatchObject({
      ok: true,
      targetWasEmpty: false,
      boundTargetAssetId: null,
      createdNodeIds: ["video-result-1"]
    });
    if (!result.ok) return;
    expect(result.document.nodes).toHaveLength(3);
    expect(result.document.nodes.find((node) => node.id === "video-target")).toMatchObject({
      data: { assetId: "old-video" }
    });
    expect(result.document.nodes.find((node) => node.id === "video-result-1")).toEqual({
      id: "video-result-1",
      kind: "video",
      position: { x: 700, y: 20 },
      data: { assetId: "new-video" }
    });
    expect(result.document.edges).toEqual(document.edges);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("rejects missing targets, wrong node kinds, blank assets, and unsafe sibling IDs", () => {
    const document = documentWithVideo();
    expect(applyCreatorVideoResult({
      document,
      targetNodeId: "missing",
      assetId: "asset"
    })).toMatchObject({ ok: false, error: "TARGET_NOT_FOUND" });
    expect(applyCreatorVideoResult({
      document,
      targetNodeId: "text-source",
      assetId: "asset"
    })).toMatchObject({ ok: false, error: "TARGET_NOT_VIDEO" });
    expect(applyCreatorVideoResult({
      document,
      targetNodeId: "video-target",
      assetId: "  "
    })).toMatchObject({ ok: false, error: "ASSET_ID_INVALID" });
    expect(applyCreatorVideoResult({
      document: documentWithVideo("old"),
      targetNodeId: "video-target",
      assetId: "new",
      siblingPosition: { x: 10, y: 10 },
      createNodeId: () => "video-target"
    })).toMatchObject({ ok: false, error: "NODE_ID_INVALID" });
    expect(applyCreatorVideoResult({
      document: documentWithVideo("old"),
      targetNodeId: "video-target",
      assetId: "new",
      createNodeId: () => "video-result"
    })).toMatchObject({ ok: false, error: "SIBLING_POSITION_INVALID" });
  });
});
