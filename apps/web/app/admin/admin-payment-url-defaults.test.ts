import { describe, expect, it } from "vitest";
import {
  completeEpayUrlsForSave,
  getRecommendedEpayUrls
} from "./admin-payment-url-defaults";

describe("admin payment URL defaults", () => {
  it("builds recommended EPay URLs from the configured app URL", () => {
    expect(
      getRecommendedEpayUrls({
        appUrl: "https://chat.example.com/",
        currentOrigin: "https://admin.example.com"
      })
    ).toEqual({
      notifyUrl: "https://chat.example.com/api/payments/epay/notify",
      returnUrl: "https://chat.example.com/payment/result"
    });
  });

  it("falls back to the current browser origin", () => {
    expect(
      getRecommendedEpayUrls({
        appUrl: null,
        currentOrigin: "https://admin.example.com"
      })
    ).toEqual({
      notifyUrl: "https://admin.example.com/api/payments/epay/notify",
      returnUrl: "https://admin.example.com/payment/result"
    });
  });

  it("fills missing URLs before saving enabled EPay settings", () => {
    expect(
      completeEpayUrlsForSave({
        enabled: true,
        notifyUrl: "",
        returnUrl: "",
        recommended: {
          notifyUrl: "https://site.example.com/api/payments/epay/notify",
          returnUrl: "https://site.example.com/payment/result"
        }
      })
    ).toEqual({
      notifyUrl: "https://site.example.com/api/payments/epay/notify",
      returnUrl: "https://site.example.com/payment/result"
    });
  });
});
