// @vitest-environment jsdom

import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import {
  CreatorTextWorkspace,
  type CreatorTextWorkspaceProps
} from "./creator-text-workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const model = {
  id: "model-1",
  name: "Text Model",
  slug: "text-model",
  provider: "OPENAI_COMPATIBLE" as const,
  capability: "chat" as const,
  maxReferenceImages: 0,
  modelId: "text-model",
  group: "Chat",
  tags: [],
  enabled: true,
  creditCost: 3,
  allowGuest: true,
  sortOrder: 1,
  isRecommended: true
};

const aiComposer: NonNullable<CreatorTextWorkspaceProps["textAiComposer"]> = {
  instruction: "Rewrite this",
  modelId: model.modelId,
  models: [model],
  modelsLoading: false,
  incomingTextCount: 1,
  authenticated: true,
  execution: {
    status: "idle",
    errorMessage: null,
    onExecute: vi.fn()
  },
  onInstructionChange: vi.fn(),
  onModelChange: vi.fn()
};

function withI18n(element: React.ReactNode) {
  return (
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      {element}
    </I18nContext.Provider>
  );
}

function createProps(overrides: Partial<CreatorTextWorkspaceProps> = {}) {
  return {
    text: "## Heading\n\n**bold**",
    textAiComposer: aiComposer,
    onTextChange: vi.fn(),
    onTextEditStart: vi.fn(),
    onTextEditEnd: vi.fn(),
    ...overrides
  } satisfies CreatorTextWorkspaceProps;
}

describe("CreatorTextWorkspace", () => {
  it("provides Markdown-first Read/Preview and an explicit Edit surface", () => {
    const html = renderToStaticMarkup(withI18n(
      <CreatorTextWorkspace {...createProps()} />
    ));

    expect(html).toContain('data-creator-text-workspace-mode="workspace"');
    expect(html).toContain('data-creator-text-workspace-preview="true"');
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("## Heading");
    expect(html).not.toContain('data-creator-text-workspace-editor="true"');
    expect(html).toContain('data-creator-text-ai-composer="true"');
    expect(html).toContain("3 credits");
    expect(html).toContain("1 text context item");
  });

  it("shows a truthful empty placeholder and bounded workspace controls", () => {
    const html = renderToStaticMarkup(withI18n(
      <CreatorTextWorkspace
        {...createProps({ text: "" })}
      />
    ));

    expect(html).toContain("Write text");
    expect(html).toContain('data-creator-text-workspace-view="read"');
    expect(html).toContain('data-creator-text-workspace-view="edit"');
    expect(html).toContain("0 characters");
    expect(html).not.toContain("overflow-y-auto");
  });

  it("passes the active locale to Focus Markdown code controls", () => {
    const html = renderToStaticMarkup(withI18n(
      <CreatorTextWorkspace
        {...createProps({ text: "```ts\nconst copyLabel = true;\n```" })}
        mode="focus"
      />
    ));

    expect(html).toContain(">Copy</button>");
    expect(html).not.toContain(">复制</button>");
  });

  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });

  it("uses the same text callbacks for workspace Edit and Focus source editing", async () => {
    const onTextChange = vi.fn();
    const onTextEditStart = vi.fn();
    const onTextEditEnd = vi.fn();
    const props = createProps({ onTextChange, onTextEditStart, onTextEditEnd });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(withI18n(<CreatorTextWorkspace {...props} />)));
    const editButton = host.querySelector<HTMLButtonElement>(
      '[data-creator-text-workspace-view="edit"]'
    );
    await act(async () => editButton?.click());
    const editor = host.querySelector<HTMLTextAreaElement>(
      '[data-creator-text-workspace-editor="true"]'
    );
    expect(editor).toBeTruthy();
    const propagatedKeydown = vi.fn();
    document.addEventListener("keydown", propagatedKeydown);
    await act(async () => {
      editor?.focus();
      editor?.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
      if (editor) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
          editor,
          "edited through shared callback"
        );
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        editor.dispatchEvent(new Event("change", { bubbles: true }));
      }
      editor?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true
      }));
      editor?.blur();
      editor?.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    });
    document.removeEventListener("keydown", propagatedKeydown);
    expect(propagatedKeydown).not.toHaveBeenCalled();
    expect(onTextChange).toHaveBeenCalledWith("edited through shared callback");
    expect(onTextEditStart).toHaveBeenCalled();
    expect(onTextEditEnd).toHaveBeenCalled();

    await act(async () => root?.render(withI18n(
      <CreatorTextWorkspace {...props} mode="focus" />
    )));
    const focusEditor = host.querySelector<HTMLTextAreaElement>(
      '[data-creator-text-workspace-editor="true"]'
    );
    expect(focusEditor?.dataset.creatorTextWorkspaceEditorMode).toBe("focus");
    expect(host.querySelector('[data-creator-text-workspace-preview]')).toBeTruthy();
  });
});
