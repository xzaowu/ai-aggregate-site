import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider
} from "@prisma/client";
import {
  processRemoteImageBody,
  RemoteImageBodyError,
  type RemoteImageBodyMimeType
} from "./remote-image-body";
import type { RemoteImageFetchResult } from "./remote-image-fetcher";
import type { StorageObjectRecord, StorageObjectStore } from "./store";
import type { Writable } from "node:stream";

const REMOTE_IMAGE_STORAGE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UNSAFE_OBJECT_KEY_CHARACTERS = /[\u0000-\u001f\u007f\\]/u;

const remoteImageStorageMessages: Record<RemoteImageStorageErrorCode, string> = {
  REMOTE_IMAGE_STORAGE_INPUT_INVALID: "remote image storage input is invalid",
  REMOTE_IMAGE_STORAGE_DIRECTORY_FAILED: "remote image storage directory setup failed",
  REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED: "remote image storage temporary file setup failed",
  REMOTE_IMAGE_STORAGE_SYNC_FAILED: "remote image storage temporary file synchronization failed",
  REMOTE_IMAGE_STORAGE_FINAL_FILE_FAILED: "remote image storage final file reservation failed",
  REMOTE_IMAGE_STORAGE_OBJECT_FAILED: "remote image storage object creation failed",
  REMOTE_IMAGE_STORAGE_RENAME_FAILED: "remote image storage finalization failed",
  REMOTE_IMAGE_STORAGE_READY_FAILED: "remote image storage readiness finalization failed",
  REMOTE_IMAGE_STORAGE_STATE_UNKNOWN: "remote image storage state is unknown"
};

export type RemoteImageStorageErrorStage = "storage";

export type RemoteImageStorageErrorCode =
  | "REMOTE_IMAGE_STORAGE_INPUT_INVALID"
  | "REMOTE_IMAGE_STORAGE_DIRECTORY_FAILED"
  | "REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED"
  | "REMOTE_IMAGE_STORAGE_SYNC_FAILED"
  | "REMOTE_IMAGE_STORAGE_FINAL_FILE_FAILED"
  | "REMOTE_IMAGE_STORAGE_OBJECT_FAILED"
  | "REMOTE_IMAGE_STORAGE_RENAME_FAILED"
  | "REMOTE_IMAGE_STORAGE_READY_FAILED"
  | "REMOTE_IMAGE_STORAGE_STATE_UNKNOWN";

export class RemoteImageStorageError extends Error {
  readonly code: RemoteImageStorageErrorCode;
  readonly stage: RemoteImageStorageErrorStage;

  constructor(code: RemoteImageStorageErrorCode) {
    super(remoteImageStorageMessages[code]);
    this.name = "RemoteImageStorageError";
    this.code = code;
    this.stage = "storage";
  }
}

export interface PersistRemoteImageInput {
  userId: string;
  fetchResult: RemoteImageFetchResult;
  signal?: AbortSignal;
}

export interface PersistedRemoteImageStorageObject {
  storageObjectId: string;
  objectKey: string;
  mimeType: RemoteImageBodyMimeType;
  sizeBytes: number;
  sha256: string;
}

export interface RemoteImageStorageService {
  persistRemoteImage(
    input: PersistRemoteImageInput
  ): Promise<PersistedRemoteImageStorageObject>;
}

export interface RemoteImageStorageFileOperations {
  createDirectory(directoryPath: string): Promise<void>;
  openExclusive(filePath: string, mode: number): Promise<FileHandle>;
  sync(handle: FileHandle): Promise<void>;
  close(handle: FileHandle): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  remove(filePath: string): Promise<void>;
}

export interface CreateRemoteImageStorageServiceInput {
  storageObjectStore: Pick<
    StorageObjectStore,
    | "createPendingStorageObject"
    | "markStorageObjectReady"
    | "markStorageObjectFailed"
    | "findStorageObjectForUser"
  >;
  generatedAssetsDir: string;
  fileOperations?: Partial<RemoteImageStorageFileOperations>;
  now?: () => Date;
  createUuid?: () => string;
}

const DEFAULT_FILE_OPERATIONS: RemoteImageStorageFileOperations = {
  async createDirectory(directoryPath) {
    await mkdir(directoryPath, { recursive: true });
  },
  async openExclusive(filePath, mode) {
    return open(filePath, "wx", mode);
  },
  async sync(handle) {
    await handle.sync();
  },
  async close(handle) {
    await handle.close();
  },
  async rename(sourcePath, destinationPath) {
    await rename(sourcePath, destinationPath);
  },
  async remove(filePath) {
    await unlink(filePath);
  }
};

