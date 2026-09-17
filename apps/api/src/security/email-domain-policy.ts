import { domainToASCII } from "node:url";

export const DEFAULT_REGISTRATION_ALLOWED_DOMAINS = ["gmail.com", "qq.com"];
export const DEFAULT_REGISTRATION_CLOSED_MESSAGE_ZH =
  "当前暂未开放新用户注册，已有账号可正常登录。";
export const DEFAULT_REGISTRATION_CLOSED_MESSAGE_EN =
  "New user registration is currently unavailable. Existing users can still sign in.";

export type RegistrationEmailPolicyMode = "ALL" | "ALLOWLIST" | "DENYLIST";

export interface RegistrationEmailPolicy {
  enabled: boolean;
  mode: RegistrationEmailPolicyMode;
  allowedDomains: string[];
  blockedDomains: string[];
}

export function normalizeEmailDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (
    !trimmed ||
    trimmed.length > 253 ||
    trimmed.includes("@") ||
    trimmed.includes("*") ||
    trimmed.includes(":") ||
    trimmed.includes("/") ||
    trimmed.startsWith(".") ||
    trimmed.endsWith(".")
  ) {
    return null;
  }

  const ascii = domainToASCII(trimmed).toLowerCase();
  if (!ascii || ascii.length > 253) return null;

  const labels = ascii.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(label)
    )
  ) {
    return null;
  }

  return ascii;
}

export function parseDomainListSetting(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("INVALID_REGISTRATION_DOMAIN_LIST");
  }

  if (!Array.isArray(parsed) || parsed.length > 100) {
    throw new Error("INVALID_REGISTRATION_DOMAIN_LIST");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "string") {
      throw new Error("INVALID_REGISTRATION_DOMAIN_LIST");
    }
    const domain = normalizeEmailDomain(item);
    if (!domain || seen.has(domain)) {
      throw new Error("INVALID_REGISTRATION_DOMAIN_LIST");
    }
    seen.add(domain);
    normalized.push(domain);
  }
  return normalized;
}

function parseBoolean(value: string | null | undefined): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function resolveRegistrationEmailPolicy(
  values: ReadonlyMap<string, string>,
  onInvalid?: () => void
): RegistrationEmailPolicy {
  const fallback = (): RegistrationEmailPolicy => ({
    enabled: true,
    mode: "ALLOWLIST",
    allowedDomains: [...DEFAULT_REGISTRATION_ALLOWED_DOMAINS],
    blockedDomains: []
  });

  try {
    const enabledValue = values.get("registrationEmailPolicyEnabled");
    const enabled = enabledValue === undefined ? true : parseBoolean(enabledValue);
    const rawMode = values.get("registrationEmailPolicyMode") ?? "ALLOWLIST";
    const mode = rawMode.toUpperCase();
    if (
      enabled === null ||
      (mode !== "ALL" && mode !== "ALLOWLIST" && mode !== "DENYLIST")
    ) {
      throw new Error("INVALID_REGISTRATION_EMAIL_POLICY");
    }

    const allowedDomains = values.has("registrationAllowedDomainsJson")
      ? parseDomainListSetting(values.get("registrationAllowedDomainsJson")!)
      : [...DEFAULT_REGISTRATION_ALLOWED_DOMAINS];
    const blockedDomains = values.has("registrationBlockedDomainsJson")
      ? parseDomainListSetting(values.get("registrationBlockedDomainsJson")!)
      : [];
    if (enabled && mode === "ALLOWLIST" && allowedDomains.length === 0) {
      throw new Error("INVALID_REGISTRATION_EMAIL_POLICY");
    }

    return {
      enabled,
      mode: mode as RegistrationEmailPolicyMode,
      allowedDomains,
      blockedDomains
    };
  } catch {
    onInvalid?.();
    return fallback();
  }
}

export function isRegistrationEmailAllowed(
  email: string,
  policy: RegistrationEmailPolicy
): boolean {
  const separator = email.lastIndexOf("@");
  if (separator < 0) return false;
  const domain = normalizeEmailDomain(email.slice(separator + 1));
  if (!domain) return false;
  if (!policy.enabled) return true;
  if (policy.blockedDomains.includes(domain)) return false;
  if (policy.mode === "ALLOWLIST") return policy.allowedDomains.includes(domain);
  return true;
}
