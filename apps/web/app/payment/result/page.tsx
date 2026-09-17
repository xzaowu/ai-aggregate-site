"use client";

import type { OrderSummary } from "@ai-aggregate/shared";
import { RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { readStoredAuthState } from "../../../components/auth-state";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../lib/site-config";
import {
  PaymentResultStatusCard,
  type PaymentResolvedResult
} from "./payment-result-status-card";

type ResultState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | PaymentResolvedResult
  | { status: "error"; message: string };

function PaymentResultInner() {
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [result, setResult] = useState<ResultState>({ status: "loading" });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkOrderStatus = useCallback(async () => {
    const { token } = readStoredAuthState(window.localStorage);
    if (!token) {
      setResult({ status: "unauthenticated" });
      return;
    }

    setIsRefreshing(true);

    try {
      const res = await fetch(apiUrl("/orders/me"), {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.status === 401) {
        setResult({ status: "unauthenticated" });
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to fetch orders");
      }

      const data = (await res.json()) as { orders: OrderSummary[] };
      const orders = data.orders ?? [];

      // Try to find the order: first by trade_no in query, then latest order
      const tradeNo = searchParams.get("out_trade_no")?.trim();
      const orderId = searchParams.get("orderId")?.trim();

      let matched: OrderSummary | undefined;

      if (tradeNo) {
        matched = orders.find((o) => o.paymentTradeNo === tradeNo);
      }
      if (!matched && orderId) {
        matched = orders.find((o) => o.id === orderId);
      }
      if (!matched) {
        // Fall back to latest order (most recent first)
        matched = orders[0];
      }

      if (!matched) {
        setResult({ status: "not_found" });
        return;
      }

      if (matched.status === "PAID") {
        setResult({ status: "success", order: matched });
      } else if (matched.status === "PENDING") {
        setResult({ status: "pending", order: matched });
      } else if (matched.status === "CANCELLED") {
        setResult({ status: "cancelled", order: matched });
      } else {
        setResult({ status: "not_found" });
      }
    } catch (err) {
      setResult({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load payment result"
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void checkOrderStatus();
  }, [checkOrderStatus]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold text-slate-950 dark:text-slate-100">
          {t("payment.result")}
        </h1>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
          {result.status === "loading" ? (
            <div className="text-center">
              <RefreshCw className="mx-auto size-10 animate-spin text-slate-300 dark:text-slate-600" aria-hidden="true" />
              <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("payment.loadingResult")}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t("payment.loadingResultDescription")}
              </p>
            </div>
          ) : result.status === "unauthenticated" ? (
            <div className="text-center">
              <XCircle className="mx-auto size-12 text-amber-400" aria-hidden="true" />
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{t("account.loginPrompt")}</p>
              <div className="mt-6">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  {t("nav.login")}
                </Link>
              </div>
            </div>
          ) : result.status === "success" ||
            result.status === "pending" ||
            result.status === "cancelled" ||
            result.status === "not_found" ? (
            <PaymentResultStatusCard
              result={result}
              isRefreshing={isRefreshing}
              onRefresh={() => void checkOrderStatus()}
            />
          ) : result.status === "error" ? (
            <div className="text-center">
              <XCircle className="mx-auto size-12 text-red-400" aria-hidden="true" />
              <p className="mt-4 text-sm text-red-600 dark:text-red-400">{result.message}</p>
              <div className="mt-4">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={() => void checkOrderStatus()}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {t("payment.refreshStatus")}
                </button>
              </div>
            </div>
          ) : null}

        </div>
      </div>
    </div>
  );
}

export default function PaymentResultPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950">
        <RefreshCw className="size-8 animate-spin text-slate-300 dark:text-slate-600" aria-hidden="true" />
      </div>
    }>
      <PaymentResultInner />
    </Suspense>
  );
}
