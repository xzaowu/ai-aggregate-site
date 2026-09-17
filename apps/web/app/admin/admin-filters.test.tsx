import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  AdminOrdersFilters,
  AdminUsageFilters,
  AdminUsersFilters,
  buildAdminOrdersPath,
  buildAdminUsageLogsPath,
  buildAdminUsersPath,
  type AdminOrdersFilterState,
  type AdminUsageFilterState,
  type AdminUsersFilterState
} from "./admin-filters";

function renderWithLocale(node: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      {node}
    </I18nContext.Provider>
  );
}

describe("admin operational filters", () => {
  it("renders user search and role filters", () => {
    const value: AdminUsersFilterState = { q: "", role: "ALL" };
    const html = renderWithLocale(
      <AdminUsersFilters
        value={value}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    );

    expect(html).toContain("Search email");
    expect(html).toContain("Role");
    expect(html).toContain("All roles");
    expect(html).toContain("USER");
    expect(html).toContain("ADMIN");
    expect(html).toContain("Reset filters");
  });

  it("renders order status, payment method, and search filters", () => {
    const value: AdminOrdersFilterState = {
      q: "",
      status: "ALL",
      paymentType: "ALL",
      review: false
    };
    const html = renderWithLocale(
      <AdminOrdersFilters
        value={value}
        reviewOrderCount={3}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    );

    expect(html).toContain("Search order, email, plan, or trade no");
    expect(html).toContain("Order status");
    expect(html).toContain("Payment method");
    expect(html).toContain("PENDING");
    expect(html).toContain("PAID");
    expect(html).toContain("CANCELLED");
    expect(html).toContain("Alipay");
    expect(html).toContain("WeChat Pay");
    expect(html).toContain("Needs review");
    expect(html).toContain(">3<");
  });

  it("renders usage search, status, and model filters", () => {
    const value: AdminUsageFilterState = {
      q: "",
      status: "ALL",
      model: "ALL"
    };
    const html = renderWithLocale(
      <AdminUsageFilters
        models={[
          { modelId: "gpt-test", label: "GPT Test" },
          { modelId: "deepseek-test", label: "DeepSeek Test" }
        ]}
        value={value}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    );

    expect(html).toContain("Search user email or model");
    expect(html).toContain("Usage status");
    expect(html).toContain("Model");
    expect(html).toContain("SUCCESS");
    expect(html).toContain("FAILED");
    expect(html).toContain("GPT Test");
    expect(html).toContain("DeepSeek Test");
  });

  it("keeps each filter group responsive without changing its control surface", () => {
    const renders = [
      renderWithLocale(
        <AdminUsersFilters
          value={{ q: "", role: "ALL" }}
          onChange={vi.fn()}
          onReset={vi.fn()}
        />
      ),
      renderWithLocale(
        <AdminOrdersFilters
          value={{ q: "", status: "ALL", paymentType: "ALL", review: false }}
          reviewOrderCount={0}
          onChange={vi.fn()}
          onReset={vi.fn()}
        />
      ),
      renderWithLocale(
        <AdminUsageFilters
          models={[]}
          value={{ q: "", status: "ALL", model: "ALL" }}
          onChange={vi.fn()}
          onReset={vi.fn()}
        />
      )
    ];

    for (const [index, html] of renders.entries()) {
      expect(html).toContain(
        `data-admin-filter-bar="${["users", "orders", "usage"][index]}"`
      );
      expect(html).toContain('data-admin-filter-layout="responsive"');
      expect(html).toContain("min-h-10");
    }
  });

  it("builds filtered admin fetch paths without empty params", () => {
    expect(buildAdminUsersPath({ q: "alice@example.com", role: "ADMIN" })).toBe(
      "/admin/users?q=alice%40example.com&role=ADMIN"
    );
    expect(
      buildAdminOrdersPath({
        q: "trade 100",
        status: "PAID",
        paymentType: "wxpay",
        review: true
      })
    ).toBe(
      "/admin/orders?q=trade+100&status=PAID&paymentType=wxpay&review=true"
    );
    expect(
      buildAdminUsageLogsPath({
        q: "deepseek",
        status: "FAILED",
        model: "deepseek-test"
      })
    ).toBe("/admin/usage-logs?q=deepseek&status=FAILED&model=deepseek-test");
    expect(
      buildAdminOrdersPath({
        q: "",
        status: "ALL",
        paymentType: "ALL",
        review: false
      })
    ).toBe("/admin/orders");
  });
});
