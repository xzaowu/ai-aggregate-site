import { describe, expect, it } from "vitest";
import { resolveRateLimitConfig } from "../src/rate-limit";

describe("resolveRateLimitConfig", () => {
  it("defaults production to Redis and non-production to memory", () => {
    expect(resolveRateLimitConfig({ NODE_ENV: "production", REDIS_URL: "redis://localhost" }).backend).toBe("redis");
    expect(resolveRateLimitConfig({ NODE_ENV: "test" }).backend).toBe("memory");
    expect(resolveRateLimitConfig({ NODE_ENV: "development" }).backend).toBe("memory");
  });

  it("forbids memory in production and requires URL for Redis", () => {
    expect(() => resolveRateLimitConfig({ NODE_ENV: "production", RATE_LIMIT_BACKEND: "memory" })).toThrow("forbidden");
    expect(() => resolveRateLimitConfig({ NODE_ENV: "production" })).toThrow("REDIS_URL");
    expect(() => resolveRateLimitConfig({ NODE_ENV: "development", RATE_LIMIT_BACKEND: "redis" })).toThrow("REDIS_URL");
  });

  it("allows redis and rediss protocols and rejects others safely", () => {
    expect(resolveRateLimitConfig({ RATE_LIMIT_BACKEND: "redis", REDIS_URL: "redis://localhost" }).backend).toBe("redis");
    expect(resolveRateLimitConfig({ RATE_LIMIT_BACKEND: "redis", REDIS_URL: "rediss://localhost" }).backend).toBe("redis");
    const credential = "do-not-leak";
    expect(() => resolveRateLimitConfig({ RATE_LIMIT_BACKEND: "redis", REDIS_URL: `http://user:${credential}@localhost` })).toThrow("protocol");
    try {
      resolveRateLimitConfig({ RATE_LIMIT_BACKEND: "redis", REDIS_URL: `http://user:${credential}@localhost` });
    } catch (error) {
      expect(String(error)).not.toContain(credential);
    }
  });

  it.each(["other", "MEMORY", " redis "]) ("rejects invalid backend %s", (backend) => {
    if (backend === " redis ") {
      expect(resolveRateLimitConfig({ RATE_LIMIT_BACKEND: backend, REDIS_URL: "redis://localhost" }).backend).toBe("redis");
      return;
    }
    expect(() => resolveRateLimitConfig({ RATE_LIMIT_BACKEND: backend })).toThrow("RATE_LIMIT_BACKEND");
  });

  it.each(["", "has space", "has:colon", "slash/value", "a".repeat(33)])("rejects invalid prefix %s", (prefix) => {
    expect(() => resolveRateLimitConfig({ REDIS_KEY_PREFIX: prefix })).toThrow("REDIS_KEY_PREFIX");
  });

  it.each(["499", "30001", "1.5", "abc"])("rejects invalid timeout %s", (timeout) => {
    expect(() => resolveRateLimitConfig({ REDIS_CONNECT_TIMEOUT_MS: timeout })).toThrow("REDIS_CONNECT_TIMEOUT_MS");
  });

  it("uses validated defaults", () => {
    expect(resolveRateLimitConfig({})).toEqual({
      backend: "memory", redisKeyPrefix: "aiagg", redisConnectTimeoutMs: 5000
    });
  });
});
