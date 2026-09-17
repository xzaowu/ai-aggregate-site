import { describe, expect, it } from "vitest";
import {
  parseImagePromptCards,
  parseWorkspacePromptCards,
  resolveWorkspaceHero
} from "./workspace-settings";

describe("workspace settings helpers", () => {
  it("parses configured prompt cards with separate display description and inserted prompt", () => {
    const cards = parseWorkspacePromptCards(
      JSON.stringify([
        {
          title: "Plan rollout",
          description: "Turn an idea into executable steps.",
          prompt: "Help me plan this rollout:"
        }
      ]),
      [
        {
          title: "Fallback",
          description: "Fallback description",
          prompt: "Fallback prompt"
        }
      ]
    );

    expect(cards).toEqual([
      {
        title: "Plan rollout",
        description: "Turn an idea into executable steps.",
        prompt: "Help me plan this rollout:"
      }
    ]);
  });

  it("falls back to safe prompt cards when JSON is empty or invalid", () => {
    const fallback = [
      {
        title: "Fallback",
        description: "Fallback description",
        prompt: "Fallback prompt"
      }
    ];

    expect(parseWorkspacePromptCards("", fallback)).toEqual(fallback);
    expect(parseWorkspacePromptCards("{", fallback)).toEqual(fallback);
    expect(
      parseWorkspacePromptCards(
        JSON.stringify([{ title: "Missing prompt", description: "No prompt" }]),
        fallback
      )
    ).toEqual(fallback);
  });

  it("keeps an explicit empty image card configuration empty while missing values use the image fallback", () => {
    const fallback = [
      {
        title: "Image fallback",
        description: "Fallback description",
        prompt: "Fallback prompt"
      }
    ];

    expect(parseImagePromptCards(undefined, fallback)).toEqual(fallback);
    expect(parseImagePromptCards("[]", fallback)).toEqual([]);
    expect(
      parseImagePromptCards(
        JSON.stringify([
          {
            title: "Configured image",
            description: "Configured description",
            prompt: "Configured prompt"
          }
        ]),
        fallback
      )
    ).toEqual([
      {
        title: "Configured image",
        description: "Configured description",
        prompt: "Configured prompt"
      }
    ]);
  });

  it("keeps safe image URLs for image cards and falls back for unsafe persisted URLs", () => {
    const fallback = [
      {
        title: "Image fallback",
        description: "Fallback description",
        prompt: "Fallback prompt"
      }
    ];

    expect(
      parseImagePromptCards(
        JSON.stringify([
          {
            title: "Product hero",
            description: "Clean commercial image",
            prompt: "Create a product hero",
            imageUrl: "https://cdn.example.com/product.jpg"
          }
        ]),
        fallback
      )
    ).toEqual([
      {
        title: "Product hero",
        description: "Clean commercial image",
        prompt: "Create a product hero",
        imageUrl: "https://cdn.example.com/product.jpg"
      }
    ]);

    expect(
      parseImagePromptCards(
        JSON.stringify([
          {
            title: "Unsafe",
            description: "Unsafe URL",
            prompt: "Do not use",
            imageUrl: "java" + "script:alert(1)"
          }
        ]),
        fallback
      )
    ).toEqual(fallback);
  });

  it("uses configured hero copy only when values are non-empty", () => {
    expect(
      resolveWorkspaceHero(
        {
          workspaceHeroTitle: "Custom hero",
          workspaceHeroSubtitle: "Custom subtitle"
        },
        {
          title: "Fallback hero",
          subtitle: "Fallback subtitle"
        }
      )
    ).toEqual({
      title: "Custom hero",
      subtitle: "Custom subtitle"
    });

    expect(
      resolveWorkspaceHero(
        {
          workspaceHeroTitle: "   ",
          workspaceHeroSubtitle: ""
        },
        {
          title: "Fallback hero",
          subtitle: "Fallback subtitle"
        }
      )
    ).toEqual({
      title: "Fallback hero",
      subtitle: "Fallback subtitle"
    });
  });
});
