export interface ConcurrencyAcquireOptions {
  limit: number;
  leaseMs: number;
}

export interface ConcurrencyLease {
  key: string;
  token: string;
  expiresAt: number;
}

export interface ConcurrencyAcquireResult {
  acquired: boolean;
  retryAfterMs: number;
  lease?: ConcurrencyLease;
}

export interface ConcurrencyLimiter {
  acquire(
    key: string,
    options: ConcurrencyAcquireOptions
  ): Promise<ConcurrencyAcquireResult>;
  renew(lease: ConcurrencyLease, leaseMs: number): Promise<ConcurrencyLease>;
  release(lease: ConcurrencyLease): Promise<void>;
  close(): Promise<void>;
}

export class ConcurrencyLimiterUnavailableError extends Error {
  constructor() {
    super("concurrency limiter unavailable");
    this.name = "ConcurrencyLimiterUnavailableError";
  }
}

export function validateConcurrencyAcquireOptions(
  options: ConcurrencyAcquireOptions
): void {
  if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
    throw new TypeError("concurrency limit must be a positive integer");
  }
  if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs <= 0) {
    throw new TypeError("concurrency leaseMs must be a positive integer");
  }
}

export function validateConcurrencyKey(key: string): void {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new TypeError("concurrency key must not be empty");
  }
}

export function validateConcurrencyLease(lease: ConcurrencyLease): void {
  validateConcurrencyKey(lease.key);
  if (typeof lease.token !== "string" || lease.token.trim().length === 0) {
    throw new TypeError("concurrency lease token must not be empty");
  }
  if (!Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= 0) {
    throw new TypeError("concurrency lease expiresAt must be a positive integer");
  }
}

export function validateConcurrencyResult(
  result: ConcurrencyAcquireResult
): void {
  if (typeof result.acquired !== "boolean") {
    throw new ConcurrencyLimiterUnavailableError();
  }
  if (!Number.isSafeInteger(result.retryAfterMs) || result.retryAfterMs < 1) {
    throw new ConcurrencyLimiterUnavailableError();
  }
  if (result.acquired) {
    if (!result.lease) {
      throw new ConcurrencyLimiterUnavailableError();
    }
    validateConcurrencyLease(result.lease);
  } else if (result.lease !== undefined) {
    throw new ConcurrencyLimiterUnavailableError();
  }
}
