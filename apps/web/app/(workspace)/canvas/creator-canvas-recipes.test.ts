import { describe, expect, it } from "vitest";
import { createTranslator } from "../../../lib/i18n/use-i18n";
import { parseCreatorCanvasDocument } from "./creator-canvas-document";
import {
  createCreatorCanvasRecipeSnapshot,
  CREATOR_CANVAS_RECIPE_DEFINITIONS,
  PRODUCT_AD_SHORT_VIDEO_RECIPE,
  type CreatorCanvasRecipeIdFactory
} from "./creator-canvas-recipes";
import {
  parseCreatorCanvasPersistedState,
  serializeCreatorCanvasPersistedState
} from "./creator-canvas-persistence";

function createDeterministicIdFactory(): CreatorCanvasRecipeIdFactory {
  let sequence = 0;
  return (prefix) => `${prefix}-${++sequence}`;
}

function createRecipeInstructions(locale: "en-US" | "zh-CN") {
  const t = createTranslator(locale);
  return {
    creative: t(PRODUCT_AD_SHORT_VIDEO_RECIPE.creativeInstructionKey),
    keyframe: t(PRODUCT_AD_SHORT_VIDEO_RECIPE.keyframeInstructionKey),
    motion: t(PRODUCT_AD_SHORT_VIDEO_RECIPE.motionInstructionKey)
  };
}

function createRecipe(
  locale: "en-US" | "zh-CN" = "en-US",
  createId?: CreatorCanvasRecipeIdFactory
) {
  const options = {
    instructions: createRecipeInstructions(locale),
    ...(createId ? { createId } : {})
  };
  return createCreatorCanvasRecipeSnapshot(
    PRODUCT_AD_SHORT_VIDEO_RECIPE.id,
    options
  );
}

function nodeLabel(node: { kind: string; position: { x: number; y: number } }): string {
  return `${node.kind}:${node.position.x}:${node.position.y}`;
}

function hasCycle(
  nodeIds: readonly string[],
  edges: readonly { sourceNodeId: string; targetNodeId: string }[]
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) adjacency.set(nodeId, []);
  for (const edge of edges) adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);

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
  return nodeIds.some(visit);
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (value instanceof Map) {
    for (const [key, nested] of value) {
      keys.push(String(key));
      collectKeys(nested, keys);
    }
    return keys;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (typeof value !== "object" || value === null) return keys;
  for (const [key, nested] of Object.entries(value)) {
    keys.push(key);
    collectKeys(nested, keys);
  }
  return keys;
}

