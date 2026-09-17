"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import React from "react";
import type { ReactNode } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";

export function MobilePageHeader({
  title,
  backHref,
  backLabel,
  action
}: {
  title: string;
  backHref: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <header
      className="flex shrink-0 items-center gap-3 bg-slate-50 px-5 pb-3 pt-5 md:hidden dark:bg-slate-950"
      data-mobile-page-header="true"
    >
      <Link
        href={backHref}
        aria-label={backLabel ?? t("workspace.backToAccount")}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-slate-950 dark:text-slate-100">
        {title}
      </h1>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
