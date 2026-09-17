import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction
} from "vitest";
import {
  createImageRecoveryScheduler,
  type ImageRecoveryLock,
  type ImageRecoveryLockLease,
  type ImageRecoveryLogger,
  type ImageRecoveryScheduler,
  type ImageRecoverySchedulerOptions,
  type ImageRecoveryStore
} from "../src/recovery/image-recovery-scheduler";

type SchedulerTuning = Partial<
  Pick<
    ImageRecoverySchedulerOptions,
    "intervalMs" | "graceMs" | "batchLimit" | "maxBatchesPerRun"
  >
>;

interface SchedulerMocks {
  recover: MockedFunction<ImageRecoveryStore["recoverExpiredImageReservations"]>;
  acquire: MockedFunction<ImageRecoveryLock["acquire"]>;
  release: MockedFunction<ImageRecoveryLockLease["release"]>;
  logger: {
    info: MockedFunction<ImageRecoveryLogger["info"]>;
    warn: MockedFunction<ImageRecoveryLogger["warn"]>;
    error: MockedFunction<ImageRecoveryLogger["error"]>;
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = (_value): void => {};
  let reject: Deferred<T>["reject"] = (_reason): void => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createMocks(): SchedulerMocks {
  const release = vi.fn<ImageRecoveryLockLease["release"]>(async () => undefined);
  return {
    recover: vi.fn<ImageRecoveryStore["recoverExpiredImageReservations"]>(
      async () => ({ scanned: 0, recovered: 0, skipped: 0 })
    ),
    acquire: vi.fn<ImageRecoveryLock["acquire"]>(async () => ({ release })),
    release,
    logger: {
      info: vi.fn<ImageRecoveryLogger["info"]>(),
      warn: vi.fn<ImageRecoveryLogger["warn"]>(),
      error: vi.fn<ImageRecoveryLogger["error"]>()
    }
  };
}

const activeSchedulers: ImageRecoveryScheduler[] = [];

function createScheduler(
  tuning: SchedulerTuning = {},
  mocks: SchedulerMocks = createMocks()
): { scheduler: ImageRecoveryScheduler; mocks: SchedulerMocks } {
  const scheduler = createImageRecoveryScheduler({
    store: { recoverExpiredImageReservations: mocks.recover },
    lock: { acquire: mocks.acquire },
    logger: mocks.logger,
    ...tuning
  });
  activeSchedulers.push(scheduler);
  return { scheduler, mocks };
}

function findInfoEvent(mocks: SchedulerMocks, event: string) {
  return mocks.logger.info.mock.calls.find(([fields]) => fields.event === event)?.[0];
}

describe("image recovery scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-07-14T00:00:00.000Z") });
  });

  afterEach(async () => {
    await Promise.all(activeSchedulers.map((scheduler) => scheduler.stop()));
    activeSchedulers.length = 0;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the documented defaults", async () => {
    const { scheduler, mocks } = createScheduler();

    await scheduler.runOnce();

    expect(mocks.recover).toHaveBeenCalledWith({
      now: new Date("2026-07-14T00:00:00.000Z"),
      graceMs: 120_000,
      limit: 50
    });
    expect(findInfoEvent(mocks, "image-recovery-completed")).toMatchObject({
      intervalMs: 60_000,
      graceMs: 120_000,
      limit: 50,
      maxBatchesPerRun: 5
    });
  });

  it("rejects invalid intervalMs during construction without side effects", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    for (const intervalMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, 86_400_001]) {
      const mocks = createMocks();
      expect(() => createScheduler({ intervalMs }, mocks)).toThrow(TypeError);
      expect(mocks.acquire).not.toHaveBeenCalled();
      expect(mocks.recover).not.toHaveBeenCalled();
    }
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid graceMs during construction", () => {
    for (const graceMs of [-1, 1.5, Number.NaN, 900_001]) {
      const mocks = createMocks();
      expect(() => createScheduler({ graceMs }, mocks)).toThrow(TypeError);
      expect(mocks.acquire).not.toHaveBeenCalled();
      expect(mocks.recover).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid batchLimit during construction", () => {
    for (const batchLimit of [0, -1, 1.5, Number.NaN, 1001]) {
      const mocks = createMocks();
      expect(() => createScheduler({ batchLimit }, mocks)).toThrow(TypeError);
      expect(mocks.acquire).not.toHaveBeenCalled();
      expect(mocks.recover).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid maxBatchesPerRun during construction", () => {
    for (const maxBatchesPerRun of [0, -1, 1.5, Number.NaN, 101]) {
      const mocks = createMocks();
      expect(() => createScheduler({ maxBatchesPerRun }, mocks)).toThrow(TypeError);
      expect(mocks.acquire).not.toHaveBeenCalled();
      expect(mocks.recover).not.toHaveBeenCalled();
    }
  });

  it("waits a full interval before the first automatic run", async () => {
    const { scheduler, mocks } = createScheduler({ intervalMs: 100 });

    scheduler.start();
    expect(mocks.acquire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.acquire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
  });

  it("unrefs the interval timer", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { scheduler } = createScheduler({ intervalMs: 100 });

    scheduler.start();

    const timer = setIntervalSpy.mock.results[0]?.value;
    expect(timer?.hasRef()).toBe(false);
  });

  it("does not create a second timer when start is repeated", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { scheduler } = createScheduler({ intervalMs: 100 });

    scheduler.start();
    scheduler.start();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("calls the Store and releases once after acquiring the lock", async () => {
    const { scheduler, mocks } = createScheduler();

    await scheduler.runOnce();

    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("skips Store and release when the lock is not acquired", async () => {
    const mocks = createMocks();
    mocks.acquire.mockResolvedValue(null);
    const { scheduler } = createScheduler({}, mocks);

    await scheduler.runOnce();

    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(findInfoEvent(mocks, "image-recovery-skipped")).toMatchObject({
      reason: "lock-not-acquired"
    });
  });

  it("contains acquire errors and clears running state for the next run", async () => {
    const mocks = createMocks();
    mocks.acquire.mockRejectedValueOnce(new TypeError("lock unavailable"));
    const { scheduler } = createScheduler({}, mocks);

    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    await expect(scheduler.runOnce()).resolves.toBeUndefined();

    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      {
        event: "image-recovery-lock-acquire-failed",
        errorType: "TypeError"
      },
      "image recovery lock acquire failed"
    );
  });

  it("releases the lease when Store recovery throws", async () => {
    const mocks = createMocks();
    mocks.recover.mockRejectedValueOnce(new RangeError("store failed"));
    const { scheduler } = createScheduler({}, mocks);

    await expect(scheduler.runOnce()).resolves.toBeUndefined();

    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(findInfoEvent(mocks, "image-recovery-completed")).toBeUndefined();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      { event: "image-recovery-failed", errorType: "RangeError" },
      "image recovery failed"
    );
  });

  it("runs successfully on the next interval after a Store error", async () => {
    const mocks = createMocks();
    mocks.recover.mockRejectedValueOnce(new Error("first run failed"));
    const { scheduler } = createScheduler({ intervalMs: 100 }, mocks);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.recover).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledTimes(2);
    expect(findInfoEvent(mocks, "image-recovery-completed")).toBeDefined();
  });

  it("contains release errors and runs successfully on the next interval", async () => {
    const mocks = createMocks();
    mocks.release.mockRejectedValueOnce(new Error("release failed"));
    const { scheduler } = createScheduler({ intervalMs: 100 }, mocks);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.recover).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledTimes(2);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      {
        event: "image-recovery-lock-release-failed",
        errorType: "Error"
      },
      "image recovery lock release failed"
    );
  });

  it("stops after one batch when scanned is below batchLimit", async () => {
    const mocks = createMocks();
    mocks.recover.mockResolvedValue({ scanned: 9, recovered: 8, skipped: 1 });
    const { scheduler } = createScheduler({ batchLimit: 10 }, mocks);

    await scheduler.runOnce();

    expect(mocks.recover).toHaveBeenCalledTimes(1);
  });

  it("continues draining when scanned equals batchLimit", async () => {
    const mocks = createMocks();
    mocks.recover
      .mockResolvedValueOnce({ scanned: 10, recovered: 9, skipped: 1 })
      .mockResolvedValueOnce({ scanned: 3, recovered: 2, skipped: 1 });
    const { scheduler } = createScheduler({ batchLimit: 10 }, mocks);

    await scheduler.runOnce();

    expect(mocks.recover).toHaveBeenCalledTimes(2);
  });

  it("stops draining at maxBatchesPerRun", async () => {
    const mocks = createMocks();
    mocks.recover.mockResolvedValue({ scanned: 2, recovered: 2, skipped: 0 });
    const { scheduler } = createScheduler(
      { batchLimit: 2, maxBatchesPerRun: 3 },
      mocks
    );

    await scheduler.runOnce();

    expect(mocks.recover).toHaveBeenCalledTimes(3);
  });

  it("passes the identical fixed now to every batch", async () => {
    const mocks = createMocks();
    mocks.recover
      .mockResolvedValueOnce({ scanned: 1, recovered: 1, skipped: 0 })
      .mockResolvedValueOnce({ scanned: 0, recovered: 0, skipped: 0 });
    const { scheduler } = createScheduler({ batchLimit: 1 }, mocks);

    await scheduler.runOnce();

    const firstNow = mocks.recover.mock.calls[0]?.[0]?.now;
    const secondNow = mocks.recover.mock.calls[1]?.[0]?.now;
    expect(firstNow).toBeInstanceOf(Date);
    expect(secondNow).toBe(firstNow);
  });

  it("logs correct aggregate counts and scheduler fields", async () => {
    const mocks = createMocks();
    mocks.recover
      .mockResolvedValueOnce({ scanned: 4, recovered: 3, skipped: 1 })
      .mockResolvedValueOnce({ scanned: 2, recovered: 1, skipped: 1 });
    const { scheduler } = createScheduler(
      { intervalMs: 200, graceMs: 300, batchLimit: 4, maxBatchesPerRun: 2 },
      mocks
    );

    await scheduler.runOnce();

    expect(findInfoEvent(mocks, "image-recovery-completed")).toEqual({
      event: "image-recovery-completed",
      scanned: 6,
      recovered: 4,
      skipped: 2,
      batches: 2,
      durationMs: 0,
      intervalMs: 200,
      graceMs: 300,
      limit: 4,
      maxBatchesPerRun: 2
    });
  });

  it("does not reenter while a long Store run is pending", async () => {
    const deferred = createDeferred<{ scanned: number; recovered: number; skipped: number }>();
    const mocks = createMocks();
    mocks.recover.mockReturnValueOnce(deferred.promise);
    const { scheduler } = createScheduler({ intervalMs: 100 }, mocks);
    scheduler.start();

    try {
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.acquire).toHaveBeenCalledTimes(1);
      expect(mocks.recover).toHaveBeenCalledTimes(1);
      expect(findInfoEvent(mocks, "image-recovery-skipped")).toMatchObject({
        reason: "run-in-progress"
      });
    } finally {
      deferred.resolve({ scanned: 0, recovered: 0, skipped: 0 });
      await scheduler.stop();
    }
  });

  it("establishes the running guard before acquire and does not queue reentry", async () => {
    const deferred = createDeferred<ImageRecoveryLockLease | null>();
    const mocks = createMocks();
    mocks.acquire.mockReturnValueOnce(deferred.promise);
    const { scheduler } = createScheduler({}, mocks);
    let firstRun: Promise<void> | undefined;

    try {
      firstRun = scheduler.runOnce();
      await Promise.resolve();
      expect(mocks.acquire).toHaveBeenCalledTimes(1);

      await scheduler.runOnce();

      expect(mocks.acquire).toHaveBeenCalledTimes(1);
      expect(mocks.recover).not.toHaveBeenCalled();
      expect(findInfoEvent(mocks, "image-recovery-skipped")).toMatchObject({
        reason: "run-in-progress"
      });
    } finally {
      deferred.resolve({ release: mocks.release });
      await firstRun;
    }

    expect(mocks.recover).toHaveBeenCalledTimes(1);
    await scheduler.runOnce();
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.recover).toHaveBeenCalledTimes(2);
  });

  it("allows the next interval after a pending run completes", async () => {
    const deferred = createDeferred<{ scanned: number; recovered: number; skipped: number }>();
    const mocks = createMocks();
    mocks.recover.mockReturnValueOnce(deferred.promise);
    const { scheduler } = createScheduler({ intervalMs: 100 }, mocks);
    scheduler.start();
    let pending = true;

    try {
      await vi.advanceTimersByTimeAsync(100);
      deferred.resolve({ scanned: 0, recovered: 0, skipped: 0 });
      pending = false;
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.acquire).toHaveBeenCalledTimes(2);
      expect(mocks.recover).toHaveBeenCalledTimes(2);
    } finally {
      if (pending) deferred.resolve({ scanned: 0, recovered: 0, skipped: 0 });
      await scheduler.stop();
    }
  });

  it("stop clears the timer and prevents later automatic ticks", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { scheduler, mocks } = createScheduler({ intervalMs: 100 });
    scheduler.start();

    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(500);

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("stop waits for the current sweep without cancelling it", async () => {
    const deferred = createDeferred<{ scanned: number; recovered: number; skipped: number }>();
    const mocks = createMocks();
    mocks.recover.mockReturnValueOnce(deferred.promise);
    const { scheduler } = createScheduler({}, mocks);
    const run = scheduler.runOnce();
    let pending = true;
    let stop: Promise<void> | undefined;

    try {
      await Promise.resolve();
      await Promise.resolve();

      let stopped = false;
      stop = scheduler.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);

      deferred.resolve({ scanned: 0, recovered: 0, skipped: 0 });
      pending = false;
      await run;
      await stop;
      expect(stopped).toBe(true);
      expect(mocks.release).toHaveBeenCalledTimes(1);
    } finally {
      if (pending) deferred.resolve({ scanned: 0, recovered: 0, skipped: 0 });
      await run;
      await stop;
      await scheduler.stop();
    }
  });

  it("supports repeated stop calls", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { scheduler } = createScheduler({ intervalMs: 100 });
    scheduler.start();

    await scheduler.stop();
    await scheduler.stop();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("supports stop before start", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { scheduler, mocks } = createScheduler();

    await expect(scheduler.stop()).resolves.toBeUndefined();

    expect(clearIntervalSpy).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
});
