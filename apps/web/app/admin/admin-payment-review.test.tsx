import type { AdminOrderSummary } from "@ai-aggregate/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  AdminPaymentReviewBadge,
  AdminPaymentReviewDetails
} from "./admin-payment-review";
import { normalizeAdminOrderSummary } from "./admin-safe-data";

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

function adminOrder(
  overrides: Partial<AdminOrderSummary> = {}
): AdminOrderSummary {
  return {
    id: "order-review-ui",
    userId: "user-review-ui",
    planId: "plan-review-ui",
    planName: "Review Plan",
    amount: 5900,
    credits: 500,
    status: "CANCELLED",
    paymentProvider: "epay",
    paymentType: "wxpay",
    paymentTradeNo: "order_review_ui",
    providerTradeNo: null,
    paidAt: null,
    createdAt: "2030-01-02T02:00:00.000Z",
    updatedAt: "2030-01-02T03:04:05.000Z",
    userEmail: "review-ui@example.com",
    reviewAttempts: [
      {
        id: "attempt-review-ui",
        orderId: "order-review-ui",
        ordinal: 1,
        status: "PAID_REQUIRES_REVIEW",
        provider: "epay",
        paymentType: "wxpay",
        merchantTradeNo: "order_review_ui",
        providerTradeNo: "Y-REVIEW-UI",
        paidAt: "2030-01-02T03:04:05.000Z",
        createdAt: "2030-01-02T03:00:00.000Z"
      }
    ],
    ...overrides
  };
}

describe("Admin payment review visibility", () => {
  it("renders a clear review badge and all required read-only Attempt fields", () => {
    const html = renderWithLocale(
      <>
        <AdminPaymentReviewBadge />
        <AdminPaymentReviewDetails order={adminOrder()} />
      </>
    );

    expect(html).toContain("Needs review");
    expect(html).toContain("Payment review details");
    expect(html).toContain("Payment attempt 1");
    expect(html).toContain("Attempt status");
    expect(html).toContain("PAID_REQUIRES_REVIEW");
    expect(html).toContain("epay");
    expect(html).toContain("wxpay");
    expect(html).toContain("order_review_ui");
    expect(html).toContain("Y-REVIEW-UI");
    expect(html).toContain("Paid");
    expect(html).toContain("Created");
    expect(html).not.toContain("Refund");
    expect(html).not.toContain("Credit");
    expect(html).not.toContain("Repair");
    expect(html).not.toContain("Reconcile");
    expect(html).not.toContain("<button");
  });

  it("does not render a false review block for a normal Order", () => {
    const html = renderWithLocale(
      <AdminPaymentReviewDetails
        order={adminOrder({ reviewAttempts: [], status: "PAID" })}
      />
    );

    expect(html).toBe("");
    expect(html).not.toContain("Needs review");
  });

  it("normalizes only the safe Admin projection and drops secret-adjacent fields", () => {
    const normalized = normalizeAdminOrderSummary({
      ...adminOrder(),
      paymentUrl: "https://pay.example/private-session",
      reviewAttempts: [
        {
          ...adminOrder().reviewAttempts[0],
          providerMerchantRef: "merchant-secret-scope",
          providerTradeIdentityHash: "raw-hash",
          paymentUrl: "https://pay.example/private-attempt"
        }
      ]
    });
    const serialized = JSON.stringify(normalized);

    expect(serialized).not.toContain("paymentUrl");
    expect(serialized).not.toContain("providerMerchantRef");
    expect(serialized).not.toContain("providerTradeIdentityHash");
    expect(normalized.reviewAttempts[0]).toEqual(
      adminOrder().reviewAttempts[0]
    );
  });
});
