import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import {
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider
} from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteImageStorageService,
  RemoteImageStorageError,
  type RemoteImageStorageFileOperations
} from "../src/remote-image-storage";
import { RemoteImageBodyError } from "../src/remote-image-body";
import type { RemoteImageFetchResult } from "../src/remote-image-fetcher";
import type { StorageObjectRecord, StorageObjectStore } from "../src/store";

type TestStorageObjectStore = Pick<
  StorageObjectStore,
  | "createPendingStorageObject"
  | "findStorageObjectForUser"
  | "markStorageObjectReady"
  | "markStorageObjectFailed"
>;

type ReadyMode =
  | "UPDATED"
  | "ALREADY_READY_MATCHING"
  | "ALREADY_READY_MISMATCHED"
  | "INVALID_PENDING"
  | "INVALID_READY_MATCHING"
  | "NOT_FOUND"
  | "THROW_READY_MATCHING"
  | "THROW_PENDING"
  | "THROW_FIND";

interface TestStoreController {
  store: TestStorageObjectStore;
  created: StorageObjectRecord | null;
  createInputs: Array<{
    userId: string;
    storageProvider: StorageProvider;
    objectKey: string;
    source: StorageObjectSource;
  }>;
  readyInputs: Array<{
    userId: string;
    id: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }>;
  failedInputs: Array<{ userId: string; id: string }>;
  findCalls: number;
  throwCreate: boolean;
  throwMarkFailed: boolean;
  mode: ReadyMode;
}

const testDirectories: string[] = [];
const testStreams = new Set<Readable | Writable>();
const testDeferredResolutions = new Set<() => void>();
const FIXED_NOW = new Date("2026-02-03T04:05:06.000Z");
const OBJECT_UUID = "11111111-1111-4111-8111-111111111111";
const TEMP_UUID = "22222222-2222-4222-8222-222222222222";
const USER_ID = " user_id_preserved ";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

