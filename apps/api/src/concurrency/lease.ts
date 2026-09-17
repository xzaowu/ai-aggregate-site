import {
  type ConcurrencyAcquireOptions,
  type ConcurrencyLease,
  type ConcurrencyLimiter,
  ConcurrencyLimiterUnavailableError,
  validateConcurrencyResult
} from "./types";

export const CONCURRENCY_LEASE_MS = 5 * 60 * 1000;
export const CONCURRENCY_RENEW_INTERVAL_MS = 60 * 1000;

export async function runWithConcurrencyLease<T>(
  limiter: ConcurrencyLimiter,
  key: string,
  options: ConcurrencyAcquireOptions,
  task: () => Promise<T>,
  callbacks: {
    onRenewFailure?: () => void;
    onReleaseFailure?: () => void;
  } = {}
): Promise<{ acquired: true; value: T } | { acquired: false; retryAfterMs: number }> {
  const result = await limiter.acquire(key, options);
  validateConcurrencyResult(result);
  if (!result.acquired || !result.lease) {
    return { acquired: false, retryAfterMs: result.retryAfterMs };
  }

  let lease: ConcurrencyLease = result.lease;
  let released = false;
  let renewing = false;
  const renewTimer = setInterval(() => {
    if (released || renewing) return;
    renewing = true;
    void limiter.renew(lease, options.leaseMs)
      .then((renewed) => {
        lease = renewed;
      })
      .catch(() => {
        callbacks.onRenewFailure?.();
      })
      .finally(() => {
        renewing = false;
      });
  }, CONCURRENCY_RENEW_INTERVAL_MS);
  renewTimer.unref();

  const release = async () => {
    if (released) return;
    released = true;
    clearInterval(renewTimer);
    try {
      await limiter.release(lease);
    } catch {
      callbacks.onReleaseFailure?.();
    }
  };

  try {
    const value = await task();
    await release();
    return { acquired: true, value };
  } catch (error) {
    await release();
    throw error;
  }
}
