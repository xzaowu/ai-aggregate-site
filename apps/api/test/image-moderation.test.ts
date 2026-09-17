import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModerationRoute, ModerationSettings } from "@ai-aggregate/shared";
import {
  createImageModerationClient,
  createRoutedImageModerationClient,
  ImageModerationRequestError,
  ImageModerationResponseError,
  ImageModerationTimeoutError,
  ImageModerationUnavailableError,
  buildModerationPolicyFingerprint,
  normalizeModerationSettings,
  normalizeModerationEndpointPath,
  parseModerationDecision,
  resolveImageModerationConfig,
  resolveModerationAttemptTimeoutMs,
  resolveModerationProviderAttempts,
  isModerationProviderAccountCompatible,
  type ImageModerationLogEntry,
  type ModerationProviderAccount,
} from "../src/image-moderation";
import { ModerationRouteCircuitBreaker } from "../src/moderation-route-circuit-breaker";

const VALID_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function responseFor(
  categories: Record<string, boolean>,
  status = 200,
  flagged = Object.values(categories).some(Boolean)
): Response {
  return new Response(
    JSON.stringify({
      results: [{ flagged, categories }]
    }),
    { status }
  );
}

function createClient(fetchImpl: typeof fetch) {
  return createImageModerationClient({
    apiKey: "moderation-test-key",
    baseUrl: "https://moderation.example/v1",
    timeoutMs: 500,
    fetchImpl
  });
}

function createEnabledCircuitBreaker(options: {
  now?: () => number;
  failureThreshold?: number;
  cooldownMs?: number;
} = {}) {
  return new ModerationRouteCircuitBreaker({
    now: options.now,
    settings: {
      version: 1,
      enabled: true,
      failureThreshold: options.failureThreshold ?? 1,
      cooldownMs: options.cooldownMs ?? 1_000
    }
  });
}

function circuitStatus(
  breaker: ModerationRouteCircuitBreaker,
  routeId: string,
  inputType: "text" | "image"
) {
  const status = breaker
    .status()
    .routes.find((route) => route.routeId === routeId && route.inputType === inputType);
  if (!status) {
    throw new Error("expected circuit status");
  }
  return status;
}

function openCircuit(
  breaker: ModerationRouteCircuitBreaker,
  routeId: string,
  inputType: "text" | "image" = "text"
) {
  const lease = breaker.acquire(routeId, inputType);
  if (!lease) {
    throw new Error("expected circuit lease");
  }
  breaker.recordFailure(lease, "request_error");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveImageModerationConfig", () => {
  it("defaults to off with safe API defaults", () => {
    expect(resolveImageModerationConfig({})).toEqual({
      mode: "off",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "omni-moderation-latest",
      timeoutMs: 3000,
      legacyConfigValid: false
    });
  });

  it("marks incomplete legacy enforce config unavailable and bounds valid timeout", () => {
    expect(
      resolveImageModerationConfig({ IMAGE_MODERATION_MODE: "enforce" })
        .legacyConfigValid
    ).toBe(false);
    expect(
      resolveImageModerationConfig({
        IMAGE_MODERATION_MODE: "enforce",
        IMAGE_MODERATION_API_KEY: "key",
        IMAGE_MODERATION_TIMEOUT_MS: "499"
      }).legacyConfigValid
    ).toBe(false);
    expect(
      resolveImageModerationConfig({
        IMAGE_MODERATION_MODE: "enforce",
        IMAGE_MODERATION_API_KEY: "key",
        IMAGE_MODERATION_TIMEOUT_MS: "10000"
      }).timeoutMs
    ).toBe(10000);
  });
});

