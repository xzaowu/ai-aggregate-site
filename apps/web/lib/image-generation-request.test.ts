import { describe, expect, it, vi } from "vitest";
import {
  createImageGenerationAttempt,
  type ImageGenerationRequestPayload
} from "./image-generation-attempt";
import { sendImageGenerationAttempt } from "./image-generation-request";

const endpoint = "https://api.example.test/image/generate";
const token = "user-token";

function createPayload(): ImageGenerationRequestPayload {
  return {
    prompt: "A quiet reading room",
    modelId: "image-model",
    size: "1024x1024",
    count: 1,
    mode: "text-to-image",
    imageSessionId: "session-1",
    clientEntryId: "entry-1",
    imageSessionTitle: "Reading room"
  };
}

function createAttempt(key = "attempt-key-00000001") {
  return createImageGenerationAttempt(createPayload(), {
    createKey: () => key
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function successBody() {
  return {
    task: { id: "task-1" },
    assets: []
  };
}

function requestInit(fetchImplementation: ReturnType<typeof vi.fn>): RequestInit {
  const call = fetchImplementation.mock.calls[0];
  expect(call).toBeDefined();
  return call?.[1] ?? {};
}

describe("sendImageGenerationAttempt", () => {
  it("posts to the provided image generation endpoint", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));

    await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("preserves the bearer Authorization header", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));

    await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(new Headers(requestInit(fetchImplementation).headers).get("Authorization")).toBe(
      "Bearer user-token"
    );
  });

  it("preserves the JSON Content-Type header", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));

    await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(new Headers(requestInit(fetchImplementation).headers).get("Content-Type")).toBe(
      "application/json"
    );
  });

  it("sends the attempt key in Idempotency-Key", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));
    const attempt = createAttempt();

    await sendImageGenerationAttempt({
      attempt,
      token,
      endpoint,
      fetchImplementation
    });

    expect(new Headers(requestInit(fetchImplementation).headers).get("Idempotency-Key")).toBe(
      attempt.key
    );
  });

  it("serializes only the immutable attempt payload as the body", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));
    const attempt = createAttempt();

    await sendImageGenerationAttempt({
      attempt,
      token,
      endpoint,
      fetchImplementation
    });

    expect(requestInit(fetchImplementation).body).toBe(JSON.stringify(attempt.payload));
  });

  it("does not place the attempt key in the request body", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));
    const attempt = createAttempt();

    await sendImageGenerationAttempt({
      attempt,
      token,
      endpoint,
      fetchImplementation
    });

    expect(String(requestInit(fetchImplementation).body)).not.toContain(attempt.key);
  });

  it("uses the same key when the same attempt is sent twice", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));
    const attempt = createAttempt();

    await sendImageGenerationAttempt({ attempt, token, endpoint, fetchImplementation });
    await sendImageGenerationAttempt({ attempt, token, endpoint, fetchImplementation });

    const firstHeaders = new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get("Idempotency-Key")).toBe(attempt.key);
    expect(secondHeaders.get("Idempotency-Key")).toBe(attempt.key);
  });

  it("uses the same body when the same attempt is sent twice", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));
    const attempt = createAttempt();

    await sendImageGenerationAttempt({ attempt, token, endpoint, fetchImplementation });
    await sendImageGenerationAttempt({ attempt, token, endpoint, fetchImplementation });

    expect(fetchImplementation.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify(attempt.payload)
    );
    expect(fetchImplementation.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify(attempt.payload)
    );
  });

  it("uses different keys for two new attempts with the same payload", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));
    const payload = createPayload();
    const firstAttempt = createImageGenerationAttempt(payload, {
      createKey: () => "attempt-key-00000001"
    });
    const secondAttempt = createImageGenerationAttempt(payload, {
      createKey: () => "attempt-key-00000002"
    });

    await sendImageGenerationAttempt({
      attempt: firstAttempt,
      token,
      endpoint,
      fetchImplementation
    });
    await sendImageGenerationAttempt({
      attempt: secondAttempt,
      token,
      endpoint,
      fetchImplementation
    });

    const firstHeaders = new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get("Idempotency-Key")).not.toBe(
      secondHeaders.get("Idempotency-Key")
    );
  });

  it("calls fetch exactly once per helper invocation", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));

    await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("invokes onFetchStarted after request construction and immediately before fetch", async () => {
    const events: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      events.push("fetch");
      return jsonResponse(successBody());
    });

    await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation,
      onFetchStarted: () => events.push("started")
    });

    expect(events).toEqual(["started", "fetch"]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("classifies a valid 200 response as success", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody(), 200));

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(result).toMatchObject({
      status: 200,
      decision: { kind: "success", terminal: true }
    });
  });

  it("classifies a valid 202 response as in progress", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(
      jsonResponse({ status: "in_progress", taskId: "task-1", retryAfterMs: 2500 }, 202)
    );

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(result).toMatchObject({
      status: 202,
      decision: { kind: "in_progress", terminal: false }
    });
  });

  it("classifies a valid 409 response as conflict", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(
      jsonResponse({ code: "IDEMPOTENCY_KEY_CONFLICT", message: "Conflict" }, 409)
    );

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(result).toMatchObject({
      status: 409,
      decision: { kind: "conflict", terminal: true }
    });
  });

  it("classifies a valid 410 response as unavailable", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(
      jsonResponse(
        { code: "IDEMPOTENCY_RESULT_UNAVAILABLE", message: "Unavailable" },
        410
      )
    );

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(result).toMatchObject({
      status: 410,
      decision: { kind: "unavailable", terminal: true }
    });
  });

  it("preserves and classifies a retryable structured 503 failure", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const body = {
      message: "Safety check unavailable",
      code: "IMAGE_SAFETY_CHECK_UNAVAILABLE",
      retryable: true
    };
    fetchImplementation.mockResolvedValue(
      jsonResponse(body, 503)
    );

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(result).toMatchObject({
      status: 503,
      body,
      decision: { kind: "structured_failure", terminal: true, retryable: true }
    });
  });

  it("preserves and classifies a non-retryable structured 422 failure", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const body = {
      message: "Prompt blocked",
      code: "IMAGE_PROMPT_BLOCKED",
      retryable: false
    };
    fetchImplementation.mockResolvedValue(jsonResponse(body, 422));

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(result).toMatchObject({
      status: 422,
      body,
      decision: { kind: "structured_failure", terminal: true, retryable: false }
    });
  });

  it("classifies malformed JSON as an unknown HTTP response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(
      new Response("private malformed response text", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(result).toEqual({
      status: 200,
      body: null,
      decision: { kind: "unknown_http_response", terminal: false }
    });
  });

  it("classifies a fetch throw as transport uncertain", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockRejectedValue(new Error("Failed to fetch"));

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(result).toEqual({
      status: null,
      body: null,
      decision: { kind: "transport_uncertain", terminal: false }
    });
  });

  it("does not issue a second POST after a fetch throw", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockRejectedValue(new Error("Failed to fetch"));

    await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("does not return malformed raw response text", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(
      new Response("private malformed response text", { status: 502 })
    );

    const result = await sendImageGenerationAttempt({
      attempt: createAttempt(),
      token,
      endpoint,
      fetchImplementation
    });

    expect(JSON.stringify(result)).not.toContain("private malformed response text");
  });

  it("does not allow another header source to override Idempotency-Key", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(jsonResponse(successBody()));
    const attempt = createAttempt("authoritative-key-0001");

    await sendImageGenerationAttempt({
      attempt,
      token,
      endpoint,
      fetchImplementation
    });

    const headers = new Headers(requestInit(fetchImplementation).headers);
    const headerNames: string[] = [];
    headers.forEach((_value, name) => {
      headerNames.push(name);
    });
    expect(headers.get("Idempotency-Key")).toBe("authoritative-key-0001");
    expect(headerNames.filter((name) => name === "idempotency-key")).toHaveLength(1);
  });
});
