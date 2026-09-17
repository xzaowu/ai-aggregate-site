import {
  createLocalStorageObjectFileRemover,
  type LocalStorageObjectFileRemover
} from "./asset-storage";
import {
  createStorageCleanupScheduler,
  type StorageCleanupLogger,
  type StorageCleanupScheduler,
  type StorageCleanupSchedulerOptions
} from "./storage-cleanup-scheduler";
import { runStorageCleanupCycle } from "./storage-cleanup";
import type { StorageObjectCleanupStore } from "./store";

const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_READY_GRACE_MS = 3_600_000;
const DEFAULT_BATCH_SIZE = 10;

export interface StorageCleanupService {
  ready(): Promise<void>;
  close(): Promise<void>;
}

export type StorageCleanupSchedulerFactory = (
  options: StorageCleanupSchedulerOptions
) => StorageCleanupScheduler;

export type StorageCleanupFileRemoverFactory = (options: {
  baseDir: string;
}) => LocalStorageObjectFileRemover;

export interface CreateStorageCleanupServiceFromEnvOptions {
  env: Partial<NodeJS.ProcessEnv>;
  store: object;
  generatedAssetsDir: string;
  logger: StorageCleanupLogger;
  schedulerFactory?: StorageCleanupSchedulerFactory;
  fileRemoverFactory?: StorageCleanupFileRemoverFactory;
}

interface EnabledStorageCleanupConfig {
  intervalMs: number;
  readyGraceMs: number;
  batchSize: number;
}

function isStorageCleanupEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new TypeError("INVALID_STORAGE_CLEANUP_ENABLED");
}

function parseIntegerEnv(
  env: Partial<NodeJS.ProcessEnv>,
  name: "STORAGE_CLEANUP_INTERVAL_MS" | "STORAGE_CLEANUP_READY_GRACE_MS" | "STORAGE_CLEANUP_BATCH_SIZE",
  fallback: number,
  isValid: (value: number) => boolean
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/u.test(raw)) {
    throw new TypeError(`INVALID_${name}`);
  }

  const value = Number(raw);
  if (!isValid(value)) {
    throw new TypeError(`INVALID_${name}`);
  }
  return value;
}

function resolveEnabledConfig(
  env: Partial<NodeJS.ProcessEnv>
): EnabledStorageCleanupConfig {
  return {
    intervalMs: parseIntegerEnv(
      env,
      "STORAGE_CLEANUP_INTERVAL_MS",
      DEFAULT_INTERVAL_MS,
      (value) =>
        Number.isSafeInteger(value) && value >= 1_000 && value <= 86_400_000
    ),
    readyGraceMs: parseIntegerEnv(
      env,
      "STORAGE_CLEANUP_READY_GRACE_MS",
      DEFAULT_READY_GRACE_MS,
      (value) => Number.isSafeInteger(value) && value >= 0
    ),
    batchSize: parseIntegerEnv(
      env,
      "STORAGE_CLEANUP_BATCH_SIZE",
      DEFAULT_BATCH_SIZE,
      (value) => Number.isInteger(value) && value >= 1 && value <= 100
    )
  };
}

function isStorageObjectCleanupStore(
  value: object
): value is StorageObjectCleanupStore {
  return (
    typeof Reflect.get(
      value,
      "listReadyGeneratedStorageObjectCleanupCandidates"
    ) === "function" &&
    typeof Reflect.get(
      value,
      "listDeletedGeneratedStorageObjectCleanupCandidates"
    ) === "function" &&
    typeof Reflect.get(
      value,
      "tombstoneReadyGeneratedStorageObjectForCleanup"
    ) === "function" &&
    typeof Reflect.get(
      value,
      "prepareDeletedGeneratedStorageObjectForPurge"
    ) === "function" &&
    typeof Reflect.get(
      value,
      "finalizeDeletedGeneratedStorageObjectPurge"
    ) === "function"
  );
}

function createDisabledService(): StorageCleanupService {
  return {
    async ready(): Promise<void> {},
    async close(): Promise<void> {}
  };
}

export function createStorageCleanupServiceFromEnv(
  options: CreateStorageCleanupServiceFromEnvOptions
): StorageCleanupService {
  if (!isStorageCleanupEnabled(options.env.STORAGE_CLEANUP_ENABLED)) {
    return createDisabledService();
  }

  const config = resolveEnabledConfig(options.env);
  const store = options.store;
  if (!isStorageObjectCleanupStore(store)) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_STORE");
  }

  const fileRemoverFactory =
    options.fileRemoverFactory ?? createLocalStorageObjectFileRemover;
  const schedulerFactory =
    options.schedulerFactory ?? createStorageCleanupScheduler;
  const fileRemover = fileRemoverFactory({
    baseDir: options.generatedAssetsDir
  });
  const scheduler = schedulerFactory({
    intervalMs: config.intervalMs,
    readyGraceMs: config.readyGraceMs,
    batchSize: config.batchSize,
    logger: options.logger,
    runCycle: () =>
      runStorageCleanupCycle({
        store,
        fileRemover,
        now: new Date(),
        readyGraceMs: config.readyGraceMs,
        batchSize: config.batchSize
      })
  });
  let readyStarted = false;
  let closeStarted = false;
  let closePromise: Promise<void> | undefined;

  return {
    ready(): Promise<void> {
      if (!readyStarted && !closeStarted) {
        readyStarted = true;
        scheduler.start();
      }
      return Promise.resolve();
    },
    close(): Promise<void> {
      closeStarted = true;
      if (closePromise === undefined) {
        closePromise = Promise.resolve().then(() => scheduler.stop());
      }
      return closePromise;
    }
  };
}
