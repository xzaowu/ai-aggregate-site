import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  createDemoModels,
  defaultDemoModelConfigs,
  demoPlans
} from "@ai-aggregate/shared";

const DEFAULT_QUOTA_CREDITS = 20;
const PASSWORD_HASH_ROUNDS = 12;

type ModelProvider = "OPENAI_COMPATIBLE" | "SUB2API" | "NEW_API";
type UserRole = "USER" | "ADMIN";
type SiteSettingValueType = "string" | "boolean" | "number" | "json";

type UpsertArgs<TWhere, TUpdate, TCreate> = {
  where: TWhere;
  update: Partial<TUpdate>;
  create: TCreate;
};

type FindUniqueArgs<TWhere> = {
  where: TWhere;
};

export interface SeedPrismaClient {
  aiModel: {
    upsert(args: UpsertArgs<
      { slug: string },
      {
        name: string;
        provider: ModelProvider;
        modelId: string;
        capability: string;
        displayName: string | null;
        enabled: boolean;
        creditCost: number;
        allowGuest: boolean;
        sortOrder: number;
        group: string;
        tags: string;
        shortDescription: string | null;
        isRecommended: boolean;
        description: string | null;
      },
      {
        id: string;
        name: string;
        slug: string;
        provider: ModelProvider;
        modelId: string;
        capability: string;
        displayName: string | null;
        enabled: boolean;
        creditCost: number;
        allowGuest: boolean;
        sortOrder: number;
        group: string;
        tags: string;
        shortDescription: string | null;
        isRecommended: boolean;
        description: string | null;
      }
    >): Promise<unknown>;
    count(): Promise<number>;
    findUnique(args: FindUniqueArgs<{ slug: string }>): Promise<unknown>;
  };
  aiProviderAccount: {
    upsert(args: UpsertArgs<
      { id: string },
      {
        name: string;
        providerType: string;
        baseUrl: string;
        apiKey: string;
        capabilities: string[];
        enabled: boolean;
        priority: number;
        timeoutMs: number;
      },
      {
        id: string;
        name: string;
        providerType: string;
        baseUrl: string;
        apiKey: string;
        capabilities: string[];
        enabled: boolean;
        priority: number;
        timeoutMs: number;
      }
    >): Promise<unknown>;
  };
  aiModelRoute: {
    upsert(args: UpsertArgs<
      {
        modelId_providerId_upstreamModel: {
          modelId: string;
          providerId: string;
          upstreamModel: string;
        };
      },
      {
        priority: number;
        enabled: boolean;
      },
      {
        id: string;
        modelId: string;
        providerId: string;
        upstreamModel: string;
        priority: number;
        enabled: boolean;
      }
    >): Promise<unknown>;
  };
  plan: {
    upsert(args: UpsertArgs<
      { slug: string },
      {
        name: string;
        price: number;
        credits: number;
        description: string | null;
        features: string[];
        enabled: boolean;
        sortOrder: number;
      },
      {
        id: string;
        name: string;
        slug: string;
        price: number;
        credits: number;
        description: string | null;
        features: string[];
        enabled: boolean;
        sortOrder: number;
        highlighted: boolean;
      }
    >): Promise<unknown>;
    count(): Promise<number>;
    findUnique(args: FindUniqueArgs<{ slug: string }>): Promise<unknown>;
  };
  siteSetting: {
    upsert(args: UpsertArgs<
      { key: string },
      Record<string, never>,
      {
        key: string;
        value: string;
        type: SiteSettingValueType;
        description: string | null;
      }
    >): Promise<unknown>;
    count(): Promise<number>;
    findUnique(args: FindUniqueArgs<{ key: string }>): Promise<unknown>;
    update(args: {
      where: { key: string };
      data: { value: string };
    }): Promise<unknown>;
  };
  user: {
    findUnique(args: FindUniqueArgs<{ email: string }>): Promise<{
      id: string;
      email: string;
      role: UserRole;
      passwordHash: string;
      emailVerifiedAt: Date | null;
    } | null>;
    create(args: {
      data: {
        email: string;
        passwordHash: string;
        role: UserRole;
        emailVerifiedAt?: Date | null;
        quota?: {
          create: {
            remainingCredits: number;
          };
        };
      };
    }): Promise<{ id: string }>;
    update(args: {
      where: { email: string };
      data: { role: "ADMIN"; emailVerifiedAt?: Date };
    }): Promise<unknown>;
  };
  userQuota: {
    upsert(args: UpsertArgs<
      { userId: string },
      Record<string, never>,
      {
        userId: string;
        remainingCredits: number;
      }
    >): Promise<unknown>;
    findUnique(args: FindUniqueArgs<{ userId: string }>): Promise<unknown>;
  };
  $disconnect?: () => Promise<void>;
}

