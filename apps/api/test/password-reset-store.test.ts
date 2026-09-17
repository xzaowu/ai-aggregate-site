import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  PrismaClient,
  UserTokenKind
} from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";
import {
  createPrismaUserStore,
  type ConsumePasswordResetTokenInput,
  type RotatePasswordResetTokenForEmailInput
} from "../src/store";
import {
  acquireCrossWorkerTestLock,
  type CrossWorkerTestLock
} from "./helpers/cross-worker-test-lock";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;
const TEST_LOCK_NAME = "password-reset-store";
const FIXTURE_PREFIX = "s4c1_reset_";
const RESET_NOW = new Date("2030-07-22T00:00:00.000Z");

databaseSuite.sequential("password reset Store transactions", () => {
  let prisma: PrismaClient | undefined;
  let secondPrisma: PrismaClient | undefined;
  let crossWorkerLock: CrossWorkerTestLock | undefined;
  const createdUserIds = new Set<string>();

  function database(): PrismaClient {
    if (!prisma) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }
    return prisma;
  }

  function concurrentDatabase(): PrismaClient {
    if (!secondPrisma) {
      throw new Error("TEST_SECOND_DATABASE_NOT_INITIALIZED");
    }
    return secondPrisma;
  }

  function store() {
    return createPrismaUserStore(database());
  }

  function concurrentStore() {
    return createPrismaUserStore(concurrentDatabase());
  }

  function makeEmail(label = "user"): string {
    return `${FIXTURE_PREFIX}${label}_${randomUUID()}@example.test`;
  }

  function makeTokenHash(label = "token"): string {
    return createHash("sha256")
      .update(`${label}:${randomUUID()}`)
      .digest("hex");
  }

  function futureExpiresAt(now = RESET_NOW): Date {
    return new Date(now.getTime() + 30 * 60 * 1000);
  }

  function rotateInput(
    email: string,
    overrides: Partial<RotatePasswordResetTokenForEmailInput> = {}
  ): RotatePasswordResetTokenForEmailInput {
    return {
      email,
      tokenHash: makeTokenHash("rotate"),
      expiresAt: futureExpiresAt(),
      now: RESET_NOW,
      ...overrides
    };
  }

  function consumeInput(
    tokenHash: string,
    overrides: Partial<ConsumePasswordResetTokenInput> = {}
  ): ConsumePasswordResetTokenInput {
    return {
      tokenHash,
      passwordHash: "replacement-password-hash",
      now: RESET_NOW,
      ...overrides
    };
  }

  function track(userId: string): void {
    createdUserIds.add(userId);
  }

  async function createFixtureUser(input: {
    email?: string;
    passwordHash?: string;
    emailVerifiedAt?: Date | null;
    lastLoginAt?: Date | null;
    sessionVersion?: number;
  } = {}): Promise<{ id: string; email: string }> {
    const id = `${FIXTURE_PREFIX}${randomUUID()}`;
    const email = input.email ?? `${id}@example.test`;
    await database().user.create({
      data: {
        id,
        email,
        passwordHash: input.passwordHash ?? "fixture-password-hash",
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        lastLoginAt: input.lastLoginAt ?? null,
        sessionVersion: input.sessionVersion ?? 0
      }
    });
    track(id);
    return { id, email };
  }

  async function createFixtureToken(input: {
    userId: string;
    kind: UserTokenKind;
    tokenHash?: string;
    expiresAt?: Date;
    usedAt?: Date | null;
  }): Promise<string> {
    const tokenHash = input.tokenHash ?? makeTokenHash("fixture");
    await database().userToken.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        tokenHash,
        expiresAt: input.expiresAt ?? futureExpiresAt(),
        usedAt: input.usedAt ?? null
      }
    });
    return tokenHash;
  }

  async function passwordResetToken(userId: string) {
    return database().userToken.findUniqueOrThrow({
      where: {
        userId_kind: {
          userId,
          kind: UserTokenKind.PASSWORD_RESET
        }
      }
    });
  }

  async function cleanup(): Promise<void> {
    const userIds = [...createdUserIds];
    if (userIds.length > 0) {
      await retryPrismaWriteConflict(async () => {
        await database().user.deleteMany({
          where: { id: { in: userIds } }
        });
      });
    }
    createdUserIds.clear();
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

    crossWorkerLock = await acquireCrossWorkerTestLock({
      name: TEST_LOCK_NAME,
      databaseUrl
    });
    try {
      prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      secondPrisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      await Promise.all([prisma.$connect(), secondPrisma.$connect()]);
    } catch (error) {
      await Promise.all([prisma?.$disconnect(), secondPrisma?.$disconnect()]);
      await crossWorkerLock.release();
      crossWorkerLock = undefined;
      throw error;
    }
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await Promise.all([prisma?.$disconnect(), secondPrisma?.$disconnect()]);
      await crossWorkerLock?.release();
    }
  });

  it("validates password-reset inputs at the Store boundary", async () => {
    await expect(
      store().rotatePasswordResetTokenForEmail(
        rotateInput("Upper@example.test")
      )
    ).rejects.toThrow("INVALID_PASSWORD_RESET_EMAIL");
    await expect(
      store().rotatePasswordResetTokenForEmail(
        rotateInput(makeEmail("invalid-hash"), { tokenHash: "A".repeat(64) })
      )
    ).rejects.toThrow("INVALID_PASSWORD_RESET_TOKEN_HASH");
    await expect(
      store().rotatePasswordResetTokenForEmail(
        rotateInput(makeEmail("expired"), {
          expiresAt: new Date(RESET_NOW.getTime() - 1)
        })
      )
    ).rejects.toThrow("INVALID_PASSWORD_RESET_EXPIRES_AT");
    await expect(
      store().consumePasswordResetToken(
        consumeInput("a".repeat(64), { passwordHash: "" })
      )
    ).rejects.toThrow("INVALID_PASSWORD_RESET_PASSWORD_HASH");
    await expect(
      store().consumePasswordResetToken(
        consumeInput("a".repeat(64), { now: new Date("invalid") })
      )
    ).rejects.toThrow("INVALID_PASSWORD_RESET_NOW");
  });

  it("issues only for verified users and preserves User and email-verification state", async () => {
    await expect(
      store().rotatePasswordResetTokenForEmail(rotateInput(makeEmail("missing")))
    ).resolves.toEqual({ status: "NO_ACTION" });

    const unverified = await createFixtureUser();
    await expect(
      store().rotatePasswordResetTokenForEmail(rotateInput(unverified.email))
    ).resolves.toEqual({ status: "NO_ACTION" });

    const emailVerifiedAt = new Date("2030-07-21T10:00:00.000Z");
    const lastLoginAt = new Date("2030-07-21T11:00:00.000Z");
    const verified = await createFixtureUser({
      passwordHash: "before-reset-password-hash",
      emailVerifiedAt,
      lastLoginAt,
      sessionVersion: 7
    });
    const emailVerificationHash = await createFixtureToken({
      userId: verified.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const beforeUser = await database().user.findUniqueOrThrow({
      where: { id: verified.id }
    });
    const beforeEmailVerification = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: emailVerificationHash }
    });
    const input = rotateInput(verified.email);

    await expect(
      store().rotatePasswordResetTokenForEmail(input)
    ).resolves.toEqual({
      status: "ISSUED",
      userId: verified.id,
      email: verified.email
    });
    await expect(passwordResetToken(verified.id)).resolves.toMatchObject({
      userId: verified.id,
      kind: UserTokenKind.PASSWORD_RESET,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null
    });
    await expect(
      database().user.findUnique({ where: { id: verified.id } })
    ).resolves.toMatchObject({
      passwordHash: beforeUser.passwordHash,
      sessionVersion: beforeUser.sessionVersion,
      lastLoginAt: beforeUser.lastLoginAt,
      emailVerifiedAt: beforeUser.emailVerifiedAt
    });
    await expect(
      database().userToken.findUnique({ where: { tokenHash: emailVerificationHash } })
    ).resolves.toEqual(beforeEmailVerification);
  });

  it("rotates one reset token per verified user, invalidates the old hash, and resets usedAt", async () => {
    const user = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const first = rotateInput(user.email);
    const firstIssued = await store().rotatePasswordResetTokenForEmail(first);
    if (firstIssued.status !== "ISSUED") {
      throw new Error("TEST_EXPECTED_INITIAL_RESET_ISSUED");
    }
    await database().userToken.update({
      where: { tokenHash: first.tokenHash },
      data: { usedAt: RESET_NOW }
    });
    const second = rotateInput(user.email);

    await expect(
      store().rotatePasswordResetTokenForEmail(second)
    ).resolves.toEqual({
      status: "ISSUED",
      userId: user.id,
      email: user.email
    });
    await expect(
      database().userToken.findUnique({ where: { tokenHash: first.tokenHash } })
    ).resolves.toBeNull();
    await expect(passwordResetToken(user.id)).resolves.toMatchObject({
      tokenHash: second.tokenHash,
      expiresAt: second.expiresAt,
      usedAt: null
    });
    await expect(
      database().userToken.count({
        where: { userId: user.id, kind: UserTokenKind.PASSWORD_RESET }
      })
    ).resolves.toBe(1);
  });

  it("keeps different verified users independent", async () => {
    const first = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const second = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const firstInput = rotateInput(first.email);
    const secondInput = rotateInput(second.email);

    await expect(
      Promise.all([
        store().rotatePasswordResetTokenForEmail(firstInput),
        store().rotatePasswordResetTokenForEmail(secondInput)
      ])
    ).resolves.toEqual([
      { status: "ISSUED", userId: first.id, email: first.email },
      { status: "ISSUED", userId: second.id, email: second.email }
    ]);
    await expect(passwordResetToken(first.id)).resolves.toMatchObject({
      tokenHash: firstInput.tokenHash
    });
    await expect(passwordResetToken(second.id)).resolves.toMatchObject({
      tokenHash: secondInput.tokenHash
    });
  });

  it("rolls back a global token-hash collision without overwriting either token", async () => {
    const owner = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const collisionHash = await createFixtureToken({
      userId: owner.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const target = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const originalHash = await createFixtureToken({
      userId: target.id,
      kind: UserTokenKind.PASSWORD_RESET
    });

    await expect(
      store().rotatePasswordResetTokenForEmail(
        rotateInput(target.email, { tokenHash: collisionHash })
      )
    ).rejects.toThrow("PASSWORD_RESET_TOKEN_HASH_CONFLICT");
    await expect(passwordResetToken(target.id)).resolves.toMatchObject({
      tokenHash: originalHash,
      kind: UserTokenKind.PASSWORD_RESET
    });
    await expect(
      database().userToken.findUnique({ where: { tokenHash: collisionHash } })
    ).resolves.toMatchObject({
      userId: owner.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
  });

  it("only classifies the tokenHash P2002 and propagates unrelated P2002 errors", async () => {
    const unrelatedError = new Prisma.PrismaClientKnownRequestError(
      "TEST_UNRELATED_UNIQUE_CONFLICT",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: "User_unrelated_key" }
      }
    );
    const failingClient = database().$extends({
      query: {
        userToken: {
          async upsert() {
            throw unrelatedError;
          }
        }
      }
    });
    const failingStore = createPrismaUserStore(
      failingClient as unknown as PrismaClient
    );
    const user = await createFixtureUser({ emailVerifiedAt: RESET_NOW });

    await expect(
      failingStore.rotatePasswordResetTokenForEmail(rotateInput(user.email))
    ).rejects.toBe(unrelatedError);
  });

  it("consumes a valid reset token once, updates only passwordHash and sessionVersion, and reports no secrets", async () => {
    const emailVerifiedAt = new Date("2030-07-21T10:00:00.000Z");
    const lastLoginAt = new Date("2030-07-21T11:00:00.000Z");
    const user = await createFixtureUser({
      passwordHash: "before-reset-password-hash",
      emailVerifiedAt,
      lastLoginAt,
      sessionVersion: 4
    });
    const emailVerificationHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const beforeEmailVerification = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: emailVerificationHash }
    });
    const input = consumeInput(resetHash, {
      passwordHash: "after-reset-password-hash"
    });

    const result = await store().consumePasswordResetToken(input);

    expect(result).toEqual({
      status: "RESET",
      userId: user.id,
      sessionVersion: 5
    });
    expect(Object.keys(result).sort()).toEqual([
      "sessionVersion",
      "status",
      "userId"
    ]);
    await expect(
      database().user.findUnique({ where: { id: user.id } })
    ).resolves.toMatchObject({
      passwordHash: input.passwordHash,
      sessionVersion: 5,
      lastLoginAt,
      emailVerifiedAt
    });
    await expect(passwordResetToken(user.id)).resolves.toMatchObject({
      tokenHash: resetHash,
      usedAt: input.now
    });
    await expect(
      database().userToken.findUnique({ where: { tokenHash: emailVerificationHash } })
    ).resolves.toEqual(beforeEmailVerification);
    await expect(
      store().consumePasswordResetToken(input)
    ).resolves.toEqual({ status: "INVALID_OR_EXPIRED" });
  });

  it("classifies unknown, cross-kind, expired, boundary-expired, and used tokens as invalid", async () => {
    const verificationUser = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const verificationHash = await createFixtureToken({
      userId: verificationUser.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const expiredUser = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const expiredHash = await createFixtureToken({
      userId: expiredUser.id,
      kind: UserTokenKind.PASSWORD_RESET,
      expiresAt: new Date(RESET_NOW.getTime() - 1)
    });
    const boundaryUser = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const boundaryHash = await createFixtureToken({
      userId: boundaryUser.id,
      kind: UserTokenKind.PASSWORD_RESET,
      expiresAt: RESET_NOW
    });
    const usedUser = await createFixtureUser({ emailVerifiedAt: RESET_NOW });
    const usedHash = await createFixtureToken({
      userId: usedUser.id,
      kind: UserTokenKind.PASSWORD_RESET,
      usedAt: RESET_NOW
    });

    for (const tokenHash of [
      makeTokenHash("missing"),
      verificationHash,
      expiredHash,
      boundaryHash,
      usedHash
    ]) {
      await expect(
        store().consumePasswordResetToken(consumeInput(tokenHash))
      ).resolves.toEqual({ status: "INVALID_OR_EXPIRED" });
    }
    await expect(
      store().consumeEmailVerificationToken({
        tokenHash: usedHash,
        now: RESET_NOW
      })
    ).resolves.toEqual({ status: "INVALID_OR_EXPIRED" });
    await expect(
      database().user.findUnique({ where: { id: expiredUser.id } })
    ).resolves.toMatchObject({ passwordHash: "fixture-password-hash", sessionVersion: 0 });
  });

  it("allows at most one concurrent reset and leaves the winner's password intact", async () => {
    const user = await createFixtureUser({
      emailVerifiedAt: RESET_NOW,
      passwordHash: "before-concurrent-reset",
      sessionVersion: 8
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const firstInput = consumeInput(resetHash, {
      passwordHash: "first-concurrent-password-hash"
    });
    const secondInput = consumeInput(resetHash, {
      passwordHash: "second-concurrent-password-hash"
    });

    const results = await Promise.all([
      store().consumePasswordResetToken(firstInput),
      concurrentStore().consumePasswordResetToken(secondInput)
    ]);

    expect(results.filter((result) => result.status === "RESET")).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "INVALID_OR_EXPIRED")
    ).toHaveLength(1);
    const finalUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    const winningInput = results[0]?.status === "RESET" ? firstInput : secondInput;
    expect(finalUser).toMatchObject({
      passwordHash: winningInput.passwordHash,
      sessionVersion: 9
    });
    expect((await passwordResetToken(user.id)).usedAt).toEqual(RESET_NOW);
  });

  it("rolls back password, session, and token mutation when the transaction fails", async () => {
    const user = await createFixtureUser({
      emailVerifiedAt: RESET_NOW,
      passwordHash: "before-transaction-failure",
      sessionVersion: 3
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const failure = new Error("TEST_PASSWORD_RESET_TOKEN_WRITE_FAILED");
    const failingClient = database().$extends({
      query: {
        userToken: {
          async updateMany({ args, query }) {
            await query(args);
            throw failure;
          }
        }
      }
    });
    const failingStore = createPrismaUserStore(
      failingClient as unknown as PrismaClient
    );

    await expect(
      failingStore.consumePasswordResetToken(
        consumeInput(resetHash, { passwordHash: "should-not-persist" })
      )
    ).rejects.toBe(failure);
    await expect(
      database().user.findUnique({ where: { id: user.id } })
    ).resolves.toMatchObject({
      passwordHash: "before-transaction-failure",
      sessionVersion: 3
    });
    await expect(passwordResetToken(user.id)).resolves.toMatchObject({
      tokenHash: resetHash,
      usedAt: null
    });
  });
});
