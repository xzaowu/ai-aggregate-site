import type {
  AdminModerationRouteSummary,
  AiProviderAccountSummary,
  ModerationRoute
} from "@ai-aggregate/shared";

export const MODERATION_REQUEST_FORMAT = "openai-moderation" as const;
export const MODERATION_DEFAULT_MODEL = "omni-moderation-latest";
export const MODERATION_DEFAULT_ENDPOINT_PATH = "/v1/moderations";
export const MODERATION_MIN_TIMEOUT_MS = 500;
export const MODERATION_MAX_TIMEOUT_MS = 10_000;

export interface AdminModerationSettings {
  version: 1;
  enabled: boolean;
  routes: AdminModerationRouteSummary[];
}

export type ModerationCircuitBreakerInputType = "text" | "image";
export type ModerationCircuitBreakerState = "closed" | "open" | "half_open";
export type ModerationCircuitBreakerFailureType =
  | "timeout"
  | "request_error"
  | "invalid_response"
  | "unknown";

export interface ModerationCircuitBreakerSettings {
  version: 1;
  enabled: boolean;
  failureThreshold: number;
  cooldownMs: number;
}

export interface ModerationCircuitBreakerRouteStatus {
  routeId: string;
  inputType: ModerationCircuitBreakerInputType;
  state: ModerationCircuitBreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  retryAt: number | null;
  lastFailureAt: number | null;
  lastFailureType: ModerationCircuitBreakerFailureType | null;
  lastSuccessAt: number | null;
  opens: number;
  recoveries: number;
  skips: number;
}

export interface ModerationCircuitBreakerStatus {
  settings: ModerationCircuitBreakerSettings;
  epoch: number;
  routes: ModerationCircuitBreakerRouteStatus[];
}

export interface CircuitBreakerFormState {
  enabled: boolean;
  failureThreshold: string;
  cooldownMs: string;
}

export type CircuitBreakerFormError = "invalidThreshold" | "invalidCooldown";

export interface ParsedCircuitBreakerForm {
  settings: ModerationCircuitBreakerSettings | null;
  error: CircuitBreakerFormError | null;
}

export interface ModerationRouteFormState {
  providerAccountId: string;
  upstreamModel: string;
  endpointPath: string;
  priority: string;
  timeoutMs: string;
  supportsText: boolean;
  supportsImage: boolean;
  enabled: boolean;
}

export interface ModerationRouteInput {
  providerAccountId: string;
  upstreamModel: string;
  endpointPath: string;
  priority: number;
  enabled: boolean;
  timeoutMs: number | null;
  supportsText: boolean;
  supportsImage: boolean;
}

export type ModerationRouteFormError =
  | "providerAccountRequired"
  | "upstreamModelRequired"
  | "endpointPathInvalid"
  | "priorityInvalid"
  | "timeoutInvalid"
  | "supportRequired"
  | "priorityDuplicate";

export interface ParsedModerationRouteForm {
  input: ModerationRouteInput | null;
  error: ModerationRouteFormError | null;
}

export interface ModerationCoverage {
  text: boolean;
  image: boolean;
}

export type ModerationReferenceInfo =
  | {
      known: true;
      count: number;
    }
  | {
      known: false;
      count: null;
    };

export interface ProviderModerationFormState {
  enabled: boolean;
  requestFormat: typeof MODERATION_REQUEST_FORMAT;
  upstreamModel: string;
  endpointPath: string;
  supportsText: boolean;
  supportsImage: boolean;
}

export type ModerationTestErrorType =
  | "timeout"
  | "request_error"
  | "invalid_response"
  | "account_unavailable"
  | "incompatible"
  | "unknown";

export interface ModerationTestItem {
  supported: boolean;
  ok: boolean;
  decision: "allowed" | "blocked" | null;
  latencyMs: number | null;
  errorType: ModerationTestErrorType | null;
}

export interface ModerationRouteTestRegistry {
  readonly activeRouteIds: Set<string>;
  begin: (routeId: string) => number | null;
  invalidate: (routeIds?: Iterable<string>) => string[];
  isCurrent: (routeId: string, version: number) => boolean;
  finish: (routeId: string, version: number) => boolean;
}

