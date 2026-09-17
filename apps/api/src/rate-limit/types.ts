export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
  close(): Promise<void>;
}

export class RateLimiterUnavailableError extends Error {
  constructor() {
    super("rate limiter unavailable");
    this.name = "RateLimiterUnavailableError";
  }
}

export function validateRateLimitPolicy(policy: RateLimitPolicy): void {
  if (!Number.isInteger(policy.limit) || policy.limit <= 0) {
    throw new TypeError("rate limit must be a positive integer");
  }
  if (!Number.isInteger(policy.windowMs) || policy.windowMs <= 0) {
    throw new TypeError("rate limit windowMs must be a positive integer");
  }
}

export function validateRateLimitKey(key: string): void {
  if (!key.trim()) {
    throw new TypeError("rate limit key must not be empty");
  }
}
