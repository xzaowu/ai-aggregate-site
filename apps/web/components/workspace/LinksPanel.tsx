"use client";

import type { LinkEntry } from "@ai-aggregate/shared";
import { ExternalLink, Globe, Server, Users } from "lucide-react";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { Card } from "./ui";

const categoryIcons: Record<string, typeof Globe> = {
  api: Server,
  resource: Globe,
  friend: Users
};

const categoryLabelKeys: Record<string, string> = {
  api: "links.apiService",
  resource: "links.title",
  friend: "links.title"
};

export interface LinksPanelProps {
  links: LinkEntry[];
}

export function LinksPanel({ links }: LinksPanelProps) {
  const { t } = useI18n();

  if (links.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-indigo-400 dark:shadow-none dark:ring-slate-700">
            <ExternalLink className="size-6" aria-hidden="true" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-slate-950 dark:text-slate-100">
            {t("links.title")}
          </h3>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("links.apiService")}
          </p>
        </div>
      </div>
    );
  }

  // Group by category
  const grouped = new Map<string, LinkEntry[]>();
  for (const link of links) {
    const cat = link.category || "other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(link);
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-3 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto grid max-w-4xl gap-8">
        <p className="text-xs text-slate-500 dark:text-slate-400" data-external-link-hint="true">
          {t("links.newWindowHint")}
        </p>
        {Array.from(grouped.entries()).map(([category, categoryLinks]) => {
          const Icon = categoryIcons[category] ?? Globe;
          const catLabel = categoryLabelKeys[category]
            ? t(categoryLabelKeys[category]!)
            : category;

          return (
            <section key={category}>
              <div className="mb-4 flex items-center gap-2">
                <Icon className="size-5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{catLabel}</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {categoryLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block"
                  >
                    <Card className="flex h-full flex-col gap-2 p-5 transition hover:border-indigo-200 hover:shadow-md dark:hover:border-indigo-800">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-slate-950 group-hover:text-indigo-700 dark:text-slate-100 dark:group-hover:text-indigo-400">
                          {link.title}
                        </h3>
                        <ExternalLink className="size-4 shrink-0 text-slate-400 group-hover:text-indigo-500 dark:text-slate-500 dark:group-hover:text-indigo-400" aria-hidden="true" />
                      </div>
                      {link.description ? (
                        <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{link.description}</p>
                      ) : null}
                    </Card>
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
