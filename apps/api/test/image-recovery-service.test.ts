import { describe, expect, it, vi } from "vitest";
import {
  createImageRecoveryServiceFromEnv,
  type ImageRecoveryRedisClient,
  type ImageRecoveryRedisClientFactoryOptions
} from "../src/recovery/image-recovery-service";
import type {
  ImageRecoveryLogger,
  ImageRecoveryScheduler,
  ImageRecoverySchedulerOptions
} from "../src/recovery/image-recovery-scheduler";
import type { RedisImageRecoveryLockOptions } from "../src/recovery/redis-image-recovery-lock";
import type { CreditReservationStore } from "../src/store";

function createStore(): CreditReservationStore {
  const unused = async (): Promise<never> => {
    throw new Error("unused store method");
  };

  return {
    reserveCredits: unused,
    createImageTaskWithReservation: unused,
    settleCreditReservation: unused,
    releaseCreditReservation: unused,
    releaseExpiredCreditReservations: unused,
    async recoverExpiredImageReservations() {
      return { scanned: 0, recovered: 0, skipped: 0 };
    },
    completeImageTaskWithReservation: unused,
    failImageTaskAndReleaseReservation: unused,
    failImageTaskAndSettleReservation: unused
  };
}

function createLogger(): ImageRecoveryLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return { info, warn, error };
}

function createRedisClientHarness(events: string[] = []) {
  const connect = vi.fn(async (): Promise<void> => {
    events.push("connect");
  });
  const ping = vi.fn(async (): Promise<string> => {
    events.push("ping");
    return "PONG";
  });
  const quit = vi.fn(async (): Promise<void> => {
    events.push("quit");
  });
  const set = vi.fn(async (
    _key: string,
    _value: string,
    _options: { NX: true; PX: number }
  ): Promise<string | null> => "OK");
  const evalCommand = vi.fn(async (
    _script: string,
    _options: { keys: string[]; arguments: string[] }
  ): Promise<unknown> => 1);
  const client: ImageRecoveryRedisClient = {
    connect,
    ping,
    quit,
    set,
    eval: evalCommand
  };
  const factory = vi.fn((
    _options: ImageRecoveryRedisClientFactoryOptions
  ): ImageRecoveryRedisClient => client);

  return { client, factory, connect, ping, quit, set, evalCommand };
}

function createSchedulerHarness(events: string[] = []) {
  const start = vi.fn((): void => {
    events.push("start");
  });
  const runOnce = vi.fn(async (): Promise<void> => {});
  const stop = vi.fn(async (): Promise<void> => {
    events.push("stop");
  });
  const scheduler: ImageRecoveryScheduler = { start, runOnce, stop };
  const factory = vi.fn((
    _options: ImageRecoverySchedulerOptions
  ): ImageRecoveryScheduler => {
    events.push("scheduler");
    return scheduler;
  });

  return { factory, scheduler, start, runOnce, stop };
}

function createLockHarness(events: string[] = []) {
  const lock = {
    acquire: vi.fn(async () => null)
  };
  const factory = vi.fn((_options: RedisImageRecoveryLockOptions) => {
    events.push("lock");
    return lock;
  });

  return { factory, lock };
}

function createEnabledHarness(
  envOverrides: Partial<NodeJS.ProcessEnv> = {},
  events: string[] = []
) {
  const redis = createRedisClientHarness(events);
  const scheduler = createSchedulerHarness(events);
  const lock = createLockHarness(events);
  const logger = createLogger();
  const service = createImageRecoveryServiceFromEnv({
    env: {
      IMAGE_RECOVERY_ENABLED: "1",
      REDIS_URL: "redis://localhost:6379",
      ...envOverrides
    },
    store: createStore(),
    logger,
    redisClientFactory: redis.factory,
    schedulerFactory: scheduler.factory,
    lockFactory: lock.factory
  });

  return { service, redis, scheduler, lock, logger };
}

