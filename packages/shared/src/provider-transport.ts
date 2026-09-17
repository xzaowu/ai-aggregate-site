const HTTP_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

const DENIED_PROVIDER_HEADER_NAMES = new Set([
  "authorization",
  "content-type",
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function isSafeProviderBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("PROVIDER_BASE_URL_INVALID");
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    throw new Error("PROVIDER_BASE_URL_INVALID");
  }

  return parsed;
}

function normalizeProviderEndpointSuffix(value: string): string {
  const endpoint = value.trim();
  if (
    !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(endpoint) ||
    endpoint.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("PROVIDER_ENDPOINT_PATH_INVALID");
  }

  return endpoint;
}

/** Join an explicit provider API prefix with a safe endpoint path. */
export function joinProviderEndpointUrl(
  baseUrl: string,
  endpointSuffix: string
): string {
  const base = isSafeProviderBaseUrl(baseUrl);
  const endpoint = normalizeProviderEndpointSuffix(endpointSuffix);
  const basePath = base.pathname.replace(/\/+$/u, "");

  return `${base.origin}${basePath}${endpoint}`;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

/** Keep only non-hop-by-hop, string-valued provider custom headers. */
export function normalizeProviderHeaders(
  headersJson: unknown
): Record<string, string> {
  if (
    typeof headersJson !== "object" ||
    headersJson === null ||
    Array.isArray(headersJson)
  ) {
    return {};
  }

  const headers = new Map<string, string>();
  for (const [name, value] of Object.entries(headersJson)) {
    if (
      typeof value !== "string" ||
      hasControlCharacter(name) ||
      hasControlCharacter(value)
    ) {
      continue;
    }

    const normalizedName = name.trim().toLowerCase();
    if (
      !HTTP_HEADER_NAME_RE.test(normalizedName) ||
      DENIED_PROVIDER_HEADER_NAMES.has(normalizedName)
    ) {
      continue;
    }

    headers.set(normalizedName, value.trim());
  }

  return Object.fromEntries(headers);
}
