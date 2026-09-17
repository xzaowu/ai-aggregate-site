import { createHash } from "node:crypto";
import type {
  ModerationRoute,
  ModerationSettings
} from "@ai-aggregate/shared";
import {
  joinProviderEndpointUrl,
  normalizeProviderHeaders
} from "@ai-aggregate/shared";
import type { ModerationRouteCircuitBreaker } from "./moderation-route-circuit-breaker";

export const IMAGE_MODERATION_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const IMAGE_MODERATION_DEFAULT_MODEL = "omni-moderation-latest";
export const IMAGE_MODERATION_DEFAULT_ENDPOINT_PATH = "/v1/moderations";
export const IMAGE_MODERATION_DEFAULT_TIMEOUT_MS = 3_000;
export const IMAGE_MODERATION_MIN_TIMEOUT_MS = 500;
export const IMAGE_MODERATION_MAX_TIMEOUT_MS = 10_000;
export const IMAGE_MODERATION_SETTINGS_KEY = "imageModerationSettings";
export const IMAGE_MODERATION_REQUEST_FORMAT = "openai-moderation";
export const IMAGE_MODERATION_POLICY_FINGERPRINT_VERSION = 1;
export const IMAGE_MODERATION_STRICT_PARSER_VERSION = "strict-v1";

const OPENAI_COMPATIBLE_PROVIDER_TYPES = new Set([
  "OPENAI_COMPATIBLE",
  "SUB2API",
  "NEW_API"
]);

export type ImageModerationMode = "off" | "enforce";
export type ModerationInputType = "text" | "image";
export type ImageModerationErrorType =
  | "timeout"
  | "request_error"
  | "invalid_response"
  | "unknown";

export type ImageModerationDecision =
  | { status: "allowed" }
  | { status: "blocked"; categories: string[] };

export interface ImageModerationClient {
  moderateText(input: string): Promise<ImageModerationDecision>;
  moderateImage(input: { url: string }): Promise<ImageModerationDecision>;
}

export interface ImageModerationConfig {
  mode: ImageModerationMode;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  legacyConfigValid: boolean;
}

export interface ModerationProviderAccount {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  timeoutMs: number;
  headersJson?: Record<string, unknown> | null;
  configJson: Record<string, unknown> | null;
}

export interface ModerationProviderAttempt {
  route: ModerationRoute;
  providerAccount: ModerationProviderAccount;
  model: string;
  endpointPath: string;
  timeoutMs: number;
  endpointUrl: string;
}

