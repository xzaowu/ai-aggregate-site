"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { apiUrl, siteConfig } from "../../lib/site-config";
import {
  completeEpayUrlsForSave,
  getRecommendedEpayUrls
} from "./admin-payment-url-defaults";
import {
  getPaymentMethodLabel,
  normalizePaymentMethods,
  type PaymentMethod
} from "../../components/workspace/payment-methods";
import {
  AdminFormActions,
  AdminFormField,
  AdminFormMessage,
  AdminFormSection,
  adminControlClass
} from "./admin-layout";

interface EpaySettingsResponse {
  enabled: boolean;
  gatewayUrl: string;
  pid: string;
  notifyUrl: string;
  returnUrl: string;
  paymentMethods?: string[];
  hasKey: boolean;
  source: "database" | "env" | "mixed" | "none";
  misconfigured: boolean;
  missingFields: string[];
}

export function AdminPaymentSettings({ token }: { token?: string | null }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<EpaySettingsResponse | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [pid, setPid] = useState("");
  const [key, setKey] = useState("");
  const [notifyUrl, setNotifyUrl] = useState("");
  const [returnUrl, setReturnUrl] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([
    "alipay"
  ]);
  const recommendedUrls = getRecommendedEpayUrls({
    appUrl: siteConfig.appUrl,
    currentOrigin:
      typeof window === "undefined" ? null : window.location.origin
  });

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(apiUrl("/admin/payment-settings/epay"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as EpaySettingsResponse;
      setSettings(data);
      setEnabled(data.enabled);
      setGatewayUrl(data.gatewayUrl ?? "");
      setPid(data.pid ?? "");
      setKey("");
      setNotifyUrl(data.notifyUrl ?? "");
      setReturnUrl(data.returnUrl ?? "");
      setPaymentMethods(normalizePaymentMethods(data.paymentMethods));
    } catch {
      setError(t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  function useRecommendedUrls() {
    setNotifyUrl(recommendedUrls.notifyUrl);
    setReturnUrl(recommendedUrls.returnUrl);
  }

  function togglePaymentMethod(method: PaymentMethod) {
    setPaymentMethods((current) => {
      const exists = current.includes(method);
      const next = exists
        ? current.filter((candidate) => candidate !== method)
        : [...current, method];

      return normalizePaymentMethods(next);
    });
  }

  async function save() {
    if (!token) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const completedUrls = completeEpayUrlsForSave({
        enabled,
        notifyUrl,
        returnUrl,
        recommended: recommendedUrls
      });

      const body: Record<string, unknown> = {
        enabled,
        gatewayUrl,
        pid,
        notifyUrl: completedUrls.notifyUrl,
        returnUrl: completedUrls.returnUrl,
        paymentMethods
      };

      // Only send key if it was entered
      if (key.trim()) {
        body.key = key.trim();
      }

      const res = await fetch(apiUrl("/admin/payment-settings/epay"), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = t("admin.updateSettingsFailed");
        try {
          const parsed = JSON.parse(text) as { message?: string };
          if (parsed.message) msg = parsed.message;
        } catch { /* use fallback */ }
        throw new Error(msg);
      }

      setKey("");
      setNotifyUrl(completedUrls.notifyUrl);
      setReturnUrl(completedUrls.returnUrl);
      setMessage(t("admin.paymentSettingsSaved"));
      await load(); // Reload to get updated hasKey status
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.updateSettingsFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        {t("admin.loading")}
      </div>
    );
  }

  return (
    <section className="grid min-w-0 gap-6">
      {/* Config status */}
      {settings ? (
        <AdminFormMessage
          live="polite"
          role="status"
          tone={settings.misconfigured ? "warning" : settings.enabled ? "success" : "neutral"}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {settings.misconfigured
                ? t("admin.paymentConfigIncomplete")
                : settings.enabled
                  ? t("admin.paymentConfigComplete")
                  : t("payment.disabled")}
            </span>
            <span className="text-xs opacity-70">
              ({t("admin.paymentGateway")}: {settings.source})
            </span>
          </div>
          {settings.misconfigured && settings.missingFields.length > 0 ? (
            <div className="mt-1 text-xs">
              {t("admin.missingFields")}: {settings.missingFields.join(", ")}
            </div>
          ) : null}
          <div className="mt-1 text-xs">
            {settings.hasKey ? t("admin.keyConfigured") : t("admin.keyNotConfigured")}
          </div>
        </AdminFormMessage>
      ) : null}

      {message ? (
        <AdminFormMessage
          className="flex items-center justify-between gap-3"
          role="status"
          tone="success"
        >
          <span>{message}</span>
          <button
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-emerald-700 transition hover:bg-emerald-100"
            aria-label={t("admin.dismissMessage")}
            onClick={() => setMessage(null)}
          >
            x
          </button>
        </AdminFormMessage>
      ) : null}
      {error ? (
        <AdminFormMessage live="assertive" role="alert" tone="error">
          {error}
        </AdminFormMessage>
      ) : null}

      {/* Form */}
      <AdminFormSection title={t("admin.paymentSettings")}>
        <label className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          <span>{t("admin.enableEpay")}</span>
          <input
            checked={enabled}
            className="size-4 rounded border-slate-300 text-indigo-600"
            type="checkbox"
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>

        <AdminFormField label={t("admin.paymentGateway")}>
          <input
            className={`${adminControlClass} font-mono`}
            type="url"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            placeholder="https://epay.example.com/submit.php"
          />
        </AdminFormField>

        <AdminFormField label={t("admin.merchantPid")}>
          <input
            className={`${adminControlClass} font-mono`}
            type="text"
            value={pid}
            onChange={(e) => setPid(e.target.value)}
            placeholder="1001"
          />
        </AdminFormField>

        <AdminFormField
          help={`${t("admin.keyCannotBeViewed")} — ${t("admin.leaveKeyBlank")}`}
          label={t("admin.merchantKey")}
        >
          <input
            className={`${adminControlClass} font-mono`}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("admin.leaveKeyBlank")}
          />
        </AdminFormField>

        <AdminFormField label={t("admin.paymentNotifyUrl")}>
          <input
            className={`${adminControlClass} font-mono`}
            type="url"
            value={notifyUrl}
            onChange={(e) => setNotifyUrl(e.target.value)}
            placeholder={recommendedUrls.notifyUrl}
          />
        </AdminFormField>

        <AdminFormField label={t("admin.paymentReturnUrl")}>
          <input
            className={`${adminControlClass} font-mono`}
            type="url"
            value={returnUrl}
            onChange={(e) => setReturnUrl(e.target.value)}
            placeholder={recommendedUrls.returnUrl}
          />
        </AdminFormField>

        <fieldset className="grid min-w-0 gap-2 text-sm font-medium text-slate-700">
          <legend>{t("admin.paymentMethods")}</legend>
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-normal text-slate-700 sm:grid-cols-2">
            {(["alipay", "wxpay"] as PaymentMethod[]).map((method) => (
              <label key={method} className="inline-flex min-h-10 items-center gap-2">
                <input
                  checked={paymentMethods.includes(method)}
                  className="size-4 rounded border-slate-300 text-indigo-600"
                  type="checkbox"
                  onChange={() => togglePaymentMethod(method)}
                />
                {getPaymentMethodLabel(method)}
              </label>
            ))}
          </div>
          <p className="text-xs leading-5 text-slate-500">
            {t("admin.paymentMethodsHelp")}
          </p>
        </fieldset>

        <AdminFormActions className="justify-start sm:justify-end">
          <button
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 disabled:text-slate-300 sm:w-auto"
            type="button"
            disabled={!recommendedUrls.notifyUrl || !recommendedUrls.returnUrl}
            onClick={useRecommendedUrls}
          >
            {t("admin.useRecommendedPaymentUrls")}
          </button>

          <button
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:bg-slate-300 sm:w-auto"
            type="button"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? t("admin.saving") : t("admin.saveSettings")}
          </button>
        </AdminFormActions>
      </AdminFormSection>
    </section>
  );
}
