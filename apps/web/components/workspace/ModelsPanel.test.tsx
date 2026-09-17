import type { AiModelSummary } from "@ai-aggregate/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Locale } from "../../lib/i18n/types";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  clampModelLibraryPage,
  createFeaturedChatModels,
  filterModelLibraryModels,
  getModelLibraryAction,
  getModelLibraryActionLabel,
  ModelsPanel,
  paginateModelLibraryModels
} from "./ChatWorkspace";

function createModel(
  overrides: Partial<AiModelSummary> & Pick<AiModelSummary, "id" | "name" | "slug" | "modelId" | "capability">
): AiModelSummary {
  return {
    provider: "SUB2API",
    group: "Default",
    tags: [],
    enabled: true,
    creditCost: 1,
    allowGuest: true,
    sortOrder: 0,
    isRecommended: false,
    ...overrides,
    maxReferenceImages: overrides.maxReferenceImages ?? 1
  };
}

const models: AiModelSummary[] = [
  createModel({
    id: "model_1",
    name: "deepseek-internal",
    displayName: "DeepSeek",
    slug: "deepseek",
    modelId: "provider/deepseek-chat",
    capability: "chat",
    group: "Reasoning",
    tags: ["reasoning"],
    shortDescription: "Reasoning chat model",
    isRecommended: true,
    iconText: "DS",
    iconColor: "#2563eb"
  }),
  createModel({
    id: "model_2",
    name: "qianyu-image",
    displayName: "Qianyu Image",
    slug: "qianyu-image",
    provider: "OPENAI_COMPATIBLE",
    modelId: "provider/qianyu-image",
    capability: "image",
    group: "Image",
    tags: ["image"],
    shortDescription: "Image generation model",
    creditCost: 2
  }),
  createModel({
    id: "model_3",
    name: "video-internal",
    displayName: "Video Model",
    slug: "video-model",
    provider: "OPENAI_COMPATIBLE",
    modelId: "provider/video-model",
    capability: "video",
    group: "Video",
    tags: ["video"],
    shortDescription: "Video generation placeholder",
    creditCost: 4
  }),
  ...Array.from({ length: 8 }, (_, index) =>
    createModel({
      id: `model_extra_${index}`,
      name: `extra-chat-${index}`,
      displayName: `Extra Chat ${index}`,
      slug: `extra-chat-${index}`,
      modelId: `provider/extra-chat-${index}`,
      capability: "chat",
      group: "Fast",
      tags: ["fast"],
      shortDescription: "Fast chat model",
      sortOrder: index + 3
    })
  )
];

function renderWithLocale(node: React.ReactNode, locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      {node}
    </I18nContext.Provider>
  );
}

