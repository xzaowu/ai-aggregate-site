"use client";

import type { OrderStatus, UsageLogStatus, UserRole } from "@ai-aggregate/shared";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";

export type AdminRoleFilter = "ALL" | UserRole;
export type AdminOrderStatusFilter = "ALL" | OrderStatus;
export type AdminUsageStatusFilter = "ALL" | UsageLogStatus;
export type AdminPaymentTypeFilter = "ALL" | "alipay" | "wxpay";

export interface AdminUsersFilterState {
  q: string;
  role: AdminRoleFilter;
}

export interface AdminOrdersFilterState {
  q: string;
  status: AdminOrderStatusFilter;
  paymentType: AdminPaymentTypeFilter;
  review: boolean;
}

export interface AdminUsageFilterState {
  q: string;
  status: AdminUsageStatusFilter;
  model: string;
}

export interface AdminUsageModelOption {
  modelId: string;
  label: string;
}

export const defaultAdminUsersFilters: AdminUsersFilterState = {
  q: "",
  role: "ALL"
};

export const defaultAdminOrdersFilters: AdminOrdersFilterState = {
  q: "",
  status: "ALL",
  paymentType: "ALL",
  review: false
};

export const defaultAdminUsageFilters: AdminUsageFilterState = {
  q: "",
  status: "ALL",
  model: "ALL"
};

const filterInputClass =
  "min-h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100";
const filterLabelClass = "grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600";
const resetButtonClass =
  "inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 sm:w-auto";

export function buildAdminUsersPath(filters: AdminUsersFilterState): string {
  return buildPath("/admin/users", [
    ["q", filters.q.trim()],
    ["role", filters.role === "ALL" ? "" : filters.role]
  ]);
}

export function buildAdminOrdersPath(filters: AdminOrdersFilterState): string {
  return buildPath("/admin/orders", [
    ["q", filters.q.trim()],
    ["status", filters.status === "ALL" ? "" : filters.status],
    ["paymentType", filters.paymentType === "ALL" ? "" : filters.paymentType],
    ["review", filters.review ? "true" : ""]
  ]);
}

export function buildAdminUsageLogsPath(filters: AdminUsageFilterState): string {
  return buildPath("/admin/usage-logs", [
    ["q", filters.q.trim()],
    ["status", filters.status === "ALL" ? "" : filters.status],
    ["model", filters.model === "ALL" ? "" : filters.model]
  ]);
}

export function hasActiveUsersFilters(filters: AdminUsersFilterState): boolean {
  return filters.q.trim().length > 0 || filters.role !== "ALL";
}

export function hasActiveOrdersFilters(filters: AdminOrdersFilterState): boolean {
  return (
    filters.q.trim().length > 0 ||
    filters.status !== "ALL" ||
    filters.paymentType !== "ALL" ||
    filters.review
  );
}

export function hasActiveUsageFilters(filters: AdminUsageFilterState): boolean {
  return (
    filters.q.trim().length > 0 ||
    filters.status !== "ALL" ||
    filters.model !== "ALL"
  );
}

export function AdminUsersFilters({
  value,
  onChange,
  onReset
}: {
  value: AdminUsersFilterState;
  onChange: (value: AdminUsersFilterState) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2 md:grid-cols-[minmax(220px,1fr)_180px_auto]"
      data-admin-filter-bar="users"
      data-admin-filter-layout="responsive"
    >
      <label className={filterLabelClass}>
        <span>{t("admin.search")}</span>
        <input
          className={filterInputClass}
          placeholder={t("admin.searchEmail")}
          value={value.q}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
        />
      </label>
      <label className={filterLabelClass}>
        <span>{t("admin.role")}</span>
        <select
          className={filterInputClass}
          value={value.role}
          onChange={(event) =>
            onChange({ ...value, role: event.target.value as AdminRoleFilter })
          }
        >
          <option value="ALL">{t("admin.allRoles")}</option>
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </label>
      <div className="flex items-end sm:col-span-2 md:col-span-1">
        <button className={resetButtonClass} type="button" onClick={onReset}>
          {t("admin.resetFilters")}
        </button>
      </div>
    </div>
  );
}

