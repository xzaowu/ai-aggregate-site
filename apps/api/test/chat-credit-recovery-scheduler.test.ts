import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { randomUUID } from "node:crypto";
import {
  CreditReservationKind,
  PrismaClient
} from "@prisma/client";
import {
  createPrismaUserStore,
  type ChatCreditReservationKind,
  type ChatCreditRecoveryStore,
  type RecoverExpiredChatReservationsResult
} from "../src/store";
import {
  createChatCreditRecoveryService,
  createChatCreditRecoveryServiceFromEnv,
  type ChatCreditRecoveryLogger,
  type ChatCreditRecoveryTimer
} from "../src/recovery/chat-credit-recovery-scheduler";
import {
  acquireCrossWorkerTestLock,
  IMAGE_RECOVERY_TEST_LOCK_NAME
} from "./helpers/cross-worker-test-lock";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const recoveryNow = new Date("2031-07-28T01:00:00.000Z");
const databaseUrl = process.env.DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;
const fixtureUserPrefix = "s5d3e1_";

function emptyResult(): RecoverExpiredChatReservationsResult {
  return { scanned: 0, settled: 0, released: 0, skipped: 0, failed: 0 };
}

function createLogger(): ChatCreditRecoveryLogger & {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn(), error: vi.fn() };
}

function createRecoveryHarness(
  store: ChatCreditRecoveryStore = {
    recoverExpiredChatReservations: vi.fn(async () => emptyResult())
  },
  options: Partial<Parameters<typeof createChatCreditRecoveryService>[0]> = {}
) {
  const logger = createLogger();
  const service = createChatCreditRecoveryService({
    store,
    logger,
    now: () => new Date("2031-07-28T01:00:00.000Z"),
    ...options
  });
  return { service, logger, store };
}

function createTimerHarness() {
  let callback: (() => void) | undefined;
  const handle = { unref: vi.fn() } as unknown as NodeJS.Timeout;
  const timer: ChatCreditRecoveryTimer = {
    setInterval: vi.fn((nextCallback: () => void, _intervalMs: number) => {
      callback = nextCallback;
      return handle;
    }),
    clearInterval: vi.fn()
  };
  return { callback: () => callback?.(), handle, timer };
}

