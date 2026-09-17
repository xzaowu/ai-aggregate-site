import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, type PromptSuggestion } from "./EmptyState";

const suggestions: PromptSuggestion[] = [
  {
    title: "Plan",
    description: "Turn a rough idea into short next steps.",
    prompt: "Plan this"
  },
  {
    title: "Compare",
    description: "Compare two options in a concise table.",
    prompt: "Compare this"
  }
];

function renderEmptyState(mode: "desktop" | "mobile" = "desktop") {
  return renderToStaticMarkup(
    <EmptyState
      mode={mode}
      headline="Start a chat"
      subtitle="Ask anything and continue from here."
      promptSuggestionsLabel="Prompt suggestions"
      suggestions={suggestions}
      onSelectPrompt={vi.fn()}
    />
  );
}

describe("EmptyState", () => {
  it("renders a centered mobile welcome area without the current model card", () => {
    const html = renderEmptyState("mobile");

    expect(html).toContain("Start a chat");
    expect(html).toContain("Ask anything and continue from here.");
    expect(html).toContain('aria-label="Start a chat"');
    expect(html).toContain("justify-items-center text-center");
    expect(html).not.toContain('data-mobile-current-model-strip="true"');
    expect(html).not.toContain("Current model");
    expect(html).not.toContain("DeepSeek");
    expect(html).not.toContain("1 credit");
    expect(html).not.toContain("Guest available");
    expect(html).not.toContain("Switch model");
    expect(html).not.toContain("Plan");
  });

  it("renders a configured workspace icon in the mobile welcome area", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        mode="mobile"
        headline="Start a chat"
        subtitle="Ask anything and continue from here."
        promptSuggestionsLabel="Prompt suggestions"
        suggestions={suggestions}
        workspaceIconUrl="https://example.com/workspace.png"
        workspaceIconText="AI"
        onSelectPrompt={vi.fn()}
      />
    );

    expect(html).toContain('src="https://example.com/workspace.png"');
    expect(html).toContain('alt="Start a chat"');
  });

  it("renders workspace icon text fallback in the mobile welcome area", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        mode="mobile"
        headline="Start a chat"
        subtitle="Ask anything and continue from here."
        promptSuggestionsLabel="Prompt suggestions"
        suggestions={suggestions}
        workspaceIconText="AI"
        onSelectPrompt={vi.fn()}
      />
    );

    expect(html).toContain(">AI<");
  });

  it("keeps desktop empty state focused on hero and prompt suggestions", () => {
    const html = renderEmptyState("desktop");

    expect(html).toContain("Start a chat");
    expect(html).toContain("Ask anything and continue from here.");
    expect(html).toContain("Prompt suggestions");
    expect(html).toContain("Plan");
    expect(html).toContain("Compare");
    expect(html).toContain("md:grid-cols-3");
    expect(html).not.toContain('data-mobile-current-model-strip="true"');
    expect(html).not.toContain("Current model");
    expect(html).not.toContain("DeepSeek");
  });
});
