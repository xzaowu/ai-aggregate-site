import { describe, expect, it } from "vitest";
import {
  LocalStorageObjectFileRemovalError,
  type LocalStorageObjectFileRemovalResult,
  type LocalStorageObjectFileRemover
} from "../src/asset-storage";
import {
  runStorageCleanupCycle,
  type StorageCleanupCycleResult
} from "../src/storage-cleanup";
import type {
  FinalizeDeletedGeneratedStorageObjectPurgeResult,
  PrepareDeletedGeneratedStorageObjectForPurgeResult,
  StorageObjectCleanupStore,
  TombstoneReadyGeneratedStorageObjectForCleanupResult
} from "../src/store";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const READY_BEFORE = new Date("2026-07-19T11:00:00.000Z");

interface CleanupObject {
  id: string;
  objectKey: string;
  status: "READY" | "DELETED" | "FAILED" | "PENDING" | "PURGED";
  updatedAt: Date;
  referenced?: boolean;
  referenceOnFinalize?: boolean;
}

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve() {
      if (!resolvePromise) {
        throw new Error("TEST_DEFERRED_RESOLVER_MISSING");
      }
      resolvePromise();
    }
  };
}

class FakeCleanupStore implements StorageObjectCleanupStore {
  readonly objects = new Map<string, CleanupObject>();
  readonly calls: string[] = [];
  readonly finalizeThrows = new Set<string>();
  readonly tombstoneThrows = new Set<string>();
  prepareGate: (() => Promise<void>) | undefined;

  constructor(objects: CleanupObject[]) {
    for (const object of objects) {
      this.objects.set(object.id, { ...object });
    }
  }

  async listReadyGeneratedStorageObjectCleanupCandidates(input: {
    readyBefore: Date;
    limit: number;
  }): Promise<Array<{ id: string }>> {
    this.calls.push("listReady");
    return [...this.objects.values()]
      .filter(
        (object) =>
          object.status === "READY" &&
          object.updatedAt.getTime() <= input.readyBefore.getTime()
      )
      .sort(
        (first, second) =>
          first.updatedAt.getTime() - second.updatedAt.getTime() ||
          first.id.localeCompare(second.id)
      )
      .slice(0, input.limit)
      .map((object) => ({ id: object.id }));
  }

  async listDeletedGeneratedStorageObjectCleanupCandidates(input: {
    limit: number;
  }): Promise<Array<{ id: string }>> {
    this.calls.push("listDeleted");
    return [...this.objects.values()]
      .filter((object) => object.status === "DELETED")
      .sort((first, second) => first.id.localeCompare(second.id))
      .slice(0, input.limit)
      .map((object) => ({ id: object.id }));
  }

  async tombstoneReadyGeneratedStorageObjectForCleanup(input: {
    storageObjectId: string;
    readyBefore: Date;
    now: Date;
  }): Promise<TombstoneReadyGeneratedStorageObjectForCleanupResult> {
    this.calls.push(`tombstone:${input.storageObjectId}`);
    if (this.tombstoneThrows.has(input.storageObjectId)) {
      throw new Error("test tombstone database failure");
    }
    const object = this.objects.get(input.storageObjectId);
    if (!object) {
      return { status: "NOT_FOUND" };
    }
    if (
      object.status !== "READY" ||
      object.updatedAt.getTime() > input.readyBefore.getTime()
    ) {
      return { status: "NOT_ELIGIBLE" };
    }
    if (object.referenced) {
      return { status: "SKIPPED_REFERENCED" };
    }

    object.status = "DELETED";
    object.updatedAt = input.now;
    return { status: "CLAIMED", id: object.id, objectKey: object.objectKey };
  }

  async prepareDeletedGeneratedStorageObjectForPurge(
    storageObjectId: string
  ): Promise<PrepareDeletedGeneratedStorageObjectForPurgeResult> {
    this.calls.push(`prepare:${storageObjectId}`);
    const object = this.objects.get(storageObjectId);
    if (!object) {
      return { status: "NOT_FOUND" };
    }
    if (object.status !== "DELETED") {
      return { status: "NOT_ELIGIBLE" };
    }
    if (object.referenced) {
      return { status: "SKIPPED_REFERENCED" };
    }
    await this.prepareGate?.();
    return { status: "PREPARED", id: object.id, objectKey: object.objectKey };
  }

