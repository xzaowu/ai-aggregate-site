import { randomUUID } from "node:crypto";
import {
  CreditReservationKind,
  PrismaClient,
  UserTokenKind
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
  createAccountCreditEventInTransaction,
  createPrismaUserStore,
  type AccountCreditEventMetadata,
  type CreateAccountCreditEventInput
} from "../src/store";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
  const databaseSuite = databaseUrl ? describe : describe.skip;
const fixtureUserPrefix = "s5d1a_credit_event_";

databaseSuite.sequential("AccountCreditEvent Store foundation", () => {
  let prisma: PrismaClient | undefined;
  let concurrentPrisma: PrismaClient | undefined;
  const fixtureUserIds = new Set<string>();
  const fixturePlanIds = new Set<string>();
  const fixtureOrderIds = new Set<string>();

  function database(): PrismaClient {
    if (!prisma) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }
    return prisma;
  }

  function concurrentDatabase(): PrismaClient {
    if (!concurrentPrisma) {
      throw new Error("TEST_CONCURRENT_DATABASE_NOT_INITIALIZED");
    }
    return concurrentPrisma;
  }

  function store() {
    return createPrismaUserStore(database());
  }

  function fixtureInput(
    userId: string,
    overrides: Partial<CreateAccountCreditEventInput> = {}
  ): CreateAccountCreditEventInput {
    return {
      userId,
      deltaCredits: 4,
      balanceBefore: 8,
      balanceAfter: 12,
      sourceType: "FIXTURE_GRANT",
      sourceId: "fixture-source",
      idempotencyKey: `fixture-key-${randomUUID()}`,
      ...overrides
    };
  }

  function registrationInput(email = `register-${randomUUID()}@example.test`) {
    return {
      email,
      passwordHash: "fixture-registration-password-hash",
      tokenHash: randomUUID().replaceAll("-", "").repeat(2),
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    };
  }

  async function createFixtureUser(input: {
    credits?: number;
    remainingCredits?: number;
    withQuota?: boolean;
  } = {}): Promise<{ userId: string }> {
    const userId = `${fixtureUserPrefix}${randomUUID()}`;
    fixtureUserIds.add(userId);
    await database().user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "fixture-password-hash",
        credits: input.credits ?? 1000,
        ...(input.withQuota === false
          ? {}
          : {
              quota: {
                create: {
                  remainingCredits: input.remainingCredits ?? 20
                }
              }
            })
      }
    });
    return { userId };
  }

  async function createFixtureOrder(input: {
    userId: string;
    credits: number;
  }): Promise<{ orderId: string; planId: string }> {
    const planId = `s5d1b_plan_${randomUUID()}`;
    const orderId = `s5d1b_order_${randomUUID()}`;
    fixturePlanIds.add(planId);
    fixtureOrderIds.add(orderId);
    await database().plan.create({
      data: {
        id: planId,
        name: "S5-D1B fixture plan",
        slug: `s5d1b-${randomUUID()}`,
        price: 100,
        credits: input.credits,
        description: "fixture",
        features: []
      }
    });
    await database().order.create({
      data: {
        id: orderId,
        userId: input.userId,
        planId,
        amount: 100,
        credits: input.credits
      }
    });
    return { orderId, planId };
  }

  async function createEvent(
    input: CreateAccountCreditEventInput,
    client = database()
  ) {
    return client.$transaction((tx) =>
      createAccountCreditEventInTransaction(tx, input)
    );
  }

  function storageInput(overrides: Partial<{
    priceCredits: number;
    durationDays: number;
    idempotencyKey: string;
  }> = {}) {
    return {
      priceCredits: 6,
      durationDays: 30,
      description: "fixture storage package",
      autoRenewEnabled: false,
      idempotencyKey: `storage-request-${randomUUID()}`,
      ...overrides
    };
  }

  function checkInInput(overrides: Partial<{
    dateKey: string;
    dailyRewardCredits: number;
    streakRewards: Record<string, number>;
  }> = {}) {
    return {
      dateKey: "2030-07-27",
      dailyRewardCredits: 3,
      streakRewards: { "1": 2 },
      ...overrides
    };
  }

  async function cleanupFixtures(): Promise<void> {
    const userIds = [...fixtureUserIds];
    const planIds = [...fixturePlanIds];
    const orderIds = [...fixtureOrderIds];
    if (userIds.length === 0 && planIds.length === 0) {
      return;
    }

    await retryPrismaWriteConflict(async () => {
      if (orderIds.length > 0) {
        await database().order.deleteMany({ where: { id: { in: orderIds } } });
      }
      if (userIds.length > 0) {
        await database().adminAuditLog.deleteMany({
          where: {
            OR: [
              { adminUserId: { in: userIds } },
              { targetId: { in: userIds } }
            ]
          }
        });
      }
      await database().accountCreditEvent.deleteMany({
        where: { userId: { in: userIds } }
      });
      if (userIds.length > 0) {
        await database().user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (planIds.length > 0) {
        await database().plan.deleteMany({ where: { id: { in: planIds } } });
      }
    });
    fixtureUserIds.clear();
    fixturePlanIds.clear();
    fixtureOrderIds.clear();
  }

  it("records a storage purchase from the real quota balance in one transaction", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 20 });
    const input = storageInput();
    const storageStore = store();
    if (!storageStore.activateStoragePackage) {
      throw new Error("TEST_STORAGE_STORE_UNAVAILABLE");
    }

    const result = await storageStore.activateStoragePackage(fixture.userId, input);
    const subscription = await database().userStorageSubscription.findUniqueOrThrow({
      where: { userId: fixture.userId }
    });
    const ledger = await database().accountLedger.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey }
    });
    const event = await database().accountCreditEvent.findUniqueOrThrow({
      where: { idempotencyKey: `storage-purchase:${input.idempotencyKey}` }
    });

    expect(result).toMatchObject({
      quota: { userId: fixture.userId, remainingCredits: 14 },
      alreadyActive: false
    });
    expect(ledger).toMatchObject({
      userId: fixture.userId,
      kind: "STORAGE_PACKAGE",
      creditsDelta: -6,
      idempotencyKey: input.idempotencyKey,
      relatedRecordId: subscription.id
    });
    expect(event).toMatchObject({
      userId: fixture.userId,
      deltaCredits: -6,
      balanceBefore: 20,
      balanceAfter: 14,
      sourceType: "STORAGE_PACKAGE_CHARGE",
      sourceId: subscription.id,
      idempotencyKey: `storage-purchase:${input.idempotencyKey}`,
      metadata: null
    });
    expect(event.balanceAfter).toBe(
      (await database().userQuota.findUniqueOrThrow({ where: { userId: fixture.userId } }))
        .remainingCredits
    );
    expect(JSON.stringify(event)).not.toContain("example.test");
  });

  it("replays a storage purchase without a second quota, ledger, subscription, or event", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 20 });
    const input = storageInput();
    const storageStore = store();
    if (!storageStore.activateStoragePackage) {
      throw new Error("TEST_STORAGE_STORE_UNAVAILABLE");
    }

    const first = await storageStore.activateStoragePackage(fixture.userId, input);
    const replay = await storageStore.activateStoragePackage(fixture.userId, input);

    expect(first.quota.remainingCredits).toBe(14);
    expect(replay).toMatchObject({
      quota: { remainingCredits: 14 },
      alreadyActive: false
    });
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
    await expect(
      database().userStorageSubscription.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("serializes concurrent storage purchase retries to one event", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 20 });
    const input = storageInput();
    const firstStore = store();
    const secondStore = createPrismaUserStore(concurrentDatabase());
    if (!firstStore.activateStoragePackage || !secondStore.activateStoragePackage) {
      throw new Error("TEST_STORAGE_STORE_UNAVAILABLE");
    }

    const [first, second] = await Promise.all([
      firstStore.activateStoragePackage(fixture.userId, input),
      secondStore.activateStoragePackage(fixture.userId, input)
    ]);

    expect(first.quota.remainingCredits).toBe(14);
    expect(second.quota.remainingCredits).toBe(14);
    await expect(
      database().accountCreditEvent.count({
        where: { userId: fixture.userId, sourceType: "STORAGE_PACKAGE_CHARGE" }
      })
    ).resolves.toBe(1);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("does not write storage facts when the quota is insufficient", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 5 });
    const input = storageInput({ priceCredits: 6 });
    const storageStore = store();
    if (!storageStore.activateStoragePackage) {
      throw new Error("TEST_STORAGE_STORE_UNAVAILABLE");
    }

    await expect(
      storageStore.activateStoragePackage(fixture.userId, input)
    ).rejects.toThrow("INSUFFICIENT_CREDITS");
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 5 });
    await expect(
      database().userStorageSubscription.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("rolls back storage quota, subscription, ledger, and event when the event fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 20 });
    const input = storageInput();
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialCreditEventCreated() {
          throw new Error("FIXTURE_STORAGE_EVENT_FAILURE");
        }
      }
    });
    if (!failingStore.activateStoragePackage) {
      throw new Error("TEST_STORAGE_STORE_UNAVAILABLE");
    }

    await expect(
      failingStore.activateStoragePackage(fixture.userId, input)
    ).rejects.toThrow("FIXTURE_STORAGE_EVENT_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
    await expect(
      database().userStorageSubscription.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("rolls back storage quota and subscription when the ledger write phase fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 20 });
    const input = storageInput();
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterStorageLedgerCreated() {
          throw new Error("FIXTURE_STORAGE_LEDGER_FAILURE");
        }
      }
    });
    if (!failingStore.activateStoragePackage) {
      throw new Error("TEST_STORAGE_STORE_UNAVAILABLE");
    }

    await expect(
      failingStore.activateStoragePackage(fixture.userId, input)
    ).rejects.toThrow("FIXTURE_STORAGE_LEDGER_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
    await expect(
      database().userStorageSubscription.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("rolls back storage quota when the subscription write phase fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 20 });
    const input = storageInput();
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterStorageSubscriptionCreated() {
          throw new Error("FIXTURE_STORAGE_SUBSCRIPTION_FAILURE");
        }
      }
    });
    if (!failingStore.activateStoragePackage) {
      throw new Error("TEST_STORAGE_STORE_UNAVAILABLE");
    }

    await expect(
      failingStore.activateStoragePackage(fixture.userId, input)
    ).rejects.toThrow("FIXTURE_STORAGE_SUBSCRIPTION_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
    await expect(
      database().userStorageSubscription.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("keeps a free storage package in AccountLedger without a zero event", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 20 });
    const input = storageInput({ priceCredits: 0 });
    const storageStore = store();
    if (!storageStore.activateStoragePackage) {
      throw new Error("TEST_STORAGE_STORE_UNAVAILABLE");
    }

    const result = await storageStore.activateStoragePackage(fixture.userId, input);
    const subscription = await database().userStorageSubscription.findUniqueOrThrow({
      where: { userId: fixture.userId }
    });

    expect(result.quota.remainingCredits).toBe(20);
    await expect(
      database().accountLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
    ).resolves.toMatchObject({ creditsDelta: 0, relatedRecordId: subscription.id });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("records the first daily check-in reward with the real quota balance", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 5 });
    const input = checkInInput();
    const checkInStore = store();
    if (!checkInStore.claimDailyCheckIn) {
      throw new Error("TEST_CHECKIN_STORE_UNAVAILABLE");
    }

    const result = await checkInStore.claimDailyCheckIn(fixture.userId, input);
    const checkIn = await database().dailyCheckIn.findUniqueOrThrow({
      where: { userId_checkInDate: { userId: fixture.userId, checkInDate: input.dateKey } }
    });
    const ledger = await database().accountLedger.findUniqueOrThrow({
      where: { idempotencyKey: `check-in:${fixture.userId}:${input.dateKey}` }
    });
    const event = await database().accountCreditEvent.findUniqueOrThrow({
      where: { idempotencyKey: `check-in:${fixture.userId}:${input.dateKey}` }
    });

    expect(result).toMatchObject({
      quota: { userId: fixture.userId, remainingCredits: 10 },
      alreadyCheckedIn: false
    });
    expect(ledger).toMatchObject({
      userId: fixture.userId,
      kind: "CHECK_IN",
      creditsDelta: 5,
      idempotencyKey: `check-in:${fixture.userId}:${input.dateKey}`,
      relatedRecordId: checkIn.id
    });
    expect(event).toMatchObject({
      userId: fixture.userId,
      deltaCredits: 5,
      balanceBefore: 5,
      balanceAfter: 10,
      sourceType: "CHECKIN_REWARD",
      sourceId: checkIn.id,
      idempotencyKey: `check-in:${fixture.userId}:${input.dateKey}`,
      metadata: { checkInDate: input.dateKey, rewardType: "DAILY_CHECKIN" }
    });
    expect(JSON.stringify(event)).not.toContain("example.test");
  });

  it("replays and serializes concurrent daily check-in claims once", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 5 });
    const input = checkInInput({ streakRewards: {} });
    const firstStore = store();
    const secondStore = createPrismaUserStore(concurrentDatabase());
    if (!firstStore.claimDailyCheckIn || !secondStore.claimDailyCheckIn) {
      throw new Error("TEST_CHECKIN_STORE_UNAVAILABLE");
    }

    const [first, second] = await Promise.all([
      firstStore.claimDailyCheckIn(fixture.userId, input),
      secondStore.claimDailyCheckIn(fixture.userId, input)
    ]);
    const replay = await firstStore.claimDailyCheckIn(fixture.userId, input);

    expect([first.alreadyCheckedIn, second.alreadyCheckedIn].sort()).toEqual([false, true]);
    expect(replay).toMatchObject({ alreadyCheckedIn: true, quota: { remainingCredits: 8 } });
    await expect(
      database().dailyCheckIn.count({ where: { userId: fixture.userId, checkInDate: input.dateKey } })
    ).resolves.toBe(1);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId, sourceType: "CHECKIN_REWARD" } })
    ).resolves.toBe(1);
  });

  it("rolls back daily check-in quota, record, ledger, and event when the event fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 5 });
    const input = checkInInput();
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialCreditEventCreated() {
          throw new Error("FIXTURE_CHECKIN_EVENT_FAILURE");
        }
      }
    });
    if (!failingStore.claimDailyCheckIn) {
      throw new Error("TEST_CHECKIN_STORE_UNAVAILABLE");
    }

    await expect(
      failingStore.claimDailyCheckIn(fixture.userId, input)
    ).rejects.toThrow("FIXTURE_CHECKIN_EVENT_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 5 });
    await expect(
      database().dailyCheckIn.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("rolls back daily check-in quota and record when the ledger write phase fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 5 });
    const input = checkInInput();
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterDailyLedgerCreated() {
          throw new Error("FIXTURE_CHECKIN_LEDGER_FAILURE");
        }
      }
    });
    if (!failingStore.claimDailyCheckIn) {
      throw new Error("TEST_CHECKIN_STORE_UNAVAILABLE");
    }

    await expect(
      failingStore.claimDailyCheckIn(fixture.userId, input)
    ).rejects.toThrow("FIXTURE_CHECKIN_LEDGER_FAILURE");
    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 5 });
    await expect(
      database().dailyCheckIn.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountLedger.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("allows a zero-reward check-in without creating a zero-delta event", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 5 });
    const input = checkInInput({ dailyRewardCredits: 0, streakRewards: {} });
    const checkInStore = store();
    if (!checkInStore.claimDailyCheckIn) {
      throw new Error("TEST_CHECKIN_STORE_UNAVAILABLE");
    }

    const result = await checkInStore.claimDailyCheckIn(fixture.userId, input);

    expect(result).toMatchObject({
      quota: { remainingCredits: 5 },
      alreadyCheckedIn: false
    });
    await expect(
      database().accountLedger.findUnique({
        where: { idempotencyKey: `check-in:${fixture.userId}:${input.dateKey}` }
      })
    ).resolves.toMatchObject({ creditsDelta: 0 });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  async function insertRawEvent(input: {
    id: string;
    userId: string;
    deltaCredits: number;
    balanceBefore: number;
    balanceAfter: number;
    idempotencyKey: string;
  }): Promise<void> {
    await database().$executeRaw`
      INSERT INTO AccountCreditEvent
        (id, userId, deltaCredits, balanceBefore, balanceAfter, sourceType, sourceId, idempotencyKey)
      VALUES
        (${input.id}, ${input.userId}, ${input.deltaCredits}, ${input.balanceBefore}, ${input.balanceAfter}, "FIXTURE_RAW", "fixture-raw", ${input.idempotencyKey})
    `;
  }

  beforeAll(async () => {
    if (!databaseUrl) {
      return;
    }

    const parsedDatabaseUrl = new URL(databaseUrl);
    if (
      parsedDatabaseUrl.protocol !== "mysql:" ||
      parsedDatabaseUrl.hostname !== "127.0.0.1" ||
      parsedDatabaseUrl.port !== "3308" ||
      parsedDatabaseUrl.pathname !== "/ai_aggregate_s13c1a"
    ) {
      throw new Error("TEST_DATABASE_MUST_BE_LOCAL_DISPOSABLE_S13C1A_MYSQL");
    }

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    concurrentPrisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
    await Promise.all([prisma.$connect(), concurrentPrisma.$connect()]);
  });

  beforeEach(async () => {
    await cleanupFixtures();
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    try {
      await cleanupFixtures();
    } finally {
      await Promise.all([
        prisma?.$disconnect(),
        concurrentPrisma?.$disconnect()
      ]);
    }
  });

  it("creates a user quota and one initial event atomically", async () => {
    const email = `${fixtureUserPrefix}${randomUUID()}@example.test`;
    const user = await store().createUser({
      email,
      passwordHash: "fixture-create-user-password-hash"
    });
    fixtureUserIds.add(user.id);

    const quota = await database().userQuota.findUniqueOrThrow({
      where: { userId: user.id }
    });
    const events = await database().accountCreditEvent.findMany({
      where: { userId: user.id }
    });

    expect(quota.remainingCredits).toBe(20);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: user.id,
      deltaCredits: 20,
      balanceBefore: 0,
      balanceAfter: 20,
      sourceType: "USER_INITIAL_GRANT",
      sourceId: user.id,
      idempotencyKey: `user-init:${user.id}`,
      metadata: null
    });
    expect(events[0]).not.toHaveProperty("email");
  });

  it("rolls back createUser when its initial event fails", async () => {
    const email = `${fixtureUserPrefix}${randomUUID()}@example.test`;
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialCreditEventCreated() {
          throw new Error("FIXTURE_INITIAL_EVENT_FAILURE");
        }
      }
    });

    await expect(
      failingStore.createUser({
        email,
        passwordHash: "fixture-create-user-failure-password-hash"
      })
    ).rejects.toThrow("FIXTURE_INITIAL_EVENT_FAILURE");
    await expect(database().user.findUnique({ where: { email } })).resolves.toBeNull();
  });

  it("creates an unverified registration quota, token, and initial event atomically", async () => {
    const input = registrationInput();
    const result = await store().registerUnverifiedUserAndIssueEmailVerificationToken(
      input
    );
    if (result.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_CREATED_UNVERIFIED_USER");
    }
    fixtureUserIds.add(result.userId);

    await expect(
      database().userQuota.findUnique({ where: { userId: result.userId } })
    ).resolves.toMatchObject({ remainingCredits: 20 });
    await expect(
      database().userToken.findUnique({
        where: {
          userId_kind: {
            userId: result.userId,
            kind: UserTokenKind.EMAIL_VERIFICATION
          }
        }
      })
    ).resolves.toMatchObject({
      userId: result.userId,
      tokenHash: input.tokenHash,
      usedAt: null
    });
    await expect(
      database().accountCreditEvent.findMany({
        where: { userId: result.userId }
      })
    ).resolves.toMatchObject([
      {
        deltaCredits: 20,
        balanceBefore: 0,
        balanceAfter: 20,
        sourceType: "REGISTER_UNVERIFIED_INITIAL_GRANT",
        sourceId: result.userId,
        idempotencyKey: `register-init:${result.userId}`,
        metadata: null
      }
    ]);
  });

  it("rolls back unverified registration user, quota, token, and event together", async () => {
    const input = registrationInput();
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialCreditEventCreated() {
          throw new Error("FIXTURE_REGISTER_INITIAL_EVENT_FAILURE");
        }
      }
    });

    await expect(
      failingStore.registerUnverifiedUserAndIssueEmailVerificationToken(input)
    ).rejects.toThrow("FIXTURE_REGISTER_INITIAL_EVENT_FAILURE");
    await expect(database().user.findUnique({ where: { email: input.email } })).resolves.toBeNull();
    await expect(
      database().userToken.count({ where: { tokenHash: input.tokenHash } })
    ).resolves.toBe(0);
  });

  it("does not create a second initial event for duplicate registrations", async () => {
    const input = registrationInput();
    const first = await store().registerUnverifiedUserAndIssueEmailVerificationToken(input);
    if (first.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_CREATED_DUPLICATE_REGISTRATION");
    }
    fixtureUserIds.add(first.userId);

    await expect(
      store().registerUnverifiedUserAndIssueEmailVerificationToken({
        ...input,
        tokenHash: randomUUID().replaceAll("-", "").repeat(2)
      })
    ).resolves.toEqual({ status: "EXISTING_UNVERIFIED" });
    await database().user.update({
      where: { id: first.userId },
      data: { emailVerifiedAt: new Date() }
    });
    await expect(
      store().registerUnverifiedUserAndIssueEmailVerificationToken({
        ...input,
        tokenHash: randomUUID().replaceAll("-", "").repeat(2)
      })
    ).resolves.toEqual({ status: "ALREADY_VERIFIED" });
    await expect(
      database().accountCreditEvent.count({ where: { userId: first.userId } })
    ).resolves.toBe(1);
  });

  it("lazily creates one quota and one initial event when quota is missing", async () => {
    const fixture = await createFixtureUser({ withQuota: false });
    const quota = await store().getQuota(fixture.userId);
    const persistedQuota = await database().userQuota.findUniqueOrThrow({
      where: { userId: fixture.userId }
    });
    const event = await database().accountCreditEvent.findUniqueOrThrow({
      where: { idempotencyKey: `quota-init:${fixture.userId}` }
    });

    expect(quota).toEqual({ userId: fixture.userId, remainingCredits: 20 });
    expect(event).toMatchObject({
      userId: fixture.userId,
      deltaCredits: 20,
      balanceBefore: 0,
      balanceAfter: 20,
      sourceType: "QUOTA_INITIALIZE",
      sourceId: persistedQuota.id,
      metadata: null
    });
  });

  it("does not backfill an initial event for an existing quota", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 7 });

    await expect(store().getQuota(fixture.userId)).resolves.toEqual({
      userId: fixture.userId,
      remainingCredits: 7
    });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("converges concurrent lazy quota initialization to one quota and event", async () => {
    const fixture = await createFixtureUser({ withQuota: false });
    const [first, second] = await Promise.all([
      store().getQuota(fixture.userId),
      createPrismaUserStore(concurrentDatabase()).getQuota(fixture.userId)
    ]);

    expect(first).toEqual({ userId: fixture.userId, remainingCredits: 20 });
    expect(second).toEqual(first);
    await expect(
      database().userQuota.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("creates zero-credit quotas without a zero-delta event", async () => {
    const zeroStore = createPrismaUserStore(database(), {
      testHooks: { initialUserQuotaCredits: 0 }
    });
    const user = await zeroStore.createUser({
      email: `${fixtureUserPrefix}${randomUUID()}@example.test`,
      passwordHash: "fixture-zero-create-password-hash"
    });
    fixtureUserIds.add(user.id);

    const lazyFixture = await createFixtureUser({ withQuota: false });
    const registration = registrationInput();
    const registered = await zeroStore.registerUnverifiedUserAndIssueEmailVerificationToken(
      registration
    );
    if (registered.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_CREATED_ZERO_REGISTRATION");
    }
    fixtureUserIds.add(registered.userId);

    await expect(
      zeroStore.getQuota(lazyFixture.userId)
    ).resolves.toEqual({ userId: lazyFixture.userId, remainingCredits: 0 });
    for (const userId of [user.id, lazyFixture.userId, registered.userId]) {
      await expect(
        database().accountCreditEvent.count({ where: { userId } })
      ).resolves.toBe(0);
    }
  });

  it("keeps zero existing quota free of zero-delta and opening events", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 0 });

    await expect(store().getQuota(fixture.userId)).resolves.toEqual({
      userId: fixture.userId,
      remainingCredits: 0
    });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("persists a positive event with all fields and a database createdAt", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 8 });
    const now = new Date("2030-07-27T12:00:00.000Z");

    const result = await createEvent(
      fixtureInput(fixture.userId, {
        deltaCredits: 4,
        balanceBefore: 8,
        balanceAfter: 12,
        sourceType: "USER_INITIAL_GRANT",
        sourceId: fixture.userId,
        idempotencyKey: "fixture-positive-event",
        now
      })
    );

    expect(result.status).toBe("CREATED");
    expect(result.event).toMatchObject({
      userId: fixture.userId,
      deltaCredits: 4,
      balanceBefore: 8,
      balanceAfter: 12,
      sourceType: "USER_INITIAL_GRANT",
      sourceId: fixture.userId,
      idempotencyKey: "fixture-positive-event",
      metadata: null,
      createdAt: now
    });
    expect(result.event.createdAt).toBeInstanceOf(Date);
    await expect(
      database().accountCreditEvent.findUnique({
        where: { idempotencyKey: "fixture-positive-event" }
      })
    ).resolves.toMatchObject({
      userId: fixture.userId,
      deltaCredits: 4,
      balanceBefore: 8,
      balanceAfter: 12,
      sourceType: "USER_INITIAL_GRANT",
      sourceId: fixture.userId,
      idempotencyKey: "fixture-positive-event",
      metadata: null,
      createdAt: now
    });
  });

  it("persists a negative event", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 12 });

    const result = await createEvent(
      fixtureInput(fixture.userId, {
        deltaCredits: -3,
        balanceBefore: 12,
        balanceAfter: 9,
        sourceType: "CHAT_CHARGE",
        sourceId: "fixture-chat-charge",
        idempotencyKey: "fixture-negative-event"
      })
    );

    expect(result).toMatchObject({
      status: "CREATED",
      event: {
        userId: fixture.userId,
        deltaCredits: -3,
        balanceBefore: 12,
        balanceAfter: 9
      }
    });
  });

  it("persists safe scalar metadata as a read-only record", async () => {
    const fixture = await createFixtureUser();
    const metadata = {
      status: "SUCCEEDED",
      attemptIndex: 1,
      label: "fixture"
    } satisfies AccountCreditEventMetadata;

    const result = await createEvent(
      fixtureInput(fixture.userId, {
        idempotencyKey: "fixture-safe-metadata",
        metadata
      })
    );

    expect(result.event.metadata).toEqual(metadata);
    await expect(
      database().accountCreditEvent.findUnique({
        where: { idempotencyKey: "fixture-safe-metadata" }
      })
    ).resolves.toMatchObject({ metadata });
  });

  it("rejects deltaCredits=0", async () => {
    const fixture = await createFixtureUser();

    await expect(
      createEvent(
        fixtureInput(fixture.userId, {
          deltaCredits: 0,
          balanceBefore: 10,
          balanceAfter: 10,
          idempotencyKey: "fixture-zero-delta"
        })
      )
    ).rejects.toThrow("INVALID_ACCOUNT_CREDIT_EVENT_DELTA");
  });

  it("rejects a non-conserving balance", async () => {
    const fixture = await createFixtureUser();

    await expect(
      createEvent(
        fixtureInput(fixture.userId, {
          deltaCredits: 2,
          balanceBefore: 10,
          balanceAfter: 11,
          idempotencyKey: "fixture-balance-mismatch"
        })
      )
    ).rejects.toThrow("INVALID_ACCOUNT_CREDIT_EVENT_BALANCE");
  });

  it.each([
    ["sourceType", { sourceType: "   " }, "INVALID_ACCOUNT_CREDIT_EVENT_SOURCE_TYPE"],
    ["sourceId", { sourceId: "   " }, "INVALID_ACCOUNT_CREDIT_EVENT_SOURCE_ID"],
    [
      "idempotencyKey",
      { idempotencyKey: "   " },
      "INVALID_ACCOUNT_CREDIT_EVENT_IDEMPOTENCY_KEY"
    ]
  ] as const)("rejects blank %s", async (_field, overrides, errorCode) => {
    const fixture = await createFixtureUser();

    await expect(
      createEvent(fixtureInput(fixture.userId, overrides))
    ).rejects.toThrow(errorCode);
  });

  it.each([
    ["sourceType", { sourceType: "x".repeat(65) }, "INVALID_ACCOUNT_CREDIT_EVENT_SOURCE_TYPE"],
    ["sourceId", { sourceId: "x".repeat(192) }, "INVALID_ACCOUNT_CREDIT_EVENT_SOURCE_ID"],
    [
      "idempotencyKey",
      { idempotencyKey: "x".repeat(192) },
      "INVALID_ACCOUNT_CREDIT_EVENT_IDEMPOTENCY_KEY"
    ]
  ] as const)("rejects overlong %s", async (_field, overrides, errorCode) => {
    const fixture = await createFixtureUser();

    await expect(
      createEvent(fixtureInput(fixture.userId, overrides))
    ).rejects.toThrow(errorCode);
  });

  it("rejects unsafe metadata keys before persistence", async () => {
    const fixture = await createFixtureUser();
    const metadata = { responseBody: "not allowed" } as AccountCreditEventMetadata;

    await expect(
      createEvent(
        fixtureInput(fixture.userId, {
          idempotencyKey: "fixture-unsafe-metadata",
          metadata
        })
      )
    ).rejects.toThrow("INVALID_ACCOUNT_CREDIT_EVENT_METADATA");
  });

  it("returns the existing event for a repeated idempotency key", async () => {
    const fixture = await createFixtureUser();
    const input = fixtureInput(fixture.userId, {
      idempotencyKey: "fixture-repeat-key"
    });

    const first = await createEvent(input);
    const second = await createEvent({
      ...input,
      deltaCredits: -2,
      balanceBefore: 12,
      balanceAfter: 10,
      sourceType: "DIFFERENT_SOURCE"
    });

    expect(first.status).toBe("CREATED");
    expect(second.status).toBe("DUPLICATE");
    expect(second.event.id).toBe(first.event.id);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("converges concurrent writes to one event", async () => {
    const fixture = await createFixtureUser();
    const input = fixtureInput(fixture.userId, {
      idempotencyKey: "fixture-concurrent-key"
    });

    const results = await Promise.all([
      createEvent(input),
      createEvent(input, concurrentDatabase())
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "CREATED",
      "DUPLICATE"
    ]);
    expect(new Set(results.map((result) => result.event.id))).toHaveLength(1);
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("allows different idempotency keys for the same sourceType and sourceId", async () => {
    const fixture = await createFixtureUser();

    await expect(
      createEvent(
        fixtureInput(fixture.userId, {
          deltaCredits: -4,
          balanceBefore: 20,
          balanceAfter: 16,
          sourceType: "TASK",
          sourceId: "task-charge-release",
          idempotencyKey: "fixture-task-charge"
        })
      )
    ).resolves.toMatchObject({ status: "CREATED" });
    await expect(
      createEvent(
        fixtureInput(fixture.userId, {
          deltaCredits: 4,
          balanceBefore: 16,
          balanceAfter: 20,
          sourceType: "TASK",
          sourceId: "task-charge-release",
          idempotencyKey: "fixture-task-release"
        })
      )
    ).resolves.toMatchObject({ status: "CREATED" });

    await expect(
      database().accountCreditEvent.count({
        where: { sourceType: "TASK", sourceId: "task-charge-release" }
      })
    ).resolves.toBe(2);
  });

  it("reads by idempotency key and lists a bounded stable user timeline", async () => {
    const fixture = await createFixtureUser();
    const firstAt = new Date("2030-07-27T12:00:00.000Z");
    const secondAt = new Date("2030-07-27T12:01:00.000Z");
    const thirdAt = new Date("2030-07-27T12:02:00.000Z");

    await createEvent(
      fixtureInput(fixture.userId, {
        idempotencyKey: "fixture-timeline-first",
        now: firstAt
      })
    );
    await createEvent(
      fixtureInput(fixture.userId, {
        idempotencyKey: "fixture-timeline-second",
        now: secondAt
      })
    );
    await createEvent(
      fixtureInput(fixture.userId, {
        idempotencyKey: "fixture-timeline-third",
        now: thirdAt
      })
    );

    const eventStore = store();
    await expect(
      eventStore.findAccountCreditEventByIdempotencyKey(
        "fixture-timeline-second"
      )
    ).resolves.toMatchObject({ idempotencyKey: "fixture-timeline-second" });

    const events = await eventStore.listAccountCreditEventsForUser(
      fixture.userId,
      2
    );
    expect(events.map((event) => event.idempotencyKey)).toEqual([
      "fixture-timeline-third",
      "fixture-timeline-second"
    ]);
    await expect(
      eventStore.listAccountCreditEventsForUser(fixture.userId, 101)
    ).rejects.toThrow("INVALID_ACCOUNT_CREDIT_EVENT_LIMIT");
  });

  it("rejects an event for a missing user with a safe Store error", async () => {
    await expect(
      createEvent(
        fixtureInput(`${fixtureUserPrefix}missing-${randomUUID()}`, {
          idempotencyKey: "fixture-missing-user"
        })
      )
    ).rejects.toThrow("ACCOUNT_CREDIT_EVENT_USER_NOT_FOUND");
  });

  it("protects a user with events from deletion", async () => {
    const fixture = await createFixtureUser();
    await createEvent(
      fixtureInput(fixture.userId, { idempotencyKey: "fixture-restrict" })
    );

    await expect(
      database().user.delete({ where: { id: fixture.userId } })
    ).rejects.toBeDefined();
    await expect(
      database().user.findUnique({ where: { id: fixture.userId } })
    ).resolves.toMatchObject({ id: fixture.userId });
  });

  it("does not expose mutable event methods or a standalone write method", async () => {
    const eventStore = store();

    expect(eventStore).not.toHaveProperty("createAccountCreditEvent");
    expect(eventStore).not.toHaveProperty("updateAccountCreditEvent");
    expect(eventStore).not.toHaveProperty("deleteAccountCreditEvent");
  });

  it("does not create an opening balance event", async () => {
    const fixture = await createFixtureUser();

    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("leaves AccountLedger unchanged", async () => {
    const fixture = await createFixtureUser();
    const ledger = await database().accountLedger.create({
      data: {
        id: `fixture-ledger-${randomUUID()}`,
        userId: fixture.userId,
        kind: "CHECK_IN",
        title: "Fixture ledger",
        creditsDelta: 1,
        status: "SUCCESS",
        idempotencyKey: `fixture-ledger-key-${randomUUID()}`
      }
    });

    await createEvent(
      fixtureInput(fixture.userId, { idempotencyKey: "fixture-ledger-event" })
    );

    await expect(
      database().accountLedger.findUnique({ where: { id: ledger.id } })
    ).resolves.toMatchObject({
      id: ledger.id,
      userId: fixture.userId,
      creditsDelta: 1,
      status: "SUCCESS"
    });
  });

  it("enforces deltaCredits CHECK in MySQL", async () => {
    const fixture = await createFixtureUser();

    await expect(
      insertRawEvent({
        id: `fixture-raw-zero-${randomUUID()}`,
        userId: fixture.userId,
        deltaCredits: 0,
        balanceBefore: 10,
        balanceAfter: 10,
        idempotencyKey: `fixture-raw-zero-key-${randomUUID()}`
      })
    ).rejects.toBeDefined();
  });

  it("enforces balance conservation CHECK in MySQL", async () => {
    const fixture = await createFixtureUser();

    await expect(
      insertRawEvent({
        id: `fixture-raw-balance-${randomUUID()}`,
        userId: fixture.userId,
        deltaCredits: 2,
        balanceBefore: 10,
        balanceAfter: 11,
        idempotencyKey: `fixture-raw-balance-key-${randomUUID()}`
      })
    ).rejects.toBeDefined();
  });

  it("adjusts quota from the real UserQuota balance and records a positive event and audit", async () => {
    const fixture = await createFixtureUser({ credits: 9000, remainingCredits: 30 });
    const result = await store().adjustUserQuotaWithAudit({
      userId: fixture.userId,
      remainingCredits: 45,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });

    expect(result).toMatchObject({
      status: "UPDATED",
      balanceBefore: 30,
      balanceAfter: 45,
      deltaCredits: 15,
      quota: { userId: fixture.userId, remainingCredits: 45 },
      creditEvent: {
        userId: fixture.userId,
        deltaCredits: 15,
        balanceBefore: 30,
        balanceAfter: 45,
        sourceType: "ADMIN_QUOTA_ADJUSTMENT",
        sourceId: expect.any(String),
        idempotencyKey: expect.stringMatching(/^admin-adjust:/u)
      },
      auditLog: {
        adminUserId: fixture.userId,
        action: "UPDATE_USER_QUOTA",
        targetType: "User",
        targetId: fixture.userId
      }
    });
    expect(result?.creditEvent?.metadata?.adminAuditId).toBe(result?.auditLog.id);
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 45 });
  });

  it("records a real negative quota delta without reading User.credits", async () => {
    const fixture = await createFixtureUser({ credits: 9999, remainingCredits: 30 });
    const result = await store().adjustUserQuotaWithAudit({
      userId: fixture.userId,
      remainingCredits: 22,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });

    expect(result).toMatchObject({
      balanceBefore: 30,
      balanceAfter: 22,
      deltaCredits: -8,
      creditEvent: {
        deltaCredits: -8,
        balanceBefore: 30,
        balanceAfter: 22
      }
    });
  });

  it("creates a missing UserQuota with the existing default semantics", async () => {
    const fixture = await createFixtureUser({ withQuota: false });
    const result = await store().adjustUserQuotaWithAudit({
      userId: fixture.userId,
      remainingCredits: 25,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });

    expect(result).toMatchObject({
      balanceBefore: 20,
      balanceAfter: 25,
      deltaCredits: 5
    });
  });

  it("does not create a zero AccountCreditEvent or a fake compensation on no-change", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 30 });
    const result = await store().adjustUserQuotaWithAudit({
      userId: fixture.userId,
      remainingCredits: 30,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });

    expect(result).toMatchObject({
      status: "NO_CHANGE",
      balanceBefore: 30,
      balanceAfter: 30,
      deltaCredits: 0,
      creditEvent: null,
      auditLog: {
        adminUserId: fixture.userId,
        action: "UPDATE_USER_QUOTA",
        targetType: "User",
        targetId: fixture.userId
      }
    });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    const compensations = await store().listAdminManualCompensations();
    expect(compensations).toEqual([
      {
        auditId: result?.auditLog.id,
        targetUserId: fixture.userId,
        action: "UPDATE_USER_QUOTA",
        createdAt: expect.any(String),
        creditChangeStatus: "RECORDED",
        creditDelta: 0
      }
    ]);
    expect(compensations[0]).not.toHaveProperty("metadata");
    expect(compensations[0]).not.toHaveProperty("oldCredits");
    expect(compensations[0]).not.toHaveProperty("newCredits");
  });

  it("retries an absolute quota target without a second event", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const first = await store().adjustUserQuotaWithAudit({
      userId: fixture.userId,
      remainingCredits: 16,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });
    const second = await store().adjustUserQuotaWithAudit({
      userId: fixture.userId,
      remainingCredits: 16,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });

    expect(first?.deltaCredits).toBe(6);
    expect(second).toMatchObject({
      status: "NO_CHANGE",
      balanceBefore: 16,
      balanceAfter: 16,
      deltaCredits: 0,
      creditEvent: null
    });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(1);
  });

  it("serializes concurrent absolute quota adjustments with truthful balances", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 40 });
    const firstStore = store();
    const secondStore = createPrismaUserStore(concurrentDatabase());

    await Promise.all([
      firstStore.adjustUserQuotaWithAudit({
        userId: fixture.userId,
        remainingCredits: 50,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      }),
      secondStore.adjustUserQuotaWithAudit({
        userId: fixture.userId,
        remainingCredits: 60,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      })
    ]);

    const events = await store().listAccountCreditEventsForUser(fixture.userId, 10);
    expect(events).toHaveLength(2);
    const first = events.find((event) => event.balanceBefore === 40);
    const second = events.find((event) => event !== first);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second?.balanceBefore).toBe(first?.balanceAfter);
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: second?.balanceAfter });
  });

  it("returns a safe missing-user result without financial facts", async () => {
    const result = await store().adjustUserQuotaWithAudit({
      userId: `${fixtureUserPrefix}missing-${randomUUID()}`,
      remainingCredits: 10,
      adminUserId: `${fixtureUserPrefix}missing-admin-${randomUUID()}`,
      adminEmail: "admin-fixture@example.test"
    });

    expect(result).toBeNull();
  });

  it("rolls back quota and event when the financial audit write fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 12 });
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialAuditLogCreated() {
          throw new Error("FIXTURE_AUDIT_FAILURE");
        }
      }
    });

    await expect(
      failingStore.adjustUserQuotaWithAudit({
        userId: fixture.userId,
        remainingCredits: 20,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      })
    ).rejects.toThrow("FIXTURE_AUDIT_FAILURE");
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 12 });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().adminAuditLog.count({ where: { targetId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("rolls back quota and audit when the financial event write fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 12 });
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialCreditEventCreated() {
          throw new Error("FIXTURE_EVENT_FAILURE");
        }
      }
    });

    await expect(
      failingStore.adjustUserQuotaWithAudit({
        userId: fixture.userId,
        remainingCredits: 20,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      })
    ).rejects.toThrow("FIXTURE_EVENT_FAILURE");
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 12 });
    await expect(
      database().accountCreditEvent.count({ where: { userId: fixture.userId } })
    ).resolves.toBe(0);
    await expect(
      database().adminAuditLog.count({ where: { targetId: fixture.userId } })
    ).resolves.toBe(0);
  });

  it("marks a PENDING order PAID with quota, one event, and one audit atomically", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 30 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 25 });
    const result = await store().markOrderPaidByAdmin({
      orderId: order.orderId,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });

    expect(result).toMatchObject({
      id: order.orderId,
      status: "PAID",
      credits: 25
    });
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 55 });
    await expect(
      database().accountCreditEvent.findMany({ where: { sourceId: order.orderId } })
    ).resolves.toMatchObject([
      {
        sourceType: "ADMIN_MANUAL_PAID",
        idempotencyKey: `admin-paid:${order.orderId}`,
        deltaCredits: 25,
        balanceBefore: 30,
        balanceAfter: 55
      }
    ]);
    await expect(
      database().adminAuditLog.count({
        where: { targetType: "Order", targetId: order.orderId }
      })
    ).resolves.toBe(1);
  });

  it("uses persisted Order.credits for manual PAID and does not accept a client amount", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 7 });
    await store().markOrderPaidByAdmin({
      orderId: order.orderId,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });

    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 17 });
  });

  it("replays manual PAID without a second quota change, event, or success audit", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 7 });
    const adminStore = store();
    await adminStore.markOrderPaidByAdmin({
      orderId: order.orderId,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });
    const replay = await adminStore.markOrderPaidByAdmin({
      orderId: order.orderId,
      adminUserId: fixture.userId,
      adminEmail: "admin-fixture@example.test"
    });

    expect(replay).toMatchObject({ id: order.orderId, status: "PAID" });
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 17 });
    await expect(
      database().accountCreditEvent.count({ where: { sourceId: order.orderId } })
    ).resolves.toBe(1);
    await expect(
      database().adminAuditLog.count({
        where: { targetType: "Order", targetId: order.orderId }
      })
    ).resolves.toBe(1);
  });

  it("rejects zero Order.credits without changing order, quota, event, or audit", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 0 });

    await expect(
      store().markOrderPaidByAdmin({
        orderId: order.orderId,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      })
    ).rejects.toThrow("ORDER_CREDITS_INVALID");
    await expect(database().order.findUnique({ where: { id: order.orderId } }))
      .resolves.toMatchObject({ status: "PENDING" });
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 10 });
    await expect(
      database().accountCreditEvent.count({ where: { sourceId: order.orderId } })
    ).resolves.toBe(0);
  });

  it("rejects a cancelled order without financial facts", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 7 });
    await database().order.update({
      where: { id: order.orderId },
      data: { status: "CANCELLED" }
    });

    await expect(
      store().markOrderPaidByAdmin({
        orderId: order.orderId,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      })
    ).rejects.toThrow("ORDER_CANCELLED_CANNOT_BE_PAID");
    await expect(
      database().accountCreditEvent.count({ where: { sourceId: order.orderId } })
    ).resolves.toBe(0);
    await expect(
      database().adminAuditLog.count({
        where: { targetType: "Order", targetId: order.orderId }
      })
    ).resolves.toBe(0);
  });

  it("returns null for a missing order without financial facts", async () => {
    await expect(
      store().markOrderPaidByAdmin({
        orderId: `${fixtureUserPrefix}missing-order-${randomUUID()}`,
        adminUserId: `${fixtureUserPrefix}missing-admin-${randomUUID()}`,
        adminEmail: "admin-fixture@example.test"
      })
    ).resolves.toBeNull();
  });

  it("rolls back manual PAID when its audit write fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 7 });
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialAuditLogCreated() {
          throw new Error("FIXTURE_AUDIT_FAILURE");
        }
      }
    });

    await expect(
      failingStore.markOrderPaidByAdmin({
        orderId: order.orderId,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      })
    ).rejects.toThrow("FIXTURE_AUDIT_FAILURE");
    await expect(database().order.findUnique({ where: { id: order.orderId } }))
      .resolves.toMatchObject({ status: "PENDING" });
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 10 });
  });

  it("rolls back manual PAID when its event write fails", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 7 });
    const failingStore = createPrismaUserStore(database(), {
      testHooks: {
        async afterFinancialCreditEventCreated() {
          throw new Error("FIXTURE_EVENT_FAILURE");
        }
      }
    });

    await expect(
      failingStore.markOrderPaidByAdmin({
        orderId: order.orderId,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      })
    ).rejects.toThrow("FIXTURE_EVENT_FAILURE");
    await expect(database().order.findUnique({ where: { id: order.orderId } }))
      .resolves.toMatchObject({ status: "PENDING" });
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 10 });
    await expect(
      database().adminAuditLog.count({
        where: { targetType: "Order", targetId: order.orderId }
      })
    ).resolves.toBe(0);
  });

  it("gives EPay notify the same exactly-once credit event path without admin audit", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 7 });
    const paymentStore = store();
    const paidAt = new Date("2030-07-27T12:00:00.000Z");
    const first = await paymentStore.confirmPaidOrderFromPayment(order.orderId, {
      providerTradeNo: "fixture-provider-trade",
      paidAt
    });
    const replay = await paymentStore.confirmPaidOrderFromPayment(order.orderId, {
      providerTradeNo: "fixture-provider-trade-replay",
      paidAt
    });

    expect(first?.alreadyPaid).toBe(false);
    expect(replay?.alreadyPaid).toBe(true);
    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 17 });
    await expect(
      database().accountCreditEvent.findMany({ where: { sourceId: order.orderId } })
    ).resolves.toMatchObject([
      { sourceType: "PAYMENT_PAID", idempotencyKey: `payment-paid:${order.orderId}` }
    ]);
    await expect(
      database().adminAuditLog.count({
        where: { targetType: "Order", targetId: order.orderId }
      })
    ).resolves.toBe(0);
  });

  it("allows manual PAID and notify to race with at most one event and one quota addition", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const order = await createFixtureOrder({ userId: fixture.userId, credits: 7 });
    const manualStore = store();
    const notifyStore = createPrismaUserStore(concurrentDatabase());

    await Promise.all([
      manualStore.markOrderPaidByAdmin({
        orderId: order.orderId,
        adminUserId: fixture.userId,
        adminEmail: "admin-fixture@example.test"
      }),
      notifyStore.confirmPaidOrderFromPayment(order.orderId, {
        providerTradeNo: "fixture-race-provider",
        paidAt: new Date("2030-07-27T12:00:00.000Z")
      })
    ]);

    await expect(database().userQuota.findUnique({ where: { userId: fixture.userId } }))
      .resolves.toMatchObject({ remainingCredits: 17 });
    await expect(
      database().accountCreditEvent.count({ where: { sourceId: order.orderId } })
    ).resolves.toBe(1);
    await expect(
      database().adminAuditLog.count({
        where: { targetType: "Order", targetId: order.orderId }
      })
    ).resolves.toBeLessThanOrEqual(1);
  });

  it("records a non-stream Chat charge from the reserved quota balance", async () => {
    const fixture = await createFixtureUser({ remainingCredits: 10 });
    const chatStore = store();
    const reservation = await chatStore.reserveChatCredits({
      userId: fixture.userId,
      requestId: `chat-completion-${randomUUID()}`,
      modelId: "fixture-chat-model",
      creditCost: 4,
      kind: CreditReservationKind.CHAT_COMPLETION,
      expiresAt: new Date("2030-07-27T13:00:00.000Z")
    });

    expect(reservation.ok).toBe(true);
    if (!reservation.ok) {
      return;
    }

    await expect(
      database().userQuota.findUnique({ where: { userId: fixture.userId } })
    ).resolves.toMatchObject({ remainingCredits: 6 });
    await expect(
      database().accountCreditEvent.findUnique({
        where: { idempotencyKey: `chat-charge:${reservation.reservation.id}` }
      })
    ).resolves.toMatchObject({
      userId: fixture.userId,
      deltaCredits: -4,
      balanceBefore: 10,
      balanceAfter: 6,
      sourceType: "CHAT_CHARGE",
      sourceId: reservation.reservation.id,
      metadata: null
    });
    await expect(
      database().accountCreditEvent.count({
        where: { sourceId: reservation.reservation.id }
      })
    ).resolves.toBe(1);
  });
});
