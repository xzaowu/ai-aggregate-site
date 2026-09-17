import type { AdminModerationRouteSummary, AiProviderAccountSummary } from "@ai-aggregate/shared";
import { describe, expect, it } from "vitest";
import {
  buildModerationCircuitBreakerResetRequestInit,
  buildModerationCircuitBreakerSettingsRequestInit,
  buildModerationRouteTestRequestInit,
  canChangeProviderModerationEnabled,
  circuitBreakerSettingsToForm,
  createModerationRouteTestRegistry,
  defaultModerationRouteForm,
  getModerationCoverage,
  getModerationReferenceInfo,
  getModerationRouteTestPresentation,
  getModerationTestPresentation,
  isManagedProviderModerationConfig,
  isSafeModerationEndpointPath,
  isProviderModerationToggleDisabled,
  mergeProviderModerationConfig,
  normalizeModerationCircuitBreakerStatus,
  normalizeModerationSettingsResponse,
  normalizeModerationTestResponse,
  normalizeModerationTestResponseForRoute,
  parseModerationRouteForm,
  parseCircuitBreakerForm,
  readProviderModerationForm,
  tryAcquireModerationRouteDeleteLock
} from "./admin-moderation";
import {
  mergeProviderAccountConfigJson,
  providerAccountToForm
} from "./admin-provider-accounts-section";

const account: AiProviderAccountSummary = {
  id: "account_1",
  name: "Moderation Primary",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://provider.example/v1",
  capabilities: ["chat"],
  enabled: true,
  priority: 1,
  timeoutMs: 3000,
  configJson: {
    region: "global",
    requestFormat: "openai-compatible",
    moderation: {
      requestFormat: "openai-moderation",
      upstreamModel: "omni-moderation-latest",
      endpointPath: "/v1/moderations",
      supportsText: true,
      supportsImage: true,
      futureFlag: "keep-me"
    }
  },
  notes: null,
  hasApiKey: true,
  hasCustomHeaders: false,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z"
};

const route = (overrides: Partial<AdminModerationRouteSummary> = {}): AdminModerationRouteSummary => ({
  id: "route_1",
  providerAccountId: account.id,
  providerAccountName: account.name,
  providerAccountEnabled: true,
  providerAccountCompatible: true,
  upstreamModel: "omni-moderation-latest",
  endpointPath: "/v1/moderations",
  priority: 1,
  enabled: true,
  timeoutMs: null,
  supportsText: true,
  supportsImage: true,
  ...overrides
});

const form = (overrides: Partial<Parameters<typeof parseModerationRouteForm>[0]> = {}) => ({
  providerAccountId: account.id,
  upstreamModel: "omni-moderation-latest",
  endpointPath: "/v1/moderations",
  priority: "2",
  timeoutMs: "",
  supportsText: true,
  supportsImage: true,
  enabled: true,
  ...overrides
});

