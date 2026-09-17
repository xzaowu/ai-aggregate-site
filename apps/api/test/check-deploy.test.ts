import { describe, expect, it } from "vitest";
import {
  containsForbiddenPublicSetting,
  createSummary,
  evaluateEnvChecks,
  getExitCode,
  type CheckResult
} from "../../../scripts/check-deploy";

const validEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "mysql://user:pass@localhost:3306/ai_aggregate_site",
  JWT_SECRET: "this-is-a-long-random-secret-for-launch-checks",
  AI_BASE_URL: "https://gateway.example.com/v1",
  AI_API_KEY: "sk-live-valid-looking-key",
  DEFAULT_MODEL: "gpt-test",
  NEXT_PUBLIC_API_BASE_URL: "https://api.example.com",
  CORS_ORIGINS: "https://example.com"
};

describe("deployment health check logic", () => {
  it("fails when required environment variables are missing", () => {
    const results = evaluateEnvChecks({});

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "FAIL",
          name: "env:DATABASE_URL"
        }),
        expect.objectContaining({
          status: "FAIL",
          name: "env:JWT_SECRET"
        }),
        expect.objectContaining({
          status: "FAIL",
          name: "env:AI_API_KEY"
        })
      ])
    );
  });

  it("flags placeholder database URLs and secrets", () => {
    const results = evaluateEnvChecks({
      ...validEnv,
      DATABASE_URL: "mysql://user:password@localhost:3306/db",
      JWT_SECRET: "replace-with-a-strong-random-string",
      AI_API_KEY: "replace-with-your-ai-provider-key"
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "FAIL",
          name: "env:DATABASE_URL:value"
        }),
        expect.objectContaining({
          status: "FAIL",
          name: "env:JWT_SECRET:strength"
        }),
        expect.objectContaining({
          status: "FAIL",
          name: "env:AI_API_KEY:value"
        })
      ])
    );
  });

  it("fails production wildcard CORS origins", () => {
    const results = evaluateEnvChecks({
      ...validEnv,
      CORS_ORIGINS: "*"
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "FAIL",
          name: "env:CORS_ORIGINS:production"
        })
      ])
    );
  });

  it("detects secret-like keys in public settings responses", () => {
    expect(
      containsForbiddenPublicSetting({
        settings: {
          siteName: "AI Aggregate",
          AI_API_KEY: "sk-leaked"
        }
      })
    ).toBe(true);

    expect(
      containsForbiddenPublicSetting({
        settings: {
          siteName: "AI Aggregate",
          maintenanceModeEnabled: false
        }
      })
    ).toBe(false);
  });

  it("summarizes results and exits non-zero only when failures exist", () => {
    const results: CheckResult[] = [
      { status: "PASS", name: "pass", message: "ok" },
      { status: "WARN", name: "warn", message: "watch" },
      { status: "FAIL", name: "fail", message: "broken" }
    ];

    expect(createSummary(results)).toEqual({
      passed: 1,
      warnings: 1,
      failed: 1
    });
    expect(getExitCode(results)).toBe(1);
    expect(getExitCode(results.slice(0, 2))).toBe(0);
  });
});