export function createModerationRouteTestRegistry(): ModerationRouteTestRegistry {
  const versions = new Map<string, number>();
  const activeRouteIds = new Set<string>();

  return {
    activeRouteIds,
    begin(routeId) {
      if (activeRouteIds.has(routeId)) return null;
      const version = (versions.get(routeId) ?? 0) + 1;
      versions.set(routeId, version);
      activeRouteIds.add(routeId);
      return version;
    },
    invalidate(routeIds) {
      const ids = routeIds
        ? Array.from(new Set(routeIds))
        : Array.from(versions.keys());
      for (const routeId of ids) {
        versions.set(routeId, (versions.get(routeId) ?? 0) + 1);
        activeRouteIds.delete(routeId);
      }
      return ids;
    },
    isCurrent(routeId, version) {
      return versions.get(routeId) === version;
    },
    finish(routeId, version) {
      if (versions.get(routeId) !== version) return false;
      activeRouteIds.delete(routeId);
      return true;
    }
  };
}

export interface ModerationRouteTestResponse {
  routeId: string;
  compatible: boolean;
  text: ModerationTestItem;
  image: ModerationTestItem;
}

export function buildModerationRouteTestRequestInit(token: string): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  };
}

export function tryAcquireModerationRouteDeleteLock(
  activeRouteIds: Set<string>,
  routeId: string
): boolean {
  if (activeRouteIds.has(routeId)) return false;
  activeRouteIds.add(routeId);
  return true;
}

export type ModerationTestPresentation =
  | "not-tested"
  | "unsupported"
  | "allowed"
  | "blocked"
  | "error";

const DEFAULT_PROVIDER_MODERATION_FORM: ProviderModerationFormState = {
  enabled: false,
  requestFormat: MODERATION_REQUEST_FORMAT,
  upstreamModel: MODERATION_DEFAULT_MODEL,
  endpointPath: MODERATION_DEFAULT_ENDPOINT_PATH,
  supportsText: true,
  supportsImage: true
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isManagedProviderModerationConfig(
  configJson: Record<string, unknown> | null | undefined
): boolean {
  const moderation = configJson?.moderation;
  return isRecord(moderation) && moderation.requestFormat === MODERATION_REQUEST_FORMAT;
}

export function isSafeModerationEndpointPath(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return false;
  }

  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(value)) {
    return false;
  }

  const segments = value.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return false;
  }

  try {
    const parsed = new URL(value, "https://moderation.invalid");
    return (
      parsed.origin === "https://moderation.invalid" &&
      parsed.pathname === value &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isValidTimeout(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) &&
      (value as number) >= MODERATION_MIN_TIMEOUT_MS &&
      (value as number) <= MODERATION_MAX_TIMEOUT_MS)
  );
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : safeString(value);
}

function normalizeModerationRouteSummary(
  value: unknown
): AdminModerationRouteSummary {
  if (!isRecord(value)) {
    throw new Error("MODERATION_ROUTE_INVALID");
  }

  const id = safeString(value.id);
  const providerAccountId = safeString(value.providerAccountId);
  const upstreamModel = safeString(value.upstreamModel);
  const endpointPath = value.endpointPath;
  const priority = value.priority;
  const timeoutMs = value.timeoutMs === undefined ? null : value.timeoutMs;

  if (
    !id ||
    !providerAccountId ||
    !upstreamModel ||
    !isSafeModerationEndpointPath(endpointPath) ||
    !isPositiveSafeInteger(priority) ||
    typeof value.enabled !== "boolean" ||
    !isValidTimeout(timeoutMs) ||
    typeof value.supportsText !== "boolean" ||
    typeof value.supportsImage !== "boolean"
  ) {
    throw new Error("MODERATION_ROUTE_INVALID");
  }

  return {
    id,
    providerAccountId,
    upstreamModel,
    endpointPath,
    priority,
    enabled: value.enabled,
    timeoutMs,
    supportsText: value.supportsText,
    supportsImage: value.supportsImage,
    providerAccountName: safeNullableString(value.providerAccountName),
    providerAccountEnabled:
      typeof value.providerAccountEnabled === "boolean"
        ? value.providerAccountEnabled
        : false,
    providerAccountCompatible:
      typeof value.providerAccountCompatible === "boolean"
        ? value.providerAccountCompatible
        : false
  };
}

