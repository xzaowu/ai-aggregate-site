import {
  joinProviderEndpointUrl,
  normalizeProviderHeaders
} from "@ai-aggregate/shared";
import {
  AIProviderAbortError,
  AIProviderRequestError,
  AIProviderResponseFormatError,
  AIProviderSubmissionUncertainError,
  AIProviderTimeoutError
} from "./index";

export const APIMART_VIDEO_TASK_V1 = "apimart-task-v1" as const;
export const VIDEO_REFERENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;
export type VideoReferenceMimeType = (typeof VIDEO_REFERENCE_MIME_TYPES)[number];

export type ApimartVideoProfileId =
  | "seedance"
  | "veo3"
  | "veo3-text-only"
  | "minimax-hailuo"
  | "wan"
  | "kling"
  | "grok-imagine-1"
  | "grok-imagine-1-5";

export interface ApimartVideoProfile {
  id: ApimartVideoProfileId;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  durationSeconds: number;
  resolution: string | null;
  aspectRatio: string;
  referenceField:
    | "image_urls"
    | "image_with_roles"
    | "first_frame_image"
    | null;
  fixedFields: Readonly<Record<string, string | number | boolean>>;
}

const APIMART_VIDEO_PROFILES: readonly ApimartVideoProfile[] = [
  {
    id: "seedance",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 5,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceField: "image_with_roles",
    fixedFields: {}
  },
  {
    id: "veo3",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 8,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceField: "image_urls",
    fixedFields: {}
  },
  {
    id: "veo3-text-only",
    supportsTextToVideo: true,
    supportsImageToVideo: false,
    durationSeconds: 8,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceField: null,
    fixedFields: {}
  },
  {
    id: "minimax-hailuo",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 5,
    resolution: "768p",
    aspectRatio: "16:9",
    referenceField: "first_frame_image",
    fixedFields: {
      prompt_optimizer: true,
      fast_pretreatment: false,
      watermark: false
    }
  },
  {
    id: "wan",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 5,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceField: "image_urls",
    fixedFields: {}
  },
  {
    id: "kling",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 5,
    resolution: null,
    aspectRatio: "16:9",
    referenceField: "image_urls",
    fixedFields: { mode: "std" }
  },
  {
    id: "grok-imagine-1",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 6,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceField: "image_urls",
    fixedFields: { quality: "720p" }
  },
  {
    id: "grok-imagine-1-5",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 6,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceField: "image_urls",
    fixedFields: {}
  }
];

export function resolveApimartVideoProfile(
  upstreamModel: string
): ApimartVideoProfile | null {
  if (typeof upstreamModel !== "string") {
    return null;
  }

  const normalized = upstreamModel.trim().toLowerCase();
  if (normalized === "doubao-seedance-1-0-pro-fast") {
    return APIMART_VIDEO_PROFILES[0] ?? null;
  }
  if (/^veo3\.1-fast(?:-ext)?$/u.test(normalized)) {
    return APIMART_VIDEO_PROFILES[1] ?? null;
  }
  if (/^veo3\.1-(?:quality|lite)(?:-ext)?$/u.test(normalized)) {
    return APIMART_VIDEO_PROFILES[2] ?? null;
  }
  if (/^minimax-hailuo-02(?:\.\d+)?$/u.test(normalized)) {
    return APIMART_VIDEO_PROFILES[3] ?? null;
  }
  if (/^wan2\.6$/u.test(normalized)) {
    return APIMART_VIDEO_PROFILES[4] ?? null;
  }
  if (/^kling-v3$/u.test(normalized)) {
    return APIMART_VIDEO_PROFILES[5] ?? null;
  }
  if (normalized === "grok-imagine-1.0-video-apimart") {
    return APIMART_VIDEO_PROFILES[6] ?? null;
  }
  if (/^grok-imagine-1\.5-video(?:-apimart|-ext)?$/u.test(normalized)) {
    return APIMART_VIDEO_PROFILES[7] ?? null;
  }

  return null;
}

export function listApimartVideoProfiles(): readonly ApimartVideoProfile[] {
  return APIMART_VIDEO_PROFILES;
}

export interface VideoReferenceImage {
  bytes: Uint8Array;
  mimeType: VideoReferenceMimeType;
  filename?: string;
}

export interface StartVideoGenerationRequest {
  model: string;
  prompt: string;
  mode: "text-to-video" | "image-to-video";
  profile: ApimartVideoProfile;
  referenceImage?: VideoReferenceImage;
  signal?: AbortSignal;
}

export type VideoGenerationStartResult = {
  status: "accepted";
  operationId: string;
};

export type VideoGenerationPollResult =
  | { status: "pending"; progress?: number }
  | { status: "processing"; progress?: number }
  | { status: "completed"; resultUrl: string; progress?: number }
  | { status: "failed"; message?: string }
  | { status: "cancelled"; message?: string };

