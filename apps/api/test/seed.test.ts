import { describe, expect, it, vi } from "vitest";
import {
  defaultSiteSettings,
  seedAdminUser,
  seedDefaultModels,
  seedDefaultPlans,
  seedDefaultSettings,
  seedDatabase,
  type SeedPrismaClient
} from "../../../prisma/seed";

function createSeedClient(): SeedPrismaClient {
  const models = new Map<string, Record<string, unknown>>();
  const providerAccounts = new Map<string, Record<string, unknown>>();
  const modelRoutes = new Map<string, Record<string, unknown>>();
  const plans = new Map<string, Record<string, unknown>>();
  const settings = new Map<string, Record<string, unknown>>();
  const users = new Map<
    string,
    {
      id: string;
      email: string;
      role: "USER" | "ADMIN";
      passwordHash: string;
      emailVerifiedAt: Date | null;
    }
  >();
  const quotas = new Map<string, Record<string, unknown>>();

  return {
    aiModel: {
      async upsert({ where, update, create }) {
        const existing = models.get(where.slug);
        const next = existing ? { ...existing, ...update } : create;
        models.set(where.slug, next);
        return next;
      },
      async count() {
        return models.size;
      },
      async findUnique({ where }) {
        return models.get(where.slug) ?? null;
      }
    },
    aiProviderAccount: {
      async upsert({ where, update, create }) {
        const existing = providerAccounts.get(where.id);
        const next = existing ? { ...existing, ...update } : create;
        providerAccounts.set(where.id, next);
        return next;
      }
    },
    aiModelRoute: {
      async upsert({ where, update, create }) {
        const key = [
          where.modelId_providerId_upstreamModel.modelId,
          where.modelId_providerId_upstreamModel.providerId,
          where.modelId_providerId_upstreamModel.upstreamModel
        ].join(":");
        const existing = modelRoutes.get(key);
        const next = existing ? { ...existing, ...update } : create;
        modelRoutes.set(key, next);
        return next;
      }
    },
    plan: {
      async upsert({ where, update, create }) {
        const existing = plans.get(where.slug);
        const next = existing ? { ...existing, ...update } : create;
        plans.set(where.slug, next);
        return next;
      },
      async count() {
        return plans.size;
      },
      async findUnique({ where }) {
        return plans.get(where.slug) ?? null;
      }
    },
    siteSetting: {
      async upsert({ where, update, create }) {
        const existing = settings.get(where.key);
        const next = existing ? { ...existing, ...update } : create;
        settings.set(where.key, next);
        return next;
      },
      async count() {
        return settings.size;
      },
      async findUnique({ where }) {
        return settings.get(where.key) ?? null;
      },
      async update({ where, data }) {
        const existing = settings.get(where.key);

        if (!existing) {
          throw new Error("missing setting");
        }

        const updated = { ...existing, ...data };
        settings.set(where.key, updated);
        return updated;
      }
    },
    user: {
      async findUnique({ where }) {
        return users.get(where.email) ?? null;
      },
      async create({ data }) {
        const user = {
          id: `user_${users.size + 1}`,
          email: data.email,
          passwordHash: data.passwordHash,
          role: data.role,
          emailVerifiedAt: data.emailVerifiedAt ?? null
        };
        users.set(data.email, user);

        if (data.quota?.create) {
          quotas.set(user.id, {
            userId: user.id,
            remainingCredits: data.quota.create.remainingCredits
          });
        }

        return user;
      },
      async update({ where, data }) {
        const existing = users.get(where.email);

        if (!existing) {
          throw new Error("missing user");
        }

        const updated = { ...existing, ...data };
        users.set(where.email, updated);
        return updated;
      }
    },
    userQuota: {
      async upsert({ where, update, create }) {
        const existing = quotas.get(where.userId);
        const next = existing ? { ...existing, ...update } : create;
        quotas.set(where.userId, next);
        return next;
      },
      async findUnique({ where }) {
        return quotas.get(where.userId) ?? null;
      }
    },
    $disconnect: vi.fn()
  };
}

