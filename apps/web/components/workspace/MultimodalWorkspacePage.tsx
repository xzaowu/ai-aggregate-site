"use client";

import type { LucideIcon } from "lucide-react";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { Badge, Button, IconBadge } from "./ui";

type FieldConfig = {
  labelKey: string;
  placeholderKey: string;
  multiline?: boolean;
};

type SelectPlaceholderConfig = {
  labelKey: string;
  valueKey: string;
};

export type WorkspaceActionConfig = {
  labelKey: string;
  variant?: "primary" | "secondary";
};

export function MultimodalWorkspacePage({
  icon: Icon,
  eyebrowKey,
  titleKey,
  descriptionKey,
  noticeKey,
  hideMobileHeader = false,
  className,
  children
}: {
  icon: LucideIcon;
  eyebrowKey: string;
  titleKey: string;
  descriptionKey: string;
  noticeKey?: string;
  hideMobileHeader?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className={`mx-auto flex w-full max-w-5xl flex-col gap-5 px-3 py-4 sm:px-6 sm:py-5 lg:px-8 ${className ?? ""}`}>
      <header className={`flex min-w-0 flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:pb-5 dark:border-slate-700${hideMobileHeader ? " hidden md:flex" : ""}`}>
        <div className="flex min-w-0 items-start gap-3">
          <IconBadge icon={Icon} label={t(titleKey)} className="mt-0.5 hidden sm:inline-flex" />
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-normal text-indigo-600 dark:text-indigo-400">
              {t(eyebrowKey)}
            </div>
            <h1 className="mt-1 truncate text-xl font-semibold text-slate-950 sm:text-3xl dark:text-slate-100">
              {t(titleKey)}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 sm:mt-2 dark:text-slate-400">
              {t(descriptionKey)}
            </p>
          </div>
        </div>
        {noticeKey ? (
          <Badge tone="amber" className="w-fit whitespace-normal leading-5">
            {t(noticeKey)}
          </Badge>
        ) : null}
      </header>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function GenerationFormShell({
  fields,
  selectors,
  actions,
  resultTitleKey,
  resultDescriptionKey,
  children
}: {
  fields: FieldConfig[];
  selectors: SelectPlaceholderConfig[];
  actions: WorkspaceActionConfig[];
  resultTitleKey: string;
  resultDescriptionKey: string;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-5">
      <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <div className="grid gap-4">
          {fields.map((field) => (
            <label key={field.labelKey} className="grid min-w-0 gap-2">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {t(field.labelKey)}
              </span>
              {field.multiline ? (
                <textarea
                  className="min-h-32 w-full min-w-0 resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:bg-slate-900"
                  placeholder={t(field.placeholderKey)}
                  rows={5}
                />
              ) : (
                <input
                  className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:bg-slate-900"
                  placeholder={t(field.placeholderKey)}
                />
              )}
            </label>
          ))}

          {selectors.length > 0 ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {selectors.map((selector) => (
                <label key={selector.labelKey} className="grid min-w-0 gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t(selector.labelKey)}
                  </span>
                  <div className="flex h-11 min-w-0 items-center truncate rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {t(selector.valueKey)}
                  </div>
                </label>
              ))}
            </div>
          ) : null}

          {children}

          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.labelKey}
                type="button"
                disabled
                variant={action.variant ?? "primary"}
              >
                {t(action.labelKey)}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <EmptyResult titleKey={resultTitleKey} descriptionKey={resultDescriptionKey} />
    </div>
  );
}

export function PlaceholderTabs({
  items
}: {
  items: Array<{ key: string; labelKey: string }>;
}) {
  const { t } = useI18n();

  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
      {items.map((item, index) => (
          <button
          key={item.key}
          type="button"
          className={
            index === 0
              ? "rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
              : "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
          }
          disabled
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({
  labelKey,
  filters
}: {
  labelKey: string;
  filters: string[];
}) {
  const { t } = useI18n();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
        {t(labelKey)}
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.map((filterKey, index) => (
          <span
            key={filterKey}
            className={
              index === 0
                ? "rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
                : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            }
          >
            {t(filterKey)}
          </span>
        ))}
      </div>
    </section>
  );
}

export function EmptyResult({
  titleKey,
  descriptionKey
}: {
  titleKey: string;
  descriptionKey: string;
}) {
  const { t } = useI18n();

  return (
    <section className="flex min-h-72 min-w-0 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center shadow-sm sm:p-6 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{t(titleKey)}</div>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
        {t(descriptionKey)}
      </p>
    </section>
  );
}

export function NoticeBlock({ messageKey }: { messageKey: string }) {
  const { t } = useI18n();

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      {t(messageKey)}
    </section>
  );
}
