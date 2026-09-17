import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TOKEN_LENGTH,
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  buildEmailVerificationUrl,
  createEmailVerificationExpiry,
  createEmailVerificationToken,
  hashEmailVerificationToken,
  normalizePublicWebUrl
} from "../src/email-verification";

const validToken = "A".repeat(EMAIL_VERIFICATION_TOKEN_LENGTH);

describe("email verification token", () => {
  it("creates a 43-character base64url token and 64-character hash", () => {
    const { rawToken, tokenHash } = createEmailVerificationToken();

    expect(rawToken).toHaveLength(43);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).toBe(
      createHash("sha256").update(rawToken).digest("hex")
    );
    expect(tokenHash).not.toBe(rawToken);
  });

  it("creates different token values on separate calls", () => {
    expect(createEmailVerificationToken().rawToken).not.toBe(
      createEmailVerificationToken().rawToken
    );
  });

  it("hashes a legal token into the same SHA-256 value", () => {
    expect(hashEmailVerificationToken(validToken)).toBe(
      createHash("sha256").update(validToken).digest("hex")
    );
  });

  it.each([
    ["non-string", null],
    ["42 characters", "A".repeat(42)],
    ["44 characters", "A".repeat(44)],
    ["padding", `${"A".repeat(42)}=`],
    ["illegal character", `${"A".repeat(42)}!`],
    ["trimmed form", ` ${"A".repeat(42)}`]
  ])("rejects %s token input", (_label, input) => {
    expect(hashEmailVerificationToken(input)).toBeNull();
  });
});

describe("email verification TTL", () => {
  it("adds exactly 24 hours without mutating the input date", () => {
    const now = new Date("2026-07-19T00:00:00.000Z");
    const before = now.getTime();
    const expiresAt = createEmailVerificationExpiry(now);

    expect(expiresAt.getTime()).toBe(before + EMAIL_VERIFICATION_TOKEN_TTL_MS);
    expect(now.getTime()).toBe(before);
  });

  it("rejects invalid Date values", () => {
    expect(() => createEmailVerificationExpiry(new Date("invalid"))).toThrow(
      TypeError
    );
  });

  it("rejects expiry values that exceed the Date range", () => {
    const nearMaximumDate = new Date(
      8_640_000_000_000_000 - EMAIL_VERIFICATION_TOKEN_TTL_MS + 1
    );

    expect(() => createEmailVerificationExpiry(nearMaximumDate)).toThrow(
      TypeError
    );
  });

  it("never returns an invalid expiry Date", () => {
    const expiry = createEmailVerificationExpiry(
      new Date("2026-07-19T00:00:00.000Z")
    );

    expect(Number.isFinite(expiry.getTime())).toBe(true);
  });
});

describe("PUBLIC_WEB_URL normalization", () => {
  it("accepts an https origin in production", () => {
    expect(normalizePublicWebUrl("https://app.example.com", "production")).toBe(
      "https://app.example.com"
    );
  });

  it("rejects http in production", () => {
    expect(() =>
      normalizePublicWebUrl("http://localhost:3000", "production")
    ).toThrow("PUBLIC_WEB_URL_INVALID");
  });

  it("accepts localhost http in development", () => {
    expect(
      normalizePublicWebUrl("http://localhost:3000", "development")
    ).toBe("http://localhost:3000");
  });

  it("accepts 127.0.0.1 http in test", () => {
    expect(normalizePublicWebUrl("http://127.0.0.1:3000", "test")).toBe(
      "http://127.0.0.1:3000"
    );
  });

  it("accepts ::1 http in test", () => {
    expect(normalizePublicWebUrl("http://[::1]:3000", "test")).toBe(
      "http://[::1]:3000"
    );
  });

  it.each([
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com?x=1",
    "https://example.com#hash",
    "https://example.com/base",
    "javascript:alert(1)",
    "file:///tmp/test",
    "data:text/plain,hello"
  ])("rejects untrusted URL configuration %s", (input) => {
    expect(() => normalizePublicWebUrl(input, "test")).toThrow(
      "PUBLIC_WEB_URL_INVALID"
    );
  });

  it("returns a normalized origin without a trailing slash", () => {
    expect(normalizePublicWebUrl("https://example.com/", "production")).toBe(
      "https://example.com"
    );
  });

  it.each([
    " https://app.example.com",
    "https://app.example.com "
  ])("rejects PUBLIC_WEB_URL with leading or trailing whitespace", (input) => {
    expect(() => normalizePublicWebUrl(input, "production")).toThrow(
      "PUBLIC_WEB_URL_INVALID"
    );
  });
});

describe("email verification URL", () => {
  it("builds /verify-email with token in searchParams", () => {
    const built = buildEmailVerificationUrl("https://example.com", validToken);
    const parsed = new URL(built);

    expect(parsed.pathname).toBe("/verify-email");
    expect(parsed.searchParams.get("token")).toBe(validToken);
  });

  it("rejects invalid token values before URL construction", () => {
    expect(() =>
      buildEmailVerificationUrl("https://example.com", `${"A".repeat(42)}=`)
    ).toThrow("EMAIL_VERIFICATION_TOKEN_INVALID");
  });

  it("uses only the trusted public URL origin", () => {
    const built = buildEmailVerificationUrl(
      "https://trusted.example.com",
      validToken
    );

    expect(new URL(built).origin).toBe("https://trusted.example.com");
    expect(built).not.toContain("attacker.example.com");
  });

  it("is a pure builder and performs no state changes", () => {
    expect(buildEmailVerificationUrl("https://example.com", validToken)).toBe(
      `https://example.com/verify-email?token=${validToken}`
    );
  });
});
