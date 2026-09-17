"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { ChatMessageRecord } from "@ai-aggregate/shared";
import {
  parseChatTurnNavigation,
  scrollToChatTurn,
  type ChatTurnNavItem
} from "../../lib/chat-outline";

const maxCollapsedTicks = 16;

const chatOutlinePanelBaseClassName =
  "invisible pointer-events-none absolute right-0 top-1/2 z-50 w-60 max-h-[min(32rem,60vh)] -translate-y-1/2 translate-x-1 overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur transition-[opacity,transform,visibility] duration-150 group-hover/nav:visible group-hover/nav:opacity-100 group-hover/nav:pointer-events-auto group-hover/nav:translate-x-0 group-focus-within/nav:visible group-focus-within/nav:opacity-100 group-focus-within/nav:pointer-events-auto group-focus-within/nav:translate-x-0 dark:border-slate-800 dark:bg-slate-900/95";

export function toggleChatOutlinePinned(isPinnedOpen: boolean): boolean {
  return !isPinnedOpen;
}

export function closeChatOutlinePinned(): boolean {
  return false;
}

export function getChatOutlinePanelClassName(isPinnedOpen: boolean): string {
  return `${chatOutlinePanelBaseClassName} ${
    isPinnedOpen
      ? "visible pointer-events-auto translate-x-0 opacity-100"
      : "opacity-0"
  }`;
}

function getTickItems<T>(items: T[]): T[] {
  if (items.length <= maxCollapsedTicks) {
    return items;
  }

  return Array.from({ length: maxCollapsedTicks }, (_, index) => {
    const itemIndex = Math.round(
      (index * (items.length - 1)) / (maxCollapsedTicks - 1)
    );
    return items[itemIndex]!;
  });
}

export function ChatOutline({
  messages,
  messageScrollContainerRef,
  onBeforeNavigate,
  onNavigate,
  title = "本轮对话",
  ariaLabel = "Conversation navigation"
}: {
  messages: ChatMessageRecord[];
  messageScrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onBeforeNavigate?: () => void;
  onNavigate?: (item: ChatTurnNavItem) => void;
  title?: string;
  ariaLabel?: string;
}) {
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [isPinnedOpen, setIsPinnedOpen] = useState(false);
  const items = useMemo(() => parseChatTurnNavigation(messages), [messages]);
  const tickItems = useMemo(() => getTickItems(items), [items]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPinnedOpen(closeChatOutlinePinned());
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function navigate(event: React.MouseEvent<HTMLButtonElement>, item: ChatTurnNavItem) {
    event.preventDefault();
    onBeforeNavigate?.();
    setActiveAnchorId(item.anchorId);
    onNavigate?.(item);
    if (!onNavigate) {
      scrollToChatTurn(item.messageId, messageScrollContainerRef.current);
    }
  }

  return (
    <aside
      className="pointer-events-none absolute inset-y-0 right-2 z-40 hidden xl:block"
      data-chat-outline="true"
      aria-label={ariaLabel}
    >
      <div
        className="group/nav pointer-events-auto relative flex h-full w-9 items-center justify-end"
        data-chat-turn-nav-boundary="true"
        data-chat-outline-interaction="true"
        data-chat-turn-nav-pinned={isPinnedOpen ? "true" : "false"}
      >
        <button
          type="button"
          className="pointer-events-auto relative z-[60] flex min-h-24 w-8 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
          aria-label={ariaLabel}
          aria-keyshortcuts="Escape"
          aria-expanded={isPinnedOpen}
          data-chat-turn-nav-trigger="true"
          onClick={() => {
            setIsPinnedOpen(toggleChatOutlinePinned);
          }}
          data-chat-outline-trigger="true"
        >
          {tickItems.map((item) => (
            <span
              key={item.anchorId}
              className={`block h-0.5 rounded-full transition-all ${
                item.anchorId === activeAnchorId
                  ? "w-5 bg-slate-500 dark:bg-slate-300"
                  : "w-3 bg-slate-300 group-hover:w-5 group-hover:bg-slate-400 dark:bg-slate-600 dark:group-hover:bg-slate-500"
              }`}
              data-chat-outline-tick="true"
              aria-hidden="true"
            />
          ))}
        </button>

        <div
          className={getChatOutlinePanelClassName(isPinnedOpen)}
          data-chat-outline-panel="true"
          data-chat-turn-nav-panel="true"
        >
          <div className="select-none border-b border-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {title}
          </div>
          <div
            className="p-1"
            data-chat-outline-list="true"
          >
            {items.map((item) => {
              const isActive = item.anchorId === activeAnchorId;
              return (
                <button
                  key={item.anchorId}
                  type="button"
                  className={`block w-full min-w-0 truncate rounded-lg px-3 py-1.5 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                    isActive
                      ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                      : "font-normal text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60"
                  }`}
                  title={item.title}
                  onClick={(event) => navigate(event, item)}
                  data-chat-turn-nav={item.messageId}
                  data-chat-turn-target={item.anchorId}
                  data-chat-outline-heading={item.anchorId}
                  data-chat-outline-index={item.index}
                >
                  {item.title}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
