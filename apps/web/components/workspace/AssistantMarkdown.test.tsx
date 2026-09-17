import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown } from "./AssistantMarkdown";

const fixture = [
  "# 一级标题",
  "",
  "## 系统模块",
  "",
  "| 模块 | 说明 | 状态 |",
  "|---|---|---|",
  "| 用户系统 | 登录和账户管理 | 已完成 |",
  "| 对话系统 | 多模型聊天 | 开发中 |",
  "",
  "- [x] 已完成",
  "- [ ] 待处理",
  "",
  "~~废弃内容~~",
  "",
  "https://example.com/very/long/path",
  "",
  "---",
  "",
  "> 这是引用内容",
  "",
  "`inline code`",
  "",
  "```ts",
  "const result = await generate();",
  "```",
  "",
  "```json",
  "{",
  '  "name": "千语"',
  "}",
  "```"
].join("\n");

describe("AssistantMarkdown", () => {
  it("renders the GFM fixture as semantic DOM", () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown content={fixture} messageId="assistant-1" />
    );

    expect(html).toContain("<table");
    expect(html).toContain("<h1");
    expect(html).toContain("<h2");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
    expect(html).not.toContain("| 模块 | 说明 | 状态 |");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<del");
    expect(html).toContain('href="https://example.com/very/long/path"');
    expect(html).toContain("<hr");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<pre");
    expect(html).toContain("inline code</code>");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("data-markdown-code-language=\"ts\"");
    expect(html).toContain("data-markdown-code-language=\"json\"");
    expect(html.match(/data-markdown-copy-button="true"/g)).toHaveLength(2);
  });

  it("uses explicit theme-safe classes for markdown surfaces and controls", () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown content={fixture} messageId="assistant-2" />
    );

    expect(html).toContain("text-slate-700");
    expect(html).toContain("dark:text-slate-200");
    expect(html).toContain("bg-slate-50");
    expect(html).toContain("dark:bg-slate-800/50");
    expect(html).toContain("bg-slate-100");
    expect(html).toContain("dark:bg-slate-800");
    expect(html).toContain("text-slate-800");
    expect(html).toContain("dark:text-slate-100");
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("opacity-100");
  });
});
