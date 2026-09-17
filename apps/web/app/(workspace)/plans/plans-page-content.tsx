"use client";

import { Coins, ExternalLink } from "lucide-react";
import Link from "next/link";
import React from "react";
import { BillingPurchaseContent } from "../../../components/workspace/BillingPurchaseContent";
import { MobilePageHeader } from "../../../components/workspace/MobilePageHeader";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { useWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";

export default function PlansPageContent() {
  const { t } = useI18n();
  const workspaceShell = useWorkspaceShellContext();
  const { shell, refreshQuota, openAuthDialog } = workspaceShell;

  return (
    <>
      <MobilePageHeader title={t("plans.title")} backHref="/account" />
      <section
        className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950"
        data-plans-page="true"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400">
                {t("plans.eyebrow")}
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl dark:text-slate-50">
                {t("plans.title")}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                {t("plans.subtitle")}
              </p>
            </div>
            {shell.remainingCredits !== undefined ? (
              <div className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <Coins className="size-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                <span className="text-slate-500 dark:text-slate-400">
                  {t("billing.currentCredits")}
                </span>
                <span className="font-semibold text-slate-950 dark:text-slate-100">
                  {shell.remainingCredits.toLocaleString()}
                </span>
              </div>
            ) : null}
          </header>

          <section
            className="mt-6 flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-indigo-900/60 dark:bg-indigo-950/30"
            data-plans-credit-explanation="true"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Coins className="mt-0.5 size-5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                  {t("plans.creditExplanationTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {t("plans.creditExplanation")}
                </p>
              </div>
            </div>
            <Link
              href="/models"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-indigo-700 hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-200"
              data-plans-model-cost-link="true"
            >
              {t("plans.viewModelCosts")}
              <ExternalLink className="size-4" aria-hidden="true" />
            </Link>
          </section>

          <section className="mt-6" data-plans-billing-surface="true">
            <BillingPurchaseContent
              token={shell.token}
              remainingCredits={shell.remainingCredits ?? null}
              onOrderCreated={refreshQuota}
              onClose={() => undefined}
              onRequireLogin={() => openAuthDialog({ mode: "login" })}
            />
          </section>
        </div>
      </section>
    </>
  );
}
