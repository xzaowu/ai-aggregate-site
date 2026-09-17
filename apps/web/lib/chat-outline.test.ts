// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageRecord } from "@ai-aggregate/shared";
import {
  findChatTurnTarget,
  isNearBottom,
  parseChatTurnNavigation,
  scrollToChatTurn
} from "./chat-outline";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeMsg(id: string, role: string, content: string): ChatMessageRecord {
  return {
    id,
    sessionId: "session_1",
    role: role as ChatMessageRecord["role"],
    content,
    model: "test-model",
    createdAt: new Date().toISOString()
  };
}

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

describe("parseChatTurnNavigation", () => {
  it("generates one item for one user message", () => {
    const items = parseChatTurnNavigation([makeMsg("u1", "user", "Hello")]);
    expect(items).toHaveLength(1);
    expect(items[0]!.anchorId).toBe("chat-turn-u1");
    expect(items[0]!.index).toBe(1);
  });

  it("generates three items for three user messages", () => {
    const msgs = [
      makeMsg("u1", "user", "First"),
      makeMsg("a1", "assistant", "Reply 1"),
      makeMsg("u2", "user", "Second"),
      makeMsg("a2", "assistant", "Reply 2"),
      makeMsg("u3", "user", "Third"),
    ];
    const items = parseChatTurnNavigation(msgs);
    expect(items).toHaveLength(3);
    expect(items.map(i => i.index)).toEqual([1, 2, 3]);
  });

  it("skips assistant messages", () => {
    const items = parseChatTurnNavigation([makeMsg("a1", "assistant", "Reply")]);
    expect(items).toHaveLength(0);
  });

  it("skips system messages", () => {
    const items = parseChatTurnNavigation([makeMsg("s1", "system", "System note")]);
    expect(items).toHaveLength(0);
  });

  it("generates unique anchors for duplicate text", () => {
    const msgs = [
      makeMsg("u1", "user", "Hello"),
      makeMsg("a1", "assistant", "Reply"),
      makeMsg("u2", "user", "Hello"),
    ];
    const items = parseChatTurnNavigation(msgs);
    expect(items).toHaveLength(2);
    expect(items[0]!.anchorId).toBe("chat-turn-u1");
    expect(items[1]!.anchorId).toBe("chat-turn-u2");
    expect(items[0]!.anchorId).not.toBe(items[1]!.anchorId);
  });

  it("strips markdown from nav titles", () => {
    const items = parseChatTurnNavigation([makeMsg("u1", "user", "Hello **world** [link](https://example.com)")]);
    expect(items[0]!.title).not.toContain("**");
    expect(items[0]!.title).not.toContain("[link]");
  });

  it("strips URLs from nav titles", () => {
    const items = parseChatTurnNavigation([makeMsg("u1", "user", "Check https://example.com/page about AI")]);
    expect(items[0]!.title).not.toContain("https://");
  });

  it("uses index fallback for empty content", () => {
    const items = parseChatTurnNavigation([makeMsg("u1", "user", "")]);
    expect(items[0]!.title).toBe("1");
  });

  it("handles 100 messages with unique stable items", () => {
    const msgs: ChatMessageRecord[] = [];
    for (let i = 0; i < 100; i++) {
      msgs.push(makeMsg(`u${i}`, "user", `Message number ${i}`));
    }
    const items = parseChatTurnNavigation(msgs);
    expect(items).toHaveLength(100);
    const anchorIds = new Set(items.map(i => i.anchorId));
    expect(anchorIds.size).toBe(100);
  });

  it("removes newlines and collapses whitespace", () => {
    const items = parseChatTurnNavigation([makeMsg("u1", "user", "hello\n\nworld  \n  test")]);
    expect(items[0]!.title).toBe("hello world test");
  });
});

