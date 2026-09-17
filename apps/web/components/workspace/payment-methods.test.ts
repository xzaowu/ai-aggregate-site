import { describe, expect, it } from "vitest";
import {
  getOrderPaymentMethodLabel,
  getPaymentMethodLabel,
  normalizePaymentMethods,
  resolvePendingOrderPaymentMethod,
  shouldShowPaymentMethodOptions
} from "./payment-methods";

describe("payment method UI helpers", () => {
  it("normalizes supported methods and defaults to alipay", () => {
    expect(normalizePaymentMethods(undefined)).toEqual(["alipay"]);
    expect(normalizePaymentMethods(["alipay", "wxpay", "bitcoin"])).toEqual([
      "alipay",
      "wxpay"
    ]);
  });

  it("shows method options only when more than one supported method is enabled", () => {
    expect(shouldShowPaymentMethodOptions(["alipay"])).toBe(false);
    expect(shouldShowPaymentMethodOptions(["alipay", "wxpay"])).toBe(true);
  });

  it("uses user-facing Chinese payment method labels", () => {
    expect(getPaymentMethodLabel("alipay")).toBe("支付宝");
    expect(getPaymentMethodLabel("wxpay")).toBe("微信支付");
  });

  it("uses selected method before gateway and falls back for old epay-only orders", () => {
    expect(getOrderPaymentMethodLabel("alipay", "epay")).toBe("支付宝");
    expect(getOrderPaymentMethodLabel("wxpay", "epay")).toBe("微信支付");
    expect(getOrderPaymentMethodLabel(null, "epay")).toBe("在线支付");
    expect(getOrderPaymentMethodLabel(null, null)).toBe("-");
  });

  it("preserves an enabled pending-order payment method instead of the current selection", () => {
    expect(
      resolvePendingOrderPaymentMethod(
        "alipay",
        ["alipay", "wxpay"],
        "wxpay"
      )
    ).toBe("alipay");
  });

  it("uses the selected enabled method only when the pending order has no method", () => {
    expect(
      resolvePendingOrderPaymentMethod(null, ["alipay", "wxpay"], "wxpay")
    ).toBe("wxpay");
  });

  it("rejects a pending-order method that is no longer enabled", () => {
    expect(
      resolvePendingOrderPaymentMethod("wxpay", ["alipay"], "alipay")
    ).toBeNull();
    expect(
      resolvePendingOrderPaymentMethod("legacy-pay", ["alipay"], "alipay")
    ).toBeNull();
  });
});
