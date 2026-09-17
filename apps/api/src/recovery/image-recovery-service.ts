import { createClient } from "redis";
import type { CreditReservationStore } from "../store";
import {
  createImageRecoveryScheduler,
  type ImageRecoveryLock,
  type ImageRecoveryLogger,
  type ImageRecoveryScheduler,
  type ImageRecoverySchedulerOptions
} from "./image-recovery-scheduler";
import {
  createRedisImageRecoveryLock,
  type RedisImageRecoveryLockClient,
  type RedisImageRecoveryLockOptions
} from "./redis-image-recovery-lock";

const DEFAULT_REDIS_KEY_PREFIX = "aiagg";
const IMAGE_RECOVERY_INTERVAL_MS = 60_000;
const IMAGE_RECOVERY_GRACE_MS = 120_000;
const IMAGE_RECOVERY_BATCH_LIMIT = 50;
const IMAGE_RECOVERY_MAX_BATCHES_PER_RUN = 5;
const IMAGE_RECOVERY_LOCK_TTL_MS = 5 * 60 * 1000;
const REDIS_KEY_PREFIX_PATTERN = /^[A-Za-z0-9_-]{1,32}:?$/u;

export interface ImageRecoveryService {
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface ImageRecoveryRedisClient {
  connect(): Promise<void>;
  ping(): Promise<string>;
  quit(): Promise<void>;
  set(
    key: string,
    value: string,
    options: {
      NX: true;
      PX: number;
    }
  ): Promise<string | null>;
  eval(
    script: string,
    options: {
      keys: string[];
      arguments: string[];
    }
  ): Promise<unknown>;
}

export interface ImageRecoveryRedisClientFactoryOptions {
  url: string;
}

export type ImageRecoveryRedisClientFactory = (
  options: ImageRecoveryRedisClientFactoryOptions
) => ImageRecoveryRedisClient;

export type ImageRecoverySchedulerFactory = (
  options: ImageRecoverySchedulerOptions
) => ImageRecoveryScheduler;

export type ImageRecoveryLockFactory = (
  options: RedisImageRecoveryLockOptions
) => ImageRecoveryLock;

export interface CreateImageRecoveryServiceFromEnvOptions {
  env: Partial<NodeJS.ProcessEnv>;
  store: CreditReservationStore;
  logger: ImageRecoveryLogger;
  redisClientFactory?: ImageRecoveryRedisClientFactory;
  schedulerFactory?: ImageRecoverySchedulerFactory;
  lockFactory?: ImageRecoveryLockFactory;
}

interface EnabledImageRecoveryConfig {
  redisUrl: string;
  lockKey: string;
}

class ImageRecoveryInitializationError extends Error {
  constructor() {
    super("image recovery initialization failed");
    this.name = "ImageRecoveryInitializationError";
  }
}

class ImageRecoveryCloseError extends Error {
  constructor() {
    super("image recovery close failed");
    this.name = "ImageRecoveryCloseError";
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function isImageRecoveryEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new TypeError("IMAGE_RECOVERY_ENABLED must be 0 or 1");
}

function resolveEnabledConfig(
  env: Partial<NodeJS.ProcessEnv>
): EnabledImageRecoveryConfig {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("Invalid image recovery configuration: REDIS_URL is required");
  }

  try {
    const parsed = new URL(redisUrl);
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw new Error(
        "Invalid image recovery configuration: REDIS_URL protocol must be redis or rediss"
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid image recovery configuration:")
    ) {
      throw error;
    }
    throw new Error("Invalid image recovery configuration: REDIS_URL is invalid");
  }

  const redisKeyPrefix = env.REDIS_KEY_PREFIX === undefined
    ? DEFAULT_REDIS_KEY_PREFIX
    : env.REDIS_KEY_PREFIX.trim();
  if (!REDIS_KEY_PREFIX_PATTERN.test(redisKeyPrefix)) {
    throw new Error(
      "Invalid image recovery configuration: REDIS_KEY_PREFIX is invalid"
    );
  }

  const normalizedPrefix = redisKeyPrefix.endsWith(":")
    ? redisKeyPrefix.slice(0, -1)
    : redisKeyPrefix;

