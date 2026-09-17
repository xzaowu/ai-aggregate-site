import { readFileSync } from "node:fs";
import React from "react";
import type { AiModelSummary } from "@ai-aggregate/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatSidebar } from "./ChatSidebar";
import { createFeaturedChatModels } from "./ChatWorkspace";

describe("ChatSidebar", () => {
  it("is hidden below desktop width so mobile keeps focus on the chat", () => {
    const html = renderToStaticMarkup(
      <ChatSidebar
        title="Chat"
        newChatLabel="New chat"
        historyLabel="History"
        noHistoryLabel="No history"
        loginHint="Log in to save"
        loginLabel="Login"
        sessions={[]}
        currentSessionId={null}
        isLoggedIn={false}
        deleteLabel="Delete"
        onCreateSession={vi.fn()}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );

    expect(html).toContain('<aside class="hidden');
    expect(html).toContain("lg:flex");
  });

  it("does not render an anonymous test mode label for logged-out users", () => {
    const html = renderToStaticMarkup(
      <ChatSidebar
        title="Chat"
        newChatLabel="New chat"
        historyLabel="History"
        noHistoryLabel="No history"
        loginHint="Log in to save chats"
        loginLabel="Login"
        sessions={[]}
        currentSessionId={null}
        isLoggedIn={false}
        deleteLabel="Delete"
        onCreateSession={vi.fn()}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );

    expect(html).toContain("Log in to save chats");
    expect(html).toContain("Login");
    expect(html).not.toContain("Anonymous");
  });

  it("preserves new chat, featured chat models, and history sections", () => {
    const html = renderToStaticMarkup(
      <ChatSidebar
        title="Chat"
        newChatLabel="New chat"
        historyLabel="History"
        noHistoryLabel="No history"
        loginHint="Log in to save"
        loginLabel="Login"
        sessions={[
          {
            id: "session_1",
            userId: "user_1",
            title: "Launch notes",
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z"
          }
        ]}
        currentSessionId="session_1"
        isLoggedIn
        deleteLabel="Delete"
        featuredModelsLabel="Featured models"
        moreModelsLabel="More models"
        featuredModels={[
          {
            model: {
              id: "model_chat",
              name: "Chat Model",
              displayName: "Chat Model",
              slug: "chat-model",
              provider: "OPENAI_COMPATIBLE",
              modelId: "chat-model",
              enabled: true,
              maxReferenceImages: 1,
              creditCost: 1,
              allowGuest: true,
              sortOrder: 0,
              group: "chat",
              tags: ["chat"],
              capability: "chat",
              isRecommended: true
            },
            isCurrent: true
          }
        ]}
        modelsPageHref="/models"
        onSelectFeaturedModel={vi.fn()}
        onCreateSession={vi.fn()}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );

    expect(html).toContain('data-chat-sidebar="true"');
    expect(html).toContain('data-new-chat-btn="true"');
    expect(html).toContain('data-featured-models-section="true"');
    expect(html).toContain('data-chat-history-list="true"');
    expect(html).toContain("Chat Model");
    expect(html).toContain("Launch notes");
    expect(html).toContain('href="/models"');
  });

  it("keeps featured sidebar models limited to chat-capable models", () => {
    const baseModel = {
      provider: "OPENAI_COMPATIBLE" as const,
      enabled: true,
      maxReferenceImages: 1,
      creditCost: 1,
      allowGuest: true,
      sortOrder: 0,
      group: "default",
      tags: [] as string[],
      isRecommended: false
    };
    const models: AiModelSummary[] = [
      {
        ...baseModel,
        id: "model_chat",
        name: "Chat Model",
        displayName: "Chat Model",
        slug: "chat-model",
        modelId: "chat-model",
        capability: "chat"
      },
      {
        ...baseModel,
        id: "model_image",
        name: "Image Model",
        displayName: "Image Model",
        slug: "image-model",
        modelId: "image-model",
        capability: "image"
      },
      {
        ...baseModel,
        id: "model_video",
        name: "Video Model",
        displayName: "Video Model",
        slug: "video-model",
        modelId: "video-model",
        capability: "video"
      }
    ];

    expect(createFeaturedChatModels(models, "chat-model").map(({ model }) => model.modelId)).toEqual([
      "chat-model"
    ]);
    expect(createFeaturedChatModels(models, "image-model").map(({ model }) => model.modelId)).toEqual([
      "chat-model"
    ]);
    expect(createFeaturedChatModels(models, "image-model").some(({ isCurrent }) => isCurrent)).toBe(false);
  });

  it("includes and highlights the selected chat model when it is outside the first six featured models", () => {
    const baseModel = {
      provider: "OPENAI_COMPATIBLE" as const,
      enabled: true,
      maxReferenceImages: 1,
      creditCost: 1,
      allowGuest: true,
      sortOrder: 0,
      group: "default",
      tags: [] as string[],
      isRecommended: false
    };
    const models: AiModelSummary[] = [
      ...Array.from({ length: 7 }, (_, index) => ({
        ...baseModel,
        id: `model_chat_${index}`,
        name: `Chat Model ${index}`,
        displayName: `Chat Model ${index}`,
        slug: `chat-model-${index}`,
        modelId: `chat-model-${index}`,
        capability: "chat" as const
      })),
      {
        ...baseModel,
        id: "model_image",
        name: "Image Model",
        displayName: "Image Model",
        slug: "image-model",
        modelId: "image-model",
        capability: "image"
      }
    ];

    const featured = createFeaturedChatModels(models, "chat-model-6");

    expect(featured.map(({ model }) => model.modelId)).toEqual([
      "chat-model-0",
      "chat-model-1",
      "chat-model-2",
      "chat-model-3",
      "chat-model-4",
      "chat-model-6"
    ]);
    expect(featured).toHaveLength(6);
    expect(featured.find(({ model }) => model.modelId === "chat-model-6")?.isCurrent).toBe(true);
    expect(featured.some(({ model }) => model.modelId === "image-model")).toBe(false);
  });

  it("keeps the original first-six featured order when the selected chat model is already visible", () => {
    const baseModel = {
      provider: "OPENAI_COMPATIBLE" as const,
      enabled: true,
      maxReferenceImages: 1,
      creditCost: 1,
      allowGuest: true,
      sortOrder: 0,
      group: "default",
      tags: [] as string[],
      isRecommended: false
    };
    const models: AiModelSummary[] = Array.from({ length: 7 }, (_, index) => ({
      ...baseModel,
      id: `model_chat_${index}`,
      name: `Chat Model ${index}`,
      displayName: `Chat Model ${index}`,
      slug: `chat-model-${index}`,
      modelId: `chat-model-${index}`,
      capability: "chat" as const
    }));

    const featured = createFeaturedChatModels(models, "chat-model-2");

    expect(featured.map(({ model }) => model.modelId)).toEqual([
      "chat-model-0",
      "chat-model-1",
      "chat-model-2",
      "chat-model-3",
      "chat-model-4",
      "chat-model-5"
    ]);
    expect(featured.find(({ model }) => model.modelId === "chat-model-2")?.isCurrent).toBe(true);
  });

  it("includes the selectModelAndReturnToChat callback in chatSidebar useMemo deps to prevent stale sidebar handlers", () => {
    const source = readFileSync(
      new URL("./ChatWorkspace.tsx", import.meta.url),
      "utf8"
    ) as string;

    // selectModelAndReturnToChat is in the chatSidebar useMemo dependency array
    expect(source).toContain("selectModelAndReturnToChat,");
    // createSession, selectSession, deleteSession are also in the sidebar memo deps
    expect(source).toContain("createSession,");
    expect(source).toContain("deleteSession,");
    expect(source).toContain("selectSession,");
    // The sidebar effect registers chatSidebar to workspace context
    // and clears on unmount.  It includes createSession as a dep so the
    // sidebar always receives a current handler reference.
    expect(source).toContain("setWorkspaceSidebar(chatSidebar)");
    // createSession appears both in chatSidebar useMemo deps and
    // the sidebar registration useEffect deps (two occurrences).
    const createSessionMatches =
      source.match(/createSession,/g)?.length ?? 0;
    expect(createSessionMatches).toBeGreaterThanOrEqual(2);
  });
});
