// @vitest-environment jsdom

import type { ChatMessageRecord } from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatOutline,
  closeChatOutlinePinned,
  getChatOutlinePanelClassName,
  toggleChatOutlinePinned
} from "./ChatOutline";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeMsg(id: string, overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id,
    sessionId: "session_1",
    role: "user",
    content: `Message ${id}`,
    model: "test-model",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

const ref = { current: null };

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function rect(top: number): DOMRect {
  return {
    bottom: top,
    height: 0,
    left: 0,
    right: 0,
    top,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({})
  };
}

describe("ChatOutline", () => {
  it("keeps the navigation boundary mounted when no user messages exist", () => {
    expect(renderToStaticMarkup(
      <ChatOutline messages={[makeMsg("a1", { role: "assistant" })]} messageScrollContainerRef={ref} />
    )).toContain('data-chat-turn-nav-boundary="true"');
  });

  it("renders a floating overlay with an accessible collapsed trigger", () => {
    const html = renderToStaticMarkup(
      <ChatOutline messages={[makeMsg("u1", { content: "Hello world" })]} messageScrollContainerRef={ref} />
    );
    expect(html).toContain('data-chat-outline="true"');
    expect(html).toContain('data-chat-outline-trigger="true"');
    expect(html).toContain('aria-label="Conversation navigation"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("xl:block");
    expect(html).not.toContain("w-60 shrink-0");
  });

  it("uses one wide pointer boundary around the trigger and panel", () => {
    const html = renderToStaticMarkup(
      <ChatOutline messages={[makeMsg("u1")]} messageScrollContainerRef={ref} />
    );

    expect(html).toContain('data-chat-turn-nav-boundary="true"');
    expect(html).toContain("group/nav pointer-events-auto relative flex h-full w-9");
    expect(html).toContain('data-chat-turn-nav-pinned="false"');
    expect(html).toContain("type=\"button\"");
    expect(html).toContain("min-h-24");
    expect(html).toContain("w-8");
    expect(html).toContain("focus-visible:outline-2");
  });

  it("keeps the expanded panel bounded and internally scrollable", () => {
    const html = renderToStaticMarkup(
      <ChatOutline messages={[makeMsg("u1")]} messageScrollContainerRef={ref} />
    );
    expect(html).toContain('data-chat-outline-panel="true"');
    expect(html).toContain('data-chat-turn-nav-panel="true"');
    expect(html).toContain("absolute");
    expect(html).toContain("pointer-events-auto");
    expect(html).toContain("max-h-[min(32rem,60vh)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("bg-white/95");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("invisible");
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/nav:visible");
    expect(html).toContain("group-hover/nav:opacity-100");
    expect(html).toContain("group-hover/nav:pointer-events-auto");
    expect(html).toContain("group-hover/nav:translate-x-0");
    expect(html).toContain("group-focus-within/nav:visible");
    expect(html).toContain("group-focus-within/nav:opacity-100");
    expect(html).toContain("group-focus-within/nav:pointer-events-auto");
    expect(html).toContain("group-focus-within/nav:translate-x-0");
    expect(html).toContain("transition");
    expect(html).toContain("duration-150");
  });

  it("keeps trigger and panel inside the same boundary", () => {
    const html = renderToStaticMarkup(
      <ChatOutline messages={[makeMsg("u1")]} messageScrollContainerRef={ref} />
    );
    const boundaryStart = html.indexOf('data-chat-turn-nav-boundary="true"');
    const triggerIndex = html.indexOf('data-chat-turn-nav-trigger="true"');
    const panelIndex = html.indexOf('data-chat-turn-nav-panel="true"');

    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(triggerIndex).toBeGreaterThan(boundaryStart);
    expect(panelIndex).toBeGreaterThan(triggerIndex);
    expect(html).toContain("group/nav");
  });

  it("uses pinned state to add expanded panel classes", () => {
    const closed = getChatOutlinePanelClassName(false);
    const pinned = getChatOutlinePanelClassName(true);

    expect(closed).toContain("invisible");
    expect(closed).toContain("opacity-0");
    expect(closed).toContain("pointer-events-none");
    expect(pinned).toContain("visible");
    expect(pinned).toContain("opacity-100");
    expect(pinned).toContain("pointer-events-auto");
    expect(pinned).toContain("translate-x-0");
  });

  it("toggles pinned state from trigger clicks and closes it for Escape", () => {
    expect(toggleChatOutlinePinned(false)).toBe(true);
    expect(toggleChatOutlinePinned(true)).toBe(false);
    expect(closeChatOutlinePinned()).toBe(false);
  });

  it("exposes stable navigation QA attributes on the trigger and every item", () => {
    const html = renderToStaticMarkup(
      <ChatOutline
        messages={[makeMsg("u1", { content: "First question" }), makeMsg("u2", { content: "Second question" })]}
        messageScrollContainerRef={ref}
      />
    );

    expect(html).toContain('data-chat-turn-nav-trigger="true"');
    expect(html).toContain('data-chat-turn-nav="u1"');
    expect(html).toContain('data-chat-turn-target="chat-turn-u1"');
    expect(html).toContain('data-chat-turn-nav="u2"');
    expect(html).toContain('data-chat-turn-target="chat-turn-u2"');
    expect(html).toContain("pointer-events-auto");
  });

  it("renders every item in one bounded panel and sampled collapsed ticks", () => {
    const messages = Array.from({ length: 100 }, (_, index) => makeMsg(`u${index}`));
    const html = renderToStaticMarkup(<ChatOutline messages={messages} messageScrollContainerRef={ref} />);
    expect(html.match(/data-chat-outline-heading=/g)).toHaveLength(100);
    expect(html).toContain('data-chat-outline-tick="true"');
    expect(html).toContain("max-h-[min(32rem,60vh)]");
  });

  it("uses translated conversation title and preserves item anchors", () => {
    const html = renderToStaticMarkup(
      <ChatOutline messages={[
        makeMsg("u1", { content: "First question" }),
        makeMsg("a1", { role: "assistant", content: "Answer" }),
        makeMsg("u2", { content: "Second question" })
      ]} messageScrollContainerRef={ref} />
    );
    expect(html).toContain("本轮对话");
    expect(html).toContain('data-chat-outline-heading="chat-turn-u1"');
    expect(html).toContain('data-chat-outline-heading="chat-turn-u2"');
    expect(html).toContain('aria-keyshortcuts="Escape"');
  });

  it("clicks real desktop navigation buttons and moves only the desktop container", async () => {
    const mobileContainer = document.createElement("div");
    const desktopContainer = document.createElement("div");
    const mobileTarget = document.createElement("div");
    const firstDesktopTarget = document.createElement("div");
    const secondDesktopTarget = document.createElement("div");
    mobileTarget.id = "chat-turn-mobile-u1";
    firstDesktopTarget.id = "chat-turn-desktop-u1";
    secondDesktopTarget.id = "chat-turn-desktop-u2";
    mobileTarget.dataset.chatTurnAnchor = "u1";
    firstDesktopTarget.dataset.chatTurnAnchor = "u1";
    secondDesktopTarget.dataset.chatTurnAnchor = "u2";
    mobileContainer.append(mobileTarget);
    desktopContainer.append(firstDesktopTarget, secondDesktopTarget);
    mobileTarget.getBoundingClientRect = vi.fn(() => rect(160));
    firstDesktopTarget.getBoundingClientRect = vi.fn(() => rect(240));
    secondDesktopTarget.getBoundingClientRect = vi.fn(() => rect(640));
    desktopContainer.getBoundingClientRect = vi.fn(() => rect(100));
    const mobileScrollTo = vi.fn();
    const desktopScrollTo = vi.fn(({ top }: ScrollToOptions) => {
      desktopContainer.scrollTop = top ?? 0;
    });
    mobileContainer.scrollTo = mobileScrollTo as unknown as HTMLElement["scrollTo"];
    desktopContainer.scrollTo = desktopScrollTo as unknown as HTMLElement["scrollTo"];
    document.body.append(mobileContainer, desktopContainer);

    const outlineHost = document.createElement("div");
    document.body.append(outlineHost);
    const root = createRoot(outlineHost);
    const desktopRef = { current: desktopContainer };

    await act(async () => {
      root.render(
        <ChatOutline
          messages={[
            makeMsg("u1", { content: "First question" }),
            makeMsg("u2", { content: "Second question" })
          ]}
          messageScrollContainerRef={desktopRef}
        />
      );
    });

    const buttons = outlineHost.querySelectorAll<HTMLButtonElement>("[data-chat-turn-nav]");
    expect(buttons).toHaveLength(2);
    expect(mobileContainer.querySelector("#chat-turn-mobile-u1")).toBe(mobileTarget);
    expect(desktopContainer.querySelector("#chat-turn-desktop-u1")).toBe(firstDesktopTarget);

    await act(async () => {
      buttons[0]!.click();
    });
    const firstTop = desktopScrollTo.mock.calls[0]![0].top;
    expect(firstTop).toBe(124);
    expect(buttons[0]!.className).toContain("bg-slate-100");
    expect(buttons[1]!.className).not.toContain("bg-slate-100");

    await act(async () => {
      buttons[1]!.click();
    });
    const secondTop = desktopScrollTo.mock.calls[1]![0].top;
    expect(secondTop).toBe(648);
    expect(secondTop).not.toBe(firstTop);
    expect(buttons[0]!.className).not.toContain("bg-slate-100");
    expect(buttons[1]!.className).toContain("bg-slate-100");
    expect(mobileScrollTo).not.toHaveBeenCalled();
    expect(mobileContainer.scrollTop).toBe(0);

    await act(async () => {
      root.unmount();
    });
    outlineHost.remove();
    mobileContainer.remove();
    desktopContainer.remove();
  });
});
