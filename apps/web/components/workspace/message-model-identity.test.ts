import { describe, it, expect } from "vitest";
import { resolveModelIdentity } from "./message-model-identity";
import { createDemoModels, type AiModelSummary } from "@ai-aggregate/shared";

const demoModels = createDemoModels();

describe("resolveModelIdentity", () => {
  it("returns a neutral fallback when model field is undefined", () => {
    const result = resolveModelIdentity(undefined, demoModels);
    expect(result.displayName).toBe("AI Assistant");
    expect(result.color).toBe("#4f46e5");
    expect(result.model).toBeNull();
  });

  it("resolves from matched model by modelId", () => {
    const model = demoModels[0];
    if (!model) return;
    const result = resolveModelIdentity(model.modelId, demoModels);
    expect(result.displayName).toBe(model.displayName || model.name);
    expect(result.model).toBe(model);
  });

  it("does not expose an unmatched raw model ID", () => {
    const result = resolveModelIdentity("deepseek-ai/unknown-model", []);
    expect(result.displayName).toBe("DeepSeek");
    expect(result.color).toBe("#4f46e5");
  });

  it("detects deepseek family icon", () => {
    const result = resolveModelIdentity("deepseek-ai/some-model", []);
    expect(result.displayName).toBe("DeepSeek");
    expect(result.color).toBe("#4f46e5");
  });

  it("detects openai family icon", () => {
    const result = resolveModelIdentity("openai/gpt-4", []);
    expect(result.displayName).toBe("GPT-4");
    expect(result.color).toBe("#10a37f");
  });

  it("detects claude family icon", () => {
    const result = resolveModelIdentity("anthropic/claude-3", []);
    expect(result.displayName).toBe("Claude");
    expect(result.color).toBe("#d97706");
  });

  it("uses default fallback for unknown provider", () => {
    const result = resolveModelIdentity("xyz-provider/model", []);
    expect(result.displayName).toBe("AI Assistant");
    expect(result.color).toBe("#4f46e5");
  });

  it("resolves by slug as well as modelId", () => {
    const model = demoModels[0];
    if (!model) return;
    const result = resolveModelIdentity(model.slug, demoModels);
    expect(result.displayName).toBe(model.displayName || model.name);
  });

  it("maps upstream and route IDs for an enriched model candidate", () => {
    const model = {
      ...demoModels[0]!,
      modelId: "logical-a",
      slug: "logical-a",
      displayName: "GPT Product",
      routes: [
        {
          id: "route_internal_high",
          upstreamModel: "provider-model-x"
        }
      ]
    };

    expect(resolveModelIdentity("provider-model-x", [model]).displayName).toBe(
      "GPT Product"
    );
    expect(
      resolveModelIdentity("route_internal_high", [model]).displayName
    ).toBe("GPT Product");
  });

  it("formats a recognizable GPT identifier without exposing provider path syntax", () => {
    expect(resolveModelIdentity("gpt-5.5-high", []).displayName).toBe(
      "GPT-5.5 High"
    );
  });

  it("keeps disabled public models available for historical identity resolution", () => {
    const disabledModel: AiModelSummary = {
      ...demoModels[0]!,
      enabled: false,
      displayName: "Historical GPT"
    };

    expect(
      resolveModelIdentity(disabledModel.slug, [disabledModel]).displayName
    ).toBe("Historical GPT");
  });
});
