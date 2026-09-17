export type TitleCoverGeometryBucket = "LANDSCAPE" | "SQUARE" | "PORTRAIT";

export type TitleCoverTextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TitleCoverLayout = {
  bucket: TitleCoverGeometryBucket;
  safeMarginX: number;
  safeMarginY: number;
  mainTextBox: TitleCoverTextBox;
  secondaryTextBox: TitleCoverTextBox;
  mainMaxLines: number;
  secondaryMaxLines: number;
  scrimWidth: number;
  scrimDirection: "horizontal" | "vertical";
};

export type TitleCoverTextFit = {
  text: string;
  lines: string[];
  paragraphs: string[][];
  fontSize: number;
  lineHeightPx: number;
  overflow: boolean;
};

export const titleCoverFontFamily =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export const titleCoverMainFontWeight = 800;
export const titleCoverSecondaryFontWeight = 500;

export const titleCoverTypographyPresets = [
  "clean-light",
  "bold-yellow",
  "dark-editorial",
  "cyan-tech"
] as const;

export type TitleCoverTypographyPreset =
  (typeof titleCoverTypographyPresets)[number];

export type TitleCoverTypographyDraft = {
  preset: TitleCoverTypographyPreset;
  mainColor: string;
  secondaryColor: string;
  mainWeight: number;
  secondaryWeight: number;
  scrimStrength: number;
  mainShadowStrength: number;
  secondaryShadowStrength: number;
};

export type TitleCoverTypographyPresetDefinition = Omit<
  TitleCoverTypographyDraft,
  "preset"
>;

export const titleCoverTypographyPresetDefinitions: Readonly<
  Record<TitleCoverTypographyPreset, TitleCoverTypographyPresetDefinition>
> = {
  "clean-light": {
    mainColor: "#ffffff",
    secondaryColor: "#ffffff",
    mainWeight: titleCoverMainFontWeight,
    secondaryWeight: titleCoverSecondaryFontWeight,
    scrimStrength: 0.62,
    mainShadowStrength: 0.42,
    secondaryShadowStrength: 0.3
  },
  "bold-yellow": {
    mainColor: "#facc15",
    secondaryColor: "#ffffff",
    mainWeight: 900,
    secondaryWeight: 600,
    scrimStrength: 0.76,
    mainShadowStrength: 0.5,
    secondaryShadowStrength: 0.38
  },
  "dark-editorial": {
    mainColor: "#f8f1e7",
    secondaryColor: "#e7ded0",
    mainWeight: 700,
    secondaryWeight: 500,
    scrimStrength: 0.52,
    mainShadowStrength: 0.3,
    secondaryShadowStrength: 0.22
  },
  "cyan-tech": {
    mainColor: "#67e8f9",
    secondaryColor: "#e0f2fe",
    mainWeight: 800,
    secondaryWeight: 600,
    scrimStrength: 0.72,
    mainShadowStrength: 0.52,
    secondaryShadowStrength: 0.4
  }
};

export function createTitleCoverTypographyDraft(
  preset: TitleCoverTypographyPreset = "clean-light"
): TitleCoverTypographyDraft {
  return {
    preset,
    ...titleCoverTypographyPresetDefinitions[preset]
  };
}

export const defaultTitleCoverTypographyDraft =
  createTitleCoverTypographyDraft();

export type TitleCoverCanvasDimensions = {
  width: number;
  height: number;
};

export type TitleCoverCoverCrop = {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function parseTitleCoverCanvasDimensions(
  value: string
): TitleCoverCanvasDimensions | null {
  const match = /^(\d+)x(\d+)$/u.exec(value.trim());
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return { width, height };
}

export function calculateTitleCoverCoverCrop({
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight
}: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
}): TitleCoverCoverCrop {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error("INVALID_TITLE_COVER_CROP_DIMENSIONS");
  }

  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    scale,
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height
  };
}

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveTitleCoverGeometryBucket(
  sourceWidth: number,
  sourceHeight: number
): TitleCoverGeometryBucket {
  const width = finitePositive(sourceWidth, 1);
  const height = finitePositive(sourceHeight, 1);
  const ratio = width / height;

  if (ratio > 1.05) return "LANDSCAPE";
  if (ratio < 0.95) return "PORTRAIT";
  return "SQUARE";
}

export function calculateTitleCoverLayout(
  sourceWidth: number,
  sourceHeight: number
): TitleCoverLayout {
  const width = finitePositive(sourceWidth, 1);
  const height = finitePositive(sourceHeight, 1);
  const bucket = resolveTitleCoverGeometryBucket(width, height);

  if (bucket === "LANDSCAPE") {
    const safeMarginX = width * 0.075;
    const safeMarginY = height * 0.075;
    return {
      bucket,
      safeMarginX,
      safeMarginY,
      mainTextBox: {
        x: safeMarginX,
        y: height * 0.27,
        width: width * 0.45,
        height: height * 0.35
      },
      secondaryTextBox: {
        x: safeMarginX,
        y: height * 0.68,
        width: width * 0.43,
        height: height * 0.15
      },
      mainMaxLines: 5,
      secondaryMaxLines: 3,
      scrimWidth: width * 0.67,
      scrimDirection: "horizontal"
    };
  }

  if (bucket === "SQUARE") {
    const safeMarginX = width * 0.08;
    const safeMarginY = height * 0.08;
    return {
      bucket,
      safeMarginX,
      safeMarginY,
      mainTextBox: {
        x: safeMarginX,
        y: height * 0.16,
        width: width * 0.76,
        height: height * 0.43
      },
      secondaryTextBox: {
        x: safeMarginX,
        y: height * 0.68,
        width: width * 0.72,
        height: height * 0.16
      },
      mainMaxLines: 6,
      secondaryMaxLines: 3,
      scrimWidth: height * 0.76,
      scrimDirection: "vertical"
    };
  }

  const safeMarginX = width * 0.08;
  const safeMarginY = height * 0.08;
  return {
    bucket,
    safeMarginX,
    safeMarginY,
    mainTextBox: {
      x: safeMarginX,
      y: height * 0.1,
      width: width * 0.84,
      height: height * 0.43
    },
    secondaryTextBox: {
      x: safeMarginX,
      y: height * 0.59,
      width: width * 0.8,
      height: height * 0.17
    },
    mainMaxLines: 7,
    secondaryMaxLines: 3,
    scrimWidth: height * 0.78,
    scrimDirection: "vertical"
  };
}

