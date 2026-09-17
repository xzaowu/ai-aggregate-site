import { describe, expect, it } from "vitest";
import {
  generateSessionTitle,
  generateImageSessionTitle,
  generateUserMessageNavTitle,
  getChatSessionTitleFallback,
  getImageSessionTitleFallback,
  isDefaultSessionTitle,
  shouldRegenerateTitle,
} from "./session-title";

describe("generateSessionTitle", () => {
  it("generates short Chinese title from long text", () => {
    const title = generateSessionTitle(
      "请帮我写一段关于人工智能发展趋势的分析报告，包括大语言模型和多模态模型的最新进展"
    );
    expect(title.length).toBeGreaterThanOrEqual(4);
    expect(title.length).toBeLessThanOrEqual(18);
    expect(title).not.toContain("请帮我");
  });

  it("strips Chinese low-info prefix 请帮我", () => {
    const title = generateSessionTitle("请帮我写一个Python脚本处理CSV数据");
    expect(title).not.toContain("请帮我");
  });

  it("strips Chinese low-info prefix 帮我", () => {
    const title = generateSessionTitle("帮我生成一份工作周报模板");
    expect(title).not.toContain("帮我");
    expect(title).not.toMatch(/^帮/);
  });

  it("strips Chinese low-info prefix 我想", () => {
    const title = generateSessionTitle("我想了解一下深度学习的基础概念");
    expect(title).not.toContain("我想");
  });

  it("strips Chinese low-info prefix 请问", () => {
    const title = generateSessionTitle("请问 React 的 useEffect 怎么用？");
    expect(title).not.toContain("请问");
  });

  it("returns empty string for empty content", () => {
    expect(generateSessionTitle("")).toBe("");
  });

  it("returns empty string for whitespace-only", () => {
    expect(generateSessionTitle("   \n  \t  ")).toBe("");
  });

  it("returns empty string when after stripping only low-info prefix remains", () => {
    expect(generateSessionTitle("请帮我")).toBe("");
  });

  it("removes markdown syntax from Chinese text", () => {
    const title = generateSessionTitle(
      "请帮我用 **Python** 实现一个 `快速排序` 算法，参考 [这个链接](https://example.com)"
    );
    expect(title).not.toContain("**");
    expect(title).not.toContain("`");
    expect(title).not.toContain("https://");
  });

  it("removes code blocks from text", () => {
    const title = generateSessionTitle(
      "```python\nprint('hello')\n```\n请帮我解释这段代码"
    );
    expect(title).not.toContain("```");
    expect(title).not.toContain("print");
  });

  it("truncates long Chinese text at a natural boundary", () => {
    const title = generateSessionTitle(
      "请帮我分析一下当前市场环境下创业公司应该采取什么样的融资策略，如何与投资人沟通估值预期"
    );
    expect(title.length).toBeLessThanOrEqual(18);
  });

  it("returns non-empty for short meaningful Chinese", () => {
    const title = generateSessionTitle("你是谁？");
    expect(title).not.toBe("");
    expect(title).toBe("你是谁");
  });

  it("generates short English title from long text", () => {
    const title = generateSessionTitle(
      "Please help me write a comprehensive analysis report about artificial intelligence trends including large language models and multimodal models"
    );
    const words = title.split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(3);
    expect(words).toBeLessThanOrEqual(8);
    expect(title.toLowerCase()).not.toContain("please help me");
  });

  it("strips English low-info prefix 'can you'", () => {
    const title = generateSessionTitle("Can you help me write a Python script for data analysis?");
    expect(title.toLowerCase()).not.toMatch(/^can you/i);
  });

  it("removes URLs from English text", () => {
    const title = generateSessionTitle("Check out this article https://example.com/article about AI safety");
    expect(title).not.toContain("https://");
  });

  it("truncates long English text to max 8 words", () => {
    const title = generateSessionTitle(
      "I need a detailed explanation of how quantum computing works and its practical applications in cryptography and drug discovery research"
    );
    expect(title.split(/\s+/).length).toBeLessThanOrEqual(8);
  });
});

