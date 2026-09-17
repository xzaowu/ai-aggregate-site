import type { OrderSummary } from "@ai-aggregate/shared";
import { describe, expect, it } from "vitest";
import {
  ORDER_PREVIEW_LIMIT,
  findPendingOrderForPlan,
  getVisibleOrders,
  shouldBlockPlanPurchase
} from "./order-list";

function order(id: string, planId: string, status: OrderSummary["status"]): OrderSummary {
  return {
    id,
    userId: "user_1",
    planId,
    planName: planId,
    amount: 990,
    credits: 100,
    status,
    paymentProvider: status === "PENDING" ? "epay" : null,
    paymentType: status === "PENDING" ? "alipay" : null,
    paymentTradeNo: status === "PENDING" ? `trade_${id}` : null,
    providerTradeNo: null,
    paymentUrl: null,
    paidAt: null,
    createdAt: `2026-06-16T00:00:0${id}.000Z`,
    updatedAt: `2026-06-16T00:00:0${id}.000Z`
  };
}

describe("workspace order-list helpers", () => {
  const orders = [
    order("1", "plan_a", "PENDING"),
    order("2", "plan_b", "PAID"),
    order("3", "plan_c", "CANCELLED"),
    order("4", "plan_d", "PENDING"),
    order("5", "plan_e", "PAID"),
    order("6", "plan_f", "PENDING")
  ];

  it("limits visible orders by default and can reveal all orders", () => {
    expect(ORDER_PREVIEW_LIMIT).toBe(5);
    expect(getVisibleOrders(orders, false)).toHaveLength(5);
    expect(getVisibleOrders(orders, true)).toHaveLength(6);
  });

  it("finds a reusable pending order for the same plan only", () => {
    expect(findPendingOrderForPlan(orders, "plan_a")?.id).toBe("1");
    expect(findPendingOrderForPlan(orders, "plan_b")).toBeNull();
    expect(findPendingOrderForPlan(orders, "missing")).toBeNull();
  });

  it("blocks duplicate purchase requests while one is pending or in flight", () => {
    expect(shouldBlockPlanPurchase("plan_a", orders, new Set())).toBe(true);
    expect(shouldBlockPlanPurchase("plan_new", orders, new Set(["plan_new"]))).toBe(true);
    expect(shouldBlockPlanPurchase("plan_new", orders, new Set())).toBe(false);
  });
});
