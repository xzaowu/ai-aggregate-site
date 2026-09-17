import { describe, expect, it, vi } from "vitest";
import {
  FIXED_WINDOW_LUA,
  RateLimiterUnavailableError,
  RedisRateLimiter,
  type RedisRateLimitClient
} from "../src/rate-limit";

function createFakeClient(overrides: Partial<RedisRateLimitClient> = {}): RedisRateLimitClient {
  return {
    isReady: true,
    eval: vi.fn(async () => [1, 1_000]),
    quit: vi.fn(async () => "OK"),
    destroy: vi.fn(),
    ...overrides
  };
}

describe("RedisRateLimiter", () => {
  it("uses one atomic EVAL with the namespaced logical key", async () => {
    const client = createFakeClient();
    const limiter = new RedisRateLimiter(client, "aiagg");
    await expect(limiter.consume("login:ip:127.0.0.1", { limit: 2, windowMs: 5_000 })).resolves.toEqual({
      allowed: true, limit: 2, remaining: 1, retryAfterMs: 1_000
    });
    expect(client.eval).toHaveBeenCalledWith(FIXED_WINDOW_LUA, {
      keys: ["aiagg:ratelimit:login:ip:127.0.0.1"],
      arguments: ["5000"]
    });
    expect(FIXED_WINDOW_LUA).toContain('redis.call("INCR", KEYS[1])');
    expect(FIXED_WINDOW_LUA).toContain('redis.call("PEXPIRE", KEYS[1], ARGV[1])');
    expect(FIXED_WINDOW_LUA).toContain('redis.call("PTTL", KEYS[1])');
  });

  it("clamps remaining and rejects after the limit", async () => {
    const limiter = new RedisRateLimiter(createFakeClient({ eval: vi.fn(async () => [3, 0.5]) }), "prefix");
    await expect(limiter.consume("chat:user:user_1", { limit: 2, windowMs: 10 })).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    const valid = new RedisRateLimiter(createFakeClient({ eval: vi.fn(async () => [3, 1]) }), "prefix");
    await expect(valid.consume("chat:user:user_1", { limit: 2, windowMs: 10 })).resolves.toEqual({
      allowed: false, limit: 2, remaining: 0, retryAfterMs: 1
    });
  });

  it.each([null, [], [1], [0, 100], [1, -1], ["1", 100]])("fails closed for invalid Redis replies", async (reply) => {
    const limiter = new RedisRateLimiter(createFakeClient({ eval: vi.fn(async () => reply) }), "prefix");
    await expect(limiter.consume("key", { limit: 1, windowMs: 100 })).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it("fails closed when not ready or EVAL fails without leaking errors", async () => {
    const notReady = new RedisRateLimiter(createFakeClient({ isReady: false }), "prefix");
    await expect(notReady.consume("key", { limit: 1, windowMs: 100 })).rejects.toThrow("rate limiter unavailable");
    const failing = new RedisRateLimiter(createFakeClient({ eval: vi.fn(async () => { throw new Error("redis://user:secret@host"); }) }), "prefix");
    const error = await failing.consume("key", { limit: 1, windowMs: 100 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimiterUnavailableError);
    expect(String(error)).not.toContain("secret");
  });

  it("quits once and destroys when quit fails", async () => {
    const client = createFakeClient();
    const limiter = new RedisRateLimiter(client, "prefix");
    await limiter.close();
    await limiter.close();
    expect(client.quit).toHaveBeenCalledTimes(1);

    const failingClient = createFakeClient({ quit: vi.fn(async () => { throw new Error("failure"); }) });
    await new RedisRateLimiter(failingClient, "prefix").close();
    expect(failingClient.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys an unready client on close", async () => {
    const client = createFakeClient({ isReady: false });
    await new RedisRateLimiter(client, "prefix").close();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
