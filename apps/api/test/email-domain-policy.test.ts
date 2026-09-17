import { describe, expect, it, vi } from "vitest";
import {
  isRegistrationEmailAllowed,
  normalizeEmailDomain,
  parseDomainListSetting,
  resolveRegistrationEmailPolicy
} from "../src/security/email-domain-policy";

describe("registration email domain policy", () => {
  it("normalizes case and internationalized domains", () => {
    expect(normalizeEmailDomain(" GMAIL.COM ")).toBe("gmail.com");
    expect(normalizeEmailDomain("例子.测试")).toBe("xn--fsqu00a.xn--0zwm56d");
  });

  it("rejects unsupported domain syntax", () => {
    for (const value of ["*.gmail.com", "https://gmail.com", "a@gmail.com", "gmail.com:443"] ) {
      expect(normalizeEmailDomain(value)).toBeNull();
    }
  });

  it("requires unique valid JSON domain arrays", () => {
    expect(parseDomainListSetting('["GMAIL.COM","qq.com"]')).toEqual(["gmail.com", "qq.com"]);
    expect(() => parseDomainListSetting('["gmail.com","GMAIL.COM"]')).toThrow();
  });

  it("uses safe defaults for missing or invalid settings", () => {
    expect(resolveRegistrationEmailPolicy(new Map()).allowedDomains).toEqual(["gmail.com", "qq.com"]);
    const warn = vi.fn();
    const policy = resolveRegistrationEmailPolicy(
      new Map([["registrationAllowedDomainsJson", "not-json"]]),
      warn
    );
    expect(policy.mode).toBe("ALLOWLIST");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("uses exact allowlist matching and blocked precedence", () => {
    const policy = {
      enabled: true,
      mode: "ALLOWLIST" as const,
      allowedDomains: ["gmail.com", "qq.com"],
      blockedDomains: ["qq.com"]
    };
    expect(isRegistrationEmailAllowed("a@GMAIL.COM", policy)).toBe(true);
    expect(isRegistrationEmailAllowed("a@qq.com", policy)).toBe(false);
    expect(isRegistrationEmailAllowed("a@fake.gmail.com", policy)).toBe(false);
    expect(isRegistrationEmailAllowed("a@gmail.com.evil.example", policy)).toBe(false);
  });

  it("supports DENYLIST and ALL while still applying blocked domains", () => {
    for (const mode of ["DENYLIST", "ALL"] as const) {
      const policy = { enabled: true, mode, allowedDomains: [], blockedDomains: ["blocked.example"] };
      expect(isRegistrationEmailAllowed("a@normal.example", policy)).toBe(true);
      expect(isRegistrationEmailAllowed("a@blocked.example", policy)).toBe(false);
    }
  });
});
