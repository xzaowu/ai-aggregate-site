import { createHash } from "node:crypto";
import {
  isImageGenerationWorkflow,
  isTitleCoverVisualStyle,
  titleCoverOriginalTitleMaxCodePoints
} from "@ai-aggregate/shared";
import type {
  AiGenerationCount,
  AiGenerationSize,
  ImageGenerationWorkflow,
  ImageGenerationMode,
  ImageReferenceInput,
  TitleCoverVisualStyle
} from "@ai-aggregate/shared";

export const IMAGE_GENERATE_IDEMPOTENCY_SCOPE = "POST /image/generate:v1";
export const VIDEO_GENERATE_IDEMPOTENCY_SCOPE = "POST /video/generate:v1";
export const IDEMPOTENCY_CLAIM_TTL_MS = 120_000;
export const IDEMPOTENCY_TERMINAL_TTL_MS = 24 * 60 * 60 * 1000;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]{16,128}$/;

const IDEMPOTENCY_KEY_DOMAIN = "idem-key-v1";
const USER_OWNER_DOMAIN = "idem-owner-user-v1";
const CLAIM_TOKEN_DOMAIN = "idem-claim-token-v1";
const IMAGE_REQUEST_FINGERPRINT_DOMAIN = "image-request-fingerprint-v1";
const IMAGE_REFERENCE_FINGERPRINT_DOMAIN = "image-reference-fingerprint-v1";
const VIDEO_REQUEST_FINGERPRINT_DOMAIN = "video-request-fingerprint-v1";

const IMAGE_REFERENCE_DATA_URL_PATTERN =
  /^data:([^;,]+);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/u;
const IMAGE_REFERENCE_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

const IMAGE_FINGERPRINT_INPUT_KEYS = new Set([
  "clientEntryId",
  "count",
  "imageSessionId",
  "imageSessionTitle",
  "mode",
  "modelId",
  "prompt",
  "referenceImageFingerprints",
  "size",
  "titleCoverOriginalTitle",
  "titleCoverStyle",
  "workflow"
]);

function hashDomainSeparated(
  domain: string,
  value: string | Uint8Array
): Buffer {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update(Buffer.from([0]));
  hash.update(typeof value === "string" ? value : Buffer.from(value));
  return hash.digest();
}

function requireNonEmptyString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(errorCode);
  }
  return value;
}

function requireValidDate(now: Date): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("INVALID_IDEMPOTENCY_NOW");
  }
  return now;
}

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new TypeError("INVALID_IDEMPOTENCY_KEY");
  }
  return value;
}

export function parseIdempotencyKeyHeader(
  value: unknown
): { ok: true; key: string } | { ok: false; reason: "MISSING" | "INVALID" } {
  if (value === undefined) {
    return { ok: false, reason: "MISSING" };
  }

  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    return { ok: false, reason: "INVALID" };
  }

  return { ok: true, key: value };
}

export function hashIdempotencyKey(value: unknown): Buffer {
  return hashDomainSeparated(
    IDEMPOTENCY_KEY_DOMAIN,
    validateIdempotencyKey(value)
  );
}

export function hashUserIdempotencyOwner(userId: unknown): Buffer {
  return hashDomainSeparated(
    USER_OWNER_DOMAIN,
    requireNonEmptyString(userId, "INVALID_IDEMPOTENCY_USER_OWNER")
  );
}

export function hashIdempotencyClaimToken(token: unknown): Buffer {
  return hashDomainSeparated(
    CLAIM_TOKEN_DOMAIN,
    requireNonEmptyString(token, "INVALID_IDEMPOTENCY_CLAIM_TOKEN")
  );
}

export function hashImageRequestFingerprint(
  canonicalFingerprintInput: string | Uint8Array
): Buffer {
  if (
    (typeof canonicalFingerprintInput === "string" &&
      canonicalFingerprintInput.length === 0) ||
    (!(typeof canonicalFingerprintInput === "string") &&
      canonicalFingerprintInput.byteLength === 0)
  ) {
    throw new TypeError("INVALID_IMAGE_REQUEST_FINGERPRINT_INPUT");
  }
  return hashDomainSeparated(
    IMAGE_REQUEST_FINGERPRINT_DOMAIN,
    canonicalFingerprintInput
  );
}

