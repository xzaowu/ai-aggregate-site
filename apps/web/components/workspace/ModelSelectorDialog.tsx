"use client";

import type { AiModelSummary } from "@ai-aggregate/shared";
import {
  isChatCapableModel,
  isImageCapableModel,
  normalizeModelDisplaySurfaces
} from "@ai-aggregate/shared";
import { Search, X } from "lucide-react";
import React, { useEffect, useMemo, useRef } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  formatModelAccessLabel,
  formatModelCreditCostLabel
} from "../../lib/chat-send-state";
import { ModelCard } from "./ModelCard";

let nextModelDialogInstanceId = 0;

export function ModelSelectorDialog({
  isOpen,
  models,
  selectedModel,
  context = "chat-selector",
  isLoggedIn,
  searchQuery,
  onSearchChange,
  onClose,
  onSelectModel,
  returnFocusRef
}: {
  isOpen: boolean;
  models: AiModelSummary[];
  selectedModel: string;
  context?: "chat-selector" | "image-selector";
  isLoggedIn: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onSelectModel: (modelId: string) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const { locale, t } = useI18n();
  const targetSurface = context === "image-selector" ? "image" : "chat";
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    const selectableModels = models.filter((model) =>
      (targetSurface === "chat"
        ? isChatCapableModel(model)
        : isImageCapableModel(model)) &&
      normalizeModelDisplaySurfaces(
        model.displaySurfaces,
        model.capability
      ).includes(targetSurface)
    );

    if (!normalizedQuery) {
      return selectableModels;
    }

    return selectableModels.filter((model) => {
      const haystack = [
        model.name,
        model.displayName,
        model.modelId,
        model.provider,
        model.group,
        model.shortDescription,
        ...model.tags
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [models, normalizedQuery, targetSurface]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const instanceIdRef = useRef<number | null>(null);
  const lifecycleVersionRef = useRef(0);

  if (instanceIdRef.current === null) {
    nextModelDialogInstanceId += 1;
    instanceIdRef.current = nextModelDialogInstanceId;
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    const isMobile = window.matchMedia?.("(max-width: 767px)").matches ?? true;
    if (!isMobile) return;

    const lifecycleVersion = lifecycleVersionRef.current + 1;
    lifecycleVersionRef.current = lifecycleVersion;
    const previousOverflow = document.body.style.overflow;
    const previousHistoryState = window.history.state;
    const marker = {
      modelDialog: "m6",
      modelDialogInstance: instanceIdRef.current
    };
    const ownsMarker = () =>
      window.history.state?.modelDialog === marker.modelDialog &&
      window.history.state?.modelDialogInstance === marker.modelDialogInstance;

    document.body.style.overflow = "hidden";
    if (!ownsMarker()) {
      window.history.pushState(
        { ...(previousHistoryState ?? {}), ...marker },
        "",
        window.location.href
      );
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    const handlePopState = () => onCloseRef.current();
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);
    closeButtonRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
      document.body.style.overflow = previousOverflow;
      queueMicrotask(() => {
        if (lifecycleVersionRef.current !== lifecycleVersion) return;
        if (ownsMarker()) window.history.back();
        returnFocusRef?.current?.focus();
      });
    };
  }, [isOpen, returnFocusRef]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-slate-950/35 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.selectModel")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:rounded-3xl dark:border-slate-700 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-indigo-600 dark:text-indigo-400">
              {t("chat.switchModel")}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
              {t("chat.selectModel")}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-indigo-400"
            aria-label={t("workspace.backToChat")}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="shrink-0 border-b border-slate-100 px-4 py-3 sm:px-5 dark:border-slate-700">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:focus-within:border-indigo-500 dark:focus-within:bg-slate-800 dark:focus-within:ring-indigo-800">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t("chat.searchModels")}</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
              placeholder={t("chat.searchModels")}
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </label>
        </div>
        <div
          className="grid min-h-0 flex-1 gap-3 overflow-y-auto bg-slate-50 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3 dark:bg-slate-950"
          role="listbox"
          aria-label={t("chat.selectModel")}
        >
          {filteredModels.map((model) => {
            const selectModel = () => {
              onSelectModel(model.modelId);
              onClose();
            };

            return (
              <div key={model.id} data-model-id={model.modelId}>
                <ModelCard
                  model={model}
                  isSelected={model.modelId === selectedModel}
                  creditLabel={formatModelCreditCostLabel(
                    model.creditCost,
                    locale
                  )}
                  accessLabel={formatModelAccessLabel(
                    model.allowGuest,
                    isLoggedIn,
                    locale
                  )}
                  usageHint={
                    model.creditCost <= 0
                      ? t("chat.freeModelUsageHint")
                      : t("chat.paidModelUsageHint", { count: model.creditCost })
                  }
                  usageHintClassName="hidden sm:block"
                  recommendedLabel={t("chat.recommended")}
                  onSelect={selectModel}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