export type SeedEnvironment = Partial<
  Record<"SEED_ADMIN_EMAIL" | "SEED_ADMIN_PASSWORD", string | undefined>
>;

export type AdminSeedResult =
  | { skipped: true; reason: "missing-env" }
  | { skipped: false; created: boolean };

export const defaultSiteSettings = [
  {
    key: "siteName",
    value: "AI Aggregate",
    type: "string",
    description: "Public site name."
  },
  {
    key: "siteAnnouncement",
    value: "",
    type: "string",
    description: "Optional public home page announcement."
  },
  {
    key: "contactEmail",
    value: "",
    type: "string",
    description: "Optional public contact email."
  },
  {
    key: "defaultModel",
    value: "openai/gpt-oss-120b:free",
    type: "string",
    description: "Default model ID used by the frontend when enabled."
  },
  {
    key: "guestModeEnabled",
    value: "true",
    type: "boolean",
    description: "Allow anonymous chat requests."
  },
  {
    key: "guestRateLimitEnabled",
    value: "true",
    type: "boolean",
    description: "Enable additional anonymous chat rate limits."
  },
  {
    key: "profileRateLimitEnabled",
    value: "true",
    type: "boolean",
    description: "Enable per-user nickname and avatar update rate limits."
  },
  {
    key: "nicknameUpdateDailyLimit",
    value: "3",
    type: "number",
    description: "Maximum nickname updates per user per day."
  },
  {
    key: "avatarUpdateDailyLimit",
    value: "5",
    type: "number",
    description: "Maximum avatar updates per user per day."
  },
  {
    key: "referenceImageRateLimitEnabled",
    value: "true",
    type: "boolean",
    description: "Enable per-user reference image request rate limits."
  },
  {
    key: "referenceImageDailyLimit",
    value: "20",
    type: "number",
    description: "Maximum reference image requests per user per day."
  },
  {
    key: "guestChatConcurrencyLimit",
    value: "1",
    type: "number",
    description: "Maximum concurrent anonymous chat requests per IP."
  },
  {
    key: "userChatConcurrencyLimit",
    value: "2",
    type: "number",
    description: "Maximum concurrent chat requests per signed-in user."
  },
  {
    key: "imageGenerationConcurrencyLimit",
    value: "1",
    type: "number",
    description: "Maximum concurrent image generation requests per user."
  },
  {
    key: "registrationEnabled",
    value: "false",
    type: "boolean",
    description: "Allow new account registrations."
  },
  {
    key: "registrationClosedMessageZh",
    value: "当前暂未开放新用户注册，已有账号可正常登录。",
    type: "string",
    description: "Chinese message shown when public registration is closed."
  },
  {
    key: "registrationClosedMessageEn",
    value: "New user registration is currently unavailable. Existing users can still sign in.",
    type: "string",
    description: "English message shown when public registration is closed."
  },
  {
    key: "registrationEmailPolicyEnabled",
    value: "true",
    type: "boolean",
    description: "Apply the registration email domain policy."
  },
  {
    key: "registrationEmailPolicyMode",
    value: "ALLOWLIST",
    type: "string",
    description: "Registration email domain policy mode."
  },
  {
    key: "registrationAllowedDomainsJson",
    value: '["gmail.com","qq.com"]',
    type: "json",
    description: "Allowed registration email domains."
  },
  {
    key: "registrationBlockedDomainsJson",
    value: "[]",
    type: "json",
    description: "Blocked registration email domains."
  },
  {
    key: "maintenanceModeEnabled",
    value: "false",
    type: "boolean",
    description: "Show a public maintenance notice."
  },
  {
    key: "maintenanceMessage",
    value: "",
    type: "string",
    description: "Public maintenance notice text."
  },
  {
    key: "guestDailyLimit",
    value: "10",
    type: "number",
    description: "Anonymous chat requests allowed per IP per day."
  },
  {
    key: "guestPerModelHourlyLimit",
    value: "5",
    type: "number",
    description: "Anonymous chat requests allowed per model and IP per hour."
  },
  {
    key: "guestBurstLimit",
    value: "2",
    type: "number",
    description: "Anonymous chat requests allowed per IP during the burst window."
  },
  {
    key: "guestBurstWindowSeconds",
    value: "10",
    type: "number",
    description: "Anonymous chat burst window in seconds."
  },
  {
    key: "homeHeroTitle",
    value: "",
    type: "string",
    description: "Custom home page hero title. Falls back to i18n when empty."
  },
  {
    key: "homeHeroSubtitle",
    value: "",
    type: "string",
    description: "Custom home page hero subtitle. Falls back to i18n when empty."
  },
  {
    key: "homePrimaryCtaText",
    value: "",
    type: "string",
    description: "Custom home page primary CTA button text."
  },
  {
    key: "homeSecondaryCtaText",
    value: "",
    type: "string",
    description: "Custom home page secondary CTA button text."
  },
  {
    key: "homeBetaNotice",
    value: "",
    type: "string",
    description: "Custom beta notice text on home page."
  },
  {
    key: "homeRightCardNotice",
    value: "",
    type: "string",
    description: "Custom notice text in the home page right feature card."
  },
  {
    key: "footerSlogan",
    value: "",
    type: "string",
    description: "Custom public footer slogan below the site name."
  },
  {
    key: "homeFeatureCards",
    value: "",
    type: "string",
    description: "JSON array of feature card strings. Falls back to i18n when empty."
  },
  {
    key: "workspaceLinksLabel",
    value: "",
    type: "string",
    description: "Custom label for the workspace external links section."
  },
  {
    key: "workspaceIconUrl",
    value: "",
    type: "string",
    description: "Custom workspace hero icon URL. Falls back to the site logo or default icon when empty."
  },
  {
    key: "workspaceHeroTitle",
    value: "",
    type: "string",
    description: "Custom chat workspace hero title. Falls back to i18n when empty."
  },
  {
    key: "workspaceHeroSubtitle",
    value: "",
    type: "string",
    description: "Custom chat workspace hero subtitle. Falls back to i18n when empty."
  },
  {
    key: "workspacePromptCards",
    value: "",
    type: "string",
    description: "JSON array of chat workspace prompt cards with title, description, and prompt."
  },
  {
    key: "helpContentJson",
    value: "",
    type: "json",
    description: "Localized configurable content for the public help page."
  }
] satisfies Array<{
  key: string;
  value: string;
  type: SiteSettingValueType;
  description: string;
}>;