export function normalizeModerationSettingsResponse(
  value: unknown
): AdminModerationSettings {
  const root = isRecord(value) && isRecord(value.settings) ? value.settings : value;

  if (!isRecord(root) || root.version !== 1 || typeof root.enabled !== "boolean") {
    throw new Error("MODERATION_SETTINGS_INVALID");
  }
  if (!Array.isArray(root.routes)) {
    throw new Error("MODERATION_ROUTES_INVALID");
  }

  const routes = root.routes.map(normalizeModerationRouteSummary);
  const routeIds = new Set<string>();
  const enabledPriorities = new Set<number>();

  for (const route of routes) {
    if (routeIds.has(route.id)) {
      throw new Error("MODERATION_ROUTE_ID_DUPLICATE");
    }
    routeIds.add(route.id);

    if (route.enabled) {
      if (enabledPriorities.has(route.priority)) {
        throw new Error("MODERATION_PRIORITY_DUPLICATE");
      }
      enabledPriorities.add(route.priority);
    }
  }

  return { version: 1, enabled: root.enabled, routes };
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

const MAX_JS_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

function normalizeCircuitBreakerTimestamp(value: unknown): number | null {
  if (value === null) return null;
  if (!isNonNegativeSafeInteger(value) || value > MAX_JS_DATE_TIMESTAMP_MS) {
    throw new Error("MODERATION_CIRCUIT_BREAKER_TIMESTAMP_INVALID");
  }
  return value;
}

function normalizeCircuitBreakerCounter(value: unknown): number {
  if (!isNonNegativeSafeInteger(value)) {
    throw new Error("MODERATION_CIRCUIT_BREAKER_COUNTER_INVALID");
  }
  return value;
}

function normalizeModerationCircuitBreakerSettings(
  value: unknown
): ModerationCircuitBreakerSettings {
  const failureThreshold = isRecord(value) ? value.failureThreshold : undefined;
  const cooldownMs = isRecord(value) ? value.cooldownMs : undefined;
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.enabled !== "boolean" ||
    typeof failureThreshold !== "number" ||
    !Number.isSafeInteger(failureThreshold) ||
    failureThreshold < 1 ||
    failureThreshold > 20 ||
    typeof cooldownMs !== "number" ||
    !Number.isSafeInteger(cooldownMs) ||
    cooldownMs < 1000 ||
    cooldownMs > 600000
  ) {
    throw new Error("MODERATION_CIRCUIT_BREAKER_SETTINGS_INVALID");
  }

  return {
    version: 1,
    enabled: value.enabled,
    failureThreshold,
    cooldownMs
  };
}

function normalizeModerationCircuitBreakerRoute(
  value: unknown
): ModerationCircuitBreakerRouteStatus {
  if (!isRecord(value)) {
    throw new Error("MODERATION_CIRCUIT_BREAKER_ROUTE_INVALID");
  }

  if (
    typeof value.routeId !== "string" ||
    value.routeId.trim().length === 0 ||
    (value.inputType !== "text" && value.inputType !== "image") ||
    (value.state !== "closed" &&
      value.state !== "open" &&
      value.state !== "half_open") ||
    value.lastFailureType !== null &&
      value.lastFailureType !== "timeout" &&
      value.lastFailureType !== "request_error" &&
      value.lastFailureType !== "invalid_response" &&
      value.lastFailureType !== "unknown"
  ) {
    throw new Error("MODERATION_CIRCUIT_BREAKER_ROUTE_INVALID");
  }

  return {
    routeId: value.routeId,
    inputType: value.inputType,
    state: value.state,
    consecutiveFailures: normalizeCircuitBreakerCounter(value.consecutiveFailures),
    openedAt: normalizeCircuitBreakerTimestamp(value.openedAt),
    retryAt: normalizeCircuitBreakerTimestamp(value.retryAt),
    lastFailureAt: normalizeCircuitBreakerTimestamp(value.lastFailureAt),
    lastFailureType: value.lastFailureType,
    lastSuccessAt: normalizeCircuitBreakerTimestamp(value.lastSuccessAt),
    opens: normalizeCircuitBreakerCounter(value.opens),
    recoveries: normalizeCircuitBreakerCounter(value.recoveries),
    skips: normalizeCircuitBreakerCounter(value.skips)
  };
}