  return {
    redisUrl,
    lockKey: `${normalizedPrefix}:imagerecovery:lock`
  };
}

function createDefaultRedisClient(
  options: ImageRecoveryRedisClientFactoryOptions
): ImageRecoveryRedisClient {
  const client = createClient({ url: options.url });
  client.on("error", () => undefined);

  return {
    async connect(): Promise<void> {
      await client.connect();
    },
    ping: () => client.ping(),
    async quit(): Promise<void> {
      await client.quit();
    },
    set: (key, value, setOptions) => client.set(key, value, setOptions),
    eval: (script, evalOptions) => client.eval(script, evalOptions)
  };
}

function createDisabledService(): ImageRecoveryService {
  return {
    async ready(): Promise<void> {},
    async close(): Promise<void> {}
  };
}

export function createImageRecoveryServiceFromEnv(
  options: CreateImageRecoveryServiceFromEnvOptions
): ImageRecoveryService {
  if (!isImageRecoveryEnabled(options.env.IMAGE_RECOVERY_ENABLED)) {
    return createDisabledService();
  }

  const config = resolveEnabledConfig(options.env);
  const redisClientFactory = options.redisClientFactory ?? createDefaultRedisClient;
  const schedulerFactory = options.schedulerFactory ?? createImageRecoveryScheduler;
  const lockFactory = options.lockFactory ?? createRedisImageRecoveryLock;
  const redisClient = redisClientFactory({ url: config.redisUrl });
  let scheduler: ImageRecoveryScheduler | undefined;
  let redisClientNeedsClose = false;
  let readyPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let closeStarted = false;

  const closeRedisAfterInitializationFailure = async (): Promise<void> => {
    if (!redisClientNeedsClose) return;
    try {
      await redisClient.quit();
      redisClientNeedsClose = false;
    } catch (error) {
      options.logger.warn(
        {
          event: "image-recovery-initialization-cleanup-failed",
          errorType: getErrorType(error)
        },
        "image recovery initialization cleanup failed"
      );
    }
  };

  const initialize = async (): Promise<void> => {
    if (closeStarted) throw new ImageRecoveryInitializationError();

    try {
      await redisClient.connect();
      redisClientNeedsClose = true;

      const pingResult = await redisClient.ping();
      if (pingResult !== "PONG") throw new ImageRecoveryInitializationError();

      const lockClient: RedisImageRecoveryLockClient = {
        set: (key, value, setOptions) =>
          redisClient.set(key, value, setOptions),
        eval: (script, evalOptions) => redisClient.eval(script, evalOptions)
      };
      const lock = lockFactory({
        client: lockClient,
        key: config.lockKey,
        ttlMs: IMAGE_RECOVERY_LOCK_TTL_MS
      });
      const createdScheduler = schedulerFactory({
        store: options.store,
        lock,
        logger: options.logger,
        intervalMs: IMAGE_RECOVERY_INTERVAL_MS,
        graceMs: IMAGE_RECOVERY_GRACE_MS,
        batchLimit: IMAGE_RECOVERY_BATCH_LIMIT,
        maxBatchesPerRun: IMAGE_RECOVERY_MAX_BATCHES_PER_RUN
      });
      scheduler = createdScheduler;
      createdScheduler.start();
    } catch (error) {
      if (scheduler !== undefined) {
        try {
          await scheduler.stop();
        } catch (cleanupError) {
          options.logger.warn(
            {
              event: "image-recovery-scheduler-initialization-cleanup-failed",
              errorType: getErrorType(cleanupError)
            },
            "image recovery scheduler initialization cleanup failed"
          );
        }
      }
      await closeRedisAfterInitializationFailure();
      throw new ImageRecoveryInitializationError();
    }
  };

  const shutdown = async (): Promise<void> => {
    closeStarted = true;

    if (readyPromise !== undefined) {
      try {
        await readyPromise;
      } catch {
        // Initialization reports its own safe error to Fastify onReady.
      }
    }

    let closeFailed = false;
    if (scheduler !== undefined) {
      try {
        await scheduler.stop();
      } catch (error) {
        closeFailed = true;
        options.logger.warn(
          {
            event: "image-recovery-scheduler-close-failed",
            errorType: getErrorType(error)
          },
          "image recovery scheduler close failed"
        );
      }
    }

    if (redisClientNeedsClose) {
      try {
        await redisClient.quit();
        redisClientNeedsClose = false;
      } catch (error) {
        closeFailed = true;
        options.logger.warn(
          {
            event: "image-recovery-redis-close-failed",
            errorType: getErrorType(error)
          },
          "image recovery redis close failed"
        );
      }
    }

    if (closeFailed) throw new ImageRecoveryCloseError();
  };

  return {
    ready(): Promise<void> {
      if (readyPromise === undefined) readyPromise = initialize();
      return readyPromise;
    },
    close(): Promise<void> {
      if (closePromise === undefined) closePromise = shutdown();
      return closePromise;
    }
  };
}