export function buildReferenceImageFingerprint(
  referenceImage: ImageReferenceInput | undefined
): string | undefined {
  if (referenceImage === undefined) {
    return undefined;
  }

  if (
    !referenceImage ||
    typeof referenceImage.dataUrl !== "string" ||
    typeof referenceImage.mimeType !== "string"
  ) {
    throw new TypeError("INVALID_REFERENCE_IMAGE_FINGERPRINT_INPUT");
  }

  const mimeType = referenceImage.mimeType.trim().toLowerCase();
  const dataUrlMatch = IMAGE_REFERENCE_DATA_URL_PATTERN.exec(
    referenceImage.dataUrl
  );

  if (!mimeType || !dataUrlMatch) {
    throw new TypeError("INVALID_REFERENCE_IMAGE_FINGERPRINT_INPUT");
  }

  const dataUrlMimeType = dataUrlMatch[1]?.trim().toLowerCase();
  const encodedPayload = dataUrlMatch[2] ?? "";

  if (!dataUrlMimeType || dataUrlMimeType !== mimeType || !encodedPayload) {
    throw new TypeError("INVALID_REFERENCE_IMAGE_FINGERPRINT_INPUT");
  }

  const decodedPayload = Buffer.from(encodedPayload, "base64");

  if (
    decodedPayload.byteLength === 0 ||
    decodedPayload.toString("base64") !== encodedPayload
  ) {
    throw new TypeError("INVALID_REFERENCE_IMAGE_FINGERPRINT_INPUT");
  }

  return hashDomainSeparated(
    IMAGE_REFERENCE_FINGERPRINT_DOMAIN,
    Buffer.concat([Buffer.from(mimeType, "utf8"), Buffer.from([0]), decodedPayload])
  ).toString("hex");
}

export function buildReferenceImageFingerprints(
  referenceImages: readonly ImageReferenceInput[] | undefined
): string[] | undefined {
  if (referenceImages === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(referenceImages) ||
    referenceImages.length < 1 ||
    referenceImages.length > 4
  ) {
    throw new TypeError("INVALID_REFERENCE_IMAGE_FINGERPRINT_INPUT");
  }

  return referenceImages.map((referenceImage) => {
    const fingerprint = buildReferenceImageFingerprint(referenceImage);
    if (fingerprint === undefined) {
      throw new TypeError("INVALID_REFERENCE_IMAGE_FINGERPRINT_INPUT");
    }
    return fingerprint;
  });
}

export interface ImageGenerationFingerprintInput {
  modelId: string;
  prompt: string;
  size: AiGenerationSize;
  count: AiGenerationCount;
  mode: ImageGenerationMode;
  workflow?: ImageGenerationWorkflow;
  titleCoverOriginalTitle?: string;
  titleCoverStyle?: TitleCoverVisualStyle;
  imageSessionId?: string;
  clientEntryId?: string;
  imageSessionTitle?: string;
  referenceImageFingerprints?: readonly string[];
}

function requireImageFingerprintString(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("INVALID_IMAGE_FINGERPRINT_INPUT");
  }
  return value;
}

function readOptionalImageFingerprintString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireImageFingerprintString(value);
}

function readOptionalReferenceImageFingerprints(
  value: unknown
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw new TypeError("INVALID_IMAGE_FINGERPRINT_INPUT");
  }
  return value.map(requireImageFingerprintString);
}