export function normalizeTitleCoverLineBreaks(value: string) {
  return value.replace(/\r\n?/gu, "\n");
}

type TextMeasurementContext = Pick<CanvasRenderingContext2D, "measureText" | "font">;

function wrapParagraph(
  context: TextMeasurementContext,
  paragraph: string,
  maxWidth: number
) {
  if (paragraph.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(paragraph)) {
    const candidate = `${current}${character}`;
    if (current.length > 0 && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function setTextFont(
  context: TextMeasurementContext,
  fontFamily: string,
  fontWeight: number | string,
  fontSize: number
) {
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
}

export function fitTitleCoverText({
  context,
  text,
  canvasWidth,
  canvasHeight,
  textBox,
  fontFamily,
  fontWeight,
  maxFontSize,
  minFontSize,
  lineHeight,
  maxLines
}: {
  context: TextMeasurementContext;
  text: string;
  canvasWidth: number;
  canvasHeight: number;
  textBox: TitleCoverTextBox;
  fontFamily: string;
  fontWeight: number | string;
  maxFontSize: number;
  minFontSize: number;
  lineHeight: number;
  maxLines: number;
}): TitleCoverTextFit {
  const normalizedText = normalizeTitleCoverLineBreaks(text);
  const width = Math.max(1, Math.min(finitePositive(canvasWidth, 1), textBox.width));
  const height = Math.max(1, Math.min(finitePositive(canvasHeight, 1), textBox.height));
  const boundedMinFontSize = Math.max(1, Math.floor(finitePositive(minFontSize, 1)));
  const boundedMaxFontSize = Math.max(
    boundedMinFontSize,
    Math.floor(finitePositive(maxFontSize, boundedMinFontSize))
  );
  const boundedLineHeight = Math.max(1, finitePositive(lineHeight, 1.15));
  const boundedMaxLines = Math.max(1, Math.floor(finitePositive(maxLines, 1)));

  function evaluate(fontSize: number): TitleCoverTextFit {
    setTextFont(context, fontFamily, fontWeight, fontSize);
    const paragraphs = normalizedText
      .split("\n")
      .map((paragraph) => wrapParagraph(context, paragraph, width));
    const lines = paragraphs.flat();
    const lineHeightPx = fontSize * boundedLineHeight;
    const fits =
      lines.length <= boundedMaxLines &&
      lines.every((line) => context.measureText(line).width <= width) &&
      lineHeightPx * lines.length <= height;

    return {
      text: normalizedText,
      lines,
      paragraphs,
      fontSize,
      lineHeightPx,
      overflow: !fits
    };
  }

  const maximum = evaluate(boundedMaxFontSize);
  if (!maximum.overflow) {
    return maximum;
  }

  const minimum = evaluate(boundedMinFontSize);
  if (minimum.overflow) {
    return minimum;
  }

  let low = boundedMinFontSize;
  let high = boundedMaxFontSize;
  let best = minimum;

  for (let iteration = 0; iteration < 12 && low <= high; iteration += 1) {
    const middle = Math.floor((low + high) / 2);
    const candidate = evaluate(middle);
    if (candidate.overflow) {
      high = middle - 1;
    } else {
      best = candidate;
      low = middle + 1;
    }
  }

  return best;
}

export function getTitleCoverFontSizeBounds(
  layout: TitleCoverLayout,
  canvasWidth: number,
  canvasHeight: number
) {
  const shortestSide = Math.min(
    finitePositive(canvasWidth, 1),
    finitePositive(canvasHeight, 1)
  );
  const mainMaxFontSize = Math.max(
    24,
    Math.round(shortestSide * (layout.bucket === "PORTRAIT" ? 0.105 : 0.1))
  );
  const secondaryMaxFontSize = Math.max(16, Math.round(shortestSide * 0.038));

  return {
    main: { maxFontSize: mainMaxFontSize, minFontSize: 18 },
    secondary: { maxFontSize: secondaryMaxFontSize, minFontSize: 12 }
  };
}

export function buildTitleCoverDownloadFilename(
  preferredName: string,
  fallbackName = "title-cover",
  maxLength = 80
) {
  const sanitize = (value: string) =>
    normalizeTitleCoverLineBreaks(value)
      .replace(/[\\/:*?"<>|]/gu, "")
      .replace(/[\u0000-\u001f\u007f]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  const boundedLength = Math.max(1, Math.floor(maxLength));
  const sanitizedName = sanitize(preferredName) || sanitize(fallbackName);
  const nameWithoutPng = sanitizedName.replace(/\.png$/iu, "");
  const base = Array.from(nameWithoutPng)
    .slice(0, boundedLength)
    .join("")
    .trim() || "title-cover";

  return `${base}.png`;
}
