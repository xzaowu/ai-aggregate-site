import { apiUrl } from "./site-config";

const privateAvatarUrlPattern = /^\/generated-assets\/images\/\d{4}\/\d{2}\/[0-9a-f-]+\.(?:png|jpg|webp)$/u;
const generatedAssetsUrlPattern = /^\/generated-assets\/[A-Za-z0-9._/-]+$/u;

export type PrivateAvatarContentErrorCode =
  | "AUTH_REQUIRED"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "INVALID_PRIVATE_URL";

export class PrivateAvatarContentError extends Error {
  readonly code: PrivateAvatarContentErrorCode;

  constructor(code: PrivateAvatarContentErrorCode) {
    super(code);
    this.name = "PrivateAvatarContentError";
    this.code = code;
  }
}

export function isPrivateAvatarContentUrl(url: unknown): url is string {
  return typeof url === "string" && privateAvatarUrlPattern.test(url);
}

export function isAbortError(error: unknown): error is Error {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

function unavailableError(): PrivateAvatarContentError {
  return new PrivateAvatarContentError("UNAVAILABLE");
}

function imageContentType(value: string | null): string | null {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "image/png" ||
    contentType === "image/jpeg" ||
    contentType === "image/webp"
    ? contentType
    : null;
}

export interface FetchPrivateAvatarBlobOptions {
  token: string;
  signal?: AbortSignal;
}

/**
 * Reads only the authenticated user's local avatar through the non-enumerable
 * content route. The returned Blob intentionally contains no URL metadata.
 */
export async function fetchPrivateAvatarBlob({
  token,
  signal
}: FetchPrivateAvatarBlobOptions): Promise<Blob> {
  if (token.trim().length === 0) {
    throw new PrivateAvatarContentError("AUTH_REQUIRED");
  }

  try {
    const response = await fetch(apiUrl("/account/avatar/content"), {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`
      },
      signal
    });

    if (response.status === 401) {
      throw new PrivateAvatarContentError("AUTH_REQUIRED");
    }

    if (response.status === 404) {
      throw new PrivateAvatarContentError("NOT_FOUND");
    }

    if (!response.ok || imageContentType(response.headers.get("content-type")) === null) {
      throw unavailableError();
    }

    const blob = await response.blob();
    if (blob.size <= 0) {
      throw unavailableError();
    }

    return blob;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (error instanceof PrivateAvatarContentError) {
      throw error;
    }

    throw unavailableError();
  }
}

/**
 * Old public generated-assets URLs are routed through the configured API
 * origin. Private StorageObject URLs are deliberately excluded and must use
 * the authenticated Blob flow above.
 */
export function resolvePublicAvatarUrl(url: string): string {
  return generatedAssetsUrlPattern.test(url) && !isPrivateAvatarContentUrl(url)
    ? apiUrl(url)
    : url;
}
