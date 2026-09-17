import { describe, expect, it } from "vitest";
import {
  buildTitleCoverDownloadFilename,
  calculateTitleCoverCoverCrop,
  calculateTitleCoverLayout,
  createTitleCoverTypographyDraft,
  fitTitleCoverText,
  normalizeTitleCoverLineBreaks,
  parseTitleCoverCanvasDimensions,
  resolveTitleCoverGeometryBucket,
  titleCoverTypographyPresetDefinitions,
  titleCoverTypographyPresets,
  titleCoverFontFamily
} from "./title-cover-composition";

function createMeasureContext() {
  return {
    font: "",
    measureText(value: string) {
      return { width: Array.from(value).length * 10 } as TextMetrics;
    }
  } satisfies Pick<CanvasRenderingContext2D, "font" | "measureText">;
}

function fit(text: string, overrides: Partial<Parameters<typeof fitTitleCoverText>[0]> = {}) {
  const context = createMeasureContext();
  return fitTitleCoverText({
    context,
    text,
    canvasWidth: 240,
    canvasHeight: 160,
    textBox: { x: 0, y: 0, width: 100, height: 100 },
    fontFamily: titleCoverFontFamily,
    fontWeight: 800,
    maxFontSize: 32,
    minFontSize: 12,
    lineHeight: 1.2,
    maxLines: 4,
    ...overrides
  });
}

describe("title cover geometry", () => {
  it("parses the selected target canvas dimensions", () => {
    expect(parseTitleCoverCanvasDimensions("1280x720")).toEqual({
      width: 1280,
      height: 720
    });
    expect(parseTitleCoverCanvasDimensions(" 1280x720 ")).toEqual({
      width: 1280,
      height: 720
    });
    expect(parseTitleCoverCanvasDimensions("natural")).toBeNull();
    expect(parseTitleCoverCanvasDimensions("0x720")).toBeNull();
  });

  it("center-crops a near-matching 1312x736 source into 1280x720", () => {
    const crop = calculateTitleCoverCoverCrop({
      sourceWidth: 1312,
      sourceHeight: 736,
      targetWidth: 1280,
      targetHeight: 720
    });

    expect(crop.scale).toBeCloseTo(720 / 736);
    expect(crop.width).toBeCloseTo(1312 * (720 / 736));
    expect(crop.height).toBeCloseTo(720);
    expect(crop.x).toBeCloseTo((1280 - crop.width) / 2);
    expect(crop.y).toBeCloseTo(0);
  });

  it("center-crops a mismatched 1536x1024 source without distortion", () => {
    const crop = calculateTitleCoverCoverCrop({
      sourceWidth: 1536,
      sourceHeight: 1024,
      targetWidth: 1280,
      targetHeight: 720
    });

    expect(crop.scale).toBeCloseTo(1280 / 1536);
    expect(crop.width).toBeCloseTo(1280);
    expect(crop.height).toBeCloseTo(1024 * (1280 / 1536));
    expect(crop.x).toBeCloseTo(0);
    expect(crop.y).toBeCloseTo((720 - crop.height) / 2);
  });

  it("calculates deterministic landscape geometry", () => {
    expect(resolveTitleCoverGeometryBucket(1536, 1024)).toBe("LANDSCAPE");
    expect(calculateTitleCoverLayout(1536, 1024)).toEqual(
      calculateTitleCoverLayout(1536, 1024)
    );
    expect(calculateTitleCoverLayout(1536, 1024).mainTextBox.width).toBe(691.2);
    expect(calculateTitleCoverLayout(1536, 1024).scrimDirection).toBe("horizontal");
  });

  it("calculates square geometry", () => {
    const layout = calculateTitleCoverLayout(1024, 1024);
    expect(layout.bucket).toBe("SQUARE");
    expect(layout.mainTextBox.width).toBe(778.24);
    expect(layout.scrimDirection).toBe("vertical");
  });

  it("calculates portrait geometry", () => {
    const layout = calculateTitleCoverLayout(768, 1024);
    expect(layout.bucket).toBe("PORTRAIT");
    expect(layout.mainTextBox.width).toBe(645.12);
    expect(layout.mainMaxLines).toBe(7);
  });
});