describe("prisma seed", () => {
  it("upserts default models and plans without creating duplicates", async () => {
    const client = createSeedClient();

    await seedDefaultModels(client);
    await seedDefaultPlans(client);
    await seedDefaultModels(client);
    await seedDefaultPlans(client);

    expect(await client.aiModel.count()).toBe(2);
    expect(await client.plan.count()).toBe(3);
    expect(await client.aiModel.findUnique({ where: { slug: "gpt-oss-120b-free" } }))
      .toMatchObject({
        name: "GPT OSS 120B Free",
        displayName: "GPT OSS 120B Free",
        enabled: true,
        creditCost: 1,
        allowGuest: true,
        sortOrder: 0,
        provider: "SUB2API",
        group: "free",
        tags: "free,general,chat",
        shortDescription: "Free model for general chat and lightweight tasks.",
        isRecommended: true
      });
    expect(await client.aiModel.findUnique({ where: { slug: "deepseek-r1-qwen3-8b" } }))
      .toMatchObject({
        group: "reasoning",
        tags: "reasoning,deepseek,analysis",
        shortDescription: "Good for reasoning, analysis, and complex problem solving.",
        isRecommended: true
      });
    expect(await client.plan.findUnique({ where: { slug: "pro" } }))
      .toMatchObject({
        name: "Pro",
        enabled: true,
        features: expect.any(Array)
      });
  });

  it("does not overwrite customized default model display names during seed", async () => {
    const client = createSeedClient();

    await seedDefaultModels(client);
    await client.aiModel.upsert({
      where: { slug: "gpt-oss-120b-free" },
      update: { displayName: "Custom GPT Label" },
      create: {
        id: "model_gpt-oss-120b-free",
        name: "GPT OSS 120B Free",
        slug: "gpt-oss-120b-free",
        provider: "SUB2API",
        modelId: "openai/gpt-oss-120b:free",
        capability: "chat",
        enabled: true,
        creditCost: 1,
        allowGuest: true,
        sortOrder: 0,
        group: "free",
        tags: "free,general,chat",
        shortDescription: "Free model for general chat and lightweight tasks.",
        isRecommended: true,
        description: "Free GPT OSS 120B chat model available through Sub2API.",
        displayName: "Custom GPT Label"
      }
    });

    await seedDefaultModels(client);

    expect(await client.aiModel.findUnique({ where: { slug: "gpt-oss-120b-free" } }))
      .toMatchObject({
        displayName: "Custom GPT Label"
      });
  });

  it("creates missing default site settings idempotently", async () => {
    const client = createSeedClient();

    await seedDefaultSettings(client);
    await seedDefaultSettings(client);

    expect(await client.siteSetting.count()).toBe(defaultSiteSettings.length);
    expect(await client.siteSetting.findUnique({ where: { key: "siteName" } }))
      .toMatchObject({
        key: "siteName",
        value: "AI Aggregate",
        type: "string"
      });
    expect(
      await client.siteSetting.findUnique({ where: { key: "guestDailyLimit" } })
    ).toMatchObject({
      key: "guestDailyLimit",
      value: "10",
      type: "number"
    });
    expect(
      await client.siteSetting.findUnique({ where: { key: "guestRateLimitEnabled" } })
    ).toMatchObject({ value: "true", type: "boolean" });
    expect(
      await client.siteSetting.findUnique({ where: { key: "guestPerModelHourlyLimit" } })
    ).toMatchObject({ value: "5", type: "number" });
    expect(
      await client.siteSetting.findUnique({ where: { key: "profileRateLimitEnabled" } })
    ).toMatchObject({ value: "true", type: "boolean" });
    expect(
      await client.siteSetting.findUnique({ where: { key: "nicknameUpdateDailyLimit" } })
    ).toMatchObject({ value: "3", type: "number" });
    expect(
      await client.siteSetting.findUnique({ where: { key: "avatarUpdateDailyLimit" } })
    ).toMatchObject({ value: "5", type: "number" });
    expect(
      await client.siteSetting.findUnique({ where: { key: "referenceImageRateLimitEnabled" } })
    ).toMatchObject({ value: "true", type: "boolean" });
    expect(
      await client.siteSetting.findUnique({ where: { key: "referenceImageDailyLimit" } })
    ).toMatchObject({ value: "20", type: "number" });
    expect(
      await client.siteSetting.findUnique({ where: { key: "guestBurstLimit" } })
    ).toMatchObject({ value: "2", type: "number" });
    expect(
      await client.siteSetting.findUnique({ where: { key: "guestBurstWindowSeconds" } })
    ).toMatchObject({ value: "10", type: "number" });
  });

  it("does not overwrite customized site setting values during seed", async () => {
    const client = createSeedClient();

    await seedDefaultSettings(client);
    await client.siteSetting.update({
      where: { key: "siteName" },
      data: { value: "Custom Name" }
    });
    await client.siteSetting.update({
      where: { key: "registrationEnabled" },
      data: { value: "false" }
    });
    await client.siteSetting.update({
      where: { key: "guestBurstLimit" },
      data: { value: "7" }
    });
    await seedDefaultSettings(client);

    expect(await client.siteSetting.findUnique({ where: { key: "siteName" } }))
      .toMatchObject({
        value: "Custom Name"
      });
    expect(
      await client.siteSetting.findUnique({
        where: { key: "registrationEnabled" }
      })
    ).toMatchObject({
      value: "false"
    });
    expect(
      await client.siteSetting.findUnique({ where: { key: "guestBurstLimit" } })
    ).toMatchObject({ value: "7" });
  });

  it("skips admin creation when either admin seed env value is missing", async () => {
    const client = createSeedClient();

    const missingEmail = await seedAdminUser(client, {
      SEED_ADMIN_PASSWORD: "strong-password"
    });
    const missingPassword = await seedAdminUser(client, {
      SEED_ADMIN_EMAIL: "admin@example.test"
    });

    expect(missingEmail).toEqual({ skipped: true, reason: "missing-env" });
    expect(missingPassword).toEqual({ skipped: true, reason: "missing-env" });
    expect(await client.user.findUnique({ where: { email: "admin@example.test" } }))
      .toBeNull();
  });

  it("creates a new admin with a hashed password and default quota", async () => {
    const client = createSeedClient();

    const result = await seedAdminUser(client, {
      SEED_ADMIN_EMAIL: "Admin@Example.Test",
      SEED_ADMIN_PASSWORD: "strong-password"
    });
    const admin = await client.user.findUnique({
      where: { email: "admin@example.test" }
    });

    expect(result).toEqual({ skipped: false, created: true });
    expect(admin).toMatchObject({
      email: "admin@example.test",
      role: "ADMIN",
      emailVerifiedAt: expect.any(Date)
    });
    expect(admin?.passwordHash).not.toBe("strong-password");
    expect(await client.userQuota.findUnique({ where: { userId: "user_1" } }))
      .toMatchObject({
        remainingCredits: 20
      });
  });

  it("promotes an existing user and preserves password and quota", async () => {
    const client = createSeedClient();
    await client.user.create({
      data: {
        email: "admin@example.test",
        passwordHash: "existing-hash",
        role: "USER",
        quota: {
          create: {
            remainingCredits: 77
          }
        }
      }
    });

    const result = await seedAdminUser(client, {
      SEED_ADMIN_EMAIL: "admin@example.test",
      SEED_ADMIN_PASSWORD: "new-password"
    });
    const admin = await client.user.findUnique({
      where: { email: "admin@example.test" }
    });
    const quota = await client.userQuota.findUnique({
      where: { userId: "user_1" }
    });

    expect(result).toEqual({ skipped: false, created: false });
    expect(admin).toMatchObject({
      role: "ADMIN",
      passwordHash: "existing-hash",
      emailVerifiedAt: expect.any(Date)
    });
    expect(quota).toMatchObject({
      remainingCredits: 77
    });
  });

  it("can run the full database seed twice idempotently", async () => {
    const client = createSeedClient();

    await seedDatabase(client, {
      SEED_ADMIN_EMAIL: "admin@example.test",
      SEED_ADMIN_PASSWORD: "strong-password"
    });
    await seedDatabase(client, {
      SEED_ADMIN_EMAIL: "admin@example.test",
      SEED_ADMIN_PASSWORD: "strong-password"
    });

    expect(await client.aiModel.count()).toBe(3);
    expect(await client.plan.count()).toBe(3);
    expect(await client.siteSetting.count()).toBe(defaultSiteSettings.length);
    expect(await client.user.findUnique({ where: { email: "admin@example.test" } }))
      .toMatchObject({
        role: "ADMIN"
      });
  });
});
