import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS,
  ModerationRouteCircuitBreaker,
  type ModerationRouteCircuitBreakerFailureType,
  type ModerationRouteCircuitBreakerLease,
  type ModerationRouteCircuitBreakerSettings,
  normalizeModerationRouteCircuitBreakerSettings,
  parseModerationRouteCircuitBreakerSettings
} from "../src/moderation-route-circuit-breaker";

function enabledSettings(
  overrides: Partial<ModerationRouteCircuitBreakerSettings> = {}
): ModerationRouteCircuitBreakerSettings {
  return normalizeModerationRouteCircuitBreakerSettings({
    ...DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS,
    enabled: true,
    ...overrides
  });
}

function createBreaker(input: {
  now: () => number;
  settings?: ModerationRouteCircuitBreakerSettings;
}): ModerationRouteCircuitBreaker {
  return new ModerationRouteCircuitBreaker({
    now: input.now,
    settings: input.settings ?? enabledSettings()
  });
}

function leaseOrThrow(
  lease: ModerationRouteCircuitBreakerLease | null
): ModerationRouteCircuitBreakerLease {
  if (!lease) {
    throw new Error("expected lease");
  }
  return lease;
}

function routeStatus(
  breaker: ModerationRouteCircuitBreaker,
  routeId: string,
  inputType: "text" | "image"
) {
  const status = breaker
    .status()
    .routes.find((route) => route.routeId === routeId && route.inputType === inputType);
  if (!status) {
    throw new Error("expected route status");
  }
  return status;
}

describe("moderation route circuit breaker settings", () => {
  it("uses the required default settings", () => {
    const breaker = new ModerationRouteCircuitBreaker({ now: () => 1_000 });

    expect(breaker.status()).toEqual({
      settings: DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS,
      epoch: 0,
      routes: []
    });
  });

  it("strictly validates and parses settings without coercion or unknown fields", () => {
    const valid = {
      version: 1,
      enabled: true,
      failureThreshold: 4,
      cooldownMs: 10_000
    };
    expect(normalizeModerationRouteCircuitBreakerSettings(valid)).toEqual(valid);
    expect(parseModerationRouteCircuitBreakerSettings(JSON.stringify(valid))).toEqual(valid);

    const invalidValues: unknown[] = [
      { ...valid, version: 2 },
      { ...valid, enabled: 1 },
      { ...valid, failureThreshold: 0 },
      { ...valid, failureThreshold: 21 },
      { ...valid, failureThreshold: 1.5 },
      { ...valid, failureThreshold: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, cooldownMs: 999 },
      { ...valid, cooldownMs: 600_001 },
      { ...valid, cooldownMs: 1.5 },
      { ...valid, cooldownMs: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, extra: false }
    ];

    for (const value of invalidValues) {
      expect(() => normalizeModerationRouteCircuitBreakerSettings(value)).toThrow(
        "IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_INVALID"
      );
    }
    expect(() => parseModerationRouteCircuitBreakerSettings("not-json")).toThrow(
      "IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_INVALID"
    );
    expect(() =>
      parseModerationRouteCircuitBreakerSettings(JSON.stringify({ ...valid, extra: false }))
    ).toThrow("IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_INVALID");
  });
});

