import {
  createAuthToken,
  createAuthTokenExpiry,
  hashAuthToken
} from "./auth-token";
import { normalizeTrustedPublicWebUrlOrigin } from "./email-verification";

export const PASSWORD_RESET_TOKEN_BYTES = 32;
export const PASSWORD_RESET_TOKEN_LENGTH = 43;
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export function createPasswordResetToken(): {
  rawToken: string;
  tokenHash: string;
} {
  try {
    return createAuthToken();
  } catch {
    throw new Error("PASSWORD_RESET_TOKEN_GENERATION_FAILED");
  }
}

export function hashPasswordResetToken(input: unknown): string | null {
  return hashAuthToken(input);
}

export function createPasswordResetExpiry(now = new Date()): Date {
  try {
    return createAuthTokenExpiry(now, PASSWORD_RESET_TOKEN_TTL_MS);
  } catch {
    throw new TypeError("PASSWORD_RESET_EXPIRY_INVALID_DATE");
  }
}

export function buildPasswordResetUrl(
  publicWebUrl: string,
  rawToken: string
): string {
  const origin = normalizeTrustedPublicWebUrlOrigin(publicWebUrl);
  if (hashPasswordResetToken(rawToken) === null) {
    throw new Error("PASSWORD_RESET_TOKEN_INVALID");
  }

  const resetUrl = new URL("/reset-password", origin);
  resetUrl.searchParams.set("token", rawToken);
  return resetUrl.toString();
}