export function AdminOrdersFilters({
  value,
  reviewOrderCount,
  onChange,
  onReset
}: {
  value: AdminOrdersFilterState;
  reviewOrderCount: number;
  onChange: (value: AdminOrdersFilterState) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2 md:grid-cols-[minmax(220px,1fr)_160px_170px_auto_auto]"
      data-admin-filter-bar="orders"
      data-admin-filter-layout="responsive"
    >
      <label className={filterLabelClass}>
        <span>{t("admin.search")}</span>
        <input
          className={filterInputClass}
          placeholder={t("admin.searchOrder")}
          value={value.q}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
        />
      </label>
      <label className={filterLabelClass}>
        <span>{t("admin.orderStatus")}</span>
        <select
          className={filterInputClass}
          value={value.status}
          onChange={(event) =>
            onChange({
              ...value,
              status: event.target.value as AdminOrderStatusFilter
            })
          }
        >
          <option value="ALL">{t("admin.allStatuses")}</option>
          <option value="PENDING">PENDING</option>
          <option value="PAID">PAID</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </label>
      <label className={filterLabelClass}>
        <span>{t("admin.paymentMethod")}</span>
        <select
          className={filterInputClass}
          value={value.paymentType}
          onChange={(event) =>
            onChange({
              ...value,
              paymentType: event.target.value as AdminPaymentTypeFilter
            })
          }
        >
          <option value="ALL">{t("admin.allPaymentMethods")}</option>
          <option value="alipay">{t("payment.alipay")}</option>
          <option value="wxpay">{t("payment.wxpay")}</option>
        </select>
      </label>
      <label className="flex min-h-10 cursor-pointer items-center gap-2 self-end rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
        <input
          type="checkbox"
          checked={value.review}
          onChange={(event) =>
            onChange({ ...value, review: event.target.checked })
          }
        />
        <span>{t("admin.needsPaymentReview")}</span>
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-950">
          {reviewOrderCount}
        </span>
      </label>
      <div className="flex items-end sm:col-span-2 md:col-span-1">
        <button className={resetButtonClass} type="button" onClick={onReset}>
          {t("admin.resetFilters")}
        </button>
      </div>
    </div>
  );
}

export function AdminUsageFilters({
  value,
  models,
  onChange,
  onReset
}: {
  value: AdminUsageFilterState;
  models: AdminUsageModelOption[];
  onChange: (value: AdminUsageFilterState) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2 md:grid-cols-[minmax(220px,1fr)_170px_220px_auto]"
      data-admin-filter-bar="usage"
      data-admin-filter-layout="responsive"
    >
      <label className={filterLabelClass}>
        <span>{t("admin.search")}</span>
        <input
          className={filterInputClass}
          placeholder={t("admin.searchUsage")}
          value={value.q}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
        />
      </label>
      <label className={filterLabelClass}>
        <span>{t("admin.usageStatus")}</span>
        <select
          className={filterInputClass}
          value={value.status}
          onChange={(event) =>
            onChange({
              ...value,
              status: event.target.value as AdminUsageStatusFilter
            })
          }
        >
          <option value="ALL">{t("admin.allStatuses")}</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILED">FAILED</option>
        </select>
      </label>
      <label className={filterLabelClass}>
        <span>{t("admin.model")}</span>
        <select
          className={filterInputClass}
          value={value.model}
          onChange={(event) => onChange({ ...value, model: event.target.value })}
        >
          <option value="ALL">{t("admin.allModels")}</option>
          {models.map((model) => (
            <option key={model.modelId} value={model.modelId}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end sm:col-span-2 md:col-span-1">
        <button className={resetButtonClass} type="button" onClick={onReset}>
          {t("admin.resetFilters")}
        </button>
      </div>
    </div>
  );
}

function buildPath(path: string, pairs: Array<[string, string]>): string {
  const params = new URLSearchParams();

  for (const [key, value] of pairs) {
    if (value.length > 0) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
