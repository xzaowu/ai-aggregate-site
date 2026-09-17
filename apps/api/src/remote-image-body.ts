import { createHash } from "node:crypto";
import { Transform, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RemoteImageFetchResult } from "./remote-image-fetcher";

const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;
const REMOTE_IMAGE_BODY_TIMEOUT_MS = 30_000;
const MAX_MAGIC_PREFIX_BYTES = 16;

const remoteImageBodyMessages: Record<RemoteImageBodyErrorCode, string> = {
  REMOTE_IMAGE_BODY_TIMEOUT: "remote image response body timed out",
  REMOTE_IMAGE_TOO_LARGE: "remote image response body exceeds the allowed size",
  REMOTE_IMAGE_EMPTY: "remote image response body is empty",
  REMOTE_IMAGE_MAGIC_UNSUPPORTED: "remote image response body format is unsupported",
  REMOTE_IMAGE_FORMAT_INVALID: "remote image response body format is invalid",
  REMOTE_IMAGE_MIME_MISMATCH: "remote image response body MIME type does not match its content",
  REMOTE_IMAGE_LENGTH_MISMATCH: "remote image response body length does not match",
  REMOTE_IMAGE_STREAM_FAILED: "remote image response body stream failed",
  REMOTE_IMAGE_DESTINATION_FAILED: "remote image response body destination failed",
  REMOTE_IMAGE_ABORTED: "remote image response body was aborted",
  REMOTE_IMAGE_ALREADY_CONSUMED: "remote image response body was already consumed"
};

const consumedRemoteImageFetchResults = new WeakSet<object>();

export type RemoteImageBodyMimeType = "image/png" | "image/jpeg" | "image/webp";

export type RemoteImageBodyErrorStage = "body";

export type RemoteImageBodyErrorCode =
  | "REMOTE_IMAGE_BODY_TIMEOUT"
  | "REMOTE_IMAGE_TOO_LARGE"
  | "REMOTE_IMAGE_EMPTY"
  | "REMOTE_IMAGE_MAGIC_UNSUPPORTED"
  | "REMOTE_IMAGE_FORMAT_INVALID"
  | "REMOTE_IMAGE_MIME_MISMATCH"
  | "REMOTE_IMAGE_LENGTH_MISMATCH"
  | "REMOTE_IMAGE_STREAM_FAILED"
  | "REMOTE_IMAGE_DESTINATION_FAILED"
  | "REMOTE_IMAGE_ABORTED"
  | "REMOTE_IMAGE_ALREADY_CONSUMED";

export class RemoteImageBodyError extends Error {
  readonly code: RemoteImageBodyErrorCode;
  readonly stage: RemoteImageBodyErrorStage;
  readonly byteCount?: number;

  constructor(code: RemoteImageBodyErrorCode, metadata: { byteCount?: number } = {}) {
    super(remoteImageBodyMessages[code]);
    this.name = "RemoteImageBodyError";
    this.code = code;
    this.stage = "body";
    if (
      Number.isSafeInteger(metadata.byteCount) &&
      (metadata.byteCount as number) >= 0
    ) {
      this.byteCount = metadata.byteCount;
    }
  }
}

export interface ProcessRemoteImageBodyInput {
  fetchResult: RemoteImageFetchResult;
  destination: Writable;
  signal?: AbortSignal;
}

export interface ProcessRemoteImageBodyResult {
  mimeType: RemoteImageBodyMimeType;
  sizeBytes: number;
  sha256: string;
}

type DeclaredMimeType = RemoteImageBodyMimeType | "mismatch" | null;
type BodyFailure =
  | RemoteImageBodyError
  | "external-abort"
  | "timeout"
  | "source"
  | "destination";

interface ValidationTransformResult {
  readonly stream: Transform;
  readonly getMimeType: () => RemoteImageBodyMimeType | null;
  readonly getSizeBytes: () => number;
  readonly digest: () => string;
}

