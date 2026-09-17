import { randomUUID } from "node:crypto";
import {
  CreditReservationKind,
  CreditReservationStatus,
  PrismaClient,
  UsageLogAttemptStatus,
  type CreditReservation
} from "@prisma/client";
import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  createPrismaUserStore,
  type ChatCreditReservationKind,
  type ChatCreditStore,
  type ChatProviderAttemptRecord,
  type CreditReservationMutationResult,
  type ExpiredChatReservationRecord,
  type ReserveChatCreditsInput,
  type ReserveCreditsInput
} from "../src/store";
import {
  acquireCrossWorkerTestLock,
  IMAGE_RECOVERY_TEST_LOCK_NAME
} from "./helpers/cross-worker-test-lock";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;
const fixtureUserPrefix = "s13b1b_";
const NON_RECOVERY_RESERVATION_EXPIRES_AT = new Date(
  "2300-01-01T00:00:00.000Z"
);

type MemoryChatCreditEvent = {
  sourceType:
    | "CHAT_CHARGE"
    | "CHAT_STREAM_CHARGE"
    | "CHAT_RELEASE"
    | "CHAT_STREAM_RELEASE";
  reservationId: string;
  deltaCredits: number;
  balanceBefore: number;
  balanceAfter: number;
};

type MemoryChatAttempt = ChatProviderAttemptRecord & {
  costCredits: number;
};

function cloneMemoryDate(value: Date): Date {
  return new Date(value.getTime());
}

function createMemoryChatCreditStore(initialCredits = 20): ChatCreditStore & {
  events(): MemoryChatCreditEvent[];
  quota(userId: string): number;
  attempts(): MemoryChatAttempt[];
} {
  const quotas = new Map<string, number>();
  const reservations = new Map<string, CreditReservation>();
  const attempts = new Map<string, MemoryChatAttempt>();
  const events: MemoryChatCreditEvent[] = [];
  let reservationSequence = 0;
  let attemptSequence = 0;

  function eventType(
    kind: CreditReservationKind,
    phase: "CHARGE" | "RELEASE"
  ): MemoryChatCreditEvent["sourceType"] {
    const stream = kind === CreditReservationKind.CHAT_STREAM;
    if (phase === "CHARGE") {
      return stream ? "CHAT_STREAM_CHARGE" : "CHAT_CHARGE";
    }
    return stream ? "CHAT_STREAM_RELEASE" : "CHAT_RELEASE";
  }

  function cloneReservation(reservation: CreditReservation): CreditReservation {
    return {
      ...reservation,
      expiresAt: cloneMemoryDate(reservation.expiresAt),
      settledAt: reservation.settledAt
        ? cloneMemoryDate(reservation.settledAt)
        : null,
      releasedAt: reservation.releasedAt
        ? cloneMemoryDate(reservation.releasedAt)
        : null,
      providerAttemptStartedAt: reservation.providerAttemptStartedAt
        ? cloneMemoryDate(reservation.providerAttemptStartedAt)
        : null,
      createdAt: cloneMemoryDate(reservation.createdAt),
      updatedAt: cloneMemoryDate(reservation.updatedAt)
    };
  }

  function cloneAttempt(attempt: MemoryChatAttempt): MemoryChatAttempt {
    return {
      ...attempt,
      createdAt: cloneMemoryDate(attempt.createdAt),
      completedAt: attempt.completedAt
        ? cloneMemoryDate(attempt.completedAt)
        : null
    };
  }

  function attemptKey(requestId: string, attemptIndex: number): string {
    return `${requestId}:${attemptIndex}`;
  }

  function terminalAttemptStatus(
    status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "ABORTED"
  ): UsageLogAttemptStatus {
    switch (status) {
      case "SUCCEEDED":
        return UsageLogAttemptStatus.SUCCEEDED;
      case "FAILED":
        return UsageLogAttemptStatus.FAILED;
      case "UNKNOWN":
        return UsageLogAttemptStatus.UNKNOWN;
      case "ABORTED":
        return UsageLogAttemptStatus.ABORTED;
    }
  }

  function mutation(
    status: CreditReservationMutationResult["status"]
  ): CreditReservationMutationResult {
    return { status };
  }

  function recordEvent(
    reservation: CreditReservation,
    phase: "CHARGE" | "RELEASE",
    balanceBefore: number,
    balanceAfter: number
  ): void {
    events.push({
      sourceType: eventType(reservation.kind, phase),
      reservationId: reservation.id,
      deltaCredits: balanceAfter - balanceBefore,
      balanceBefore,
      balanceAfter
    });
  }

  const store: ChatCreditStore & {
    events(): MemoryChatCreditEvent[];
    quota(userId: string): number;
    attempts(): MemoryChatAttempt[];
  } = {
    async reserveChatCredits(input) {
      if (input.creditCost === 0) {
        return { ok: false, reason: "INVALID_CONFIGURATION" };
      }
      const existing = [...reservations.values()].find(
        (reservation) => reservation.requestId === input.requestId
      );
      if (existing) {
        return existing.kind === input.kind &&
          existing.amountCredits === input.creditCost
          ? {
              ok: true,
              status: "DUPLICATE",
              reservation: cloneReservation(existing)
            }
          : { ok: false, reason: "IDEMPOTENCY_CONFLICT" };
      }

      const balanceBefore = quotas.get(input.userId) ?? initialCredits;
      quotas.set(input.userId, balanceBefore);
      if (balanceBefore < input.creditCost) {
        return { ok: false, reason: "INSUFFICIENT_CREDITS" };
      }

      const now = new Date();
      const reservation: CreditReservation = {
        id: `memory-reservation-${++reservationSequence}`,
        userId: input.userId,
        kind: input.kind,
        amountCredits: input.creditCost,
        status: CreditReservationStatus.RESERVED,
        expiresAt: cloneMemoryDate(input.expiresAt),
        settledAt: null,
        releasedAt: null,
        requestId: input.requestId,
        providerAttemptStartedAt: null,
        aiTaskId: null,
        createdAt: now,
        updatedAt: now
      };
      const balanceAfter = balanceBefore - input.creditCost;
      quotas.set(input.userId, balanceAfter);
      reservations.set(reservation.id, reservation);
      recordEvent(reservation, "CHARGE", balanceBefore, balanceAfter);
      return {
        ok: true,
        status: "CREATED",
        reservation: cloneReservation(reservation)
      };
    },

    async claimChatProviderAttempt(input) {
      const key = attemptKey(input.requestId, input.attemptIndex);
      const existing = attempts.get(key);
      if (existing) {
        return existing.reservationId === input.reservationId
          ? {
              status:
                existing.status === UsageLogAttemptStatus.STARTED
                  ? "ALREADY_CLAIMED"
                  : "ALREADY_TERMINAL",
              attempt: cloneAttempt(existing)
            }
          : { status: "ATTEMPT_CONFLICT" };
      }

      const reservation = input.reservationId
        ? reservations.get(input.reservationId)
        : null;
      if (input.reservationId && !reservation) {
        return { status: "NOT_FOUND" };
      }
      if (reservation && (
        reservation.requestId !== input.requestId ||
        reservation.status !== CreditReservationStatus.RESERVED
      )) {
        return { status: "INVALID_STATE" };
      }
      const userId = reservation?.userId ?? input.userId;
      if (!userId) {
        return { status: "INVALID_STATE" };
      }

      const startedAt = input.startedAt ?? new Date();
      if (reservation && !reservation.providerAttemptStartedAt) {
        reservation.providerAttemptStartedAt = cloneMemoryDate(startedAt);
      }
      if (reservation) {
        reservation.updatedAt = new Date();
      }
      const attempt: MemoryChatAttempt = {
        id: `memory-attempt-${++attemptSequence}`,
        reservationId: input.reservationId,
        requestId: input.requestId,
        attemptIndex: input.attemptIndex,
        status: UsageLogAttemptStatus.STARTED,
        userId,
        model: input.modelId,
        createdAt: cloneMemoryDate(startedAt),
        completedAt: null,
        costCredits: 0
      };
      attempts.set(key, attempt);
      return { status: "CLAIMED", attempt: cloneAttempt(attempt) };
    },

    async completeChatProviderAttempt(input) {
      const reservation = input.reservationId
        ? reservations.get(input.reservationId)
        : null;
      if (input.reservationId && !reservation) {
        return { status: "NOT_FOUND" };
      }
      const attempt = attempts.get(
        attemptKey(input.requestId, input.attemptIndex)
      );
      if (!attempt) {
        return { status: "NOT_FOUND" };
      }
      if (attempt.reservationId !== input.reservationId) {
        return { status: "ATTEMPT_CONFLICT" };
      }
      const status = terminalAttemptStatus(input.status);
      if (attempt.status === status) {
        return { status: "ALREADY_TERMINAL", attempt: cloneAttempt(attempt) };
      }
      if (attempt.status !== UsageLogAttemptStatus.STARTED) {
        return { status: "CONFLICTING_TERMINAL_STATUS" };
      }
      attempt.status = status;
      attempt.costCredits =
        status === UsageLogAttemptStatus.FAILED
          ? 0
          : reservation?.amountCredits ?? 0;
      attempt.completedAt = cloneMemoryDate(input.completedAt ?? new Date());
      return { status: "UPDATED", attempt: cloneAttempt(attempt) };
    },

    async settleChatReservation(reservationId) {
      const reservation = reservations.get(reservationId);
      if (!reservation) {
        return mutation("INVALID_STATE");
      }
      if (reservation.status === CreditReservationStatus.SETTLED) {
        return mutation("ALREADY_SETTLED");
      }
      if (reservation.status !== CreditReservationStatus.RESERVED) {
        return mutation("INVALID_STATE");
      }
      reservation.status = CreditReservationStatus.SETTLED;
      reservation.settledAt = new Date();
      reservation.updatedAt = new Date();
      return mutation("UPDATED");
    },

    async releaseChatReservation(reservationId) {
      const reservation = reservations.get(reservationId);
      if (!reservation) {
        return mutation("INVALID_STATE");
      }
      if (reservation.status === CreditReservationStatus.RELEASED) {
        return mutation("ALREADY_RELEASED");
      }
      if (reservation.status !== CreditReservationStatus.RESERVED) {
        return mutation("INVALID_STATE");
      }
      const balanceBefore = quotas.get(reservation.userId) ?? initialCredits;
      const balanceAfter = balanceBefore + reservation.amountCredits;
      quotas.set(reservation.userId, balanceAfter);
      reservation.status = CreditReservationStatus.RELEASED;
      reservation.releasedAt = new Date();
      reservation.updatedAt = new Date();
      recordEvent(reservation, "RELEASE", balanceBefore, balanceAfter);
      return mutation("UPDATED");
    },

    async listExpiredChatReservations(options = {}) {
      const now = options.now ?? new Date();
      const limit = options.limit ?? 100;
      return [...reservations.values()]
        .filter(
          (reservation) =>
            reservation.status === CreditReservationStatus.RESERVED &&
            reservation.expiresAt.getTime() <= now.getTime()
        )
        .sort(
          (left, right) =>
            left.expiresAt.getTime() - right.expiresAt.getTime() ||
            left.id.localeCompare(right.id)
        )
        .slice(0, limit)
        .map(
          (reservation): ExpiredChatReservationRecord => ({
            id: reservation.id,
            userId: reservation.userId,
            requestId: reservation.requestId,
            kind: reservation.kind as ChatCreditReservationKind,
            amountCredits: reservation.amountCredits,
            status: reservation.status,
            expiresAt: cloneMemoryDate(reservation.expiresAt),
            providerAttemptStartedAt: reservation.providerAttemptStartedAt
              ? cloneMemoryDate(reservation.providerAttemptStartedAt)
              : null
          })
        );
    },

    events() {
      return events.map((event) => ({ ...event }));
    },
    quota(userId) {
      return quotas.get(userId) ?? initialCredits;
    },
    attempts() {
      return [...attempts.values()].map(cloneAttempt);
    }
  };

  return store;
}

