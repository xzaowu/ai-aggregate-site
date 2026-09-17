import { createHash } from "node:crypto";
import { PassThrough, Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  processRemoteImageBody,
  RemoteImageBodyError
} from "../src/remote-image-body";
import type { RemoteImageFetchResult } from "../src/remote-image-fetcher";

const MAX_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

afterEach(() => {
  vi.useRealTimers();
});

describe("remote image body successful streams", () => {
  it("accepts PNG and reports the written bytes with a streaming hash", async () => {
    const image = png([1, 2, 3]);
    const fixture = createResult({ chunks: [image], contentLength: image.byteLength });
    const destination = createDestination();

    const result = await processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: destination.writable
    });

    expect(result).toEqual({
      mimeType: "image/png",
      sizeBytes: image.byteLength,
      sha256: createHash("sha256").update(image).digest("hex")
    });
    expect([...destination.bytes()]).toEqual([...image]);
    expect(fixture.cancelCalls()).toBe(0);
  });

  it("accepts JPEG", async () => {
    const image = jpeg([1, 2]);
    const result = await processImage(image, "image/jpeg");

    expect(result.mimeType).toBe("image/jpeg");
  });

  it.each(["VP8 ", "VP8L", "VP8X"] as const)("accepts WebP %s", async (chunkType) => {
    const image = webp(chunkType, [1, 2, 3]);
    const result = await processImage(image, "image/webp");

    expect(result.mimeType).toBe("image/webp");
    expect(result.sizeBytes).toBe(image.byteLength);
  });

  it("passes multi-chunk PNG through without changing byte order", async () => {
    const image = png([1, 2, 3, 4]);
    const fixture = createResult({
      chunks: [image.subarray(0, 3), image.subarray(3, 9), image.subarray(9)],
      contentLength: image.byteLength,
      contentType: "image/png"
    });
    const destination = createDestination();

    await processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: destination.writable });

    expect([...destination.bytes()]).toEqual([...image]);
  });

  it("passes multi-chunk JPEG through without changing byte order", async () => {
    const image = jpeg([1, 2, 3, 4]);
    const fixture = createResult({
      chunks: [image.subarray(0, 2), image.subarray(2, 4), image.subarray(4)],
      contentLength: image.byteLength,
      contentType: "image/jpeg"
    });
    const destination = createDestination();

    await processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: destination.writable });

    expect([...destination.bytes()]).toEqual([...image]);
  });

  it("recognizes a WebP header split across chunks", async () => {
    const image = webp("VP8X", [1, 2]);
    const fixture = createResult({
      chunks: [image.subarray(0, 5), image.subarray(5, 13), image.subarray(13)],
      contentLength: image.byteLength,
      contentType: "image/webp"
    });
    const destination = createDestination();

    const result = await processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: destination.writable
    });

    expect(result.mimeType).toBe("image/webp");
    expect([...destination.bytes()]).toEqual([...image]);
  });

  it.each([
    ["missing Content-Type", null, "image/png"],
    ["octet stream", "application/octet-stream", "image/png"],
    ["octet stream parameters", "application/octet-stream; charset=binary", "image/png"],
    ["jpg alias", "image/jpg", "image/jpeg"],
    ["PNG parameters", "image/png; charset=binary", "image/png"],
    ["mixed casing and whitespace", "  IMAGE/WEBP ; charset=binary ", "image/webp"],
    ["comma separated declaration", "image/jpeg, text/html", "image/png"],
    ["line-broken declaration", "image/jpeg\r\n", "image/png"]
  ] as const)("accepts %s", async (_name, contentType, expectedMimeType) => {
    const image = expectedMimeType === "image/jpeg" ? jpeg([1]) : expectedMimeType === "image/webp" ? webp("VP8 ") : png([1]);
    const result = await processImage(image, contentType);

    expect(result.mimeType).toBe(expectedMimeType);
  });

  it("uses actual bytes when Content-Length is null", async () => {
    const image = png([1, 2, 3, 4, 5]);
    const result = await processImage(image, "image/png", null);

    expect(result.sizeBytes).toBe(image.byteLength);
  });

  it("accepts an exact Content-Length", async () => {
    const image = png([1, 2, 3]);
    const result = await processImage(image, "image/png", image.byteLength);

    expect(result.sizeBytes).toBe(image.byteLength);
  });

  it("allows an actual body and Content-Length exactly at 10 MiB", async () => {
    const image = pngAtSize(MAX_BYTES);
    const fixture = createResult({ chunks: [image], contentLength: MAX_BYTES });
    const destination = createDestination();

    const result = await processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: destination.writable
    });

    expect(result.sizeBytes).toBe(MAX_BYTES);
    expect(destination.writtenSize()).toBe(MAX_BYTES);
    expect(fixture.cancelCalls()).toBe(0);
  });

  it("cleans its deadline and external listener after success", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const image = png([1]);
    const fixture = createResult({ chunks: [image], contentLength: image.byteLength });
    const destination = createDestination();

    await processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: destination.writable,
      signal: controller.signal
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fixture.cancelCalls()).toBe(0);
  });
});

