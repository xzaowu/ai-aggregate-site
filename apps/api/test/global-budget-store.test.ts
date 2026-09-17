import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
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
import { createPrismaGlobalBudgetStore } from "../src/global-budget-store";
import type { ConsumeGlobalBudgetInput } from "../src/store";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;
const defaultInput = {
  scope: "image_generation",
  periodType: "DAILY",
  periodKey: "2026-07-16",
  budgetCredits: 10,
  costCredits: 3
} satisfies ConsumeGlobalBudgetInput;

databaseSuite.sequential("GlobalBudgetPeriod atomic Store operations", () => {
  let prisma: PrismaClient | undefined;
  let secondPrisma: PrismaClient | undefined;

  function database(): PrismaClient {
    if (!prisma) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }
    return prisma;
  }

  function secondDatabase(): PrismaClient {
    if (!secondPrisma) {
      throw new Error("TEST_SECOND_DATABASE_NOT_INITIALIZED");
    }
    return secondPrisma;
  }

  function budgetStore() {
    return createPrismaGlobalBudgetStore(database());
  }

  function input(
    overrides: Partial<ConsumeGlobalBudgetInput> = {}
  ): ConsumeGlobalBudgetInput {
    return { ...defaultInput, ...overrides };
  }

  async function readPeriod(periodKey = defaultInput.periodKey) {
    return readScopedPeriod(defaultInput.scope, periodKey);
  }

  async function readScopedPeriod(
    scope: ConsumeGlobalBudgetInput["scope"],
    periodKey = defaultInput.periodKey
  ) {
    return database().globalBudgetPeriod.findUniqueOrThrow({
      where: {
        scope_periodType_periodKey: {
          scope,
          periodType: defaultInput.periodType,
          periodKey
        }
      }
    });
  }

  async function cleanup(): Promise<void> {
    await retryPrismaWriteConflict(async () => {
      await prisma?.globalBudgetPeriod.deleteMany();
    });
  }

  beforeAll(async () => {
    if (!databaseUrl) {
      return;
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

  it("returns unavailable for invalid input without database access or rows", async () => {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL_MISSING");
    }

    const isolatedClient = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
    const transaction = vi.spyOn(isolatedClient, "$transaction");
    const invalidInputs: unknown[] = [
      null,
      {},
      { ...defaultInput, scope: "video_generation" },
      { ...defaultInput, periodType: "MONTHLY" },
      { ...defaultInput, periodKey: "2026-02-29" },
      { ...defaultInput, periodKey: "2024-02-30" },
      { ...defaultInput, periodKey: "2026-7-16" },
      { ...defaultInput, budgetCredits: 0 },
      { ...defaultInput, budgetCredits: -1 },
      { ...defaultInput, budgetCredits: 1.5 },
      { ...defaultInput, budgetCredits: Number.MAX_SAFE_INTEGER + 1 },
      { ...defaultInput, costCredits: 0 },
      { ...defaultInput, costCredits: Number.NaN },
      { ...defaultInput, costCredits: Number.POSITIVE_INFINITY },
      { ...defaultInput, costCredits: 11 }
    ];

    try {
      const store = createPrismaGlobalBudgetStore(isolatedClient);
      for (const invalidInput of invalidInputs) {
        await expect(
          store.consumeGlobalBudget(invalidInput as ConsumeGlobalBudgetInput)
        ).resolves.toEqual({ status: "unavailable" });
      }

      expect(transaction).not.toHaveBeenCalled();
      await expect(database().globalBudgetPeriod.count()).resolves.toBe(0);
    } finally {
      transaction.mockRestore();
      await isolatedClient.$disconnect();
    }
  });

  it("keeps the shared PrismaClient usable for the first legal consume", async () => {
    expect(typeof database().$transaction).toBe("function");
    await expect(budgetStore().consumeGlobalBudget(input())).resolves.toEqual({
      status: "consumed"
    });
    await expect(readPeriod()).resolves.toMatchObject({
      budgetCredits: 10n,
      consumedCredits: 3n
    });
  });

  it("accumulates consecutive consumes", async () => {
    await expect(budgetStore().consumeGlobalBudget(input())).resolves.toEqual({
      status: "consumed"
    });
    await expect(budgetStore().consumeGlobalBudget(input())).resolves.toEqual({
      status: "consumed"
    });
    await expect(readPeriod()).resolves.toMatchObject({ consumedCredits: 6n });
  });

  it("consumes exactly the remaining budget", async () => {
    await budgetStore().consumeGlobalBudget(input({ costCredits: 6 }));
    await expect(
      budgetStore().consumeGlobalBudget(input({ costCredits: 4 }))
    ).resolves.toEqual({ status: "consumed" });
    await expect(readPeriod()).resolves.toMatchObject({ consumedCredits: 10n });
  });

  it("returns exhausted without changing any persisted field", async () => {
    await budgetStore().consumeGlobalBudget(input({ costCredits: 9 }));
    const before = await readPeriod();

    await expect(
      budgetStore().consumeGlobalBudget(input({ costCredits: 2 }))
    ).resolves.toEqual({ status: "exhausted" });
    await expect(readPeriod()).resolves.toEqual(before);
  });

  it("returns unavailable on budget mismatch without changing any field", async () => {
    await budgetStore().consumeGlobalBudget(input({ costCredits: 3 }));
    const before = await readPeriod();

    await expect(
      budgetStore().consumeGlobalBudget(
        input({ budgetCredits: 11, costCredits: 1 })
      )
    ).resolves.toEqual({ status: "unavailable" });
    await expect(readPeriod()).resolves.toEqual(before);
  });

  it("allows a new period to use a different budget", async () => {
    await budgetStore().consumeGlobalBudget(input());
    await expect(
      budgetStore().consumeGlobalBudget(
        input({ periodKey: "2026-07-17", budgetCredits: 20, costCredits: 7 })
      )
    ).resolves.toEqual({ status: "consumed" });
    await expect(readPeriod("2026-07-17")).resolves.toMatchObject({
      budgetCredits: 20n,
      consumedCredits: 7n
    });
  });

  it("reads four current scopes with bounded status and safe empty rows", async () => {
    await budgetStore().consumeGlobalBudget(
      input({ budgetCredits: 100, costCredits: 20 })
    );
    await budgetStore().consumeGlobalBudget(
      input({
        scope: "chat_completion",
        budgetCredits: 10,
        costCredits: 8
      })
    );
    await budgetStore().consumeGlobalBudget(
      input({
        scope: "admin_provider_test",
        budgetCredits: 5,
        costCredits: 5
      })
    );
    await budgetStore().consumeGlobalBudget(
      input({
        scope: "title_cover_visual_brief",
        budgetCredits: 100,
        costCredits: 2
      })
    );
    await database().globalBudgetPeriod.update({
      where: {
        scope_periodType_periodKey: {
          scope: "admin_provider_test",
          periodType: "DAILY",
          periodKey: defaultInput.periodKey
        }
      },
      data: { consumedCredits: 9n }
    });

    await expect(
      budgetStore().listAdminBudgetPeriods(
        new Date("2026-07-16T12:00:00.000Z")
      )
    ).resolves.toEqual([
      {
        scope: "image_generation",
        periodType: "DAILY",
        periodKey: "2026-07-16",
        limit: 100,
        used: 20,
        remaining: 80,
        status: "NORMAL",
        updatedAt: expect.any(String)
      },
      {
        scope: "chat_completion",
        periodType: "DAILY",
        periodKey: "2026-07-16",
        limit: 10,
        used: 8,
        remaining: 2,
        status: "NEAR_LIMIT",
        updatedAt: expect.any(String)
      },
      {
        scope: "admin_provider_test",
        periodType: "DAILY",
        periodKey: "2026-07-16",
        limit: 5,
        used: 9,
        remaining: 0,
        status: "EXHAUSTED",
        updatedAt: expect.any(String)
      },
      {
        scope: "title_cover_visual_brief",
        periodType: "DAILY",
        periodKey: "2026-07-16",
        limit: 100,
        used: 2,
        remaining: 98,
        status: "NORMAL",
        updatedAt: expect.any(String)
      }
    ]);

    await cleanup();
    await expect(
      budgetStore().listAdminBudgetPeriods(
        new Date("2026-07-16T12:00:00.000Z")
      )
    ).resolves.toEqual([
      {
        scope: "image_generation",
        periodType: null,
        periodKey: null,
        limit: null,
        used: null,
        remaining: null,
        status: "NOT_INITIALIZED",
        updatedAt: null
      },
      {
        scope: "chat_completion",
        periodType: null,
        periodKey: null,
        limit: null,
        used: null,
        remaining: null,
        status: "NOT_INITIALIZED",
        updatedAt: null
      },
      {
        scope: "admin_provider_test",
        periodType: null,
        periodKey: null,
        limit: null,
        used: null,
        remaining: null,
        status: "NOT_INITIALIZED",
        updatedAt: null
      },
      {
        scope: "title_cover_visual_brief",
        periodType: null,
        periodKey: null,
        limit: null,
        used: null,
        remaining: null,
        status: "NOT_INITIALIZED",
        updatedAt: null
      }
    ]);
  });

  it("does not oversell budget=10 cost=3 under ten concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        budgetStore().consumeGlobalBudget(input())
      )
    );

    expect(results.filter((result) => result.status === "consumed")).toHaveLength(
      3
    );
    expect(
      results.filter((result) => result.status === "exhausted")
    ).toHaveLength(7);
    await expect(readPeriod()).resolves.toMatchObject({ consumedCredits: 9n });
  });

  it("does not oversell across two independent PrismaClient instances", async () => {
    const firstStore = createPrismaGlobalBudgetStore(database());
    const secondStore = createPrismaGlobalBudgetStore(secondDatabase());
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? firstStore : secondStore).consumeGlobalBudget(input())
      )
    );

    expect(results.filter((result) => result.status === "consumed")).toHaveLength(
      3
    );
    expect(
      results.filter((result) => result.status === "exhausted")
    ).toHaveLength(7);
    await expect(readPeriod()).resolves.toMatchObject({ consumedCredits: 9n });
  });

  it("creates only one row when the first consume is concurrent", async () => {
    const firstInput = input({ budgetCredits: 100, costCredits: 1 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        budgetStore().consumeGlobalBudget(firstInput)
      )
    );

    expect(results.every((result) => result.status === "consumed")).toBe(true);
    await expect(database().globalBudgetPeriod.count()).resolves.toBe(1);
    await expect(readPeriod()).resolves.toMatchObject({ consumedCredits: 20n });
  });

  it("persists legal values above the MySQL INT range", async () => {
    const aboveInt = 2_147_483_648;
    await expect(
      budgetStore().consumeGlobalBudget(
        input({ budgetCredits: aboveInt + 5, costCredits: aboveInt })
      )
    ).resolves.toEqual({ status: "consumed" });
    await expect(readPeriod()).resolves.toMatchObject({
      budgetCredits: BigInt(aboveInt + 5),
      consumedCredits: BigInt(aboveInt)
    });
  });

  it("keeps arithmetic exact near Number.MAX_SAFE_INTEGER", async () => {
    await expect(
      budgetStore().consumeGlobalBudget(
        input({
          budgetCredits: Number.MAX_SAFE_INTEGER,
          costCredits: Number.MAX_SAFE_INTEGER - 1
        })
      )
    ).resolves.toEqual({ status: "consumed" });
    await expect(
      budgetStore().consumeGlobalBudget(
        input({ budgetCredits: Number.MAX_SAFE_INTEGER, costCredits: 1 })
      )
    ).resolves.toEqual({ status: "consumed" });
    await expect(readPeriod()).resolves.toMatchObject({
      budgetCredits: BigInt(Number.MAX_SAFE_INTEGER),
      consumedCredits: BigInt(Number.MAX_SAFE_INTEGER)
    });
  });

  it("returns unavailable when the database is unavailable", async () => {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL_MISSING");
    }
    const unavailableUrl = new URL(databaseUrl);
    unavailableUrl.pathname = `/cost_be2_missing_${randomUUID().replaceAll("-", "")}`;
    const unavailableClient = new PrismaClient({
      datasources: { db: { url: unavailableUrl.toString() } }
    });

    try {
      await expect(
        createPrismaGlobalBudgetStore(unavailableClient).consumeGlobalBudget(
          input()
        )
      ).resolves.toEqual({ status: "unavailable" });
    } finally {
      await unavailableClient.$disconnect();
    }
    await expect(database().globalBudgetPeriod.count()).resolves.toBe(0);
  });

  it("returns unavailable without partial consumption when the transaction fails", async () => {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL_MISSING");
    }

    const failingClient = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
    const transactionSpy = vi.spyOn(failingClient, "$transaction");
    transactionSpy.mockRejectedValueOnce(
      new Error("synthetic global budget transaction failure")
    );

    try {
      const result = await createPrismaGlobalBudgetStore(
        failingClient
      ).consumeGlobalBudget(input());

      expect(result).toEqual({ status: "unavailable" });
      expect(JSON.stringify(result)).not.toContain(
        "synthetic global budget transaction failure"
      );
      await expect(failingClient.globalBudgetPeriod.count()).resolves.toBe(0);
    } finally {
      transactionSpy.mockRestore();
      await failingClient.$disconnect();
    }
  });

  it("isolates consumption between different periods", async () => {
    const firstPeriod = input({ budgetCredits: 5, costCredits: 5 });
    const secondPeriod = input({
      periodKey: "2026-07-17",
      budgetCredits: 8,
      costCredits: 3
    });

    await expect(
      budgetStore().consumeGlobalBudget(firstPeriod)
    ).resolves.toEqual({ status: "consumed" });
    await expect(
      budgetStore().consumeGlobalBudget(firstPeriod)
    ).resolves.toEqual({ status: "exhausted" });
    await expect(
      budgetStore().consumeGlobalBudget(secondPeriod)
    ).resolves.toEqual({ status: "consumed" });

    await expect(readPeriod()).resolves.toMatchObject({ consumedCredits: 5n });
    await expect(readPeriod("2026-07-17")).resolves.toMatchObject({
      consumedCredits: 3n
    });
  });

  it("accepts chat_completion scope consume", async () => {
    const chatInput = input({
      scope: "chat_completion",
      budgetCredits: 20,
      costCredits: 5
    });

    await expect(
      budgetStore().consumeGlobalBudget(chatInput)
    ).resolves.toEqual({ status: "consumed" });
    await expect(
      database().globalBudgetPeriod.findUnique({
        where: {
          scope_periodType_periodKey: {
            scope: "chat_completion",
            periodType: "DAILY",
            periodKey: defaultInput.periodKey
          }
        }
      })
    ).resolves.toMatchObject({ consumedCredits: 5n, budgetCredits: 20n });
  });

  it("isolates image_generation and chat_completion scopes on the same period", async () => {
    await budgetStore().consumeGlobalBudget(
      input({ budgetCredits: 10, costCredits: 3 })
    );
    await budgetStore().consumeGlobalBudget(
      input({
        scope: "chat_completion",
        budgetCredits: 20,
        costCredits: 5
      })
    );

    await expect(readPeriod()).resolves.toMatchObject({
      budgetCredits: 10n,
      consumedCredits: 3n
    });
    await expect(
      database().globalBudgetPeriod.findUniqueOrThrow({
        where: {
          scope_periodType_periodKey: {
            scope: "chat_completion",
            periodType: "DAILY",
            periodKey: defaultInput.periodKey
          }
        }
      })
    ).resolves.toMatchObject({ consumedCredits: 5n, budgetCredits: 20n });
  });

  it("accepts admin_provider_test scope consume", async () => {
    await expect(
      budgetStore().consumeGlobalBudget(
        input({
          scope: "admin_provider_test",
          budgetCredits: 20,
          costCredits: 5
        })
      )
    ).resolves.toEqual({ status: "consumed" });
    await expect(
      readScopedPeriod("admin_provider_test")
    ).resolves.toMatchObject({
      budgetCredits: 20n,
      consumedCredits: 5n
    });
  });

  it("accepts title_cover_visual_brief scope consume", async () => {
    await expect(
      budgetStore().consumeGlobalBudget(
        input({
          scope: "title_cover_visual_brief",
          budgetCredits: 100,
          costCredits: 2
        })
      )
    ).resolves.toEqual({ status: "consumed" });
    await expect(
      readScopedPeriod("title_cover_visual_brief")
    ).resolves.toMatchObject({
      budgetCredits: 100n,
      consumedCredits: 2n
    });
  });

  it("isolates admin_provider_test and chat_completion scopes on the same UTC day", async () => {
    await budgetStore().consumeGlobalBudget(
      input({ scope: "admin_provider_test", budgetCredits: 10, costCredits: 3 })
    );
    await budgetStore().consumeGlobalBudget(
      input({ scope: "chat_completion", budgetCredits: 20, costCredits: 5 })
    );

    await expect(
      readScopedPeriod("admin_provider_test")
    ).resolves.toMatchObject({ consumedCredits: 3n });
    await expect(readScopedPeriod("chat_completion")).resolves.toMatchObject({
      consumedCredits: 5n
    });
  });

  it("isolates admin_provider_test and image_generation scopes on the same UTC day", async () => {
    await budgetStore().consumeGlobalBudget(
      input({ scope: "admin_provider_test", budgetCredits: 10, costCredits: 3 })
    );
    await budgetStore().consumeGlobalBudget(
      input({ scope: "image_generation", budgetCredits: 20, costCredits: 5 })
    );

    await expect(
      readScopedPeriod("admin_provider_test")
    ).resolves.toMatchObject({ consumedCredits: 3n });
    await expect(readScopedPeriod("image_generation")).resolves.toMatchObject({
      consumedCredits: 5n
    });
  });

  it("does not oversell an admin_provider_test scope on one period", async () => {
    const adminInput = input({
      scope: "admin_provider_test",
      budgetCredits: 5,
      costCredits: 2
    });
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        budgetStore().consumeGlobalBudget(adminInput)
      )
    );

    expect(results.filter((result) => result.status === "consumed")).toHaveLength(
      2
    );
    expect(results.filter((result) => result.status === "exhausted")).toHaveLength(
      1
    );
    await expect(
      readScopedPeriod("admin_provider_test")
    ).resolves.toMatchObject({ consumedCredits: 4n });
  });

  it("returns unavailable for an admin_provider_test budget mismatch", async () => {
    const adminInput = input({
      scope: "admin_provider_test",
      budgetCredits: 10,
      costCredits: 3
    });
    await budgetStore().consumeGlobalBudget(adminInput);

    await expect(
      budgetStore().consumeGlobalBudget({
        ...adminInput,
        budgetCredits: 11,
        costCredits: 1
      })
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      readScopedPeriod("admin_provider_test")
    ).resolves.toMatchObject({ budgetCredits: 10n, consumedCredits: 3n });
  });
});
