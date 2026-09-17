import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createAuthToken,
  createAuthTokenExpiry,
  hashAuthToken
} from "../src/auth-token";

const validToken = "A".repeat(43);

describe("auth token primitive", () => {
  it("creates a 32-byte, 43-character base64url token with a lowercase SHA-256 hash", () => {
    const { rawToken, tokenHash } = createAuthToken();

    expect(rawToken).toHaveLength(43);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(rawToken, "base64url")).toHaveLength(32);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).toBe(
      createHash("sha256").update(rawToken).digest("hex")
    );
  });

  it("returns the same hash for the same token and distinct hashes for distinct tokens", () => {
    const otherToken = "B".repeat(43);

    expect(hashAuthToken(validToken)).toBe(hashAuthToken(validToken));
    expect(hashAuthToken(validToken)).not.toBe(hashAuthToken(otherToken));
  });

  it.each([
    ["non-string", null],
    ["empty", ""],
    ["42 characters", "A".repeat(42)],
    ["44 characters", "A".repeat(44)],
    ["invalid character", `${"A".repeat(42)}!`],
    ["Unicode", `${"A".repeat(42)}密`],
    ["leading whitespace", ` ${"A".repeat(42)}`],
    ["trailing whitespace", `${"A".repeat(42)} `]
  ])("returns null for %s", (_label, input) => {
    expect(hashAuthToken(input)).toBeNull();
  });
});

describe("auth token expiry", () => {
  it("adds a valid TTL without mutating the input date", () => {
    const now = new Date("2026-07-22T00:00:00.000Z");
    const expiry = createAuthTokenExpiry(now, 30 * 60 * 1000);

    expect(expiry.getTime()).toBe(now.getTime() + 30 * 60 * 1000);
    expect(now.getTime()).toBe(Date.parse("2026-07-22T00:00:00.000Z"));
  });

  it("rejects invalid dates and TTL values without exposing sensitive values", () => {
    const rawToken = "sensitive-raw-token";
    const tokenHash = "sensitive-token-hash";
    const errorMessage = (callback: () => Date): string => {
      try {
        callback();
      } catch (error) {
        return error instanceof Error ? error.message : "NON_ERROR_THROWN";
      }
      throw new Error("TEST_EXPECTED_AUTH_TOKEN_EXPIRY_ERROR");
    };

    const invalidDateMessage = errorMessage(() =>
      createAuthTokenExpiry(new Date("invalid"), 1)
    );
    expect(invalidDateMessage).toBe("AUTH_TOKEN_EXPIRY_INVALID_DATE");
    expect(invalidDateMessage).not.toContain(rawToken);
    expect(invalidDateMessage).not.toContain(tokenHash);

    for (const ttlMs of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createAuthTokenExpiry(new Date("2026-07-22T00:00:00.000Z"), ttlMs)
      ).toThrow("AUTH_TOKEN_EXPIRY_INVALID_TTL");
    }
  });

  it("rejects expiry arithmetic outside the valid Date range", () => {
    const nearMaximumDate = new Date(8_640_000_000_000_000 - 1);

    expect(() => createAuthTokenExpiry(nearMaximumDate, 2)).toThrow(
      "AUTH_TOKEN_EXPIRY_INVALID_DATE"
    );
  });
});
