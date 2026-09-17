import type {
  AiModelSummary,
  ChatMessage,
  ChatMessageRecord,
  ChatSessionSummary
} from "@ai-aggregate/shared";
import { getModelDisplayName } from "@ai-aggregate/shared";
import { apiUrl } from "./site-config";

interface CanSendChatMessageInput {
  input: string;
  isSending: boolean;
  selectedModel: string;
}

interface BuildChatCompletionPayloadInput {
  sessionId?: string | null;
  model: string;
  messages: ChatMessage[];
}

interface ResolveRequestModelInput {
  selectedModel: string;
  fallbackModel: string;
  selectedModelInfo?: Pick<AiModelSummary, "slug"> | null;
}

interface CreateModelChangeStateInput {
  oldModel: string;
  nextModel: string;
  isAnonymous: boolean;
  messages: ChatMessageRecord[];
  currentSessionId: string | null;
  error: string | null;
}

interface EnterKeyInput {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
}

interface CreateSessionDeleteStateInput {
  deletedSessionId: string;
  currentSessionId: string | null;
  sessions: ChatSessionSummary[];
}

interface CreateDeleteSessionRequestInput {
  /** @deprecated Use the built-in apiUrl() helper. Kept for backward compat. */
  apiBaseUrl?: string;
  sessionId: string;
  token: string | null;
}

interface DeleteSessionNetworkErrorMessageInput {
  deleteFailedMessage: string;
  apiUnreachableMessage: string;
}

export type ChatCompletionStreamEvent =
  | { event: "meta"; data: { sessionId?: string; model?: string } }
  | { event: "delta"; data: { content?: string } }
  | { event: "done"; data: { sessionId?: string; model?: string } }
  | { event: "error"; data: { message?: string; code?: string } };

type Locale = "zh-CN" | "en-US";

export interface ModelDisplaySection {
  key: string;
  title: string;
  models: AiModelSummary[];
}

const groupOrder = ["free", "reasoning", "coding", "advanced"];

const groupTitles: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    free: "免费模型",
    reasoning: "推理模型",
    advanced: "高级模型",
    coding: "编程模型"
  },
  "en-US": {
    free: "Free Models",
    reasoning: "Reasoning Models",
    advanced: "Advanced Models",
    coding: "Coding Models"
  }
};

function compareModelsForDisplay(a: AiModelSummary, b: AiModelSummary): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }

  return getModelDisplayName(a).localeCompare(getModelDisplayName(b));
}

function formatGroupTitle(group: string, locale: Locale): string {
  return groupTitles[locale][group] ?? group;
}

export function groupModelsForDisplay(
  models: AiModelSummary[],
  locale: Locale
): ModelDisplaySection[] {
  const sortedModels = [...models].sort(compareModelsForDisplay);
  const recommendedModels = sortedModels.filter((model) => model.isRecommended);
  const groupNames = Array.from(
    new Set(sortedModels.map((model) => model.group || "advanced"))
  ).sort((a, b) => {
    const aIndex = groupOrder.indexOf(a);
    const bIndex = groupOrder.indexOf(b);

    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
        (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    }

    return a.localeCompare(b);
  });
  const sections: ModelDisplaySection[] = [];

  if (recommendedModels.length > 0) {
    sections.push({
      key: "recommended",
      title: locale === "en-US" ? "Recommended" : "推荐",
      models: recommendedModels
    });
  }

  for (const group of groupNames) {
    sections.push({
      key: group,
      title: formatGroupTitle(group, locale),
      models: sortedModels.filter((model) => (model.group || "advanced") === group)
    });
  }

  return sections;
}

interface ModelSendValidationInput {
  isLoggedIn: boolean;
  remainingCredits: number | null;
  model?: Pick<AiModelSummary, "creditCost" | "allowGuest"> | null;
  locale: Locale;
}

export function canSendChatMessage({
  input,
  isSending,
  selectedModel
}: CanSendChatMessageInput): boolean {
  return (
    input.trim().length > 0 &&
    !isSending &&
    selectedModel.trim().length > 0
  );
}

export function buildChatCompletionPayload({
  sessionId,
  model,
  messages
}: BuildChatCompletionPayloadInput): {
  sessionId?: string;
  model: string;
  messages: ChatMessage[];
} {
  return {
    ...(sessionId ? { sessionId } : {}),
    model,
    messages
  };
}

function parseChatCompletionStreamBlock(block: string): ChatCompletionStreamEvent | null {
  const eventLine = block
    .split("\n")
    .map((line) => line.trimEnd())
    .find((line) => line.startsWith("event:"));
  const dataLines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  if (!eventLine || dataLines.length === 0) {
    return null;
  }

  const event = eventLine.slice("event:".length).trim();
  const data = JSON.parse(dataLines.join("\n")) as unknown;

  if (event === "meta" || event === "done") {
    return {
      event,
      data:
        typeof data === "object" && data !== null
          ? (data as { sessionId?: string; model?: string })
          : {}
    };
  }

  if (event === "delta") {
    return {
      event,
      data:
        typeof data === "object" && data !== null
          ? (data as { content?: string })
          : {}
    };
  }

  if (event === "error") {
    return {
      event,
      data:
        typeof data === "object" && data !== null
          ? (data as { message?: string; code?: string })
          : {}
    };
  }

  return null;
}

