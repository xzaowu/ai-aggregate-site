import type { StorageCleanupCycleResult } from "./storage-cleanup";

const DEFAULT_INTERVAL_MS = 300_000;
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 86_400_000;

export interface StorageCleanupLogger {
  info(fields: Record<string, string | number>, message?: string): void;
  error(fields: Record<string, string>, message?: string): void;
}

export interface StorageCleanupSchedulerTimer {
  setInterval(callback: () => void, intervalMs: number): NodeJS.Timeout;
  clearInterval(timer: NodeJS.Timeout): void;
}

export interface StorageCleanupSchedulerOptions {
  runCycle(): Promise<StorageCleanupCycleResult>;
  intervalMs?: number;
  readyGraceMs: number;
  batchSize: number;
  logger: StorageCleanupLogger;
  timer?: StorageCleanupSchedulerTimer;
  now?: () => number;
}

export type StorageCleanupSchedulerRunResult =
  | {
      status: "COMPLETED";
      result: StorageCleanupCycleResult;
      durationMs: number;
    }
  | {
      status: "SKIPPED";
      reason: "RUN_IN_PROGRESS" | "SCHEDULER_STOPPED";
    };

export interface StorageCleanupScheduler {
  start(): void;
  runOnce(): Promise<StorageCleanupSchedulerRunResult>;
  stop(): Promise<void>;
}

function validateIntervalMs(intervalMs: number): number {
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < MIN_INTERVAL_MS ||
    intervalMs > MAX_INTERVAL_MS
  ) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_INTERVAL_MS");
  }
  return intervalMs;
}

function validateReadyGraceMs(readyGraceMs: number): number {
  if (!Number.isSafeInteger(readyGraceMs) || readyGraceMs < 0) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_READY_GRACE_MS");
  }
  return readyGraceMs;
}

function validateBatchSize(batchSize: number): number {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_BATCH_SIZE");
  }
  return batchSize;
}

const defaultTimer: StorageCleanupSchedulerTimer = {
  setInterval(callback, intervalMs) {
    return setInterval(callback, intervalMs);
  },
  clearInterval(timer) {
    clearInterval(timer);
  }
};

export function createStorageCleanupScheduler(
  options: StorageCleanupSchedulerOptions
): StorageCleanupScheduler {
  const intervalMs = validateIntervalMs(
    options.intervalMs ?? DEFAULT_INTERVAL_MS
  );
  const readyGraceMs = validateReadyGraceMs(options.readyGraceMs);
  const batchSize = validateBatchSize(options.batchSize);
  const timerApi = options.timer ?? defaultTimer;
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | undefined;
  let currentRun: Promise<StorageCleanupSchedulerRunResult> | undefined;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;

  const runCycle = async (): Promise<StorageCleanupSchedulerRunResult> => {
    const startedAt = now();
    try {
      const result = await options.runCycle();
      const durationMs = now() - startedAt;
      options.logger.info(
        {
          event: "storage-cleanup-cycle-completed",
          ...result,
          durationMs,
          intervalMs,
          readyGraceMs,
          batchSize
        },
        "storage cleanup cycle completed"
      );
      return { status: "COMPLETED", result, durationMs };
    } catch {
      options.logger.error(
        {
          event: "storage-cleanup-cycle-failed",
          errorCode: "STORAGE_CLEANUP_CYCLE_FAILED"
        },
        "storage cleanup cycle failed"
      );
      throw new Error("STORAGE_CLEANUP_CYCLE_FAILED");
    }
  };

  const runOnce = (): Promise<StorageCleanupSchedulerRunResult> => {
    if (currentRun !== undefined) {
      options.logger.info(
        {
          event: "storage-cleanup-cycle-skipped",
          reason: "RUN_IN_PROGRESS"
        },
        "storage cleanup cycle skipped"
      );
      return Promise.resolve({ status: "SKIPPED", reason: "RUN_IN_PROGRESS" });
    }
    if (stopped) {
      return Promise.resolve({ status: "SKIPPED", reason: "SCHEDULER_STOPPED" });
    }

    const run = runCycle();
    currentRun = run;
    void run.then(
      () => {
        if (currentRun === run) currentRun = undefined;
      },
      () => {
        if (currentRun === run) currentRun = undefined;
      }
    );
    return run;
  };

  return {
    start() {
      if (timer !== undefined || stopped) return;
      timer = timerApi.setInterval(() => {
        void runOnce().catch(() => undefined);
      }, intervalMs);
      timer.unref();
    },
    runOnce,
    stop(): Promise<void> {
      if (stopPromise !== undefined) return stopPromise;
      stopped = true;
      if (timer !== undefined) {
        timerApi.clearInterval(timer);
        timer = undefined;
      }
      const runningCycle = currentRun;
      stopPromise = (async () => {
        if (runningCycle === undefined) return;
        try {
          await runningCycle;
        } catch {
          // The cycle logged a fixed safe failure code before rejecting.
        }
      })();
      return stopPromise;
    }
  };
}