afterEach(async () => {
  for (const resolve of testDeferredResolutions) {
    resolve();
  }
  testDeferredResolutions.clear();
  for (const stream of testStreams) {
    if (!stream.destroyed) {
      stream.destroy();
    }
  }
  testStreams.clear();
  vi.useRealTimers();
  await Promise.all(testDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

function webp(): Buffer {
  const image = Buffer.alloc(20);
  image.write("RIFF", 0, "ascii");
  image.writeUInt32LE(12, 4);
  image.write("WEBP", 8, "ascii");
  image.write("VP8 ", 12, "ascii");
  image.writeUInt32LE(0, 16);
  return image;
}

function createFetchResult(
  body: Uint8Array,
  options: {
    contentType?: string | null;
    contentLength?: number | null;
    stream?: Readable;
    finalHostname?: string;
    sourceUrlHash?: string;
  } = {}
): { fetchResult: RemoteImageFetchResult; cancel: ReturnType<typeof vi.fn> } {
  const stream = options.stream ?? Readable.from([body]);
  testStreams.add(stream);
  const cancel = vi.fn(() => stream.destroy());
  return {
    fetchResult: {
      stream,
      contentType: options.contentType ?? "image/png",
      contentLength: options.contentLength ?? body.byteLength,
      finalHostname: options.finalHostname ?? "provider.example.test",
      redirectCount: 0,
      sourceUrlHash: options.sourceUrlHash ?? "a".repeat(64),
      cancel
    },
    cancel
  };
}

function createRecord(input: {
  objectKey: string;
  status?: StorageObjectStatus;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
}): StorageObjectRecord {
  return {
    id: "storage_object_1",
    userId: USER_ID,
    storageProvider: StorageProvider.LOCAL,
    objectKey: input.objectKey,
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes ?? null,
    sha256: input.sha256 ?? null,
    source: StorageObjectSource.GENERATED,
    status: input.status ?? StorageObjectStatus.PENDING,
    expiresAt: null,
    deletedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW
  };
}

function createStoreController(mode: ReadyMode = "UPDATED"): TestStoreController {
  const controller: TestStoreController = {
    store: undefined as never,
    created: null,
    createInputs: [],
    readyInputs: [],
    failedInputs: [],
    findCalls: 0,
    throwCreate: false,
    throwMarkFailed: false,
    mode
  };

  controller.store = {
    async createPendingStorageObject(input) {
      if (controller.throwCreate) {
        throw new Error("database password and object key must not leak");
      }
      controller.createInputs.push(input);
      controller.created = createRecord({ objectKey: input.objectKey });
      return controller.created;
    },
    async markStorageObjectReady(input) {
      controller.readyInputs.push(input);
      const created = controller.created;
      if (created === null) {
        return { status: "NOT_FOUND" };
      }

      const setMatchingReady = (): void => {
        created.status = StorageObjectStatus.READY;
        created.mimeType = input.mimeType;
        created.sizeBytes = input.sizeBytes;
        created.sha256 = input.sha256;
      };

      if (controller.mode === "UPDATED") {
        setMatchingReady();
        return { status: "UPDATED" };
      }
      if (controller.mode === "ALREADY_READY_MATCHING") {
        setMatchingReady();
        return { status: "ALREADY_READY" };
      }
      if (controller.mode === "ALREADY_READY_MISMATCHED") {
        created.status = StorageObjectStatus.READY;
        created.mimeType = "image/jpeg";
        created.sizeBytes = 7;
        created.sha256 = "b".repeat(64);
        return { status: "ALREADY_READY" };
      }
      if (controller.mode === "INVALID_READY_MATCHING") {
        setMatchingReady();
        return { status: "INVALID_STATE" };
      }
      if (controller.mode === "NOT_FOUND") {
        controller.created = null;
        return { status: "NOT_FOUND" };
      }
      if (controller.mode === "THROW_READY_MATCHING") {
        setMatchingReady();
        throw new Error("database response disconnected");
      }
      if (controller.mode === "THROW_PENDING") {
        throw new Error("database response disconnected");
      }
      return { status: "INVALID_STATE" };
    },
    async markStorageObjectFailed(input) {
      controller.failedInputs.push(input);
      if (controller.throwMarkFailed) {
        throw new Error("database failed-state message");
      }
      if (controller.created !== null) {
        controller.created.status = StorageObjectStatus.FAILED;
      }
      return { status: "UPDATED" };
    },
    async findStorageObjectForUser() {
      controller.findCalls += 1;
      if (controller.mode === "THROW_FIND") {
        throw new Error("database find failure");
      }
      return controller.created;
    }
  };

  return controller;
}

async function createTemporaryRoot(): Promise<string> {
  const directory = await mkdtemp(path.join("/tmp", "remote-image-storage-"));
  testDirectories.push(directory);
  return directory;
}

async function createService(options: {
  root?: string;
  store?: TestStoreController;
  mode?: ReadyMode;
  createUuid?: () => string;
  fileOperations?: Partial<RemoteImageStorageFileOperations>;
  now?: () => Date;
} = {}) {
  const root = options.root ?? (await createTemporaryRoot());
  const controller = options.store ?? createStoreController(options.mode);
  const uuidValues = [OBJECT_UUID, TEMP_UUID];
  const service = createRemoteImageStorageService({
    storageObjectStore: controller.store,
    generatedAssetsDir: root,
    now: options.now ?? (() => FIXED_NOW),
    createUuid:
      options.createUuid ??
      (() => uuidValues.shift() ?? randomUUID()),
    fileOperations: options.fileOperations
  });
  return { root, controller, service };
}

function expectedObjectKey(extension: string): string {
  return `images/2026/02/${OBJECT_UUID}.${extension}`;
}

function expectedTempKey(): string {
  return `images/2026/02/.${OBJECT_UUID}.${TEMP_UUID}.tmp`;
}

function expectStorageError(
  error: unknown,
  code: RemoteImageStorageError["code"]
): void {
  expect(error).toBeInstanceOf(RemoteImageStorageError);
  expect((error as RemoteImageStorageError).code).toBe(code);
  expect((error as RemoteImageStorageError).stage).toBe("storage");
}

describe("RemoteImageStorageService success", () => {
  it("persists a PNG as a local generated READY object", async () => {
    const { root, controller, service } = await createService();
    const { fetchResult, cancel } = createFetchResult(PNG);

    const result = await service.persistRemoteImage({
      userId: USER_ID,
      fetchResult
    });

    expect(result).toEqual({
      storageObjectId: "storage_object_1",
      objectKey: expectedObjectKey("png"),
      mimeType: "image/png",
      sizeBytes: PNG.byteLength,
      sha256: createHash("sha256").update(PNG).digest("hex")
    });
    expect(Object.keys(result).sort()).toEqual([
      "mimeType",
      "objectKey",
      "sha256",
      "sizeBytes",
      "storageObjectId"
    ]);
    expect(controller.createInputs).toEqual([
      {
        userId: USER_ID,
        storageProvider: StorageProvider.LOCAL,
        objectKey: expectedObjectKey("png"),
        source: StorageObjectSource.GENERATED
      }
    ]);
    expect(controller.readyInputs).toEqual([
      {
        userId: USER_ID,
        id: "storage_object_1",
        mimeType: "image/png",
        sizeBytes: PNG.byteLength,
        sha256: result.sha256
      }
    ]);
    expect(controller.created?.status).toBe(StorageObjectStatus.READY);
    expect(cancel).not.toHaveBeenCalled();
    expect(await readFile(path.join(root, result.objectKey))).toEqual(PNG);
  });

  it("persists a JPEG with the canonical jpg extension", async () => {
    const { root, service } = await createService();
    const { fetchResult } = createFetchResult(JPEG, { contentType: "image/jpeg" });

    const result = await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(result.objectKey).toBe(expectedObjectKey("jpg"));
    expect(result.mimeType).toBe("image/jpeg");
    expect(await readFile(path.join(root, result.objectKey))).toEqual(JPEG);
  });

  it("persists a WebP with the canonical webp extension", async () => {
    const { root, service } = await createService();
    const image = webp();
    const { fetchResult } = createFetchResult(image, { contentType: "image/webp" });

    const result = await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(result.objectKey).toBe(expectedObjectKey("webp"));
    expect(result.mimeType).toBe("image/webp");
    expect(await readFile(path.join(root, result.objectKey))).toEqual(image);
  });

  it("uses UTC year and month in the object key", async () => {
    const { service } = await createService({
      now: () => new Date("2025-12-31T23:30:00.000-02:00")
    });
    const { fetchResult } = createFetchResult(PNG);

    const result = await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(result.objectKey).toMatch(/^images\/2026\/01\//u);
  });

  it("uses strict v4 UUIDs for the object key", async () => {
    const { service } = await createService();
    const { fetchResult } = createFetchResult(PNG);

    const result = await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(result.objectKey).toMatch(
      /^images\/2026\/02\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/u
    );
  });

  it("keeps the final file inside an absolute resolved root", async () => {
    const root = await createTemporaryRoot();
    const relativeRoot = path.relative(process.cwd(), root);
    const { service } = await createService({ root: relativeRoot });
    const { fetchResult } = createFetchResult(PNG);

    const result = await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(path.resolve(relativeRoot, result.objectKey)).toBe(
      path.join(root, result.objectKey)
    );
  });

  it("uses mode 0600 for both temporary and final files", async () => {
    const { root, service } = await createService();
    const { fetchResult } = createFetchResult(PNG);

    const result = await service.persistRemoteImage({ userId: USER_ID, fetchResult });
    const fileStat = await stat(path.join(root, result.objectKey));

    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it("removes the same-directory temporary file after rename", async () => {
    const { root, service } = await createService();
    const { fetchResult } = createFetchResult(PNG);

    await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(await readdir(path.join(root, "images", "2026", "02"))).not.toContain(
      path.basename(expectedTempKey())
    );
  });

  it("does not use fetch-result hostname or source hash for the object key", async () => {
    const { controller, service } = await createService();
    const { fetchResult } = createFetchResult(PNG, {
      finalHostname: "not-a-filename.example.test",
      sourceUrlHash: "provider-url-hash-should-not-appear"
    });

    const result = await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(result.objectKey).not.toContain("provider");
    expect(result.objectKey).not.toContain("filename");
    expect(JSON.stringify(controller.createInputs[0])).not.toContain("metadata");
  });

  it("replaces the final exclusive placeholder with complete image bytes", async () => {
    const { root, service } = await createService();
    const { fetchResult } = createFetchResult(PNG);

    const result = await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect((await stat(path.join(root, result.objectKey))).size).toBe(PNG.byteLength);
    expect(createHash("sha256").update(await readFile(path.join(root, result.objectKey))).digest("hex")).toBe(result.sha256);
  });
});

describe("RemoteImageStorageService input and exclusive paths", () => {
  it("rejects an empty storage root", () => {
    const controller = createStoreController();

    expect(() => createRemoteImageStorageService({
      storageObjectStore: controller.store,
      generatedAssetsDir: ""
    })).toThrowError(RemoteImageStorageError);
  });

  it("rejects a blank user ID without trimming the valid stored value", async () => {
    const { service } = await createService();
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: "   ", fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_INPUT_INVALID"
    });
  });

  it("rejects a non-object fetch result", async () => {
    const { service } = await createService();

    await expect(service.persistRemoteImage({
      userId: USER_ID,
      fetchResult: null as never
    })).rejects.toMatchObject({ code: "REMOTE_IMAGE_STORAGE_INPUT_INVALID" });
  });

  it("rejects a malformed injected UUID", async () => {
    const { service } = await createService({ createUuid: () => "not-a-uuid" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_INPUT_INVALID"
    });
  });

  it("rejects an injected UUID containing a backslash", async () => {
    const { service } = await createService({
      createUuid: () => "11111111-1111-4111-8111-11111111\\111"
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_INPUT_INVALID"
    });
  });

  it("rejects an injected UUID containing traversal", async () => {
    const { service } = await createService({ createUuid: () => "../escape" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_INPUT_INVALID"
    });
  });

  it("does not overwrite an existing final file", async () => {
    const root = await createTemporaryRoot();
    const finalPath = path.join(root, expectedObjectKey("png"));
    await writeFile(finalPath, Buffer.from("original-final"), { flag: "wx", mode: 0o600 }).catch(async () => {
      await mkdir(path.dirname(finalPath), { recursive: true });
      await writeFile(finalPath, Buffer.from("original-final"), { flag: "wx", mode: 0o600 });
    });
    const { controller, service } = await createService({ root });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_FINAL_FILE_FAILED"
    });
    expect(await readFile(finalPath, "utf8")).toBe("original-final");
    expect(controller.createInputs).toHaveLength(0);
  });

  it("does not overwrite a conflicting temporary file created with wx", async () => {
    const root = await createTemporaryRoot();
    const tempPath = path.join(root, expectedTempKey());
    await mkdir(path.dirname(tempPath), { recursive: true });
    await writeFile(tempPath, "original-temp", { flag: "wx", mode: 0o600 });
    const { controller, service } = await createService({ root });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED"
    });
    expect(await readFile(tempPath, "utf8")).toBe("original-temp");
    expect(controller.createInputs).toHaveLength(0);
  });
});