export function normalizeModerationCircuitBreakerStatus(
  value: unknown
): ModerationCircuitBreakerStatus {
  if (
    !isRecord(value) ||
    !isNonNegativeSafeInteger(value.epoch) ||
    !isRecord(value.settings) ||
    !Array.isArray(value.routes)
  ) {
    throw new Error("MODERATION_CIRCUIT_BREAKER_STATUS_INVALID");
  }

  return {
    settings: normalizeModerationCircuitBreakerSettings(value.settings),
    epoch: value.epoch,
    routes: value.routes.map(normalizeModerationCircuitBreakerRoute)
  };
}

export function circuitBreakerSettingsToForm(
  settings: ModerationCircuitBreakerSettings
): CircuitBreakerFormState {
  return {
    enabled: settings.enabled,
    failureThreshold: String(settings.failureThreshold),
    cooldownMs: String(settings.cooldownMs)
  };
}

function parseCircuitBreakerInteger(
  value: string,
  minimum: number,
  maximum: number
): number | null {
  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export function parseCircuitBreakerForm(
  form: CircuitBreakerFormState
): ParsedCircuitBreakerForm {
  const failureThreshold = parseCircuitBreakerInteger(
    form.failureThreshold,
    1,
    20
  );
  if (failureThreshold === null) {
    return { settings: null, error: "invalidThreshold" };
  }

  const cooldownMs = parseCircuitBreakerInteger(form.cooldownMs, 1000, 600000);
  if (cooldownMs === null) {
    return { settings: null, error: "invalidCooldown" };
  }

  return {
    settings: {
      version: 1,
      enabled: form.enabled,
      failureThreshold,
      cooldownMs
    },
    error: null
  };
}

export function buildModerationCircuitBreakerSettingsRequestInit(
  token: string,
  settings: ModerationCircuitBreakerSettings
): RequestInit {
  return {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      version: 1,
      enabled: settings.enabled,
      failureThreshold: settings.failureThreshold,
      cooldownMs: settings.cooldownMs
    })
  };
}

export function buildModerationCircuitBreakerResetRequestInit(
  token: string
): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  };
}

export function readProviderModerationForm(
  configJson: Record<string, unknown> | null | undefined
): ProviderModerationFormState {
  const moderation = isRecord(configJson?.moderation)
    ? configJson.moderation
    : null;
  const endpointPath = isSafeModerationEndpointPath(moderation?.endpointPath)
    ? moderation.endpointPath
    : MODERATION_DEFAULT_ENDPOINT_PATH;
  const upstreamModel =
    safeString(moderation?.upstreamModel) ?? safeString(moderation?.model);

  return {
    enabled: moderation?.requestFormat === MODERATION_REQUEST_FORMAT,
    requestFormat: MODERATION_REQUEST_FORMAT,
    upstreamModel: upstreamModel ?? MODERATION_DEFAULT_MODEL,
    endpointPath,
    supportsText:
      typeof moderation?.supportsText === "boolean"
        ? moderation.supportsText
        : true,
    supportsImage:
      typeof moderation?.supportsImage === "boolean"
        ? moderation.supportsImage
        : true
  };
}

export function mergeProviderModerationConfig(
  configJson: Record<string, unknown> | null | undefined,
  form: ProviderModerationFormState
): Record<string, unknown> | null {
  const nextConfig = { ...(configJson ?? {}) };

  if (!form.enabled) {
    if (isManagedProviderModerationConfig(nextConfig)) {
      delete nextConfig.moderation;
    }
  } else {
    const existingModeration = isRecord(nextConfig.moderation)
      ? nextConfig.moderation
      : {};
    nextConfig.moderation = {
      ...existingModeration,
      requestFormat: MODERATION_REQUEST_FORMAT,
      upstreamModel: form.upstreamModel.trim() || MODERATION_DEFAULT_MODEL,
      endpointPath: form.endpointPath.trim() || MODERATION_DEFAULT_ENDPOINT_PATH,
      supportsText: form.supportsText,
      supportsImage: form.supportsImage
    };
  }

  return Object.keys(nextConfig).length > 0 ? nextConfig : null;
}

