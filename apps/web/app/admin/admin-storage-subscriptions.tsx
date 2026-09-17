"use client";

import type { AdminStorageSubscriptionSummary } from "@ai-aggregate/shared";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  X
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../../lib/site-config";
import { useI18n } from "../../lib/i18n/use-i18n";
import { useAdminAuth } from "./admin-auth-context";
import { AdminToastContainer, useAdminToast } from "./toast";

function localeText(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US");
}

const PAGE_SIZES = [10, 20, 50, 100];

const STATUS_OPTIONS = [
  { value: "ALL", zh: "全部", en: "All" },
  { value: "ACTIVE", zh: "已开通", en: "Active" },
  { value: "INACTIVE", zh: "未开通", en: "Inactive" },
  { value: "EXPIRED", zh: "已过期", en: "Expired" }
];

const ACTIONS = [
  { value: "", zh: "选择操作…", en: "Select action…" },
  { value: "ACTIVATE", zh: "开通", en: "Activate" },
  { value: "EXTEND", zh: "延长", en: "Extend" },
  { value: "DEACTIVATE", zh: "停用", en: "Deactivate" },
  { value: "SET_AUTO_RENEW", zh: "修改自动续费", en: "Edit auto-renew" }
];

export default function AdminStorageSubscriptions() {
  const { locale } = useI18n();
  const t = useCallback((zh: string, en: string) => localeText(locale, zh, en), [locale]);
  const { token, isAdmin } = useAdminAuth();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<{
    items: AdminStorageSubscriptionSummary[];
    total: number;
    totalPages: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(!isAdmin);
  const { toasts, showToast, dismissToast } = useAdminToast();

  const [editOpen, setEditOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editUserEmail, setEditUserEmail] = useState<string | null>(null);
  const [editAction, setEditAction] = useState("");
  const [editDurationDays, setEditDurationDays] = useState(30);
  const [editAutoRenew, setEditAutoRenew] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!token || !isAdmin) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) params.set("q", q);
    if (status !== "ALL") params.set("status", status);
    try {
      const res = await fetch(`${apiUrl("/admin/storage-subscriptions")}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json() as { items: AdminStorageSubscriptionSummary[]; page: number; pageSize: number; total: number; totalPages: number };
      setData(json);
      setPage(json.page);
    } catch {
      setError(t("加载失败", "Failed to load data."));
    } finally {
      setLoading(false);
    }
  }, [token, isAdmin, page, pageSize, q, status, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function openEdit(user: AdminStorageSubscriptionSummary) {
    setEditUserId(user.userId);
    setEditUserEmail(user.userEmail);
    setEditAction("");
    setEditDurationDays(user.durationDays ?? 30);
    setEditAutoRenew(user.autoRenewEnabled);
    setEditMessage(null);
    setConfirmOpen(false);
    setEditOpen(true);
  }

  async function submitEdit() {
    if (!token || !editUserId || !editAction || editSaving) return;

    if (editAction === "DEACTIVATE" && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }

    setEditSaving(true);
    setEditMessage(null);
    try {
      const body: Record<string, unknown> = { action: editAction };
      if (editAction === "ACTIVATE" || editAction === "EXTEND") {
        body.durationDays = editDurationDays;
      }
      if (editAction === "SET_AUTO_RENEW") {
        body.enabled = editAutoRenew;
      }
      const res = await fetch(apiUrl(`/admin/storage-subscriptions/${editUserId}`), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "error" })) as { message?: string };
        throw new Error(err.message || "error");
      }
      setEditOpen(false);
      void fetchData();
    } catch (e) {
      const message = e instanceof Error ? e.message : t("操作失败", "Action failed.");
      setEditMessage(message);
      showToast("error", message);
    } finally {
      setEditSaving(false);
    }
  }

  function statusColor(s: string) {
    return s === "ACTIVE" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
      : s === "EXPIRED" ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }

  function statusLabel(s: string) {
    return s === "ACTIVE" ? t("已开通", "Active") : s === "EXPIRED" ? t("已过期", "Expired") : t("未开通", "Not active");
  }

  if (!isAdmin || forbidden) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">{t("无权访问", "Access denied.")}</div>;
  }

  return (
    <>
      <AdminToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        dismissLabel={t("关闭", "Close")}
      />
      <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50">{t("存储包管理", "Storage packages")}</h2>
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder={t("搜索邮箱或昵称…", "Search email or name…")}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.zh, opt.en)}</option>
          ))}
        </select>
        <button type="button" onClick={() => fetchData()} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {t("刷新", "Refresh")}
        </button>
      </div>

      {loading && <div className="py-8 text-center text-sm text-slate-500">{t("加载中…", "Loading…")}</div>}
      {error && <div className="py-8 text-center text-sm text-red-500">{error}</div>}

      {data && !loading && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-xs sm:text-sm">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-3 font-medium">{t("用户", "User")}</th>
                  <th className="px-3 py-3 font-medium">{t("邮箱", "Email")}</th>
                  <th className="px-3 py-3 font-medium">{t("状态", "Status")}</th>
                  <th className="px-3 py-3 font-medium">{t("开通时间", "Starts")}</th>
                  <th className="px-3 py-3 font-medium">{t("到期时间", "Expires")}</th>
                  <th className="px-3 py-3 font-medium">{t("自动续费", "Auto-renew")}</th>
                  <th className="px-3 py-3 font-medium">{t("价格", "Price")}</th>
                  <th className="px-3 py-3 font-medium">{t("操作", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">{t("暂无数据", "No data found.")}</td></tr>
                ) : data.items.map((item) => (
                  <tr key={item.userId} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="max-w-[120px] truncate px-3 py-3 font-semibold text-slate-800 dark:text-slate-100">{item.userName || item.userId.slice(0, 8)}</td>
                    <td className="max-w-[160px] truncate px-3 py-3 text-slate-600 dark:text-slate-300">{item.userEmail}</td>
                    <td className="px-3 py-3"><span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusColor(item.status)}`}>{statusLabel(item.status)}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">{formatDate(item.startsAt, locale)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">{formatDate(item.expiresAt, locale)}</td>
                    <td className="px-3 py-3">{item.autoRenewEnabled ? <span className="text-xs font-semibold text-emerald-600">{t("已开启", "On")}</span> : <span className="text-xs text-slate-400">{t("未开启", "Off")}</span>}</td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{item.priceCredits != null ? `${item.priceCredits} credits` : "—"}</td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => openEdit(item)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-400">
                        <Pencil className="size-3" />{t("编辑", "Edit")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{t("共", "Total")} {data.total} {t("条", "")}</span>
              <select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {PAGE_SIZES.map((n) => <option key={n} value={String(n)}>{n} {t("条/页", "/page")}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800" aria-label={t("上一页", "Previous")}>
                <ChevronLeft className="size-4" />
              </button>
              <span className="px-2 text-xs font-medium text-slate-700 dark:text-slate-300">{page} / {data.totalPages}</span>
              <button type="button" disabled={page >= data.totalPages || loading} onClick={() => setPage(page + 1)} className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800" aria-label={t("下一页", "Next")}>
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {editOpen && editUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-950 dark:text-slate-50">{t("管理存储包", "Manage storage package")}</h3>
              <button type="button" onClick={() => setEditOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("关闭", "Close")}>
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div className="text-sm text-slate-600 dark:text-slate-300">{t("用户", "User")}: {editUserEmail}</div>

              {!confirmOpen ? (
                <>
                  <select value={editAction} onChange={(e) => setEditAction(e.target.value)} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {ACTIONS.map((a) => <option key={a.value} value={a.value}>{t(a.zh, a.en)}</option>)}
                  </select>

                  {(editAction === "ACTIVATE" || editAction === "EXTEND") && (
                    <div>
                      <label className="text-xs text-slate-500 dark:text-slate-400">{t("天数", "Days")}</label>
                      <input type="number" value={editDurationDays} onChange={(e) => setEditDurationDays(Number(e.target.value))} min={1} max={3650} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" />
                    </div>
                  )}
                  {editAction === "SET_AUTO_RENEW" && (
                    <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                      <input type="checkbox" checked={editAutoRenew} onChange={(e) => setEditAutoRenew(e.target.checked)} />
                      {t("启用自动续费", "Enable auto-renew")}
                    </label>
                  )}

                  {editMessage && <p className="text-xs text-red-500">{editMessage}</p>}

                  <button type="button" disabled={!editAction || editSaving} onClick={() => void submitEdit()} className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    {editSaving ? t("提交中…", "Saving…") : t("确定", "Confirm")}
                  </button>
                </>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-red-600 dark:text-red-400">{t("确认停用该用户的存储包？此操作将立即生效。", "Confirm deactivation? This takes effect immediately.")}</p>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setConfirmOpen(false)} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">{t("取消", "Cancel")}</button>
                    <button type="button" disabled={editSaving} onClick={() => void submitEdit()} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                      {editSaving ? t("提交中…", "Saving…") : t("确认停用", "Confirm deactivation")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
