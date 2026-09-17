import type { LocalStorageObjectFileRemover } from "./asset-storage";
import type {
  FinalizeDeletedGeneratedStorageObjectPurgeResult,
  PrepareDeletedGeneratedStorageObjectForPurgeResult,
  StorageObjectCleanupStore,
  TombstoneReadyGeneratedStorageObjectForCleanupResult
} from "./store";

export interface StorageCleanupCycleInput {
  store: StorageObjectCleanupStore;
  fileRemover: LocalStorageObjectFileRemover;
  now: Date;
  readyGraceMs: number;
  batchSize: number;
}

export interface StorageCleanupCycleResult {
  scannedReady: number;
  claimedReady: number;
  scannedDeleted: number;
  skippedReferenced: number;
  skippedIneligible: number;
  lostRaces: number;
  removedFiles: number;
  missingFiles: number;
  purgedRows: number;
  alreadyPurgedRows: number;
  deleteFailures: number;
  dbFailures: number;
}

function createEmptyResult(): StorageCleanupCycleResult {
  return {
    scannedReady: 0,
    claimedReady: 0,
    scannedDeleted: 0,
    skippedReferenced: 0,
    skippedIneligible: 0,
    lostRaces: 0,
    removedFiles: 0,
    missingFiles: 0,
    purgedRows: 0,
    alreadyPurgedRows: 0,
    deleteFailures: 0,
    dbFailures: 0
  };
}

function validateCycleInput(input: StorageCleanupCycleInput): Date {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_NOW");
  }
  if (
    !Number.isSafeInteger(input.readyGraceMs) ||
    input.readyGraceMs < 0
  ) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_READY_GRACE_MS");
  }
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 100
  ) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_BATCH_SIZE");
  }

  const readyBefore = new Date(input.now.getTime() - input.readyGraceMs);
  if (!Number.isFinite(readyBefore.getTime())) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_READY_GRACE_MS");
  }

  return readyBefore;
}

function recordTombstoneResult(
  result: StorageCleanupCycleResult,
  tombstone: Exclude<
    TombstoneReadyGeneratedStorageObjectForCleanupResult,
    { status: "CLAIMED" }
  >
): void {
  if (tombstone.status === "SKIPPED_REFERENCED") {
    result.skippedReferenced += 1;
    return;
  }
  if (tombstone.status === "LOST_RACE") {
    result.lostRaces += 1;
    return;
  }

  result.skippedIneligible += 1;
}

function recordPrepareResult(
  result: StorageCleanupCycleResult,
  prepared: Exclude<
    PrepareDeletedGeneratedStorageObjectForPurgeResult,
    { status: "PREPARED" }
  >
): void {
  if (prepared.status === "SKIPPED_REFERENCED") {
    result.skippedReferenced += 1;
    return;
  }

  result.skippedIneligible += 1;
}

function recordFinalizeResult(
  result: StorageCleanupCycleResult,
  finalized: FinalizeDeletedGeneratedStorageObjectPurgeResult
): void {
  if (finalized.status === "PURGED") {
    result.purgedRows += 1;
    return;
  }
  if (finalized.status === "ALREADY_PURGED") {
    result.alreadyPurgedRows += 1;
    return;
  }
  if (finalized.status === "SKIPPED_REFERENCED") {
    result.skippedReferenced += 1;
    return;
  }

  result.skippedIneligible += 1;
}

async function removePreparedStorageObjectFile(input: {
  store: StorageObjectCleanupStore;
  fileRemover: LocalStorageObjectFileRemover;
  storageObjectId: string;
  objectKey: string;
  result: StorageCleanupCycleResult;
}): Promise<void> {
  let fileResult;
  try {
    fileResult = await input.fileRemover.removeLocalStorageObjectFile(
      input.objectKey
    );
  } catch {
    input.result.deleteFailures += 1;
    return;
  }

  if (fileResult.status === "REMOVED") {
    input.result.removedFiles += 1;
  } else if (fileResult.status === "NOT_FOUND") {
    input.result.missingFiles += 1;
  } else {
    input.result.deleteFailures += 1;
    return;
  }

  let finalized: FinalizeDeletedGeneratedStorageObjectPurgeResult;
  try {
    finalized = await input.store.finalizeDeletedGeneratedStorageObjectPurge(
      input.storageObjectId
    );
  } catch {
    input.result.dbFailures += 1;
    return;
  }

  recordFinalizeResult(input.result, finalized);
}

async function processDeletedStorageObjectCandidate(input: {
  store: StorageObjectCleanupStore;
  fileRemover: LocalStorageObjectFileRemover;
  storageObjectId: string;
  result: StorageCleanupCycleResult;
}): Promise<void> {
  let prepared: PrepareDeletedGeneratedStorageObjectForPurgeResult;
  try {
    prepared = await input.store.prepareDeletedGeneratedStorageObjectForPurge(
      input.storageObjectId
    );
  } catch {
    input.result.dbFailures += 1;
    return;
  }

  if (prepared.status !== "PREPARED") {
    recordPrepareResult(input.result, prepared);
    return;
  }

  await removePreparedStorageObjectFile({
    store: input.store,
    fileRemover: input.fileRemover,
    storageObjectId: prepared.id,
    objectKey: prepared.objectKey,
    result: input.result
  });
}

export async function runStorageCleanupCycle(
  input: StorageCleanupCycleInput
): Promise<StorageCleanupCycleResult> {
  const readyBefore = validateCycleInput(input);
  const result = createEmptyResult();
  const processedReadyCandidateIds = new Set<string>();
  let readyCandidates: Array<{ id: string }> = [];

  try {
    readyCandidates =
      await input.store.listReadyGeneratedStorageObjectCleanupCandidates({
        readyBefore,
        limit: input.batchSize
      });
  } catch {
    result.dbFailures += 1;
  }

  result.scannedReady = readyCandidates.length;
  for (const candidate of readyCandidates) {
    processedReadyCandidateIds.add(candidate.id);
    let tombstone: TombstoneReadyGeneratedStorageObjectForCleanupResult;
    try {
      tombstone =
        await input.store.tombstoneReadyGeneratedStorageObjectForCleanup({
          storageObjectId: candidate.id,
          readyBefore,
          now: input.now
        });
    } catch {
      result.dbFailures += 1;
      continue;
    }

    if (tombstone.status !== "CLAIMED") {
      recordTombstoneResult(result, tombstone);
      continue;
    }

    result.claimedReady += 1;
    await processDeletedStorageObjectCandidate({
      store: input.store,
      fileRemover: input.fileRemover,
      storageObjectId: tombstone.id,
      result
    });
  }

  const remainingBatchSize = input.batchSize - readyCandidates.length;
  if (remainingBatchSize < 1) {
    return result;
  }

  let deletedCandidates: Array<{ id: string }> = [];
  try {
    deletedCandidates =
      await input.store.listDeletedGeneratedStorageObjectCleanupCandidates({
        limit: remainingBatchSize
      });
  } catch {
    result.dbFailures += 1;
  }

  result.scannedDeleted = deletedCandidates.length;
  for (const candidate of deletedCandidates) {
    if (processedReadyCandidateIds.has(candidate.id)) {
      continue;
    }
    await processDeletedStorageObjectCandidate({
      store: input.store,
      fileRemover: input.fileRemover,
      storageObjectId: candidate.id,
      result
    });
  }

  return result;
}
