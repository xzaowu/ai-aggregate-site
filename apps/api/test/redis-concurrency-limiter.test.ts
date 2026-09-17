import { describe, expect, it, vi, type MockedFunction } from "vitest";
import {
  CONCURRENCY_ACQUIRE_LUA,
  CONCURRENCY_RELEASE_LUA,
  CONCURRENCY_RENEW_LUA,
  ConcurrencyLimiterUnavailableError,
  RedisConcurrencyLimiter,
  type RedisConcurrencyClient
} from "../src/concurrency";

type MockedRedisConcurrencyClient = Omit<RedisConcurrencyClient, "eval" | "quit"> & {
  eval: MockedFunction<RedisConcurrencyClient["eval"]>;
  quit: MockedFunction<RedisConcurrencyClient["quit"]>;
};

function createClient(
  evalResult: unknown = [1, Date.now() + 1_000],
  isReady = true
): MockedRedisConcurrencyClient {
  const evalMock = vi.fn<RedisConcurrencyClient["eval"]>(
    async (_script, _options) => evalResult
  );
  const quitMock: MockedFunction<RedisConcurrencyClient["quit"]> = vi.fn(
    async () => undefined
  );
  return {
    isReady,
    eval: evalMock,
    quit: quitMock,
    destroy: vi.fn()
  };
}

describe("Redis concurrency limiter", () => {
  it("uses one atomic acquire EVAL with the prefixed key and random token", async () => {
    const client = createClient();
    client.eval.mockImplementation(async (script, options) => [1, Number(options.arguments[1])]);
    const limiter = new RedisConcurrencyLimiter(client, "aiagg");

    const result = await limiter.acquire("chat:user:u1", { limit: 2, leaseMs: 5_000 });

    expect(result.acquired).toBe(true);
    expect(client.eval).toHaveBeenCalledTimes(1);
    const [script, options] = client.eval.mock.calls[0]!;
    expect(script).toBe(CONCURRENCY_ACQUIRE_LUA);
    expect(options.keys).toEqual(["aiagg:concurrency:chat:user:u1"]);
    expect(options.arguments[0]).toMatch(/^\d+$/);
    expect(options.arguments[2]).toBe("2");
    expect(options.arguments[3]).toBe("5000");
    expect(options.arguments[4]).toMatch(/^[0-9a-f-]{36}$/);
    await limiter.close();
  });

  it("returns the earliest expiry retry time when the bucket is full", async () => {
    const client = createClient([0, 234]);
    const limiter = new RedisConcurrencyLimiter(client, "prefix");

    await expect(limiter.acquire("image:user:u1", { limit: 1, leaseMs: 5_000 })).resolves.toEqual({
      acquired: false,
      retryAfterMs: 234
    });
    await limiter.close();
  });

  it("uses atomic renew and release scripts", async () => {
    const client = createClient();
    client.eval
      .mockImplementationOnce(async (_script, options) => [1, Number(options.arguments[1])])
      .mockImplementationOnce(async (_script, options) => [1, Number(options.arguments[1])])
      .mockImplementationOnce(async () => 1);
    const limiter = new RedisConcurrencyLimiter(client, "prefix");
    const acquired = await limiter.acquire("chat:user:u1", { limit: 1, leaseMs: 5_000 });
    await limiter.renew(acquired.lease!, 5_000);
    await limiter.release(acquired.lease!);

    expect(client.eval.mock.calls.map(([script]) => script)).toEqual([
      CONCURRENCY_ACQUIRE_LUA,
      CONCURRENCY_RENEW_LUA,
      CONCURRENCY_RELEASE_LUA
    ]);
    await limiter.close();
  });

  it("fails closed for unavailable clients, Redis errors, and malformed replies", async () => {
    const unavailable = createClient(undefined, false);
    const unavailableLimiter = new RedisConcurrencyLimiter(unavailable, "prefix");
    await expect(unavailableLimiter.acquire("key", { limit: 1, leaseMs: 1_000 })).rejects.toBeInstanceOf(
      ConcurrencyLimiterUnavailableError
    );

    const failed = createClient();
    failed.eval.mockRejectedValue(new Error("redis://user:password@example"));
    const failedLimiter = new RedisConcurrencyLimiter(failed, "prefix");
    await expect(failedLimiter.acquire("key", { limit: 1, leaseMs: 1_000 })).rejects.toBeInstanceOf(
      ConcurrencyLimiterUnavailableError
    );

    const malformed = createClient(["bad"]);
    const malformedLimiter = new RedisConcurrencyLimiter(malformed, "prefix");
    await expect(malformedLimiter.acquire("key", { limit: 1, leaseMs: 1_000 })).rejects.toBeInstanceOf(
      ConcurrencyLimiterUnavailableError
    );
    await Promise.all([
      unavailableLimiter.close(),
      failedLimiter.close(),
      malformedLimiter.close()
    ]);
  });

  it("destroys safely when quit fails and closes idempotently", async () => {
    const client = createClient();
    client.quit.mockRejectedValue(new Error("redis quit failed"));
    const limiter = new RedisConcurrencyLimiter(client, "prefix");
    await limiter.close();
    await limiter.close();
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
