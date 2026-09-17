const avatarMaxSide = 800;
const avatarMaxBytes = 2 * 1024 * 1024;
const avatarTargetMinBytes = 500 * 1024;
const avatarTargetMaxBytes = 800 * 1024;
const avatarSizeTriggerBytes = 700 * 1024;

const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1];
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = dataUrl;
  });
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("file read failed"));
    reader.onerror = () => reject(new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

export interface CompressImageResult {
  dataUrl: string;
  compressedBytes: number;
}

export interface PrepareAvatarResult {
  dataUrl: string;
  originalBytes: number;
  outputBytes: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  compressed: boolean;
  outputMimeType: string;
}

export function shouldCompressImage(file: File): boolean {
  if (!allowedMimeTypes.has(file.type)) return false;
  if (file.size > avatarSizeTriggerBytes) return true;
  return false;
}

function needsDimensionCompress(originalWidth: number, originalHeight: number): boolean {
  const maxDimension = Math.max(originalWidth, originalHeight);
  return maxDimension > avatarMaxSide;
}

function estimateBase64JsonBodySize(dataUrlLength: number): number {
  return dataUrlLength + 256;
}

function needsSizeCompressForBody(dataUrlLength: number): boolean {
  const estimatedBody = estimateBase64JsonBodySize(dataUrlLength);
  return estimatedBody > 3 * 1024 * 1024;
}

export function shouldPrepareImage(file: File): boolean {
  if (!allowedMimeTypes.has(file.type)) return false;
  return shouldCompressImage(file) || true;
}

async function canvasCompress(
  img: HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  mimeType: string,
  hasTransparency: boolean
): Promise<CompressImageResult> {
  const scale = Math.min(1, avatarMaxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  if (hasTransparency) {
    const pngDataUrl = canvas.toDataURL("image/png");
    const pngBytes = estimateDataUrlBytes(pngDataUrl);
    if (pngBytes <= avatarMaxBytes) {
      return { dataUrl: pngDataUrl, compressedBytes: pngBytes };
    }

    let bestWebP = "";
    let bestWebPBytes = Number.POSITIVE_INFINITY;
    try {
      for (let q = 0.82; q >= 0.6; q = Number((q - 0.04).toFixed(2))) {
        const webp = canvas.toDataURL("image/webp", q);
        const bytes = estimateDataUrlBytes(webp);
        if (bytes < bestWebPBytes) { bestWebP = webp; bestWebPBytes = bytes; }
        if (bytes <= avatarTargetMaxBytes) break;
      }
      if (bestWebP && bestWebPBytes <= avatarMaxBytes) {
        return { dataUrl: bestWebP, compressedBytes: bestWebPBytes };
      }
    } catch {
      // WebP not supported, fall through to JPEG
    }
  }

  let bestDataUrl = "";
  let bestBytes = Number.POSITIVE_INFINITY;

  for (
    let quality = 0.82;
    quality >= 0.4;
    quality = Number((quality - 0.04).toFixed(2))
  ) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const bytes = estimateDataUrlBytes(dataUrl);
    bestDataUrl = dataUrl;
    bestBytes = bytes;
    if (bytes <= avatarTargetMaxBytes) break;
  }

  return { dataUrl: bestDataUrl, compressedBytes: bestBytes };
}

export async function compressImageForUpload(file: File): Promise<CompressImageResult> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const img = await loadImageFromDataUrl(originalDataUrl);

  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;

  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error("invalid image dimensions");
  }

  const hasTransparency = file.type === "image/png" || file.type === "image/webp";
  return canvasCompress(img, sourceWidth, sourceHeight, file.type, hasTransparency);
}

export async function prepareAvatarImage(file: File): Promise<PrepareAvatarResult> {
  if (!allowedMimeTypes.has(file.type)) {
    throw new Error("unsupported image type");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const originalBytes = file.size;
  const img = await loadImageFromDataUrl(originalDataUrl);

  const originalWidth = img.naturalWidth || img.width;
  const originalHeight = img.naturalHeight || img.height;

  if (
    !Number.isFinite(originalWidth) ||
    !Number.isFinite(originalHeight) ||
    originalWidth <= 0 ||
    originalHeight <= 0
  ) {
    throw new Error("invalid image dimensions");
  }

  const overSizeLimit = file.size > avatarSizeTriggerBytes;
  const overDimensionLimit = needsDimensionCompress(originalWidth, originalHeight);
  const overBodyEstimate = needsSizeCompressForBody(originalDataUrl.length);

  const shouldCompress = overSizeLimit || overDimensionLimit || overBodyEstimate;

  const isSmall =
    file.size < avatarSizeTriggerBytes &&
    Math.max(originalWidth, originalHeight) <= avatarMaxSide &&
    allowedMimeTypes.has(file.type);

  if (!shouldCompress && isSmall) {
    return {
      dataUrl: originalDataUrl,
      originalBytes,
      outputBytes: originalBytes,
      originalWidth,
      originalHeight,
      outputWidth: originalWidth,
      outputHeight: originalHeight,
      compressed: false,
      outputMimeType: file.type
    };
  }

  const hasTransparency = file.type === "image/png" || file.type === "image/webp";
  const { dataUrl, compressedBytes } = await canvasCompress(
    img, originalWidth, originalHeight, file.type, hasTransparency
  );

  if (compressedBytes > avatarMaxBytes) {
    throw new Error("image too large even after compression");
  }

  const outputImg = await loadImageFromDataUrl(dataUrl);
  const outputWidth = outputImg.naturalWidth || outputImg.width;
  const outputHeight = outputImg.naturalHeight || outputImg.height;

  let outputMimeType = file.type;
  if (dataUrl.startsWith("data:image/webp")) outputMimeType = "image/webp";
  else if (dataUrl.startsWith("data:image/jpeg")) outputMimeType = "image/jpeg";
  else if (dataUrl.startsWith("data:image/png")) outputMimeType = "image/png";

  return {
    dataUrl,
    originalBytes,
    outputBytes: compressedBytes,
    originalWidth,
    originalHeight,
    outputWidth,
    outputHeight,
    compressed: true,
    outputMimeType
  };
}

export { avatarMaxBytes, avatarMaxSide, avatarSizeTriggerBytes };
