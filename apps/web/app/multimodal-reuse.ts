import type {
  AiAssetSummary,
  AiGenerationCount,
  AiGenerationSize,
  AiTaskSummary,
  ImageGenerationMode
} from "@ai-aggregate/shared";
import {
  aiGenerationCounts,
  aiGenerationSizes,
  imageGenerationModes
} from "@ai-aggregate/shared";

export interface SafeReferenceImageMetadata {
  name: string | null;
  mimeType: string | null;
  originalBytes: number | null;
  compressedBytes: number | null;
}

export interface ImageReuseParams {
  prompt: string;
  mode: ImageGenerationMode;
  modelId: string | null;
  size: AiGenerationSize | null;
  count: AiGenerationCount;
  referenceImages: SafeReferenceImageMetadata[];
  referenceImage: SafeReferenceImageMetadata | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function readMode(value: unknown): ImageGenerationMode | null {
  return imageGenerationModes.includes(value as ImageGenerationMode)
    ? (value as ImageGenerationMode)
    : null;
}

function readSize(value: unknown): AiGenerationSize | null {
  return aiGenerationSizes.includes(value as AiGenerationSize)
    ? (value as AiGenerationSize)
    : null;
}

function readCount(value: unknown): AiGenerationCount | null {
  return aiGenerationCounts.includes(value as AiGenerationCount)
    ? (value as AiGenerationCount)
    : null;
}

export function readReferenceImageMetadata(
  value: unknown
): SafeReferenceImageMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    name: readString(value.name),
    mimeType: readString(value.mimeType),
    originalBytes: readPositiveNumber(value.originalBytes),
    compressedBytes: readPositiveNumber(value.compressedBytes)
  };
}

export function readReferenceImagesMetadata(
  pluralValue: unknown,
  scalarValue: unknown
): SafeReferenceImageMetadata[] {
  if (Array.isArray(pluralValue)) {
    const references = pluralValue
      .map((value) => readReferenceImageMetadata(value))
      .filter(
        (value): value is SafeReferenceImageMetadata => value !== null
      );
    if (references.length > 0) {
      return references;
    }
  }

  const scalar = readReferenceImageMetadata(scalarValue);
  return scalar ? [scalar] : [];
}

export function getTaskReuseParams(task: AiTaskSummary): ImageReuseParams {
  const input = task.input;
  const output = task.output ?? {};
  const mode = readMode(input.mode) ?? readMode(output.mode) ?? "text-to-image";

  const referenceImages = readReferenceImagesMetadata(
    input.referenceImages,
    input.referenceImage
  );

  return {
    prompt: task.prompt,
    mode,
    modelId: task.modelId ?? readString(input.modelId),
    size: readSize(input.size) ?? readSize(output.size),
    count: readCount(input.count) ?? readCount(output.count) ?? 1,
    referenceImages,
    referenceImage: referenceImages[0] ?? null
  };
}

export function getAssetReuseParams(
  asset: AiAssetSummary,
  task: AiTaskSummary | null
): ImageReuseParams {
  const metadata = asset.metadata ?? {};
  const taskParams = task ? getTaskReuseParams(task) : null;
  const mode =
    readMode(metadata.mode) ?? taskParams?.mode ?? "text-to-image";

  const metadataReferences = readReferenceImagesMetadata(
    metadata.referenceImages,
    metadata.referenceImage
  );
  const referenceImages =
    metadataReferences.length > 0
      ? metadataReferences
      : taskParams?.referenceImages ?? [];

  return {
    prompt: asset.taskPrompt ?? taskParams?.prompt ?? asset.title ?? "",
    mode,
    modelId: readString(metadata.modelId) ?? taskParams?.modelId ?? null,
    size: readSize(metadata.size) ?? taskParams?.size ?? null,
    count: readCount(metadata.count) ?? taskParams?.count ?? 1,
    referenceImages,
    referenceImage: referenceImages[0] ?? null
  };
}

export function formatMetadataBytes(value: number | null): string {
  if (!value) {
    return "-";
  }

  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}