describe("moderation route circuit breaker state machine", () => {
  it("keeps text and image state isolated", () => {
    let now = 1_000;
    const breaker = createBreaker({
      now: () => now,
      settings: enabledSettings({ failureThreshold: 1 })
    });

    const textLease = leaseOrThrow(breaker.acquire("route-a", "text"));
    breaker.recordFailure(textLease, "request_error");

    expect(breaker.acquire("route-a", "text")).toBeNull();
    const imageLease = breaker.acquire("route-a", "image");
    expect(imageLease).not.toBeNull();
    expect(routeStatus(breaker, "route-a", "text").state).toBe("open");
    expect(routeStatus(breaker, "route-a", "image").state).toBe("closed");
  });

  it("keeps failures below threshold closed", () => {
    const breaker = createBreaker({
      now: () => 2_000,
      settings: enabledSettings({ failureThreshold: 3 })
    });

    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "timeout");
    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "unknown");

    expect(routeStatus(breaker, "route-a", "text")).toMatchObject({
      state: "closed",
      consecutiveFailures: 2,
      openedAt: null,
      retryAt: null,
      lastFailureType: "unknown"
    });
  });

  it("opens at the threshold and records cooldown timestamps", () => {
    const breaker = createBreaker({
      now: () => 5_000,
      settings: enabledSettings({ failureThreshold: 3, cooldownMs: 10_000 })
    });

    for (const failureType of ["timeout", "request_error", "invalid_response"] as const) {
      breaker.recordFailure(
        leaseOrThrow(breaker.acquire("route-a", "text")),
        failureType
      );
    }

    expect(routeStatus(breaker, "route-a", "text")).toMatchObject({
      state: "open",
      consecutiveFailures: 3,
      openedAt: 5_000,
      retryAt: 15_000,
      opens: 1
    });
  });

  it("skips an open circuit before cooldown expiry", () => {
    let now = 10_000;
    const breaker = createBreaker({
      now: () => now,
      settings: enabledSettings({ failureThreshold: 1, cooldownMs: 10_000 })
    });
    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "timeout");

    now = 19_999;
    expect(breaker.acquire("route-a", "text")).toBeNull();
    expect(routeStatus(breaker, "route-a", "text").skips).toBe(1);
  });

  it("creates exactly one half-open probe at cooldown expiry", () => {
    let now = 20_000;
    const breaker = createBreaker({
      now: () => now,
      settings: enabledSettings({ failureThreshold: 1, cooldownMs: 10_000 })
    });
    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "timeout");

    now = 30_000;
    const probe = breaker.acquire("route-a", "text");
    expect(probe).not.toBeNull();
    expect(routeStatus(breaker, "route-a", "text").state).toBe("half_open");
    expect(breaker.acquire("route-a", "text")).toBeNull();
  });

  it("allows only one concurrent half-open acquire", () => {
    let now = 40_000;
    const breaker = createBreaker({
      now: () => now,
      settings: enabledSettings({ failureThreshold: 1, cooldownMs: 10_000 })
    });
    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "timeout");
    now = 50_000;

    const leases = Array.from({ length: 20 }, () => breaker.acquire("route-a", "text"));
    expect(leases.filter((lease) => lease !== null)).toHaveLength(1);
    expect(routeStatus(breaker, "route-a", "text").skips).toBe(19);
  });

  it("closes after a successful probe", () => {
    let now = 60_000;
    const breaker = createBreaker({
      now: () => now,
      settings: enabledSettings({ failureThreshold: 1, cooldownMs: 10_000 })
    });
    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "timeout");
    now = 70_000;
    const probe = leaseOrThrow(breaker.acquire("route-a", "text"));
    now = 70_001;
    breaker.recordSuccess(probe);
    const afterProbeSuccess = breaker.status();
    breaker.recordFailure(probe, "unknown");

    expect(routeStatus(breaker, "route-a", "text")).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
      openedAt: null,
      retryAt: null,
      lastSuccessAt: 70_001,
      recoveries: 1
    });
    expect(breaker.status()).toEqual(afterProbeSuccess);
  });

  it("reopens after a failed probe with a new cooldown", () => {
    let now = 80_000;
    const breaker = createBreaker({
      now: () => now,
      settings: enabledSettings({ failureThreshold: 1, cooldownMs: 10_000 })
    });
    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "timeout");
    now = 90_000;
    const probe = leaseOrThrow(breaker.acquire("route-a", "text"));
    now = 90_001;
    breaker.recordFailure(probe, "invalid_response");

    expect(routeStatus(breaker, "route-a", "text")).toMatchObject({
      state: "open",
      openedAt: 90_001,
      retryAt: 100_001,
      lastFailureType: "invalid_response",
      opens: 2
    });
  });

  it("resets consecutive failures after a normal success", () => {
    let now = 100_000;
    const breaker = createBreaker({
      now: () => now,
      settings: enabledSettings({ failureThreshold: 3 })
    });
    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "timeout");
    now = 100_001;
    const success = leaseOrThrow(breaker.acquire("route-a", "text"));
    now = 100_002;
    breaker.recordSuccess(success);

    expect(routeStatus(breaker, "route-a", "text")).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
      lastSuccessAt: 100_002
    });
  });
});