describe("RemoteImageStorageService D1 error propagation", () => {
  it("passes through TOO_LARGE and removes the temporary file", async () => {
    const { root, controller, service } = await createService();
    const { fetchResult } = createFetchResult(PNG, { contentLength: 10 * 1024 * 1024 + 1 });

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_TOO_LARGE",
      stage: "body"
    });
    await expect(stat(path.join(root, expectedTempKey()))).rejects.toThrow();
    expect(controller.createInputs).toHaveLength(0);
  });

  it("passes through MAGIC_UNSUPPORTED", async () => {
    const { controller, service } = await createService();
    const { fetchResult } = createFetchResult(Buffer.from("GIF89a"), { contentType: "image/gif" });

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toBeInstanceOf(RemoteImageBodyError);
    expect(controller.createInputs).toHaveLength(0);
  });

  it("passes through MIME_MISMATCH", async () => {
    const { service } = await createService();
    const { fetchResult } = createFetchResult(PNG, { contentType: "image/jpeg" });

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_MIME_MISMATCH"
    });
  });

  it("passes through BODY_TIMEOUT", async () => {
    vi.useFakeTimers();
    let readStartedResolved = false;
    let resolveReadStarted: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      const resolveOnce = (): void => {
        if (!readStartedResolved) {
          readStartedResolved = true;
          testDeferredResolutions.delete(resolveOnce);
          resolve();
        }
      };
      resolveReadStarted = resolveOnce;
      testDeferredResolutions.add(resolveOnce);
    });
    const stalled = new Readable({
      read() {
        resolveReadStarted?.();
      }
    });
    const { service } = await createService();
    const { fetchResult } = createFetchResult(PNG, { stream: stalled });
    const result = service.persistRemoteImage({ userId: USER_ID, fetchResult });

    await readStarted;
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(result).rejects.toMatchObject({ code: "REMOTE_IMAGE_BODY_TIMEOUT" });
  });

  it("passes through ABORTED", async () => {
    const controller = new AbortController();
    controller.abort();
    const { service } = await createService();
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({
      userId: USER_ID,
      fetchResult,
      signal: controller.signal
    })).rejects.toMatchObject({ code: "REMOTE_IMAGE_ABORTED" });
  });

  it("passes through DESTINATION_FAILED from D1", async () => {
    const root = await createTemporaryRoot();
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("destination failure detail"));
      }
    });
    testStreams.add(destination);
    const fakeHandle = {
      createWriteStream: () => destination,
      sync: async () => undefined,
      close: async () => {
        destination.destroy();
      }
    } as FileHandle;
    let openCalls = 0;
    const { service } = await createService({
      root,
      fileOperations: {
        async openExclusive(filePath, mode) {
          openCalls += 1;
          if (openCalls === 1) {
            await writeFile(filePath, "", { flag: "wx", mode });
            return fakeHandle;
          }
          return open(filePath, "wx", mode);
        }
      }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_DESTINATION_FAILED",
      stage: "body"
    });
  });

  it("preserves the original D1 error instance", async () => {
    const { service } = await createService();
    const { fetchResult } = createFetchResult(PNG, { contentLength: 10 * 1024 * 1024 + 1 });

    try {
      await service.persistRemoteImage({ userId: USER_ID, fetchResult });
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteImageBodyError);
      return;
    }
    throw new Error("expected D1 error");
  });
});