describe("moderation admin helpers", () => {
  it("normalizes a valid response without changing canonical route order", () => {
    const normalized = normalizeModerationSettingsResponse({
      settings: {
        version: 1,
        enabled: false,
        routes: [route({ id: "route_b", priority: 2 }), route({ id: "route_a", priority: 1 })]
      }
    });

    expect(normalized.version).toBe(1);
    expect(normalized.enabled).toBe(false);
    expect(normalized.routes.map((item) => item.id)).toEqual(["route_b", "route_a"]);
  });

  it("rejects invalid version and routes instead of fabricating settings", () => {
    expect(() => normalizeModerationSettingsResponse({ version: 2, enabled: true, routes: [] })).toThrow();
    expect(() => normalizeModerationSettingsResponse({ version: 1, enabled: true, routes: {} })).toThrow();
    expect(() => normalizeModerationSettingsResponse({ version: 1, enabled: true, routes: [{ id: "bad" }] })).toThrow();
  });

  it("uses safe defaults for missing provider account summary fields", () => {
    const normalized = normalizeModerationSettingsResponse({
      version: 1,
      enabled: true,
      routes: [route({ providerAccountName: undefined, providerAccountEnabled: undefined, providerAccountCompatible: undefined })]
    });
    expect(normalized.routes[0]).toMatchObject({
      providerAccountName: null,
      providerAccountEnabled: false,
      providerAccountCompatible: false
    });
  });

  it("provides route form defaults from the next maximum priority and available account", () => {
    expect(defaultModerationRouteForm([route({ priority: 7, enabled: false })], [account])).toEqual({
      providerAccountId: account.id,
      upstreamModel: "omni-moderation-latest",
      endpointPath: "/v1/moderations",
      priority: "8",
      timeoutMs: "",
      supportsText: true,
      supportsImage: true,
      enabled: true
    });
  });

  it("converts blank timeout to null and rejects values outside 500..10000", () => {
    expect(parseModerationRouteForm(form(), [])).toMatchObject({ input: { timeoutMs: null } });
    expect(parseModerationRouteForm(form({ timeoutMs: "499" }), []).error).toBe("timeoutInvalid");
    expect(parseModerationRouteForm(form({ timeoutMs: "10001" }), []).error).toBe("timeoutInvalid");
  });

  it("rejects invalid priority, duplicate enabled priority, and empty capabilities", () => {
    expect(parseModerationRouteForm(form({ priority: "0" }), []).error).toBe("priorityInvalid");
    expect(parseModerationRouteForm(form({ priority: "1" }), [route()]).error).toBe("priorityDuplicate");
    expect(parseModerationRouteForm(form({ supportsText: false, supportsImage: false }), []).error).toBe("supportRequired");
  });

  it("matches the strict safe endpoint path boundary", () => {
    expect(isSafeModerationEndpointPath("/v1/moderations")).toBe(true);
    for (const value of [
      "v1/moderations",
      "/v1//moderations",
      "/v1/%6dod",
      "/v1/moderations?x=1",
      "/v1/moderations#hash",
      "/v1\\moderations",
      "/v1/./moderations",
      "/v1/../moderations",
      "/v1/moderations/"
    ]) {
      expect(isSafeModerationEndpointPath(value)).toBe(false);
    }
  });

  it("reads and safely merges nested moderation config while preserving unknown fields", () => {
    const read = readProviderModerationForm(account.configJson);
    expect(read.enabled).toBe(true);
    expect(read.upstreamModel).toBe("omni-moderation-latest");
    const merged = mergeProviderModerationConfig(account.configJson, {
      ...read,
      upstreamModel: "omni-moderation-next",
      supportsImage: false
    });
    expect(merged).toMatchObject({
      region: "global",
      requestFormat: "openai-compatible",
      moderation: {
        requestFormat: "openai-moderation",
        upstreamModel: "omni-moderation-next",
        supportsImage: false,
        futureFlag: "keep-me"
      }
    });
    expect(merged?.requestFormat).not.toBe("openai-moderation");
  });

  it("reads legacy moderation.model when upstreamModel is absent", () => {
    const legacyConfig = {
      moderation: {
        requestFormat: "openai-moderation",
        model: "legacy-custom-model"
      }
    };

    expect(readProviderModerationForm(legacyConfig).upstreamModel).toBe(
      "legacy-custom-model"
    );
    expect(
      providerAccountToForm({ ...account, configJson: legacyConfig })
        .moderationUpstreamModel
    ).toBe("legacy-custom-model");
  });

  it("prefers upstreamModel over the legacy moderation.model field", () => {
    expect(
      readProviderModerationForm({
        moderation: {
          requestFormat: "openai-moderation",
          upstreamModel: "new-model",
          model: "legacy-model"
        }
      }).upstreamModel
    ).toBe("new-model");
  });

  it.each([
    { model: "", label: "empty" },
    { model: 123, label: "non-string" }
  ])("uses the default moderation model for a $label model field", ({ model }) => {
    expect(
      readProviderModerationForm({
        moderation: { requestFormat: "openai-moderation", model }
      }).upstreamModel
    ).toBe("omni-moderation-latest");
  });

  it("canonicalizes a legacy model on save without dropping legacy or unknown fields", () => {
    const legacyConfig = {
      region: "global",
      moderation: {
        requestFormat: "openai-moderation",
        model: "legacy-custom-model",
        futureFlag: "keep-me",
        supportsText: true,
        supportsImage: true
      },
      otherUnknown: { keep: true }
    };
    const formValue = providerAccountToForm({
      ...account,
      configJson: legacyConfig
    });

    const saved = mergeProviderAccountConfigJson(
      { ...formValue, moderationSupportsImage: false },
      legacyConfig
    );

    expect(saved).toMatchObject({
      region: "global",
      otherUnknown: { keep: true },
      moderation: {
        requestFormat: "openai-moderation",
        upstreamModel: "legacy-custom-model",
        model: "legacy-custom-model",
        futureFlag: "keep-me",
        supportsImage: false
      }
    });
    expect(saved?.moderation).not.toMatchObject({
      upstreamModel: "omni-moderation-latest"
    });
  });

  it("removes only moderation when the declaration is disabled", () => {
    const merged = mergeProviderModerationConfig(account.configJson, {
      ...readProviderModerationForm(account.configJson),
      enabled: false
    });
    expect(merged).toEqual({ region: "global", requestFormat: "openai-compatible" });
  });

  it("recognizes only the current openai moderation declaration as managed", () => {
    expect(
      isManagedProviderModerationConfig({
        moderation: { requestFormat: "openai-moderation" }
      })
    ).toBe(true);
    expect(
      isManagedProviderModerationConfig({
        moderation: { requestFormat: "future-moderation-v2" }
      })
    ).toBe(false);
    expect(isManagedProviderModerationConfig({ moderation: "legacy-value" })).toBe(false);
    expect(isManagedProviderModerationConfig(null)).toBe(false);
  });

  it("preserves an unknown future moderation object when the form is disabled", () => {
    const config = {
      region: "global",
      moderation: {
        requestFormat: "future-moderation-v2",
        futureFlag: true
      }
    };

    const merged = mergeProviderModerationConfig(config, {
      ...readProviderModerationForm(config),
      enabled: false
    });

    expect(merged).toEqual(config);
  });

  it("preserves an object moderation config with no request format when disabled", () => {
    const config = {
      region: "global",
      moderation: { futureFlag: true }
    };

    const merged = mergeProviderModerationConfig(config, {
      ...readProviderModerationForm(config),
      enabled: false
    });

    expect(merged).toEqual(config);
  });

  it.each([
    "legacy-value",
    ["future", { enabled: true }]
  ])("preserves non-object moderation config %j when disabled", (moderation) => {
    const config = { region: "global", moderation };

    const merged = mergeProviderModerationConfig(config, {
      ...readProviderModerationForm(config),
      enabled: false
    });

    expect(merged).toEqual(config);
  });

  it("keeps moderation absent when no declaration exists and the form is disabled", () => {
    const config = { region: "global" };

    const merged = mergeProviderModerationConfig(config, {
      ...readProviderModerationForm(config),
      enabled: false
    });

    expect(merged).toEqual(config);
  });

  it("converts an unknown moderation declaration to canonical form when enabled", () => {
    const config = {
      region: "global",
      moderation: {
        requestFormat: "future-moderation-v2",
        futureFlag: true
      }
    };

    const merged = mergeProviderModerationConfig(config, {
      ...readProviderModerationForm(config),
      enabled: true,
      upstreamModel: "future-compatible-model",
      endpointPath: "/v1/moderations",
      supportsText: false,
      supportsImage: true
    });

    expect(merged).toEqual({
      region: "global",
      moderation: {
        requestFormat: "openai-moderation",
        upstreamModel: "future-compatible-model",
        endpointPath: "/v1/moderations",
        supportsText: false,
        supportsImage: true,
        futureFlag: true
      }
    });
  });

  it("keeps write-only credentials blank while preserving all configJson fields", () => {
    const formValue = providerAccountToForm({
      ...account,
      hasCustomHeaders: true,
      configJson: {
        region: "global",
        requestFormat: "openai-compatible",
        ordinaryUnknown: { keep: true },
        moderation: {
          requestFormat: "openai-moderation",
          upstreamModel: "omni-moderation-latest",
          endpointPath: "/v1/moderations",
          supportsText: true,
          supportsImage: true,
          futureFlag: "keep-me"
        }
      }
    });
    expect(formValue.apiKey).toBe("");
    expect(formValue.configJson).toContain("ordinaryUnknown");
    expect(formValue.configJson).toContain("futureFlag");
    expect(formValue.headersJson).toBe("");

    const edited = mergeProviderModerationConfig(
      JSON.parse(formValue.configJson) as Record<string, unknown>,
      {
        ...readProviderModerationForm(JSON.parse(formValue.configJson)),
        upstreamModel: "omni-moderation-next"
      }
    );
    expect(edited).toMatchObject({
      region: "global",
      requestFormat: "openai-compatible",
      ordinaryUnknown: { keep: true },
      moderation: { futureFlag: "keep-me", upstreamModel: "omni-moderation-next" }
    });
  });

  it("allows an undeclared referenced account to be enabled but blocks disabling a declared one", () => {
    const referenced = { known: true as const, count: 2 };
    const empty = { known: true as const, count: 0 };
    const unknown = { known: false as const, count: null };
    expect(isProviderModerationToggleDisabled(false, referenced)).toBe(false);
    expect(isProviderModerationToggleDisabled(true, referenced)).toBe(true);
    expect(isProviderModerationToggleDisabled(true, unknown)).toBe(true);
    expect(canChangeProviderModerationEnabled(false, true, referenced)).toBe(true);
    expect(canChangeProviderModerationEnabled(true, false, referenced)).toBe(false);
    expect(canChangeProviderModerationEnabled(true, false, empty)).toBe(true);
    expect(canChangeProviderModerationEnabled(true, false, unknown)).toBe(false);
    expect(canChangeProviderModerationEnabled(false, true, unknown)).toBe(true);
  });

  it("keeps moderation route references unknown until settings are available", () => {
    expect(getModerationReferenceInfo(null, account.id)).toEqual({
      known: false,
      count: null
    });
    expect(
      getModerationReferenceInfo(
        { version: 1, enabled: false, routes: [] },
        account.id
      )
    ).toEqual({ known: true, count: 0 });
    expect(
      getModerationReferenceInfo(
        { version: 1, enabled: false, routes: [route()] },
        account.id
      )
    ).toEqual({ known: true, count: 1 });
  });

  it("allows only one synchronous route delete and releases the lock for retry", () => {
    const activeRouteIds = new Set<string>();
    expect(tryAcquireModerationRouteDeleteLock(activeRouteIds, "route_a")).toBe(true);
    expect(tryAcquireModerationRouteDeleteLock(activeRouteIds, "route_a")).toBe(false);
    activeRouteIds.delete("route_a");
    expect(tryAcquireModerationRouteDeleteLock(activeRouteIds, "route_a")).toBe(true);
  });

  it("computes effective text and image coverage from route and account state", () => {
    expect(getModerationCoverage([route()])).toEqual({ text: true, image: true });
    expect(getModerationCoverage([route({ providerAccountCompatible: false })])).toEqual({ text: false, image: false });
    expect(getModerationCoverage([route({ supportsImage: false })])).toEqual({ text: true, image: false });
  });

  it("distinguishes allowed, blocked, unsupported, and error test semantics", () => {
    const allowed = { supported: true, ok: true, decision: "allowed" as const, latencyMs: 12, errorType: null };
    const blocked = { supported: true, ok: true, decision: "blocked" as const, latencyMs: 12, errorType: null };
    const unsupported = { supported: false, ok: false, decision: null, latencyMs: null, errorType: null };
    const error = { supported: true, ok: false, decision: null, latencyMs: 12, errorType: "timeout" as const };
    expect(getModerationTestPresentation(allowed)).toBe("allowed");
    expect(getModerationTestPresentation(blocked)).toBe("blocked");
    expect(getModerationTestPresentation(unsupported)).toBe("unsupported");
    expect(getModerationTestPresentation(error)).toBe("error");
    expect(getModerationRouteTestPresentation({ routeId: "route_1", compatible: true, text: blocked, image: allowed })).toBe("blocked");
  });

  it("keeps concurrent route tests independent and invalidates stale completions", () => {
    const registry = createModerationRouteTestRegistry();
    const versionA = registry.begin("route_a");
    const versionB = registry.begin("route_b");

    expect(versionA).toBe(1);
    expect(versionB).toBe(1);
    expect(registry.activeRouteIds).toEqual(new Set(["route_a", "route_b"]));
    expect(registry.begin("route_a")).toBeNull();
    expect(registry.finish("route_a", versionA!)).toBe(true);
    expect(registry.activeRouteIds).toEqual(new Set(["route_b"]));

    const editedVersion = registry.begin("route_a");
    expect(editedVersion).toBe(2);
    const invalidated = registry.invalidate(["route_a"]);
    expect(invalidated).toEqual(["route_a"]);
    expect(registry.isCurrent("route_a", editedVersion!)).toBe(false);
    expect(registry.finish("route_a", editedVersion!)).toBe(false);
    expect(registry.activeRouteIds).toEqual(new Set(["route_b"]));

    const allInvalidated = registry.invalidate();
    expect(allInvalidated).toEqual(["route_a", "route_b"]);
    expect(registry.isCurrent("route_b", versionB!)).toBe(false);
    expect(registry.activeRouteIds).toEqual(new Set());
  });

  it("normalizes test results without accepting raw or malformed response data", () => {
    const response = normalizeModerationTestResponse({
      routeId: "route_1",
      compatible: true,
      text: { supported: true, ok: true, decision: "allowed", latencyMs: 2, errorType: null },
      image: { supported: false, ok: false, decision: null, latencyMs: null, errorType: null }
    });
    expect(response.text.decision).toBe("allowed");
    expect(() => normalizeModerationTestResponse({ routeId: "route_1", compatible: true, text: {}, image: {} })).toThrow();
    expect(() => normalizeModerationTestResponse({ routeId: "", compatible: true, text: response.text, image: response.image })).toThrow();
    expect(() => normalizeModerationTestResponseForRoute({ routeId: "route_b", compatible: true, text: response.text, image: response.image }, "route_a")).toThrow("MODERATION_TEST_ROUTE_MISMATCH");
    expect(normalizeModerationTestResponseForRoute({ ...response, routeId: "route_a" }, "route_a").routeId).toBe("route_a");
  });

  it("builds a moderation test request with auth only and no body", () => {
    const requestInit = buildModerationRouteTestRequestInit("admin-token");
    expect(requestInit).toEqual({
      method: "POST",
      headers: { Authorization: "Bearer admin-token" }
    });
    expect(requestInit).not.toHaveProperty("body");
    expect(requestInit.headers).not.toHaveProperty("Content-Type");
  });

  it("normalizes the default circuit-breaker status", () => {
    expect(
      normalizeModerationCircuitBreakerStatus({
        settings: {
          version: 1,
          enabled: false,
          failureThreshold: 3,
          cooldownMs: 60000
        },
        epoch: 0,
        routes: []
      })
    ).toEqual({
      settings: {
        version: 1,
        enabled: false,
        failureThreshold: 3,
        cooldownMs: 60000
      },
      epoch: 0,
      routes: []
    });
  });

  it("normalizes closed, open, and half-open runtime entries", () => {
    const entry = (state: "closed" | "open" | "half_open") => ({
      routeId: `route_${state}`,
      inputType: "text" as const,
      state,
      consecutiveFailures: state === "closed" ? 0 : 3,
      openedAt: state === "closed" ? null : 1000,
      retryAt: state === "closed" ? null : 61000,
      lastFailureAt: state === "closed" ? null : 1000,
      lastFailureType: state === "closed" ? null : ("timeout" as const),
      lastSuccessAt: state === "closed" ? 2000 : null,
      opens: state === "closed" ? 0 : 1,
      recoveries: state === "half_open" ? 1 : 0,
      skips: state === "open" ? 2 : 0
    });
    const status = normalizeModerationCircuitBreakerStatus({
      settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 60000 },
      epoch: 4,
      routes: [entry("closed"), entry("open"), entry("half_open")]
    });
    expect(status.routes.map((item) => item.state)).toEqual([
      "closed",
      "open",
      "half_open"
    ]);
  });

  it.each([
    ["state", { state: "unknown" }],
    ["input type", { inputType: "audio" }]
  ])("rejects invalid circuit-breaker %s", (_label, override) => {
    expect(() =>
      normalizeModerationCircuitBreakerStatus({
        settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 60000 },
        epoch: 0,
        routes: [
          {
            routeId: "route_1",
            inputType: "text",
            state: "closed",
            consecutiveFailures: 0,
            openedAt: null,
            retryAt: null,
            lastFailureAt: null,
            lastFailureType: null,
            lastSuccessAt: null,
            opens: 0,
            recoveries: 0,
            skips: 0,
            ...override
          }
        ]
      })
    ).toThrow();
  });

  it("rejects invalid circuit-breaker settings", () => {
    expect(() =>
      normalizeModerationCircuitBreakerStatus({
        settings: { version: 1, enabled: true, failureThreshold: 21, cooldownMs: 60000 },
        epoch: 0,
        routes: []
      })
    ).toThrow();
    expect(() =>
      normalizeModerationCircuitBreakerStatus({
        settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 600001 },
        epoch: 0,
        routes: []
      })
    ).toThrow();
  });

  it("rejects negative or non-integer runtime counters", () => {
    const base = {
      routeId: "route_1",
      inputType: "text",
      state: "closed",
      consecutiveFailures: 0,
      openedAt: null,
      retryAt: null,
      lastFailureAt: null,
      lastFailureType: null,
      lastSuccessAt: null,
      opens: 0,
      recoveries: 0,
      skips: 0
    };
    expect(() =>
      normalizeModerationCircuitBreakerStatus({
        settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 60000 },
        epoch: 0,
        routes: [{ ...base, consecutiveFailures: -1 }]
      })
    ).toThrow();
    expect(() =>
      normalizeModerationCircuitBreakerStatus({
        settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 60000 },
        epoch: 0,
        routes: [{ ...base, opens: 1.5 }]
      })
    ).toThrow();
  });

  it("rejects invalid timestamps", () => {
    const base = {
      routeId: "route_1",
      inputType: "text",
      state: "closed",
      consecutiveFailures: 0,
      openedAt: null,
      retryAt: null,
      lastFailureAt: null,
      lastFailureType: null,
      lastSuccessAt: null,
      opens: 0,
      recoveries: 0,
      skips: 0
    };
    expect(() =>
      normalizeModerationCircuitBreakerStatus({
        settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 60000 },
        epoch: 0,
        routes: [{ ...base, openedAt: -1 }]
      })
    ).toThrow();
    expect(() =>
      normalizeModerationCircuitBreakerStatus({
        settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 60000 },
        epoch: 0,
        routes: [{ ...base, retryAt: Infinity }]
      })
    ).toThrow();
    expect(() =>
      normalizeModerationCircuitBreakerStatus({
        settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 60000 },
        epoch: 0,
        routes: [{ ...base, openedAt: 8_640_000_000_000_001 }]
      })
    ).toThrow();

    const maxTimestampStatus = normalizeModerationCircuitBreakerStatus({
      settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 60000 },
      epoch: 0,
      routes: [{ ...base, openedAt: 8_640_000_000_000_000 }]
    });
    expect(maxTimestampStatus.routes[0]?.openedAt).toBe(8_640_000_000_000_000);
  });

  it("parses a valid circuit-breaker form into exact settings", () => {
    const parsed = parseCircuitBreakerForm({
      enabled: true,
      failureThreshold: "3",
      cooldownMs: "1500"
    });
    expect(parsed).toEqual({
      settings: { version: 1, enabled: true, failureThreshold: 3, cooldownMs: 1500 },
      error: null
    });
    expect(circuitBreakerSettingsToForm(parsed.settings!)).toEqual({
      enabled: true,
      failureThreshold: "3",
      cooldownMs: "1500"
    });
  });

  it.each(["0", "21", "1.5"]) (
    "rejects invalid threshold %s",
    (failureThreshold) => {
      expect(
        parseCircuitBreakerForm({ enabled: true, failureThreshold, cooldownMs: "1000" })
          .error
      ).toBe("invalidThreshold");
    }
  );

  it.each(["999", "600001", "1500.5"]) (
    "rejects invalid cooldown %s",
    (cooldownMs) => {
      expect(
        parseCircuitBreakerForm({ enabled: true, failureThreshold: "3", cooldownMs }).error
      ).toBe("invalidCooldown");
    }
  );

  it("builds an exact settings request body", () => {
    const requestInit = buildModerationCircuitBreakerSettingsRequestInit("admin-token", {
      version: 1,
      enabled: true,
      failureThreshold: 4,
      cooldownMs: 1500
    });
    expect(requestInit.method).toBe("PUT");
    expect(requestInit.headers).toEqual({
      Authorization: "Bearer admin-token",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(requestInit.body))).toEqual({
      version: 1,
      enabled: true,
      failureThreshold: 4,
      cooldownMs: 1500
    });
  });

  it("builds the reset request with auth and no body", () => {
    const requestInit = buildModerationCircuitBreakerResetRequestInit("admin-token");
    expect(requestInit).toEqual({
      method: "POST",
      headers: { Authorization: "Bearer admin-token" }
    });
    expect(requestInit).not.toHaveProperty("body");
    expect(requestInit.headers).not.toHaveProperty("Content-Type");
  });
});
