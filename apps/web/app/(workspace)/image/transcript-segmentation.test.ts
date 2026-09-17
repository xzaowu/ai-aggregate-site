import { describe, expect, it } from "vitest";
import {
  TRANSCRIPT_BEAT_MAX_CODE_POINTS,
  TRANSCRIPT_MAX_CANDIDATE_SCENES,
  TRANSCRIPT_MAX_CODE_POINTS,
  compileTranscriptImagePrompt,
  countTranscriptCodePoints,
  segmentTranscript,
  validateTranscriptInput
} from "./transcript-segmentation";

describe("transcript segmentation", () => {
  it("uses blank-line paragraphs and Chinese sentence punctuation", () => {
    expect(
      segmentTranscript("第一段先介绍问题。然后给出一个例子。\n\n第二段收束观点！")
    ).toEqual(["第一段先介绍问题。然后给出一个例子。", "第二段收束观点！"]);
  });

  it("segments English paragraphs without requiring an NLP dependency", () => {
    expect(
      segmentTranscript("The first beat sets the scene. It stays concise.\n\nThe second beat changes direction?")
    ).toEqual([
      "The first beat sets the scene. It stays concise.",
      "The second beat changes direction?"
    ]);
  });

  it("bounds long input by code points and candidate count", () => {
    const longTranscript = Array.from({ length: 30 }, (_, index) =>
      `第 ${index + 1} 段内容说明一个视觉变化。`
    ).join(" ");
    const scenes = segmentTranscript(longTranscript);

    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CANDIDATE_SCENES);
    expect(
      scenes.every(
        (scene) => countTranscriptCodePoints(scene) <= TRANSCRIPT_BEAT_MAX_CODE_POINTS
      )
    ).toBe(true);
  });

  it("hard-bounds seven long paragraphs without dropping source content", () => {
    const paragraphs = Array.from({ length: 7 }, () => "画面".repeat(500));
    const transcript = paragraphs.join("\n\n");
    const scenes = segmentTranscript(transcript);

    expect(scenes.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CANDIDATE_SCENES);
    expect(
      scenes.every(
        (scene) => countTranscriptCodePoints(scene) <= TRANSCRIPT_BEAT_MAX_CODE_POINTS
      )
    ).toBe(true);
    expect(scenes.join("").replace(/\s/gu, "")).toBe(
      transcript.replace(/\s/gu, "")
    );
  });

  it("accepts the exact code-point ceiling and rejects one more code point", () => {
    const accepted = "界".repeat(TRANSCRIPT_MAX_CODE_POINTS);
    const rejected = `${accepted}界`;

    expect(validateTranscriptInput(accepted)).toBeNull();
    expect(validateTranscriptInput(rejected)).toBe("too-long");

    const scenes = segmentTranscript(accepted);
    expect(scenes.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CANDIDATE_SCENES);
    expect(
      scenes.every(
        (scene) => countTranscriptCodePoints(scene) <= TRANSCRIPT_BEAT_MAX_CODE_POINTS
      )
    ).toBe(true);
  });

  it("counts surrogate pairs as one code point and keeps compiled prompts under the API limit", () => {
    const transcript = "🙂".repeat(TRANSCRIPT_MAX_CODE_POINTS);
    const scenes = segmentTranscript(transcript);

    expect(countTranscriptCodePoints(transcript)).toBe(TRANSCRIPT_MAX_CODE_POINTS);
    expect(scenes.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CANDIDATE_SCENES);
    expect(
      scenes.every(
        (scene) => countTranscriptCodePoints(scene) <= TRANSCRIPT_BEAT_MAX_CODE_POINTS
      )
    ).toBe(true);

    for (const locale of ["zh-CN", "en-US"] as const) {
      expect(
        Math.max(
          ...scenes.map((scene) => compileTranscriptImagePrompt(scene, locale).length)
        )
      ).toBeLessThan(4000);
    }
  });

  it("returns no scenes for empty input and validates the transcript bound", () => {
    expect(segmentTranscript("  \n\n ")).toEqual([]);
    expect(validateTranscriptInput(" ")).toBe("empty");
    expect(validateTranscriptInput("🙂".repeat(TRANSCRIPT_MAX_CODE_POINTS + 1))).toBe(
      "too-long"
    );
    expect(validateTranscriptInput("🙂".repeat(TRANSCRIPT_MAX_CODE_POINTS))).toBeNull();
  });

  it("compiles stable text-free visual prompts for both locales", () => {
    const source = "一位创作者在清晨整理桌面。";
    const zhPrompt = compileTranscriptImagePrompt(source, "zh-CN");
    const enPrompt = compileTranscriptImagePrompt(source, "en-US");

    expect(zhPrompt).toContain("不要添加字幕");
    expect(zhPrompt).toContain(source);
    expect(enPrompt).toContain("Do not add subtitles");
    expect(enPrompt).toContain(source);
  });

  it("keeps the explicit transcript input ceiling stable", () => {
    expect(TRANSCRIPT_MAX_CODE_POINTS).toBe(10_800);
  });
});
