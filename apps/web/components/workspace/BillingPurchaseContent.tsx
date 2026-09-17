"use client";

import type { OrderSummary, PlanSummary } from "@ai-aggregate/shared";
import { Check, CreditCard, Loader2, ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import type { PublicEpayStatus } from "./payment-notice";
import {
  getOrderPaymentMethodLabel,
  getPaymentMethodLabel,
  isPaymentMethod,
  resolvePendingOrderPaymentMethod,
  shouldShowPaymentMethodOptions
} from "./payment-methods";
import { findPendingOrderForPlan } from "./order-list";
import { ConfirmDialog } from "./ConfirmDialog";
import { useBilling } from "./use-billing";

type BillingPurchaseContentProps = {
  readonly token: string | null;
  readonly remainingCredits: number | null;
  readonly initialPlans?: readonly PlanSummary[];
  readonly initialOrders?: readonly OrderSummary[];
  readonly initialPaymentStatus?: PublicEpayStatus | null;
  readonly onOrderCreated?: () => void;
  readonly onPurchase?: (planId: string) => void;
  readonly onClose: () => void;
  readonly onRequireLogin?: () => void;
};

export function runBillingPurchase(
  purchase: (planId: string) => void,
  planId: string
): void {
  purchase(planId);
}

function formatPrice(price: number, freeLabel: string): string {
  return price === 0 ? freeLabel : `¥${(price / 100).toFixed(2)}`;
}

function formatOrderCreatedAt(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US");
}

export function BillingPurchaseContent({
  token,
  remainingCredits,
  initialPlans,
  initialOrders,
  initialPaymentStatus,
  onOrderCreated,
  onPurchase,
  onClose,
  onRequireLogin
}: BillingPurchaseContentProps) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [cancelOrder, setCancelOrder] = React.useState<OrderSummary | null>(null);
  const cancelOrderSubmitInFlightRef = React.useRef(false);
  const billing = useBilling({
    token,
    initialPlans,
    initialOrders,
    initialPaymentStatus,
    onOrderCreated,
    onRequireLogin
  });
  const paymentMethodLabels = {
    alipay: t("billing.alipay"),
    wxpay: t("billing.wechatPay"),
    onlinePayment: t("payment.onlinePayment"),
    empty: "-"
  };
  const purchase = onPurchase ?? ((planId: string) => void billing.purchase(planId));

  return (
    <div className="grid gap-5" data-billing-purchase-content="true">
      {billing.paymentStatus?.enabled ? (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t("billing.paymentMethod")}
          </legend>
          {shouldShowPaymentMethodOptions(billing.paymentMethods) ? (
            <div className="grid grid-cols-2 gap-2">
              {billing.paymentMethods.map((method) => (
                <button
                  key={method}
                  type="button"
                  className={
                    billing.selectedPaymentMethod === method
                      ? "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-100 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-800"
                      : "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-indigo-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
                  }
                  aria-pressed={billing.selectedPaymentMethod === method}
                  onClick={() => billing.setSelectedPaymentMethod(method)}
                >
                  <CreditCard className="size-4" aria-hidden="true" />
                  {getPaymentMethodLabel(method, paymentMethodLabels)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {getPaymentMethodLabel(
                billing.paymentMethods[0] ?? "alipay",
                paymentMethodLabels
              )}
            </p>
          )}
        </fieldset>
      ) : null}

      {billing.message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
          {billing.message}
        </p>
      ) : null}
      {billing.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {billing.error}
        </p>
      ) : null}

      {billing.loadState === "loading" ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {t("pricing.loading")}
        </p>
      ) : null}
      {billing.loadState === "error" ? (
        <p className="py-4 text-center text-sm text-red-600 dark:text-red-400">
          {t("pricing.loadFailed")}
        </p>
      ) : null}
      {billing.loadState === "ready" ? (
        <div className="grid gap-4 sm:grid-cols-2" data-billing-plans="true">
          {billing.plans.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500 sm:col-span-2 dark:border-slate-700 dark:text-slate-400">
              {t("pricing.noPlans")}
            </p>
          ) : (
            billing.plans.map((plan, index) => {
              const isPurchasable = plan.enabled && plan.price > 0;
              const isProcessing = billing.processingPlanId === plan.id;
              const isFirstPlan = index === 0 && billing.plans.length > 1;
              const pendingOrder = findPendingOrderForPlan(billing.orders, plan.id);
              const pendingPaymentMethod = pendingOrder
                ? resolvePendingOrderPaymentMethod(
                    pendingOrder.paymentType,
                    billing.paymentMethods,
                    billing.selectedPaymentMethod
                  )
                : null;
              const isResumeUnavailable = Boolean(pendingOrder) &&
                (!billing.paymentStatus?.enabled || pendingPaymentMethod === null);
              const displayName = pendingOrder?.planName ?? plan.name;
              const displayPrice = pendingOrder?.amount ?? plan.price;
              const displayCredits = pendingOrder?.credits ?? plan.credits;
              const isCancelling = pendingOrder?.id === billing.cancellingOrderId;
              const isActionDisabled = pendingOrder
                ? isProcessing || isCancelling || isResumeUnavailable
                : !isPurchasable || isProcessing;

              return (
                <article
                  key={plan.id}
                  className={
                    "flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5" +
                    (isFirstPlan ? " ring-1 ring-indigo-100 dark:ring-indigo-800" : "") +
                    " dark:border-slate-700 dark:bg-slate-900"
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 break-words text-base font-semibold text-slate-950 dark:text-slate-100">
                      {displayName}
                    </h3>
                    <strong className="shrink-0 text-base text-slate-950 dark:text-slate-100">
                      {formatPrice(displayPrice, t("pricing.free"))}
                    </strong>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-indigo-700 dark:text-indigo-400">
                    {t("pricing.credits")}: {displayCredits.toLocaleString()}
                  </p>
                  {!pendingOrder ? (
                    <p className="mt-2 flex-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {plan.description}
                    </p>
                  ) : null}
                  {plan.features.length > 0 ? (
                    <ul
                      className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300"
                      data-billing-plan-features="true"
                    >
                      {plan.features.map((feature, featureIndex) => (
                        <li
                          key={`${plan.id}-feature-${featureIndex}`}
                          className="flex min-w-0 items-start gap-2"
                        >
                          <Check
                            className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 break-words">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {pendingOrder ? (
                    <div
                      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                      data-pending-order-context="true"
                      data-pending-order-id={pendingOrder.id}
                    >
                      <p className="font-semibold">{t("billing.pendingOrderTitle")}</p>
                      <dl className="mt-2 grid gap-1 text-xs leading-5 text-amber-800 dark:text-amber-300">
                        <div className="flex justify-between gap-3">
                          <dt>{t("account.status")}</dt>
                          <dd className="font-medium">{t("payment.pending")}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>{t("account.createdAt")}</dt>
                          <dd className="text-right font-medium">
                            {formatOrderCreatedAt(pendingOrder.createdAt, locale)}
                          </dd>
                        </div>
                        {isPaymentMethod(pendingOrder.paymentType) ? (
                          <div className="flex justify-between gap-3">
                            <dt>{t("billing.paymentMethod")}</dt>
                            <dd className="font-medium">
                              {getOrderPaymentMethodLabel(
                                pendingOrder.paymentType,
                                pendingOrder.paymentProvider,
                                paymentMethodLabels
                              )}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      {isPaymentMethod(pendingOrder.paymentType) && pendingPaymentMethod ? (
                        <p className="mt-2 text-xs leading-5">
                          {t("billing.pendingOriginalMethodHint")}
                        </p>
                      ) : null}
                      {isResumeUnavailable ? (
                        <p className="mt-2 text-xs font-medium leading-5 text-red-700 dark:text-red-300" role="alert">
                          {billing.paymentStatus?.enabled
                            ? t("billing.pendingPaymentMethodUnavailable")
                            : t("payment.disabled")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    disabled={isActionDisabled}
                    onClick={() => {
                      if (!token) {
                        onRequireLogin?.();
                        return;
                      }
                      if (pendingOrder) {
                        void billing.resumePayment(pendingOrder);
                        return;
                      }
                      runBillingPurchase(purchase, plan.id);
                    }}
                    data-billing-plan-action={pendingOrder ? "resume" : "purchase"}
                  >
                    {isProcessing ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CreditCard className="size-4" aria-hidden="true" />
                    )}
                    {isProcessing
                      ? t("billing.processing")
                      : pendingOrder
                        ? t("payment.continuePayment")
                      : isPurchasable
                        ? token
                          ? t("billing.buyNow")
                          : t("billing.signInToPurchase")
                        : t("pricing.planUnavailable")}
                  </button>
                  {pendingOrder ? (
                    <button
                      type="button"
                      className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/30"
                      disabled={isProcessing || isCancelling}
                      onClick={() => setCancelOrder(pendingOrder)}
                      data-billing-order-cancel="true"
                      data-billing-order-id={pendingOrder.id}
                    >
                      {isCancelling ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {isCancelling
                        ? t("account.cancellingOrder")
                        : t("account.cancelOrder")}
                    </button>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      ) : null}

      <div className="flex items-center justify-end border-t border-slate-100 pt-4 dark:border-slate-700">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-slate-50 hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
          onClick={() => {
            onClose();
            setTimeout(() => {
              router.push("/account#account-orders");
            }, 0);
          }}
          data-view-orders-button="true"
        >
          <ReceiptText className="size-4" aria-hidden="true" />
          {t("billing.viewOrders")}
        </button>
      </div>
      <ConfirmDialog
        isOpen={cancelOrder !== null}
        title={t("account.cancelOrderConfirmTitle")}
        message={t("account.cancelOrderConfirmMessage")}
        confirmLabel={
          cancelOrder?.id === billing.cancellingOrderId
            ? t("account.cancellingOrder")
            : t("account.cancelOrderConfirm")
        }
        cancelLabel={t("account.security.close")}
        onConfirm={() => {
          if (!cancelOrder || cancelOrderSubmitInFlightRef.current) return;
          cancelOrderSubmitInFlightRef.current = true;
          void billing.cancelPendingOrder(cancelOrder).finally(() => {
            cancelOrderSubmitInFlightRef.current = false;
            setCancelOrder(null);
          });
        }}
        onCancel={() => {
          if (!cancelOrderSubmitInFlightRef.current) setCancelOrder(null);
        }}
      />
    </div>
  );
}