databaseSuite.sequential("CreditReservation Store operations", () => {
  let prisma: PrismaClient | undefined;
  let store: ReturnType<typeof createPrismaUserStore> | undefined;
  const fixtureUserIds: string[] = [];

  function database(): PrismaClient {
    if (!prisma) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }

    return prisma;
  }

  function reservationStore(): ReturnType<typeof createPrismaUserStore> {
    if (!store) {
      throw new Error("TEST_STORE_NOT_INITIALIZED");
    }

    return store;
  }

  async function createFixture(input?: {
    credits?: number;
    remainingCredits?: number;
  }): Promise<{ userId: string; email: string }> {
    const userId = `${fixtureUserPrefix}${randomUUID()}`;
    const email = `${userId}@example.test`;
    fixtureUserIds.push(userId);
    await database().user.create({
      data: {
        id: userId,
        email,
        passwordHash: "test-hash",
        credits: input?.credits ?? 1000,
        quota: {
          create: {
            remainingCredits: input?.remainingCredits ?? 20
          }
        }
      }
    });
    return { userId, email };
  }

  function reserveInput(
    userId: string,
    amountCredits: number,
    overrides: Partial<ReserveCreditsInput> = {}
  ): ReserveCreditsInput {
    return {
      userId,
      kind: "CHAT_COMPLETION" as CreditReservationKind,
      amountCredits,
      expiresAt: NON_RECOVERY_RESERVATION_EXPIRES_AT,
      ...overrides
    };
  }

  function chatReserveInput(
    userId: string,
    overrides: Partial<{
      requestId: string;
      modelId: string;
      creditCost: number;
      kind: ChatCreditReservationKind;
      expiresAt: Date;
    }> = {}
  ): ReserveChatCreditsInput {
    return {
      userId,
      requestId: `chat-request-${randomUUID()}`,
      modelId: "chat-model-fixture",
      creditCost: 4,
      kind: CreditReservationKind.CHAT_COMPLETION,
      expiresAt: NON_RECOVERY_RESERVATION_EXPIRES_AT,
      ...overrides
    };
  }

  async function cleanupFixtures(): Promise<void> {
    const userIds = [...fixtureUserIds];
    await retryPrismaWriteConflict(async () => {
      if (userIds.length > 0) {
        await database().usageLog.deleteMany({
          where: { userId: { in: userIds } }
        });
        await database().accountCreditEvent.deleteMany({
          where: { userId: { in: userIds } }
        });
        await database().user.deleteMany({ where: { id: { in: userIds } } });
      }
    });
    fixtureUserIds.length = 0;
  }

  async function withExpiredCreditSweep<T>(body: () => Promise<T>): Promise<T> {
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

  afterAll(async () => {
    await cleanupFixtures();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
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
    fixtureUserIds.length = 0;
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  it("reserves credits atomically and creates RESERVED", async () => {
    const fixture = await createFixture({ remainingCredits: 10 });

    const result = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 4, { aiTaskId: null })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservation).toMatchObject({
        userId: fixture.userId,
        kind: "CHAT_COMPLETION",
        amountCredits: 4,
        status: "RESERVED",
        aiTaskId: null
      });
    }
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
  });

  it("allows a reservation that exactly consumes the quota", async () => {
    const fixture = await createFixture({ remainingCredits: 7 });

    const result = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 7)
    );

    expect(result.ok).toBe(true);
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 0 });
  });

  it("returns INSUFFICIENT_CREDITS without changing quota or creating a reservation", async () => {
    const fixture = await createFixture({ remainingCredits: 3 });

    await expect(
      reservationStore().reserveCredits(reserveInput(fixture.userId, 4))
    ).resolves.toEqual({ ok: false, reason: "INSUFFICIENT_CREDITS" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 3 });
    await expect(
      database().creditReservation.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("returns QUOTA_NOT_FOUND without creating quota", async () => {
    const fixture = await createFixture({ remainingCredits: 3 });
    await database().userQuota.delete({ where: { userId: fixture.userId } });

    await expect(
      reservationStore().reserveCredits(reserveInput(fixture.userId, 1))
    ).resolves.toEqual({ ok: false, reason: "QUOTA_NOT_FOUND" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toBeNull();
  });

  it.each([0, -1, 1.5])("rejects amountCredits=%s", async (amountCredits) => {
    const fixture = await createFixture();

    await expect(
      reservationStore().reserveCredits(
        reserveInput(fixture.userId, amountCredits)
      )
    ).rejects.toThrow("INVALID_CREDIT_RESERVATION_AMOUNT");
  });

  it.each([new Date("invalid"), new Date(Date.now() - 1)])(
    "rejects invalid expiry %s",
    async (expiresAt) => {
      const fixture = await createFixture();

      await expect(
        reservationStore().reserveCredits(
          reserveInput(fixture.userId, 1, { expiresAt })
        )
      ).rejects.toThrow("INVALID_CREDIT_RESERVATION_EXPIRY");
    }
  );

  it("rolls back the quota decrement when reservation creation fails", async () => {
    const fixture = await createFixture({ remainingCredits: 8 });

    await expect(
      reservationStore().reserveCredits(
        reserveInput(fixture.userId, 3, {
          aiTaskId: `missing_task_${randomUUID()}`
        })
      )
    ).rejects.toThrow();
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 8 });
    await expect(
      database().creditReservation.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("does not modify User.credits", async () => {
    const fixture = await createFixture({ credits: 321, remainingCredits: 5 });

    await reservationStore().reserveCredits(reserveInput(fixture.userId, 2));

    await expect(
      database().user.findUnique({ where: { id: fixture.userId } })
    ).resolves.toMatchObject({ credits: 321 });
  });

  it("settles RESERVED and sets settledAt without deducting again", async () => {
    const fixture = await createFixture({ remainingCredits: 8 });
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 3)
    );

    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    await expect(
      reservationStore().settleCreditReservation(reserved.reservation.id)
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      database().creditReservation.findUnique({
        where: { id: reserved.reservation.id }
      })
    ).resolves.toMatchObject({ status: "SETTLED" });
    const settled = await database().creditReservation.findUnique({
      where: { id: reserved.reservation.id }
    });
    expect(settled?.settledAt).toBeInstanceOf(Date);
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 5 });
  });

  it("does not settle the same reservation twice", async () => {
    const fixture = await createFixture();
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 1)
    );

    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    await expect(
      reservationStore().settleCreditReservation(reserved.reservation.id)
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      reservationStore().settleCreditReservation(reserved.reservation.id)
    ).resolves.toEqual({ status: "ALREADY_SETTLED" });
  });

  it("does not settle a released reservation", async () => {
    const fixture = await createFixture();
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 1)
    );

    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    await expect(
      reservationStore().releaseCreditReservation(reserved.reservation.id)
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      reservationStore().settleCreditReservation(reserved.reservation.id)
    ).resolves.toEqual({ status: "INVALID_STATE" });
  });

  it("returns NOT_FOUND when settling an unknown reservation", async () => {
    await createFixture();

    await expect(
      reservationStore().settleCreditReservation(`missing_${randomUUID()}`)
    ).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("releases a reservation and restores its quota once", async () => {
    const fixture = await createFixture({ remainingCredits: 10 });
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 4)
    );

    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
    await expect(
      reservationStore().releaseCreditReservation(reserved.reservation.id)
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 10 });
    await expect(
      database().creditReservation.findUnique({
        where: { id: reserved.reservation.id }
      })
    ).resolves.toMatchObject({ status: "RELEASED" });
  });

  it("does not refund a reservation twice", async () => {
    const fixture = await createFixture({ remainingCredits: 10 });
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 4)
    );

    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    await reservationStore().releaseCreditReservation(reserved.reservation.id);
    await expect(
      reservationStore().releaseCreditReservation(reserved.reservation.id)
    ).resolves.toEqual({ status: "ALREADY_RELEASED" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 10 });
  });

  it("does not release a settled reservation", async () => {
    const fixture = await createFixture({ remainingCredits: 10 });
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 4)
    );

    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    await reservationStore().settleCreditReservation(reserved.reservation.id);
    await expect(
      reservationStore().releaseCreditReservation(reserved.reservation.id)
    ).resolves.toEqual({ status: "INVALID_STATE" });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
  });

  it("rolls back the release when the quota cannot be restored", async () => {
    const fixture = await createFixture({ remainingCredits: 10 });
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 4)
    );

    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    await database().userQuota.delete({ where: { userId: fixture.userId } });
    await expect(
      reservationStore().releaseCreditReservation(reserved.reservation.id)
    ).rejects.toThrow("CREDIT_RESERVATION_QUOTA_NOT_FOUND");
    await expect(
      database().creditReservation.findUnique({
        where: { id: reserved.reservation.id }
      })
    ).resolves.toMatchObject({ status: "RESERVED" });
  });

  it("allows at most one concurrent release refund", async () => {
    const fixture = await createFixture({ remainingCredits: 10 });
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 4)
    );

    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    const results = await Promise.allSettled([
      reservationStore().releaseCreditReservation(reserved.reservation.id),
      reservationStore().releaseCreditReservation(reserved.reservation.id)
    ]);
    const statuses = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.status] : []
    );

    expect(statuses).toHaveLength(2);
    expect(statuses.filter((status) => status === "UPDATED")).toHaveLength(1);
    expect(statuses.filter((status) => status === "ALREADY_RELEASED")).toHaveLength(1);
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 10 });
  });

  it.each([
    0,
    -1,
    1.5,
    1001
  ])("rejects invalid expired reservation release limit=%s", async (limit) => {
    await expect(
      reservationStore().releaseExpiredCreditReservations({ limit })
    ).rejects.toThrow("INVALID_EXPIRED_CREDIT_RESERVATION_LIMIT");
  });

  it("rejects an invalid expired reservation release now", async () => {
    await expect(
      reservationStore().releaseExpiredCreditReservations({
        now: new Date("invalid")
      })
    ).rejects.toThrow("INVALID_EXPIRED_CREDIT_RESERVATION_NOW");
  });

  it("returns zero counts when no reservations are expired", async () => withExpiredCreditSweep(async () => {
    await createFixture();

    await expect(
      reservationStore().releaseExpiredCreditReservations({
        now: new Date(Date.now() + 1_000)
      })
    ).resolves.toEqual({ scanned: 0, released: 0, skipped: 0 });
  }));

  it("uses the default limit of 100", async () => withExpiredCreditSweep(async () => {
    const fixture = await createFixture({
      remainingCredits: 101
    });
    const createdReservationIds: string[] = [];
    const sweepNow = new Date("2000-01-02T00:00:00.000Z");
    const expiredAt = new Date("2000-01-01T00:00:00.000Z");

    vi.useFakeTimers({ now: new Date("1999-12-31T23:59:00.000Z") });
    try {
      for (let index = 0; index < 101; index += 1) {
        const reserved = await reservationStore().reserveCredits(
          reserveInput(fixture.userId, 1, { expiresAt: expiredAt })
        );
        expect(reserved.ok).toBe(true);
        if (!reserved.ok) {
          throw new Error(`TEST_UNEXPECTED_RESULT_${reserved.reason}`);
        }
        createdReservationIds.push(reserved.reservation.id);
      }

      const result = await reservationStore().releaseExpiredCreditReservations({
        now: sweepNow
      });
      expect(result).toEqual({ scanned: 100, released: 100, skipped: 0 });
    } finally {
      vi.useRealTimers();
    }

    await expect(
      database().creditReservation.count({
        where: {
          id: { in: createdReservationIds },
          status: "RELEASED"
        }
      })
    ).resolves.toBe(100);
    await expect(
      database().creditReservation.count({
        where: {
          id: { in: createdReservationIds },
          status: "RESERVED"
        }
      })
    ).resolves.toBe(1);
  }));

  it("uses a custom limit and stable expiresAt/id ordering", async () => withExpiredCreditSweep(async () => {
    const fixture = await createFixture({ remainingCredits: 9 });
    const fixtureNow = new Date("1989-12-31T23:59:00.000Z");
    const baseNow = new Date("1990-01-01T00:00:00.000Z");
    const earliestExpiresAt = new Date(baseNow.getTime() + 60 * 60 * 1000);
    const tiedExpiresAt = new Date(baseNow.getTime() + 2 * 60 * 60 * 1000);
    const sweepNow = new Date(baseNow.getTime() + 3 * 60 * 60 * 1000);
    vi.useFakeTimers({ now: fixtureNow });
    try {
      const reservations = await Promise.all([
        reservationStore().reserveCredits(
          reserveInput(fixture.userId, 1, { expiresAt: earliestExpiresAt })
        ),
        reservationStore().reserveCredits(
          reserveInput(fixture.userId, 1, { expiresAt: tiedExpiresAt })
        ),
        reservationStore().reserveCredits(
          reserveInput(fixture.userId, 1, { expiresAt: tiedExpiresAt })
        )
      ]);

      const reservationIds = reservations.flatMap((result) =>
        result.ok ? [result.reservation.id] : []
      );
      expect(reservationIds).toHaveLength(3);
      const [firstId, secondId, thirdId] = reservationIds;
      if (!firstId || !secondId || !thirdId) {
        throw new Error("expected test reservation fixture ids to exist");
      }
      const tiedIds = [secondId, thirdId].sort();
      const [firstTiedId, secondTiedId] = tiedIds;
      if (!firstTiedId || !secondTiedId) {
        throw new Error("expected tied test reservation fixture ids to exist");
      }

      const firstSweep = await reservationStore().releaseExpiredCreditReservations({
        now: sweepNow,
        limit: 2
      });
      expect(firstSweep.scanned).toBeGreaterThanOrEqual(1);
      expect(firstSweep.released).toBeGreaterThanOrEqual(0);
      expect(firstSweep.skipped).toBeGreaterThanOrEqual(0);

      await expect(
        database().creditReservation.findMany({
          where: { id: { in: [firstId, firstTiedId] } },
          select: { id: true, status: true }
        })
      ).resolves.toEqual(
        expect.arrayContaining([
          { id: firstId, status: "RELEASED" },
          { id: firstTiedId, status: "RELEASED" }
        ])
      );

      const secondSweep = await reservationStore().releaseExpiredCreditReservations({
        now: sweepNow,
        limit: 1
      });
      expect(secondSweep.scanned).toBeGreaterThanOrEqual(0);
      expect(secondSweep.released).toBeGreaterThanOrEqual(0);
      expect(secondSweep.skipped).toBeGreaterThanOrEqual(0);

      await expect(
        database().creditReservation.findUnique({
          where: { id: secondTiedId }
        })
      ).resolves.toMatchObject({ status: "RELEASED" });
    } finally {
      vi.useRealTimers();
    }
  }));

  it("selects only expired RESERVED reservations and restores quota once", async () => withExpiredCreditSweep(async () => {
    const fixture = await createFixture({ remainingCredits: 50 });
    const baseNow = new Date();
    const sweepNow = new Date(baseNow.getTime() + 4 * 60 * 60 * 1000);
    const expiredOne = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 3, {
        expiresAt: new Date(baseNow.getTime() + 60 * 60 * 1000)
      })
    );
    const expiredTwo = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 4, {
        expiresAt: new Date(baseNow.getTime() + 2 * 60 * 60 * 1000)
      })
    );
    const unexpired = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 5, {
        expiresAt: new Date(baseNow.getTime() + 8 * 60 * 60 * 1000)
      })
    );
    const settled = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 2, {
        expiresAt: new Date(baseNow.getTime() + 90 * 60 * 60 * 1000)
      })
    );
    const released = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 1, {
        expiresAt: new Date(baseNow.getTime() + 90 * 60 * 60 * 1000)
      })
    );

    expect(expiredOne.ok && expiredTwo.ok && unexpired.ok).toBe(true);
    expect(settled.ok && released.ok).toBe(true);
    if (
      !expiredOne.ok ||
      !expiredTwo.ok ||
      !unexpired.ok ||
      !settled.ok ||
      !released.ok
    ) {
      return;
    }

    await reservationStore().settleCreditReservation(settled.reservation.id);
    await reservationStore().releaseCreditReservation(released.reservation.id);

    await expect(
      reservationStore().releaseExpiredCreditReservations({ now: sweepNow })
    ).resolves.toEqual({ scanned: 2, released: 2, skipped: 0 });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 43 });
    await expect(
      database().creditReservation.findMany({
        where: { userId: fixture.userId },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        { id: expiredOne.reservation.id, status: "RELEASED" },
        { id: expiredTwo.reservation.id, status: "RELEASED" },
        { id: unexpired.reservation.id, status: "RESERVED" },
        { id: settled.reservation.id, status: "SETTLED" },
        { id: released.reservation.id, status: "RELEASED" }
      ])
    );
  }));

  it("counts all non-UPDATED release statuses as skipped", async () => withExpiredCreditSweep(async () => {
    const fixture = await createFixture({ remainingCredits: 5 });
    const baseNow = new Date();
    const expiresAt = new Date(baseNow.getTime() + 60 * 60 * 1000);
    const sweepNow = new Date(baseNow.getTime() + 2 * 60 * 60 * 1000);

    for (let index = 0; index < 5; index += 1) {
      const reserved = await reservationStore().reserveCredits(
        reserveInput(fixture.userId, 1, { expiresAt })
      );
      expect(reserved.ok).toBe(true);
    }

    const store = reservationStore();
    const releaseSpy = vi.spyOn(store, "releaseCreditReservation");
    releaseSpy
      .mockResolvedValueOnce({ status: "UPDATED" })
      .mockResolvedValueOnce({ status: "ALREADY_RELEASED" })
      .mockResolvedValueOnce({ status: "ALREADY_SETTLED" })
      .mockResolvedValueOnce({ status: "INVALID_STATE" })
      .mockResolvedValueOnce({ status: "NOT_FOUND" });

    try {
      await expect(
        store.releaseExpiredCreditReservations({ now: sweepNow })
      ).resolves.toEqual({ scanned: 5, released: 1, skipped: 4 });
      expect(releaseSpy).toHaveBeenCalledTimes(5);
    } finally {
      releaseSpy.mockRestore();
    }
  }));

  it("propagates a release database error", async () => withExpiredCreditSweep(async () => {
    const fixture = await createFixture();
    const baseNow = new Date();
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 1, {
        expiresAt: new Date(baseNow.getTime() + 60 * 60 * 1000)
      })
    );
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    const databaseError = new Error("TEST_DATABASE_FAILURE");
    const store = reservationStore();
    const releaseSpy = vi
      .spyOn(store, "releaseCreditReservation")
      .mockRejectedValueOnce(databaseError);

    try {
      await expect(
        store.releaseExpiredCreditReservations({
          now: new Date(baseNow.getTime() + 2 * 60 * 60 * 1000)
        })
      ).rejects.toBe(databaseError);
    } finally {
      releaseSpy.mockRestore();
    }
  }));

  it("does not return reservation or user-sensitive data", async () => withExpiredCreditSweep(async () => {
    const fixture = await createFixture();
    const baseNow = new Date();
    const reserved = await reservationStore().reserveCredits(
      reserveInput(fixture.userId, 1, {
        expiresAt: new Date(baseNow.getTime() + 60 * 60 * 1000)
      })
    );
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    const result = await reservationStore().releaseExpiredCreditReservations({
      now: new Date(baseNow.getTime() + 2 * 60 * 60 * 1000)
    });

    expect(result).toEqual({ scanned: 1, released: 1, skipped: 0 });
    expect(Object.keys(result).sort()).toEqual([
      "released",
      "scanned",
      "skipped"
    ]);
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("reservationId");
    expect(result).not.toHaveProperty("reservation");
  }));

  it("does not refund expired reservations more than once across concurrent sweeps", async () => withExpiredCreditSweep(async () => {
    const fixture = await createFixture({ remainingCredits: 20 });
    const baseNow = new Date();
    const sweepNow = new Date(baseNow.getTime() + 2 * 60 * 60 * 1000);
    for (const amountCredits of [3, 4]) {
      const reserved = await reservationStore().reserveCredits(
        reserveInput(fixture.userId, amountCredits, {
          expiresAt: new Date(baseNow.getTime() + 60 * 60 * 1000)
        })
      );
      expect(reserved.ok).toBe(true);
    }

    const results = await Promise.allSettled([
      reservationStore().releaseExpiredCreditReservations({ now: sweepNow }),
      reservationStore().releaseExpiredCreditReservations({ now: sweepNow })
    ]);
    const values = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    expect(values).toHaveLength(2);
    expect(values.every((value) => Object.keys(value).length === 3)).toBe(true);
    expect(values.reduce((total, value) => total + value.released, 0)).toBe(2);
    expect(
      values.reduce((total, value) => total + value.skipped, 0)
    ).toBeGreaterThanOrEqual(0);
    expect(
      values.reduce((total, value) => total + value.scanned, 0)
    ).toBeGreaterThanOrEqual(2);
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
  }));

  it("allows at most one concurrent reservation for the remaining credits", async () => {
    const fixture = await createFixture({ remainingCredits: 4 });

    const results = await Promise.allSettled([
      reservationStore().reserveCredits(reserveInput(fixture.userId, 4)),
      reservationStore().reserveCredits(reserveInput(fixture.userId, 4))
    ]);
    const values = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    expect(values).toHaveLength(2);
    expect(values.filter((value) => value.ok)).toHaveLength(1);
    expect(values).toContainEqual({
      ok: false,
      reason: "INSUFFICIENT_CREDITS"
    });
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 0 });
    await expect(
      database().creditReservation.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("reserves Chat credits once, emits the typed charge event, and fails closed for zero cost", async () => {
    const fixture = await createFixture({ remainingCredits: 20 });
    const input = chatReserveInput(fixture.userId, { creditCost: 4 });

    const first = await reservationStore().reserveChatCredits(input);
    expect(first).toMatchObject({
      ok: true,
      status: "CREATED",
      reservation: {
        userId: fixture.userId,
        kind: CreditReservationKind.CHAT_COMPLETION,
        amountCredits: 4,
        status: "RESERVED",
        requestId: input.requestId,
        providerAttemptStartedAt: null
      }
    });
    if (!first.ok) {
      return;
    }

    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 16 });
    await expect(
      database().accountCreditEvent.findMany({
        where: { userId: fixture.userId },
        select: { deltaCredits: true, sourceType: true, sourceId: true, idempotencyKey: true }
      })
    ).resolves.toEqual([
      {
        deltaCredits: -4,
        sourceType: "CHAT_CHARGE",
        sourceId: first.reservation.id,
        idempotencyKey: `chat-charge:${first.reservation.id}`
      }
    ]);

    await expect(
      reservationStore().reserveChatCredits(input)
    ).resolves.toMatchObject({ ok: true, status: "DUPLICATE" });
    await expect(
      reservationStore().reserveChatCredits({ ...input, creditCost: 5 })
    ).resolves.toEqual({ ok: false, reason: "IDEMPOTENCY_CONFLICT" });

    const zeroCost = await reservationStore().reserveChatCredits(
      chatReserveInput(fixture.userId, {
        requestId: `${input.requestId}-zero`,
        creditCost: 0
      })
    );
    expect(zeroCost).toEqual({ ok: false, reason: "INVALID_CONFIGURATION" });
    await expect(
      database().creditReservation.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("records durable provider attempts exactly once and supports fallback attempts", async () => {
    const fixture = await createFixture({ remainingCredits: 20 });
    const input = chatReserveInput(fixture.userId, {
      requestId: `chat-attempt-${randomUUID()}`,
      creditCost: 3
    });
    const reserved = await reservationStore().reserveChatCredits(input);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }

    const firstStartedAt = new Date("2030-07-28T01:00:00.000Z");
    const firstAttempt = await reservationStore().claimChatProviderAttempt({
      reservationId: reserved.reservation.id,
      requestId: input.requestId,
      attemptIndex: 0,
      modelId: input.modelId,
      providerId: "provider-fixture",
      providerName: "Provider Fixture",
      upstreamModel: "upstream-fixture",
      routeId: "route-fixture",
      fallbackAttempts: 0,
      startedAt: firstStartedAt
    });
    expect(firstAttempt).toMatchObject({
      status: "CLAIMED",
      attempt: {
        reservationId: reserved.reservation.id,
        requestId: input.requestId,
        attemptIndex: 0,
        status: UsageLogAttemptStatus.STARTED,
        model: input.modelId,
        completedAt: null
      }
    });
    if (firstAttempt.status !== "CLAIMED") {
      return;
    }

    await expect(
      database().creditReservation.findUnique({
        where: { id: reserved.reservation.id },
        select: { providerAttemptStartedAt: true }
      })
    ).resolves.toMatchObject({ providerAttemptStartedAt: firstStartedAt });
    await expect(
      reservationStore().claimChatProviderAttempt({
        reservationId: reserved.reservation.id,
        requestId: input.requestId,
        attemptIndex: 0,
        modelId: input.modelId,
        startedAt: new Date("2030-07-28T01:01:00.000Z")
      })
    ).resolves.toMatchObject({ status: "ALREADY_CLAIMED", attempt: { id: firstAttempt.attempt.id } });

    await expect(
      reservationStore().completeChatProviderAttempt({
        reservationId: reserved.reservation.id,
        requestId: input.requestId,
        attemptIndex: 0,
        status: "FAILED",
        completedAt: new Date("2030-07-28T01:00:01.000Z")
      })
    ).resolves.toMatchObject({ status: "UPDATED", attempt: { status: UsageLogAttemptStatus.FAILED } });

    const secondAttempt = await reservationStore().claimChatProviderAttempt({
      reservationId: reserved.reservation.id,
      requestId: input.requestId,
      attemptIndex: 1,
      modelId: input.modelId,
      fallbackAttempts: 1,
      startedAt: new Date("2030-07-28T01:00:02.000Z")
    });
    expect(secondAttempt).toMatchObject({
      status: "CLAIMED",
      attempt: { attemptIndex: 1, status: UsageLogAttemptStatus.STARTED }
    });
    await expect(
      reservationStore().completeChatProviderAttempt({
        reservationId: reserved.reservation.id,
        requestId: input.requestId,
        attemptIndex: 1,
        status: "SUCCEEDED",
        completedAt: new Date("2030-07-28T01:00:03.000Z")
      })
    ).resolves.toMatchObject({ status: "UPDATED", attempt: { status: UsageLogAttemptStatus.SUCCEEDED } });
    await expect(
      reservationStore().completeChatProviderAttempt({
        reservationId: reserved.reservation.id,
        requestId: input.requestId,
        attemptIndex: 1,
        status: "SUCCEEDED"
      })
    ).resolves.toMatchObject({ status: "ALREADY_TERMINAL" });

    await expect(
      database().usageLog.findMany({
        where: { reservationId: reserved.reservation.id },
        orderBy: { attemptIndex: "asc" },
        select: {
          requestId: true,
          attemptIndex: true,
          attemptStatus: true,
          status: true,
          costCredits: true
        }
      })
    ).resolves.toEqual([
      {
        requestId: input.requestId,
        attemptIndex: 0,
        attemptStatus: UsageLogAttemptStatus.FAILED,
        status: "FAILED",
        costCredits: 0
      },
      {
        requestId: input.requestId,
        attemptIndex: 1,
        attemptStatus: UsageLogAttemptStatus.SUCCEEDED,
        status: "SUCCESS",
        costCredits: 3
      }
    ]);
  });

  it("claims nullable-reservation attempts without reading or creating a reservation", async () => {
    const fixture = await createFixture({ remainingCredits: 20 });
    const requestId = `free-chat-attempt-${randomUUID()}`;
    const startedAt = new Date("2030-07-28T02:00:00.000Z");

    const first = await reservationStore().claimChatProviderAttempt({
      reservationId: null,
      userId: fixture.userId,
      requestId,
      attemptIndex: 0,
      modelId: "free-chat-model",
      startedAt
    });
    expect(first).toMatchObject({
      status: "CLAIMED",
      attempt: {
        reservationId: null,
        requestId,
        attemptIndex: 0,
        userId: fixture.userId,
        status: UsageLogAttemptStatus.STARTED
      }
    });

    await expect(
      reservationStore().claimChatProviderAttempt({
        reservationId: null,
        userId: fixture.userId,
        requestId,
        attemptIndex: 0,
        modelId: "free-chat-model",
        startedAt: new Date("2030-07-28T02:01:00.000Z")
      })
    ).resolves.toMatchObject({ status: "ALREADY_CLAIMED" });

    await expect(
      reservationStore().completeChatProviderAttempt({
        reservationId: null,
        requestId,
        attemptIndex: 0,
        status: "SUCCEEDED",
        completedAt: new Date("2030-07-28T02:00:01.000Z")
      })
    ).resolves.toMatchObject({ status: "UPDATED" });

    await expect(
      database().usageLog.findMany({
        where: { requestId },
        select: {
          reservationId: true,
          requestId: true,
          attemptIndex: true,
          attemptStatus: true,
          costCredits: true
        }
      })
    ).resolves.toEqual([
      {
        reservationId: null,
        requestId,
        attemptIndex: 0,
        attemptStatus: UsageLogAttemptStatus.SUCCEEDED,
        costCredits: 0
      }
    ]);
    await expect(
      database().creditReservation.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
  });

  it("settles without another charge and releases atomically with one reverse event", async () => {
    const fixture = await createFixture({ remainingCredits: 20 });
    const releaseInput = chatReserveInput(fixture.userId, {
      requestId: `chat-release-${randomUUID()}`,
      creditCost: 5
    });
    const released = await reservationStore().reserveChatCredits(releaseInput);
    expect(released.ok).toBe(true);
    if (!released.ok) {
      return;
    }
    await expect(
      reservationStore().releaseChatReservation(released.reservation.id)
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      reservationStore().releaseChatReservation(released.reservation.id)
    ).resolves.toEqual({ status: "ALREADY_RELEASED" });

    const settledInput = chatReserveInput(fixture.userId, {
      requestId: `chat-settle-${randomUUID()}`,
      creditCost: 2,
      kind: CreditReservationKind.CHAT_STREAM
    });
    const settled = await reservationStore().reserveChatCredits(settledInput);
    expect(settled.ok).toBe(true);
    if (!settled.ok) {
      return;
    }
    await expect(
      reservationStore().settleChatReservation(settled.reservation.id)
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      reservationStore().settleChatReservation(settled.reservation.id)
    ).resolves.toEqual({ status: "ALREADY_SETTLED" });
    await expect(
      reservationStore().releaseChatReservation(settled.reservation.id)
    ).resolves.toEqual({ status: "INVALID_STATE" });

    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 18 });
    await expect(
      database().accountCreditEvent.findMany({
        where: { userId: fixture.userId },
        orderBy: { createdAt: "asc" },
        select: { deltaCredits: true, sourceType: true }
      })
    ).resolves.toEqual([
      { deltaCredits: -5, sourceType: "CHAT_CHARGE" },
      { deltaCredits: 5, sourceType: "CHAT_RELEASE" },
      { deltaCredits: -2, sourceType: "CHAT_STREAM_CHARGE" }
    ]);
  });

  it(
    "keeps expired Chat recovery queries bounded and preserves historical NULL attempts",
    async () => withExpiredCreditSweep(async () => {
      const fixture = await createFixture({ remainingCredits: 20 });
      const baseNow = new Date();
      const blockerExpiresAt = new Date(baseNow.getTime() + 60 * 60 * 1000);
      const targetExpiresAt = new Date(baseNow.getTime() + 2 * 60 * 60 * 1000);
      const recoveryNow = new Date(baseNow.getTime() + 3 * 60 * 60 * 1000);

      const blockerRequestId = `chat-expired-blocker-${randomUUID()}`;
      const blocker = await reservationStore().reserveChatCredits(
        chatReserveInput(fixture.userId, {
          requestId: blockerRequestId,
          creditCost: 5,
          expiresAt: blockerExpiresAt
        })
      );
      expect(blocker.ok).toBe(true);
      if (!blocker.ok) {
        return;
      }

      const targetRequestId = `chat-expired-target-${randomUUID()}`;
      const target = await reservationStore().reserveChatCredits(
        chatReserveInput(fixture.userId, {
          requestId: targetRequestId,
          expiresAt: targetExpiresAt
        })
      );
      expect(target.ok).toBe(true);
      if (!target.ok) {
        return;
      }

      const expectedReservationIds = new Set([
        blocker.reservation.id,
        target.reservation.id
      ]);
      const boundedRows = await reservationStore().listExpiredChatReservations({
        now: recoveryNow,
        limit: 1
      });
      expect(boundedRows.length).toBeLessThanOrEqual(1);
      expect(boundedRows).toHaveLength(1);
      expect(
        boundedRows.every(
          (row) =>
            expectedReservationIds.has(row.id) &&
            row.status === CreditReservationStatus.RESERVED &&
            (row.kind === CreditReservationKind.CHAT_COMPLETION ||
              row.kind === CreditReservationKind.CHAT_STREAM) &&
            row.expiresAt.getTime() <= recoveryNow.getTime()
        )
      ).toBe(true);
      expect(boundedRows).toEqual([
        expect.objectContaining({
          id: blocker.reservation.id,
          userId: fixture.userId,
          requestId: blocker.reservation.requestId,
          kind: CreditReservationKind.CHAT_COMPLETION,
          amountCredits: 5,
          status: CreditReservationStatus.RESERVED,
          providerAttemptStartedAt: null
        })
      ]);
      expect(boundedRows.map((row) => row.id)).not.toContain(
        target.reservation.id
      );

      const allExpectedRows = await reservationStore().listExpiredChatReservations({
        now: recoveryNow,
        limit: 1000
      });
      expect(allExpectedRows.length).toBeLessThanOrEqual(1000);
      expect(
        allExpectedRows.every(
          (row) =>
            row.status === CreditReservationStatus.RESERVED &&
            (row.kind === CreditReservationKind.CHAT_COMPLETION ||
              row.kind === CreditReservationKind.CHAT_STREAM) &&
            row.expiresAt.getTime() <= recoveryNow.getTime()
        )
      ).toBe(true);
      const returnedFixtureIds = new Set(
        allExpectedRows
          .filter((row) => expectedReservationIds.has(row.id))
          .map((row) => row.id)
      );
      expect(returnedFixtureIds).toEqual(expectedReservationIds);
      expect(blockerExpiresAt.getTime()).toBeLessThan(targetExpiresAt.getTime());
      expect(Object.keys(boundedRows[0] ?? {}).sort()).toEqual([
        "amountCredits",
        "expiresAt",
        "id",
        "kind",
        "providerAttemptStartedAt",
        "requestId",
        "status",
        "userId"
      ]);

      await database().usageLog.createMany({
        data: [
          {
            userId: null,
            sessionId: null,
            model: "historical-null-attempt-one",
            status: "FAILED",
            costCredits: 0,
            requestId: null,
            attemptIndex: null,
            reservationId: null
          },
          {
            userId: null,
            sessionId: null,
            model: "historical-null-attempt-two",
            status: "FAILED",
            costCredits: 0,
            requestId: null,
            attemptIndex: null,
            reservationId: null
          }
        ]
      });
      await expect(
        database().usageLog.count({
          where: { requestId: null, attemptIndex: null, reservationId: null }
        })
      ).resolves.toBeGreaterThanOrEqual(2);

      const uniqueIndexes = await database().$queryRaw<Array<{ indexName: string }>>`
        SELECT INDEX_NAME AS indexName
        FROM information_schema.statistics
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'UsageLog'
          AND INDEX_NAME = 'UsageLog_requestId_attemptIndex_key'
        GROUP BY INDEX_NAME
      `;
      expect(uniqueIndexes).toHaveLength(1);
      const foreignKeys = await database().$queryRaw<Array<{ constraintName: string }>>`
        SELECT CONSTRAINT_NAME AS constraintName
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'UsageLog'
          AND COLUMN_NAME = 'reservationId'
          AND REFERENCED_TABLE_NAME = 'CreditReservation'
        GROUP BY CONSTRAINT_NAME
      `;
      expect(foreignKeys).toEqual([
        { constraintName: "UsageLog_reservationId_fkey" }
      ]);
    })
  );

  it("keeps the Memory Store contract equivalent for Chat credit lifecycle", async () => {
    const memory = createMemoryChatCreditStore();
    const userId = "memory-chat-user";
    const input = chatReserveInput(userId, {
      requestId: "memory-chat-request",
      creditCost: 4
    });

    const first = await memory.reserveChatCredits(input);
    expect(first).toMatchObject({
      ok: true,
      status: "CREATED",
      reservation: {
        userId,
        requestId: input.requestId,
        amountCredits: 4,
        status: CreditReservationStatus.RESERVED,
        providerAttemptStartedAt: null
      }
    });
    if (!first.ok) {
      return;
    }
    await expect(memory.reserveChatCredits(input)).resolves.toMatchObject({
      ok: true,
      status: "DUPLICATE",
      reservation: { id: first.reservation.id }
    });
    await expect(
      memory.reserveChatCredits({ ...input, creditCost: 5 })
    ).resolves.toEqual({ ok: false, reason: "IDEMPOTENCY_CONFLICT" });
    await expect(
      memory.reserveChatCredits({
        ...input,
        requestId: "memory-zero-cost",
        creditCost: 0
      })
    ).resolves.toEqual({ ok: false, reason: "INVALID_CONFIGURATION" });
    expect(memory.quota(userId)).toBe(16);
    expect(memory.events()).toEqual([
      expect.objectContaining({
        sourceType: "CHAT_CHARGE",
        deltaCredits: -4,
        balanceBefore: 20,
        balanceAfter: 16
      })
    ]);

    const startedAt = new Date("2030-07-28T01:00:00.000Z");
    await expect(
      memory.claimChatProviderAttempt({
        reservationId: first.reservation.id,
        requestId: input.requestId,
        attemptIndex: 0,
        modelId: input.modelId,
        startedAt
      })
    ).resolves.toMatchObject({
      status: "CLAIMED",
      attempt: { status: UsageLogAttemptStatus.STARTED }
    });
    await expect(
      memory.claimChatProviderAttempt({
        reservationId: first.reservation.id,
        requestId: input.requestId,
        attemptIndex: 0,
        modelId: input.modelId,
        startedAt: new Date("2030-07-28T01:01:00.000Z")
      })
    ).resolves.toMatchObject({ status: "ALREADY_CLAIMED" });
    await expect(
      memory.completeChatProviderAttempt({
        reservationId: first.reservation.id,
        requestId: input.requestId,
        attemptIndex: 0,
        status: "FAILED",
        completedAt: new Date("2030-07-28T01:00:01.000Z")
      })
    ).resolves.toMatchObject({ status: "UPDATED" });
    await expect(
      memory.claimChatProviderAttempt({
        reservationId: first.reservation.id,
        requestId: input.requestId,
        attemptIndex: 1,
        modelId: input.modelId,
        startedAt: new Date("2030-07-28T01:00:02.000Z")
      })
    ).resolves.toMatchObject({ status: "CLAIMED" });
    await expect(
      memory.completeChatProviderAttempt({
        reservationId: first.reservation.id,
        requestId: input.requestId,
        attemptIndex: 1,
        status: "SUCCEEDED"
      })
    ).resolves.toMatchObject({ status: "UPDATED" });
    expect(memory.attempts()).toEqual([
      expect.objectContaining({
        attemptIndex: 0,
        status: UsageLogAttemptStatus.FAILED,
        costCredits: 0
      }),
      expect.objectContaining({
        attemptIndex: 1,
        status: UsageLogAttemptStatus.SUCCEEDED,
        costCredits: 4
      })
    ]);

    await expect(
      memory.settleChatReservation(first.reservation.id)
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      memory.settleChatReservation(first.reservation.id)
    ).resolves.toEqual({ status: "ALREADY_SETTLED" });

    await expect(
      memory.claimChatProviderAttempt({
        reservationId: null,
        userId,
        requestId: "memory-free-request",
        attemptIndex: 0,
        modelId: "memory-free-model"
      })
    ).resolves.toMatchObject({
      status: "CLAIMED",
      attempt: { reservationId: null, status: UsageLogAttemptStatus.STARTED }
    });
    await expect(
      memory.completeChatProviderAttempt({
        reservationId: null,
        requestId: "memory-free-request",
        attemptIndex: 0,
        status: "SUCCEEDED"
      })
    ).resolves.toMatchObject({
      status: "UPDATED",
      attempt: { reservationId: null, costCredits: 0 }
    });
    await expect(
      memory.claimChatProviderAttempt({
        reservationId: null,
        userId,
        requestId: "memory-free-request",
        attemptIndex: 0,
        modelId: "memory-free-model"
      })
    ).resolves.toMatchObject({ status: "ALREADY_TERMINAL" });
    expect(memory.events()).toHaveLength(1);

    const releaseInput = chatReserveInput(userId, {
      requestId: "memory-stream-release",
      creditCost: 2,
      kind: CreditReservationKind.CHAT_STREAM
    });
    const released = await memory.reserveChatCredits(releaseInput);
    expect(released.ok).toBe(true);
    if (!released.ok) {
      return;
    }
    await expect(
      memory.releaseChatReservation(released.reservation.id)
    ).resolves.toEqual({ status: "UPDATED" });
    await expect(
      memory.releaseChatReservation(released.reservation.id)
    ).resolves.toEqual({ status: "ALREADY_RELEASED" });
    expect(memory.quota(userId)).toBe(16);
    expect(memory.events().map((event) => event.sourceType)).toEqual([
      "CHAT_CHARGE",
      "CHAT_STREAM_CHARGE",
      "CHAT_STREAM_RELEASE"
    ]);

    const expired = await memory.reserveChatCredits(
      chatReserveInput(userId, {
        requestId: "memory-expired",
        creditCost: 1,
        expiresAt: new Date("2030-07-28T00:00:00.000Z")
      })
    );
    expect(expired.ok).toBe(true);
    await expect(
      memory.listExpiredChatReservations({
        now: new Date("2030-07-28T01:00:00.000Z"),
        limit: 1
      })
    ).resolves.toHaveLength(1);
  });
});
