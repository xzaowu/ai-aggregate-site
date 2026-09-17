"use client";

import type { AiProviderAccountSummary } from "@ai-aggregate/shared";
import { Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, WandSparkles } from "lucide-react";
import React from "react";
import { ConfirmDialog } from "../../components/workspace/ConfirmDialog";
import { useI18n } from "../../lib/i18n/use-i18n";
import { AdminDataTable, AdminSection, AdminSectionHeader } from "./admin-layout";
import {
  defaultModerationRouteForm,
  circuitBreakerSettingsToForm,
  getModerationCoverage,
  getModerationRouteStatus,
  getModerationRouteTestPresentation,
  getModerationTestErrorKey,
  getModerationTestPresentation,
  parseCircuitBreakerForm,
  parseModerationRouteForm,
  type AdminModerationSettings,
  type CircuitBreakerFormState,
  type ModerationCircuitBreakerRouteStatus,
  type ModerationCircuitBreakerSettings,
  type ModerationCircuitBreakerStatus,
  type ModerationRouteFormState,
  type ModerationRouteInput,
  type ModerationRouteTestResponse
} from "./admin-moderation";
import { AdminModerationDrawer } from "./admin-moderation-drawer";

type ModerationLoadState = "loading" | "ready" | "error";

export interface AdminModerationSectionProps {
  settings: AdminModerationSettings | null;
  loadState: ModerationLoadState;
  loadError: string | null;
  accounts: AiProviderAccountSummary[];
  testResults: Record<string, ModerationRouteTestResponse | undefined>;
  testingRouteIds: Set<string>;
  savingSettings: boolean;
  savingRouteId: string | null;
  deletingRouteId: string | null;
  circuitBreakerStatus: ModerationCircuitBreakerStatus | null;
  circuitBreakerLoadState: ModerationLoadState;
  circuitBreakerLoadError: string | null;
  savingCircuitBreakerSettings: boolean;
  resettingCircuitBreaker: boolean;
  inputClass: string;
  checkboxClass: string;
  primaryButtonClass: string;
  iconButtonClass: string;
  toggleInlineClass: string;
  onReload: () => void;
  onToggleEnabled: (enabled: boolean) => void | Promise<boolean>;
  onCreateRoute: (input: ModerationRouteInput) => void | Promise<boolean>;
  onUpdateRoute: (
    routeId: string,
    input: ModerationRouteInput
  ) => void | Promise<boolean>;
  onDeleteRoute: (routeId: string) => void | Promise<boolean>;
  onTestRoute: (routeId: string) => void;
  onReloadCircuitBreaker: () => void;
  onSaveCircuitBreakerSettings: (
    settings: ModerationCircuitBreakerSettings
  ) => void | Promise<boolean>;
  onResetCircuitBreaker: () => void | Promise<boolean>;
}