export async function processRemoteImageBody(
  input: ProcessRemoteImageBodyInput
): Promise<ProcessRemoteImageBodyResult> {
  if (consumedRemoteImageFetchResults.has(input.fetchResult)) {
    throw new RemoteImageBodyError("REMOTE_IMAGE_ALREADY_CONSUMED");
  }
  consumedRemoteImageFetchResults.add(input.fetchResult);

  let cancelInvoked = false;
  let destinationDestroyed = false;
  const safeCancel = (): void => {
    if (cancelInvoked) {
      return;
    }

    cancelInvoked = true;
    try {
      input.fetchResult.cancel();
    } catch {
      // Cancellation is best-effort and must not expose source failures.
    }
  };
  const safeDestroyDestination = (): void => {
    if (destinationDestroyed) {
      return;
    }

    destinationDestroyed = true;
    try {
      input.destination.destroy();
    } catch {
      // Destination destruction is best-effort and must not expose failures.
    }
  };
  const failBeforePipeline = (code: RemoteImageBodyErrorCode): RemoteImageBodyError => {
    safeCancel();
    safeDestroyDestination();
    return new RemoteImageBodyError(code);
  };

  if (input.signal?.aborted) {
    throw failBeforePipeline("REMOTE_IMAGE_ABORTED");
  }

  const declaredContentLength = input.fetchResult.contentLength;
  if (
    declaredContentLength !== null &&
    (!Number.isSafeInteger(declaredContentLength) || declaredContentLength < 0)
  ) {
    throw failBeforePipeline("REMOTE_IMAGE_LENGTH_MISMATCH");
  }
  if (declaredContentLength !== null && declaredContentLength > MAX_REMOTE_IMAGE_BYTES) {
    throw failBeforePipeline("REMOTE_IMAGE_TOO_LARGE");
  }

  const declaredMimeType = normalizeDeclaredMimeType(input.fetchResult.contentType);
  const operationController = new AbortController();
  let failure: BodyFailure | null = null;

  const recordFailure = (nextFailure: BodyFailure): void => {
    if (failure === null) {
      failure = nextFailure;
    }
  };
  const failValidation = (error: RemoteImageBodyError): void => {
    recordFailure(error);
    safeCancel();
    safeDestroyDestination();
  };
  const abortOperation = (nextFailure: "external-abort" | "timeout"): void => {
    if (failure !== null) {
      return;
    }

    recordFailure(nextFailure);
    operationController.abort();
    safeCancel();
    safeDestroyDestination();
  };
  const sourceErrorListener = (): void => {
    if (failure !== null) {
      return;
    }

    recordFailure("source");
    safeCancel();
    safeDestroyDestination();
  };
  let sourceEnded = false;
  const sourceEndListener = (): void => {
    sourceEnded = true;
  };
  const sourceCloseListener = (): void => {
    if (sourceEnded || failure !== null) {
      return;
    }

    recordFailure("source");
    safeCancel();
    safeDestroyDestination();
  };
  const destinationErrorListener = (): void => {
    if (failure !== null) {
      return;
    }

    recordFailure("destination");
    safeCancel();
    safeDestroyDestination();
  };
  const externalAbortListener = (): void => {
    abortOperation("external-abort");
  };
  const validation = createValidationTransform({
    declaredMimeType,
    onValidationFailure: failValidation
  });

  input.fetchResult.stream.on("error", sourceErrorListener);
  input.fetchResult.stream.on("end", sourceEndListener);
  input.fetchResult.stream.on("close", sourceCloseListener);
  input.destination.on("error", destinationErrorListener);
  input.signal?.addEventListener("abort", externalAbortListener, { once: true });

  if (input.signal?.aborted) {
    abortOperation("external-abort");
  }

  const timeout = setTimeout(() => {
    abortOperation("timeout");
  }, REMOTE_IMAGE_BODY_TIMEOUT_MS);

  try {
    if (failure !== null) {
      throw mapBodyFailure(failure);
    }

    await pipeline(input.fetchResult.stream, validation.stream, input.destination, {
      signal: operationController.signal
    });

    if (failure !== null) {
      throw mapBodyFailure(failure);
    }

    const mimeType = validation.getMimeType();
    if (mimeType === null) {
      const error = new RemoteImageBodyError("REMOTE_IMAGE_EMPTY");
      failValidation(error);
      throw error;
    }
    if (declaredContentLength !== null && validation.getSizeBytes() !== declaredContentLength) {
      const error = new RemoteImageBodyError("REMOTE_IMAGE_LENGTH_MISMATCH", {
        byteCount: validation.getSizeBytes()
      });
      failValidation(error);
      throw error;
    }

    try {
      return {
        mimeType,
        sizeBytes: validation.getSizeBytes(),
        sha256: validation.digest()
      };
    } catch {
      const error = new RemoteImageBodyError("REMOTE_IMAGE_STREAM_FAILED");
      failValidation(error);
      throw error;
    }
  } catch {
    const error = mapBodyFailure(failure);
    safeCancel();
    safeDestroyDestination();
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", externalAbortListener);
    input.fetchResult.stream.removeListener("error", sourceErrorListener);
    input.fetchResult.stream.removeListener("end", sourceEndListener);
    input.fetchResult.stream.removeListener("close", sourceCloseListener);
    input.destination.removeListener("error", destinationErrorListener);
  }
}

