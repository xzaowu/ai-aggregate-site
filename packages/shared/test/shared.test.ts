import { describe, expect, it } from "vitest";
import {
  aiAssetTypes,
  aiGenerationCounts,
  aiGenerationSizes,
  aiTaskStatuses,
  aiTaskTypes,
  modelCapabilities,
  modelDisplaySurfaces,
  normalizeModelImageInvokeMode,
  normalizeModelImageOutputParser,
  normalizeModelDisplaySurfaces,
  isModelDisplaySurfaceCompatible,
  createDemoModels,
  demoModels,
  demoPlans,
  isImageCapableModel,
  isChatCapableModel,
  isEnabledModel,
  isSafePublicImagePromptCardUrl,
  isValidImagePromptCardsSetting,
  providerAccountCapabilities,
  providerAccountTypes,
  imageGenerationWorkflows,
  isImageGenerationWorkflow,
  titleCoverVisualStyles,
  titleCoverOriginalTitleMaxCodePoints,
  isTitleCoverVisualStyle,
  joinProviderEndpointUrl,
  normalizeProviderHeaders
} from "../src/index";

describe("shared demo data", () => {
  it("contains at least one enabled model for the chat MVP", () => {
    expect(demoModels.some(isEnabledModel)).toBe(true);
  });

  it("uses Sub2API-compatible model IDs for demo chat models", () => {
    expect(demoModels.map((model) => model.modelId)).toEqual([
      "openai/gpt-oss-120b:free",
      "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B"
    ]);
    expect(demoModels.map((model) => model.name)).toEqual([
      "GPT OSS 120B Free",
      "DeepSeek R1 Qwen3 8B"
    ]);
  });

  it("only exposes chat models in the demo chat model list", () => {
    expect(
      demoModels.some((model) =>
        /gpt-image|audio|realtime/i.test(model.modelId)
      )
    ).toBe(false);
  });

  it("creates enabled demo models from configurable model IDs", () => {
    const [model] = createDemoModels([
      {
        name: "Custom Demo",
        slug: "custom-demo",
        provider: "SUB2API",
        modelId: "provider/custom-model",
        description: "Custom demo model."
      }
    ]);

    expect(model).toMatchObject({
      id: "model_custom-demo",
      name: "Custom Demo",
      modelId: "provider/custom-model",
      enabled: true,
      creditCost: 1,
      allowGuest: true,
      sortOrder: 0,
      capability: "chat"
    });
  });

  it("defaults demo model billing to one credit and guest access", () => {
    expect(demoModels[0]).toMatchObject({
      creditCost: 1,
      allowGuest: true,
      sortOrder: 0,
      capability: "chat"
    });
  });

  it("contains enabled demo plans ordered by sort order", () => {
    expect(demoPlans.every((plan) => plan.enabled)).toBe(true);
    expect(demoPlans.map((plan) => plan.sortOrder)).toEqual([0, 1, 2]);
    expect(demoPlans.some((plan) => plan.price > 0)).toBe(true);
  });
});