export interface VideoGenerationAdapter {
  startVideoGeneration(
    request: StartVideoGenerationRequest
  ): Promise<VideoGenerationStartResult>;
  pollVideoGeneration(input: {
    operationId: string;
    signal?: AbortSignal;
  }): Promise<VideoGenerationPollResult>;
}

export interface ApimartVideoAdapterConfig {
  baseUrl: string;
  apiKey: string;
  headersJson?: Record<string, unknown> | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_APIMART_VIDEO_TIMEOUT_MS = 60_000;
const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonPayload(value: unknown): unknown {
  return value;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 600) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) {
    return undefined;
  }
  return Math.min(600_000, Math.max(0, date - Date.now()));
}

function endpointUrl(baseUrl: string, suffix: string): string {
  try {
    const parsed = new URL(baseUrl.trim());
    const normalizedPath = parsed.pathname.replace(/\/+$/u, "");
    if (normalizedPath !== "" && normalizedPath !== "/v1") {
      throw new Error("APIMART_VIDEO_BASE_URL_PATH_INVALID");
    }
    parsed.pathname = "";
    return joinProviderEndpointUrl(parsed.toString(), suffix);
  } catch {
    throw new AIProviderRequestError("AI provider request failed", {
      endpointPath: suffix
    });
  }
}

function headers(
  apiKey: string,
  headersJson: Record<string, unknown> | null | undefined
): Record<string, string> {
  return {
    ...normalizeProviderHeaders(headersJson),
    Authorization: `Bearer ${apiKey}`
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<Response> {
  if (parentSignal?.aborted) {
    throw new AIProviderAbortError();
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortParent, { once: true });
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new AIProviderTimeoutError();
    }
    if (parentSignal?.aborted) {
      throw new AIProviderAbortError();
    }
    throw new AIProviderRequestError("AI provider request failed", {});
  } finally {
    clearTimeout(timeoutHandle);
    parentSignal?.removeEventListener("abort", abortParent);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return readJsonPayload(await response.json());
  } catch {
    throw new AIProviderResponseFormatError();
  }
}

async function readProviderError(
  response: Response,
  endpointPath: string
): Promise<never> {
  throw new AIProviderRequestError("AI provider request failed", {
    statusCode: response.status,
    endpointPath,
    retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"))
  });
}

function requireAcceptedOperation(payload: unknown): string {
  if (!isRecord(payload) || payload.code !== 200) {
    throw new AIProviderResponseFormatError();
  }

  if (Array.isArray(payload.data)) {
    const item = payload.data[0];
    if (
      !isRecord(item) ||
      item.status !== "submitted" ||
      typeof item.task_id !== "string" ||
      item.task_id.trim().length === 0
    ) {
      throw new AIProviderResponseFormatError();
    }

    return item.task_id.trim();
  }

  if (
    isRecord(payload.data) &&
    payload.data.status === "submitted" &&
    typeof payload.data.id === "string" &&
    payload.data.id.trim().length > 0
  ) {
    return payload.data.id.trim();
  }

  throw new AIProviderResponseFormatError();
}

function requirePollResult(payload: unknown): VideoGenerationPollResult {
  if (!isRecord(payload) || payload.code !== 200 || !isRecord(payload.data)) {
    throw new AIProviderResponseFormatError();
  }

  const data = payload.data;
  if (data.status === "pending" || data.status === "processing") {
    return {
      status: data.status,
      ...(typeof data.progress === "number" &&
      Number.isInteger(data.progress) &&
      data.progress >= 0 &&
      data.progress <= 100
        ? { progress: data.progress }
        : {})
    };
  }
  if (data.status === "failed" || data.status === "cancelled") {
    return {
      status: data.status,
      ...(typeof data.error === "string" && data.error.trim().length > 0
        ? { message: data.error.trim().slice(0, 200) }
        : {})
    };
  }
  if (data.status !== "completed" || !isRecord(data.result)) {
    throw new AIProviderResponseFormatError();
  }

  const videos = data.result.videos;
  if (!Array.isArray(videos) || videos.length === 0) {
    throw new AIProviderResponseFormatError();
  }
  const first = videos[0];
  if (!isRecord(first)) {
    throw new AIProviderResponseFormatError();
  }
  const candidate = first.url;
  const resultUrl = Array.isArray(candidate) ? candidate[0] : candidate;
  if (
    typeof resultUrl !== "string" ||
    !/^https?:\/\/[^\s]+$/u.test(resultUrl.trim())
  ) {
    throw new AIProviderResponseFormatError();
  }

  return {
    status: "completed",
    resultUrl: resultUrl.trim(),
    ...(typeof data.progress === "number" &&
    Number.isInteger(data.progress) &&
    data.progress >= 0 &&
    data.progress <= 100
      ? { progress: data.progress }
      : {})
  };
}