function createValidationTransform(input: {
  declaredMimeType: DeclaredMimeType;
  onValidationFailure(error: RemoteImageBodyError): void;
}): ValidationTransformResult {
  const prefix = Buffer.alloc(MAX_MAGIC_PREFIX_BYTES);
  const hash = createHash("sha256");
  let prefixLength = 0;
  let sizeBytes = 0;
  let mimeType: RemoteImageBodyMimeType | null = null;

  const fail = (error: RemoteImageBodyError): RemoteImageBodyError => {
    input.onValidationFailure(error);
    return error;
  };
  const classify = (): void => {
    if (mimeType !== null) {
      return;
    }

    const detectedMimeType = detectMimeType(prefix, prefixLength);
    if (detectedMimeType === null) {
      return;
    }
    if (
      input.declaredMimeType === "mismatch" ||
      (input.declaredMimeType !== null && input.declaredMimeType !== detectedMimeType)
    ) {
      throw fail(new RemoteImageBodyError("REMOTE_IMAGE_MIME_MISMATCH"));
    }

    mimeType = detectedMimeType;
  };

  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      const byteChunk: Uint8Array = chunk;

      try {
        if (byteChunk.byteLength > MAX_REMOTE_IMAGE_BYTES - sizeBytes) {
          callback(
            fail(
              new RemoteImageBodyError("REMOTE_IMAGE_TOO_LARGE", {
                byteCount: sizeBytes + byteChunk.byteLength
              })
            )
          );
          return;
        }

        sizeBytes += byteChunk.byteLength;
        hash.update(byteChunk);

        if (prefixLength < MAX_MAGIC_PREFIX_BYTES) {
          const prefixBytes = Math.min(
            MAX_MAGIC_PREFIX_BYTES - prefixLength,
            byteChunk.byteLength
          );
          prefix.set(byteChunk.subarray(0, prefixBytes), prefixLength);
          prefixLength += prefixBytes;
        }

        classify();
        callback(null, chunk);
      } catch (error) {
        if (error instanceof RemoteImageBodyError) {
          callback(fail(error));
          return;
        }

        callback(fail(new RemoteImageBodyError("REMOTE_IMAGE_STREAM_FAILED")));
      }
    },
    flush(callback) {
      try {
        if (sizeBytes === 0) {
          callback(
            fail(new RemoteImageBodyError("REMOTE_IMAGE_EMPTY", { byteCount: 0 }))
          );
          return;
        }

        classify();
        if (mimeType === null) {
          callback(
            fail(
              new RemoteImageBodyError("REMOTE_IMAGE_MAGIC_UNSUPPORTED", {
                byteCount: sizeBytes
              })
            )
          );
          return;
        }
        if (mimeType === "image/webp" && readRiffDeclaredSize(prefix) + 8 !== sizeBytes) {
          callback(
            fail(
              new RemoteImageBodyError("REMOTE_IMAGE_FORMAT_INVALID", {
                byteCount: sizeBytes
              })
            )
          );
          return;
        }

        callback();
      } catch (error) {
        if (error instanceof RemoteImageBodyError) {
          callback(fail(error));
          return;
        }

        callback(fail(new RemoteImageBodyError("REMOTE_IMAGE_STREAM_FAILED")));
      }
    }
  });

  return {
    stream,
    getMimeType: () => mimeType,
    getSizeBytes: () => sizeBytes,
    digest: () => hash.digest("hex")
  };
}

