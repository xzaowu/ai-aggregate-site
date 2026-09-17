// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import AccountActivityModal from "./AccountActivityModal";

beforeAll(() => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 1
        })
    })
  );
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccountActivityModal", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "zh-CN",
        isOpen: false,
        onClose: () => {}
      })
    );
    expect(html).toBe("");
  });

  it("renders dialog with correct accessibility attributes when open", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "zh-CN",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("订单与开通记录");
  });

  it("renders page size selector with 10/20/50/100 options and default 20", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "zh-CN",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("10");
    expect(html).toContain('value="20"');
    expect(html).toContain("50");
    expect(html).toContain("100");
  });

  it("renders close button with zh locale label", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "zh-CN",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("关闭");
  });

  it("renders close button with en locale label", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "en",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("Close");
  });

  it("renders prev/next page navigation", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "zh-CN",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("上一页");
    expect(html).toContain("下一页");
  });

  it("renders empty state before data loads", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "zh-CN",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("暂无订单或账户变动记录");
  });

  it("table area has fixed max-height with overflow scroll", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "en",
        locale: "en",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("max-height:60vh");
  });

  it("renders total count display in footer", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "zh-CN",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("条");
  });

  it("renders in English locale", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "en",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("Orders and activations");
    expect(html).toContain("No orders or account activity yet.");
  });

  it("renders close button with zh locale label", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountActivityModal, {
        token: "test-token",
        locale: "zh-CN",
        isOpen: true,
        onClose: () => {}
      })
    );
    expect(html).toContain("关闭");
  });
});