export async function seedDefaultModels(client: SeedPrismaClient) {
  const models = createDemoModels(defaultDemoModelConfigs);

  for (const model of models) {
    const existing = await client.aiModel.findUnique({
      where: { slug: model.slug }
    });
    const existingDisplayName =
      existing &&
      typeof existing === "object" &&
      "displayName" in existing &&
      typeof existing.displayName === "string" &&
      existing.displayName.trim().length > 0
        ? existing.displayName
        : null;
    const displayName = existingDisplayName ?? model.displayName ?? model.name;

    await client.aiModel.upsert({
      where: { slug: model.slug },
      update: {
        name: model.name,
        provider: model.provider,
        modelId: model.modelId,
        capability: model.capability,
        displayName,
        enabled: model.enabled,
        creditCost: model.creditCost,
        allowGuest: model.allowGuest,
        sortOrder: model.sortOrder,
        group: model.group,
        tags: model.tags.join(","),
        shortDescription: model.shortDescription ?? null,
        isRecommended: model.isRecommended,
        description: model.description ?? null
      },
      create: {
        id: model.id,
        name: model.name,
        slug: model.slug,
        provider: model.provider,
        modelId: model.modelId,
        capability: model.capability,
        displayName,
        enabled: model.enabled,
        creditCost: model.creditCost,
        allowGuest: model.allowGuest,
        sortOrder: model.sortOrder,
        group: model.group,
        tags: model.tags.join(","),
        shortDescription: model.shortDescription ?? null,
        isRecommended: model.isRecommended,
        description: model.description ?? null
      }
    });
  }
}

