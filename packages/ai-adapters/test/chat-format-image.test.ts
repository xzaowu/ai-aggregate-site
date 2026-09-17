import { describe, expect, it } from "vitest";
import {
  parseChatFormatImageOutputs,
  parseChatFormatImageResponseOutputs
} from "../src/index";

// Short fake base64 for testing (1x1 PNG)
const FAKE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const FAKE_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";

describe("parseChatFormatImageOutputs", () => {
  it("parses a markdown png data URL image", () => {
    const text = `![image_1](data:image/png;base64,${FAKE_PNG_BASE64})`;
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(1);
    const img = result[0]!;
    expect(img).toMatchObject({
      sourceType: "data-url",
      mimeType: "image/png",
      altText: "image_1",
    });
    expect(img.dataUrl).toBe(`data:image/png;base64,${FAKE_PNG_BASE64}`);
    expect(img.base64Data).toBe(FAKE_PNG_BASE64);
  });

  it("parses a raw jpeg data URL (no markdown wrapper)", () => {
    const text = `data:image/jpeg;base64,${FAKE_JPEG_BASE64}`;
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(1);
    const img = result[0]!;
    expect(img).toMatchObject({
      sourceType: "data-url",
      mimeType: "image/jpeg",
    });
    expect(img.altText).toBeUndefined();
    expect(img.dataUrl).toBe(
      `data:image/jpeg;base64,${FAKE_JPEG_BASE64}`
    );
    expect(img.base64Data).toBe(FAKE_JPEG_BASE64);
  });

  it("parses a markdown http image URL", () => {
    const text = "![image](https://example.com/image.png)";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(1);
    const img = result[0]!;
    expect(img).toMatchObject({
      sourceType: "url",
      altText: "image",
      url: "https://example.com/image.png",
    });
  });

  it("handles mixed text before and after images", () => {
    const text = `Here is some text before.
![img](data:image/png;base64,${FAKE_PNG_BASE64})
And some text in between.
data:image/jpeg;base64,${FAKE_JPEG_BASE64}
And trailing text.`;

    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(2);
    const a = result[0]!;
    const b = result[1]!;
    expect(a.sourceType).toBe("data-url");
    expect(a.mimeType).toBe("image/png");
    expect(b.sourceType).toBe("data-url");
    expect(b.mimeType).toBe("image/jpeg");
  });

  it("keeps repeated data URLs as separate ordered outputs", () => {
    const dataUrl = `data:image/png;base64,${FAKE_PNG_BASE64}`;
    const text = `![a](${dataUrl})\n${dataUrl}`;
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(2);
    const img = result[0]!;
    expect(img.sourceType).toBe("data-url");
    expect(img.mimeType).toBe("image/png");
    expect(img.altText).toBe("a");
    expect(result[1]?.altText).toBeUndefined();
  });

  it("keeps a markdown image and a later raw image as separate outputs", () => {
    const dataUrl = `data:image/png;base64,${FAKE_PNG_BASE64}`;
    const text = `![my_image](${dataUrl})\nAlso here: ${dataUrl}`;
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(2);
    const img = result[0]!;
    expect(img.sourceType).toBe("data-url");
    expect(img.altText).toBe("my_image");
    expect(img.dataUrl).toBe(dataUrl);
    expect(img.base64Data).toBe(FAKE_PNG_BASE64);
    expect(result[1]?.altText).toBeUndefined();
  });

  it("rejects non-image data URL (e.g. text/plain)", () => {
    const text = "data:text/plain;base64,SGVsbG8gV29ybGQ=";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("rejects non-base64 data URL (e.g. data:image/png,<data>)", () => {
    const text = "data:image/png,someRawData";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("rejects javascript: URL", () => {
    const text = "![x](javascript:alert(1))";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("rejects file: URL", () => {
    const text = "![x](file:///etc/passwd)";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("rejects ftp: URL", () => {
    const text = "![x](ftp://example.com/image.png)";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("rejects vbscript: URL", () => {
    const text = "![x](vbscript:msgbox(1))";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("rejects data: protocol in Markdown (not image)", () => {
    const text = "![x](data:text/html;base64,PGgxPkhlbGxvPC9oMT4=)";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty text", () => {
    expect(parseChatFormatImageOutputs("")).toHaveLength(0);
  });

  it("parses multiple markdown http images without URL-based deduplication", () => {
    const text =
      "![a](https://example.com/1.png)\n![b](https://example.com/2.png)\n![c](https://example.com/1.png)";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(3);
    const a = result[0]!;
    const b = result[1]!;
    expect(a.url).toBe("https://example.com/1.png");
    expect(a.altText).toBe("a");
    expect(b.url).toBe("https://example.com/2.png");
    expect(b.altText).toBe("b");
    expect(result[2]?.url).toBe("https://example.com/1.png");
    expect(result[2]?.altText).toBe("c");
  });

  it("parses markdown https URL", () => {
    const text = "![secure](https://secure.example.com/img.png)";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(1);
    const img = result[0]!;
    expect(img).toMatchObject({
      sourceType: "url",
      altText: "secure",
      url: "https://secure.example.com/img.png",
    });
  });

  it("does not capture plain http URL without markdown wrapper", () => {
    const text = "Look at https://example.com/photo.png in the text.";
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("rejects unsupported gif data URL MIME", () => {
    const gifBase64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const text = `![gif_img](data:image/gif;base64,${gifBase64})`;
    const result = parseChatFormatImageOutputs(text);

    expect(result).toHaveLength(0);
  });

  it("parses image outputs across multiple choices and content blocks", () => {
    const result = parseChatFormatImageResponseOutputs({
      choices: [
        {
          message: {
            content: `![first](https://cdn.example.com/first.png)`
          }
        },
        {
          message: {
            content: [
              {
                type: "text",
                text: `![second](data:image/png;base64,${FAKE_PNG_BASE64})`
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: FAKE_JPEG_BASE64
                }
              },
              {
                type: "image_url",
                image_url: { url: "https://cdn.example.com/fourth.webp" }
              }
            ]
          }
        }
      ]
    });

    expect(result).toEqual([
      {
        sourceType: "url",
        altText: "first",
        url: "https://cdn.example.com/first.png"
      },
      {
        sourceType: "data-url",
        mimeType: "image/png",
        altText: "second",
        dataUrl: `data:image/png;base64,${FAKE_PNG_BASE64}`,
        base64Data: FAKE_PNG_BASE64
      },
      {
        sourceType: "data-url",
        mimeType: "image/jpeg",
        dataUrl: `data:image/jpeg;base64,${FAKE_JPEG_BASE64}`,
        base64Data: FAKE_JPEG_BASE64
      },
      {
        sourceType: "url",
        url: "https://cdn.example.com/fourth.webp"
      }
    ]);
  });

  it("filters invalid structured outputs while preserving valid response order", () => {
    const result = parseChatFormatImageResponseOutputs({
      content: [
        { type: "image", source: { type: "base64", media_type: "text/plain", data: "SGVsbG8=" } },
        { type: "image_url", image_url: { url: "javascript:alert(1)" } },
        { type: "image", source: { type: "base64", media_type: "image/png", data: FAKE_PNG_BASE64 } },
        { type: "text", text: "![last](https://cdn.example.com/last.png)" }
      ]
    });

    expect(result.map((image) => image.url ?? image.dataUrl)).toEqual([
      `data:image/png;base64,${FAKE_PNG_BASE64}`,
      "https://cdn.example.com/last.png"
    ]);
  });
});
