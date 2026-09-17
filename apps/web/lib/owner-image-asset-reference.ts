import type { AiAssetDetailResponse } from "@ai-aggregate/shared";
import {
  fetchPrivateAssetBlob,
  isAbortError,
  isPrivateAssetContentUrl,
  PrivateAssetContentError
} from "./private-asset-content";
import { isSupportedImageReferenceMimeType } from "./image-reference-preparation";
import { apiUrl } from "./site-config";

export type OwnerImageAssetReferenceErrorCode =
  | "INVALID_REQUEST"
  | "ASSET_UNAVAILABLE"
  | "INVALID_IMAGE_ASSET"
  | "INVALID_IMAGE_CONTENT";

export class OwnerImageAssetReferenceError extends Error {
  readonly code: OwnerImageAssetReferenceErrorCode;
  readonly terminal: boolean;

  constructor(code: OwnerImageAssetReferenceErrorCode, terminal: boolean) {
    super(code);
    this.name = "OwnerImageAssetReferenceError";
    this.code = code;
    this.terminal = terminal;
  }
}

export type ResolveOwnerImageAssetReferenceOptions = Readonly<{
  assetId: string;
  token: string;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
  fetchPrivateAssetBlobImplementation?: typeof fetchPrivateAssetBlob;
}>;

export type ResolvedOwnerImageAssetReference = Readonly<{
  asset: AiAssetDetailResponse["asset"];
  task: AiAssetDetailResponse["task"];
  blob: Blob;
}>;

function terminalError(
  code: OwnerImageAssetReferenceErrorCode
): OwnerImageAssetReferenceError {
  return new OwnerImageAssetReferenceError(code, true);
}

function transientError(): OwnerImageAssetReferenceError {
  return new OwnerImageAssetReferenceError("ASSET_UNAVAILABLE", false);
}

function isTerminalPrivateAssetContentError(error: unknown): boolean {
  return (
    error instanceof PrivateAssetContentError &&
    (error.code === "AUTH_REQUIRED" ||
      error.code === "NOT_FOUND" ||
      error.code === "INVALID_PRIVATE_URL" ||
      error.code === "INVALID_ASSET_URL")
  );
}

export async function resolveOwnerImageAssetReference({
  assetId,
  token,
  signal,
  fetchImplementation = fetch,
  fetchPrivateAssetBlobImplementation = fetchPrivateAssetBlob
}: ResolveOwnerImageAssetReferenceOptions): Promise<
  ResolvedOwnerImageAssetReference
> {
  if (!assetId.trim() || !token) {
    throw terminalError("INVALID_REQUEST");
  }

  let response: Response;
  try {
    response = await fetchImplementation(apiUrl(`/assets/${assetId}`), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw transientError();
  }

  if (!response.ok) {
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429
    ) {
      throw terminalError("ASSET_UNAVAILABLE");
    }
    throw transientError();
  }

  let data: Partial<AiAssetDetailResponse>;
  try {
    data = (await response.json()) as Partial<AiAssetDetailResponse>;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw transientError();
  }

  const asset = data.asset;
  if (
    !asset ||
    asset.id !== assetId ||
    asset.type !== "image" ||
    !isPrivateAssetContentUrl(asset.url)
  ) {
    throw terminalError("INVALID_IMAGE_ASSET");
  }

  let blob: Blob;
  try {
    blob = await fetchPrivateAssetBlobImplementation({
      logicalUrl: asset.url,
      token,
      signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (isTerminalPrivateAssetContentError(error)) {
      throw terminalError("INVALID_IMAGE_CONTENT");
    }
    throw transientError();
  }

  if (blob.size <= 0 || !isSupportedImageReferenceMimeType(blob.type)) {
    throw terminalError("INVALID_IMAGE_CONTENT");
  }

  return {
    asset,
    task: data.task ?? null,
    blob
  };
}
