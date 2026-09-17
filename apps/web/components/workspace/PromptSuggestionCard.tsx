import { ArrowUpRight } from "lucide-react";
import React from "react";

export function PromptSuggestionCard({
  title,
  description,
  variant = "default",
  onSelect
}: {
  title: string;
  description: string;
  variant?: "default" | "compact";
  onSelect: () => void;
}) {
  const isCompact = variant === "compact";

  return (
    <button
      type="button"
      className={
        isCompact
          ? "group flex w-[min(15rem,78vw)] shrink-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          : "group flex min-h-24 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
      }
      data-mobile-prompt-chip={isCompact ? "true" : undefined}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-sm font-semibold text-slate-950 dark:text-slate-100">
          {title}
        </h3>
        <ArrowUpRight
          className="size-4 shrink-0 text-slate-400 transition group-hover:text-indigo-600 dark:text-slate-500 dark:group-hover:text-indigo-400"
          aria-hidden="true"
        />
      </div>
      <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </button>
  );
}