describe("shared AI task foundation", () => {
  it("exposes unified AI generation task types", () => {
    expect(aiTaskTypes).toEqual(["image", "video", "ppt", "document"]);
  });

  it("exposes unified AI generation task statuses", () => {
    expect(aiTaskStatuses).toEqual([
      "pending",
      "running",
      "succeeded",
      "failed",
      "cancelled"
    ]);
  });

  it("exposes reusable generated asset types", () => {
    expect(aiAssetTypes).toEqual(["image", "video", "document"]);
  });

  it("exposes MVP image generation sizes and counts", () => {
    expect(aiGenerationSizes).toEqual([
      "1024x1024",
      "1024x768",
      "768x1024",
      "1280x720",
      "720x1280"
    ]);
    expect(aiGenerationCounts).toEqual([1, 2, 4]);
  });

  it("exposes canonical image workflows and the Title Cover style allowlist", () => {
    expect(imageGenerationWorkflows).toEqual([
      "precision-edit",
      "title-cover",
      "transcript-images"
    ]);
    expect(isImageGenerationWorkflow("precision-edit")).toBe(true);
    expect(isImageGenerationWorkflow("title-cover")).toBe(true);
    expect(isImageGenerationWorkflow("transcript-images")).toBe(true);
    expect(isImageGenerationWorkflow("free-create")).toBe(false);
    expect(titleCoverVisualStyles).toEqual([
      "minimal-modern",
      "energetic-motion",
      "professional-business",
      "warm-editorial"
    ]);
    expect(titleCoverOriginalTitleMaxCodePoints).toBe(300);
    expect(isTitleCoverVisualStyle("warm-editorial")).toBe(true);
    expect(isTitleCoverVisualStyle("neon")).toBe(false);
    expect(isTitleCoverVisualStyle(3)).toBe(false);
  });

  it("exposes explicit model capabilities", () => {
    expect(modelCapabilities).toEqual(["chat", "image", "video", "ppt"]);
    expect(demoModels[0]?.capability).toBe("chat");
    expect(modelDisplaySurfaces).toEqual(["chat", "image", "video"]);
    expect(demoModels[0]?.displaySurfaces).toEqual(["chat"]);
  });

  it("normalizes model display surfaces with capability fallback", () => {
    expect(normalizeModelDisplaySurfaces(["image", "chat"], "chat")).toEqual([
      "image",
      "chat"
    ]);
    expect(normalizeModelDisplaySurfaces(["bad", "image"], "chat")).toEqual([
      "image"
    ]);
    expect(normalizeModelDisplaySurfaces([], "image")).toEqual([]);
    expect(normalizeModelDisplaySurfaces(undefined, "chat")).toEqual(["chat"]);
    expect(normalizeModelDisplaySurfaces(undefined, undefined)).toEqual(["chat"]);
    expect(normalizeModelDisplaySurfaces([], "video")).toEqual([]);
    expect(normalizeModelDisplaySurfaces([], "ppt")).toEqual([]);
    expect(normalizeModelDisplaySurfaces(undefined, "")).toEqual(["chat"]);
  });

  it("keeps capability and public surface compatibility explicit", () => {
    expect(isModelDisplaySurfaceCompatible("image", "image")).toBe(true);
    expect(isModelDisplaySurfaceCompatible("chat", "image")).toBe(false);
    expect(isModelDisplaySurfaceCompatible("video", "chat")).toBe(false);
  });

  it("normalizes valid model image invoke modes", () => {
    expect(normalizeModelImageInvokeMode("native-image")).toBe("native-image");
    expect(normalizeModelImageInvokeMode("anthropic-messages")).toBe(
      "anthropic-messages"
    );
  });

  it("rejects invalid model image invoke modes", () => {
    expect(normalizeModelImageInvokeMode("bad")).toBeUndefined();
    expect(normalizeModelImageInvokeMode("")).toBeUndefined();
    expect(normalizeModelImageInvokeMode(null)).toBeUndefined();
    expect(normalizeModelImageInvokeMode(undefined)).toBeUndefined();
  });

  it("normalizes valid model image output parsers", () => {
    expect(normalizeModelImageOutputParser("native-image")).toBe("native-image");
    expect(normalizeModelImageOutputParser("markdown-data-url")).toBe(
      "markdown-data-url"
    );
  });

  it("rejects invalid model image output parsers", () => {
    expect(normalizeModelImageOutputParser("bad")).toBeUndefined();
    expect(normalizeModelImageOutputParser("")).toBeUndefined();
    expect(normalizeModelImageOutputParser(null)).toBeUndefined();
    expect(normalizeModelImageOutputParser(undefined)).toBeUndefined();
  });

  it("detects image-capable models from explicit capability", () => {
    expect(isImageCapableModel({ capability: "image" })).toBe(true);
    expect(isImageCapableModel({ capability: "chat" })).toBe(false);
    expect(isChatCapableModel({ capability: "chat" })).toBe(true);
    expect(isChatCapableModel({ capability: "image" })).toBe(false);
  });

  it("exposes provider account types and capabilities", () => {
    expect(providerAccountTypes).toEqual([
      "OPENAI_COMPATIBLE",
      "SUB2API",
      "NEW_API",
      "ANTHROPIC",
      "AGNES_IMAGE"
    ]);
    expect(providerAccountCapabilities).toEqual(["chat", "image", "video", "ppt"]);
  });
});

