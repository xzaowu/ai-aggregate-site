import { createHash, randomUUID } from "node:crypto";
import {
  PrismaClient,
  UserRole,
  UserTokenKind,
  type User
} from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";
import { createPrismaUserStore } from "../src/store";
import {
  acquireCrossWorkerTestLock,
  type CrossWorkerTestLock
} from "./helpers/cross-worker-test-lock";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;
const TEST_LOCK_NAME = "account-security-store";
const FIXTURE_PREFIX = "s4d1_account_";
const NOW = new Date("2030-07-22T12:00:00.000Z");

databaseSuite.sequential("account security Store transactions", () => {
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

  function futureExpiresAt(): Date {
    return new Date(NOW.getTime() + 30 * 60 * 1000);
  }

  function unchangedUserFields(user: User) {
    return {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      name: user.name,
      avatarUrl: user.avatarUrl,
      avatarStorageObjectId: user.avatarStorageObjectId,
      role: user.role,
      credits: user.credits,
      createdAt: user.createdAt
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
    name?: string | null;
    avatarUrl?: string | null;
    role?: UserRole;
    credits?: number;
  } = {}): Promise<User> {
    const id = `${FIXTURE_PREFIX}${randomUUID()}`;
    const user = await database().user.create({
      data: {
        id,
        email: input.email ?? makeEmail(),
        passwordHash: input.passwordHash ?? "fixture-password-hash",
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        lastLoginAt: input.lastLoginAt ?? null,
        sessionVersion: input.sessionVersion ?? 0,
        name: input.name ?? null,
        avatarUrl: input.avatarUrl ?? null,
        role: input.role ?? UserRole.USER,
        credits: input.credits ?? 1000
      }
    });
    track(user.id);
    return user;
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

  async function cleanup(): Promise<void> {
    const userIds = [...createdUserIds];
    if (userIds.length > 0) {
      await retryPrismaWriteConflict(async () => {
        await database().user.deleteMany({
          where: {
            id: {
              in: userIds
            }
          }
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

  it("changes only password auth state and invalidates only an active reset token", async () => {
    const emailVerifiedAt = new Date("2030-07-21T01:00:00.000Z");
    const lastLoginAt = new Date("2030-07-21T02:00:00.000Z");
    const user = await createFixtureUser({
      passwordHash: "before-change-password-hash",
      sessionVersion: 7,
      emailVerifiedAt,
      lastLoginAt,
      name: "fixture-name",
      avatarUrl: "https://example.test/avatar.png",
      role: UserRole.ADMIN,
      credits: 321
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const verificationHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const beforeUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    const beforeVerification = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: verificationHash }
    });

    const result = await store().changePasswordForUser({
      userId: user.id,
      expectedSessionVersion: beforeUser.sessionVersion,
      expectedPasswordHash: beforeUser.passwordHash,
      passwordHash: "after-change-password-hash",
      now: NOW
    });

    expect(result).toEqual({ status: "CHANGED" });
    expect(Object.keys(result)).toEqual(["status"]);
    const changedUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    expect(changedUser.passwordHash).toBe("after-change-password-hash");
    expect(changedUser.sessionVersion).toBe(beforeUser.sessionVersion + 1);
    expect(unchangedUserFields(changedUser)).toEqual(
      unchangedUserFields(beforeUser)
    );
    await expect(
      database().userToken.findUnique({ where: { tokenHash: resetHash } })
    ).resolves.toMatchObject({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET,
      usedAt: NOW
    });
    await expect(
      database().userToken.findUnique({ where: { tokenHash: verificationHash } })
    ).resolves.toEqual(beforeVerification);
  });

  it("leaves used and expired reset tokens unchanged and succeeds without a reset token", async () => {
    const usedUser = await createFixtureUser({
      passwordHash: "used-token-password-hash",
      sessionVersion: 2
    });
    const usedHash = await createFixtureToken({
      userId: usedUser.id,
      kind: UserTokenKind.PASSWORD_RESET,
      usedAt: new Date("2030-07-21T00:00:00.000Z")
    });
    const expiredUser = await createFixtureUser({
      passwordHash: "expired-token-password-hash",
      sessionVersion: 3
    });
    const expiredHash = await createFixtureToken({
      userId: expiredUser.id,
      kind: UserTokenKind.PASSWORD_RESET,
      expiresAt: new Date(NOW.getTime() - 1)
    });
    const noTokenUser = await createFixtureUser({
      passwordHash: "no-token-password-hash",
      sessionVersion: 4
    });
    const beforeUsed = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: usedHash }
    });
    const beforeExpired = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: expiredHash }
    });

    await expect(
      store().changePasswordForUser({
        userId: usedUser.id,
        expectedSessionVersion: 2,
        expectedPasswordHash: "used-token-password-hash",
        passwordHash: "used-token-new-password-hash",
        now: NOW
      })
    ).resolves.toEqual({ status: "CHANGED" });
    await expect(
      store().changePasswordForUser({
        userId: expiredUser.id,
        expectedSessionVersion: 3,
        expectedPasswordHash: "expired-token-password-hash",
        passwordHash: "expired-token-new-password-hash",
        now: NOW
      })
    ).resolves.toEqual({ status: "CHANGED" });
    await expect(
      store().changePasswordForUser({
        userId: noTokenUser.id,
        expectedSessionVersion: 4,
        expectedPasswordHash: "no-token-password-hash",
        passwordHash: "no-token-new-password-hash",
        now: NOW
      })
    ).resolves.toEqual({ status: "CHANGED" });
    await expect(
      database().userToken.findUnique({ where: { tokenHash: usedHash } })
    ).resolves.toEqual(beforeUsed);
    await expect(
      database().userToken.findUnique({ where: { tokenHash: expiredHash } })
    ).resolves.toEqual(beforeExpired);
    await expect(
      database().user.findUnique({ where: { id: noTokenUser.id } })
    ).resolves.toMatchObject({
      passwordHash: "no-token-new-password-hash",
      sessionVersion: 5
    });
  });

  it("returns stale auth state with zero user and token changes", async () => {
    const user = await createFixtureUser({
      passwordHash: "stale-password-hash",
      sessionVersion: 6
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const verificationHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const beforeUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    const beforeReset = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: resetHash }
    });
    const beforeVerification = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: verificationHash }
    });

    const staleSession = await store().changePasswordForUser({
      userId: user.id,
      expectedSessionVersion: 5,
      expectedPasswordHash: beforeUser.passwordHash,
      passwordHash: "should-not-persist-session",
      now: NOW
    });
    const stalePassword = await store().changePasswordForUser({
      userId: user.id,
      expectedSessionVersion: beforeUser.sessionVersion,
      expectedPasswordHash: "different-password-hash",
      passwordHash: "should-not-persist-password",
      now: NOW
    });
    const missing = await store().changePasswordForUser({
      userId: "s4d1_missing_user",
      expectedSessionVersion: 0,
      expectedPasswordHash: "missing-password-hash",
      passwordHash: "should-not-persist-missing",
      now: NOW
    });

    for (const result of [staleSession, stalePassword, missing]) {
      expect(result).toEqual({ status: "STALE_AUTH_STATE" });
      expect(Object.keys(result)).toEqual(["status"]);
    }
    await expect(
      database().user.findUnique({ where: { id: user.id } })
    ).resolves.toEqual(beforeUser);
    await expect(
      database().userToken.findUnique({ where: { tokenHash: resetHash } })
    ).resolves.toEqual(beforeReset);
    await expect(
      database().userToken.findUnique({ where: { tokenHash: verificationHash } })
    ).resolves.toEqual(beforeVerification);
  });

  it("allows only one concurrent password change from the same expected auth state", async () => {
    const user = await createFixtureUser({
      passwordHash: "concurrent-before-password-hash",
      sessionVersion: 9
    });
    const firstInput = {
      userId: user.id,
      expectedSessionVersion: 9,
      expectedPasswordHash: "concurrent-before-password-hash",
      passwordHash: "first-concurrent-password-hash",
      now: NOW
    };
    const secondInput = {
      ...firstInput,
      passwordHash: "second-concurrent-password-hash"
    };

    const results = await Promise.all([
      store().changePasswordForUser(firstInput),
      concurrentStore().changePasswordForUser(secondInput)
    ]);

    expect(results.filter((result) => result.status === "CHANGED")).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "STALE_AUTH_STATE")
    ).toHaveLength(1);
    const finalUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    const winningInput = results[0]?.status === "CHANGED" ? firstInput : secondInput;
    expect(finalUser).toMatchObject({
      passwordHash: winningInput.passwordHash,
      sessionVersion: 10
    });
  });

  it("serializes a password change and session revocation through their shared CAS", async () => {
    const user = await createFixtureUser({
      passwordHash: "change-revoke-before-password-hash",
      sessionVersion: 10
    });

    const [changeResult, revokeResult] = await Promise.all([
      store().changePasswordForUser({
        userId: user.id,
        expectedSessionVersion: 10,
        expectedPasswordHash: "change-revoke-before-password-hash",
        passwordHash: "change-revoke-after-password-hash",
        now: NOW
      }),
      concurrentStore().revokeUserSessions({
        userId: user.id,
        expectedSessionVersion: 10
      })
    ]);

    expect(
      [changeResult.status === "CHANGED", revokeResult.status === "REVOKED"].filter(Boolean)
    ).toHaveLength(1);
    expect(
      [
        changeResult.status === "STALE_AUTH_STATE",
        revokeResult.status === "STALE_AUTH_STATE"
      ].filter(Boolean)
    ).toHaveLength(1);
    const finalUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    expect(finalUser.sessionVersion).toBe(11);
    expect(finalUser.passwordHash).toBe(
      changeResult.status === "CHANGED"
        ? "change-revoke-after-password-hash"
        : "change-revoke-before-password-hash"
    );
  });

  it("serializes a password change with real password-reset consumption", async () => {
    const user = await createFixtureUser({
      passwordHash: "change-reset-before-password-hash",
      sessionVersion: 12
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });

    const [changeResult, resetResult] = await Promise.all([
      store().changePasswordForUser({
        userId: user.id,
        expectedSessionVersion: 12,
        expectedPasswordHash: "change-reset-before-password-hash",
        passwordHash: "change-reset-after-password-hash",
        now: NOW
      }),
      concurrentStore().consumePasswordResetToken({
        tokenHash: resetHash,
        passwordHash: "reset-after-password-hash",
        now: NOW
      })
    ]);

    expect(
      [changeResult.status === "CHANGED", resetResult.status === "RESET"].filter(Boolean)
    ).toHaveLength(1);
    expect(
      [
        changeResult.status === "STALE_AUTH_STATE",
        resetResult.status === "INVALID_OR_EXPIRED"
      ].filter(Boolean)
    ).toHaveLength(1);
    const finalUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    expect(finalUser.sessionVersion).toBe(13);
    expect(finalUser.passwordHash).toBe(
      changeResult.status === "CHANGED"
        ? "change-reset-after-password-hash"
        : "reset-after-password-hash"
    );
    await expect(
      database().userToken.findUnique({ where: { tokenHash: resetHash } })
    ).resolves.toMatchObject({ usedAt: NOW });
  });

  it("rolls back a password change when reset-token invalidation fails", async () => {
    const user = await createFixtureUser({
      passwordHash: "rollback-before-password-hash",
      sessionVersion: 14
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const beforeUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    const beforeReset = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: resetHash }
    });
    const failure = new Error("TEST_ACCOUNT_SECURITY_TOKEN_WRITE_FAILED");
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
      failingStore.changePasswordForUser({
        userId: user.id,
        expectedSessionVersion: 14,
        expectedPasswordHash: "rollback-before-password-hash",
        passwordHash: "should-not-persist-password-hash",
        now: NOW
      })
    ).rejects.toBe(failure);
    await expect(
      database().user.findUnique({ where: { id: user.id } })
    ).resolves.toEqual(beforeUser);
    await expect(
      database().userToken.findUnique({ where: { tokenHash: resetHash } })
    ).resolves.toEqual(beforeReset);
  });

  it("revokes sessions with one CAS and preserves all other account and token state", async () => {
    const emailVerifiedAt = new Date("2030-07-21T03:00:00.000Z");
    const lastLoginAt = new Date("2030-07-21T04:00:00.000Z");
    const user = await createFixtureUser({
      passwordHash: "revoke-password-hash",
      sessionVersion: 15,
      emailVerifiedAt,
      lastLoginAt,
      name: "revoke-name",
      role: UserRole.ADMIN,
      credits: 456
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const verificationHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const beforeUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    const beforeReset = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: resetHash }
    });
    const beforeVerification = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: verificationHash }
    });

    const result = await store().revokeUserSessions({
      userId: user.id,
      expectedSessionVersion: beforeUser.sessionVersion
    });

    expect(result).toEqual({ status: "REVOKED" });
    expect(Object.keys(result)).toEqual(["status"]);
    const revokedUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    expect(revokedUser.passwordHash).toBe(beforeUser.passwordHash);
    expect(revokedUser.sessionVersion).toBe(beforeUser.sessionVersion + 1);
    expect(unchangedUserFields(revokedUser)).toEqual(
      unchangedUserFields(beforeUser)
    );
    await expect(
      database().userToken.findUnique({ where: { tokenHash: resetHash } })
    ).resolves.toEqual(beforeReset);
    await expect(
      database().userToken.findUnique({ where: { tokenHash: verificationHash } })
    ).resolves.toEqual(beforeVerification);
  });

  it("returns stale auth state for stale or missing revocation without changing state", async () => {
    const user = await createFixtureUser({
      passwordHash: "revoke-stale-password-hash",
      sessionVersion: 16
    });
    const resetHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const verificationHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const beforeUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    const beforeReset = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: resetHash }
    });
    const beforeVerification = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: verificationHash }
    });

    const stale = await store().revokeUserSessions({
      userId: user.id,
      expectedSessionVersion: 15
    });
    const missing = await store().revokeUserSessions({
      userId: "s4d1_missing_revoke_user",
      expectedSessionVersion: 0
    });

    for (const result of [stale, missing]) {
      expect(result).toEqual({ status: "STALE_AUTH_STATE" });
      expect(Object.keys(result)).toEqual(["status"]);
    }
    await expect(
      database().user.findUnique({ where: { id: user.id } })
    ).resolves.toEqual(beforeUser);
    await expect(
      database().userToken.findUnique({ where: { tokenHash: resetHash } })
    ).resolves.toEqual(beforeReset);
    await expect(
      database().userToken.findUnique({ where: { tokenHash: verificationHash } })
    ).resolves.toEqual(beforeVerification);
  });

  it("allows only one concurrent session revocation from the same version", async () => {
    const user = await createFixtureUser({ sessionVersion: 17 });

    const results = await Promise.all([
      store().revokeUserSessions({
        userId: user.id,
        expectedSessionVersion: 17
      }),
      concurrentStore().revokeUserSessions({
        userId: user.id,
        expectedSessionVersion: 17
      })
    ]);

    expect(results.filter((result) => result.status === "REVOKED")).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "STALE_AUTH_STATE")
    ).toHaveLength(1);
    await expect(
      database().user.findUnique({ where: { id: user.id } })
    ).resolves.toMatchObject({ sessionVersion: 18 });
  });
});
