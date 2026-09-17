import type { OrderSummary } from "@ai-aggregate/shared";

export const ORDER_PREVIEW_LIMIT = 5;

export function getVisibleOrders(
  orders: OrderSummary[],
  showAll: boolean
): OrderSummary[] {
  return showAll ? orders : orders.slice(0, ORDER_PREVIEW_LIMIT);
}

export function findPendingOrderForPlan(
  orders: OrderSummary[],
  planId: string
): OrderSummary | null {
  return (
    orders.find((order) => order.planId === planId && order.status === "PENDING") ??
    null
  );
}

export function shouldBlockPlanPurchase(
  planId: string,
  orders: OrderSummary[],
  inFlightPlanIds: ReadonlySet<string>
): boolean {
  return inFlightPlanIds.has(planId) || findPendingOrderForPlan(orders, planId) !== null;
}