export function buildModerationPolicyFingerprint(input: {
  policyVersion: string;
  attempts?: readonly ModerationProviderAttempt[];
  legacy?: {
    model: string;
    endpointPath: string;
    baseUrl: string;
    timeoutMs: number;
  };
}): string {
  const attempts = input.attempts
    ? input.attempts.map((attempt) => {
        const safeHeaders = normalizeProviderHeaders(
          attempt.providerAccount.headersJson
        );
        const safeHeadersDigest = createHash("sha256")
          .update(
            JSON.stringify(
              Object.entries(safeHeaders)
                .sort(([leftName, leftValue], [rightName, rightValue]) =>
                  leftName === rightName
                    ? leftValue.localeCompare(rightValue)
                    : leftName.localeCompare(rightName)
                )
            )
          )
          .digest("hex");
        return [
          attempt.route.id,
          attempt.providerAccount.id,
          attempt.providerAccount.providerType,
          attempt.model,
          attempt.endpointPath,
          attempt.timeoutMs,
          attempt.route.supportsText,
          attempt.endpointUrl,
          safeHeadersDigest
        ];
      })
    : [];
  const legacy = input.legacy
    ? (() => {
        let endpointUrl = "";
        try {
          endpointUrl = joinProviderEndpointUrl(
            input.legacy.baseUrl,
            input.legacy.endpointPath
          );
        } catch {
          endpointUrl = "invalid-endpoint";
        }
        return [
          input.legacy.model,
          input.legacy.endpointPath,
          endpointUrl,
          input.legacy.timeoutMs
        ];
      })()
    : null;
  const canonicalPayload = JSON.stringify([
    IMAGE_MODERATION_POLICY_FINGERPRINT_VERSION,
    "text",
    ["sexual", "sexual/minors"],
    IMAGE_MODERATION_STRICT_PARSER_VERSION,
    input.policyVersion,
    attempts,
    legacy
  ]);
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

export class ImageModerationTimeoutError extends Error {
  constructor() {
    super("image moderation request timed out");
    this.name = "ImageModerationTimeoutError";
  }
}

export class ImageModerationRequestError extends Error {
  constructor() {
    super("image moderation request failed");
    this.name = "ImageModerationRequestError";
  }
}

export class ImageModerationResponseError extends Error {
  constructor() {
    super("image moderation response is invalid");
    this.name = "ImageModerationResponseError";
  }
}

export class ImageModerationUnavailableError extends Error {
  readonly lastErrorType: ImageModerationErrorType | null;

  constructor(lastErrorType: ImageModerationErrorType | null = null) {
    super("image moderation is unavailable");
    this.name = "ImageModerationUnavailableError";
    this.lastErrorType = lastErrorType;
  }
}

export interface ImageModerationLogEntry {
  routeId: string | null;
  providerAccountId: string | null;
  providerType: string | null;
  inputType: ModerationInputType;
  attemptIndex: number;
  attemptCount: number;
  moderationModel: string | null;
  endpointPath: string | null;
  timeoutMs: number | null;
  latencyMs: number;
  outcome: "allowed" | "blocked" | "unavailable";
  errorType?: "timeout" | "request_error" | "invalid_response" | "unknown";
  blockedCategories?: string[];
  failoverCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwnProperty(
  value: Record<string, unknown>,
  key: string
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireNonEmptyString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(errorCode);
  }
  return value.trim();
}

function requireSafeInteger(value: unknown, errorCode: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(errorCode);
  }
  return value as number;
}

export function normalizeModerationEndpointPath(value: unknown): string {
  const path = requireNonEmptyString(value, "MODERATION_ENDPOINT_PATH_INVALID");
  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(path)) {
    throw new Error("MODERATION_ENDPOINT_PATH_INVALID");
  }

  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("MODERATION_ENDPOINT_PATH_INVALID");
  }

  try {
    const parsed = new URL(path, "https://moderation.invalid");
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== "https://moderation.invalid" ||
      parsed.pathname !== path
    ) {
      throw new Error("MODERATION_ENDPOINT_PATH_INVALID");
    }
  } catch {
    throw new Error("MODERATION_ENDPOINT_PATH_INVALID");
  }

  return path;
}

function normalizeModerationBaseUrl(value: unknown): string {
  const baseUrl = requireNonEmptyString(value, "IMAGE_MODERATION_BASE_URL_INVALID");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("IMAGE_MODERATION_BASE_URL_INVALID");
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    throw new Error("IMAGE_MODERATION_BASE_URL_INVALID");
  }

  return baseUrl.replace(/\/+$/u, "");
}

function normalizeModerationTimeout(
  value: unknown,
  errorCode = "IMAGE_MODERATION_TIMEOUT_INVALID"
): number {
  const timeoutMs = requireSafeInteger(value, errorCode);
  if (
    timeoutMs < IMAGE_MODERATION_MIN_TIMEOUT_MS ||
    timeoutMs > IMAGE_MODERATION_MAX_TIMEOUT_MS
  ) {
    throw new Error(errorCode);
  }
  return timeoutMs;
}

