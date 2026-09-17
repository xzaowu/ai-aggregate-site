import type {
  ImageGenerationWorkflow,
  TitleCoverImageRequest
} from "@ai-aggregate/shared";

export type ImageGenerationSize =
  | "1024x1024"
  | "1024x768"
  | "768x1024"
  | "1280x720"
  | "720x1280";

export type ImageGenerationCount = 1 | 2 | 4;

export type ImageGenerationMode = "text-to-image" | "image-to-image";

export type ImageReferencePayload = {
  dataUrl: string;
  mimeType: string;
  name?: string;
  originalBytes?: number;
  compressedBytes?: number;
};

export type GenericImageGenerationRequestPayload = {
  prompt: string;
  modelId: string;
  size: ImageGenerationSize;
  count: ImageGenerationCount;
  mode: ImageGenerationMode;
  clientEntryId: string;
  imageSessionId?: string;
  imageSessionTitle?: string;
  referenceImage?: ImageReferencePayload | null;
  referenceImages?: readonly ImageReferencePayload[];
  workflow?: ImageGenerationWorkflow;
  titleCover?: TitleCoverImageRequest;
};

export type QuickImageGenerationRequestPayload =
  GenericImageGenerationRequestPayload & {
    imageSessionId: string;
    imageSessionTitle: string;
  };

export type ImageGenerationRequestPayload = GenericImageGenerationRequestPayload;

export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type ImageGenerationAttempt<
  TPayload extends
    GenericImageGenerationRequestPayload = GenericImageGenerationRequestPayload
> = Readonly<{
  key: string;
  payload: DeepReadonly<TPayload>;
}>;

export type CreateImageGenerationAttemptOptions = {
  createKey?: () => string;
};

export type ImageGenerationAttemptDecision =
  | { kind: "success"; terminal: true }
  | { kind: "in_progress"; terminal: false }
  | { kind: "conflict"; terminal: true }
  | { kind: "unavailable"; terminal: true }
  | { kind: "structured_failure"; terminal: true; retryable: boolean }
  | { kind: "transport_uncertain"; terminal: false }
  | { kind: "unknown_http_response"; terminal: false };

const idempotencyKeyCharsetPattern = /^[A-Za-z0-9._~:-]+$/;
const idempotencyKeyMinLength = 16;
const idempotencyKeyMaxLength = 128;

export function createSecureUuid(): string {
  const cryptoApi =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Secure UUID unavailable");
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}

function defaultCreateKey(): string {
  return createSecureUuid();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStructuredClone(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.structuredClone === "function"
  );
}

function cloneValue<T>(value: T): T {
  if (hasStructuredClone()) {
    return globalThis.structuredClone(value);
  }

  return manualDeepClone(value);
}

function cloneUnknownValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneUnknownValue(item));
  }

  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    cloned[key] = cloneUnknownValue((value as Record<string, unknown>)[key]);
  }

  return cloned;
}

function manualDeepClone<T>(value: T): T {
  return cloneUnknownValue(value) as T;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  Object.freeze(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        deepFreeze(item);
      }
    }
  } else {
    for (const key of Object.keys(value)) {
      const property = (value as Record<string, unknown>)[key];
      if (property !== null && typeof property === "object") {
        deepFreeze(property);
      }
    }
  }

  return value;
}

export function createImageGenerationAttempt<
  TPayload extends GenericImageGenerationRequestPayload
>(
  payload: TPayload,
  options?: CreateImageGenerationAttemptOptions
): ImageGenerationAttempt<TPayload> {
  const createKey = options?.createKey ?? defaultCreateKey;
  const key = createKey();

  if (!validateIdempotencyKey(key)) {
    throw new Error("Invalid image generation idempotency key");
  }

  const snapshot = deepFreeze(cloneValue(payload));

  return Object.freeze({
    key,
    payload: snapshot
  }) as ImageGenerationAttempt<TPayload>;
}

export function buildImageGenerationAttemptHeaders(
  attempt: ImageGenerationAttempt
): Record<string, string> {
  return {
    "Idempotency-Key": attempt.key
  };
}

export function isImageGenerationAttemptTerminal(
  decision: ImageGenerationAttemptDecision
): boolean {
  return decision.terminal;
}

function isImageGenerationSuccessBody(body: unknown): boolean {
  if (!isRecord(body)) {
    return false;
  }

  return isRecord(body.task) && Array.isArray(body.assets);
}

function isImageGenerationInProgressBody(body: unknown): boolean {
  if (!isRecord(body)) {
    return false;
  }

  return (
    body.status === "in_progress" &&
    (body.taskId === null || typeof body.taskId === "string") &&
    typeof body.retryAfterMs === "number" &&
    Number.isFinite(body.retryAfterMs) &&
    body.retryAfterMs >= 0
  );
}

function isIdempotencyConflictBody(body: unknown): boolean {
  return isRecord(body) && body.code === "IDEMPOTENCY_KEY_CONFLICT";
}

function isIdempotencyUnavailableBody(body: unknown): boolean {
  return isRecord(body) && body.code === "IDEMPOTENCY_RESULT_UNAVAILABLE";
}

export function isStructuredImageGenerationFailureBody(
  body: unknown
): body is { code: string; message: string; retryable: boolean } {
  if (!isRecord(body)) {
    return false;
  }

  return (
    typeof body.code === "string" &&
    body.code.trim().length > 0 &&
    typeof body.message === "string" &&
    body.message.trim().length > 0 &&
    typeof body.retryable === "boolean"
  );
}

export function classifyImageGenerationHttpResponse(
  status: number,
  body: unknown
): ImageGenerationAttemptDecision {
  if (status === 200) {
    if (isImageGenerationSuccessBody(body)) {
      return { kind: "success", terminal: true };
    }
    return { kind: "unknown_http_response", terminal: false };
  }

  if (status === 202) {
    if (isImageGenerationInProgressBody(body)) {
      return { kind: "in_progress", terminal: false };
    }
    return { kind: "unknown_http_response", terminal: false };
  }

  if (status === 409) {
    if (isIdempotencyConflictBody(body)) {
      return { kind: "conflict", terminal: true };
    }
    return { kind: "unknown_http_response", terminal: false };
  }

  if (status === 410) {
    if (isIdempotencyUnavailableBody(body)) {
      return { kind: "unavailable", terminal: true };
    }
    return { kind: "unknown_http_response", terminal: false };
  }

  if (status >= 400 && status < 600) {
    if (isStructuredImageGenerationFailureBody(body)) {
      return {
        kind: "structured_failure",
        terminal: true,
        retryable: body.retryable
      };
    }
  }

  return { kind: "unknown_http_response", terminal: false };
}

export function classifyImageGenerationTransportError(): ImageGenerationAttemptDecision {
  return { kind: "transport_uncertain", terminal: false };
}

export function validateIdempotencyKey(key: string): boolean {
  return (
    key.length >= idempotencyKeyMinLength &&
    key.length <= idempotencyKeyMaxLength &&
    idempotencyKeyCharsetPattern.test(key)
  );
}
