export const TRANSCRIPT_MAX_CODE_POINTS = 10_800;
export const TRANSCRIPT_MAX_CANDIDATE_SCENES = 6;
export const TRANSCRIPT_MAX_SELECTED_SCENES = 4;
export const TRANSCRIPT_BEAT_MAX_CODE_POINTS = 1_800;

export type TranscriptLocale = "zh-CN" | "en-US";

export type TranscriptSceneDraft = {
  id: string;
  sourceText: string;
  prompt: string;
  selected: boolean;
  entryId: string | null;
};

export type TranscriptSceneStatus =
  | "draft"
  | "queued"
  | "generating"
  | "checking"
  | "succeeded"
  | "failed";

export type TranscriptSceneView = TranscriptSceneDraft & {
  status: TranscriptSceneStatus;
  resultUrl: string | null;
  resultAssetId: string | null;
  error: string | null;
};

export function countTranscriptCodePoints(value: string) {
  return Array.from(value).length;
}

export function validateTranscriptInput(value: string):
  | "empty"
  | "too-long"
  | null {
  const normalized = value.trim();
  if (!normalized) {
    return "empty";
  }

  return countTranscriptCodePoints(normalized) > TRANSCRIPT_MAX_CODE_POINTS
    ? "too-long"
    : null;
}

function isSentenceBoundary(value: string | undefined) {
  return Boolean(value && /[。！？!?；;.!?]/u.test(value));
}

function isClosingPunctuation(value: string | undefined) {
  return Boolean(value && /[”’）】》」』"')\]]/u.test(value));
}

function splitParagraphIntoSentences(paragraph: string) {
  const codePoints = Array.from(paragraph);
  const sentences: string[] = [];
  let start = 0;

  for (let index = 0; index < codePoints.length; index += 1) {
    if (!isSentenceBoundary(codePoints[index])) {
      continue;
    }

    let end = index + 1;
    while (end < codePoints.length && isClosingPunctuation(codePoints[end])) {
      end += 1;
    }

    const sentence = codePoints.slice(start, end).join("").trim();
    if (sentence) {
      sentences.push(sentence);
    }
    start = end;
    index = end - 1;
  }

  const tail = codePoints.slice(start).join("").trim();
  if (tail) {
    sentences.push(tail);
  }

  return sentences;
}

function splitLongUnit(unit: string, maxCodePoints: number) {
  const codePoints = Array.from(unit);
  if (codePoints.length <= maxCodePoints) {
    return [unit.trim()];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < codePoints.length) {
    let end = Math.min(cursor + maxCodePoints, codePoints.length);

    if (end < codePoints.length) {
      for (let candidate = end; candidate > cursor + 80; candidate -= 1) {
        if (/[\s，、,。！？!?；;]/u.test(codePoints[candidate - 1] ?? "")) {
          end = candidate;
          break;
        }
      }
    }

    const chunk = codePoints.slice(cursor, end).join("").trim();
    if (chunk) {
      chunks.push(chunk);
    }
    cursor = end;
  }

  return chunks;
}

function hardSplitText(value: string, maxCodePoints: number) {
  const codePoints = Array.from(value);
  const scenes: string[] = [];

  for (let cursor = 0; cursor < codePoints.length; cursor += maxCodePoints) {
    const scene = codePoints
      .slice(cursor, cursor + maxCodePoints)
      .join("")
      .trim();
    if (scene) {
      scenes.push(scene);
    }
  }

  return scenes;
}

function mergeUnitsToSceneLimit(
  units: string[],
  maxScenes: number,
  maxCodePoints: number,
  normalizedTranscript: string
) {
  if (units.length <= maxScenes) {
    return units;
  }

  const preferredScenes: string[] = [];
  let bucket: string[] = [];
  let bucketLength = 0;

  for (const unit of units) {
    const unitLength = countTranscriptCodePoints(unit);
    const separatorLength = bucket.length > 0 ? 1 : 0;

    if (
      bucket.length > 0 &&
      bucketLength + separatorLength + unitLength > maxCodePoints
    ) {
      preferredScenes.push(bucket.join(" ").trim());
      bucket = [];
      bucketLength = 0;
    }

    bucket.push(unit);
    bucketLength += (bucket.length > 1 ? 1 : 0) + unitLength;
  }

  if (bucket.length > 0) {
    preferredScenes.push(bucket.join(" ").trim());
  }

  if (preferredScenes.length <= maxScenes) {
    return preferredScenes;
  }

  // If preferred boundaries would exceed the scene ceiling, hard-split the
  // normalized source. This preserves every non-whitespace code point and
  // is the only fallback needed to fit many small paragraphs into the bound.
  const preferredFallback = normalizedTranscript;
  const compactFallback =
    countTranscriptCodePoints(preferredFallback) <= maxScenes * maxCodePoints
      ? preferredFallback
      : units.join("");

  return hardSplitText(compactFallback, maxCodePoints);
}

export function segmentTranscript(
  input: string,
  options: {
    maxScenes?: number;
    maxBeatCodePoints?: number;
  } = {}
) {
  const normalized = input.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) {
    return [];
  }

  const maxScenes = Math.max(
    1,
    Math.min(options.maxScenes ?? TRANSCRIPT_MAX_CANDIDATE_SCENES, TRANSCRIPT_MAX_CANDIDATE_SCENES)
  );
  const maxBeatCodePoints = Math.max(
    1,
    options.maxBeatCodePoints ?? TRANSCRIPT_BEAT_MAX_CODE_POINTS
  );
  const paragraphs = normalized
    .split(/\n\s*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const units = paragraphs.flatMap((paragraph) =>
    countTranscriptCodePoints(paragraph) <= maxBeatCodePoints
      ? [paragraph]
      : splitParagraphIntoSentences(paragraph).flatMap((sentence) =>
          splitLongUnit(sentence, maxBeatCodePoints)
        )
  );

  return mergeUnitsToSceneLimit(
    units.length > 0 ? units : [normalized],
    maxScenes,
    maxBeatCodePoints,
    normalized
  );
}

export function compileTranscriptImagePrompt(
  sourceText: string,
  locale: TranscriptLocale
) {
  const content = sourceText.trim();
  if (locale === "zh-CN") {
    return [
      "根据下面这段口播内容生成一张适合作为视频配图的画面。",
      "用视觉画面表达含义，而不是把整段文字写进图片。",
      "不要添加字幕、段落、UI、海报或无关可读文字。",
      `内容：${content}`
    ].join("\n");
  }

  return [
    "Create a visual scene for the following spoken transcript segment, suitable as a video illustration.",
    "Express the meaning through imagery instead of writing the full text into the image.",
    "Do not add subtitles, paragraphs, UI, posters, or unrelated readable text.",
    `Content: ${content}`
  ].join("\n");
}