describe("moderation settings and routed attempts", () => {
  const account = (overrides: Partial<ModerationProviderAccount> = {}) => ({
    id: "account-1",
    name: "Moderation account",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://moderation.example",
    apiKey: "secret-key",
    enabled: true,
    timeoutMs: 3000,
    configJson: {
      moderation: {
        requestFormat: "openai-moderation",
        endpointPath: "/v1/moderations",
        supportsText: true,
        supportsImage: true
      }
    },
    ...overrides
  });

  const settings = (routes: ModerationRoute[] = [
    {
      id: "route-1",
      providerAccountId: "account-1",
      upstreamModel: "omni-moderation-latest",
      endpointPath: "/v1/moderations",
      priority: 1,
      enabled: true,
      timeoutMs: null,
      supportsText: true,
      supportsImage: true
    }
  ]) => normalizeModerationSettings({ version: 1, enabled: true, routes });

  const twoRouteSettings = () =>
    settings([
      { ...settings().routes[0]!, upstreamModel: "primary-model" },
      {
        ...settings().routes[0]!,
        id: "route-2",
        providerAccountId: "account-2",
        upstreamModel: "backup-model",
        priority: 2
      }
    ]);

  const resolveRoutes = (routeSettings: ModerationSettings) =>
    (inputType: "text" | "image") =>
      resolveModerationProviderAttempts({
        settings: routeSettings,
        providerAccounts: [account(), account({ id: "account-2" })],
        inputType
      });

  it("normalizes routes deterministically and rejects unsafe settings", () => {
    expect(
      settings([
        { ...settings().routes[0]!, id: "b", priority: 2 },
        { ...settings().routes[0]!, id: "a", priority: 1 }
      ]).routes.map((route) => route.id)
    ).toEqual(["a", "b"]);
    expect(() =>
      normalizeModerationSettings({
        version: 1,
        enabled: true,
        routes: [{ ...settings().routes[0]!, endpointPath: "/v1/../moderations" }]
      })
    ).toThrow("MODERATION_ENDPOINT_PATH_INVALID");
    expect(() =>
      normalizeModerationSettings({
        version: 1,
        enabled: true,
        routes: [
          settings().routes[0]!,
          { ...settings().routes[0]!, id: "route-2" }
        ]
      })
    ).toThrow("MODERATION_PRIORITY_DUPLICATE");
  });

  it.each(["/v1/moderations", "/moderations", "/api/v1/moderations"])(
    "accepts the safe endpoint path %s without changing its fetch pathname",
    (path) => {
      const normalized = normalizeModerationEndpointPath(path);
      expect(normalized).toBe(path);
      expect(new URL(`https://moderation.example${normalized}`).pathname).toBe(
        normalized
      );
    }
  );

  it.each([
    "/v1/../admin",
    "/v1/%2e%2e/admin",
    "/v1/%2E%2E/admin",
    "/v1/.%2e/admin",
    "/v1/%2e./admin",
    "/v1/%2fadmin",
    "/v1/%2Fadmin",
    "/v1/%5cadmin",
    "/v1/%5Cadmin",
    "/v1/%ZZ/admin",
    "/v1/moderations?mode=admin",
    "/v1/moderations#admin",
    "//host/path"
  ])("rejects unsafe endpoint path %s", (path) => {
    expect(() => normalizeModerationEndpointPath(path)).toThrow(
      "MODERATION_ENDPOINT_PATH_INVALID"
    );
  });

  it("does not resolve an attempt for an unsafe encoded endpoint path", () => {
    const unsafeSettings = {
      ...settings(),
      routes: [
        {
          ...settings().routes[0]!,
          endpointPath: "/v1/%2e%2e/admin"
        }
      ]
    } as ModerationSettings;

    expect(
      resolveModerationProviderAttempts({
        settings: unsafeSettings,
        providerAccounts: [account()],
        inputType: "text"
      })
    ).toEqual([]);
  });

  it("filters disabled and incompatible accounts and applies route overrides", () => {
    const attempts = resolveModerationProviderAttempts({
      settings: settings(),
      providerAccounts: [account({ timeoutMs: 6000 })],
      inputType: "text"
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      model: "omni-moderation-latest",
      endpointPath: "/v1/moderations",
      timeoutMs: 6000
    });
    expect(
      resolveModerationProviderAttempts({
        settings: settings(),
        providerAccounts: [account({ enabled: false })],
        inputType: "text"
      })
    ).toHaveLength(0);
    expect(
      resolveModerationProviderAttempts({
        settings: settings(),
        providerAccounts: [
          account({ configJson: { moderation: { requestFormat: "anthropic" } } })
        ],
        inputType: "text"
      })
    ).toHaveLength(0);
  });

  it.each([
    ["https://moderation.example", "/v1/moderations", "https://moderation.example/v1/moderations"],
    ["https://moderation.example/v1", "/v1/moderations", "https://moderation.example/v1/moderations"],
    ["https://moderation.example/custom/v1", "/v1/moderations", "https://moderation.example/custom/v1/moderations"],
    ["https://moderation.example/custom/v1", "/moderations", "https://moderation.example/custom/v1/moderations"],
    ["https://moderation.example/custom", "/v1/moderations", "https://moderation.example/custom/v1/moderations"],
    ["https://moderation.example/v1/moderations", "/v1/moderations", "https://moderation.example/v1/moderations"],
    ["https://moderation.example/custom/v1/moderations", "/v1/moderations", "https://moderation.example/custom/v1/moderations"],
    ["https://moderation.example/moderations", "/moderations", "https://moderation.example/moderations"]
  ])("normalizes the moderation-only base/endpoint overlap", (baseUrl, endpointPath, expected) => {
    const attempts = resolveModerationProviderAttempts({
      settings: settings([{ ...settings().routes[0]!, endpointPath }]),
      providerAccounts: [account({ baseUrl })],
      inputType: "text"
    });
    expect(attempts[0]?.endpointUrl).toBe(expected);
  });

  it("changes the text policy fingerprint when policy or transport-dependent route fields change", () => {
    const attempts = resolveModerationProviderAttempts({
      settings: settings(),
      providerAccounts: [account()],
      inputType: "text"
    });
    const base = buildModerationPolicyFingerprint({
      policyVersion: "v1",
      attempts
    });
    expect(
      buildModerationPolicyFingerprint({ policyVersion: "v2", attempts })
    ).not.toBe(base);
    expect(
      buildModerationPolicyFingerprint({
        policyVersion: "v1",
        attempts: resolveModerationProviderAttempts({
          settings: settings([
            { ...settings().routes[0]!, upstreamModel: "changed-model" }
          ]),
          providerAccounts: [account()],
          inputType: "text"
        })
      })
    ).not.toBe(base);
  });

  it("fingerprints the effective endpoint path even when the origin is shared", () => {
    const base = buildModerationPolicyFingerprint({
      policyVersion: "v1",
      attempts: resolveModerationProviderAttempts({
        settings: settings(),
        providerAccounts: [account({ baseUrl: "https://moderation.example/v1" })],
        inputType: "text"
      })
    });
    const custom = buildModerationPolicyFingerprint({
      policyVersion: "v1",
      attempts: resolveModerationProviderAttempts({
        settings: settings(),
        providerAccounts: [
          account({ baseUrl: "https://moderation.example/custom/v1" })
        ],
        inputType: "text"
      })
    });

    expect(custom).not.toBe(base);
  });

  it("fingerprints effective safe custom headers without fingerprinting filtered headers", () => {
    const fingerprint = (headersJson: Record<string, unknown>) =>
      buildModerationPolicyFingerprint({
        policyVersion: "v1",
        attempts: resolveModerationProviderAttempts({
          settings: settings(),
          providerAccounts: [account({ headersJson })],
          inputType: "text"
        })
      });

    expect(
      fingerprint({ " X-Tenant ": " tenant-a " })
    ).toBe(
      fingerprint({ "x-tenant": "tenant-a" })
    );
    expect(
      fingerprint({ " X-Tenant ": " tenant-a " })
    ).not.toBe(
      fingerprint({ "x-tenant": "tenant-b" })
    );
    expect(fingerprint({ Authorization: "A" })).toBe(
      fingerprint({ Authorization: "B" })
    );
  });

  it("does not fingerprint provider API keys or headers", () => {
    const base = buildModerationPolicyFingerprint({
      policyVersion: "v1",
      attempts: resolveModerationProviderAttempts({
        settings: settings(),
        providerAccounts: [account()],
        inputType: "text"
      })
    });
    const changedCredentials = buildModerationPolicyFingerprint({
      policyVersion: "v1",
      attempts: resolveModerationProviderAttempts({
        settings: settings(),
        providerAccounts: [
          account({
            apiKey: "new-secret-key",
            headersJson: { Authorization: "Bearer new-secret-key" }
          })
        ],
        inputType: "text"
      })
    });
    expect(changedCredentials).toBe(base);
  });

  it("binds legacy fallback fingerprints to model, endpoint origin, and timeout", () => {
    const base = buildModerationPolicyFingerprint({
      policyVersion: "v1",
      legacy: {
        model: "omni-moderation-latest",
        endpointPath: "/moderations",
        baseUrl: "https://moderation.example/v1",
        timeoutMs: 3000
      }
    });
    expect(
      buildModerationPolicyFingerprint({
        policyVersion: "v1",
        legacy: {
          model: "changed-model",
          endpointPath: "/moderations",
          baseUrl: "https://moderation.example/v1",
          timeoutMs: 3000
        }
      })
    ).not.toBe(base);
    expect(
      buildModerationPolicyFingerprint({
        policyVersion: "v1",
        legacy: {
          model: "omni-moderation-latest",
          endpointPath: "/moderations",
          baseUrl: "https://other.example/v1",
          timeoutMs: 3000
        }
      })
    ).not.toBe(base);
  });

  it.each([
    [60000, null, 3000],
    [5000, null, 5000],
    [60000, 4000, 4000]
  ])(
    "resolves account timeout %s and route timeout %s to %s",
    (providerAccountTimeoutMs, routeTimeoutMs, expectedTimeoutMs) => {
      const attempts = resolveModerationProviderAttempts({
        settings: settings([
          {
            ...settings().routes[0]!,
            timeoutMs: routeTimeoutMs
          }
        ]),
        providerAccounts: [account({ timeoutMs: providerAccountTimeoutMs })],
        inputType: "text"
      });

      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.timeoutMs).toBe(expectedTimeoutMs);
    }
  );

  it("keeps an account with a non-moderation timeout compatible", () => {
    expect(isModerationProviderAccountCompatible(account({ timeoutMs: 60000 }))).toBe(
      true
    );
    expect(
      resolveModerationAttemptTimeoutMs({
        routeTimeoutMs: null,
        providerAccountTimeoutMs: 60000
      })
    ).toBe(3000);
  });

  it.each([
    401,
    403,
    429,
    500
  ])("fails over status %s and stops on allowed", async (status) => {
    const first = account();
    const second = account({ id: "account-2" });
    const routeSettings = settings([
      settings().routes[0]!,
      { ...settings().routes[0]!, id: "route-2", providerAccountId: "account-2", priority: 2 }
    ]);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream failure", { status }))
      .mockResolvedValueOnce(responseFor({ sexual: false, "sexual/minors": false }));
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: (inputType) =>
        resolveModerationProviderAttempts({
          settings: routeSettings,
          providerAccounts: [first, second],
          inputType
        })
    });

    await expect(client.moderateText("safe prompt")).resolves.toEqual({
      status: "allowed"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never fails over a valid blocked decision", async () => {
    const routeSettings = settings([
      settings().routes[0]!,
      { ...settings().routes[0]!, id: "route-2", providerAccountId: "account-2", priority: 2 }
    ]);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responseFor({ sexual: true, "sexual/minors": false }))
      .mockResolvedValueOnce(responseFor({ sexual: false, "sexual/minors": false }));
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: (inputType) =>
        resolveModerationProviderAttempts({
          settings: routeSettings,
          providerAccounts: [account(), account({ id: "account-2" })],
          inputType
        })
    });

    await expect(client.moderateText("unsafe prompt")).resolves.toEqual({
      status: "blocked",
      categories: ["sexual"]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails over invalid JSON and throws unavailable after every route fails", async () => {
    const routeSettings = settings([
      settings().routes[0]!,
      { ...settings().routes[0]!, id: "route-2", providerAccountId: "account-2", priority: 2 }
    ]);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(new Response("still not json", { status: 200 }));
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: (inputType) =>
        resolveModerationProviderAttempts({
          settings: routeSettings,
          providerAccounts: [account(), account({ id: "account-2" })],
          inputType
        })
    });

    await expect(client.moderateText("safe prompt")).rejects.toThrow(
      "image moderation is unavailable"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps routed failover unchanged without a circuit breaker", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream failure", { status: 500 }))
      .mockResolvedValueOnce(responseFor({ sexual: false, "sexual/minors": false }));
    const logs: ImageModerationLogEntry[] = [];
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(twoRouteSettings()),
      log: (entry) => logs.push(entry)
    });

    await expect(client.moderateText("safe prompt")).resolves.toEqual({
      status: "allowed"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      fetchImpl.mock.calls.map((call) =>
        (JSON.parse(String(call[1]?.body)) as { model: string }).model
      )
    ).toEqual(["primary-model", "backup-model"]);
    expect(logs).toMatchObject([
      { routeId: "route-1", attemptIndex: 1, attemptCount: 2, outcome: "unavailable" },
      { routeId: "route-2", attemptIndex: 2, attemptCount: 2, outcome: "allowed" }
    ]);
  });

  it("skips an open primary route and succeeds on the next route", async () => {
    const breaker = createEnabledCircuitBreaker();
    openCircuit(breaker, "route-1");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responseFor({ sexual: false, "sexual/minors": false }));
    const logs: ImageModerationLogEntry[] = [];
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(twoRouteSettings()),
      circuitBreaker: breaker,
      log: (entry) => logs.push(entry)
    });

    await expect(client.moderateText("safe prompt")).resolves.toEqual({
      status: "allowed"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logs).toMatchObject([
      { routeId: "route-2", attemptIndex: 2, attemptCount: 2, failoverCount: 1 }
    ]);
    expect(circuitStatus(breaker, "route-1", "text").state).toBe("open");
  });

  it("records a provider failure, opens the route, and skips it on the next request", async () => {
    const breaker = createEnabledCircuitBreaker({ failureThreshold: 1 });
    const routeSettings = twoRouteSettings();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream failure", { status: 500 }))
      .mockImplementation(async () =>
        responseFor({ sexual: false, "sexual/minors": false })
      );
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(routeSettings),
      circuitBreaker: breaker
    });

    await expect(client.moderateText("first request")).resolves.toEqual({
      status: "allowed"
    });
    expect(circuitStatus(breaker, "route-1", "text")).toMatchObject({
      state: "open",
      lastFailureType: "request_error"
    });

    await expect(client.moderateText("second request")).resolves.toEqual({
      status: "allowed"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.map((call) =>
        (JSON.parse(String(call[1]?.body)) as { model: string }).model
      )
    ).toEqual(["primary-model", "backup-model", "backup-model"]);
    expect(circuitStatus(breaker, "route-1", "text")).toMatchObject({
      state: "open",
      skips: 1
    });
  });

  it("records an allowed decision as route success", async () => {
    const breaker = createEnabledCircuitBreaker({ failureThreshold: 1 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        responseFor({ sexual: false, "sexual/minors": false })
      );
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(settings()),
      circuitBreaker: breaker
    });

    await expect(client.moderateText("safe prompt")).resolves.toEqual({
      status: "allowed"
    });
    await expect(client.moderateText("safe prompt again")).resolves.toEqual({
      status: "allowed"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(circuitStatus(breaker, "route-1", "text")).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
      lastFailureType: null
    });
    expect(circuitStatus(breaker, "route-1", "text").lastSuccessAt).not.toBeNull();
  });

  it("records a blocked decision as route success without opening the circuit", async () => {
    const breaker = createEnabledCircuitBreaker({ failureThreshold: 1 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responseFor({ sexual: true, "sexual/minors": false }))
      .mockResolvedValueOnce(responseFor({ sexual: false, "sexual/minors": false }));
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(settings()),
      circuitBreaker: breaker
    });

    await expect(client.moderateText("unsafe prompt")).resolves.toEqual({
      status: "blocked",
      categories: ["sexual"]
    });
    await expect(client.moderateText("safe prompt")).resolves.toEqual({
      status: "allowed"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(circuitStatus(breaker, "route-1", "text")).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
      lastFailureType: null
    });
  });

  it.each([
    {
      outcome: "allowed" as const,
      categories: { sexual: false, "sexual/minors": false }
    },
    {
      outcome: "blocked" as const,
      categories: { sexual: true, "sexual/minors": false }
    }
  ])(
    "does not record a breaker failure when the $outcome success log throws",
    async ({ outcome, categories }) => {
      const breaker = createEnabledCircuitBreaker({ failureThreshold: 1 });
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(responseFor(categories));
      const log = vi.fn((entry: ImageModerationLogEntry) => {
        if (entry.outcome === outcome) {
          throw new Error("success log failed");
        }
      });
      const client = createRoutedImageModerationClient({
        fetchImpl,
        resolveAttempts: resolveRoutes(twoRouteSettings()),
        circuitBreaker: breaker,
        log
      });

      if (outcome === "allowed") {
        await expect(client.moderateText("allowed prompt")).resolves.toEqual({
          status: "allowed"
        });
      } else {
        await expect(client.moderateText("blocked prompt")).resolves.toEqual({
          status: "blocked",
          categories: ["sexual"]
        });
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(
        fetchImpl.mock.calls.map((call) =>
          (JSON.parse(String(call[1]?.body)) as { model: string }).model
        )
      ).toEqual(["primary-model"]);
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome }));
      const status = circuitStatus(breaker, "route-1", "text");
      expect(status).toMatchObject({
        state: "closed",
        consecutiveFailures: 0,
        lastFailureType: null,
        opens: 0
      });
      expect(status.lastSuccessAt).not.toBeNull();
    }
  );

  it("keeps failover active when a provider failure log throws", async () => {
    const breaker = createEnabledCircuitBreaker({ failureThreshold: 1 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream failure", { status: 500 }))
      .mockResolvedValueOnce(responseFor({ sexual: false, "sexual/minors": false }));
    const log = vi.fn((entry: ImageModerationLogEntry) => {
      if (entry.outcome === "unavailable") {
        throw new Error("failure log failed");
      }
    });
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(twoRouteSettings()),
      circuitBreaker: breaker,
      log
    });

    await expect(client.moderateText("safe prompt")).resolves.toEqual({
      status: "allowed"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        routeId: "route-1",
        outcome: "unavailable",
        errorType: "request_error"
      })
    );
    expect(circuitStatus(breaker, "route-1", "text")).toMatchObject({
      state: "open",
      consecutiveFailures: 1,
      lastFailureType: "request_error",
      opens: 1
    });
    expect(circuitStatus(breaker, "route-2", "text")).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
      opens: 0
    });
  });

  it("preserves the last provider error when every failure log throws", async () => {
    vi.useFakeTimers();
    const breaker = createEnabledCircuitBreaker({ failureThreshold: 1 });
    const routeSettings = settings([
      { ...settings().routes[0]!, timeoutMs: 500 },
      {
        ...settings().routes[0]!,
        id: "route-2",
        providerAccountId: "account-2",
        priority: 2,
        timeoutMs: 500
      }
    ]);
    let callCount = 0;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(new Response("upstream failure", { status: 500 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true }
        );
      });
    });
    const log = vi.fn((entry: ImageModerationLogEntry) => {
      if (entry.outcome === "unavailable") {
        throw new Error("unavailable log failed");
      }
    });
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(routeSettings),
      circuitBreaker: breaker,
      log
    });

    const request = client.moderateText("unavailable prompt");
    const settled = request.catch((error: unknown) => error);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    const error = await settled;

    expect(error).toBeInstanceOf(ImageModerationUnavailableError);
    expect((error as ImageModerationUnavailableError).lastErrorType).toBe("timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: "unavailable", errorType: "request_error" })
    );
    expect(log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ outcome: "unavailable", errorType: "timeout" })
    );
    expect(circuitStatus(breaker, "route-2", "text")).toMatchObject({
      state: "open",
      lastFailureType: "timeout",
      opens: 1
    });
  });

  it("returns unavailable with a null last error when every route is skipped", async () => {
    const breaker = createEnabledCircuitBreaker();
    openCircuit(breaker, "route-1");
    openCircuit(breaker, "route-2");
    const fetchImpl = vi.fn<typeof fetch>();
    const logs: ImageModerationLogEntry[] = [];
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(twoRouteSettings()),
      circuitBreaker: breaker,
      log: (entry) => logs.push(entry)
    });

    const error = await client.moderateText("safe prompt").then(
      () => new Error("expected moderation to be unavailable"),
      (value: unknown) => value
    );
    expect(error).toBeInstanceOf(ImageModerationUnavailableError);
    expect((error as ImageModerationUnavailableError).lastErrorType).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it("keeps text and image breaker state isolated in routed moderation", async () => {
    const breaker = createEnabledCircuitBreaker();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("text upstream failure", { status: 500 }))
      .mockResolvedValueOnce(responseFor({ sexual: false }));
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(settings()),
      circuitBreaker: breaker
    });

    await expect(client.moderateText("text input")).rejects.toBeInstanceOf(
      ImageModerationUnavailableError
    );
    await expect(
      client.moderateImage({ url: "https://images.example/safe.png" })
    ).resolves.toEqual({ status: "allowed" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(circuitStatus(breaker, "route-1", "text").state).toBe("open");
    expect(circuitStatus(breaker, "route-1", "image")).toMatchObject({
      state: "closed",
      lastFailureType: null
    });
  });

  it("allows only one routed half-open probe with a deterministic provider gate", async () => {
    let now = 0;
    const breaker = createEnabledCircuitBreaker({
      now: () => now,
      cooldownMs: 1_000
    });
    openCircuit(breaker, "route-1");
    now = 1_000;

    let resolvePrimaryStarted!: () => void;
    const primaryStarted = new Promise<void>((resolve) => {
      resolvePrimaryStarted = resolve;
    });
    let releasePrimary!: () => void;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { model: string };
      if (payload.model === "primary-model") {
        resolvePrimaryStarted();
        return new Promise<Response>((resolve) => {
          releasePrimary = () =>
            resolve(responseFor({ sexual: false, "sexual/minors": false }));
        });
      }
      return responseFor({ sexual: false, "sexual/minors": false });
    });
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(twoRouteSettings()),
      circuitBreaker: breaker
    });

    const requestA = client.moderateText("probe A");
    await primaryStarted;
    const requestB = client.moderateText("probe B");
    await expect(requestB).resolves.toEqual({ status: "allowed" });
    expect(
      fetchImpl.mock.calls.map((call) =>
        (JSON.parse(String(call[1]?.body)) as { model: string }).model
      )
    ).toEqual(["primary-model", "backup-model"]);

    releasePrimary();
    await expect(requestA).resolves.toEqual({ status: "allowed" });
    expect(
      fetchImpl.mock.calls.filter(
        (call) =>
          (JSON.parse(String(call[1]?.body)) as { model: string }).model ===
          "primary-model"
      )
    ).toHaveLength(1);
    expect(circuitStatus(breaker, "route-1", "text")).toMatchObject({
      state: "closed",
      recoveries: 1
    });
  });

  it("does not let a stale in-flight success close an opened primary route", async () => {
    let now = 0;
    const breaker = createEnabledCircuitBreaker({
      now: () => now,
      failureThreshold: 1,
      cooldownMs: 1_000
    });
    const routeSettings = twoRouteSettings();
    let primaryCalls = 0;
    let resolvePrimaryStarted!: () => void;
    const primaryStarted = new Promise<void>((resolve) => {
      resolvePrimaryStarted = resolve;
    });
    let releaseFirstPrimary!: () => void;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { model: string };
      if (payload.model === "primary-model") {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          resolvePrimaryStarted();
          return new Promise<Response>((resolve) => {
            releaseFirstPrimary = () =>
              resolve(responseFor({ sexual: false, "sexual/minors": false }));
          });
        }
        return new Response("primary failure", { status: 500 });
      }
      return responseFor({ sexual: false, "sexual/minors": false });
    });
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(routeSettings),
      circuitBreaker: breaker
    });

    const requestA = client.moderateText("old in-flight request");
    await primaryStarted;
    const requestB = client.moderateText("new failing request");
    await expect(requestB).resolves.toEqual({ status: "allowed" });
    expect(circuitStatus(breaker, "route-1", "text")).toMatchObject({
      state: "open",
      lastFailureType: "request_error"
    });

    releaseFirstPrimary();
    await expect(requestA).resolves.toEqual({ status: "allowed" });
    expect(circuitStatus(breaker, "route-1", "text")).toMatchObject({
      state: "open",
      lastSuccessAt: null
    });

    await expect(client.moderateText("after stale success")).resolves.toEqual({
      status: "allowed"
    });
    expect(primaryCalls).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(circuitStatus(breaker, "route-1", "text").skips).toBe(1);
  });

  it("maps timeout failures to the circuit breaker failure type", async () => {
    vi.useFakeTimers();
    const breaker = createEnabledCircuitBreaker();
    const recordFailure = vi.spyOn(breaker, "recordFailure");
    const routeSettings = settings([{ ...settings().routes[0]!, timeoutMs: 500 }]);
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true }
          );
        })
    );
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(routeSettings),
      circuitBreaker: breaker
    });

    const request = client.moderateText("timeout input");
    const requestExpectation = expect(request).rejects.toBeInstanceOf(
      ImageModerationUnavailableError
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await requestExpectation;
    expect(recordFailure).toHaveBeenCalledWith(expect.anything(), "timeout");
    expect(circuitStatus(breaker, "route-1", "text").lastFailureType).toBe(
      "timeout"
    );
  });

  it("maps request failures to the circuit breaker failure type", async () => {
    const breaker = createEnabledCircuitBreaker();
    const recordFailure = vi.spyOn(breaker, "recordFailure");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(settings()),
      circuitBreaker: breaker
    });

    await expect(client.moderateText("request error input")).rejects.toBeInstanceOf(
      ImageModerationUnavailableError
    );
    expect(recordFailure).toHaveBeenCalledWith(expect.anything(), "request_error");
    expect(circuitStatus(breaker, "route-1", "text").lastFailureType).toBe(
      "request_error"
    );
  });

  it("maps invalid responses to the circuit breaker failure type", async () => {
    const breaker = createEnabledCircuitBreaker();
    const recordFailure = vi.spyOn(breaker, "recordFailure");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not json", { status: 200 }));
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: resolveRoutes(settings()),
      circuitBreaker: breaker
    });

    await expect(client.moderateText("invalid response input")).rejects.toBeInstanceOf(
      ImageModerationUnavailableError
    );
    expect(recordFailure).toHaveBeenCalledWith(expect.anything(), "invalid_response");
    expect(circuitStatus(breaker, "route-1", "text").lastFailureType).toBe(
      "invalid_response"
    );
  });

  it("maps unexpected routed errors to the circuit breaker unknown type", async () => {
    const breaker = createEnabledCircuitBreaker();
    const recordFailure = vi.spyOn(breaker, "recordFailure");
    const attempts = resolveModerationProviderAttempts({
      settings: settings(),
      providerAccounts: [account()],
      inputType: "text"
    });
    const unknownAttempt = attempts[0]!;
    Object.defineProperty(unknownAttempt, "timeoutMs", {
      configurable: true,
      get() {
        throw new Error("unexpected routed error");
      }
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: () => [unknownAttempt],
      circuitBreaker: breaker
    });

    await expect(client.moderateText("unknown error input")).rejects.toBeInstanceOf(
      ImageModerationUnavailableError
    );
    expect(recordFailure).toHaveBeenCalledWith(expect.anything(), "unknown");
    expect(circuitStatus(breaker, "route-1", "text").lastFailureType).toBe("unknown");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ImageModerationClient", () => {
  it("allows text and sends the moderation text input", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      responseFor({ sexual: false, "sexual/minors": false })
    );
    const client = createClient(fetchImpl);

    await expect(client.moderateText("a safe prompt")).resolves.toEqual({
      status: "allowed"
    });
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://moderation.example/v1/moderations",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer moderation-test-key"
    );
    expect(new Headers(request?.headers).get("content-type")).toBe(
      "application/json"
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "omni-moderation-latest",
      input: [{ type: "text", text: "a safe prompt" }]
    });
  });

  it("sends allowed routed moderation headers and blocks platform-owned overrides", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      responseFor({ sexual: false, "sexual/minors": false })
    );
    const routedAccount: ModerationProviderAccount = {
      id: "account-headers",
      name: "Moderation headers account",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://moderation.example/v1",
      apiKey: "secret-key",
      enabled: true,
      timeoutMs: 3000,
      configJson: {
        moderation: {
          requestFormat: "openai-moderation",
          endpointPath: "/v1/moderations",
          supportsText: true,
          supportsImage: true
        }
      },
      headersJson: {
        "X-Moderation-Trace": "trace-1",
        " X-Tenant ": " tenant-a ",
        "x-tenant": "tenant-b",
        Authorization: "blocked",
        "Content-Type": "blocked",
        Host: "blocked",
        "X-Control": "bad\r\nvalue"
      }
    };
    const routedSettings = normalizeModerationSettings({
      version: 1,
      enabled: true,
      routes: [
        {
          id: "route-headers",
          providerAccountId: routedAccount.id,
          upstreamModel: "omni-moderation-latest",
          endpointPath: "/v1/moderations",
          priority: 1,
          enabled: true,
          timeoutMs: null,
          supportsText: true,
          supportsImage: true
        }
      ]
    });
    const client = createRoutedImageModerationClient({
      fetchImpl,
      resolveAttempts: () =>
        resolveModerationProviderAttempts({
          settings: routedSettings,
          providerAccounts: [routedAccount],
          inputType: "text"
        })
    });

    await client.moderateText("safe prompt");

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-moderation-trace")).toBe("trace-1");
    expect(headers.get("x-tenant")).toBe("tenant-b");
    expect(headers.get("authorization")).toBe("Bearer secret-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-control")).toBeNull();
  });

  it.each([
    { category: "sexual" },
    { category: "sexual/minors" }
  ])("blocks text category $category", async ({ category }) => {
    const client = createClient(
      vi.fn<typeof fetch>(async () =>
        responseFor({
          sexual: category === "sexual",
          "sexual/minors": category === "sexual/minors"
        })
      )
    );

    await expect(client.moderateText("unsafe prompt")).resolves.toEqual({
      status: "blocked",
      categories: [category]
    });
  });

  it("blocks sexual images and allows safe images", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responseFor({ sexual: true }))
      .mockResolvedValueOnce(responseFor({ sexual: false }));
    const client = createClient(fetchImpl);

    await expect(
      client.moderateImage({ url: "https://cdn.example/image.png" })
    ).resolves.toEqual({ status: "blocked", categories: ["sexual"] });
    await expect(
      client.moderateImage({ url: VALID_DATA_URL })
    ).resolves.toEqual({ status: "allowed" });
  });

  it("formats HTTPS URL and Data URL image inputs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => responseFor({ sexual: false }));
    const client = createClient(fetchImpl);

    await client.moderateImage({ url: "https://cdn.example/safe.png?sig=secret" });
    await client.moderateImage({ url: VALID_DATA_URL });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      model: "omni-moderation-latest",
      input: [
        {
          type: "image_url",
          image_url: { url: "https://cdn.example/safe.png?sig=secret" }
        }
      ]
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      model: "omni-moderation-latest",
      input: [
        {
          type: "image_url",
          image_url: { url: VALID_DATA_URL }
        }
      ]
    });
  });

  it.each([
    new Response("upstream failure", { status: 500 }),
    new Response("not json", { status: 200 })
  ])("fails closed for non-2xx or invalid JSON", async (response) => {
    const client = createClient(vi.fn<typeof fetch>(async () => response));

    await expect(client.moderateText("prompt")).rejects.toBeInstanceOf(
      response.status === 200
        ? ImageModerationResponseError
        : ImageModerationRequestError
    );
  });

  it("fails closed when categories are missing", () => {
    expect(() =>
      parseModerationDecision(
        { results: [{ flagged: false, categories: {} }] },
        ["sexual"]
      )
    ).toThrowError(ImageModerationResponseError);
  });

  it("fails closed when an image response omits sexual", () => {
    expect(() =>
      parseModerationDecision(
        { results: [{ flagged: false, categories: { violence: false } }] },
        ["sexual"]
      )
    ).toThrowError(ImageModerationResponseError);
  });

  it("fails closed when a text response omits sexual", () => {
    expect(() =>
      parseModerationDecision(
        { results: [{ flagged: false, categories: { "sexual/minors": false } }] },
        ["sexual", "sexual/minors"]
      )
    ).toThrowError(ImageModerationResponseError);
  });

  it("fails closed when a text response omits sexual/minors", () => {
    expect(() =>
      parseModerationDecision(
        { results: [{ flagged: false, categories: { sexual: false } }] },
        ["sexual", "sexual/minors"]
      )
    ).toThrowError(ImageModerationResponseError);
  });

  it.each([
    { flagged: undefined, label: "missing flagged" },
    { flagged: "false", label: "non-boolean flagged" }
  ])("fails closed for $label", ({ flagged }) => {
    const result: Record<string, unknown> = {
      categories: { sexual: false }
    };
    if (flagged !== undefined) {
      result.flagged = flagged;
    }

    expect(() =>
      parseModerationDecision({ results: [result] }, ["sexual"])
    ).toThrowError(ImageModerationResponseError);
  });

  it("fails closed when a required category is not boolean", () => {
    expect(() =>
      parseModerationDecision(
        { results: [{ flagged: false, categories: { sexual: "false" } }] },
        ["sexual"]
      )
    ).toThrowError(ImageModerationResponseError);
  });

  it("fails closed when an extra category is not boolean", () => {
    expect(() =>
      parseModerationDecision(
        {
          results: [
            {
              flagged: false,
              categories: { sexual: false, violence: "false" }
            }
          ]
        },
        ["sexual"]
      )
    ).toThrowError(ImageModerationResponseError);
  });

  it("fails closed when flagged disagrees with categories", () => {
    expect(() =>
      parseModerationDecision(
        { results: [{ flagged: false, categories: { sexual: true } }] },
        ["sexual"]
      )
    ).toThrowError(ImageModerationResponseError);
  });

  it("allows a violence-only flagged response for the current business policy", () => {
    expect(
      parseModerationDecision(
        {
          results: [
            {
              flagged: true,
              categories: {
                sexual: false,
                "sexual/minors": false,
                violence: true
              }
            }
          ]
        },
        ["sexual", "sexual/minors"]
      )
    ).toEqual({ status: "blocked", categories: ["violence"] });
  });

  it("preserves valid complete text and image responses", async () => {
    expect(
      parseModerationDecision(
        {
          results: [
            {
              flagged: false,
              categories: {
                sexual: false,
                "sexual/minors": false,
                violence: false
              }
            }
          ]
        },
        ["sexual", "sexual/minors"]
      )
    ).toEqual({ status: "allowed" });
    expect(
      parseModerationDecision(
        { results: [{ flagged: false, categories: { sexual: false } }] },
        ["sexual"]
      )
    ).toEqual({ status: "allowed" });

    const client = createClient(
      vi.fn<typeof fetch>(async () =>
        responseFor({ sexual: false, "sexual/minors": false })
      )
    );
    await expect(client.moderateText("safe prompt")).resolves.toEqual({
      status: "allowed"
    });
  });

  it("rejects missing or extra moderation results", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ categories: {} }, { categories: {} }] }), {
          status: 200
        })
      );
    const client = createClient(fetchImpl);

    await expect(client.moderateText("prompt")).rejects.toBeInstanceOf(
      ImageModerationResponseError
    );
    await expect(client.moderateText("prompt")).rejects.toBeInstanceOf(
      ImageModerationResponseError
    );
  });

  it.each([
    "",
    "file:///tmp/image.png",
    "/tmp/image.png",
    "javascript:alert(1)",
    "data:text/plain;base64,SGVsbG8=",
    "data:image/png;base64,not-base64"
  ])("rejects unsafe image URL %s", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createClient(fetchImpl);

    await expect(client.moderateImage({ url })).rejects.toBeInstanceOf(
      ImageModerationRequestError
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts a hanging fetch and clears its timer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let operationSettled = false;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            operationSettled = true;
            reject(new Error("fetch aborted"));
          },
          { once: true }
        );
      });
    });
    const client = createClient(fetchImpl);
    const promise = client.moderateText("prompt");
    let rejectionCount = 0;
    const settled = promise.catch((error: unknown) => {
      rejectionCount += 1;
      return error;
    });

    await vi.advanceTimersByTimeAsync(500);
    const error = await settled;
    expect(error).toBeInstanceOf(ImageModerationTimeoutError);
    expect(rejectionCount).toBe(1);
    expect(signal?.aborted).toBe(true);
    expect(operationSettled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out while the response body is hanging without logging its body", async () => {
    vi.useFakeTimers();
    let operationSettled = false;
    let signal: AbortSignal | undefined;
    const response = {
      ok: true,
      status: 200,
      text: vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                operationSettled = true;
                reject(new Error("body aborted"));
              },
              { once: true }
            );
          })
      )
    } as unknown as Response;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return response;
    });
    const client = createClient(fetchImpl);
    const promise = client.moderateText("prompt");
    let rejectionCount = 0;
    const settled = promise.catch((error: unknown) => {
      rejectionCount += 1;
      return error;
    });

    await vi.advanceTimersByTimeAsync(500);
    const error = await settled;
    expect(error).toBeInstanceOf(ImageModerationTimeoutError);
    expect(rejectionCount).toBe(1);
    expect(signal?.aborted).toBe(true);
    expect(operationSettled).toBe(true);
    expect(response.text).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
