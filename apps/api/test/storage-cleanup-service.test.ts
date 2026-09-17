import { describe, expect, it, vi } from "vitest";
import type { LocalStorageObjectFileRemover } from "../src/asset-storage";
import {
  createStorageCleanupServiceFromEnv,
  type StorageCleanupFileRemoverFactory,
  type StorageCleanupSchedulerFactory
} from "../src/storage-cleanup-service";
import type {
  StorageCleanupLogger,
  StorageCleanupScheduler,
  StorageCleanupSchedulerOptions
} from "../src/storage-cleanup-scheduler";
import type { StorageObjectCleanupStore } from "../src/store";

function createStore(): StorageObjectCleanupStore {
  return {
    async listReadyGeneratedStorageObjectCleanupCandidates() {
      return [];
    },
    async listDeletedGeneratedStorageObjectCleanupCandidates() {
      return [];
    },
    async tombstoneReadyGeneratedStorageObjectForCleanup() {
      return { status: "NOT_FOUND" };
    },
    async prepareDeletedGeneratedStorageObjectForPurge() {
      return { status: "NOT_FOUND" };
    },
    async finalizeDeletedGeneratedStorageObjectPurge() {
      return { status: "ALREADY_PURGED" };
    }
  };
}

function createLogger(): StorageCleanupLogger {
  return {
    info: vi.fn<StorageCleanupLogger["info"]>(),
    error: vi.fn<StorageCleanupLogger["error"]>()
  };
}

function createFileRemover(): LocalStorageObjectFileRemover {
  return {
    async removeLocalStorageObjectFile() {
      return { status: "NOT_FOUND" };
    }
  };
}

function createScheduler() {
  const start = vi.fn<StorageCleanupScheduler["start"]>();
  const runOnce = vi.fn<StorageCleanupScheduler["runOnce"]>(async () => ({
    status: "SKIPPED",
    reason: "SCHEDULER_STOPPED"
  }));
  const stop = vi.fn<StorageCleanupScheduler["stop"]>(async () => undefined);
  const scheduler: StorageCleanupScheduler = { start, runOnce, stop };
  return { scheduler, start, stop };
}

function createSchedulerFactory(
  scheduler: StorageCleanupScheduler
): {
  schedulerFactory: StorageCleanupSchedulerFactory;
  receivedOptions(): StorageCleanupSchedulerOptions | undefined;
} {
  let options: StorageCleanupSchedulerOptions | undefined;
  return {
    schedulerFactory(nextOptions) {
      options = nextOptions;
      return scheduler;
    },
    receivedOptions() {
      return options;
    }
  };
}

function createFileRemoverFactory(
  fileRemover: LocalStorageObjectFileRemover
): {
  fileRemoverFactory: StorageCleanupFileRemoverFactory;
  calls: Array<{ baseDir: string }>;
} {
  const calls: Array<{ baseDir: string }> = [];
  return {
    fileRemoverFactory(options) {
      calls.push(options);
      return fileRemover;
    },
    calls
  };
}

function createEnabledService(
  env: Partial<NodeJS.ProcessEnv> = {}
) {
  const schedulerSpy = createScheduler();
  const schedulerFactory = createSchedulerFactory(schedulerSpy.scheduler);
  const removerFactory = createFileRemoverFactory(createFileRemover());
  const service = createStorageCleanupServiceFromEnv({
    env: { STORAGE_CLEANUP_ENABLED: "1", ...env },
    store: createStore(),
    generatedAssetsDir: "/tmp/storage-cleanup-test",
    logger: createLogger(),
    schedulerFactory: schedulerFactory.schedulerFactory,
    fileRemoverFactory: removerFactory.fileRemoverFactory
  });
  return { service, schedulerSpy, schedulerFactory, removerFactory };
}