describe("Creator Canvas recipes", () => {
  it("registers only the curated product-ad short-video recipe", () => {
    expect(CREATOR_CANVAS_RECIPE_DEFINITIONS).toHaveLength(1);
    expect(CREATOR_CANVAS_RECIPE_DEFINITIONS[0]?.id)
      .toBe("product-ad-short-video");
  });

  it("creates the exact six-node, six-edge acyclic reference graph", () => {
    const snapshot = createRecipe("en-US", createDeterministicIdFactory());
    const { document } = snapshot;

    expect(document.nodes).toHaveLength(6);
    expect(document.edges).toHaveLength(6);
    expect(document.nodes.filter((node) => node.kind === "text")).toHaveLength(4);
    expect(document.nodes.filter((node) => node.kind === "image")).toHaveLength(1);
    expect(document.nodes.filter((node) => node.kind === "video")).toHaveLength(1);

    const nodeByLabel = new Map(document.nodes.map((node) => [nodeLabel(node), node]));
    const brief = nodeByLabel.get("text:0:0");
    const creative = nodeByLabel.get("text:380:0");
    const keyframe = nodeByLabel.get("text:760:-160");
    const image = nodeByLabel.get("image:1140:-160");
    const motion = nodeByLabel.get("text:760:220");
    const video = nodeByLabel.get("video:1140:220");
    if (!brief || !creative || !keyframe || !image || !motion || !video) {
      throw new Error("RECIPE_NODE_LAYOUT_MISSING");
    }

    expect(document.edges.map((edge) => [
      edge.sourceNodeId,
      edge.targetNodeId,
      edge.relationship
    ])).toEqual([
      [brief.id, creative.id, "reference"],
      [creative.id, keyframe.id, "reference"],
      [keyframe.id, image.id, "reference"],
      [creative.id, motion.id, "reference"],
      [motion.id, video.id, "reference"],
      [image.id, video.id, "reference"]
    ]);
    expect(hasCycle(
      document.nodes.map((node) => node.id),
      document.edges
    )).toBe(false);
    expect(document.edges.every((edge) =>
      document.nodes.some((node) => node.id === edge.sourceNodeId) &&
      document.nodes.some((node) => node.id === edge.targetNodeId)
    )).toBe(true);
  });

  it("keeps semantic defaults, localized instructions, and only the Video draft", () => {
    const english = createRecipe("en-US");
    const chinese = createRecipe("zh-CN");
    const englishAiNodes = english.document.nodes.filter(
      (node): node is Extract<typeof english.document.nodes[number], { kind: "text" }> =>
        node.kind === "text" && node.data.ai !== undefined
    );
    const chineseAiNodes = chinese.document.nodes.filter(
      (node): node is Extract<typeof chinese.document.nodes[number], { kind: "text" }> =>
        node.kind === "text" && node.data.ai !== undefined
    );
    expect(englishAiNodes).toHaveLength(3);
    expect(chineseAiNodes).toHaveLength(3);
    const englishInstructions = englishAiNodes.map((node) => node.data.ai?.instruction ?? "");
    const chineseInstructions = chineseAiNodes.map((node) => node.data.ai?.instruction ?? "");
    expect(englishInstructions).not.toEqual(chineseInstructions);
    expect(englishInstructions.every((instruction) => instruction.trim().length > 0)).toBe(true);
    expect(englishAiNodes.every((node) => node.data.text === "" && node.data.ai?.modelId === ""))
      .toBe(true);

    const brief = english.document.nodes.find(
      (node) => node.kind === "text" && node.position.x === 0
    );
    const image = english.document.nodes.find((node) => node.kind === "image");
    const video = english.document.nodes.find((node) => node.kind === "video");
    if (!brief || brief.kind !== "text" || !image || image.kind !== "image" || !video || video.kind !== "video") {
      throw new Error("RECIPE_DEFAULT_NODE_MISSING");
    }
    expect(brief.data).toEqual({ text: "" });
    expect(image.data.assetId).toBeNull();
    expect(video.data.assetId).toBeNull();
    expect(english.imageComposerDrafts.size).toBe(0);
    expect(Array.from(english.videoComposerDrafts.keys())).toEqual([video.id]);
    expect(english.videoComposerDrafts.get(video.id)).toEqual({
      prompt: "",
      modelId: "",
      mode: "image-to-video",
      selectedImageReferenceNodeId: null,
      promptSeedSourceNodeId: null,
      promptDirty: false
    });
  });

  it("passes the existing document parser and strict V2 serialize/parse round-trip", () => {
    const snapshot = createRecipe("en-US", createDeterministicIdFactory());
    const parsedDocument = parseCreatorCanvasDocument(snapshot.document);
    expect(parsedDocument.ok).toBe(true);
    const persisted = serializeCreatorCanvasPersistedState(
      snapshot.document,
      snapshot.imageComposerDrafts,
      snapshot.videoComposerDrafts
    );
    const parsedState = parseCreatorCanvasPersistedState(persisted);
    expect(parsedState.ok).toBe(true);
    if (!parsedState.ok) throw new Error("RECIPE_PERSISTED_STATE_INVALID");
    expect(parsedState.state).toEqual(persisted);
    expect(parsedState.videoComposerDrafts.size).toBe(1);
    expect(parsedState.imageComposerDrafts.size).toBe(0);
  });

  it("generates fresh node and edge identity for each instance", () => {
    const first = createRecipe();
    const second = createRecipe();
    const firstIds = new Set([
      ...first.document.nodes.map((node) => node.id),
      ...first.document.edges.map((edge) => edge.id)
    ]);
    const secondIds = [
      ...second.document.nodes.map((node) => node.id),
      ...second.document.edges.map((edge) => edge.id)
    ];
    expect(secondIds.every((id) => !firstIds.has(id))).toBe(true);
  });

  it("contains no persisted recipe identity or runtime/provider/task/url/binary data", () => {
    const snapshot = createRecipe();
    const keys = collectKeys(snapshot);
    const forbiddenKeys = [
      "recipeId",
      "providerId",
      "routeId",
      "providerAccount",
      "taskId",
      "idempotencyKey",
      "progress",
      "executionStatus",
      "abortController",
      "runtimeGeneration",
      "blob",
      "file",
      "base64",
      "dataUrl",
      "externalUrl",
      "ownerPrivateUrl",
      "userIdentity",
      "storageObject"
    ];
    expect(keys.some((key) => forbiddenKeys.includes(key))).toBe(false);
    expect(Object.keys(snapshot)).toEqual([
      "document",
      "imageComposerDrafts",
      "videoComposerDrafts"
    ]);
    expect(snapshot.document.viewport.zoom).toBeGreaterThanOrEqual(0.25);
    expect(snapshot.document.viewport.zoom).toBeLessThanOrEqual(2);
  });
});
