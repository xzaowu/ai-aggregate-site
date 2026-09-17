import { getModelDisplayName, type AiModelSummary } from "@ai-aggregate/shared";
import React from "react";
import { ModelIcon } from "./ModelIcon";
import { Badge } from "./ui";

export function ModelCard({
  model,
  isSelected,
  creditLabel,
  accessLabel,
  usageHint,
  usageHintClassName,
  selectedLabel,
  recommendedLabel,
  onSelect
}: {
  model: AiModelSummary;
  isSelected: boolean;
  creditLabel: string;
  accessLabel: string;
  usageHint?: string;
  usageHintClassName?: string;
  selectedLabel?: string;
  recommendedLabel: string;
  onSelect: () => void;
}) {
  const displayName = getModelDisplayName(model);

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={
        isSelected
          ? "group w-full rounded-2xl border border-indigo-300 bg-indigo-50/80 p-4 text-left shadow-sm ring-2 ring-indigo-100 transition dark:border-indigo-800 dark:bg-indigo-950/50 dark:ring-indigo-800"
          : "group w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
      }
    >
      <div className="flex items-start gap-3">
        <ModelIcon model={model} selected={isSelected} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-words text-sm font-semibold text-slate-950 dark:text-slate-100">
                {displayName}
              </div>
              <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {model.group}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              {isSelected && selectedLabel ? (
                <Badge tone="indigo" className="shrink-0">
                  {selectedLabel}
                </Badge>
              ) : null}
              {model.isRecommended ? (
                <Badge tone="indigo" className="shrink-0">
                  {recommendedLabel}
                </Badge>
              ) : null}
            </div>
          </div>
          {model.shortDescription ? (
            <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {model.shortDescription}
            </p>
          ) : null}
          {model.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {model.tags.slice(0, 4).map((tag) => (
                <Badge key={`${model.id}-${tag}`} tone="slate">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="emerald">{creditLabel}</Badge>
            <Badge tone={model.allowGuest ? "slate" : "amber"}>{accessLabel}</Badge>
          </div>
          {usageHint ? (
            <p className={`mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400 ${usageHintClassName ?? ""}`}>
              {usageHint}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  );
}
