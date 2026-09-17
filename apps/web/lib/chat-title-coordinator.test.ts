import { describe, expect, it, vi } from "vitest";
import {
  coordinateSessionTitle,
  getSessionTitleCompensation,
  hasUserMessage,
  processStreamTitleEvent,
} from "./chat-title-coordinator";

function makeInput(
  overrides: Partial<{
    sessionId: string;
    currentTitle: string;
    firstUserContent: string;
    locale: string;
    fetchResult: { ok: boolean; status: number };
    authHeaders: Record<string, string>;
    inFlight: boolean;
  }> = {}
) {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({}), overrides.fetchResult ?? { ok: true, status: 200 })
  );
  const titleInFlightRef = { current: overrides.inFlight ?? false };
  const updatedIdsRef = { current: new Set<string>() };
  const onTitleUpdated = vi.fn();
  const getPatchUrl = vi.fn((id: string) => `/api/chat/sessions/${id}`);

  return {
    fetchImpl,
    titleInFlightRef,
    updatedIdsRef,
    onTitleUpdated,
    getPatchUrl,
    input: {
      sessionId: overrides.sessionId ?? "session-1",
      currentTitle: overrides.currentTitle ?? "新会话",
      firstUserContent: overrides.firstUserContent ?? "请介绍人工智能的核心概念",
      locale: overrides.locale ?? "zh-CN",
      getPatchUrl,
      fetchImpl,
      authHeaders: overrides.authHeaders ?? { Authorization: "Bearer test" },
      titleInFlightRef,
      updatedIdsRef,
      onTitleUpdated,
    }
  };
}