function normalizeDeclaredMimeType(contentType: string | null): DeclaredMimeType {
  if (contentType === null || /[,\r\n]/u.test(contentType)) {
    return null;
  }

  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined || mediaType.length === 0 || mediaType === "application/octet-stream") {
    return null;
  }
  if (mediaType === "image/jpg") {
    return "image/jpeg";
  }
  if (mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp") {
    return mediaType;
  }

  return "mismatch";
}

function detectMimeType(
  prefix: Uint8Array,
  prefixLength: number
): RemoteImageBodyMimeType | null {
  if (prefixLength < 4) {
    return null;
  }
  if (matchesBytes(prefix, [0x89, 0x50, 0x4e, 0x47])) {
    if (prefixLength < 8) {
      return null;
    }
    if (matchesBytes(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return "image/png";
    }
    throw new RemoteImageBodyError("REMOTE_IMAGE_MAGIC_UNSUPPORTED");
  }
  if (matchesBytes(prefix, [0xff, 0xd8, 0xff])) {
    if (prefix[3] === 0x00 || prefix[3] === 0xff) {
      throw new RemoteImageBodyError("REMOTE_IMAGE_MAGIC_UNSUPPORTED");
    }
    return "image/jpeg";
  }
  if (matchesBytes(prefix, [0x52, 0x49, 0x46, 0x46])) {
    if (prefixLength < MAX_MAGIC_PREFIX_BYTES) {
      return null;
    }
    if (
      !matchesBytes(prefix, [0x57, 0x45, 0x42, 0x50], 8) ||
      !matchesAnyBytes(
        prefix,
        [
          [0x56, 0x50, 0x38, 0x20],
          [0x56, 0x50, 0x38, 0x4c],
          [0x56, 0x50, 0x38, 0x58]
        ],
        12
      )
    ) {
      throw new RemoteImageBodyError("REMOTE_IMAGE_MAGIC_UNSUPPORTED");
    }
    return "image/webp";
  }

  throw new RemoteImageBodyError("REMOTE_IMAGE_MAGIC_UNSUPPORTED");
}

function matchesBytes(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function matchesAnyBytes(
  bytes: Uint8Array,
  expectedValues: readonly (readonly number[])[],
  offset: number
): boolean {
  return expectedValues.some((expected) => matchesBytes(bytes, expected, offset));
}

function readRiffDeclaredSize(prefix: Uint8Array): number {
  return (
    prefix[4]! |
    (prefix[5]! << 8) |
    (prefix[6]! << 16) |
    (prefix[7]! << 24)
  ) >>> 0;
}

function mapBodyFailure(failure: BodyFailure | null): RemoteImageBodyError {
  if (failure instanceof RemoteImageBodyError) {
    return failure;
  }
  if (failure === "external-abort") {
    return new RemoteImageBodyError("REMOTE_IMAGE_ABORTED");
  }
  if (failure === "timeout") {
    return new RemoteImageBodyError("REMOTE_IMAGE_BODY_TIMEOUT");
  }
  if (failure === "destination") {
    return new RemoteImageBodyError("REMOTE_IMAGE_DESTINATION_FAILED");
  }

  return new RemoteImageBodyError("REMOTE_IMAGE_STREAM_FAILED");
}
