"use client";

import { X } from "lucide-react";
import React, { useEffect, useRef } from "react";

export type MobileAccountDrawerVariant = "bottom" | "full";

let nextDrawerInstanceId = 0;

interface MobileAccountDrawerProps {
  title: string;
  labelledBy: string;
  variant: MobileAccountDrawerVariant;
  pending?: boolean;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
}

export function MobileAccountDrawer({
  title,
  labelledBy,
  variant,
  pending = false,
  returnFocusRef,
  onClose,
  closeLabel,
  children
}: MobileAccountDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(pending);
  const lifecycleVersionRef = useRef(0);
  const instanceIdRef = useRef<number | null>(null);

  if (instanceIdRef.current === null) {
    nextDrawerInstanceId += 1;
    instanceIdRef.current = nextDrawerInstanceId;
  }

  useEffect(() => {
    onCloseRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    const lifecycleVersion = lifecycleVersionRef.current + 1;
    lifecycleVersionRef.current = lifecycleVersion;
    const scrollContainer = document.querySelector<HTMLElement>("[data-account-mobile-scroll]");
    const previousBodyOverflow = document.body.style.overflow;
    const previousContainerOverflow = scrollContainer?.style.overflowY ?? "";
    const previousContainerScrollTop = scrollContainer?.scrollTop ?? 0;
    const previousWindowScrollY = window.scrollY;
    const previousHistoryState = window.history.state;
    const marker = { accountDrawer: "m5", accountDrawerInstance: instanceIdRef.current };
    const ownsCurrentHistoryMarker = () => window.history.state?.accountDrawer === marker.accountDrawer && window.history.state?.accountDrawerInstance === marker.accountDrawerInstance;

    document.body.style.overflow = "hidden";
    if (scrollContainer) scrollContainer.style.overflowY = "hidden";
    if (!ownsCurrentHistoryMarker()) window.history.pushState({ ...(previousHistoryState ?? {}), ...marker }, "", window.location.href);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) onCloseRef.current();
    };
    const handlePopState = () => {
      if (!pendingRef.current) {
        onCloseRef.current();
      } else {
        window.history.pushState({ ...(window.history.state ?? {}), ...marker }, "", window.location.href);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);
    (closeButtonRef.current ?? document.querySelector<HTMLElement>("[role='dialog'] [data-account-drawer-first-focus]"))?.focus();

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
      document.body.style.overflow = previousBodyOverflow;
      if (scrollContainer) {
        scrollContainer.style.overflowY = previousContainerOverflow;
        scrollContainer.scrollTop = previousContainerScrollTop;
      }
      if (window.scrollY !== previousWindowScrollY) window.scrollTo(0, previousWindowScrollY);
      queueMicrotask(() => {
        if (lifecycleVersionRef.current !== lifecycleVersion) return;
        if (ownsCurrentHistoryMarker()) window.history.back();
        returnFocusRef.current?.focus();
      });
    };
  }, [returnFocusRef]);

  const panelClass = variant === "bottom"
    ? "max-h-[min(88dvh,760px)] rounded-t-[28px]"
    : "h-[100dvh] max-h-[100dvh] rounded-t-[28px]";

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-slate-950/55" role="presentation" onMouseDown={(event) => { if (!pending && event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={`flex w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${panelClass}`}>
        <div className="shrink-0 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="mx-auto mb-2 h-1.5 w-20 rounded-full bg-slate-300 dark:bg-slate-600" />
          <div className="flex items-center justify-between gap-3"><h2 id={labelledBy} className="min-w-0 truncate text-xl font-bold text-slate-950 dark:text-slate-50">{title}</h2><button ref={closeButtonRef} type="button" disabled={pending} onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800" aria-label={closeLabel} data-account-drawer-first-focus><X className="size-6" /></button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </section>
    </div>
  );
}
