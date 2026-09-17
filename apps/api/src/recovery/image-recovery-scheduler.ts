import type { CreditReservationStore } from "../store";

export type ImageRecoveryStore = Pick<
  CreditReservationStore,
  "recoverExpiredImageReservations"
>;

export interface ImageRecoveryLockLease {
  release(): Promise<void>;
}

export interface ImageRecoveryLock {
  acquire(): Promise<ImageRecoveryLockLease | null>;
}

export interface ImageRecoveryLogger {
  info(fields: Record<string, unknown>, message?: string): void;
  warn(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
}

export interface ImageRecoverySchedulerOptions {
  store: ImageRecoveryStore;
  lock: ImageRecoveryLock;
  logger: ImageRecoveryLogger;
  intervalMs?: number;
  graceMs?: number;
  batchLimit?: number;
  maxBatchesPerRun?: number;
}

export interface ImageRecoveryScheduler {
  start(): void;
  runOnce(): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_GRACE_MS = 120_000;
const DEFAULT_BATCH_LIMIT = 50;
const DEFAULT_MAX_BATCHES_PER_RUN = 5;

function validateIntegerRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export function createImageRecoveryScheduler(
  options: ImageRecoverySchedulerOptions
): ImageRecoveryScheduler {
  const intervalMs = validateIntegerRange(
    "intervalMs",
    options.intervalMs ?? DEFAULT_INTERVAL_MS,
    1,
    24 * 60 * 60 * 1000
  );
  const graceMs = validateIntegerRange(
    "graceMs",
    options.graceMs ?? DEFAULT_GRACE_MS,
    0,
    15 * 60 * 1000
  );
  const batchLimit = validateIntegerRange(
    "batchLimit",
    options.batchLimit ?? DEFAULT_BATCH_LIMIT,
    1,
    1000
  );
  const maxBatchesPerRun = validateIntegerRange(
    "maxBatchesPerRun",
    options.maxBatchesPerRun ?? DEFAULT_MAX_BATCHES_PER_RUN,
    1,
    100
  );

  let timer: NodeJS.Timeout | undefined;
  let currentRun: Promise<void> | undefined;

  const executeRecovery = async (): Promise<void> => {
    const startedAt = Date.now();
    const recoveryNow = new Date();
    let lease: ImageRecoveryLockLease | null;

    try {
      lease = await options.lock.acquire();
    } catch (error) {
      options.logger.error(
        {
          event: "image-recovery-lock-acquire-failed",
          errorType: getErrorType(error)
        },
        "image recovery lock acquire failed"
      );
      return;
    }

    if (lease === null) {
      options.logger.info(
        {
          event: "image-recovery-skipped",
          reason: "lock-not-acquired"
        },
        "image recovery skipped"
      );
      return;
    }

    let scanned = 0;
    let recovered = 0;
    let skipped = 0;
    let batches = 0;
    let completed = false;

    try {
      while (batches < maxBatchesPerRun) {
        const result = await options.store.recoverExpiredImageReservations({
          now: recoveryNow,
          graceMs,
          limit: batchLimit
        });
        batches += 1;
        scanned += result.scanned;
        recovered += result.recovered;
        skipped += result.skipped;

        if (result.scanned < batchLimit) break;
      }
      completed = true;
    } catch (error) {
      options.logger.error(
        {
          event: "image-recovery-failed",
          errorType: getErrorType(error)
        },
        "image recovery failed"
      );
    } finally {
      try {
        await lease.release();
      } catch (error) {
        options.logger.warn(
          {
            event: "image-recovery-lock-release-failed",
            errorType: getErrorType(error)
          },
          "image recovery lock release failed"
        );
      }
    }

    if (completed) {
      options.logger.info(
        {
          event: "image-recovery-completed",
          scanned,
          recovered,
          skipped,
          batches,
          durationMs: Date.now() - startedAt,
          intervalMs,
          graceMs,
          limit: batchLimit,
          maxBatchesPerRun
        },
        "image recovery completed"
      );
    }
  };

  const runOnce = async (): Promise<void> => {
    if (currentRun !== undefined) {
      options.logger.info(
        {
          event: "image-recovery-skipped",
          reason: "run-in-progress"
        },
        "image recovery skipped"
      );
      return;
    }

    const run = Promise.resolve().then(executeRecovery);
    currentRun = run;
    try {
      await run;
    } finally {
      if (currentRun === run) currentRun = undefined;
    }
  };

  return {
    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        void runOnce();
      }, intervalMs);
      timer.unref();
    },
    runOnce,
    async stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      if (currentRun !== undefined) await currentRun;
    }
  };
}
