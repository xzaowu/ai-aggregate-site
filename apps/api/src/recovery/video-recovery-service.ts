import { createClient } from "redis";
import { randomUUID } from "node:crypto";
import type { AiTaskRuntimeRecord, UserStore } from "../store";

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;
const MAX_LOCK_TTL_MS = 24 * 60 * 60 * 1000;
const VIDEO_RECOVERY_LOCK_RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`.trim();

export interface VideoRecoveryLogger {
  info(fields: Record<string, unknown>, message?: string): void;
  warn(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
}

export interface VideoRecoveryService {
  ready(): Promise<void>;
  start(): void;
  runOnce(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateVideoRecoveryServiceOptions {
  env: Partial<NodeJS.ProcessEnv>;
  store: Pick<UserStore, "listRunningVideoTaskRuntime">;
  recoverTask(task: AiTaskRuntimeRecord): Promise<void>;
  logger: VideoRecoveryLogger;
}

interface RedisRecoveryClient {
  connect(): Promise<void>;
  ping(): Promise<string>;
  set(
    key: string,
    value: string,
    options: { NX: true; PX: number }
  ): Promise<string | null>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>;
  quit(): Promise<void>;
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function createRedisClient(url: string): RedisRecoveryClient {
  const client = createClient({ url });
  client.on("error", () => undefined);
  return {
    async connect() {
      await client.connect();
    },
    ping: () => client.ping(),
    set: (key, value, options) => client.set(key, value, options),
    eval: (script, options) => client.eval(script, options),
    async quit() {
      await client.quit();
    }
  };
}

function resolveRedisUrl(env: Partial<NodeJS.ProcessEnv>): string | null {
  const value = env.VIDEO_RECOVERY_REDIS_URL?.trim() || env.REDIS_URL?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "redis:" || parsed.protocol === "rediss:"
      ? value
      : null;
  } catch {
    return null;
  }
}

function createDisabledService(): VideoRecoveryService {
  return {
    async ready() {},
    start() {},
    async runOnce() {},
    async close() {}
  };
}

export function createVideoRecoveryServiceFromEnv(
  options: CreateVideoRecoveryServiceOptions
): VideoRecoveryService {
  if (options.env.VIDEO_RECOVERY_ENABLED === "0") {
    return createDisabledService();
  }

  const intervalMs = readInteger(
    options.env.VIDEO_RECOVERY_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    1_000,
    MAX_INTERVAL_MS
  );
  const lockTtlMs = readInteger(
    options.env.VIDEO_RECOVERY_LOCK_TTL_MS,
    DEFAULT_LOCK_TTL_MS,
    intervalMs,
    MAX_LOCK_TTL_MS
  );
  const redisUrl = resolveRedisUrl(options.env);
  const redisKeyPrefix = options.env.REDIS_KEY_PREFIX?.trim() || "aiagg";
  const lockKey = `${redisKeyPrefix.replace(/:+$/u, "")}:videorecovery:lock`;
  const redisClient = redisUrl ? createRedisClient(redisUrl) : null;
  let redisReady = false;
  let redisCloseNeeded = false;
  let timer: NodeJS.Timeout | undefined;
  let currentRun: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let closeStarted = false;
  let localLock = false;

  const releaseRedisLock = async (token: string): Promise<void> => {
    if (!redisClient || !redisReady) return;
    await redisClient.eval(VIDEO_RECOVERY_LOCK_RELEASE_LUA, {
      keys: [lockKey],
      arguments: [token]
    });
  };

  const executeRecovery = async (): Promise<void> => {
    if (localLock) return;
    localLock = true;
    const startedAt = Date.now();
    const token = randomUUID();
    let distributedLock = false;

    try {
      if (redisClient && redisReady) {
        const result = await redisClient.set(lockKey, token, {
          NX: true,
          PX: lockTtlMs
        });
        if (result !== "OK") return;
        distributedLock = true;
      }

      const listRunningVideoTaskRuntime =
        options.store.listRunningVideoTaskRuntime;
      if (typeof listRunningVideoTaskRuntime !== "function") return;

      let tasks: AiTaskRuntimeRecord[];
      try {
        tasks = await listRunningVideoTaskRuntime.call(options.store);
      } catch (error) {
        options.logger.error(
          { event: "video-recovery-scan-failed", errorType: errorType(error) },
          "video recovery scan failed"
        );
        return;
      }

      let recovered = 0;
      for (const task of tasks.slice(0, 100)) {
        if (task.type !== "video" || task.status !== "running") continue;
        try {
          await options.recoverTask(task);
          recovered += 1;
        } catch (error) {
          options.logger.warn(
            {
              event: "video-recovery-task-failed",
              taskId: task.id,
              errorType: errorType(error)
            },
            "video recovery task failed"
          );
        }
      }

      options.logger.info(
        {
          event: "video-recovery-completed",
          scanned: tasks.length,
          recovered,
          durationMs: Math.max(0, Date.now() - startedAt)
        },
        "video recovery completed"
      );
    } catch (error) {
      options.logger.error(
        { event: "video-recovery-failed", errorType: errorType(error) },
        "video recovery failed"
      );
    } finally {
      if (distributedLock) {
        try {
          await releaseRedisLock(token);
        } catch (error) {
          options.logger.warn(
            {
              event: "video-recovery-lock-release-failed",
              errorType: errorType(error)
            },
            "video recovery lock release failed"
          );
        }
      }
      localLock = false;
    }
  };

  const runOnce = async (): Promise<void> => {
    if (currentRun !== undefined) return currentRun;
    const run = Promise.resolve().then(executeRecovery);
    currentRun = run;
    try {
      await run;
    } finally {
      if (currentRun === run) currentRun = undefined;
    }
  };

  return {
    async ready(): Promise<void> {
      if (closeStarted || !redisClient) return;
      try {
        await redisClient.connect();
        redisCloseNeeded = true;
        if ((await redisClient.ping()) !== "PONG") {
          throw new Error("VIDEO_RECOVERY_REDIS_PING_FAILED");
        }
        redisReady = true;
      } catch (error) {
        redisReady = false;
        options.logger.warn(
          {
            event: "video-recovery-redis-unavailable",
            errorType: errorType(error)
          },
          "video recovery will use the local lock"
        );
        if (redisCloseNeeded) {
          try {
            await redisClient.quit();
          } catch {
            // Keep the local recovery path available.
          }
          redisCloseNeeded = false;
        }
      }
    },
    start(): void {
      if (closeStarted || timer !== undefined) return;
      timer = setInterval(() => {
        void runOnce().catch((error) => {
          options.logger.error(
            { event: "video-recovery-background-failed", errorType: errorType(error) },
            "video recovery background run failed"
          );
        });
      }, intervalMs);
      timer.unref();
    },
    runOnce,
    async close(): Promise<void> {
      if (closePromise !== undefined) return closePromise;
      closeStarted = true;
      closePromise = (async () => {
        if (timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
        if (currentRun !== undefined) {
          await currentRun.catch(() => undefined);
        }
        if (redisClient && redisCloseNeeded) {
          try {
            await redisClient.quit();
          } finally {
            redisCloseNeeded = false;
            redisReady = false;
          }
        }
      })();
      return closePromise;
    }
  };
}
