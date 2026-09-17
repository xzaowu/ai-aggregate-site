import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

export type CheckStatus = "PASS" | "WARN" | "FAIL";

export interface CheckResult {
  status: CheckStatus;
  name: string;
  message: string;
}

export interface CheckSummary {
  passed: number;
  warnings: number;
  failed: number;
}

type Env = Record<string, string | undefined>;

const requiredEnvVars = [
  "DATABASE_URL",
  "JWT_SECRET",
  "AI_BASE_URL",
  "AI_API_KEY",
  "DEFAULT_MODEL",
  "NEXT_PUBLIC_API_BASE_URL",
  "CORS_ORIGINS"
];

const optionalEnvVars = [
  "SEED_ADMIN_EMAIL",
  "SEED_ADMIN_PASSWORD",
  "GUEST_DAILY_LIMIT",
  "NEXT_PUBLIC_CONTACT_EMAIL",
  "NEXT_PUBLIC_APP_URL"
];

const forbiddenPublicKeys = [
  "AI_API_KEY",
  "JWT_SECRET",
  "DATABASE_URL",
  "SUB2API_KEY",
  "SUB2API_API_KEY",
  "SUB2API_BASE_URL"
];

function result(
  status: CheckStatus,
  name: string,
  message: string
): CheckResult {
  return { status, name, message };
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasPlaceholder(value: string | undefined): boolean {
  if (!isNonEmpty(value)) {
    return false;
  }

  const normalized = value.toLowerCase();
  return [
    "replace",
    "placeholder",
    "changeme",
    "change-me",
    "your-",
    "your_",
    "your_api_key",
    "example.com",
    "user:password"
  ].some((marker) => normalized.includes(marker));
}

function isWeakJwtSecret(value: string | undefined): boolean {
  if (!isNonEmpty(value)) {
    return false;
  }

  const secret = value.trim();

  if (secret.length < 32 || hasPlaceholder(secret)) {
    return true;
  }

  return [
    "secret",
    "jwt_secret",
    "password",
    "123456",
    "development"
  ].includes(secret.toLowerCase());
}

function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function evaluateEnvChecks(env: Env): CheckResult[] {
  const results: CheckResult[] = [];

  for (const key of requiredEnvVars) {
    results.push(
      isNonEmpty(env[key])
        ? result("PASS", `env:${key}`, `${key} is configured`)
        : result("FAIL", `env:${key}`, `${key} is required`)
    );
  }

  for (const key of optionalEnvVars) {
    results.push(
      isNonEmpty(env[key])
        ? result("PASS", `env:${key}`, `${key} is configured`)
        : result("WARN", `env:${key}`, `${key} is not configured`)
    );
  }

  if (isWeakJwtSecret(env.JWT_SECRET)) {
    results.push(
      result(
        "FAIL",
        "env:JWT_SECRET:strength",
        "JWT_SECRET must be a strong non-placeholder value of at least 32 characters"
      )
    );
  } else if (isNonEmpty(env.JWT_SECRET)) {
    results.push(
      result("PASS", "env:JWT_SECRET:strength", "JWT_SECRET strength looks usable")
    );
  }

  if (hasPlaceholder(env.AI_API_KEY)) {
    results.push(
      result("FAIL", "env:AI_API_KEY:value", "AI_API_KEY still looks like a placeholder")
    );
  } else if (isNonEmpty(env.AI_API_KEY)) {
    results.push(
      result("PASS", "env:AI_API_KEY:value", "AI_API_KEY is non-placeholder")
    );
  }

  if (hasPlaceholder(env.DATABASE_URL)) {
    results.push(
      result(
        "FAIL",
        "env:DATABASE_URL:value",
        "DATABASE_URL still looks like a placeholder"
      )
    );
  } else if (isNonEmpty(env.DATABASE_URL)) {
    results.push(
      result("PASS", "env:DATABASE_URL:value", "DATABASE_URL is non-placeholder")
    );
  }

  const corsOrigins = parseCorsOrigins(env.CORS_ORIGINS);
  const usesWildcardCors = corsOrigins.includes("*");

  if (env.NODE_ENV === "production" && usesWildcardCors) {
    results.push(
      result(
        "FAIL",
        "env:CORS_ORIGINS:production",
        "CORS_ORIGINS must not be * in production"
      )
    );
  } else if (usesWildcardCors) {
    results.push(
      result("WARN", "env:CORS_ORIGINS:wildcard", "CORS_ORIGINS is * outside production")
    );
  } else if (corsOrigins.length > 0) {
    results.push(
      result("PASS", "env:CORS_ORIGINS:production", "CORS_ORIGINS is restricted")
    );
  }

  return results;
}

export function containsForbiddenPublicSetting(
  value: unknown,
  env: Env = {}
): boolean {
  const secretValues = [env.AI_API_KEY, env.JWT_SECRET, env.DATABASE_URL].filter(
    (secret): secret is string => isNonEmpty(secret) && !hasPlaceholder(secret)
  );

  function visit(current: unknown): boolean {
    if (typeof current === "string") {
      return secretValues.some((secret) => current.includes(secret));
    }

    if (Array.isArray(current)) {
      return current.some(visit);
    }

    if (current && typeof current === "object") {
      return Object.entries(current).some(([key, nested]) => {
        const normalized = key.toUpperCase();
        return (
          forbiddenPublicKeys.includes(normalized) ||
          normalized.includes("API_KEY") ||
          normalized.includes("SECRET") ||
          normalized.includes("DATABASE_URL") ||
          visit(nested)
        );
      });
    }

    return false;
  }

  return visit(value);
}

export function createSummary(results: CheckResult[]): CheckSummary {
  return {
    passed: results.filter((check) => check.status === "PASS").length,
    warnings: results.filter((check) => check.status === "WARN").length,
    failed: results.filter((check) => check.status === "FAIL").length
  };
}

export function getExitCode(results: CheckResult[]): 0 | 1 {
  return createSummary(results).failed > 0 ? 1 : 0;
}

function loadDotEnvFile(envPath = resolve(process.cwd(), ".env")): Env {
  if (!existsSync(envPath)) {
    return {};
  }

  const parsed: Env = {};
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    parsed[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }

  return parsed;
}

function resolveEnv(): Env {
  return {
    ...loadDotEnvFile(),
    ...process.env
  };
}

async function runDatabaseChecks(
  prisma: PrismaClient,
  env: Env
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    results.push(result("PASS", "db:connection", "Database connection works"));
  } catch {
    return [
      result(
        "FAIL",
        "db:connection",
        "Database connection failed; verify DATABASE_URL and network access"
      )
    ];
  }

  const [
    modelCount,
    enabledModelCount,
    planCount,
    siteSettingCount,
    defaultModel,
    defaultSiteSetting
  ] = await Promise.all([
    prisma.aiModel.count(),
    prisma.aiModel.count({ where: { enabled: true } }),
    prisma.plan.count(),
    prisma.siteSetting.count(),
    isNonEmpty(env.DEFAULT_MODEL)
      ? prisma.aiModel.findFirst({ where: { modelId: env.DEFAULT_MODEL } })
      : Promise.resolve(null),
    prisma.siteSetting.findUnique({ where: { key: "defaultModel" } })
  ]);

  results.push(
    modelCount > 0
      ? result("PASS", "db:models:any", "At least one AiModel exists")
      : result("FAIL", "db:models:any", "No AiModel records found; run prisma:seed")
  );
  results.push(
    enabledModelCount > 0
      ? result("PASS", "db:models:enabled", "At least one enabled AiModel exists")
      : result("FAIL", "db:models:enabled", "No enabled AiModel records found")
  );

  if (defaultModel?.enabled) {
    results.push(
      result("PASS", "db:models:default", "DEFAULT_MODEL exists and is enabled")
    );
  } else {
    const settingModelId = defaultSiteSetting?.value.trim();
    const settingModel = settingModelId
      ? await prisma.aiModel.findFirst({ where: { modelId: settingModelId } })
      : null;

    results.push(
      settingModel?.enabled
        ? result(
            "WARN",
            "db:models:default",
            "DEFAULT_MODEL is not enabled, but site defaultModel points to an enabled model"
          )
        : result(
            "WARN",
            "db:models:default",
            "DEFAULT_MODEL is not an enabled AiModel; chat requests may fail until model settings are fixed"
          )
    );
  }

  results.push(
    planCount > 0
      ? result("PASS", "db:plans:any", "At least one Plan exists")
      : result("FAIL", "db:plans:any", "No Plan records found; run prisma:seed")
  );
  results.push(
    siteSettingCount > 0
      ? result("PASS", "db:settings:any", "SiteSetting records exist")
      : result("FAIL", "db:settings:any", "No SiteSetting records found; run prisma:seed")
  );

  const seedAdminEmail = env.SEED_ADMIN_EMAIL;

  if (isNonEmpty(seedAdminEmail)) {
    const admin = await prisma.user.findUnique({
      where: { email: seedAdminEmail.toLowerCase() }
    });

    results.push(
      admin?.role === "ADMIN"
        ? result("PASS", "db:admin:seed", "Configured seed admin exists")
        : result(
            "FAIL",
            "db:admin:seed",
            "SEED_ADMIN_EMAIL is configured but no ADMIN user exists for it"
          )
    );
  } else {
    results.push(
      result("WARN", "db:admin:seed", "SEED_ADMIN_EMAIL is not configured")
    );
  }

  return results;
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json"
      }
    });
    const text = await response.text();
    let body: unknown = null;

    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function runApiChecks(env: Env): Promise<CheckResult[]> {
  const baseUrl = env.API_BASE_URL || env.NEXT_PUBLIC_API_BASE_URL;

  if (!isNonEmpty(baseUrl)) {
    return [
      result(
        "WARN",
        "api:base-url",
        "API_BASE_URL and NEXT_PUBLIC_API_BASE_URL are missing; skipping API checks"
      )
    ];
  }

  const checks: Array<{
    name: string;
    path: string;
    validate: (body: unknown) => CheckResult;
  }> = [
    {
      name: "api:health",
      path: "/health",
      validate: (body) =>
        isRecord(body) && String(body.status).toLowerCase() === "ok"
          ? result("PASS", "api:health", "GET /health returned OK")
          : result("FAIL", "api:health", "GET /health did not return OK")
    },
    {
      name: "api:models",
      path: "/models",
      validate: (body) =>
        isRecord(body) && Array.isArray(body.models) && body.models.length > 0
          ? result("PASS", "api:models", "GET /models returned usable data")
          : result("FAIL", "api:models", "GET /models returned no usable models")
    },
    {
      name: "api:plans",
      path: "/plans",
      validate: (body) =>
        isRecord(body) && Array.isArray(body.plans) && body.plans.length > 0
          ? result("PASS", "api:plans", "GET /plans returned usable data")
          : result("FAIL", "api:plans", "GET /plans returned no usable plans")
    },
    {
      name: "api:settings:public",
      path: "/settings/public",
      validate: (body) => {
        if (!isRecord(body) || !isRecord(body.settings)) {
          return result(
            "FAIL",
            "api:settings:public",
            "GET /settings/public returned no usable settings"
          );
        }

        return containsForbiddenPublicSetting(body, env)
          ? result(
              "FAIL",
              "api:settings:public",
              "GET /settings/public exposes secret-like settings"
            )
          : result(
              "PASS",
              "api:settings:public",
              "GET /settings/public returned safe public settings"
            );
      }
    }
  ];

  const results: CheckResult[] = [
    result("PASS", "api:base-url", "API base URL is configured")
  ];

  for (const check of checks) {
    try {
      const response = await fetchJsonWithTimeout(buildUrl(baseUrl, check.path), 5000);

      results.push(
        response.ok
          ? check.validate(response.body)
          : result(
              "FAIL",
              check.name,
              `${check.path} returned HTTP ${response.status}`
            )
      );
    } catch {
      results.push(
        result("FAIL", check.name, `${check.path} request failed or timed out`)
      );
    }
  }

  return results;
}

function printResults(results: CheckResult[]): void {
  for (const check of results) {
    console.log(`${check.status} ${check.name} - ${check.message}`);
  }

  const summary = createSummary(results);
  console.log(
    `Summary: passed=${summary.passed} warnings=${summary.warnings} failed=${summary.failed}`
  );
}

async function main(): Promise<void> {
  const env = resolveEnv();
  const prisma = new PrismaClient();
  const results: CheckResult[] = [];

  try {
    results.push(...evaluateEnvChecks(env));
    results.push(...(await runDatabaseChecks(prisma, env)));
    results.push(...(await runApiChecks(env)));
  } finally {
    await prisma.$disconnect();
  }

  printResults(results);
  process.exitCode = getExitCode(results);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/check-deploy.ts")) {
  void main();
}
