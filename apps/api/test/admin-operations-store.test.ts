import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPrismaUserStore,
  normalizeAdminManualCompensationCreditDelta
} from "../src/store";
import { retryPrismaWriteConflict } from "./helpers/retry-prisma-write-conflict";

const databaseUrl = process.env.DATABASE_URL;
const fixturePrefix = `s5c2b1_ops_${randomUUID()}_`;
const fixtureNow = new Date("2200-01-01T12:00:00.000Z");

describe.sequential("S5-C2B1 Admin operations Store queries", () => {
  let prisma: PrismaClient | undefined;
  let store: ReturnType<typeof createPrismaUserStore> | undefined;
  let fixtureUserId = "";
  let fixtureModelId = "";

  function database(): PrismaClient {
    if (!prisma) {
      throw new Error("TEST_DATABASE_NOT_INITIALIZED");
    }
    return prisma;
  }

  function operationsStore(): ReturnType<typeof createPrismaUserStore> {
    if (!store) {
      throw new Error("TEST_STORE_NOT_INITIALIZED");
    }
    return store;
  }

  async function createQuotaAuditLog(input: {
    id: string;
    metadata?: Prisma.InputJsonValue;
    createdAt: Date;
    summary?: string;
  }): Promise<void> {
    await database().adminAuditLog.create({
      data: {
        id: input.id,
        adminUserId: fixtureUserId,
        adminEmail: "admin-secret@example.test",
        action: "UPDATE_USER_QUOTA",
        targetType: "User",
        targetId: fixtureUserId,
        summary: input.summary ?? "secret audit summary",
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        createdAt: input.createdAt
      }
    });
  }

  async function cleanup(): Promise<void> {
    if (!prisma) {
      return;
    }
    const prismaClient = prisma;

    await retryPrismaWriteConflict(async () => {
      await prismaClient.adminAuditLog.deleteMany({
        where: { adminUserId: { startsWith: fixturePrefix } }
      });
      await prismaClient.user.deleteMany({
        where: { id: { startsWith: fixturePrefix } }
      });
      await prismaClient.aiModel.deleteMany({
        where: { modelId: { startsWith: fixturePrefix } }
      });
      await prismaClient.siteSetting.deleteMany({
        where: { key: { startsWith: fixturePrefix } }
      });
    });
  }

  async function cleanupCaseRows(): Promise<void> {
    await retryPrismaWriteConflict(async () => {
      await database().aiTask.deleteMany({
        where: { userId: fixtureUserId }
      });
      await database().adminAuditLog.deleteMany({
        where: { adminUserId: fixtureUserId }
      });
    });
  }

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL_MISSING");
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

    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
    await prisma.$connect();
    store = createPrismaUserStore(prisma);

    fixtureUserId = `${fixturePrefix}user`;
    fixtureModelId = `${fixturePrefix}model`;
    await database().user.create({
      data: {
        id: fixtureUserId,
        email: `${fixtureUserId}@example.test`,
        passwordHash: "fixture-password-hash",
        quota: { create: { remainingCredits: 100 } }
      }
    });
    await database().aiModel.create({
      data: {
        id: `${fixturePrefix}model-record`,
        name: "Fixture model",
        displayName: "Safe fixture model",
        slug: `${fixturePrefix}slug`,
        provider: "OPENAI_COMPATIBLE",
        modelId: fixtureModelId,
        capability: "image",
        enabled: true,
        creditCost: 2,
        allowGuest: false,
        sortOrder: 0,
        isRecommended: false
      }
    });
  });

  beforeEach(async () => {
    await cleanupCaseRows();
  });

  afterEach(async () => {
    await cleanupCaseRows();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma?.$disconnect();
    }
  });

  it("returns 50 stable safe task DTOs and 50 quota audit DTOs", async () => {
    const taskRows = Array.from({ length: 51 }, (_, index) => ({
      id: `${fixturePrefix}task-${String(index).padStart(2, "0")}`,
      userId: fixtureUserId,
      type: "IMAGE" as const,
      status: "FAILED" as const,
      modelId: fixtureModelId,
      prompt: `secret prompt ${index}`,
      input: {
        prompt: `input secret ${index}`,
        imagePath: `/private/${index}.png`
      },
      costCredits: 0,
      errorMessage: `raw provider error ${index}`,
      createdAt: new Date(fixtureNow.getTime() + index * 1000),
      updatedAt: new Date(fixtureNow.getTime() + index * 1000)
    }));
    await database().aiTask.createMany({ data: taskRows });

    const chargedTask = await database().aiTask.create({
      data: {
        id: `${fixturePrefix}task-charged`,
        userId: fixtureUserId,
        type: "IMAGE",
        status: "FAILED",
        modelId: fixtureModelId,
        prompt: "charged task secret prompt",
        input: {
          prompt: "charged input secret",
          authorization: "Bearer fixture-token"
        },
        costCredits: 4,
        errorMessage: "raw provider body and https://provider.example/raw",
        createdAt: new Date(fixtureNow.getTime() + 100_000),
        updatedAt: new Date(fixtureNow.getTime() + 100_000)
      }
    });
    await database().creditReservation.create({
      data: {
        userId: fixtureUserId,
        kind: "IMAGE_GENERATION",
        amountCredits: 4,
        status: "SETTLED",
        expiresAt: new Date("2026-07-28T00:00:00.000Z"),
        settledAt: new Date(fixtureNow.getTime() + 100_000),
        aiTaskId: chargedTask.id
      }
    });

    await database().adminAuditLog.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        id: `${fixturePrefix}audit-${String(index).padStart(2, "0")}`,
        adminUserId: fixtureUserId,
        adminEmail: "admin-secret@example.test",
        action: "UPDATE_USER_QUOTA",
        targetType: "User",
        targetId: fixtureUserId,
        summary: "secret audit summary",
        metadata: {
          oldCredits: index,
          newCredits: index + 1,
          secret: "metadata-secret"
        },
        createdAt: new Date(fixtureNow.getTime() + index * 1000)
      }))
    });

    const tasks = await operationsStore().listAdminOperationsTasks();
    const compensations = await operationsStore().listAdminManualCompensations();

    expect(tasks).toHaveLength(50);
    expect(tasks[0]).toMatchObject({
      taskId: chargedTask.id,
      userId: fixtureUserId,
      type: "image",
      status: "failed",
      modelId: fixtureModelId,
      modelLabel: "Safe fixture model",
      providerLabel: null,
      routeId: null,
      safeErrorClass: "CHARGED_AND_FAILED",
      chargeStatus: "SETTLED",
      creditReleaseStatus: "NOT_RELEASED",
      refundStatus: "UNKNOWN",
      costRecorded: true
    });
    expect(tasks.every((task) => Object.keys(task).sort().join(",") === [
      "chargeStatus",
      "costRecorded",
      "createdAt",
      "creditReleaseStatus",
      "modelId",
      "modelLabel",
      "providerLabel",
      "refundStatus",
      "routeId",
      "safeErrorClass",
      "status",
      "taskId",
      "type",
      "updatedAt",
      "userId"
    ].join(","))).toBe(true);
    expect(JSON.stringify(tasks)).not.toContain("secret prompt");
    expect(JSON.stringify(tasks)).not.toContain("raw provider");
    expect(JSON.stringify(tasks)).not.toContain("fixture-token");
    expect(compensations).toHaveLength(50);
    expect(compensations[0]).toMatchObject({
      auditId: `${fixturePrefix}audit-50`,
      targetUserId: fixtureUserId,
      action: "UPDATE_USER_QUOTA",
      creditChangeStatus: "RECORDED",
      creditDelta: 1
    });
    expect(Object.keys(compensations[0] ?? {}).sort()).toEqual([
      "action",
      "auditId",
      "createdAt",
      "creditChangeStatus",
      "creditDelta",
      "targetUserId"
    ]);
    expect(JSON.stringify(compensations)).not.toContain("admin-secret");
    expect(JSON.stringify(compensations)).not.toContain("metadata-secret");
  });

  it("returns signed credit deltas, including a recorded zero", async () => {
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-positive`,
      metadata: { oldCredits: 20, newCredits: 22 },
      createdAt: new Date(fixtureNow.getTime() + 1_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-negative`,
      metadata: { oldCredits: 22, newCredits: 20 },
      createdAt: new Date(fixtureNow.getTime() + 2_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-zero`,
      metadata: { oldCredits: 20, newCredits: 20 },
      createdAt: new Date(fixtureNow.getTime() + 3_000)
    });

    const compensations = await operationsStore().listAdminManualCompensations();

    expect(compensations).toHaveLength(3);
    expect(compensations.find((item) => item.auditId.endsWith("positive"))).toMatchObject({
      creditChangeStatus: "RECORDED",
      creditDelta: 2
    });
    expect(compensations.find((item) => item.auditId.endsWith("negative"))).toMatchObject({
      creditChangeStatus: "RECORDED",
      creditDelta: -2
    });
    expect(compensations.find((item) => item.auditId.endsWith("zero"))).toMatchObject({
      creditChangeStatus: "RECORDED",
      creditDelta: 0
    });
  });

  it("returns UNKNOWN for missing, invalid, or non-whitelist credit data", async () => {
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-missing-metadata`,
      createdAt: new Date(fixtureNow.getTime() + 1_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-missing-old`,
      metadata: { newCredits: 20 },
      createdAt: new Date(fixtureNow.getTime() + 2_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-missing-new`,
      metadata: { oldCredits: 20 },
      createdAt: new Date(fixtureNow.getTime() + 3_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-non-number`,
      metadata: { oldCredits: "20", newCredits: 22 },
      createdAt: new Date(fixtureNow.getTime() + 4_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-fake-delta`,
      metadata: { oldCredits: 20, newCredits: 22, delta: -999 },
      createdAt: new Date(fixtureNow.getTime() + 5_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-summary-number`,
      metadata: { oldCredits: 20, newCredits: 20 },
      summary: "quota changed by 999 credits",
      createdAt: new Date(fixtureNow.getTime() + 6_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-sensitive-metadata`,
      metadata: {
        oldCredits: 20,
        newCredits: 22,
        DATABASE_URL: "mysql://secret",
        JWT_SECRET: "jwt-secret",
        rawToken: "raw-token"
      },
      createdAt: new Date(fixtureNow.getTime() + 7_000)
    });
    await createQuotaAuditLog({
      id: `${fixturePrefix}audit-over-boundary`,
      metadata: {
        oldCredits: Number.MAX_SAFE_INTEGER + 1,
        newCredits: Number.MAX_SAFE_INTEGER + 2
      },
      createdAt: new Date(fixtureNow.getTime() + 8_000)
    });

    const compensations = await operationsStore().listAdminManualCompensations();

    for (const item of compensations.filter(
      (entry) => !entry.auditId.endsWith("sensitive-metadata")
    )) {
      if (
        item.auditId.endsWith("fake-delta") ||
        item.auditId.endsWith("summary-number")
      ) {
        expect(item).toMatchObject({
          creditChangeStatus: "RECORDED",
          creditDelta: item.auditId.endsWith("fake-delta") ? 2 : 0
        });
      } else {
        expect(item).toMatchObject({
          creditChangeStatus: "UNKNOWN",
          creditDelta: null
        });
      }
    }
    expect(compensations.find((item) => item.auditId.endsWith("sensitive-metadata"))).toMatchObject({
      creditChangeStatus: "RECORDED",
      creditDelta: 2
    });
    expect(JSON.stringify(compensations)).not.toContain("mysql://secret");
    expect(JSON.stringify(compensations)).not.toContain("jwt-secret");
    expect(JSON.stringify(compensations)).not.toContain("raw-token");
    expect(JSON.stringify(compensations)).not.toContain("quota changed by 999");

    expect(
      normalizeAdminManualCompensationCreditDelta({
        oldCredits: Number.NaN,
        newCredits: 20
      })
    ).toBeNull();
    expect(
      normalizeAdminManualCompensationCreditDelta({
        oldCredits: 20,
        newCredits: Number.POSITIVE_INFINITY
      })
    ).toBeNull();
    expect(
      normalizeAdminManualCompensationCreditDelta([20, 22])
    ).toBeNull();
    expect(
      normalizeAdminManualCompensationCreditDelta("malformed JSON")
    ).toBeNull();
  });

  it("serializes concurrent SiteSetting mutations without losing routes", async () => {
    const key = `${fixturePrefix}moderationSettings`;
    const initial = JSON.stringify({ version: 1, enabled: true, routes: [] });

    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        operationsStore().updateSettingAtomically({
          key,
          create: { key, value: initial, type: "json" },
          update: (current) => {
            const parsed = current
              ? (JSON.parse(current.value) as {
                  version: 1;
                  enabled: boolean;
                  routes: Array<{ id: string }>;
                })
              : { version: 1 as const, enabled: true, routes: [] };
            return {
              key,
              value: JSON.stringify({
                ...parsed,
                routes: [...parsed.routes, { id: `${fixturePrefix}route-${index}` }]
              }),
              type: "json"
            };
          }
        })
      )
    );

    const saved = await operationsStore().getSetting(key);
    const parsed = saved
      ? (JSON.parse(saved.value) as { routes: Array<{ id: string }> })
      : null;
    expect(parsed?.routes.map((route) => route.id).sort()).toEqual(
      Array.from({ length: 4 }, (_, index) => `${fixturePrefix}route-${index}`).sort()
    );
  });
});
