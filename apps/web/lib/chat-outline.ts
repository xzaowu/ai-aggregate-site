import type { ChatMessageRecord } from "@ai-aggregate/shared";
import { generateUserMessageNavTitle } from "./session-title";

export interface ChatTurnNavItem {
  messageId: string;
  title: string;
  anchorId: string;
  index: number;
}

export interface ScrollChatTurnParams {
  container: HTMLElement;
  target: HTMLElement;
  offset?: number;
}

export function scrollChatTurn({
  container,
  target,
  offset = 16
}: ScrollChatTurnParams): boolean {
  if (!container.contains(target)) {
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextTop =
    container.scrollTop + targetRect.top - containerRect.top - offset;

  container.scrollTo({
    top: Math.max(0, nextTop),
    behavior: "smooth"
  });
  return true;
}

export function isNearBottom(
  container: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = 80
): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

export function parseChatTurnNavigation(
  messages: ChatMessageRecord[]
): ChatTurnNavItem[] {
  const items: ChatTurnNavItem[] = [];
  let turnIndex = 0;

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    turnIndex++;
    const title = generateUserMessageNavTitle(message.content, turnIndex);
    const anchorId = `chat-turn-${message.id}`;

    items.push({
      messageId: message.id,
      title,
      anchorId,
      index: turnIndex
    });
  }

  return items;
}

export function findChatTurnTarget(
  container: HTMLElement,
  messageId: string
): HTMLElement | null {
  const candidates = container.querySelectorAll<HTMLElement>(
    "[data-chat-turn-anchor]"
  );

  for (const candidate of Array.from(candidates)) {
    if (candidate.getAttribute("data-chat-turn-anchor") === messageId) {
      return candidate;
    }
  }

  return null;
}

export function scrollToChatTurn(
  messageId: string,
  container: HTMLElement | null
): boolean {
  if (!container) {
    return false;
  }

  const target = findChatTurnTarget(container, messageId);
  if (!target) {
    return false;
  }

  return scrollChatTurn({
    container,
    target
  });
}
