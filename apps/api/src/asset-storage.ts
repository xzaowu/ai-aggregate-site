import {
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider
} from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { constants, createReadStream, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
  type FileHandle
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { StorageObjectStore } from "./store";

export type GeneratedAssetMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "video/mp4";

export interface StoredGeneratedAsset {
  url: string;
  storageProvider: "local";
  storageKey: string;
  filePath: string;
  mimeType: GeneratedAssetMimeType;
  sizeBytes: number;
}

export interface AssetStorage {
  saveDataUrlImage(input: {
    dataUrl: string;
    filenamePrefix?: string;
    maxBytes?: number;
  }): Promise<StoredGeneratedAsset>;
}

export const DEFAULT_GENERATED_ASSETS_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_GENERATED_ASSETS_PUBLIC_PATH = "/generated-assets";

const SUPPORTED_IMAGE_TYPES: Record<GeneratedAssetMimeType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4"
};

const CONTENT_TYPES_BY_EXTENSION: Record<string, GeneratedAssetMimeType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4"
};

export class AssetStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetStorageError";
  }
}

export type LocalStorageObjectErrorCode =
  | "INVALID_STORAGE_OBJECT_INPUT"
  | "INVALID_IMAGE_DATA_URL"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_SIGNATURE_MISMATCH"
  | "VIDEO_TOO_LARGE"
  | "VIDEO_SIGNATURE_MISMATCH"
  | "STORAGE_OBJECT_CREATE_FAILED"
  | "LOCAL_STORAGE_WRITE_FAILED"
  | "STORAGE_OBJECT_FINALIZE_FAILED";

export class LocalStorageObjectError extends AssetStorageError {
  readonly code: LocalStorageObjectErrorCode;

  constructor(code: LocalStorageObjectErrorCode) {
    super(code);
    this.name = "LocalStorageObjectError";
    this.code = code;
  }
}

export type LocalStorageObjectStore = Pick<
  StorageObjectStore,
  | "createPendingStorageObject"
  | "markStorageObjectReady"
  | "markStorageObjectFailed"
>;

export interface LocalStorageObjectFileOperations {
  createDirectory(directoryPath: string): Promise<void>;
  openExclusive(filePath: string): Promise<FileHandle>;
  write(handle: FileHandle, data: Buffer): Promise<void>;
  sync(handle: FileHandle): Promise<void>;
  close(handle: FileHandle): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  remove(filePath: string): Promise<void>;
}

export interface PersistLocalImageStorageObjectInput {
  userId: string;
  source: StorageObjectSource;
  maxBytes: number;
  dataUrl?: string;
  base64?: string;
}

export interface SafeLocalImageStorageObjectRecord {
  id: string;
  userId: string;
  storageProvider: StorageProvider;
  objectKey: string;
  mimeType: GeneratedAssetMimeType;
  sizeBytes: number;
  sha256: string;
  source: StorageObjectSource;
  status: StorageObjectStatus;
}

export interface PersistedLocalImageStorageObject {
  storageObject: SafeLocalImageStorageObjectRecord;
  storageObjectId: string;
  objectKey: string;
  publicUrl: string;
  mimeType: GeneratedAssetMimeType;
  sizeBytes: number;
  sha256: string;
}

export interface PersistLocalVideoStorageObjectInput {
  userId: string;
  source: StorageObjectSource;
  maxBytes: number;
  bytes: Uint8Array;
}

export interface SafeLocalVideoStorageObjectRecord {
  id: string;
  userId: string;
  storageProvider: StorageProvider;
  objectKey: string;
  mimeType: "video/mp4";
  sizeBytes: number;
  sha256: string;
  source: StorageObjectSource;
  status: StorageObjectStatus;
}

export interface PersistedLocalVideoStorageObject {
  storageObject: SafeLocalVideoStorageObjectRecord;
  storageObjectId: string;
  objectKey: string;
  publicUrl: string;
  mimeType: "video/mp4";
  sizeBytes: number;
  sha256: string;
}

export class LocalStorageObjectContentUnavailableError extends AssetStorageError {
  readonly code = "LOCAL_STORAGE_OBJECT_CONTENT_UNAVAILABLE";

  constructor() {
    super("LOCAL_STORAGE_OBJECT_CONTENT_UNAVAILABLE");
    this.name = "LocalStorageObjectContentUnavailableError";
  }
}

export interface OpenedLocalStorageObjectContent {
  stream: Readable;
  sizeBytes: number;
  start?: number;
  end?: number;
}

