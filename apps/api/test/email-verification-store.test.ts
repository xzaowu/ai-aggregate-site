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
  type ConsumeEmailVerificationTokenInput,
  type RegisterUnverifiedUserAndIssueEmailVerificationTokenInput,
  type RotateEmailVerificationTokenForEmailInput
} from "../src/store";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;

databaseSuite.sequential("email verification Store transactions", () => {
  let prisma: PrismaClient | undefined;
  let secondPrisma: PrismaClient | undefined;
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
    return `s4b1b_${label}_${randomUUID()}@example.test`;
  }

  function makeTokenHash(label = "token"): string {
    return createHash("sha256")
      .update(`${label}:${randomUUID()}`)
      .digest("hex");
  }

  function futureExpiresAt(): Date {
    return new Date(Date.now() + 60 * 60 * 1000);
  }

  function registrationInput(
    overrides: Partial<RegisterUnverifiedUserAndIssueEmailVerificationTokenInput> = {}
  ): RegisterUnverifiedUserAndIssueEmailVerificationTokenInput {
    return {
      email: makeEmail("register"),
      passwordHash: "password-hash",
      tokenHash: makeTokenHash("register"),
      expiresAt: futureExpiresAt(),
      ...overrides
    };
  }

  function rotateInput(
    email: string,
    overrides: Partial<RotateEmailVerificationTokenForEmailInput> = {}
  ): RotateEmailVerificationTokenForEmailInput {
    return {
      email,
      tokenHash: makeTokenHash("rotate"),
      expiresAt: futureExpiresAt(),
      ...overrides
    };
  }

  function consumeInput(
    tokenHash: string,
    overrides: Partial<ConsumeEmailVerificationTokenInput> = {}
  ): ConsumeEmailVerificationTokenInput {
    return {
      tokenHash,
      now: new Date(),
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
    const id = `s4b1b_${randomUUID()}`;
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

  async function emailVerificationToken(userId: string) {
    return database().userToken.findUniqueOrThrow({
      where: {
        userId_kind: {
          userId,
          kind: UserTokenKind.EMAIL_VERIFICATION
        }
      }
    });
  }

  async function cleanup(): Promise<void> {
    const userIds = [...createdUserIds];
    if (userIds.length > 0) {
      await retryPrismaWriteConflict(async () => {
        await database().accountCreditEvent.deleteMany({
          where: {
            userId: {
              in: userIds
            }
          }
        });
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
      parsedDatabaseUrl.hostname !== "127.0.0.1" ||
      parsedDatabaseUrl.port !== "3308" ||
      parsedDatabaseUrl.pathname !== "/ai_aggregate_s13c1a"
    ) {
      throw new Error("TEST_DATABASE_MUST_BE_LOCAL_DISPOSABLE_S13C1A_MYSQL");
    }

    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
    secondPrisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
    await Promise.all([prisma.$connect(), secondPrisma.$connect()]);
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

  it("rejects noncanonical email, invalid hashes, and invalid dates at the Store boundary", async () => {
    await expect(
      store().registerUnverifiedUserAndIssueEmailVerificationToken(
        registrationInput({ email: "Upper@example.test" })
      )
    ).rejects.toThrow("INVALID_EMAIL_VERIFICATION_EMAIL");
    await expect(
      store().rotateEmailVerificationTokenForEmail(
        rotateInput("not-an-email")
      )
    ).rejects.toThrow("INVALID_EMAIL_VERIFICATION_EMAIL");
    await expect(
      store().registerUnverifiedUserAndIssueEmailVerificationToken(
        registrationInput({ tokenHash: "A".repeat(64) })
      )
    ).rejects.toThrow("INVALID_EMAIL_VERIFICATION_TOKEN_HASH");
    await expect(
      store().consumeEmailVerificationToken(
        consumeInput("f".repeat(64), { now: new Date("invalid") })
      )
    ).rejects.toThrow("INVALID_EMAIL_VERIFICATION_NOW");
    await expect(
      store().registerUnverifiedUserAndIssueEmailVerificationToken(
        registrationInput({ expiresAt: new Date("invalid") })
      )
    ).rejects.toThrow("INVALID_EMAIL_VERIFICATION_EXPIRES_AT");
    await expect(
      store().rotateEmailVerificationTokenForEmail(
        rotateInput(makeEmail("expired"), {
          expiresAt: new Date(Date.now() - 1)
        })
      )
    ).rejects.toThrow("INVALID_EMAIL_VERIFICATION_EXPIRES_AT");
  });

  it("atomically creates an unverified user and one email-verification token", async () => {
    const input = registrationInput({ passwordHash: "created-password-hash" });

    const result = await store().registerUnverifiedUserAndIssueEmailVerificationToken(
      input
    );

    expect(result).toEqual({
      status: "CREATED",
      userId: expect.any(String),
      email: input.email
    });
    if (result.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_CREATED_EMAIL_VERIFICATION_USER");
    }
    track(result.userId);
    await expect(
      database().user.findUnique({ where: { id: result.userId } })
    ).resolves.toMatchObject({
      email: input.email,
      passwordHash: input.passwordHash,
      emailVerifiedAt: null,
      lastLoginAt: null,
      sessionVersion: 0
    });
    await expect(emailVerificationToken(result.userId)).resolves.toMatchObject({
      userId: result.userId,
      kind: UserTokenKind.EMAIL_VERIFICATION,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null
    });
    await expect(
      database().userToken.count({
        where: { userId: result.userId, kind: UserTokenKind.PASSWORD_RESET }
      })
    ).resolves.toBe(0);
  });

  it("keeps an existing unverified registration unchanged and classifies verified users", async () => {
    const firstInput = registrationInput({ passwordHash: "first-password-hash" });
    const first = await store().registerUnverifiedUserAndIssueEmailVerificationToken(
      firstInput
    );
    if (first.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_FIRST_CREATED");
    }
    track(first.userId);
    const beforeToken = await emailVerificationToken(first.userId);

    await expect(
      store().registerUnverifiedUserAndIssueEmailVerificationToken(
        registrationInput({
          email: firstInput.email,
          passwordHash: "second-password-hash",
          tokenHash: makeTokenHash("duplicate")
        })
      )
    ).resolves.toEqual({ status: "EXISTING_UNVERIFIED" });
    await expect(
      database().user.findUnique({ where: { id: first.userId } })
    ).resolves.toMatchObject({
      passwordHash: firstInput.passwordHash,
      emailVerifiedAt: null
    });
    await expect(emailVerificationToken(first.userId)).resolves.toEqual(beforeToken);

    await database().user.update({
      where: { id: first.userId },
      data: { emailVerifiedAt: new Date() }
    });
    await expect(
      store().registerUnverifiedUserAndIssueEmailVerificationToken(
        registrationInput({
          email: firstInput.email,
          passwordHash: "third-password-hash",
          tokenHash: makeTokenHash("verified-duplicate")
        })
      )
    ).resolves.toEqual({ status: "ALREADY_VERIFIED" });
    await expect(
      database().user.findUnique({ where: { id: first.userId } })
    ).resolves.toMatchObject({ passwordHash: firstInput.passwordHash });
  });

  it("rolls back a new user when its email-verification hash conflicts", async () => {
    const owner = await createFixtureUser();
    const conflictHash = await createFixtureToken({
      userId: owner.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const input = registrationInput({ tokenHash: conflictHash });

    await expect(
      store().registerUnverifiedUserAndIssueEmailVerificationToken(input)
    ).rejects.toThrow("EMAIL_VERIFICATION_TOKEN_HASH_CONFLICT");
    await expect(
      database().user.findUnique({ where: { email: input.email } })
    ).resolves.toBeNull();
    await expect(
      database().userToken.findUnique({ where: { tokenHash: conflictHash } })
    ).resolves.toMatchObject({ userId: owner.id, kind: UserTokenKind.PASSWORD_RESET });
  });

  it("does not swallow unrelated P2002 conflicts", async () => {
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
        user: {
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
      failingStore.registerUnverifiedUserAndIssueEmailVerificationToken(
        registrationInput()
      )
    ).rejects.toBe(unrelatedError);
  });

  it("serializes concurrent registration without overwriting the winner", async () => {
    const email = makeEmail("concurrent-register");
    const firstInput = registrationInput({
      email,
      passwordHash: "first-concurrent-password"
    });
    const secondInput = registrationInput({
      email,
      passwordHash: "second-concurrent-password"
    });

    const [firstResult, secondResult] = await Promise.all([
      store().registerUnverifiedUserAndIssueEmailVerificationToken(firstInput),
      concurrentStore().registerUnverifiedUserAndIssueEmailVerificationToken(secondInput)
    ]);

    const results = [firstResult, secondResult];
    expect(results.filter((result) => result.status === "CREATED")).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "EXISTING_UNVERIFIED")
    ).toHaveLength(1);
    const created = results.find((result) => result.status === "CREATED");
    if (!created || created.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_CONCURRENT_CREATED_USER");
    }
    track(created.userId);
    const winningInput = firstResult.status === "CREATED" ? firstInput : secondInput;
    await expect(
      database().user.count({ where: { email } })
    ).resolves.toBe(1);
    await expect(
      database().user.findUnique({ where: { id: created.userId } })
    ).resolves.toMatchObject({ passwordHash: winningInput.passwordHash });
    await expect(
      database().userToken.count({
        where: {
          userId: created.userId,
          kind: UserTokenKind.EMAIL_VERIFICATION
        }
      })
    ).resolves.toBe(1);
    await expect(emailVerificationToken(created.userId)).resolves.toMatchObject({
      tokenHash: winningInput.tokenHash
    });
  });

  it("rotates only an unverified user's email token and preserves unrelated state", async () => {
    const missing = await store().rotateEmailVerificationTokenForEmail(
      rotateInput(makeEmail("missing"))
    );
    expect(missing).toEqual({ status: "NO_ACTION" });

    const verified = await createFixtureUser({ emailVerifiedAt: new Date() });
    await expect(
      store().rotateEmailVerificationTokenForEmail(rotateInput(verified.email))
    ).resolves.toEqual({ status: "NO_ACTION" });

    const lastLoginAt = new Date("2026-07-20T01:02:03.000Z");
    const user = await createFixtureUser({
      passwordHash: "rotate-password-hash",
      lastLoginAt,
      sessionVersion: 4
    });
    const oldTokenHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.EMAIL_VERIFICATION,
      usedAt: new Date("2026-07-20T01:00:00.000Z")
    });
    const resetTokenHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const beforeUser = await database().user.findUniqueOrThrow({
      where: { id: user.id }
    });
    const beforeReset = await database().userToken.findUniqueOrThrow({
      where: { tokenHash: resetTokenHash }
    });
    const input = rotateInput(user.email);

    await expect(
      store().rotateEmailVerificationTokenForEmail(input)
    ).resolves.toEqual({
      status: "ISSUED",
      userId: user.id,
      email: user.email
    });
    await expect(emailVerificationToken(user.id)).resolves.toMatchObject({
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null
    });
    await expect(
      database().userToken.findUnique({ where: { tokenHash: oldTokenHash } })
    ).resolves.toBeNull();
    await expect(
      database().user.findUnique({ where: { id: user.id } })
    ).resolves.toMatchObject({
      passwordHash: beforeUser.passwordHash,
      lastLoginAt: beforeUser.lastLoginAt,
      emailVerifiedAt: null,
      sessionVersion: beforeUser.sessionVersion
    });
    await expect(
      database().userToken.findUnique({ where: { tokenHash: resetTokenHash } })
    ).resolves.toEqual(beforeReset);
  });

  it("rolls back a resend hash collision and serializes concurrent resends", async () => {
    const user = await createFixtureUser();
    const originalHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    const collisionOwner = await createFixtureUser();
    const collisionHash = await createFixtureToken({
      userId: collisionOwner.id,
      kind: UserTokenKind.PASSWORD_RESET
    });

    await expect(
      store().rotateEmailVerificationTokenForEmail(
        rotateInput(user.email, { tokenHash: collisionHash })
      )
    ).rejects.toThrow("EMAIL_VERIFICATION_TOKEN_HASH_CONFLICT");
    await expect(emailVerificationToken(user.id)).resolves.toMatchObject({
      tokenHash: originalHash
    });

    const resetTokenHash = await createFixtureToken({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const firstInput = rotateInput(user.email);
    const secondInput = rotateInput(user.email);
    const results = await Promise.all([
      store().rotateEmailVerificationTokenForEmail(firstInput),
      concurrentStore().rotateEmailVerificationTokenForEmail(secondInput)
    ]);

    expect(results).toEqual([
      { status: "ISSUED", userId: user.id, email: user.email },
      { status: "ISSUED", userId: user.id, email: user.email }
    ]);
    const finalToken = await emailVerificationToken(user.id);
    expect([firstInput.tokenHash, secondInput.tokenHash]).toContain(
      finalToken.tokenHash
    );
    expect(finalToken.usedAt).toBeNull();
    await expect(
      database().userToken.count({
        where: { userId: user.id, kind: UserTokenKind.EMAIL_VERIFICATION }
      })
    ).resolves.toBe(1);
    await expect(
      database().userToken.findUnique({ where: { tokenHash: resetTokenHash } })
    ).resolves.toMatchObject({
      userId: user.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
  });

  it("consumes a valid token exactly once and increments sessionVersion once", async () => {
    const input = registrationInput();
    const registered = await store().registerUnverifiedUserAndIssueEmailVerificationToken(
      input
    );
    if (registered.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_CREATED_CONSUME_USER");
    }
    track(registered.userId);
    const now = new Date();

    await expect(
      store().consumeEmailVerificationToken(consumeInput(input.tokenHash, { now }))
    ).resolves.toEqual({
      status: "VERIFIED",
      userId: registered.userId,
      sessionVersion: 1
    });
    const verifiedUser = await database().user.findUniqueOrThrow({
      where: { id: registered.userId }
    });
    const usedToken = await emailVerificationToken(registered.userId);
    expect(verifiedUser.emailVerifiedAt?.getTime()).toBe(now.getTime());
    expect(verifiedUser.sessionVersion).toBe(1);
    expect(usedToken.usedAt?.getTime()).toBe(now.getTime());
    await expect(
      store().consumeEmailVerificationToken(consumeInput(input.tokenHash, { now }))
    ).resolves.toEqual({ status: "ALREADY_VERIFIED" });
    await expect(
      database().user.findUnique({ where: { id: registered.userId } })
    ).resolves.toMatchObject({ sessionVersion: 1 });
  });

  it("classifies expired, used, reset, missing, and deleted-token states as invalid", async () => {
    const expiredUser = await createFixtureUser();
    const expiredHash = await createFixtureToken({
      userId: expiredUser.id,
      kind: UserTokenKind.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() - 1)
    });
    const usedUser = await createFixtureUser();
    const usedHash = await createFixtureToken({
      userId: usedUser.id,
      kind: UserTokenKind.EMAIL_VERIFICATION,
      usedAt: new Date()
    });
    const resetUser = await createFixtureUser();
    const resetHash = await createFixtureToken({
      userId: resetUser.id,
      kind: UserTokenKind.PASSWORD_RESET
    });
    const deletedUser = await createFixtureUser();
    const deletedHash = await createFixtureToken({
      userId: deletedUser.id,
      kind: UserTokenKind.EMAIL_VERIFICATION
    });
    await database().user.delete({ where: { id: deletedUser.id } });

    for (const tokenHash of [
      expiredHash,
      usedHash,
      resetHash,
      deletedHash,
      makeTokenHash("missing")
    ]) {
      await expect(
        store().consumeEmailVerificationToken(consumeInput(tokenHash))
      ).resolves.toEqual({ status: "INVALID_OR_EXPIRED" });
    }
    await expect(
      database().user.findUnique({ where: { id: expiredUser.id } })
    ).resolves.toMatchObject({ emailVerifiedAt: null, sessionVersion: 0 });
    await expect(
      database().user.findUnique({ where: { id: usedUser.id } })
    ).resolves.toMatchObject({ emailVerifiedAt: null, sessionVersion: 0 });
  });

  it("allows exactly one concurrent verification and keeps the shared lock order with resend", async () => {
    const firstInput = registrationInput();
    const firstRegistration = await store().registerUnverifiedUserAndIssueEmailVerificationToken(
      firstInput
    );
    if (firstRegistration.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_CONCURRENT_CONSUME_USER");
    }
    track(firstRegistration.userId);
    const now = new Date();
    const consumeResults = await Promise.all([
      store().consumeEmailVerificationToken(consumeInput(firstInput.tokenHash, { now })),
      concurrentStore().consumeEmailVerificationToken(
        consumeInput(firstInput.tokenHash, { now })
      )
    ]);

    expect(consumeResults.filter((result) => result.status === "VERIFIED")).toHaveLength(1);
    expect(
      consumeResults.filter((result) => result.status === "ALREADY_VERIFIED")
    ).toHaveLength(1);
    await expect(
      database().user.findUnique({ where: { id: firstRegistration.userId } })
    ).resolves.toMatchObject({ sessionVersion: 1 });
    const firstToken = await emailVerificationToken(firstRegistration.userId);
    expect(firstToken.usedAt?.getTime()).toBe(now.getTime());

    const secondInput = registrationInput();
    const secondRegistration = await store().registerUnverifiedUserAndIssueEmailVerificationToken(
      secondInput
    );
    if (secondRegistration.status !== "CREATED") {
      throw new Error("TEST_EXPECTED_ROTATE_CONSUME_USER");
    }
    track(secondRegistration.userId);
    const rotate = rotateInput(secondInput.email);
    const [rotateResult, consumeResult] = await Promise.all([
      store().rotateEmailVerificationTokenForEmail(rotate),
      concurrentStore().consumeEmailVerificationToken(
        consumeInput(secondInput.tokenHash)
      )
    ]);

    const user = await database().user.findUniqueOrThrow({
      where: { id: secondRegistration.userId }
    });
    if (rotateResult.status === "ISSUED") {
      expect(consumeResult).toEqual({ status: "INVALID_OR_EXPIRED" });
      expect(user.emailVerifiedAt).toBeNull();
      await expect(emailVerificationToken(user.id)).resolves.toMatchObject({
        tokenHash: rotate.tokenHash,
        usedAt: null
      });
    } else {
      expect(rotateResult).toEqual({ status: "NO_ACTION" });
      expect(consumeResult).toMatchObject({
        status: "VERIFIED",
        userId: secondRegistration.userId,
        sessionVersion: 1
      });
      expect(user.emailVerifiedAt).toBeInstanceOf(Date);
      await expect(emailVerificationToken(user.id)).resolves.toMatchObject({
        tokenHash: secondInput.tokenHash,
        usedAt: expect.any(Date)
      });
    }
  });
});
