import type {
  AiGenerationSize,
  ImageGenerationMode
} from "@ai-aggregate/shared";

export type ImageAspectRatio =
  | "auto"
  | "1:1"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "2:3"
  | "3:2";

export type ImageReferenceDimensions = Readonly<{
  width: number;
  height: number;
}>;

export const imageAspectRatios: readonly ImageAspectRatio[] = [
  "auto",
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "2:3",
  "3:2"
];

export const imageAspectRatioSizeMap: Readonly<
  Record<ImageAspectRatio, AiGenerationSize>
> = {
  auto: "1024x1024",
  "1:1": "1024x1024",
  "4:3": "1024x768",
  "3:4": "768x1024",
  "16:9": "1280x720",
  "9:16": "720x1280",
  "2:3": "768x1024",
  "3:2": "1280x720"
};

type SupportedImageAspectRatio = Exclude<ImageAspectRatio, "auto">;

const supportedPromptAspectRatios: Readonly<
  Record<string, SupportedImageAspectRatio>
> = {
  "1:1": "1:1",
  "4:3": "4:3",
  "3:4": "3:4",
  "16:9": "16:9",
  "9:16": "9:16",
  "2:3": "2:3",
  "3:2": "3:2"
};

function canonicalizePromptAspectRatio(
  widthText: string,
  heightText: string
): SupportedImageAspectRatio | null {
  const canonical = `${Number(widthText)}:${Number(heightText)}`;
  return supportedPromptAspectRatios[canonical] ?? null;
}

export function isImageAspectRatio(value: unknown): value is ImageAspectRatio {
  return (
    typeof value === "string" &&
    imageAspectRatios.includes(value as ImageAspectRatio)
  );
}

export function inferAspectRatioFromPrompt(
  prompt: string
): SupportedImageAspectRatio | null {
  const normalizedPrompt = prompt.normalize("NFKC").toLowerCase();
  const inferredRatios = new Set<SupportedImageAspectRatio>();

  if (normalizedPrompt.includes("正方形") || /\bsquare\b/.test(normalizedPrompt)) {
    inferredRatios.add("1:1");
  }

  const ratioPattern = /(?:^|[^0-9])([0-9]+)\s*[:/]\s*([0-9]+)(?![0-9])/g;
  let match: RegExpExecArray | null;

  while ((match = ratioPattern.exec(normalizedPrompt)) !== null) {
    const widthText = match[1];
    const heightText = match[2];

    if (!widthText || !heightText) {
      continue;
    }

    const ratio = canonicalizePromptAspectRatio(widthText, heightText);
    if (!ratio) {
      return null;
    }

    inferredRatios.add(ratio);
    if (inferredRatios.size > 1) {
      return null;
    }
  }

  return inferredRatios.size === 1
    ? inferredRatios.values().next().value ?? null
    : null;
}

function parseImageGenerationSize(
  size: AiGenerationSize
): ImageReferenceDimensions | null {
  const match = /^(\d+)x(\d+)$/.exec(size);
  const widthText = match?.[1];
  const heightText = match?.[2];

  if (!widthText || !heightText) {
    return null;
  }

  const width = Number(widthText);
  const height = Number(heightText);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return { width, height };
}

function isValidReferenceImageDimensions(
  dimensions: ImageReferenceDimensions | null | undefined
): dimensions is ImageReferenceDimensions {
  return (
    !!dimensions &&
    Number.isFinite(dimensions.width) &&
    Number.isFinite(dimensions.height) &&
    dimensions.width > 0 &&
    dimensions.height > 0
  );
}

export function resolveImageGenerationSize(
  aspectRatio: ImageAspectRatio,
  generationMode: ImageGenerationMode,
  referenceDimensions?: ImageReferenceDimensions | null,
  prompt = ""
): AiGenerationSize {
  if (aspectRatio !== "auto") {
    return imageAspectRatioSizeMap[aspectRatio];
  }

  if (
    generationMode === "image-to-image" &&
    isValidReferenceImageDimensions(referenceDimensions)
  ) {
    const referenceRatio = referenceDimensions.width / referenceDimensions.height;
    let bestSize = imageAspectRatioSizeMap.auto;
    let bestDifference = Number.POSITIVE_INFINITY;
    const candidateSizes = Array.from(
      new Set(
        imageAspectRatios
          .filter((ratio) => ratio !== "auto")
          .map((ratio) => imageAspectRatioSizeMap[ratio])
      )
    );

    for (const candidateSize of candidateSizes) {
      const candidateDimensions = parseImageGenerationSize(candidateSize);

      if (!candidateDimensions) {
        continue;
      }

      const candidateRatio = candidateDimensions.width / candidateDimensions.height;
      const difference = Math.abs(candidateRatio - referenceRatio);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestSize = candidateSize;
      }
    }

    return bestSize;
  }

  const inferredAspectRatio = inferAspectRatioFromPrompt(prompt);
  return inferredAspectRatio
    ? imageAspectRatioSizeMap[inferredAspectRatio]
    : imageAspectRatioSizeMap.auto;
}
