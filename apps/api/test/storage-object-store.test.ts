import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  Prisma,
  PrismaClient,
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider
} from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  createPrismaUserStore,
  type CompleteImageTaskWithStorageObjectReservationInput,
  type CreatePendingStorageObjectInput,
  type ImageTaskCompletionAiAssetCreateInput,
  type MarkStorageObjectReadyInput
} from "../src/store";
import { createJwt } from "../src/auth";
import { buildServer } from "../src/server";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const USER_PREFIX = "s2a_storage_";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const IMAGE_RESERVATION_EXPIRES_AT = new Date(
  "2300-01-01T00:00:00.000Z"
);

interface PersistedStorageObjectOverrides {
  storageProvider?: StorageProvider;
  mimeType?: string | null;
  sizeBytes?: bigint | null;
  sha256?: string | null;
  source?: StorageObjectSource;
  status?: StorageObjectStatus;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ImageCompletionFixture {
  userId: string;
  taskId: string;
  reservationId: string;
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

describe.sequential("StorageObject Store operations", () => {
  let prisma: PrismaClient | undefined;
  let secondPrisma: PrismaClient | undefined;
  let store: ReturnType<typeof createPrismaUserStore> | undefined;
  let secondStore: ReturnType<typeof createPrismaUserStore> | undefined;
  const createdUserIds = new Set<string>();

  function database(): PrismaClient {
    if (!prisma) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }
    return prisma;
  }

  function storageStore(): ReturnType<typeof createPrismaUserStore> {
    if (!store) {
      throw new Error("TEST_STORE_NOT_INITIALIZED");
    }
    return store;
  }

  function concurrentStorageStore(): ReturnType<typeof createPrismaUserStore> {
    if (!secondStore) {
      throw new Error("TEST_SECOND_STORE_NOT_INITIALIZED");
    }
    return secondStore;
  }

  async function cleanup(): Promise<void> {
    const userIds = [...createdUserIds];
    if (userIds.length === 0) {
      return;
    }

    await retryPrismaWriteConflict(async () => {
      await prisma?.accountCreditEvent.deleteMany({
        where: { userId: { in: userIds } }
      });
      await prisma?.user.deleteMany({
        where: { id: { in: userIds } }
      });
    });
    createdUserIds.clear();
  }

  async function createUser(avatarUrl?: string): Promise<string> {
    const userId = `${USER_PREFIX}${randomUUID()}`;
    createdUserIds.add(userId);
    await database().user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "test-hash",
        ...(avatarUrl === undefined ? {} : { avatarUrl })
      }
    });
    return userId;
  }

  async function createStoreUser(lastLoginAt?: Date) {
    const user = await storageStore().createUser({
      email: `s4a2-${randomUUID()}@example.test`,
      passwordHash: "test-hash",
      ...(lastLoginAt === undefined ? {} : { lastLoginAt })
    });
    createdUserIds.add(user.id);
    return user;
  }

  function pendingInput(
    userId: string,
    overrides: Partial<CreatePendingStorageObjectInput> = {}
  ): CreatePendingStorageObjectInput {
    return {
      userId,
      storageProvider: StorageProvider.LOCAL,
      objectKey: `users/${userId}/${randomUUID()}.png`,
      source: StorageObjectSource.UPLOAD,
      ...overrides
    };
  }

  async function createPending(
    userId: string,
    overrides: Partial<CreatePendingStorageObjectInput> = {}
  ) {
    return storageStore().createPendingStorageObject(
      pendingInput(userId, overrides)
    );
  }

  function readyInput(
    userId: string,
    id: string,
    overrides: Partial<MarkStorageObjectReadyInput> = {}
  ): MarkStorageObjectReadyInput {
    return {
      userId,
      id,
      mimeType: "image/png",
      sizeBytes: 128,
      sha256: SHA_A,
      ...overrides
    };
  }

  async function createPersistedReadyObject(
    userId: string,
    overrides: PersistedStorageObjectOverrides = {}
  ) {
    return database().storageObject.create({
      data: {
        userId,
        storageProvider: StorageProvider.LOCAL,
        objectKey: `users/${userId}/${randomUUID()}.png`,
        mimeType: "image/png",
        sizeBytes: 128n,
        sha256: SHA_A,
        source: StorageObjectSource.UPLOAD,
        status: StorageObjectStatus.READY,
        deletedAt: null,
        ...overrides
      }
    });
  }

  async function createReadyGeneratedObject(
    userId: string,
    overrides: PersistedStorageObjectOverrides = {}
  ) {
    return createPersistedReadyObject(userId, {
      source: StorageObjectSource.GENERATED,
      ...overrides
    });
  }

  async function createDeletedGeneratedObject(
    userId: string,
    overrides: PersistedStorageObjectOverrides = {}
  ) {
    return createPersistedReadyObject(userId, {
      source: StorageObjectSource.GENERATED,
      status: StorageObjectStatus.DELETED,
      deletedAt: new Date("2026-07-17T00:00:00.000Z"),
      ...overrides
    });
  }

  async function createAiAssetReference(
    userId: string,
    storageObjectId: string
  ): Promise<void> {
    await database().aiAsset.create({
      data: {
        userId,
        type: "IMAGE",
        url: `https://assets.example.test/${randomUUID()}.png`,
        storageObjectId
      }
    });
  }

  async function createAvatarReference(
    userId: string,
    storageObjectId: string
  ): Promise<void> {
    await database().user.update({
      where: { id: userId },
      data: { avatarStorageObjectId: storageObjectId }
    });
  }

  async function createImageCompletionFixture(
    requestedUserId?: string
  ): Promise<ImageCompletionFixture> {
    const userId = requestedUserId ?? (await createUser());
    const existingQuota = await database().userQuota.findUnique({
      where: { userId }
    });
    if (!existingQuota) {
      await database().userQuota.create({
        data: {
          userId,
          remainingCredits: 100
        }
      });
    }

    const created = await storageStore().createImageTaskWithReservation({
      userId,
      amountCredits: 4,
      expiresAt: IMAGE_RESERVATION_EXPIRES_AT,
      task: {
        type: "image",
        modelId: "s2-c1-a-model",
        prompt: "S2-C1-A generated image",
        input: { mode: "text-to-image" }
      }
    });
    if (!created.ok) {
      throw new Error(`TEST_IMAGE_FIXTURE_${created.reason}`);
    }

    const running = await storageStore().markAiTaskRunning(created.task.id);
    if (!running) {
      throw new Error("TEST_IMAGE_TASK_NOT_RUNNING");
    }
    return {
      userId,
      taskId: created.task.id,
      reservationId: created.reservation.id
    };
  }

  function localAssetInput(
    fixture: ImageCompletionFixture,
    storageObjectId: string,
    metadata: Record<string, unknown> = {}
  ): ImageTaskCompletionAiAssetCreateInput {
    return {
      userId: fixture.userId,
      taskId: fixture.taskId,
      type: "image",
      storageObjectId,
      title: "local generated asset",
      metadata
    };
  }

  function externalAssetInput(
    fixture: ImageCompletionFixture,
    suffix: string = randomUUID(),
    metadata: Record<string, unknown> = {}
  ): ImageTaskCompletionAiAssetCreateInput {
    return {
      userId: fixture.userId,
      taskId: fixture.taskId,
      type: "image",
      url: `https://assets.example.test/${suffix}.png`,
      title: "provider URL asset",
      metadata
    };
  }

  function completionInput(
    fixture: ImageCompletionFixture,
    assets: ImageTaskCompletionAiAssetCreateInput[]
  ): CompleteImageTaskWithStorageObjectReservationInput {
    return {
      taskId: fixture.taskId,
      reservationId: fixture.reservationId,
      assets,
      output: {
        source: "s2-c1-a-test",
        count: assets.length
      }
    };
  }

  async function readImageCompletionState(
    fixture: ImageCompletionFixture
  ) {
    const [reservation, task, quota, assetCount] = await Promise.all([
      database().creditReservation.findUniqueOrThrow({
        where: { id: fixture.reservationId },
        select: {
          status: true,
          settledAt: true,
          releasedAt: true
        }
      }),
      database().aiTask.findUniqueOrThrow({
        where: { id: fixture.taskId },
        select: {
          status: true,
          output: true,
          costCredits: true,
          completedAt: true
        }
      }),
      database().userQuota.findUniqueOrThrow({
        where: { userId: fixture.userId },
        select: { remainingCredits: true }
      }),
      database().aiAsset.count({
        where: { taskId: fixture.taskId }
      })
    ]);

    return { reservation, task, quota, assetCount };
  }

  type CompletionResult = Awaited<
    ReturnType<
      ReturnType<
        typeof createPrismaUserStore
      >["completeImageTaskWithReservation"]
    >
  >;

  async function captureCompletion(
    promise: Promise<CompletionResult>
  ): Promise<
    | { outcome: "fulfilled"; value: CompletionResult }
    | { outcome: "rejected"; errorCode: string }
  > {
    try {
      return {
        outcome: "fulfilled",
        value: await promise
      };
    } catch (error) {
      return {
        outcome: "rejected",
        errorCode: error instanceof Error ? error.message : "NON_ERROR_THROWN"
      };
    }
  }

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL_MISSING");
    }

    const parsedDatabaseUrl = new URL(databaseUrl);
    if (
      parsedDatabaseUrl.hostname !== "127.0.0.1" ||
      parsedDatabaseUrl.port !== "3308"
    ) {
      throw new Error("TEST_DATABASE_MUST_BE_LOCAL_DISPOSABLE_MYSQL_3308");
    }

    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
    secondPrisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
    await Promise.all([prisma.$connect(), secondPrisma.$connect()]);
    store = createPrismaUserStore(prisma);
    secondStore = createPrismaUserStore(secondPrisma);
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await Promise.all([prisma?.$disconnect(), secondPrisma?.$disconnect()]);
    }
  });

  it("creates users with default sessionVersion and no lastLoginAt", async () => {
    const user = await createStoreUser();

    expect(user).toMatchObject({
      sessionVersion: 0,
      lastLoginAt: null
    });
  });

  it("M7-B persists, reloads, and privately reads a current-user avatar through the disposable database", async () => {
    const assetDir = await mkdtemp(resolve(tmpdir(), "m7-db-avatar-"));
    const jwtSecret = "m7-disposable-avatar-secret";
    const server = buildServer({
      store: storageStore(),
      emailVerificationMailer: {
        sendEmailVerification: async () => undefined
      },
      publicWebUrl: "http://localhost:3000",
      env: {
        JWT_SECRET: jwtSecret,
        AI_BASE_URL: "http://127.0.0.1:9",
        AI_API_KEY: "test-key",
        DEFAULT_MODEL: "gpt-test",
        GENERATED_ASSETS_DIR: assetDir,
        GLOBAL_IMAGE_BUDGET_MODE: "disabled",
        GLOBAL_CHAT_BUDGET_MODE: "disabled",
        GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_MODE: "disabled"
      },
      logger: false
    });
    const user = await createStoreUser();
    const token = createJwt(user.id, user.sessionVersion, jwtSecret);
    const headers = { authorization: `Bearer ${token}` };
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const expectedBytes = Buffer.from("iVBORw0KGgo=", "base64");

    try {
      const firstUpload = await server.inject({
        method: "POST",
        url: "/account/avatar",
        headers,
        payload: { dataUrl }
      });
      expect(firstUpload.statusCode).toBe(200);
      const firstAvatarUrl = firstUpload.json().user.avatarUrl as string;
      expect(firstAvatarUrl).toMatch(
        /^\/generated-assets\/images\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/u
      );

      const persistedUser = await database().user.findUniqueOrThrow({
        where: { id: user.id },
        select: { avatarUrl: true, avatarStorageObjectId: true }
      });
      expect(persistedUser.avatarUrl).toBe(firstAvatarUrl);
      expect(persistedUser.avatarStorageObjectId).toEqual(expect.any(String));

      const [me, overview, content, directPublic] = await Promise.all([
        server.inject({ method: "GET", url: "/auth/me", headers }),
        server.inject({ method: "GET", url: "/account/overview", headers }),
        server.inject({ method: "GET", url: "/account/avatar/content", headers }),
        server.inject({ method: "GET", url: firstAvatarUrl })
      ]);
      expect(me.json().user.avatarUrl).toBe(firstAvatarUrl);
      expect(overview.json().profile.avatarUrl).toBe(firstAvatarUrl);
      expect(content.statusCode).toBe(200);
      expect(content.rawPayload).toEqual(expectedBytes);
      expect(content.headers["content-type"]).toBe("image/png");
      expect(directPublic.statusCode).toBe(404);

      const secondUpload = await server.inject({
        method: "POST",
        url: "/account/avatar",
        headers,
        payload: { dataUrl }
      });
      expect(secondUpload.statusCode).toBe(200);
      expect(secondUpload.json().user.avatarUrl).not.toBe(firstAvatarUrl);
    } finally {
      await server.close();
      await rm(assetDir, { recursive: true, force: true });
    }
  });

  it("persists createUser lastLoginAt when supplied", async () => {
    const lastLoginAt = new Date("2026-07-19T12:34:56.789Z");
    const user = await createStoreUser(lastLoginAt);

    expect(user.lastLoginAt).toBe(lastLoginAt.toISOString());
    await expect(
      database().user.findUniqueOrThrow({ where: { id: user.id } })
    ).resolves.toMatchObject({ lastLoginAt });
  });

  it("records a successful login without changing unrelated User fields", async () => {
    const user = await createStoreUser();
    const emailVerifiedAt = new Date("2026-07-18T01:02:03.456Z");
    const now = new Date("2026-07-19T09:08:07.654Z");
    await database().user.update({
      where: { id: user.id },
      data: { emailVerifiedAt, name: "Unchanged user" }
    });

    await expect(
      storageStore().recordSuccessfulLogin(user.id, now)
    ).resolves.toEqual({ sessionVersion: 0 });
    await expect(
      database().user.findUniqueOrThrow({ where: { id: user.id } })
    ).resolves.toMatchObject({
      sessionVersion: 0,
      lastLoginAt: now,
      emailVerifiedAt,
      name: "Unchanged user"
    });
  });

  it("returns a non-zero current sessionVersion when recording a login", async () => {
    const user = await createStoreUser();
    await database().user.update({
      where: { id: user.id },
      data: { sessionVersion: 9 }
    });

    await expect(
      storageStore().recordSuccessfulLogin(
        user.id,
        new Date("2026-07-19T10:11:12.123Z")
      )
    ).resolves.toEqual({ sessionVersion: 9 });
  });

  it("returns null when recording a login for a missing user", async () => {
    await expect(
      storageStore().recordSuccessfulLogin(
        `${USER_PREFIX}missing-user`,
        new Date("2026-07-19T10:11:12.123Z")
      )
    ).resolves.toBeNull();
  });

  it("rejects an invalid login timestamp before updating the database", async () => {
    const user = await createStoreUser();

    await expect(
      storageStore().recordSuccessfulLogin(user.id, new Date("invalid"))
    ).rejects.toThrow("now must be a valid Date");
    await expect(
      database().user.findUniqueOrThrow({ where: { id: user.id } })
    ).resolves.toMatchObject({ lastLoginAt: null });
  });

  it("creates a PENDING object and reads it for its owner", async () => {
    const userId = await createUser();
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    const created = await createPending(userId, { expiresAt });

    expect(created).toMatchObject({
      userId,
      storageProvider: StorageProvider.LOCAL,
      source: StorageObjectSource.UPLOAD,
      status: StorageObjectStatus.PENDING,
      mimeType: null,
      sizeBytes: null,
      sha256: null,
      expiresAt,
      deletedAt: null
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
    await expect(
      storageStore().findStorageObjectForUser(userId, created.id)
    ).resolves.toMatchObject({
      id: created.id,
      userId,
      status: StorageObjectStatus.PENDING
    });
  });

  it("does not return a PENDING object from the READY lookup", async () => {
    const userId = await createUser();
    const created = await createPending(userId);

    await expect(
      storageStore().findReadyStorageObjectForUser(userId, created.id)
    ).resolves.toBeNull();
  });

  it("transitions a PENDING object to READY", async () => {
    const userId = await createUser();
    const created = await createPending(userId);

    await expect(
      storageStore().markStorageObjectReady(readyInput(userId, created.id))
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      storageStore().findReadyStorageObjectForUser(userId, created.id)
    ).resolves.toMatchObject({
      id: created.id,
      status: StorageObjectStatus.READY
    });
  });

  it("persists validated READY metadata without exposing BigInt", async () => {
    const userId = await createUser();
    const created = await createPending(userId);

    await storageStore().markStorageObjectReady(
      readyInput(userId, created.id, {
        mimeType: "image/webp",
        sizeBytes: Number.MAX_SAFE_INTEGER,
        sha256: SHA_B
      })
    );

    const persisted = await database().storageObject.findUniqueOrThrow({
      where: { id: created.id }
    });
    expect(persisted).toMatchObject({
      mimeType: "image/webp",
      sizeBytes: BigInt(Number.MAX_SAFE_INTEGER),
      sha256: SHA_B,
      status: StorageObjectStatus.READY
    });
    await expect(
      storageStore().findReadyStorageObjectForUser(userId, created.id)
    ).resolves.toMatchObject({
      mimeType: "image/webp",
      sizeBytes: Number.MAX_SAFE_INTEGER,
      sha256: SHA_B
    });
  });

  it("transitions a PENDING object to FAILED", async () => {
    const userId = await createUser();
    const created = await createPending(userId);

    await expect(
      storageStore().markStorageObjectFailed({ userId, id: created.id })
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      storageStore().findStorageObjectForUser(userId, created.id)
    ).resolves.toMatchObject({
      status: StorageObjectStatus.FAILED,
      mimeType: null,
      sizeBytes: null,
      sha256: null
    });
  });

  it("transitions READY to DELETED and sets deletedAt", async () => {
    const userId = await createUser();
    const created = await createPending(userId);
    await storageStore().markStorageObjectReady(
      readyInput(userId, created.id)
    );

    await expect(
      storageStore().markStorageObjectDeleted({ userId, id: created.id })
    ).resolves.toEqual({ status: "UPDATED" });
    const deleted = await storageStore().findStorageObjectForUser(
      userId,
      created.id
    );
    expect(deleted).toMatchObject({
      status: StorageObjectStatus.DELETED
    });
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    await expect(
      storageStore().findReadyStorageObjectForUser(userId, created.id)
    ).resolves.toBeNull();
  });

  it("transitions FAILED to DELETED", async () => {
    const userId = await createUser();
    const created = await createPending(userId);
    await storageStore().markStorageObjectFailed({
      userId,
      id: created.id
    });

    await expect(
      storageStore().markStorageObjectDeleted({ userId, id: created.id })
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      storageStore().findStorageObjectForUser(userId, created.id)
    ).resolves.toMatchObject({
      status: StorageObjectStatus.DELETED
    });
  });

  it("rejects illegal reverse and cross-terminal transitions", async () => {
    const userId = await createUser();
    const pending = await createPending(userId);
    await expect(
      storageStore().markStorageObjectDeleted({ userId, id: pending.id })
    ).resolves.toEqual({ status: "INVALID_STATE" });

    const ready = await createPending(userId);
    await storageStore().markStorageObjectReady(readyInput(userId, ready.id));
    await expect(
      storageStore().markStorageObjectFailed({ userId, id: ready.id })
    ).resolves.toEqual({ status: "INVALID_STATE" });

    const failed = await createPending(userId);
    await storageStore().markStorageObjectFailed({ userId, id: failed.id });
    await expect(
      storageStore().markStorageObjectReady(readyInput(userId, failed.id))
    ).resolves.toEqual({ status: "INVALID_STATE" });

    await storageStore().markStorageObjectDeleted({ userId, id: ready.id });
    await expect(
      storageStore().markStorageObjectReady(readyInput(userId, ready.id))
    ).resolves.toEqual({ status: "INVALID_STATE" });
    await expect(
      storageStore().markStorageObjectFailed({ userId, id: ready.id })
    ).resolves.toEqual({ status: "INVALID_STATE" });
  });

  it("keeps repeated target-state markers idempotent without overwriting metadata", async () => {
    const userId = await createUser();
    const ready = await createPending(userId);
    await storageStore().markStorageObjectReady(readyInput(userId, ready.id));
    await expect(
      storageStore().markStorageObjectReady(
        readyInput(userId, ready.id, {
          mimeType: "image/jpeg",
          sizeBytes: 999,
          sha256: SHA_B
        })
      )
    ).resolves.toEqual({ status: "ALREADY_READY" });
    await expect(
      storageStore().findStorageObjectForUser(userId, ready.id)
    ).resolves.toMatchObject({
      mimeType: "image/png",
      sizeBytes: 128,
      sha256: SHA_A
    });

    const failed = await createPending(userId);
    await storageStore().markStorageObjectFailed({ userId, id: failed.id });
    await expect(
      storageStore().markStorageObjectFailed({ userId, id: failed.id })
    ).resolves.toEqual({ status: "ALREADY_FAILED" });

    await storageStore().markStorageObjectDeleted({ userId, id: failed.id });
    const firstDeleted = await storageStore().findStorageObjectForUser(
      userId,
      failed.id
    );
    await expect(
      storageStore().markStorageObjectDeleted({ userId, id: failed.id })
    ).resolves.toEqual({ status: "ALREADY_DELETED" });
    const secondDeleted = await storageStore().findStorageObjectForUser(
      userId,
      failed.id
    );
    expect(secondDeleted?.deletedAt?.getTime()).toBe(
      firstDeleted?.deletedAt?.getTime()
    );
  });

  it("rejects duplicate objectKey values for the same provider", async () => {
    const userId = await createUser();
    const objectKey = `users/${userId}/same.png`;
    await createPending(userId, { objectKey });

    await expect(
      createPending(userId, { objectKey })
    ).rejects.toThrow(/^STORAGE_OBJECT_KEY_CONFLICT$/);
  });

  it("allows the same objectKey for different providers", async () => {
    const userId = await createUser();
    const objectKey = `users/${userId}/provider-specific.png`;
    const local = await createPending(userId, {
      objectKey,
      storageProvider: StorageProvider.LOCAL
    });
    const s3 = await createPending(userId, {
      objectKey,
      storageProvider: StorageProvider.S3_COMPATIBLE
    });

    expect(local.storageProvider).toBe(StorageProvider.LOCAL);
    expect(s3.storageProvider).toBe(StorageProvider.S3_COMPATIBLE);
  });

  it("does not let one user read another user's object", async () => {
    const ownerId = await createUser();
    const otherUserId = await createUser();
    const created = await createPending(ownerId);
    await storageStore().markStorageObjectReady(
      readyInput(ownerId, created.id)
    );

    await expect(
      storageStore().findStorageObjectForUser(otherUserId, created.id)
    ).resolves.toBeNull();
    await expect(
      storageStore().findReadyStorageObjectForUser(otherUserId, created.id)
    ).resolves.toBeNull();
  });

  it("does not let one user modify another user's object", async () => {
    const ownerId = await createUser();
    const otherUserId = await createUser();
    const created = await createPending(ownerId);

    await expect(
      storageStore().markStorageObjectReady(
        readyInput(otherUserId, created.id)
      )
    ).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(
      storageStore().markStorageObjectFailed({
        userId: otherUserId,
        id: created.id
      })
    ).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(
      storageStore().markStorageObjectDeleted({
        userId: otherUserId,
        id: created.id
      })
    ).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(
      storageStore().findStorageObjectForUser(ownerId, created.id)
    ).resolves.toMatchObject({
      status: StorageObjectStatus.PENDING
    });
  });

  it("rejects unsafe object keys with a static error", async () => {
    const userId = await createUser();
    const invalidObjectKeys = [
      "",
      ".",
      "../escape.png",
      "/home/test/absolute.png",
      "folder\\file.png",
      "folder//file.png",
      "https://example.test/file.png",
      "C:/temp/file.png",
      "folder/./file.png",
      "folder/\0file.png",
      "folder/",
      "a".repeat(513)
    ];

    for (const objectKey of invalidObjectKeys) {
      await expect(
        createPending(userId, { objectKey })
      ).rejects.toThrow(/^INVALID_STORAGE_OBJECT_KEY$/);
    }
  });

  it("rejects MIME types outside the current image allowlist", async () => {
    const userId = await createUser();
    const created = await createPending(userId);

    for (const mimeType of [
      "image/svg+xml",
      "image/gif",
      "text/html",
      "application/pdf",
      "IMAGE/PNG"
    ]) {
      await expect(
        storageStore().markStorageObjectReady(
          readyInput(userId, created.id, { mimeType })
        )
      ).rejects.toThrow(/^INVALID_STORAGE_OBJECT_MIME_TYPE$/);
    }
    await expect(
      storageStore().findStorageObjectForUser(userId, created.id)
    ).resolves.toMatchObject({
      status: StorageObjectStatus.PENDING
    });
  });

  it("rejects invalid sizeBytes values before database mutation", async () => {
    const userId = await createUser();
    const created = await createPending(userId);

    for (const sizeBytes of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      await expect(
        storageStore().markStorageObjectReady(
          readyInput(userId, created.id, { sizeBytes })
        )
      ).rejects.toThrow(/^INVALID_STORAGE_OBJECT_SIZE_BYTES$/);
    }
    await expect(
      storageStore().findStorageObjectForUser(userId, created.id)
    ).resolves.toMatchObject({
      status: StorageObjectStatus.PENDING
    });
  });

  it("rejects malformed sha256 values", async () => {
    const userId = await createUser();
    const created = await createPending(userId);

    for (const sha256 of [
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64)
    ]) {
      await expect(
        storageStore().markStorageObjectReady(
          readyInput(userId, created.id, { sha256 })
        )
      ).rejects.toThrow(/^INVALID_STORAGE_OBJECT_SHA256$/);
    }
    await expect(
      storageStore().findStorageObjectForUser(userId, created.id)
    ).resolves.toMatchObject({
      status: StorageObjectStatus.PENDING
    });
  });

  it("allows different users to persist the same sha256", async () => {
    const firstUserId = await createUser();
    const secondUserId = await createUser();
    const first = await createPending(firstUserId);
    const second = await createPending(secondUserId);

    await expect(
      storageStore().markStorageObjectReady(
        readyInput(firstUserId, first.id, { sha256: SHA_A })
      )
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      storageStore().markStorageObjectReady(
        readyInput(secondUserId, second.id, { sha256: SHA_A })
      )
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      database().storageObject.count({
        where: {
          sha256: SHA_A,
          userId: { in: [firstUserId, secondUserId] }
        }
      })
    ).resolves.toBe(2);
  });

  it("keeps existing avatar URLs while new avatar references default to null", async () => {
    const avatarUrl = "https://example.test/existing-avatar.png";
    const userId = await createUser(avatarUrl);

    await expect(
      database().user.findUniqueOrThrow({ where: { id: userId } })
    ).resolves.toMatchObject({
      avatarUrl,
      avatarStorageObjectId: null
    });
  });

  it.each(["image/png", "image/jpeg", "image/webp"])(
    "atomically links a READY LOCAL UPLOAD %s avatar with no old reference",
    async (mimeType) => {
      const userId = await createUser();
      const avatar = await createPersistedReadyObject(userId, {
        mimeType,
        sha256:
          mimeType === "image/png"
            ? SHA_A
            : mimeType === "image/jpeg"
              ? SHA_B
              : SHA_C
      });
      const avatarUrl = `/generated-assets/${avatar.id}`;

      const result = await storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl,
        storageObjectId: avatar.id
      });

      expect(result).toMatchObject({
        status: "UPDATED",
        user: {
          id: userId,
          avatarUrl,
          avatarStorageObjectId: avatar.id
        },
        replacedStorageObjectId: null
      });
      await expect(
        database().user.findUniqueOrThrow({ where: { id: userId } })
      ).resolves.toMatchObject({
        avatarUrl,
        avatarStorageObjectId: avatar.id
      });
    }
  );

  it("commits a local avatar and profile fields in the same transaction", async () => {
    const userId = await createUser("https://example.test/original.png");
    const avatar = await createPersistedReadyObject(userId);
    const avatarUrl = `/generated-assets/${avatar.id}`;

    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl,
        storageObjectId: avatar.id,
        profile: { name: "Atomic Local Name" }
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      user: {
        id: userId,
        name: "Atomic Local Name",
        avatarUrl,
        avatarStorageObjectId: avatar.id
      }
    });
    await expect(
      database().user.findUniqueOrThrow({ where: { id: userId } })
    ).resolves.toMatchObject({
      name: "Atomic Local Name",
      avatarUrl,
      avatarStorageObjectId: avatar.id
    });
  });

  it("returns the replaced object and never returns an unchanged current object", async () => {
    const userId = await createUser();
    const firstAvatar = await createPersistedReadyObject(userId, {
      sha256: SHA_A
    });
    const secondAvatar = await createPersistedReadyObject(userId, {
      sha256: SHA_B
    });

    await storageStore().replaceUserAvatarReference({
      kind: "LOCAL_STORAGE_OBJECT",
      userId,
      avatarUrl: `/generated-assets/${firstAvatar.id}`,
      storageObjectId: firstAvatar.id
    });
    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl: `/generated-assets/${secondAvatar.id}`,
        storageObjectId: secondAvatar.id
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      replacedStorageObjectId: firstAvatar.id
    });

    const updatedUrl = `/generated-assets/${secondAvatar.id}?version=2`;
    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl: updatedUrl,
        storageObjectId: secondAvatar.id
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      user: {
        avatarUrl: updatedUrl,
        avatarStorageObjectId: secondAvatar.id
      },
      replacedStorageObjectId: null
    });
  });

  it("atomically replaces a local avatar with an external URL", async () => {
    const userId = await createUser();
    const localAvatar = await createPersistedReadyObject(userId);
    await storageStore().replaceUserAvatarReference({
      kind: "LOCAL_STORAGE_OBJECT",
      userId,
      avatarUrl: `/generated-assets/${localAvatar.id}`,
      storageObjectId: localAvatar.id
    });

    const avatarUrl = "https://example.test/external-avatar.png";
    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "EXTERNAL_URL",
        userId,
        avatarUrl,
        profile: { name: "Atomic External Name" }
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      user: {
        name: "Atomic External Name",
        avatarUrl,
        avatarStorageObjectId: null
      },
      replacedStorageObjectId: localAvatar.id
    });
    await expect(
      database().user.findUniqueOrThrow({ where: { id: userId } })
    ).resolves.toMatchObject({
      name: "Atomic External Name",
      avatarUrl,
      avatarStorageObjectId: null
    });
  });

  it("atomically clears both avatar fields and returns the old local object", async () => {
    const userId = await createUser();
    const localAvatar = await createPersistedReadyObject(userId);
    await storageStore().replaceUserAvatarReference({
      kind: "LOCAL_STORAGE_OBJECT",
      userId,
      avatarUrl: `/generated-assets/${localAvatar.id}`,
      storageObjectId: localAvatar.id
    });

    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "CLEARED",
        userId,
        profile: { name: "Atomic Cleared Name" }
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      user: {
        name: "Atomic Cleared Name",
        avatarStorageObjectId: null
      },
      replacedStorageObjectId: localAvatar.id
    });
    await expect(
      database().user.findUniqueOrThrow({ where: { id: userId } })
    ).resolves.toMatchObject({
      name: "Atomic Cleared Name",
      avatarUrl: null,
      avatarStorageObjectId: null
    });
  });

  it("returns NOT_FOUND without consulting a local object for a missing user", async () => {
    const ownerId = await createUser();
    const avatar = await createPersistedReadyObject(ownerId);

    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId: `${USER_PREFIX}missing`,
        avatarUrl: `/generated-assets/${avatar.id}`,
        storageObjectId: avatar.id,
        profile: { name: "Must Not Be Created" }
      })
    ).resolves.toEqual({
      status: "NOT_FOUND",
      user: null,
      replacedStorageObjectId: null
    });
    await expect(
      database().user.count({
        where: { id: `${USER_PREFIX}missing` }
      })
    ).resolves.toBe(0);
  });

  it("does not update profile fields when the local avatar object is unavailable", async () => {
    const userId = await createUser("https://example.test/original.png");
    const otherUserId = await createUser();
    const otherAvatar = await createPersistedReadyObject(otherUserId);

    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl: `/generated-assets/${otherAvatar.id}`,
        storageObjectId: otherAvatar.id,
        profile: { name: "Must Not Commit" }
      })
    ).resolves.toEqual({
      status: "STORAGE_OBJECT_UNAVAILABLE",
      user: null,
      replacedStorageObjectId: null
    });
    await expect(
      database().user.findUniqueOrThrow({ where: { id: userId } })
    ).resolves.toMatchObject({
      name: null,
      avatarUrl: "https://example.test/original.png",
      avatarStorageObjectId: null
    });
  });

  it("rolls back both profile and avatar fields when the transaction update fails", async () => {
    const userId = await createUser("https://example.test/original.png");
    const avatar = await createPersistedReadyObject(userId);

    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl: `/generated-assets/${avatar.id}`,
        storageObjectId: avatar.id,
        profile: { name: "x".repeat(1000) }
      })
    ).rejects.toThrow();
    await expect(
      database().user.findUniqueOrThrow({ where: { id: userId } })
    ).resolves.toMatchObject({
      name: null,
      avatarUrl: "https://example.test/original.png",
      avatarStorageObjectId: null
    });
  });

  it("maps cross-user and missing objects to the same safe result without changing the user", async () => {
    const firstUserId = await createUser();
    const secondUserId = await createUser();
    const currentAvatar = await createPersistedReadyObject(firstUserId);
    const otherAvatar = await createPersistedReadyObject(secondUserId);
    const currentUrl = `/generated-assets/${currentAvatar.id}`;
    await storageStore().replaceUserAvatarReference({
      kind: "LOCAL_STORAGE_OBJECT",
      userId: firstUserId,
      avatarUrl: currentUrl,
      storageObjectId: currentAvatar.id
    });

    const unavailableResult = {
      status: "STORAGE_OBJECT_UNAVAILABLE",
      user: null,
      replacedStorageObjectId: null
    };
    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId: firstUserId,
        avatarUrl: `/generated-assets/${otherAvatar.id}`,
        storageObjectId: otherAvatar.id
      })
    ).resolves.toEqual(unavailableResult);
    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId: firstUserId,
        avatarUrl: "/generated-assets/missing",
        storageObjectId: `${USER_PREFIX}missing-object`
      })
    ).resolves.toEqual(unavailableResult);
    await expect(
      database().user.findUniqueOrThrow({ where: { id: firstUserId } })
    ).resolves.toMatchObject({
      avatarUrl: currentUrl,
      avatarStorageObjectId: currentAvatar.id
    });
  });

  it.each([
    {
      label: "PENDING",
      overrides: { status: StorageObjectStatus.PENDING }
    },
    {
      label: "FAILED",
      overrides: { status: StorageObjectStatus.FAILED }
    },
    {
      label: "DELETED",
      overrides: {
        status: StorageObjectStatus.DELETED,
        deletedAt: new Date("2026-07-17T00:00:00.000Z")
      }
    },
    {
      label: "READY with deletedAt",
      overrides: {
        deletedAt: new Date("2026-07-17T00:00:00.000Z")
      }
    },
    {
      label: "S3_COMPATIBLE",
      overrides: { storageProvider: StorageProvider.S3_COMPATIBLE }
    },
    {
      label: "GENERATED",
      overrides: { source: StorageObjectSource.GENERATED }
    },
    {
      label: "IMPORTED",
      overrides: { source: StorageObjectSource.IMPORTED }
    }
  ] satisfies Array<{
    label: string;
    overrides: PersistedStorageObjectOverrides;
  }>)(
    "rejects unavailable avatar object state/provider/source: $label",
    async ({ overrides }) => {
      const userId = await createUser();
      const currentAvatar = await createPersistedReadyObject(userId, {
        sha256: SHA_A
      });
      const unavailableAvatar = await createPersistedReadyObject(userId, {
        sha256: SHA_B,
        ...overrides
      });
      const currentUrl = `/generated-assets/${currentAvatar.id}`;
      await storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl: currentUrl,
        storageObjectId: currentAvatar.id
      });

      await expect(
        storageStore().replaceUserAvatarReference({
          kind: "LOCAL_STORAGE_OBJECT",
          userId,
          avatarUrl: `/generated-assets/${unavailableAvatar.id}`,
          storageObjectId: unavailableAvatar.id
        })
      ).resolves.toEqual({
        status: "STORAGE_OBJECT_UNAVAILABLE",
        user: null,
        replacedStorageObjectId: null
      });
      await expect(
        database().user.findUniqueOrThrow({ where: { id: userId } })
      ).resolves.toMatchObject({
        avatarUrl: currentUrl,
        avatarStorageObjectId: currentAvatar.id
      });
    }
  );

  it.each([
    {
      label: "unsupported MIME",
      overrides: { mimeType: "image/gif" }
    },
    {
      label: "missing MIME",
      overrides: { mimeType: null }
    },
    {
      label: "missing size",
      overrides: { sizeBytes: null }
    },
    {
      label: "unsafe size",
      overrides: { sizeBytes: BigInt(Number.MAX_SAFE_INTEGER) + 1n }
    },
    {
      label: "missing hash",
      overrides: { sha256: null }
    },
    {
      label: "malformed hash",
      overrides: { sha256: "A".repeat(64) }
    }
  ] satisfies Array<{
    label: string;
    overrides: PersistedStorageObjectOverrides;
  }>)(
    "rejects READY avatar objects with invalid persisted metadata: $label",
    async ({ overrides }) => {
      const userId = await createUser("https://example.test/original.png");
      const unavailableAvatar = await createPersistedReadyObject(
        userId,
        overrides
      );

      await expect(
        storageStore().replaceUserAvatarReference({
          kind: "LOCAL_STORAGE_OBJECT",
          userId,
          avatarUrl: `/generated-assets/${unavailableAvatar.id}`,
          storageObjectId: unavailableAvatar.id
        })
      ).resolves.toEqual({
        status: "STORAGE_OBJECT_UNAVAILABLE",
        user: null,
        replacedStorageObjectId: null
      });
      await expect(
        database().user.findUniqueOrThrow({ where: { id: userId } })
      ).resolves.toMatchObject({
        avatarUrl: "https://example.test/original.png",
        avatarStorageObjectId: null
      });
    }
  );

  it("serializes two real concurrent avatar replacements into one replacement chain", async () => {
    const userId = await createUser();
    const initialAvatar = await createPersistedReadyObject(userId, {
      sha256: SHA_A
    });
    const firstCandidate = await createPersistedReadyObject(userId, {
      sha256: SHA_B
    });
    const secondCandidate = await createPersistedReadyObject(userId, {
      sha256: SHA_C
    });
    await storageStore().replaceUserAvatarReference({
      kind: "LOCAL_STORAGE_OBJECT",
      userId,
      avatarUrl: `/generated-assets/${initialAvatar.id}`,
      storageObjectId: initialAvatar.id
    });

    const [firstResult, secondResult] = await Promise.all([
      storageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl: `/generated-assets/${firstCandidate.id}`,
        storageObjectId: firstCandidate.id
      }),
      concurrentStorageStore().replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId,
        avatarUrl: `/generated-assets/${secondCandidate.id}`,
        storageObjectId: secondCandidate.id
      })
    ]);

    expect(firstResult.status).toBe("UPDATED");
    expect(secondResult.status).toBe("UPDATED");
    if (
      firstResult.status !== "UPDATED" ||
      secondResult.status !== "UPDATED"
    ) {
      throw new Error("CONCURRENT_AVATAR_REPLACEMENT_NOT_UPDATED");
    }

    const finalUser = await database().user.findUniqueOrThrow({
      where: { id: userId }
    });
    expect([firstCandidate.id, secondCandidate.id]).toContain(
      finalUser.avatarStorageObjectId
    );
    const replacedStorageObjectIds = [
      firstResult.replacedStorageObjectId,
      secondResult.replacedStorageObjectId
    ];
    const nonFinalCandidateId =
      finalUser.avatarStorageObjectId === firstCandidate.id
        ? secondCandidate.id
        : firstCandidate.id;
    expect(replacedStorageObjectIds).toContain(initialAvatar.id);
    expect(replacedStorageObjectIds).toContain(nonFinalCandidateId);
    expect(replacedStorageObjectIds).not.toContain(
      finalUser.avatarStorageObjectId
    );
    expect(new Set(replacedStorageObjectIds).size).toBe(2);
  });

  it("keeps AiAsset StorageObject relations and nullable legacy asset flows intact", async () => {
    const userId = await createUser();
    const storageObject = await createPersistedReadyObject(userId);
    const linkedAsset = await database().aiAsset.create({
      data: {
        userId,
        type: "IMAGE",
        url: "/generated-assets/linked-contract.png",
        storageObjectId: storageObject.id
      }
    });
    const legacyAsset = await database().aiAsset.create({
      data: {
        userId,
        type: "IMAGE",
        url: "/generated-assets/existing-contract.png"
      }
    });
    const secondLegacyAsset = await database().aiAsset.create({
      data: {
        userId,
        type: "IMAGE",
        url: "https://provider.example.test/nullable-contract.png"
      }
    });

    await storageStore().replaceUserAvatarReference({
      kind: "LOCAL_STORAGE_OBJECT",
      userId,
      avatarUrl: `/generated-assets/${storageObject.id}`,
      storageObjectId: storageObject.id
    });
    await expect(
      database().aiAsset.findUniqueOrThrow({
        where: { id: linkedAsset.id }
      })
    ).resolves.toMatchObject({
      storageObjectId: storageObject.id
    });
    expect(legacyAsset.storageObjectId).toBeNull();
    expect(secondLegacyAsset.storageObjectId).toBeNull();
    await expect(
      database().aiAsset.create({
        data: {
          userId,
          type: "IMAGE",
          url: "/generated-assets/duplicate-link.png",
          storageObjectId: storageObject.id
        }
      })
    ).rejects.toThrow();
  });

  it.each(["image/png", "image/jpeg", "image/webp"] as const)(
    "completes a local generated %s asset with a private content URL",
    async (mimeType) => {
      const fixture = await createImageCompletionFixture();
      const storageObject = await createReadyGeneratedObject(fixture.userId, {
        mimeType,
        sizeBytes: 256n,
        sha256: SHA_B
      });

      const result =
        await storageStore().completeImageTaskWithReservation(
          completionInput(fixture, [
            localAssetInput(fixture, storageObject.id)
          ])
        );

      expect(result.status).toBe("UPDATED");
      const asset = await database().aiAsset.findFirstOrThrow({
        where: { taskId: fixture.taskId }
      });
      const contentUrlMatch =
        /^\/assets\/([^/]+)\/content$/u.exec(asset.url);
      expect(contentUrlMatch).not.toBeNull();
      if (!contentUrlMatch) {
        throw new Error("TEST_LOCAL_ASSET_CONTENT_URL_INVALID");
      }
      expect(asset.id).not.toBe("");
      expect(contentUrlMatch[1]).toBe(asset.id);
      expect(encodeURIComponent(asset.id)).toBe(asset.id);
      expect(asset.storageObjectId).toBe(storageObject.id);
      await expect(
        database().storageObject.findUniqueOrThrow({
          where: { id: storageObject.id }
        })
      ).resolves.toMatchObject({
        status: StorageObjectStatus.READY,
        mimeType
      });
    }
  );

  it("generates distinct opaque local asset IDs and ignores a caller ID property", async () => {
    const fixture = await createImageCompletionFixture();
    const [firstObject, secondObject] = await Promise.all([
      createReadyGeneratedObject(fixture.userId),
      createReadyGeneratedObject(fixture.userId, {
        sha256: SHA_B
      })
    ]);
    const callerAssetId = `caller_${randomUUID()}`;
    const callerSpecifiedAsset = {
      ...localAssetInput(fixture, firstObject.id),
      id: callerAssetId
    };

    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          callerSpecifiedAsset,
          localAssetInput(fixture, secondObject.id)
        ])
      )
    ).resolves.toMatchObject({ status: "UPDATED" });

    const assets = await database().aiAsset.findMany({
      where: { taskId: fixture.taskId }
    });
    expect(assets).toHaveLength(2);
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(2);
    expect(assets.map((asset) => asset.id)).not.toContain(callerAssetId);
    for (const asset of assets) {
      expect(asset.id).toMatch(/^[A-Za-z0-9._~-]+$/u);
      expect(asset.url).toBe(`/assets/${asset.id}/content`);
    }
  });

  it("rejects a caller URL for a local StorageObject asset at runtime", async () => {
    const fixture = await createImageCompletionFixture();
    const storageObject = await createReadyGeneratedObject(fixture.userId);
    const before = await readImageCompletionState(fixture);
    const unsafeInput = {
      taskId: fixture.taskId,
      reservationId: fixture.reservationId,
      assets: [
        {
          userId: fixture.userId,
          taskId: fixture.taskId,
          type: "image",
          storageObjectId: storageObject.id,
          url: "https://caller.example.test/forbidden.png"
        }
      ]
    };
    const complete = storageStore().completeImageTaskWithReservation;

    await expect(
      Reflect.apply(complete, storageStore(), [unsafeInput])
    ).rejects.toThrow(/^AI_ASSET_LOCAL_URL_FORBIDDEN$/u);
    await expect(readImageCompletionState(fixture)).resolves.toEqual(before);
  });

  it("rejects a missing generated StorageObject without partial completion", async () => {
    const fixture = await createImageCompletionFixture();
    const before = await readImageCompletionState(fixture);

    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          localAssetInput(fixture, `${USER_PREFIX}missing-object`)
        ])
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_UNAVAILABLE$/u);
    await expect(readImageCompletionState(fixture)).resolves.toEqual(before);
  });

  it("rejects a generated StorageObject owned by another user uniformly", async () => {
    const fixture = await createImageCompletionFixture();
    const otherUserId = await createUser();
    const storageObject = await createReadyGeneratedObject(otherUserId);
    const before = await readImageCompletionState(fixture);

    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          localAssetInput(fixture, storageObject.id)
        ])
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_UNAVAILABLE$/u);
    await expect(readImageCompletionState(fixture)).resolves.toEqual(before);
  });

  it.each(
    [
      {
        name: "PENDING status",
        overrides: { status: StorageObjectStatus.PENDING }
      },
      {
        name: "FAILED status",
        overrides: { status: StorageObjectStatus.FAILED }
      },
      {
        name: "DELETED status",
        overrides: {
          status: StorageObjectStatus.DELETED,
          deletedAt: new Date("2026-07-17T00:00:00.000Z")
        }
      },
      {
        name: "UPLOAD source",
        overrides: { source: StorageObjectSource.UPLOAD }
      },
      {
        name: "IMPORTED source",
        overrides: { source: StorageObjectSource.IMPORTED }
      },
      {
        name: "S3-compatible provider",
        overrides: { storageProvider: StorageProvider.S3_COMPATIBLE }
      },
      {
        name: "deletedAt on a READY object",
        overrides: { deletedAt: new Date("2026-07-17T00:00:00.000Z") }
      },
      {
        name: "missing MIME type",
        overrides: { mimeType: null }
      },
      {
        name: "missing size",
        overrides: { sizeBytes: null }
      },
      {
        name: "zero size",
        overrides: { sizeBytes: 0n }
      },
      {
        name: "unsafe size",
        overrides: { sizeBytes: BigInt(Number.MAX_SAFE_INTEGER) + 1n }
      },
      {
        name: "missing SHA-256",
        overrides: { sha256: null }
      },
      {
        name: "malformed SHA-256",
        overrides: { sha256: "A".repeat(64) }
      }
    ] satisfies Array<{
      name: string;
      overrides: PersistedStorageObjectOverrides;
    }>
  )(
    "rejects a generated StorageObject with $name and rolls back",
    async ({ overrides }) => {
      const fixture = await createImageCompletionFixture();
      const storageObject = await createReadyGeneratedObject(
        fixture.userId,
        overrides
      );
      const before = await readImageCompletionState(fixture);

      await expect(
        storageStore().completeImageTaskWithReservation(
          completionInput(fixture, [
            localAssetInput(fixture, storageObject.id)
          ])
        )
      ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_UNAVAILABLE$/u);
      await expect(readImageCompletionState(fixture)).resolves.toEqual(before);
    }
  );

  it("rejects a duplicate StorageObject in one asset batch atomically", async () => {
    const fixture = await createImageCompletionFixture();
    const storageObject = await createReadyGeneratedObject(fixture.userId);
    const before = await readImageCompletionState(fixture);

    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          localAssetInput(fixture, storageObject.id),
          localAssetInput(fixture, storageObject.id)
        ])
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED$/u);
    await expect(readImageCompletionState(fixture)).resolves.toEqual(before);
    await expect(
      database().aiAsset.count({
        where: { storageObjectId: storageObject.id }
      })
    ).resolves.toBe(0);
  });

  it("rejects a StorageObject already linked to another AiAsset safely", async () => {
    const userId = await createUser();
    const firstFixture = await createImageCompletionFixture(userId);
    const storageObject = await createReadyGeneratedObject(userId);
    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(firstFixture, [
          localAssetInput(firstFixture, storageObject.id)
        ])
      )
    ).resolves.toMatchObject({ status: "UPDATED" });

    const secondFixture = await createImageCompletionFixture(userId);
    const before = await readImageCompletionState(secondFixture);
    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(secondFixture, [
          localAssetInput(secondFixture, storageObject.id)
        ])
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED$/u);
    await expect(
      readImageCompletionState(secondFixture)
    ).resolves.toEqual(before);
    await expect(
      database().aiAsset.count({
        where: { storageObjectId: storageObject.id }
      })
    ).resolves.toBe(1);
  });

  it("allows only one concurrent task to link the same StorageObject", async () => {
    const userId = await createUser();
    const firstFixture = await createImageCompletionFixture(userId);
    const secondFixture = await createImageCompletionFixture(userId);
    const storageObject = await createReadyGeneratedObject(userId);
    const quotaBefore = await database().userQuota.findUniqueOrThrow({
      where: { userId },
      select: { remainingCredits: true }
    });

    const results = await Promise.all([
      captureCompletion(
        storageStore().completeImageTaskWithReservation(
          completionInput(firstFixture, [
            localAssetInput(firstFixture, storageObject.id)
          ])
        )
      ),
      captureCompletion(
        concurrentStorageStore().completeImageTaskWithReservation(
          completionInput(secondFixture, [
            localAssetInput(secondFixture, storageObject.id)
          ])
        )
      )
    ]);

    const fulfilled = results.filter(
      (result) => result.outcome === "fulfilled"
    );
    const rejected = results.filter(
      (result) => result.outcome === "rejected"
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({
      outcome: "fulfilled",
      value: { status: "UPDATED" }
    });
    expect(rejected).toEqual([
      {
        outcome: "rejected",
        errorCode: "AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED"
      }
    ]);

    const [assets, tasks, reservations, storageAfter, quotaAfter] =
      await Promise.all([
        database().aiAsset.findMany({
          where: { storageObjectId: storageObject.id }
        }),
        database().aiTask.findMany({
          where: {
            id: { in: [firstFixture.taskId, secondFixture.taskId] }
          },
          select: { status: true }
        }),
        database().creditReservation.findMany({
          where: {
            id: {
              in: [
                firstFixture.reservationId,
                secondFixture.reservationId
              ]
            }
          },
          select: { status: true }
        }),
        database().storageObject.findUniqueOrThrow({
          where: { id: storageObject.id }
        }),
        database().userQuota.findUniqueOrThrow({
          where: { userId },
          select: { remainingCredits: true }
        })
      ]);
    expect(assets).toHaveLength(1);
    expect(tasks.map((task) => task.status).sort()).toEqual([
      "RUNNING",
      "SUCCEEDED"
    ]);
    expect(
      reservations.map((reservation) => reservation.status).sort()
    ).toEqual(["RESERVED", "SETTLED"]);
    expect(storageAfter.status).toBe(StorageObjectStatus.READY);
    expect(quotaAfter).toEqual(quotaBefore);
  });

  it("creates no assets when any object in a mixed batch is unavailable", async () => {
    const fixture = await createImageCompletionFixture();
    const [validObject, invalidObject] = await Promise.all([
      createReadyGeneratedObject(fixture.userId),
      createReadyGeneratedObject(fixture.userId, {
        status: StorageObjectStatus.PENDING,
        sha256: SHA_B
      })
    ]);
    const before = await readImageCompletionState(fixture);

    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          externalAssetInput(fixture, "valid-provider"),
          localAssetInput(fixture, validObject.id),
          localAssetInput(fixture, invalidObject.id)
        ])
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_UNAVAILABLE$/u);
    await expect(readImageCompletionState(fixture)).resolves.toEqual(before);
    await expect(
      database().aiAsset.count({
        where: {
          storageObjectId: { in: [validObject.id, invalidObject.id] }
        }
      })
    ).resolves.toBe(0);
  });

  it("rejects an AiAsset user that differs from the current task owner", async () => {
    const fixture = await createImageCompletionFixture();
    const otherUserId = await createUser();
    const before = await readImageCompletionState(fixture);
    const mismatchedAsset = {
      ...externalAssetInput(fixture, "wrong-user"),
      userId: otherUserId
    };

    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [mismatchedAsset])
      )
    ).rejects.toThrow(/^AI_ASSET_TASK_OWNERSHIP_MISMATCH$/u);
    await expect(readImageCompletionState(fixture)).resolves.toEqual(before);
  });

  it("rejects an AiAsset taskId that differs from the completed task", async () => {
    const userId = await createUser();
    const fixture = await createImageCompletionFixture(userId);
    const otherFixture = await createImageCompletionFixture(userId);
    const before = await readImageCompletionState(fixture);
    const mismatchedAsset = {
      ...externalAssetInput(fixture, "wrong-task"),
      taskId: otherFixture.taskId
    };

    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [mismatchedAsset])
      )
    ).rejects.toThrow(/^AI_ASSET_TASK_OWNERSHIP_MISMATCH$/u);
    await expect(readImageCompletionState(fixture)).resolves.toEqual(before);
  });

  it("preserves the existing provider URL completion path with NULL references", async () => {
    const fixture = await createImageCompletionFixture();
    const providerAsset = externalAssetInput(fixture, "provider-contract");

    const result =
      await storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [providerAsset])
      );

    expect(result).toMatchObject({
      status: "UPDATED",
      assets: [
        {
          url: "https://assets.example.test/provider-contract.png"
        }
      ]
    });
    await expect(
      database().aiAsset.findFirstOrThrow({
        where: { taskId: fixture.taskId }
      })
    ).resolves.toMatchObject({
      url: "https://assets.example.test/provider-contract.png",
      storageObjectId: null
    });
  });

  it("completes local and provider URL assets in one atomic batch", async () => {
    const fixture = await createImageCompletionFixture();
    const storageObject = await createReadyGeneratedObject(fixture.userId);

    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          localAssetInput(fixture, storageObject.id),
          externalAssetInput(fixture, "mixed-provider")
        ])
      )
    ).resolves.toMatchObject({
      status: "UPDATED",
      assets: [
        { url: expect.stringMatching(/^\/assets\/[^/]+\/content$/u) },
        { url: "https://assets.example.test/mixed-provider.png" }
      ]
    });

    const assets = await database().aiAsset.findMany({
      where: { taskId: fixture.taskId },
      orderBy: { url: "asc" }
    });
    expect(assets).toHaveLength(2);
    expect(
      assets.map((asset) => asset.storageObjectId).sort()
    ).toEqual([null, storageObject.id].sort());
    await expect(
      database().storageObject.findUniqueOrThrow({
        where: { id: storageObject.id }
      })
    ).resolves.toMatchObject({
      status: StorageObjectStatus.READY
    });
  });

  it("finds only the owning user's minimal AiAsset StorageObject reference", async () => {
    const fixture = await createImageCompletionFixture();
    const otherUserId = await createUser();
    const storageObject = await createReadyGeneratedObject(fixture.userId);
    const completed =
      await storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          localAssetInput(fixture, storageObject.id)
        ])
      );
    const asset = completed.assets?.[0];
    if (!asset) {
      throw new Error("TEST_LOCAL_ASSET_RESULT_MISSING");
    }

    await expect(
      storageStore().findAiAssetStorageObjectReferenceForUser(
        fixture.userId,
        asset.id
      )
    ).resolves.toEqual({
      assetId: asset.id,
      userId: fixture.userId,
      storageObjectId: storageObject.id
    });
    await expect(
      storageStore().findAiAssetStorageObjectReferenceForUser(
        otherUserId,
        asset.id
      )
    ).resolves.toBeNull();
    await expect(
      storageStore().findAiAssetStorageObjectReferenceForUser(
        fixture.userId,
        `${USER_PREFIX}missing-asset`
      )
    ).resolves.toBeNull();

    const detail = await storageStore().findAiAssetForUser(
      fixture.userId,
      asset.id
    );
    expect(detail?.asset).not.toHaveProperty("storageObjectId");
  });

  it("returns a NULL StorageObject reference for a provider URL asset", async () => {
    const fixture = await createImageCompletionFixture();
    const completed =
      await storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          externalAssetInput(fixture, "reference-provider")
        ])
      );
    const asset = completed.assets?.[0];
    if (!asset) {
      throw new Error("TEST_PROVIDER_ASSET_RESULT_MISSING");
    }

    await expect(
      storageStore().findAiAssetStorageObjectReferenceForUser(
        fixture.userId,
        asset.id
      )
    ).resolves.toEqual({
      assetId: asset.id,
      userId: fixture.userId,
      storageObjectId: null
    });
  });

  it("deletes a local AiAsset and returns only its StorageObject reference", async () => {
    const fixture = await createImageCompletionFixture();
    const storageObject = await createReadyGeneratedObject(fixture.userId);
    const completed =
      await storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          localAssetInput(fixture, storageObject.id)
        ])
      );
    const asset = completed.assets?.[0];
    if (!asset) {
      throw new Error("TEST_LOCAL_ASSET_RESULT_MISSING");
    }
    const objectBefore = await database().storageObject.findUniqueOrThrow({
      where: { id: storageObject.id }
    });

    await expect(
      storageStore().deleteAiAssetForUserWithStorageObjectReference(
        fixture.userId,
        asset.id
      )
    ).resolves.toEqual({
      status: "DELETED",
      storageObjectId: storageObject.id
    });
    await expect(
      database().aiAsset.findUnique({ where: { id: asset.id } })
    ).resolves.toBeNull();
    await expect(
      database().storageObject.findUniqueOrThrow({
        where: { id: storageObject.id }
      })
    ).resolves.toEqual(objectBefore);
  });

  it("deletes a provider URL asset with a NULL reference and hides cross-user assets", async () => {
    const fixture = await createImageCompletionFixture();
    const otherUserId = await createUser();
    const completed =
      await storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          externalAssetInput(fixture, "delete-provider")
        ])
      );
    const asset = completed.assets?.[0];
    if (!asset) {
      throw new Error("TEST_PROVIDER_ASSET_RESULT_MISSING");
    }

    await expect(
      storageStore().deleteAiAssetForUserWithStorageObjectReference(
        otherUserId,
        asset.id
      )
    ).resolves.toEqual({
      status: "NOT_FOUND",
      storageObjectId: null
    });
    await expect(
      database().aiAsset.findUnique({ where: { id: asset.id } })
    ).resolves.not.toBeNull();
    await expect(
      storageStore().deleteAiAssetForUserWithStorageObjectReference(
        fixture.userId,
        asset.id
      )
    ).resolves.toEqual({
      status: "DELETED",
      storageObjectId: null
    });
  });

  it("allows only one concurrent repeated delete to report DELETED", async () => {
    const userId = await createUser();
    const asset = await database().aiAsset.create({
      data: {
        userId,
        type: "IMAGE",
        url: "https://provider.example.test/delete-race.png"
      }
    });

    const results = await Promise.all([
      storageStore().deleteAiAssetForUserWithStorageObjectReference(
        userId,
        asset.id
      ),
      concurrentStorageStore().deleteAiAssetForUserWithStorageObjectReference(
        userId,
        asset.id
      )
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "DELETED",
      "NOT_FOUND"
    ]);
    await expect(
      database().aiAsset.count({ where: { id: asset.id } })
    ).resolves.toBe(0);
  });

  it("filters legacy internal metadata consistently without mutating the database", async () => {
    const fixture = await createImageCompletionFixture();
    const persistedMetadata = {
      storageKey: "images/private/key.png",
      storageProvider: "LOCAL",
      objectKey: "images/private/object.png",
      absolutePath: "/srv/private/object.png",
      mode: "text-to-image",
      modelId: "s2-c1-a-model",
      size: "1024x1024",
      count: 1,
      mimeType: "image/png",
      sizeBytes: 512,
      businessField: "preserved"
    };
    const asset = await database().aiAsset.create({
      data: {
        userId: fixture.userId,
        taskId: fixture.taskId,
        type: "IMAGE",
        url: "/assets/legacy/content",
        metadata: persistedMetadata
      }
    });
    const expectedPublicMetadata = {
      mode: "text-to-image",
      modelId: "s2-c1-a-model",
      size: "1024x1024",
      count: 1,
      mimeType: "image/png",
      sizeBytes: 512,
      businessField: "preserved"
    };

    const [list, detail, taskDetail] = await Promise.all([
      storageStore().listAiAssetsForUser(fixture.userId),
      storageStore().findAiAssetForUser(fixture.userId, asset.id),
      storageStore().findAiTaskForUser(fixture.userId, fixture.taskId)
    ]);
    expect(
      list.find((entry) => entry.id === asset.id)?.metadata
    ).toEqual(expectedPublicMetadata);
    expect(detail?.asset.metadata).toEqual(expectedPublicMetadata);
    expect(
      taskDetail?.assets.find((entry) => entry.id === asset.id)?.metadata
    ).toEqual(expectedPublicMetadata);
    expect(JSON.stringify({ list, detail, taskDetail })).not.toContain(
      "images/private"
    );
    await expect(
      database().aiAsset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { metadata: true }
      })
    ).resolves.toEqual({ metadata: persistedMetadata });
  });

  it("does not persist internal metadata fields for a new local asset", async () => {
    const fixture = await createImageCompletionFixture();
    const storageObject = await createReadyGeneratedObject(fixture.userId);
    const completed =
      await storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [
          localAssetInput(fixture, storageObject.id, {
            storageKey: "images/private/key.png",
            storageProvider: "LOCAL",
            objectKey: "images/private/object.png",
            absolutePath: "/srv/private/object.png",
            mode: "image-to-image",
            mimeType: "image/png",
            sizeBytes: 256,
            nested: { objectKey: "business-nested-value" }
          })
        ])
      );
    const asset = completed.assets?.[0];
    if (!asset) {
      throw new Error("TEST_LOCAL_ASSET_RESULT_MISSING");
    }
    const expectedMetadata = {
      mode: "image-to-image",
      mimeType: "image/png",
      sizeBytes: 256,
      nested: { objectKey: "business-nested-value" }
    };

    expect(asset.metadata).toEqual(expectedMetadata);
    await expect(
      database().aiAsset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { metadata: true }
      })
    ).resolves.toEqual({ metadata: expectedMetadata });
  });

  it("keeps non-object legacy metadata on the existing safe serialization contract", async () => {
    const userId = await createUser();
    const [arrayAsset, scalarAsset, nullAsset] = await Promise.all([
      database().aiAsset.create({
        data: {
          userId,
          type: "IMAGE",
          url: "https://provider.example.test/array.png",
          metadata: ["storageKey", "objectKey"]
        }
      }),
      database().aiAsset.create({
        data: {
          userId,
          type: "IMAGE",
          url: "https://provider.example.test/scalar.png",
          metadata: "absolutePath"
        }
      }),
      database().aiAsset.create({
        data: {
          userId,
          type: "IMAGE",
          url: "https://provider.example.test/null.png",
          metadata: Prisma.DbNull
        }
      })
    ]);

    const list = await storageStore().listAiAssetsForUser(userId);
    expect(
      list.find((asset) => asset.id === arrayAsset.id)?.metadata
    ).toEqual({});
    expect(
      list.find((asset) => asset.id === scalarAsset.id)?.metadata
    ).toEqual({});
    expect(
      list.find((asset) => asset.id === nullAsset.id)?.metadata
    ).toBeNull();
  });

  it("keeps legacy saveAvatar available without changing its avatarUrl-only behavior", async () => {
    const userId = await createUser();
    const storageObject = await createPersistedReadyObject(userId);
    await storageStore().replaceUserAvatarReference({
      kind: "LOCAL_STORAGE_OBJECT",
      userId,
      avatarUrl: `/generated-assets/${storageObject.id}`,
      storageObjectId: storageObject.id
    });
    const saveAvatar = storageStore().saveAvatar;
    if (!saveAvatar) {
      throw new Error("LEGACY_SAVE_AVATAR_MISSING");
    }

    const legacyUrl = "/generated-assets/legacy-route-avatar.png";
    await expect(saveAvatar(userId, legacyUrl)).resolves.toMatchObject({
      id: userId,
      avatarUrl: legacyUrl
    });
    await expect(
      database().user.findUniqueOrThrow({ where: { id: userId } })
    ).resolves.toMatchObject({
      avatarUrl: legacyUrl,
      avatarStorageObjectId: storageObject.id
    });
  });

  it("rejects an empty external avatar URL before database mutation", async () => {
    const userId = await createUser("https://example.test/original.png");

    await expect(
      storageStore().replaceUserAvatarReference({
        kind: "EXTERNAL_URL",
        userId,
        avatarUrl: "   "
      })
    ).rejects.toThrow(/^INVALID_USER_AVATAR_URL$/);
    await expect(
      database().user.findUniqueOrThrow({ where: { id: userId } })
    ).resolves.toMatchObject({
      avatarUrl: "https://example.test/original.png",
      avatarStorageObjectId: null
    });
  });

  it("allows only one conflicting concurrent terminal transition to win", async () => {
    const userId = await createUser();
    const created = await createPending(userId);

    const [readyResult, failedResult] = await Promise.all([
      storageStore().markStorageObjectReady(readyInput(userId, created.id)),
      concurrentStorageStore().markStorageObjectFailed({
        userId,
        id: created.id
      })
    ]);

    expect([readyResult.status, failedResult.status].sort()).toEqual([
      "INVALID_STATE",
      "UPDATED"
    ]);
    const finalObject = await storageStore().findStorageObjectForUser(
      userId,
      created.id
    );
    expect([
      StorageObjectStatus.READY,
      StorageObjectStatus.FAILED
    ]).toContain(finalObject?.status);
    if (finalObject?.status === StorageObjectStatus.READY) {
      expect(finalObject).toMatchObject({
        mimeType: "image/png",
        sizeBytes: 128,
        sha256: SHA_A
      });
    }
  });

  it("lists bounded READY cleanup candidates by updatedAt then id", async () => {
    const userId = await createUser();
    const first = await createReadyGeneratedObject(userId, {
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    const second = await createReadyGeneratedObject(userId, {
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-02T00:00:00.000Z")
    });
    await createReadyGeneratedObject(userId, {
      updatedAt: new Date("2026-07-03T00:00:00.000Z"),
      source: StorageObjectSource.UPLOAD
    });

    await expect(
      storageStore().listReadyGeneratedStorageObjectCleanupCandidates({
        readyBefore: new Date("2026-07-04T00:00:00.000Z"),
        limit: 2
      })
    ).resolves.toEqual([{ id: first.id }, { id: second.id }]);
  });

  it("tombstones an unreferenced READY generated local object with the supplied timestamp", async () => {
    const userId = await createUser();
    const readyBefore = new Date("2026-07-18T00:00:00.000Z");
    const now = new Date("2026-07-19T00:00:00.000Z");
    const storageObject = await createReadyGeneratedObject(userId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z")
    });

    await expect(
      storageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore,
        now
      })
    ).resolves.toEqual({
      status: "CLAIMED",
      id: storageObject.id,
      objectKey: storageObject.objectKey
    });
    await expect(
      database().storageObject.findUniqueOrThrow({
        where: { id: storageObject.id }
      })
    ).resolves.toMatchObject({
      status: StorageObjectStatus.DELETED,
      deletedAt: now
    });
  });

  it("uses updatedAt rather than createdAt for READY cleanup grace", async () => {
    const userId = await createUser();
    const storageObject = await createReadyGeneratedObject(userId, {
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-19T00:00:00.000Z")
    });

    await expect(
      storageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore: new Date("2026-07-18T00:00:00.000Z"),
        now: new Date("2026-07-20T00:00:00.000Z")
      })
    ).resolves.toEqual({ status: "NOT_ELIGIBLE" });
  });

  it("does not tombstone a READY object referenced by an AiAsset", async () => {
    const ownerId = await createUser();
    const storageObject = await createReadyGeneratedObject(ownerId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z")
    });
    await createAiAssetReference(ownerId, storageObject.id);

    await expect(
      storageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore: new Date("2026-07-18T00:00:00.000Z"),
        now: new Date("2026-07-19T00:00:00.000Z")
      })
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
  });

  it("does not tombstone a READY object referenced by a cross-user AiAsset", async () => {
    const ownerId = await createUser();
    const otherUserId = await createUser();
    const storageObject = await createReadyGeneratedObject(ownerId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z")
    });
    await createAiAssetReference(otherUserId, storageObject.id);

    await expect(
      storageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore: new Date("2026-07-18T00:00:00.000Z"),
        now: new Date("2026-07-19T00:00:00.000Z")
      })
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
  });

  it("does not tombstone a READY object referenced by an avatar", async () => {
    const ownerId = await createUser();
    const storageObject = await createReadyGeneratedObject(ownerId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z")
    });
    await createAvatarReference(ownerId, storageObject.id);

    await expect(
      storageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore: new Date("2026-07-18T00:00:00.000Z"),
        now: new Date("2026-07-19T00:00:00.000Z")
      })
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
  });

  it("does not tombstone a READY object referenced by a cross-user avatar", async () => {
    const ownerId = await createUser();
    const otherUserId = await createUser();
    const storageObject = await createReadyGeneratedObject(ownerId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z")
    });
    await createAvatarReference(otherUserId, storageObject.id);

    await expect(
      storageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore: new Date("2026-07-18T00:00:00.000Z"),
        now: new Date("2026-07-19T00:00:00.000Z")
      })
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
  });

  it.each([
    ["S3-compatible", { storageProvider: StorageProvider.S3_COMPATIBLE }],
    ["upload", { source: StorageObjectSource.UPLOAD }],
    ["PENDING", { status: StorageObjectStatus.PENDING }],
    ["FAILED", { status: StorageObjectStatus.FAILED }]
  ])("does not tombstone an ineligible %s object", async (_label, overrides) => {
    const userId = await createUser();
    const storageObject = await createReadyGeneratedObject(userId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z"),
      ...overrides
    });

    await expect(
      storageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore: new Date("2026-07-18T00:00:00.000Z"),
        now: new Date("2026-07-19T00:00:00.000Z")
      })
    ).resolves.toEqual({ status: "NOT_ELIGIBLE" });
  });

  it("serializes two cleanup tombstone workers with one CLAIMED result", async () => {
    const userId = await createUser();
    const storageObject = await createReadyGeneratedObject(userId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z")
    });
    const locked = createDeferred();
    const release = createDeferred();
    const firstStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterCleanupStorageObjectLocked({ phase, storageObjectId }) {
          if (phase === "tombstone" && storageObjectId === storageObject.id) {
            locked.resolve();
            await release.promise;
          }
        }
      }
    });

    const first = firstStore.tombstoneReadyGeneratedStorageObjectForCleanup({
      storageObjectId: storageObject.id,
      readyBefore: new Date("2026-07-18T00:00:00.000Z"),
      now: new Date("2026-07-19T00:00:00.000Z")
    });
    await locked.promise;
    const second =
      concurrentStorageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore: new Date("2026-07-18T00:00:00.000Z"),
        now: new Date("2026-07-19T00:00:00.000Z")
      });
    release.resolve();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect([firstResult.status, secondResult.status]).toContain("CLAIMED");
    expect([firstResult.status, secondResult.status]).not.toEqual([
      "CLAIMED",
      "CLAIMED"
    ]);
  });

  it("makes completion reject an object tombstoned by cleanup first", async () => {
    const fixture = await createImageCompletionFixture();
    const storageObject = await createReadyGeneratedObject(fixture.userId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z")
    });
    const locked = createDeferred();
    const release = createDeferred();
    const cleanupStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterCleanupStorageObjectLocked({ phase, storageObjectId }) {
          if (phase === "tombstone" && storageObjectId === storageObject.id) {
            locked.resolve();
            await release.promise;
          }
        }
      }
    });
    const cleanup = cleanupStore.tombstoneReadyGeneratedStorageObjectForCleanup({
      storageObjectId: storageObject.id,
      readyBefore: new Date("2026-07-18T00:00:00.000Z"),
      now: new Date("2026-07-19T00:00:00.000Z")
    });
    await locked.promise;
    const completion = captureCompletion(
      concurrentStorageStore().completeImageTaskWithReservation(
        completionInput(fixture, [localAssetInput(fixture, storageObject.id)])
      )
    );
    release.resolve();

    await expect(cleanup).resolves.toMatchObject({ status: "CLAIMED" });
    await expect(completion).resolves.toEqual({
      outcome: "rejected",
      errorCode: "AI_ASSET_STORAGE_OBJECT_UNAVAILABLE"
    });
    await expect(
      database().aiAsset.count({ where: { storageObjectId: storageObject.id } })
    ).resolves.toBe(0);
  });

  it("makes cleanup skip a reference committed by completion first", async () => {
    const fixture = await createImageCompletionFixture();
    const storageObject = await createReadyGeneratedObject(fixture.userId, {
      updatedAt: new Date("2026-07-17T00:00:00.000Z")
    });
    const locked = createDeferred();
    const release = createDeferred();
    const completionStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterGeneratedStorageObjectLocked(storageObjectId) {
          if (storageObjectId === storageObject.id) {
            locked.resolve();
            await release.promise;
          }
        }
      }
    });
    const completion = captureCompletion(
      completionStore.completeImageTaskWithReservation(
        completionInput(fixture, [localAssetInput(fixture, storageObject.id)])
      )
    );
    await locked.promise;
    const cleanup =
      concurrentStorageStore().tombstoneReadyGeneratedStorageObjectForCleanup({
        storageObjectId: storageObject.id,
        readyBefore: new Date("2026-07-18T00:00:00.000Z"),
        now: new Date("2026-07-19T00:00:00.000Z")
      });
    release.resolve();

    await expect(completion).resolves.toMatchObject({
      outcome: "fulfilled",
      value: { status: "UPDATED" }
    });
    await expect(cleanup).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
  });

  it("prepares only unreferenced DELETED generated local objects", async () => {
    const userId = await createUser();
    const storageObject = await createDeletedGeneratedObject(userId);

    await expect(
      storageStore().prepareDeletedGeneratedStorageObjectForPurge(
        storageObject.id
      )
    ).resolves.toEqual({
      status: "PREPARED",
      id: storageObject.id,
      objectKey: storageObject.objectKey
    });
  });

  it("claims and purges only an unreferenced generated object for request compensation", async () => {
    const userId = await createUser();
    const storageObject = await createReadyGeneratedObject(userId);

    await expect(
      storageStore().claimGeneratedStorageObjectForCompensation({
        userId,
        storageObjectId: storageObject.id,
        now: new Date("2026-07-19T00:00:00.000Z")
      })
    ).resolves.toEqual({
      status: "CLAIMED",
      id: storageObject.id,
      objectKey: storageObject.objectKey
    });
    await expect(
      database().storageObject.findUniqueOrThrow({
        where: { id: storageObject.id }
      })
    ).resolves.toMatchObject({ status: StorageObjectStatus.DELETED });

    await expect(
      storageStore().prepareDeletedGeneratedStorageObjectForPurge(
        storageObject.id
      )
    ).resolves.toEqual({
      status: "PREPARED",
      id: storageObject.id,
      objectKey: storageObject.objectKey
    });
    await expect(
      storageStore().finalizeDeletedGeneratedStorageObjectPurge(
        storageObject.id
      )
    ).resolves.toEqual({ status: "PURGED" });
    await expect(
      database().storageObject.findUnique({ where: { id: storageObject.id } })
    ).resolves.toBeNull();
  });

  it("does not claim a generated object after completion references it", async () => {
    const fixture = await createImageCompletionFixture();
    const storageObject = await createReadyGeneratedObject(fixture.userId);
    await expect(
      storageStore().completeImageTaskWithReservation(
        completionInput(fixture, [localAssetInput(fixture, storageObject.id)])
      )
    ).resolves.toMatchObject({ status: "UPDATED" });

    await expect(
      storageStore().claimGeneratedStorageObjectForCompensation({
        userId: fixture.userId,
        storageObjectId: storageObject.id,
        now: new Date("2026-07-19T00:00:00.000Z")
      })
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
    await expect(
      database().storageObject.findUniqueOrThrow({
        where: { id: storageObject.id }
      })
    ).resolves.toMatchObject({ status: StorageObjectStatus.READY });
  });

  it.each([
    ["READY", { status: StorageObjectStatus.READY, deletedAt: null }],
    ["S3-compatible", { storageProvider: StorageProvider.S3_COMPATIBLE }],
    ["upload", { source: StorageObjectSource.UPLOAD }],
    ["missing deletedAt", { deletedAt: null }]
  ])("does not prepare an ineligible %s object", async (_label, overrides) => {
    const userId = await createUser();
    const storageObject = await createDeletedGeneratedObject(userId, overrides);

    await expect(
      storageStore().prepareDeletedGeneratedStorageObjectForPurge(
        storageObject.id
      )
    ).resolves.toEqual({ status: "NOT_ELIGIBLE" });
  });

  it("does not prepare a DELETED object when either business reference exists", async () => {
    const ownerId = await createUser();
    const assetUserId = await createUser();
    const avatarUserId = await createUser();
    const assetObject = await createDeletedGeneratedObject(ownerId);
    const avatarObject = await createDeletedGeneratedObject(ownerId);
    await createAiAssetReference(assetUserId, assetObject.id);
    await createAvatarReference(avatarUserId, avatarObject.id);

    await expect(
      storageStore().prepareDeletedGeneratedStorageObjectForPurge(assetObject.id)
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
    await expect(
      storageStore().prepareDeletedGeneratedStorageObjectForPurge(avatarObject.id)
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
  });

  it("purges an unreferenced DELETED generated local object and is idempotent", async () => {
    const userId = await createUser();
    const storageObject = await createDeletedGeneratedObject(userId);

    await expect(
      storageStore().finalizeDeletedGeneratedStorageObjectPurge(storageObject.id)
    ).resolves.toEqual({ status: "PURGED" });
    await expect(
      database().storageObject.findUnique({ where: { id: storageObject.id } })
    ).resolves.toBeNull();
    await expect(
      storageStore().finalizeDeletedGeneratedStorageObjectPurge(storageObject.id)
    ).resolves.toEqual({ status: "ALREADY_PURGED" });
  });

  it.each([
    ["READY", { status: StorageObjectStatus.READY, deletedAt: null }],
    ["S3-compatible", { storageProvider: StorageProvider.S3_COMPATIBLE }],
    ["upload", { source: StorageObjectSource.UPLOAD }]
  ])("does not purge an ineligible %s object", async (_label, overrides) => {
    const userId = await createUser();
    const storageObject = await createDeletedGeneratedObject(userId, overrides);

    await expect(
      storageStore().finalizeDeletedGeneratedStorageObjectPurge(storageObject.id)
    ).resolves.toEqual({ status: "NOT_ELIGIBLE" });
  });

  it("rechecks AiAsset and avatar references before final purge", async () => {
    const ownerId = await createUser();
    const assetUserId = await createUser();
    const avatarUserId = await createUser();
    const assetObject = await createDeletedGeneratedObject(ownerId);
    const avatarObject = await createDeletedGeneratedObject(ownerId);
    await createAiAssetReference(assetUserId, assetObject.id);
    await createAvatarReference(avatarUserId, avatarObject.id);

    await expect(
      storageStore().finalizeDeletedGeneratedStorageObjectPurge(assetObject.id)
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
    await expect(
      storageStore().finalizeDeletedGeneratedStorageObjectPurge(avatarObject.id)
    ).resolves.toEqual({ status: "SKIPPED_REFERENCED" });
  });
});