describe("remote image body magic and format checks", () => {
  it.each([
    ["empty", Buffer.alloc(0), "REMOTE_IMAGE_EMPTY"],
    ["one byte", Buffer.from([0x89]), "REMOTE_IMAGE_MAGIC_UNSUPPORTED"],
    ["short PNG", Buffer.from(PNG_SIGNATURE.slice(0, 7)), "REMOTE_IMAGE_MAGIC_UNSUPPORTED"],
    ["short JPEG", Buffer.from([0xff, 0xd8, 0xff]), "REMOTE_IMAGE_MAGIC_UNSUPPORTED"],
    ["short WebP", webp("VP8 ").subarray(0, 15), "REMOTE_IMAGE_MAGIC_UNSUPPORTED"]
  ] as const)("rejects %s", async (_name, image, code) => {
    const error = await expectBodyError(processImage(image, null));

    expect(error.code).toBe(code);
  });

  it.each([
    ["GIF", Buffer.from("GIF89a")],
    ["SVG", Buffer.from("<svg")],
    ["HTML", Buffer.from("<htm")],
    ["JSON", Buffer.from("{\"a\"")],
    ["PDF", Buffer.from("%PDF")],
    ["RIFF without WEBP", riff("WAVE", "VP8 ")],
    ["WebP with an invalid first chunk", webp("BAD!")]
  ] as const)("rejects unsupported %s bytes", async (_name, image) => {
    const error = await expectBodyError(processImage(image, null));

    expect(error.code).toBe("REMOTE_IMAGE_MAGIC_UNSUPPORTED");
  });

  it("rejects a WebP RIFF size that does not equal the actual byte count", async () => {
    const image = webp("VP8 ", [1, 2]);
    image.writeUInt32LE(image.byteLength - 7, 4);

    const error = await expectBodyError(processImage(image, "image/webp"));

    expect(error.code).toBe("REMOTE_IMAGE_FORMAT_INVALID");
  });

  it.each([
    ["PNG declaration with JPEG bytes", "image/png", jpeg([1])],
    ["JPEG declaration with PNG bytes", "image/jpeg", png([1])],
    ["HTML declaration with PNG bytes", "text/html", png([1])],
    ["WebP declaration with PNG bytes", "image/webp", png([1])]
  ] as const)("rejects %s", async (_name, contentType, image) => {
    const error = await expectBodyError(processImage(image, contentType));

    expect(error.code).toBe("REMOTE_IMAGE_MIME_MISMATCH");
  });
});

describe("remote image body size and length checks", () => {
  it("rejects a Content-Length above the limit before the source starts", async () => {
    let reads = 0;
    const stream = new Readable({
      read() {
        reads += 1;
        this.push(png([1]));
        this.push(null);
      }
    });
    const fixture = createResult({ stream, contentLength: MAX_BYTES + 1 });
    const destination = createDestination();

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: destination.writable })
    );

    expect(error.code).toBe("REMOTE_IMAGE_TOO_LARGE");
    expect(reads).toBe(0);
    expect(fixture.cancelCalls()).toBe(1);
    expect(destination.writable.destroyed).toBe(true);
  });

  it("stops at the first actual byte above 10 MiB", async () => {
    const atLimit = pngAtSize(MAX_BYTES);
    const fixture = createResult({ chunks: [atLimit, Buffer.from([0x00]), png([1])] });
    const destination = createDestination();

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: destination.writable })
    );

    expect(error.code).toBe("REMOTE_IMAGE_TOO_LARGE");
    expect(fixture.cancelCalls()).toBe(1);
    expect(destination.writtenSize()).toBe(MAX_BYTES);
  });

  it("enforces the actual limit when a smaller header lies", async () => {
    const fixture = createResult({
      chunks: [pngAtSize(MAX_BYTES + 1)],
      contentLength: 1
    });

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: createDestination().writable })
    );

    expect(error.code).toBe("REMOTE_IMAGE_TOO_LARGE");
  });

  it("rejects a Content-Length below the bytes actually written", async () => {
    const image = png([1, 2]);
    const error = await expectBodyError(processImage(image, "image/png", image.byteLength - 1));

    expect(error.code).toBe("REMOTE_IMAGE_LENGTH_MISMATCH");
  });

  it("rejects a Content-Length above the bytes actually written", async () => {
    const image = png([1, 2]);
    const error = await expectBodyError(processImage(image, "image/png", image.byteLength + 1));

    expect(error.code).toBe("REMOTE_IMAGE_LENGTH_MISMATCH");
  });

  it.each([
    ["negative", -1],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1]
  ])("rejects a defensive %s Content-Length", async (_name, contentLength) => {
    const fixture = createResult({ chunks: [png([1])], contentLength });
    const destination = createDestination();

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: destination.writable })
    );

    expect(error.code).toBe("REMOTE_IMAGE_LENGTH_MISMATCH");
    expect(fixture.cancelCalls()).toBe(1);
    expect(destination.writable.destroyed).toBe(true);
  });
});