function normalizeModerationRoute(
  value: unknown,
  index: number
): ModerationRoute {
  if (!isRecord(value)) {
    throw new Error("MODERATION_ROUTE_INVALID");
  }

  const id = requireNonEmptyString(value.id, "MODERATION_ROUTE_ID_INVALID");
  const providerAccountId = requireNonEmptyString(
    value.providerAccountId,
    "MODERATION_PROVIDER_ACCOUNT_ID_INVALID"
  );
  const upstreamModel =
    value.upstreamModel === undefined
      ? IMAGE_MODERATION_DEFAULT_MODEL
      : requireNonEmptyString(value.upstreamModel, "MODERATION_MODEL_INVALID");
  const endpointPath =
    value.endpointPath === undefined
      ? IMAGE_MODERATION_DEFAULT_ENDPOINT_PATH
      : normalizeModerationEndpointPath(value.endpointPath);
  const priority =
    value.priority === undefined
      ? index + 1
      : requireSafeInteger(value.priority, "MODERATION_PRIORITY_INVALID");
  if (priority <= 0) {
    throw new Error("MODERATION_PRIORITY_INVALID");
  }

  const enabled = value.enabled === undefined ? true : value.enabled;
  const timeoutMs = value.timeoutMs === undefined ? null : value.timeoutMs;
  if (enabled !== true && enabled !== false) {
    throw new Error("MODERATION_ENABLED_INVALID");
  }
  if (timeoutMs !== null) {
    normalizeModerationTimeout(timeoutMs);
  }

  const supportsText = value.supportsText === undefined ? true : value.supportsText;
  const supportsImage = value.supportsImage === undefined ? true : value.supportsImage;
  if (typeof supportsText !== "boolean" || typeof supportsImage !== "boolean") {
    throw new Error("MODERATION_SUPPORTS_INVALID");
  }
  if (!supportsText && !supportsImage) {
    throw new Error("MODERATION_SUPPORTS_REQUIRED");
  }

  return {
    id,
    providerAccountId,
    upstreamModel,
    endpointPath,
    priority,
    enabled,
    timeoutMs: timeoutMs as number | null,
    supportsText,
    supportsImage
  };
}

export function createDefaultModerationSettings(): ModerationSettings {
  return {
    version: 1,
    enabled: true,
    routes: []
  };
}

export function normalizeModerationSettings(
  value: unknown
): ModerationSettings {
  if (!isRecord(value) || value.version !== 1 || typeof value.enabled !== "boolean") {
    throw new Error("MODERATION_SETTINGS_INVALID");
  }
  if (!Array.isArray(value.routes)) {
    throw new Error("MODERATION_ROUTES_INVALID");
  }

  const routes = value.routes.map((route, index) =>
    normalizeModerationRoute(route, index)
  );
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

  routes.sort((left, right) =>
    left.priority === right.priority
      ? left.id.localeCompare(right.id)
      : left.priority - right.priority
  );

  return { version: 1, enabled: value.enabled, routes };
}

function readModerationAccountConfig(account: ModerationProviderAccount): {
  requestFormat: string;
  endpointPath: string;
  model: string;
  supportsText: boolean;
  supportsImage: boolean;
} | null {
  const moderation = account.configJson?.moderation;
  if (!isPlainObject(moderation)) {
    return null;
  }

  const requestFormat =
    typeof moderation.requestFormat === "string"
      ? moderation.requestFormat.trim()
      : "";
  if (requestFormat !== IMAGE_MODERATION_REQUEST_FORMAT) {
    return null;
  }

  let endpointPath = IMAGE_MODERATION_DEFAULT_ENDPOINT_PATH;
  if (moderation.endpointPath !== undefined) {
    try {
      endpointPath = normalizeModerationEndpointPath(moderation.endpointPath);
    } catch {
      return null;
    }
  }
  let model = IMAGE_MODERATION_DEFAULT_MODEL;
  const configuredModel = moderation.upstreamModel ?? moderation.model;
  if (configuredModel !== undefined) {
    if (typeof configuredModel !== "string" || configuredModel.trim() === "") {
      return null;
    }
    model = configuredModel.trim();
  }

  const supportsText = moderation.supportsText ?? true;
  const supportsImage = moderation.supportsImage ?? true;
  if (typeof supportsText !== "boolean" || typeof supportsImage !== "boolean") {
    return null;
  }

  return { requestFormat, endpointPath, model, supportsText, supportsImage };
}

