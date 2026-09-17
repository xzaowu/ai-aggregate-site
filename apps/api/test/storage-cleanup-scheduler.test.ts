import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStorageCleanupScheduler,
  type StorageCleanupLogger,
  type StorageCleanupSchedulerTimer
} from "../src/storage-cleanup-scheduler";
import type { StorageCleanupCycleResult } from "../src/storage-cleanup";

function createResult(
  overrides: Partial<StorageCleanupCycleResult> = {}
): StorageCleanupCycleResult {
  return {
    scannedReady: 1,
    claimedReady: 1,
    scannedDeleted: 0,
    skippedReferenced: 0,
    skippedIneligible: 0,
    lostRaces: 0,
    removedFiles: 1,
    missingFiles: 0,
    purgedRows: 1,
    alreadyPurgedRows: 0,
    deleteFailures: 0,
    dbFailures: 0,
    ...overrides
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) {
        throw new Error("TEST_DEFERRED_RESOLVER_MISSING");
      }
      resolvePromise(value);
    }
  };
}

function createLogger() {
  const info = vi.fn<StorageCleanupLogger["info"]>();
  const error = vi.fn<StorageCleanupLogger["error"]>();
  return { logger: { info, error }, info, error };
}

function createTimer() {
  let callback: (() => void) | undefined;
  const handle = globalThis.setInterval(() => undefined, 60_000);
  const unref = vi.spyOn(handle, "unref");
  const setIntervalMock = vi.fn<StorageCleanupSchedulerTimer["setInterval"]>(
    (nextCallback) => {
      callback = nextCallback;
      return handle;
    }
  );
  const clearIntervalGlobal = globalThis.clearInterval;
  const clearIntervalMock = vi.fn<StorageCleanupSchedulerTimer["clearInterval"]>(
    (timer) => {
      clearIntervalGlobal(timer);
    }
  );

  return {
    timer: { setInterval: setIntervalMock, clearInterval: clearIntervalMock },
    setInterval: setIntervalMock,
    clearInterval: clearIntervalMock,
    unref,
    trigger() {
      if (callback === undefined) {
        throw new Error("TEST_TIMER_CALLBACK_MISSING");
      }
      callback();
    },
    dispose() {
      clearIntervalGlobal(handle);
    }
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("createStorageCleanupScheduler", () => {
  const timers: Array<ReturnType<typeof createTimer>> = [];

  afterEach(() => {
    for (const timer of timers.splice(0)) {
      timer.dispose();
    }
  });

  function createTestScheduler(
    runCycle: () => Promise<StorageCleanupCycleResult>,
    options: Partial<{
      intervalMs: number;
      now: () => number;
    }> = {}
  ) {
    const logger = createLogger();
    const timer = createTimer();
    timers.push(timer);
    const scheduler = createStorageCleanupScheduler({
      runCycle,
      intervalMs: options.intervalMs ?? 1_000,
      readyGraceMs: 0,
      batchSize: 1,
      logger: logger.logger,
      timer: timer.timer,
      now: options.now
    });
    return { scheduler, logger, timer };
  }

  it("creates one unrefed interval without running a cycle at start", async () => {
    const runCycle = vi.fn(async () => createResult());
    const { scheduler, timer } = createTestScheduler(runCycle);

    scheduler.start();
    scheduler.start();

    expect(timer.setInterval).toHaveBeenCalledTimes(1);
    expect(timer.setInterval).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(timer.unref).toHaveBeenCalledTimes(1);
    expect(runCycle).not.toHaveBeenCalled();
    await scheduler.stop();
  });

  it("runs a cycle when the interval fires", async () => {
    const runCycle = vi.fn(async () => createResult());
    const { scheduler, timer } = createTestScheduler(runCycle);

    scheduler.start();
    timer.trigger();
    await flushMicrotasks();

    expect(runCycle).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it("skips an overlapping run and permits the next run after completion", async () => {
    const deferred = createDeferred<StorageCleanupCycleResult>();
    const runCycle = vi.fn(() => deferred.promise);
    const { scheduler, logger } = createTestScheduler(runCycle);

    const first = scheduler.runOnce();
    const second = await scheduler.runOnce();

    expect(second).toEqual({ status: "SKIPPED", reason: "RUN_IN_PROGRESS" });
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: "storage-cleanup-cycle-skipped",
        reason: "RUN_IN_PROGRESS"
      },
      "storage cleanup cycle skipped"
    );

    deferred.resolve(createResult());
    await expect(first).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(scheduler.runOnce()).resolves.toMatchObject({
      status: "COMPLETED"
    });
    expect(runCycle).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("logs only the aggregate completed-cycle fields", async () => {
    let timestamp = 100;
    const runCycle = vi.fn(async () => createResult({ dbFailures: 2 }));
    const { scheduler, logger } = createTestScheduler(runCycle, {
      intervalMs: 2_000,
      now: () => {
        timestamp += 25;
        return timestamp;
      }
    });

    await expect(scheduler.runOnce()).resolves.toEqual({
      status: "COMPLETED",
      result: createResult({ dbFailures: 2 }),
      durationMs: 25
    });
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: "storage-cleanup-cycle-completed",
        ...createResult({ dbFailures: 2 }),
        durationMs: 25,
        intervalMs: 2_000,
        readyGraceMs: 0,
        batchSize: 1
      },
      "storage cleanup cycle completed"
    );
    await scheduler.stop();
  });

  it("records a fixed failure code without the original error message", async () => {
    const secretMessage = "database failure with private-object-key";
    const runCycle = vi.fn(async () => {
      throw new Error(secretMessage);
    });
    const { scheduler, logger } = createTestScheduler(runCycle);

    await expect(scheduler.runOnce()).rejects.toThrow(
      "STORAGE_CLEANUP_CYCLE_FAILED"
    );
    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "storage-cleanup-cycle-failed",
        errorCode: "STORAGE_CLEANUP_CYCLE_FAILED"
      },
      "storage cleanup cycle failed"
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretMessage);
    await scheduler.stop();
  });

  it("swallows timer-triggered failures after recording the fixed failure code", async () => {
    const unhandledRejection = vi.fn();
    const secretMessage = "timer failure private-object-key";
    const runCycle = vi.fn(async () => {
      throw new Error(secretMessage);
    });
    const { scheduler, timer, logger } = createTestScheduler(runCycle);

    process.on("unhandledRejection", unhandledRejection);
    scheduler.start();
    timer.trigger();
    await flushMicrotasks();
    process.removeListener("unhandledRejection", unhandledRejection);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(unhandledRejection).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretMessage);
    await scheduler.stop();
  });

  it("clears the timer and waits for the active cycle without cancelling it", async () => {
    const deferred = createDeferred<StorageCleanupCycleResult>();
    const runCycle = vi.fn(() => deferred.promise);
    const { scheduler, timer } = createTestScheduler(runCycle);

    scheduler.start();
    const run = scheduler.runOnce();
    const stop = scheduler.stop();
    let stopped = false;
    void stop.then(() => {
      stopped = true;
    });
    await flushMicrotasks();

    expect(timer.clearInterval).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(false);
    expect(runCycle).toHaveBeenCalledTimes(1);

    deferred.resolve(createResult());
    await expect(run).resolves.toMatchObject({ status: "COMPLETED" });
    await stop;
    expect(stopped).toBe(true);
  });

  it("is safe to stop repeatedly and does not run after stop", async () => {
    const runCycle = vi.fn(async () => createResult());
    const { scheduler, timer } = createTestScheduler(runCycle);

    scheduler.start();
    const firstStop = scheduler.stop();
    const secondStop = scheduler.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;

    timer.trigger();
    await flushMicrotasks();
    expect(runCycle).not.toHaveBeenCalled();
  });

  it.each([999, 86_400_001, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid intervalMs: %s",
    (intervalMs) => {
      const logger = createLogger();
      expect(() =>
        createStorageCleanupScheduler({
          runCycle: async () => createResult(),
          intervalMs,
          readyGraceMs: 0,
          batchSize: 1,
          logger: logger.logger
        })
      ).toThrow("INVALID_STORAGE_CLEANUP_INTERVAL_MS");
    }
  );
});