describe("coordinateSessionTitle", () => {
  it("generates title and calls PATCH for default title session", async () => {
    const { input, fetchImpl, getPatchUrl, onTitleUpdated, updatedIdsRef, titleInFlightRef } = makeInput();

    const result = await coordinateSessionTitle(input);

    expect(result).toBe("generated");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0]).toBe("/api/chat/sessions/session-1");
    const init = call[1]! as RequestInit;
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.title).toBeTruthy();
    expect(body.title).not.toBe("新会话");
    expect(body.title).not.toBe("请介绍人工智能的核心概念");
    expect(body.title.length).toBeLessThan(20);
    expect(onTitleUpdated).toHaveBeenCalledWith("session-1", body.title);
    expect(updatedIdsRef.current.has("session-1")).toBe(true);
    expect(titleInFlightRef.current).toBe(false);
  });

  it("does not PATCH when title is already a normal short title", async () => {
    const { input, fetchImpl, onTitleUpdated } = makeInput({
      currentTitle: "人工智能核心概念"
    });

    const result = await coordinateSessionTitle(input);

    expect(result).toBe("no-title-needed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onTitleUpdated).not.toHaveBeenCalled();
  });

  it("returns no-content when user content is empty", async () => {
    const { input, fetchImpl, onTitleUpdated } = makeInput({
      firstUserContent: ""
    });

    const result = await coordinateSessionTitle(input);

    expect(result).toBe("no-content");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onTitleUpdated).not.toHaveBeenCalled();
  });

  it("returns already-updated if session already in success set", async () => {
    const { input, fetchImpl, onTitleUpdated, updatedIdsRef } = makeInput();
    updatedIdsRef.current.add("session-1");

    const result = await coordinateSessionTitle(input);

    expect(result).toBe("already-updated");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onTitleUpdated).not.toHaveBeenCalled();
  });

  it("returns already-updated when another PATCH is in flight", async () => {
    const { input, fetchImpl, onTitleUpdated } = makeInput({ inFlight: true });

    const result = await coordinateSessionTitle(input);

    expect(result).toBe("already-updated");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onTitleUpdated).not.toHaveBeenCalled();
  });

  it("does not crash when fetch fails, allows retry", async () => {
    const { input, fetchImpl, onTitleUpdated, updatedIdsRef, titleInFlightRef } = makeInput({
      fetchResult: { ok: false, status: 500 }
    });

    const result = await coordinateSessionTitle(input);

    expect(result).toBe("generated");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onTitleUpdated).not.toHaveBeenCalled();
    // Success set should NOT contain failed session
    expect(updatedIdsRef.current.has("session-1")).toBe(false);
    // In-flight should be cleared
    expect(titleInFlightRef.current).toBe(false);

    // Retry with success
    const fetch2 = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const result2 = await coordinateSessionTitle({ ...input, fetchImpl: fetch2 });
    expect(result2).toBe("generated");
    expect(fetch2).toHaveBeenCalledTimes(1);
    expect(onTitleUpdated).toHaveBeenCalledTimes(1); // second call succeeds
  });

  it("uses the provided getPatchUrl for URL construction", async () => {
    const { input, getPatchUrl } = makeInput({ sessionId: "session-xyz" });

    await coordinateSessionTitle(input);

    expect(getPatchUrl).toHaveBeenCalledWith("session-xyz");
  });

  it("sends auth headers in the request", async () => {
    const { input, fetchImpl } = makeInput({
      authHeaders: { Authorization: "Bearer custom-token" }
    });

    await coordinateSessionTitle(input);

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({
      Authorization: "Bearer custom-token",
      "Content-Type": "application/json"
    });
  });

  it("generates title for English default session", async () => {
    const { input, fetchImpl, onTitleUpdated } = makeInput({
      currentTitle: "New chat",
      locale: "en-US",
      firstUserContent: "Please explain the core concepts of artificial intelligence"
    });

    await coordinateSessionTitle(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.title).toBeTruthy();
    expect(body.title).not.toBe("New chat");
    const words = body.title.split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(8);
  });

  it("coordinates duplicate calls correctly (first succeeds, second is blocked)", async () => {
    const { input, updatedIdsRef } = makeInput();

    const r1 = await coordinateSessionTitle(input);
    const r2 = await coordinateSessionTitle(input);

    expect(r1).toBe("generated");
    expect(r2).toBe("already-updated");
    expect(input.fetchImpl).toHaveBeenCalledTimes(1);
    expect(updatedIdsRef.current.has("session-1")).toBe(true);
  });

  it("allows different sessions to both get titles", async () => {
    const fetch1 = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const fetch2 = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const ids = { current: new Set<string>() };
    const flightA = { current: false };
    const flightB = { current: false };

    const r1 = await coordinateSessionTitle({
      sessionId: "s1", currentTitle: "新会话", firstUserContent: "你好",
      locale: "zh-CN", getPatchUrl: (id) => `/api/${id}`, fetchImpl: fetch1,
      authHeaders: {}, titleInFlightRef: flightA, updatedIdsRef: ids,
      onTitleUpdated: vi.fn()
    });
    // Wait for r1 to fully complete before starting r2
    const r2 = await coordinateSessionTitle({
      sessionId: "s2", currentTitle: "New chat", firstUserContent: "Hello world testing",
      locale: "en-US", getPatchUrl: (id) => `/api/${id}`, fetchImpl: fetch2,
      authHeaders: {}, titleInFlightRef: flightB, updatedIdsRef: ids,
      onTitleUpdated: vi.fn()
    });

    expect(r1).toBe("generated");
    expect(r2).toBe("generated");
    expect(fetch1).toHaveBeenCalledTimes(1);
    expect(fetch2).toHaveBeenCalledTimes(1);
    expect(ids.current.size).toBe(2);
  });
});

describe("hasUserMessage", () => {
  it("returns false when no user message exists", () => {
    expect(hasUserMessage([{ role: "assistant" }, { role: "system" }])).toBe(false);
  });

  it("returns true when a user message exists", () => {
    expect(hasUserMessage([{ role: "assistant" }, { role: "user" }])).toBe(true);
  });

  it("returns true for only user message", () => {
    expect(hasUserMessage([{ role: "user" }])).toBe(true);
  });

  it("returns false for empty array", () => {
    expect(hasUserMessage([])).toBe(false);
  });
});

