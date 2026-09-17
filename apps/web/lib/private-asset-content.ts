import { apiUrl } from "./site-config";

const privateAssetContentUrlPattern = /^\/assets\/[A-Za-z0-9_-]+\/content$/;

export type PrivateAssetContentErrorCode =
  | "AUTH_REQUIRED"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "INVALID_PRIVATE_URL"
  | "INVALID_ASSET_URL";

export class PrivateAssetContentError extends Error {
  readonly code: PrivateAssetContentErrorCode;

  constructor(code: PrivateAssetContentErrorCode) {
    super(code);
    this.name = "PrivateAssetContentError";
    this.code = code;
  }
}

/**
 * Recognizes the logical URL persisted for a locally stored private AiAsset.
 * This intentionally does not accept browser-facing /api URLs or absolute URLs.
 */
export function isPrivateAssetContentUrl(url: unknown): url is string {
  return typeof url === "string" && privateAssetContentUrlPattern.test(url);
}

export function isAbortError(error: unknown): error is Error {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

function unavailableError(): PrivateAssetContentError {
  return new PrivateAssetContentError("UNAVAILABLE");
}

export interface FetchPrivateAssetBlobOptions {
  logicalUrl: string;
  token: string;
  signal?: AbortSignal;
}

/**
 * Loads a private local asset through the authenticated content endpoint.
 * It returns only a validated Blob and never exposes a Response or error body.
 */
export async function fetchPrivateAssetBlob({
  logicalUrl,
  token,
  signal
}: FetchPrivateAssetBlobOptions): Promise<Blob> {
  if (!isPrivateAssetContentUrl(logicalUrl)) {
    throw new PrivateAssetContentError("INVALID_PRIVATE_URL");
  }

  if (token.trim().length === 0) {
    throw new PrivateAssetContentError("AUTH_REQUIRED");
  }

  try {
    const response = await fetch(apiUrl(logicalUrl), {
      method: "GET",
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${token}`
      },
      signal
    });

    if (response.status === 401) {
      throw new PrivateAssetContentError("AUTH_REQUIRED");
    }

    if (response.status === 404) {
      throw new PrivateAssetContentError("NOT_FOUND");
    }

    if (!response.ok) {
      throw unavailableError();
    }

    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (
      contentType !== "image/png" &&
      contentType !== "image/jpeg" &&
      contentType !== "image/webp" &&
      contentType !== "video/mp4"
    ) {
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

    if (error instanceof PrivateAssetContentError) {
      throw error;
    }

    throw unavailableError();
  }
}

function isAllowedPublicAssetUrl(url: string) {
  return (
    /^https?:\/\//i.test(url) ||
    /^\/generated-assets\/[^?#]+$/i.test(url)
  );
}

function isSupportedImageContentType(value: string | null) {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return (
    contentType === "image/png" ||
    contentType === "image/jpeg" ||
    contentType === "image/webp"
  );
}

export interface FetchImageAssetBlobOptions {
  logicalUrl: string;
  token?: string | null;
  signal?: AbortSignal;
}

/**
 * Reads a complete image asset through the same private route used by image
 * rendering, or through an existing public/provider URL without credentials.
 * It returns only a non-empty, image-typed Blob and never exposes response
 * bodies or upstream errors.
 */
export async function fetchImageAssetBlob({
  logicalUrl,
  token,
  signal
}: FetchImageAssetBlobOptions): Promise<Blob> {
  if (isPrivateAssetContentUrl(logicalUrl)) {
    return fetchPrivateAssetBlob({ logicalUrl, token: token ?? "", signal });
  }

  if (!isAllowedPublicAssetUrl(logicalUrl)) {
    throw new PrivateAssetContentError("INVALID_ASSET_URL");
  }

  try {
    const response = await fetch(logicalUrl, {
      method: "GET",
      credentials: "omit",
      signal
    });

    if (!response.ok || !isSupportedImageContentType(response.headers.get("content-type"))) {
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

    if (error instanceof PrivateAssetContentError) {
      throw error;
    }

    throw unavailableError();
  }
}
