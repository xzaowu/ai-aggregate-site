"use client";

import type {
  AdminOperationsBudget,
  AdminOperationsManualCompensation,
  AdminOperationsOverview,
  AdminOperationsTask,
  AdminOverview
} from "@ai-aggregate/shared";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Coins,
  CreditCard,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Users,
  XCircle
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import React from "react";
import { getOrderPaymentMethodLabel } from "../../components/workspace/payment-methods";
import { useI18n } from "../../lib/i18n/use-i18n";
import { formatPlanCentsForDisplay } from "./admin-plan-price";
import {
  asArray,
  formatAdminDate,
  formatAdminNumber,
  normalizeAdminOperations,
  normalizeAdminOverviewStats
} from "./admin-safe-data";
import {
  AdminDataTable,
  AdminSection,
  AdminSectionHeader,
  AdminStatusBadge,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell
} from "./admin-layout";

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatPrice(value: number): string {
  return formatPlanCentsForDisplay(value, "¥0.00");
}

export function AdminOperationsOverview({
  overview
}: {
  overview: AdminOverview | null | undefined;
}) {
  const { t } = useI18n();
  const stats = normalizeAdminOverviewStats(overview?.stats);
  const paymentMethodLabels = {
    alipay: t("payment.alipay"),
    wxpay: t("payment.wxpay"),
    onlinePayment: t("payment.onlinePayment"),
    empty: "-"
  };

  return (
    <div
      className="grid min-w-0 gap-4"
      data-admin-overview-dashboard="true"
    >
      <AdminSection>
        <AdminSectionHeader title={t("admin.operationsOverview")} />
      {stats.orders.pending > 0 ? (
        <div
          className="mx-4 mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("admin.pendingOrdersNotice", {
            count: stats.orders.pending
          })}
        </div>
      ) : null}
      <div className="grid min-w-0 gap-4 p-4">
        <div
          className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
          data-admin-primary-metrics="true"
        >
          <Metric
            icon={Activity}
            label={t("admin.callsToday")}
            value={stats.usage.todayCalls}
          />
          <Metric
            icon={TrendingUp}
            label={t("admin.successRate")}
            tone="emerald"
            value={formatPercent(stats.usage.successRate)}
          />
          <Metric
            icon={AlertTriangle}
            label={t("admin.todayFailedRequests")}
            tone={stats.usage.todayFailed > 0 ? "rose" : "slate"}
            value={stats.usage.todayFailed}
          />
          <Metric
            icon={Activity}
            label={t("admin.todayActiveUsers")}
            value={stats.users.todayActive}
          />
          <Metric
            icon={CheckCircle2}
            label={t("admin.todayPaidOrders")}
            tone="emerald"
            value={stats.orders.todayPaid}
          />
          <Metric
            icon={CreditCard}
            label={t("admin.todayRevenue")}
            tone="emerald"
            value={formatPrice(stats.orders.todayRevenueCents)}
          />
        </div>

        <div
          className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4"
          data-admin-secondary-metrics="true"
        >
          <Metric
            icon={Users}
            label={t("admin.totalUsers")}
            value={stats.users.total}
          />
          <Metric
            icon={ShoppingCart}
            label={t("admin.pendingOrders")}
            tone={stats.orders.pending > 0 ? "amber" : "slate"}
            value={stats.orders.pending}
          />
          <Metric
            icon={Coins}
            label={t("admin.totalRemainingCredits")}
            value={stats.quota.remainingCreditsTotal}
          />
          <Metric
            icon={Users}
            label={t("admin.regularUsers")}
            value={stats.users.regularUsers}
          />
          <Metric
            icon={UserPlus}
            label={t("admin.newUsersToday")}
            value={stats.users.todayNew}
          />
          <Metric icon={ShieldCheck} label={t("admin.admins")} value={stats.users.admins} />
          <Metric icon={CheckCircle2} label={t("admin.paidOrders")} value={stats.orders.paid} />
          <Metric
            icon={XCircle}
            label={t("admin.cancelledOrders")}
            tone="rose"
            value={stats.orders.cancelled}
          />
        </div>
      </div>
      </AdminSection>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <RecentFailuresList failures={stats.recentFailures} />
        <RecentOrdersList
          orders={stats.recentOrders}
          paymentMethodLabels={paymentMethodLabels}
        />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.25fr_1fr]">
        <AdminSection>
          <AdminSectionHeader
            title={t("admin.last7Days")}
            description={t("admin.todayRangeCopy")}
          />
          <AdminDataTable className="bg-white">
            <table
              className="w-full min-w-[720px] text-left text-sm"
              data-admin-data-surface="overview-trend"
            >
              <thead className="bg-slate-50">
                <tr>
                  <AdminTableHeadCell>{t("admin.date")}</AdminTableHeadCell>
                  <AdminTableHeadCell>{t("admin.callsToday")}</AdminTableHeadCell>
                  <AdminTableHeadCell>{t("admin.successToday")}</AdminTableHeadCell>
                  <AdminTableHeadCell>{t("admin.failedToday")}</AdminTableHeadCell>
                  <AdminTableHeadCell>{t("admin.creditsUsedToday")}</AdminTableHeadCell>
                  <AdminTableHeadCell>{t("admin.guestCalls")}</AdminTableHeadCell>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.last7Days.length === 0 ? (
                  <AdminTableEmptyRow colSpan={6}>{t("admin.noData")}</AdminTableEmptyRow>
                ) : (
                  stats.last7Days.map((point) => (
                    <tr key={point.date} className="text-slate-700" data-admin-table-row="true">
                      <AdminTableCell className="font-semibold text-slate-950">
                        {point.date}
                      </AdminTableCell>
                      <AdminTableCell>{point.calls}</AdminTableCell>
                      <AdminTableCell>{point.success}</AdminTableCell>
                      <AdminTableCell>{point.failed}</AdminTableCell>
                      <AdminTableCell>{point.creditsUsed}</AdminTableCell>
                      <AdminTableCell>{point.guestCalls}</AdminTableCell>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </AdminDataTable>
        </AdminSection>

        <div className="grid min-w-0 gap-3">
          <ModelRanking
            title={t("admin.modelUsageLast7Days")}
            subtitle={t("admin.last7DaysRangeCopy")}
            models={stats.modelUsageLast7Days}
            valueLabel={t("admin.calls")}
            valueKey="calls"
          />
          <ModelRanking
            title={t("admin.topModelsByCalls")}
            models={stats.modelTopByCalls}
            valueLabel={t("admin.callsToday")}
            valueKey="calls"
          />
          <ModelRanking
            title={t("admin.topModelsByCredits")}
            models={stats.modelTopByCredits}
            valueLabel={t("admin.creditsUsedToday")}
            valueKey="creditsUsed"
          />
          <ModelRanking
            title={t("admin.topModelsByFailures")}
            models={stats.modelTopByFailures}
            valueLabel={t("admin.failedToday")}
            valueKey="failed"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Link
          className="inline-flex min-h-10 items-center rounded-md border border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800"
          href="/admin/operations"
        >
          {t("admin.viewDetailedOperations")}
        </Link>
      </div>
    </div>
  );
}

export function AdminOperationsDetails({
  overview
}: {
  overview: AdminOverview | null | undefined;
}) {
  const operations = normalizeAdminOperations(overview?.operations);
  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
      data-admin-data-surface="operations"
    >
      <OperationsDataSections operations={operations} />
    </section>
  );
}