describe("remote image body deadline and external abort", () => {
  it("cancels before starting when the external signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fixture = createResult({ chunks: [png([1])] });
    const destination = createDestination();

    const error = await expectBodyError(
      processRemoteImageBody({
        fetchResult: fixture.fetchResult,
        destination: destination.writable,
        signal: controller.signal
      })
    );

    expect(error.code).toBe("REMOTE_IMAGE_ABORTED");
    expect(fixture.cancelCalls()).toBe(1);
    expect(destination.writable.destroyed).toBe(true);
  });

  it("maps an in-progress external abort without leaking the pipeline abort", async () => {
    const controller = new AbortController();
    const stream = new PassThrough();
    const fixture = createResult({ stream });
    const destination = createDestination();
    const operation = processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: destination.writable,
      signal: controller.signal
    });

    stream.write(png([1]));
    controller.abort();

    const error = await expectBodyError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_ABORTED");
    expect(fixture.cancelCalls()).toBe(1);
  });

  it("times out a body that never ends", async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    const fixture = createResult({ stream });
    const operation = processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: createDestination().writable
    });
    const errorPromise = expectBodyError(operation);

    await vi.advanceTimersByTimeAsync(30_000);

    const error = await errorPromise;
    expect(error.code).toBe("REMOTE_IMAGE_BODY_TIMEOUT");
    expect(fixture.cancelCalls()).toBe(1);
  });

  it("times out after a partial body stalls", async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    const fixture = createResult({ stream });
    const operation = processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: createDestination().writable
    });
    const errorPromise = expectBodyError(operation);

    stream.write(Buffer.from(PNG_SIGNATURE.slice(0, 4)));
    await vi.advanceTimersByTimeAsync(30_000);

    const error = await errorPromise;
    expect(error.code).toBe("REMOTE_IMAGE_BODY_TIMEOUT");
  });

  it("prefers a timeout that fires before the final chunk", async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    const fixture = createResult({ stream });
    const operation = processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: createDestination().writable
    });
    const errorPromise = expectBodyError(operation);

    stream.write(png([1]));
    await vi.advanceTimersByTimeAsync(30_000);
    stream.end();

    const error = await errorPromise;
    expect(error.code).toBe("REMOTE_IMAGE_BODY_TIMEOUT");
  });
});

describe("remote image body stream and destination failures", () => {
  it("maps a source error to the fixed stream error", async () => {
    const source = new Readable({
      read() {
        this.destroy(new Error("source https://secret.example/?token=hidden 203.0.113.9"));
      }
    });
    const fixture = createResult({ stream: source });

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: createDestination().writable })
    );

    expect(error.code).toBe("REMOTE_IMAGE_STREAM_FAILED");
    expectSafeError(error);
  });

  it("maps a premature source close to the fixed stream error", async () => {
    const source = new Readable({
      read() {
        this.push(png([1]));
        this.destroy();
      }
    });
    const fixture = createResult({ stream: source });

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: createDestination().writable })
    );

    expect(error.code).toBe("REMOTE_IMAGE_STREAM_FAILED");
  });

  it("maps a destination error to the fixed destination error", async () => {
    const rawDestination = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("destination https://secret.example/?token=hidden 203.0.113.9"));
      }
    });
    const fixture = createResult({ chunks: [png([1])] });

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: rawDestination })
    );

    expect(error.code).toBe("REMOTE_IMAGE_DESTINATION_FAILED");
    expectSafeError(error);
  });

  it("keeps a validation error when destination teardown also errors", async () => {
    const rawDestination = new Writable({
      destroy(error, callback) {
        callback(error ?? new Error("destination teardown failed"));
      }
    });
    const fixture = createResult({ chunks: [Buffer.from("GIF89a")] });

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: rawDestination })
    );

    expect(error.code).toBe("REMOTE_IMAGE_MAGIC_UNSUPPORTED");
  });

  it("swallows a throwing cancellation callback", async () => {
    let cancelCalls = 0;
    const fixture = createResult({
      chunks: [pngAtSize(MAX_BYTES + 1)],
      onCancel: () => {
        cancelCalls += 1;
        throw new Error("cancel https://secret.example/?token=hidden");
      }
    });

    const error = await expectBodyError(
      processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: createDestination().writable })
    );

    expect(error.code).toBe("REMOTE_IMAGE_TOO_LARGE");
    expect(cancelCalls).toBe(1);
  });

  it("keeps cancellation safe when a second abort happens after a timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fixture = createResult({ stream: new PassThrough() });
    const operation = processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: createDestination().writable,
      signal: controller.signal
    });
    const errorPromise = expectBodyError(operation);

    await vi.advanceTimersByTimeAsync(30_000);
    controller.abort();

    const error = await errorPromise;
    expect(error.code).toBe("REMOTE_IMAGE_BODY_TIMEOUT");
    expect(fixture.cancelCalls()).toBe(1);
  });

  it("allows a result to be consumed only once and leaves the second destination empty", async () => {
    const image = png([1, 2]);
    const fixture = createResult({ chunks: [image], contentLength: image.byteLength });
    const firstDestination = createDestination();
    const secondDestination = createDestination();

    await processRemoteImageBody({
      fetchResult: fixture.fetchResult,
      destination: firstDestination.writable
    });
    const error = await expectBodyError(
      processRemoteImageBody({
        fetchResult: fixture.fetchResult,
        destination: secondDestination.writable
      })
    );

    expect(error.code).toBe("REMOTE_IMAGE_ALREADY_CONSUMED");
    expect(secondDestination.writtenSize()).toBe(0);
    expect(secondDestination.writable.destroyed).toBe(false);
  });
});

