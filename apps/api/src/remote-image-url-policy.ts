import ipaddr from "ipaddr.js";

export type RemoteImageAllowedHostRule =
  | {
      kind: "exact";
      hostname: string;
    }
  | {
      kind: "wildcard";
      hostname: string;
    };

export interface ValidatedRemoteImageUrl {
  url: URL;
  protocol: "https:";
  hostname: string;
  port: string;
  pathname: string;
  search: string;
}

export type RemoteImageUrlPolicyErrorCode =
  | "REMOTE_IMAGE_ALLOWLIST_INVALID"
  | "REMOTE_IMAGE_URL_INVALID";

export type RemoteImageUrlPolicyReason =
  | "MALFORMED_URL"
  | "HOST_NOT_ALLOWED"
  | "OTHER_POLICY_VIOLATION"
  | "PROTOCOL_NOT_ALLOWED"
  | "CREDENTIALS_NOT_ALLOWED"
  | "PORT_NOT_ALLOWED"
  | "FRAGMENT_NOT_ALLOWED";

const remoteImageUrlPolicyMessages: Record<RemoteImageUrlPolicyErrorCode, string> = {
  REMOTE_IMAGE_ALLOWLIST_INVALID: "remote image allowlist is invalid",
  REMOTE_IMAGE_URL_INVALID: "remote image URL is invalid or not allowed"
};

export class RemoteImageUrlPolicyError extends Error {
  readonly code: RemoteImageUrlPolicyErrorCode;
  readonly reason: RemoteImageUrlPolicyReason;

  constructor(
    code: RemoteImageUrlPolicyErrorCode,
    reason: RemoteImageUrlPolicyReason = "OTHER_POLICY_VIOLATION"
  ) {
    super(remoteImageUrlPolicyMessages[code]);
    this.name = "RemoteImageUrlPolicyError";
    this.code = code;
    this.reason = reason;
  }
}

export function parseRemoteImageAllowedHostRules(
  value: string
): readonly RemoteImageAllowedHostRule[] {
  if (value.trim().length === 0) {
    throwRemoteImageUrlPolicyError("REMOTE_IMAGE_ALLOWLIST_INVALID");
  }

  const rules = new Map<string, RemoteImageAllowedHostRule>();

  for (const rawRule of value.split(",")) {
    const normalizedRule = rawRule.trim().toLowerCase();
    if (normalizedRule.length === 0) {
      throwRemoteImageUrlPolicyError("REMOTE_IMAGE_ALLOWLIST_INVALID");
    }

    const normalizedWithoutTrailingDot = normalizedRule.endsWith(".")
      ? normalizedRule.slice(0, -1)
      : normalizedRule;
    const isWildcard = normalizedWithoutTrailingDot.startsWith("*.");
    const hostname = isWildcard
      ? normalizedWithoutTrailingDot.slice(2)
      : normalizedWithoutTrailingDot;

    if (
      normalizedWithoutTrailingDot.includes("*") &&
      (!isWildcard || normalizedWithoutTrailingDot.indexOf("*", 1) !== -1)
    ) {
      throwRemoteImageUrlPolicyError("REMOTE_IMAGE_ALLOWLIST_INVALID");
    }

    if (!isValidAllowedHostname(hostname)) {
      throwRemoteImageUrlPolicyError("REMOTE_IMAGE_ALLOWLIST_INVALID");
    }

    const rule: RemoteImageAllowedHostRule = isWildcard
      ? { kind: "wildcard", hostname }
      : { kind: "exact", hostname };
    rules.set(`${rule.kind}:${rule.hostname}`, rule);
  }

  return [...rules.values()];
}

