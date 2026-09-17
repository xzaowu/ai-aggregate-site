"use client";

import type { OrderSummary } from "@ai-aggregate/shared";
import { ArrowLeft, CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import React from "react";
import { useI18n } from "../../../lib/i18n/use-i18n";
import {
  formatOrderPrice,
  formatShortOrderId
} from "../../../components/workspace/order-display";

export type PaymentResolvedResult =
  | { status: "success"; order: OrderSummary }
  | { status: "pending"; order: OrderSummary }
  | { status: "cancelled"; order: OrderSummary }
  | { status: "not_found" };

export function PaymentResultStatusCard({
  result,
  isRefreshing,
  onRefresh
}: {
  result: PaymentResolvedResult;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();

  if (result.status === "success") {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-slate-950 dark:text-slate-100">
          {t("payment.success")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("payment.successUpdateDelay")}
        </p>
        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <div className="flex justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">{t("pricing.plan")}</span>
            <span className="font-semibold">{result.order.planName}</span>
          </div>
          <div className="mt-1 flex justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">{t("pricing.amount")}</span>
            <span className="font-semibold">
              {formatOrderPrice(result.order.amount, t("pricing.free"))}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">{t("pricing.credits")}</span>
            <span className="font-semibold">{result.order.credits.toLocaleString()}</span>
          </div>
          <div className="mt-1 flex justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">{t("account.orderReference")}</span>
            <span className="text-right font-mono text-xs">
              {formatShortOrderId(result.order.id)}
            </span>
          </div>
        </div>
        <PaymentResultActions
          actions={[
            { href: "/", label: t("payment.backToWorkspace"), primary: true },
            { href: "/account#account-orders", label: t("payment.viewOrders") }
          ]}
        />
      </div>
    );
  }

  if (result.status === "pending") {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:ring-amber-900">
          <Clock3 className="size-7" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-slate-950 dark:text-slate-100">
          {t("payment.incomplete")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("payment.pendingFailureGuidance")}
        </p>
        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-left text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <span className="font-medium">{t("account.orderReference")}:</span>{" "}
          <span className="font-mono">{formatShortOrderId(result.order.id)}</span>
        </div>
        <div className="mt-6">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            {t("payment.refreshStatus")}
          </button>
        </div>
        <PaymentResultActions
          actions={[
            {
              href: "/account#account-orders",
              label: t("payment.continueFromOrders"),
              primary: true
            }
          ]}
        />
      </div>
    );
  }

  return (
    <div className="text-center">
      <XCircle className="mx-auto size-12 text-red-400 dark:text-red-500" aria-hidden="true" />
      <h2 className="mt-4 text-xl font-semibold text-slate-950 dark:text-slate-100">
        {t("payment.incomplete")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
        {result.status === "cancelled"
          ? t("payment.cancelledGuidance")
          : t("payment.pendingFailureGuidance")}
      </p>
      <PaymentResultActions
        actions={[
          {
            href: "/account#account-orders",
            label: t("payment.viewOrders"),
            primary: true
          }
        ]}
      />
    </div>
  );
}

function PaymentResultActions({
  actions
}: {
  actions: Array<{ href: string; label: string; primary?: boolean }>;
}) {
  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-center dark:border-slate-700">
      {actions.map((action) => (
        <Link
          key={`${action.href}-${action.label}`}
          href={action.href}
          className={
            action.primary
              ? "inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 dark:hover:bg-indigo-500"
              : "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300"
          }
        >
          {action.href === "/" ? <ArrowLeft className="size-4" aria-hidden="true" /> : null}
          {action.label}
        </Link>
      ))}
    </div>
  );
}
