import { describe, expect, it } from "vitest";
import {
  createInitialCreatorCanvasDocument,
  type CreatorCanvasDocumentV1
} from "./creator-canvas-document";
import {
  createCreatorImageComposerDraft,
  type CreatorImageComposerDraft
} from "./creator-image-composer";
import {
  createCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";
import {
  areCreatorCanvasPersistedStatesEqual,
  getCreatorCanvasPersistedStateFingerprint,
  parseCreatorCanvasPersistedState,
  serializeCreatorCanvasPersistedState
} from "./creator-canvas-persistence";

function imageDocument(): CreatorCanvasDocumentV1 {
  return {
    ...createInitialCreatorCanvasDocument(),
    nodes: [
      {
        id: "image-1",
        kind: "image",
        position: { x: 12, y: 24 },
        data: { assetId: "asset-1" }
      },
      {
        id: "video-1",
        kind: "video",
        position: { x: 320, y: 24 },
        data: { assetId: "asset-video" }
      },
      {
        id: "text-1",
        kind: "text",
        position: { x: 12, y: 300 },
        data: { text: "A saved canvas" }
      }
    ],
    edges: [
      {
        id: "edge-1",
        sourceNodeId: "image-1",
        targetNodeId: "video-1",
        relationship: "reference"
      }
    ],
    viewport: { x: -40, y: -80, zoom: 0.75 }
  };
}

function draft(overrides: Partial<CreatorImageComposerDraft> = {}): CreatorImageComposerDraft {
  return {
    ...createCreatorImageComposerDraft("image-model"),
    prompt: "saved prompt",
    aspectRatio: "1:1",
    count: 2,
    operation: "edit",
    selectedImageReferenceNodeId: "image-1",
    promptSeedSourceNodeId: "text-1",
    promptDirty: true,
    ...overrides
  };
}

function videoDraft(
  overrides: Partial<CreatorVideoComposerDraft> = {}
): CreatorVideoComposerDraft {
  return {
    ...createCreatorVideoComposerDraft("video-model"),
    prompt: "Animate the saved product",
    mode: "image-to-video",
    selectedImageReferenceNodeId: "image-1",
    promptSeedSourceNodeId: "text-1",
    promptDirty: true,
    ...overrides
  };
}

describe("Creator Canvas persisted state", () => {
  it("round trips document, viewport, asset references, and Composer drafts", () => {
    const document = imageDocument();
    const drafts = new Map([["image-1", draft()] as const]);
    const videoDrafts = new Map([["video-1", videoDraft()] as const]);
    const serialized = serializeCreatorCanvasPersistedState(document, drafts, videoDrafts);

    expect(serialized).toEqual({
      schemaVersion: 2,
      document,
      imageComposerDrafts: { "image-1": draft() },
      videoComposerDrafts: { "video-1": videoDraft() }
    });
    expect(serialized).not.toHaveProperty("history");
    expect(serialized).not.toHaveProperty("selection");
    expect(serialized).not.toHaveProperty("runtime");

    const parsed = parseCreatorCanvasPersistedState(serialized);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.document).toEqual(document);
    expect(parsed.imageComposerDrafts.get("image-1")).toEqual(draft());
    expect(parsed.videoComposerDrafts.get("video-1")).toEqual(videoDraft());
    expect(parsed.state.document.nodes.find((node) => node.kind === "video")?.data).toEqual({
      assetId: "asset-video"
    });
  });

  it("uses a stable fingerprint and includes draft and viewport changes", () => {
    const document = imageDocument();
    const firstDrafts = new Map([
      ["image-1", draft()],
      ["missing", draft({ prompt: "pruned" })]
    ] as const);
    const reorderedDrafts = new Map([
      ["missing", draft({ prompt: "pruned" })],
      ["image-1", draft()]
    ] as const);

    expect(getCreatorCanvasPersistedStateFingerprint(document, firstDrafts)).toBe(
      getCreatorCanvasPersistedStateFingerprint(document, reorderedDrafts)
    );

    const draftEdited = new Map([
      ["image-1", draft({ prompt: "new prompt" })] as const
    ]);
    expect(getCreatorCanvasPersistedStateFingerprint(document, draftEdited)).not.toBe(
      getCreatorCanvasPersistedStateFingerprint(document, firstDrafts)
    );

    const viewportChanged = { ...document, viewport: { x: 0, y: 0, zoom: 1 } };
    expect(getCreatorCanvasPersistedStateFingerprint(viewportChanged, firstDrafts)).not.toBe(
      getCreatorCanvasPersistedStateFingerprint(document, firstDrafts)
    );

    const left = serializeCreatorCanvasPersistedState(document, firstDrafts);
    const right = serializeCreatorCanvasPersistedState(document, reorderedDrafts);
    expect(areCreatorCanvasPersistedStatesEqual(left, right)).toBe(true);

    const videoEdited = new Map([["video-1", videoDraft({ prompt: "another" })] as const]);
    expect(getCreatorCanvasPersistedStateFingerprint(document, firstDrafts, videoEdited)).not.toBe(
      getCreatorCanvasPersistedStateFingerprint(document, firstDrafts)
    );

    const v1 = {
      schemaVersion: 1 as const,
      document,
      imageComposerDrafts: { "image-1": draft() }
    };
    const parsedV1 = parseCreatorCanvasPersistedState(v1);
    expect(parsedV1.ok).toBe(true);
    if (parsedV1.ok) {
      expect(parsedV1.state.schemaVersion).toBe(2);
      expect(parsedV1.videoComposerDrafts.size).toBe(0);
      expect(getCreatorCanvasPersistedStateFingerprint(document, parsedV1.imageComposerDrafts)).toBe(
        getCreatorCanvasPersistedStateFingerprint(document, parsedV1.imageComposerDrafts, new Map())
      );
    }
  });

  it("fails safely for malformed schema or document and prunes missing-node drafts", () => {
    const serialized = serializeCreatorCanvasPersistedState(
      imageDocument(),
      new Map([["image-1", draft()] as const])
    );

    const wrongVersion = parseCreatorCanvasPersistedState({
      ...serialized,
      schemaVersion: 3
    });
    expect(wrongVersion).toMatchObject({ ok: false });

    const legacyWithExtraKey = parseCreatorCanvasPersistedState({
      schemaVersion: 1,
      document: serialized.document,
      imageComposerDrafts: serialized.imageComposerDrafts,
      extra: true
    });
    expect(legacyWithExtraKey).toMatchObject({ ok: false });

    const missingVideoDrafts = parseCreatorCanvasPersistedState({
      schemaVersion: 2,
      document: serialized.document,
      imageComposerDrafts: serialized.imageComposerDrafts
    });
    expect(missingVideoDrafts).toMatchObject({ ok: false });

    const malformedVideoDraft = parseCreatorCanvasPersistedState({
      ...serialized,
      videoComposerDrafts: { "video-1": { ...videoDraft(), mode: "unsupported" } }
    });
    expect(malformedVideoDraft).toMatchObject({ ok: false });

    const malformedDocument = parseCreatorCanvasPersistedState({
      ...serialized,
      document: { ...serialized.document, version: 2 }
    });
    expect(malformedDocument).toMatchObject({ ok: false });

    const withMissingDraft = parseCreatorCanvasPersistedState({
      ...serialized,
      imageComposerDrafts: {
        ...serialized.imageComposerDrafts,
        missing: draft({ prompt: "must prune" })
      }
    });
    expect(withMissingDraft.ok).toBe(true);
    if (!withMissingDraft.ok) return;
    expect(withMissingDraft.imageComposerDrafts.has("missing")).toBe(false);
    expect(withMissingDraft.state.imageComposerDrafts).toEqual({
      "image-1": draft()
    });

    const withOrphanVideoDraft = parseCreatorCanvasPersistedState({
      ...serialized,
      videoComposerDrafts: {
        "video-1": videoDraft(),
        missing: videoDraft({ prompt: "must prune" }),
        "image-1": videoDraft({ prompt: "wrong node kind" })
      }
    });
    expect(withOrphanVideoDraft.ok).toBe(true);
    if (!withOrphanVideoDraft.ok) return;
    expect(withOrphanVideoDraft.videoComposerDrafts.has("missing")).toBe(false);
    expect(withOrphanVideoDraft.videoComposerDrafts.has("image-1")).toBe(false);
    expect(withOrphanVideoDraft.state.videoComposerDrafts).toEqual({
      "video-1": videoDraft()
    });
  });
});
