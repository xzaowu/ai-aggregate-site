import { createClient } from "redis";
import { createInMemoryRateLimiter } from "./in-memory-rate-limiter";
import {
  RedisRateLimiter,
  type RedisRateLimitClient
} from "./redis-rate-limiter";
import { type RateLimiter, RateLimiterUnavailableError } from "./types";

export interface RateLimitConfig {
  backend: "memory" | "redis";
  redisUrl?: string;
  redisKeyPrefix: string;
  redisConnectTimeoutMs: number;
}

export interface CreatedRateLimiter {
  rateLimiter: RateLimiter;
  ready(): Promise<void>;
}

function configurationError(message: string): Error {
  return new Error(`Invalid rate limit configuration: ${message}`);
}

export function resolveRateLimitConfig(
  env: Partial<NodeJS.ProcessEnv>
): RateLimitConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const defaultBackend = nodeEnv === "production" ? "redis" : "memory";
  const backend = env.RATE_LIMIT_BACKEND?.trim() || defaultBackend;
  if (backend !== "redis" && backend !== "memory") {
    throw configurationError("RATE_LIMIT_BACKEND must be redis or memory");
  }
  if (nodeEnv === "production" && backend === "memory") {
    throw configurationError("memory backend is forbidden in production");
  }

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
  if (redisConnectTimeoutMs < 500 || redisConnectTimeoutMs > 30_000) {
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
    if (error instanceof Error && error.message.startsWith("Invalid rate limit configuration:")) {
      throw error;
    }
    throw configurationError("REDIS_URL is invalid");
  }
  return { backend, redisUrl, redisKeyPrefix, redisConnectTimeoutMs };
}

export function createRateLimiterFromConfig(config: RateLimitConfig): CreatedRateLimiter {
  if (config.backend === "memory") {
    return { rateLimiter: createInMemoryRateLimiter(), ready: async () => undefined };
  }

  const client = createClient({
    url: config.redisUrl,
    socket: { connectTimeout: config.redisConnectTimeoutMs }
  });
  client.on("error", () => undefined);
  const limiterClient: RedisRateLimitClient = {
    get isReady() { return client.isReady; },
    eval: async (script, options) => client.eval(script, options),
    quit: async () => client.quit(),
    destroy: () => client.destroy()
  };
  const rateLimiter = new RedisRateLimiter(limiterClient, config.redisKeyPrefix);

  return {
    rateLimiter,
    ready: async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          (async () => {
            await client.connect();
            await client.ping();
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new RateLimiterUnavailableError()), config.redisConnectTimeoutMs);
            timer.unref();
          })
        ]);
      } catch {
        await rateLimiter.close();
        throw new RateLimiterUnavailableError();
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
}
