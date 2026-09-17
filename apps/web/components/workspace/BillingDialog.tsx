"use client";

import type { OrderSummary, PlanSummary } from "@ai-aggregate/shared";
import { WalletCards, X } from "lucide-react";
import React, { useEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { BillingPurchaseContent } from "./BillingPurchaseContent";
import type { PublicEpayStatus } from "./payment-notice";

export type BillingDialogProps = {
  readonly isOpen: boolean;
  readonly token: string | null;
  readonly remainingCredits: number | null;
  readonly onClose: () => void;
  readonly onOrderCreated?: () => void;
  readonly initialPlans?: readonly PlanSummary[];
  readonly initialOrders?: readonly OrderSummary[];
  readonly initialPaymentStatus?: PublicEpayStatus | null;
  readonly onPurchase?: (planId: string) => void;
  readonly onRequireLogin?: () => void;
};

export function isBillingDialogDismissKey(key: string): boolean {
  return key === "Escape";
}

export function handleBillingDialogBackdrop(
  isBackdrop: boolean,
  onClose: () => void
): void {
  if (isBackdrop) onClose();
}

export function handleBillingDialogKeyDown(
  key: string,
  onClose: () => void
): void {
  if (isBillingDialogDismissKey(key)) onClose();
}

export function BillingDialog({
  isOpen,
  token,
  remainingCredits,
  onClose,
  onOrderCreated,
  initialPlans,
  initialOrders,
  initialPaymentStatus,
  onPurchase,
  onRequireLogin
}: BillingDialogProps) {
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      handleBillingDialogKeyDown(event.key, onClose);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6 dark:bg-slate-950/70"
      data-billing-dialog-backdrop="true"
      onMouseDown={(event) => {
        handleBillingDialogBackdrop(event.target === event.currentTarget, onClose);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-dialog-title"
        className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-lg bg-white shadow-2xl sm:max-h-[85vh] sm:rounded-lg dark:bg-slate-950 dark:shadow-[0_0_80px_rgba(0,0,0,0.4)]"
        data-billing-dialog="true"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                <WalletCards className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id="billing-dialog-title" className="text-lg font-semibold text-slate-950 dark:text-slate-100">
                  {t("billing.dialogTitle")}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {t("billing.dialogSubtitle")}
                </p>
              </div>
            </div>
            {remainingCredits !== null ? (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-800">
                <span className="text-slate-500 dark:text-slate-400">{t("billing.currentCredits")}:</span>
                <span className="font-semibold text-slate-950 dark:text-slate-100">{remainingCredits.toLocaleString()}</span>
              </div>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label={t("billing.close")}
            title={t("billing.close")}
            onClick={onClose}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-5">
          <BillingPurchaseContent
            token={token}
            remainingCredits={remainingCredits}
            onOrderCreated={onOrderCreated}
            initialPlans={initialPlans}
            initialOrders={initialOrders}
            initialPaymentStatus={initialPaymentStatus}
            onPurchase={onPurchase}
            onClose={onClose}
            onRequireLogin={onRequireLogin}
          />
        </div>
      </section>
    </div>
  );
}
