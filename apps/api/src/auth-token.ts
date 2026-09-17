import { createHash, randomBytes } from "node:crypto";

const AUTH_TOKEN_BYTES = 32;
const AUTH_TOKEN_LENGTH = 43;
const authTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createAuthToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(AUTH_TOKEN_BYTES).toString("base64url");

  if (
    rawToken.length !== AUTH_TOKEN_LENGTH ||
    !authTokenPattern.test(rawToken)
  ) {
    throw new Error("AUTH_TOKEN_GENERATION_FAILED");
  }

  return {
    rawToken,
    tokenHash: hashAuthTokenValue(rawToken)
  };
}

export function hashAuthToken(input: unknown): string | null {
  if (
    typeof input !== "string" ||
    input.length !== AUTH_TOKEN_LENGTH ||
    !authTokenPattern.test(input)
  ) {
    return null;
  }

  return hashAuthTokenValue(input);
}

export function createAuthTokenExpiry(now: Date, ttlMs: number): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("AUTH_TOKEN_EXPIRY_INVALID_DATE");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new TypeError("AUTH_TOKEN_EXPIRY_INVALID_TTL");
  }

  const expiryMs = now.getTime() + ttlMs;
  if (!Number.isFinite(expiryMs)) {
    throw new TypeError("AUTH_TOKEN_EXPIRY_INVALID_DATE");
  }

  const expiry = new Date(expiryMs);
  if (!Number.isFinite(expiry.getTime())) {
    throw new TypeError("AUTH_TOKEN_EXPIRY_INVALID_DATE");
  }

  return expiry;
}

function hashAuthTokenValue(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