describe("chat credit recovery scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs once with the D3B bounded query contract and safe aggregate logging", async () => {
    const store: ChatCreditRecoveryStore = {
      recoverExpiredChatReservations: vi.fn(async () => ({
        scanned: 4,
        settled: 1,
        released: 2,
        skipped: 1,
        failed: 0
      }))
    };
    const { service, logger } = createRecoveryHarness(store, { batchLimit: 25 });

    await expect(service.runOnce()).resolves.toMatchObject({
      status: "COMPLETED",
      result: { scanned: 4, settled: 1, released: 2, skipped: 1, failed: 0 }
    });
    expect(store.recoverExpiredChatReservations).toHaveBeenCalledWith({
      now: recoveryNow,
      limit: 25
    });
    const fields = logger.info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fields).toMatchObject({
      event: "chat-credit-recovery-completed",
      scanned: 4,
      settled: 1,
      released: 2,
      skipped: 1,
      failed: 0
    });
    expect(JSON.stringify(fields)).not.toContain("userId");
    expect(JSON.stringify(fields)).not.toContain("DATABASE_URL");
  });

  it("is explicit-run-only when no interval is frozen", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { service, store } = createRecoveryHarness();

    service.start();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(store.recoverExpiredChatReservations).not.toHaveBeenCalled();
    await service.runOnce();
    expect(store.recoverExpiredChatReservations).toHaveBeenCalledTimes(1);
  });

  it("validates optional scheduling and batch inputs", () => {
    for (const intervalMs of [0, -1, 1.5, Number.NaN, 86_400_001]) {
      expect(() =>
        createRecoveryHarness(undefined, { intervalMs }).service
      ).toThrow("INVALID_CHAT_CREDIT_RECOVERY_INTERVAL_MS");
    }
    for (const batchLimit of [0, -1, 1.5, Number.NaN, 1001]) {
      expect(() =>
        createRecoveryHarness(undefined, { batchLimit }).service
      ).toThrow("INVALID_CHAT_CREDIT_RECOVERY_BATCH_LIMIT");
    }
  });

  it("keeps scheduling explicitly disabled when the env is missing or empty", async () => {
    const timer = createTimerHarness();
    const store: ChatCreditRecoveryStore = {
      recoverExpiredChatReservations: vi.fn(async () => emptyResult())
    };

    for (const rawIntervalMs of [undefined, ""]) {
      const service = createChatCreditRecoveryServiceFromEnv({
        env: { CHAT_CREDIT_RECOVERY_INTERVAL_MS: rawIntervalMs },
        store,
        logger: createLogger(),
        timer: timer.timer
      });
      service.start();
      await service.close();
    }

    expect(timer.timer.setInterval).not.toHaveBeenCalled();
    expect(store.recoverExpiredChatReservations).not.toHaveBeenCalled();
  });

  it("starts one unrefed timer with the configured interval and frozen batch default", async () => {
    const timer = createTimerHarness();
    const store: ChatCreditRecoveryStore = {
      recoverExpiredChatReservations: vi.fn(async () => emptyResult())
    };
    const service = createChatCreditRecoveryServiceFromEnv({
      env: { CHAT_CREDIT_RECOVERY_INTERVAL_MS: "60000" },
      store,
      logger: createLogger(),
      now: () => new Date(recoveryNow),
      timer: timer.timer
    });

    service.start();
    service.start();
    expect(timer.timer.setInterval).toHaveBeenCalledTimes(1);
    expect(timer.timer.setInterval).toHaveBeenCalledWith(expect.any(Function), 60000);
    expect(timer.handle.unref).toHaveBeenCalledTimes(1);

    timer.callback();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.recoverExpiredChatReservations).toHaveBeenCalledWith({
      now: recoveryNow,
      limit: 100
    });

    await service.close();
    timer.callback();
    expect(store.recoverExpiredChatReservations).toHaveBeenCalledTimes(1);
    expect(timer.timer.clearInterval).toHaveBeenCalledTimes(1);
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "not-a-number",
    "9007199254740992",
    "60000.5"
  ])("rejects an invalid configured interval without echoing %s", (rawIntervalMs) => {
    const error = (() => {
      try {
        createChatCreditRecoveryServiceFromEnv({
          env: { CHAT_CREDIT_RECOVERY_INTERVAL_MS: rawIntervalMs },
          store: {
            recoverExpiredChatReservations: vi.fn(async () => emptyResult())
          },
          logger: createLogger()
        });
      } catch (caught) {
        return caught;
      }
      throw new Error("EXPECTED_INVALID_INTERVAL");
    })();

    expect(error).toEqual(new TypeError("INVALID_CHAT_CREDIT_RECOVERY_INTERVAL_MS"));
    expect(String(error)).not.toContain(rawIntervalMs);
  });

  it("prevents overlapping runs and lets the next run proceed", async () => {
    let resolveRun: (() => void) | undefined;
    let callCount = 0;
    const store: ChatCreditRecoveryStore = {
      recoverExpiredChatReservations: vi.fn(
        () => {
          callCount += 1;
          if (callCount > 1) return Promise.resolve(emptyResult());
          return new Promise<RecoverExpiredChatReservationsResult>((resolve) => {
            resolveRun = () => resolve(emptyResult());
          });
        }
      )
    };
    const { service } = createRecoveryHarness(store);

    const first = service.runOnce();
    await expect(service.runOnce()).resolves.toEqual({
      status: "SKIPPED",
      reason: "RUN_IN_PROGRESS"
    });
    resolveRun?.();
    await expect(first).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(service.runOnce()).resolves.toMatchObject({ status: "COMPLETED" });
    expect(store.recoverExpiredChatReservations).toHaveBeenCalledTimes(2);
  });

  it("uses an unrefed explicit timer and stop prevents later runs", async () => {
    vi.useFakeTimers({ now: recoveryNow });
    const handle = setInterval(() => undefined, 60_000);
    const unref = vi.spyOn(handle, "unref");
    let callback: (() => void) | undefined;
    const timer: ChatCreditRecoveryTimer = {
      setInterval: vi.fn((nextCallback) => {
        callback = nextCallback;
        return handle;
      }),
      clearInterval: vi.fn((timerToClear) => clearInterval(timerToClear))
    };
    const store: ChatCreditRecoveryStore = {
      recoverExpiredChatReservations: vi.fn(async () => emptyResult())
    };
    const { service } = createRecoveryHarness(store, {
      intervalMs: 100,
      timer
    });

    service.start();
    service.start();
    expect(timer.setInterval).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
    callback?.();
    await vi.runAllTicks();
    expect(store.recoverExpiredChatReservations).toHaveBeenCalledTimes(1);
    await service.stop();
    callback?.();
    await expect(service.runOnce()).resolves.toEqual({
      status: "SKIPPED",
      reason: "SERVICE_STOPPED"
    });
    expect(timer.clearInterval).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it("contains a whole-run Store failure with a fixed safe code", async () => {
    const logger = createLogger();
    const store: ChatCreditRecoveryStore = {
      recoverExpiredChatReservations: vi.fn(async () => {
        throw new Error("DATABASE_URL=mysql://secret; raw database canary");
      })
    };
    const service = createChatCreditRecoveryService({
      store,
      logger,
      now: () => new Date("2031-07-28T01:00:00.000Z")
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      status: "FAILED",
      result: { failed: 1 }
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("raw database canary");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "chat-credit-recovery-failed",
        errorCode: "CHAT_CREDIT_RECOVERY_FAILED"
      }),
      "chat credit recovery failed"
    );
  });
});

