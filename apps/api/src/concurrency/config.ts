import { createClient } from "redis";
import { createInMemoryConcurrencyLimiter } from "./in-memory-concurrency-limiter";
import {
  RedisConcurrencyLimiter,
  type RedisConcurrencyClient
} from "./redis-concurrency-limiter";
import { ConcurrencyLimiterUnavailableError, type ConcurrencyLimiter } from "./types";

export interface ConcurrencyConfig {
  backend: "memory" | "redis";
  redisUrl?: string;
  redisKeyPrefix: string;
  redisConnectTimeoutMs: number;
}

export interface CreatedConcurrencyLimiter {
  concurrencyLimiter: ConcurrencyLimiter;
  ready(): Promise<void>;
}

function configurationError(message: string): Error {
  return new Error(`Invalid concurrency configuration: ${message}`);
}

export function resolveConcurrencyConfig(
  env: Partial<NodeJS.ProcessEnv>
): ConcurrencyConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const backend = nodeEnv === "production" ? "redis" : "memory";
  const redisKeyPrefix = env.REDIS_KEY_PREFIX === undefined
    ? "aiagg"
    : env.REDIS_KEY_PREFIX.trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(redisKeyPrefix)) {
    throw configurationError("REDIS_KEY_PREFIX is invalid");
  }
  const timeoutText = env.REDIS_CONNECT_TIMEOUT_MS?.trim() || "5000";
  if (!/^\d+$/.test(timeoutText)) {
    throw configurationError("REDIS_CONNECT_TIMEOUT_MS must be an integer");
  }
  const redisConnectTimeoutMs = Number(timeoutText);
  if (!Number.isSafeInteger(redisConnectTimeoutMs) || redisConnectTimeoutMs < 500 || redisConnectTimeoutMs > 30_000) {
    throw configurationError("REDIS_CONNECT_TIMEOUT_MS must be between 500 and 30000");
  }

  if (backend === "memory") {
    return { backend, redisKeyPrefix, redisConnectTimeoutMs };
  }

  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw configurationError("REDIS_URL is required");
  try {
    const parsed = new URL(redisUrl);
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw configurationError("REDIS_URL protocol must be redis or rediss");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid concurrency configuration:")) {
      throw error;
    }
    throw configurationError("REDIS_URL is invalid");
  }
  return { backend, redisUrl, redisKeyPrefix, redisConnectTimeoutMs };
}

export function createConcurrencyLimiterFromConfig(
  config: ConcurrencyConfig
): CreatedConcurrencyLimiter {
  if (config.backend === "memory") {
    return {
      concurrencyLimiter: createInMemoryConcurrencyLimiter(),
      ready: async () => undefined
    };
  }

  const client = createClient({
    url: config.redisUrl,
    socket: { connectTimeout: config.redisConnectTimeoutMs }
  });
  client.on("error", () => undefined);
  const limiterClient: RedisConcurrencyClient = {
    get isReady() { return client.isReady; },
    eval: async (script, options) => client.eval(script, options),
    quit: async () => client.quit(),
    destroy: () => client.destroy()
  };
  const concurrencyLimiter = new RedisConcurrencyLimiter(
    limiterClient,
    config.redisKeyPrefix
  );

  return {
    concurrencyLimiter,
    ready: async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          (async () => {
            await client.connect();
            await client.ping();
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new ConcurrencyLimiterUnavailableError()),
              config.redisConnectTimeoutMs
            );
            timer.unref();
          })
        ]);
      } catch {
        await concurrencyLimiter.close();
        throw new ConcurrencyLimiterUnavailableError();
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
}
