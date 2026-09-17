import type { AiModelSummary } from "@ai-aggregate/shared";
import { describe, expect, it } from "vitest";
import {
  compileCreatorTextAiPrompt,
  filterCreatorTextAiModels,
  getCreatorTextAiEffectiveModelId,
  getCreatorTextAiIncomingTextOutputs,
  parseCreatorTextAiCompletionResponse,
  resolveCreatorTextAiModel,
  validateCreatorTextAiExecution
} from "./creator-text-ai";
import type {
  CreatorCanvasDocumentV1,
  CreatorContentNode
} from "./creator-canvas-document";

function model(
  modelId: string,
  overrides: Partial<AiModelSummary> = {}
): AiModelSummary {
  return {
    id: `id-${modelId}`,
    name: modelId,
    displayName: modelId,
    slug: modelId,
    provider: "SUB2API",
    modelId,
    enabled: true,
    maxReferenceImages: 0,
    creditCost: 1,
    allowGuest: false,
    sortOrder: 0,
    description: "",
    group: "test",
    tags: ["chat"],
    shortDescription: "",
    isRecommended: false,
    capability: "chat",
    displaySurfaces: ["chat"],
    ...overrides
  };
}

function textNode(
  id: string,
  text: string,
  position = { x: 0, y: 0 }
): CreatorContentNode {
  return { id, kind: "text", position, data: { text } };
}

function aiDocument(
  nodes: CreatorContentNode[],
  edges: CreatorCanvasDocumentV1["edges"] = []
): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

describe("Creator Text AI helper", () => {
  it("compiles zero, one, and multiple incoming Text outputs deterministically", () => {
    const zero = aiDocument([textNode("target", "old output")]);
    expect(compileCreatorTextAiPrompt(zero, "target", "  Rewrite it  ")).toBe(
      "context:\n\ninstruction:\nRewrite it"
    );

    const one = aiDocument([
      textNode("source", "source output"),
      textNode("target", "old output")
    ], [{
      id: "source-target",
      sourceNodeId: "source",
      targetNodeId: "target",
      relationship: "reference"
    }]);
    expect(getCreatorTextAiIncomingTextOutputs(one, "target")).toEqual([
      "source output"
    ]);
    expect(compileCreatorTextAiPrompt(one, "target", "Create a title")).toBe(
      "context:\n[1]\nsource output\n\ninstruction:\nCreate a title"
    );

    const multiple = aiDocument([
      textNode("source-a", "A"),
      textNode("source-b", "B"),
      textNode("target", "old output")
    ], [
      {
        id: "edge-b",
        sourceNodeId: "source-b",
        targetNodeId: "target",
        relationship: "reference"
      },
      {
        id: "edge-a",
        sourceNodeId: "source-a",
        targetNodeId: "target",
        relationship: "reference"
      }
    ]);
    expect(getCreatorTextAiIncomingTextOutputs(multiple, "target")).toEqual([
      "B",
      "A"
    ]);
    expect(compileCreatorTextAiPrompt(multiple, "target", "Combine them")).toBe(
      "context:\n[1]\nB\n\n[2]\nA\n\ninstruction:\nCombine them"
    );
  });

  it("excludes blank upstream Text and ignores Image/Video inputs", () => {
    const document = aiDocument([
      textNode("blank", "  \n"),
      textNode("source", "kept"),
      { id: "image", kind: "image", position: { x: 0, y: 0 }, data: { assetId: "asset" } },
      { id: "video", kind: "video", position: { x: 0, y: 0 }, data: { assetId: "asset" } },
      textNode("target", "old")
    ], [
      { id: "blank-edge", sourceNodeId: "blank", targetNodeId: "target", relationship: "reference" },
      { id: "image-edge", sourceNodeId: "image", targetNodeId: "target", relationship: "reference" },
      { id: "source-edge", sourceNodeId: "source", targetNodeId: "target", relationship: "reference" },
      { id: "video-edge", sourceNodeId: "video", targetNodeId: "target", relationship: "reference" }
    ]);

    expect(getCreatorTextAiIncomingTextOutputs(document, "target")).toEqual(["kept"]);
    expect(compileCreatorTextAiPrompt(document, "target", "Use context")).toBe(
      "context:\n[1]\nkept\n\ninstruction:\nUse context"
    );
  });

  it("does not mutate source inputs while compiling", () => {
    const document = aiDocument([
      textNode("source", "Source"),
      textNode("target", "Target")
    ], [{
      id: "edge",
      sourceNodeId: "source",
      targetNodeId: "target",
      relationship: "reference"
    }]);
    const before = JSON.stringify(document);

    compileCreatorTextAiPrompt(document, "target", "  Instruction  ");

    expect(JSON.stringify(document)).toBe(before);
  });

  it("validates bounded executable state and rejects blank instruction or model", () => {
    expect(validateCreatorTextAiExecution({ instruction: "  ", modelId: "chat" })).toEqual({
      ok: false,
      reason: "blank-instruction"
    });
    expect(validateCreatorTextAiExecution({ instruction: "Rewrite", modelId: null })).toEqual({
      ok: false,
      reason: "no-model"
    });
    expect(validateCreatorTextAiExecution({ instruction: " Rewrite ", modelId: " chat " })).toEqual({
      ok: true,
      modelId: "chat"
    });
  });

  it("filters chat-surface models and reconciles saved, stale, and missing choices", () => {
    const available = model("available");
    const second = model("second", { sortOrder: 1 });
    const filtered = filterCreatorTextAiModels([
      available,
      second,
      model("disabled", { enabled: false }),
      model("image", { capability: "image", displaySurfaces: ["image"] }),
      model("other-surface", { displaySurfaces: ["image"] })
    ]);

    expect(filtered).toEqual([available, second]);
    expect(resolveCreatorTextAiModel("second", filtered)).toBe(second);
    expect(getCreatorTextAiEffectiveModelId("second", filtered)).toBe("second");
    expect(getCreatorTextAiEffectiveModelId("stale", filtered)).toBe("available");
    expect(getCreatorTextAiEffectiveModelId(undefined, filtered)).toBe("available");
    expect(getCreatorTextAiEffectiveModelId("stale", [])).toBeNull();
  });

  it("rejects malformed and blank completion payloads while parsing valid output", () => {
    expect(parseCreatorTextAiCompletionResponse(null)).toEqual({
      ok: false,
      reason: "malformed"
    });
    expect(parseCreatorTextAiCompletionResponse({ content: 3 })).toEqual({
      ok: false,
      reason: "malformed"
    });
    expect(parseCreatorTextAiCompletionResponse({ content: "  \n" })).toEqual({
      ok: false,
      reason: "blank"
    });
    expect(parseCreatorTextAiCompletionResponse({ content: "  generated output  " })).toEqual({
      ok: true,
      content: "generated output"
    });
  });
});