export function parseChatCompletionStreamChunk({
  buffer,
  chunk
}: {
  buffer: string;
  chunk: string;
}): {
  events: ChatCompletionStreamEvent[];
  buffer: string;
} {
  const combined = `${buffer}${chunk}`.replace(/\r\n/g, "\n");
  const parts = combined.split(/\n\n+/);
  const nextBuffer = parts.pop() ?? "";
  const events = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(parseChatCompletionStreamBlock)
    .filter((event): event is ChatCompletionStreamEvent => Boolean(event));

  return {
    events,
    buffer: nextBuffer
  };
}

export function tryAcquireChatSendLock(lock: { current: boolean }): boolean {
  if (lock.current) {
    return false;
  }

  lock.current = true;
  return true;
}

export function releaseChatSendLock(lock: { current: boolean }): void {
  lock.current = false;
}

export function isChatCompletionStreamResponseUsable(
  response: Pick<Response, "ok" | "body">
): boolean {
  return response.ok && Boolean(response.body);
}

export function resolveRequestModel({
  selectedModel,
  fallbackModel,
  selectedModelInfo
}: ResolveRequestModelInput): string {
  if (selectedModelInfo?.slug.trim()) {
    return selectedModelInfo.slug.trim();
  }

  return selectedModel.trim() || fallbackModel;
}

export function formatModelCreditCostLabel(
  creditCost: number,
  locale: Locale
): string {
  if (creditCost <= 0) {
    return locale === "en-US" ? "Free" : "免费";
  }

  return locale === "en-US"
    ? `${creditCost} ${creditCost === 1 ? "credit" : "credits"} per message`
    : `消耗 ${creditCost} 额度 / 次`;
}

export function formatModelAccessLabel(
  allowGuest: boolean,
  isLoggedIn: boolean,
  locale: Locale
): string {
  if (allowGuest) {
    return locale === "en-US" ? "Guest available" : "游客可用";
  }

  if (isLoggedIn) {
    return locale === "en-US" ? "Sign-in required" : "登录后可用";
  }

  return locale === "en-US" ? "Sign-in required" : "游客不可用";
}

export function validateModelBeforeSend({
  isLoggedIn,
  remainingCredits,
  model,
  locale
}: ModelSendValidationInput): string | null {
  if (!model) {
    return null;
  }

  if (!isLoggedIn && !model.allowGuest) {
    return locale === "en-US"
      ? "This model requires sign-in"
      : "该模型需要登录后使用";
  }

  if (
    isLoggedIn &&
    remainingCredits !== null &&
    remainingCredits < model.creditCost
  ) {
    return locale === "en-US"
      ? `Insufficient credits. This model requires ${model.creditCost} credits per message`
      : `额度不足，当前模型每次需要 ${model.creditCost} 额度`;
  }

  return null;
}

export function createModelChangeState({
  oldModel,
  nextModel,
  isAnonymous,
  messages,
  currentSessionId,
  error
}: CreateModelChangeStateInput): {
  selectedModel: string;
  messages: ChatMessageRecord[];
  currentSessionId: string | null;
  error: string | null;
  modelChanged: boolean;
} {
  const modelChanged = oldModel !== nextModel;

  if (!isAnonymous || !modelChanged) {
    return {
      selectedModel: nextModel,
      messages,
      currentSessionId,
      error,
      modelChanged
    };
  }

  return {
    selectedModel: nextModel,
    messages: [],
    currentSessionId: null,
    error: null,
    modelChanged
  };
}

export function shouldSubmitOnEnter({
  key,
  shiftKey,
  isComposing = false
}: EnterKeyInput): boolean {
  return key === "Enter" && !shiftKey && !isComposing;
}

export function createSessionDeleteState({
  deletedSessionId,
  currentSessionId,
  sessions
}: CreateSessionDeleteStateInput): {
  sessions: ChatSessionSummary[];
  currentSessionId: string | null;
  shouldReloadMessages: boolean;
} {
  const remainingSessions = sessions.filter(
    (session) => session.id !== deletedSessionId
  );
  const deletedCurrentSession = currentSessionId === deletedSessionId;

  return {
    sessions: remainingSessions,
    currentSessionId: deletedCurrentSession
      ? remainingSessions[0]?.id ?? null
      : currentSessionId,
    shouldReloadMessages: deletedCurrentSession && remainingSessions.length > 0
  };
}

export function createDeleteSessionRequest({
  apiBaseUrl,
  sessionId,
  token
}: CreateDeleteSessionRequestInput):
  | {
      url: string;
      init: RequestInit;
    }
  | null {
  if (!token) {
    return null;
  }

  const deleteUrl = apiBaseUrl
    ? `${apiBaseUrl.replace(/\/+$/, "")}/chat/sessions/${sessionId}`
    : apiUrl(`/chat/sessions/${sessionId}`);
  return {
    url: deleteUrl,
    init: {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  };
}

export function createDeleteSessionNetworkErrorMessage({
  deleteFailedMessage,
  apiUnreachableMessage
}: DeleteSessionNetworkErrorMessageInput): string {
  return `${deleteFailedMessage}: ${apiUnreachableMessage}`;
}

export async function readResponseErrorMessage(
  response: Pick<Response, "status" | "text">,
  fallbackMessage: string
): Promise<string> {
  const text = await response.text();
  const trimmedText = text.trim();

  if (!trimmedText) {
    return `${fallbackMessage} (${response.status})`;
  }

  try {
    const body = JSON.parse(trimmedText) as unknown;

    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string" &&
      body.message.trim().length > 0
    ) {
      return body.message;
    }
  } catch {
    return trimmedText;
  }

  return trimmedText;
}
