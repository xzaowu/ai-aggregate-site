// @vitest-environment jsdom

import React, { createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./ChatComposer";

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {}
) {
  return renderToStaticMarkup(
    <ChatComposer
      textareaRef={createRef<HTMLTextAreaElement>()}
      value="hello"
      placeholder="Message"
      selectedModelLabel="GPT"
      switchModelLabel="Switch model"
      creditLabel="1 credit"
      accessLabel="Guest available"
      sendLabel="Send"
      sendingLabel="Sending"
      clearLabel="Clear draft"
      expandLabel="Expand prompt editor"
      closeExpandedLabel="Close prompt editor"
      expandedTitle="Edit prompt"
      isLoading={false}
      canSend={true}
      onChange={vi.fn()}
      onKeyDown={vi.fn()}
      onOpenModelSelector={vi.fn()}
      onClear={vi.fn()}
      onSend={vi.fn()}
      {...overrides}
    />
  );
}

describe("ChatComposer", () => {
  it("does not render a form that can trigger a default page reload", () => {
    expect(renderComposer()).not.toContain("<form");
  });

  it("renders the send button as a non-submit button", () => {
    expect(renderComposer()).toContain('type="button"');
  });

  it("renders the current model badge as a model selector trigger", () => {
    const html = renderComposer();

    expect(html).toContain('aria-label="Switch model"');
    expect(html).toContain("GPT");
    expect(html).not.toContain("Current model:");
  });

  it("keeps the composer fixed as a non-shrinking workspace region", () => {
    expect(renderComposer()).toContain("shrink-0");
  });

  it("keeps model, cost, access, and send controls in an explicit left-to-right grid", () => {
    const html = renderComposer();

    expect(html).toContain('data-chat-composer-toolbar="compact-single-row"');
    expect(html).toContain('data-chat-composer-layout="model-cost-access-send-grid"');
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]");
    expect(html).toContain("min-h-16");
    expect(html).toContain("justify-self-start");
    expect(html).toContain("min-h-11 min-w-11");
    expect(html).toContain("Guest available");
    expect(html).not.toContain("min-[390px]:inline-flex");
    expect(html).toContain("size-5 shrink-0");
    expect(html).toContain("sm:gap-2 sm:px-4");
    expect(html).not.toContain("flex-col gap-2");
    expect(html).not.toContain("absolute");
    expect(html).not.toContain('class="flex min-w-0 flex-1 items-center gap-1.5"');
  });

  it("exposes an accessible mobile full-screen prompt editor and clear action", () => {
    const html = renderComposer({ value: "draft" });

    expect(html).toContain('data-chat-expand-prompt="true"');
    expect(html).toContain('aria-label="Expand prompt editor"');
    expect(html).toContain('data-chat-clear-draft="true"');
  });

  it("keeps the model trigger at the grid start without positional patches", () => {
    const html = renderComposer();
    const toolbar = html.split('data-chat-composer-toolbar="compact-single-row"', 2)[1] ?? "";

    expect(html).toContain('class="min-w-0 max-w-full justify-self-start text-left"');
    expect(toolbar).not.toContain("absolute");
    expect(toolbar).not.toContain("translate-");
    expect(toolbar).not.toContain("-ml-");
    expect(toolbar).not.toContain("mx-auto");
  });

  it("keeps free, paid, guest, and long-model labels as real field values", () => {
    const html = renderComposer({
      selectedModelLabel: "A very long model display name that must truncate",
      creditLabel: "Free",
      accessLabel: "Guest available"
    });

    expect(html).toContain("A very long model display name that must truncate");
    expect(html).toContain("Free");
    expect(html).toContain("Guest available");
    expect(html).toContain("truncate");
    expect(html).not.toContain("1 credit");
  });

  it("keeps the send control disabled and shows the sending label during send state", () => {
    const html = renderComposer({ isLoading: true, canSend: false });

    expect(html).toContain('disabled=""');
    expect(html).toContain("Sending");
    expect(html).toContain("min-h-11 min-w-11");
  });

  it("uses the same controlled draft and submit handler in the full-screen editor", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let draft = "long prompt";
    const onSend = vi.fn();
    const onChange = vi.fn((nextValue: string) => {
      draft = nextValue;
      root.render(
        <ChatComposer
          textareaRef={createRef<HTMLTextAreaElement>()}
          value={draft}
          placeholder="Message"
          selectedModelLabel="GPT"
          switchModelLabel="Switch model"
          creditLabel={null}
          accessLabel={null}
          sendLabel="Send"
          sendingLabel="Sending"
          clearLabel="Clear draft"
          expandLabel="Expand prompt editor"
          closeExpandedLabel="Close prompt editor"
          expandedTitle="Edit prompt"
          isLoading={false}
          canSend={true}
          onChange={onChange}
          onKeyDown={vi.fn()}
          onOpenModelSelector={vi.fn()}
          onClear={() => { draft = ""; }}
          onSend={onSend}
        />
      );
    });

    await act(async () => {
      root.render(
        <ChatComposer
          textareaRef={createRef<HTMLTextAreaElement>()}
          value={draft}
          placeholder="Message"
          selectedModelLabel="GPT"
          switchModelLabel="Switch model"
          creditLabel={null}
          accessLabel={null}
          sendLabel="Send"
          sendingLabel="Sending"
          clearLabel="Clear draft"
          expandLabel="Expand prompt editor"
          closeExpandedLabel="Close prompt editor"
          expandedTitle="Edit prompt"
          isLoading={false}
          canSend={true}
          onChange={onChange}
          onKeyDown={vi.fn()}
          onOpenModelSelector={vi.fn()}
          onClear={vi.fn()}
          onSend={onSend}
        />
      );
    });

    const expandButton = host.querySelector<HTMLButtonElement>("[data-chat-expand-prompt]");
    expect(expandButton).toBeTruthy();
    await act(async () => {
      expandButton?.click();
    });

    const expandedEditor = document.querySelector<HTMLTextAreaElement>("[data-chat-fullscreen-editor]");
    expect(expandedEditor).toBeTruthy();
    expect(expandedEditor?.value).toBe("long prompt");
    expect(document.activeElement).toBe(expandedEditor);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      valueSetter?.call(expandedEditor, "updated prompt");
      expandedEditor?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("updated prompt");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("updated prompt");

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-chat-fullscreen-send]")?.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[aria-label='Close prompt editor']")?.click();
    });
    expect(document.querySelector("[data-chat-fullscreen-editor]")).toBeNull();
    expect(document.activeElement).toBe(expandButton);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