const STRICT_IMAGE_DATA_URL_PATTERN =
  /^data:(image\/(?:png|jpeg|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/u;
const STRICT_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);
const RIFF_SIGNATURE = Buffer.from("RIFF", "ascii");
const WEBP_SIGNATURE = Buffer.from("WEBP", "ascii");
const WEBP_FIRST_CHUNK_TYPES = new Set(["VP8 ", "VP8L", "VP8X"]);
const MP4_FTYP_SIGNATURE = Buffer.from("ftyp", "ascii");
const STORAGE_OBJECT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UNSAFE_STORAGE_OBJECT_KEY_CHARACTERS =
  /[\u0000-\u001f\u007f\u2044\u2215\uff0f\\]/u;
const STORAGE_OBJECT_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const STORAGE_OBJECT_WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;
const ALLOWED_LOCAL_IMAGE_SOURCES = new Set<StorageObjectSource>([
  StorageObjectSource.UPLOAD,
  StorageObjectSource.GENERATED,
  StorageObjectSource.IMPORTED
]);

const DEFAULT_LOCAL_STORAGE_OBJECT_FILE_OPERATIONS: LocalStorageObjectFileOperations =
  {
    async createDirectory(directoryPath) {
      await mkdir(directoryPath, { recursive: true });
    },
    async openExclusive(filePath) {
      return open(filePath, "wx", 0o600);
    },
    async write(handle, data) {
      await handle.writeFile(data);
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

export function resolveGeneratedAssetsDir(
  env: Partial<NodeJS.ProcessEnv> = process.env
): string {
  const configured = env.GENERATED_ASSETS_DIR?.trim();

  return path.resolve(configured || path.join(process.cwd(), "storage", "generated-assets"));
}

export function resolveGeneratedAssetsPublicPath(
  env: Partial<NodeJS.ProcessEnv> = process.env
): string {
  const configured = env.GENERATED_ASSETS_PUBLIC_PATH?.trim();

  if (!configured) {
    return DEFAULT_GENERATED_ASSETS_PUBLIC_PATH;
  }

  return `/${configured.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

export function resolveGeneratedAssetsMaxBytes(
  env: Partial<NodeJS.ProcessEnv> = process.env
): number {
  const parsed = Number(env.GENERATED_ASSETS_MAX_BYTES);

  if (Number.isSafeInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_GENERATED_ASSETS_MAX_BYTES;
}

export class LocalAssetStorage implements AssetStorage {
  private readonly baseDir: string;
  private readonly publicPath: string;
  private readonly defaultMaxBytes: number;
  private readonly now: () => Date;

  constructor(options: {
    baseDir?: string;
    publicPath?: string;
    maxBytes?: number;
    env?: Partial<NodeJS.ProcessEnv>;
    now?: () => Date;
  } = {}) {
    const env = options.env ?? process.env;
    this.baseDir = path.resolve(options.baseDir ?? resolveGeneratedAssetsDir(env));
    this.publicPath =
      options.publicPath ?? resolveGeneratedAssetsPublicPath(env);
    this.defaultMaxBytes =
      options.maxBytes ?? resolveGeneratedAssetsMaxBytes(env);
    this.now = options.now ?? (() => new Date());
  }

  async saveDataUrlImage(input: {
    dataUrl: string;
    filenamePrefix?: string;
    maxBytes?: number;
  }): Promise<StoredGeneratedAsset> {
    const parsed = parseDataUrlImage(input.dataUrl);
    const maxBytes = input.maxBytes ?? this.defaultMaxBytes;

    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new AssetStorageError("Invalid generated asset size limit");
    }

    const decoded = Buffer.from(parsed.base64, "base64");

    if (decoded.length === 0) {
      throw new AssetStorageError("Image data URL payload is empty");
    }

    if (decoded.length > maxBytes) {
      throw new AssetStorageError("Image data URL payload exceeds size limit");
    }

    const now = this.now();
    const year = String(now.getUTCFullYear()).padStart(4, "0");
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const extension = SUPPORTED_IMAGE_TYPES[parsed.mimeType];
    const filename = `${randomUUID()}${extension}`;
    const storageKey = path.posix.join(year, month, filename);
    const filePath = resolveInside(this.baseDir, storageKey);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, decoded, { flag: "wx" });

    return {
      url: `${this.publicPath}/${storageKey}`,
      storageProvider: "local",
      storageKey,
      filePath,
      mimeType: parsed.mimeType,
      sizeBytes: decoded.length
    };
  }
}

export class LocalStorageObjectService {
  private readonly store: LocalStorageObjectStore;
  private readonly baseDir: string;
  private readonly publicPath: string;
  private readonly now: () => Date;
  private readonly createUuid: () => string;
  private readonly fileOperations: LocalStorageObjectFileOperations;

  constructor(options: {
    store: LocalStorageObjectStore;
    baseDir?: string;
    publicPath?: string;
    env?: Partial<NodeJS.ProcessEnv>;
    now?: () => Date;
    randomUUID?: () => string;
    fileOperations?: Partial<LocalStorageObjectFileOperations>;
  }) {
    const env = options.env ?? process.env;
    this.store = options.store;
    this.baseDir = path.resolve(
      options.baseDir ?? resolveGeneratedAssetsDir(env)
    );
    this.publicPath =
      options.publicPath ?? resolveGeneratedAssetsPublicPath(env);
    this.now = options.now ?? (() => new Date());
    this.createUuid = options.randomUUID ?? randomUUID;
    this.fileOperations = {
      ...DEFAULT_LOCAL_STORAGE_OBJECT_FILE_OPERATIONS,
      ...options.fileOperations
    };
  }

  async persistLocalImageStorageObject(
    input: PersistLocalImageStorageObjectInput
  ): Promise<PersistedLocalImageStorageObject> {
    const userId = normalizeStorageObjectUserId(input.userId);
    const source = validateLocalImageStorageObjectSource(input.source);
    const hasDataUrl = typeof input.dataUrl === "string";
    const hasBase64 = typeof input.base64 === "string";
    if (hasDataUrl === hasBase64) {
      throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
    }

    const parsed = hasBase64
      ? parseStrictBase64Image(input.base64!, input.maxBytes)
      : parseStrictDataUrlImage(input.dataUrl!, input.maxBytes);
    const now = this.now();

    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
    }

    const objectUuid = createStorageObjectUuid(this.createUuid);
    const year = String(now.getUTCFullYear()).padStart(4, "0");
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const extension = SUPPORTED_IMAGE_TYPES[parsed.mimeType].slice(1);
    const objectKey = [
      "images",
      year,
      month,
      `${objectUuid}.${extension}`
    ].join("/");
    validateLocalStorageObjectKey(objectKey);

    const finalPath = resolveLocalStorageObjectPath(this.baseDir, objectKey);
    const publicUrl = `${this.publicPath}/${objectKey}`;
    const sha256 = createHash("sha256").update(parsed.buffer).digest("hex");

    let pendingStorageObject: Awaited<
      ReturnType<LocalStorageObjectStore["createPendingStorageObject"]>
    >;
    try {
      pendingStorageObject = await this.store.createPendingStorageObject({
        userId,
        storageProvider: StorageProvider.LOCAL,
        objectKey,
        source
      });
    } catch {
      throw new LocalStorageObjectError("STORAGE_OBJECT_CREATE_FAILED");
    }

    let tempPath: string | undefined;
    let tempHandle: FileHandle | undefined;
    let finalReservationHandle: FileHandle | undefined;
    let tempCreated = false;
    let finalReserved = false;
    let renamed = false;
    let failureCode: LocalStorageObjectErrorCode =
      "LOCAL_STORAGE_WRITE_FAILED";

    try {
      const targetDirectory = path.dirname(finalPath);
      await this.fileOperations.createDirectory(targetDirectory);

      const tempUuid = createStorageObjectUuid(this.createUuid);
      tempPath = resolveLocalStorageObjectPath(
        this.baseDir,
        path.posix.join(
          path.posix.dirname(objectKey),
          `.${tempUuid}.tmp`
        )
      );

      tempHandle = await this.fileOperations.openExclusive(tempPath);
      tempCreated = true;
      await this.fileOperations.write(tempHandle, parsed.buffer);
      await this.fileOperations.sync(tempHandle);
      await this.fileOperations.close(tempHandle);
      tempHandle = undefined;

      finalReservationHandle =
        await this.fileOperations.openExclusive(finalPath);
      finalReserved = true;
      await this.fileOperations.close(finalReservationHandle);
      finalReservationHandle = undefined;

      await this.fileOperations.rename(tempPath, finalPath);
      renamed = true;
      tempCreated = false;
      finalReserved = false;

      failureCode = "STORAGE_OBJECT_FINALIZE_FAILED";
      const readyResult = await this.store.markStorageObjectReady({
        userId,
        id: pendingStorageObject.id,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.buffer.byteLength,
        sha256
      });

      if (readyResult.status !== "UPDATED") {
        throw new LocalStorageObjectError(
          "STORAGE_OBJECT_FINALIZE_FAILED"
        );
      }

      const storageObject: SafeLocalImageStorageObjectRecord = {
        id: pendingStorageObject.id,
        userId,
        storageProvider: StorageProvider.LOCAL,
        objectKey,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.buffer.byteLength,
        sha256,
        source,
        status: StorageObjectStatus.READY
      };

      return {
        storageObject,
        storageObjectId: storageObject.id,
        objectKey,
        publicUrl,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.buffer.byteLength,
        sha256
      };
    } catch {
      await closeBestEffort(tempHandle, this.fileOperations);
      await closeBestEffort(
        finalReservationHandle,
        this.fileOperations
      );

      if (tempCreated && tempPath) {
        await removeBestEffort(tempPath, this.fileOperations);
      }
      if (finalReserved && !renamed) {
        await removeBestEffort(finalPath, this.fileOperations);
      }

      try {
        await this.store.markStorageObjectFailed({
          userId,
          id: pendingStorageObject.id
        });
      } catch {
        // The original safe failure remains authoritative.
      }

      throw new LocalStorageObjectError(failureCode);
    }
  }

  async persistLocalVideoStorageObject(
    input: PersistLocalVideoStorageObjectInput
  ): Promise<PersistedLocalVideoStorageObject> {
    const userId = normalizeStorageObjectUserId(input.userId);
    const source = validateLocalImageStorageObjectSource(input.source);
    const buffer = parseStrictVideoBytes(input.bytes, input.maxBytes);
    const now = this.now();

    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
    }

    const objectUuid = createStorageObjectUuid(this.createUuid);
    const year = String(now.getUTCFullYear()).padStart(4, "0");
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const objectKey = [
      "videos",
      year,
      month,
      `${objectUuid}.mp4`
    ].join("/");
    validateLocalStorageObjectKey(objectKey);

    const finalPath = resolveLocalStorageObjectPath(this.baseDir, objectKey);
    const publicUrl = `${this.publicPath}/${objectKey}`;
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    let pendingStorageObject: Awaited<
      ReturnType<LocalStorageObjectStore["createPendingStorageObject"]>
    >;
    try {
      pendingStorageObject = await this.store.createPendingStorageObject({
        userId,
        storageProvider: StorageProvider.LOCAL,
        objectKey,
        source
      });
    } catch {
      throw new LocalStorageObjectError("STORAGE_OBJECT_CREATE_FAILED");
    }

    let tempPath: string | undefined;
    let tempHandle: FileHandle | undefined;
    let finalReservationHandle: FileHandle | undefined;
    let tempCreated = false;
    let finalReserved = false;
    let renamed = false;
    let failureCode: LocalStorageObjectErrorCode =
      "LOCAL_STORAGE_WRITE_FAILED";

    try {
      const targetDirectory = path.dirname(finalPath);
      await this.fileOperations.createDirectory(targetDirectory);
      const tempUuid = createStorageObjectUuid(this.createUuid);
      tempPath = resolveLocalStorageObjectPath(
        this.baseDir,
        path.posix.join(path.posix.dirname(objectKey), `.${tempUuid}.tmp`)
      );

      tempHandle = await this.fileOperations.openExclusive(tempPath);
      tempCreated = true;
      await this.fileOperations.write(tempHandle, buffer);
      await this.fileOperations.sync(tempHandle);
      await this.fileOperations.close(tempHandle);
      tempHandle = undefined;

      finalReservationHandle =
        await this.fileOperations.openExclusive(finalPath);
      finalReserved = true;
      await this.fileOperations.close(finalReservationHandle);
      finalReservationHandle = undefined;

      await this.fileOperations.rename(tempPath, finalPath);
      renamed = true;
      tempCreated = false;
      finalReserved = false;
      failureCode = "STORAGE_OBJECT_FINALIZE_FAILED";

      const readyResult = await this.store.markStorageObjectReady({
        userId,
        id: pendingStorageObject.id,
        mimeType: "video/mp4",
        sizeBytes: buffer.byteLength,
        sha256
      });
      if (readyResult.status !== "UPDATED") {
        throw new LocalStorageObjectError("STORAGE_OBJECT_FINALIZE_FAILED");
      }

      const storageObject: SafeLocalVideoStorageObjectRecord = {
        id: pendingStorageObject.id,
        userId,
        storageProvider: StorageProvider.LOCAL,
        objectKey,
        mimeType: "video/mp4",
        sizeBytes: buffer.byteLength,
        sha256,
        source,
        status: StorageObjectStatus.READY
      };

      return {
        storageObject,
        storageObjectId: storageObject.id,
        objectKey,
        publicUrl,
        mimeType: "video/mp4",
        sizeBytes: buffer.byteLength,
        sha256
      };
    } catch {
      await closeBestEffort(tempHandle, this.fileOperations);
      await closeBestEffort(finalReservationHandle, this.fileOperations);
      if (tempCreated && tempPath) {
        await removeBestEffort(tempPath, this.fileOperations);
      }
      if (finalReserved && !renamed) {
        await removeBestEffort(finalPath, this.fileOperations);
      }
      try {
        await this.store.markStorageObjectFailed({
          userId,
          id: pendingStorageObject.id
        });
      } catch {
        // Keep the fixed safe persistence error.
      }
      throw new LocalStorageObjectError(failureCode);
    }
  }
}

export class LocalStorageObjectContentService {
  private readonly baseDir: string;

  constructor(options: {
    baseDir?: string;
    env?: Partial<NodeJS.ProcessEnv>;
  } = {}) {
    const env = options.env ?? process.env;
    this.baseDir = path.resolve(
      options.baseDir ?? resolveGeneratedAssetsDir(env)
    );
  }

  async openLocalStorageObjectContent(input: {
    objectKey: string;
    expectedSizeBytes: number;
    start?: number;
    end?: number;
  }): Promise<OpenedLocalStorageObjectContent> {
    let handle: FileHandle | undefined;

    try {
      if (
        !Number.isSafeInteger(input.expectedSizeBytes) ||
        input.expectedSizeBytes <= 0
      ) {
        throw new LocalStorageObjectContentUnavailableError();
      }

      validateLocalStorageObjectKey(input.objectKey);
      const canonicalRoot = await realpath(this.baseDir);
      const filePath = resolveLocalStorageObjectPath(
        canonicalRoot,
        input.objectKey
      );

      await assertLocalStorageObjectPathHasNoSymlinks(
        canonicalRoot,
        input.objectKey
      );

      const canonicalFilePath = await realpath(filePath);
      if (!isPathInsideRoot(canonicalRoot, canonicalFilePath)) {
        throw new LocalStorageObjectContentUnavailableError();
      }

      handle = await open(
        canonicalFilePath,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      const fileStat = await handle.stat();

      if (
        !fileStat.isFile() ||
        !Number.isSafeInteger(fileStat.size) ||
        fileStat.size !== input.expectedSizeBytes
      ) {
        throw new LocalStorageObjectContentUnavailableError();
      }

      const start = input.start ?? 0;
      const end = input.end ?? fileStat.size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end >= fileStat.size
      ) {
        throw new LocalStorageObjectContentUnavailableError();
      }

      return {
        stream: handle.createReadStream({ autoClose: true, start, end }),
        sizeBytes: end - start + 1,
        start,
        end
      };
    } catch {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // The fixed safe content-unavailable error remains authoritative.
        }
      }

      throw new LocalStorageObjectContentUnavailableError();
    }
  }
}

export type LocalStorageObjectFileRemovalErrorCode =
  | "STORAGE_CLEANUP_INVALID_OBJECT_KEY"
  | "STORAGE_CLEANUP_ROOT_UNAVAILABLE"
  | "STORAGE_CLEANUP_PATH_OUTSIDE_ROOT"
  | "STORAGE_CLEANUP_SYMLINK_REJECTED"
  | "STORAGE_CLEANUP_NOT_DIRECTORY"
  | "STORAGE_CLEANUP_NOT_REGULAR_FILE"
  | "STORAGE_CLEANUP_DELETE_FAILED";

export class LocalStorageObjectFileRemovalError extends AssetStorageError {
  readonly code: LocalStorageObjectFileRemovalErrorCode;

  constructor(code: LocalStorageObjectFileRemovalErrorCode) {
    super(code);
    this.name = "LocalStorageObjectFileRemovalError";
    this.code = code;
  }
}

export type LocalStorageObjectFileRemovalResult =
  | { status: "REMOVED" }
  | { status: "NOT_FOUND" };

export interface LocalStorageObjectFileRemover {
  removeLocalStorageObjectFile(
    objectKey: string
  ): Promise<LocalStorageObjectFileRemovalResult>;
}

export interface LocalStorageObjectFileRemovalOperations {
  realpath(filePath: string): Promise<string>;
  lstat(filePath: string): Promise<Stats>;
  remove(filePath: string): Promise<void>;
}

const DEFAULT_LOCAL_STORAGE_OBJECT_FILE_REMOVAL_OPERATIONS: LocalStorageObjectFileRemovalOperations =
  {
    async realpath(filePath) {
      return realpath(filePath);
    },
    async lstat(filePath) {
      return lstat(filePath);
    },
    async remove(filePath) {
      await unlink(filePath);
    }
  };

export class LocalStorageObjectFileRemovalService
  implements LocalStorageObjectFileRemover
{
  private readonly baseDir: string;
  private readonly fileOperations: LocalStorageObjectFileRemovalOperations;

  constructor(options: {
    baseDir: string;
    fileOperations?: Partial<LocalStorageObjectFileRemovalOperations>;
  }) {
    if (
      typeof options.baseDir !== "string" ||
      !path.isAbsolute(options.baseDir)
    ) {
      throw new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_ROOT_UNAVAILABLE"
      );
    }

    this.baseDir = options.baseDir;
    this.fileOperations = {
      ...DEFAULT_LOCAL_STORAGE_OBJECT_FILE_REMOVAL_OPERATIONS,
      ...options.fileOperations
    };
  }

  async removeLocalStorageObjectFile(
    objectKey: string
  ): Promise<LocalStorageObjectFileRemovalResult> {
    const canonicalRoot = await this.resolveCanonicalRoot();
    validateStorageCleanupObjectKey(objectKey);
    const filePath = this.resolveFilePath(canonicalRoot, objectKey);
    const segments = objectKey.split("/");
    let currentPath = canonicalRoot;

    for (const [index, segment] of segments.entries()) {
      currentPath = path.join(currentPath, segment);
      const fileStat = await this.lstatPath(currentPath);
      if (fileStat === null) {
        return { status: "NOT_FOUND" };
      }
      if (fileStat.isSymbolicLink()) {
        throw new LocalStorageObjectFileRemovalError(
          "STORAGE_CLEANUP_SYMLINK_REJECTED"
        );
      }

      const isLastSegment = index === segments.length - 1;
      if (!isLastSegment && !fileStat.isDirectory()) {
        throw new LocalStorageObjectFileRemovalError(
          "STORAGE_CLEANUP_NOT_DIRECTORY"
        );
      }
      if (isLastSegment && !fileStat.isFile()) {
        throw new LocalStorageObjectFileRemovalError(
          "STORAGE_CLEANUP_NOT_REGULAR_FILE"
        );
      }
    }

    let canonicalFilePath: string;
    try {
      canonicalFilePath = await this.fileOperations.realpath(filePath);
    } catch (error) {
      if (isStorageCleanupNotFoundError(error)) {
        return { status: "NOT_FOUND" };
      }
      throw new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_DELETE_FAILED"
      );
    }
    if (
      !path.isAbsolute(canonicalFilePath) ||
      !isPathInsideRoot(canonicalRoot, canonicalFilePath)
    ) {
      throw new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_PATH_OUTSIDE_ROOT"
      );
    }

    try {
      await this.fileOperations.remove(filePath);
    } catch (error) {
      if (isStorageCleanupNotFoundError(error)) {
        return { status: "NOT_FOUND" };
      }
      throw new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_DELETE_FAILED"
      );
    }

    return { status: "REMOVED" };
  }

  private async resolveCanonicalRoot(): Promise<string> {
    let canonicalRoot: string;
    try {
      canonicalRoot = await this.fileOperations.realpath(this.baseDir);
      const rootStat = await this.fileOperations.lstat(canonicalRoot);
      if (!path.isAbsolute(canonicalRoot) || !rootStat.isDirectory()) {
        throw new LocalStorageObjectFileRemovalError(
          "STORAGE_CLEANUP_ROOT_UNAVAILABLE"
        );
      }
    } catch (error) {
      if (error instanceof LocalStorageObjectFileRemovalError) {
        throw error;
      }
      throw new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_ROOT_UNAVAILABLE"
      );
    }

    return canonicalRoot;
  }

  private resolveFilePath(canonicalRoot: string, objectKey: string): string {
    try {
      return resolveLocalStorageObjectPath(canonicalRoot, objectKey);
    } catch {
      throw new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_PATH_OUTSIDE_ROOT"
      );
    }
  }

  private async lstatPath(filePath: string): Promise<Stats | null> {
    try {
      return await this.fileOperations.lstat(filePath);
    } catch (error) {
      if (isStorageCleanupNotFoundError(error)) {
        return null;
      }
      throw new LocalStorageObjectFileRemovalError(
        "STORAGE_CLEANUP_DELETE_FAILED"
      );
    }
  }
}

export function createLocalStorageObjectFileRemover(options: {
  baseDir: string;
  fileOperations?: Partial<LocalStorageObjectFileRemovalOperations>;
}): LocalStorageObjectFileRemover {
  return new LocalStorageObjectFileRemovalService(options);
}

export function registerGeneratedAssetsRoute(
  server: FastifyInstance,
  options: {
    env?: Partial<NodeJS.ProcessEnv>;
    baseDir?: string;
    publicPath?: string;
  } = {}
): void {
  const env = options.env ?? process.env;
  const baseDir = path.resolve(options.baseDir ?? resolveGeneratedAssetsDir(env));
  const publicPath = options.publicPath ?? resolveGeneratedAssetsPublicPath(env);
  const routePath = `${publicPath}/*`;

  server.get(routePath, async (request, reply) => {
    return serveGeneratedAsset(request, reply, baseDir);
  });
}

function parseDataUrlImage(dataUrl: string): {
  mimeType: GeneratedAssetMimeType;
  base64: string;
} {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    throw new AssetStorageError("Malformed image data URL");
  }

  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(dataUrl);

  if (!match) {
    throw new AssetStorageError("Malformed image data URL");
  }

	const rawMimeType = match[1];
	const rawBase64 = match[2];

	if (rawMimeType === undefined || rawBase64 === undefined) {
		throw new AssetStorageError("Malformed image data URL");
	}

	const mimeType = rawMimeType.toLowerCase();
	const base64 = rawBase64.replace(/\s/g, "");

  if (!mimeType.startsWith("image/")) {
    throw new AssetStorageError("Only image data URLs are supported");
  }

  if (mimeType === "image/svg+xml") {
    throw new AssetStorageError("SVG data URLs are not supported");
  }

  if (!isSupportedMimeType(mimeType)) {
    throw new AssetStorageError("Unsupported image data URL MIME type");
  }

  if (base64.length === 0) {
    throw new AssetStorageError("Image data URL payload is empty");
  }

  if (!isValidBase64(base64)) {
    throw new AssetStorageError("Malformed image data URL");
  }

  return { mimeType, base64 };
}

function isSupportedMimeType(value: string): value is GeneratedAssetMimeType {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_IMAGE_TYPES, value);
}

function isValidBase64(value: string): boolean {
  if (value.length % 4 !== 0) {
    return false;
  }

  return Buffer.from(value, "base64").toString("base64") === value;
}

function resolveInside(baseDir: string, storageKey: string): string {
  const resolved = path.resolve(baseDir, storageKey);
  const relative = path.relative(baseDir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AssetStorageError("Generated asset path is invalid");
  }

  return resolved;
}

function normalizeStorageObjectUserId(userId: string): string {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }

  return userId.trim();
}

function validateLocalImageStorageObjectSource(
  source: StorageObjectSource
): StorageObjectSource {
  if (!ALLOWED_LOCAL_IMAGE_SOURCES.has(source)) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }

  return source;
}

function parseStrictDataUrlImage(
  dataUrl: string,
  maxBytes: number
): {
  mimeType: GeneratedAssetMimeType;
  buffer: Buffer;
} {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    throw new LocalStorageObjectError("INVALID_IMAGE_DATA_URL");
  }

  const match = STRICT_IMAGE_DATA_URL_PATTERN.exec(dataUrl);
  const rawMimeType = match?.[1];
  const base64 = match?.[2];

  if (
    !rawMimeType ||
    !isSupportedMimeType(rawMimeType) ||
    base64 === undefined ||
    base64.length === 0
  ) {
    throw new LocalStorageObjectError("INVALID_IMAGE_DATA_URL");
  }

  const buffer = decodeStrictBase64Image(base64, maxBytes);
  const detectedMimeType = detectImageMimeType(buffer);
  if (detectedMimeType !== rawMimeType) {
    throw new LocalStorageObjectError("IMAGE_SIGNATURE_MISMATCH");
  }

  return {
    mimeType: detectedMimeType,
    buffer
  };
}

function parseStrictBase64Image(
  base64: string,
  maxBytes: number
): {
  mimeType: GeneratedAssetMimeType;
  buffer: Buffer;
} {
  const buffer = decodeStrictBase64Image(base64, maxBytes);
  const mimeType = detectImageMimeType(buffer);

  if (!mimeType) {
    throw new LocalStorageObjectError("IMAGE_SIGNATURE_MISMATCH");
  }

  return { mimeType, buffer };
}

function parseStrictVideoBytes(
  bytes: Uint8Array,
  maxBytes: number
): Buffer {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }
  if (bytes.byteLength > maxBytes) {
    throw new LocalStorageObjectError("VIDEO_TOO_LARGE");
  }

  const buffer = Buffer.from(bytes);
  if (
    buffer.byteLength < 8 ||
    !buffer.subarray(4, 8).equals(MP4_FTYP_SIGNATURE)
  ) {
    throw new LocalStorageObjectError("VIDEO_SIGNATURE_MISMATCH");
  }

  return buffer;
}

function decodeStrictBase64Image(base64: string, maxBytes: number): Buffer {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }
  if (
    typeof base64 !== "string" ||
    base64.length === 0 ||
    !STRICT_BASE64_PATTERN.test(base64)
  ) {
    throw new LocalStorageObjectError("INVALID_IMAGE_DATA_URL");
  }

  const decodedSize = calculateDecodedBase64Size(base64);
  if (decodedSize > maxBytes) {
    throw new LocalStorageObjectError("IMAGE_TOO_LARGE");
  }
  if (decodedSize <= 0) {
    throw new LocalStorageObjectError("INVALID_IMAGE_DATA_URL");
  }

  const buffer = Buffer.from(base64, "base64");
  if (
    buffer.byteLength === 0 ||
    buffer.toString("base64") !== base64
  ) {
    throw new LocalStorageObjectError("INVALID_IMAGE_DATA_URL");
  }
  if (buffer.byteLength > maxBytes) {
    throw new LocalStorageObjectError("IMAGE_TOO_LARGE");
  }
  if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0) {
    throw new LocalStorageObjectError("INVALID_IMAGE_DATA_URL");
  }

  return buffer;
}

function calculateDecodedBase64Size(base64: string): number {
  const paddingBytes = base64.endsWith("==")
    ? 2
    : base64.endsWith("=")
      ? 1
      : 0;

  return (base64.length / 4) * 3 - paddingBytes;
}

function detectImageMimeType(
  buffer: Buffer
): GeneratedAssetMimeType | undefined {
  if (
    buffer.byteLength >= PNG_SIGNATURE.byteLength &&
    buffer.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
  ) {
    return "image/png";
  }

  const jpegMarker = buffer[3];
  if (
    buffer.byteLength >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    jpegMarker !== undefined &&
    jpegMarker !== 0x00 &&
    jpegMarker !== 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.byteLength >= 20 &&
    buffer.subarray(0, 4).equals(RIFF_SIGNATURE) &&
    buffer.subarray(8, 12).equals(WEBP_SIGNATURE) &&
    buffer.readUInt32LE(4) === buffer.byteLength - 8
  ) {
    const firstChunkType = buffer.toString("ascii", 12, 16);
    const firstChunkSize = buffer.readUInt32LE(16);
    const firstChunkPadding = firstChunkSize % 2;
    const firstChunkEnd = 20 + firstChunkSize + firstChunkPadding;

    if (
      WEBP_FIRST_CHUNK_TYPES.has(firstChunkType) &&
      firstChunkEnd <= buffer.byteLength
    ) {
      return "image/webp";
    }
  }

  return undefined;
}

function createStorageObjectUuid(createUuid: () => string): string {
  const value = createUuid();

  if (!STORAGE_OBJECT_UUID_PATTERN.test(value)) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }

  return value;
}

function validateLocalStorageObjectKey(objectKey: string): void {
  if (
    objectKey.length === 0 ||
    objectKey.length > 512 ||
    objectKey.trim() !== objectKey ||
    objectKey.startsWith("/") ||
    UNSAFE_STORAGE_OBJECT_KEY_CHARACTERS.test(objectKey) ||
    STORAGE_OBJECT_WINDOWS_DRIVE_PATTERN.test(objectKey) ||
    STORAGE_OBJECT_SCHEME_PATTERN.test(objectKey)
  ) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }

  const segments = objectKey.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }
}

function validateStorageCleanupObjectKey(objectKey: string): void {
  if (typeof objectKey !== "string") {
    throw new LocalStorageObjectFileRemovalError(
      "STORAGE_CLEANUP_INVALID_OBJECT_KEY"
    );
  }

  try {
    validateLocalStorageObjectKey(objectKey);
  } catch {
    throw new LocalStorageObjectFileRemovalError(
      "STORAGE_CLEANUP_INVALID_OBJECT_KEY"
    );
  }
}

function isStorageCleanupNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "ENOENT"
  );
}

function resolveLocalStorageObjectPath(
  baseDir: string,
  objectKey: string
): string {
  validateLocalStorageObjectKey(objectKey);
  const resolved = path.resolve(baseDir, objectKey);

  if (!isPathInsideRoot(baseDir, resolved)) {
    throw new LocalStorageObjectError("INVALID_STORAGE_OBJECT_INPUT");
  }

  return resolved;
}

function isPathInsideRoot(baseDir: string, filePath: string): boolean {
  const relative = path.relative(baseDir, filePath);

  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function assertLocalStorageObjectPathHasNoSymlinks(
  baseDir: string,
  objectKey: string
): Promise<void> {
  const segments = objectKey.split("/");
  let currentPath = baseDir;

  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    const fileStat = await lstat(currentPath);

    if (fileStat.isSymbolicLink()) {
      throw new LocalStorageObjectContentUnavailableError();
    }

    const isLastSegment = index === segments.length - 1;
    if (
      (isLastSegment && !fileStat.isFile()) ||
      (!isLastSegment && !fileStat.isDirectory())
    ) {
      throw new LocalStorageObjectContentUnavailableError();
    }
  }
}

async function closeBestEffort(
  handle: FileHandle | undefined,
  fileOperations: LocalStorageObjectFileOperations
): Promise<void> {
  if (!handle) {
    return;
  }

  try {
    await fileOperations.close(handle);
  } catch {
    // Cleanup failures do not replace the primary safe error.
  }
}

async function removeBestEffort(
  filePath: string,
  fileOperations: LocalStorageObjectFileOperations
): Promise<void> {
  try {
    await fileOperations.remove(filePath);
  } catch {
    // Cleanup failures do not replace the primary safe error.
  }
}

async function serveGeneratedAsset(
  request: FastifyRequest,
  reply: FastifyReply,
  baseDir: string
): Promise<FastifyReply> {
  const key = readWildcardParam(request);

  if (!key || key.includes("\0")) {
    return reply.code(404).send({ error: "asset not found" });
  }

  const normalizedKey = key.replace(/\\/g, "/");

  if (
    normalizedKey.startsWith("/") ||
    normalizedKey.split("/").some((segment) => segment === "..")
  ) {
    return reply.code(404).send({ error: "asset not found" });
  }

  const extension = path.extname(normalizedKey).toLowerCase();
  const contentType = CONTENT_TYPES_BY_EXTENSION[extension];

  if (!contentType) {
    return reply.code(404).send({ error: "asset not found" });
  }

  const filePath = resolveInside(baseDir, normalizedKey);

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      return reply.code(404).send({ error: "asset not found" });
    }
  } catch {
    return reply.code(404).send({ error: "asset not found" });
  }

  return reply.type(contentType).send(createReadStream(filePath));
}

function readWildcardParam(request: FastifyRequest): string | undefined {
  const params = request.params;

  if (!params || typeof params !== "object") {
    return undefined;
  }

  const wildcard = (params as Record<string, unknown>)["*"];

  return typeof wildcard === "string" ? wildcard : undefined;
}