describe("title cover bounded typography", () => {
  it("keeps four bounded presets with complete rendering values", () => {
    expect(titleCoverTypographyPresets).toEqual([
      "clean-light",
      "bold-yellow",
      "dark-editorial",
      "cyan-tech"
    ]);

    for (const preset of titleCoverTypographyPresets) {
      expect(createTitleCoverTypographyDraft(preset)).toEqual({
        preset,
        ...titleCoverTypographyPresetDefinitions[preset]
      });
    }
  });

  it("keeps the clean-light default close to the existing compositor treatment", () => {
    expect(createTitleCoverTypographyDraft()).toMatchObject({
      preset: "clean-light",
      mainColor: "#ffffff",
      secondaryColor: "#ffffff",
      mainWeight: 800,
      secondaryWeight: 500,
      scrimStrength: 0.62,
      mainShadowStrength: 0.42,
      secondaryShadowStrength: 0.3
    });
  });
});

describe("title cover exact-copy fitting", () => {
  it("normalizes only line endings and preserves main copy characters", () => {
    const text = "主文案\r\nAI 2026?!";
    const result = fit(text);
    expect(result.text).toBe("主文案\nAI 2026?!");
    expect(result.text).toBe(normalizeTitleCoverLineBreaks(text));
    expect(result.lines.join("")).toBe(result.text.replaceAll("\n", ""));
    expect(result.lines.join("")).not.toContain("…");
  });

  it("preserves secondary copy and explicit empty lines", () => {
    const result = fit("第一行\n\n第三行", { maxLines: 5 });
    expect(result.text).toBe("第一行\n\n第三行");
    expect(result.paragraphs).toHaveLength(3);
    expect(result.paragraphs[1]).toEqual([""]);
  });

  it("wraps long Chinese text without changing characters", () => {
    const text = "这是一个需要在固定封面文字区域内稳定换行的中文标题";
    const result = fit(text, {
      maxLines: 10,
      textBox: { x: 0, y: 0, width: 100, height: 220 }
    });
    expect(result.overflow).toBe(false);
    expect(result.lines.join("")).toBe(text);
    expect(result.lines.length).toBeGreaterThan(1);
  });

  it("wraps long English text without ellipsis", () => {
    const text = "A deterministic title cover composition keeps every English character";
    const result = fit(text, {
      maxLines: 10,
      textBox: { x: 0, y: 0, width: 100, height: 220 }
    });
    expect(result.overflow).toBe(false);
    expect(result.lines.join("")).toBe(text);
    expect(result.lines.join("")).not.toContain("…");
  });

  it("wraps mixed Chinese, English, and numeric text", () => {
    const text = "AI副业 2026: 从想法到可执行工作流";
    const result = fit(text, { maxLines: 8 });
    expect(result.lines.join("")).toBe(text);
    expect(result.overflow).toBe(false);
  });

  it("supports an empty secondary copy", () => {
    const result = fit("");
    expect(result.text).toBe("");
    expect(result.lines).toEqual([""]);
    expect(result.overflow).toBe(false);
  });

  it("uses a bounded fitting search", () => {
    const result = fit("bounded", { maxFontSize: 80, minFontSize: 10 });
    expect(result.fontSize).toBeGreaterThanOrEqual(10);
    expect(result.fontSize).toBeLessThanOrEqual(80);
  });

  it("returns overflow when the minimum size cannot fit", () => {
    const result = fit("无法放入固定区域的超长文案", {
      textBox: { x: 0, y: 0, width: 10, height: 10 },
      maxLines: 1,
      minFontSize: 20,
      maxFontSize: 24
    });
    expect(result.overflow).toBe(true);
    expect(result.text).not.toContain("…");
    expect(result.lines.join("")).toBe(result.text);
  });
});

describe("title cover filenames", () => {
  it("removes filesystem-forbidden characters", () => {
    expect(buildTitleCoverDownloadFilename('AI / 副业: "入门"?.png')).toBe(
      "AI 副业 入门.png"
    );
  });

  it("bounds the filename by Unicode code points", () => {
    const filename = buildTitleCoverDownloadFilename("标题".repeat(100), "fallback", 12);
    expect(Array.from(filename.replace(/\.png$/u, ""))).toHaveLength(12);
  });

  it("uses fallback for empty names", () => {
    expect(buildTitleCoverDownloadFilename(" /:*?", "title-cover")).toBe(
      "title-cover.png"
    );
  });
});