  async finalizeDeletedGeneratedStorageObjectPurge(
    storageObjectId: string
  ): Promise<FinalizeDeletedGeneratedStorageObjectPurgeResult> {
    this.calls.push(`finalize:${storageObjectId}`);
    if (this.finalizeThrows.has(storageObjectId)) {
      this.finalizeThrows.delete(storageObjectId);
      throw new Error("test finalize database failure");
    }
    const object = this.objects.get(storageObjectId);
    if (!object || object.status === "PURGED") {
      return { status: "ALREADY_PURGED" };
    }
    if (object.status !== "DELETED") {
      return { status: "NOT_ELIGIBLE" };
    }
    if (object.referenceOnFinalize) {
      object.referenced = true;
    }
    if (object.referenced) {
      return { status: "SKIPPED_REFERENCED" };
    }

    object.status = "PURGED";
    return { status: "PURGED" };
  }
}

class FakeFileRemover implements LocalStorageObjectFileRemover {
  readonly calls: string[] = [];
  readonly outcomes = new Map<
    string,
    Array<LocalStorageObjectFileRemovalResult | Error>
  >();

  async removeLocalStorageObjectFile(
    objectKey: string
  ): Promise<LocalStorageObjectFileRemovalResult> {
    this.calls.push(objectKey);
    const outcome = this.outcomes.get(objectKey)?.shift();
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome ?? { status: "REMOVED" };
  }
}

function readyObject(
  id: string,
  overrides: Partial<CleanupObject> = {}
): CleanupObject {
  return {
    id,
    objectKey: `images/${id}.png`,
    status: "READY",
    updatedAt: new Date("2026-07-19T10:00:00.000Z"),
    ...overrides
  };
}

function deletedObject(
  id: string,
  overrides: Partial<CleanupObject> = {}
): CleanupObject {
  return {
    id,
    objectKey: `images/${id}.png`,
    status: "DELETED",
    updatedAt: new Date("2026-07-18T10:00:00.000Z"),
    ...overrides
  };
}

function runCycle(
  store: StorageObjectCleanupStore,
  fileRemover: LocalStorageObjectFileRemover,
  overrides: Partial<{
    now: Date;
    readyGraceMs: number;
    batchSize: number;
  }> = {}
): Promise<StorageCleanupCycleResult> {
  return runStorageCleanupCycle({
    store,
    fileRemover,
    now: NOW,
    readyGraceMs: NOW.getTime() - READY_BEFORE.getTime(),
    batchSize: 10,
    ...overrides
  });
}

