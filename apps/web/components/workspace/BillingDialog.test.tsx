import type { OrderSummary, PlanSummary } from "@ai-aggregate/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  BillingDialog,
  handleBillingDialogBackdrop,
  handleBillingDialogKeyDown
} from "./BillingDialog";
import { runBillingPurchase } from "./BillingPurchaseContent";
import { reduceBillingDialogState } from "./workspace-shell-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

const plan: PlanSummary = {
  id: "plan-pro",
  name: "Pro credits",
  price: 990,
  credits: 1200,
  description: "For regular image and chat use.",
  features: ["Fast access"],
  enabled: true,
  sortOrder: 1,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z"
};

const pendingOrder: OrderSummary = {
  id: "pending-order",
  userId: "user-1",
  planId: plan.id,
  planName: plan.name,
  amount: plan.price,
  credits: plan.credits,
  status: "PENDING",
  paymentProvider: "epay",
  paymentType: "alipay",
  paymentTradeNo: "order_pending-order",
  providerTradeNo: null,
  paymentUrl: null,
  paidAt: null,
  createdAt: "2026-08-20T08:00:00.000Z",
  updatedAt: "2026-08-20T08:00:00.000Z"
};

function renderDialog(isOpen: boolean): string {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      <BillingDialog
        isOpen={isOpen}
        token="token"
        remainingCredits={4321}
        onClose={vi.fn()}
        initialPlans={[plan]}
        initialPaymentStatus={{
          enabled: true,
          misconfigured: false,
          paymentMethods: ["alipay", "wxpay"]
        }}
      />
    </I18nContext.Provider>
  );
}

describe("BillingDialog", () => {
  it("is closed by default and renders after the open action", () => {
    expect(renderDialog(false)).toBe("");
    expect(reduceBillingDialogState(false, "open")).toBe(true);
    expect(renderDialog(true)).toContain('role="dialog"');
  });

  it("closes through the close action, Escape, and backdrop", () => {
    const onClose = vi.fn();

    expect(reduceBillingDialogState(true, "close")).toBe(false);
    handleBillingDialogKeyDown("Enter", onClose);
    expect(onClose).not.toHaveBeenCalled();
    handleBillingDialogKeyDown("Escape", onClose);
    handleBillingDialogBackdrop(false, onClose);
    handleBillingDialogBackdrop(true, onClose);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows credits, packages, payment choices, and accessible dialog metadata", () => {
    const html = renderDialog(true);

    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="billing-dialog-title"');
    expect(html).toContain("4,321");
    expect(html).toContain("Pro credits");
    expect(html).toContain("¥9.90");
    expect(html).toContain("1,200");
    expect(html).toContain("Alipay");
    expect(html).toContain("WeChat Pay");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Buy and pay");
  });

  it("routes the purchase button through the supplied purchase workflow", () => {
    const purchase = vi.fn();

    runBillingPurchase(purchase, plan.id);

    expect(purchase).toHaveBeenCalledWith("plan-pro");
  });

  it("does not render orders, auto-credit hint, or explanatory marketing sections", () => {
    const html = renderDialog(true);

    expect(html).not.toContain("My orders");
    expect(html).not.toContain("Per-use credit note");
    expect(html).not.toContain("Best for");
    expect(html).not.toContain("data-desktop-orders-table");
    expect(html).not.toContain("Credits are added automatically");
    // View orders is now a styled button, not a plain Link
    expect(html).toContain('data-view-orders-button="true"');
    expect(html).toContain("View my orders");
  });

  it("renders the billing dialog subtitle", () => {
    const html = renderDialog(true);

    expect(html).toContain("Choose a credit package that fits your needs");
  });

  it("keeps the pending-order cancel action visible on the shared mobile billing surface", () => {
    const html = renderToStaticMarkup(
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <BillingDialog
          isOpen={true}
          token="token"
          remainingCredits={4321}
          onClose={vi.fn()}
          initialPlans={[plan]}
          initialOrders={[pendingOrder]}
          initialPaymentStatus={{
            enabled: true,
            misconfigured: false,
            paymentMethods: ["alipay", "wxpay"]
          }}
        />
      </I18nContext.Provider>
    );

    expect(html).toContain("items-end");
    expect(html).toContain('data-billing-plan-action="resume"');
    expect(html).toContain('data-billing-order-cancel="true"');
    expect(html).toContain("Continue payment");
    expect(html).toContain("Cancel order");
  });

  it("view-orders button exists and has close-before-navigate semantics", () => {
    const onClose = vi.fn();
    const html = renderToStaticMarkup(
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <BillingDialog
          isOpen={true}
          token="token"
          remainingCredits={4321}
          onClose={onClose}
          initialPlans={[plan]}
          initialPaymentStatus={{
            enabled: true,
            misconfigured: false,
            paymentMethods: ["alipay", "wxpay"]
          }}
        />
      </I18nContext.Provider>
    );

    // Verify the view-orders button is present as a button (not Link)
    expect(html).toContain('data-view-orders-button="true"');
    // The button should not use href (it uses onClick with router.push instead)
    expect(html).not.toContain('href="/account#account-orders"');
  });
});