function buildGenerationPayload(
  request: StartVideoGenerationRequest,
  referenceUrl?: string
): Record<string, unknown> {
  const profile = request.profile;
  if (
    request.mode === "image-to-video" &&
    (!referenceUrl || !profile.supportsImageToVideo || !profile.referenceField)
  ) {
    throw new AIProviderResponseFormatError();
  }
  if (request.mode === "text-to-video" && !profile.supportsTextToVideo) {
    throw new AIProviderResponseFormatError();
  }

  const payload: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    duration: profile.durationSeconds,
    ...profile.fixedFields
  };

  if (
    profile.resolution !== null &&
    profile.id !== "kling"
  ) {
    payload.resolution = profile.resolution;
  }

  if (
    profile.id !== "minimax-hailuo" &&
    !profile.id.startsWith("grok-imagine") &&
    !(profile.id === "wan" && request.mode === "image-to-video")
  ) {
    payload.aspect_ratio = profile.aspectRatio;
  }

  if (referenceUrl && profile.referenceField === "image_urls") {
    payload.image_urls = [referenceUrl];
  } else if (referenceUrl && profile.referenceField === "image_with_roles") {
    payload.image_with_roles = [{ url: referenceUrl, role: "first_frame" }];
  } else if (referenceUrl && profile.referenceField === "first_frame_image") {
    payload.first_frame_image = referenceUrl;
  }

  if (
    profile.id === "grok-imagine-1" ||
    profile.id === "grok-imagine-1-5"
  ) {
    payload.size = profile.aspectRatio;
  }

  return payload;
}

export function createApimartVideoAdapter(
  config: ApimartVideoAdapterConfig
): VideoGenerationAdapter {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs =
    Number.isSafeInteger(config.timeoutMs) && (config.timeoutMs ?? 0) > 0
      ? config.timeoutMs!
      : DEFAULT_APIMART_VIDEO_TIMEOUT_MS;
  const requestHeaders = headers(config.apiKey, config.headersJson);

  async function uploadReference(
    image: VideoReferenceImage,
    signal?: AbortSignal
  ): Promise<string> {
    if (
      !VIDEO_REFERENCE_MIME_TYPES.includes(image.mimeType) ||
      image.bytes.byteLength <= 0 ||
      image.bytes.byteLength > MAX_REFERENCE_BYTES
    ) {
      throw new AIProviderResponseFormatError();
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }),
      image.filename ?? "reference-image"
    );
    const path = "/v1/uploads/images";
    const response = await fetchWithTimeout(
      fetchImpl,
      endpointUrl(config.baseUrl, path),
      {
        method: "POST",
        headers: requestHeaders,
        body: form
      },
      timeoutMs,
      signal
    );
    if (!response.ok) {
      return readProviderError(response, path);
    }
    const payload = await readJson(response);
    if (
      !isRecord(payload) ||
      typeof payload.url !== "string" ||
      !/^https?:\/\/[^\s]+$/u.test(payload.url.trim())
    ) {
      throw new AIProviderResponseFormatError();
    }
    return payload.url.trim();
  }

  return {
    async startVideoGeneration(request) {
      const referenceUrl = request.referenceImage
        ? await uploadReference(request.referenceImage, request.signal)
        : undefined;
      const path = "/v1/videos/generations";
      let response: Response;
      try {
        response = await fetchWithTimeout(
          fetchImpl,
          endpointUrl(config.baseUrl, path),
          {
            method: "POST",
            headers: {
              ...requestHeaders,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(buildGenerationPayload(request, referenceUrl))
          },
          timeoutMs,
          request.signal
        );
      } catch (error) {
        if (
          error instanceof AIProviderTimeoutError ||
          (error instanceof AIProviderRequestError &&
            error.statusCode === undefined)
        ) {
          throw new AIProviderSubmissionUncertainError();
        }
        throw error;
      }
      if (!response.ok) {
        return readProviderError(response, path);
      }
      return {
        status: "accepted" as const,
        operationId: requireAcceptedOperation(await readJson(response))
      };
    },
    async pollVideoGeneration({ operationId, signal }) {
      if (
        typeof operationId !== "string" ||
        !/^[A-Za-z0-9._~-]+$/u.test(operationId.trim())
      ) {
        throw new AIProviderResponseFormatError();
      }
      const path = `/v1/tasks/${encodeURIComponent(operationId.trim())}`;
      const response = await fetchWithTimeout(
        fetchImpl,
        endpointUrl(config.baseUrl, path),
        { method: "GET", headers: requestHeaders },
        timeoutMs,
        signal
      );
      if (!response.ok) {
        return readProviderError(response, path);
      }
      return requirePollResult(await readJson(response));
    }
  };
}
