import { describe, expect, it } from "vitest";
import {
  imageAspectRatioSizeMap,
  imageAspectRatios,
  inferAspectRatioFromPrompt,
  isImageAspectRatio,
  resolveImageGenerationSize,
  type ImageAspectRatio
} from "./image-generation-aspect";

describe("shared image aspect and size contract", () => {
  it("keeps the exact supported aspect vocabulary and mapping", () => {
    expect(imageAspectRatios).toEqual([
      "auto",
      "1:1",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
      "2:3",
      "3:2"
    ]);
    expect(imageAspectRatioSizeMap).toEqual({
      auto: "1024x1024",
      "1:1": "1024x1024",
      "4:3": "1024x768",
      "3:4": "768x1024",
      "16:9": "1280x720",
      "9:16": "720x1280",
      "2:3": "768x1024",
      "3:2": "1280x720"
    });
  });

  it.each([
    ["1:1", "1024x1024"],
    ["4:3", "1024x768"],
    ["3:4", "768x1024"],
    ["16:9", "1280x720"],
    ["9:16", "720x1280"],
    ["2:3", "768x1024"],
    ["3:2", "1280x720"]
  ] as const)("maps explicit %s to %s", (ratio, size) => {
    expect(resolveImageGenerationSize(ratio, "text-to-image")).toBe(size);
  });

  it.each([
    ["16:9", "16:9"],
    ["16：9", "16:9"],
    ["１６／９", "16:9"],
    ["正方形", "1:1"],
    ["square", "1:1"],
    ["Create a 3:2 cover", "3:2"]
  ] as const)("infers a supported ratio from %s", (prompt, ratio) => {
    expect(inferAspectRatioFromPrompt(prompt)).toBe(ratio);
  });

  it.each([
    "",
    "landscape",
    "16:9 and 1:1",
    "5:7",
    "5:7 and 16:9",
    "2026 1080p 4K"
  ])("does not guess an ambiguous or unsupported ratio from %s", (prompt) => {
    expect(inferAspectRatioFromPrompt(prompt)).toBeNull();
  });

  it("uses prompt inference for text auto and preserves the square default", () => {
    expect(resolveImageGenerationSize("auto", "text-to-image", null, "16:9")).toBe(
      "1280x720"
    );
    expect(resolveImageGenerationSize("auto", "text-to-image", null, "")).toBe(
      "1024x1024"
    );
  });

  it.each([
    [{ width: 1024, height: 1024 }, "1024x1024"],
    [{ width: 1600, height: 900 }, "1280x720"],
    [{ width: 900, height: 1600 }, "720x1280"],
    [{ width: 1200, height: 900 }, "1024x768"],
    [{ width: 900, height: 1200 }, "768x1024"]
  ] as const)("uses the closest supported image-to-image size", (dimensions, size) => {
    expect(resolveImageGenerationSize("auto", "image-to-image", dimensions)).toBe(
      size
    );
  });

  it("falls back through prompt inference when image dimensions are invalid", () => {
    expect(
      resolveImageGenerationSize(
        "auto",
        "image-to-image",
        { width: 0, height: 1200 },
        "9:16"
      )
    ).toBe("720x1280");
  });

  it("rejects unsupported ratios at the shared validation seam", () => {
    expect(isImageAspectRatio("5:7")).toBe(false);
    expect(isImageAspectRatio("auto")).toBe(true);
    expect(isImageAspectRatio("3:2" satisfies ImageAspectRatio)).toBe(true);
  });
});
