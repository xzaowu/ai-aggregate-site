import type { AiModelSummary } from "@ai-aggregate/shared";
import { describe, expect, it } from "vitest";
import { resolveSelectedModelDisplayLabel } from "./model-display";

const models: AiModelSummary[] = [
  {
    id: "model_deepseek",
    name: "DeepSeek Internal",
    displayName: "DeepSeek Chat",
    slug: "deepseek-chat",
    provider: "SUB2API",
    modelId: "provider/deepseek-chat",
    capability: "chat",
    group: "reasoning",
    tags: ["reasoning"],
    enabled: true,
    maxReferenceImages: 1,
    creditCost: 1,
    allowGuest: true,
    sortOrder: 0,
    isRecommended: true
  }
];

describe("model display helpers", () => {
  it("does not expose a raw selected model id before models are loaded", () => {
    expect(
      resolveSelectedModelDisplayLabel({
        models,
        selectedModel: "provider/deepseek-chat",
        modelsLoaded: false
      })
    ).toBeNull();
  });

  it("maps a saved selected model id to displayName as soon as models are loaded", () => {
    expect(
      resolveSelectedModelDisplayLabel({
        models,
        selectedModel: "provider/deepseek-chat",
        modelsLoaded: true
      })
    ).toBe("DeepSeek Chat");
  });
});
