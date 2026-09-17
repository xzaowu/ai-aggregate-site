"use client";

import type {
  AiModelRouteSummary,
  AdminAiModelSummary,
  AiProviderAccountSummary
} from "@ai-aggregate/shared";
import { Save, Trash2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { readStoredAuthState } from "../../components/auth-state";
import { apiUrl } from "../../lib/site-config";
import { AdminFormActions } from "./admin-layout";

export interface ModelRouteFormState {
  providerAccountId: string;
  upstreamModel: string;
  priority: string;
  enabled: boolean;
}

interface RouteDraftState {
  providerAccountId: string;
  upstreamModel: string;
  priority: string;
  enabled: boolean;
}

export interface ModelRouteTestResult {
  status: "success" | "error";
  message: string;
  errorCode?: string;
  capability?: "chat" | "image" | "video" | "ppt";
  requestFormat?: "openai-compatible" | "anthropic";
  imageTransport?: "openai-images" | "legacy-extra-body-v1";
  upstreamModel?: string;
  latencyMs?: number;
  endpointPath?: string;
  statusCode?: number;
  routeEnabled?: boolean;
  providerEnabled?: boolean;
}

interface AdminModelRoutesEditorProps {
  model: AdminAiModelSummary;
  routes: AiModelRouteSummary[];
  providerAccounts: AiProviderAccountSummary[];
  routeForm: ModelRouteFormState;
  savingModelRouteId: string | null;
  inputClass: string;
  checkboxClass: string;
  primaryButtonClass: string;
  toggleInlineClass: string;
  onRouteFormChange: (form: ModelRouteFormState) => void;
  onCreateRoute: (model: AdminAiModelSummary) => void;
  onUpdateRoute: (
    model: AdminAiModelSummary,
    route: AiModelRouteSummary,
    patch: Partial<
      Pick<AiModelRouteSummary, "providerId" | "upstreamModel" | "priority" | "enabled">
    >
  ) => void;
  onDisableRoute: (model: AdminAiModelSummary, route: AiModelRouteSummary) => void;
}

export function AdminModelRoutesEditor({
  model,
  routes,
  providerAccounts,
  routeForm,
  savingModelRouteId,
  inputClass,
  checkboxClass,
  primaryButtonClass,
  toggleInlineClass,
  onRouteFormChange,
  onCreateRoute,
  onUpdateRoute,
  onDisableRoute
}: AdminModelRoutesEditorProps) {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [routeDrafts, setRouteDrafts] = useState<Record<string, RouteDraftState>>({});
  const [testingRouteId, setTestingRouteId] = useState<string | null>(null);
  const [routeTestResults, setRouteTestResults] = useState<
    Record<string, ModelRouteTestResult | undefined>
  >({});
  const routeTestGenerationRef = React.useRef(new Map<string, number>());
  const testingRouteIdRef = React.useRef<string | null>(null);

  function nextRouteTestGeneration(routeId: string): number {
    const generation = (routeTestGenerationRef.current.get(routeId) ?? 0) + 1;
    routeTestGenerationRef.current.set(routeId, generation);
    return generation;
  }

  function invalidateRouteTest(routeId: string) {
    nextRouteTestGeneration(routeId);
    setRouteTestResults((current) => {
      const next = { ...current };
      delete next[routeId];
      return next;
    });
  }

  function invalidateAllRouteTests() {
    for (const routeId of routeTestGenerationRef.current.keys()) {
      nextRouteTestGeneration(routeId);
    }
    for (const route of routes) {
      nextRouteTestGeneration(route.id);
    }
    if (testingRouteIdRef.current === null) {
      setTestingRouteId(null);
    }
    setRouteTestResults({});
  }

  function isCurrentRouteTest(routeId: string, generation: number): boolean {
    return routeTestGenerationRef.current.get(routeId) === generation;
  }

  function beginRouteTest(routeId: string): number {
    const generation = nextRouteTestGeneration(routeId);
    testingRouteIdRef.current = routeId;
    setTestingRouteId(routeId);
    return generation;
  }

  function updateRouteDraft(
    routeId: string,
    patch: Partial<RouteDraftState>
  ) {
    invalidateRouteTest(routeId);
    setRouteDrafts((current) => ({
      ...current,
      [routeId]: {
        ...(current[routeId] ?? {
          providerAccountId: "",
          upstreamModel: "",
          priority: "1",
          enabled: true
        }),
        ...patch
      }
    }));
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      setToken(readStoredAuthState(window.localStorage).token);
    }
  }, []);

  useEffect(() => {
    invalidateAllRouteTests();
    setRouteDrafts((current) => {
      const next: Record<string, RouteDraftState> = {};

      for (const route of routes) {
        next[route.id] = current[route.id] ?? {
          providerAccountId: route.providerId,
          upstreamModel: route.upstreamModel,
          priority: String(route.priority),
          enabled: route.enabled
        };
      }

      return next;
    });
  }, [routes]);

  async function testRoute(route: AiModelRouteSummary) {
    if (testingRouteIdRef.current !== null) {
      return;
    }

    if (!token) {
      setRouteTestResults((current) => ({
        ...current,
        [route.id]: {
          status: "error",
          message: "Admin authentication required",
          errorCode: "ADMIN_AUTH_REQUIRED"
        }
      }));
      return;
    }

    const generation = beginRouteTest(route.id);
    setRouteTestResults((current) => {
      const next = { ...current };
      delete next[route.id];
      return next;
    });

    try {
      const response = await fetch(
        apiUrl(`/admin/model-routes/${encodeURIComponent(route.id)}/test`),
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` }
        }
      );
      const data = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const errorCode =
        typeof data?.errorCode === "string"
          ? data.errorCode
          : typeof data?.code === "string"
            ? data.code
            : undefined;
      const message = safeRouteTestMessage(
        data?.message,
        response.ok && data?.success === true ? "线路测试成功" : "线路测试失败"
      );
      const success = response.ok && data?.success === true;
      const result: ModelRouteTestResult = {
        status: success ? "success" : "error",
        message,
        ...(errorCode ? { errorCode } : {}),
        ...(isRouteTestCapability(data?.capability)
          ? { capability: data?.capability }
          : {}),
        ...(isRouteTestRequestFormat(data?.requestFormat)
          ? { requestFormat: data.requestFormat }
          : {}),
        ...(isRouteTestImageTransport(data?.imageTransport)
          ? { imageTransport: data.imageTransport }
          : {}),
        ...(safeRouteTestString(data?.upstreamModel)
          ? { upstreamModel: data.upstreamModel }
          : {}),
        ...(safeRouteTestNumber(data?.latencyMs)
          ? { latencyMs: data.latencyMs }
          : {}),
        ...(safeRouteTestPath(data?.endpointPath)
          ? { endpointPath: data.endpointPath }
          : {}),
        ...(safeRouteTestStatusCode(data?.statusCode)
          ? { statusCode: data.statusCode }
          : {}),
        ...(typeof data?.routeEnabled === "boolean"
          ? { routeEnabled: data.routeEnabled }
          : {}),
        ...(typeof data?.providerEnabled === "boolean"
          ? { providerEnabled: data.providerEnabled }
          : {})
      };
      if (!isCurrentRouteTest(route.id, generation)) {
        return;
      }
      setRouteTestResults((current) => ({
        ...current,
        [route.id]: result
      }));
    } catch {
      if (!isCurrentRouteTest(route.id, generation)) {
        return;
      }
      setRouteTestResults((current) => ({
        ...current,
        [route.id]: {
          status: "error",
          message: "线路测试失败",
          errorCode: "ROUTE_TEST_REQUEST_FAILED"
        }
      }));
    } finally {
      if (
        !isCurrentRouteTest(route.id, generation) &&
        testingRouteIdRef.current !== route.id
      ) {
        return;
      }
      testingRouteIdRef.current = null;
      setTestingRouteId((current) => (current === route.id ? null : current));
    }
  }

  const enabledRoutes = routes.filter((route) => route.enabled).length;

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-500">
          {t("admin.canonicalId")}:{" "}
          <code className="font-mono text-slate-700">{model.slug}</code>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={enabledRoutes > 0 ? "emerald" : "slate"}>
            {t("admin.enabledRoutes")}: {enabledRoutes}
          </Badge>
          <Badge tone="slate">
            {t("admin.totalRoutes")}: {routes.length}
          </Badge>
        </div>
      </div>

      <div className="min-w-0 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-[760px] w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <TableHead label={t("admin.providerAccount")} />
              <TableHead label={t("admin.upstreamModelId")} />
              <TableHead label={t("admin.routePriority")} />
              <TableHead label={t("admin.enabled")} />
              <TableHead label={t("admin.actions")} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {routes.length === 0 ? (
              <tr>
                <td className="px-4 py-5 text-sm text-slate-500" colSpan={5}>
                  {t("admin.noModelRoutes")}
                </td>
              </tr>
            ) : (
              routes.map((route) => {
                const draft = routeDrafts[route.id] ?? {
                  providerAccountId: route.providerId,
                  upstreamModel: route.upstreamModel,
                  priority: String(route.priority),
                  enabled: route.enabled
                };
                const priority = Number(draft.priority);
                const canSave =
                  draft.providerAccountId.trim().length > 0 &&
                  draft.upstreamModel.trim().length > 0 &&
                  Number.isInteger(priority);

                return (
                  <tr key={route.id} data-admin-model-route>
                    <td className="px-3 py-3">
                      <select
                        className={inputClass}
                        aria-label={`${t("admin.providerAccount")} ${route.id}`}
                        value={draft.providerAccountId}
                        disabled={savingModelRouteId === route.id}
                        onChange={(event) =>
                          updateRouteDraft(route.id, {
                            providerAccountId: event.target.value
                          })
                        }
                      >
                        {providerAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        className={`${inputClass} font-mono`}
                        aria-label={`${t("admin.upstreamModelId")} ${route.id}`}
                        value={draft.upstreamModel}
                        disabled={savingModelRouteId === route.id}
                        onChange={(event) =>
                          updateRouteDraft(route.id, {
                            upstreamModel: event.target.value
                          })
                        }
                      />
                    </td>
                    <td className="w-28 px-3 py-3">
                      <input
                        className={inputClass}
                        aria-label={`${t("admin.routePriority")} ${route.id}`}
                        type="number"
                        value={draft.priority}
                        disabled={savingModelRouteId === route.id}
                        onChange={(event) =>
                          updateRouteDraft(route.id, {
                            priority: event.target.value
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <label className={toggleInlineClass}>
                        <input
                          checked={draft.enabled}
                          className={checkboxClass}
                          type="checkbox"
                          disabled={savingModelRouteId === route.id}
                          onChange={(event) =>
                            updateRouteDraft(route.id, {
                              enabled: event.target.checked
                            })
                          }
                        />
                        {draft.enabled ? t("admin.enabled") : t("admin.disabled")}
                      </label>
                    </td>
                    <td className="px-3 py-3">
                      <AdminFormActions className="min-w-max justify-start">
                        <button
                          className={primaryButtonClass}
                          type="button"
                          disabled={savingModelRouteId === route.id || !canSave}
                          onClick={() => {
                            invalidateRouteTest(route.id);
                            onUpdateRoute(model, route, {
                              providerId: draft.providerAccountId.trim(),
                              upstreamModel: draft.upstreamModel.trim(),
                              priority,
                              enabled: draft.enabled
                            });
                          }}
                        >
                          <Save className="size-3.5" aria-hidden="true" />
                          {t("admin.saveRoute")}
                        </button>
                        <button
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:text-sky-300"
                          type="button"
                          disabled={testingRouteId !== null}
                          onClick={() => void testRoute(route)}
                        >
                          {testingRouteId === route.id
                            ? "测试中 / Testing"
                            : "测试此线路"}
                        </button>
                        <button
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:text-rose-300"
                          type="button"
                          disabled={savingModelRouteId === route.id || !route.enabled}
                          onClick={() => {
                            invalidateRouteTest(route.id);
                            onDisableRoute(model, route);
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          {t("admin.disableRoute")}
                        </button>
                      </AdminFormActions>
                      {routeTestResults[route.id] ? (
                        <RouteTestResultCard result={routeTestResults[route.id]} />
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
            <tr className="bg-slate-50/60">
              <td className="px-3 py-3">
                <select
                  className={inputClass}
                  aria-label={t("admin.providerAccount")}
                  value={routeForm.providerAccountId}
                  onChange={(event) =>
                    onRouteFormChange({
                      ...routeForm,
                      providerAccountId: event.target.value
                    })
                  }
                >
                  {providerAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-3">
                <input
                  className={`${inputClass} font-mono`}
                  aria-label={t("admin.upstreamModelId")}
                  placeholder={t("admin.upstreamModelId")}
                  value={routeForm.upstreamModel}
                  onChange={(event) =>
                    onRouteFormChange({
                      ...routeForm,
                      upstreamModel: event.target.value
                    })
                  }
                />
              </td>
              <td className="w-28 px-3 py-3">
                <input
                  className={inputClass}
                  aria-label={t("admin.routePriority")}
                  type="number"
                  placeholder={t("admin.routePriority")}
                  value={routeForm.priority}
                  onChange={(event) =>
                    onRouteFormChange({
                      ...routeForm,
                      priority: event.target.value
                    })
                  }
                />
              </td>
              <td className="px-3 py-3">
                <label className={toggleInlineClass}>
                  <input
                    checked={routeForm.enabled}
                    className={checkboxClass}
                    type="checkbox"
                    onChange={(event) =>
                      onRouteFormChange({
                        ...routeForm,
                        enabled: event.target.checked
                      })
                    }
                  />
                  {t("admin.enabled")}
                </label>
              </td>
              <td className="px-3 py-3">
                <button
                  className={primaryButtonClass}
                  type="button"
                  disabled={
                    savingModelRouteId === `new:${model.id}` ||
                    providerAccounts.length === 0
                  }
                  onClick={() => onCreateRoute(model)}
                >
                  <Save className="size-3.5" aria-hidden="true" />
                  {t("admin.addRoute")}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function safeRouteTestMessage(value: unknown, fallback: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 240 ||
    /https?:\/\/|\bsk-[A-Za-z0-9_-]+/iu.test(value)
  ) {
    return fallback;
  }

  return value;
}

function safeRouteTestString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function safeRouteTestPath(value: unknown): value is string {
  return (
    safeRouteTestString(value) &&
    value.startsWith("/") &&
    !value.includes("?") &&
    !value.includes("#")
  );
}

function safeRouteTestNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeRouteTestStatusCode(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function isRouteTestCapability(
  value: unknown
): value is ModelRouteTestResult["capability"] {
  return value === "chat" || value === "image" || value === "video" || value === "ppt";
}

function isRouteTestRequestFormat(
  value: unknown
): value is NonNullable<ModelRouteTestResult["requestFormat"]> {
  return value === "openai-compatible" || value === "anthropic";
}

function isRouteTestImageTransport(
  value: unknown
): value is NonNullable<ModelRouteTestResult["imageTransport"]> {
  return value === "openai-images" || value === "legacy-extra-body-v1";
}

function RouteTestResultCard({
  result
}: {
  result: ModelRouteTestResult | undefined;
}) {
  if (!result) return null;

  const budgetDenied =
    result.errorCode?.startsWith("GLOBAL_ADMIN_PROVIDER_TEST_BUDGET") ||
    result.errorCode === "ADMIN_PROVIDER_TEST_COST_EXCEEDED";

  return (
    <div
      className={
        result.status === "success"
          ? "mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          : "mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
      }
    >
      {budgetDenied ? (
        <div className="font-semibold text-amber-800">
          Platform test budget denied / 平台测试预算拒绝
        </div>
      ) : null}
      <div className="font-semibold">{result.message}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {result.capability ? <span>capability: {result.capability}</span> : null}
        {result.requestFormat ? (
          <span>requestFormat: {result.requestFormat}</span>
        ) : null}
        {result.imageTransport ? (
          <span>imageTransport: {result.imageTransport}</span>
        ) : null}
        {result.upstreamModel ? (
          <span className="font-mono">upstreamModel: {result.upstreamModel}</span>
        ) : null}
        {typeof result.latencyMs === "number" ? (
          <span>latency: {result.latencyMs}ms</span>
        ) : null}
        {result.endpointPath ? (
          <span className="font-mono">endpoint: {result.endpointPath}</span>
        ) : null}
        {typeof result.statusCode === "number" ? (
          <span>status: {result.statusCode}</span>
        ) : null}
        {typeof result.routeEnabled === "boolean" ? (
          <span>routeEnabled: {String(result.routeEnabled)}</span>
        ) : null}
        {typeof result.providerEnabled === "boolean" ? (
          <span>providerEnabled: {String(result.providerEnabled)}</span>
        ) : null}
      </div>
    </div>
  );
}

function TableHead({ label }: { label: string }) {
  return <th className="whitespace-nowrap px-3 py-3">{label}</th>;
}

function Badge({
  children,
  tone
}: {
  children: React.ReactNode;
  tone: "slate" | "emerald";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700"
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
