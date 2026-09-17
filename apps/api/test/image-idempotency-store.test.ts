import { randomUUID } from "node:crypto";
import {
  IdempotencyOwnerType,
  IdempotencyRequestStatus,
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
  IDEMPOTENCY_TERMINAL_TTL_MS,
  hashIdempotencyClaimToken,
  hashIdempotencyKey,
  hashImageRequestFingerprint,
  hashUserIdempotencyOwner
} from "../src/idempotency";
import {
  IMAGE_CREDIT_EVENT_SOURCE_TYPES,
  createPrismaUserStore,
  imageCreditEventContract,
  type ClaimIdempotencyRequestInput,
  type CompleteImageTaskWithReservationInput,
  type CompleteImageTaskWithStorageObjectReservationInput,
  type CreateImageTaskWithReservationInput,
  type FailImageTaskAndSettleReservationInput,
  type FailImageTaskAndReleaseReservationInput,
  type IdempotencyTerminalMetadata,
  type ImageTaskCompletionAiAssetCreateInput,
  type ImageTaskIdempotencyClaimBinding,
  type ReadIdempotencyRequestStateInput
} from "../src/store";
import {
  acquireCrossWorkerTestLock,
  IMAGE_RECOVERY_TEST_LOCK_NAME
} from "./helpers/cross-worker-test-lock";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;
const USER_PREFIX = "s13c1a_";
const RESERVATION_EXPIRES_AT = new Date("2300-01-01T00:00:00.000Z");
const CLAIM_NOW = new Date("2030-01-01T00:00:00.000Z");
// Fixed inputs make expiration and staleness deterministic; the shared lock
// wrapper below provides cross-file isolation for the production-global recovery scan.
const C1B_RECOVERY_NOW = new Date("2200-04-01T00:00:00.000Z");
const C1B_RECOVERY_EXPIRES_AT = new Date(
  C1B_RECOVERY_NOW.getTime() - 60 * 60 * 1000
);
const C1B_RECOVERY_STALE_UPDATED_AT = new Date(
  C1B_RECOVERY_NOW.getTime() - 10 * 60 * 1000
);
databaseSuite.sequential("image idempotency Store primitives", () => {
  let prisma: PrismaClient | undefined;
  let store: ReturnType<typeof createPrismaUserStore> | undefined;
  const testScopes: string[] = [];

  function database(): PrismaClient {
    if (!prisma) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }
    return prisma;
  }

  function idempotencyStore(): ReturnType<typeof createPrismaUserStore> {
    if (!store) {
      throw new Error("TEST_STORE_NOT_INITIALIZED");
    }
    return store;
  }

  function makeScope(label = "claim"): string {
    const scope = `S13C1A:${label}:${randomUUID()}`;
    testScopes.push(scope);
    return scope;
  }

  async function createUser(remainingCredits: number | null = 20): Promise<string> {
    const userId = `${USER_PREFIX}${randomUUID()}`;
    await database().user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "test-hash",
        credits: 777,
        ...(remainingCredits === null
          ? {}
          : { quota: { create: { remainingCredits } } })
      }
    });
    return userId;
  }

  function claimInput(input: {
    scope: string;
    userId: string;
    key: string;
    fingerprint: string;
    token: string;
    now?: Date;
  }): ClaimIdempotencyRequestInput {
    return {
      scope: input.scope,
      ownerType: IdempotencyOwnerType.USER,
      ownerKeyHash: hashUserIdempotencyOwner(input.userId),
      idempotencyKeyHash: hashIdempotencyKey(input.key),
      requestFingerprint: hashImageRequestFingerprint(input.fingerprint),
      claimTokenHash: hashIdempotencyClaimToken(input.token),
      now: input.now ?? CLAIM_NOW
    };
  }

  function readInput(input: {
    scope: string;
    userId: string;
    key: string;
    fingerprint: string;
  }): ReadIdempotencyRequestStateInput {
    return {
      scope: input.scope,
      ownerType: IdempotencyOwnerType.USER,
      ownerKeyHash: hashUserIdempotencyOwner(input.userId),
      idempotencyKeyHash: hashIdempotencyKey(input.key),
      requestFingerprint: hashImageRequestFingerprint(input.fingerprint)
    };
  }

  async function acquire(input: {
    scope: string;
    userId: string;
    key?: string;
    fingerprint?: string;
    token?: string;
    now?: Date;
  }): Promise<{
    requestId: string;
    key: string;
    fingerprint: string;
    token: string;
  }> {
    const key = input.key ?? randomUUID();
    const fingerprint = input.fingerprint ?? `fingerprint:${randomUUID()}`;
    const token = input.token ?? `claim-token:${randomUUID()}`;
    const result = await idempotencyStore().claimIdempotencyRequest(
      claimInput({ ...input, key, fingerprint, token })
    );
    expect(result.status).toBe("ACQUIRED");
    if (result.status !== "ACQUIRED") {
      throw new Error(`TEST_EXPECTED_ACQUIRED_${result.status}`);
    }
    return { requestId: result.request.id, key, fingerprint, token };
  }

  function binding(
    acquired: { requestId: string; fingerprint: string; token: string },
    overrides: Partial<ImageTaskIdempotencyClaimBinding> = {}
  ): ImageTaskIdempotencyClaimBinding {
    return {
      requestId: acquired.requestId,
      requestFingerprint: hashImageRequestFingerprint(acquired.fingerprint),
      claimTokenHash: hashIdempotencyClaimToken(acquired.token),
      now: CLAIM_NOW,
      ...overrides
    };
  }

  function imageTaskInput(
    userId: string,
    amountCredits: number,
    idempotencyClaim?: ImageTaskIdempotencyClaimBinding
  ): CreateImageTaskWithReservationInput {
    return {
      userId,
      amountCredits,
      expiresAt: RESERVATION_EXPIRES_AT,
      task: {
        type: "image",
        modelId: "s13c1a-image-model",
        prompt: "private prompt must remain outside IdempotencyRequest",
        input: {
          size: "1024x1024",
          referenceImage: {
            dataUrl: "data:image/png;base64,private-reference-body"
          }
        }
      },
      ...(idempotencyClaim ? { idempotencyClaim } : {})
    };
  }

  async function expectClaimStillUnbound(
    requestId: string,
    expectedToken: string
  ): Promise<void> {
    const request = await database().idempotencyRequest.findUnique({
      where: { id: requestId }
    });
    expect(request).toMatchObject({
      status: IdempotencyRequestStatus.CLAIMED,
      aiTaskId: null
    });
    expect(Array.from(request?.claimTokenHash ?? [])).toEqual(
      Array.from(hashIdempotencyClaimToken(expectedToken))
    );
  }

  async function cleanupFixtures(): Promise<void> {
    const client = prisma;
    if (!client) {
      return;
    }
    await retryPrismaWriteConflict(async () => {
      if (testScopes.length > 0) {
        await client.idempotencyRequest.deleteMany({
          where: { scope: { in: testScopes } }
        });
      }
      await client.accountCreditEvent.deleteMany({
        where: { userId: { startsWith: USER_PREFIX } }
      });
      await client.user.deleteMany({
        where: { id: { startsWith: USER_PREFIX } }
      });
    });
    testScopes.length = 0;
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
        datasources: { db: { url: databaseUrl } }
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
    testScopes.length = 0;
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma?.$disconnect();
  });

  it("acquires the first claim without task, reservation, or quota changes", async () => {
    const scope = makeScope();
    const userId = await createUser(20);
    const result = await acquire({ scope, userId });

    await expect(
      database().idempotencyRequest.findUnique({ where: { id: result.requestId } })
    ).resolves.toMatchObject({
      scope,
      ownerType: IdempotencyOwnerType.USER,
      status: IdempotencyRequestStatus.CLAIMED,
      aiTaskId: null
    });
    await expect(database().aiTask.count({ where: { userId } })).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
  });

  it("returns IN_PROGRESS for the same fingerprint without replacing the token", async () => {
    const scope = makeScope();
    const userId = await createUser();
    const first = await acquire({ scope, userId });
    const before = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: first.requestId }
    });

    const result = await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: first.key,
        fingerprint: first.fingerprint,
        token: `replacement:${randomUUID()}`
      })
    );

    expect(result).toEqual({
      status: "IN_PROGRESS",
      request: { id: first.requestId, aiTaskId: null }
    });
    const after = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: first.requestId }
    });
    expect(after.claimTokenHash).toEqual(before.claimTokenHash);
    expect(after.claimExpiresAt).toEqual(before.claimExpiresAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("returns CONFLICT for a different fingerprint without updating the record", async () => {
    const scope = makeScope();
    const userId = await createUser();
    const first = await acquire({ scope, userId });
    const before = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: first.requestId }
    });

    await expect(
      idempotencyStore().claimIdempotencyRequest(
        claimInput({
          scope,
          userId,
          key: first.key,
          fingerprint: `different:${randomUUID()}`,
          token: `other-token:${randomUUID()}`
        })
      )
    ).resolves.toEqual({ status: "CONFLICT" });
    await expect(
      database().idempotencyRequest.findUniqueOrThrow({
        where: { id: first.requestId }
      })
    ).resolves.toEqual(before);
  });

  it("isolates the same key between different users", async () => {
    const scope = makeScope();
    const [firstUserId, secondUserId] = await Promise.all([
      createUser(),
      createUser()
    ]);
    const key = randomUUID();
    const first = await acquire({ scope, userId: firstUserId, key });
    const second = await acquire({ scope, userId: secondUserId, key });
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("isolates the same owner and key between scopes", async () => {
    const firstScope = makeScope("scope-a");
    const secondScope = makeScope("scope-b");
    const userId = await createUser();
    const key = randomUUID();
    const first = await acquire({ scope: firstScope, userId, key });
    const second = await acquire({ scope: secondScope, userId, key });
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("takes over an expired unbound claim with CAS and invalidates the old token", async () => {
    const scope = makeScope();
    const userId = await createUser();
    const first = await acquire({ scope, userId });
    await database().idempotencyRequest.update({
      where: { id: first.requestId },
      data: { claimExpiresAt: new Date(CLAIM_NOW.getTime() - 1) }
    });
    const newToken = `new-token:${randomUUID()}`;
    const takeoverNow = new Date(CLAIM_NOW.getTime() + 1);

    const result = await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: first.key,
        fingerprint: first.fingerprint,
        token: newToken,
        now: takeoverNow
      })
    );

    expect(result.status).toBe("ACQUIRED");
    const takenOver = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: first.requestId }
    });
    expect(takenOver).toMatchObject({
      aiTaskId: null,
      status: IdempotencyRequestStatus.CLAIMED
    });
    expect(Array.from(takenOver.claimTokenHash ?? [])).toEqual(
      Array.from(hashIdempotencyClaimToken(newToken))
    );
  });

  it("rejects bind by the old token after takeover without financial side effects", async () => {
    const scope = makeScope();
    const userId = await createUser(10);
    const first = await acquire({ scope, userId });
    await database().idempotencyRequest.update({
      where: { id: first.requestId },
      data: { claimExpiresAt: new Date(CLAIM_NOW.getTime() - 1) }
    });
    const newToken = `new-token:${randomUUID()}`;
    await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: first.key,
        fingerprint: first.fingerprint,
        token: newToken,
        now: CLAIM_NOW
      })
    );

    await expect(
      idempotencyStore().createImageTaskWithReservation(
        imageTaskInput(userId, 4, binding(first))
      )
    ).resolves.toEqual({ ok: false, reason: "IDEMPOTENCY_CLAIM_INVALID" });
    await expect(database().aiTask.count({ where: { userId } })).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 10 });
    await expectClaimStillUnbound(first.requestId, newToken);
  });

  it("prevents the old token from abandoning a takeover", async () => {
    const scope = makeScope();
    const userId = await createUser();
    const first = await acquire({ scope, userId });
    await database().idempotencyRequest.update({
      where: { id: first.requestId },
      data: { claimExpiresAt: new Date(CLAIM_NOW.getTime() - 1) }
    });
    const newToken = `new-token:${randomUUID()}`;
    await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: first.key,
        fingerprint: first.fingerprint,
        token: newToken,
        now: CLAIM_NOW
      })
    );

    await expect(
      idempotencyStore().abandonIdempotencyClaim({
        requestId: first.requestId,
        claimTokenHash: hashIdempotencyClaimToken(first.token)
      })
    ).resolves.toEqual({ status: "NOT_ABANDONED" });
    await expectClaimStillUnbound(first.requestId, newToken);
  });

  it("allows only one ACQUIRED result under high first-claim concurrency", async () => {
    const scope = makeScope("concurrent");
    const userId = await createUser();
    const key = randomUUID();
    const fingerprint = `fingerprint:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        idempotencyStore().claimIdempotencyRequest(
          claimInput({
            scope,
            userId,
            key,
            fingerprint,
            token: `concurrent-token-${index}-${randomUUID()}`
          })
        )
      )
    );

    expect(results.filter((result) => result.status === "ACQUIRED")).toHaveLength(1);
    expect(results.filter((result) => result.status === "IN_PROGRESS")).toHaveLength(19);
    await expect(
      database().idempotencyRequest.count({ where: { scope } })
    ).resolves.toBe(1);
  });

  it("allows only one concurrent bind for the same claim token", async () => {
    const scope = makeScope("bind");
    const userId = await createUser(8);
    const acquired = await acquire({ scope, userId });
    const results = await Promise.all([
      idempotencyStore().createImageTaskWithReservation(
        imageTaskInput(userId, 4, binding(acquired))
      ),
      idempotencyStore().createImageTaskWithReservation(
        imageTaskInput(userId, 4, binding(acquired))
      )
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual({
      ok: false,
      reason: "IDEMPOTENCY_CLAIM_INVALID"
    });
    await expect(database().aiTask.count({ where: { userId } })).resolves.toBe(1);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(1);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 4 });
    await expect(
      database().accountCreditEvent.count({ where: { userId } })
    ).resolves.toBe(1);
  });

  it("binds positive quota, task, reservation, and idempotency atomically", async () => {
    const scope = makeScope("positive");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });

    const result = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`TEST_UNEXPECTED_RESULT_${result.reason}`);
    }
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
    await expect(
      database().idempotencyRequest.findUniqueOrThrow({
        where: { id: acquired.requestId }
      })
    ).resolves.toMatchObject({
      status: IdempotencyRequestStatus.IN_PROGRESS,
      aiTaskId: result.task.id,
      claimTokenHash: null,
      claimExpiresAt: null
    });
    await expect(
      database().creditReservation.findUnique({
        where: { aiTaskId: result.task.id }
      })
    ).resolves.toMatchObject({
      status: "RESERVED",
      amountCredits: 4,
      aiTaskId: result.task.id
    });
    await expect(
      database().accountCreditEvent.findMany({ where: { userId } })
    ).resolves.toMatchObject([
      {
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
  });

  it("binds zero-cost work without reading or creating UserQuota", async () => {
    const scope = makeScope("zero");
    const userId = await createUser(null);
    const acquired = await acquire({ scope, userId });
    const quotaGuardClient = database().$extends({
      query: {
        userQuota: {
          async $allOperations() {
            throw new Error("TEST_ZERO_COST_QUOTA_ACCESS");
          }
        }
      }
    });
    const guardedStore = createPrismaUserStore(
      quotaGuardClient as unknown as PrismaClient
    );

    const result = await guardedStore.createImageTaskWithReservation(
      imageTaskInput(userId, 0, binding(acquired))
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`TEST_UNEXPECTED_RESULT_${result.reason}`);
    }
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toBeNull();
    await expect(
      database().creditReservation.findUnique({
        where: { aiTaskId: result.task.id }
      })
    ).resolves.toMatchObject({ amountCredits: 0, status: "RESERVED" });
    await expect(
      database().idempotencyRequest.findUniqueOrThrow({
        where: { id: acquired.requestId }
      })
    ).resolves.toMatchObject({
      status: IdempotencyRequestStatus.IN_PROGRESS,
      aiTaskId: result.task.id
    });
  });

  it("rolls back claim binding when credits are insufficient", async () => {
    const scope = makeScope("insufficient");
    const userId = await createUser(3);
    const acquired = await acquire({ scope, userId });

    await expect(
      idempotencyStore().createImageTaskWithReservation(
        imageTaskInput(userId, 4, binding(acquired))
      )
    ).resolves.toEqual({ ok: false, reason: "INSUFFICIENT_CREDITS" });
    await expectClaimStillUnbound(acquired.requestId, acquired.token);
    await expect(database().aiTask.count({ where: { userId } })).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 3 });
  });

  it("rolls back claim binding when quota does not exist", async () => {
    const scope = makeScope("missing-quota");
    const userId = await createUser(null);
    const acquired = await acquire({ scope, userId });

    await expect(
      idempotencyStore().createImageTaskWithReservation(
        imageTaskInput(userId, 4, binding(acquired))
      )
    ).resolves.toEqual({ ok: false, reason: "QUOTA_NOT_FOUND" });
    await expectClaimStillUnbound(acquired.requestId, acquired.token);
    await expect(database().aiTask.count({ where: { userId } })).resolves.toBe(0);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it("rejects an expired claim before quota or task side effects", async () => {
    const scope = makeScope("expired");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const expiredNow = new Date(CLAIM_NOW.getTime() + 120_001);

    await expect(
      idempotencyStore().createImageTaskWithReservation(
        imageTaskInput(
          userId,
          4,
          binding(acquired, { now: expiredNow })
        )
      )
    ).resolves.toEqual({ ok: false, reason: "IDEMPOTENCY_CLAIM_INVALID" });
    await expectClaimStillUnbound(acquired.requestId, acquired.token);
    await expect(database().aiTask.count({ where: { userId } })).resolves.toBe(0);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 10 });
  });

  it.each(["fingerprint", "token", "owner"] as const)(
    "rejects %s mismatch without financial or task side effects",
    async (mismatch) => {
      const scope = makeScope(`mismatch-${mismatch}`);
      const ownerUserId = await createUser(10);
      const otherUserId = mismatch === "owner" ? await createUser(10) : ownerUserId;
      const acquired = await acquire({ scope, userId: ownerUserId });
      const mismatchedBinding = binding(acquired, {
        ...(mismatch === "fingerprint"
          ? { requestFingerprint: hashImageRequestFingerprint("other-fingerprint") }
          : {}),
        ...(mismatch === "token"
          ? { claimTokenHash: hashIdempotencyClaimToken("other-claim-token") }
          : {})
      });

      await expect(
        idempotencyStore().createImageTaskWithReservation(
          imageTaskInput(otherUserId, 4, mismatchedBinding)
        )
      ).resolves.toEqual({ ok: false, reason: "IDEMPOTENCY_CLAIM_INVALID" });
      await expectClaimStillUnbound(acquired.requestId, acquired.token);
      await expect(
        database().aiTask.count({
          where: { userId: { in: [ownerUserId, otherUserId] } }
        })
      ).resolves.toBe(0);
      await expect(
        database().creditReservation.count({
          where: { userId: { in: [ownerUserId, otherUserId] } }
        })
      ).resolves.toBe(0);
    }
  );

  it.each(["task", "reservation", "idempotency"] as const)(
    "rolls back quota, task, reservation, and claim when %s write fails",
    async (failurePoint) => {
      const scope = makeScope(`failure-${failurePoint}`);
      const userId = await createUser(10);
      const acquired = await acquire({ scope, userId });
      const failingClient = database().$extends({
        query: {
          aiTask: {
            async create({ args, query }) {
              if (failurePoint === "task") {
                throw new Error("TEST_TASK_CREATE_FAILURE");
              }
              return query(args);
            }
          },
          creditReservation: {
            async create({ args, query }) {
              if (failurePoint === "reservation") {
                throw new Error("TEST_RESERVATION_CREATE_FAILURE");
              }
              return query(args);
            }
          },
          idempotencyRequest: {
            async updateMany({ args, query }) {
              const data = args.data as Record<string, unknown>;
              if (failurePoint === "idempotency" && "aiTaskId" in data) {
                throw new Error("TEST_IDEMPOTENCY_BIND_FAILURE");
              }
              return query(args);
            }
          }
        }
      });
      const failingStore = createPrismaUserStore(
        failingClient as unknown as PrismaClient
      );

      await expect(
        failingStore.createImageTaskWithReservation(
          imageTaskInput(userId, 4, binding(acquired))
        )
      ).rejects.toThrow(
        failurePoint === "task"
          ? "TEST_TASK_CREATE_FAILURE"
          : failurePoint === "reservation"
            ? "TEST_RESERVATION_CREATE_FAILURE"
            : "TEST_IDEMPOTENCY_BIND_FAILURE"
      );
      await expectClaimStillUnbound(acquired.requestId, acquired.token);
      await expect(
        database().userQuota.findUnique({ where: { userId } })
      ).resolves.toMatchObject({ remainingCredits: 10 });
      await expect(database().aiTask.count({ where: { userId } })).resolves.toBe(0);
      await expect(
        database().creditReservation.count({ where: { userId } })
      ).resolves.toBe(0);
    }
  );

  it("abandons only the current unbound claim and makes repeats no-op", async () => {
    const scope = makeScope("abandon");
    const userId = await createUser();
    const acquired = await acquire({ scope, userId });

    await expect(
      idempotencyStore().abandonIdempotencyClaim({
        requestId: acquired.requestId,
        claimTokenHash: hashIdempotencyClaimToken("wrong-token")
      })
    ).resolves.toEqual({ status: "NOT_ABANDONED" });
    await expect(
      idempotencyStore().abandonIdempotencyClaim({
        requestId: acquired.requestId,
        claimTokenHash: hashIdempotencyClaimToken(acquired.token)
      })
    ).resolves.toEqual({ status: "ABANDONED" });
    await expect(
      idempotencyStore().abandonIdempotencyClaim({
        requestId: acquired.requestId,
        claimTokenHash: hashIdempotencyClaimToken(acquired.token)
      })
    ).resolves.toEqual({ status: "NOT_ABANDONED" });
  });

  it("does not abandon bound or terminal records", async () => {
    const boundScope = makeScope("bound");
    const terminalScope = makeScope("terminal");
    const userId = await createUser(20);
    const bound = await acquire({ scope: boundScope, userId });
    const terminal = await acquire({ scope: terminalScope, userId });
    const boundResult = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(bound))
    );
    expect(boundResult.ok).toBe(true);
    await database().idempotencyRequest.update({
      where: { id: terminal.requestId },
      data: { status: IdempotencyRequestStatus.FAILED }
    });

    for (const request of [bound, terminal]) {
      await expect(
        idempotencyStore().abandonIdempotencyClaim({
          requestId: request.requestId,
          claimTokenHash: hashIdempotencyClaimToken(request.token)
        })
      ).resolves.toEqual({ status: "NOT_ABANDONED" });
    }
  });

  it.each([
    {
      status: IdempotencyRequestStatus.SUCCEEDED,
      responseStatus: 200,
      responseCode: "IMAGE_GENERATED"
    },
    {
      status: IdempotencyRequestStatus.FAILED,
      responseStatus: 502,
      responseCode: "IMAGE_PROVIDER_FAILED"
    }
  ])("replays safe $status terminal metadata without hashes", async (terminal) => {
    const scope = makeScope("terminal-replay");
    const userId = await createUser();
    const acquired = await acquire({ scope, userId });
    const completedAt = new Date("2030-01-02T00:00:00.000Z");
    const expiresAt = new Date("2030-01-03T00:00:00.000Z");
    await database().idempotencyRequest.update({
      where: { id: acquired.requestId },
      data: { ...terminal, completedAt, expiresAt, claimTokenHash: null }
    });

    const replay = await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: acquired.key,
        fingerprint: acquired.fingerprint,
        token: `unused:${randomUUID()}`
      })
    );

    expect(replay.status).toBe(terminal.status);
    if (replay.status !== "SUCCEEDED" && replay.status !== "FAILED") {
      throw new Error(`TEST_EXPECTED_TERMINAL_${replay.status}`);
    }
    expect(replay.request).toEqual({
      id: acquired.requestId,
      aiTaskId: null,
      responseStatus: terminal.responseStatus,
      responseCode: terminal.responseCode,
      expiresAt,
      completedAt
    });
    expect(replay.request).not.toHaveProperty("ownerKeyHash");
    expect(replay.request).not.toHaveProperty("idempotencyKeyHash");
    expect(replay.request).not.toHaveProperty("requestFingerprint");
    expect(replay.request).not.toHaveProperty("claimTokenHash");
  });

  it("propagates unrelated P2002 errors instead of treating all unique conflicts as claims", async () => {
    const scope = makeScope("wrong-p2002");
    const userId = await createUser();
    const unrelatedError = new Prisma.PrismaClientKnownRequestError(
      "TEST_UNRELATED_UNIQUE_CONFLICT",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: "IdempotencyRequest_aiTaskId_key" }
      }
    );
    const failingClient = database().$extends({
      query: {
        idempotencyRequest: {
          async create() {
            throw unrelatedError;
          }
        }
      }
    });
    const failingStore = createPrismaUserStore(
      failingClient as unknown as PrismaClient
    );

    await expect(
      failingStore.claimIdempotencyRequest(
        claimInput({
          scope,
          userId,
          key: randomUUID(),
          fingerprint: "fingerprint",
          token: "claim-token"
        })
      )
    ).rejects.toBe(unrelatedError);
  });

  it("keeps the original non-idempotent createImageTaskWithReservation behavior", async () => {
    const userId = await createUser(10);
    const result = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4)
    );

    expect(result.ok).toBe(true);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
    await expect(database().aiTask.count({ where: { userId } })).resolves.toBe(1);
    await expect(
      database().creditReservation.count({ where: { userId } })
    ).resolves.toBe(1);
  });

  it("stores only hashes and metadata in IdempotencyRequest", async () => {
    const scope = makeScope("no-raw");
    const userId = await createUser(10);
    const rawKey = randomUUID();
    const rawToken = `raw-claim-token:${randomUUID()}`;
    const acquired = await acquire({
      scope,
      userId,
      key: rawKey,
      token: rawToken
    });
    const result = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    expect(result.ok).toBe(true);
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    const serialized = JSON.stringify(record);

    expect(Object.keys(record).sort()).toEqual(
      [
        "aiTaskId",
        "claimExpiresAt",
        "claimTokenHash",
        "completedAt",
        "createdAt",
        "expiresAt",
        "id",
        "idempotencyKeyHash",
        "ownerKeyHash",
        "ownerType",
        "requestFingerprint",
        "responseCode",
        "responseStatus",
        "scope",
        "status",
        "updatedAt"
      ].sort()
    );
    expect(serialized).not.toContain(rawKey);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("private-reference-body");
    expect(record.ownerKeyHash).toHaveLength(32);
    expect(record.idempotencyKeyHash).toHaveLength(32);
    expect(record.requestFingerprint).toHaveLength(32);
  });

  it("rejects the reserved GUEST owner type without database writes", async () => {
    const scope = makeScope("guest");
    const userId = await createUser();
    const input = claimInput({
      scope,
      userId,
      key: randomUUID(),
      fingerprint: "fingerprint",
      token: "claim-token"
    });

    await expect(
      idempotencyStore().claimIdempotencyRequest({
        ...input,
        ownerType: IdempotencyOwnerType.GUEST
      })
    ).rejects.toThrow("UNSUPPORTED_IDEMPOTENCY_OWNER_TYPE");
    await expect(
      database().idempotencyRequest.count({ where: { scope } })
    ).resolves.toBe(0);
  });

  function completeInput(
    userId: string,
    taskId: string,
    reservationId: string,
    completedAt?: Date
  ): CompleteImageTaskWithReservationInput {
    return {
      taskId,
      reservationId,
      ...(completedAt !== undefined ? { completedAt } : {}),
      assets: [
        {
          userId,
          taskId: null,
          type: "image",
          url: `https://example.com/c1b/${randomUUID()}.png`,
          thumbnailUrl: null,
          title: "c1b-asset"
        }
      ]
    };
  }

  async function createReadyGeneratedStorageObject(userId: string) {
    return database().storageObject.create({
      data: {
        userId,
        storageProvider: StorageProvider.LOCAL,
        objectKey: `images/2300/01/${randomUUID()}.png`,
        mimeType: "image/png",
        sizeBytes: 128n,
        sha256: "b".repeat(64),
        source: StorageObjectSource.GENERATED,
        status: StorageObjectStatus.READY,
        deletedAt: null
      }
    });
  }

  function canonicalCompletionInput(input: {
    userId: string;
    taskId: string;
    reservationId: string;
    assets: ImageTaskCompletionAiAssetCreateInput[];
    output: Record<string, unknown>;
  }): CompleteImageTaskWithStorageObjectReservationInput {
    return {
      taskId: input.taskId,
      reservationId: input.reservationId,
      assets: input.assets,
      output: input.output
    };
  }

  function failInput(
    taskId: string,
    reservationId: string,
    idempotencyTerminal?: IdempotencyTerminalMetadata
  ): FailImageTaskAndReleaseReservationInput {
    return {
      taskId,
      reservationId,
      errorMessage: "C1b test failure",
      ...(idempotencyTerminal !== undefined ? { idempotencyTerminal } : {})
    };
  }

  function settledFailureInput(
    taskId: string,
    reservationId: string
  ): FailImageTaskAndSettleReservationInput {
    return {
      taskId,
      reservationId,
      errorMessage: "图片任务完成确认失败，请稍后重试",
      idempotencyTerminal: {
        responseStatus: 500,
        responseCode: "IMAGE_TASK_COMPLETION_FAILED"
      }
    };
  }

  it("C1b: complete writes Idempotency terminal SUCCEEDED atomically with reservation/task/assets", async () => {
    const scope = makeScope("c1b-complete");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const result = await idempotencyStore().completeImageTaskWithReservation(
      completeInput(userId, bind.task.id, bind.reservation.id)
    );

    expect(result.status).toBe("UPDATED");
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.SUCCEEDED);
    expect(record.responseStatus).toBe(200);
    expect(record.responseCode).toBeNull();
    expect(record.completedAt).not.toBeNull();
    expect(record.expiresAt).not.toBeNull();
    expect(
      record.expiresAt!.getTime() - record.completedAt!.getTime()
    ).toBe(IDEMPOTENCY_TERMINAL_TTL_MS);
    expect(record.aiTaskId).toBe(bind.task.id);
    expect(record.claimTokenHash).toBeNull();
    expect(record.claimExpiresAt).toBeNull();
    await expect(
      database().creditReservation.findUnique({
        where: { id: bind.reservation.id }
      })
    ).resolves.toMatchObject({ status: "SETTLED" });
    await expect(
      database().aiTask.findUnique({ where: { id: bind.task.id } })
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(
      database().aiAsset.count({ where: { taskId: bind.task.id } })
    ).resolves.toBe(1);
  });

  it("C1b: fail writes Idempotency terminal FAILED with default 500/null atomically with refund", async () => {
    const scope = makeScope("c1b-fail");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const result = await idempotencyStore().failImageTaskAndReleaseReservation(
      failInput(bind.task.id, bind.reservation.id)
    );

    expect(result.status).toBe("UPDATED");
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.FAILED);
    expect(record.responseStatus).toBe(500);
    expect(record.responseCode).toBeNull();
    expect(record.completedAt).not.toBeNull();
    expect(record.expiresAt).not.toBeNull();
    expect(
      record.expiresAt!.getTime() - record.completedAt!.getTime()
    ).toBe(IDEMPOTENCY_TERMINAL_TTL_MS);
    expect(record.aiTaskId).toBe(bind.task.id);
    expect(record.claimTokenHash).toBeNull();
    expect(record.claimExpiresAt).toBeNull();
    await expect(
      database().creditReservation.findUnique({
        where: { id: bind.reservation.id }
      })
    ).resolves.toMatchObject({ status: "RELEASED" });
    await expect(
      database().aiTask.findUnique({ where: { id: bind.task.id } })
    ).resolves.toMatchObject({ status: "FAILED" });
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 10 });
  });

  it("C1b: fail accepts caller-provided safe responseStatus/responseCode", async () => {
    const scope = makeScope("c1b-fail-custom");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const result = await idempotencyStore().failImageTaskAndReleaseReservation(
      failInput(bind.task.id, bind.reservation.id, {
        responseStatus: 502,
        responseCode: "IMAGE_PROVIDER_FAILED"
      })
    );

    expect(result.status).toBe("UPDATED");
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.FAILED);
    expect(record.responseStatus).toBe(502);
    expect(record.responseCode).toBe("IMAGE_PROVIDER_FAILED");
  });

  it("C1b: reject invalid responseStatus before any side effect", async () => {
    const scope = makeScope("c1b-bad-status");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    for (const bad of [399, 600, 200.5, NaN, "500", null]) {
      await expect(
        idempotencyStore().failImageTaskAndReleaseReservation(
          failInput(bind.task.id, bind.reservation.id, {
            responseStatus: bad as unknown as number
          })
        )
      ).rejects.toThrow("INVALID_IDEMPOTENCY_RESPONSE_STATUS");
    }

    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.IN_PROGRESS);
    await expect(
      database().creditReservation.findUnique({
        where: { id: bind.reservation.id }
      })
    ).resolves.toMatchObject({ status: "RESERVED" });
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
  });

  it("C1b: reject invalid responseCode before any side effect", async () => {
    const scope = makeScope("c1b-bad-code");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    for (const bad of [
      "",
      "lower",
      "WITH-HYPHEN",
      "WITH SPACE",
      "WITH.DOT",
      "A".repeat(65),
      123
    ]) {
      await expect(
        idempotencyStore().failImageTaskAndReleaseReservation(
          failInput(bind.task.id, bind.reservation.id, {
            responseCode: bad as unknown as string
          })
        )
      ).rejects.toThrow("INVALID_IDEMPOTENCY_RESPONSE_CODE");
    }

    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.IN_PROGRESS);
  });

  it("C1b: accept null responseCode and 400/599 boundary responseStatus", async () => {
    const scope400 = makeScope("c1b-400");
    const scope599 = makeScope("c1b-599");
    const userId400 = await createUser(10);
    const userId599 = await createUser(10);

    for (const [scope, userId, status, code] of [
      [scope400, userId400, 400, null],
      [scope599, userId599, 599, null]
    ] as const) {
      const acquired = await acquire({ scope, userId });
      const bind = await idempotencyStore().createImageTaskWithReservation(
        imageTaskInput(userId, 4, binding(acquired))
      );
      if (!bind.ok) {
        throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
      }

      const result = await idempotencyStore().failImageTaskAndReleaseReservation(
        failInput(bind.task.id, bind.reservation.id, {
          responseStatus: status,
          responseCode: code
        })
      );
      expect(result.status).toBe("UPDATED");
      const record = await database().idempotencyRequest.findUniqueOrThrow({
        where: { id: acquired.requestId }
      });
      expect(record.responseStatus).toBe(status);
      expect(record.responseCode).toBeNull();
    }
  });

  it("C1b: reject invalid completedAt before any side effect", async () => {
    const scope = makeScope("c1b-bad-completed");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const invalidDate = new Date("not-a-date");
    await expect(
      idempotencyStore().failImageTaskAndReleaseReservation(
        failInput(bind.task.id, bind.reservation.id, {
          completedAt: invalidDate
        })
      )
    ).rejects.toThrow("INVALID_IDEMPOTENCY_COMPLETED_AT");

    await expect(
      idempotencyStore().completeImageTaskWithReservation(
        completeInput(userId, bind.task.id, bind.reservation.id, invalidDate)
      )
    ).rejects.toThrow("INVALID_IDEMPOTENCY_COMPLETED_AT");

    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.IN_PROGRESS);
  });

  it("C1b: complete/fail on a task without IdempotencyRequest leave no record behind", async () => {
    const userId = await createUser(10);
    const create = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4)
    );
    if (!create.ok) {
      throw new Error(`TEST_UNEXPECTED_CREATE_${create.reason}`);
    }

    const complete = await idempotencyStore().completeImageTaskWithReservation(
      completeInput(userId, create.task.id, create.reservation.id)
    );
    expect(complete.status).toBe("UPDATED");
    await expect(
      database().idempotencyRequest.count({ where: { aiTaskId: create.task.id } })
    ).resolves.toBe(0);

    const create2 = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4)
    );
    if (!create2.ok) {
      throw new Error(`TEST_UNEXPECTED_CREATE2_${create2.reason}`);
    }
    const fail = await idempotencyStore().failImageTaskAndReleaseReservation(
      failInput(create2.task.id, create2.reservation.id)
    );
    expect(fail.status).toBe("UPDATED");
    await expect(
      database().idempotencyRequest.count({ where: { aiTaskId: create2.task.id } })
    ).resolves.toBe(0);
  });

  it("C1b: complete repeated does not rewrite Idempotency terminal fields", async () => {
    const scope = makeScope("c1b-replay");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const first = await idempotencyStore().completeImageTaskWithReservation(
      completeInput(userId, bind.task.id, bind.reservation.id)
    );
    expect(first.status).toBe("UPDATED");
    const terminal = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    const originalCompletedAt = terminal.completedAt;
    const originalExpiresAt = terminal.expiresAt;

    const second = await idempotencyStore().completeImageTaskWithReservation(
      completeInput(userId, bind.task.id, bind.reservation.id)
    );
    expect(second.status).toBe("ALREADY_COMPLETED");
    const replay = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(replay.completedAt).toEqual(originalCompletedAt);
    expect(replay.expiresAt).toEqual(originalExpiresAt);
    expect(replay.responseStatus).toBe(terminal.responseStatus);
    expect(replay.responseCode).toBe(terminal.responseCode);
  });

  it("C1c: persists canonical local and provider image URLs once across a status-only replay", async () => {
    const scope = makeScope("c1c-canonical-replay");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const [firstStorageObject, secondStorageObject] = await Promise.all([
      createReadyGeneratedStorageObject(userId),
      createReadyGeneratedStorageObject(userId)
    ]);
    const assets: ImageTaskCompletionAiAssetCreateInput[] = [
      {
        userId,
        taskId: bind.task.id,
        type: "image",
        storageObjectId: firstStorageObject.id,
        metadata: { imageOutputIndex: 0, source: "local-a" }
      },
      {
        userId,
        taskId: bind.task.id,
        type: "image",
        url: "https://assets.example.test/idempotency-provider.png",
        metadata: { imageOutputIndex: 1, source: "provider-b" }
      },
      {
        userId,
        taskId: bind.task.id,
        type: "image",
        storageObjectId: secondStorageObject.id,
        metadata: { imageOutputIndex: 2, source: "local-c" }
      }
    ];
    const input = canonicalCompletionInput({
      userId,
      taskId: bind.task.id,
      reservationId: bind.reservation.id,
      assets,
      output: {
        images: ["caller-a", "caller-b", "caller-c"],
        mode: "mixed",
        size: "1024x1024",
        count: 3,
        sourceType: "idempotency",
        revisedPrompt: "canonical replay prompt",
        model: "s13c1a-image-model",
        imageUrl: "https://caller.example.test/legacy-image-url.png"
      }
    });

    const first = await idempotencyStore().completeImageTaskWithReservation(input);
    if (first.status !== "UPDATED" || !first.task || !first.assets) {
      throw new Error("TEST_CANONICAL_IDEMPOTENCY_COMPLETION_MISSING");
    }

    const [firstLocalAsset, providerAsset, secondLocalAsset] = first.assets;
    if (!firstLocalAsset || !providerAsset || !secondLocalAsset) {
      throw new Error("TEST_CANONICAL_IDEMPOTENCY_ASSETS_MISSING");
    }
    const canonicalImages = first.assets.map((asset) => asset.url);
    const expectedOutput = {
      ...input.output,
      images: canonicalImages
    };
    expect(canonicalImages).toEqual([
      `/assets/${firstLocalAsset.id}/content`,
      "https://assets.example.test/idempotency-provider.png",
      `/assets/${secondLocalAsset.id}/content`
    ]);
    expect(first.task.output).toEqual(expectedOutput);
    expect(first.assets.map((asset) => asset.metadata?.imageOutputIndex)).toEqual([
      0,
      1,
      2
    ]);

    const [taskBefore, assetsBefore, storageBefore, terminalBefore] =
      await Promise.all([
        database().aiTask.findUniqueOrThrow({
          where: { id: bind.task.id },
          select: { output: true }
        }),
        database().aiAsset.findMany({
          where: { taskId: bind.task.id },
          select: { id: true, url: true, storageObjectId: true, metadata: true }
        }),
        database().storageObject.findMany({
          where: { id: { in: [firstStorageObject.id, secondStorageObject.id] } },
          select: { id: true, status: true, updatedAt: true }
        }),
        database().idempotencyRequest.findUniqueOrThrow({
          where: { id: acquired.requestId },
          select: { status: true, completedAt: true, expiresAt: true }
        })
      ]);
    expect(taskBefore.output).toEqual(expectedOutput);
    expect(assetsBefore).toHaveLength(3);
    const persistedAssetsInCompletionOrder = first.assets.map((asset) => {
      const persisted = assetsBefore.find((entry) => entry.id === asset.id);
      if (!persisted) {
        throw new Error("TEST_CANONICAL_IDEMPOTENCY_PERSISTED_ASSET_MISSING");
      }
      return {
        id: persisted.id,
        url: persisted.url,
        storageObjectId: persisted.storageObjectId
      };
    });
    expect(persistedAssetsInCompletionOrder).toEqual([
      {
        id: firstLocalAsset.id,
        url: firstLocalAsset.url,
        storageObjectId: firstStorageObject.id
      },
      {
        id: providerAsset.id,
        url: providerAsset.url,
        storageObjectId: null
      },
      {
        id: secondLocalAsset.id,
        url: secondLocalAsset.url,
        storageObjectId: secondStorageObject.id
      }
    ]);

    const second = await idempotencyStore().completeImageTaskWithReservation(input);
    expect(second).toEqual({ status: "ALREADY_COMPLETED" });

    const [taskAfter, assetsAfter, storageAfter, terminalAfter] =
      await Promise.all([
        database().aiTask.findUniqueOrThrow({
          where: { id: bind.task.id },
          select: { output: true }
        }),
        database().aiAsset.findMany({
          where: { taskId: bind.task.id },
          select: { id: true, url: true, storageObjectId: true, metadata: true }
        }),
        database().storageObject.findMany({
          where: { id: { in: [firstStorageObject.id, secondStorageObject.id] } },
          select: { id: true, status: true, updatedAt: true }
        }),
        database().idempotencyRequest.findUniqueOrThrow({
          where: { id: acquired.requestId },
          select: { status: true, completedAt: true, expiresAt: true }
        })
      ]);
    expect(taskAfter).toEqual(taskBefore);
    expect(
      assetsAfter.sort((left, right) => left.id.localeCompare(right.id))
    ).toEqual(assetsBefore.sort((left, right) => left.id.localeCompare(right.id)));
    expect(
      storageAfter.sort((left, right) => left.id.localeCompare(right.id))
    ).toEqual(storageBefore.sort((left, right) => left.id.localeCompare(right.id)));
    expect(terminalAfter).toEqual(terminalBefore);
    await expect(
      database().aiAsset.count({ where: { storageObjectId: firstStorageObject.id } })
    ).resolves.toBe(1);
    await expect(
      database().aiAsset.count({ where: { storageObjectId: secondStorageObject.id } })
    ).resolves.toBe(1);
  });

  it("C1b: recoverExpiredImageReservations writes 500/IMAGE_GENERATION_EXPIRED terminal", async () => withImageRecoverySweep(async () => {
    const scope = makeScope("c1b-recovery");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    await database().aiTask.update({
      where: { id: bind.task.id },
      data: { updatedAt: C1B_RECOVERY_STALE_UPDATED_AT }
    });
    await database().creditReservation.update({
      where: { id: bind.reservation.id },
      data: { expiresAt: C1B_RECOVERY_EXPIRES_AT }
    });

    const result = await idempotencyStore().recoverExpiredImageReservations({
      now: C1B_RECOVERY_NOW,
      graceMs: 0
    });
    expect(result.recovered).toBeGreaterThanOrEqual(1);

    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.FAILED);
    expect(record.responseStatus).toBe(500);
    expect(record.responseCode).toBe("IMAGE_GENERATION_EXPIRED");
    await expect(
      database().creditReservation.findUnique({
        where: { id: bind.reservation.id }
      })
    ).resolves.toMatchObject({ status: "RELEASED" });
    await expect(
      database().aiTask.findUnique({ where: { id: bind.task.id } })
    ).resolves.toMatchObject({ status: "FAILED" });
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 10 });
  }));

  it("C1b: zero-cost complete writes Idempotency terminal without touching quota", async () => {
    const scope = makeScope("c1b-zero-complete");
    const userId = await createUser(null);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 0, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const result = await idempotencyStore().completeImageTaskWithReservation(
      completeInput(userId, bind.task.id, bind.reservation.id)
    );
    expect(result.status).toBe("UPDATED");
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.SUCCEEDED);
    expect(record.responseStatus).toBe(200);
    expect(record.responseCode).toBeNull();
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toBeNull();
  });

  it("C1b: zero-cost fail writes Idempotency terminal without touching quota", async () => {
    const scope = makeScope("c1b-zero-fail");
    const userId = await createUser(null);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 0, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const result = await idempotencyStore().failImageTaskAndReleaseReservation(
      failInput(bind.task.id, bind.reservation.id, {
        responseStatus: 422,
        responseCode: "VALIDATION_FAILED"
      })
    );
    expect(result.status).toBe("UPDATED");
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.FAILED);
    expect(record.responseStatus).toBe(422);
    expect(record.responseCode).toBe("VALIDATION_FAILED");
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toBeNull();
  });

  it("C1b: AiTask deletion with terminal SUCCEEDED record is replay-safe", async () => {
    const scope = makeScope("c1b-delete-succ");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }
    const complete = await idempotencyStore().completeImageTaskWithReservation(
      completeInput(userId, bind.task.id, bind.reservation.id)
    );
    expect(complete.status).toBe("UPDATED");

    await database().aiTask.delete({ where: { id: bind.task.id } });
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.aiTaskId).toBeNull();
    expect(record.status).toBe(IdempotencyRequestStatus.SUCCEEDED);

    const replay = await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: acquired.key,
        fingerprint: acquired.fingerprint,
        token: `unused:${randomUUID()}`
      })
    );
    expect(replay.status).toBe(IdempotencyRequestStatus.SUCCEEDED);
    if (replay.status !== IdempotencyRequestStatus.SUCCEEDED) {
      throw new Error("TEST_EXPECTED_SUCCEEDED_REPLAY");
    }
    expect(replay.request.aiTaskId).toBeNull();
    expect(replay.request.responseStatus).toBe(200);
    expect(replay.request.responseCode).toBeNull();

    const conflict = await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: acquired.key,
        fingerprint: `different:${randomUUID()}`,
        token: `other:${randomUUID()}`
      })
    );
    expect(conflict).toEqual({ status: "CONFLICT" });
  });

  it("C1b: AiTask deletion with terminal FAILED record is replay-safe", async () => {
    const scope = makeScope("c1b-delete-fail");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }
    const fail = await idempotencyStore().failImageTaskAndReleaseReservation(
      failInput(bind.task.id, bind.reservation.id, {
        responseStatus: 502,
        responseCode: "IMAGE_PROVIDER_FAILED"
      })
    );
    expect(fail.status).toBe("UPDATED");

    await database().aiTask.delete({ where: { id: bind.task.id } });
    const replay = await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: acquired.key,
        fingerprint: acquired.fingerprint,
        token: `unused:${randomUUID()}`
      })
    );
    expect(replay.status).toBe(IdempotencyRequestStatus.FAILED);
    if (replay.status !== IdempotencyRequestStatus.FAILED) {
      throw new Error("TEST_EXPECTED_FAILED_REPLAY");
    }
    expect(replay.request.responseStatus).toBe(502);
    expect(replay.request.responseCode).toBe("IMAGE_PROVIDER_FAILED");
  });

  it("terminalizes completion persistence failure as FAILED and replays it without another claim", async () => {
    const scope = makeScope("c-fail");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }
    await idempotencyStore().markAiTaskRunning(bind.task.id);

    const first = await idempotencyStore().failImageTaskAndSettleReservation(
      settledFailureInput(bind.task.id, bind.reservation.id)
    );

    expect(first).toMatchObject({
      status: "UPDATED",
      task: {
        id: bind.task.id,
        status: "failed",
        output: null,
        costCredits: 4,
        errorMessage: "图片任务完成确认失败，请稍后重试"
      }
    });
    await expect(
      database().creditReservation.findUnique({
        where: { id: bind.reservation.id }
      })
    ).resolves.toMatchObject({ status: "SETTLED", releasedAt: null });
    const terminalBeforeRepeat =
      await database().idempotencyRequest.findUniqueOrThrow({
        where: { id: acquired.requestId }
      });
    expect(terminalBeforeRepeat).toMatchObject({
      status: IdempotencyRequestStatus.FAILED,
      responseStatus: 500,
      responseCode: "IMAGE_TASK_COMPLETION_FAILED",
      aiTaskId: bind.task.id
    });

    await expect(
      idempotencyStore().readIdempotencyRequestState(
        readInput({
          scope,
          userId,
          key: acquired.key,
          fingerprint: acquired.fingerprint
        })
      )
    ).resolves.toMatchObject({
      status: "FAILED",
      responseStatus: 500,
      responseCode: "IMAGE_TASK_COMPLETION_FAILED",
      taskId: bind.task.id
    });
    const replay = await idempotencyStore().claimIdempotencyRequest(
      claimInput({
        scope,
        userId,
        key: acquired.key,
        fingerprint: acquired.fingerprint,
        token: `completion-settled-failure-replay:${randomUUID()}`
      })
    );
    expect(replay.status).toBe(IdempotencyRequestStatus.FAILED);

    await expect(
      idempotencyStore().failImageTaskAndSettleReservation(
        settledFailureInput(bind.task.id, bind.reservation.id)
      )
    ).resolves.toEqual({ status: "ALREADY_FAILED" });
    await expect(
      database().idempotencyRequest.findUnique({
        where: { id: acquired.requestId }
      })
    ).resolves.toEqual(terminalBeforeRepeat);
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
  });

  it("does not overwrite a SUCCEEDED idempotency terminal with settled failure", async () => {
    const scope = makeScope("c-win");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    await expect(
      idempotencyStore().completeImageTaskWithReservation(
        completeInput(userId, bind.task.id, bind.reservation.id)
      )
    ).resolves.toMatchObject({ status: "UPDATED" });
    await expect(
      idempotencyStore().failImageTaskAndSettleReservation(
        settledFailureInput(bind.task.id, bind.reservation.id)
      )
    ).resolves.toEqual({ status: "ALREADY_COMPLETED" });
    await expect(
      database().idempotencyRequest.findUnique({
        where: { id: acquired.requestId }
      })
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
      responseStatus: 200,
      responseCode: null
    });
  });

  it("C1b: complete and fail are mutually exclusive on terminal", async () => {
    const scope = makeScope("c1b-race");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const [a, b] = await Promise.all([
      idempotencyStore().completeImageTaskWithReservation(
        completeInput(userId, bind.task.id, bind.reservation.id)
      ),
      idempotencyStore().failImageTaskAndReleaseReservation(
        failInput(bind.task.id, bind.reservation.id, {
          responseStatus: 502,
          responseCode: "IMAGE_PROVIDER_FAILED"
        })
      )
    ]);

    const updatedStatuses = [a.status, b.status].filter(
      (status) => status === "UPDATED"
    );
    expect(updatedStatuses).toHaveLength(1);
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    if (a.status === "UPDATED") {
      expect(record.status).toBe(IdempotencyRequestStatus.SUCCEEDED);
      expect(record.responseStatus).toBe(200);
    } else {
      expect(record.status).toBe(IdempotencyRequestStatus.FAILED);
      expect(record.responseStatus).toBe(502);
      expect(record.responseCode).toBe("IMAGE_PROVIDER_FAILED");
    }
  });

  it("C1b: multiple recovery attempts only refund once and do not rewrite terminal", async () => withImageRecoverySweep(async () => {
    const scope = makeScope("c1b-rb-race");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }
    await database().aiTask.update({
      where: { id: bind.task.id },
      data: { updatedAt: C1B_RECOVERY_STALE_UPDATED_AT }
    });
    await database().creditReservation.update({
      where: { id: bind.reservation.id },
      data: { expiresAt: C1B_RECOVERY_EXPIRES_AT }
    });

    const first = await idempotencyStore().recoverExpiredImageReservations({
      now: C1B_RECOVERY_NOW,
      graceMs: 0
    });
    expect(first.recovered).toBe(1);

    const second = await idempotencyStore().recoverExpiredImageReservations({
      now: C1B_RECOVERY_NOW,
      graceMs: 0
    });
    const totalRecovered = first.recovered + second.recovered;
    expect(totalRecovered).toBe(1);

    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 10 });
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.FAILED);
    expect(record.responseStatus).toBe(500);
    expect(record.responseCode).toBe("IMAGE_GENERATION_EXPIRED");
  }));

  it("C1b: complete rolls back reservation/task/assets when terminal update fails", async () => {
    const scope = makeScope("c1b-rb-complete");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const failingClient = database().$extends({
      query: {
        idempotencyRequest: {
          async updateMany({ args, query }) {
            const data = args.data as Record<string, unknown>;
            if ("status" in data && data.status === "SUCCEEDED") {
              throw new Error("TEST_TERMINAL_UPDATE_FAILURE");
            }
            return query(args);
          }
        }
      }
    });
    const failingStore = createPrismaUserStore(
      failingClient as unknown as PrismaClient
    );

    await expect(
      failingStore.completeImageTaskWithReservation(
        completeInput(userId, bind.task.id, bind.reservation.id)
      )
    ).rejects.toThrow("TEST_TERMINAL_UPDATE_FAILURE");

    const reservation = await database().creditReservation.findUniqueOrThrow({
      where: { id: bind.reservation.id }
    });
    expect(reservation.status).toBe("RESERVED");
    const task = await database().aiTask.findUniqueOrThrow({
      where: { id: bind.task.id }
    });
    expect(task.status).toBe("PENDING");
    expect(await database().aiAsset.count({ where: { taskId: bind.task.id } })).toBe(0);
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.IN_PROGRESS);
  });

  it("C1b: fail rolls back refund/task when terminal update fails", async () => {
    const scope = makeScope("c1b-rollback-fail");
    const userId = await createUser(10);
    const acquired = await acquire({ scope, userId });
    const bind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(acquired))
    );
    if (!bind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bind.reason}`);
    }

    const failingClient = database().$extends({
      query: {
        idempotencyRequest: {
          async updateMany({ args, query }) {
            const data = args.data as Record<string, unknown>;
            if ("status" in data && data.status === "FAILED") {
              throw new Error("TEST_FAIL_TERMINAL_FAILURE");
            }
            return query(args);
          }
        }
      }
    });
    const failingStore = createPrismaUserStore(
      failingClient as unknown as PrismaClient
    );

    await expect(
      failingStore.failImageTaskAndReleaseReservation(
        failInput(bind.task.id, bind.reservation.id)
      )
    ).rejects.toThrow("TEST_FAIL_TERMINAL_FAILURE");

    const reservation = await database().creditReservation.findUniqueOrThrow({
      where: { id: bind.reservation.id }
    });
    expect(reservation.status).toBe("RESERVED");
    const task = await database().aiTask.findUniqueOrThrow({
      where: { id: bind.task.id }
    });
    expect(task.status).toBe("PENDING");
    await expect(
      database().userQuota.findUnique({ where: { userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
    const record = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(record.status).toBe(IdempotencyRequestStatus.IN_PROGRESS);
  });

  it("C1c-BE1.5: returns NOT_FOUND and maps CLAIMED/IN_PROGRESS without takeover", async () => {
    const missingScope = makeScope("c1c-be15-missing");
    const claimedScope = makeScope("c1c-be15-claimed");
    const userId = await createUser(10);
    const missingInput = readInput({
      scope: missingScope,
      userId,
      key: randomUUID(),
      fingerprint: `fingerprint:${randomUUID()}`
    });
    await expect(
      idempotencyStore().readIdempotencyRequestState(missingInput)
    ).resolves.toEqual({ status: "NOT_FOUND" });

    const claimed = await acquire({ scope: claimedScope, userId });
    const claimedInput = readInput({
      scope: claimedScope,
      userId,
      key: claimed.key,
      fingerprint: claimed.fingerprint
    });
    await expect(
      idempotencyStore().readIdempotencyRequestState(claimedInput)
    ).resolves.toEqual({
      status: "IN_PROGRESS",
      requestId: claimed.requestId,
      taskId: null
    });
    await expect(
      idempotencyStore().readIdempotencyRequestState({
        ...claimedInput,
        requestFingerprint: hashImageRequestFingerprint(`different:${randomUUID()}`)
      })
    ).resolves.toEqual({ status: "CONFLICT" });

    const bound = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(claimed))
    );
    if (!bound.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${bound.reason}`);
    }
    await expect(
      idempotencyStore().readIdempotencyRequestState(claimedInput)
    ).resolves.toEqual({
      status: "IN_PROGRESS",
      requestId: claimed.requestId,
      taskId: bound.task.id
    });
    await expect(
      idempotencyStore().readIdempotencyRequestState({
        ...claimedInput,
        requestFingerprint: hashImageRequestFingerprint(`different:${randomUUID()}`)
      })
    ).resolves.toEqual({ status: "CONFLICT" });
  });

  it("C1c-BE1.5: returns only safe persisted terminal metadata", async () => {
    const userId = await createUser(20);
    const succeededScope = makeScope("c1c-be15-succeeded");
    const failedScope = makeScope("c1c-be15-failed");
    const failedNullScope = makeScope("c1c-be15-failed-null");
    const completedAt = new Date("2030-02-01T00:00:00.000Z");

    const succeeded = await acquire({ scope: succeededScope, userId });
    const succeededBind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(succeeded))
    );
    if (!succeededBind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${succeededBind.reason}`);
    }
    await expect(
      idempotencyStore().completeImageTaskWithReservation(
        completeInput(
          userId,
          succeededBind.task.id,
          succeededBind.reservation.id,
          completedAt
        )
      )
    ).resolves.toMatchObject({ status: "UPDATED" });
    const succeededRead = await idempotencyStore().readIdempotencyRequestState(
      readInput({
        scope: succeededScope,
        userId,
        key: succeeded.key,
        fingerprint: succeeded.fingerprint
      })
    );
    expect(succeededRead).toEqual({
      status: "SUCCEEDED",
      requestId: succeeded.requestId,
      taskId: succeededBind.task.id,
      responseStatus: 200,
      responseCode: null,
      completedAt,
      expiresAt: new Date(completedAt.getTime() + IDEMPOTENCY_TERMINAL_TTL_MS)
    });

    const failed = await acquire({ scope: failedScope, userId });
    const failedBind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(failed))
    );
    if (!failedBind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${failedBind.reason}`);
    }
    await expect(
      idempotencyStore().failImageTaskAndReleaseReservation(
        failInput(failedBind.task.id, failedBind.reservation.id, {
          responseStatus: 502,
          responseCode: "IMAGE_PROVIDER_FAILED",
          completedAt
        })
      )
    ).resolves.toMatchObject({ status: "UPDATED" });
    await expect(
      idempotencyStore().readIdempotencyRequestState(
        readInput({
          scope: failedScope,
          userId,
          key: failed.key,
          fingerprint: failed.fingerprint
        })
      )
    ).resolves.toEqual({
      status: "FAILED",
      requestId: failed.requestId,
      taskId: failedBind.task.id,
      responseStatus: 502,
      responseCode: "IMAGE_PROVIDER_FAILED",
      completedAt,
      expiresAt: new Date(completedAt.getTime() + IDEMPOTENCY_TERMINAL_TTL_MS)
    });

    const failedNull = await acquire({ scope: failedNullScope, userId });
    const failedNullBind =
      await idempotencyStore().createImageTaskWithReservation(
        imageTaskInput(userId, 4, binding(failedNull))
      );
    if (!failedNullBind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${failedNullBind.reason}`);
    }
    await expect(
      idempotencyStore().failImageTaskAndReleaseReservation(
        failInput(failedNullBind.task.id, failedNullBind.reservation.id, {
          responseStatus: 500,
          responseCode: null,
          completedAt
        })
      )
    ).resolves.toMatchObject({ status: "UPDATED" });
    const failedNullRead = await idempotencyStore().readIdempotencyRequestState(
      readInput({
        scope: failedNullScope,
        userId,
        key: failedNull.key,
        fingerprint: failedNull.fingerprint
      })
    );
    expect(failedNullRead).toMatchObject({
      status: "FAILED",
      responseStatus: 500,
      responseCode: null
    });
    expect(failedNullRead).not.toHaveProperty("ownerKeyHash");
    expect(failedNullRead).not.toHaveProperty("idempotencyKeyHash");
    expect(failedNullRead).not.toHaveProperty("requestFingerprint");
    expect(failedNullRead).not.toHaveProperty("claimTokenHash");

    await expect(
      idempotencyStore().readIdempotencyRequestState({
        ...readInput({
          scope: succeededScope,
          userId,
          key: succeeded.key,
          fingerprint: succeeded.fingerprint
        }),
        requestFingerprint: hashImageRequestFingerprint(`different:${randomUUID()}`)
      })
    ).resolves.toEqual({ status: "CONFLICT" });
  });

  it("C1c-BE1.5: preserves terminal metadata after linked task deletion", async () => {
    const userId = await createUser(20);
    const completedAt = new Date("2030-02-02T00:00:00.000Z");

    const succeededScope = makeScope("c1c-be15-del-s");
    const succeeded = await acquire({ scope: succeededScope, userId });
    const succeededBind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(succeeded))
    );
    if (!succeededBind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${succeededBind.reason}`);
    }
    await idempotencyStore().completeImageTaskWithReservation(
      completeInput(
        userId,
        succeededBind.task.id,
        succeededBind.reservation.id,
        completedAt
      )
    );
    await database().aiTask.delete({ where: { id: succeededBind.task.id } });
    await expect(
      idempotencyStore().readIdempotencyRequestState(
        readInput({
          scope: succeededScope,
          userId,
          key: succeeded.key,
          fingerprint: succeeded.fingerprint
        })
      )
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
      taskId: null,
      responseStatus: 200,
      responseCode: null,
      completedAt
    });

    const failedScope = makeScope("c1c-be15-del-f");
    const failed = await acquire({ scope: failedScope, userId });
    const failedBind = await idempotencyStore().createImageTaskWithReservation(
      imageTaskInput(userId, 4, binding(failed))
    );
    if (!failedBind.ok) {
      throw new Error(`TEST_UNEXPECTED_BIND_${failedBind.reason}`);
    }
    await idempotencyStore().failImageTaskAndReleaseReservation(
      failInput(failedBind.task.id, failedBind.reservation.id, {
        responseStatus: 503,
        responseCode: "IMAGE_PROVIDER_FAILED",
        completedAt
      })
    );
    await database().aiTask.delete({ where: { id: failedBind.task.id } });
    await expect(
      idempotencyStore().readIdempotencyRequestState(
        readInput({
          scope: failedScope,
          userId,
          key: failed.key,
          fingerprint: failed.fingerprint
        })
      )
    ).resolves.toMatchObject({
      status: "FAILED",
      taskId: null,
      responseStatus: 503,
      responseCode: "IMAGE_PROVIDER_FAILED",
      completedAt
    });
  });

  it("C1c-BE1.5: expired CLAIMED reads remain stable and absolutely read-only", async () => {
    const scope = makeScope("c1c-be15-read-only");
    const userId = await createUser();
    const acquired = await acquire({ scope, userId });
    await database().idempotencyRequest.update({
      where: { id: acquired.requestId },
      data: { claimExpiresAt: new Date(CLAIM_NOW.getTime() - 1) }
    });
    const before = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    const readOnlyStore = idempotencyStore();
    const input = readInput({
      scope,
      userId,
      key: acquired.key,
      fingerprint: acquired.fingerprint
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        readOnlyStore.readIdempotencyRequestState(input)
      )
    );
    expect(results).toEqual(
      Array.from({ length: 20 }, () => ({
        status: "IN_PROGRESS",
        requestId: acquired.requestId,
        taskId: null
      }))
    );
    const after = await database().idempotencyRequest.findUniqueOrThrow({
      where: { id: acquired.requestId }
    });
    expect(after).toEqual(before);
    await expect(
      database().idempotencyRequest.count({ where: { scope } })
    ).resolves.toBe(1);
  });

  it("C1c-BE1.5: rejects malformed persisted terminal metadata with a static error", async () => {
    const userId = await createUser();
    const completedAt = new Date("2030-02-03T00:00:00.000Z");
    const expiresAt = new Date(completedAt.getTime() + IDEMPOTENCY_TERMINAL_TTL_MS);
    const succeededCodeScope = makeScope("c1c-bad-s-code");
    const succeededStatusScope = makeScope("c1c-bad-s-status");
    const failedStatusScope = makeScope("c1c-bad-f-status");

    const succeededCode = await acquire({ scope: succeededCodeScope, userId });
    await database().idempotencyRequest.update({
      where: { id: succeededCode.requestId },
      data: {
        status: IdempotencyRequestStatus.SUCCEEDED,
        responseStatus: 200,
        responseCode: "UNSAFE_TERMINAL_CODE",
        completedAt,
        expiresAt
      }
    });
    await expect(
      idempotencyStore().readIdempotencyRequestState(
        readInput({
          scope: succeededCodeScope,
          userId,
          key: succeededCode.key,
          fingerprint: succeededCode.fingerprint
        })
      )
    ).rejects.toMatchObject({ message: "INVALID_IDEMPOTENCY_TERMINAL_STATE" });

    const succeededStatus = await acquire({
      scope: succeededStatusScope,
      userId
    });
    await database().idempotencyRequest.update({
      where: { id: succeededStatus.requestId },
      data: {
        status: IdempotencyRequestStatus.SUCCEEDED,
        responseStatus: 201,
        responseCode: null,
        completedAt,
        expiresAt
      }
    });
    await expect(
      idempotencyStore().readIdempotencyRequestState(
        readInput({
          scope: succeededStatusScope,
          userId,
          key: succeededStatus.key,
          fingerprint: succeededStatus.fingerprint
        })
      )
    ).rejects.toMatchObject({ message: "INVALID_IDEMPOTENCY_TERMINAL_STATE" });

    const failedStatus = await acquire({ scope: failedStatusScope, userId });
    await database().idempotencyRequest.update({
      where: { id: failedStatus.requestId },
      data: {
        status: IdempotencyRequestStatus.FAILED,
        responseStatus: 399,
        responseCode: null,
        completedAt,
        expiresAt
      }
    });
    await expect(
      idempotencyStore().readIdempotencyRequestState(
        readInput({
          scope: failedStatusScope,
          userId,
          key: failedStatus.key,
          fingerprint: failedStatus.fingerprint
        })
      )
    ).rejects.toMatchObject({ message: "INVALID_IDEMPOTENCY_TERMINAL_STATE" });
  });

  it("C1c-BE1.5: rejects invalid read inputs with existing static errors", async () => {
    const scope = makeScope("c1c-be15-invalid");
    const userId = await createUser();
    const input = readInput({
      scope,
      userId,
      key: randomUUID(),
      fingerprint: `fingerprint:${randomUUID()}`
    });

    await expect(
      idempotencyStore().readIdempotencyRequestState({ ...input, scope: "" })
    ).rejects.toThrow("INVALID_IDEMPOTENCY_SCOPE");
    await expect(
      idempotencyStore().readIdempotencyRequestState({
        ...input,
        ownerType: IdempotencyOwnerType.GUEST
      })
    ).rejects.toThrow("UNSUPPORTED_IDEMPOTENCY_OWNER_TYPE");
    await expect(
      idempotencyStore().readIdempotencyRequestState({
        ...input,
        requestFingerprint: new Uint8Array(31)
      })
    ).rejects.toThrow("INVALID_IDEMPOTENCY_REQUEST_FINGERPRINT");
    await expect(
      database().idempotencyRequest.count({ where: { scope } })
    ).resolves.toBe(0);
  });
});
