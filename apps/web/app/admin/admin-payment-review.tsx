"use client";

import type { AdminOrderSummary } from "@ai-aggregate/shared";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { formatAdminDate } from "./admin-safe-data";

export function AdminPaymentReviewBadge() {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
      {t("admin.needsPaymentReview")}
    </span>
  );
}

export function AdminPaymentReviewDetails({
  order
}: {
  order: AdminOrderSummary;
}) {
  const { t } = useI18n();

  if (order.reviewAttempts.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={t("admin.paymentReviewDetails")}
      className="mt-3 border-t border-amber-200 pt-3 sm:col-span-2 lg:col-span-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-amber-950">
          {t("admin.paymentReviewDetails")}
        </h4>
        <AdminPaymentReviewBadge />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {order.reviewAttempts.map((attempt) => (
          <div
            key={attempt.id}
            className="rounded-xl border border-amber-200 bg-amber-50/70 p-3"
          >
            <div className="mb-2 font-semibold text-amber-950">
              {t("admin.paymentAttemptOrdinal")} {attempt.ordinal}
            </div>
            <ReviewField
              label={t("admin.paymentAttemptStatus")}
              value={attempt.status}
            />
            <ReviewField
              label={t("payment.gateway")}
              value={attempt.provider}
            />
            <ReviewField
              label={t("admin.paymentMethod")}
              value={attempt.paymentType}
            />
            <ReviewField
              label={t("payment.tradeNo")}
              value={attempt.merchantTradeNo}
              mono
            />
            <ReviewField
              label={t("admin.providerTradeNo")}
              value={attempt.providerTradeNo ?? "-"}
              mono
            />
            <ReviewField
              label={t("admin.paid")}
              value={formatAdminDate(attempt.paidAt)}
            />
            <ReviewField
              label={t("admin.created")}
              value={formatAdminDate(attempt.createdAt)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewField({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="mt-1 break-all text-slate-600">
      <span className="font-semibold text-slate-700">{label}:</span>{" "}
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}
