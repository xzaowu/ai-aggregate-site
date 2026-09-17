import {
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  mkdtemp,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  LocalAssetStorage,
  LocalStorageObjectContentService,
  LocalStorageObjectContentUnavailableError,
  LocalStorageObjectError,
  LocalStorageObjectFileRemovalError,
  LocalStorageObjectFileRemovalService,
  LocalStorageObjectService,
  type LocalStorageObjectFileRemovalOperations,
  type LocalStorageObjectFileOperations,
  type LocalStorageObjectStore,
  type PersistLocalImageStorageObjectInput,
  type PersistLocalVideoStorageObjectInput
} from "../src/asset-storage";
import type {
  CreatePendingStorageObjectInput,
  MarkStorageObjectFailedResult,
  MarkStorageObjectReadyInput,
  MarkStorageObjectReadyResult,
  OwnedStorageObjectInput,
  StorageObjectRecord
} from "../src/store";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const OBJECT_UUID = "00000000-0000-4000-8000-000000000001";
const TEMP_UUID = "00000000-0000-4000-8000-000000000002";
const OBJECT_KEY = `images/2026/07/${OBJECT_UUID}.png`;
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00
]);
const MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d,
  0x69, 0x73, 0x6f, 0x32
]);

function createWebpBytes(
  firstChunkType: string,
  payload: Buffer,
  includeRequiredPadding = true
): Buffer {
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write(firstChunkType, 0, 4, "ascii");
  chunkHeader.writeUInt32LE(payload.byteLength, 4);
  const padding =
    payload.byteLength % 2 === 1 && includeRequiredPadding
      ? Buffer.from([0])
      : Buffer.alloc(0);
  const riffPayload = Buffer.concat([
    Buffer.from("WEBP", "ascii"),
    chunkHeader,
    payload,
    padding
  ]);
  const riffHeader = Buffer.alloc(8);
  riffHeader.write("RIFF", 0, 4, "ascii");
  riffHeader.writeUInt32LE(riffPayload.byteLength, 4);
  return Buffer.concat([riffHeader, riffPayload]);
}

function withWebpDeclaredSize(bytes: Buffer, declaredSize: number): Buffer {
  const result = Buffer.from(bytes);
  result.writeUInt32LE(declaredSize, 4);
  return result;
}

function withWebpFirstChunkSize(bytes: Buffer, chunkSize: number): Buffer {
  const result = Buffer.from(bytes);
  result.writeUInt32LE(chunkSize, 16);
  return result;
}

const WEBP_BYTES = createWebpBytes(
  "VP8 ",
  Buffer.from([0x9d, 0x01, 0x2a, 0x00])
);

type ServiceOptions = Omit<
  ConstructorParameters<typeof LocalStorageObjectService>[0],
  "store" | "baseDir"
>;

class FakeStorageObjectStore implements LocalStorageObjectStore {
  readonly calls: string[] = [];
  readonly records = new Map<string, StorageObjectRecord>();
  createError: Error | undefined;
  readyError: Error | undefined;
  readyErrorAfterUpdate: Error | undefined;
  failedError: Error | undefined;
  readyResult: MarkStorageObjectReadyResult | undefined;
  failedResult: MarkStorageObjectFailedResult | undefined;
  private nextId = 1;

  async createPendingStorageObject(
    input: CreatePendingStorageObjectInput
  ): Promise<StorageObjectRecord> {
    this.calls.push("createPending");
    if (this.createError) {
      throw this.createError;
    }

    const timestamp = new Date(NOW);
    const record: StorageObjectRecord = {
      id: `storage-object-${this.nextId}`,
      userId: input.userId,
      storageProvider: input.storageProvider,
      objectKey: input.objectKey,
      mimeType: null,
      sizeBytes: null,
      sha256: null,
      source: input.source,
      status: StorageObjectStatus.PENDING,
      expiresAt: input.expiresAt ?? null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.nextId += 1;
    this.records.set(record.id, record);
    return record;
  }

  async markStorageObjectReady(
    input: MarkStorageObjectReadyInput
  ): Promise<MarkStorageObjectReadyResult> {
    this.calls.push("markReady");
    if (this.readyError) {
      throw this.readyError;
    }
    if (this.readyResult) {
      return this.readyResult;
    }

    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId) {
      return { status: "NOT_FOUND" };
    }
    if (record.status === StorageObjectStatus.READY) {
      return { status: "ALREADY_READY" };
    }
    if (record.status !== StorageObjectStatus.PENDING) {
      return { status: "INVALID_STATE" };
    }

    this.records.set(input.id, {
      ...record,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      status: StorageObjectStatus.READY,
      updatedAt: new Date(NOW.getTime() + 1)
    });
    if (this.readyErrorAfterUpdate) {
      throw this.readyErrorAfterUpdate;
    }
    return { status: "UPDATED" };
  }

  async markStorageObjectFailed(
    input: OwnedStorageObjectInput
  ): Promise<MarkStorageObjectFailedResult> {
    this.calls.push("markFailed");
    if (this.failedError) {
      throw this.failedError;
    }
    if (this.failedResult) {
      return this.failedResult;
    }

    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId) {
      return { status: "NOT_FOUND" };
    }
    if (record.status === StorageObjectStatus.FAILED) {
      return { status: "ALREADY_FAILED" };
    }
    if (record.status !== StorageObjectStatus.PENDING) {
      return { status: "INVALID_STATE" };
    }

    this.records.set(input.id, {
      ...record,
      status: StorageObjectStatus.FAILED,
      updatedAt: new Date(NOW.getTime() + 1)
    });
    return { status: "UPDATED" };
  }
}

