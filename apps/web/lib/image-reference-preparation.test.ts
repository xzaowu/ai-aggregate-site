// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compressReferenceImage,
  estimateDataUrlBytes,
  imageReferencePreparationTimeoutMs,
  ImageReferencePreparationTimeoutError,
  isCompressedImageReferenceUsable,
  isSupportedImageReferenceMimeType,
  maxReferenceImageCompressedBytes,
  maxReferenceImageOriginalBytes,
  validateReferenceImageFile,
  withImageReferencePreparationTimeout
} from "./image-reference-preparation";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function installCompressionBrowser(options?: {
  sourceWidth?: number;
  sourceHeight?: number;
  dataUrl?: string;
  contextAvailable?: boolean;
}) {
  const sourceWidth = options?.sourceWidth ?? 2400;
  const sourceHeight = options?.sourceHeight ?? 1200;

  class FakeFileReader {
    result: string | ArrayBuffer | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL() {
      this.result = "data:image/png;base64,aW1hZ2U=";
      this.onload?.({} as ProgressEvent<FileReader>);
    }
  }

  class FakeImage {
    naturalWidth = sourceWidth;
    naturalHeight = sourceHeight;
    width = sourceWidth;
    height = sourceHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      this.onload?.();
    }
  }

  const drawImage = vi.fn();
  const toDataURL = vi.fn((_type?: string, _quality?: number) =>
    options?.dataUrl ?? "data:image/jpeg;base64,aW1hZ2U="
  );
  const createElement = document.createElement.bind(document);
  vi.stubGlobal("FileReader", FakeFileReader);
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName !== "canvas") {
      return createElement(tagName);
    }
    return {
      width: 0,
      height: 0,
      getContext: () =>
        options?.contextAvailable === false ? null : { drawImage },
      toDataURL
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);

  return { drawImage, toDataURL };
}

describe("shared image reference preprocessing", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])(
    "accepts %s references",
    (mimeType) => {
      const blob = new Blob(["image"], { type: mimeType });
      expect(isSupportedImageReferenceMimeType(mimeType)).toBe(true);
      expect(validateReferenceImageFile(blob)).toEqual({ valid: true });
    }
  );

  it("normalizes MIME parameters but rejects unsupported media", () => {
    expect(isSupportedImageReferenceMimeType("IMAGE/JPEG; charset=binary")).toBe(true);
    expect(
      validateReferenceImageFile(new Blob(["image"], { type: "image/gif" }))
    ).toEqual({
      valid: false,
      errorKey: "multimodal.error.referenceImageUnsupported",
      state: { status: "idle" }
    });
  });

  it("rejects originals larger than 5 MB", () => {
    const blob = new Blob([new Uint8Array(maxReferenceImageOriginalBytes + 1)], {
      type: "image/png"
    });
    expect(validateReferenceImageFile(blob)).toEqual({
      valid: false,
      errorKey: "multimodal.error.referenceImageOriginalTooLarge",
      state: { status: "too-large-original" }
    });
  });

  it("downscales the maximum side and returns JPEG metadata", async () => {
    const { drawImage, toDataURL } = installCompressionBrowser();
    const result = await compressReferenceImage(
      new Blob(["image"], { type: "image/png" })
    );

    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.compressedBytes).toBe(estimateDataUrlBytes(result.dataUrl));
    expect(result).toMatchObject({ sourceWidth: 2400, sourceHeight: 1200 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.82);
    expect(isCompressedImageReferenceUsable(result)).toBe(true);
  });

  it("steps JPEG quality down to 0.70 and reports a hard-limit miss", async () => {
    const oversizedBase64 = "a".repeat(
      Math.ceil(((maxReferenceImageCompressedBytes + 1) * 4) / 3)
    );
    const { toDataURL } = installCompressionBrowser({
      dataUrl: `data:image/jpeg;base64,${oversizedBase64}`
    });
    const result = await compressReferenceImage(
      new Blob(["image"], { type: "image/webp" })
    );

    expect(toDataURL.mock.calls.map((call) => call[1])).toEqual([
      0.82,
      0.78,
      0.74,
      0.7
    ]);
    expect(result.compressedBytes).toBeGreaterThan(maxReferenceImageCompressedBytes);
    expect(isCompressedImageReferenceUsable(result)).toBe(false);
  });

  it("fails safely when decoded dimensions or Canvas are unusable", async () => {
    installCompressionBrowser({ sourceWidth: 0, sourceHeight: 0 });
    await expect(
      compressReferenceImage(new Blob(["image"], { type: "image/png" }))
    ).rejects.toThrow("invalid image dimensions");

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    installCompressionBrowser({ contextAvailable: false });
    await expect(
      compressReferenceImage(new Blob(["image"], { type: "image/png" }))
    ).rejects.toThrow("canvas unavailable");
  });

  it("aborts and rejects preprocessing that exceeds the existing timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = withImageReferencePreparationTimeout(
      new Promise<never>(() => undefined),
      controller
    );
    const expectation = expect(request).rejects.toBeInstanceOf(
      ImageReferencePreparationTimeoutError
    );

    await vi.advanceTimersByTimeAsync(imageReferencePreparationTimeoutMs);
    await expectation;
    expect(controller.signal.aborted).toBe(true);
  });
});
