import { describe, expect, it } from "vitest";
import { shouldCompressImage, avatarMaxBytes, avatarMaxSide, avatarSizeTriggerBytes } from "./image-compress";

describe("image compression", () => {
  it("does not flag files under the size trigger", () => {
    const smallFile = new File(["x".repeat(100)], "small.png", { type: "image/png" });
    expect(shouldCompressImage(smallFile)).toBe(false);
  });

  it("flags files that exceed the size trigger for compression", () => {
    const large = new File(
      ["x".repeat(avatarSizeTriggerBytes + 1)],
      "large.jpg",
      { type: "image/jpeg" }
    );
    expect(shouldCompressImage(large)).toBe(true);
  });

  it("boundary: file exactly at size trigger is not flagged", () => {
    const exact = new File(
      ["x".repeat(avatarSizeTriggerBytes)],
      "exact.jpg",
      { type: "image/jpeg" }
    );
    expect(shouldCompressImage(exact)).toBe(false);
  });

  it("boundary: file one byte over size trigger is flagged", () => {
    const exact = new File(
      ["x".repeat(avatarSizeTriggerBytes + 1)],
      "over.jpg",
      { type: "image/jpeg" }
    );
    expect(shouldCompressImage(exact)).toBe(true);
  });

  it("does not flag unsupported mime types even if size is large", () => {
    const bmp = new File(
      ["x".repeat(avatarSizeTriggerBytes + 1000)],
      "img.bmp",
      { type: "image/bmp" }
    );
    expect(shouldCompressImage(bmp)).toBe(false);
  });

  it("avatarMaxBytes is 2MB", () => {
    expect(avatarMaxBytes).toBe(2 * 1024 * 1024);
  });

  it("avatarMaxSide is 800px", () => {
    expect(avatarMaxSide).toBe(800);
  });

  it("avatarSizeTriggerBytes is 700KB", () => {
    expect(avatarSizeTriggerBytes).toBe(700 * 1024);
  });

  it("reads file type correctly for PNG vs JPEG vs WebP", () => {
    const png = new File(["data"], "icon.png", { type: "image/png" });
    const jpg = new File(["data"], "photo.jpg", { type: "image/jpeg" });
    const webp = new File(["data"], "img.webp", { type: "image/webp" });

    expect(png.type).toBe("image/png");
    expect(jpg.type).toBe("image/jpeg");
    expect(webp.type).toBe("image/webp");
  });
});
