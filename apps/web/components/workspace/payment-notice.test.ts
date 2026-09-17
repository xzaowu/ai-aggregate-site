import { describe, expect, it } from "vitest";
import { getPricingPaymentNoticeKey } from "./payment-notice";

describe("pricing payment notice", () => {
  it("uses the online notice only when EPay is enabled and complete", () => {
    expect(
      getPricingPaymentNoticeKey({
        enabled: true,
        misconfigured: false
      })
    ).toBe("pricing.onlineNotice");
  });

  it("uses the manual notice when EPay is disabled or incomplete", () => {
    expect(
      getPricingPaymentNoticeKey({
        enabled: false,
        misconfigured: false
      })
    ).toBe("pricing.manualNotice");
    expect(
      getPricingPaymentNoticeKey({
        enabled: true,
        misconfigured: true
      })
    ).toBe("pricing.manualNotice");
    expect(getPricingPaymentNoticeKey(null)).toBe("pricing.manualNotice");
  });
});
