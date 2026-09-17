import {
  createAuthToken,
  createAuthTokenExpiry,
  hashAuthToken
} from "./auth-token";

export const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
export const EMAIL_VERIFICATION_TOKEN_LENGTH = 43;
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const trustedPublicWebUrlError = "PUBLIC_WEB_URL_INVALID";

export function createEmailVerificationToken(): {
  rawToken: string;
  tokenHash: string;
} {
  try {
    return createAuthToken();
  } catch {
    throw new Error("EMAIL_VERIFICATION_TOKEN_GENERATION_FAILED");
  }
}

export function hashEmailVerificationToken(input: unknown): string | null {
  return hashAuthToken(input);
}

export function createEmailVerificationExpiry(now = new Date()): Date {
  try {
    return createAuthTokenExpiry(now, EMAIL_VERIFICATION_TOKEN_TTL_MS);
  } catch {
    throw new TypeError("EMAIL_VERIFICATION_EXPIRY_INVALID_DATE");
  }
}

export function normalizePublicWebUrl(
  input: unknown,
  environment: "development" | "test" | "production"
): string {
  const url = parsePublicWebUrl(input);

  if (environment === "production") {
    if (url.protocol !== "https:") {
      throw new Error(trustedPublicWebUrlError);
    }
  } else if (url.protocol !== "https:" && !isLocalHttpOrigin(url)) {
    throw new Error(trustedPublicWebUrlError);
  }

  return url.origin;
}

export function buildEmailVerificationUrl(
  publicWebUrl: string,
  rawToken: string
): string {
  const origin = normalizeTrustedPublicWebUrlOrigin(publicWebUrl);
  if (hashEmailVerificationToken(rawToken) === null) {
    throw new Error("EMAIL_VERIFICATION_TOKEN_INVALID");
  }

  const verificationUrl = new URL("/verify-email", origin);
  verificationUrl.searchParams.set("token", rawToken);
  return verificationUrl.toString();
}

function parsePublicWebUrl(input: unknown): URL {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input !== input.trim()
  ) {
    throw new Error(trustedPublicWebUrlError);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(trustedPublicWebUrlError);
  }

  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && url.protocol !== "http:")
  ) {
    throw new Error(trustedPublicWebUrlError);
  }

  return url;
}

export function normalizeTrustedPublicWebUrlOrigin(publicWebUrl: string): string {
  const url = parsePublicWebUrl(publicWebUrl);
  if (url.protocol === "https:" || isLocalHttpOrigin(url)) {
    return url.origin;
  }

  throw new Error(trustedPublicWebUrlError);
}

function isLocalHttpOrigin(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1")
  );
}
