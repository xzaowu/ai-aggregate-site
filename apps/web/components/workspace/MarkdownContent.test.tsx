import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

const fixture = [
  "# Heading",
  "",
  "**bold** and *emphasis*",
  "",
  "- first item",
  "- second item",
  "",
  "| Name | State |",
  "| --- | --- |",
  "| Text | Ready |",
  "",
  "- [x] done",
  "- [ ] next",
  "",
  "> quoted",
  "",
  "`inline`",
  "",
  "~~removed~~",
  "",
  "[link](https://example.com)",
  "",
  "```ts",
  "const value = 1;",
  "```"
].join("\n");

describe("MarkdownContent", () => {
  it("shares the complete GFM renderer for Canvas and Chat-facing content", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={fixture}
        locale="en-US"
        variant="compact"
        headingIdPrefix="canvas-heading"
      />
    );

    expect(html).toContain('data-markdown-content-variant="compact"');
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<blockquote");
    expect(html).toContain("inline</code>");
    expect(html).toContain("<del");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('data-markdown-code-language="ts"');
    expect(html).not.toContain("| Name | State |");
    expect(html).not.toContain("**bold**");
  });

  it("keeps the bounded Canvas variant free of vertical scrolling", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={"## Long form\n\nA paragraph."} variant="compact" />
    );

    expect(html).toContain("canvas-markdown-compact");
    expect(html).not.toContain("overflow-y-auto");
  });

  it("renders wide compact tables and fenced code without nested scrolling or copy controls", () => {
    const longCodeLine = "const longLine = \"" + "x".repeat(180) + "\";";
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={[
          "| A very wide heading | Another wide heading |",
          "| --- | --- |",
          "| a value that must wrap inside the card | another value that must wrap inside the card |",
          "",
          "```ts",
          longCodeLine,
          "```"
        ].join("\n")}
        variant="compact"
      />
    );

    expect(html).toContain('data-markdown-code-compact="true"');
    expect(html).toContain('data-markdown-code-language="ts"');
    expect(html).toContain("overflow-hidden");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("overflow-y-auto");
    expect(html).not.toContain("min-w-[36rem]");
    expect(html).not.toContain("data-markdown-copy-button");
  });
});
