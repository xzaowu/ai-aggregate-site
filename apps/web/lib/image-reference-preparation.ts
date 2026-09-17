export const maxReferenceImageOriginalBytes = 5 * 1024 * 1024;
export const maxReferenceImageCompressedBytes = 1 * 1024 * 1024;
export const targetReferenceImageCompressedBytes = 900 * 1024;
export const referenceImageMaxSide = 1024;
export const referenceImageInitialQuality = 0.82;
export const referenceImageMinimumQuality = 0.7;
export const imageReferencePreparationTimeoutMs = 15_000;

const supportedReferenceImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

export type ReferenceImageCompressionState =
  | { status: "idle" }
  | { status: "compressing" }
  | { status: "compressed"; originalBytes: number; compressedBytes: number }
  | { status: "too-large-original" }
  | { status: "too-large-compressed" }
  | { status: "failed" };

export type ReferenceImageFileValidation =
  | { valid: true }
  | {
      valid: false;
      errorKey:
        | "multimodal.error.referenceImageUnsupported"
        | "multimodal.error.referenceImageOriginalTooLarge";
      state: ReferenceImageCompressionState;
    };

export type CompressedImageReference = Readonly<{
  dataUrl: string;
  compressedBytes: number;
  sourceWidth: number;
  sourceHeight: number;
}>;

export class ImageReferencePreparationTimeoutError extends Error {
  constructor() {
    super("reference preparation timed out");
    this.name = "ImageReferencePreparationTimeoutError";
  }
}

export function normalizeImageReferenceMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isSupportedImageReferenceMimeType(value: string): boolean {
  return supportedReferenceImageTypes.has(normalizeImageReferenceMimeType(value));
}

export function validateReferenceImageFile(
  file: Blob
): ReferenceImageFileValidation {
  if (!isSupportedImageReferenceMimeType(file.type)) {
    return {
      valid: false,
      errorKey: "multimodal.error.referenceImageUnsupported",
      state: { status: "idle" }
    };
  }

  if (file.size > maxReferenceImageOriginalBytes) {
    return {
      valid: false,
      errorKey: "multimodal.error.referenceImageOriginalTooLarge",
      state: { status: "too-large-original" }
    };
  }

  return { valid: true };
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = dataUrl;
  });
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("file read failed"));
      }
    };
    reader.onerror = () => reject(new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

export async function compressReferenceImage(
  file: Blob
): Promise<CompressedImageReference> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(originalDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error("invalid image dimensions");
  }

  const scale = Math.min(
    1,
    referenceImageMaxSide / Math.max(sourceWidth, sourceHeight)
  );
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("canvas unavailable");
  }

  context.drawImage(image, 0, 0, width, height);

  let bestDataUrl = "";
  let bestBytes = Number.POSITIVE_INFINITY;

  for (
    let quality = referenceImageInitialQuality;
    quality >= referenceImageMinimumQuality;
    quality = Number((quality - 0.04).toFixed(2))
  ) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const bytes = estimateDataUrlBytes(dataUrl);

    bestDataUrl = dataUrl;
    bestBytes = bytes;

    if (bytes <= targetReferenceImageCompressedBytes) {
      break;
    }
  }

  return {
    dataUrl: bestDataUrl,
    compressedBytes: bestBytes,
    sourceWidth,
    sourceHeight
  };
}

export function isCompressedImageReferenceUsable(
  reference: Pick<CompressedImageReference, "dataUrl" | "compressedBytes">
): boolean {
  return (
    reference.dataUrl.length > 0 &&
    reference.compressedBytes <= maxReferenceImageCompressedBytes
  );
}

export async function withImageReferencePreparationTimeout<T>(
  operation: Promise<T>,
  controller: AbortController
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort();
      reject(new ImageReferencePreparationTimeoutError());
    }, imageReferencePreparationTimeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