describe("generateUserMessageNavTitle", () => {
  it("generates short nav title from Chinese text", () => {
    const title = generateUserMessageNavTitle("请帮我写一个Python脚本处理CSV数据", 1);
    expect(title.length).toBeLessThanOrEqual(22);
    expect(title).not.toContain("请帮我");
  });

  it("uses index number for empty content", () => {
    expect(generateUserMessageNavTitle("", 1)).toBe("1");
    expect(generateUserMessageNavTitle("   ", 3)).toBe("3");
  });

  it("strips markdown and URLs", () => {
    const title = generateUserMessageNavTitle("Check out https://example.com/article about **AI** safety", 1);
    expect(title).not.toContain("https://");
    expect(title).not.toContain("**");
  });

  it("truncates long text", () => {
    const title = generateUserMessageNavTitle(
      "这是一个非常长的用户消息包含大量无关内容和多余标点以及空格和换行测试字符串", 1
    );
    expect(title.length).toBeLessThanOrEqual(23); // 22 + ellipsis
  });

  it("returns short message as-is", () => {
    const title = generateUserMessageNavTitle("你是谁？", 1);
    expect(title).toBe("你是谁");
  });

  it("removes newlines and collapses whitespace", () => {
    const title = generateUserMessageNavTitle("hello\n\nworld  \n  test", 1);
    expect(title).toBe("hello world test");
  });
});

describe("generateImageSessionTitle", () => {
  it("returns image creation fallback for empty content", () => {
    expect(generateImageSessionTitle("", "zh-CN")).toBe("图像创作");
    expect(generateImageSessionTitle("", "en-US")).toBe("Image creation");
  });

  it("generates short title from prompt", () => {
    const title = generateImageSessionTitle("生成一张赛博朋克风格的城市夜景图，霓虹灯闪烁", "zh-CN");
    expect(title).not.toBe("图像创作");
    expect(title.length).toBeLessThanOrEqual(18);
  });
});

describe("getChatSessionTitleFallback", () => {
  it("returns 新会话 for zh-CN", () => {
    expect(getChatSessionTitleFallback("zh-CN")).toBe("新会话");
  });

  it("returns New chat for en-US", () => {
    expect(getChatSessionTitleFallback("en-US")).toBe("New chat");
  });
});

describe("getImageSessionTitleFallback", () => {
  it("returns 图像创作 for zh-CN", () => {
    expect(getImageSessionTitleFallback("zh-CN")).toBe("图像创作");
  });

  it("returns Image creation for en-US", () => {
    expect(getImageSessionTitleFallback("en-US")).toBe("Image creation");
  });
});

describe("isDefaultSessionTitle", () => {
  it("returns true for exact chat fallback", () => {
    expect(isDefaultSessionTitle("新会话", "zh-CN")).toBe(true);
    expect(isDefaultSessionTitle("New chat", "en-US")).toBe(true);
  });

  it("returns true for overlong Chinese title", () => {
    expect(isDefaultSessionTitle("请帮我写一段关于人工智能发展趋势的分析报告和最新进展", "zh-CN")).toBe(true);
  });

  it("returns false for normal short title", () => {
    expect(isDefaultSessionTitle("人工智能发展趋势分析", "zh-CN")).toBe(false);
  });
});

describe("shouldRegenerateTitle", () => {
  it("returns true for null/undefined/empty title", () => {
    expect(shouldRegenerateTitle(null, "zh-CN")).toBe(true);
    expect(shouldRegenerateTitle(undefined, "zh-CN")).toBe(true);
    expect(shouldRegenerateTitle("", "zh-CN")).toBe(true);
  });

  it("returns true for default fallback titles", () => {
    expect(shouldRegenerateTitle("新会话", "zh-CN")).toBe(true);
  });

  it("returns false for normal short titles", () => {
    expect(shouldRegenerateTitle("深度学习基础", "zh-CN")).toBe(false);
  });
});