databaseSuite.sequential("chat credit recovery Store", () => {
  let prisma: PrismaClient | undefined;
  let store: ReturnType<typeof createPrismaUserStore> | undefined;

  function database(): PrismaClient {
    if (!prisma) throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    return prisma;
  }

  function recoveryStore(): ReturnType<typeof createPrismaUserStore> {
    if (!store) throw new Error("TEST_STORE_NOT_INITIALIZED");
    return store;
  }

  async function createFixture(remainingCredits = 100): Promise<{ userId: string }> {
    const userId = `${fixtureUserPrefix}${randomUUID()}`;
    await database().user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "test-hash",
        quota: { create: { remainingCredits } }
      }
    });
    return { userId };
  }

  async function reserveExpired(
    userId: string,
    input: Partial<{
      kind: ChatCreditReservationKind;
      creditCost: number;
      expiresAt: Date;
      requestId: string;
    }> = {}
  ) {
    const result = await recoveryStore().reserveChatCredits({
      userId,
      requestId: input.requestId ?? `recovery-${randomUUID()}`,
      modelId: "recovery-model",
      creditCost: input.creditCost ?? 4,
      kind: input.kind ?? CreditReservationKind.CHAT_COMPLETION,
      expiresAt: input.expiresAt ?? new Date("2030-07-28T00:00:00.000Z")
    });
    if (!result.ok) throw new Error("TEST_RESERVATION_NOT_CREATED");
    return result.reservation;
  }

  async function completeAttempt(
    reservation: Awaited<ReturnType<typeof reserveExpired>>,
    status: "FAILED" | "SUCCEEDED" | "UNKNOWN" | "ABORTED",
    attemptIndex = 0
  ): Promise<void> {
    const requestId = reservation.requestId;
    if (!requestId) throw new Error("TEST_REQUEST_ID_MISSING");
    const claimed = await recoveryStore().claimChatProviderAttempt({
      reservationId: reservation.id,
      requestId,
      attemptIndex,
      modelId: "recovery-model",
      startedAt: new Date("2030-07-28T00:10:00.000Z")
    });
    expect(claimed.status).toBe("CLAIMED");
    await expect(
      recoveryStore().completeChatProviderAttempt({
        reservationId: reservation.id,
        requestId,
        attemptIndex,
        status,
        completedAt: new Date("2030-07-28T00:11:00.000Z")
      })
    ).resolves.toMatchObject({ status: "UPDATED" });
  }

  async function reservationStatus(id: string) {
    return database().creditReservation.findUnique({
      where: { id },
      select: { status: true, providerAttemptStartedAt: true }
    });
  }

  async function cleanupFixtures(): Promise<void> {
    await retryPrismaWriteConflict(async () => {
      await database().usageLog.deleteMany({
        where: { userId: { startsWith: fixtureUserPrefix } }
      });
      await database().accountCreditEvent.deleteMany({
        where: { user: { id: { startsWith: fixtureUserPrefix } } }
      });
      await database().user.deleteMany({
        where: { id: { startsWith: fixtureUserPrefix } }
      });
    });
  }

  async function withChatRecoverySweep<T>(body: () => Promise<T>): Promise<T> {
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
    if (!databaseUrl) return;
    try {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
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

  beforeEach(async () => {
    await cleanupFixtures();
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma?.$disconnect();
  });

  it("processes an empty batch and ignores unexpired, settled, released, and image reservations", async () => withChatRecoverySweep(async () => {
    const fixture = await createFixture(100);
    const unexpired = await reserveExpired(fixture.userId, {
      expiresAt: new Date("2032-07-28T00:00:00.000Z")
    });
    const settled = await reserveExpired(fixture.userId);
    await recoveryStore().settleChatReservation(settled.id);
    const released = await reserveExpired(fixture.userId);
    await recoveryStore().releaseChatReservation(released.id);
    const image = await recoveryStore().reserveCredits({
      userId: fixture.userId,
      kind: CreditReservationKind.IMAGE_GENERATION,
      amountCredits: 3,
      expiresAt: new Date("2030-07-28T00:00:00.000Z")
    });
    expect(image.ok).toBe(true);

    const result = await recoveryStore().recoverExpiredChatReservations({
      now: recoveryNow,
      limit: 20
    });
    expect(result).toMatchObject({ scanned: 0, settled: 0, released: 0, skipped: 0, failed: 0 });
    await expect(reservationStatus(unexpired.id)).resolves.toMatchObject({ status: "RESERVED" });
    await expect(reservationStatus(settled.id)).resolves.toMatchObject({ status: "SETTLED" });
    await expect(reservationStatus(released.id)).resolves.toMatchObject({ status: "RELEASED" });
    if (image.ok) {
      await expect(reservationStatus(image.reservation.id)).resolves.toMatchObject({ status: "RESERVED" });
    }
  }));

  it.each([
    [CreditReservationKind.CHAT_COMPLETION, "CHAT_RELEASE", "chat-release"],
    [CreditReservationKind.CHAT_STREAM, "CHAT_STREAM_RELEASE", "chat-stream-release"]
  ] as const)("releases expired %s reservations with no attempt and one event", async (kind, sourceType, keyPrefix) => withChatRecoverySweep(async () => {
    const fixture = await createFixture(100);
    const reservation = await reserveExpired(fixture.userId, { kind, creditCost: 7 });

    const result = await recoveryStore().recoverExpiredChatReservations({ now: recoveryNow });
    expect(result).toMatchObject({ scanned: 1, settled: 0, released: 1, skipped: 0, failed: 0 });
    await expect(reservationStatus(reservation.id)).resolves.toMatchObject({ status: "RELEASED" });
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } })).resolves.toMatchObject({ remainingCredits: 100 });
    await expect(database().accountCreditEvent.findMany({
      where: { userId: fixture.userId },
      orderBy: { createdAt: "asc" },
      select: { sourceType: true, sourceId: true, idempotencyKey: true, deltaCredits: true }
    })).resolves.toEqual([
      { sourceType: kind === CreditReservationKind.CHAT_STREAM ? "CHAT_STREAM_CHARGE" : "CHAT_CHARGE", sourceId: reservation.id, idempotencyKey: `${kind === CreditReservationKind.CHAT_STREAM ? "chat-stream-charge" : "chat-charge"}:${reservation.id}`, deltaCredits: -7 },
      { sourceType, sourceId: reservation.id, idempotencyKey: `${keyPrefix}:${reservation.id}`, deltaCredits: 7 }
    ]);

    await expect(recoveryStore().recoverExpiredChatReservations({ now: recoveryNow })).resolves.toMatchObject({
      scanned: 0,
      settled: 0,
      released: 0,
      skipped: 0,
      failed: 0
    });
    await expect(database().accountCreditEvent.count({ where: { sourceId: reservation.id } })).resolves.toBe(2);
  }));

  it("releases after one or many explicit FAILED attempts and does not write GlobalBudget", async () => withChatRecoverySweep(async () => {
    const fixture = await createFixture(100);
    const oneFailed = await reserveExpired(fixture.userId, { creditCost: 5 });
    await completeAttempt(oneFailed, "FAILED");
    const manyFailed = await reserveExpired(fixture.userId, { creditCost: 6 });
    await completeAttempt(manyFailed, "FAILED");
    await completeAttempt(manyFailed, "FAILED", 1);
    const budgetCountBefore = await database().globalBudgetPeriod.count();

    const result = await recoveryStore().recoverExpiredChatReservations({ now: recoveryNow });
    expect(result).toMatchObject({ scanned: 2, settled: 0, released: 2, skipped: 0, failed: 0 });
    await expect(database().globalBudgetPeriod.count()).resolves.toBe(budgetCountBefore);
    await expect(database().accountCreditEvent.count({ where: { sourceType: { in: ["CHAT_RELEASE", "CHAT_STREAM_RELEASE"] }, sourceId: { in: [oneFailed.id, manyFailed.id] } } })).resolves.toBe(2);
  }));

  it.each(["SUCCEEDED", "STARTED", "MARKER_ONLY", "UNKNOWN", "ABORTED"] as const)(
    "settles expired reservation for cost-protected result %s without release",
    async (status) => withChatRecoverySweep(async () => {
      const fixture = await createFixture(100);
      const reservation = await reserveExpired(fixture.userId, { creditCost: 5 });
      if (status === "MARKER_ONLY") {
        await database().creditReservation.update({
          where: { id: reservation.id },
          data: { providerAttemptStartedAt: new Date("2030-07-28T00:10:00.000Z") }
        });
      } else if (status === "STARTED") {
        const requestId = reservation.requestId;
        if (!requestId) throw new Error("TEST_REQUEST_ID_MISSING");
        await recoveryStore().claimChatProviderAttempt({
          reservationId: reservation.id,
          requestId,
          attemptIndex: 0,
          modelId: "recovery-model",
          startedAt: new Date("2030-07-28T00:10:00.000Z")
        });
      } else {
        await completeAttempt(reservation, status);
      }

      await expect(recoveryStore().recoverExpiredChatReservations({ now: recoveryNow })).resolves.toMatchObject({
        scanned: 1,
        settled: 1,
        released: 0,
        skipped: 0,
        failed: 0
      });
      await expect(reservationStatus(reservation.id)).resolves.toMatchObject({ status: "SETTLED" });
      await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } })).resolves.toMatchObject({ remainingCredits: 95 });
      await expect(database().accountCreditEvent.count({ where: { sourceId: reservation.id, sourceType: { in: ["CHAT_RELEASE", "CHAT_STREAM_RELEASE"] } } })).resolves.toBe(0);
    })
  );

  it("settles a mixed FAILED and STARTED fallback reservation", async () => withChatRecoverySweep(async () => {
    const fixture = await createFixture(100);
    const reservation = await reserveExpired(fixture.userId, { creditCost: 4 });
    await completeAttempt(reservation, "FAILED", 0);
    const requestId = reservation.requestId;
    if (!requestId) throw new Error("TEST_REQUEST_ID_MISSING");
    await expect(recoveryStore().claimChatProviderAttempt({
      reservationId: reservation.id,
      requestId,
      attemptIndex: 1,
      modelId: "recovery-model",
      startedAt: new Date("2030-07-28T00:12:00.000Z")
    })).resolves.toMatchObject({ status: "CLAIMED" });

    await expect(recoveryStore().recoverExpiredChatReservations({ now: recoveryNow })).resolves.toMatchObject({ settled: 1, released: 0 });
    await expect(reservationStatus(reservation.id)).resolves.toMatchObject({ status: "SETTLED" });
  }));

  it("is idempotent under concurrent Recovery runs and restores quota/event once", async () => withChatRecoverySweep(async () => {
    const fixture = await createFixture(100);
    const reservation = await reserveExpired(fixture.userId, { creditCost: 9 });
    const results = await Promise.all([
      recoveryStore().recoverExpiredChatReservations({ now: recoveryNow }),
      recoveryStore().recoverExpiredChatReservations({ now: recoveryNow })
    ]);

    expect(results.reduce((total, result) => total + result.released, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.settled, 0)).toBe(0);
    await expect(reservationStatus(reservation.id)).resolves.toMatchObject({ status: "RELEASED" });
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } })).resolves.toMatchObject({ remainingCredits: 100 });
    await expect(database().accountCreditEvent.count({ where: { sourceId: reservation.id } })).resolves.toBe(2);
  }));

  it("allows Route settle/release races to produce one terminal state and no double event", async () => withChatRecoverySweep(async () => {
    const settleFixture = await createFixture(100);
    const settleRace = await reserveExpired(settleFixture.userId, { creditCost: 8 });
    const settleResults = await Promise.all([
      recoveryStore().recoverExpiredChatReservations({ now: recoveryNow }),
      recoveryStore().settleChatReservation(settleRace.id)
    ]);
    expect(settleResults[1]).toMatchObject({ status: expect.stringMatching(/UPDATED|ALREADY_SETTLED|INVALID_STATE/) });
    await expect(reservationStatus(settleRace.id)).resolves.toMatchObject({ status: expect.stringMatching(/SETTLED|RELEASED/) });
    await expect(database().accountCreditEvent.count({ where: { sourceId: settleRace.id } })).resolves.toBeLessThanOrEqual(2);

    const releaseFixture = await createFixture(100);
    const releaseRace = await reserveExpired(releaseFixture.userId, { creditCost: 8 });
    const requestId = releaseRace.requestId;
    if (!requestId) throw new Error("TEST_REQUEST_ID_MISSING");
    await recoveryStore().claimChatProviderAttempt({
      reservationId: releaseRace.id,
      requestId,
      attemptIndex: 0,
      modelId: "recovery-model",
      startedAt: new Date("2030-07-28T00:10:00.000Z")
    });
    const releaseResults = await Promise.all([
      recoveryStore().recoverExpiredChatReservations({ now: recoveryNow }),
      recoveryStore().releaseChatReservation(releaseRace.id)
    ]);
    expect(releaseResults[1]).toMatchObject({ status: expect.stringMatching(/UPDATED|ALREADY_RELEASED|INVALID_STATE/) });
    await expect(reservationStatus(releaseRace.id)).resolves.toMatchObject({ status: expect.stringMatching(/SETTLED|RELEASED/) });
    await expect(database().accountCreditEvent.count({ where: { sourceId: releaseRace.id } })).resolves.toBeLessThanOrEqual(2);
  }));

  it("reports an item failure without exposing its database error or changing terminal state", async () => withChatRecoverySweep(async () => {
    const fixture = await createFixture(100);
    const reservation = await reserveExpired(fixture.userId, { creditCost: 4 });
    await database().userQuota.delete({ where: { userId: fixture.userId } });

    const result = await recoveryStore().recoverExpiredChatReservations({ now: recoveryNow });
    expect(result).toMatchObject({ scanned: 1, settled: 0, released: 0, skipped: 0, failed: 1 });
    await expect(reservationStatus(reservation.id)).resolves.toMatchObject({ status: "RESERVED" });
  }));
});