describe("createStorageCleanupServiceFromEnv", () => {
  it("returns a disabled no-op service when STORAGE_CLEANUP_ENABLED is absent", async () => {
    const service = createStorageCleanupServiceFromEnv({
      env: {},
      store: {},
      generatedAssetsDir: "relative-directory-is-never-read",
      logger: createLogger()
    });

    await service.ready();
    await service.close();
  });

  it("returns a disabled no-op service when STORAGE_CLEANUP_ENABLED is 0", async () => {
    const service = createStorageCleanupServiceFromEnv({
      env: { STORAGE_CLEANUP_ENABLED: "0" },
      store: {},
      generatedAssetsDir: "relative-directory-is-never-read",
      logger: createLogger()
    });

    await service.ready();
    await service.close();
  });

  it("does not validate other cleanup configuration or construct a remover while disabled", async () => {
    const removerFactory = createFileRemoverFactory(createFileRemover());
    const schedulerFactory = createSchedulerFactory(createScheduler().scheduler);
    const service = createStorageCleanupServiceFromEnv({
      env: {
        STORAGE_CLEANUP_ENABLED: "0",
        STORAGE_CLEANUP_INTERVAL_MS: "not-an-integer",
        STORAGE_CLEANUP_READY_GRACE_MS: "-1",
        STORAGE_CLEANUP_BATCH_SIZE: "101"
      },
      store: {},
      generatedAssetsDir: "relative-directory-is-never-read",
      logger: createLogger(),
      schedulerFactory: schedulerFactory.schedulerFactory,
      fileRemoverFactory: removerFactory.fileRemoverFactory
    });

    await service.ready();
    await service.close();
    expect(removerFactory.calls).toEqual([]);
    expect(schedulerFactory.receivedOptions()).toBeUndefined();
  });

  it("keeps disabled ready and close idempotent", async () => {
    const service = createStorageCleanupServiceFromEnv({
      env: {},
      store: {},
      generatedAssetsDir: "relative-directory-is-never-read",
      logger: createLogger()
    });

    await service.ready();
    await service.ready();
    await service.close();
    await service.close();
  });

  it.each(["", "true", "2", " 1"]) (
    "rejects invalid STORAGE_CLEANUP_ENABLED synchronously: %s",
    (value) => {
      expect(() =>
        createStorageCleanupServiceFromEnv({
          env: { STORAGE_CLEANUP_ENABLED: value },
          store: {},
          generatedAssetsDir: "/tmp/storage-cleanup-test",
          logger: createLogger()
        })
      ).toThrow("INVALID_STORAGE_CLEANUP_ENABLED");
    }
  );

  it("uses the enabled default configuration and controlled file remover", () => {
    const { schedulerFactory, removerFactory } = createEnabledService();

    expect(removerFactory.calls).toEqual([
      { baseDir: "/tmp/storage-cleanup-test" }
    ]);
    expect(schedulerFactory.receivedOptions()).toMatchObject({
      intervalMs: 300_000,
      readyGraceMs: 3_600_000,
      batchSize: 10
    });
  });

  it.each([1_000, 86_400_000])(
    "accepts interval boundary: %s",
    (intervalMs) => {
      const { schedulerFactory } = createEnabledService({
        STORAGE_CLEANUP_INTERVAL_MS: String(intervalMs)
      });
      expect(schedulerFactory.receivedOptions()?.intervalMs).toBe(intervalMs);
    }
  );

  it.each(["999", "86400001", "1.5", "1e3", ""]) (
    "rejects invalid interval: %s",
    (value) => {
      expect(() =>
        createEnabledService({ STORAGE_CLEANUP_INTERVAL_MS: value })
      ).toThrow("INVALID_STORAGE_CLEANUP_INTERVAL_MS");
    }
  );

  it("allows a zero READY grace interval", () => {
    const { schedulerFactory } = createEnabledService({
      STORAGE_CLEANUP_READY_GRACE_MS: "0"
    });
    expect(schedulerFactory.receivedOptions()?.readyGraceMs).toBe(0);
  });

  it.each(["-1", "1.5", "9007199254740992", ""]) (
    "rejects invalid READY grace interval: %s",
    (value) => {
      expect(() =>
        createEnabledService({ STORAGE_CLEANUP_READY_GRACE_MS: value })
      ).toThrow("INVALID_STORAGE_CLEANUP_READY_GRACE_MS");
    }
  );

  it.each([1, 100])("accepts batch boundary: %s", (batchSize) => {
    const { schedulerFactory } = createEnabledService({
      STORAGE_CLEANUP_BATCH_SIZE: String(batchSize)
    });
    expect(schedulerFactory.receivedOptions()?.batchSize).toBe(batchSize);
  });

  it.each(["0", "101", "1.5", ""]) (
    "rejects invalid batch size: %s",
    (value) => {
      expect(() =>
        createEnabledService({ STORAGE_CLEANUP_BATCH_SIZE: value })
      ).toThrow("INVALID_STORAGE_CLEANUP_BATCH_SIZE");
    }
  );

  it("starts the enabled scheduler once and closes it once", async () => {
    const { service, schedulerSpy } = createEnabledService();

    await service.ready();
    await service.ready();
    expect(schedulerSpy.start).toHaveBeenCalledTimes(1);

    await service.close();
    await service.close();
    expect(schedulerSpy.stop).toHaveBeenCalledTimes(1);
  });

  it("waits for scheduler stop to finish", async () => {
    let resolveStop: (() => void) | undefined;
    const stopPromise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const { service, schedulerSpy } = createEnabledService();
    schedulerSpy.stop.mockImplementationOnce(async () => stopPromise);

    const close = service.close();
    let closed = false;
    void close.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    if (resolveStop === undefined) {
      throw new Error("TEST_STOP_RESOLVER_MISSING");
    }
    resolveStop();
    await close;
    expect(closed).toBe(true);
  });

  it("is safe to close before ready and never starts after close", async () => {
    const { service, schedulerSpy } = createEnabledService();

    await service.close();
    await service.ready();

    expect(schedulerSpy.stop).toHaveBeenCalledTimes(1);
    expect(schedulerSpy.start).not.toHaveBeenCalled();
  });

  it("rejects invalid enabled configuration before constructing a scheduler", () => {
    const schedulerSpy = createScheduler();
    const schedulerFactory = createSchedulerFactory(schedulerSpy.scheduler);
    const removerFactory = createFileRemoverFactory(createFileRemover());

    expect(() =>
      createStorageCleanupServiceFromEnv({
        env: {
          STORAGE_CLEANUP_ENABLED: "1",
          STORAGE_CLEANUP_INTERVAL_MS: "999"
        },
        store: createStore(),
        generatedAssetsDir: "/tmp/storage-cleanup-test",
        logger: createLogger(),
        schedulerFactory: schedulerFactory.schedulerFactory,
        fileRemoverFactory: removerFactory.fileRemoverFactory
      })
    ).toThrow("INVALID_STORAGE_CLEANUP_INTERVAL_MS");
    expect(removerFactory.calls).toEqual([]);
    expect(schedulerFactory.receivedOptions()).toBeUndefined();
  });
});
