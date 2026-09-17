import type {
  CreatorCanvasDocumentV1,
  CreatorContentNode
} from "./creator-canvas-document";
import {
  captureCreatorCanvasGraphClipboard,
  cloneCreatorCanvasGraphForPaste,
  type CreatorCanvasGraphClipboard
} from "./creator-canvas-graph-clipboard";
import {
  createCreatorImageComposerDraft,
  type CreatorImageComposerDraft
} from "./creator-image-composer";
import {
  createCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";
import { describe, expect, it } from "vitest";

function createDocument(): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "text-a",
        kind: "text",
        position: { x: 0, y: 0 },
        data: {
          text: "Source text",
          ai: { instruction: "Write from source", modelId: "chat-model" }
        }
      },
      {
        id: "image-a",
        kind: "image",
        position: { x: 180, y: 90 },
        data: { assetId: "asset-image-a" }
      },
      {
        id: "video-a",
        kind: "video",
        position: { x: 420, y: 210 },
        data: { assetId: "asset-video-a" }
      },
      {
        id: "image-b",
        kind: "image",
        position: { x: 120, y: 360 },
        data: { assetId: "asset-image-b" }
      },
      {
        id: "image-outside",
        kind: "image",
        position: { x: 620, y: 20 },
        data: { assetId: "asset-image-outside" }
      },
      {
        id: "video-outside",
        kind: "video",
        position: { x: 760, y: 300 },
        data: { assetId: "asset-video-outside" }
      }
    ],
    edges: [
      {
        id: "edge-internal-text-image",
        sourceNodeId: "text-a",
        targetNodeId: "image-a",
        relationship: "reference"
      },
      {
        id: "edge-internal-image-video",
        sourceNodeId: "image-a",
        targetNodeId: "video-a",
        relationship: "reference"
      },
      {
        id: "edge-external-inbound",
        sourceNodeId: "image-outside",
        targetNodeId: "video-a",
        relationship: "reference"
      },
      {
        id: "edge-external-outbound",
        sourceNodeId: "video-a",
        targetNodeId: "video-outside",
        relationship: "reference"
      }
    ],
    viewport: { x: -40, y: 25, zoom: 1 }
  };
}

function createDraft(
  overrides: Partial<CreatorImageComposerDraft> = {}
): CreatorImageComposerDraft {
  return {
    ...createCreatorImageComposerDraft("canvas-model"),
    prompt: "A preserved prompt",
    aspectRatio: "16:9",
    count: 2,
    operation: "edit",
    promptDirty: true,
    ...overrides
  };
}

function createDraftMap(): Map<string, CreatorImageComposerDraft> {
  return new Map([
    [
      "image-a",
      createDraft({
        selectedImageReferenceNodeId: "image-a",
        promptSeedSourceNodeId: "text-a"
      })
    ],
    [
      "image-b",
      createDraft({
        prompt: "External references are removed",
        selectedImageReferenceNodeId: "image-outside",
        promptSeedSourceNodeId: "video-outside"
      })
    ]
  ]);
}

function createVideoDraftMap(): Map<string, CreatorVideoComposerDraft> {
  return new Map([[
    "video-a",
    {
      ...createCreatorVideoComposerDraft("video-model"),
      prompt: "Animate product",
      modelId: "video-model",
      mode: "image-to-video" as const,
      selectedImageReferenceNodeId: "image-a",
      promptSeedSourceNodeId: "text-a",
      promptDirty: true
    }
  ]]);
}

function createIdFactory() {
  let sequence = 0;
  return (prefix: string) => `${prefix}-paste-${++sequence}`;
}

function capture(
  selectedNodeIds: readonly string[] = [
    "text-a",
    "image-a",
    "video-a",
    "image-b"
  ]
): CreatorCanvasGraphClipboard {
  const snapshot = captureCreatorCanvasGraphClipboard(
    createDocument(),
    new Set(selectedNodeIds),
    createDraftMap(),
    createVideoDraftMap()
  );
  if (!snapshot) throw new Error("GRAPH_CLIPBOARD_SNAPSHOT_MISSING");
  return snapshot;
}

