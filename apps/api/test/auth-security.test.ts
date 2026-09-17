import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import {
  createJwt,
  hashPassword,
  validatePasswordForSet,
  verifyJwt,
  verifyPasswordWithTimingProtection
} from "../src/auth";

const JWT_SECRET = "auth-security-test-secret";

function createSignedToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const unsigned = `${header}.${encodedPayload}`;
  const signature = createHmac("sha256", JWT_SECRET)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) {
    throw new Error("TEST_JWT_PAYLOAD_MISSING");
  }

  const parsed: unknown = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("TEST_JWT_PAYLOAD_INVALID");
  }
  return parsed as Record<string, unknown>;
}

describe("auth security", () => {
  it("writes sessionVersion 0 into a new JWT", () => {
    const payload = decodeJwtPayload(createJwt("user-0", 0, JWT_SECRET));

    expect(payload.sv).toBe(0);
  });

  it("writes a non-zero sessionVersion into a new JWT", () => {
    const payload = decodeJwtPayload(createJwt("user-7", 7, JWT_SECRET));

    expect(payload.sv).toBe(7);
  });

  it("returns userId and sessionVersion for a valid JWT", () => {
    const token = createJwt("user-valid", 13, JWT_SECRET);

    expect(verifyJwt(token, JWT_SECRET)).toEqual({
      userId: "user-valid",
      sessionVersion: 13
    });
  });

  it.each([
    ["a missing sessionVersion", { sub: "user", exp: 4_102_444_800 }],
    ["a string sessionVersion", { sub: "user", sv: "0", exp: 4_102_444_800 }],
    ["a negative sessionVersion", { sub: "user", sv: -1, exp: 4_102_444_800 }],
    ["a fractional sessionVersion", { sub: "user", sv: 0.5, exp: 4_102_444_800 }],
    [
      "an unsafe sessionVersion",
      { sub: "user", sv: Number.MAX_SAFE_INTEGER + 1, exp: 4_102_444_800 }
    ]
  ])("rejects JWTs with %s", (_label, payload) => {
    expect(verifyJwt(createSignedToken(payload), JWT_SECRET)).toBeNull();
  });

  it("rejects expired JWTs", () => {
    expect(
      verifyJwt(
        createSignedToken({
          sub: "user",
          sv: 0,
          exp: Math.floor(Date.now() / 1000) - 1
        }),
        JWT_SECRET
      )
    ).toBeNull();
  });

  it("rejects JWTs with an invalid signature", () => {
    const token = createJwt("user", 0, JWT_SECRET);
    const replacement = token.endsWith("A") ? "B" : "A";
    const invalidSignature = `${token.slice(0, -1)}${replacement}`;

    expect(verifyJwt(invalidSignature, JWT_SECRET)).toBeNull();
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejects an invalid sessionVersion when creating a JWT: %s",
    (sessionVersion) => {
      expect(() => createJwt("user", sessionVersion, JWT_SECRET)).toThrow(
        TypeError
      );
    }
  );

  it("accepts eight ASCII code points", () => {
    expect(validatePasswordForSet("password")).toBe("VALID");
  });

  it("rejects seven code points", () => {
    expect(validatePasswordForSet("pass123")).toBe("TOO_SHORT");
  });

  it("counts multibyte passwords by code point", () => {
    expect(validatePasswordForSet("😀😀😀😀😀😀😀😀")).toBe("VALID");
  });

  it("accepts exactly 72 UTF-8 bytes", () => {
    expect(validatePasswordForSet("密".repeat(24))).toBe("VALID");
  });

  it("rejects passwords over 72 UTF-8 bytes", () => {
    expect(validatePasswordForSet("密".repeat(25))).toBe("TOO_LONG");
  });

  it("does not trim password input", () => {
    expect(validatePasswordForSet("  pass12 ")).toBe("VALID");
  });

  it("accepts eight spaces", () => {
    expect(validatePasswordForSet("        ")).toBe("VALID");
  });

  it("rejects a non-string password", () => {
    expect(validatePasswordForSet(null)).toBe("INVALID_TYPE");
  });

  it("verifies a real password hash", async () => {
    const passwordHash = await hashPassword("password123");

    await expect(
      verifyPasswordWithTimingProtection("password123", passwordHash)
    ).resolves.toBe(true);
  });

  it("uses the fixed dummy hash and returns false when no user hash exists", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    try {
      await expect(
        verifyPasswordWithTimingProtection("password123", null)
      ).resolves.toBe(false);
      expect(compare).toHaveBeenCalledOnce();
      const dummyHash = compare.mock.calls[0]?.[1];
      expect(dummyHash).toMatch(/^\$2[aby]\$12\$/);
      expect(bcrypt.getRounds(dummyHash ?? "")).toBe(12);
    } finally {
      compare.mockRestore();
    }
  });

  it("returns false even when an input matches the dummy hash", async () => {
    await expect(
      verifyPasswordWithTimingProtection("s4-a2-fixed-dummy-password", null)
    ).resolves.toBe(false);
  });

  it("does not dynamically generate a dummy hash while verifying", async () => {
    const hash = vi.spyOn(bcrypt, "hash");
    try {
      await verifyPasswordWithTimingProtection("password123", null);
      expect(hash).not.toHaveBeenCalled();
    } finally {
      hash.mockRestore();
    }
  });

  it("allows callers to reject a password over 72 bytes before bcrypt", () => {
    const password = "密".repeat(25);

    expect(Buffer.byteLength(password, "utf8")).toBeGreaterThan(72);
    expect(validatePasswordForSet(password)).toBe("TOO_LONG");
  });
});