export function validateRemoteImageDownloadUrl(
  value: string,
  allowedHostRules: readonly RemoteImageAllowedHostRule[]
): ValidatedRemoteImageUrl {
  if (typeof value !== "string") {
    throwRemoteImageUrlPolicyError("REMOTE_IMAGE_URL_INVALID", "MALFORMED_URL");
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0 || trimmedValue.startsWith("//")) {
    throwRemoteImageUrlPolicyError("REMOTE_IMAGE_URL_INVALID", "MALFORMED_URL");
  }

  let url: URL;
  try {
    url = new URL(trimmedValue);
  } catch {
    throwRemoteImageUrlPolicyError("REMOTE_IMAGE_URL_INVALID", "MALFORMED_URL");
  }

  if (url.protocol !== "https:") {
    throwRemoteImageUrlPolicyError(
      "REMOTE_IMAGE_URL_INVALID",
      "PROTOCOL_NOT_ALLOWED"
    );
  }
  if (
    hasUrlCredentials(trimmedValue) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throwRemoteImageUrlPolicyError(
      "REMOTE_IMAGE_URL_INVALID",
      "CREDENTIALS_NOT_ALLOWED"
    );
  }
  if (trimmedValue.includes("#")) {
    throwRemoteImageUrlPolicyError(
      "REMOTE_IMAGE_URL_INVALID",
      "FRAGMENT_NOT_ALLOWED"
    );
  }
  if (url.port.length > 0 && url.port !== "443") {
    throwRemoteImageUrlPolicyError("REMOTE_IMAGE_URL_INVALID", "PORT_NOT_ALLOWED");
  }
  if (url.hostname.length === 0) {
    throwRemoteImageUrlPolicyError(
      "REMOTE_IMAGE_URL_INVALID",
      "OTHER_POLICY_VIOLATION"
    );
  }

  if (isIpLiteralHostname(url.hostname)) {
    throwRemoteImageUrlPolicyError(
      "REMOTE_IMAGE_URL_INVALID",
      "OTHER_POLICY_VIOLATION"
    );
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    hostname.length === 0 ||
    !allowedHostRules.some((rule) => matchesAllowedHostRule(hostname, rule))
  ) {
    throwRemoteImageUrlPolicyError("REMOTE_IMAGE_URL_INVALID", "HOST_NOT_ALLOWED");
  }

  return {
    url,
    protocol: "https:",
    hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search
  };
}

export function isPublicRemoteAddress(address: unknown): boolean {
  if (typeof address !== "string" || address.trim().length === 0) {
    return false;
  }

  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

function throwRemoteImageUrlPolicyError(
  code: RemoteImageUrlPolicyErrorCode,
  reason: RemoteImageUrlPolicyReason = "OTHER_POLICY_VIOLATION"
): never {
  throw new RemoteImageUrlPolicyError(code, reason);
}

function isValidAllowedHostname(hostname: string): boolean {
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes("..") ||
    !/^[a-z0-9.-]+$/u.test(hostname) ||
    isIpLiteralHostname(hostname)
  ) {
    return false;
  }

  const labels = hostname.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-")
    )
  ) {
    return false;
  }

  try {
    return new URL(`https://${hostname}`).hostname === hostname;
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  const lowercased = hostname.toLowerCase();
  return lowercased.endsWith(".") ? lowercased.slice(0, -1) : lowercased;
}

function isIpLiteralHostname(hostname: string): boolean {
  const address =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  try {
    ipaddr.parse(address);
    return true;
  } catch {
    return false;
  }
}

function matchesAllowedHostRule(
  hostname: string,
  rule: RemoteImageAllowedHostRule
): boolean {
  if (rule.kind === "exact") {
    return hostname === rule.hostname;
  }

  const hostnameLabels = hostname.split(".");
  const allowedLabels = rule.hostname.split(".");
  return (
    hostnameLabels.length === allowedLabels.length + 1 &&
    hostname.endsWith(`.${rule.hostname}`)
  );
}

function hasUrlCredentials(value: string): boolean {
  const schemeSeparatorIndex = value.indexOf("://");
  if (schemeSeparatorIndex === -1) {
    return false;
  }

  const authorityStart = schemeSeparatorIndex + 3;
  let authorityEnd = value.length;
  for (const delimiter of ["/", "?", "#"]) {
    const delimiterIndex = value.indexOf(delimiter, authorityStart);
    if (delimiterIndex !== -1 && delimiterIndex < authorityEnd) {
      authorityEnd = delimiterIndex;
    }
  }

  const authority = value.slice(authorityStart, authorityEnd);
  return authority.includes("@");
}
