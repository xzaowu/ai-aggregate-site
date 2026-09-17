import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpayConfig {
  /** Whether EPay is enabled and fully configured. */
  enabled: boolean;
  gatewayUrl: string;
  pid: string;
  key: string;
  notifyUrl: string;
  returnUrl: string;
  /** Where the effective config comes from. */
  source: "database" | "env" | "mixed" | "none";
}

export interface EpaySafeConfig {
  /** Whether EPay is enabled and fully configured (safe to expose). */
  enabled: boolean;
  gatewayUrl: string;
  pid: string;
  notifyUrl: string;
  returnUrl: string;
  /** True when EPay is enabled but one or more required variables are missing. */
  misconfigured: boolean;
  /** Where the config comes from. */
  source: "database" | "env" | "mixed" | "none";
  /** Whether the effective runtime configuration has a usable key. */
  hasKey: boolean;
  /** Missing required fields (only populated when misconfigured). */
  missingFields: string[];
}

/** Server-only identity and secret material used to verify EPay callbacks. */
export interface EpayCallbackVerificationConfig {
  pid: string;
  key: string;
  source: "database" | "env";
}

export interface EpayCallbackVerificationSetting {
  pid: string | null;
  decryptedKey: string | null;
}

export interface EpaySignParams {
  [key: string]: string | number | undefined | null;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/**
 * Read EPay configuration from the environment.
 * EPay is only enabled when EPAY_ENABLED === "true" AND all required vars
 * are present. Never log or expose EPAY_KEY.
 */
export function readEpayConfig(env: Partial<NodeJS.ProcessEnv>): EpayConfig {
  const enabled = env.EPAY_ENABLED === "true";

  const gatewayUrl = (env.EPAY_GATEWAY_URL ?? "").trim();
  const pid = (env.EPAY_PID ?? "").trim();
  const key = (env.EPAY_KEY ?? "").trim();
  const notifyUrl = (env.EPAY_NOTIFY_URL ?? "").trim();
  const returnUrl = (env.EPAY_RETURN_URL ?? "").trim();

  if (!enabled) {
    return {
      enabled: false,
      gatewayUrl: "",
      pid: "",
      key: "",
      notifyUrl: "",
      returnUrl: "",
      source: "none"
    };
  }

  return {
    enabled: true,
    gatewayUrl,
    pid,
    key,
    notifyUrl,
    returnUrl,
    source: "env"
  };
}

/**
 * Raw payment setting record from the database (decrypted).
 */
export interface PaymentSettingRecord {
  id: string;
  provider: string;
  enabled: boolean;
  gatewayUrl: string | null;
  pid: string | null;
  decryptedKey: string | null;
  notifyUrl: string | null;
  returnUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Read EPay configuration from a database PaymentSetting record.
 * The decryptedKey must already be decrypted before calling this.
 */
export function readEpayConfigFromDb(
  setting: PaymentSettingRecord | null,
  env: Partial<NodeJS.ProcessEnv>
): EpayConfig {
  if (!setting) {
    return readEpayConfig(env);
  }

  const gatewayUrl = (setting.gatewayUrl ?? "").trim();
  const pid = (setting.pid ?? "").trim();
  const key = (setting.decryptedKey ?? "").trim();
  const notifyUrl = (setting.notifyUrl ?? "").trim();
  const returnUrl = (setting.returnUrl ?? "").trim();

  // If DB setting says not enabled, respect it regardless of env
  if (!setting.enabled) {
    return {
      enabled: false,
      gatewayUrl: "",
      pid: "",
      key: "",
      notifyUrl: "",
      returnUrl: "",
      source: "database"
    };
  }

  // If DB key is missing but env key exists, use env key as fallback
  const envKey = (env.EPAY_KEY ?? "").trim();
  const effectiveKey = key || envKey;

  return {
    enabled: true,
    gatewayUrl,
    pid,
    key: effectiveKey,
    notifyUrl,
    returnUrl,
    source: !key && envKey ? "mixed" : "database"
  };
}

/**
 * Resolve the callback-only verification contract independently from whether
 * new EPay initiations are enabled. A database record owns the merchant pid;
 * only its missing/unusable key may use the existing EPAY_KEY fallback.
 */
export function readEpayCallbackVerificationConfig(
  setting: EpayCallbackVerificationSetting | null,
  env: Partial<NodeJS.ProcessEnv>
): EpayCallbackVerificationConfig | null {
  if (setting) {
    const pid = (setting.pid ?? "").trim();
    const storedKey = (setting.decryptedKey ?? "").trim();
    const key = storedKey || (env.EPAY_KEY ?? "").trim();

    if (!pid || !key) {
      return null;
    }

    return {
      pid,
      key,
      source: "database"
    };
  }

  const pid = (env.EPAY_PID ?? "").trim();
  const key = (env.EPAY_KEY ?? "").trim();

  if (!pid || !key) {
    return null;
  }

  return {
    pid,
    key,
    source: "env"
  };
}

/**
 * Return a public-safe version of the EPay config that never includes
 * EPAY_KEY. Useful for admin status checks or debug endpoints.
 */
export function epaySafeConfig(config: EpayConfig): EpaySafeConfig {
  const missingFields: string[] = [];

  if (!config.gatewayUrl) missingFields.push("gatewayUrl");
  if (!config.pid) missingFields.push("pid");
  if (!config.key) missingFields.push("key");
  if (!config.notifyUrl) missingFields.push("notifyUrl");
  if (!config.returnUrl) missingFields.push("returnUrl");

  const missing = missingFields.length > 0;

  return {
    enabled: config.enabled && !missing,
    gatewayUrl: config.gatewayUrl,
    pid: config.pid,
    notifyUrl: config.notifyUrl,
    returnUrl: config.returnUrl,
    misconfigured: config.enabled && missing,
    source: config.source,
    hasKey: Boolean(config.key),
    missingFields: config.enabled ? missingFields : []
  };
}

// ---------------------------------------------------------------------------
// EPay MD5 signing (standard 易支付 protocol)
// ---------------------------------------------------------------------------

/**
 * Normalize EPay parameters by removing entries whose value is null,
 * undefined, or the empty string. Also removes the reserved `sign` and
 * `sign_type` keys (they are never part of the signature payload).
 */
export function normalizeEpayParams(
  params: EpaySignParams
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key === "sign" || key === "sign_type") {
      continue;
    }

