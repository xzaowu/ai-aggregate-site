import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  buildImageGenerationAttemptHeaders,
  classifyImageGenerationHttpResponse,
  classifyImageGenerationTransportError,
  createImageGenerationAttempt,
  createSecureUuid,
  isImageGenerationAttemptTerminal,
  type ImageGenerationAttemptDecision,
  type GenericImageGenerationRequestPayload,
  type ImageGenerationRequestPayload,
  type ImageReferencePayload,
  type QuickImageGenerationRequestPayload,
  validateIdempotencyKey
} from "./image-generation-attempt";

const idempotencyKeyPattern = /^[A-Za-z0-9._~:-]{16,128}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createTestPayload(options?: {
  prompt?: string;
  referenceImage?: ImageReferencePayload | null;
  referenceImages?: ImageReferencePayload[];
  extra?: Record<string, unknown>;
}): ImageGenerationRequestPayload {
  return {
    prompt: options?.prompt ?? "test prompt",
    modelId: "test-model",
    size: "1024x1024",
    count: 1,
    mode: "text-to-image",
    imageSessionId: "session-1",
    clientEntryId: "entry-1",
    imageSessionTitle: "title-1",
    ...(options?.referenceImage !== undefined
      ? { referenceImage: options.referenceImage }
      : {}),
    ...(options?.referenceImages !== undefined
      ? { referenceImages: options.referenceImages }
      : {}),
    ...(options?.extra ?? {})
  };
}

function createIncrementingKeyFactory(): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `key-${String(index).padStart(14, "0")}`;
  };
}

