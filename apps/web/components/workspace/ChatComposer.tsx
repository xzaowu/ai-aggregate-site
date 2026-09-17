import type { KeyboardEvent, RefObject } from "react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Expand, SendHorizontal, X } from "lucide-react";
import { Badge } from "./ui";
import { MobileAccountDrawer } from "./MobileAccountDrawer";

export function ChatComposer({
  textareaRef,
  modelTriggerRef,
  value,
  placeholder,
  selectedModelLabel,
  switchModelLabel,
  creditLabel,
  accessLabel,
  sendLabel,
  sendingLabel,
  clearLabel,
  expandLabel,
  closeExpandedLabel,
  expandedTitle,
  isLoading,
  canSend,
  onChange,
  onKeyDown,
  onOpenModelSelector,
  onClear,
  onSend
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  modelTriggerRef?: RefObject<HTMLButtonElement | null>;
  value: string;
  placeholder: string;
  selectedModelLabel: string;
  switchModelLabel: string;
  creditLabel: string | null;
  accessLabel: string | null;
  sendLabel: string;
  sendingLabel: string;
  clearLabel: string;
  expandLabel: string;
  closeExpandedLabel: string;
  expandedTitle: string;
  isLoading: boolean;
  canSend: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onOpenModelSelector: () => void;
  onClear: () => void;
  onSend: () => void;
}) {
  const chatComposerContentClassName = "mx-auto w-full max-w-4xl";
  const [isExpanded, setIsExpanded] = useState(false);
  const expandTriggerRef = useRef<HTMLButtonElement | null>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        expandedTextareaRef.current?.focus();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isExpanded]);
  const expandedEditor = isExpanded ? (
    <MobileAccountDrawer
      title={expandedTitle}
      labelledBy="chat-prompt-editor-title"
      variant="full"
      returnFocusRef={expandTriggerRef}
      onClose={() => setIsExpanded(false)}
      closeLabel={closeExpandedLabel}
    >
      <div className="flex min-h-full flex-col gap-4 px-5 pb-4 pt-1">
        <textarea
          ref={expandedTextareaRef}
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={expandedTitle}
          data-chat-fullscreen-editor="true"
          className="min-h-0 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-7 text-slate-950 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-800"
        />
        <div className="flex shrink-0 items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={onClear}
            disabled={value.length === 0}
          >
            {clearLabel}
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            disabled={!canSend}
            onClick={onSend}
            data-chat-fullscreen-send="true"
          >
            {isLoading ? sendingLabel : sendLabel}
          </button>
        </div>
      </div>
    </MobileAccountDrawer>
  ) : null;

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur sm:px-4 sm:py-4 dark:border-slate-700 dark:bg-slate-900/95" data-chat-composer="true">
      <div className={`${chatComposerContentClassName} rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.08)] focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-100 sm:rounded-[1.5rem] dark:border-slate-700 dark:bg-slate-900 dark:shadow-none dark:focus-within:border-indigo-500 dark:focus-within:ring-indigo-800`}>
        <div className="flex justify-end px-1 pb-1 md:hidden">
          <button
            ref={expandTriggerRef}
            type="button"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-slate-800"
            aria-label={expandLabel}
            onClick={() => setIsExpanded(true)}
            data-chat-expand-prompt="true"
          >
            <Expand className="size-4" aria-hidden="true" />
            {expandLabel}
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="max-h-36 min-h-16 w-full resize-none overflow-y-auto rounded-xl border-0 bg-transparent px-3 py-2 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 sm:min-h-24 sm:rounded-2xl sm:px-4 sm:py-3 dark:text-slate-100 dark:placeholder:text-slate-500"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
        />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-1.5 border-t border-slate-100 px-1 pb-1 pt-2 sm:px-2 sm:pt-3 dark:border-slate-700" data-chat-composer-toolbar="compact-single-row" data-chat-composer-layout="model-cost-access-send-grid">
          <button
            ref={modelTriggerRef}
            type="button"
            className="min-w-0 max-w-full justify-self-start text-left"
            aria-label={switchModelLabel}
            onClick={onOpenModelSelector}
          >
            <Badge
              tone="indigo"
              className="block max-w-full truncate text-left transition hover:border-indigo-300 hover:bg-indigo-100"
            >
              {selectedModelLabel}
            </Badge>
          </button>
          {creditLabel ? <Badge tone="emerald" className="shrink-0 whitespace-nowrap text-[11px]">{creditLabel}</Badge> : null}
          {accessLabel ? <Badge tone="slate" className="shrink-0 whitespace-nowrap text-[11px]">{accessLabel}</Badge> : null}
          {value.length > 0 ? (
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label={clearLabel}
              title={clearLabel}
              onClick={onClear}
              data-chat-clear-draft="true"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canSend}
            onClick={onSend}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 p-0 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 sm:gap-2 sm:px-4"
          >
            <SendHorizontal className="size-5 shrink-0" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{isLoading ? sendingLabel : sendLabel}</span>
          </button>
        </div>
      </div>
      {expandedEditor && typeof document !== "undefined"
        ? createPortal(expandedEditor, document.body)
        : null}
    </div>
  );
}