describe("image recovery service", () => {
  it("is disabled when IMAGE_RECOVERY_ENABLED is unset", async () => {
    const redis = createRedisClientHarness();
    const service = createImageRecoveryServiceFromEnv({
      env: {},
      store: createStore(),
      logger: createLogger(),
      redisClientFactory: redis.factory
    });

    await service.ready();
    expect(redis.factory).not.toHaveBeenCalled();
  });

  it("is disabled when IMAGE_RECOVERY_ENABLED is 0", async () => {
    const redis = createRedisClientHarness();
    const service = createImageRecoveryServiceFromEnv({
      env: { IMAGE_RECOVERY_ENABLED: "0" },
      store: createStore(),
      logger: createLogger(),
      redisClientFactory: redis.factory
    });

    await service.ready();
    expect(redis.factory).not.toHaveBeenCalled();
  });

  it("is enabled only when IMAGE_RECOVERY_ENABLED is 1", async () => {
    const harness = createEnabledHarness();
    await harness.service.ready();
    expect(harness.redis.connect).toHaveBeenCalledTimes(1);
  });

  it.each(["", "true", "false", "yes", "2"])(
    "rejects invalid IMAGE_RECOVERY_ENABLED value %j",
    (value) => {
      expect(() => createImageRecoveryServiceFromEnv({
        env: { IMAGE_RECOVERY_ENABLED: value },
        store: createStore(),
        logger: createLogger()
      })).toThrow(TypeError);
    }
  );

  it("does not call the client factory while disabled", async () => {
    const redis = createRedisClientHarness();
    const service = createImageRecoveryServiceFromEnv({
      env: {},
      store: createStore(),
      logger: createLogger(),
      redisClientFactory: redis.factory
    });

    await service.ready();
    await service.close();
    expect(redis.factory).not.toHaveBeenCalled();
  });

  it("keeps disabled ready and close idempotent no-ops", async () => {
    const service = createImageRecoveryServiceFromEnv({
      env: {},
      store: createStore(),
      logger: createLogger()
    });
    await service.ready();
    await service.ready();
    await service.close();
    await service.close();
  });

  it("does not connect while constructing an enabled service", () => {
    const harness = createEnabledHarness();
    expect(harness.redis.factory).toHaveBeenCalledTimes(1);
    expect(harness.redis.connect).not.toHaveBeenCalled();
  });

  it("connects Redis from ready", async () => {
    const harness = createEnabledHarness();
    await harness.service.ready();
    expect(harness.redis.connect).toHaveBeenCalledTimes(1);
  });

  it("pings only after Redis connects", async () => {
    const events: string[] = [];
    const harness = createEnabledHarness({}, events);
    await harness.service.ready();
    expect(events.slice(0, 2)).toEqual(["connect", "ping"]);
  });

  it("starts the scheduler only after ping succeeds", async () => {
    const events: string[] = [];
    const harness = createEnabledHarness({}, events);
    await harness.service.ready();
    expect(events).toEqual(["connect", "ping", "lock", "scheduler", "start"]);
  });

  it("initializes only once across repeated ready calls", async () => {
    const harness = createEnabledHarness();
    await Promise.all([harness.service.ready(), harness.service.ready()]);
    expect(harness.redis.connect).toHaveBeenCalledTimes(1);
    expect(harness.redis.ping).toHaveBeenCalledTimes(1);
    expect(harness.lock.factory).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.factory).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.start).toHaveBeenCalledTimes(1);
  });

  it("does not start the scheduler when connect fails", async () => {
    const harness = createEnabledHarness();
    harness.redis.connect.mockRejectedValueOnce(new Error("connect failed"));
    await expect(harness.service.ready()).rejects.toThrow(
      "image recovery initialization failed"
    );
    expect(harness.redis.ping).not.toHaveBeenCalled();
    expect(harness.scheduler.start).not.toHaveBeenCalled();
  });

  it("does not start the scheduler when ping fails", async () => {
    const harness = createEnabledHarness();
    harness.redis.ping.mockRejectedValueOnce(new Error("ping failed"));
    await expect(harness.service.ready()).rejects.toThrow(
      "image recovery initialization failed"
    );
    expect(harness.scheduler.start).not.toHaveBeenCalled();
  });

  it("rejects an unexpected ping response", async () => {
    const harness = createEnabledHarness();
    harness.redis.ping.mockResolvedValueOnce("NOPE");
    await expect(harness.service.ready()).rejects.toThrow(
      "image recovery initialization failed"
    );
    expect(harness.scheduler.start).not.toHaveBeenCalled();
  });

  it("quits the connected client when ping fails", async () => {
    const harness = createEnabledHarness();
    harness.redis.ping.mockRejectedValueOnce(new Error("ping failed"));
    await expect(harness.service.ready()).rejects.toThrow();
    expect(harness.redis.quit).toHaveBeenCalledTimes(1);
  });

  it("uses aiagg:imagerecovery:lock by default", async () => {
    const harness = createEnabledHarness();
    await harness.service.ready();
    expect(harness.lock.factory).toHaveBeenCalledWith(
      expect.objectContaining({ key: "aiagg:imagerecovery:lock" })
    );
  });

  it("normalizes prefix aiagg without a double colon", async () => {
    const harness = createEnabledHarness({ REDIS_KEY_PREFIX: "aiagg" });
    await harness.service.ready();
    expect(harness.lock.factory).toHaveBeenCalledWith(
      expect.objectContaining({ key: "aiagg:imagerecovery:lock" })
    );
  });

  it("normalizes prefix aiagg: without a double colon", async () => {
    const harness = createEnabledHarness({ REDIS_KEY_PREFIX: "aiagg:" });
    await harness.service.ready();
    expect(harness.lock.factory).toHaveBeenCalledWith(
      expect.objectContaining({ key: "aiagg:imagerecovery:lock" })
    );
  });

  it("passes the 300000ms TTL to the Redis lock", async () => {
    const harness = createEnabledHarness();
    await harness.service.ready();
    expect(harness.lock.factory).toHaveBeenCalledWith(
      expect.objectContaining({ ttlMs: 300_000 })
    );
  });

  it("passes the fixed recovery scheduler configuration", async () => {
    const harness = createEnabledHarness();
    await harness.service.ready();
    expect(harness.scheduler.factory).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: 60_000,
        graceMs: 120_000,
        batchLimit: 50,
        maxBatchesPerRun: 5
      })
    );
  });

  it("stops the scheduler before quitting Redis", async () => {
    const events: string[] = [];
    const harness = createEnabledHarness({}, events);
    await harness.service.ready();
    events.length = 0;
    await harness.service.close();
    expect(events).toEqual(["stop", "quit"]);
  });

  it("closes only once across repeated close calls", async () => {
    const harness = createEnabledHarness();
    await harness.service.ready();
    await Promise.all([harness.service.close(), harness.service.close()]);
    expect(harness.scheduler.stop).toHaveBeenCalledTimes(1);
    expect(harness.redis.quit).toHaveBeenCalledTimes(1);
  });

  it("closes safely before ready", async () => {
    const harness = createEnabledHarness();
    await harness.service.close();
    expect(harness.scheduler.stop).not.toHaveBeenCalled();
    expect(harness.redis.quit).not.toHaveBeenCalled();
  });

  it("quits Redis even when scheduler stop fails", async () => {
    const harness = createEnabledHarness();
    harness.scheduler.stop.mockRejectedValueOnce(new Error("stop failed"));
    await harness.service.ready();
    await expect(harness.service.close()).rejects.toThrow(
      "image recovery close failed"
    );
    expect(harness.redis.quit).toHaveBeenCalledTimes(1);
  });

  it("closes safely after partial ready failure", async () => {
    const harness = createEnabledHarness();
    harness.redis.ping.mockRejectedValueOnce(new Error("ping failed"));
    await expect(harness.service.ready()).rejects.toThrow();
    await harness.service.close();
    expect(harness.redis.quit).toHaveBeenCalledTimes(1);
  });

  it("forwards lock set and eval through the real mock client", async () => {
    const redis = createRedisClientHarness();
    const scheduler = createSchedulerHarness();
    let schedulerOptions: ImageRecoverySchedulerOptions | undefined;
    scheduler.factory.mockImplementation((options) => {
      schedulerOptions = options;
      return scheduler.scheduler;
    });
    const service = createImageRecoveryServiceFromEnv({
      env: {
        IMAGE_RECOVERY_ENABLED: "1",
        REDIS_URL: "redis://localhost:6379"
      },
      store: createStore(),
      logger: createLogger(),
      redisClientFactory: redis.factory,
      schedulerFactory: scheduler.factory
    });
    await service.ready();

    if (schedulerOptions === undefined) throw new Error("missing scheduler options");
    const lease = await schedulerOptions.lock.acquire();
    if (lease === null) throw new Error("missing lock lease");
    await lease.release();

    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set.mock.calls[0]?.[2]).toEqual({ NX: true, PX: 300_000 });
    expect(redis.evalCommand).toHaveBeenCalledTimes(1);
  });

  it("exposes only set and eval to the lock factory", async () => {
    const harness = createEnabledHarness();
    await harness.service.ready();
    const lockOptions = harness.lock.factory.mock.calls[0]?.[0];
    if (lockOptions === undefined) throw new Error("missing lock options");
    expect(Object.keys(lockOptions.client).sort()).toEqual(["eval", "set"]);
    expect("connect" in lockOptions.client).toBe(false);
    expect("quit" in lockOptions.client).toBe(false);
  });

  it("does not expose Redis credentials in initialization errors", async () => {
    const password = "super-secret-password";
    const harness = createEnabledHarness({
      REDIS_URL: `redis://user:${password}@localhost:6379`
    });
    harness.redis.connect.mockRejectedValueOnce(
      new Error(`failed to connect to redis://user:${password}@localhost:6379`)
    );

    try {
      await harness.service.ready();
      throw new Error("expected ready failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("image recovery initialization failed");
      expect(message).not.toContain(password);
    }
  });

  it("passes REDIS_URL only to the injected client factory without networking", () => {
    const harness = createEnabledHarness({
      REDIS_URL: "rediss://cache.example.test:6380"
    });
    expect(harness.redis.factory).toHaveBeenCalledWith({
      url: "rediss://cache.example.test:6380"
    });
    expect(harness.redis.connect).not.toHaveBeenCalled();
  });

  it("rejects invalid Redis configuration without invoking the client factory", () => {
    const redis = createRedisClientHarness();
    expect(() => createImageRecoveryServiceFromEnv({
      env: {
        IMAGE_RECOVERY_ENABLED: "1",
        REDIS_URL: "redis://localhost:6379",
        REDIS_KEY_PREFIX: "bad\u0000prefix"
      },
      store: createStore(),
      logger: createLogger(),
      redisClientFactory: redis.factory
    })).toThrow("REDIS_KEY_PREFIX is invalid");
    expect(redis.factory).not.toHaveBeenCalled();
  });
});