class DefaultRemoteImageStorageService implements RemoteImageStorageService {
  private readonly storageObjectStore: CreateRemoteImageStorageServiceInput["storageObjectStore"];
  private readonly generatedAssetsDir: string;
  private readonly fileOperations: RemoteImageStorageFileOperations;
  private readonly now: () => Date;
  private readonly createUuid: () => string;

  constructor(input: CreateRemoteImageStorageServiceInput) {
    if (
      typeof input.generatedAssetsDir !== "string" ||
      input.generatedAssetsDir.trim().length === 0
    ) {
      throw new RemoteImageStorageError("REMOTE_IMAGE_STORAGE_INPUT_INVALID");
    }

    this.storageObjectStore = input.storageObjectStore;
    this.generatedAssetsDir = path.resolve(input.generatedAssetsDir);
    this.fileOperations = {
      ...DEFAULT_FILE_OPERATIONS,
      ...input.fileOperations
    };
    this.now = input.now ?? (() => new Date());
    this.createUuid = input.createUuid ?? randomUUID;
  }

  async persistRemoteImage(
    input: PersistRemoteImageInput
  ): Promise<PersistedRemoteImageStorageObject> {
    const userId = validateUserId(input);
    const now = validateDate(this.now());
    const objectUuid = createUuid(this.createUuid);
    const directoryKey = getDirectoryKey(now);
    const directoryPath = resolveStoragePath(
      this.generatedAssetsDir,
      directoryKey
    );
    let tempPath: string | undefined;

    let tempHandle: FileHandle | undefined;
    let tempDestination: Writable | undefined;
    let tempCreated = false;
    let tempRenamed = false;
    let finalReserved = false;
    let finalPath: string | undefined;
    let pendingStorageObjectId: string | undefined;
    let readyConfirmed = false;
    let storageStateUnknown = false;
    let shouldMarkPendingFailed = false;
    let finalCleanupAttempted = false;

    try {
      try {
        await this.fileOperations.createDirectory(directoryPath);
      } catch {
        throw new RemoteImageStorageError(
          "REMOTE_IMAGE_STORAGE_DIRECTORY_FAILED"
        );
      }

      const tempUuid = createUuid(this.createUuid);
      tempPath = resolveStoragePath(
        this.generatedAssetsDir,
        `${directoryKey}/.${objectUuid}.${tempUuid}.tmp`
      );

      let bodyResult;
      let tempPhaseError: unknown;
      try {
        try {
          tempHandle = await this.fileOperations.openExclusive(tempPath, 0o600);
          tempCreated = true;
        } catch {
          throw new RemoteImageStorageError(
            "REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED"
          );
        }

        try {
          tempDestination = tempHandle.createWriteStream({
            autoClose: false
          });
          bodyResult = await processRemoteImageBody({
            fetchResult: input.fetchResult,
            destination: tempDestination,
            signal: input.signal
          });
        } catch (error) {
          if (error instanceof RemoteImageBodyError) {
            throw error;
          }
          throw new RemoteImageStorageError(
            "REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED"
          );
        }

        try {
          await this.fileOperations.sync(tempHandle);
          destroyBestEffort(tempDestination);
        } catch {
          throw new RemoteImageStorageError(
            "REMOTE_IMAGE_STORAGE_SYNC_FAILED"
          );
        }
      } catch (error) {
        tempPhaseError = error;
        throw error;
      } finally {
        if (tempPhaseError !== undefined) {
          destroyBestEffort(tempDestination);
        }

        if (tempHandle !== undefined) {
          try {
            await this.fileOperations.close(tempHandle);
            tempHandle = undefined;
          } catch {
            if (tempPhaseError === undefined) {
              throw new RemoteImageStorageError(
                "REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED"
              );
            }
          }
        }
      }

      const objectKey = `${directoryKey}/${objectUuid}.${extensionForMimeType(
        bodyResult.mimeType
      )}`;
      finalPath = resolveStoragePath(this.generatedAssetsDir, objectKey);

      let placeholderHandle: FileHandle | undefined;
      try {
        placeholderHandle = await this.fileOperations.openExclusive(finalPath, 0o600);
        finalReserved = true;
      } catch {
        throw new RemoteImageStorageError(
          "REMOTE_IMAGE_STORAGE_FINAL_FILE_FAILED"
        );
      }

      try {
        await this.fileOperations.close(placeholderHandle);
        placeholderHandle = undefined;
      } catch {
        await closeBestEffort(placeholderHandle, this.fileOperations);
        throw new RemoteImageStorageError(
          "REMOTE_IMAGE_STORAGE_FINAL_FILE_FAILED"
        );
      }

      let pendingStorageObject: StorageObjectRecord;
      try {
        pendingStorageObject =
          await this.storageObjectStore.createPendingStorageObject({
            userId,
            storageProvider: StorageProvider.LOCAL,
            objectKey,
            source: StorageObjectSource.GENERATED
          });
      } catch {
        // The current local Store call is a single create. A thrown result is
        // treated as no confirmed PENDING record for this phase.
        throw new RemoteImageStorageError(
          "REMOTE_IMAGE_STORAGE_OBJECT_FAILED"
        );
      }

      if (
        typeof pendingStorageObject.id !== "string" ||
        pendingStorageObject.id.trim().length === 0
      ) {
        throw new RemoteImageStorageError(
          "REMOTE_IMAGE_STORAGE_OBJECT_FAILED"
        );
      }

      pendingStorageObjectId = pendingStorageObject.id;
      shouldMarkPendingFailed = true;

      try {
        await this.fileOperations.rename(tempPath, finalPath);
        tempRenamed = true;
        tempCreated = false;
        finalReserved = false;
      } catch {
        throw new RemoteImageStorageError(
          "REMOTE_IMAGE_STORAGE_RENAME_FAILED"
        );
      }

      let readyResult:
        | Awaited<
            ReturnType<
              CreateRemoteImageStorageServiceInput["storageObjectStore"]["markStorageObjectReady"]
            >
          >
        | undefined;
      let readyCallThrew = false;
      try {
        readyResult = await this.storageObjectStore.markStorageObjectReady({
          userId,
          id: pendingStorageObjectId,
          mimeType: bodyResult.mimeType,
          sizeBytes: bodyResult.sizeBytes,
          sha256: bodyResult.sha256
        });
      } catch {
        readyCallThrew = true;
      }

      if (!readyCallThrew && readyResult?.status === "UPDATED") {
        readyConfirmed = true;
        shouldMarkPendingFailed = false;
        return toPersistedStorageObject({
          id: pendingStorageObjectId,
          objectKey,
          mimeType: bodyResult.mimeType,
          sizeBytes: bodyResult.sizeBytes,
          sha256: bodyResult.sha256
        });
      }

      const reconciliation = await reconcileReadyState({
        storageObjectStore: this.storageObjectStore,
        fileOperations: this.fileOperations,
        userId,
        storageObjectId: pendingStorageObjectId,
        objectKey,
        mimeType: bodyResult.mimeType,
        sizeBytes: bodyResult.sizeBytes,
        sha256: bodyResult.sha256,
        finalPath
      });

      if (reconciliation.status === "ready") {
        readyConfirmed = true;
        shouldMarkPendingFailed = false;
        return toPersistedStorageObject({
          id: pendingStorageObjectId,
          objectKey,
          mimeType: bodyResult.mimeType,
          sizeBytes: bodyResult.sizeBytes,
          sha256: bodyResult.sha256
        });
      }

      if (reconciliation.status === "unknown") {
        storageStateUnknown = true;
        shouldMarkPendingFailed = false;
        throw new RemoteImageStorageError(
          "REMOTE_IMAGE_STORAGE_STATE_UNKNOWN"
        );
      }

      finalCleanupAttempted = reconciliation.finalCleanupAttempted;
      shouldMarkPendingFailed = false;
      throw new RemoteImageStorageError(
        "REMOTE_IMAGE_STORAGE_READY_FAILED"
      );
    } catch (error) {
      destroyBestEffort(tempDestination);
      await closeBestEffort(tempHandle, this.fileOperations);

      if (tempCreated && !tempRenamed && tempPath !== undefined) {
        await removeBestEffort(tempPath, this.fileOperations);
      }
      if (finalReserved && !tempRenamed && finalPath !== undefined) {
        await removeBestEffort(finalPath, this.fileOperations);
      }
      if (
        tempRenamed &&
        !readyConfirmed &&
        !storageStateUnknown &&
        !finalCleanupAttempted &&
        finalPath !== undefined
      ) {
        await removeBestEffort(finalPath, this.fileOperations);
      }

      if (pendingStorageObjectId !== undefined && shouldMarkPendingFailed) {
        await markFailedBestEffort(
          this.storageObjectStore,
          userId,
          pendingStorageObjectId
        );
      }

      throw error;
    }
  }
}

