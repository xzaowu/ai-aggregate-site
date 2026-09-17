import { randomUUID } from "node:crypto";
import {
  CreditReservationStatus,
  IdempotencyOwnerType,
  IdempotencyRequestStatus,
  PrismaClient,
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider,
  type AiTaskStatus,
  type CreditReservationKind
} from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_CREDIT_EVENT_SOURCE_TYPES,
  createPrismaUserStore,
  imageCreditEventContract,
  type AiAssetCreateInput,
  type CompleteImageTaskWithReservationInput,
  type CompleteImageTaskWithStorageObjectReservationInput,
  type CreateImageTaskWithReservationInput,
  type FailImageTaskAndReleaseReservationInput,
  type ImageTaskCompletionAiAssetCreateInput
} from "../src/store";
import {
  acquireCrossWorkerTestLock,
  IMAGE_RECOVERY_TEST_LOCK_NAME
} from "./helpers/cross-worker-test-lock";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;

databaseSuite.sequential("image task and credit reservation atomic Store operations", () => {
  let prisma: PrismaClient | undefined;
  let store: ReturnType<typeof createPrismaUserStore> | undefined;
  const fixtureUserIds: string[] = [];

  function database(): PrismaClient {
    if (!prisma) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }
    return prisma;
  }

  function imageStore(): ReturnType<typeof createPrismaUserStore> {
    if (!store) {
      throw new Error("TEST_STORE_NOT_INITIALIZED");
    }
    return store;
  }

  // Keep non-recovery image reservation fixtures outside every recovery sweep window.
  const IMAGE_RESERVATION_DEFAULT_EXPIRES_AT = new Date(
    "2300-01-01T00:00:00.000Z"
  );
  const IMAGE_RECOVERY_NOW = new Date("2200-03-01T00:00:00.000Z");
  const IMAGE_RECOVERY_GRACE_MS = 2 * 60 * 1000;
  const GENERATED_STORAGE_OBJECT_SHA256 = "a".repeat(64);

  type GeneratedStorageObjectOverrides = {
    storageProvider?: StorageProvider;
    objectKey?: string;
    mimeType?: string | null;
    sizeBytes?: bigint | null;
    sha256?: string | null;
    source?: StorageObjectSource;
    status?: StorageObjectStatus;
    deletedAt?: Date | null;
  };

  async function createImageFixture(input: {
    amountCredits?: number;
    remainingCredits?: number;
    taskStatus?: AiTaskStatus;
    leavePending?: boolean;
    expiresAt?: Date;
  } = {}): Promise<{
    userId: string;
    taskId: string;
    reservationId: string;
    amountCredits: number;
  }> {
    const userId = `s13b2a_${randomUUID()}`;
    const email = `${userId}@example.test`;
    const amountCredits = input.amountCredits ?? 4;
    fixtureUserIds.push(userId);

    await database().user.create({
      data: {
        id: userId,
        email,
        passwordHash: "test-hash",
        credits: 777,
        quota: {
          create: {
            remainingCredits: input.remainingCredits ?? 20
          }
        }
      }
    });

    const task = await imageStore().createAiTask({
      userId,
      type: "image",
      modelId: "image-test-model",
      prompt: "atomic image test",
      input: { testId: randomUUID() }
    });

    if (!input.leavePending) {
      const running = await imageStore().markAiTaskRunning(task.id);
      if (!running) {
        throw new Error("TEST_TASK_NOT_RUNNING");
      }
    }

    const reserved = await imageStore().reserveCredits({
      userId,
      kind: "IMAGE_GENERATION" as CreditReservationKind,
      amountCredits,
      expiresAt: input.expiresAt ?? IMAGE_RESERVATION_DEFAULT_EXPIRES_AT,
      aiTaskId: task.id
    });

    if (!reserved.ok) {
      throw new Error(reserved.reason);
    }

    if (input.taskStatus) {
      await database().aiTask.update({
        where: { id: task.id },
        data: { status: input.taskStatus }
      });
    }

    return {
      userId,
      taskId: task.id,
      reservationId: reserved.reservation.id,
      amountCredits
    };
  }

  const imageRecoveryBaseNow = IMAGE_RECOVERY_NOW;
  const recoveryTime = (offsetMs: number): Date =>
    new Date(imageRecoveryBaseNow.getTime() + offsetMs);
  const recoveryNow = new Date(IMAGE_RECOVERY_NOW.getTime());
  const recoveryExpiredAt = recoveryTime(-60 * 60 * 1000);
  const recoveryStaleUpdatedAt = recoveryTime(
    -(IMAGE_RECOVERY_GRACE_MS + 8 * 60 * 1000)
  );

  async function prepareRecoveryFixture(input: {
    amountCredits?: number;
    taskStatus?: AiTaskStatus;
    taskUpdatedAt?: Date;
    reservationKind?: CreditReservationKind;
    reservationStatus?: CreditReservationStatus;
    expiresAt?: Date;
    aiTaskId?: string | null;
  } = {}): Promise<{
    userId: string;
    taskId: string;
    reservationId: string;
    amountCredits: number;
  }> {
    const fixture = await createImageFixture({
      amountCredits: input.amountCredits,
      leavePending: true,
      expiresAt: input.expiresAt ?? recoveryExpiredAt
    });
    await database().$transaction(async (tx) => {
      await tx.creditReservation.update({
        where: { id: fixture.reservationId },
        data: {
          kind: input.reservationKind ?? "IMAGE_GENERATION",
          status: input.reservationStatus ?? "RESERVED",
          expiresAt: input.expiresAt ?? recoveryExpiredAt,
          aiTaskId: input.aiTaskId === undefined ? fixture.taskId : input.aiTaskId
        }
      });
      await tx.aiTask.update({
        where: { id: fixture.taskId },
        data: {
          status: input.taskStatus ?? "PENDING",
          updatedAt: input.taskUpdatedAt ?? recoveryStaleUpdatedAt
        }
      });
    });
    return fixture;
  }

  async function prepareZeroCostRecoveryFixture(): Promise<{
    userId: string;
    taskId: string;
    reservationId: string;
  }> {
    const userId = await createUserWithoutQuota();
    const created = await imageStore().createImageTaskWithReservation(
      createImageTaskInput(userId, 0, recoveryExpiredAt)
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(`TEST_UNEXPECTED_RESULT_${created.reason}`);
    }
    await database().$transaction(async (tx) => {
      await tx.creditReservation.update({
        where: { id: created.reservation.id },
        data: {
          expiresAt: recoveryExpiredAt
        }
      });
      await tx.aiTask.update({
        where: { id: created.task.id },
        data: {
          updatedAt: recoveryStaleUpdatedAt
        }
      });
    });
    return {
      userId,
      taskId: created.task.id,
      reservationId: created.reservation.id
    };
  }

  function assetInput(
    fixture: { userId: string; taskId: string },
    suffix: string
  ): AiAssetCreateInput {
    return {
      userId: fixture.userId,
      taskId: fixture.taskId,
      type: "image",
      url: `https://assets.example.test/${fixture.taskId}/${suffix}.png`,
      title: `asset ${suffix}`,
      metadata: { suffix }
    };
  }

  function completeInput(
    fixture: { taskId: string; reservationId: string },
    assets: AiAssetCreateInput[]
  ): CompleteImageTaskWithReservationInput {
    return {
      taskId: fixture.taskId,
      reservationId: fixture.reservationId,
      assets,
      output: { source: "test", assetCount: assets.length }
    };
  }

  async function createReadyGeneratedStorageObject(
    userId: string,
    overrides: GeneratedStorageObjectOverrides = {}
  ) {
    return database().storageObject.create({
      data: {
        userId,
        storageProvider: StorageProvider.LOCAL,
        objectKey: `images/2200/01/${randomUUID()}.png`,
        mimeType: "image/png",
        sizeBytes: 128n,
        sha256: GENERATED_STORAGE_OBJECT_SHA256,
        source: StorageObjectSource.GENERATED,
        status: StorageObjectStatus.READY,
        deletedAt: null,
        ...overrides
      }
    });
  }

  function localAssetInput(
    fixture: { userId: string; taskId: string },
    storageObjectId: string,
    imageOutputIndex: number
  ): ImageTaskCompletionAiAssetCreateInput {
    return {
      userId: fixture.userId,
      taskId: fixture.taskId,
      type: "image",
      storageObjectId,
      metadata: { imageOutputIndex, test: "local" }
    };
  }

  function externalAssetInput(
    fixture: { userId: string; taskId: string },
    suffix: string,
    imageOutputIndex: number
  ): ImageTaskCompletionAiAssetCreateInput {
    return {
      userId: fixture.userId,
      taskId: fixture.taskId,
      type: "image",
      url: `https://assets.example.test/${fixture.taskId}/${suffix}.png`,
      metadata: { imageOutputIndex, test: "external" }
    };
  }

  function storageCompletionInput(
    fixture: { taskId: string; reservationId: string },
    assets: ImageTaskCompletionAiAssetCreateInput[],
    output: Record<string, unknown>
  ): CompleteImageTaskWithStorageObjectReservationInput {
    return {
      taskId: fixture.taskId,
      reservationId: fixture.reservationId,
      assets,
      output
    };
  }

  function failInput(
    fixture: { taskId: string; reservationId: string },
    errorMessage = "safe image failure"
  ): FailImageTaskAndReleaseReservationInput {
    return {
      taskId: fixture.taskId,
      reservationId: fixture.reservationId,
      errorMessage
    };
  }

  async function bindInProgressImageIdempotency(
    fixture: { userId: string; taskId: string }
  ) {
    return database().idempotencyRequest.create({
      data: {
        scope: `S2_C1_C_GENERATE_B_FIX1:${randomUUID()}`,
        ownerType: IdempotencyOwnerType.USER,
        ownerKeyHash: Buffer.alloc(32, 1),
        idempotencyKeyHash: Buffer.alloc(32, 2),
        requestFingerprint: Buffer.alloc(32, 3),
        status: IdempotencyRequestStatus.IN_PROGRESS,
        aiTaskId: fixture.taskId
      }
    });
  }

  function imageTaskInput(): CreateImageTaskWithReservationInput["task"] {
    return {
      type: "image",
      modelId: "image-test-model",
      prompt: "atomic image test",
      input: { testId: randomUUID() }
    };
  }

  async function createQuotaUser(remainingCredits = 20): Promise<string> {
    const userId = `s13b2b1_${randomUUID()}`;
    fixtureUserIds.push(userId);
    await database().user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "test-hash",
        credits: 777,
        quota: {
          create: { remainingCredits }
        }
      }
    });
    return userId;
  }

  async function createUserWithoutQuota(): Promise<string> {
    const userId = `s13b2b1_${randomUUID()}`;
    fixtureUserIds.push(userId);
    await database().user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "test-hash",
        credits: 777
      }
    });
    return userId;
  }

  function createImageTaskInput(
    userId: string,
    amountCredits: number,
    expiresAt = IMAGE_RESERVATION_DEFAULT_EXPIRES_AT
  ): CreateImageTaskWithReservationInput {
    return {
      userId,
      amountCredits,
      expiresAt,
      task: imageTaskInput()
    };
  }

  async function createAtomicImageFixture(amountCredits = 4): Promise<{
    userId: string;
    taskId: string;
    reservationId: string;
    amountCredits: number;
  }> {
    const userId = await createQuotaUser(20);
    const created = await imageStore().createImageTaskWithReservation(
      createImageTaskInput(userId, amountCredits)
    );
    if (!created.ok) {
      throw new Error(`TEST_UNEXPECTED_ATOMIC_IMAGE_${created.reason}`);
    }
    const running = await imageStore().markAiTaskRunning(created.task.id);
    if (!running) {
      throw new Error("TEST_ATOMIC_IMAGE_TASK_NOT_RUNNING");
    }
    return {
      userId,
      taskId: created.task.id,
      reservationId: created.reservation.id,
      amountCredits
    };
  }

  async function cleanupFixtures(): Promise<void> {
    if (!prisma) {
      return;
    }
    const prismaClient = prisma;
    const userIds = [...fixtureUserIds];
    await retryPrismaWriteConflict(async () => {
      if (userIds.length > 0) {
        await prismaClient.accountCreditEvent.deleteMany({
          where: { userId: { in: userIds } }
        });
        await prismaClient.user.deleteMany({ where: { id: { in: userIds } } });
      }
    });
    fixtureUserIds.length = 0;
  }

  async function withImageRecoverySweep<T>(body: () => Promise<T>): Promise<T> {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }
    const lock = await acquireCrossWorkerTestLock({
      name: IMAGE_RECOVERY_TEST_LOCK_NAME,
      databaseUrl
    });
    try {
      return await body();
    } finally {
      try {
        await cleanupFixtures();
      } finally {
        await lock.release();
      }
    }
  }

  beforeAll(async () => {
    if (!databaseUrl) {
      return;
    }

    try {
      prisma = new PrismaClient({
        datasources: {
          db: { url: databaseUrl }
        }
      });
      await prisma.$connect();
      store = createPrismaUserStore(prisma);
    } catch (error) {
      const client = prisma;
      prisma = undefined;
      store = undefined;
      try {
        await client?.$disconnect();
      } catch {
        // Preserve the original Prisma setup error.
      }
      throw error;
    }
  });

  beforeEach(() => {
    fixtureUserIds.length = 0;
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma?.$disconnect();
  });

  it("creates a pending image task and reserved credits atomically", async () => {
    const userId = await createQuotaUser(10);
    const before = await database().user.findUnique({
      where: { id: userId },
      select: { credits: true }
    });

    const result = await imageStore().createImageTaskWithReservation(
      createImageTaskInput(userId, 4)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`TEST_UNEXPECTED_RESULT_${result.reason}`);
    }
    expect(result.task).toMatchObject({
      userId,
      type: "image",
      status: "pending",
      costCredits: 0
    });
    expect(result.reservation).toMatchObject({
      userId,
      kind: "IMAGE_GENERATION",
      amountCredits: 4,
      status: "RESERVED",
      aiTaskId: result.task.id
    });
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
    await expect(
      database().accountCreditEvent.findMany({ where: { userId } })
    ).resolves.toMatchObject([
      {
        userId,
        deltaCredits: -4,
        balanceBefore: 10,
        balanceAfter: 6,
        sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.CHARGE,
        sourceId: result.reservation.id,
        idempotencyKey: imageCreditEventContract(
          "CHARGE",
          result.reservation.id
        ).idempotencyKey,
        metadata: null
      }
    ]);
    await expect(
      database().user.findUnique({
        where: { id: userId },
        select: { credits: true }
      })
    ).resolves.toEqual(before);
  });

  it("allows an exact quota balance and leaves zero remaining credits", async () => {
    const userId = await createQuotaUser(4);

    const result = await imageStore().createImageTaskWithReservation(
      createImageTaskInput(userId, 4)
    );

    expect(result.ok).toBe(true);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 0 });
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(1);
  });

  it("creates a zero-cost pending task without creating or changing UserQuota", async () => {
    const userId = await createUserWithoutQuota();
    const before = await database().user.findUnique({
      where: { id: userId },
      select: { credits: true }
    });

    const result = await imageStore().createImageTaskWithReservation(
      createImageTaskInput(userId, 0)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`TEST_UNEXPECTED_RESULT_${result.reason}`);
    }
    expect(result.task).toMatchObject({
      userId,
      status: "pending",
      costCredits: 0
    });
    expect(result.reservation).toMatchObject({
      userId,
      amountCredits: 0,
      status: "RESERVED",
      aiTaskId: result.task.id
    });
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toBeNull();
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().user.findUnique({
        where: { id: userId },
        select: { credits: true }
      })
    ).resolves.toEqual(before);
  });

  it("returns INSUFFICIENT_CREDITS without creating task or reservation", async () => {
    const userId = await createQuotaUser(3);

    await expect(
      imageStore().createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      )
    ).resolves.toEqual({ ok: false, reason: "INSUFFICIENT_CREDITS" });
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 3 });
    await expect(
      database().aiTask.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it("returns QUOTA_NOT_FOUND without creating quota, task, or reservation", async () => {
    const userId = await createQuotaUser();
    await database().userQuota.delete({ where: { userId } });

    await expect(
      imageStore().createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      )
    ).resolves.toEqual({ ok: false, reason: "QUOTA_NOT_FOUND" });
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toBeNull();
    await expect(
      database().aiTask.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it.each([-1, 1.5])(
    "rejects invalid amountCredits=%s before database access",
    async (amountCredits) => {
      const input = createImageTaskInput(`missing_${randomUUID()}`, amountCredits);
      await expect(
        imageStore().createImageTaskWithReservation(input)
      ).rejects.toThrow("INVALID_CREDIT_RESERVATION_AMOUNT");
    }
  );

  it.each([
    new Date("invalid"),
    new Date(0),
    new Date(1)
  ])("rejects invalid expiresAt=%s before database access", async (expiresAt) => {
    const input = createImageTaskInput(
      `missing_${randomUUID()}`,
      1,
      expiresAt
    );
    await expect(
      imageStore().createImageTaskWithReservation(input)
    ).rejects.toThrow("INVALID_CREDIT_RESERVATION_EXPIRY");
  });

  it("rejects non-image task types before database access", async () => {
    const userId = `missing_${randomUUID()}`;
    const input = {
      ...createImageTaskInput(userId, 1),
      task: {
        ...imageTaskInput(),
        type: "video"
      }
    } as unknown as CreateImageTaskWithReservationInput;

    await expect(
      imageStore().createImageTaskWithReservation(input)
    ).rejects.toThrow("INVALID_GENERATION_TASK_TYPE");
  });

  it("rolls back quota when task creation fails", async () => {
    const userId = await createQuotaUser(8);
    const failingClient = prisma?.$extends({
      query: {
        aiTask: {
          async create() {
            throw new Error("TEST_IMAGE_TASK_CREATE_FAILURE");
          }
        }
      }
    });

    if (!failingClient) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }

    const failingStore = createPrismaUserStore(
      failingClient as unknown as PrismaClient
    );
    await expect(
      failingStore.createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      )
    ).rejects.toThrow("TEST_IMAGE_TASK_CREATE_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 8 });
    await expect(
      database().aiTask.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it("rolls back quota and task when reservation creation fails", async () => {
    const userId = await createQuotaUser(8);
    const failingClient = prisma?.$extends({
      query: {
        creditReservation: {
          async create() {
            throw new Error("TEST_RESERVATION_CREATE_FAILURE");
          }
        }
      }
    });

    if (!failingClient) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }

    const failingStore = createPrismaUserStore(
      failingClient as unknown as PrismaClient
    );
    await expect(
      failingStore.createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      )
    ).rejects.toThrow("TEST_RESERVATION_CREATE_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 8 });
    await expect(
      database().aiTask.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it("rolls back quota, task, reservation, and event when charge event creation fails", async () => {
    const userId = await createQuotaUser(8);
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialCreditEventCreated(input) {
          if (input.sourceType === IMAGE_CREDIT_EVENT_SOURCE_TYPES.CHARGE) {
            throw new Error("TEST_IMAGE_CHARGE_EVENT_FAILURE");
          }
        }
      }
    });

    await expect(
      failingStore.createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      )
    ).rejects.toThrow("TEST_IMAGE_CHARGE_EVENT_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 8 });
    await expect(
      database().aiTask.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it("creates no assets, usage logs, or account ledger during reservation", async () => {
    const userId = await createQuotaUser(8);

    const result = await imageStore().createImageTaskWithReservation(
      createImageTaskInput(userId, 4)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`TEST_UNEXPECTED_RESULT_${result.reason}`);
    }
    await expect(
      database().aiAsset.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().usageLog.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountLedger.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it("allows only one concurrent reservation when quota covers one task", async () => {
    const userId = await createQuotaUser(4);
    const results = await Promise.allSettled([
      imageStore().createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      ),
      imageStore().createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      )
    ]);
    const values = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    expect(values).toHaveLength(2);
    expect(values.filter((value) => value.ok)).toHaveLength(1);
    expect(values).toContainEqual({ ok: false, reason: "INSUFFICIENT_CREDITS" });
    await expect(
      database().aiTask.count({ where: { userId } })
    ).resolves.toBe(1);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(1);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 0 });
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(1);
    await expect(
      database().user.findUnique({
        where: { id: userId },
        select: { credits: true }
      })
    ).resolves.toMatchObject({ credits: 777 });
  });

  it("creates two independent reservations when quota covers two tasks", async () => {
    const userId = await createQuotaUser(8);
    const results = await Promise.allSettled([
      imageStore().createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      ),
      imageStore().createImageTaskWithReservation(
        createImageTaskInput(userId, 4)
      )
    ]);
    const values = results.flatMap((result) =>
      result.status === "fulfilled" && result.value.ok ? [result.value] : []
    );

    expect(values).toHaveLength(2);
    expect(new Set(values.map((value) => value.task.id)).size).toBe(2);
    expect(new Set(values.map((value) => value.reservation.id)).size).toBe(2);
    for (const value of values) {
      expect(value.reservation).toMatchObject({
        userId,
        kind: "IMAGE_GENERATION",
        status: "RESERVED",
        aiTaskId: value.task.id
      });
    }
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 0 });
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(2);
  });

  it.each([
    { taskStatus: "PENDING" as const, leavePending: true },
    { taskStatus: "RUNNING" as const, leavePending: false }
  ])("settles a RESERVED image task from $taskStatus atomically", async ({
    leavePending
  }) => {
    const fixture = await createImageFixture({ leavePending });
    const before = await database().user.findUnique({
      where: { id: fixture.userId },
      select: { credits: true }
    });

    const result = await imageStore().completeImageTaskWithReservation(
      completeInput(fixture, [assetInput(fixture, "one")])
    );

    expect(result.status).toBe("UPDATED");
    expect(result.task).toMatchObject({
      id: fixture.taskId,
      status: "succeeded",
      costCredits: fixture.amountCredits,
      errorMessage: null
    });
    expect(result.assets).toHaveLength(1);
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({
      status: "SETTLED",
      aiTaskId: fixture.taskId,
      releasedAt: null
    });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
    await expect(
      database().accountCreditEvent.count({
        where: {
          userId: fixture.userId,
          idempotencyKey: imageCreditEventContract(
            "CHARGE",
            fixture.reservationId
          ).idempotencyKey
        }
      })
    ).resolves.toBe(0);
    await expect(
      database().user.findUnique({
        where: { id: fixture.userId },
        select: { credits: true }
      })
    ).resolves.toEqual(before);
  });

  it("does not create a second or zero-delta event when an atomic image settles", async () => {
    const fixture = await createAtomicImageFixture();
    const input = completeInput(fixture, [assetInput(fixture, "settled")]);

    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
    await expect(
      imageStore().completeImageTaskWithReservation(input)
    ).resolves.toMatchObject({ status: "UPDATED" });
    await expect(
      imageStore().completeImageTaskWithReservation(input)
    ).resolves.toEqual({ status: "ALREADY_COMPLETED" });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
    await expect(
      database().accountCreditEvent.findMany({
        where: { userId: fixture.userId, deltaCredits: 0 }
      })
    ).resolves.toHaveLength(0);
  });

  it("creates all image assets in the same success transaction", async () => {
    const fixture = await createImageFixture({ amountCredits: 6 });
    const assets = [assetInput(fixture, "one"), assetInput(fixture, "two")];

    const result = await imageStore().completeImageTaskWithReservation(
      completeInput(fixture, assets)
    );

    expect(result.status).toBe("UPDATED");
    expect(result.assets).toHaveLength(2);
    await expect(
      database().aiAsset.findMany({ where: { taskId: fixture.taskId } })
    ).resolves.toHaveLength(2);
  });

  it("settles partial image output with one idempotent missing-unit refund", async () => {
    const fixture = await createAtomicImageFixture(8);
    const assets = [assetInput(fixture, "one"), assetInput(fixture, "two")];
    const input = {
      ...completeInput(fixture, assets),
      refundCredits: 4
    };

    const first = await imageStore().completeImageTaskWithReservation(input);
    const replay = await imageStore().completeImageTaskWithReservation(input);

    expect(first.status).toBe("UPDATED");
    expect(first.task).toMatchObject({
      status: "succeeded",
      costCredits: 4
    });
    expect(first.assets).toHaveLength(2);
    expect(replay).toEqual({ status: "ALREADY_COMPLETED" });
    await expect(
      database().aiAsset.findMany({ where: { taskId: fixture.taskId } })
    ).resolves.toHaveLength(2);
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "SETTLED", releasedAt: null });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
    await expect(
      database().accountCreditEvent.findMany({
        where: { userId: fixture.userId },
        orderBy: { createdAt: "asc" }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.CHARGE,
          deltaCredits: -8
        }),
        expect.objectContaining({
          sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.RELEASE,
          deltaCredits: 4,
          sourceId: fixture.reservationId
        })
      ])
    );
    await expect(
      database().accountCreditEvent.count({
        where: { userId: fixture.userId }
      })
    ).resolves.toBe(2);
  });

  it("arbitrates concurrent complete and release with one consistent terminal state", async () => {
    const fixture = await createAtomicImageFixture(4);
    const idempotencyRequest = await bindInProgressImageIdempotency(fixture);
    const storageObject = await createReadyGeneratedStorageObject(fixture.userId);
    let allowCompletion: (() => void) | undefined;
    let storageObjectLocked: (() => void) | undefined;
    const completionMayContinue = new Promise<void>((resolve) => {
      allowCompletion = resolve;
    });
    const completionReachedStorageLock = new Promise<void>((resolve) => {
      storageObjectLocked = resolve;
    });
    const completingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterGeneratedStorageObjectLocked() {
          storageObjectLocked?.();
          await completionMayContinue;
        }
      }
    });

    const completePromise = completingStore.completeImageTaskWithReservation(
      storageCompletionInput(
        fixture,
        [localAssetInput(fixture, storageObject.id, 0)],
        { source: "race-complete" }
      )
    );
    await completionReachedStorageLock;
    const releasePromise = imageStore().failImageTaskAndReleaseReservation(
      failInput(fixture, "race release")
    );
    allowCompletion?.();

    const [completeResult, releaseResult] = await Promise.all([
      completePromise,
      releasePromise
    ]);
    const completeWon = completeResult.status === "UPDATED";
    const releaseWon = releaseResult.status === "UPDATED";
    const task = await database().aiTask.findUnique({
      where: { id: fixture.taskId }
    });
    const reservation = await database().creditReservation.findUnique({
      where: { id: fixture.reservationId }
    });
    const idempotency = await database().idempotencyRequest.findUnique({
      where: { id: idempotencyRequest.id }
    });
    const assetCount = await database().aiAsset.count({
      where: { taskId: fixture.taskId }
    });
    const releaseEventCount = await database().accountCreditEvent.count({
      where: {
        userId: fixture.userId,
        sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.RELEASE,
        sourceId: fixture.reservationId
      }
    });
    const quota = await database().userQuota.findUniqueOrThrow({
      where: { userId: fixture.userId }
    });

    expect(completeWon).not.toBe(releaseWon);
    expect(task).not.toBeNull();
    expect(reservation).not.toBeNull();
    expect(idempotency).not.toBeNull();
    expect(releaseEventCount).toBeLessThanOrEqual(1);
    expect(quota.remainingCredits).toBeLessThanOrEqual(20);

    if (completeWon) {
      expect(releaseResult.status).toBe("INVALID_STATE");
      expect(task).toMatchObject({ status: "SUCCEEDED", costCredits: 4 });
      expect(reservation).toMatchObject({ status: "SETTLED", releasedAt: null });
      expect(idempotency).toMatchObject({ status: "SUCCEEDED" });
      expect(assetCount).toBe(1);
      expect(releaseEventCount).toBe(0);
      expect(quota.remainingCredits).toBe(16);
    } else {
      expect(releaseResult.status).toBe("UPDATED");
      expect(task).toMatchObject({ status: "FAILED", costCredits: 0 });
      expect(reservation).toMatchObject({ status: "RELEASED", settledAt: null });
      expect(idempotency).toMatchObject({ status: "FAILED" });
      expect(assetCount).toBe(0);
      expect(releaseEventCount).toBe(1);
      expect(quota.remainingCredits).toBe(20);
    }

    const compensation = await imageStore().claimGeneratedStorageObjectForCompensation({
      userId: fixture.userId,
      storageObjectId: storageObject.id,
      now: new Date("2026-07-19T00:00:00.000Z")
    });
    if (completeWon) {
      expect(compensation).toEqual({ status: "SKIPPED_REFERENCED" });
      await expect(
        database().storageObject.findUniqueOrThrow({
          where: { id: storageObject.id }
        })
      ).resolves.toMatchObject({ status: StorageObjectStatus.READY });
    } else {
      expect(compensation).toMatchObject({
        status: "CLAIMED",
        id: storageObject.id
      });
      await expect(
        imageStore().prepareDeletedGeneratedStorageObjectForPurge(
          storageObject.id
        )
      ).resolves.toMatchObject({ status: "PREPARED" });
      await expect(
        imageStore().finalizeDeletedGeneratedStorageObjectPurge(
          storageObject.id
        )
      ).resolves.toEqual({ status: "PURGED" });
      await expect(
        database().storageObject.findUnique({ where: { id: storageObject.id } })
      ).resolves.toBeNull();
    }
  });

  it("writes a provider URL into canonical task output", async () => {
    const fixture = await createImageFixture();
    const providerAsset = externalAssetInput(fixture, "canonical-provider", 0);
    const output = {
      images: ["https://caller.example.test/stale.png"],
      mode: "text-to-image",
      size: "1024x1024",
      count: 1,
      sourceType: "provider",
      revisedPrompt: "provider revised prompt",
      model: "canonical-provider-model",
      imageUrl: "https://caller.example.test/legacy-image-url.png"
    };

    const result = await imageStore().completeImageTaskWithReservation(
      storageCompletionInput(fixture, [providerAsset], output)
    );
    if (result.status !== "UPDATED" || !result.task || !result.assets) {
      throw new Error("TEST_CANONICAL_PROVIDER_COMPLETION_MISSING");
    }

    const asset = result.assets[0];
    if (!asset) {
      throw new Error("TEST_CANONICAL_PROVIDER_ASSET_MISSING");
    }
    const expectedOutput = { ...output, images: [providerAsset.url] };
    expect(result.task.output).toEqual(expectedOutput);
    expect(result.assets.map((entry) => entry.url)).toEqual([providerAsset.url]);
    await expect(
      database().aiTask.findUniqueOrThrow({
        where: { id: fixture.taskId },
        select: { output: true }
      })
    ).resolves.toEqual({ output: expectedOutput });
    await expect(
      database().aiAsset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { url: true, storageObjectId: true }
      })
    ).resolves.toEqual({ url: providerAsset.url, storageObjectId: null });
  });

  it("replaces local caller images with the generated private content URL", async () => {
    const fixture = await createImageFixture();
    const storageObject = await createReadyGeneratedStorageObject(fixture.userId);
    const localAsset = localAssetInput(fixture, storageObject.id, 0);
    const output = {
      images: [
        "data:image/png;base64,caller-owned-image",
        "/generated-assets/caller-owned-image.png"
      ],
      mode: "text-to-image",
      size: "1024x1024",
      count: 1,
      sourceType: "local-storage",
      revisedPrompt: "local revised prompt",
      model: "canonical-local-model",
      imageUrl: "https://caller.example.test/legacy-image-url.png"
    };

    const result = await imageStore().completeImageTaskWithReservation(
      storageCompletionInput(fixture, [localAsset], output)
    );
    if (result.status !== "UPDATED" || !result.task || !result.assets) {
      throw new Error("TEST_CANONICAL_LOCAL_COMPLETION_MISSING");
    }

    const asset = result.assets[0];
    if (!asset) {
      throw new Error("TEST_CANONICAL_LOCAL_ASSET_MISSING");
    }
    const expectedUrl = `/assets/${asset.id}/content`;
    const expectedOutput = { ...output, images: [expectedUrl] };
    expect(asset.url).toBe(expectedUrl);
    expect(result.task.output).toEqual(expectedOutput);
    expect(result.task.output).not.toEqual(output);
    expect(JSON.stringify(result.task.output)).not.toContain("data:image");
    expect(JSON.stringify(result.task.output)).not.toContain("/generated-assets/");
    await expect(
      database().aiTask.findUniqueOrThrow({
        where: { id: fixture.taskId },
        select: { output: true }
      })
    ).resolves.toEqual({ output: expectedOutput });
    await expect(
      database().aiAsset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { url: true, storageObjectId: true }
      })
    ).resolves.toEqual({
      url: expectedUrl,
      storageObjectId: storageObject.id
    });
  });

  it("preserves LOCAL, EXTERNAL, LOCAL canonical order across task output and returned assets", async () => {
    const fixture = await createImageFixture();
    const [firstStorageObject, secondStorageObject] = await Promise.all([
      createReadyGeneratedStorageObject(fixture.userId),
      createReadyGeneratedStorageObject(fixture.userId)
    ]);
    const assets = [
      localAssetInput(fixture, firstStorageObject.id, 0),
      externalAssetInput(fixture, "mixed-provider", 1),
      localAssetInput(fixture, secondStorageObject.id, 2)
    ];
    const result = await imageStore().completeImageTaskWithReservation(
      storageCompletionInput(fixture, assets, {
        images: ["caller-a", "caller-b", "caller-c"],
        mode: "mixed",
        count: 3
      })
    );
    if (result.status !== "UPDATED" || !result.task || !result.assets) {
      throw new Error("TEST_CANONICAL_MIXED_COMPLETION_MISSING");
    }

    const [firstLocalAsset, providerAsset, secondLocalAsset] = result.assets;
    if (!firstLocalAsset || !providerAsset || !secondLocalAsset) {
      throw new Error("TEST_CANONICAL_MIXED_ASSETS_MISSING");
    }
    const canonicalImages = result.assets.map((asset) => asset.url);
    expect(result.task.output).toEqual({
      images: canonicalImages,
      mode: "mixed",
      count: 3
    });
    expect(canonicalImages).toEqual([
      `/assets/${firstLocalAsset.id}/content`,
      providerAsset.url,
      `/assets/${secondLocalAsset.id}/content`
    ]);
    expect(result.assets.map((asset) => asset.metadata?.imageOutputIndex)).toEqual([
      0,
      1,
      2
    ]);
    expect(result.assets).toHaveLength(3);
  });

  it("preserves the order of multiple provider URL assets", async () => {
    const fixture = await createImageFixture();
    const assets = [
      externalAssetInput(fixture, "provider-one", 0),
      externalAssetInput(fixture, "provider-two", 1),
      externalAssetInput(fixture, "provider-three", 2)
    ];
    const result = await imageStore().completeImageTaskWithReservation(
      storageCompletionInput(fixture, assets, { images: ["stale"] })
    );
    if (result.status !== "UPDATED" || !result.task || !result.assets) {
      throw new Error("TEST_CANONICAL_PROVIDER_ORDER_MISSING");
    }

    const expectedImages = assets.map((asset) => {
      if (!("url" in asset)) {
        throw new Error("TEST_PROVIDER_URL_MISSING");
      }
      return asset.url;
    });
    expect(result.assets.map((asset) => asset.url)).toEqual(expectedImages);
    expect(result.task.output).toEqual({ images: expectedImages });
  });

  it("preserves the order of multiple local generated assets", async () => {
    const fixture = await createImageFixture();
    const storageObjects = await Promise.all(
      [0, 1, 2].map(() => createReadyGeneratedStorageObject(fixture.userId))
    );
    const assets = storageObjects.map((storageObject, imageOutputIndex) =>
      localAssetInput(fixture, storageObject.id, imageOutputIndex)
    );
    const result = await imageStore().completeImageTaskWithReservation(
      storageCompletionInput(fixture, assets, { images: ["stale"] })
    );
    if (result.status !== "UPDATED" || !result.task || !result.assets) {
      throw new Error("TEST_CANONICAL_LOCAL_ORDER_MISSING");
    }

    const canonicalImages = result.assets.map((asset) => asset.url);
    expect(canonicalImages).toEqual(
      result.assets.map((asset) => `/assets/${asset.id}/content`)
    );
    expect(result.task.output).toEqual({ images: canonicalImages });
    expect(result.assets).toHaveLength(storageObjects.length);
  });

  it("rejects runtime inputs that combine a StorageObject ID with a caller URL", async () => {
    const fixture = await createImageFixture();
    const storageObject = await createReadyGeneratedStorageObject(fixture.userId);
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
      ],
      output: { images: ["https://caller.example.test/forbidden.png"] }
    };
    const complete = imageStore().completeImageTaskWithReservation;

    await expect(
      Reflect.apply(complete, imageStore(), [unsafeInput])
    ).rejects.toThrow(/^AI_ASSET_LOCAL_URL_FORBIDDEN$/u);
    await expect(
      database().aiTask.findUniqueOrThrow({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "RUNNING", output: null });
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(0);
  });

  it.each(
    [
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
          deletedAt: new Date("2200-01-01T00:00:00.000Z")
        }
      },
      {
        label: "non-generated source",
        overrides: { source: StorageObjectSource.UPLOAD }
      },
      {
        label: "non-local provider",
        overrides: { storageProvider: StorageProvider.S3_COMPATIBLE }
      },
      {
        label: "unsafe object key",
        overrides: { objectKey: "../unsafe-object-key.png" }
      }
    ] satisfies Array<{
      label: string;
      overrides: GeneratedStorageObjectOverrides;
    }>
  )("rejects an unavailable generated StorageObject: $label", async ({ overrides }) => {
    const fixture = await createImageFixture();
    const storageObject = await createReadyGeneratedStorageObject(
      fixture.userId,
      overrides
    );

    await expect(
      imageStore().completeImageTaskWithReservation(
        storageCompletionInput(
          fixture,
          [localAssetInput(fixture, storageObject.id, 0)],
          { images: ["caller-image"] }
        )
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_UNAVAILABLE$/u);
    await expect(
      database().creditReservation.findUniqueOrThrow({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "RESERVED", settledAt: null });
    await expect(
      database().aiTask.findUniqueOrThrow({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "RUNNING", output: null });
  });

  it("rejects a cross-user generated StorageObject without creating an asset", async () => {
    const fixture = await createImageFixture();
    const otherUserId = await createQuotaUser();
    const storageObject = await createReadyGeneratedStorageObject(otherUserId);

    await expect(
      imageStore().completeImageTaskWithReservation(
        storageCompletionInput(
          fixture,
          [localAssetInput(fixture, storageObject.id, 0)],
          { images: ["caller-image"] }
        )
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_UNAVAILABLE$/u);
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(0);
  });

  it("rejects duplicate or previously linked generated StorageObjects", async () => {
    const duplicateFixture = await createImageFixture();
    const duplicateObject = await createReadyGeneratedStorageObject(
      duplicateFixture.userId
    );
    await expect(
      imageStore().completeImageTaskWithReservation(
        storageCompletionInput(
          duplicateFixture,
          [
            localAssetInput(duplicateFixture, duplicateObject.id, 0),
            localAssetInput(duplicateFixture, duplicateObject.id, 1)
          ],
          { images: ["caller-a", "caller-b"] }
        )
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED$/u);

    const linkedFixture = await createImageFixture();
    const linkedObject = await createReadyGeneratedStorageObject(linkedFixture.userId);
    await database().aiAsset.create({
      data: {
        userId: linkedFixture.userId,
        type: "IMAGE",
        url: "https://assets.example.test/already-linked.png",
        storageObjectId: linkedObject.id
      }
    });
    await expect(
      imageStore().completeImageTaskWithReservation(
        storageCompletionInput(
          linkedFixture,
          [localAssetInput(linkedFixture, linkedObject.id, 0)],
          { images: ["caller-image"] }
        )
      )
    ).rejects.toThrow(/^AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED$/u);
    await expect(
      database().aiAsset.count({ where: { taskId: linkedFixture.taskId } })
    ).resolves.toBe(0);
  });

  it("rolls back task, reservation, and all assets when an AiAsset create fails", async () => {
    const fixture = await createImageFixture();
    const assets = [
      externalAssetInput(fixture, "valid-before-failure", 0),
      {
        ...externalAssetInput(fixture, "create-failure", 1),
        title: "x".repeat(1000)
      }
    ];

    await expect(
      imageStore().completeImageTaskWithReservation(
        storageCompletionInput(fixture, assets, { images: ["caller-image"] })
      )
    ).rejects.toThrow();
    await expect(
      database().creditReservation.findUniqueOrThrow({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "RESERVED", settledAt: null });
    await expect(
      database().aiTask.findUniqueOrThrow({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "RUNNING", output: null });
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(0);
  });

  it("returns NOT_FOUND for an unknown reservation", async () => {
    const fixture = await createImageFixture();

    await expect(
      imageStore().completeImageTaskWithReservation({
        ...completeInput(fixture, [assetInput(fixture, "one")]),
        reservationId: `missing_${randomUUID()}`
      })
    ).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("returns NOT_FOUND for an unknown task", async () => {
    const fixture = await createImageFixture();
    const unknownTaskId = `missing_${randomUUID()}`;

    await expect(
      imageStore().completeImageTaskWithReservation({
        ...completeInput(fixture, [assetInput(fixture, "one")]),
        taskId: unknownTaskId
      })
    ).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("returns TASK_MISMATCH when reservation and task are not paired", async () => {
    const first = await createImageFixture();
    const second = await createImageFixture();

    await expect(
      imageStore().completeImageTaskWithReservation({
        taskId: first.taskId,
        reservationId: second.reservationId,
        assets: [assetInput(first, "one")]
      })
    ).resolves.toEqual({ status: "TASK_MISMATCH" });
  });

  it("rejects a RELEASED reservation and terminal task states", async () => {
    const released = await createImageFixture();
    await expect(
      imageStore().failImageTaskAndReleaseReservation(failInput(released))
    ).resolves.toMatchObject({ status: "UPDATED" });
    await expect(
      imageStore().completeImageTaskWithReservation(
        completeInput(released, [assetInput(released, "one")])
      )
    ).resolves.toEqual({ status: "INVALID_STATE" });

    for (const taskStatus of ["FAILED", "CANCELLED"] as const) {
      const fixture = await createImageFixture({ taskStatus });
      await expect(
        imageStore().completeImageTaskWithReservation(
          completeInput(fixture, [assetInput(fixture, taskStatus)])
        )
      ).resolves.toEqual({ status: "INVALID_STATE" });
    }
  });

  it("does not create assets when success is repeated", async () => {
    const fixture = await createImageFixture();
    const input = completeInput(fixture, [assetInput(fixture, "one")]);

    await expect(
      imageStore().completeImageTaskWithReservation(input)
    ).resolves.toMatchObject({ status: "UPDATED" });
    await expect(
      imageStore().completeImageTaskWithReservation(input)
    ).resolves.toEqual({ status: "ALREADY_COMPLETED" });
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(1);
  });

  it("rolls back reservation, task, and all assets when an asset fails", async () => {
    const fixture = await createImageFixture();
    const invalidAsset = {
      ...assetInput(fixture, "invalid"),
      userId: `missing_asset_user_${randomUUID()}`
    };

    await expect(
      imageStore().completeImageTaskWithReservation(
        completeInput(fixture, [assetInput(fixture, "valid"), invalidAsset])
      )
    ).rejects.toThrow();
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "RESERVED", settledAt: null });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "RUNNING", costCredits: 0 });
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(0);
  });

  it("rolls back all success changes when the task status is no longer mutable", async () => {
    const fixture = await createImageFixture({ taskStatus: "FAILED" });

    await expect(
      imageStore().completeImageTaskWithReservation(
        completeInput(fixture, [assetInput(fixture, "one")])
      )
    ).resolves.toEqual({ status: "INVALID_STATE" });
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "RESERVED" });
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(0);
  });

  it("allows only one concurrent success and creates one asset set", async () => {
    const fixture = await createImageFixture();
    const results = await Promise.allSettled([
      imageStore().completeImageTaskWithReservation(
        completeInput(fixture, [assetInput(fixture, "one")])
      ),
      imageStore().completeImageTaskWithReservation(
        completeInput(fixture, [assetInput(fixture, "one")])
      )
    ]);
    const values = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    expect(values).toHaveLength(2);
    expect(values.filter((value) => value.status === "UPDATED")).toHaveLength(1);
    expect(
      values.some((value) => value.status === "ALREADY_COMPLETED")
    ).toBe(true);
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(1);
  });

  it("releases a RESERVED image task, refunds quota once, and does not change User.credits", async () => {
    const fixture = await createImageFixture();
    const before = await database().user.findUnique({
      where: { id: fixture.userId },
      select: { credits: true }
    });

    await expect(
      imageStore().failImageTaskAndReleaseReservation(
        failInput(fixture, "safe provider failure")
      )
    ).resolves.toMatchObject({
      status: "UPDATED",
      task: { status: "failed", costCredits: 0, errorMessage: "safe provider failure" }
    });
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({
      status: "RELEASED",
      settledAt: null
    });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
    await expect(
      database().accountCreditEvent.findMany({
        where: { userId: fixture.userId }
      })
    ).resolves.toMatchObject([
      {
        deltaCredits: fixture.amountCredits,
        balanceBefore: 16,
        balanceAfter: 20,
        sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.RELEASE,
        sourceId: fixture.reservationId,
        idempotencyKey: imageCreditEventContract(
          "RELEASE",
          fixture.reservationId
        ).idempotencyKey,
        metadata: null
      }
    ]);
    await expect(
      database().user.findUnique({
        where: { id: fixture.userId },
        select: { credits: true }
      })
    ).resolves.toEqual(before);
  });

  it("writes one charge and one release event for an atomic image failure", async () => {
    const fixture = await createAtomicImageFixture();

    await expect(
      imageStore().failImageTaskAndReleaseReservation({
        taskId: fixture.taskId,
        reservationId: fixture.reservationId,
        errorMessage: "safe provider failure"
      })
    ).resolves.toMatchObject({ status: "UPDATED" });

    const events = await database().accountCreditEvent.findMany({
      where: { userId: fixture.userId },
      orderBy: { createdAt: "asc" }
    });
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deltaCredits: -fixture.amountCredits,
          balanceBefore: 20,
          balanceAfter: 16,
          sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.CHARGE,
          sourceId: fixture.reservationId,
          idempotencyKey: imageCreditEventContract(
            "CHARGE",
            fixture.reservationId
          ).idempotencyKey,
          metadata: null
        }),
        expect.objectContaining({
          deltaCredits: fixture.amountCredits,
          balanceBefore: 16,
          balanceAfter: 20,
          sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.RELEASE,
          sourceId: fixture.reservationId,
          idempotencyKey: imageCreditEventContract(
            "RELEASE",
            fixture.reservationId
          ).idempotencyKey,
          metadata: null
        })
      ])
    );
    expect(
      imageCreditEventContract("CHARGE", fixture.reservationId).idempotencyKey
    ).not.toBe(
      imageCreditEventContract("RELEASE", fixture.reservationId).idempotencyKey
    );
  });

  it("rolls back release, quota, task, and event when release event creation fails", async () => {
    const fixture = await createAtomicImageFixture();
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialCreditEventCreated(input) {
          if (input.sourceType === IMAGE_CREDIT_EVENT_SOURCE_TYPES.RELEASE) {
            throw new Error("TEST_IMAGE_RELEASE_EVENT_FAILURE");
          }
        }
      }
    });

    await expect(
      failingStore.failImageTaskAndReleaseReservation({
        taskId: fixture.taskId,
        reservationId: fixture.reservationId,
        errorMessage: "safe provider failure"
      })
    ).rejects.toThrow("TEST_IMAGE_RELEASE_EVENT_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "RESERVED", releasedAt: null });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "RUNNING", costCredits: 0 });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("fails a zero-cost image task without creating or increasing UserQuota", async () => {
    const userId = await createUserWithoutQuota();
    const created = await imageStore().createImageTaskWithReservation(
      createImageTaskInput(userId, 0)
    );

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(`TEST_UNEXPECTED_RESULT_${created.reason}`);
    }

    await expect(
      imageStore().failImageTaskAndReleaseReservation({
        taskId: created.task.id,
        reservationId: created.reservation.id,
        errorMessage: "zero-cost image failure"
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      task: { status: "failed", costCredits: 0 }
    });
    await expect(
      database().creditReservation.findUnique({
        where: { id: created.reservation.id }
      })
    ).resolves.toMatchObject({ status: "RELEASED", amountCredits: 0 });
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toBeNull();
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it("recovers an expired zero-cost reservation without creating or increasing UserQuota", async () => withImageRecoverySweep(async () => {
    const userId = await createUserWithoutQuota();
    const before = await database().user.findUnique({
      where: { id: userId },
      select: { credits: true }
    });
    const fixtureNow = recoveryTime(-2 * 60 * 60 * 1000);
    const expiredAt = recoveryExpiredAt;
    const sweepNow = recoveryNow;

    vi.useFakeTimers({ now: fixtureNow });
    try {
      const created = await imageStore().createImageTaskWithReservation(
        createImageTaskInput(userId, 0, expiredAt)
      );

      expect(created.ok).toBe(true);
      if (!created.ok) {
        throw new Error(`TEST_UNEXPECTED_RESULT_${created.reason}`);
      }

      await expect(
        imageStore().recoverExpiredImageReservations({ now: sweepNow })
      ).resolves.toEqual({ scanned: 1, recovered: 1, skipped: 0 });

      await expect(
        database().creditReservation.findUnique({
          where: { id: created.reservation.id }
        })
      ).resolves.toMatchObject({
        status: "RELEASED",
        releasedAt: expect.any(Date),
        amountCredits: 0
      });
      await expect(
        database().userQuota.findUnique({ where: { userId } })
      ).resolves.toBeNull();
      await expect(
        database().user.findUnique({
          where: { id: userId },
          select: { credits: true }
        })
      ).resolves.toEqual(before);

      await expect(
        imageStore().recoverExpiredImageReservations({ now: sweepNow })
      ).resolves.toEqual({ scanned: 0, recovered: 0, skipped: 0 });
      await expect(
        database().creditReservation.findUnique({
          where: { id: created.reservation.id }
        })
      ).resolves.toMatchObject({ status: "RELEASED", amountCredits: 0 });
      await expect(
        database().userQuota.findUnique({ where: { userId } })
      ).resolves.toBeNull();
      await expect(
        database().user.findUnique({
          where: { id: userId },
          select: { credits: true }
        })
      ).resolves.toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  }));

  it("settles a provider-success completion failure without refunding or touching its ready orphan", async () => {
    const fixture = await createImageFixture({ amountCredits: 3 });
    const idempotencyRequest = await bindInProgressImageIdempotency(fixture);
    const storageObject = await createReadyGeneratedStorageObject(fixture.userId);
    const quotaBefore = await database().userQuota.findUniqueOrThrow({
      where: { userId: fixture.userId }
    });

    const first = await imageStore().failImageTaskAndSettleReservation({
      taskId: fixture.taskId,
      reservationId: fixture.reservationId,
      errorMessage: "图片任务完成确认失败，请稍后重试",
      idempotencyTerminal: {
        responseStatus: 500,
        responseCode: "IMAGE_TASK_COMPLETION_FAILED"
      }
    });

    expect(first).toMatchObject({
      status: "UPDATED",
      task: {
        id: fixture.taskId,
        status: "failed",
        output: null,
        costCredits: fixture.amountCredits,
        errorMessage: "图片任务完成确认失败，请稍后重试"
      }
    });
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({
      status: "SETTLED",
      settledAt: expect.any(Date),
      releasedAt: null
    });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({
      status: "FAILED",
      output: null,
      costCredits: fixture.amountCredits
    });
    await expect(
      database().idempotencyRequest.findUnique({
        where: { id: idempotencyRequest.id }
      })
    ).resolves.toMatchObject({
      status: "FAILED",
      responseStatus: 500,
      responseCode: "IMAGE_TASK_COMPLETION_FAILED",
      aiTaskId: fixture.taskId
    });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toEqual(quotaBefore);
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(0);
    await expect(
      database().storageObject.findUnique({
        where: { id: storageObject.id },
        include: { assets: true }
      })
    ).resolves.toMatchObject({
      status: "READY",
      deletedAt: null,
      assets: []
    });

    const beforeRepeat = await database().creditReservation.findUniqueOrThrow({
      where: { id: fixture.reservationId }
    });
    const second = await imageStore().failImageTaskAndSettleReservation({
      taskId: fixture.taskId,
      reservationId: fixture.reservationId,
      errorMessage: "图片任务完成确认失败，请稍后重试",
      idempotencyTerminal: {
        responseStatus: 500,
        responseCode: "IMAGE_TASK_COMPLETION_FAILED"
      }
    });

    expect(second).toEqual({ status: "ALREADY_FAILED" });
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toEqual(beforeRepeat);
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toEqual(quotaBefore);
  });

  it("keeps CHARGED_AND_FAILED charged without an image release event", async () => {
    const fixture = await createAtomicImageFixture(3);
    await bindInProgressImageIdempotency(fixture);

    await expect(
      imageStore().failImageTaskAndSettleReservation({
        taskId: fixture.taskId,
        reservationId: fixture.reservationId,
        errorMessage: "safe completion persistence failure"
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      task: { status: "failed", costCredits: 3 }
    });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 17 });
    await expect(
      database().accountCreditEvent.findMany({
        where: { userId: fixture.userId }
      })
    ).resolves.toMatchObject([
      {
        sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.CHARGE,
        deltaCredits: -3,
        sourceId: fixture.reservationId
      }
    ]);
    await expect(
      database().accountCreditEvent.count({
        where: {
          userId: fixture.userId,
          sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES.RELEASE
        }
      })
    ).resolves.toBe(0);
  });

  it("preserves a concurrent successful terminal instead of overwriting it as failed", async () => {
    const fixture = await createImageFixture({ amountCredits: 3 });
    const idempotencyRequest = await bindInProgressImageIdempotency(fixture);
    const complete = await imageStore().completeImageTaskWithReservation(
      completeInput(fixture, [assetInput(fixture, "winner")])
    );
    expect(complete.status).toBe("UPDATED");

    await expect(
      imageStore().failImageTaskAndSettleReservation({
        taskId: fixture.taskId,
        reservationId: fixture.reservationId,
        errorMessage: "图片任务完成确认失败，请稍后重试"
      })
    ).resolves.toEqual({ status: "ALREADY_COMPLETED" });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "SUCCEEDED", output: expect.any(Object) });
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "SETTLED" });
    await expect(
      database().idempotencyRequest.findUnique({
        where: { id: idempotencyRequest.id }
      })
    ).resolves.toMatchObject({ status: "SUCCEEDED", responseStatus: 200 });
    await expect(
      database().aiAsset.count({ where: { taskId: fixture.taskId } })
    ).resolves.toBe(1);
  });

  it("leaves task and idempotency untouched for a released reservation", async () => {
    const fixture = await createImageFixture({ amountCredits: 3 });
    const idempotencyRequest = await bindInProgressImageIdempotency(fixture);
    await database().creditReservation.update({
      where: { id: fixture.reservationId },
      data: { status: CreditReservationStatus.RELEASED, releasedAt: new Date() }
    });

    await expect(
      imageStore().failImageTaskAndSettleReservation({
        taskId: fixture.taskId,
        reservationId: fixture.reservationId,
        errorMessage: "图片任务完成确认失败，请稍后重试"
      })
    ).resolves.toEqual({ status: "INVALID_STATE" });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "RUNNING", output: null });
    await expect(
      database().idempotencyRequest.findUnique({
        where: { id: idempotencyRequest.id }
      })
    ).resolves.toMatchObject({ status: "IN_PROGRESS" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 17 });
  });

  it("rolls back settled failure changes when the task update fails", async () => {
    const fixture = await createImageFixture({ amountCredits: 3 });
    const idempotencyRequest = await bindInProgressImageIdempotency(fixture);
    const quotaBefore = await database().userQuota.findUniqueOrThrow({
      where: { userId: fixture.userId }
    });

    await expect(
      imageStore().failImageTaskAndSettleReservation({
        taskId: fixture.taskId,
        reservationId: fixture.reservationId,
        errorMessage: "x".repeat(70_000)
      })
    ).rejects.toThrow();
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "RESERVED", settledAt: null });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "RUNNING", output: null });
    await expect(
      database().idempotencyRequest.findUnique({
        where: { id: idempotencyRequest.id }
      })
    ).resolves.toMatchObject({ status: "IN_PROGRESS" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toEqual(quotaBefore);
  });

  it("does not refund twice on repeated failure", async () => {
    const fixture = await createImageFixture();

    await expect(
      imageStore().failImageTaskAndReleaseReservation(failInput(fixture))
    ).resolves.toMatchObject({ status: "UPDATED" });
    await expect(
      imageStore().failImageTaskAndReleaseReservation(failInput(fixture))
    ).resolves.toEqual({ status: "ALREADY_FAILED" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
  });

  it("does not refund a SETTLED reservation or a SUCCEEDED task", async () => {
    const settled = await createImageFixture();
    await expect(
      imageStore().completeImageTaskWithReservation(
        completeInput(settled, [assetInput(settled, "one")])
      )
    ).resolves.toMatchObject({ status: "UPDATED" });
    await expect(
      imageStore().failImageTaskAndReleaseReservation(failInput(settled))
    ).resolves.toEqual({ status: "INVALID_STATE" });

    const succeeded = await createImageFixture({ taskStatus: "SUCCEEDED" });
    await expect(
      imageStore().failImageTaskAndReleaseReservation(failInput(succeeded))
    ).resolves.toEqual({ status: "INVALID_STATE" });
    await expect(
      database().userQuota.findUnique({ where: { userId: succeeded.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
  });

  it("returns TASK_MISMATCH without refunding", async () => {
    const first = await createImageFixture();
    const second = await createImageFixture();

    await expect(
      imageStore().failImageTaskAndReleaseReservation({
        taskId: first.taskId,
        reservationId: second.reservationId,
        errorMessage: "must not apply"
      })
    ).resolves.toEqual({ status: "TASK_MISMATCH" });
    await expect(
      database().userQuota.findUnique({ where: { userId: second.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
  });

  it("rolls back release and task failure when quota restoration fails", async () => {
    const fixture = await createImageFixture();
    await database().userQuota.delete({ where: { userId: fixture.userId } });

    await expect(
      imageStore().failImageTaskAndReleaseReservation(failInput(fixture))
    ).rejects.toThrow("CREDIT_RESERVATION_QUOTA_NOT_FOUND");
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "RESERVED", releasedAt: null });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "RUNNING" });
  });

  it("rolls back release and quota when task update fails", async () => {
    const fixture = await createImageFixture();
    const failingClient = prisma?.$extends({
      query: {
        aiTask: {
          async updateMany() {
            throw new Error("TEST_TASK_UPDATE_FAILURE");
          }
        }
      }
    });

    if (!failingClient) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }

    const failingStore = createPrismaUserStore(failingClient as unknown as PrismaClient);
    await expect(
      failingStore.failImageTaskAndReleaseReservation(failInput(fixture))
    ).rejects.toThrow("TEST_TASK_UPDATE_FAILURE");
    await expect(
      database().creditReservation.findUnique({
        where: { id: fixture.reservationId }
      })
    ).resolves.toMatchObject({ status: "RESERVED", releasedAt: null });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
  });

  it("allows only one concurrent failure refund", async () => {
    const fixture = await createImageFixture();
    const results = await Promise.allSettled([
      imageStore().failImageTaskAndReleaseReservation(failInput(fixture)),
      imageStore().failImageTaskAndReleaseReservation(failInput(fixture))
    ]);
    const values = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    expect(values).toHaveLength(2);
    expect(values.filter((value) => value.status === "UPDATED")).toHaveLength(1);
    expect(
      values.some((value) =>
        value.status === "ALREADY_FAILED" || value.status === "ALREADY_RELEASED"
      )
    ).toBe(true);
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "FAILED" });
  });

  it("recovers an expired stale PENDING image task and refunds quota", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture({ taskStatus: "PENDING" });
    const before = await database().user.findUnique({
      where: { id: fixture.userId },
      select: { credits: true }
    });

    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ).resolves.toEqual({ scanned: 1, recovered: 1, skipped: 0 });
    await expect(
      database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
    ).resolves.toMatchObject({ status: "RELEASED" });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({
      status: "FAILED",
      errorMessage: "Image generation expired before completion"
    });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
    await expect(
      database().user.findUnique({
        where: { id: fixture.userId },
        select: { credits: true }
      })
    ).resolves.toEqual(before);
  }));

  it("recovers an expired stale RUNNING image task", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture({ taskStatus: "RUNNING" });

    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ).resolves.toEqual({ scanned: 1, recovered: 1, skipped: 0 });
    await expect(
      database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
    ).resolves.toMatchObject({ status: "RELEASED" });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "FAILED" });
  }));

  it("does not recover a reservation that has not expired", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture({
      expiresAt: recoveryTime(60 * 60 * 1000)
    });

    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ).resolves.toEqual({ scanned: 0, recovered: 0, skipped: 0 });
    await expect(
      database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
    ).resolves.toMatchObject({ status: "RESERVED" });
  }));

  it("does not recover an expired task updated within the grace window", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture({
      taskUpdatedAt: recoveryTime(-(IMAGE_RECOVERY_GRACE_MS - 60 * 1000))
    });

    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ).resolves.toEqual({ scanned: 0, recovered: 0, skipped: 0 });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
  }));

  it.each(["SUCCEEDED", "FAILED", "CANCELLED"] as const)(
    "does not recover a %s task or refund it",
    async (taskStatus) => withImageRecoverySweep(async () => {
      const fixture = await prepareRecoveryFixture({ taskStatus });

      await expect(
        imageStore().recoverExpiredImageReservations({ now: recoveryNow })
      ).resolves.toEqual({ scanned: 0, recovered: 0, skipped: 0 });
      await expect(
        database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
      ).resolves.toMatchObject({ status: "RESERVED" });
      await expect(
        database().userQuota.findUnique({ where: { userId: fixture.userId } })
      ).resolves.toMatchObject({ remainingCredits: 16 });
    })
  );

  it.each(["SETTLED", "RELEASED"] as const)(
    "does not recover a %s reservation or refund it",
    async (reservationStatus) => withImageRecoverySweep(async () => {
      const fixture = await prepareRecoveryFixture({ reservationStatus });

      await expect(
        imageStore().recoverExpiredImageReservations({ now: recoveryNow })
      ).resolves.toEqual({ scanned: 0, recovered: 0, skipped: 0 });
      await expect(
        database().userQuota.findUnique({ where: { userId: fixture.userId } })
      ).resolves.toMatchObject({ remainingCredits: 16 });
    })
  );

  it("does not recover a reservation without an aiTaskId", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture({ aiTaskId: null });

    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ).resolves.toEqual({ scanned: 0, recovered: 0, skipped: 0 });
    await expect(
      database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
    ).resolves.toMatchObject({ status: "RESERVED", aiTaskId: null });
  }));

  it("does not recover a non-image reservation", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture({
      reservationKind: "CHAT_COMPLETION"
    });

    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ).resolves.toEqual({ scanned: 0, recovered: 0, skipped: 0 });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
  }));

  it("releases a zero-cost reservation without creating UserQuota", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareZeroCostRecoveryFixture();
    const before = await database().user.findUnique({
      where: { id: fixture.userId },
      select: { credits: true }
    });

    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toBeNull();
    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ).resolves.toEqual({ scanned: 1, recovered: 1, skipped: 0 });
    await expect(
      database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
    ).resolves.toMatchObject({ status: "RELEASED", amountCredits: 0 });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "FAILED" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toBeNull();
    await expect(
      database().user.findUnique({
        where: { id: fixture.userId },
        select: { credits: true }
      })
    ).resolves.toEqual(before);
  }));

  it("uses the default two-minute grace window", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture({
      taskUpdatedAt: recoveryTime(-(IMAGE_RECOVERY_GRACE_MS + 60 * 1000))
    });

    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ).resolves.toEqual({ scanned: 1, recovered: 1, skipped: 0 });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "FAILED" });
  }));

  it("allows graceMs=0 for any stale task", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture({
      taskUpdatedAt: recoveryTime(-1000)
    });

    await expect(
      imageStore().recoverExpiredImageReservations({ now: recoveryNow, graceMs: 0 })
    ).resolves.toEqual({ scanned: 1, recovered: 1, skipped: 0 });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "FAILED" });
  }));

  it("recovers only the earliest reservations up to limit in expiresAt/id order", async () => withImageRecoverySweep(async () => {
    const fixtures = await Promise.all([
      prepareRecoveryFixture({ expiresAt: recoveryTime(-2 * 60 * 60 * 1000) }),
      prepareRecoveryFixture({ expiresAt: recoveryTime(-2 * 60 * 60 * 1000) }),
      prepareRecoveryFixture({ expiresAt: recoveryTime(-2 * 60 * 60 * 1000) })
    ]);
    const expectedRecoveredIds = fixtures
      .map((fixture) => fixture.reservationId)
      .sort()
      .slice(0, 2);

    await expect(
      imageStore().recoverExpiredImageReservations({
        now: recoveryNow,
        graceMs: 0,
        limit: 2
      })
    ).resolves.toEqual({ scanned: 2, recovered: 2, skipped: 0 });
    for (const fixture of fixtures) {
      await expect(
        database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
      ).resolves.toMatchObject({
        status: expectedRecoveredIds.includes(fixture.reservationId)
          ? "RELEASED"
          : "RESERVED"
      });
    }
  }));

  it.each([
    [new Date("invalid"), undefined, undefined, "INVALID_EXPIRED_CREDIT_RESERVATION_NOW"],
    [recoveryNow, -1, undefined, "INVALID_EXPIRED_IMAGE_RESERVATION_GRACE"],
    [recoveryNow, 15 * 60 * 1000 + 1, undefined, "INVALID_EXPIRED_IMAGE_RESERVATION_GRACE"],
    [recoveryNow, undefined, 0, "INVALID_EXPIRED_CREDIT_RESERVATION_LIMIT"],
    [recoveryNow, undefined, 1001, "INVALID_EXPIRED_CREDIT_RESERVATION_LIMIT"]
  ] as const)(
    "rejects invalid recovery input",
    async (now, graceMs, limit, errorMessage) => {
      await expect(
        imageStore().recoverExpiredImageReservations({ now, graceMs, limit })
      ).rejects.toThrow(errorMessage);
    }
  );

  it("allows only one of two concurrent recoveries to refund quota", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture();
    const results = await Promise.allSettled([
      imageStore().recoverExpiredImageReservations({ now: recoveryNow }),
      imageStore().recoverExpiredImageReservations({ now: recoveryNow })
    ]);
    const values = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(values).toHaveLength(2);
    expect(values.reduce((total, value) => total + value.recovered, 0)).toBe(1);
    expect(values.filter((value) => value.recovered === 1)).toHaveLength(1);
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
    await expect(
      database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
    ).resolves.toMatchObject({ status: "RELEASED" });
  }));

  it("converges with a concurrent ordinary image failure", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture();
    const results = await Promise.allSettled([
      imageStore().recoverExpiredImageReservations({ now: recoveryNow }),
      imageStore().failImageTaskAndReleaseReservation(
        failInput(fixture, "ordinary image failure")
      )
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    await expect(
      database().creditReservation.findUnique({ where: { id: fixture.reservationId } })
    ).resolves.toMatchObject({ status: "RELEASED" });
    await expect(
      database().aiTask.findUnique({ where: { id: fixture.taskId } })
    ).resolves.toMatchObject({ status: "FAILED" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
  }));

  it("converges with a concurrent image completion without mixed state", async () => withImageRecoverySweep(async () => {
    const fixture = await prepareRecoveryFixture();
    const results = await Promise.allSettled([
      imageStore().recoverExpiredImageReservations({ now: recoveryNow }),
      imageStore().completeImageTaskWithReservation(
        completeInput(fixture, [assetInput(fixture, "recovery-race")])
      )
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const reservation = await database().creditReservation.findUnique({
      where: { id: fixture.reservationId }
    });
    const task = await database().aiTask.findUnique({
      where: { id: fixture.taskId }
    });
    const assetCount = await database().aiAsset.count({
      where: { taskId: fixture.taskId }
    });
    const quota = await database().userQuota.findUnique({
      where: { userId: fixture.userId }
    });

    if (reservation?.status === "SETTLED" && task?.status === "SUCCEEDED") {
      expect(assetCount).toBe(1);
      expect(quota?.remainingCredits).toBe(16);
    } else {
      expect(reservation?.status).toBe("RELEASED");
      expect(task?.status).toBe("FAILED");
      expect(assetCount).toBe(0);
      expect(quota?.remainingCredits).toBe(20);
    }
  }));

  it("does not create UsageLog, AccountLedger, or another reservation", async () => {
    const fixture = await createImageFixture();
    await imageStore().completeImageTaskWithReservation(
      completeInput(fixture, [assetInput(fixture, "one")])
    );

    await expect(
      database().usageLog.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });
});
