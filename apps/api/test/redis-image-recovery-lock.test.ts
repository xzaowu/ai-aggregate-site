import { readFile } from "node:fs/promises";
import { describe, expect, it, vi, type MockedFunction } from "vitest";
import {
  createRedisImageRecoveryLock,
  IMAGE_RECOVERY_LOCK_RELEASE_LUA,
  type RedisImageRecoveryLockClient
} from "../src/recovery/redis-image-recovery-lock";

interface ClientFixture {
  client: RedisImageRecoveryLockClient;
  set: MockedFunction<RedisImageRecoveryLockClient["set"]>;
  eval: MockedFunction<RedisImageRecoveryLockClient["eval"]>;
  del: MockedFunction<() => Promise<number>>;
}

function createClientFixture(
  setResult: string | null = "OK",
  evalResult: unknown = 1
): ClientFixture {
  const set = vi.fn<RedisImageRecoveryLockClient["set"]>(async () => setResult);
  const evalCommand = vi.fn<RedisImageRecoveryLockClient["eval"]>(
    async () => evalResult
  );
  const del = vi.fn<() => Promise<number>>(async () => 1);
  const clientWithUnusedDel = { set, eval: evalCommand, del };
  const client: RedisImageRecoveryLockClient = clientWithUnusedDel;
  return { client, set, eval: evalCommand, del };
}

function createLock(
  fixture: ClientFixture,
  tokenFactory: () => string = () => "token-1"
) {
  return createRedisImageRecoveryLock({
    client: fixture.client,
    key: "aiagg:image-recovery",
    ttlMs: 60_000,
    tokenFactory
  });
}

async function expectErrorMessageWithoutToken(
  operation: () => Promise<unknown>,
  token: string
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  if (caught instanceof Error) expect(caught.message).not.toContain(token);
}

describe("createRedisImageRecoveryLock configuration", () => {
  const invalidKeys: Array<[string, string]> = [
    ["empty", ""],
    ["whitespace", "   "],
    ["control character", "aiagg:\nrecovery"],
    ["overlong", "k".repeat(513)]
  ];

  it.each(invalidKeys)("rejects an %s key before Redis access", (_label, key) => {
    const fixture = createClientFixture();
    expect(() =>
      createRedisImageRecoveryLock({ client: fixture.client, key, ttlMs: 1 })
    ).toThrow(TypeError);
    expect(fixture.set).not.toHaveBeenCalled();
    expect(fixture.eval).not.toHaveBeenCalled();
  });

  const invalidTtls: Array<[string, number]> = [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["over maximum", 24 * 60 * 60 * 1000 + 1]
  ];

  it.each(invalidTtls)("rejects a %s ttl before Redis access", (_label, ttlMs) => {
    const fixture = createClientFixture();
    expect(() =>
      createRedisImageRecoveryLock({
        client: fixture.client,
        key: "aiagg:image-recovery",
        ttlMs
      })
    ).toThrow(TypeError);
    expect(fixture.set).not.toHaveBeenCalled();
    expect(fixture.eval).not.toHaveBeenCalled();
  });

  it("preserves the caller-provided key", async () => {
    const fixture = createClientFixture();
    const lock = createRedisImageRecoveryLock({
      client: fixture.client,
      key: "  aiagg:image-recovery  ",
      ttlMs: 1,
      tokenFactory: () => "token"
    });
    await lock.acquire();
    expect(fixture.set).toHaveBeenCalledWith(
      "  aiagg:image-recovery  ",
      "token",
      { NX: true, PX: 1 }
    );
  });
});

