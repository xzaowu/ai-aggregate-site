import {
  type RateLimiter,
  type RateLimitPolicy,
  type RateLimitResult,
  RateLimiterUnavailableError,
  validateRateLimitKey,
  validateRateLimitPolicy
} from "./types";

export const FIXED_WINDOW_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`.trim();

export interface RedisRateLimitClient {
  readonly isReady: boolean;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  quit(): Promise<unknown>;
  destroy(): void;
}

function parseRedisInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return null;
}

export class RedisRateLimiter implements RateLimiter {
  private closed = false;

  constructor(
    private readonly client: RedisRateLimitClient,
    private readonly keyPrefix: string
  ) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    validateRateLimitKey(key);
    validateRateLimitPolicy(policy);
    if (this.closed || !this.client.isReady) {
      throw new RateLimiterUnavailableError();
    }

    let raw: unknown;
    try {
      raw = await this.client.eval(FIXED_WINDOW_LUA, {
        keys: [`${this.keyPrefix}:ratelimit:${key}`],
        arguments: [String(policy.windowMs)]
      });
    } catch {
      throw new RateLimiterUnavailableError();
    }

    if (!Array.isArray(raw) || raw.length !== 2) {
      throw new RateLimiterUnavailableError();
    }
    const current = parseRedisInteger(raw[0]);
    const ttl = parseRedisInteger(raw[1]);
    if (current === null || current < 1 || ttl === null || ttl < 1) {
      throw new RateLimiterUnavailableError();
    }

    return {
      allowed: current <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - current),
      retryAfterMs: Math.max(1, ttl)
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.client.isReady) {
      this.client.destroy();
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.destroy();
    }
  }
}