describe("getSessionTitleCompensation", () => {
  it("returns compensation data when session has default title and user message", () => {
    const result = getSessionTitleCompensation({
      activeSession: { id: "s1", title: "新会话" },
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "请帮我学习" },
        { role: "assistant", content: "好的" },
      ]
    });
    expect(result).toEqual({ sessionId: "s1", firstUserContent: "请帮我学习" });
  });

  it("returns null when no user message exists", () => {
    const result = getSessionTitleCompensation({
      activeSession: { id: "s1", title: "新会话" },
      messages: [{ role: "assistant", content: "ok" }]
    });
    expect(result).toBeNull();
  });

  it("returns null when activeSession is undefined", () => {
    const result = getSessionTitleCompensation({
      activeSession: undefined,
      messages: [{ role: "user", content: "hello" }]
    });
    expect(result).toBeNull();
  });

  it("uses first user message when multiple exist", () => {
    const result = getSessionTitleCompensation({
      activeSession: { id: "s2", title: "New chat" },
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "second question" },
      ]
    });
    expect(result?.firstUserContent).toBe("first question");
  });

  it("returns null for normal title even with user messages", () => {
    const result = getSessionTitleCompensation({
      activeSession: { id: "s1", title: "人工智能学习" },
      messages: [{ role: "user", content: "hello" }]
    });
    expect(result).toEqual({ sessionId: "s1", firstUserContent: "hello" });
  });
});

describe("processStreamTitleEvent", () => {
  it("calls ensureSessionTitle on meta event with sessionId", () => {
    const fn = vi.fn();

    processStreamTitleEvent({
      event: "meta",
      eventSessionId: "session-new",
      isFirstUserMessage: true,
      firstUserPrompt: "请介绍人工智能",
      fallbackSessionId: "session-old",
      ensureSessionTitle: fn
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("session-new", "请介绍人工智能");
  });

  it("does not call on delta event", () => {
    const fn = vi.fn();

    processStreamTitleEvent({
      event: "delta",
      isFirstUserMessage: true,
      firstUserPrompt: "test",
      fallbackSessionId: "s",
      ensureSessionTitle: fn
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it("calls on done as fallback", () => {
    const fn = vi.fn();

    processStreamTitleEvent({
      event: "done",
      eventSessionId: "session-done",
      isFirstUserMessage: true,
      firstUserPrompt: "test",
      fallbackSessionId: "s",
      ensureSessionTitle: fn
    });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not call if isFirstUserMessage is false", () => {
    const fn = vi.fn();

    processStreamTitleEvent({
      event: "meta",
      eventSessionId: "s",
      isFirstUserMessage: false,
      firstUserPrompt: "test",
      fallbackSessionId: "s",
      ensureSessionTitle: fn
    });

    expect(fn).not.toHaveBeenCalled();

    processStreamTitleEvent({
      event: "done",
      eventSessionId: "s",
      isFirstUserMessage: false,
      firstUserPrompt: "test",
      fallbackSessionId: "s",
      ensureSessionTitle: fn
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it("meta + delta + done sequence calls on both meta and done (dedup by coordinator)", () => {
    const fn = vi.fn();
    const base = {
      isFirstUserMessage: true,
      firstUserPrompt: "hello",
      fallbackSessionId: "s",
      ensureSessionTitle: fn
    };

    processStreamTitleEvent({ ...base, event: "meta", eventSessionId: "s" });
    processStreamTitleEvent({ ...base, event: "delta" });
    processStreamTitleEvent({ ...base, event: "done", eventSessionId: "s" });

    // Both meta and done fire — deduplication is handled by coordinateSessionTitle
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "s", "hello");
    expect(fn).toHaveBeenNthCalledWith(2, "s", "hello");
  });
});