describe("Redis image recovery lock acquire", () => {
  it("uses SET with the exact key, token, NX, and PX ttl", async () => {
    const fixture = createClientFixture();
    const lock = createLock(fixture, () => "unique-token");
    const lease = await lock.acquire();
    expect(lease).not.toBeNull();
    expect(fixture.set).toHaveBeenCalledWith(
      "aiagg:image-recovery",
      "unique-token",
      { NX: true, PX: 60_000 }
    );
  });

  it("returns an independent lease when SET returns OK", async () => {
    const fixture = createClientFixture();
    const lock = createLock(fixture);
    const first = await lock.acquire();
    const second = await lock.acquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it("returns null when SET returns null", async () => {
    const fixture = createClientFixture(null);
    await expect(createLock(fixture).acquire()).resolves.toBeNull();
    expect(fixture.eval).not.toHaveBeenCalled();
  });

  it("propagates a SET failure unchanged", async () => {
    const fixture = createClientFixture();
    const failure = new Error("redis unavailable");
    fixture.set.mockRejectedValueOnce(failure);
    await expect(createLock(fixture).acquire()).rejects.toBe(failure);
  });

  it("generates a fresh token for every acquire", async () => {
    const fixture = createClientFixture();
    let tokenNumber = 0;
    const tokenFactory = vi.fn(() => {
      tokenNumber += 1;
      return `token-${tokenNumber}`;
    });
    const lock = createLock(fixture, tokenFactory);
    await lock.acquire();
    await lock.acquire();
    expect(tokenFactory).toHaveBeenCalledTimes(2);
    expect(fixture.set.mock.calls).toEqual([
      ["aiagg:image-recovery", "token-1", { NX: true, PX: 60_000 }],
      ["aiagg:image-recovery", "token-2", { NX: true, PX: 60_000 }]
    ]);
  });

  it.each(["", "   ", "token\u0000value"])(
    "rejects an invalid generated token without calling SET",
    async (token) => {
      const fixture = createClientFixture();
      await expect(createLock(fixture, () => token).acquire()).rejects.toThrow(TypeError);
      expect(fixture.set).not.toHaveBeenCalled();
    }
  );

  it("does not call SET when token generation throws", async () => {
    const fixture = createClientFixture();
    const failure = new Error("token generation failed");
    const lock = createLock(fixture, () => {
      throw failure;
    });
    await expect(lock.acquire()).rejects.toBe(failure);
    expect(fixture.set).not.toHaveBeenCalled();
  });

  it("rejects an unknown SET response without exposing the token", async () => {
    const fixture = createClientFixture("UNEXPECTED");
    const token = "secret-token-value";
    await expectErrorMessageWithoutToken(
      () => createLock(fixture, () => token).acquire(),
      token
    );
  });
});

describe("Redis image recovery lock release", () => {
  it("uses atomic Lua compare-and-delete with the matching key and token", async () => {
    const fixture = createClientFixture();
    const lease = await createLock(fixture, () => "lease-token").acquire();
    expect(lease).not.toBeNull();
    if (lease === null) return;
    await lease.release();
    expect(IMAGE_RECOVERY_LOCK_RELEASE_LUA).toContain(
      'redis.call("GET", KEYS[1]) == ARGV[1]'
    );
    expect(IMAGE_RECOVERY_LOCK_RELEASE_LUA).toContain(
      'redis.call("DEL", KEYS[1])'
    );
    expect(fixture.eval).toHaveBeenCalledWith(IMAGE_RECOVERY_LOCK_RELEASE_LUA, {
      keys: ["aiagg:image-recovery"],
      arguments: ["lease-token"]
    });
  });

  it.each([1, 1n, "1"])("accepts a successful EVAL result", async (result) => {
    const fixture = createClientFixture("OK", result);
    const lease = await createLock(fixture).acquire();
    if (lease === null) throw new Error("expected lease");
    await expect(lease.release()).resolves.toBeUndefined();
  });

  it.each([0, 0n, "0"])("treats a safe no-op EVAL result as success", async (result) => {
    const fixture = createClientFixture("OK", result);
    const lease = await createLock(fixture).acquire();
    if (lease === null) throw new Error("expected lease");
    await expect(lease.release()).resolves.toBeUndefined();
    expect(fixture.del).not.toHaveBeenCalled();
  });

  it("does not issue DEL when the token does not match", async () => {
    const fixture = createClientFixture("OK", 0);
    const lease = await createLock(fixture, () => "stale-token").acquire();
    if (lease === null) throw new Error("expected lease");
    await lease.release();
    expect(fixture.eval).toHaveBeenCalledTimes(1);
    expect(fixture.del).not.toHaveBeenCalled();
  });

  it("propagates an EVAL failure unchanged", async () => {
    const fixture = createClientFixture();
    const failure = new Error("eval unavailable");
    fixture.eval.mockRejectedValueOnce(failure);
    const lease = await createLock(fixture).acquire();
    if (lease === null) throw new Error("expected lease");
    await expect(lease.release()).rejects.toBe(failure);
  });

  it("runs EVAL only once across repeated release calls", async () => {
    const fixture = createClientFixture();
    const lease = await createLock(fixture).acquire();
    if (lease === null) throw new Error("expected lease");
    const first = lease.release();
    const second = lease.release();
    expect(first).toBe(second);
    await first;
    await lease.release();
    expect(fixture.eval).toHaveBeenCalledTimes(1);
  });

  it("runs EVAL only once for concurrent release calls", async () => {
    const fixture = createClientFixture();
    let resolveEval: ((value: unknown) => void) | undefined;
    const evalPromise = new Promise<unknown>((resolve) => {
      resolveEval = resolve;
    });
    fixture.eval.mockReturnValueOnce(evalPromise);
    const lease = await createLock(fixture).acquire();
    if (lease === null) throw new Error("expected lease");
    const first = lease.release();
    const second = lease.release();
    expect(fixture.eval).toHaveBeenCalledTimes(1);
    if (resolveEval === undefined) throw new Error("missing eval resolver");
    resolveEval(1);
    await Promise.all([first, second]);
    expect(fixture.eval).toHaveBeenCalledTimes(1);
  });

  it("does not retry EVAL after a failed release", async () => {
    const fixture = createClientFixture();
    const failure = new Error("eval failed once");
    fixture.eval.mockRejectedValueOnce(failure);
    const lease = await createLock(fixture).acquire();
    if (lease === null) throw new Error("expected lease");
    const first = lease.release();
    const second = lease.release();
    expect(first).toBe(second);
    await expect(first).rejects.toBe(failure);
    await expect(lease.release()).rejects.toBe(failure);
    expect(fixture.eval).toHaveBeenCalledTimes(1);
  });

  it("keeps each lease bound to its own token", async () => {
    const fixture = createClientFixture();
    let tokenNumber = 0;
    const lock = createLock(fixture, () => {
      tokenNumber += 1;
      return `token-${tokenNumber}`;
    });
    const first = await lock.acquire();
    const second = await lock.acquire();
    if (first === null || second === null) throw new Error("expected leases");
    await first.release();
    await second.release();
    expect(fixture.eval.mock.calls).toEqual([
      [IMAGE_RECOVERY_LOCK_RELEASE_LUA, {
        keys: ["aiagg:image-recovery"],
        arguments: ["token-1"]
      }],
      [IMAGE_RECOVERY_LOCK_RELEASE_LUA, {
        keys: ["aiagg:image-recovery"],
        arguments: ["token-2"]
      }]
    ]);
  });

  it.each([2, -1, 2n, "2", "01", null, true, [1]])(
    "rejects an unknown EVAL result without exposing the token",
    async (result) => {
      const fixture = createClientFixture("OK", result);
      const token = "private-release-token";
      const lease = await createLock(fixture, () => token).acquire();
      if (lease === null) throw new Error("expected lease");
      await expectErrorMessageWithoutToken(() => lease.release(), token);
    }
  );
});

describe("Redis image recovery lock boundaries", () => {
  it("does not write to console", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fixture = createClientFixture();
      const lease = await createLock(fixture).acquire();
      if (lease === null) throw new Error("expected lease");
      await lease.release();
      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("contains no Store, Redis client lifecycle, environment, or network access", async () => {
    const source = await readFile(
      new URL("../src/recovery/redis-image-recovery-lock.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/from ["']redis["']/u);
    expect(source).not.toContain("createClient");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("CreditReservationStore");
    expect(source).not.toMatch(/\b(fetch|connect|ping|quit|disconnect)\s*\(/u);
  });
});