describe("moderation route circuit breaker stale lease handling", () => {
  it("ignores a closed request success after another request opens the circuit", () => {
    const breaker = createBreaker({
      now: () => 110_000,
      settings: enabledSettings({ failureThreshold: 2 })
    });
    const oldSuccess = leaseOrThrow(breaker.acquire("route-a", "text"));
    const failureOne = leaseOrThrow(breaker.acquire("route-a", "text"));
    const failureTwo = leaseOrThrow(breaker.acquire("route-a", "text"));
    breaker.recordFailure(failureOne, "timeout");
    breaker.recordFailure(failureTwo, "request_error");

    breaker.recordSuccess(oldSuccess);
    expect(routeStatus(breaker, "route-a", "text")).toMatchObject({
      state: "open",
      consecutiveFailures: 2,
      lastSuccessAt: null
    });
  });

  it("ignores an old failure after clear changes the epoch", () => {
    const breaker = createBreaker({
      now: () => 120_000,
      settings: enabledSettings({ failureThreshold: 1 })
    });
    const oldLease = leaseOrThrow(breaker.acquire("route-a", "text"));
    const oldEpoch = breaker.status().epoch;
    breaker.clear();
    breaker.recordFailure(oldLease, "timeout");

    expect(breaker.status()).toMatchObject({ epoch: oldEpoch + 1, routes: [] });
    expect(breaker.acquire("route-a", "text")).not.toBeNull();
    expect(routeStatus(breaker, "route-a", "text").state).toBe("closed");
  });

  it("ignores a stale half-open probe result after clear", () => {
    let now = 130_000;
    const breaker = createBreaker({
      now: () => now,
      settings: enabledSettings({ failureThreshold: 1, cooldownMs: 10_000 })
    });
    breaker.recordFailure(leaseOrThrow(breaker.acquire("route-a", "text")), "timeout");
    now = 140_000;
    const oldProbe = leaseOrThrow(breaker.acquire("route-a", "text"));
    breaker.clear();
    breaker.recordSuccess(oldProbe);
    breaker.recordFailure(oldProbe, "unknown");

    expect(breaker.status().routes).toEqual([]);
    expect(breaker.acquire("route-a", "text")).not.toBeNull();
  });

  it("invalidates old state and leases when settings change", () => {
    const breaker = createBreaker({
      now: () => 150_000,
      settings: enabledSettings({ failureThreshold: 1 })
    });
    const oldLease = leaseOrThrow(breaker.acquire("route-a", "text"));
    const oldEpoch = breaker.status().epoch;
    breaker.syncSettings(enabledSettings({ failureThreshold: 2 }));
    breaker.recordFailure(oldLease, "timeout");

    expect(breaker.status()).toMatchObject({
      epoch: oldEpoch + 1,
      settings: enabledSettings({ failureThreshold: 2 }),
      routes: []
    });
    breaker.recordFailure(
      leaseOrThrow(breaker.acquire("route-a", "text")),
      "timeout"
    );
    expect(routeStatus(breaker, "route-a", "text").state).toBe("closed");
  });
});

describe("moderation route circuit breaker disabled and status contracts", () => {
  it("does not block or accumulate attempts while disabled", () => {
    let now = 160_000;
    const breaker = new ModerationRouteCircuitBreaker({
      now: () => now,
      settings: DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS
    });
    const disabledLeases = Array.from({ length: 4 }, () =>
      leaseOrThrow(breaker.acquire("route-a", "text"))
    );
    for (const lease of disabledLeases) {
      breaker.recordFailure(lease, "timeout");
    }

    expect(breaker.status().routes).toEqual([]);
    breaker.applySettings(enabledSettings({ failureThreshold: 1 }));
    now += 1;
    expect(breaker.acquire("route-a", "text")).not.toBeNull();
    expect(routeStatus(breaker, "route-a", "text").state).toBe("closed");
  });

  it("returns only safe runtime fields and no request or provider payload", () => {
    const breaker = createBreaker({
      now: () => 170_000,
      settings: enabledSettings({ failureThreshold: 1 })
    });
    breaker.recordFailure(
      leaseOrThrow(breaker.acquire("safe-route", "image")),
      "unknown"
    );

    const status = breaker.status();
    expect(Object.keys(status)).toEqual(["settings", "epoch", "routes"]);
    expect(Object.keys(status.routes[0]!)).toEqual([
      "routeId",
      "inputType",
      "state",
      "consecutiveFailures",
      "openedAt",
      "retryAt",
      "lastFailureAt",
      "lastFailureType",
      "lastSuccessAt",
      "opens",
      "recoveries",
      "skips"
    ]);
    const serialized = JSON.stringify(status);
    for (const forbidden of [
      "prompt",
      "image-data",
      "https://",
      "apiKey",
      "authorization",
      "provider response",
      "provider error"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("accepts every supported failure type without broadening the contract", () => {
    const failureTypes: ModerationRouteCircuitBreakerFailureType[] = [
      "timeout",
      "request_error",
      "invalid_response",
      "unknown"
    ];
    for (const failureType of failureTypes) {
      const breaker = createBreaker({
        now: () => 180_000,
        settings: enabledSettings({ failureThreshold: 1 })
      });
      breaker.recordFailure(
        leaseOrThrow(breaker.acquire(`route-${failureType}`, "text")),
        failureType
      );
      expect(routeStatus(breaker, `route-${failureType}`, "text").lastFailureType).toBe(
        failureType
      );
    }
  });

  it("rejects unsupported failure types without changing runtime state", () => {
    const breaker = createBreaker({
      now: () => 190_000,
      settings: enabledSettings({ failureThreshold: 1 })
    });
    const lease = leaseOrThrow(breaker.acquire("route-a", "text"));

    expect(() =>
      breaker.recordFailure(
        lease,
        "provider_body" as ModerationRouteCircuitBreakerFailureType
      )
    ).toThrow("IMAGE_MODERATION_CIRCUIT_BREAKER_FAILURE_TYPE_INVALID");
    expect(routeStatus(breaker, "route-a", "text")).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastFailureType: null
    });
  });
});