async function processImage(
  image: Uint8Array,
  contentType: string | null,
  contentLength: number | null = image.byteLength
): Promise<{ mimeType: string; sizeBytes: number; sha256: string }> {
  const fixture = createResult({ chunks: [image], contentType, contentLength });
  const destination = createDestination();

  return processRemoteImageBody({ fetchResult: fixture.fetchResult, destination: destination.writable });
}

function createResult(input: {
  chunks?: readonly Uint8Array[];
  stream?: Readable;
  contentType?: string | null;
  contentLength?: number | null;
  onCancel?: () => void;
}): { fetchResult: RemoteImageFetchResult; cancelCalls: () => number } {
  let cancelled = 0;
  const fetchResult: RemoteImageFetchResult = {
    stream: input.stream ?? Readable.from(input.chunks ?? [png([1])]),
    contentType: input.contentType === undefined ? "image/png" : input.contentType,
    contentLength: input.contentLength === undefined ? null : input.contentLength,
    finalHostname: "images.example.test",
    redirectCount: 0,
    sourceUrlHash: "a".repeat(64),
    cancel() {
      cancelled += 1;
      input.onCancel?.();
    }
  };

  return { fetchResult, cancelCalls: () => cancelled };
}

function createDestination(): {
  writable: Writable;
  writtenSize: () => number;
  bytes: () => Uint8Array;
} {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      const bytes: Uint8Array = chunk;
      chunks.push(bytes);
      size += bytes.byteLength;
      callback();
    }
  });

  return {
    writable,
    writtenSize: () => size,
    bytes: () => {
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    }
  };
}

function png(payload: readonly number[] = []): Buffer {
  return Buffer.from([...PNG_SIGNATURE, ...payload]);
}

function pngAtSize(size: number): Buffer {
  const image = Buffer.alloc(size);
  image.set(PNG_SIGNATURE, 0);
  return image;
}

function jpeg(payload: readonly number[] = []): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...payload]);
}

function webp(chunkType: "VP8 " | "VP8L" | "VP8X" | "BAD!", payload: readonly number[] = []): Buffer {
  const image = Buffer.alloc(16 + payload.length);
  image.write("RIFF", 0, "ascii");
  image.writeUInt32LE(image.byteLength - 8, 4);
  image.write("WEBP", 8, "ascii");
  image.write(chunkType, 12, "ascii");
  image.set(payload, 16);
  return image;
}

function riff(container: "WAVE", chunkType: "VP8 "): Buffer {
  const image = Buffer.alloc(16);
  image.write("RIFF", 0, "ascii");
  image.writeUInt32LE(image.byteLength - 8, 4);
  image.write(container, 8, "ascii");
  image.write(chunkType, 12, "ascii");
  return image;
}

async function expectBodyError(operation: Promise<unknown>): Promise<RemoteImageBodyError> {
  try {
    await operation;
    throw new Error("expected body processing to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteImageBodyError);
    return error as RemoteImageBodyError;
  }
}

function expectSafeError(error: RemoteImageBodyError): void {
  const output = `${String(error)}${JSON.stringify(error)}${error.stack?.split("\n", 1)[0] ?? ""}`;

  expect(output).not.toContain("https://secret.example");
  expect(output).not.toContain("token=hidden");
  expect(output).not.toContain("203.0.113.9");
}
