// @vitest-environment jsdom

import type { OrderSummary, PlanSummary } from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator, I18nContext } from "../../lib/i18n/use-i18n";
import { BillingPurchaseContent } from "./BillingPurchaseContent";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan: PlanSummary = {
  id: "plan-pro",
  name: "Pro credits",
  price: 990,
  credits: 1200,
  description: "For regular image and chat use.",
  features: [],
  enabled: true,
  sortOrder: 1,
  createdAt: "2026-08-20T08:00:00.000Z",
  updatedAt: "2026-08-20T08:00:00.000Z"
};

function order(
  id: string,
  status: OrderSummary["status"],
  paymentType: string | null
): OrderSummary {
  return {
    id,
    userId: "user-1",
    planId: plan.id,
    planName: plan.name,
    amount: plan.price,
    credits: plan.credits,
    status,
    paymentProvider: paymentType ? "epay" : null,
    paymentType,
    paymentTradeNo: paymentType ? `order_${id}` : null,
    providerTradeNo: null,
    paymentUrl: null,
    paidAt: status === "PAID" ? "2026-08-20T08:05:00.000Z" : null,
    createdAt: "2026-08-20T08:00:00.000Z",
    updatedAt: "2026-08-20T08:00:00.000Z"
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

type BillingScenario = {
  orders: OrderSummary[];
  paymentMethods: string[];
  currentPlan?: PlanSummary;
  cancelResponse?: Response | Promise<Response>;
};

function mockBillingFetch({
  orders,
  paymentMethods,
  currentPlan = plan,
  cancelResponse
}: BillingScenario) {
  const calls = {
    requests: [] as Array<{ url: string; method: string }>,
    create: [] as RequestInit[],
    pay: [] as Array<{ url: string; init: RequestInit }>,
    cancel: [] as Array<{ url: string; init: RequestInit }>
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.requests.push({ url, method });

    if (url.endsWith("/plans") && method === "GET") {
      return jsonResponse({ plans: [currentPlan] });
    }
    if (url.endsWith("/payments/epay/status") && method === "GET") {
      return jsonResponse({ enabled: true, misconfigured: false, paymentMethods });
    }
    if (url.endsWith("/orders/me") && method === "GET") {
      return jsonResponse({ orders });
    }
    if (url.endsWith("/orders") && method === "POST") {
      calls.create.push(init);
      return jsonResponse({ order: order("new-order", "PENDING", null) });
    }
    if (/\/orders\/[^/]+\/pay$/.test(url) && method === "POST") {
      calls.pay.push({ url, init });
      return jsonResponse({ orderId: url.split("/").at(-2), paymentUrl: "#mock-payment" });
    }
    if (/\/orders\/[^/]+\/cancel$/.test(url) && method === "POST") {
      calls.cancel.push({ url, init });
      if (cancelResponse) return cancelResponse;
      const orderId = url.split("/").at(-2);
      const existingOrder = orders.find((currentOrder) => currentOrder.id === orderId);
      if (!existingOrder) return jsonResponse({ message: "not found" }, 404);
      return jsonResponse({
        order: {
          ...existingOrder,
          status: "CANCELLED",
          updatedAt: "2026-08-20T08:10:00.000Z"
        }
      });
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function renderBilling(scenario: BillingScenario) {
  const calls = mockBillingFetch(scenario);
  const currentPlan = scenario.currentPlan ?? plan;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);

  await act(async () => {
    root?.render(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <BillingPurchaseContent
          token="token"
          remainingCredits={100}
          initialPlans={[currentPlan]}
          initialOrders={scenario.orders}
          initialPaymentStatus={{
            enabled: true,
            misconfigured: false,
            paymentMethods: scenario.paymentMethods
          }}
          onClose={vi.fn()}
        />
      </I18nContext.Provider>
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  return calls;
}

async function renderGuestBilling({
  onRequireLogin,
  onPurchase
}: {
  onRequireLogin: () => void;
  onPurchase: (planId: string) => void;
}) {
  const guestPlan: PlanSummary = {
    ...plan,
    features: ["Faster access", "More creative capacity"]
  };
  const calls = mockBillingFetch({
    orders: [],
    paymentMethods: ["alipay", "wxpay"],
    currentPlan: guestPlan
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);

  await act(async () => {
    root?.render(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <BillingPurchaseContent
          token={null}
          remainingCredits={null}
          initialPlans={[guestPlan]}
          initialPaymentStatus={{
            enabled: true,
            misconfigured: false,
            paymentMethods: ["alipay", "wxpay"]
          }}
          onPurchase={onPurchase}
          onRequireLogin={onRequireLogin}
          onClose={vi.fn()}
        />
      </I18nContext.Provider>
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  return calls;
}

async function click(selector: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`button not found: ${selector}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dialogButton(label: string): HTMLButtonElement | undefined {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  return Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((button) => button.textContent?.trim() === label);
}

function payBody(calls: Awaited<ReturnType<typeof renderBilling>>, index = 0) {
  return JSON.parse(String(calls.pay[index]?.init.body)) as { paymentType: string };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("BillingPurchaseContent pending-order recovery", () => {
  it("keeps the new-purchase path at one create and one pay request", async () => {
    const calls = await renderBilling({ orders: [], paymentMethods: ["alipay"] });

    expect(document.querySelector('[data-billing-plan-action="purchase"]')?.textContent).toContain("Buy and pay");
    await click('[data-billing-plan-action="purchase"]');

    expect(calls.create).toHaveLength(1);
    expect(calls.pay).toHaveLength(1);
    expect(calls.pay[0]?.url).toContain("/orders/new-order/pay");
  });

  it("shows pending context and resumes the existing order without creating one", async () => {
    const pending = order("existing-order", "PENDING", "alipay");
    const calls = await renderBilling({ orders: [pending], paymentMethods: ["alipay"] });

    expect(document.querySelector('[data-pending-order-id="existing-order"]')?.textContent).toContain("Pending order");
    expect(document.querySelector('[data-pending-order-id="existing-order"]')?.textContent).toContain("Alipay");
    expect(document.querySelector('[data-billing-plan-action="resume"]')?.textContent).toContain("Continue payment");
    expect(document.querySelector('[data-billing-order-cancel="true"]')?.textContent).toContain("Cancel order");
    await click('[data-billing-plan-action="resume"]');

    expect(calls.create).toHaveLength(0);
    expect(calls.pay).toHaveLength(1);
    expect(calls.pay[0]?.url).toContain("/orders/existing-order/pay");
  });

  it("uses the pending order snapshot and does not couple resume to current plan eligibility", async () => {
    const currentPlan: PlanSummary = {
      ...plan,
      name: "Pro credits current",
      price: 2990,
      credits: 5000,
      description: "Current package includes 5000 credits.",
      enabled: false
    };
    const pending: OrderSummary = {
      ...order("existing-order", "PENDING", "alipay"),
      planName: "Pro credits legacy",
      amount: 990,
      credits: 1200
    };
    const calls = await renderBilling({
      orders: [pending],
      paymentMethods: ["alipay"],
      currentPlan
    });
    const article = document.querySelector("[data-billing-plan-action='resume']")?.closest("article");
    const action = document.querySelector<HTMLButtonElement>("[data-billing-plan-action='resume']");

    expect(article?.textContent).toContain("Pro credits legacy");
    expect(article?.textContent).toContain("¥9.90");
    expect(article?.textContent).toContain("1,200");
    expect(article?.textContent).not.toContain("Pro credits current");
    expect(article?.textContent).not.toContain("¥29.90");
    expect(article?.textContent).not.toContain("5,000");
    expect(article?.textContent).not.toContain("5000");
    expect(action?.disabled).toBe(false);

    await click("[data-billing-plan-action='resume']");

    expect(calls.create).toHaveLength(0);
    expect(calls.pay).toHaveLength(1);
    expect(calls.pay[0]?.url).toContain("/orders/existing-order/pay");
  });

  it("uses the pending order's alipay method when the current selection is wxpay", async () => {
    const pending = order("existing-order", "PENDING", "alipay");
    const calls = await renderBilling({
      orders: [pending],
      paymentMethods: ["alipay", "wxpay"]
    });

    await click("button[aria-pressed='false']");
    await click('[data-billing-plan-action="resume"]');

    expect(calls.create).toHaveLength(0);
    expect(payBody(calls)).toEqual({ paymentType: "alipay" });
  });

  it("uses the selected enabled method when the pending order has no payment type", async () => {
    const pending = order("existing-order", "PENDING", null);
    const calls = await renderBilling({
      orders: [pending],
      paymentMethods: ["alipay", "wxpay"]
    });

    await click("button[aria-pressed='false']");
    await click('[data-billing-plan-action="resume"]');

    expect(calls.create).toHaveLength(0);
    expect(payBody(calls)).toEqual({ paymentType: "wxpay" });
  });

  it("blocks resume when the original method is no longer enabled", async () => {
    const pending = order("existing-order", "PENDING", "wxpay");
    const calls = await renderBilling({ orders: [pending], paymentMethods: ["alipay"] });
    const action = document.querySelector<HTMLButtonElement>('[data-billing-plan-action="resume"]');

    expect(action?.disabled).toBe(true);
    expect(document.body.textContent).toContain("original payment method is no longer available");
    action?.click();
    await act(async () => Promise.resolve());

    expect(calls.create).toHaveLength(0);
    expect(calls.pay).toHaveLength(0);
  });

  it("does not expose Continue payment for paid or cancelled orders", async () => {
    await renderBilling({
      orders: [
        order("paid-order", "PAID", "alipay"),
        order("cancelled-order", "CANCELLED", "alipay")
      ],
      paymentMethods: ["alipay"]
    });

    expect(document.querySelector('[data-billing-plan-action="resume"]')).toBeNull();
    expect(document.querySelector('[data-billing-order-cancel="true"]')).toBeNull();
    expect(document.querySelector('[data-billing-plan-action="purchase"]')?.textContent).toContain("Buy and pay");
  });

  it("opens the shared confirmation without cancelling until the user confirms", async () => {
    const pending = order("existing-order", "PENDING", "alipay");
    const calls = await renderBilling({ orders: [pending], paymentMethods: ["alipay"] });

    await click('[data-billing-order-cancel="true"]');

    expect(calls.cancel).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Cancel this order?");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "It does not cancel a payment already in progress with the payment provider."
    );
  });

  it("keeps the pending order when the cancellation confirmation is dismissed", async () => {
    const pending = order("existing-order", "PENDING", "alipay");
    const calls = await renderBilling({ orders: [pending], paymentMethods: ["alipay"] });

    await click('[data-billing-order-cancel="true"]');
    await act(async () => dialogButton("Close")?.click());

    expect(calls.cancel).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[data-pending-order-id="existing-order"]')).not.toBeNull();
    expect(document.querySelector('[data-billing-plan-action="resume"]')).not.toBeNull();
    expect(document.querySelector('[data-billing-order-cancel="true"]')).not.toBeNull();
  });

  it("cancels once with bearer auth and immediately restores the purchase action", async () => {
    const pending = order("existing-order", "PENDING", "alipay");
    const calls = await renderBilling({ orders: [pending], paymentMethods: ["alipay"] });

    await click('[data-billing-order-cancel="true"]');
    await act(async () => {
      dialogButton("Cancel order")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.cancel).toEqual([
      {
        url: "/api/orders/existing-order/cancel",
        init: {
          method: "POST",
          headers: { Authorization: "Bearer token" }
        }
      }
    ]);
    expect(document.querySelector('[data-pending-order-context="true"]')).toBeNull();
    expect(document.querySelector('[data-billing-plan-action="resume"]')).toBeNull();
    expect(document.querySelector('[data-billing-order-cancel="true"]')).toBeNull();
    expect(document.querySelector('[data-billing-plan-action="purchase"]')?.textContent).toContain("Buy and pay");
    expect(document.body.textContent).toContain("Order cancelled.");
  });

  it("guards duplicate cancellation submits and disables resume while cancellation is pending", async () => {
    let resolveCancel!: (response: Response) => void;
    const pending = order("existing-order", "PENDING", "alipay");
    const cancelResponse = new Promise<Response>((resolve) => {
      resolveCancel = resolve;
    });
    const calls = await renderBilling({
      orders: [pending],
      paymentMethods: ["alipay"],
      cancelResponse
    });

    await click('[data-billing-order-cancel="true"]');
    const confirm = dialogButton("Cancel order");
    await act(async () => {
      confirm?.click();
      confirm?.click();
      await Promise.resolve();
    });

    expect(calls.cancel).toHaveLength(1);
    expect(document.querySelector<HTMLButtonElement>('[data-billing-plan-action="resume"]')?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Cancelling…");

    await act(async () => {
      resolveCancel(jsonResponse({ order: { ...pending, status: "CANCELLED" } }));
      await cancelResponse;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.cancel).toHaveLength(1);
  });

  it("keeps the pending UI and shows a safe error when cancellation fails", async () => {
    const pending = order("existing-order", "PENDING", "alipay");
    const calls = await renderBilling({
      orders: [pending],
      paymentMethods: ["alipay"],
      cancelResponse: jsonResponse({ message: "sensitive internal reason" }, 409)
    });

    await click('[data-billing-order-cancel="true"]');
    await act(async () => {
      dialogButton("Cancel order")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.cancel).toHaveLength(1);
    expect(document.querySelector('[data-pending-order-id="existing-order"]')).not.toBeNull();
    expect(document.querySelector('[data-billing-plan-action="resume"]')).not.toBeNull();
    expect(document.querySelector('[data-billing-order-cancel="true"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      "We could not cancel this order. Refresh its status and try again."
    );
    expect(document.body.textContent).not.toContain("sensitive internal reason");
  });
});

describe("BillingPurchaseContent guest plans", () => {
  it("shows public plan data and opens login without invoking purchase overrides", async () => {
    const onRequireLogin = vi.fn();
    const onPurchase = vi.fn();
    const calls = await renderGuestBilling({ onRequireLogin, onPurchase });

    expect(document.querySelector('[data-billing-plans="true"]')?.textContent).toContain("Pro credits");
    expect(document.body.textContent).toContain("¥9.90");
    expect(document.body.textContent).toContain("1,200");
    expect(document.body.textContent).toContain("For regular image and chat use.");
    expect(document.body.textContent).toContain("Faster access");
    expect(document.body.textContent).toContain("More creative capacity");
    expect(document.body.textContent).toContain("Alipay");
    expect(document.body.textContent).toContain("WeChat Pay");
    expect(document.querySelector('[data-billing-plan-action="purchase"]')?.textContent).toContain(
      "Sign in to purchase"
    );

    await click('[data-billing-plan-action="purchase"]');

    expect(onRequireLogin).toHaveBeenCalledTimes(1);
    expect(onPurchase).not.toHaveBeenCalled();
    expect(calls.requests.filter(({ url, method }) => url.endsWith("/plans") && method === "GET")).toHaveLength(1);
    expect(calls.requests.filter(({ url, method }) => url.endsWith("/payments/epay/status") && method === "GET")).toHaveLength(1);
    expect(calls.requests.filter(({ url }) => url.endsWith("/orders/me"))).toHaveLength(0);
    expect(calls.create).toHaveLength(0);
    expect(calls.pay).toHaveLength(0);
    expect(calls.cancel).toHaveLength(0);
  });
});
