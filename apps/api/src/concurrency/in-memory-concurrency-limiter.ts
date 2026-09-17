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

export interface InMemoryConcurrencyLimiterOptions {
  now?: () => number;
  cleanupIntervalMs?: number;
}

export class InMemoryConcurrencyLimiter implements ConcurrencyLimiter {
  private readonly entries = new Map<string, Map<string, number>>();
  private readonly now: () => number;
  private readonly cleanupTimer: NodeJS.Timeout;
  private closed = false;

  constructor(options: InMemoryConcurrencyLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
    if (!Number.isSafeInteger(cleanupIntervalMs) || cleanupIntervalMs <= 0) {
      throw new TypeError("concurrency cleanup interval must be a positive integer");
    }
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  async acquire(
    key: string,
    options: ConcurrencyAcquireOptions
  ): Promise<ConcurrencyAcquireResult> {
    validateConcurrencyKey(key);
    validateConcurrencyAcquireOptions(options);
    this.ensureOpen();

    const now = this.now();
    const leases = this.entries.get(key) ?? new Map<string, number>();
    this.deleteExpired(leases, now);

    if (leases.size >= options.limit) {
      const earliestExpiry = Math.min(...leases.values());
      return {
        acquired: false,
        retryAfterMs: Math.max(1, earliestExpiry - now)
      };
    }

    const token = randomUUID();
    const expiresAt = now + options.leaseMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new ConcurrencyLimiterUnavailableError();
    }
    leases.set(token, expiresAt);
    this.entries.set(key, leases);

    return {
      acquired: true,
      retryAfterMs: Math.max(1, options.leaseMs),
      lease: { key, token, expiresAt }
    };
  }

  async renew(lease: ConcurrencyLease, leaseMs: number): Promise<ConcurrencyLease> {
    validateConcurrencyLease(lease);
    validateConcurrencyAcquireOptions({ limit: 1, leaseMs });
    this.ensureOpen();

    const now = this.now();
    const leases = this.entries.get(lease.key);
    if (leases === undefined) {
      throw new ConcurrencyLimiterUnavailableError();
    }
    const currentExpiry = leases.get(lease.token);
    if (currentExpiry === undefined || currentExpiry <= now) {
      if (currentExpiry !== undefined) leases.delete(lease.token);
      if (leases.size === 0) this.entries.delete(lease.key);
      throw new ConcurrencyLimiterUnavailableError();
    }

    const expiresAt = now + leaseMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new ConcurrencyLimiterUnavailableError();
    }
    leases.set(lease.token, expiresAt);
    return { ...lease, expiresAt };
  }

  async release(lease: ConcurrencyLease): Promise<void> {
    if (this.closed) return;
    validateConcurrencyLease(lease);
    const leases = this.entries.get(lease.key);
    if (!leases) return;
    leases.delete(lease.token);
    if (leases.size === 0) this.entries.delete(lease.key);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.cleanupTimer);
    this.entries.clear();
  }

  private ensureOpen(): void {
    if (this.closed) throw new ConcurrencyLimiterUnavailableError();
  }

  private deleteExpired(leases: Map<string, number>, now: number): void {
    for (const [token, expiresAt] of leases) {
      if (expiresAt <= now) leases.delete(token);
    }
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const [key, leases] of this.entries) {
      this.deleteExpired(leases, now);
      if (leases.size === 0) this.entries.delete(key);
    }
  }
}

export function createInMemoryConcurrencyLimiter(
  options: InMemoryConcurrencyLimiterOptions = {}
): InMemoryConcurrencyLimiter {
  return new InMemoryConcurrencyLimiter(options);
}
