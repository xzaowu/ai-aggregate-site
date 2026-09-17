"use client";

import type { AccountActivitySummary } from "@ai-aggregate/shared";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../../lib/site-config";
import {
  getAccountActivityKindLabel,
  getAccountActivityStatusLabel,
  getAccountActivityTitle
} from "./account-activity-labels";

function localeText(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US");
}

interface AccountActivityContentProps {
  token: string | null;
  locale: string;
  isOpen: boolean;
  mobile?: boolean;
  onOpenBilling?: () => void;
  onCancelOrder?: (activity: AccountActivitySummary) => void;
  cancellingActivityId?: string | null;
  cancelOrderLabel?: string;
}

interface AccountActivityModalProps extends AccountActivityContentProps {
  onClose: () => void;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type ActivityLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: AccountActivitySummary[]; page: number; pageSize: number; total: number; totalPages: number }
  | { status: "empty" }
  | { status: "error"; message: string };

export function AccountActivityContent({ token, locale, isOpen, mobile = false, onOpenBilling, onCancelOrder, cancellingActivityId = null, cancelOrderLabel }: AccountActivityContentProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loadState, setLoadState] = useState<ActivityLoadState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (p: number, ps: number, signal?: AbortSignal) => {
    if (!token) return;
    setLoadState({ status: "loading" });
    const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
    try {
      const response = await fetch(`${apiUrl("/account/activities")}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal
      });
      if (signal?.aborted) return;
      if (response.status === 401) {
        setLoadState({ status: "error", message: localeText(locale, "登录已过期，请重新登录", "Session expired. Please log in again.") });
        return;
      }
      if (!response.ok) {
        setLoadState({ status: "error", message: localeText(locale, "加载记录失败", "Failed to load activity records.") });
        return;
      }
      const data = await response.json() as {
        items: AccountActivitySummary[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
      if (signal?.aborted) return;
      if (data.items.length === 0 && data.total === 0) {
        setLoadState({ status: "empty" });
      } else {
        setLoadState({ status: "ready", ...data });
        setPage(data.page);
        scrollRef.current?.scrollTo(0, 0);
      }
    } catch {
      if (!signal?.aborted) setLoadState({ status: "error", message: localeText(locale, "加载记录失败", "Failed to load activity records.") });
    }
  }, [locale, token]);

  useEffect(() => {
    if (!isOpen) return;
    setPage(1);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void fetchPage(1, pageSize, controller.signal);
    return () => controller.abort();
  }, [fetchPage, isOpen, pageSize]);

  const t = (zh: string, en: string) => localeText(locale, zh, en);
  const retry = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void fetchPage(page, pageSize, controller.signal);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loadState.status === "loading" ? <div className="flex items-center justify-center py-16 text-sm text-slate-500">{t("加载中…", "Loading…")}</div> : null}
        {loadState.status === "error" ? <div className="flex flex-col items-center justify-center gap-3 py-16"><p className="text-sm text-slate-500">{loadState.message}</p><button type="button" onClick={retry} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-indigo-600 dark:border-slate-700 dark:text-indigo-400">{t("重新加载", "Reload")}</button></div> : null}
        {loadState.status === "empty" || loadState.status === "idle" ? <div className="flex items-center justify-center py-16 text-sm text-slate-500">{t("暂无订单或账户变动记录", "No orders or account activity yet.")}</div> : null}
        {loadState.status === "ready" ? mobile ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {loadState.items.map((activity) => (
              <div key={activity.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-5 py-4">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{getAccountActivityTitle(activity, locale)}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{getAccountActivityKindLabel(activity, locale)} · {formatDate(activity.createdAt, locale)}</p>{activity.kind === "ORDER" && activity.status === "PENDING" ? <div className="mt-2 flex flex-wrap gap-2">{onOpenBilling ? <button type="button" className="min-h-10 rounded-xl border border-indigo-200 px-3 text-xs font-semibold text-indigo-600 dark:border-indigo-800 dark:text-indigo-400" onClick={onOpenBilling} data-account-payment-resume="true">{t("继续支付", "Continue payment")}</button> : null}{onCancelOrder ? <button type="button" disabled={cancellingActivityId === activity.id} className="min-h-10 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900 dark:text-rose-400" onClick={() => onCancelOrder(activity)} data-account-order-cancel="true" data-order-activity-id={activity.id}>{cancellingActivityId === activity.id ? t("取消中…", "Cancelling…") : cancelOrderLabel ?? t("取消订单", "Cancel order")}</button> : null}</div> : null}</div>
                <div className="text-right"><span className={`text-xs font-semibold ${activity.status === "SUCCESS" ? "text-emerald-600" : activity.status === "PENDING" ? "text-amber-600" : activity.status === "CANCELLED" ? "text-slate-500 dark:text-slate-400" : "text-rose-600"}`}>{getAccountActivityStatusLabel(activity, locale)}</span><p className={`mt-1 text-base font-bold ${activity.creditsDelta < 0 ? "text-rose-600" : "text-indigo-600 dark:text-indigo-400"}`}>{activity.creditsDelta > 0 ? "+" : ""}{activity.creditsDelta}</p></div>
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full min-w-[480px] text-left text-xs sm:text-sm"><thead className="sticky top-0 border-b border-slate-100 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400"><tr><th className="px-5 py-3 font-medium">{t("项目", "Item")}</th><th className="px-5 py-3 font-medium">{t("类型", "Type")}</th><th className="px-5 py-3 font-medium">{t("状态", "Status")}</th><th className="px-5 py-3 font-medium">{t("额度", "Credits")}</th><th className="px-5 py-3 font-medium">{t("创建时间", "Created")}</th></tr></thead><tbody>{loadState.items.map((activity) => <tr key={activity.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="max-w-[140px] truncate px-5 py-3 font-semibold text-slate-800 dark:text-slate-100">{getAccountActivityTitle(activity, locale)}</td><td className="px-5 py-3 text-slate-500 dark:text-slate-400">{getAccountActivityKindLabel(activity, locale)}</td><td className="px-5 py-3"><div className="grid justify-items-start gap-2"><span className={`rounded-md px-2 py-1 text-xs font-semibold ${activity.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : activity.status === "PENDING" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" : activity.status === "CANCELLED" ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"}`}>{getAccountActivityStatusLabel(activity, locale)}</span>{activity.kind === "ORDER" && activity.status === "PENDING" ? <div className="flex flex-wrap gap-2">{onOpenBilling ? <button type="button" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400" onClick={onOpenBilling} data-account-payment-resume="true">{t("继续支付", "Continue payment")}</button> : null}{onCancelOrder ? <button type="button" disabled={cancellingActivityId === activity.id} className="text-xs font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-400" onClick={() => onCancelOrder(activity)} data-account-order-cancel="true" data-order-activity-id={activity.id}>{cancellingActivityId === activity.id ? t("取消中…", "Cancelling…") : cancelOrderLabel ?? t("取消订单", "Cancel order")}</button> : null}</div> : null}</div></td><td className={`px-5 py-3 font-semibold ${activity.creditsDelta < 0 ? "text-red-600" : "text-emerald-600"}`}>{activity.creditsDelta > 0 ? "+" : ""}{activity.creditsDelta}</td><td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-slate-400">{formatDate(activity.createdAt, locale)}</td></tr>)}</tbody></table>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {loadState.status === "ready" ? <span>{t("共", "Total")} {loadState.total} {t("条", "")}</span> : null}
          <select aria-label={t("每页条数", "Page size")} value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))} className={mobile ? "min-h-11 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" : "rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}>
            {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={String(size)}>{size} {t("条/页", "/page")}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" disabled={page <= 1 || loadState.status === "loading"} onClick={() => { void fetchPage(page - 1, pageSize); }} className={mobile ? "flex size-11 items-center justify-center rounded-lg text-slate-500 disabled:opacity-30" : "inline-flex size-8 items-center justify-center rounded-lg text-slate-500 disabled:opacity-30"} aria-label={t("上一页", "Previous page")}><ChevronLeft className="size-4" /></button>
          <span className="px-1 text-xs font-medium text-slate-700 dark:text-slate-300">{loadState.status === "ready" ? `${loadState.page} / ${loadState.totalPages}` : "- / -"}</span>
          <button type="button" disabled={(loadState.status === "ready" ? page >= loadState.totalPages : true) || loadState.status === "loading"} onClick={() => { void fetchPage(page + 1, pageSize); }} className={mobile ? "flex size-11 items-center justify-center rounded-lg text-slate-500 disabled:opacity-30" : "inline-flex size-8 items-center justify-center rounded-lg text-slate-500 disabled:opacity-30"} aria-label={t("下一页", "Next page")}><ChevronRight className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}

export default function AccountActivityModal({ token, locale, isOpen, onClose, onOpenBilling, onCancelOrder, cancellingActivityId = null, cancelOrderLabel = localeText(locale, "取消订单", "Cancel order") }: AccountActivityModalProps) {
  if (!isOpen) return null;
  const t = (zh: string, en: string) => localeText(locale, zh, en);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="account-activity-dialog" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section style={{ maxHeight: "60vh" }} className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800"><h2 id="account-activity-dialog" className="text-lg font-bold text-slate-950 dark:text-slate-50">{t("订单与开通记录", "Orders and activations")}</h2><button type="button" onClick={onClose} className="flex size-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("关闭", "Close")}><X className="size-5" /></button></div>
        <AccountActivityContent
          token={token}
          locale={locale}
          isOpen={isOpen}
          {...(onOpenBilling
            ? { onOpenBilling: () => { onClose(); onOpenBilling(); } }
            : {})}
          {...(onCancelOrder
            ? { onCancelOrder: (activity: AccountActivitySummary) => { onClose(); onCancelOrder(activity); } }
            : {})}
          cancellingActivityId={cancellingActivityId}
          cancelOrderLabel={cancelOrderLabel}
        />
      </section>
    </div>
  );
}
