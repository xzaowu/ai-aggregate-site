import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MarkdownCodeBlock, copyMarkdownCode } from "./MarkdownCodeBlock";

describe("MarkdownCodeBlock", () => {
  it("renders language, copy control, and bounded dark code surfaces", () => {
    const html = renderToStaticMarkup(
      <MarkdownCodeBlock
        className="language-ts"
        rawCode={"const result = await generate();\n  return result;"}
      />
    );

    expect(html).toContain('data-markdown-code-language="ts"');
    expect(html).toContain("ts");
    expect(html).toContain('data-markdown-copy-button="true"');
    expect(html).toContain("Copy");
    expect(html).toContain("bg-slate-950");
    expect(html).toContain("text-slate-100");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("return result;");
  });

  it("copies exact code and reports success without throwing on failure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyMarkdownCode("line 1\n  line 2", { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("line 1\n  line 2");

    const failedWrite = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));
    await expect(copyMarkdownCode("code", { writeText: failedWrite })).resolves.toBe(false);
  });
});
