import Link from "next/link";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";

export type MobileWorksSection = "assets" | "tasks";

export function MobileWorksSwitcher({
  active
}: {
  active: MobileWorksSection;
}) {
  const { t } = useI18n();
  const items: Array<{
    key: MobileWorksSection;
    href: string;
    label: string;
  }> = [
    { key: "assets", href: "/assets", label: t("multimodal.mobileWorks.assets") },
    { key: "tasks", href: "/tasks", label: t("multimodal.mobileWorks.tasks") }
  ];

  return (
    <header
      className="flex min-w-0 shrink-0 items-center justify-between gap-2"
      data-mobile-works-switcher="true"
    >
      <h1 className="min-w-0 truncate text-[26px] font-bold leading-tight tracking-tight text-slate-950 dark:text-slate-100">
        {t("multimodal.mobileWorks.title")}
      </h1>
      <nav
        className="flex shrink-0 rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        aria-label={t("multimodal.mobileWorks.navigation")}
        data-mobile-works-tabs="true"
      >
        {items.map((item) => {
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
              data-mobile-works-tab={item.key}
              data-mobile-works-tab-active={isActive ? "true" : "false"}
              className={
                isActive
                  ? "inline-flex min-h-9 items-center justify-center rounded-[10px] bg-indigo-600 px-3 text-[13px] font-semibold text-white shadow-sm"
                  : "inline-flex min-h-9 items-center justify-center rounded-[10px] px-3 text-[13px] font-semibold text-slate-600 transition hover:text-indigo-700 dark:text-slate-300 dark:hover:text-indigo-300"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