export function createRemoteImageStorageService(
  input: CreateRemoteImageStorageServiceInput
): RemoteImageStorageService {
  if (typeof input !== "object" || input === null) {
    throw new RemoteImageStorageError("REMOTE_IMAGE_STORAGE_INPUT_INVALID");
  }

  return new DefaultRemoteImageStorageService(input);
}

function validateUserId(input: PersistRemoteImageInput): string {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.userId !== "string" ||
    input.userId.trim().length === 0 ||
    typeof input.fetchResult !== "object" ||
    input.fetchResult === null
  ) {
    throw new RemoteImageStorageError("REMOTE_IMAGE_STORAGE_INPUT_INVALID");
  }

  return input.userId;
}

function validateDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RemoteImageStorageError("REMOTE_IMAGE_STORAGE_INPUT_INVALID");
  }

  return value;
}

function createUuid(create: () => string): string {
  const value = create();
  if (!REMOTE_IMAGE_STORAGE_UUID_PATTERN.test(value)) {
    throw new RemoteImageStorageError("REMOTE_IMAGE_STORAGE_INPUT_INVALID");
  }
  return value;
}

function getDirectoryKey(now: Date): string {
  const year = String(now.getUTCFullYear()).padStart(4, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `images/${year}/${month}`;
}

function extensionForMimeType(mimeType: RemoteImageBodyMimeType): string {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  return "webp";
}

function resolveStoragePath(root: string, objectKey: string): string {
  if (
    objectKey.length === 0 ||
    path.isAbsolute(objectKey) ||
    UNSAFE_OBJECT_KEY_CHARACTERS.test(objectKey) ||
    objectKey.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new RemoteImageStorageError("REMOTE_IMAGE_STORAGE_INPUT_INVALID");
  }

  const resolved = path.resolve(root, objectKey);
  const relative = path.relative(root, resolved);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new RemoteImageStorageError("REMOTE_IMAGE_STORAGE_INPUT_INVALID");
  }

  return resolved;
}

