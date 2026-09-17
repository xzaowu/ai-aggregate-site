import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  buildEmailVerificationUrl,
  createEmailVerificationExpiry,
  hashEmailVerificationToken,
  normalizePublicWebUrl
} from "../src/email-verification";
import {
  PASSWORD_RESET_TOKEN_LENGTH,
  PASSWORD_RESET_TOKEN_TTL_MS,
  buildPasswordResetUrl,
  createPasswordResetExpiry,
  createPasswordResetToken,
  hashPasswordResetToken
} from "../src/password-reset";

const validToken = "A".repeat(PASSWORD_RESET_TOKEN_LENGTH);

describe("password reset token", () => {
  it("uses the shared 32-byte token and SHA-256 wrapper", () => {
    const { rawToken, tokenHash } = createPasswordResetToken();

    expect(rawToken).toHaveLength(PASSWORD_RESET_TOKEN_LENGTH);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(rawToken, "base64url")).toHaveLength(32);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPasswordResetToken(rawToken)).toBe(tokenHash);
  });

  it("uses an exact 30-minute TTL", () => {
    const now = new Date("2026-07-22T00:00:00.000Z");

    expect(createPasswordResetExpiry(now).getTime()).toBe(
      now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS
    );
    expect(PASSWORD_RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000);
  });

  it.each([
    "",
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}密`,
    ` ${"A".repeat(42)}`
  ])("rejects invalid token values", (token) => {
    expect(hashPasswordResetToken(token)).toBeNull();
    expect(() =>
      buildPasswordResetUrl("https://app.example.com", token)
    ).toThrow("PASSWORD_RESET_TOKEN_INVALID");
  });
});

describe("password reset URL", () => {
  it("builds /reset-password with the token search parameter", () => {
    const built = buildPasswordResetUrl("https://app.example.com", validToken);
    const parsed = new URL(built);

    expect(parsed.origin).toBe("https://app.example.com");
    expect(parsed.pathname).toBe("/reset-password");
    expect(parsed.searchParams.get("token")).toBe(validToken);
  });

  it("uses the same trusted-origin rules as email verification", () => {
    const trustedOrigins = [
      "https://app.example.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000"
    ];

    for (const publicWebUrl of trustedOrigins) {
      expect(buildPasswordResetUrl(publicWebUrl, validToken)).toBe(
        buildEmailVerificationUrl(publicWebUrl, validToken).replace(
          "/verify-email",
          "/reset-password"
        )
      );
    }
  });

  it.each([
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com?next=/reset-password",
    "https://example.com#fragment"
  ])("rejects an untrusted public URL: %s", (publicWebUrl) => {
    expect(() => buildPasswordResetUrl(publicWebUrl, validToken)).toThrow(
      "PUBLIC_WEB_URL_INVALID"
    );
  });

  it("keeps production and development origin validation with the existing normalizer", () => {
    const productionOrigin = normalizePublicWebUrl(
      "https://app.example.com",
      "production"
    );
    const developmentOrigin = normalizePublicWebUrl(
      "http://localhost:3000",
      "development"
    );

    expect(new URL(buildPasswordResetUrl(productionOrigin, validToken)).origin).toBe(
      productionOrigin
    );
    expect(new URL(buildPasswordResetUrl(developmentOrigin, validToken)).origin).toBe(
      developmentOrigin
    );
    expect(() =>
      normalizePublicWebUrl("http://localhost:3000", "production")
    ).toThrow("PUBLIC_WEB_URL_INVALID");
  });
});

describe("email verification compatibility", () => {
  it("retains its 24-hour TTL and URL path", () => {
    const now = new Date("2026-07-22T00:00:00.000Z");
    const emailUrl = buildEmailVerificationUrl(
      "https://app.example.com",
      validToken
    );

    expect(createEmailVerificationExpiry(now).getTime()).toBe(
      now.getTime() + EMAIL_VERIFICATION_TOKEN_TTL_MS
    );
    expect(EMAIL_VERIFICATION_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(new URL(emailUrl).pathname).toBe("/verify-email");
    expect(hashEmailVerificationToken(validToken)).toBe(
      hashPasswordResetToken(validToken)
    );
  });
});
