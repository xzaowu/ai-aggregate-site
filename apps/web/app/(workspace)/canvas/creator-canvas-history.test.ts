import { describe, expect, it } from "vitest";
import {
  CREATOR_CANVAS_HISTORY_LIMIT,
  CreatorCanvasHistory,
  areCreatorCanvasHistorySnapshotsSemanticallyEqual,
  createCreatorCanvasHistorySnapshot
} from "./creator-canvas-history";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import { createCreatorImageComposerDraft } from "./creator-image-composer";
import {
  createCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";

function documentWith(
  text = "",
  viewport = { x: 0, y: 0, zoom: 1 }
): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "text-1",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text }
      }
    ],
    edges: [],
    viewport
  };
}

function snapshot(
  document: CreatorCanvasDocumentV1,
  drafts: ReadonlyMap<string, ReturnType<typeof createCreatorImageComposerDraft>> = new Map(),
  videoDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
) {
  return createCreatorCanvasHistorySnapshot(document, drafts, videoDrafts);
}

function textNode(document: CreatorCanvasDocumentV1) {
  const node = document.nodes[0];
  if (!node || node.kind !== "text") throw new Error("TEXT_NODE_MISSING");
  return node;
}

describe("CreatorCanvasHistory", () => {
  it("starts without undo or redo", () => {
    const history = new CreatorCanvasHistory();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.pastLength).toBe(0);
    expect(history.futureLength).toBe(0);
  });

  it("records an atomic change and restores it in both directions", () => {
    const history = new CreatorCanvasHistory();
    const before = snapshot(documentWith("before"));
    const after = snapshot(documentWith("after"));

    expect(history.record(before, after)).toBe(true);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    const undone = history.undo(snapshot(after.document, after.imageComposerDrafts));
    expect(undone?.document.nodes[0]?.data).toEqual({ text: "before" });
    expect(undone?.document.viewport).toEqual(after.document.viewport);
    expect(history.canRedo).toBe(true);

    const redone = history.redo(undone!);
    expect(redone?.document.nodes[0]?.data).toEqual({ text: "after" });
    expect(history.canUndo).toBe(true);
  });

  it("deep-clones Text AI config and preserves it through Undo/Redo", () => {
    const beforeDocument = documentWith("old output");
    textNode(beforeDocument).data.ai = {
      instruction: "Rewrite the source",
      modelId: "chat-model"
    };
    const afterDocument = documentWith("generated output");
    textNode(afterDocument).data.ai = {
      instruction: "Rewrite the source",
      modelId: "chat-model"
    };
    const before = snapshot(beforeDocument);
    const after = snapshot(afterDocument);

    expect(textNode(before.document).data.ai).toEqual({
      instruction: "Rewrite the source",
      modelId: "chat-model"
    });
    expect(textNode(before.document).data.ai).not.toBe(textNode(beforeDocument).data.ai);
    textNode(beforeDocument).data.ai!.instruction = "mutated source";
    expect(textNode(before.document).data.ai?.instruction).toBe("Rewrite the source");

    const history = new CreatorCanvasHistory();
    expect(history.record(before, after)).toBe(true);
    const undone = history.undo(after);
    expect(undone).not.toBeNull();
    if (!undone) throw new Error("UNDO_SNAPSHOT_MISSING");
    expect(textNode(undone.document).data).toEqual({
      text: "old output",
      ai: { instruction: "Rewrite the source", modelId: "chat-model" }
    });
    const redone = history.redo(undone!);
    expect(redone).not.toBeNull();
    if (!redone) throw new Error("REDO_SNAPSHOT_MISSING");
    expect(textNode(redone.document).data).toEqual({
      text: "generated output",
      ai: { instruction: "Rewrite the source", modelId: "chat-model" }
    });
  });

  it("deep-clones Video Composer drafts and carries them through Undo/Redo and interleave", () => {
    const beforeDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "video-1",
        kind: "video",
        position: { x: 0, y: 0 },
        data: { assetId: null }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const videoDraft = {
      ...createCreatorVideoComposerDraft("video-model"),
      prompt: "Animate the product",
      mode: "image-to-video" as const,
      selectedImageReferenceNodeId: "image-1",
      promptSeedSourceNodeId: "text-1",
      promptDirty: true
    };
    const before = snapshot(beforeDocument, new Map(), new Map([["video-1", videoDraft]]));
    const afterDocument: CreatorCanvasDocumentV1 = {
      ...beforeDocument,
      nodes: [{
        id: "video-1",
        kind: "video",
        position: { x: 0, y: 0 },
        data: { assetId: "asset-video" }
      }]
    };
    const after = snapshot(afterDocument, new Map(), new Map([["video-1", videoDraft]]));
    expect(before.videoComposerDrafts.get("video-1")).toEqual(videoDraft);
    expect(before.videoComposerDrafts.get("video-1")).not.toBe(videoDraft);
    videoDraft.prompt = "mutated after snapshot";
    expect(before.videoComposerDrafts.get("video-1")?.prompt).toBe("Animate the product");

    const history = new CreatorCanvasHistory();
    expect(history.record(before, after)).toBe(true);
    const undone = history.undo(after);
    expect(undone?.videoComposerDrafts.get("video-1")?.prompt).toBe("Animate the product");
    const redone = history.redo(undone!);
    expect(redone?.videoComposerDrafts.get("video-1")?.selectedImageReferenceNodeId)
      .toBe("image-1");

    const live = snapshot(afterDocument, new Map(), new Map([[
      "video-1",
      { ...videoDraft, prompt: "live draft" }
    ]]));
    history.beginTransaction(live);
    const interleaved = history.interleaveOpenTransaction(live, (current) => ({
      snapshot: snapshot({
        ...current.document,
        nodes: current.document.nodes.map((node) =>
          node.id === "video-1" && node.kind === "video"
            ? { ...node, data: { assetId: "asset-result" } }
            : node
        )
      }, current.imageComposerDrafts, current.videoComposerDrafts),
      value: null
    }));
    expect(interleaved?.current.videoComposerDrafts.get("video-1")?.prompt).toBe("live draft");
    expect(history.hasOpenTransaction).toBe(true);
  });

  it("preserves the current viewport while undoing and redoing semantic content", () => {
    const history = new CreatorCanvasHistory();
    const before = snapshot(documentWith("before", { x: 0, y: 0, zoom: 1 }));
    const after = snapshot(documentWith("after", { x: 10, y: 20, zoom: 1.5 }));
    history.record(before, after);

    const current = snapshot(documentWith("after", { x: 90, y: -40, zoom: 0.75 }));
    const undone = history.undo(current);
    expect(undone?.document.nodes[0]?.data).toEqual({ text: "before" });
    expect(undone?.document.viewport).toEqual(current.document.viewport);

    const currentAfterUndo = snapshot(documentWith("before", { x: -12, y: 30, zoom: 1.25 }));
    const redone = history.redo(currentAfterUndo);
    expect(redone?.document.nodes[0]?.data).toEqual({ text: "after" });
    expect(redone?.document.viewport).toEqual(currentAfterUndo.document.viewport);
  });

  it("clears redo after a new committed mutation and ignores semantic no-ops", () => {
    const history = new CreatorCanvasHistory();
    const first = snapshot(documentWith("first"));
    const second = snapshot(documentWith("second"));
    const third = snapshot(documentWith("third"));

    expect(history.record(first, second)).toBe(true);
    expect(history.undo(second)).not.toBeNull();
    expect(history.canRedo).toBe(true);
    expect(history.record(first, third)).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.record(third, snapshot(documentWith("third", { x: 2, y: 3, zoom: 1.2 })))).toBe(false);
    expect(history.pastLength).toBe(1);
  });

  it("keeps at most 100 committed steps", () => {
    const history = new CreatorCanvasHistory();
    for (let index = 0; index < CREATOR_CANVAS_HISTORY_LIMIT + 7; index += 1) {
      history.record(
        snapshot(documentWith(`before-${index}`)),
        snapshot(documentWith(`after-${index}`))
      );
    }

    expect(history.pastLength).toBe(CREATOR_CANVAS_HISTORY_LIMIT);
  });

  it("coalesces live transaction updates into one committed step", () => {
    const history = new CreatorCanvasHistory();
    const before = snapshot(documentWith(""));
    expect(history.beginTransaction(before)).toBe(true);
    expect(history.updateTransaction(snapshot(documentWith("a")))).toBe(true);
    expect(history.updateTransaction(snapshot(documentWith("ab")))).toBe(true);
    expect(history.commitTransaction(snapshot(documentWith("abc")))).toBe(true);
    expect(history.pastLength).toBe(1);
    expect(history.undo(snapshot(documentWith("abc")))?.document.nodes[0]?.data)
      .toEqual({ text: "" });
  });

  it("does not record an empty transaction", () => {
    const history = new CreatorCanvasHistory();
    const before = snapshot(documentWith("same"));

    expect(history.beginTransaction(before)).toBe(true);
    expect(history.commitTransaction(snapshot(documentWith("same")))).toBe(false);
    expect(history.pastLength).toBe(0);
    expect(history.hasOpenTransaction).toBe(false);
  });

  it("restores Composer drafts and treats Result-style snapshots as local data", () => {
    const history = new CreatorCanvasHistory();
    const draft = {
      ...createCreatorImageComposerDraft("model-a"),
      prompt: "keep this draft",
      aspectRatio: "16:9" as const,
      count: 4 as const,
      operation: "edit" as const
    };
    const beforeDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "image-1",
        kind: "image",
        position: { x: 10, y: 20 },
        data: { assetId: null }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const resultDocument: CreatorCanvasDocumentV1 = {
      ...beforeDocument,
      nodes: [{
        id: "image-1",
        kind: "image",
        position: { x: 10, y: 20 },
        data: { assetId: "asset-result" }
      }, {
        id: "image-sibling",
        kind: "image",
        position: { x: 400, y: 20 },
        data: { assetId: "asset-sibling" }
      }]
    };
    const before = snapshot(beforeDocument, new Map([["image-1", draft]]));
    const after = snapshot(resultDocument, new Map([["image-1", draft]]));
    expect(history.record(before, after)).toBe(true);

    const undone = history.undo(after);
    expect(undone?.document.nodes).toHaveLength(1);
    expect(undone?.document.nodes[0]?.data).toEqual({ assetId: null });
    expect(undone?.imageComposerDrafts.get("image-1")).toEqual(draft);
    expect(undone?.document.nodes).not.toContainEqual(expect.objectContaining({
      data: { assetId: "asset-sibling" }
    }));
    expect(areCreatorCanvasHistorySnapshotsSemanticallyEqual(
      undone!,
      before
    )).toBe(true);
  });

  it("keeps the current draft for a surviving node across structural undo and redo", () => {
    const draftA = {
      ...createCreatorImageComposerDraft("model-a"),
      prompt: "draft A"
    };
    const draftB = {
      ...draftA,
      prompt: "draft B"
    };
    const beforeDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "image-surviving",
        kind: "image",
        position: { x: 0, y: 0 },
        data: { assetId: null }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const afterDocument: CreatorCanvasDocumentV1 = {
      ...beforeDocument,
      nodes: [
        ...beforeDocument.nodes,
        {
          id: "text-added",
          kind: "text",
          position: { x: 200, y: 0 },
          data: { text: "added" }
        }
      ]
    };
    const history = new CreatorCanvasHistory();
    const before = snapshot(beforeDocument, new Map([["image-surviving", draftA]]));
    const after = snapshot(afterDocument, new Map([["image-surviving", draftB]]));
    history.record(before, after);

    const undone = history.undo(after);
    expect(undone?.document.nodes.map((node) => node.id)).toEqual(["image-surviving"]);
    expect(undone?.imageComposerDrafts.get("image-surviving")).toEqual(draftB);

    const redone = history.redo(undone!);
    expect(redone?.document.nodes.map((node) => node.id)).toEqual([
      "image-surviving",
      "text-added"
    ]);
    expect(redone?.imageComposerDrafts.get("image-surviving")).toEqual(draftB);
  });

  it("restores the historical draft when undo resurrects an Image node", () => {
    const draft = {
      ...createCreatorImageComposerDraft("model-a"),
      prompt: "resurrected draft",
      aspectRatio: "16:9" as const,
      count: 4 as const,
      operation: "edit" as const
    };
    const beforeDocument = documentWith("before");
    const afterDocument: CreatorCanvasDocumentV1 = {
      ...beforeDocument,
      nodes: [
        ...beforeDocument.nodes,
        {
          id: "image-added",
          kind: "image",
          position: { x: 200, y: 0 },
          data: { assetId: null }
        }
      ]
    };
    const history = new CreatorCanvasHistory();
    const before = snapshot(beforeDocument);
    const after = snapshot(afterDocument);
    history.record(before, after);

    const edited = snapshot(afterDocument, new Map([["image-added", draft]]));
    const undone = history.undo(edited);
    expect(undone?.document.nodes.map((node) => node.id)).toEqual(["text-1"]);
    expect(undone?.imageComposerDrafts.size).toBe(0);

    const redone = history.redo(undone!);
    expect(redone?.imageComposerDrafts.get("image-added")).toEqual(draft);
  });

  it("interleaves an atomic mutation without closing the open transaction", () => {
    const beforeDocument = documentWith("");
    const liveDocument = documentWith("ab");
    const resultNode = {
      id: "result-image",
      kind: "image" as const,
      position: { x: 200, y: 0 },
      data: { assetId: "asset-result" }
    };
    const history = new CreatorCanvasHistory();
    const before = snapshot(beforeDocument);
    const live = snapshot(liveDocument);
    history.beginTransaction(before);
    history.updateTransaction(live);

    const interleaved = history.interleaveOpenTransaction(live, (current) => ({
      snapshot: snapshot({
        ...current.document,
        nodes: [...current.document.nodes, resultNode]
      }, current.imageComposerDrafts),
      value: current.document.nodes.length
    }));
    expect(interleaved?.recorded).toBe(true);
    expect(interleaved?.current.document.nodes).toHaveLength(2);
    expect(interleaved?.current.document.nodes[0]?.data).toEqual({ text: "ab" });
    expect(history.hasOpenTransaction).toBe(true);
    expect(history.pastLength).toBe(1);

    const final = snapshot({
      ...interleaved!.current.document,
      nodes: interleaved!.current.document.nodes.map((node) =>
        node.id === "text-1" && node.kind === "text"
          ? { ...node, data: { text: "abc" } }
          : node
      )
    });
    expect(history.commitTransaction(final)).toBe(true);
    expect(history.pastLength).toBe(2);

    const undoneInteraction = history.undo(final);
    expect(undoneInteraction?.document.nodes[0]?.data).toEqual({ text: "" });
    expect(undoneInteraction?.document.nodes).toHaveLength(2);
    const undoneResult = history.undo(undoneInteraction!);
    expect(undoneResult?.document.nodes).toHaveLength(1);
    expect(undoneResult?.document.nodes[0]?.data).toEqual({ text: "" });
    expect(history.redo(undoneResult!)?.document.nodes).toHaveLength(2);
  });
});