function dataUrl(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function sequentialUuidFactory(): () => string {
  let value = 1;

  return () => {
    const suffix = String(value).padStart(12, "0");
    value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
}

function createService(
  rootDir: string,
  store: FakeStorageObjectStore,
  options: ServiceOptions = {}
): LocalStorageObjectService {
  return new LocalStorageObjectService({
    store,
    baseDir: rootDir,
    publicPath: "/generated-assets",
    now: () => new Date(NOW),
    randomUUID: sequentialUuidFactory(),
    ...options
  });
}

function persist(
  service: LocalStorageObjectService,
  overrides: Partial<PersistLocalImageStorageObjectInput> = {}
) {
  return service.persistLocalImageStorageObject({
    userId: "user-1",
    source: StorageObjectSource.UPLOAD,
    dataUrl: dataUrl("image/png", PNG_BYTES),
    maxBytes: 1024,
    ...overrides
  });
}

function persistVideo(
  service: LocalStorageObjectService,
  overrides: Partial<PersistLocalVideoStorageObjectInput> = {}
) {
  return service.persistLocalVideoStorageObject({
    userId: "user-1",
    source: StorageObjectSource.GENERATED,
    bytes: MP4_BYTES,
    maxBytes: 1024,
    ...overrides
  });
}

async function captureError(action: Promise<unknown>): Promise<Error> {
  try {
    await action;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error("EXPECTED_OPERATION_TO_FAIL");
}

async function expectLocalError(
  action: Promise<unknown>,
  code: LocalStorageObjectError["code"]
): Promise<LocalStorageObjectError> {
  const error = await captureError(action);
  expect(error).toBeInstanceOf(LocalStorageObjectError);
  if (!(error instanceof LocalStorageObjectError)) {
    throw new Error("EXPECTED_LOCAL_STORAGE_OBJECT_ERROR");
  }
  expect(error.code).toBe(code);
  expect(error.message).toBe(code);
  return error;
}

async function listRelativeFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(directoryPath: string): Promise<void> {
    const entries: Dirent[] = await readdir(directoryPath, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else {
        results.push(path.relative(rootDir, absolutePath));
      }
    }
  }

  await visit(rootDir);
  return results.sort();
}

function realFileOperations(events?: string[]): LocalStorageObjectFileOperations {
  return {
    async createDirectory(directoryPath) {
      await mkdir(directoryPath, { recursive: true });
    },
    async openExclusive(filePath) {
      return open(filePath, "wx", 0o600);
    },
    async write(handle, bytes) {
      events?.push("fileWrite");
      await handle.writeFile(bytes);
    },
    async sync(handle) {
      await handle.sync();
    },
    async close(handle) {
      await handle.close();
    },
    async rename(sourcePath, destinationPath) {
      events?.push("rename");
      await rename(sourcePath, destinationPath);
    },
    async remove(filePath) {
      await unlink(filePath);
    }
  };
}

describe("LocalStorageObjectService", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(
      path.join(tmpdir(), "s2-b1-asset-storage-")
    );
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("persists a valid PNG as a READY local StorageObject", async () => {
    const store = new FakeStorageObjectStore();
    const result = await persist(createService(rootDir, store));
    const finalPath = path.resolve(rootDir, result.objectKey);
    const expectedSha256 = createHash("sha256")
      .update(PNG_BYTES)
      .digest("hex");

    expect(result).toMatchObject({
      storageObjectId: "storage-object-1",
      objectKey: OBJECT_KEY,
      publicUrl: `/generated-assets/${OBJECT_KEY}`,
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      sha256: expectedSha256
    });
    expect(result.storageObject).toEqual({
      id: "storage-object-1",
      userId: "user-1",
      storageProvider: StorageProvider.LOCAL,
      objectKey: OBJECT_KEY,
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      sha256: expectedSha256,
      source: StorageObjectSource.UPLOAD,
      status: StorageObjectStatus.READY
    });
    expect(JSON.stringify(result)).not.toContain(rootDir);
    expect(() => JSON.stringify(result)).not.toThrow();
    await expect(readFile(finalPath)).resolves.toEqual(PNG_BYTES);
    expect(store.records.get("storage-object-1")?.status).toBe(
      StorageObjectStatus.READY
    );
  });

  it("persists a valid JPEG for the GENERATED source", async () => {
    const store = new FakeStorageObjectStore();
    const result = await persist(createService(rootDir, store), {
      source: StorageObjectSource.GENERATED,
      dataUrl: dataUrl("image/jpeg", JPEG_BYTES)
    });

    expect(result.objectKey).toBe(
      `images/2026/07/${OBJECT_UUID}.jpg`
    );
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.sizeBytes).toBe(JPEG_BYTES.byteLength);
    expect(result.storageObject.source).toBe(
      StorageObjectSource.GENERATED
    );
    await expect(
      readFile(path.resolve(rootDir, result.objectKey))
    ).resolves.toEqual(JPEG_BYTES);
  });

  it("persists a valid naked Base64 image through the StorageObject path", async () => {
    const store = new FakeStorageObjectStore();
    const result = await createService(rootDir, store).persistLocalImageStorageObject({
      userId: "user-1",
      source: StorageObjectSource.GENERATED,
      base64: PNG_BYTES.toString("base64"),
      maxBytes: 1024
    });

    expect(result.mimeType).toBe("image/png");
    expect(result.storageObject.source).toBe(StorageObjectSource.GENERATED);
    await expect(
      readFile(path.resolve(rootDir, result.objectKey))
    ).resolves.toEqual(PNG_BYTES);
  });

  it("persists a valid MP4 as a READY local StorageObject", async () => {
    const store = new FakeStorageObjectStore();
    const result = await persistVideo(createService(rootDir, store));

    expect(result).toMatchObject({
      storageObjectId: "storage-object-1",
      objectKey: `videos/2026/07/${OBJECT_UUID}.mp4`,
      publicUrl: `/generated-assets/videos/2026/07/${OBJECT_UUID}.mp4`,
      mimeType: "video/mp4",
      sizeBytes: MP4_BYTES.byteLength
    });
    expect(result.storageObject.status).toBe(StorageObjectStatus.READY);
    await expect(
      readFile(path.resolve(rootDir, result.objectKey))
    ).resolves.toEqual(MP4_BYTES);
  });

  it("rejects an oversized MP4 before Store or filesystem writes", async () => {
    const store = new FakeStorageObjectStore();
    await expectLocalError(
      persistVideo(createService(rootDir, store), {
        maxBytes: MP4_BYTES.byteLength - 1
      }),
      "VIDEO_TOO_LARGE"
    );

    expect(store.calls).toEqual([]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("rejects an MP4 with an invalid container signature", async () => {
    const store = new FakeStorageObjectStore();
    const invalidBytes = Buffer.from(MP4_BYTES);
    invalidBytes.write("moov", 4, 4, "ascii");

    await expectLocalError(
      persistVideo(createService(rootDir, store), { bytes: invalidBytes }),
      "VIDEO_SIGNATURE_MISMATCH"
    );

    expect(store.calls).toEqual([]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it.each([
    {
      label: "VP8",
      bytes: WEBP_BYTES
    },
    {
      label: "VP8L",
      bytes: createWebpBytes(
        "VP8L",
        Buffer.from([0x2f, 0x00, 0x00, 0x00])
      )
    },
    {
      label: "VP8X",
      bytes: createWebpBytes(
        "VP8X",
        Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
      )
    }
  ])(
    "persists a valid $label WebP with its signature-derived extension",
    async ({ bytes }) => {
      const store = new FakeStorageObjectStore();
      const result = await persist(createService(rootDir, store), {
        source: StorageObjectSource.GENERATED,
        dataUrl: dataUrl("image/webp", bytes)
      });

      expect(result.objectKey).toBe(
        `images/2026/07/${OBJECT_UUID}.webp`
      );
      expect(result.mimeType).toBe("image/webp");
      await expect(
        readFile(path.resolve(rootDir, result.objectKey))
      ).resolves.toEqual(bytes);
    }
  );

  it("accepts an odd WebP first chunk payload with one padding byte", async () => {
    const bytes = createWebpBytes(
      "VP8 ",
      Buffer.from([0x9d, 0x01, 0x2a])
    );
    const store = new FakeStorageObjectStore();
    const result = await persist(createService(rootDir, store), {
      dataUrl: dataUrl("image/webp", bytes)
    });

    expect(result.mimeType).toBe("image/webp");
    await expect(
      readFile(path.resolve(rootDir, result.objectKey))
    ).resolves.toEqual(bytes);
  });

  it.each([
    {
      label: "RIFF declared size greater than the actual buffer",
      bytes: withWebpDeclaredSize(
        WEBP_BYTES,
        WEBP_BYTES.byteLength - 8 + 2
      )
    },
    {
      label: "RIFF declared size smaller than the actual buffer",
      bytes: withWebpDeclaredSize(
        WEBP_BYTES,
        WEBP_BYTES.byteLength - 8 - 2
      )
    },
    {
      label: "unaccounted trailing garbage",
      bytes: Buffer.concat([WEBP_BYTES, Buffer.from([0xde, 0xad])])
    },
    {
      label: "unknown first chunk FourCC",
      bytes: createWebpBytes("JUNK", Buffer.from([0x00, 0x00]))
    },
    {
      label: "first chunk payload beyond the actual buffer",
      bytes: withWebpFirstChunkSize(WEBP_BYTES, 1024)
    },
    {
      label: "odd first chunk payload without padding",
      bytes: createWebpBytes(
        "VP8 ",
        Buffer.from([0x9d, 0x01, 0x2a]),
        false
      )
    },
    {
      label: "only the 12-byte RIFF and WEBP header",
      bytes: Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50
      ])
    },
    {
      label: "random RIFF and WEBP forgery",
      bytes: (() => {
        const bytes = Buffer.alloc(28, 0x41);
        bytes.write("RIFF", 0, 4, "ascii");
        bytes.writeUInt32LE(bytes.byteLength - 8, 4);
        bytes.write("WEBP", 8, 4, "ascii");
        return bytes;
      })()
    }
  ])(
    "rejects malformed WebP containers: $label",
    async ({ bytes }) => {
      const store = new FakeStorageObjectStore();
      await expectLocalError(
        persist(createService(rootDir, store), {
          dataUrl: dataUrl("image/webp", bytes)
        }),
        "IMAGE_SIGNATURE_MISMATCH"
      );

      expect(store.calls).toEqual([]);
      expect(await listRelativeFiles(rootDir)).toEqual([]);
    }
  );

  it("returns the fixed safe error when WebP is declared but the container is invalid", async () => {
    const store = new FakeStorageObjectStore();
    const error = await expectLocalError(
      persist(createService(rootDir, store), {
        dataUrl: dataUrl(
          "image/webp",
          withWebpFirstChunkSize(WEBP_BYTES, 0xffffffff)
        )
      }),
      "IMAGE_SIGNATURE_MISMATCH"
    );

    expect(error.message).toBe("IMAGE_SIGNATURE_MISMATCH");
    expect(store.calls).toEqual([]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("writes only inside the configured absolute root", async () => {
    const store = new FakeStorageObjectStore();
    const result = await persist(createService(rootDir, store));
    const finalPath = path.resolve(rootDir, result.objectKey);
    const relative = path.relative(rootDir, finalPath);

    expect(path.isAbsolute(rootDir)).toBe(true);
    expect(path.isAbsolute(finalPath)).toBe(true);
    expect(relative.startsWith("..")).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
  });

  it("does not include user input or unsafe path characters in objectKey", async () => {
    const store = new FakeStorageObjectStore();
    const userId = "../private/C:\\secret\u2044user\u2215id\uff0fvalue";
    const result = await persist(createService(rootDir, store), {
      userId
    });

    expect(result.objectKey).not.toContain(userId);
    expect(result.objectKey).not.toContain("\\");
    expect(result.objectKey).not.toContain("..");
    expect(result.objectKey).not.toMatch(/[\u2044\u2215\uff0f]/u);
    expect(result.objectKey.split("/")).not.toContain(".");
    expect(result.objectKey.split("/")).not.toContain("..");
  });

  it("removes the temporary file after a successful atomic rename", async () => {
    const store = new FakeStorageObjectStore();
    const result = await persist(createService(rootDir, store));

    expect(await listRelativeFiles(rootDir)).toEqual([result.objectKey]);
    expect((await listRelativeFiles(rootDir)).some(
      (filePath) => filePath.endsWith(".tmp")
    )).toBe(false);
  });

  it("orders createPending before file write and markReady", async () => {
    const events: string[] = [];
    const store = new FakeStorageObjectStore();
    const originalCreate = store.createPendingStorageObject.bind(store);
    const originalReady = store.markStorageObjectReady.bind(store);
    store.createPendingStorageObject = async (input) => {
      events.push("createPending");
      return originalCreate(input);
    };
    store.markStorageObjectReady = async (input) => {
      events.push("markReady");
      return originalReady(input);
    };

    await persist(createService(rootDir, store, {
      fileOperations: realFileOperations(events)
    }));

    expect(events).toEqual([
      "createPending",
      "fileWrite",
      "rename",
      "markReady"
    ]);
  });

  it("computes sha256 from the exact persisted file bytes", async () => {
    const store = new FakeStorageObjectStore();
    const result = await persist(createService(rootDir, store));
    const persistedBytes = await readFile(
      path.resolve(rootDir, result.objectKey)
    );

    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.sha256).toBe(
      createHash("sha256").update(persistedBytes).digest("hex")
    );
  });

  it("keeps publicUrl compatible with /generated-assets/*", async () => {
    const store = new FakeStorageObjectStore();
    const result = await persist(createService(rootDir, store));

    expect(result.publicUrl).toBe(
      `/generated-assets/${result.objectKey}`
    );
    expect(result.publicUrl).toMatch(
      /^\/generated-assets\/images\/2026\/07\/[0-9a-f-]+\.png$/u
    );
  });

  it.each([
    {
      label: "SVG",
      value: dataUrl("image/svg+xml", Buffer.from("<svg>"))
    },
    {
      label: "GIF",
      value: dataUrl("image/gif", Buffer.from("GIF89a"))
    },
    {
      label: "HTML",
      value: dataUrl("text/html", Buffer.from("<html>"))
    },
    {
      label: "octet-stream",
      value: dataUrl("application/octet-stream", PNG_BYTES)
    },
    {
      label: "PDF",
      value: dataUrl("application/pdf", Buffer.from("%PDF"))
    },
    {
      label: "ZIP",
      value: dataUrl("application/zip", Buffer.from("PK"))
    },
    {
      label: "video",
      value: dataUrl("video/mp4", Buffer.from("video"))
    },
    {
      label: "audio",
      value: dataUrl("audio/mpeg", Buffer.from("audio"))
    },
    {
      label: "non-base64",
      value: "data:image/png,iVBORw0KGgo="
    },
    {
      label: "empty payload",
      value: "data:image/png;base64,"
    },
    {
      label: "illegal base64 characters",
      value: "data:image/png;base64,iVBORw0KGg!="
    },
    {
      label: "MIME parameters",
      value: "data:image/png;charset=utf-8;base64,iVBORw0KGgo="
    },
    {
      label: "uppercase MIME",
      value: "data:IMAGE/PNG;base64,iVBORw0KGgo="
    },
    {
      label: "leading whitespace",
      value: " data:image/png;base64,iVBORw0KGgo="
    },
    {
      label: "trailing whitespace",
      value: "data:image/png;base64,iVBORw0KGgo= "
    }
  ])("rejects strict data URL violation: $label", async ({ value }) => {
    const store = new FakeStorageObjectStore();
    await expectLocalError(
      persist(createService(rootDir, store), { dataUrl: value }),
      "INVALID_IMAGE_DATA_URL"
    );

    expect(store.calls).toEqual([]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("rejects payloads over maxBytes before Store or filesystem writes", async () => {
    const store = new FakeStorageObjectStore();
    let filesystemCalls = 0;
    const service = createService(rootDir, store, {
      fileOperations: {
        async createDirectory() {
          filesystemCalls += 1;
        }
      }
    });

    await expectLocalError(
      persist(service, { maxBytes: PNG_BYTES.byteLength - 1 }),
      "IMAGE_TOO_LARGE"
    );
    expect(store.calls).toEqual([]);
    expect(filesystemCalls).toBe(0);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity])(
    "rejects invalid maxBytes %s before Store or filesystem writes",
    async (maxBytes) => {
      const store = new FakeStorageObjectStore();
      await expectLocalError(
        persist(createService(rootDir, store), { maxBytes }),
        "INVALID_STORAGE_OBJECT_INPUT"
      );

      expect(store.calls).toEqual([]);
      expect(await listRelativeFiles(rootDir)).toEqual([]);
    }
  );

  it.each([
    ["empty", ""],
    ["wrong length", "abc"],
    ["illegal character", "iVBORw0KGg!="],
    ["URL-safe alphabet", "iVBORw0KGgo_"],
    ["whitespace", "iVBORw0KGgo=\n"]
  ])("rejects naked Base64 violation: %s", async (_label, base64) => {
    const store = new FakeStorageObjectStore();
    await expectLocalError(
      createService(rootDir, store).persistLocalImageStorageObject({
        userId: "user-1",
        source: StorageObjectSource.GENERATED,
        base64,
        maxBytes: 1024
      }),
      "INVALID_IMAGE_DATA_URL"
    );

    expect(store.calls).toEqual([]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("rejects a valid naked Base64 payload whose bytes are not a supported image", async () => {
    const store = new FakeStorageObjectStore();
    await expectLocalError(
      createService(rootDir, store).persistLocalImageStorageObject({
        userId: "user-1",
        source: StorageObjectSource.GENERATED,
        base64: Buffer.from("not-an-image").toString("base64"),
        maxBytes: 1024
      }),
      "IMAGE_SIGNATURE_MISMATCH"
    );

    expect(store.calls).toEqual([]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it.each([
    {
      label: "PNG declared as JPEG",
      declaredMimeType: "image/jpeg",
      bytes: PNG_BYTES
    },
    {
      label: "JPEG declared as PNG",
      declaredMimeType: "image/png",
      bytes: JPEG_BYTES
    },
    {
      label: "WebP declared as PNG",
      declaredMimeType: "image/png",
      bytes: WEBP_BYTES
    },
    {
      label: "random bytes declared as WebP",
      declaredMimeType: "image/webp",
      bytes: Buffer.from("not-an-image")
    }
  ])(
    "rejects signature mismatch: $label",
    async ({ declaredMimeType, bytes }) => {
      const store = new FakeStorageObjectStore();
      await expectLocalError(
        persist(createService(rootDir, store), {
          dataUrl: dataUrl(declaredMimeType, bytes)
        }),
        "IMAGE_SIGNATURE_MISMATCH"
      );

      expect(store.calls).toEqual([]);
      expect(await listRelativeFiles(rootDir)).toEqual([]);
    }
  );

  it.each([
    {
      label: "PNG",
      mimeType: "image/png",
      bytes: PNG_BYTES.subarray(0, 7)
    },
    {
      label: "JPEG containing only SOI",
      mimeType: "image/jpeg",
      bytes: JPEG_BYTES.subarray(0, 2)
    },
    {
      label: "WebP shorter than RIFF/WEBP headers",
      mimeType: "image/webp",
      bytes: WEBP_BYTES.subarray(0, 11)
    }
  ])("rejects truncated $label signatures", async ({ mimeType, bytes }) => {
    const store = new FakeStorageObjectStore();
    await expectLocalError(
      persist(createService(rootDir, store), {
        dataUrl: dataUrl(mimeType, bytes)
      }),
      "IMAGE_SIGNATURE_MISMATCH"
    );

    expect(store.calls).toEqual([]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("does not create directories or call markFailed when createPending fails", async () => {
    const store = new FakeStorageObjectStore();
    store.createError = new Error(`database failed at ${rootDir}`);

    const error = await expectLocalError(
      persist(createService(rootDir, store)),
      "STORAGE_OBJECT_CREATE_FAILED"
    );

    expect(store.calls).toEqual(["createPending"]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
    expect(error.message).not.toContain(rootDir);
    expect(error.message).not.toContain("database");
  });

  it("marks FAILED and leaves no files when directory creation fails", async () => {
    const store = new FakeStorageObjectStore();
    const service = createService(rootDir, store, {
      fileOperations: {
        async createDirectory() {
          throw new Error(`mkdir failed at ${rootDir}`);
        }
      }
    });

    const error = await expectLocalError(
      persist(service),
      "LOCAL_STORAGE_WRITE_FAILED"
    );
    expect(store.calls).toEqual(["createPending", "markFailed"]);
    expect(store.records.get("storage-object-1")?.status).toBe(
      StorageObjectStatus.FAILED
    );
    expect(await listRelativeFiles(rootDir)).toEqual([]);
    expect(error.message).not.toContain(rootDir);
  });

  it("marks FAILED when exclusive temporary file creation fails", async () => {
    const store = new FakeStorageObjectStore();
    const service = createService(rootDir, store, {
      fileOperations: {
        async openExclusive() {
          throw new Error(`open failed at ${rootDir}`);
        }
      }
    });

    await expectLocalError(
      persist(service),
      "LOCAL_STORAGE_WRITE_FAILED"
    );
    expect(store.calls).toEqual(["createPending", "markFailed"]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("cleans a partially written temporary file and marks FAILED", async () => {
    const store = new FakeStorageObjectStore();
    const service = createService(rootDir, store, {
      fileOperations: {
        async write(handle, bytes) {
          await handle.writeFile(bytes.subarray(0, 1));
          throw new Error(`write failed at ${rootDir}`);
        }
      }
    });

    const error = await expectLocalError(
      persist(service),
      "LOCAL_STORAGE_WRITE_FAILED"
    );
    expect(store.calls).toEqual(["createPending", "markFailed"]);
    expect(store.records.get("storage-object-1")?.status).toBe(
      StorageObjectStatus.FAILED
    );
    expect(await listRelativeFiles(rootDir)).toEqual([]);
    expect(error.message).not.toContain(rootDir);
    expect(error.message).not.toContain("write failed");
  });

  it("cleans the temporary file when flush fails", async () => {
    const store = new FakeStorageObjectStore();
    const service = createService(rootDir, store, {
      fileOperations: {
        async sync() {
          throw new Error(`sync failed at ${rootDir}`);
        }
      }
    });

    await expectLocalError(
      persist(service),
      "LOCAL_STORAGE_WRITE_FAILED"
    );
    expect(store.calls).toEqual(["createPending", "markFailed"]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("cleans the temporary file when close reports failure", async () => {
    const store = new FakeStorageObjectStore();
    let closeCalls = 0;
    const service = createService(rootDir, store, {
      fileOperations: {
        async close(handle) {
          closeCalls += 1;
          await handle.close();
          if (closeCalls === 1) {
            throw new Error(`close failed at ${rootDir}`);
          }
        }
      }
    });

    await expectLocalError(
      persist(service),
      "LOCAL_STORAGE_WRITE_FAILED"
    );
    expect(store.calls).toEqual(["createPending", "markFailed"]);
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("cleans temporary and reserved final files when rename fails", async () => {
    const store = new FakeStorageObjectStore();
    const service = createService(rootDir, store, {
      fileOperations: {
        async rename() {
          throw new Error(`rename failed at ${rootDir}`);
        }
      }
    });

    const error = await expectLocalError(
      persist(service),
      "LOCAL_STORAGE_WRITE_FAILED"
    );
    expect(store.calls).toEqual(["createPending", "markFailed"]);
    expect(store.records.get("storage-object-1")?.status).toBe(
      StorageObjectStatus.FAILED
    );
    expect(await listRelativeFiles(rootDir)).toEqual([]);
    expect(error.message).not.toContain(rootDir);
    expect(error.message).not.toContain("rename failed");
  });

  it("retains the final file and marks FAILED when markReady throws", async () => {
    const store = new FakeStorageObjectStore();
    store.readyError = new Error(`Prisma failure at ${rootDir}`);
    const service = createService(rootDir, store);

    const error = await expectLocalError(
      persist(service),
      "STORAGE_OBJECT_FINALIZE_FAILED"
    );

    expect(store.calls).toEqual([
      "createPending",
      "markReady",
      "markFailed"
    ]);
    expect(store.records.get("storage-object-1")?.status).toBe(
      StorageObjectStatus.FAILED
    );
    await expect(
      readFile(path.resolve(rootDir, OBJECT_KEY))
    ).resolves.toEqual(PNG_BYTES);
    expect(await listRelativeFiles(rootDir)).toEqual([OBJECT_KEY]);
    expect(error.message).not.toContain(rootDir);
    expect(error.message).not.toContain("Prisma");
  });

  it("treats non-UPDATED markReady results as safe finalize failures", async () => {
    const store = new FakeStorageObjectStore();
    store.readyResult = { status: "INVALID_STATE" };

    await expectLocalError(
      persist(createService(rootDir, store)),
      "STORAGE_OBJECT_FINALIZE_FAILED"
    );

    expect(store.calls).toEqual([
      "createPending",
      "markReady",
      "markFailed"
    ]);
    expect(store.records.get("storage-object-1")?.status).toBe(
      StorageObjectStatus.FAILED
    );
    await expect(
      readFile(path.resolve(rootDir, OBJECT_KEY))
    ).resolves.toEqual(PNG_BYTES);
  });

  it("does not overwrite READY when markReady committed before throwing", async () => {
    const store = new FakeStorageObjectStore();
    store.readyErrorAfterUpdate = new Error("connection lost after commit");

    await expectLocalError(
      persist(createService(rootDir, store)),
      "STORAGE_OBJECT_FINALIZE_FAILED"
    );

    expect(store.calls).toEqual([
      "createPending",
      "markReady",
      "markFailed"
    ]);
    expect(store.records.get("storage-object-1")?.status).toBe(
      StorageObjectStatus.READY
    );
    await expect(
      readFile(path.resolve(rootDir, OBJECT_KEY))
    ).resolves.toEqual(PNG_BYTES);
  });

  it("does not let markFailed failure replace the primary safe error", async () => {
    const store = new FakeStorageObjectStore();
    store.failedError = new Error(
      `DATABASE_URL=mysql://secret@host/db ${rootDir}`
    );
    const service = createService(rootDir, store, {
      fileOperations: {
        async write() {
          throw new Error(`errno path ${rootDir}`);
        }
      }
    });

    const error = await expectLocalError(
      persist(service),
      "LOCAL_STORAGE_WRITE_FAILED"
    );
    expect(store.calls).toEqual(["createPending", "markFailed"]);
    expect(error.message).not.toContain(rootDir);
    expect(error.message).not.toContain("DATABASE_URL");
    expect(error.message).not.toContain("mysql");
    expect(error.message).not.toContain("errno");
    expect(await listRelativeFiles(rootDir)).toEqual([]);
  });

  it("does not overwrite an existing final filename collision", async () => {
    const existingPath = path.resolve(rootDir, OBJECT_KEY);
    const existingBytes = Buffer.from("existing-file");
    await mkdir(path.dirname(existingPath), { recursive: true });
    await writeFile(existingPath, existingBytes, { flag: "wx" });

    const store = new FakeStorageObjectStore();
    await expectLocalError(
      persist(createService(rootDir, store)),
      "LOCAL_STORAGE_WRITE_FAILED"
    );

    expect(store.calls).toEqual(["createPending", "markFailed"]);
    await expect(readFile(existingPath)).resolves.toEqual(existingBytes);
    expect(await listRelativeFiles(rootDir)).toEqual([OBJECT_KEY]);
    expect(store.records.get("storage-object-1")?.status).toBe(
      StorageObjectStatus.FAILED
    );
  });

  it("keeps the legacy saveDataUrlImage contract unchanged", async () => {
    const storage = new LocalAssetStorage({
      baseDir: rootDir,
      publicPath: "/generated-assets",
      now: () => new Date(NOW)
    });
    const stored = await storage.saveDataUrlImage({
      dataUrl: "data:image/png;base64,cG5n",
      filenamePrefix: "../user-original-name"
    });

    expect(stored.storageProvider).toBe("local");
    expect(stored.url).toMatch(
      /^\/generated-assets\/2026\/07\/[0-9a-f-]+\.png$/u
    );
    expect(stored.storageKey).toMatch(
      /^2026\/07\/[0-9a-f-]+\.png$/u
    );
    expect(stored.storageKey).not.toContain("user-original-name");
    expect(path.relative(rootDir, stored.filePath).startsWith("..")).toBe(
      false
    );
    await expect(readFile(stored.filePath, "utf8")).resolves.toBe("png");
  });

  it("uses server-generated UUIDs instead of caller-controlled filenames", async () => {
    const store = new FakeStorageObjectStore();
    const userContent = `${randomUUID()}../prompt-secret.png`;
    const result = await persist(createService(rootDir, store), {
      userId: userContent
    });

    expect(result.objectKey).toBe(OBJECT_KEY);
    expect(result.objectKey).not.toContain(userContent);
    expect(result.objectKey).not.toContain("prompt-secret");
  });
});

describe("LocalStorageObjectContentService", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(
      path.join(tmpdir(), "local-storage-object-content-")
    );
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function writeObject(
    objectKey: string,
    bytes: Buffer = PNG_BYTES
  ): Promise<void> {
    const filePath = path.resolve(rootDir, objectKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  }

  async function readOpenedContent(
    opened: Awaited<
      ReturnType<
        LocalStorageObjectContentService["openLocalStorageObjectContent"]
      >
    >
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of opened.stream) {
      chunks.push(
        typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk)
      );
    }

    return Buffer.concat(chunks);
  }

  it("opens an ordinary contained file and returns its exact bytes", async () => {
    await writeObject(OBJECT_KEY);
    const service = new LocalStorageObjectContentService({
      baseDir: rootDir
    });
    const opened = await service.openLocalStorageObjectContent({
      objectKey: OBJECT_KEY,
      expectedSizeBytes: PNG_BYTES.byteLength
    });

    expect(opened.sizeBytes).toBe(PNG_BYTES.byteLength);
    await expect(readOpenedContent(opened)).resolves.toEqual(PNG_BYTES);
  });

  it.each([
    ["path traversal", "../outside.png"],
    ["absolute path", "/etc/passwd"],
    ["backslash", "images\\2026\\07\\secret.png"],
    ["unicode slash", "images\uff0f2026/07/secret.png"]
  ])("rejects unsafe objectKey input: %s", async (_label, objectKey) => {
    const service = new LocalStorageObjectContentService({
      baseDir: rootDir
    });

    await expect(
      service.openLocalStorageObjectContent({
        objectKey,
        expectedSizeBytes: PNG_BYTES.byteLength
      })
    ).rejects.toEqual(
      new LocalStorageObjectContentUnavailableError()
    );
  });

  it("rejects a directory", async () => {
    await mkdir(path.resolve(rootDir, OBJECT_KEY), { recursive: true });
    const service = new LocalStorageObjectContentService({
      baseDir: rootDir
    });

    await expect(
      service.openLocalStorageObjectContent({
        objectKey: OBJECT_KEY,
        expectedSizeBytes: PNG_BYTES.byteLength
      })
    ).rejects.toEqual(
      new LocalStorageObjectContentUnavailableError()
    );
  });

  it("rejects a symbolic-link file", async () => {
    const targetKey = "images/2026/07/target.png";
    await writeObject(targetKey);
    await symlink(
      path.resolve(rootDir, targetKey),
      path.resolve(rootDir, OBJECT_KEY)
    );
    const service = new LocalStorageObjectContentService({
      baseDir: rootDir
    });

    await expect(
      service.openLocalStorageObjectContent({
        objectKey: OBJECT_KEY,
        expectedSizeBytes: PNG_BYTES.byteLength
      })
    ).rejects.toEqual(
      new LocalStorageObjectContentUnavailableError()
    );
  });

  it("rejects a symbolic-link directory in the objectKey path", async () => {
    const realDirectory = path.resolve(rootDir, "real-images");
    await mkdir(realDirectory, { recursive: true });
    await writeFile(path.join(realDirectory, "file.png"), PNG_BYTES);
    await symlink(realDirectory, path.resolve(rootDir, "images"));
    const service = new LocalStorageObjectContentService({
      baseDir: rootDir
    });

    await expect(
      service.openLocalStorageObjectContent({
        objectKey: "images/file.png",
        expectedSizeBytes: PNG_BYTES.byteLength
      })
    ).rejects.toEqual(
      new LocalStorageObjectContentUnavailableError()
    );
  });

  it("rejects a missing file with a fixed safe error", async () => {
    const service = new LocalStorageObjectContentService({
      baseDir: rootDir
    });
    const error = await captureError(
      service.openLocalStorageObjectContent({
        objectKey: OBJECT_KEY,
        expectedSizeBytes: PNG_BYTES.byteLength
      })
    );

    expect(error).toBeInstanceOf(LocalStorageObjectContentUnavailableError);
    expect(error.message).toBe("LOCAL_STORAGE_OBJECT_CONTENT_UNAVAILABLE");
    expect(error.message).not.toContain(rootDir);
    expect(error.message).not.toContain("ENOENT");
    expect(error.message).not.toContain(OBJECT_KEY);
  });

  it("rejects a file whose actual size does not match StorageObject metadata", async () => {
    await writeObject(OBJECT_KEY);
    const service = new LocalStorageObjectContentService({
      baseDir: rootDir
    });

    await expect(
      service.openLocalStorageObjectContent({
        objectKey: OBJECT_KEY,
        expectedSizeBytes: PNG_BYTES.byteLength + 1
      })
    ).rejects.toEqual(
      new LocalStorageObjectContentUnavailableError()
    );
  });
});

describe("LocalStorageObjectFileRemovalService", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(
      path.join(tmpdir(), "s3-b1-asset-storage-delete-")
    );
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function writeObject(
    objectKey: string,
    bytes: Buffer = PNG_BYTES
  ): Promise<string> {
    const filePath = path.resolve(rootDir, objectKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
    return filePath;
  }

  function createRemovalService(
    fileOperations: Partial<LocalStorageObjectFileRemovalOperations> = {}
  ): LocalStorageObjectFileRemovalService {
    return new LocalStorageObjectFileRemovalService({
      baseDir: rootDir,
      fileOperations
    });
  }

  function nodeError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
  }

  async function expectRemovalError(
    action: Promise<unknown>,
    code: LocalStorageObjectFileRemovalError["code"]
  ): Promise<LocalStorageObjectFileRemovalError> {
    const error = await captureError(action);
    expect(error).toBeInstanceOf(LocalStorageObjectFileRemovalError);
    if (!(error instanceof LocalStorageObjectFileRemovalError)) {
      throw new Error("EXPECTED_LOCAL_STORAGE_OBJECT_FILE_REMOVAL_ERROR");
    }
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
    return error;
  }

  it("removes an ordinary contained file without removing its storage root", async () => {
    const filePath = await writeObject(OBJECT_KEY);
    const service = createRemovalService();

    await expect(service.removeLocalStorageObjectFile(OBJECT_KEY)).resolves.toEqual({
      status: "REMOVED"
    });
    await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(rootDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
    expect((await lstat(rootDir)).isDirectory()).toBe(true);
  });

  it("returns NOT_FOUND when the final file is absent", async () => {
    await mkdir(path.dirname(path.resolve(rootDir, OBJECT_KEY)), {
      recursive: true
    });

    await expect(
      createRemovalService().removeLocalStorageObjectFile(OBJECT_KEY)
    ).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("returns NOT_FOUND when an intermediate directory is absent", async () => {
    await expect(
      createRemovalService().removeLocalStorageObjectFile(OBJECT_KEY)
    ).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("returns NOT_FOUND when unlink observes ENOENT", async () => {
    await writeObject(OBJECT_KEY);
    const service = createRemovalService({
      async remove() {
        throw nodeError("ENOENT", "raw unlink missing message");
      }
    });

    await expect(service.removeLocalStorageObjectFile(OBJECT_KEY)).resolves.toEqual({
      status: "NOT_FOUND"
    });
  });

  it.each([
    ["traversal", "../outside.png"],
    ["absolute path", "/etc/passwd"],
    ["scheme", "https://example.test/file.png"],
    ["Windows path", "C:\\temp\\file.png"]
  ])("rejects a cleanup objectKey containing %s", async (_label, objectKey) => {
    const error = await expectRemovalError(
      createRemovalService().removeLocalStorageObjectFile(objectKey),
      "STORAGE_CLEANUP_INVALID_OBJECT_KEY"
    );

    expect(error.message).not.toContain(objectKey);
    expect(error.message).not.toContain(rootDir);
  });

  it("rejects a non-absolute storage root during construction", () => {
    expect(
      () =>
        new LocalStorageObjectFileRemovalService({
          baseDir: "relative-storage-root"
        })
    ).toThrow("STORAGE_CLEANUP_ROOT_UNAVAILABLE");
  });

  it("maps an unavailable storage root to a fixed safe error", async () => {
    const service = createRemovalService({
      async realpath() {
        throw nodeError("EACCES", "raw root failure message");
      }
    });
    const error = await expectRemovalError(
      service.removeLocalStorageObjectFile(OBJECT_KEY),
      "STORAGE_CLEANUP_ROOT_UNAVAILABLE"
    );

    expect(error.message).not.toContain(rootDir);
    expect(error.message).not.toContain("raw root failure message");
  });

  it("rejects an intermediate symbolic link without recursively removing it", async () => {
    const realDirectory = path.resolve(rootDir, "real-images");
    await mkdir(realDirectory, { recursive: true });
    await writeFile(path.join(realDirectory, "file.png"), PNG_BYTES);
    await symlink(realDirectory, path.resolve(rootDir, "images"));

    await expectRemovalError(
      createRemovalService().removeLocalStorageObjectFile("images/file.png"),
      "STORAGE_CLEANUP_SYMLINK_REJECTED"
    );
    await expect(readFile(path.join(realDirectory, "file.png"))).resolves.toEqual(
      PNG_BYTES
    );
  });

  it("rejects a final symbolic link", async () => {
    const targetPath = await writeObject("targets/actual.png");
    const finalPath = path.resolve(rootDir, OBJECT_KEY);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await symlink(targetPath, finalPath);

    await expectRemovalError(
      createRemovalService().removeLocalStorageObjectFile(OBJECT_KEY),
      "STORAGE_CLEANUP_SYMLINK_REJECTED"
    );
    await expect(readFile(targetPath)).resolves.toEqual(PNG_BYTES);
  });

  it("rejects a directory and leaves it intact", async () => {
    const directoryPath = path.resolve(rootDir, OBJECT_KEY);
    await mkdir(directoryPath, { recursive: true });
    await writeFile(path.join(directoryPath, "nested.png"), PNG_BYTES);

    await expectRemovalError(
      createRemovalService().removeLocalStorageObjectFile(OBJECT_KEY),
      "STORAGE_CLEANUP_NOT_REGULAR_FILE"
    );
    await expect(readFile(path.join(directoryPath, "nested.png"))).resolves.toEqual(
      PNG_BYTES
    );
  });

  it("rejects an intermediate node that is not a directory", async () => {
    await writeFile(path.resolve(rootDir, "images"), PNG_BYTES);

    await expectRemovalError(
      createRemovalService().removeLocalStorageObjectFile("images/file.png"),
      "STORAGE_CLEANUP_NOT_DIRECTORY"
    );
  });

  it("rejects a non-regular final node from injected lstat metadata", async () => {
    const filePath = await writeObject(OBJECT_KEY);
    const ordinaryFileStat = await lstat(filePath);
    const nonRegularFileStat = new Proxy(ordinaryFileStat, {
      get(target, property, receiver) {
        if (property === "isFile") {
          return () => false;
        }
        return Reflect.get(target, property, receiver);
      }
    });
    const service = createRemovalService({
      async lstat(candidatePath) {
        return candidatePath === filePath
          ? nonRegularFileStat
          : lstat(candidatePath);
      }
    });

    await expectRemovalError(
      service.removeLocalStorageObjectFile(OBJECT_KEY),
      "STORAGE_CLEANUP_NOT_REGULAR_FILE"
    );
  });

  it("rejects a final realpath outside the canonical root", async () => {
    await writeObject(OBJECT_KEY);
    let realpathCalls = 0;
    const service = createRemovalService({
      async realpath(candidatePath) {
        realpathCalls += 1;
        if (realpathCalls === 1) {
          return realpath(candidatePath);
        }
        return path.join(tmpdir(), "s3-b1-outside-root.png");
      }
    });

    await expectRemovalError(
      service.removeLocalStorageObjectFile(OBJECT_KEY),
      "STORAGE_CLEANUP_PATH_OUTSIDE_ROOT"
    );
  });

  it.each(["EACCES", "EBUSY"])(
    "maps unlink %s to a fixed safe deletion error",
    async (code) => {
      await writeObject(OBJECT_KEY);
      const rawMessage = `raw ${code} unlink message`;
      const service = createRemovalService({
        async remove() {
          throw nodeError(code, rawMessage);
        }
      });
      const error = await expectRemovalError(
        service.removeLocalStorageObjectFile(OBJECT_KEY),
        "STORAGE_CLEANUP_DELETE_FAILED"
      );

      expect(error.message).not.toContain(OBJECT_KEY);
      expect(error.message).not.toContain(rootDir);
      expect(error.message).not.toContain(rawMessage);
    }
  );
});