export function defaultModerationRouteForm(
  routes: ModerationRoute[] | AdminModerationRouteSummary[],
  accounts: AiProviderAccountSummary[]
): ModerationRouteFormState {
  const maxPriority = routes.reduce(
    (maximum, route) => Math.max(maximum, route.priority),
    0
  );
  const providerAccountId = accounts.find(isAvailableModerationAccount)?.id ?? "";

  return {
    providerAccountId,
    upstreamModel: MODERATION_DEFAULT_MODEL,
    endpointPath: MODERATION_DEFAULT_ENDPOINT_PATH,
    priority: String(maxPriority + 1),
    timeoutMs: "",
    supportsText: true,
    supportsImage: true,
    enabled: true
  };
}

export function isProviderModerationDeclared(
  account: AiProviderAccountSummary
): boolean {
  return readProviderModerationForm(account.configJson).enabled;
}

export function getModerationReferenceInfo(
  settings: AdminModerationSettings | null | undefined,
  providerAccountId: string
): ModerationReferenceInfo {
  if (!settings) {
    return { known: false, count: null };
  }

  return getModerationReferenceInfoFromRoutes(settings.routes, providerAccountId);
}

export function getModerationReferenceInfoFromRoutes(
  routes: AdminModerationRouteSummary[],
  providerAccountId: string
): ModerationReferenceInfo {
  return {
    known: true,
    count: routes.filter(
      (route) => route.providerAccountId === providerAccountId
    ).length
  };
}

export function isProviderModerationToggleDisabled(
  moderationEnabled: boolean | undefined,
  moderationReferenceInfo: ModerationReferenceInfo
): boolean {
  return (
    moderationEnabled === true &&
    (!moderationReferenceInfo.known || moderationReferenceInfo.count > 0)
  );
}

export function canChangeProviderModerationEnabled(
  currentEnabled: boolean | undefined,
  nextEnabled: boolean,
  moderationReferenceInfo: ModerationReferenceInfo
): boolean {
  return !(
    currentEnabled === true &&
    nextEnabled === false &&
    (!moderationReferenceInfo.known || moderationReferenceInfo.count > 0)
  );
}

export function isAvailableModerationAccount(
  account: AiProviderAccountSummary
): boolean {
  return (
    (account.providerType === "OPENAI_COMPATIBLE" ||
      account.providerType === "SUB2API" ||
      account.providerType === "NEW_API") &&
    account.enabled &&
    account.hasApiKey &&
    account.baseUrl.trim().length > 0 &&
    isProviderModerationDeclared(account)
  );
}

export function parseModerationRouteForm(
  form: ModerationRouteFormState,
  routes: AdminModerationRouteSummary[] | ModerationRoute[],
  editingRouteId?: string
): ParsedModerationRouteForm {
  if (!form.providerAccountId.trim()) {
    return { input: null, error: "providerAccountRequired" };
  }
  if (!form.upstreamModel.trim()) {
    return { input: null, error: "upstreamModelRequired" };
  }
  if (!isSafeModerationEndpointPath(form.endpointPath)) {
    return { input: null, error: "endpointPathInvalid" };
  }

  const priority = Number(form.priority);
  if (!isPositiveSafeInteger(priority)) {
    return { input: null, error: "priorityInvalid" };
  }

  const trimmedTimeout = form.timeoutMs.trim();
  const timeoutMs = trimmedTimeout === "" ? null : Number(trimmedTimeout);
  if (!isValidTimeout(timeoutMs)) {
    return { input: null, error: "timeoutInvalid" };
  }
  if (!form.supportsText && !form.supportsImage) {
    return { input: null, error: "supportRequired" };
  }
  if (
    form.enabled &&
    routes.some(
      (route) =>
        route.id !== editingRouteId &&
        route.enabled &&
        route.priority === priority
    )
  ) {
    return { input: null, error: "priorityDuplicate" };
  }

  return {
    input: {
      providerAccountId: form.providerAccountId.trim(),
      upstreamModel: form.upstreamModel.trim(),
      endpointPath: form.endpointPath,
      priority,
      enabled: form.enabled,
      timeoutMs,
      supportsText: form.supportsText,
      supportsImage: form.supportsImage
    },
    error: null
  };
}

