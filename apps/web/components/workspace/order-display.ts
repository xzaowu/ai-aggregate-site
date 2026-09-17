import type { OrderSummary } from "@ai-aggregate/shared";

export function formatOrderPrice(price: number, freeLabel: string): string {
  return price === 0 ? freeLabel : `¥${(price / 100).toFixed(2)}`;
}

export function formatShortOrderId(orderId: string): string {
  const normalized = orderId.trim();
  if (normalized.length <= 12) return normalized;

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export function canRepurchaseOrder(status: OrderSummary["status"]): boolean {
  return status === "CANCELLED";
}
