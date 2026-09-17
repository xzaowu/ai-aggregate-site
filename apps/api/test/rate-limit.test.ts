import { describe, expect, it, vi } from "vitest";
import { createInMemoryRateLimiter } from "../src/rate-limit";

describe("InMemoryRateLimiter", () => {
  it("uses independent fixed windows and reports remaining accurately", async () => {
    let now = 1_000;
    const limiter = createInMemoryRateLimiter({ now: () => now });
    await expect(limiter.consume("a", { limit: 2, windowMs: 1_000 })).resolves.toEqual({
      allowed: true, limit: 2, remaining: 1, retryAfterMs: 1_000
    });
    await expect(limiter.consume("a", { limit: 2, windowMs: 1_000 })).resolves.toMatchObject({
      allowed: true, remaining: 0
    });
    await expect(limiter.consume("a", { limit: 2, windowMs: 1_000 })).resolves.toMatchObject({
      allowed: false, remaining: 0, retryAfterMs: 1_000
    });
    await expect(limiter.consume("b", { limit: 2, windowMs: 1_000 })).resolves.toMatchObject({
      allowed: true, remaining: 1
    });
    now = 2_000;
    await expect(limiter.consume("a", { limit: 2, windowMs: 1_000 })).resolves.toMatchObject({
      allowed: true, remaining: 1
    });
    await limiter.close();
  });

  it("reports a stable retry interval within the window", async () => {
    let now = 5_000;
    const limiter = createInMemoryRateLimiter({ now: () => now });
    await limiter.consume("key", { limit: 1, windowMs: 500 });
    now = 5_499;
    await expect(limiter.consume("key", { limit: 1, windowMs: 500 })).resolves.toMatchObject({
      allowed: false, retryAfterMs: 1
    });
    await limiter.close();
  });

  it.each([
    [{ limit: 0, windowMs: 1 }, "limit"],
    [{ limit: 1.5, windowMs: 1 }, "limit"],
    [{ limit: 1, windowMs: 0 }, "windowMs"],
    [{ limit: 1, windowMs: 1.5 }, "windowMs"]
  ])("rejects invalid policies", async (policy, message) => {
    const limiter = createInMemoryRateLimiter();
    await expect(limiter.consume("key", policy)).rejects.toThrow(message);
    await limiter.close();
  });

  it("rejects an empty key", async () => {
    const limiter = createInMemoryRateLimiter();
    await expect(limiter.consume("  ", { limit: 1, windowMs: 1 })).rejects.toThrow("key");
    await limiter.close();
  });

  it("supports reset and idempotent close", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const limiter = createInMemoryRateLimiter();
    await limiter.consume("key", { limit: 1, windowMs: 10_000 });
    limiter.reset();
    await expect(limiter.consume("key", { limit: 1, windowMs: 10_000 })).resolves.toMatchObject({ allowed: true });
    await limiter.close();
    await limiter.close();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });
});