export function AdminModerationSection({
  settings,
  loadState,
  loadError,
  accounts,
  testResults,
  testingRouteIds,
  savingSettings,
  savingRouteId,
  deletingRouteId,
  circuitBreakerStatus,
  circuitBreakerLoadState,
  circuitBreakerLoadError,
  savingCircuitBreakerSettings,
  resettingCircuitBreaker,
  inputClass,
  checkboxClass,
  primaryButtonClass,
  iconButtonClass,
  toggleInlineClass,
  onReload,
  onToggleEnabled,
  onCreateRoute,
  onUpdateRoute,
  onDeleteRoute,
  onTestRoute,
  onReloadCircuitBreaker,
  onSaveCircuitBreakerSettings,
  onResetCircuitBreaker
}: AdminModerationSectionProps) {
  const { t } = useI18n();
  const [drawerState, setDrawerState] = React.useState<
    { mode: "create"; form: ModerationRouteFormState } | {
      mode: "edit";
      routeId: string;
      form: ModerationRouteFormState;
    } | null
  >(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<
    AdminModerationSettings["routes"][number] | null
  >(null);

  const safeSettings = settings;
  const routes = safeSettings?.routes ?? [];
  const coverage = getModerationCoverage(routes);
  const enabledRoutes = routes.filter((route) => route.enabled).length;
  const compatibleRoutes = routes.filter(
    (route) => route.providerAccountCompatible
  ).length;

  function openCreate() {
    setFormError(null);
    setDrawerState({
      mode: "create",
      form: defaultModerationRouteForm(routes, accounts)
    });
  }

  function openEdit(route: AdminModerationSettings["routes"][number]) {
    setFormError(null);
    setDrawerState({
      mode: "edit",
      routeId: route.id,
      form: {
        providerAccountId: route.providerAccountId,
        upstreamModel: route.upstreamModel,
        endpointPath: route.endpointPath,
        priority: String(route.priority),
        timeoutMs: route.timeoutMs === null ? "" : String(route.timeoutMs),
        supportsText: route.supportsText,
        supportsImage: route.supportsImage,
        enabled: route.enabled
      }
    });
  }

  async function submitDrawer() {
    if (!drawerState) return;

    const parsed = parseModerationRouteForm(
      drawerState.form,
      routes,
      drawerState.mode === "edit" ? drawerState.routeId : undefined
    );
    if (!parsed.input) {
      setFormError(
        t(`admin.moderationFormError.${parsed.error ?? "providerAccountRequired"}`)
      );
      return;
    }

    const succeeded =
      drawerState.mode === "create"
        ? await onCreateRoute(parsed.input)
        : await onUpdateRoute(drawerState.routeId, parsed.input);
    if (succeeded) {
      setDrawerState(null);
      setFormError(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const succeeded = await onDeleteRoute(deleteTarget.id);
    if (succeeded) {
      setDeleteTarget(null);
    }
  }

  if (loadState === "loading") {
    return (
      <AdminSection>
        <AdminSectionHeader
          title={t("admin.contentSafety")}
          description={t("admin.contentSafetyLoading")}
        />
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500" role="status">
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          {t("admin.loading")}
        </div>
      </AdminSection>
    );
  }

  if (loadState === "error" || !safeSettings) {
    return (
      <AdminSection>
        <AdminSectionHeader
          title={t("admin.contentSafety")}
          description={t("admin.contentSafetyDescription")}
        />
        <div className="grid gap-3 px-4 py-6" role="alert">
          <p className="text-sm font-semibold text-rose-700">
            {loadError || t("admin.contentSafetyLoadFailed")}
          </p>
          <button className={primaryButtonClass} type="button" onClick={onReload}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {t("admin.retryModerationLoad")}
          </button>
        </div>
      </AdminSection>
    );
  }

  return (
    <>
      <AdminSection>
        <AdminSectionHeader
          title={t("admin.contentSafety")}
          description={t("admin.contentSafetyDescription")}
        >
          <button className={primaryButtonClass} type="button" onClick={openCreate}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("admin.createModerationRoute")}
          </button>
        </AdminSectionHeader>
        <div className="grid gap-4 border-b border-slate-200 bg-slate-50/50 p-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Summary label={t("admin.moderationGlobalEnabled")} value={safeSettings.enabled ? t("admin.enabled") : t("admin.disabled")} tone={safeSettings.enabled ? "success" : "neutral"} />
            <Summary label={t("admin.moderationTotalRoutes")} value={routes.length} />
            <Summary label={t("admin.moderationEnabledRoutes")} value={enabledRoutes} />
            <Summary label={t("admin.moderationCompatibleRoutes")} value={compatibleRoutes} />
            <Summary label={t("admin.moderationTextCoverage")} value={coverage.text ? t("admin.coverageComplete") : t("admin.coverageMissing")} tone={coverage.text ? "success" : "danger"} />
            <Summary label={t("admin.moderationImageCoverage")} value={coverage.image ? t("admin.coverageComplete") : t("admin.coverageMissing")} tone={coverage.image ? "success" : "danger"} />
          </div>
          <label className={`${toggleInlineClass} max-w-xl`}>
            <span>
              <span className="block">{t("admin.moderationGlobalSwitch")}</span>
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {t("admin.moderationGlobalSwitchHelp")}
              </span>
            </span>
            <input
              aria-label={t("admin.moderationGlobalSwitch")}
              checked={safeSettings.enabled}
              className={checkboxClass}
              disabled={savingSettings}
              type="checkbox"
              onChange={(event) => void onToggleEnabled(event.target.checked)}
            />
            {savingSettings ? (
              <span className="text-xs font-semibold text-sky-700" role="status">
                {t("admin.saving")}
              </span>
            ) : null}
          </label>
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900" role="note">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t("admin.moderationEnvironmentNotice")}</span>
          </div>
        </div>
        <CircuitBreakerPanel
          status={circuitBreakerStatus}
          loadState={circuitBreakerLoadState}
          loadError={circuitBreakerLoadError}
          routes={routes}
          saving={savingCircuitBreakerSettings}
          resetting={resettingCircuitBreaker}
          inputClass={inputClass}
          checkboxClass={checkboxClass}
          primaryButtonClass={primaryButtonClass}
          toggleInlineClass={toggleInlineClass}
          onReload={onReloadCircuitBreaker}
          onSave={onSaveCircuitBreakerSettings}
          onReset={onResetCircuitBreaker}
        />
        <div className="px-4 py-4">
          {routes.length === 0 ? (
            <div className="grid gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <WandSparkles className="mx-auto size-6 text-slate-400" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-700">{t("admin.noModerationRoutes")}</p>
              <p className="text-xs text-slate-500">{t("admin.noModerationRoutesHelp")}</p>
              <button className={`${primaryButtonClass} mx-auto`} type="button" onClick={openCreate}>
                <Plus className="size-3.5" aria-hidden="true" />
                {t("admin.createModerationRoute")}
              </button>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <AdminDataTable>
                  <table className="min-w-[1220px] w-full border-separate border-spacing-0 text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                      <tr>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationPriority")}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationProviderAccount")}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationUpstreamModel")}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationEndpointPath")}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationTimeout")}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationCapabilities")}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationRouteStatus")}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationTestResult")}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t("admin.moderationActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {routes.map((route) => (
                        <RouteRow
                          key={route.id}
                          route={route}
                          result={testResults[route.id]}
                          testing={testingRouteIds.has(route.id)}
                          deleting={deletingRouteId === route.id}
                          onEdit={() => openEdit(route)}
                          onDelete={() => setDeleteTarget(route)}
                          onTest={() => onTestRoute(route.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </AdminDataTable>
              </div>
              <div className="grid gap-3 md:hidden">
                {routes.map((route) => (
                  <RouteCard
                    key={route.id}
                    route={route}
                    result={testResults[route.id]}
                    testing={testingRouteIds.has(route.id)}
                    deleting={deletingRouteId === route.id}
                    onEdit={() => openEdit(route)}
                    onDelete={() => setDeleteTarget(route)}
                    onTest={() => onTestRoute(route.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </AdminSection>
      <AdminModerationDrawer
        open={drawerState !== null}
        mode={drawerState?.mode ?? "create"}
        form={drawerState?.form ?? defaultModerationRouteForm(routes, accounts)}
        accounts={accounts}
        inputClass={inputClass}
        checkboxClass={checkboxClass}
        toggleInlineClass={toggleInlineClass}
        primaryButtonClass={primaryButtonClass}
        iconButtonClass={iconButtonClass}
        busy={savingRouteId !== null}
        error={formError}
        onChange={(form) => {
          setFormError(null);
          setDrawerState((current) =>
            current ? { ...current, form } : current
          );
        }}
        onClose={() => {
          setDrawerState(null);
          setFormError(null);
        }}
        onSubmit={() => void submitDrawer()}
      />
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t("admin.confirmDeleteModerationRoute")}
        message={
          deleteTarget
            ? t("admin.confirmDeleteModerationRouteMessage", {
                account: deleteTarget.providerAccountName || t("admin.moderationAccountMissing"),
                model: deleteTarget.upstreamModel
              })
            : ""
        }
        confirmLabel={deletingRouteId ? t("admin.deleting") : t("admin.deleteModerationRoute")}
        cancelLabel={t("admin.cancel")}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

function CircuitBreakerPanel({
  status,
  loadState,
  loadError,
  routes,
  saving,
  resetting,
  inputClass,
  checkboxClass,
  primaryButtonClass,
  toggleInlineClass,
  onReload,
  onSave,
  onReset
}: {
  status: ModerationCircuitBreakerStatus | null;
  loadState: ModerationLoadState;
  loadError: string | null;
  routes: AdminModerationSettings["routes"];
  saving: boolean;
  resetting: boolean;
  inputClass: string;
  checkboxClass: string;
  primaryButtonClass: string;
  toggleInlineClass: string;
  onReload: () => void;
  onSave: (
    settings: ModerationCircuitBreakerSettings
  ) => void | Promise<boolean>;
  onReset: () => void | Promise<boolean>;
}) {
  const { locale, t } = useI18n();
  const [form, setForm] = React.useState<CircuitBreakerFormState>({
    enabled: false,
    failureThreshold: "3",
    cooldownMs: "60000"
  });
  const [formError, setFormError] = React.useState<
    "invalidThreshold" | "invalidCooldown" | null
  >(null);
  const [resetConfirmOpen, setResetConfirmOpen] = React.useState(false);
  const resetSubmissionRef = React.useRef(false);

  React.useEffect(() => {
    if (!status) return;
    setForm(circuitBreakerSettingsToForm(status.settings));
    setFormError(null);
  }, [status]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCircuitBreakerForm(form);
    if (!parsed.settings) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    void Promise.resolve(onSave(parsed.settings)).then((succeeded) => {
      if (succeeded === true) setFormError(null);
    });
  }

  async function confirmReset() {
    if (resetSubmissionRef.current || resetting) return;
    resetSubmissionRef.current = true;
    setResetConfirmOpen(false);
    try {
      await onReset();
    } finally {
      resetSubmissionRef.current = false;
    }
  }

  if (loadState === "loading") {
    return (
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-5">
        <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          {t("admin.circuitBreakerLoading")}
        </div>
      </div>
    );
  }

  if (loadState === "error" || !status) {
    return (
      <div className="grid gap-3 border-b border-slate-200 bg-rose-50/60 px-4 py-5" role="alert">
        <p className="text-sm font-semibold text-rose-700">
          {loadError || t("admin.circuitBreakerLoadFailed")}
        </p>
        <button
          className={`${primaryButtonClass} w-fit`}
          type="button"
          onClick={onReload}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {t("admin.circuitBreakerRefresh")}
        </button>
      </div>
    );
  }

  const openCount = status.routes.filter((route) => route.state === "open").length;
  const halfOpenCount = status.routes.filter(
    (route) => route.state === "half_open"
  ).length;

  return (
    <div className="min-w-0 border-b border-slate-200 bg-slate-50/70">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            {t("admin.circuitBreakerTitle")}
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            {t("admin.circuitBreakerDescription")}
          </p>
        </div>
        <button
          aria-label={t("admin.circuitBreakerRefresh")}
          className={primaryButtonClass}
          disabled={saving || resetting}
          type="button"
          onClick={onReload}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {t("admin.circuitBreakerRefresh")}
        </button>
      </div>
      <div className="grid gap-4 border-b border-slate-200 p-4">
        <form className="grid gap-4" noValidate onSubmit={submit}>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(10rem,0.8fr)_minmax(10rem,0.8fr)]">
            <label className={`${toggleInlineClass} min-h-11`}>
              <span>
                <span className="block">{t("admin.circuitBreakerEnabled")}</span>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  {t("admin.circuitBreakerEnabledHelp")}
                </span>
              </span>
              <input
                aria-label={t("admin.circuitBreakerEnabled")}
                checked={form.enabled}
                className={checkboxClass}
                type="checkbox"
                onChange={(event) =>
                  setForm((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              <span>{t("admin.circuitBreakerFailureThreshold")}</span>
              <input
                aria-label={t("admin.circuitBreakerFailureThreshold")}
                className={inputClass}
                inputMode="numeric"
                max={20}
                min={1}
                type="number"
                value={form.failureThreshold}
                onChange={(event) => {
                  setFormError(null);
                  setForm((current) => ({
                    ...current,
                    failureThreshold: event.target.value
                  }));
                }}
              />
              <span className="font-normal text-slate-500">
                {t("admin.circuitBreakerThresholdHelp")}
              </span>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              <span>{t("admin.circuitBreakerCooldown")}</span>
              <input
                aria-label={t("admin.circuitBreakerCooldown")}
                className={inputClass}
                inputMode="numeric"
                max={600000}
                min={1000}
                type="number"
                value={form.cooldownMs}
                onChange={(event) => {
                  setFormError(null);
                  setForm((current) => ({
                    ...current,
                    cooldownMs: event.target.value
                  }));
                }}
              />
              <span className="font-normal text-slate-500">
                {t("admin.circuitBreakerCooldownHelp")}
              </span>
            </label>
          </div>
          {formError ? (
            <p className="text-xs font-semibold text-rose-700" role="alert">
              {t(`admin.circuitBreakerFormError.${formError}`)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              className={primaryButtonClass}
              disabled={saving}
              type="submit"
            >
              <Save className="size-3.5" aria-hidden="true" />
              {saving ? t("admin.circuitBreakerSaving") : t("admin.circuitBreakerSave")}
            </button>
            <button
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={resetting}
              type="button"
              onClick={() => setResetConfirmOpen(true)}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {resetting ? t("admin.circuitBreakerResetting") : t("admin.circuitBreakerReset")}
            </button>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            {t("admin.circuitBreakerResetHelp")}
          </p>
        </form>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Summary
            label={t("admin.circuitBreakerRuntimeStatus")}
            value={status.settings.enabled ? t("admin.enabled") : t("admin.disabled")}
            tone={status.settings.enabled ? "success" : "neutral"}
          />
          <Summary
            label={t("admin.circuitBreakerFailureThreshold")}
            value={status.settings.failureThreshold}
          />
          <Summary
            label={t("admin.circuitBreakerCooldown")}
            value={`${status.settings.cooldownMs} ms`}
          />
          <Summary
            label={t("admin.circuitBreakerRuntimeEntries")}
            value={status.routes.length}
          />
          <Summary
            label={t("admin.circuitBreakerOpenSummary")}
            value={`${openCount} / ${halfOpenCount}`}
          />
        </div>
      </div>
      <div className="grid gap-3 p-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            {t("admin.circuitBreakerRuntimeStatus")}
          </h4>
        </div>
        {status.routes.length === 0 ? (
          <div className="grid gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
            <p className="text-sm font-semibold text-slate-700">
              {t("admin.circuitBreakerRuntimeEmpty")}
            </p>
            <p className="text-xs text-slate-500">
              {t("admin.circuitBreakerRuntimeEmptyHelp")}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <CircuitBreakerRuntimeTable
                entries={status.routes}
                routes={routes}
                locale={locale}
                emptyLabel={t("admin.notAvailable")}
              />
            </div>
            <div className="grid gap-3 md:hidden">
              {status.routes.map((entry) => (
                <CircuitBreakerRuntimeCard
                  key={`${entry.routeId}:${entry.inputType}`}
                  entry={entry}
                  route={routes.find((route) => route.id === entry.routeId)}
                  locale={locale}
                  emptyLabel={t("admin.notAvailable")}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        isOpen={resetConfirmOpen}
        title={t("admin.circuitBreakerResetConfirmTitle")}
        message={t("admin.circuitBreakerResetConfirmBody")}
        confirmLabel={t("admin.circuitBreakerReset")}
        cancelLabel={t("admin.cancel")}
        onConfirm={() => void confirmReset()}
        onCancel={() => {
          if (!resetting) setResetConfirmOpen(false);
        }}
      />
    </div>
  );
}

function CircuitBreakerRuntimeTable({
  entries,
  routes,
  locale,
  emptyLabel
}: {
  entries: ModerationCircuitBreakerRouteStatus[];
  routes: AdminModerationSettings["routes"];
  locale: string;
  emptyLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-[980px] w-full text-left text-xs">
        <thead className="bg-slate-50 font-semibold text-slate-500">
          <tr>
            <th className="px-3 py-3">{t("admin.circuitBreakerRoute")}</th>
            <th className="px-3 py-3">{t("admin.circuitBreakerInputType")}</th>
            <th className="px-3 py-3">{t("admin.circuitBreakerState")}</th>
            <th className="px-3 py-3">{t("admin.circuitBreakerConsecutiveFailures")}</th>
            <th className="px-3 py-3">{t("admin.circuitBreakerLastFailure")}</th>
            <th className="px-3 py-3">{t("admin.circuitBreakerRetryAt")}</th>
            <th className="px-3 py-3">{t("admin.circuitBreakerLastSuccess")}</th>
            <th className="px-3 py-3">{t("admin.circuitBreakerCounters")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map((entry) => (
            <CircuitBreakerRuntimeRow
              key={`${entry.routeId}:${entry.inputType}`}
              entry={entry}
              route={routes.find((route) => route.id === entry.routeId)}
              locale={locale}
              emptyLabel={emptyLabel}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CircuitBreakerRuntimeRow({
  entry,
  route,
  locale,
  emptyLabel
}: {
  entry: ModerationCircuitBreakerRouteStatus;
  route: AdminModerationSettings["routes"][number] | undefined;
  locale: string;
  emptyLabel: string;
}) {
  const { t } = useI18n();
  return (
    <tr className="align-top text-slate-700">
      <td className="px-3 py-3"><CircuitBreakerRouteIdentity entry={entry} route={route} /></td>
      <td className="px-3 py-3"><CircuitBreakerInputType inputType={entry.inputType} /></td>
      <td className="px-3 py-3"><CircuitBreakerStateBadge state={entry.state} /></td>
      <td className="px-3 py-3 font-semibold">{entry.consecutiveFailures}</td>
      <td className="px-3 py-3"><CircuitBreakerLastFailure entry={entry} locale={locale} emptyLabel={emptyLabel} /></td>
      <td className="whitespace-nowrap px-3 py-3">{formatCircuitBreakerTime(entry.retryAt, locale, emptyLabel)}</td>
      <td className="whitespace-nowrap px-3 py-3">{formatCircuitBreakerTime(entry.lastSuccessAt, locale, emptyLabel)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-slate-500">
        {t("admin.circuitBreakerOpens")}: {entry.opens}<br />
        {t("admin.circuitBreakerRecoveries")}: {entry.recoveries}<br />
        {t("admin.circuitBreakerSkips")}: {entry.skips}
      </td>
    </tr>
  );
}

function CircuitBreakerRuntimeCard({
  entry,
  route,
  locale,
  emptyLabel
}: {
  entry: ModerationCircuitBreakerRouteStatus;
  route: AdminModerationSettings["routes"][number] | undefined;
  locale: string;
  emptyLabel: string;
}) {
  const { t } = useI18n();
  return (
    <article className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <CircuitBreakerRouteIdentity entry={entry} route={route} />
        <CircuitBreakerStateBadge state={entry.state} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
        <CircuitBreakerField label={t("admin.circuitBreakerInputType")} value={<CircuitBreakerInputType inputType={entry.inputType} />} />
        <CircuitBreakerField label={t("admin.circuitBreakerConsecutiveFailures")} value={entry.consecutiveFailures} />
        <CircuitBreakerField label={t("admin.circuitBreakerLastFailure")} value={<CircuitBreakerLastFailure entry={entry} locale={locale} emptyLabel={emptyLabel} />} />
        <CircuitBreakerField label={t("admin.circuitBreakerRetryAt")} value={formatCircuitBreakerTime(entry.retryAt, locale, emptyLabel)} />
        <CircuitBreakerField label={t("admin.circuitBreakerLastSuccess")} value={formatCircuitBreakerTime(entry.lastSuccessAt, locale, emptyLabel)} />
        <CircuitBreakerField
          label={t("admin.circuitBreakerCounters")}
          value={
            <span>
              {t("admin.circuitBreakerOpens")}: {entry.opens}<br />
              {t("admin.circuitBreakerRecoveries")}: {entry.recoveries}<br />
              {t("admin.circuitBreakerSkips")}: {entry.skips}
            </span>
          }
        />
      </div>
    </article>
  );
}

function CircuitBreakerField({
  label,
  value
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="font-semibold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-slate-700">{value}</div>
    </div>
  );
}

function CircuitBreakerRouteIdentity({
  entry,
  route
}: {
  entry: ModerationCircuitBreakerRouteStatus;
  route: AdminModerationSettings["routes"][number] | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <div className="break-words font-semibold text-slate-950">
        {route?.providerAccountName || (route ? t("admin.moderationAccountMissing") : entry.routeId)}
      </div>
      {route ? <div className="break-all font-mono text-xs text-slate-600">{route.upstreamModel}</div> : null}
      <div className="mt-1 break-all font-mono text-[11px] text-slate-400">{entry.routeId}</div>
    </div>
  );
}

function CircuitBreakerInputType({
  inputType
}: {
  inputType: ModerationCircuitBreakerRouteStatus["inputType"];
}) {
  const { t } = useI18n();
  return <span>{inputType === "text" ? t("admin.circuitBreakerText") : t("admin.circuitBreakerImage")}</span>;
}

function CircuitBreakerStateBadge({
  state
}: {
  state: ModerationCircuitBreakerRouteStatus["state"];
}) {
  const { t } = useI18n();
  const labels = {
    closed: t("admin.circuitBreakerClosed"),
    open: t("admin.circuitBreakerOpen"),
    half_open: t("admin.circuitBreakerHalfOpen")
  } as const;
  const tone = state === "closed" ? "success" : state === "open" ? "danger" : "warning";
  return (
    <span role="status" aria-label={labels[state]}>
      <Status text={labels[state]} tone={tone} />
    </span>
  );
}

function CircuitBreakerLastFailure({
  entry,
  locale,
  emptyLabel
}: {
  entry: ModerationCircuitBreakerRouteStatus;
  locale: string;
  emptyLabel: string;
}) {
  const { t } = useI18n();
  if (entry.lastFailureAt === null) return <span>{emptyLabel}</span>;
  const failureType = entry.lastFailureType
    ? t(`admin.circuitBreakerFailureType.${entry.lastFailureType}`)
    : emptyLabel;
  return (
    <span className="break-words">
      {formatCircuitBreakerTime(entry.lastFailureAt, locale, emptyLabel)} | {failureType}
    </span>
  );
}

function formatCircuitBreakerTime(
  value: number | null,
  locale: string,
  emptyLabel: string
): string {
  if (value === null) return emptyLabel;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(value);
}

function Summary({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "danger"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-slate-200 bg-white text-slate-700";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClass}`}>
      <div className="text-xs font-semibold opacity-75">{label}</div>
      <div className="mt-1 text-sm font-bold">{value}</div>
    </div>
  );
}

function RouteRow({
  route,
  result,
  testing,
  deleting,
  onEdit,
  onDelete,
  onTest
}: {
  route: AdminModerationSettings["routes"][number];
  result?: ModerationRouteTestResponse;
  testing: boolean;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const { t } = useI18n();
  return (
    <tr className="align-top text-slate-700">
      <td className="px-3 py-3 font-semibold">{route.priority}</td>
      <td className="px-3 py-3">
        <div className="font-semibold text-slate-950">{route.providerAccountName || t("admin.moderationAccountMissing")}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Status text={route.providerAccountEnabled ? t("admin.moderationAccountEnabled") : t("admin.moderationAccountDisabled")} tone={route.providerAccountEnabled ? "success" : "neutral"} />
          <Status text={route.providerAccountCompatible ? t("admin.providerModerationCompatible") : t("admin.providerModerationIncompatible")} tone={route.providerAccountCompatible ? "success" : "danger"} />
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-xs">{route.upstreamModel}</td>
      <td className="px-3 py-3 font-mono text-xs">{route.endpointPath}</td>
      <td className="whitespace-nowrap px-3 py-3 text-xs">{route.timeoutMs === null ? t("admin.moderationTimeoutInherited") : `${route.timeoutMs} ms`}</td>
      <td className="px-3 py-3 text-xs">
        <div>{t("admin.moderationTextCapability")}: {route.supportsText ? t("admin.yes") : t("admin.no")}</div>
        <div>{t("admin.moderationImageCapability")}: {route.supportsImage ? t("admin.yes") : t("admin.no")}</div>
      </td>
      <td className="px-3 py-3"><RouteStatus route={route} /></td>
      <td className="min-w-[210px] px-3 py-3"><TestResult result={result} testing={testing} /></td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          <button aria-label={`${t("admin.testModerationRoute")}: ${route.upstreamModel}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-sky-200 px-2 py-1.5 text-xs font-semibold text-sky-700 disabled:text-slate-300" disabled={testing} type="button" onClick={onTest}>
            <WandSparkles className="size-3.5" aria-hidden="true" />
            {testing ? t("admin.testingModerationRoute") : t("admin.testModerationRoute")}
          </button>
          <button aria-label={`${t("admin.editModerationRoute")}: ${route.upstreamModel}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700" type="button" onClick={onEdit}>
            <Pencil className="size-3.5" aria-hidden="true" />
            {t("admin.edit")}
          </button>
          <button aria-label={`${t("admin.deleteModerationRoute")}: ${route.upstreamModel}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-rose-200 px-2 py-1.5 text-xs font-semibold text-rose-700 disabled:text-rose-300" disabled={deleting} type="button" onClick={onDelete}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("admin.delete")}
          </button>
        </div>
      </td>
    </tr>
  );
}

function RouteCard({
  route,
  result,
  testing,
  deleting,
  onEdit,
  onDelete,
  onTest
}: Parameters<typeof RouteRow>[0]) {
  const { t } = useI18n();
  return (
    <article className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-500">{t("admin.moderationPriority")} {route.priority}</div>
          <h3 className="mt-1 break-all font-mono text-sm font-semibold text-slate-950">{route.upstreamModel}</h3>
        </div>
        <RouteStatus route={route} />
      </div>
      <div className="grid gap-2 text-xs text-slate-600">
        <div><span className="font-semibold text-slate-700">{t("admin.moderationProviderAccount")}：</span>{route.providerAccountName || t("admin.moderationAccountMissing")}</div>
        <div><span className="font-semibold text-slate-700">{t("admin.moderationEndpointPath")}：</span><span className="font-mono">{route.endpointPath}</span></div>
        <div><span className="font-semibold text-slate-700">{t("admin.moderationTimeout")}：</span>{route.timeoutMs === null ? t("admin.moderationTimeoutInherited") : `${route.timeoutMs} ms`}</div>
        <div className="flex flex-wrap gap-1"><Status text={`${t("admin.moderationTextCapability")}: ${route.supportsText ? t("admin.yes") : t("admin.no")}`} tone={route.supportsText ? "success" : "neutral"} /><Status text={`${t("admin.moderationImageCapability")}: ${route.supportsImage ? t("admin.yes") : t("admin.no")}`} tone={route.supportsImage ? "success" : "neutral"} /></div>
      </div>
      <div className="rounded-lg bg-slate-50 p-3"><TestResult result={result} testing={testing} /></div>
      <div className="grid grid-cols-3 gap-2">
        <button aria-label={`${t("admin.testModerationRoute")}: ${route.upstreamModel}`} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-sky-200 px-2 py-2 text-xs font-semibold text-sky-700 disabled:text-slate-300" disabled={testing} type="button" onClick={onTest}><WandSparkles className="size-3.5" aria-hidden="true" />{testing ? t("admin.testingModerationRoute") : t("admin.testModerationRoute")}</button>
        <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-700" type="button" onClick={onEdit}><Pencil className="size-3.5" aria-hidden="true" />{t("admin.edit")}</button>
        <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-rose-200 px-2 py-2 text-xs font-semibold text-rose-700 disabled:text-rose-300" disabled={deleting} type="button" onClick={onDelete}><Trash2 className="size-3.5" aria-hidden="true" />{t("admin.delete")}</button>
      </div>
    </article>
  );
}

function RouteStatus({ route }: { route: AdminModerationSettings["routes"][number] }) {
  const { t } = useI18n();
  const status = getModerationRouteStatus(route);
  const labels = {
    "route-disabled": t("admin.moderationRouteDisabled"),
    "account-disabled": t("admin.moderationAccountDisabled"),
    "account-missing": t("admin.moderationAccountMissing"),
    incompatible: t("admin.providerModerationIncompatible"),
    runnable: t("admin.moderationRunnable")
  } as const;
  const tone = status === "runnable" ? "success" : status === "route-disabled" ? "neutral" : "danger";
  return <Status text={labels[status]} tone={tone} />;
}

function Status({ text, tone }: { text: string; tone: "neutral" | "success" | "danger" | "warning" }) {
  const classes = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
    warning: "border-amber-200 bg-amber-50 text-amber-800"
  };
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold leading-none ${classes[tone]}`}>{text}</span>;
}

function TestResult({ result, testing }: { result?: ModerationRouteTestResponse; testing: boolean }) {
  const { t } = useI18n();
  if (testing) {
    return <span className="text-xs font-semibold text-sky-700" role="status">{t("admin.testingModerationRoute")}</span>;
  }
  if (!result) return <span className="text-xs text-slate-400">{t("admin.moderationNotTested")}</span>;
  const overall = getModerationRouteTestPresentation(result);
  const overallLabel = {
    allowed: t("admin.moderationTestPassed"),
    blocked: t("admin.moderationTestCompatibleButBlocked"),
    error: t("admin.moderationTestFailed"),
    unsupported: t("admin.moderationNoSupportedInput"),
    "not-tested": t("admin.moderationNotTested")
  }[overall];
  const overallTone = overall === "allowed" ? "success" : overall === "blocked" ? "warning" : overall === "unsupported" ? "neutral" : "danger";
  return (
    <div className="grid gap-2">
      <Status text={overallLabel} tone={overallTone} />
      <div className="grid gap-1 text-xs text-slate-600">
        <TestItem label={t("admin.moderationTextCapability")} item={result.text} />
        <TestItem label={t("admin.moderationImageCapability")} item={result.image} />
      </div>
    </div>
  );
}

function TestItem({ label, item }: { label: string; item: ModerationRouteTestResponse["text"] }) {
  const { t } = useI18n();
  const presentation = getModerationTestPresentation(item);
  const text =
    presentation === "unsupported"
      ? t("admin.moderationInputUnsupported")
      : presentation === "allowed"
        ? `${t("admin.moderationSampleAllowed")}${typeof item.latencyMs === "number" ? ` · ${item.latencyMs} ms` : ""}`
        : presentation === "blocked"
          ? `${t("admin.moderationSampleBlocked")}${typeof item.latencyMs === "number" ? ` · ${item.latencyMs} ms` : ""}`
          : presentation === "error"
            ? t(getModerationTestErrorKey(item.errorType))
            : t("admin.moderationNotTested");
  const tone = presentation === "allowed" ? "success" : presentation === "blocked" ? "warning" : presentation === "unsupported" ? "neutral" : "danger";
  return <div className="flex min-w-0 items-start gap-1.5"><span className="shrink-0 font-semibold">{label}:</span><Status text={text} tone={tone} /></div>;
}