export function canonicalizeImageGenerationFingerprintInput(
  input: ImageGenerationFingerprintInput
): string {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !IMAGE_FINGERPRINT_INPUT_KEYS.has(key))
  ) {
    throw new TypeError("INVALID_IMAGE_FINGERPRINT_INPUT");
  }

  const clientEntryId = readOptionalImageFingerprintString(input.clientEntryId);
  const imageSessionId = readOptionalImageFingerprintString(input.imageSessionId);
  const imageSessionTitle = readOptionalImageFingerprintString(
    input.imageSessionTitle
  );
  const referenceImageFingerprints = readOptionalReferenceImageFingerprints(
    input.referenceImageFingerprints
  );
  const workflow = readOptionalImageFingerprintString(input.workflow);
  const titleCoverOriginalTitle = readOptionalImageFingerprintString(
    input.titleCoverOriginalTitle
  );
  const titleCoverStyle = readOptionalImageFingerprintString(
    input.titleCoverStyle
  );

  if (
    typeof input.count !== "number" ||
    (input.count !== 1 && input.count !== 2 && input.count !== 4) ||
    typeof input.size !== "string" ||
    ![
      "1024x1024",
      "1024x768",
      "768x1024",
      "1280x720",
      "720x1280"
    ].includes(input.size) ||
    (input.mode !== "text-to-image" && input.mode !== "image-to-image") ||
    (workflow !== undefined && !isImageGenerationWorkflow(workflow)) ||
    (input.mode === "text-to-image" &&
      referenceImageFingerprints !== undefined) ||
    (input.mode === "image-to-image" &&
      referenceImageFingerprints === undefined) ||
    (workflow === "precision-edit" &&
      (input.mode !== "image-to-image" ||
        referenceImageFingerprints?.length !== 1)) ||
    (workflow === "transcript-images" &&
      (input.mode !== "text-to-image" ||
        input.count !== 1 ||
        referenceImageFingerprints !== undefined)) ||
    (workflow === "title-cover" &&
      (titleCoverOriginalTitle === undefined ||
        titleCoverStyle === undefined ||
        !isTitleCoverVisualStyle(titleCoverStyle) ||
        titleCoverOriginalTitle.trim().length === 0 ||
        Array.from(titleCoverOriginalTitle.trim()).length >
          titleCoverOriginalTitleMaxCodePoints)) ||
    (workflow !== "title-cover" &&
      (titleCoverOriginalTitle !== undefined || titleCoverStyle !== undefined)) ||
    (referenceImageFingerprints !== undefined &&
      referenceImageFingerprints.some(
        (fingerprint) =>
          !IMAGE_REFERENCE_FINGERPRINT_PATTERN.test(fingerprint)
      ))
  ) {
    throw new TypeError("INVALID_IMAGE_FINGERPRINT_INPUT");
  }

  const canonicalInput: Record<string, string | number | readonly string[]> = {};

  if (clientEntryId !== undefined) {
    canonicalInput.clientEntryId = clientEntryId;
  }
  canonicalInput.count = input.count;
  if (imageSessionId !== undefined) {
    canonicalInput.imageSessionId = imageSessionId;
  }
  if (imageSessionTitle !== undefined) {
    canonicalInput.imageSessionTitle = imageSessionTitle;
  }
  canonicalInput.mode = input.mode;
  canonicalInput.modelId = requireImageFingerprintString(input.modelId);
  canonicalInput.prompt = requireImageFingerprintString(input.prompt);
  if (referenceImageFingerprints?.length === 1) {
    canonicalInput.referenceImageFingerprint = referenceImageFingerprints[0]!;
  } else if (referenceImageFingerprints !== undefined) {
    canonicalInput.referenceImageFingerprints = referenceImageFingerprints;
  }
  canonicalInput.size = input.size;
  if (workflow !== undefined) {
    canonicalInput.workflow = workflow;
  }
  if (titleCoverOriginalTitle !== undefined) {
    canonicalInput.titleCoverOriginalTitle = titleCoverOriginalTitle.trim();
  }
  if (titleCoverStyle !== undefined) {
    canonicalInput.titleCoverStyle = titleCoverStyle;
  }

  return JSON.stringify(canonicalInput);
}

export function buildImageGenerationRequestFingerprint(
  input: ImageGenerationFingerprintInput
): Buffer {
  return hashImageRequestFingerprint(
    canonicalizeImageGenerationFingerprintInput(input)
  );
}

export interface VideoGenerationFingerprintInput {
  modelId: string;
  mode: "text-to-video" | "image-to-video";
  prompt: string;
  referenceFingerprint?: string;
}

export function buildVideoGenerationRequestFingerprint(
  input: VideoGenerationFingerprintInput
): Buffer {
  if (
    !input ||
    typeof input.modelId !== "string" ||
    typeof input.mode !== "string" ||
    typeof input.prompt !== "string" ||
    (input.mode !== "text-to-video" && input.mode !== "image-to-video") ||
    (input.referenceFingerprint !== undefined &&
      !IMAGE_REFERENCE_FINGERPRINT_PATTERN.test(input.referenceFingerprint)) ||
    (input.mode === "text-to-video" && input.referenceFingerprint !== undefined) ||
    (input.mode === "image-to-video" && input.referenceFingerprint === undefined)
  ) {
    throw new TypeError("INVALID_VIDEO_REQUEST_FINGERPRINT_INPUT");
  }

  const canonical = JSON.stringify({
    mode: input.mode,
    modelId: input.modelId.trim(),
    prompt: input.prompt.trim(),
    ...(input.referenceFingerprint
      ? { referenceFingerprint: input.referenceFingerprint }
      : {})
  });

  return hashDomainSeparated(VIDEO_REQUEST_FINGERPRINT_DOMAIN, canonical);
}

export function getIdempotencyClaimExpiresAt(now = new Date()): Date {
  return new Date(requireValidDate(now).getTime() + IDEMPOTENCY_CLAIM_TTL_MS);
}

export function getIdempotencyTerminalExpiresAt(now = new Date()): Date {
  return new Date(requireValidDate(now).getTime() + IDEMPOTENCY_TERMINAL_TTL_MS);
}
