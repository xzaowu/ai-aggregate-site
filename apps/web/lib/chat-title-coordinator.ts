import { generateSessionTitle, shouldRegenerateTitle } from "./session-title";

export interface CoordinateTitleInput {
  sessionId: string;
  currentTitle: string;
  firstUserContent: string;
  locale: string;
  getPatchUrl: (sessionId: string) => string;
  fetchImpl: typeof fetch;
  authHeaders: Record<string, string>;
  titleInFlightRef: { current: boolean };
  updatedIdsRef: { current: Set<string> };
  onTitleUpdated: (sessionId: string, title: string) => void;
}

export function hasUserMessage(
  messages: { role: string }[]
): boolean {
  return messages.some((m) => m.role === "user");
}

export interface CompensationInput {
  activeSession: { id: string; title: string } | undefined;
  messages: { role: string; content: string }[];
}

export interface CompensationOutput {
  sessionId: string;
  firstUserContent: string;
}

export function getSessionTitleCompensation(
  input: CompensationInput
): CompensationOutput | null {
  const { activeSession, messages } = input;
  if (!activeSession) {
    return null;
  }
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) {
    return null;
  }
  return {
    sessionId: activeSession.id,
    firstUserContent: firstUserMsg.content
  };
}

export interface StreamTitleEventInput {
  event: "meta" | "delta" | "done";
  eventSessionId?: string | null;
  isFirstUserMessage: boolean;
  firstUserPrompt: string;
  fallbackSessionId: string;
  ensureSessionTitle: (sessionId: string, content: string) => void;
}

export function processStreamTitleEvent(
  input: StreamTitleEventInput
): void {
  const { event, eventSessionId, isFirstUserMessage, firstUserPrompt,
    fallbackSessionId, ensureSessionTitle } = input;

  if (event === "meta" && eventSessionId && isFirstUserMessage) {
    ensureSessionTitle(eventSessionId, firstUserPrompt);
    return;
  }

  if (event === "done" && isFirstUserMessage) {
    ensureSessionTitle(eventSessionId ?? fallbackSessionId, firstUserPrompt);
  }
}

/**
 * Coordinates title generation and PATCH for a chat session.
 * Handles: in-flight guard, success guard, should-regenerate check,
 * title generation, PATCH execution, and local state update callback.
 */
export async function coordinateSessionTitle(
  input: CoordinateTitleInput
): Promise<"generated" | "already-updated" | "no-title-needed" | "no-content"> {
  const { sessionId, currentTitle, firstUserContent, locale, fetchImpl,
    titleInFlightRef, updatedIdsRef, onTitleUpdated } = input;

  if (updatedIdsRef.current.has(sessionId)) {
    return "already-updated";
  }

  if (!shouldRegenerateTitle(currentTitle, locale)) {
    return "no-title-needed";
  }

  const generated = generateSessionTitle(firstUserContent);
  if (!generated) {
    return "no-content";
  }

  if (titleInFlightRef.current) {
    return "already-updated";
  }

  titleInFlightRef.current = true;
  const url = input.getPatchUrl(sessionId);

  try {
    const response = await fetchImpl(url, {
      method: "PATCH",
      headers: {
        ...input.authHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title: generated })
    });
    if (response.ok) {
      updatedIdsRef.current.add(sessionId);
      onTitleUpdated(sessionId, generated);
    }
    return "generated";
  } catch {
    return "generated";
  } finally {
    titleInFlightRef.current = false;
  }
}