describe("scrollToChatTurn", () => {
  it("selects and scrolls only the matching target inside the desktop container", () => {
    const mobileContainer = document.createElement("div");
    const desktopContainer = document.createElement("div");
    const mobileTarget = document.createElement("div");
    const desktopTarget = document.createElement("div");
    mobileTarget.id = "chat-turn-mobile-u1";
    desktopTarget.id = "chat-turn-desktop-u1";
    mobileTarget.dataset.chatTurnAnchor = "u1";
    desktopTarget.dataset.chatTurnAnchor = "u1";
    mobileContainer.dataset.testid = "mobile-container";
    desktopContainer.dataset.testid = "desktop-container";
    mobileContainer.append(mobileTarget);
    desktopContainer.append(desktopTarget);
    document.body.append(mobileContainer, desktopContainer);

    const mobileRect = vi.fn(() => rect(220));
    const desktopRect = vi.fn(() => rect(460));
    const desktopScrollTo = vi.fn(({ top }: ScrollToOptions) => {
      desktopContainer.scrollTop = top ?? 0;
    });
    mobileTarget.getBoundingClientRect = mobileRect;
    desktopTarget.getBoundingClientRect = desktopRect;
    desktopContainer.getBoundingClientRect = vi.fn(() => rect(100));
    desktopContainer.scrollTo = desktopScrollTo as unknown as HTMLElement["scrollTo"];
    const getElementById = vi.spyOn(document, "getElementById");

    expect(scrollToChatTurn("u1", desktopContainer)).toBe(true);
    expect(desktopScrollTo).toHaveBeenCalledWith({ top: 344, behavior: "smooth" });
    expect(desktopRect).toHaveBeenCalled();
    expect(mobileRect).not.toHaveBeenCalled();
    expect(getElementById).not.toHaveBeenCalled();
    expect(findChatTurnTarget(desktopContainer, "u1")).toBe(desktopTarget);
    expect(desktopContainer.scrollTop).toBe(344);
  });

  it("scrolls different desktop targets while never scrolling mobile", () => {
    const mobileContainer = document.createElement("div");
    const desktopContainer = document.createElement("div");
    const mobileTarget = document.createElement("div");
    const firstDesktopTarget = document.createElement("div");
    const secondDesktopTarget = document.createElement("div");
    mobileTarget.dataset.chatTurnAnchor = "u1";
    firstDesktopTarget.dataset.chatTurnAnchor = "u1";
    secondDesktopTarget.dataset.chatTurnAnchor = "u2";
    mobileContainer.append(mobileTarget);
    desktopContainer.append(firstDesktopTarget, secondDesktopTarget);
    document.body.append(mobileContainer, desktopContainer);

    mobileTarget.getBoundingClientRect = vi.fn(() => rect(180));
    firstDesktopTarget.getBoundingClientRect = vi.fn(() => rect(220));
    secondDesktopTarget.getBoundingClientRect = vi.fn(() => rect(620));
    desktopContainer.getBoundingClientRect = vi.fn(() => rect(100));
    const mobileScrollTo = vi.fn();
    const desktopScrollTo = vi.fn(({ top }: ScrollToOptions) => {
      desktopContainer.scrollTop = top ?? 0;
    });
    mobileContainer.scrollTo = mobileScrollTo as unknown as HTMLElement["scrollTo"];
    desktopContainer.scrollTo = desktopScrollTo as unknown as HTMLElement["scrollTo"];

    expect(scrollToChatTurn("u1", desktopContainer)).toBe(true);
    const firstTop = desktopScrollTo.mock.calls[0]![0].top;
    expect(scrollToChatTurn("u2", desktopContainer)).toBe(true);
    const secondTop = desktopScrollTo.mock.calls[1]![0].top;

    expect(firstTop).toBe(104);
    expect(secondTop).toBe(608);
    expect(secondTop).not.toBe(firstTop);
    expect(desktopScrollTo).toHaveBeenCalledTimes(2);
    expect(mobileScrollTo).not.toHaveBeenCalled();
    expect(mobileContainer.scrollTop).toBe(0);
  });

  it("keeps duplicate data anchors scoped and ids unique across surfaces", () => {
    const mobileContainer = document.createElement("div");
    const desktopContainer = document.createElement("div");
    const mobileTarget = document.createElement("div");
    const desktopTarget = document.createElement("div");
    mobileTarget.id = "chat-turn-mobile-u1";
    desktopTarget.id = "chat-turn-desktop-u1";
    mobileTarget.dataset.chatTurnAnchor = "u1";
    desktopTarget.dataset.chatTurnAnchor = "u1";
    mobileContainer.append(mobileTarget);
    desktopContainer.append(desktopTarget);
    document.body.append(mobileContainer, desktopContainer);

    const allIds = Array.from(document.querySelectorAll<HTMLElement>("[id]"), (node) => node.id);
    expect(document.querySelectorAll('[data-chat-turn-anchor="u1"]')).toHaveLength(2);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(mobileTarget.id).not.toBe(desktopTarget.id);
    expect(findChatTurnTarget(desktopContainer, "u1")).toBe(desktopTarget);
  });

  it("returns false without a container or a matching scoped anchor", () => {
    const container = document.createElement("div");

    expect(scrollToChatTurn("missing", container)).toBe(false);
    expect(scrollToChatTurn("missing", null)).toBe(false);
  });
});

describe("isNearBottom", () => {
  it("follows streaming output when the viewport is near the bottom", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 720, clientHeight: 220 })).toBe(true);
  });

  it("stops following after the user scrolls upward", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 220 })).toBe(false);
  });
});