describe("image prompt card public URLs", () => {
  it("accepts public HTTPS URLs and same-origin public paths", () => {
    expect(isSafePublicImagePromptCardUrl("https://cdn.example.com/card.jpg")).toBe(true);
    expect(isSafePublicImagePromptCardUrl("/images/prompt-card.webp")).toBe(true);
  });

  it("rejects unsafe protocols, private hosts, credentials, and private asset content", () => {
    for (const value of [
      `java${"script"}:alert(1)`,
      `${"data"}:image/png;base64,abc`,
      `${"blob"}:https://example.com/id`,
      `${"file"}:///tmp/card.png`,
      "http://example.com/card.jpg",
      "https://localhost/card.jpg",
      "https://127.0.0.1/card.jpg",
      "https://10.0.0.1/card.jpg",
      "https://user:pass@example.com/card.jpg",
      "/assets/550e8400-e29b-41d4-a716-446655440000/content"
    ]) {
      expect(isSafePublicImagePromptCardUrl(value)).toBe(false);
    }
  });

  it("permits imageUrl only when it is blank or a safe public URL", () => {
    const baseCard = {
      title: "Product hero",
      description: "Clean commercial image",
      prompt: "Create a product hero"
    };

    expect(isValidImagePromptCardsSetting(JSON.stringify([baseCard]))).toBe(true);
    expect(
      isValidImagePromptCardsSetting(
        JSON.stringify([{ ...baseCard, imageUrl: "https://cdn.example.com/card.jpg" }])
      )
    ).toBe(true);
    expect(
      isValidImagePromptCardsSetting(
        JSON.stringify([{ ...baseCard, imageUrl: `java${"script"}:alert(1)` }])
      )
    ).toBe(false);
  });
});

describe("provider transport helpers", () => {
  it.each([
    ["https://example.com", "/images/generations", "https://example.com/images/generations"],
    ["https://example.com/v1", "/images/generations", "https://example.com/v1/images/generations"],
    ["https://example.com/custom/v1", "/images/generations", "https://example.com/custom/v1/images/generations"],
    ["https://example.com/custom/v1/", "/images/generations", "https://example.com/custom/v1/images/generations"]
  ])("joins an explicit API prefix without guessing paths", (base, suffix, expected) => {
    expect(joinProviderEndpointUrl(base, suffix)).toBe(expected);
  });

  it.each([
    "ftp://example.com",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?token=secret",
    "https://example.com/v1#fragment"
  ])("rejects unsafe provider base URL %s", (base) => {
    expect(() => joinProviderEndpointUrl(base, "/images/generations")).toThrow(
      "PROVIDER_BASE_URL_INVALID"
    );
  });

  it("rejects unsafe provider endpoint paths", () => {
    expect(() => joinProviderEndpointUrl("https://example.com/v1", "/v1/../admin"))
      .toThrow("PROVIDER_ENDPOINT_PATH_INVALID");
    expect(() => joinProviderEndpointUrl("https://example.com/v1", "/moderations?x=1"))
      .toThrow("PROVIDER_ENDPOINT_PATH_INVALID");
  });

  it("filters unsafe custom headers without exposing values", () => {
    expect(
      normalizeProviderHeaders({
        " X-Allowed ": " ok ",
        " x-allowed": "replacement ",
        authorization: "secret",
        "CONTENT-TYPE": "text/plain",
        Host: "evil.example",
        "Content-Length": "42",
        Connection: "keep-alive",
        "X-Number": 1,
        "X-Control": "line\r\nbreak",
        "X-Control-Name\n": "bad",
        "not a header": "no"
      })
    ).toEqual({ "x-allowed": "replacement" });
    expect(
      normalizeProviderHeaders({
        " X-Tenant ": " tenant-a ",
        "x-tenant": "tenant-b"
      })
    ).toEqual({
      "x-tenant": "tenant-b"
    });
    expect(
      normalizeProviderHeaders({
        Authorization: "blocked",
        "CONTENT-TYPE": "blocked",
        HOST: "blocked",
        "Content-Length": "blocked",
        Connection: "blocked",
        "Keep-Alive": "blocked",
        "Proxy-Authenticate": "blocked",
        "PROXY-AUTHORIZATION": "blocked",
        TE: "blocked",
        Trailer: "blocked",
        "Transfer-Encoding": "blocked",
        Upgrade: "blocked"
      })
    ).toEqual({});
    expect(normalizeProviderHeaders(null)).toEqual({});
    expect(normalizeProviderHeaders([])).toEqual({});
  });
});