export async function seedDefaultModelRoutes(client: SeedPrismaClient) {
  const providerId = "provider_sub2api_main";
  const modelId = "model_deepseek_chat";
  const baseUrl =
    process.env.SUB2API_BASE_URL ||
    process.env.AI_BASE_URL ||
    "https://api.openai.com/v1";
  const apiKey = process.env.SUB2API_API_KEY || process.env.AI_API_KEY || "";

  await client.aiProviderAccount.upsert({
    where: { id: providerId },
    update: {
      name: "sub2api-main",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl,
      apiKey,
      capabilities: ["chat"],
      enabled: true,
      priority: 1,
      timeoutMs: 60000
    },
    create: {
      id: providerId,
      name: "sub2api-main",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl,
      apiKey,
      capabilities: ["chat"],
      enabled: true,
      priority: 1,
      timeoutMs: 60000
    }
  });

  await client.aiModel.upsert({
    where: { slug: "deepseek-chat" },
    update: {
      name: "DeepSeek Chat",
      provider: "SUB2API",
      modelId: "deepseek-chat",
      capability: "chat",
      displayName: "DeepSeek Chat",
      enabled: true,
      creditCost: 1,
      allowGuest: true,
      sortOrder: 10,
      group: "general",
      tags: "deepseek,chat",
      shortDescription: "DeepSeek Chat routed through configurable providers.",
      isRecommended: true,
      description: "Unified DeepSeek Chat model with admin-configurable upstream routes."
    },
    create: {
      id: modelId,
      name: "DeepSeek Chat",
      slug: "deepseek-chat",
      provider: "SUB2API",
      modelId: "deepseek-chat",
      capability: "chat",
      displayName: "DeepSeek Chat",
      enabled: true,
      creditCost: 1,
      allowGuest: true,
      sortOrder: 10,
      group: "general",
      tags: "deepseek,chat",
      shortDescription: "DeepSeek Chat routed through configurable providers.",
      isRecommended: true,
      description: "Unified DeepSeek Chat model with admin-configurable upstream routes."
    }
  });

  await client.aiModelRoute.upsert({
    where: {
      modelId_providerId_upstreamModel: {
        modelId,
        providerId,
        upstreamModel: "deepseek-chat"
      }
    },
    update: {
      priority: 1,
      enabled: true
    },
    create: {
      id: "route_deepseek_chat_sub2api_main",
      modelId,
      providerId,
      upstreamModel: "deepseek-chat",
      priority: 1,
      enabled: true
    }
  });
}

export async function seedDefaultPlans(client: SeedPrismaClient) {
  for (const plan of demoPlans) {
    const slug = planSlug(plan.id);
    const data = {
      name: plan.name,
      price: plan.price,
      credits: plan.credits,
      description: plan.description || null,
      features: plan.features,
      enabled: plan.enabled,
      sortOrder: plan.sortOrder
    };

    await client.plan.upsert({
      where: { slug },
      update: data,
      create: {
        id: plan.id,
        slug,
        ...data,
        highlighted: false
      }
    });
  }
}

export async function seedDefaultSettings(client: SeedPrismaClient) {
  for (const setting of defaultSiteSettings) {
    await client.siteSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: {
        ...setting,
        description: setting.description
      }
    });
  }
}

export async function seedAdminUser(
  client: SeedPrismaClient,
  env: SeedEnvironment = process.env
): Promise<AdminSeedResult> {
  const email = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.SEED_ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    return { skipped: true, reason: "missing-env" };
  }

  const existingUser = await client.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    if (existingUser.role !== "ADMIN" || existingUser.emailVerifiedAt === null) {
      await client.user.update({
        where: { email },
        data: {
          role: "ADMIN",
          emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date()
        }
      });
    }

    await client.userQuota.upsert({
      where: { userId: existingUser.id },
      update: {},
      create: {
        userId: existingUser.id,
        remainingCredits: DEFAULT_QUOTA_CREDITS
      }
    });

    return { skipped: false, created: false };
  }

  await client.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS),
      role: "ADMIN",
      emailVerifiedAt: new Date(),
      quota: {
        create: {
          remainingCredits: DEFAULT_QUOTA_CREDITS
        }
      }
    }
  });

  return { skipped: false, created: true };
}

export async function seedDatabase(
  client: SeedPrismaClient,
  env: SeedEnvironment = process.env
) {
  await seedDefaultModels(client);
  await seedDefaultModelRoutes(client);
  await seedDefaultPlans(client);
  await seedDefaultSettings(client);
  return seedAdminUser(client, env);
}

function planSlug(planId: string): string {
  return planId.replace(/^plan_/, "");
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const admin = await seedDatabase(prisma);
    const adminMessage = admin.skipped
      ? "admin skipped"
      : admin.created
        ? "admin created"
        : "admin updated";

    console.log(
      `Seed completed: demo models, demo plans, site settings, ${adminMessage}.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (import.meta.url === entrypoint) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
