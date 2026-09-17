import type { AuthUser } from "@ai-aggregate/shared";
import { describe, expect, it } from "vitest";
import { generateNickname, getUserDisplayName, getUserSeed } from "./user-identity";

describe("user-identity", () => {
  describe("getUserSeed", () => {
    it("returns user.id when available", () => {
      const user: AuthUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        role: "USER",
        credits: 100
      };
      expect(getUserSeed(user)).toBe("user-1");
    });

    it("falls back to email when id is empty", () => {
      const user: AuthUser = {
        id: "",
        email: "fallback@example.com",
        name: "Test",
        role: "USER",
        credits: 100
      };
      expect(getUserSeed(user)).toBe("fallback@example.com");
    });

    it("falls back to 'user' when all are empty", () => {
      const user: AuthUser = {
        id: "",
        email: "",
        name: "Test",
        role: "USER",
        credits: 100
      };
      expect(getUserSeed(user)).toBe("user");
    });
  });

  describe("generateNickname", () => {
    it("produces stable Chinese nickname for same seed", () => {
      const n1 = generateNickname("user-1", "zh-CN");
      const n2 = generateNickname("user-1", "zh-CN");
      expect(n1).toBe(n2);
    });

    it("produces stable English nickname for same seed", () => {
      const n1 = generateNickname("user-1", "en-US");
      const n2 = generateNickname("user-1", "en-US");
      expect(n1).toBe(n2);
    });

    it("produces different nicknames for different seeds", () => {
      const n1 = generateNickname("user-1", "zh-CN");
      const n2 = generateNickname("user-2", "zh-CN");
      expect(n1).not.toBe(n2);
    });

    it("zh-CN nickname contains Chinese characters and suffix", () => {
      const nickname = generateNickname("user-1", "zh-CN");
      expect(nickname).toMatch(/\p{Script=Han}/u);
      expect(nickname).toMatch(/\d{2}$/);
    });

    it("en-US nickname contains English words and suffix", () => {
      const nickname = generateNickname("user-1", "en-US");
      expect(nickname).not.toMatch(/\p{Script=Han}/u);
      expect(nickname).toMatch(/\d{2}$/);
    });

    it("does not contain email prefix", () => {
      const nickname = generateNickname("testuser@example.com", "zh-CN");
      expect(nickname).not.toContain("testuser");
    });

    it("same seed in zh-CN and en-US use same index positions", () => {
      const zh = generateNickname("stable-seed", "zh-CN");
      const en = generateNickname("stable-seed", "en-US");
      const zhSuffix = zh.match(/(\d{2})$/)?.[1];
      const enSuffix = en.match(/(\d{2})$/)?.[1];
      expect(zhSuffix).toBe(enSuffix);
    });

    it("does not exceed ~12 Chinese characters", () => {
      const nickname = generateNickname("user-1", "zh-CN");
      expect(nickname.length).toBeLessThanOrEqual(15);
    });
  });

  describe("getUserDisplayName", () => {
    it("uses user.name when available", () => {
      const user: AuthUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Real Name",
        role: "USER",
        credits: 100
      };
      expect(getUserDisplayName(user, "zh-CN")).toBe("Real Name");
    });

    it("generates nickname when name is missing", () => {
      const user: AuthUser = {
        id: "user-1",
        email: "test@example.com",
        name: undefined,
        role: "USER",
        credits: 100
      };
      const displayName = getUserDisplayName(user, "zh-CN");
      expect(displayName).not.toContain("test");
      expect(displayName).not.toContain("example");
    });

    it("generates nickname when name is empty string", () => {
      const user: AuthUser = {
        id: "user-1",
        email: "test@example.com",
        name: "",
        role: "USER",
        credits: 100
      };
      const displayName = getUserDisplayName(user, "en-US");
      expect(displayName).not.toContain("test");
    });

    it("returns stable nickname for the same user", () => {
      const user: AuthUser = {
        id: "user-stable",
        email: "stable@example.com",
        name: undefined,
        role: "USER",
        credits: 100
      };
      const n1 = getUserDisplayName(user, "zh-CN");
      const n2 = getUserDisplayName(user, "zh-CN");
      expect(n1).toBe(n2);
    });
  });
});
