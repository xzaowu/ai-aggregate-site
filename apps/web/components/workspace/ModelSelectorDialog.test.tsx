import type { AiModelSummary } from "@ai-aggregate/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { readFileSync } from "node:fs";
import { ModelSelectorDialog } from "./ModelSelectorDialog";

const models: AiModelSummary[] = [
  {
    id: "model_fast",
    name: "Fast Internal",
    displayName: "Fast Chat",
    slug: "fast-chat",
    provider: "SUB2API",
    modelId: "provider/fast-chat",
    capability: "chat",
    group: "free",
    tags: ["fast", "chat"],
    shortDescription: "Quick general chat.",
    enabled: true,
    maxReferenceImages: 1,
    creditCost: 1,
    allowGuest: true,
    sortOrder: 0,
    isRecommended: true,
    iconText: "FC"
  },
  {
    id: "model_reason",
    name: "Reasoning",
    slug: "reasoning",
    provider: "OPENAI_COMPATIBLE",
    modelId: "provider/reasoning",
    capability: "chat",
    group: "reasoning",
    tags: ["analysis"],
    shortDescription: "Better for deeper reasoning.",
    enabled: true,
    maxReferenceImages: 1,
    creditCost: 4,
    allowGuest: false,
    sortOrder: 1,
    isRecommended: false
  },
  {
    id: "model_image",
    name: "Image Internal",
    displayName: "Image Model",
    slug: "image-model",
    provider: "OPENAI_COMPATIBLE",
    modelId: "provider/image-model",
    capability: "image",
    group: "image",
    tags: ["image"],
    shortDescription: "Generate images.",
    enabled: true,
    maxReferenceImages: 1,
    creditCost: 2,
    allowGuest: false,
    sortOrder: 2,
    isRecommended: false
  }
];

function renderDialog() {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      <ModelSelectorDialog
        isOpen={true}
        models={models}
        selectedModel="provider/fast-chat"
        isLoggedIn={false}
        searchQuery=""
        onSearchChange={vi.fn()}
        onClose={vi.fn()}
        onSelectModel={vi.fn()}
      />
    </I18nContext.Provider>
  );
}

describe("ModelSelectorDialog", () => {
  it("renders model metadata without leaving chat", () => {
    const html = renderDialog();

    expect(html).toContain("Select model");
    expect(html).toContain("Search models");
    expect(html).toContain("Fast Chat");
    expect(html).not.toContain("SUB2API");
    expect(html).toContain("1 credit per message");
    expect(html).toContain("Guest available");
    expect(html).toContain("Quick general chat.");
    expect(html).toContain("fast");
    expect(html).toContain("Reasoning");
    expect(html).toContain("Sign-in required");
    expect(html).toContain('data-model-id="provider/reasoning"');
    expect(html).not.toContain("Image Model");
    expect(html).not.toContain("Use in Image Creation");
    expect(html).not.toContain("Go to Image Creation");
    expect(html).not.toContain('data-model-id="provider/image-model"');
  });

  it("can be scoped to image selector context without chat navigation actions", () => {
    const html = renderToStaticMarkup(
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <ModelSelectorDialog
          isOpen={true}
          models={models}
          selectedModel="provider/image-model"
          context="image-selector"
          isLoggedIn={false}
          searchQuery=""
          onSearchChange={vi.fn()}
          onClose={vi.fn()}
          onSelectModel={vi.fn()}
        />
      </I18nContext.Provider>
    );

    expect(html).toContain("Image Model");
    expect(html).toContain('data-model-id="provider/image-model"');
    expect(html).not.toContain("Fast Chat");
    expect(html).not.toContain("Use in Image Creation");
    expect(html).not.toContain("Go to chat");
  });

  it("passes selectModelAndReturnToChat as onSelectModel in chat context so sidebar and input stay in sync", () => {
    const source = readFileSync(
      new URL("./ChatWorkspace.tsx", import.meta.url),
      "utf8"
    );

    // ModelSelectorDialog in chat context gets onSelectModel={selectModelAndReturnToChat}
    expect(source).toContain("onSelectModel={selectModelAndReturnToChat}");
    // selectModelAndReturnToChat guards against non-chat models
    expect(source).toContain('includes("chat")');
    // It calls handleModelChange which is the single update entry point
    expect(source).toContain("handleModelChange(nextModel)");
  });

  it("keeps image models out of the chat-context ModelSelectorDialog", () => {
    const source = readFileSync(
      new URL("./ChatWorkspace.tsx", import.meta.url),
      "utf8"
    );

    // Chat Workspace only passes chat-selector context to ModelSelectorDialog
    expect(source).toContain('context="chat-selector"');
    // selectModelAndReturnToChat is the onSelectModel handler (not a raw setState)
    expect(source).toContain("onSelectModel={selectModelAndReturnToChat}");
    // selectModelAndReturnToChat rejects non-chat models at the top
    expect(source).toContain('includes("chat")');
  });
});