describe("image generation attempt", () => {
  describe("payload contracts", () => {
    it("deeply snapshots and freezes ordered referenceImages for retries", () => {
      const references: ImageReferencePayload[] = [
        { dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png", name: "A.png" },
        { dataUrl: "data:image/jpeg;base64,Qg==", mimeType: "image/jpeg", name: "B.jpg" }
      ];
      const payload = createTestPayload({ referenceImages: references });
      const attempt = createImageGenerationAttempt(payload, {
        createKey: () => "reference-key-000001"
      });

      references.reverse();
      references[0]!.name = "mutated.jpg";

      expect(attempt.payload.referenceImages?.map((reference) => reference.name)).toEqual([
        "A.png",
        "B.jpg"
      ]);
      expect(Object.isFrozen(attempt.payload.referenceImages)).toBe(true);
      expect(Object.isFrozen(attempt.payload.referenceImages?.[0])).toBe(true);

      const retry = createImageGenerationAttempt(attempt.payload, {
        createKey: () => "reference-key-000002"
      });
      expect(retry.payload.referenceImages?.map((reference) => reference.name)).toEqual([
        "A.png",
        "B.jpg"
      ]);
    });

    it("creates a generic attempt without Quick Image session metadata", () => {
      const payload: GenericImageGenerationRequestPayload = {
        prompt: "Canvas-ready prompt",
        modelId: "image-model",
        size: "1024x1024",
        count: 1,
        mode: "text-to-image",
        clientEntryId: "canvas-entry-1"
      };
      const attempt = createImageGenerationAttempt(payload, {
        createKey: () => "generic-key-00000001"
      });

      expect(attempt.payload).toEqual(payload);
      expect(attempt.payload.clientEntryId).toBe("canvas-entry-1");
      expect("imageSessionId" in attempt.payload).toBe(false);
      expect("imageSessionTitle" in attempt.payload).toBe(false);
      expect(Object.isFrozen(attempt.payload)).toBe(true);
    });

    it("keeps Quick Image session metadata required in its specialized payload", () => {
      expectTypeOf<QuickImageGenerationRequestPayload>().toMatchTypeOf<{
        imageSessionId: string;
        imageSessionTitle: string;
      }>();
      const payload: QuickImageGenerationRequestPayload = {
        ...createTestPayload(),
        imageSessionId: "quick-session",
        imageSessionTitle: "Quick session"
      };
      const attempt = createImageGenerationAttempt(payload, {
        createKey: () => "quick-key-000000001"
      });

      expect(attempt.payload).toMatchObject({
        imageSessionId: "quick-session",
        imageSessionTitle: "Quick session",
        clientEntryId: "entry-1"
      });
    });

    it("keeps a generic attempt key and snapshot stable across later mutations", () => {
      const payload: GenericImageGenerationRequestPayload = {
        prompt: "Original",
        modelId: "image-model",
        size: "1024x1024",
        count: 1,
        mode: "text-to-image",
        clientEntryId: "entry-generic"
      };
      const attempt = createImageGenerationAttempt(payload, {
        createKey: () => "stable-key-00000001"
      });

      payload.prompt = "Changed";
      expect(attempt.key).toBe("stable-key-00000001");
      expect(attempt.payload.prompt).toBe("Original");
      expect(Object.isFrozen(attempt)).toBe(true);
    });
  });

  describe("key generation", () => {
    it("generates a key that meets the 16-128 length contract", () => {
      const attempt = createImageGenerationAttempt(createTestPayload());
      expect(attempt.key.length).toBeGreaterThanOrEqual(16);
      expect(attempt.key.length).toBeLessThanOrEqual(128);
    });

    it("generates a key that satisfies the backend character set", () => {
      const attempt = createImageGenerationAttempt(createTestPayload());
      expect(idempotencyKeyPattern.test(attempt.key)).toBe(true);
      expect(validateIdempotencyKey(attempt.key)).toBe(true);
    });

    it("generates a different key for each new attempt", () => {
      const first = createImageGenerationAttempt(createTestPayload());
      const second = createImageGenerationAttempt(createTestPayload());
      expect(first.key).not.toBe(second.key);
    });

    it("generates a different key even when the payload is identical", () => {
      const payload = createTestPayload();
      const first = createImageGenerationAttempt(payload);
      const second = createImageGenerationAttempt(payload);
      expect(first.key).not.toBe(second.key);
    });

    it("uses the injected key factory in tests", () => {
      const createKey = createIncrementingKeyFactory();
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey
      });
      expect(attempt.key).toBe("key-00000000000001");
    });

    it("does not use Math.random for key generation", () => {
      const originalRandom = Math.random;
      let called = false;
      Math.random = () => {
        called = true;
        return 0;
      };
      try {
        const attempt = createImageGenerationAttempt(createTestPayload());
        expect(attempt.key.length).toBeGreaterThanOrEqual(16);
      } finally {
        Math.random = originalRandom;
      }
      expect(called).toBe(false);
    });

    it("uses crypto.randomUUID in the default key factory", () => {
      const attempt = createImageGenerationAttempt(createTestPayload());
      expect(uuidPattern.test(attempt.key)).toBe(true);
    });

    it("falls back to crypto.getRandomValues when randomUUID is unavailable", () => {
      try {
        vi.stubGlobal("crypto", {
          getRandomValues(bytes: Uint8Array) {
            bytes.fill(0xab);
            return bytes;
          }
        });

        const uuid = createSecureUuid();
        expect(uuid).toMatch(uuidPattern);
        expect(uuid.split("-")[2]?.[0]).toBe("4");
        expect("89ab".includes(uuid.split("-")[3]?.[0] ?? "")).toBe(true);
        expect(createImageGenerationAttempt(createTestPayload()).key).toMatch(
          uuidPattern
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("fails safely when neither secure UUID API is available", () => {
      try {
        vi.stubGlobal("crypto", {});

        expect(() => createImageGenerationAttempt(createTestPayload())).toThrowError(
          "Secure UUID unavailable"
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("validates the key returned by the default key factory", () => {
      const originalRandomUUID = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: () => "short"
      });

      try {
        expect(() => createImageGenerationAttempt(createTestPayload())).toThrowError(
          "Invalid image generation idempotency key"
        );
      } finally {
        Object.defineProperty(globalThis.crypto, "randomUUID", {
          configurable: true,
          value: originalRandomUUID
        });
      }
    });

    it("rejects a too-short injected key before creating an attempt", () => {
      let cloneReads = 0;
      const payload = createTestPayload();
      Object.defineProperty(payload, "cloneProbe", {
        enumerable: true,
        get() {
          cloneReads += 1;
          return "probe";
        }
      });

      expect(() =>
        createImageGenerationAttempt(payload, { createKey: () => "short" })
      ).toThrowError("Invalid image generation idempotency key");
      expect(cloneReads).toBe(0);
    });

    it("rejects an injected key containing whitespace", () => {
      expect(() =>
        createImageGenerationAttempt(createTestPayload(), {
          createKey: () => "valid-prefix key-123456"
        })
      ).toThrowError("Invalid image generation idempotency key");
    });

    it("rejects an injected key containing a comma", () => {
      expect(() =>
        createImageGenerationAttempt(createTestPayload(), {
          createKey: () => "key-with-comma,123456"
        })
      ).toThrowError("Invalid image generation idempotency key");
    });

    it("rejects an injected key containing Unicode", () => {
      expect(() =>
        createImageGenerationAttempt(createTestPayload(), {
          createKey: () => "key-with-unicode-测试"
        })
      ).toThrowError("Invalid image generation idempotency key");
    });

    it("does not include a raw invalid key in the error message", () => {
      const invalidKey = "private invalid idempotency key";
      let errorMessage: string | undefined;

      try {
        createImageGenerationAttempt(createTestPayload(), {
          createKey: () => invalidKey
        });
      } catch (error) {
        if (error instanceof Error) {
          errorMessage = error.message;
        }
      }

      expect(errorMessage).toBe("Invalid image generation idempotency key");
      expect(errorMessage).not.toContain(invalidKey);
    });
  });

  describe("payload snapshot", () => {
    it("preserves the full request payload", () => {
      const payload = createTestPayload({
        referenceImage: {
          dataUrl: "data:image/png;base64,abc",
          mimeType: "image/png",
          name: "ref.png",
          originalBytes: 1000,
          compressedBytes: 800
        }
      });
      const attempt = createImageGenerationAttempt(payload, {
        createKey: createIncrementingKeyFactory()
      });

      expect(attempt.payload).toEqual(payload);
    });

    it("creates an independent snapshot so later payload mutations do not affect the attempt", () => {
      const payload = createTestPayload();
      const attempt = createImageGenerationAttempt(payload, {
        createKey: createIncrementingKeyFactory()
      });

      payload.prompt = "mutated prompt";
      payload.modelId = "mutated-model";

      expect(attempt.payload.prompt).toBe("test prompt");
      expect(attempt.payload.modelId).toBe("test-model");
    });

    it("creates an independent snapshot of referenceImage mutations", () => {
      const referenceImage: ImageReferencePayload = {
        dataUrl: "data:image/png;base64,original",
        mimeType: "image/png",
        name: "original.png",
        originalBytes: 1000,
        compressedBytes: 800
      };
      const payload = createTestPayload({ referenceImage });
      const attempt = createImageGenerationAttempt(payload, {
        createKey: createIncrementingKeyFactory()
      });

      referenceImage.dataUrl = "data:image/png;base64,mutated";
      referenceImage.name = "mutated.png";
      referenceImage.originalBytes = 9999;
      referenceImage.compressedBytes = 9999;

      expect(attempt.payload.referenceImage?.dataUrl).toBe(
        "data:image/png;base64,original"
      );
      expect(attempt.payload.referenceImage?.name).toBe("original.png");
      expect(attempt.payload.referenceImage?.originalBytes).toBe(1000);
      expect(attempt.payload.referenceImage?.compressedBytes).toBe(800);
    });

    it("freezes the top-level payload object", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      expect(Object.isFrozen(attempt.payload)).toBe(true);
    });

    it("freezes nested referenceImage objects", () => {
      const attempt = createImageGenerationAttempt(
        createTestPayload({
          referenceImage: {
            dataUrl: "data:image/png;base64,abc",
            mimeType: "image/png"
          }
        }),
        { createKey: createIncrementingKeyFactory() }
      );
      expect(Object.isFrozen(attempt.payload.referenceImage)).toBe(true);
    });

    it("freezes the attempt object itself", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      expect(Object.isFrozen(attempt)).toBe(true);
    });

    it("preserves undefined optional fields according to the input shape", () => {
      const payload = createTestPayload();
      const attempt = createImageGenerationAttempt(payload, {
        createKey: createIncrementingKeyFactory()
      });
      expect("referenceImage" in attempt.payload).toBe(false);
    });

    it("preserves null referenceImage when explicitly provided", () => {
      const payload = createTestPayload({ referenceImage: null });
      const attempt = createImageGenerationAttempt(payload, {
        createKey: createIncrementingKeyFactory()
      });
      expect(attempt.payload.referenceImage).toBeNull();
    });

    it("does not rewrite referenceImage dataUrl", () => {
      const attempt = createImageGenerationAttempt(
        createTestPayload({
          referenceImage: {
            dataUrl: "data:image/jpeg;base64,keep-me",
            mimeType: "image/jpeg"
          }
        }),
        { createKey: createIncrementingKeyFactory() }
      );
      expect(attempt.payload.referenceImage?.dataUrl).toBe(
        "data:image/jpeg;base64,keep-me"
      );
    });

    it("does not include Authorization or token fields", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      expect("token" in attempt.payload).toBe(false);
      expect("Authorization" in attempt.payload).toBe(false);
    });

    it("preserves extra future payload fields through the generic type", () => {
      type ExtendedPayload = ImageGenerationRequestPayload & {
        futureField: string;
        nestedFuture: { value: number };
      };
      const payload: ExtendedPayload = {
        ...createTestPayload(),
        futureField: "future",
        nestedFuture: { value: 42 }
      };
      const attempt = createImageGenerationAttempt(payload, {
        createKey: createIncrementingKeyFactory()
      });
      expect(attempt.payload.futureField).toBe("future");
      expect(attempt.payload.nestedFuture.value).toBe(42);
    });

    it("preserves generic extra fields through the manual clone fallback", () => {
      type ExtendedPayload = ImageGenerationRequestPayload & {
        futureArray: Array<{ nested: string }>;
        futureObject: { enabled: boolean };
        futureNull: null;
        futurePrimitive: string;
      };
      const payload: ExtendedPayload = {
        ...createTestPayload(),
        futureArray: [{ nested: "original" }],
        futureObject: { enabled: true },
        futureNull: null,
        futurePrimitive: "primitive"
      };
      const structuredCloneDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "structuredClone"
      );
      const originalStructuredClone = globalThis.structuredClone;
      Object.defineProperty(globalThis, "structuredClone", {
        configurable: true,
        value: undefined
      });

      try {
        const attempt = createImageGenerationAttempt(payload, {
          createKey: createIncrementingKeyFactory()
        });
        payload.futureArray[0]!.nested = "mutated";
        payload.futureObject.enabled = false;

        expect(attempt.payload.futureArray).toEqual([{ nested: "original" }]);
        expect(attempt.payload.futureObject).toEqual({ enabled: true });
        expect(attempt.payload.futureNull).toBeNull();
        expect(attempt.payload.futurePrimitive).toBe("primitive");
      } finally {
        Object.defineProperty(
          globalThis,
          "structuredClone",
          structuredCloneDescriptor ?? {
            configurable: true,
            value: originalStructuredClone,
            writable: true
          }
        );
      }
    });
  });

  describe("retry lifecycle", () => {
    it("reuses the same key for transport retry", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      const firstHeaders = buildImageGenerationAttemptHeaders(attempt);
      const secondHeaders = buildImageGenerationAttemptHeaders(attempt);
      expect(firstHeaders["Idempotency-Key"]).toBe(attempt.key);
      expect(secondHeaders["Idempotency-Key"]).toBe(attempt.key);
    });

    it("reuses the same payload snapshot for transport retry", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      const firstHeaders = buildImageGenerationAttemptHeaders(attempt);
      const secondHeaders = buildImageGenerationAttemptHeaders(attempt);
      expect(firstHeaders).toEqual(secondHeaders);
      expect(attempt.payload).toBe(attempt.payload);
    });

    it("retains the same attempt after a 202 in_progress response", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: "task-1",
        retryAfterMs: 1000
      });
      expect(decision.kind).toBe("in_progress");
      expect(isImageGenerationAttemptTerminal(decision)).toBe(false);
      expect(buildImageGenerationAttemptHeaders(attempt)["Idempotency-Key"]).toBe(
        attempt.key
      );
    });

    it("terminates the attempt after a 200 success response", () => {
      const decision = classifyImageGenerationHttpResponse(200, {
        task: { id: "task-1" },
        assets: [{ url: "https://example.com/image.png" }]
      });
      expect(decision.kind).toBe("success");
      expect(isImageGenerationAttemptTerminal(decision)).toBe(true);
    });

    it("classifies retryable structured failures as terminal", () => {
      const decision = classifyImageGenerationHttpResponse(500, {
        message: "generation failed",
        code: "GENERATION_FAILED",
        taskId: "task-1",
        retryable: true
      });
      expect(decision).toEqual({
        kind: "structured_failure",
        terminal: true,
        retryable: true
      });
      expect(isImageGenerationAttemptTerminal(decision)).toBe(true);
    });

    it("terminates the attempt after a 409 conflict", () => {
      const decision = classifyImageGenerationHttpResponse(409, {
        message: "conflict",
        code: "IDEMPOTENCY_KEY_CONFLICT"
      });
      expect(decision.kind).toBe("conflict");
      expect(isImageGenerationAttemptTerminal(decision)).toBe(true);
    });

    it("terminates the attempt after a 410 unavailable", () => {
      const decision = classifyImageGenerationHttpResponse(410, {
        message: "gone",
        code: "IDEMPOTENCY_RESULT_UNAVAILABLE"
      });
      expect(decision.kind).toBe("unavailable");
      expect(isImageGenerationAttemptTerminal(decision)).toBe(true);
    });

    it("creates a new key after a terminal response when the user explicitly retries", () => {
      const createKey = createIncrementingKeyFactory();
      const firstAttempt = createImageGenerationAttempt(createTestPayload(), {
        createKey
      });
      const terminalDecision = classifyImageGenerationHttpResponse(409, {
        code: "IDEMPOTENCY_KEY_CONFLICT"
      });
      expect(isImageGenerationAttemptTerminal(terminalDecision)).toBe(true);

      const secondAttempt = createImageGenerationAttempt(createTestPayload(), {
        createKey
      });
      expect(secondAttempt.key).not.toBe(firstAttempt.key);
    });

    it("creates a new attempt when the payload changes", () => {
      const createKey = createIncrementingKeyFactory();
      const firstAttempt = createImageGenerationAttempt(
        createTestPayload({ prompt: "first" }),
        { createKey }
      );
      const secondAttempt = createImageGenerationAttempt(
        createTestPayload({ prompt: "second" }),
        { createKey }
      );
      expect(secondAttempt.key).not.toBe(firstAttempt.key);
      expect(secondAttempt.payload.prompt).toBe("second");
    });

    it("creates a new attempt when the same payload is submitted again", () => {
      const payload = createTestPayload();
      const createKey = createIncrementingKeyFactory();
      const firstAttempt = createImageGenerationAttempt(payload, { createKey });
      const secondAttempt = createImageGenerationAttempt(payload, { createKey });
      expect(secondAttempt.key).not.toBe(firstAttempt.key);
    });

    it("retains the attempt for transport or network uncertainty", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      const decision = classifyImageGenerationTransportError();
      expect(decision.kind).toBe("transport_uncertain");
      expect(isImageGenerationAttemptTerminal(decision)).toBe(false);
      expect(buildImageGenerationAttemptHeaders(attempt)["Idempotency-Key"]).toBe(
        attempt.key
      );
    });
  });

  describe("headers", () => {
    it("uses the exact header name Idempotency-Key", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: () => "idempotency-key-value"
      });
      const headers = buildImageGenerationAttemptHeaders(attempt);
      expect(Object.keys(headers)).toEqual(["Idempotency-Key"]);
    });

    it("sets the header value to the attempt key", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: () => "idempotency-key-value"
      });
      const headers = buildImageGenerationAttemptHeaders(attempt);
      expect(headers["Idempotency-Key"]).toBe("idempotency-key-value");
    });

    it("does not include Authorization in generated headers", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      const headers = buildImageGenerationAttemptHeaders(attempt);
      expect(headers).not.toHaveProperty("Authorization");
    });

    it("does not mutate the attempt when building headers", () => {
      const attempt = createImageGenerationAttempt(createTestPayload(), {
        createKey: createIncrementingKeyFactory()
      });
      const before = attempt.key;
      buildImageGenerationAttemptHeaders(attempt);
      expect(attempt.key).toBe(before);
    });
  });

  describe("response classification", () => {
    it("classifies 200 with task and assets as success", () => {
      const decision = classifyImageGenerationHttpResponse(200, {
        task: { id: "task-1" },
        assets: [{ url: "https://example.com/image.png" }]
      });
      expect(decision).toEqual({ kind: "success", terminal: true });
    });

    it("classifies 202 with a string taskId as in_progress", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: "task-1",
        retryAfterMs: 1000
      });
      expect(decision).toEqual({ kind: "in_progress", terminal: false });
    });

    it("classifies 202 with a null taskId as in_progress", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: null,
        retryAfterMs: 1000
      });
      expect(decision).toEqual({ kind: "in_progress", terminal: false });
    });

    it("returns unknown_http_response for 202 without retryAfterMs", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: "task-1"
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 202 with a string retryAfterMs", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: "task-1",
        retryAfterMs: "1000"
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 202 with NaN retryAfterMs", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: "task-1",
        retryAfterMs: Number.NaN
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 202 with infinite retryAfterMs", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: "task-1",
        retryAfterMs: Number.POSITIVE_INFINITY
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 202 with negative retryAfterMs", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: "task-1",
        retryAfterMs: -1
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 202 with a numeric taskId", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: 1,
        retryAfterMs: 1000
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 202 with an object taskId", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        status: "in_progress",
        taskId: { id: "task-1" },
        retryAfterMs: 1000
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("classifies 409 with IDEMPOTENCY_KEY_CONFLICT as conflict", () => {
      const decision = classifyImageGenerationHttpResponse(409, {
        code: "IDEMPOTENCY_KEY_CONFLICT"
      });
      expect(decision).toEqual({ kind: "conflict", terminal: true });
    });

    it("classifies 410 with IDEMPOTENCY_RESULT_UNAVAILABLE as unavailable", () => {
      const decision = classifyImageGenerationHttpResponse(410, {
        code: "IDEMPOTENCY_RESULT_UNAVAILABLE"
      });
      expect(decision).toEqual({ kind: "unavailable", terminal: true });
    });

    it.each([
      [400, true],
      [422, false],
      [500, true],
      [503, true]
    ] as const)(
      "classifies %i with a complete structured failure body as terminal",
      (status, retryable) => {
        const decision = classifyImageGenerationHttpResponse(status, {
          message: "validation failed",
          code: "VALIDATION_ERROR",
          retryable
        });
        expect(decision).toEqual({
          kind: "structured_failure",
          terminal: true,
          retryable
        });
      }
    );

    it.each([
      ["missing code", { message: "validation failed", retryable: false }],
      ["empty code", { code: "", message: "validation failed", retryable: false }],
      ["missing message", { code: "VALIDATION_ERROR", retryable: false }],
      ["empty message", { code: "VALIDATION_ERROR", message: "", retryable: false }],
      ["missing retryable", { code: "VALIDATION_ERROR", message: "validation failed" }],
      [
        "string retryable",
        { code: "VALIDATION_ERROR", message: "validation failed", retryable: "true" }
      ],
      [
        "numeric retryable",
        { code: "VALIDATION_ERROR", message: "validation failed", retryable: 1 }
      ],
      ["null body", null],
      ["array body", []]
    ] as const)("classifies %s as unknown_http_response", (_label, body) => {
      const decision = classifyImageGenerationHttpResponse(422, body);
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("classifies network uncertainty as transport_uncertain", () => {
      const decision = classifyImageGenerationTransportError();
      expect(decision).toEqual({ kind: "transport_uncertain", terminal: false });
    });

    it("does not classify based on message content", () => {
      const decision = classifyImageGenerationHttpResponse(409, {
        message: "IDEMPOTENCY_KEY_CONFLICT",
        code: "SOME_OTHER_CODE"
      });
      expect(decision.kind).toBe("unknown_http_response");
    });

    it("returns unknown_http_response for 200 with an unexpected body", () => {
      const decision = classifyImageGenerationHttpResponse(200, {
        status: "in_progress"
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 202 with an unexpected body", () => {
      const decision = classifyImageGenerationHttpResponse(202, {
        task: { id: "task-1" },
        assets: []
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 409 with a non-conflict code", () => {
      const decision = classifyImageGenerationHttpResponse(409, {
        code: "OTHER_CODE"
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 410 with a non-unavailable code", () => {
      const decision = classifyImageGenerationHttpResponse(410, {
        code: "OTHER_CODE"
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for 4xx without retryable", () => {
      const decision = classifyImageGenerationHttpResponse(422, {
        message: "validation failed",
        code: "VALIDATION_ERROR"
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("returns unknown_http_response for unrecognized HTTP statuses", () => {
      const decision = classifyImageGenerationHttpResponse(418, {
        message: "I'm a teapot"
      });
      expect(decision).toEqual({ kind: "unknown_http_response", terminal: false });
    });

    it("does not create a new attempt decision for unknown responses", () => {
      const decision = classifyImageGenerationHttpResponse(500, {
        message: "unknown server error"
      });
      expect(decision.kind).toBe("unknown_http_response");
      expect(isImageGenerationAttemptTerminal(decision)).toBe(false);
    });
  });

  describe("decision exhaustiveness", () => {
    it("exposes terminal status for every decision kind", () => {
      const decisions: ImageGenerationAttemptDecision[] = [
        classifyImageGenerationHttpResponse(200, {
          task: { id: "task-1" },
          assets: []
        }),
        classifyImageGenerationHttpResponse(202, {
          status: "in_progress",
          taskId: "task-1",
          retryAfterMs: 1000
        }),
        classifyImageGenerationHttpResponse(409, {
          code: "IDEMPOTENCY_KEY_CONFLICT"
        }),
        classifyImageGenerationHttpResponse(410, {
          code: "IDEMPOTENCY_RESULT_UNAVAILABLE"
        }),
        classifyImageGenerationHttpResponse(500, {
          message: "failed",
          code: "FAILED",
          retryable: true
        }),
        classifyImageGenerationTransportError(),
        classifyImageGenerationHttpResponse(418, {})
      ];

      expect(decisions.map((decision) => decision.terminal)).toEqual([
        true,
        false,
        true,
        true,
        true,
        false,
        false
      ]);
    });
  });
});