function buildModerationEndpointUrl(
  baseUrl: string,
  endpointPath: string
): string {
  const normalizedBaseUrl = normalizeModerationBaseUrl(baseUrl);
  const path = normalizeModerationEndpointPath(endpointPath);
  const basePathSegments = new URL(normalizedBaseUrl).pathname
    .split("/")
    .filter(Boolean);
  const endpointSegments = path.split("/").filter(Boolean);
  let overlap = Math.min(basePathSegments.length, endpointSegments.length);

  while (
    overlap > 0 &&
    !basePathSegments
      .slice(basePathSegments.length - overlap)
      .every((segment, index) => segment === endpointSegments[index])
  ) {
    overlap -= 1;
  }

  const compatiblePath = `/${[
    ...basePathSegments,
    ...endpointSegments.slice(overlap)
  ].join("/")}`;

  return `${new URL(normalizedBaseUrl).origin}${compatiblePath}`;
}

export function isModerationProviderAccountCompatible(
  account: ModerationProviderAccount
): boolean {
  if (!OPENAI_COMPATIBLE_PROVIDER_TYPES.has(account.providerType)) {
    return false;
  }
  const config = readModerationAccountConfig(account);
  if (!config || !account.apiKey.trim() || !account.baseUrl.trim()) {
    return false;
  }
  try {
    normalizeModerationBaseUrl(account.baseUrl);
    buildModerationEndpointUrl(account.baseUrl, config.endpointPath);
    return config.supportsText || config.supportsImage;
  } catch {
    return false;
  }
}

export function resolveModerationAttemptTimeoutMs(input: {
  routeTimeoutMs: number | null;
  providerAccountTimeoutMs: number;
}): number {
  if (input.routeTimeoutMs !== null) {
    return normalizeModerationTimeout(input.routeTimeoutMs);
  }

  try {
    return normalizeModerationTimeout(input.providerAccountTimeoutMs);
  } catch {
    return IMAGE_MODERATION_DEFAULT_TIMEOUT_MS;
  }
}

export function resolveModerationProviderAttempts(input: {
  settings: ModerationSettings;
  providerAccounts: readonly ModerationProviderAccount[];
  inputType: ModerationInputType;
}): ModerationProviderAttempt[] {
  if (!input.settings.enabled) {
    return [];
  }

  const accounts = new Map(input.providerAccounts.map((account) => [account.id, account]));
  const attempts: ModerationProviderAttempt[] = [];

  for (const route of [...input.settings.routes].sort((left, right) =>
    left.priority === right.priority
      ? left.id.localeCompare(right.id)
      : left.priority - right.priority
  )) {
    if (!route.enabled) {
      continue;
    }
    const account = accounts.get(route.providerAccountId);
    if (!account || !account.enabled || !account.apiKey.trim()) {
      continue;
    }
    if (!OPENAI_COMPATIBLE_PROVIDER_TYPES.has(account.providerType)) {
      continue;
    }

    const accountConfig = readModerationAccountConfig(account);
    if (!accountConfig || !account.baseUrl.trim()) {
      continue;
    }
    if (
      (input.inputType === "text" && (!route.supportsText || !accountConfig.supportsText)) ||
      (input.inputType === "image" && (!route.supportsImage || !accountConfig.supportsImage))
    ) {
      continue;
    }

    try {
      const normalizedTimeoutMs = resolveModerationAttemptTimeoutMs({
        routeTimeoutMs: route.timeoutMs,
        providerAccountTimeoutMs: account.timeoutMs
      });
      const endpointUrl = buildModerationEndpointUrl(
        account.baseUrl,
        route.endpointPath || accountConfig.endpointPath
      );
      const model = route.upstreamModel || accountConfig.model;
      if (!model.trim()) {
        continue;
      }
      attempts.push({
        route,
        providerAccount: account,
        model,
        endpointPath: route.endpointPath || accountConfig.endpointPath,
        timeoutMs: normalizedTimeoutMs,
        endpointUrl
      });
    } catch {
      continue;
    }
  }

  return attempts;
}

