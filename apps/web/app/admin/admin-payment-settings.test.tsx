// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPaymentSettings } from "./admin-payment-settings";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  completeEpayUrlsForSave,
  getRecommendedEpayUrls
} from "./admin-payment-url-defaults";
import { normalizePaymentMethods } from "../../components/workspace/payment-methods";

vi.mock("../../lib/site-config", () => ({
  siteConfig: { apiBaseUrl: "http://localhost:4000" },
  apiUrl: (path: string) => `http://localhost:4000${path}`
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderWithLocale(locale: "zh-CN" | "en-US" = "zh-CN") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{ locale, setLocale: vi.fn(), t: createTranslator(locale) }}
    >
      <AdminPaymentSettings token="mock-token" />
    </I18nContext.Provider>
  );
}

const loadedPaymentSettings = {
  enabled: true,
  gatewayUrl: "https://epay.example.com/submit.php",
  pid: "1001",
  notifyUrl: "",
  returnUrl: "",
  paymentMethods: ["wxpay", "wxpay"],
  hasKey: true,
  source: "database" as const,
  misconfigured: false,
  missingFields: []
};

let interactionRoot: Root | null = null;
let interactionHost: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => interactionRoot?.unmount());
  interactionRoot = null;
  interactionHost?.remove();
  interactionHost = null;
  vi.unstubAllGlobals();
});

async function mountLoadedPaymentSettings() {
  const host = document.createElement("div");
  interactionHost = host;
  document.body.append(host);
  const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "PATCH") {
      return new Response(JSON.stringify(loadedPaymentSettings), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify(loadedPaymentSettings), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  interactionRoot = createRoot(host);

  await act(async () => {
    interactionRoot?.render(
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <AdminPaymentSettings token="payment-test-token" />
      </I18nContext.Provider>
    );
  });
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  return { fetchMock, host };
}

describe("admin payment settings", () => {
  it("renders payment settings section in loading state", () => {
    const html = renderWithLocale();
    // Should show loading text while fetching
    expect(html).toContain("正在加载管理数据");
  });

  it("has leave-key-blank i18n key", () => {
    const t = createTranslator("zh-CN");
    expect(t("admin.leaveKeyBlank")).toBe("留空则保留当前密钥");
  });

  it("has key-cannot-be-viewed i18n key", () => {
    const t = createTranslator("zh-CN");
    expect(t("admin.keyCannotBeViewed")).toBe("密钥保存后不可查看");
  });

  it("has hasKey i18n keys", () => {
    const t = createTranslator("zh-CN");
    expect(t("admin.keyConfigured")).toBe("密钥已配置");
    expect(t("admin.keyNotConfigured")).toBe("密钥未配置");
  });

  it("has payment config status i18n keys", () => {
    const t = createTranslator("zh-CN");
    expect(t("admin.paymentConfigComplete")).toBe("支付配置完整");
    expect(t("admin.paymentConfigIncomplete")).toBe("支付配置不完整");
  });

  it("has English translations for all payment settings keys", () => {
    const t = createTranslator("en-US");
    expect(t("admin.leaveKeyBlank")).toBe("Leave blank to keep current key");
    expect(t("admin.keyCannotBeViewed")).toBe("The key cannot be viewed after saving");
    expect(t("admin.keyConfigured")).toBe("Key configured");
    expect(t("admin.keyNotConfigured")).toBe("Key not configured");
    expect(t("admin.paymentConfigComplete")).toBe("Payment configuration complete");
    expect(t("admin.paymentConfigIncomplete")).toBe("Payment configuration incomplete");
  });

  it("payment settings i18n keys do not expose EPAY_KEY", () => {
    const t = createTranslator("zh-CN");
    const tEn = createTranslator("en-US");
    const keys = [
      "admin.leaveKeyBlank",
      "admin.keyCannotBeViewed",
      "admin.keyConfigured",
      "admin.keyNotConfigured",
      "admin.merchantKey",
      "admin.paymentConfigComplete",
      "admin.paymentConfigIncomplete"
    ];
    for (const key of keys) {
      expect(t(key)).not.toContain("EPAY_KEY");
      expect(tEn(key)).not.toContain("EPAY_KEY");
    }
  });

  it("keeps recommended URL completion and payment method normalization contracts", () => {
    const recommended = getRecommendedEpayUrls({ appUrl: "https://admin.example" });

    expect(
      completeEpayUrlsForSave({
        enabled: true,
        notifyUrl: " ",
        returnUrl: "",
        recommended
      })
    ).toEqual(recommended);

    expect(normalizePaymentMethods(loadedPaymentSettings.paymentMethods)).toEqual([
      "alipay",
      "wxpay"
    ]);
  });

  it("renders shared payment form status, field associations, and safe secret state", async () => {
    const { host } = await mountLoadedPaymentSettings();

    const status = host.querySelector('[data-admin-form-message="success"]');
    expect(status?.getAttribute("role")).toBe("status");
    expect(host.querySelector('[data-admin-form-section="true"]')).toBeTruthy();
    expect(host.querySelector('[data-admin-form-actions="true"]')).toBeTruthy();

    const keyInput = host.querySelector<HTMLInputElement>('input[type="password"]');
    expect(keyInput?.value).toBe("");
    const describedBy = keyInput?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(host.querySelector(`[id="${describedBy}"]`)).toBeTruthy();
    expect(host.textContent).not.toContain("sk-");
    expect(host.querySelector<HTMLButtonElement>('button[type="button"]:disabled')).toBeNull();
  });

  it("omits a blank merchant key while preserving completed URLs and normalized methods", async () => {
    const { fetchMock, host } = await mountLoadedPaymentSettings();
    const saveButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save settings"
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    if (!patchCall) throw new Error("missing payment PATCH");
    const body = JSON.parse(String(patchCall[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("key");
    expect(body.notifyUrl).toBe("http://localhost:3000/api/payments/epay/notify");
    expect(body.returnUrl).toBe("http://localhost:3000/payment/result");
    expect(body.paymentMethods).toEqual(["alipay", "wxpay"]);
  });
});
