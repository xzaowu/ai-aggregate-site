import { describe, expect, it } from "vitest";
import {
  ConcurrencyLimiterUnavailableError,
  createInMemoryConcurrencyLimiter
} from "../src/concurrency";

describe("in-memory concurrency limiter", () => {
  it("enforces a limit of one and releases for the next request", async () => {
    const limiter = createInMemoryConcurrencyLimiter({ now: () => 1_000 });
    const first = await limiter.acquire("chat:user:u1", { limit: 1, leaseMs: 1_000 });
    const blocked = await limiter.acquire("chat:user:u1", { limit: 1, leaseMs: 1_000 });

    expect(first.acquired).toBe(true);
    expect(blocked).toEqual({ acquired: false, retryAfterMs: 1_000 });
    await limiter.release(first.lease!);
    expect((await limiter.acquire("chat:user:u1", { limit: 1, leaseMs: 1_000 })).acquired).toBe(true);
    await limiter.close();
  });

  it("expires leases, isolates keys, renews known tokens, and rejects unknown tokens", async () => {
    let now = 1_000;
    const limiter = createInMemoryConcurrencyLimiter({ now: () => now });
    const first = await limiter.acquire("chat:user:u1", { limit: 1, leaseMs: 1_000 });
    expect((await limiter.acquire("chat:user:u2", { limit: 1, leaseMs: 1_000 })).acquired).toBe(true);
    now = 1_500;
    const renewed = await limiter.renew(first.lease!, 2_000);
    expect(renewed.expiresAt).toBe(3_500);
    now = 3_501;
    expect((await limiter.acquire("chat:user:u1", { limit: 1, leaseMs: 1_000 })).acquired).toBe(true);
    await expect(limiter.renew(first.lease!, 1_000)).rejects.toBeInstanceOf(
      ConcurrencyLimiterUnavailableError
    );
    await limiter.close();
  });

  it("supports idempotent release and close, then fails closed", async () => {
    const limiter = createInMemoryConcurrencyLimiter({ now: () => 1_000 });
    const lease = (await limiter.acquire("key", { limit: 1, leaseMs: 1_000 })).lease!;
    await limiter.release(lease);
    await limiter.release(lease);
    await limiter.close();
    await limiter.close();
    await expect(limiter.acquire("key", { limit: 1, leaseMs: 1_000 })).rejects.toBeInstanceOf(
      ConcurrencyLimiterUnavailableError
    );
    await expect(limiter.renew(lease, 1_000)).rejects.toBeInstanceOf(
      ConcurrencyLimiterUnavailableError
    );
  });

  it.each([
    ["", { limit: 1, leaseMs: 1_000 }],
    ["key", { limit: 0, leaseMs: 1_000 }],
    ["key", { limit: 1.5, leaseMs: 1_000 }],
    ["key", { limit: 1, leaseMs: 0 }],
    ["key", { limit: 1, leaseMs: 1.5 }]
  ])("rejects invalid acquire input", async (key, options) => {
    const limiter = createInMemoryConcurrencyLimiter({ now: () => 1_000 });
    await expect(limiter.acquire(key, options)).rejects.toThrow();
    await limiter.close();
  });
});
