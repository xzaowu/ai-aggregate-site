import { randomUUID } from "node:crypto";
import {
  type ConcurrencyAcquireOptions,
  type ConcurrencyAcquireResult,
  type ConcurrencyLease,
  type ConcurrencyLimiter,
  ConcurrencyLimiterUnavailableError,
  validateConcurrencyAcquireOptions,
  validateConcurrencyKey,
  validateConcurrencyLease
} from "./types";

export const CONCURRENCY_ACQUIRE_LUA = `
local now = tonumber(ARGV[1])
local expiresAt = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local leaseMs = tonumber(ARGV[4])
local token = ARGV[5]
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
local current = redis.call("ZCARD", KEYS[1])
if current >= limit then
  local earliest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local retryAfterMs = math.max(1, tonumber(earliest[2]) - now)
  return { 0, retryAfterMs }
end
redis.call("ZADD", KEYS[1], expiresAt, token)
redis.call("PEXPIRE", KEYS[1], leaseMs)
return { 1, expiresAt }
`.trim();

export const CONCURRENCY_RELEASE_LUA = `
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
if redis.call("ZCARD", KEYS[1]) == 0 then
  redis.call("DEL", KEYS[1])
end
return removed
`.trim();

export const CONCURRENCY_RENEW_LUA = `
local now = tonumber(ARGV[1])
local expiresAt = tonumber(ARGV[2])
local leaseMs = tonumber(ARGV[3])
local current = redis.call("ZSCORE", KEYS[1], ARGV[4])
if not current or tonumber(current) <= now then
  return { 0, 0 }
end
redis.call("ZADD", KEYS[1], expiresAt, ARGV[4])
redis.call("PEXPIRE", KEYS[1], leaseMs)
return { 1, expiresAt }
`.trim();

export interface RedisConcurrencyClient {
  readonly isReady: boolean;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  quit(): Promise<unknown>;
  destroy(): void;
}

function parseRedisInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return null;
}

function parseRedisArray(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const first = parseRedisInteger(value[0]);
  const second = parseRedisInteger(value[1]);
  return first === null || second === null ? null : [first, second];
}

export class RedisConcurrencyLimiter implements ConcurrencyLimiter {
  private closed = false;

  constructor(
    private readonly client: RedisConcurrencyClient,
    private readonly keyPrefix: string
  ) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyPrefix)) {
      throw new TypeError("concurrency key prefix is invalid");
    }
  }

  async acquire(
    key: string,
    options: ConcurrencyAcquireOptions
  ): Promise<ConcurrencyAcquireResult> {
    validateConcurrencyKey(key);
    validateConcurrencyAcquireOptions(options);
    this.ensureReady();

    const now = Date.now();
    const expiresAt = now + options.leaseMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new ConcurrencyLimiterUnavailableError();
    }

    let raw: unknown;
    const token = randomUUID();
    try {
      raw = await this.client.eval(CONCURRENCY_ACQUIRE_LUA, {
        keys: [this.buildKey(key)],
        arguments: [
          String(now),
          String(expiresAt),
          String(options.limit),
          String(options.leaseMs),
          token
        ]
      });
    } catch {
      throw new ConcurrencyLimiterUnavailableError();
    }

    const parsed = parseRedisArray(raw);
    if (!parsed || (parsed[0] !== 0 && parsed[0] !== 1)) {
      throw new ConcurrencyLimiterUnavailableError();
    }
    if (parsed[0] === 0) {
      if (parsed[1] < 1) throw new ConcurrencyLimiterUnavailableError();
      return { acquired: false, retryAfterMs: parsed[1] };
    }
    if (parsed[1] !== expiresAt) {
      throw new ConcurrencyLimiterUnavailableError();
    }

    return {
      acquired: true,
      retryAfterMs: Math.max(1, options.leaseMs),
      lease: { key, token, expiresAt }
    };
  }

  async renew(lease: ConcurrencyLease, leaseMs: number): Promise<ConcurrencyLease> {
    validateConcurrencyLease(lease);
    validateConcurrencyAcquireOptions({ limit: 1, leaseMs });
    this.ensureReady();

    const now = Date.now();
    const expiresAt = now + leaseMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new ConcurrencyLimiterUnavailableError();
    }

    let raw: unknown;
    try {
      raw = await this.client.eval(CONCURRENCY_RENEW_LUA, {
        keys: [this.buildKey(lease.key)],
        arguments: [String(now), String(expiresAt), String(leaseMs), lease.token]
      });
    } catch {
      throw new ConcurrencyLimiterUnavailableError();
    }
    const parsed = parseRedisArray(raw);
    if (!parsed || parsed[0] !== 1 || parsed[1] !== expiresAt) {
      throw new ConcurrencyLimiterUnavailableError();
    }
    return { ...lease, expiresAt };
  }

  async release(lease: ConcurrencyLease): Promise<void> {
    if (this.closed) return;
    validateConcurrencyLease(lease);
    this.ensureReady();
    let raw: unknown;
    try {
      raw = await this.client.eval(CONCURRENCY_RELEASE_LUA, {
        keys: [this.buildKey(lease.key)],
        arguments: [lease.token]
      });
    } catch {
      throw new ConcurrencyLimiterUnavailableError();
    }
    const removed = parseRedisInteger(raw);
    if (removed === null || (removed !== 0 && removed !== 1)) {
      throw new ConcurrencyLimiterUnavailableError();
    }
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

  private ensureReady(): void {
    if (this.closed || !this.client.isReady) {
      throw new ConcurrencyLimiterUnavailableError();
    }
  }

  private buildKey(key: string): string {
    return `${this.keyPrefix}:concurrency:${key}`;
  }
}