function requireNonEmptyEnvironmentValue(
  value: string | undefined,
  errorCode: string
): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function resolveLegacyTimeoutMs(value: string | undefined): number {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "") {
    return IMAGE_MODERATION_DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) &&
    parsed >= IMAGE_MODERATION_MIN_TIMEOUT_MS &&
    parsed <= IMAGE_MODERATION_MAX_TIMEOUT_MS
    ? parsed
    : IMAGE_MODERATION_DEFAULT_TIMEOUT_MS;
}

export function resolveImageModerationConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env
): ImageModerationConfig {
  const rawMode = env.IMAGE_MODERATION_MODE?.trim() || "off";
  if (rawMode !== "off" && rawMode !== "enforce") {
    throw new Error("IMAGE_MODERATION_MODE_INVALID");
  }

  if (rawMode === "off") {
    return {
      mode: "off",
      apiKey: "",
      baseUrl: IMAGE_MODERATION_DEFAULT_BASE_URL,
      model: IMAGE_MODERATION_DEFAULT_MODEL,
      timeoutMs: IMAGE_MODERATION_DEFAULT_TIMEOUT_MS,
      legacyConfigValid: false
    };
  }

  const apiKey = env.IMAGE_MODERATION_API_KEY?.trim() ?? "";
  let baseUrl = IMAGE_MODERATION_DEFAULT_BASE_URL;
  let model = IMAGE_MODERATION_DEFAULT_MODEL;
  let legacyConfigValid = apiKey.length > 0;
  try {
    baseUrl = normalizeModerationBaseUrl(
      env.IMAGE_MODERATION_BASE_URL ?? IMAGE_MODERATION_DEFAULT_BASE_URL
    );
  } catch {
    legacyConfigValid = false;
  }
  try {
    model = requireNonEmptyEnvironmentValue(
      env.IMAGE_MODERATION_MODEL ?? IMAGE_MODERATION_DEFAULT_MODEL,
      "IMAGE_MODERATION_MODEL_INVALID"
    );
  } catch {
    legacyConfigValid = false;
  }

  const rawTimeout = env.IMAGE_MODERATION_TIMEOUT_MS?.trim();
  const timeoutMs = resolveLegacyTimeoutMs(rawTimeout);
  if (
    rawTimeout !== undefined &&
    rawTimeout !== "" &&
    timeoutMs === IMAGE_MODERATION_DEFAULT_TIMEOUT_MS &&
    Number(rawTimeout) !== IMAGE_MODERATION_DEFAULT_TIMEOUT_MS
  ) {
    legacyConfigValid = false;
  }

  return {
    mode: "enforce",
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    legacyConfigValid
  };
}

function isValidBase64(value: string): boolean {
  if (
    !value ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value
    )
  ) {
    return false;
  }

  return Buffer.from(value, "base64").toString("base64") === value;
}

function validateModerationImageUrl(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ImageModerationRequestError();
  }

  const normalized = value.trim();
  if (normalized.startsWith("data:")) {
    const match =
      /^data:(image\/[A-Za-z0-9!#$&^_.+~-]+);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
        normalized
      );
    if (!match || !isValidBase64(match[2] ?? "")) {
      throw new ImageModerationRequestError();
    }
    return normalized;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ImageModerationRequestError();
  }

  if (url.protocol !== "https:" || !url.hostname) {
    throw new ImageModerationRequestError();
  }

  return normalized;
}

export function parseModerationDecision(
  value: unknown,
  requiredCategories: readonly string[]
): ImageModerationDecision {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length !== 1) {
    throw new ImageModerationResponseError();
  }

  const result = value.results[0];
  if (
    !isRecord(result) ||
    !hasOwnProperty(result, "flagged") ||
    typeof result.flagged !== "boolean" ||
    !isPlainObject(result.categories)
  ) {
    throw new ImageModerationResponseError();
  }

  const categories: string[] = [];
  for (const [category, flagged] of Object.entries(result.categories)) {
    if (typeof flagged !== "boolean") {
      throw new ImageModerationResponseError();
    }
    if (flagged) {
      categories.push(category);
    }
  }

  for (const category of requiredCategories) {
    if (
      !hasOwnProperty(result.categories, category) ||
      typeof result.categories[category] !== "boolean"
    ) {
      throw new ImageModerationResponseError();
    }
  }

  if (result.flagged !== (categories.length > 0)) {
    throw new ImageModerationResponseError();
  }

  return categories.length > 0
    ? { status: "blocked", categories: categories.sort() }
    : { status: "allowed" };
}