describe("RemoteImageStorageService filesystem failures", () => {
  it("maps mkdir failures without creating a StorageObject", async () => {
    const { controller, service } = await createService({
      fileOperations: { async createDirectory() { throw new Error("mkdir secret"); } }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_DIRECTORY_FAILED"
    });
    expect(controller.createInputs).toHaveLength(0);
  });

  it("maps temporary open failures", async () => {
    const { controller, service } = await createService({
      fileOperations: { async openExclusive() { throw new Error("open secret"); } }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED"
    });
    expect(controller.createInputs).toHaveLength(0);
  });

  it("maps sync failures and removes the temporary file", async () => {
    const { root, controller, service } = await createService({
      fileOperations: { async sync() { throw new Error("sync secret"); } }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_SYNC_FAILED"
    });
    await expect(stat(path.join(root, expectedTempKey()))).rejects.toThrow();
    expect(controller.createInputs).toHaveLength(0);
  });

  it("maps a primary temporary close failure", async () => {
    const { service } = await createService({
      fileOperations: {
        async close(handle) {
          await handle.close();
          throw new Error("close secret");
        }
      }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED"
    });
  });

  it("maps a placeholder close failure after closing its real handle", async () => {
    let closeCalls = 0;
    const { root, controller, service } = await createService({
      fileOperations: {
        async close(handle) {
          await handle.close();
          closeCalls += 1;
          if (closeCalls === 2) {
            throw new Error("placeholder close secret");
          }
        }
      }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_FINAL_FILE_FAILED"
    });
    await expect(stat(path.join(root, expectedObjectKey("png")))).rejects.toThrow();
    expect(controller.createInputs).toHaveLength(0);
  });

  it("maps final placeholder reservation failures before creating PENDING", async () => {
    let openCalls = 0;
    const { controller, service } = await createService({
      fileOperations: {
        async openExclusive(filePath, mode) {
          openCalls += 1;
          if (openCalls === 2) {
            throw new Error("final reservation secret");
          }
          return open(filePath, "wx", mode);
        }
      }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_FINAL_FILE_FAILED"
    });
    expect(controller.createInputs).toHaveLength(0);
  });

  it("marks PENDING failed after rename failure", async () => {
    const { controller, service } = await createService({
      fileOperations: { async rename() { throw new Error("rename secret"); } }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_RENAME_FAILED"
    });
    expect(controller.failedInputs).toEqual([{ userId: USER_ID, id: "storage_object_1" }]);
  });

  it("does not replace a rename error when temporary cleanup fails", async () => {
    const { service } = await createService({
      fileOperations: {
        async rename() { throw new Error("rename secret"); },
        async remove() { throw new Error("unlink secret"); }
      }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_RENAME_FAILED"
    });
  });

  it("does not replace a READY failure when final cleanup fails", async () => {
    const { service } = await createService({
      mode: "INVALID_PENDING",
      fileOperations: { async remove() { throw new Error("unlink secret"); } }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_READY_FAILED"
    });
  });
});