    if (value === null || value === undefined || value === "") {
      continue;
    }

    result[key] = String(value);
  }

  return result;
}

/**
 * Build the plain-text string that will be hashed.
 * Steps: normalize params → sort keys alphabetically →
 * join as `key=value&key=value` → append the merchant key.
 */
export function buildEpaySignString(
  params: EpaySignParams,
  merchantKey: string
): string {
  const normalized = normalizeEpayParams(params);
  const sortedKeys = Object.keys(normalized).sort();

  const queryString = sortedKeys
    .map((key) => `${key}=${normalized[key]}`)
    .join("&");

  return `${queryString}${merchantKey}`;
}

/**
 * Sign EPay parameters with MD5.
 * Returns a lowercase MD5 hex string.
 */
export function signEpayParams(
  params: EpaySignParams,
  merchantKey: string
): string {
  const signString = buildEpaySignString(params, merchantKey);
  return crypto.createHash("md5").update(signString, "utf8").digest("hex");
}

/**
 * Verify an EPay signature.
 * Computes the expected sign from the params (without the sign field)
 * and compares it (constant-time safe-ish) with the provided sign.
 */
export function verifyEpaySignature(
  params: EpaySignParams,
  merchantKey: string,
  providedSign: string
): boolean {
  const expected = signEpayParams(params, merchantKey);
  if (expected.length !== providedSign.length) {
    return false;
  }

  // Constant-time comparison to reduce timing leakage.
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(providedSign, "utf8")
  );
}

// ---------------------------------------------------------------------------
// Payment URL helpers
// ---------------------------------------------------------------------------

/** Supported EPay payment types exposed to users. */
export const EPAY_PAYMENT_TYPES = ["alipay", "wxpay"] as const;
export type EpayPaymentType = (typeof EPAY_PAYMENT_TYPES)[number];
export const DEFAULT_EPAY_PAYMENT_TYPES: EpayPaymentType[] = ["alipay"];

export function isEpayPaymentType(value: unknown): value is EpayPaymentType {
  return typeof value === "string" && EPAY_PAYMENT_TYPES.includes(value as EpayPaymentType);
}