export function getModerationCoverage(
  routes: AdminModerationRouteSummary[]
): ModerationCoverage {
  const runnable = routes.filter(
    (route) =>
      route.enabled &&
      route.providerAccountEnabled &&
      route.providerAccountCompatible
  );

  return {
    text: runnable.some((route) => route.supportsText),
    image: runnable.some((route) => route.supportsImage)
  };
}

const moderationTestErrorTypes = new Set<ModerationTestErrorType>([
  "timeout",
  "request_error",
  "invalid_response",
  "account_unavailable",
  "incompatible",
  "unknown"
]);

function normalizeModerationTestItem(value: unknown): ModerationTestItem {
  if (!isRecord(value)) throw new Error("MODERATION_TEST_INVALID");
  const latencyMs = value.latencyMs === null ? null : value.latencyMs;
  const errorType = value.errorType === null ? null : value.errorType;
  if (
    typeof value.supported !== "boolean" ||
    typeof value.ok !== "boolean" ||
    (value.decision !== null &&
      value.decision !== "allowed" &&
      value.decision !== "blocked") ||
    (latencyMs !== null &&
      (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0)) ||
    (errorType !== null &&
      (typeof errorType !== "string" ||
        !moderationTestErrorTypes.has(errorType as ModerationTestErrorType)))
  ) {
    throw new Error("MODERATION_TEST_INVALID");
  }
  return {
    supported: value.supported,
    ok: value.ok,
    decision: value.decision,
    latencyMs,
    errorType: errorType as ModerationTestErrorType | null
  };
}

export function normalizeModerationTestResponse(
  value: unknown
): ModerationRouteTestResponse {
  if (
    !isRecord(value) ||
    typeof value.routeId !== "string" ||
    value.routeId.trim().length === 0 ||
    typeof value.compatible !== "boolean"
  ) {
    throw new Error("MODERATION_TEST_INVALID");
  }
  return {
    routeId: value.routeId,
    compatible: value.compatible,
    text: normalizeModerationTestItem(value.text),
    image: normalizeModerationTestItem(value.image)
  };
}

export function normalizeModerationTestResponseForRoute(
  value: unknown,
  expectedRouteId: string
): ModerationRouteTestResponse {
  const response = normalizeModerationTestResponse(value);
  if (response.routeId !== expectedRouteId) {
    throw new Error("MODERATION_TEST_ROUTE_MISMATCH");
  }
  return response;
}

export function getModerationTestPresentation(
  item: ModerationTestItem | undefined
): ModerationTestPresentation {
  if (!item) return "not-tested";
  if (!item.supported) return "unsupported";
  if (item.ok && item.decision === "allowed") return "allowed";
  if (item.ok && item.decision === "blocked") return "blocked";
  return "error";
}

export function getModerationRouteTestPresentation(
  result: ModerationRouteTestResponse | undefined
): ModerationTestPresentation {
  if (!result) return "not-tested";
  const supported = [result.text, result.image].filter((item) => item.supported);
  if (supported.length === 0) return "unsupported";
  if (supported.some((item) => item.ok && item.decision === "blocked")) {
    return "blocked";
  }
  if (supported.some((item) => !item.ok)) return "error";
  return supported.every((item) => item.ok && item.decision === "allowed")
    ? "allowed"
    : "error";
}

export function getModerationTestErrorKey(
  errorType: ModerationTestErrorType | null | undefined
): string {
  return errorType ? `admin.moderationTestError.${errorType}` : "admin.moderationTestFailed";
}

export function getModerationRouteStatus(
  route: AdminModerationRouteSummary
): "route-disabled" | "account-disabled" | "account-missing" | "incompatible" | "runnable" {
  if (!route.enabled) return "route-disabled";
  if (!route.providerAccountName) return "account-missing";
  if (!route.providerAccountEnabled) return "account-disabled";
  if (!route.providerAccountCompatible) return "incompatible";
  return "runnable";
}