describe("RemoteImageStorageService StorageObject readiness reconciliation", () => {
  it("does not rename or mark failed when PENDING creation throws", async () => {
    const controller = createStoreController();
    controller.throwCreate = true;
    const rename = vi.fn();
    const { root, service } = await createService({
      store: controller,
      fileOperations: { async rename(sourcePath, destinationPath) { rename(sourcePath, destinationPath); } }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_OBJECT_FAILED"
    });
    expect(rename).not.toHaveBeenCalled();
    expect(controller.failedInputs).toHaveLength(0);
    await expect(stat(path.join(root, expectedTempKey()))).rejects.toThrow();
  });

  it("accepts ALREADY_READY only after a matching reread", async () => {
    const { controller, service } = await createService({ mode: "ALREADY_READY_MATCHING" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).resolves.toMatchObject({
      storageObjectId: "storage_object_1"
    });
    expect(controller.findCalls).toBe(1);
  });

  it("keeps the final file for mismatched READY state", async () => {
    const { root, controller, service } = await createService({ mode: "ALREADY_READY_MISMATCHED" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_STATE_UNKNOWN"
    });
    expect(await readFile(path.join(root, expectedObjectKey("png")))).toEqual(PNG);
    expect(controller.failedInputs).toHaveLength(0);
  });

  it("accepts INVALID_STATE when the reread is matching READY", async () => {
    const { controller, service } = await createService({ mode: "INVALID_READY_MATCHING" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).resolves.toMatchObject({
      mimeType: "image/png"
    });
    expect(controller.findCalls).toBe(1);
  });

  it("cleans final and marks PENDING failed after INVALID_STATE", async () => {
    const { root, controller, service } = await createService({ mode: "INVALID_PENDING" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_READY_FAILED"
    });
    await expect(stat(path.join(root, expectedObjectKey("png")))).rejects.toThrow();
    expect(controller.failedInputs).toHaveLength(1);
  });

  it("cleans final after NOT_FOUND reread", async () => {
    const { root, controller, service } = await createService({ mode: "NOT_FOUND" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_READY_FAILED"
    });
    await expect(stat(path.join(root, expectedObjectKey("png")))).rejects.toThrow();
    expect(controller.failedInputs).toHaveLength(0);
  });

  it("accepts a matching READY reread after markReady throws", async () => {
    const { controller, service } = await createService({ mode: "THROW_READY_MATCHING" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).resolves.toMatchObject({
      storageObjectId: "storage_object_1"
    });
    expect(controller.findCalls).toBe(1);
  });

  it("cleans final and marks failed when markReady throws with PENDING", async () => {
    const { root, controller, service } = await createService({ mode: "THROW_PENDING" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_READY_FAILED"
    });
    await expect(stat(path.join(root, expectedObjectKey("png")))).rejects.toThrow();
    expect(controller.failedInputs).toHaveLength(1);
  });

  it("keeps final and does not mark failed when reread throws", async () => {
    const { root, controller, service } = await createService({ mode: "THROW_FIND" });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_STATE_UNKNOWN"
    });
    expect(await readFile(path.join(root, expectedObjectKey("png")))).toEqual(PNG);
    expect(controller.failedInputs).toHaveLength(0);
  });

  it("does not replace a rename failure when markFailed throws", async () => {
    const controller = createStoreController();
    controller.throwMarkFailed = true;
    const { service } = await createService({
      store: controller,
      fileOperations: { async rename() { throw new Error("rename secret"); } }
    });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_RENAME_FAILED"
    });
  });
});