export function normalizeEpayPaymentTypes(value: unknown): EpayPaymentType[] {
  let raw: unknown = value;

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return DEFAULT_EPAY_PAYMENT_TYPES;
    }

    try {
      raw = JSON.parse(trimmed) as unknown;
    } catch {
      raw = trimmed.split(",");
    }
  }

  if (!Array.isArray(raw)) {
    return DEFAULT_EPAY_PAYMENT_TYPES;
  }

  const methods = raw.filter(isEpayPaymentType);
  const unique = Array.from(new Set(methods));

  if (unique.length === 0) {
    return DEFAULT_EPAY_PAYMENT_TYPES;
  }

  return unique.includes("alipay") ? unique : ["alipay", ...unique];
}

/**
 * Create a deterministic merchant trade number for an order.
 * Format: order_<orderId>
 */
export function createPaymentTradeNo(orderId: string): string {
  return `order_${orderId}`;
}

/**
 * Convert a decimal money amount in cents (e.g. 2900 = ¥29.00) to the
 * EPay money string format.
 */
export function formatEpayMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Build the full EPay payment page URL for an order.
 * All pricing data comes from the database — never from the frontend.
 */
export function buildEpayPaymentUrl(config: EpayConfig, params: {
  paymentType: EpayPaymentType;
  outTradeNo: string;
  name: string;
  moneyCents: number;
}): string {
  const { paymentType, outTradeNo, name, moneyCents } = params;

  const requestParams: EpaySignParams = {
    pid: config.pid,
    type: paymentType,
    out_trade_no: outTradeNo,
    notify_url: config.notifyUrl,
    return_url: config.returnUrl,
    name,
    money: formatEpayMoney(moneyCents)
  };

  const sign = signEpayParams(requestParams, config.key);

  // Build the final query string including sign and sign_type
  const finalParams: EpaySignParams = {
    ...requestParams,
    sign_type: "MD5",
    sign
  };

  const query = Object.entries(finalParams)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

  return `${config.gatewayUrl}?${query}`;
}

// ---------------------------------------------------------------------------
// Notify / callback helpers
// ---------------------------------------------------------------------------

/** Parsed EPay notify callback fields. */
export interface EpayNotifyParams {
  [key: string]: string | undefined;
  pid: string;
  trade_no: string;
  out_trade_no: string;
  type: string;
  name: string;
  money: string;
  trade_status: string;
  sign: string;
  sign_type: string;
}

/** Recognised success trade status values. Extend if your provider differs. */
const SUCCESS_TRADE_STATUSES = new Set(["TRADE_SUCCESS"]);

/**
 * Returns true when the trade_status value indicates a successfully
 * completed payment.
 */
export function isSuccessTradeStatus(status: string): boolean {
  return SUCCESS_TRADE_STATUSES.has(status);
}

/**
 * Convert an EPay money string (e.g. "29.00") to an integer number of
 * cents (2900). Returns null when the input cannot be parsed safely.
 */
export function convertEpayMoneyToCents(money: string): number | null {
  const trimmed = money.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  // Multiply by 100 and round to avoid floating-point drift (e.g. 29.00 * 100 = 2899.9999...)
  return Math.round(parsed * 100);
}

/**
 * Parse raw callback key-value pairs into a typed EpayNotifyParams.
 * Returns null when required fields are missing.
 */
export function parseEpayNotifyParams(
  raw: Record<string, string | string[] | undefined>
): EpayNotifyParams | null {
  const get = (key: string): string | undefined => {
    const value = raw[key];
    if (Array.isArray(value) || typeof value !== "string") {
      return undefined;
    }
    return value;
  };

  const pid = get("pid");
  const trade_no = get("trade_no");
  const out_trade_no = get("out_trade_no");
  const type = get("type");
  const name = get("name");
  const money = get("money");
  const trade_status = get("trade_status");
  const sign = get("sign");
  const sign_type = get("sign_type");

  if (
    !pid ||
    !trade_no ||
    !out_trade_no ||
    !type ||
    !name ||
    !money ||
    !trade_status ||
    !sign ||
    !sign_type
  ) {
    return null;
  }

  return {
    pid,
    trade_no,
    out_trade_no,
    type,
    name,
    money,
    trade_status,
    sign,
    sign_type
  };
}