describe("runStorageCleanupCycle", () => {
  it("processes a READY orphan through tombstone, prepare, file removal, and purge", async () => {
    const store = new FakeCleanupStore([readyObject("ready-orphan")]);
    const fileRemover = new FakeFileRemover();

    await expect(runCycle(store, fileRemover)).resolves.toEqual({
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
      dbFailures: 0
    });
    expect(store.calls).toEqual([
      "listReady",
      "tombstone:ready-orphan",
      "prepare:ready-orphan",
      "finalize:ready-orphan",
      "listDeleted"
    ]);
  });

  it("skips a READY candidate whose reference appeared after scanning", async () => {
    const store = new FakeCleanupStore([
      readyObject("ready-referenced", { referenced: true })
    ]);
    const fileRemover = new FakeFileRemover();

    const result = await runCycle(store, fileRemover);
    expect(result.skippedReferenced).toBe(1);
    expect(result.claimedReady).toBe(0);
    expect(fileRemover.calls).toEqual([]);
  });

  it("does not scan a READY object that has not reached its grace cutoff", async () => {
    const store = new FakeCleanupStore([
      readyObject("not-old-enough", { updatedAt: new Date(NOW) })
    ]);

    const result = await runCycle(store, new FakeFileRemover());
    expect(result.scannedReady).toBe(0);
    expect(store.calls).toEqual(["listReady", "listDeleted"]);
  });

  it("recovers a leftover DELETED object", async () => {
    const store = new FakeCleanupStore([deletedObject("deleted-leftover")]);
    const fileRemover = new FakeFileRemover();

    const result = await runCycle(store, fileRemover);
    expect(result).toMatchObject({
      scannedReady: 0,
      scannedDeleted: 1,
      removedFiles: 1,
      purgedRows: 1
    });
    expect(store.objects.get("deleted-leftover")?.status).toBe("PURGED");
  });

  it("finalizes a DELETED object when its file is already missing", async () => {
    const object = deletedObject("missing-file");
    const store = new FakeCleanupStore([object]);
    const fileRemover = new FakeFileRemover();
    fileRemover.outcomes.set(object.objectKey, [{ status: "NOT_FOUND" }]);

    const result = await runCycle(store, fileRemover);
    expect(result).toMatchObject({ missingFiles: 1, purgedRows: 1 });
  });

  it("recovers a crash after tombstone from the next cycle's DELETED scan", async () => {
    const object = readyObject("crash-after-tombstone");
    const store = new FakeCleanupStore([object]);
    const fileRemover = new FakeFileRemover();
    await store.tombstoneReadyGeneratedStorageObjectForCleanup({
      storageObjectId: object.id,
      readyBefore: READY_BEFORE,
      now: NOW
    });

    const result = await runCycle(store, fileRemover);
    expect(result).toMatchObject({
      scannedReady: 0,
      scannedDeleted: 1,
      purgedRows: 1
    });
  });

  it("recovers a finalize failure after the file was removed", async () => {
    const object = deletedObject("finalize-retry");
    const store = new FakeCleanupStore([object]);
    const fileRemover = new FakeFileRemover();
    store.finalizeThrows.add(object.id);
    fileRemover.outcomes.set(object.objectKey, [
      { status: "REMOVED" },
      { status: "NOT_FOUND" }
    ]);

    const first = await runCycle(store, fileRemover);
    const second = await runCycle(store, fileRemover);
    expect(first).toMatchObject({ removedFiles: 1, dbFailures: 1, purgedRows: 0 });
    expect(second).toMatchObject({ missingFiles: 1, purgedRows: 1 });
  });

  it("retains a DELETED row when safe file deletion fails", async () => {
    const object = deletedObject("file-delete-failure");
    const store = new FakeCleanupStore([object]);
    const fileRemover = new FakeFileRemover();
    fileRemover.outcomes.set(object.objectKey, [
      new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_SYMLINK_REJECTED"
      )
    ]);

    const result = await runCycle(store, fileRemover);
    expect(result).toMatchObject({ deleteFailures: 1, purgedRows: 0 });
    expect(store.objects.get(object.id)?.status).toBe("DELETED");
    expect(store.calls).not.toContain(`finalize:${object.id}`);
  });

  it("continues with later objects after one object fails", async () => {
    const first = readyObject("first-failure");
    const second = readyObject("second-success", {
      updatedAt: new Date("2026-07-19T10:01:00.000Z")
    });
    const store = new FakeCleanupStore([first, second]);
    const fileRemover = new FakeFileRemover();
    fileRemover.outcomes.set(first.objectKey, [
      new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_DELETE_FAILED"
      )
    ]);

    const result = await runCycle(store, fileRemover, { batchSize: 2 });
    expect(result).toMatchObject({
      claimedReady: 2,
      deleteFailures: 1,
      purgedRows: 1
    });
    expect(store.objects.get(second.id)?.status).toBe("PURGED");
  });

  it("keeps READY and DELETED work within one combined batch limit", async () => {
    const store = new FakeCleanupStore([
      readyObject("ready-1"),
      readyObject("ready-2", {
        updatedAt: new Date("2026-07-19T10:01:00.000Z")
      }),
      deletedObject("deleted-1"),
      deletedObject("deleted-2")
    ]);

    const result = await runCycle(store, new FakeFileRemover(), {
      batchSize: 3
    });
    expect(result.scannedReady + result.scannedDeleted).toBeLessThanOrEqual(3);
    expect(result.scannedReady).toBe(2);
    expect(result.scannedDeleted).toBe(1);
  });

  it("does not finalize when the final reference recheck finds a reference", async () => {
    const object = deletedObject("reference-before-finalize", {
      referenceOnFinalize: true
    });
    const store = new FakeCleanupStore([object]);

    const result = await runCycle(store, new FakeFileRemover());
    expect(result).toMatchObject({
      removedFiles: 1,
      skippedReferenced: 1,
      purgedRows: 0
    });
    expect(store.objects.get(object.id)?.status).toBe("DELETED");
  });

  it("allows two cycles to converge on one DELETED object without unsafe double purge", async () => {
    const object = deletedObject("two-workers");
    const store = new FakeCleanupStore([object]);
    const fileRemover = new FakeFileRemover();
    const bothPrepared = createDeferred();
    const releasePrepared = createDeferred();
    let preparedCount = 0;
    store.prepareGate = async () => {
      preparedCount += 1;
      if (preparedCount === 2) {
        bothPrepared.resolve();
      }
      await releasePrepared.promise;
    };
    fileRemover.outcomes.set(object.objectKey, [
      { status: "REMOVED" },
      { status: "NOT_FOUND" }
    ]);

    const first = runCycle(store, fileRemover);
    const second = runCycle(store, fileRemover);
    await bothPrepared.promise;
    releasePrepared.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.purgedRows + secondResult.purgedRows).toBe(1);
    expect(firstResult.alreadyPurgedRows + secondResult.alreadyPurgedRows).toBe(1);
    expect(firstResult.removedFiles + secondResult.removedFiles).toBe(1);
    expect(firstResult.missingFiles + secondResult.missingFiles).toBe(1);
  });

  it("does not process FAILED or PENDING objects", async () => {
    const store = new FakeCleanupStore([
      readyObject("failed", { status: "FAILED" }),
      readyObject("pending", { status: "PENDING" })
    ]);

    const result = await runCycle(store, new FakeFileRemover());
    expect(result).toMatchObject({ scannedReady: 0, scannedDeleted: 0 });
    expect(store.calls).toEqual(["listReady", "listDeleted"]);
  });

  it("returns only aggregate counters without object keys, paths, users, IDs, or errors", async () => {
    const secretKey = "images/private-user-secret.png";
    const store = new FakeCleanupStore([
      readyObject("private-storage-id", { objectKey: secretKey })
    ]);

    const result = await runCycle(store, new FakeFileRemover());
    expect(Object.keys(result).sort()).toEqual([
      "alreadyPurgedRows",
      "claimedReady",
      "dbFailures",
      "deleteFailures",
      "lostRaces",
      "missingFiles",
      "purgedRows",
      "removedFiles",
      "scannedDeleted",
      "scannedReady",
      "skippedIneligible",
      "skippedReferenced"
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretKey);
    expect(serialized).not.toContain("private-storage-id");
    expect(serialized).not.toContain("user");
  });

  it("rejects an invalid now value", async () => {
    await expect(
      runCycle(new FakeCleanupStore([]), new FakeFileRemover(), {
        now: new Date("invalid")
      })
    ).rejects.toThrow("INVALID_STORAGE_CLEANUP_NOW");
  });

  it.each([-1, 1.5, Number.NaN])(
    "rejects invalid readyGraceMs values: %s",
    async (readyGraceMs) => {
      await expect(
        runCycle(new FakeCleanupStore([]), new FakeFileRemover(), {
          readyGraceMs
        })
      ).rejects.toThrow("INVALID_STORAGE_CLEANUP_READY_GRACE_MS");
    }
  );

  it.each([0, 101, 1.5])("rejects invalid batchSize values: %s", async (batchSize) => {
    await expect(
      runCycle(new FakeCleanupStore([]), new FakeFileRemover(), { batchSize })
    ).rejects.toThrow("INVALID_STORAGE_CLEANUP_BATCH_SIZE");
  });
});