function moderationErrorType(
  error: unknown
): ImageModerationErrorType {
  if (error instanceof ImageModerationTimeoutError) {
    return "timeout";
  }
  if (error instanceof ImageModerationResponseError) {
    return "invalid_response";
  }
  if (error instanceof ImageModerationRequestError) {
    return "request_error";
  }
  return "unknown";
}

async function requestModerationForAttempt(options: {
  attempt: ModerationProviderAttempt;
  input: unknown;
  requiredCategories: readonly string[];
  fetchImpl: typeof fetch;
}): Promise<ImageModerationDecision> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.attempt.timeoutMs);
  timer.unref?.();

  try {
    let response: Response;
    try {
      response = await options.fetchImpl(options.attempt.endpointUrl, {
        method: "POST",
        headers: {
          ...normalizeProviderHeaders(
            options.attempt.providerAccount.headersJson
          ),
          authorization: `Bearer ${options.attempt.providerAccount.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: options.attempt.model,
          input: options.input
        }),
        signal: controller.signal
      });
    } catch {
      if (timedOut) {
        throw new ImageModerationTimeoutError();
      }
      throw new ImageModerationRequestError();
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      if (timedOut) {
        throw new ImageModerationTimeoutError();
      }
      throw new ImageModerationRequestError();
    }

    if (!response.ok) {
      throw new ImageModerationRequestError();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ImageModerationResponseError();
    }

    return parseModerationDecision(parsed, options.requiredCategories);
  } catch (error) {
    if (timedOut) {
      throw new ImageModerationTimeoutError();
    }
    if (
      error instanceof ImageModerationRequestError ||
      error instanceof ImageModerationResponseError ||
      error instanceof ImageModerationTimeoutError
    ) {
      throw error;
    }
    throw new ImageModerationRequestError();
  } finally {
    clearTimeout(timer);
  }
}

function createAttemptClient(options: {
  attempt: ModerationProviderAttempt;
  fetchImpl: typeof fetch;
  log?: (entry: ImageModerationLogEntry) => void;
}): ImageModerationClient {
  const request = (
    inputType: ModerationInputType,
    input: unknown,
    requiredCategories: readonly string[]
  ) =>
    requestModerationForAttempt({
      attempt: options.attempt,
      input,
      requiredCategories,
      fetchImpl: options.fetchImpl
    });

  return {
    moderateText(input) {
      if (typeof input !== "string" || input.trim() === "") {
        return Promise.reject(new ImageModerationRequestError());
      }
      return request("text", [{ type: "text", text: input }], [
        "sexual",
        "sexual/minors"
      ]);
    },
    async moderateImage(input) {
      const url = validateModerationImageUrl(input?.url);
      return request(
        "image",
        [{ type: "image_url", image_url: { url } }],
        ["sexual"]
      );
    }
  };
}

export function createRoutedImageModerationClient(options: {
  resolveAttempts(
    inputType: ModerationInputType
  ): ModerationProviderAttempt[] | Promise<ModerationProviderAttempt[]>;
  fetchImpl?: typeof fetch;
  log?: (entry: ImageModerationLogEntry) => void;
  circuitBreaker?: ModerationRouteCircuitBreaker;
}): ImageModerationClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const circuitBreaker = options.circuitBreaker;
  const emitLog = (createEntry: () => ImageModerationLogEntry): void => {
    try {
      options.log?.(createEntry());
    } catch {
      // Logging must never affect moderation control flow.
    }
  };

  async function moderate(
    inputType: ModerationInputType,
    input: unknown,
    requiredCategories: readonly string[]
  ): Promise<ImageModerationDecision> {
    const attempts = await options.resolveAttempts(inputType);
    let lastErrorType: ImageModerationErrorType | null = null;
    for (const [index, attempt] of attempts.entries()) {
      const lease = circuitBreaker?.acquire(attempt.route.id, inputType);
      if (circuitBreaker && lease === null) {
        continue;
      }
      const startedAt = Date.now();
      let providerDecisionResolved = false;
      try {
        const decision = await requestModerationForAttempt({
          attempt,
          input,
          requiredCategories,
          fetchImpl
        });
        providerDecisionResolved = true;
        if (circuitBreaker && lease) {
          circuitBreaker.recordSuccess(lease);
        }
        emitLog(() => ({
          routeId: attempt.route.id,
          providerAccountId: attempt.providerAccount.id,
          providerType: attempt.providerAccount.providerType,
          inputType,
          attemptIndex: index + 1,
          attemptCount: attempts.length,
          moderationModel: attempt.model,
          endpointPath: attempt.endpointPath,
          timeoutMs: attempt.timeoutMs,
          latencyMs: Date.now() - startedAt,
          outcome: decision.status,
          ...(decision.status === "blocked"
            ? { blockedCategories: decision.categories }
            : {}),
          failoverCount: index
        }));
        return decision;
      } catch (error) {
        const errorType = moderationErrorType(error);
        if (circuitBreaker && lease && !providerDecisionResolved) {
          circuitBreaker.recordFailure(lease, errorType);
        }
        lastErrorType = errorType;
        emitLog(() => ({
          routeId: attempt.route.id,
          providerAccountId: attempt.providerAccount.id,
          providerType: attempt.providerAccount.providerType,
          inputType,
          attemptIndex: index + 1,
          attemptCount: attempts.length,
          moderationModel: attempt.model,
          endpointPath: attempt.endpointPath,
          timeoutMs: attempt.timeoutMs,
          latencyMs: Date.now() - startedAt,
          outcome: "unavailable",
          errorType,
          failoverCount: index
        }));
      }
    }

    throw new ImageModerationUnavailableError(lastErrorType);
  }

  return {
    moderateText(input) {
      if (typeof input !== "string" || input.trim() === "") {
        return Promise.reject(new ImageModerationRequestError());
      }
      return moderate("text", [{ type: "text", text: input }], [
        "sexual",
        "sexual/minors"
      ]);
    },
    async moderateImage(input) {
      const url = validateModerationImageUrl(input?.url);
      return moderate(
        "image",
        [{ type: "image_url", image_url: { url } }],
        ["sexual"]
      );
    }
  };
}

export function createImageModerationClient(options: {
  apiKey: string;
  baseUrl: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ImageModerationClient {
  const apiKey = requireNonEmptyEnvironmentValue(
    options.apiKey,
    "IMAGE_MODERATION_API_KEY_REQUIRED"
  );
  const baseUrl = normalizeModerationBaseUrl(options.baseUrl);
  const model = requireNonEmptyEnvironmentValue(
    options.model ?? IMAGE_MODERATION_DEFAULT_MODEL,
    "IMAGE_MODERATION_MODEL_INVALID"
  );
  const timeoutMs = normalizeModerationTimeout(
    options.timeoutMs ?? IMAGE_MODERATION_DEFAULT_TIMEOUT_MS
  );
  const endpointUrl = joinProviderEndpointUrl(baseUrl, "/moderations");
  const attempt: ModerationProviderAttempt = {
    route: {
      id: "legacy-env",
      providerAccountId: "legacy-env",
      upstreamModel: model,
      endpointPath: "/moderations",
      priority: 1,
      enabled: true,
      timeoutMs,
      supportsText: true,
      supportsImage: true
    },
    providerAccount: {
      id: "legacy-env",
      name: "legacy-env",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl,
      apiKey,
      enabled: true,
      timeoutMs,
      configJson: null
    },
    model,
    endpointPath: "/moderations",
    timeoutMs,
    endpointUrl
  };
  return createAttemptClient({ attempt, fetchImpl: options.fetchImpl ?? fetch });
}