describe("RemoteImageStorageService safety", () => {
  it("does not leak root, user, provider data, object key, or filesystem detail", async () => {
    const root = await createTemporaryRoot();
    const userId = "secret-user-id";
    const { service } = await createService({
      root,
      fileOperations: { async createDirectory() { throw new Error("fs /private/root secret"); } }
    });
    const { fetchResult } = createFetchResult(PNG, {
      finalHostname: "credential-host.example.test",
      sourceUrlHash: "provider-source-url-hash"
    });

    try {
      await service.persistRemoteImage({ userId, fetchResult });
    } catch (error) {
      expectStorageError(error, "REMOTE_IMAGE_STORAGE_DIRECTORY_FAILED");
      const rendered = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack?.split("\n")[0]}`;
      for (const secret of [root, userId, "credential-host", "provider-source", OBJECT_UUID, "fs /private"]) {
        expect(rendered).not.toContain(secret);
      }
      return;
    }
    throw new Error("expected storage error");
  });

  it("does not leak a database error", async () => {
    const controller = createStoreController();
    controller.throwCreate = true;
    const { service } = await createService({ store: controller });
    const { fetchResult } = createFetchResult(PNG);

    await expect(service.persistRemoteImage({ userId: USER_ID, fetchResult })).rejects.toMatchObject({
      code: "REMOTE_IMAGE_STORAGE_OBJECT_FAILED"
    });
  });

  it("does not accept a caller-provided object key or MIME field", async () => {
    const { service } = await createService();
    const { fetchResult } = createFetchResult(PNG);

    const result = await service.persistRemoteImage({
      userId: USER_ID,
      fetchResult,
      objectKey: "attacker.png",
      mimeType: "image/jpeg"
    } as never);

    expect(result.objectKey).toBe(expectedObjectKey("png"));
    expect(result.mimeType).toBe("image/png");
  });

  it("does not modify a StorageObject with metadata", async () => {
    const { controller, service } = await createService();
    const { fetchResult } = createFetchResult(PNG);

    await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(Object.keys(controller.createInputs[0] ?? {}).sort()).toEqual([
      "objectKey",
      "source",
      "storageProvider",
      "userId"
    ]);
  });

  it("does not call a real network or database dependency", async () => {
    const controller = createStoreController();
    const { service } = await createService({ store: controller });
    const { fetchResult } = createFetchResult(PNG);

    await service.persistRemoteImage({ userId: USER_ID, fetchResult });

    expect(controller.createInputs).toHaveLength(1);
    expect(controller.findCalls).toBe(0);
  });
});
