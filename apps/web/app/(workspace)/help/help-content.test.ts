import { describe, expect, it } from "vitest";
import {
  getHelpLocaleContent,
  parseHelpContentJson
} from "./help-content";

const validConfig = JSON.stringify({
  "zh-CN": {
    title: "中文帮助",
    intro: "中文介绍",
    quickStartTitle: "中文开始",
    serviceTitle: "中文服务",
    faqTitle: "中文问答",
    overviewCards: [],
    quickStart: [],
    serviceCards: [],
    faqs: [{ question: "中文问题", answer: "中文答案" }]
  },
  "en-US": {
    title: "English help",
    intro: "English intro",
    quickStartTitle: "English start",
    serviceTitle: "English services",
    faqTitle: "English FAQ",
    overviewCards: [],
    quickStart: [],
    serviceCards: [],
    faqs: [{ question: "English question", answer: "English answer" }]
  }
});

describe("help content configuration", () => {
  it("parses and selects localized Chinese and English content", () => {
    const config = parseHelpContentJson(validConfig);

    expect(getHelpLocaleContent(config, "zh-CN")?.title).toBe("中文帮助");
    expect(getHelpLocaleContent(config, "en-US")?.title).toBe("English help");
    expect(getHelpLocaleContent(config, "zh-CN")?.faqs[0]?.answer).toBe("中文答案");
  });

  it("returns null for invalid JSON so the page can use default copy", () => {
    expect(parseHelpContentJson("{invalid")).toBeNull();
    expect(parseHelpContentJson(JSON.stringify({ "zh-CN": {} }))).toBeNull();
  });

  it("keeps configured content as text values", () => {
    const config = parseHelpContentJson(
      validConfig.replace("中文帮助", "<script>alert(1)</script>")
    );

    expect(config?.["zh-CN"].title).toBe("<script>alert(1)</script>");
  });
});
