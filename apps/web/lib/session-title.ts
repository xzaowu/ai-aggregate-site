const chineseLowInfoPrefixes = [
  /^请帮我[：:\s]*/,
  /^帮我[：:\s]*/,
  /^我想[：:\s]*/,
  /^请问[：:\s]*/,
  /^能不能[：:\s]*/,
  /^你可以[：:\s]*/,
  /^请[：:\s]*/,
];

const englishLowInfoPrefixes = [
  /^please\s+help\s+me[,:.]*\s*/i,
  /^can\s+you[,:.]*\s*/i,
  /^i\s+want\s+to[,:.]*\s*/i,
  /^could\s+you[,:.]*\s*/i,
  /^would\s+you[,:.]*\s*/i,
  /^please[,:.]*\s*/i,
];

const chineseFallback = "新会话";
const englishFallback = "New chat";

const imageChineseFallback = "图像创作";
const imageEnglishFallback = "Image creation";

function stripMarkdown(input: string): string {
  return (
    input
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]+`/g, "")
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s+/gm, "")
      .replace(/^[-*_]{3,}\s*$/gm, "")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
  );
}

function stripMeaninglessSymbols(text: string): string {
  return (
    text
      .replace(
        /[\x00-\x1F\x7F\u200B-\u200D\uFEFF\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9FFF\uF900-\uFAFF\u4E00-\u9FFF]/.test(text);
}

function extractFirstSentenceChinese(text: string): string {
  const sentences = text
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences[0] ?? "";
}

function extractFirstSentenceEnglish(text: string): string {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences[0] ?? "";
}

function stripChineseLowInfoPrefix(text: string): string {
  for (const prefix of chineseLowInfoPrefixes) {
    const stripped = text.replace(prefix, "").trim();
    if (stripped !== text) {
      return stripped;
    }
  }
  return text;
}

function stripEnglishLowInfoPrefix(text: string): string {
  for (const prefix of englishLowInfoPrefixes) {
    const stripped = text.replace(prefix, "").trim();
    if (stripped !== text) {
      return stripped;
    }
  }
  return text;
}

/**
 * Truncate Chinese text to target 8-18 characters, preferring natural break points.
 */
function truncateChinese(text: string): string {
  if (text.length <= 18) {
    return text;
  }

  const breakPoints = [
    ...text.matchAll(/[，,、；;：:\s]+/g),
    ...text.matchAll(/[。！？!?.]+/g),
  ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const match of breakPoints) {
    const idx = match.index ?? 0;
    if (idx >= 8 && idx <= 18) {
      return text.slice(0, idx).trim();
    }
  }

  return text.slice(0, 18).trim();
}

/**
 * Truncate English text to 3-8 words.
 */
function truncateEnglish(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 8) {
    return text;
  }

  const targetWords = Math.min(8, Math.max(3, Math.ceil(words.length / 2)));
  return words.slice(0, targetWords).join(" ");
}

function generateChineseTitle(content: string): string {
  let text = stripMarkdown(content);
  text = stripMeaninglessSymbols(text);
  if (!text) {
    return "";
  }

  text = extractFirstSentenceChinese(text);
  text = stripMeaninglessSymbols(text);
  if (!text) {
    return "";
  }

  text = stripChineseLowInfoPrefix(text);
  if (!text) {
    return "";
  }

  text = truncateChinese(text);

  return text || "";
}

function generateEnglishTitle(content: string): string {
  let text = stripMarkdown(content);
  text = stripMeaninglessSymbols(text);
  if (!text) {
    return "";
  }

  text = extractFirstSentenceEnglish(text);
  text = stripMeaninglessSymbols(text);
  if (!text) {
    return "";
  }

  text = stripEnglishLowInfoPrefix(text);
  if (!text) {
    return "";
  }

  text = truncateEnglish(text);

  return text || "";
}

export function generateSessionTitle(
  content: string
): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  if (hasCjk(trimmed)) {
    return generateChineseTitle(trimmed);
  }

  return generateEnglishTitle(trimmed);
}

export function generateImageSessionTitle(
  content: string,
  locale: string
): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return locale === "zh-CN" ? imageChineseFallback : imageEnglishFallback;
  }

  const result = generateSessionTitle(trimmed);
  if (!result) {
    return locale === "zh-CN" ? imageChineseFallback : imageEnglishFallback;
  }

  return result;
}

export function getChatSessionTitleFallback(locale: string): string {
  return locale === "zh-CN" ? chineseFallback : englishFallback;
}

export function getImageSessionTitleFallback(locale: string): string {
  return locale === "zh-CN" ? imageChineseFallback : imageEnglishFallback;
}

export function isDefaultSessionTitle(
  title: string,
  locale: string
): boolean {
  const chatFallback = getChatSessionTitleFallback(locale);
  if (title === chatFallback) {
    return true;
  }

  if (hasCjk(title)) {
    return title.length > 20;
  }
  return title.length > 40;
}

export function shouldRegenerateTitle(
  title: string | undefined | null,
  locale: string
): boolean {
  if (!title || title.trim().length === 0) {
    return true;
  }
  return isDefaultSessionTitle(title, locale);
}

function stripForNav(input: string): string {
  return (
    input
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]+`/g, " ")
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s+/gm, "")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[，,。！？!?、；;：:]+$/, "")
      .trim()
  );
}

function stripNavLowInfoPrefix(text: string): string {
  for (const prefix of chineseLowInfoPrefixes) {
    const stripped = text.replace(prefix, "").trim();
    if (stripped !== text) {
      return stripped;
    }
  }
  for (const prefix of englishLowInfoPrefixes) {
    const stripped = text.replace(prefix, "").trim();
    if (stripped !== text) {
      return stripped;
    }
  }
  return text;
}

function truncateNav(text: string): string {
  if (hasCjk(text)) {
    if (text.length <= 22) return text;
    return text.slice(0, 22).trim() + "…";
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 10) return text;
  return words.slice(0, 10).join(" ") + "…";
}

export function generateUserMessageNavTitle(
  content: string,
  index: number
): string {
  let text = stripForNav(content);
  text = stripMeaninglessSymbols(text);
  if (!text) {
    text = `${index}`;
  }

  text = stripNavLowInfoPrefix(text);
  if (!text) {
    text = `${index}`;
  }

  text = truncateNav(text);

  return text || `${index}`;
}
