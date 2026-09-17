import { describe, expect, it } from "vitest";
import { resolveTrustProxy } from "../src/security/trust-proxy";

describe("resolveTrustProxy", () => {
  it("defaults to disabled", () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
  });

  it("normalizes and deduplicates safe multi-value configuration", () => {
    expect(resolveTrustProxy(" loopback, 10.0.0.0/8, ::1, LOOPBACK ")).toEqual([
      "loopback",
      "10.0.0.0/8",
      "::1"
    ]);
  });

  it.each(["true", "*", "0.0.0.0/0", "::/0"])("rejects unsafe value %s", (value) => {
    expect(() => resolveTrustProxy(value)).toThrow(/unsafe or invalid/);
  });

  it.each(["10.0.0.0/33", "2001:db8::/129", "not-a-cidr/24"])(
    "rejects invalid CIDR %s",
    (value) => {
      expect(() => resolveTrustProxy(value)).toThrow(/unsafe or invalid/);
    }
  );
});