function paste(
  clipboard: CreatorCanvasGraphClipboard,
  document = createDocument(),
  drafts = createDraftMap(),
  pasteIndex = 0
) {
  const idFactory = createIdFactory();
  const result = cloneCreatorCanvasGraphForPaste(
    clipboard,
    document,
    drafts,
    {
      anchor: { x: 1_000, y: 800 },
      pasteIndex,
      createId: (prefix) => idFactory(prefix)
    },
    createVideoDraftMap()
  );
  if (!result) throw new Error("GRAPH_CLIPBOARD_PASTE_MISSING");
  return result;
}

function findNode(
  nodes: readonly CreatorContentNode[],
  nodeId: string
): CreatorContentNode {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`GRAPH_NODE_MISSING:${nodeId}`);
  return node;
}

describe("Creator Canvas graph clipboard", () => {
  it("returns no graph for zero selected nodes or edge-only selection", () => {
    const document = createDocument();
    const drafts = createDraftMap();

    expect(captureCreatorCanvasGraphClipboard(document, new Set(), drafts)).toBeNull();
    expect(captureCreatorCanvasGraphClipboard(document, new Set(), drafts)).toBeNull();
  });

  it("captures one Text node with its semantic data", () => {
    const snapshot = capture(["text-a"]);

    expect(snapshot.nodes).toEqual([{
      id: "text-a",
      kind: "text",
      position: { x: 0, y: 0 },
      data: {
        text: "Source text",
        ai: { instruction: "Write from source", modelId: "chat-model" }
      }
    }]);
    expect(snapshot.edges).toEqual([]);
    expect(snapshot.imageComposerDrafts.size).toBe(0);
  });

  it("captures multi-node graphs and only internal edges", () => {
    const snapshot = capture();

    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      "text-a",
      "image-a",
      "video-a",
      "image-b"
    ]);
    expect(snapshot.edges.map((edge) => edge.id)).toEqual([
      "edge-internal-text-image",
      "edge-internal-image-video"
    ]);
    expect([...snapshot.imageComposerDrafts.keys()]).toEqual(["image-a", "image-b"]);
  });

  it("excludes external inbound and outbound edges", () => {
    const snapshot = capture(["image-a", "video-a"]);

    expect(snapshot.edges).toEqual([{
      id: "edge-internal-image-video",
      sourceNodeId: "image-a",
      targetNodeId: "video-a",
      relationship: "reference"
    }]);
  });

  it("keeps source document, drafts, and captured graph immutable", () => {
    const document = createDocument();
    const drafts = createDraftMap();
    const documentBefore = JSON.stringify(document);
    const draftsBefore = JSON.stringify([...drafts]);
    const snapshot = captureCreatorCanvasGraphClipboard(
      document,
      new Set(["text-a", "image-a", "video-a", "image-b"]),
      drafts,
      createVideoDraftMap()
    );
    if (!snapshot) throw new Error("GRAPH_CLIPBOARD_SNAPSHOT_MISSING");
    const snapshotBefore = JSON.stringify({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      drafts: [...snapshot.imageComposerDrafts],
      videoDrafts: [...snapshot.videoComposerDrafts]
    });

    const result = cloneCreatorCanvasGraphForPaste(
      snapshot,
      document,
      drafts,
      {
        anchor: { x: 100, y: 100 },
        createId: (prefix, existingIds) => {
          let index = 1;
          while (existingIds.has(`${prefix}-immutable-${index}`)) index += 1;
          return `${prefix}-immutable-${index}`;
        }
      }
    );
    expect(result).not.toBeNull();
    expect(JSON.stringify(document)).toBe(documentBefore);
    expect(JSON.stringify([...drafts])).toBe(draftsBefore);
    expect(JSON.stringify({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      drafts: [...snapshot.imageComposerDrafts],
      videoDrafts: [...snapshot.videoComposerDrafts]
    })).toBe(snapshotBefore);
  });

  it("creates fresh node and edge IDs and remaps internal endpoints", () => {
    const snapshot = capture();
    let sequence = 0;
    const result = cloneCreatorCanvasGraphForPaste(
      snapshot,
      createDocument(),
      createDraftMap(),
      {
        anchor: { x: 1_000, y: 800 },
        createId: (prefix) => `${prefix}-fresh-${++sequence}`
      }
    );
    if (!result) throw new Error("GRAPH_CLIPBOARD_PASTE_MISSING");

    expect(result.pastedNodeIds).toHaveLength(4);
    expect(result.pastedEdgeIds).toHaveLength(2);
    expect(new Set(result.pastedNodeIds).size).toBe(4);
    expect(new Set(result.pastedEdgeIds).size).toBe(2);
    expect(result.pastedNodeIds.every((id) => !snapshot.nodes.some((node) => node.id === id)))
      .toBe(true);
    expect(result.document.edges.slice(-2).every((edge) =>
      result.pastedNodeIds.includes(edge.sourceNodeId) &&
      result.pastedNodeIds.includes(edge.targetNodeId)
    )).toBe(true);
  });

  it("preserves relative layout and applies a deterministic repeated-paste offset", () => {
    const snapshot = capture(["text-a", "image-a"]);
    let sequence = 0;
    const createId = (prefix: string) => `${prefix}-layout-${++sequence}`;
    const first = cloneCreatorCanvasGraphForPaste(
      snapshot,
      createDocument(),
      new Map(),
      { anchor: { x: 1_000, y: 800 }, createId, pasteIndex: 0 }
    );
    if (!first) throw new Error("GRAPH_CLIPBOARD_FIRST_PASTE_MISSING");
    const second = cloneCreatorCanvasGraphForPaste(
      snapshot,
      first.document,
      first.imageComposerDrafts,
      { anchor: { x: 1_000, y: 800 }, createId, pasteIndex: 1 }
    );
    if (!second) throw new Error("GRAPH_CLIPBOARD_SECOND_PASTE_MISSING");

    const firstText = findNode(first.document.nodes, first.pastedNodeIds[0] ?? "");
    const firstImage = findNode(first.document.nodes, first.pastedNodeIds[1] ?? "");
    const secondText = findNode(second.document.nodes, second.pastedNodeIds[0] ?? "");
    expect(firstImage.position.x - firstText.position.x).toBe(180);
    expect(firstImage.position.y - firstText.position.y).toBe(90);
    expect(secondText.position.x - firstText.position.x).toBe(32);
    expect(secondText.position.y - firstText.position.y).toBe(32);
  });

  it("preserves Text data and Image/Video asset references", () => {
    const snapshot = capture();
    const result = paste(snapshot);
    const pastedText = findNode(result.document.nodes, result.pastedNodeIds[0] ?? "");
    const pastedImage = findNode(result.document.nodes, result.pastedNodeIds[1] ?? "");
    const pastedVideo = findNode(result.document.nodes, result.pastedNodeIds[2] ?? "");

    expect(pastedText.kind).toBe("text");
    if (pastedText.kind === "text") expect(pastedText.data.text).toBe("Source text");
    expect(pastedImage.kind).toBe("image");
    if (pastedImage.kind === "image") expect(pastedImage.data.assetId).toBe("asset-image-a");
    expect(pastedVideo.kind).toBe("video");
    if (pastedVideo.kind === "video") expect(pastedVideo.data.assetId).toBe("asset-video-a");
  });

  it("preserves and remaps internal Video Composer references while cloning the draft", () => {
    const sourceVideoDrafts = createVideoDraftMap();
    const snapshot = captureCreatorCanvasGraphClipboard(
      createDocument(),
      new Set(["text-a", "image-a", "video-a"]),
      createDraftMap(),
      sourceVideoDrafts
    );
    if (!snapshot) throw new Error("VIDEO_GRAPH_CLIPBOARD_MISSING");
    const captured = snapshot.videoComposerDrafts.get("video-a");
    expect(captured).toEqual(sourceVideoDrafts.get("video-a"));
    expect(captured).not.toBe(sourceVideoDrafts.get("video-a"));
    sourceVideoDrafts.get("video-a")!.prompt = "mutated source";
    expect(captured?.prompt).toBe("Animate product");

    const result = paste(snapshot);
    const pastedVideoId = result.pastedNodeIds[2];
    const pastedTextId = result.pastedNodeIds[0];
    const pastedImageId = result.pastedNodeIds[1];
    expect(pastedVideoId).toBeDefined();
    const pastedDraft = result.videoComposerDrafts.get(pastedVideoId ?? "");
    expect(pastedDraft).toMatchObject({
      prompt: "Animate product",
      modelId: "video-model",
      mode: "image-to-video",
      promptSeedSourceNodeId: pastedTextId,
      selectedImageReferenceNodeId: pastedImageId
    });
    expect(pastedDraft).not.toBe(captured);
  });

  it("clears external Video Composer references when only the Video node is copied", () => {
    const snapshot = capture(["video-a"]);
    const result = paste(snapshot);
    const pastedDraft = result.videoComposerDrafts.get(result.pastedNodeIds[0] ?? "");
    expect(pastedDraft).toMatchObject({
      prompt: "Animate product",
      selectedImageReferenceNodeId: null,
      promptSeedSourceNodeId: null
    });
    expect(result.pastedEdgeIds).toHaveLength(0);
  });

  it("deep-clones Text AI config and copies internal Text edges", () => {
    const sourceDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [
        {
          id: "text-a",
          kind: "text",
          position: { x: 0, y: 0 },
          data: {
            text: "A",
            ai: { instruction: "Transform A", modelId: "chat-model" }
          }
        },
        {
          id: "text-b",
          kind: "text",
          position: { x: 200, y: 0 },
          data: { text: "B" }
        }
      ],
      edges: [{
        id: "text-chain",
        sourceNodeId: "text-a",
        targetNodeId: "text-b",
        relationship: "reference"
      }],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const snapshot = captureCreatorCanvasGraphClipboard(
      sourceDocument,
      new Set(["text-a", "text-b"]),
      new Map()
    );
    if (!snapshot) throw new Error("GRAPH_CLIPBOARD_TEXT_SNAPSHOT_MISSING");
    const sourceAi = sourceDocument.nodes[0]!.kind === "text"
      ? sourceDocument.nodes[0]!.data.ai
      : undefined;
    const capturedAi = snapshot.nodes[0]!.kind === "text"
      ? snapshot.nodes[0]!.data.ai
      : undefined;
    expect(capturedAi).toEqual(sourceAi);
    expect(capturedAi).not.toBe(sourceAi);

    const result = cloneCreatorCanvasGraphForPaste(
      snapshot,
      sourceDocument,
      new Map(),
      {
        anchor: { x: 800, y: 400 },
        createId: (() => {
          let index = 0;
          return (prefix: string) => `${prefix}-text-test-${++index}`;
        })()
      }
    );
    if (!result) throw new Error("GRAPH_CLIPBOARD_TEXT_PASTE_MISSING");
    const pastedText = findNode(result.document.nodes, result.pastedNodeIds[0] ?? "");
    const pastedSecondText = findNode(result.document.nodes, result.pastedNodeIds[1] ?? "");
    expect(pastedText).toMatchObject({
      kind: "text",
      data: { text: "A", ai: { instruction: "Transform A", modelId: "chat-model" } }
    });
    if (pastedText.kind === "text" && capturedAi) {
      expect(pastedText.data.ai).not.toBe(capturedAi);
    }
    expect(pastedSecondText.kind).toBe("text");
    expect(result.document.edges).toContainEqual(expect.objectContaining({
      sourceNodeId: pastedText.id,
      targetNodeId: pastedSecondText.id
    }));
  });

  it("remaps internal and self draft references, while nulling external references", () => {
    const snapshot = capture();
    const result = paste(snapshot);
    const pastedImageAId = result.pastedNodeIds[1];
    const pastedTextId = result.pastedNodeIds[0];
    const pastedImageBId = result.pastedNodeIds[3];
    if (!pastedImageAId || !pastedTextId || !pastedImageBId) {
      throw new Error("GRAPH_CLIPBOARD_DRAFT_NODE_IDS_MISSING");
    }

    const pastedDraftA = result.imageComposerDrafts.get(pastedImageAId);
    const pastedDraftB = result.imageComposerDrafts.get(pastedImageBId);
    expect(pastedDraftA?.selectedImageReferenceNodeId).toBe(pastedImageAId);
    expect(pastedDraftA?.promptSeedSourceNodeId).toBe(pastedTextId);
    expect(pastedDraftB?.selectedImageReferenceNodeId).toBeNull();
    expect(pastedDraftB?.promptSeedSourceNodeId).toBeNull();
  });

  it("preserves ordinary draft fields and does not mutate source drafts", () => {
    const sourceDrafts = createDraftMap();
    const sourceDraftA = sourceDrafts.get("image-a");
    const snapshot = captureCreatorCanvasGraphClipboard(
      createDocument(),
      new Set(["image-a"]),
      sourceDrafts
    );
    if (!snapshot || !sourceDraftA) throw new Error("GRAPH_CLIPBOARD_DRAFT_MISSING");
    const result = paste(snapshot, createDocument(), sourceDrafts);
    const pastedId = result.pastedNodeIds[0];
    const pastedDraft = pastedId ? result.imageComposerDrafts.get(pastedId) : undefined;
    expect(pastedDraft).toMatchObject({
      prompt: sourceDraftA.prompt,
      modelId: sourceDraftA.modelId,
      aspectRatio: sourceDraftA.aspectRatio,
      count: sourceDraftA.count,
      operation: sourceDraftA.operation,
      promptDirty: sourceDraftA.promptDirty
    });
    expect(sourceDrafts.get("image-a")).toEqual(sourceDraftA);
    expect(snapshot.imageComposerDrafts.get("image-a")).toEqual(sourceDraftA);
  });

  it("keeps repeated pastes unique without reusing the captured source", () => {
    const snapshot = capture(["text-a", "image-a"]);
    let sequence = 0;
    const createId = (prefix: string) => `${prefix}-repeat-${++sequence}`;
    const first = cloneCreatorCanvasGraphForPaste(
      snapshot,
      createDocument(),
      new Map(),
      { anchor: { x: 0, y: 0 }, createId, pasteIndex: 0 }
    );
    if (!first) throw new Error("GRAPH_CLIPBOARD_FIRST_PASTE_MISSING");
    const second = cloneCreatorCanvasGraphForPaste(
      snapshot,
      first.document,
      first.imageComposerDrafts,
      { anchor: { x: 0, y: 0 }, createId, pasteIndex: 1 }
    );
    if (!second) throw new Error("GRAPH_CLIPBOARD_SECOND_PASTE_MISSING");

    expect(new Set([...first.pastedNodeIds, ...second.pastedNodeIds]).size)
      .toBe(first.pastedNodeIds.length + second.pastedNodeIds.length);
    expect(new Set([...first.pastedEdgeIds, ...second.pastedEdgeIds]).size)
      .toBe(first.pastedEdgeIds.length + second.pastedEdgeIds.length);
    expect(snapshot.nodes.map((node) => node.id)).toEqual(["text-a", "image-a"]);
    expect(snapshot.edges.map((edge) => edge.id)).toEqual(["edge-internal-text-image"]);
  });
});