async function reconcileReadyState(input: {
  storageObjectStore: CreateRemoteImageStorageServiceInput["storageObjectStore"];
  fileOperations: RemoteImageStorageFileOperations;
  userId: string;
  storageObjectId: string;
  objectKey: string;
  mimeType: RemoteImageBodyMimeType;
  sizeBytes: number;
  sha256: string;
  finalPath: string;
}): Promise<{
  status: "ready" | "failed" | "unknown";
  finalCleanupAttempted: boolean;
}> {
  let storageObject: StorageObjectRecord | null;
  try {
    storageObject = await input.storageObjectStore.findStorageObjectForUser(
      input.userId,
      input.storageObjectId
    );
  } catch {
    return { status: "unknown", finalCleanupAttempted: false };
  }

  if (
    storageObject !== null &&
    storageObject.status === StorageObjectStatus.READY
  ) {
    return isMatchingReadyStorageObject(storageObject, input)
      ? { status: "ready", finalCleanupAttempted: false }
      : { status: "unknown", finalCleanupAttempted: false };
  }

  await removeBestEffort(input.finalPath, input.fileOperations);

  if (
    storageObject !== null &&
    storageObject.status === StorageObjectStatus.PENDING
  ) {
    await markFailedBestEffort(
      input.storageObjectStore,
      input.userId,
      input.storageObjectId
    );
  }

  return { status: "failed", finalCleanupAttempted: true };
}

function isMatchingReadyStorageObject(
  storageObject: StorageObjectRecord,
  expected: {
    objectKey: string;
    mimeType: RemoteImageBodyMimeType;
    sizeBytes: number;
    sha256: string;
  }
): boolean {
  return (
    storageObject.storageProvider === StorageProvider.LOCAL &&
    storageObject.objectKey === expected.objectKey &&
    storageObject.mimeType === expected.mimeType &&
    storageObject.sizeBytes === expected.sizeBytes &&
    storageObject.sha256 === expected.sha256
  );
}

function toPersistedStorageObject(input: {
  id: string;
  objectKey: string;
  mimeType: RemoteImageBodyMimeType;
  sizeBytes: number;
  sha256: string;
}): PersistedRemoteImageStorageObject {
  return {
    storageObjectId: input.id,
    objectKey: input.objectKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256
  };
}

async function closeBestEffort(
  handle: FileHandle | undefined,
  fileOperations: RemoteImageStorageFileOperations
): Promise<void> {
  if (handle === undefined) {
    return;
  }

  try {
    await fileOperations.close(handle);
  } catch {
    // Cleanup failures do not replace the primary safe error.
  }
}

function destroyBestEffort(destination: Writable | undefined): void {
  if (destination === undefined || destination.destroyed) {
    return;
  }

  try {
    destination.destroy();
  } catch {
    // Cleanup failures do not replace the primary safe error.
  }
}

async function removeBestEffort(
  filePath: string,
  fileOperations: RemoteImageStorageFileOperations
): Promise<void> {
  try {
    await fileOperations.remove(filePath);
  } catch {
    // Cleanup failures do not replace the primary safe error.
  }
}

async function markFailedBestEffort(
  storageObjectStore: CreateRemoteImageStorageServiceInput["storageObjectStore"],
  userId: string,
  storageObjectId: string
): Promise<void> {
  try {
    await storageObjectStore.markStorageObjectFailed({
      userId,
      id: storageObjectId
    });
  } catch {
    // Cleanup failures do not replace the primary safe error.
  }
}