function OperationsDataSections({
  operations
}: {
  operations: AdminOperationsOverview;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 border-t border-slate-200 bg-slate-50/60 p-4 sm:p-5">
      <AbnormalTasksSection tasks={operations.recentTasks} />
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <ManualCompensationsSection compensations={operations.manualCompensations} />
        <BudgetsSection budgets={operations.budgets} />
      </div>
    </div>
  );
}

function AbnormalTasksSection({ tasks }: { tasks: AdminOperationsTask[] }) {
  const { t } = useI18n();

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <SectionTitle title={t("admin.abnormalTasks")} subtitle={t("admin.reliableStatus")} />
      {tasks.length === 0 ? (
        <OperationsEmptyBlock />
      ) : (
        <AdminDataTable className="bg-white">
          <table
            className="w-full min-w-[760px] text-left text-sm lg:min-w-[1500px]"
            data-admin-data-surface="operations-abnormal-tasks"
          >
            <thead className="bg-slate-50">
              <tr>
                <AdminTableHeadCell>{t("admin.taskId")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">{t("admin.userId")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">{t("admin.taskType")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.taskStatus")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">{t("admin.model")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">{t("admin.provider")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">{t("admin.route")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">{t("admin.created")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">{t("admin.updatedAt")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.errorClass")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.chargeStatus")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.creditReleaseStatus")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.refundStatus")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.costRecord")}</AdminTableHeadCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <tr key={task.taskId} className="text-slate-700" data-admin-table-row="true">
                  <AdminTableCell className="max-w-[180px] truncate font-mono text-xs text-slate-950">
                    {task.taskId}
                  </AdminTableCell>
                  <AdminTableCell priority="secondary" className="max-w-[180px] truncate font-mono text-xs">
                    {task.userId}
                  </AdminTableCell>
                  <AdminTableCell priority="secondary">{t(`admin.taskType.${task.type}`)}</AdminTableCell>
                  <AdminTableCell>
                    <OperationStatusBadge
                      label={t(`admin.taskStatus.${task.status}`)}
                      tone={task.status === "failed" ? "rose" : "slate"}
                    />
                  </AdminTableCell>
                  <AdminTableCell priority="secondary" className="max-w-[180px] truncate">
                    {task.modelLabel ?? task.modelId ?? t("admin.notAvailable")}
                  </AdminTableCell>
                  <AdminTableCell priority="tertiary" className="max-w-[160px] truncate">
                    {task.providerLabel ?? t("admin.notAvailable")}
                  </AdminTableCell>
                  <AdminTableCell priority="tertiary" className="max-w-[160px] truncate font-mono text-xs">
                    {task.routeId ?? t("admin.notAvailable")}
                  </AdminTableCell>
                  <AdminTableCell priority="tertiary" className="whitespace-nowrap text-xs text-slate-500">
                    {formatAdminDate(task.createdAt)}
                  </AdminTableCell>
                  <AdminTableCell priority="tertiary" className="whitespace-nowrap text-xs text-slate-500">
                    {formatAdminDate(task.updatedAt)}
                  </AdminTableCell>
                  <AdminTableCell>
                    <OperationStatusBadge
                      label={t(`admin.reliableStatus.${task.safeErrorClass}`)}
                      tone={
                        task.safeErrorClass === "CHARGED_AND_FAILED"
                          ? "amber"
                          : task.safeErrorClass === "TASK_FAILED"
                          ? "rose"
                          : "slate"
                      }
                    />
                  </AdminTableCell>
                  <AdminTableCell className="text-xs">
                    {t(`admin.chargeStatus.${task.chargeStatus}`)}
                  </AdminTableCell>
                  <AdminTableCell className="text-xs">
                    {t(`admin.creditReleaseStatus.${task.creditReleaseStatus}`)}
                  </AdminTableCell>
                  <AdminTableCell className="text-xs">
                    {task.refundStatus === "UNKNOWN"
                      ? t("admin.refundUnknown")
                      : t("admin.notAvailable")}
                  </AdminTableCell>
                  <AdminTableCell className="text-xs">
                    {task.costRecorded
                      ? t("admin.costRecorded")
                      : t("admin.costNotRecorded")}
                  </AdminTableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminDataTable>
      )}
    </div>
  );
}

function ManualCompensationsSection({
  compensations
}: {
  compensations: AdminOperationsManualCompensation[];
}) {
  const { t } = useI18n();

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <SectionTitle title={t("admin.manualCompensations")} />
      {compensations.length === 0 ? (
        <OperationsEmptyBlock />
      ) : (
        <AdminDataTable className="bg-white">
          <table
            className="w-full min-w-[560px] text-left text-sm lg:min-w-[760px]"
            data-admin-data-surface="operations-manual-compensations"
          >
            <thead className="bg-slate-50">
              <tr>
                <AdminTableHeadCell priority="secondary">{t("admin.time")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.targetUserId")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.creditDelta")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.creditChangeStatus")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">{t("admin.action")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">{t("admin.auditId")}</AdminTableHeadCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {compensations.map((compensation) => (
                <tr key={compensation.auditId} className="text-slate-700" data-admin-table-row="true">
                  <AdminTableCell priority="secondary" className="whitespace-nowrap text-xs text-slate-500">
                    {formatAdminDate(compensation.createdAt)}
                  </AdminTableCell>
                  <AdminTableCell className="max-w-[180px] truncate font-mono text-xs">
                    {compensation.targetUserId}
                  </AdminTableCell>
                  <AdminTableCell className="font-semibold text-slate-950">
                    {formatCreditDelta(compensation)}
                  </AdminTableCell>
                  <AdminTableCell className="text-xs">
                    {compensation.creditChangeStatus === "RECORDED"
                      ? t("admin.compensationStatus.RECORDED")
                      : t("admin.compensationStatus.UNKNOWN")}
                  </AdminTableCell>
                  <AdminTableCell priority="secondary" className="text-xs">
                    {t("admin.manualQuotaUpdate")}
                  </AdminTableCell>
                  <AdminTableCell priority="tertiary" className="max-w-[180px] truncate font-mono text-xs">
                    {compensation.auditId}
                  </AdminTableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminDataTable>
      )}
    </div>
  );

  function formatCreditDelta(compensation: AdminOperationsManualCompensation) {
    const delta = compensation.creditDelta;
    if (compensation.creditChangeStatus !== "RECORDED" || delta === null) {
      return t("admin.creditDeltaUnknown");
    }

    if (delta > 0) {
      return `${t("admin.creditIncrease")} +${formatAdminNumber(delta)}`;
    }

    if (delta < 0) {
      return `${t("admin.creditDecrease")} ${formatAdminNumber(delta)}`;
    }

    return `${t("admin.creditUnchanged")} 0`;
  }
}

function BudgetsSection({ budgets }: { budgets: AdminOperationsBudget[] }) {
  const { t } = useI18n();

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <SectionTitle title={t("admin.budgets")} />
      {budgets.length === 0 ? (
        <OperationsEmptyBlock />
      ) : (
        <AdminDataTable className="bg-white">
          <table
            className="w-full min-w-[620px] text-left text-sm lg:min-w-[900px]"
            data-admin-data-surface="operations-budgets"
          >
            <thead className="bg-slate-50">
              <tr>
                <AdminTableHeadCell>{t("admin.scope")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">{t("admin.period")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.limit")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.used")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.remaining")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.status")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">{t("admin.updatedAt")}</AdminTableHeadCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {budgets.map((budget) => (
                <tr key={budget.scope} className="text-slate-700" data-admin-table-row="true">
                  <AdminTableCell className="font-semibold text-slate-950">
                    {t(`admin.budgetScope.${budget.scope}`)}
                  </AdminTableCell>
                  <AdminTableCell priority="secondary" className="whitespace-nowrap text-xs text-slate-500">
                    {budget.periodType && budget.periodKey
                      ? `${budget.periodType} ${budget.periodKey}`
                      : t("admin.notAvailable")}
                  </AdminTableCell>
                  <AdminTableCell>{formatBudgetNumber(budget.limit)}</AdminTableCell>
                  <AdminTableCell>{formatBudgetNumber(budget.used)}</AdminTableCell>
                  <AdminTableCell>{formatBudgetNumber(budget.remaining)}</AdminTableCell>
                  <AdminTableCell>
                    <OperationStatusBadge
                      label={t(`admin.budgetStatus.${budget.status}`)}
                      tone={
                        budget.status === "EXHAUSTED"
                          ? "rose"
                          : budget.status === "NEAR_LIMIT"
                          ? "amber"
                          : "slate"
                      }
                    />
                  </AdminTableCell>
                  <AdminTableCell priority="secondary" className="whitespace-nowrap text-xs text-slate-500">
                    {budget.updatedAt
                      ? formatAdminDate(budget.updatedAt)
                      : t("admin.notAvailable")}
                  </AdminTableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminDataTable>
      )}
    </div>
  );

  function formatBudgetNumber(value: number | null) {
    return value === null ? t("admin.notAvailable") : formatAdminNumber(value);
  }
}

function OperationStatusBadge({
  label,
  tone
}: {
  label: string;
  tone: "slate" | "amber" | "rose";
}) {
  return <AdminStatusBadge tone={tone}>{label}</AdminStatusBadge>;
}

function RecentFailuresList({
  failures
}: {
  failures: AdminOverview["stats"]["recentFailures"];
}) {
  const { t } = useI18n();

  return (
    <AdminSection>
      <AdminSectionHeader
        title={t("admin.recentFailures")}
        description={t("admin.latest5")}
      />
      {failures.length === 0 ? (
        <EmptyBlock />
      ) : (
        <div className="divide-y divide-slate-100 text-sm">
          {failures.map((failure) => (
            <div key={failure.id} className="grid gap-2 px-4 py-3 text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-950">
                  {failure.modelDisplayName ?? failure.model}
                </span>
                <span className="text-xs text-slate-500">
                  {formatAdminTime(failure.createdAt)}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {failure.userEmail ?? t("admin.guestUser")}
              </div>
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {failure.errorSummary || t("admin.safeFailureFallback")}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function RecentOrdersList({
  orders,
  paymentMethodLabels
}: {
  orders: AdminOverview["stats"]["recentOrders"];
  paymentMethodLabels: Parameters<typeof getOrderPaymentMethodLabel>[2];
}) {
  const { t } = useI18n();

  return (
    <AdminSection>
      <AdminSectionHeader
        title={t("admin.recentOrders")}
        description={t("admin.latest5")}
      />
      {orders.length === 0 ? (
        <EmptyBlock />
      ) : (
        <div className="divide-y divide-slate-100 text-sm">
          {orders.map((order) => (
            <div key={order.id} className="grid gap-2 px-4 py-3 text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-950">
                  {order.planName}
                </span>
                <span className="text-xs text-slate-500">
                  {formatAdminTime(order.createdAt)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{order.userEmail}</span>
                <span>{order.status}</span>
                <span>{formatPrice(order.amount)}</span>
                <span>
                  {getOrderPaymentMethodLabel(
                    order.paymentType,
                    order.paymentProvider,
                    paymentMethodLabels
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function EmptyBlock() {
  const { t } = useI18n();

  return (
    <div className="px-4 py-8 text-center text-sm text-slate-500">
      {t("admin.noData")}
    </div>
  );
}

function OperationsEmptyBlock() {
  const { t } = useI18n();

  return (
    <div
      className="border-t border-slate-100 bg-slate-50/40 px-4 py-7 text-center text-sm text-slate-500"
      data-admin-empty-state="operations"
    >
      {t("admin.noData")}
    </div>
  );
}

function formatAdminTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "slate"
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone?: "slate" | "emerald" | "amber" | "rose";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700"
  };

  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className={`rounded-md p-1.5 ${tones[tone]}`}>
          <Icon className="size-3.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 text-right text-[11px] font-semibold leading-4 text-slate-500">
          {label}
        </div>
      </div>
      <div className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
        {value}
      </div>
    </div>
  );
}

function ModelRanking({
  title,
  subtitle,
  models,
  valueLabel,
  valueKey
}: {
  title: string;
  subtitle?: string;
  models: AdminOverview["stats"]["modelTopByCalls"] | null | undefined;
  valueLabel: string;
  valueKey: "calls" | "creditsUsed" | "failed";
}) {
  const { t } = useI18n();
  const safeModels =
    asArray<AdminOverview["stats"]["modelTopByCalls"][number]>(models);

  return (
    <AdminSection>
      <AdminSectionHeader title={title} description={subtitle} />
      {safeModels.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          {t("admin.noData")}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 text-sm">
          {safeModels.map((model, index) => (
            <div
              key={`${model.model}-${index}`}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 px-4 py-3 text-slate-700"
            >
              <div className="flex size-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-950">
                  {model.displayName ?? model.model}
                </div>
                {model.displayName ? (
                  <div className="mt-0.5 truncate text-xs text-slate-400">
                    {model.model}
                  </div>
                ) : null}
                <div className="mt-1 text-xs text-slate-500">
                  {t("admin.successToday")}: {model.success} /{" "}
                  {t("admin.failedToday")}: {model.failed}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-slate-950">
                  {model[valueKey]}
                </div>
                <div className="text-xs text-slate-500">{valueLabel}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function SectionTitle({
  title,
  subtitle
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="border-b border-slate-200 bg-white px-5 py-4">
      <div className="text-sm font-semibold text-slate-950">{title}</div>
      {subtitle ? (
        <div className="mt-1 text-xs font-medium text-slate-500">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
