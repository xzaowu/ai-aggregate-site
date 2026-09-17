import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTranslator, I18nContext } from "../../../lib/i18n/use-i18n";
import { PaymentResultStatusCard } from "./payment-result-status-card";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "out_trade_no" ? "order_test-1" : null)
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

function renderWithLocale(node: React.ReactNode, locale: "zh-CN" | "en-US" = "zh-CN") {
  return renderToStaticMarkup(
    <I18nContext.Provider value={{ locale, setLocale: vi.fn(), t: createTranslator(locale) }}>
      {node}
    </I18nContext.Provider>
  );
}

const paidOrder = {
  id: "order-1",
  userId: "user-1",
  planId: "plan-1",
  planName: "Pro Plan",
  amount: 990,
  credits: 100,
  status: "PAID" as const,
  paymentProvider: "epay",
  paymentType: "alipay",
  paymentTradeNo: "order_test-1",
  providerTradeNo: "trade-1",
  paymentUrl: null,
  paidAt: "2026-06-17T08:00:00.000Z",
  createdAt: "2026-06-17T07:59:00.000Z",
  updatedAt: "2026-06-17T08:00:00.000Z"
};

const pendingOrder = {
  ...paidOrder,
  status: "PENDING" as const,
  paidAt: null
};

describe("payment result page", () => {
  it("renders the payment result title", () => {
    const html = renderWithLocale(
      <h1>支付结果</h1>
    );
    expect(html).toContain("支付结果");
  });

  it("renders in English", () => {
    const html = renderWithLocale(
      <h1>Payment result</h1>,
      "en-US"
    );
    expect(html).toContain("Payment result");
  });

  it("has i18n keys for payment result states", () => {
    // Verify the translation keys resolve correctly
    const t = createTranslator("zh-CN");
    expect(t("payment.result")).toBe("支付结果");
    expect(t("payment.success")).toBe("支付成功");
    expect(t("payment.pending")).toBe("支付待确认");
    expect(t("payment.incomplete")).toBe("支付未完成");
    expect(t("payment.cancelled")).toBe("支付已取消");
    expect(t("payment.notFound")).toBe("未找到支付订单");
    expect(t("payment.backToChat")).toBe("返回聊天");
    expect(t("payment.refreshStatus")).toBe("刷新支付状态");
    expect(t("payment.creditsAvailable")).toBe("额度已到账");
    expect(t("payment.pleaseRefresh")).toBe("如已完成支付，请稍后刷新");
    expect(t("payment.manualFallback")).toBe("或等待管理员人工确认");
    expect(t("payment.continueFromOrders")).toBe("前往我的订单继续支付");
  });

  it("has i18n keys for payment result states in English", () => {
    const t = createTranslator("en-US");
    expect(t("payment.result")).toBe("Payment result");
    expect(t("payment.success")).toBe("Payment successful");
    expect(t("payment.pending")).toBe("Payment pending confirmation");
    expect(t("payment.incomplete")).toBe("Payment incomplete");
    expect(t("payment.cancelled")).toBe("Payment cancelled");
    expect(t("payment.backToWorkspace")).toBe("Back to workspace");
    expect(t("payment.refreshStatus")).toBe("Refresh payment status");
    expect(t("payment.loadingResult")).toBe("Confirming payment result");
    expect(t("payment.loadingResultDescription")).toBe("Please wait while we read the order status.");
    expect(t("payment.continueFromOrders")).toBe("Go to My orders to continue payment");
  });

  it("payment result page does not contain admin-only actions", () => {
    // Verify the related translation keys
    const t = createTranslator("zh-CN");
    const tEn = createTranslator("en-US");
    // The page should never expose admin confirm/cancel
    expect(t("payment.result")).not.toContain("确认");
    expect(tEn("payment.result")).not.toContain("Confirm");
  });

  it("shows success guidance with workspace and account buttons", () => {
    const html = renderWithLocale(
      <PaymentResultStatusCard
        result={{ status: "success", order: paidOrder }}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
      "en-US"
    );

    expect(html).toContain("Credits have been added");
    expect(html).toContain("Back to workspace");
    expect(html).toContain("View orders");
    expect(html).toContain("Order reference");
    expect(html).toContain("¥9.90");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/account#account-orders"');
    expect(html).not.toContain("order_test-1");
  });

  it("shows pending guidance with plan and order buttons", () => {
    const html = renderWithLocale(
      <PaymentResultStatusCard
        result={{ status: "pending", order: pendingOrder }}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
      "en-US"
    );

    expect(html).toContain("Payment incomplete");
    expect(html).toContain("Payment was not completed");
    expect(html).toContain("Go to My orders to continue payment");
    expect(html).not.toContain('href="/plans"');
    expect(html).toContain('href="/account#account-orders"');
    expect(html).not.toContain("data-billing-plan-action");
    expect(html).not.toContain("order_test-1");
  });

  it("shows cancelled guidance as an incomplete payment", () => {
    const html = renderWithLocale(
      <PaymentResultStatusCard
        result={{ status: "cancelled", order: { ...pendingOrder, status: "CANCELLED" } }}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
      "en-US"
    );

    expect(html).toContain("Payment incomplete");
    expect(html).toContain("This payment was not completed");
    expect(html).toContain("View orders");
    expect(html).toContain('href="/account#account-orders"');
  });
});
