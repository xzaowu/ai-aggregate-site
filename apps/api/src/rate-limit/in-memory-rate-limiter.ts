import {
  type RateLimiter,
  type RateLimitPolicy,
  type RateLimitResult,
  validateRateLimitKey,
  validateRateLimitPolicy
} from "./types";

interface Entry {
  count: number;
  resetAt: number;
}

export interface InMemoryRateLimiterOptions {
  now?: () => number;
  cleanupIntervalMs?: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly cleanupTimer: NodeJS.Timeout;
  private closed = false;

  constructor(options: InMemoryRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.cleanupTimer = setInterval(
      () => this.cleanupExpired(),
      options.cleanupIntervalMs ?? 60_000
    );
    this.cleanupTimer.unref();
  }

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    validateRateLimitKey(key);
    validateRateLimitPolicy(policy);
    const now = this.now();
    const existing = this.entries.get(key);
    const entry = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + policy.windowMs }
      : existing;

    entry.count += 1;
    this.entries.set(key, entry);
    return {
      allowed: entry.count <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - entry.count),
      retryAfterMs: Math.max(1, entry.resetAt - now)
    };
  }

  reset(): void {
    this.entries.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.cleanupTimer);
    this.entries.clear();
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

export function createInMemoryRateLimiter(
  options: InMemoryRateLimiterOptions = {}
): InMemoryRateLimiter {
  return new InMemoryRateLimiter(options);
}