describe("ModelsPanel", () => {
  it("renders search, filters, model cards with icons, badges, and actions (no SUB2API or raw modelId)", () => {
    const html = renderWithLocale(
      <ModelsPanel
        models={models}
        modelsLoaded={true}
        selectedModel="provider/deepseek-chat"
        onSelectModel={vi.fn()}
        onOpenImageModel={vi.fn()}
      />
    );

    expect(html).toContain("Search models");
    expect(html).not.toContain("Back to chat");
    expect(html).not.toContain("返回对话");
    expect(html).toContain("Search model name");
    expect(html).toContain("Capability");
    expect(html).toContain("All capabilities");
    expect(html).toContain("Chat");
    expect(html).toContain("Image");
    expect(html).toContain("Billing");
    expect(html).toContain("Free");
    expect(html).toContain("Paid");
    expect(html).toContain("通用");
    expect(html).toContain("DeepSeek");
    expect(html).toContain("Qianyu Image");
    expect(html).toContain("Video Model");
    expect(html).not.toContain("Current model");
    expect(html).not.toContain('aria-selected="true"');
    expect(html).toContain("1 credit");
    expect(html).toContain("Recommended");
    expect(html).toContain("Reasoning chat model");
    expect(html).toContain("Go to chat");
    expect(html).toContain("Go to Image Creation");
    expect(html).toContain("Coming soon");
    expect(html).not.toContain("Set as current model");
    expect(html).not.toContain("Load more models");
    expect(html).toContain('data-model-icon="true"');
    expect(html).toContain('data-model-library-action="chat"');
    expect(html).toContain('data-model-library-action="image"');
    expect(html).toContain('data-model-library-action="unavailable"');
    expect(html).toContain('data-model-library-pagination="true"');
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
    expect(html).toContain("Page 1 / 2");
    expect(html).toContain("11 models");
  });

  it("renders free model cost labels without zero-credit cost copy", () => {
    const html = renderWithLocale(
      <ModelsPanel
        models={[
          {
            ...models[0]!,
            creditCost: 0
          }
        ]}
        modelsLoaded={true}
        selectedModel="provider/deepseek-chat"
        onSelectModel={vi.fn()}
        onOpenImageModel={vi.fn()}
      />,
      "zh-CN"
    );

    expect(html).toContain("免费");
    expect(html).not.toContain("消耗 0 额度 / 次");
  });

  it("keeps the model card itself non-navigating and exposes an explicit action button", () => {
    const html = renderWithLocale(
      <ModelsPanel
        modelsLoaded={true}
        models={models.slice(0, 1)}
        selectedModel="provider/deepseek-chat"
        onSelectModel={vi.fn()}
        onOpenImageModel={vi.fn()}
      />
    );

    expect(html).toContain('data-model-library-card="provider/deepseek-chat"');
    expect(html).toContain('data-model-library-action="chat"');
    expect(html).toContain(">Go to chat</button>");
    expect(html).toContain("Guest available");
    expect(html).not.toMatch(/<button[^>]*data-model-library-card/);
  });

  it("uses full /models source instead of chat-surface-only model loading", () => {
    const source = readFileSync(new URL("./ChatWorkspace.tsx", import.meta.url), "utf8");

    expect(source).toContain('fetch(apiUrl("/models")');
    expect(source).not.toContain("/models?surface=chat");
  });

  it("renders workspace secondary panels in a shell without the shared back-to-chat button", () => {
    // ChatWorkspace no longer hosts non-chat panels; they have their own page-content files
    const chatSource = readFileSync(new URL("./ChatWorkspace.tsx", import.meta.url), "utf8");
    expect(chatSource).not.toContain("currentPanelTitle");
    expect(chatSource).not.toContain("routePanel");
    expect(chatSource).not.toContain("workspace.backToChat");

    // ModelsPageContent hosts ModelLibraryPanelShell
    const modelsSource = readFileSync(
      new URL("../../app/(workspace)/models/models-page-content.tsx", import.meta.url),
      "utf8"
    );
    expect(modelsSource).toContain("function ModelLibraryPanelShell");
    expect(modelsSource).toContain("<ModelLibraryPanelShell");
    expect(modelsSource).not.toContain("workspace.backToChat");
  });

  it("hands off image model navigation through sessionStorage without exposing modelId in the URL", () => {
    const source = readFileSync(new URL("./ChatWorkspace.tsx", import.meta.url), "utf8");

    expect(source).toContain("imageModelHandoffStorageKey");
    expect(source).toContain("window.sessionStorage.setItem");
    expect(source).toContain('router.push("/image")');
    expect(source).not.toContain('router.push(`/image?modelId=');
  });

  it("filters image models and paginates model-library results", () => {
    expect(
      filterModelLibraryModels(models, {
        capabilityFilter: "image"
      }).map((model) => model.modelId)
    ).toEqual(["provider/qianyu-image"]);

    expect(
      filterModelLibraryModels(models, {
        searchQuery: "generation",
        capabilityFilter: "image"
      }).map((model) => model.modelId)
    ).toEqual(["provider/qianyu-image"]);

    expect(paginateModelLibraryModels(models, 1).map((model) => model.modelId)).toHaveLength(9);
    expect(paginateModelLibraryModels(models, 2).map((model) => model.modelId)).toHaveLength(2);
    expect(clampModelLibraryPage(99, models.length)).toBe(2);
    expect(clampModelLibraryPage(0, models.length)).toBe(1);
  });

  it("resolves chat, image, and unavailable model actions without mutating chat selection for image models", () => {
    expect(getModelLibraryAction(models[0]!)).toBe("chat");
    expect(getModelLibraryAction(models[1]!)).toBe("image");
    expect(getModelLibraryAction(models[2]!)).toBe("unavailable");
    expect(
      getModelLibraryAction({
        ...models[0]!,
        displaySurfaces: ["image"]
      })
    ).toBe("unavailable");
    expect(
      getModelLibraryAction({
        ...models[1]!,
        displaySurfaces: []
      })
    ).toBe("unavailable");
    expect(getModelLibraryActionLabel("chat", "zh-CN")).toBe("去对话");
    expect(getModelLibraryActionLabel("image", "zh-CN")).toBe("去图像创作");
    expect(getModelLibraryActionLabel("unavailable", "zh-CN")).toBe("即将上线");
  });

  it("ensures createFeaturedChatModels always includes the current selected chat model and marks it isCurrent", () => {
    const chatModels: AiModelSummary[] = [
      createModel({
        id: "cm_0", name: "Chat 0", slug: "chat-0", modelId: "chat-0",
        capability: "chat", group: "default",
      }),
      createModel({
        id: "cm_1", name: "Chat 1", slug: "chat-1", modelId: "chat-1",
        capability: "chat", group: "default",
      }),
      createModel({
        id: "cm_2", name: "Chat 2", slug: "chat-2", modelId: "chat-2",
        capability: "chat", group: "default",
      }),
      createModel({
        id: "cm_3", name: "Chat 3", slug: "chat-3", modelId: "chat-3",
        capability: "chat", group: "default",
      }),
      createModel({
        id: "cm_4", name: "Chat 4", slug: "chat-4", modelId: "chat-4",
        capability: "chat", group: "default",
      }),
      createModel({
        id: "cm_5", name: "Chat 5", slug: "chat-5", modelId: "chat-5",
        capability: "chat", group: "default",
      }),
      createModel({
        id: "cm_6", name: "Chat 6", slug: "chat-6", modelId: "chat-6",
        capability: "chat", group: "default",
      }),
      createModel({
        id: "im_0", name: "Image 0", slug: "image-0", modelId: "image-0",
        capability: "image", group: "image",
      }),
      createModel({
        id: "im_1", name: "Image 1", slug: "image-1", modelId: "image-1",
        capability: "image", group: "image",
      }),
    ];

    // Selected model NOT in first 6 — must be inserted
    const far = createFeaturedChatModels(chatModels, "chat-6");
    expect(far.map((f) => f.model.modelId)).toEqual([
      "chat-0", "chat-1", "chat-2", "chat-3", "chat-4", "chat-6",
    ]);
    expect(far.find((f) => f.model.modelId === "chat-6")?.isCurrent).toBe(true);
    // Image models never enter the featured list
    expect(far.some((f) => f.model.capability !== "chat")).toBe(false);

    // Selected model IS in first 6 — stays in place
    const near = createFeaturedChatModels(chatModels, "chat-2");
    expect(near.map((f) => f.model.modelId)).toEqual([
      "chat-0", "chat-1", "chat-2", "chat-3", "chat-4", "chat-5",
    ]);
    expect(near.find((f) => f.model.modelId === "chat-2")?.isCurrent).toBe(true);
    expect(near.some((f) => f.model.capability !== "chat")).toBe(false);
  });

  it("uses selectModelAndReturnToChat (not raw setState) when a chat model is clicked in the library", () => {
    const source = readFileSync(new URL("./ChatWorkspace.tsx", import.meta.url), "utf8");

    // ModelsPanel receives onSelectModel={selectModelAndReturnToChat}
    expect(source).toContain("onSelectModel={selectModelAndReturnToChat}");
    // selectModelAndReturnToChat is useCallback-wrapped
    expect(source).toContain("const selectModelAndReturnToChat = useCallback(");
    // It calls handleModelChange internally
    expect(source).toContain("handleModelChange(nextModel);");
    // It navigates back to chat
    expect(source).toContain('router.push("/", { scroll: false })');
  });

  it("shows loading skeleton when modelsLoaded is false instead of empty state", () => {
    const html = renderWithLocale(
      <ModelsPanel
        models={[]}
        modelsLoaded={false}
        selectedModel=""
        onSelectModel={vi.fn()}
        onOpenImageModel={vi.fn()}
      />
    );

    // Loading state visible
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Loading models...");
    // Empty state NOT visible
    expect(html).not.toContain("No models available");
  });

  it("shows empty state only when modelsLoaded is true and model list is empty", () => {
    const html = renderWithLocale(
      <ModelsPanel
        models={[]}
        modelsLoaded={true}
        selectedModel=""
        onSelectModel={vi.fn()}
        onOpenImageModel={vi.fn()}
      />
    );

    expect(html).toContain("No models available");
    expect(html).not.toContain("animate-pulse");
  });

  it("shows model cards when modelsLoaded is true and models exist", () => {
    const html = renderWithLocale(
      <ModelsPanel
        models={models}
        modelsLoaded={true}
        selectedModel="provider/deepseek-chat"
        onSelectModel={vi.fn()}
        onOpenImageModel={vi.fn()}
      />
    );

    expect(html).toContain("Search models");
    expect(html).not.toContain("No models available");
    expect(html).not.toContain("animate-pulse");
  });
});
