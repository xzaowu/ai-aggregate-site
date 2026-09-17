export const IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_KEY =
  "imageModerationCircuitBreakerSettings";
export const IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_ERROR =
  "IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_INVALID";
export const IMAGE_MODERATION_CIRCUIT_BREAKER_FAILURE_TYPE_ERROR =
  "IMAGE_MODERATION_CIRCUIT_BREAKER_FAILURE_TYPE_INVALID";

export const DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS = {
  version: 1,
  enabled: false,
  failureThreshold: 3,
  cooldownMs: 60_000
} as const;

export type ModerationRouteCircuitBreakerSettings = {
  version: 1;
  enabled: boolean;
  failureThreshold: number;
  cooldownMs: number;
};

export type ModerationRouteCircuitBreakerInputType = "text" | "image";
export type ModerationRouteCircuitBreakerState =
  | "closed"
  | "open"
  | "half_open";
export type ModerationRouteCircuitBreakerFailureType =
  | "timeout"
  | "request_error"
  | "invalid_response"
  | "unknown";

declare const moderationRouteCircuitBreakerLeaseBrand: unique symbol;

export type ModerationRouteCircuitBreakerLease = {
  readonly [moderationRouteCircuitBreakerLeaseBrand]:
    "ModerationRouteCircuitBreakerLease";
};

export interface ModerationRouteCircuitBreakerRouteStatus {
  routeId: string;
  inputType: ModerationRouteCircuitBreakerInputType;
  state: ModerationRouteCircuitBreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  retryAt: number | null;
  lastFailureAt: number | null;
  lastFailureType: ModerationRouteCircuitBreakerFailureType | null;
  lastSuccessAt: number | null;
  opens: number;
  recoveries: number;
  skips: number;
}

export interface ModerationRouteCircuitBreakerStatus {
  settings: ModerationRouteCircuitBreakerSettings;
  epoch: number;
  routes: ModerationRouteCircuitBreakerRouteStatus[];
}

type CircuitBreakerClock = () => number;
type LeaseMode = "normal" | "probe" | "disabled";

type CircuitEntry = {
  state: ModerationRouteCircuitBreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  retryAt: number | null;
  lastFailureAt: number | null;
  lastFailureType: ModerationRouteCircuitBreakerFailureType | null;
  lastSuccessAt: number | null;
  generation: number;
  opens: number;
  recoveries: number;
  skips: number;
};

type LeaseRecord = {
  routeId: string;
  inputType: ModerationRouteCircuitBreakerInputType;
  epoch: number;
  generation: number;
  mode: LeaseMode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function requireSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_ERROR);
  }
  return value as number;
}

function cloneSettings(
  settings: ModerationRouteCircuitBreakerSettings
): ModerationRouteCircuitBreakerSettings {
  return { ...settings };
}

function sameSettings(
  left: ModerationRouteCircuitBreakerSettings,
  right: ModerationRouteCircuitBreakerSettings
): boolean {
  return (
    left.version === right.version &&
    left.enabled === right.enabled &&
    left.failureThreshold === right.failureThreshold &&
    left.cooldownMs === right.cooldownMs
  );
}

function requireRouteId(routeId: unknown): string {
  if (typeof routeId !== "string" || routeId.length === 0) {
    throw new Error("IMAGE_MODERATION_CIRCUIT_BREAKER_ROUTE_ID_INVALID");
  }
  return routeId;
}

function requireInputType(
  inputType: unknown
): ModerationRouteCircuitBreakerInputType {
  if (inputType !== "text" && inputType !== "image") {
    throw new Error("IMAGE_MODERATION_CIRCUIT_BREAKER_INPUT_TYPE_INVALID");
  }
  return inputType;
}

function isFailureType(
  failureType: unknown
): failureType is ModerationRouteCircuitBreakerFailureType {
  return (
    failureType === "timeout" ||
    failureType === "request_error" ||
    failureType === "invalid_response" ||
    failureType === "unknown"
  );
}

function createClosedEntry(): CircuitEntry {
  return {
    state: "closed",
    consecutiveFailures: 0,
    openedAt: null,
    retryAt: null,
    lastFailureAt: null,
    lastFailureType: null,
    lastSuccessAt: null,
    generation: 0,
    opens: 0,
    recoveries: 0,
    skips: 0
  };
}

export function normalizeModerationRouteCircuitBreakerSettings(
  value: unknown
): ModerationRouteCircuitBreakerSettings {
  const keys = [
    "version",
    "enabled",
    "failureThreshold",
    "cooldownMs"
  ] as const;
  if (!isRecord(value) || !hasExactlyKeys(value, keys)) {
    throw new Error(IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_ERROR);
  }

  const failureThreshold = requireSafeInteger(value.failureThreshold);
  const cooldownMs = requireSafeInteger(value.cooldownMs);
  if (
    value.version !== 1 ||
    typeof value.enabled !== "boolean" ||
    failureThreshold < 1 ||
    failureThreshold > 20 ||
    cooldownMs < 1_000 ||
    cooldownMs > 600_000
  ) {
    throw new Error(IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_ERROR);
  }

  return {
    version: 1,
    enabled: value.enabled,
    failureThreshold,
    cooldownMs
  };
}

export function parseModerationRouteCircuitBreakerSettings(
  value: string
): ModerationRouteCircuitBreakerSettings {
  if (typeof value !== "string") {
    throw new Error(IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_ERROR);
  }
  try {
    return normalizeModerationRouteCircuitBreakerSettings(JSON.parse(value));
  } catch {
    throw new Error(IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_ERROR);
  }
}

export class ModerationRouteCircuitBreaker {
  private readonly entries = new Map<
    string,
    Map<ModerationRouteCircuitBreakerInputType, CircuitEntry>
  >();
  private readonly leases = new WeakMap<object, LeaseRecord>();
  private readonly now: CircuitBreakerClock;
  private settings: ModerationRouteCircuitBreakerSettings;
  private epochValue = 0;

  constructor(options: {
    now?: CircuitBreakerClock;
    settings?: ModerationRouteCircuitBreakerSettings;
  } = {}) {
    this.now = options.now ?? Date.now;
    this.settings = normalizeModerationRouteCircuitBreakerSettings(
      options.settings ?? DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS
    );
  }

  get currentEpoch(): number {
    return this.epochValue;
  }

  acquire(
    routeId: string,
    inputType: ModerationRouteCircuitBreakerInputType
  ): ModerationRouteCircuitBreakerLease | null {
    const normalizedRouteId = requireRouteId(routeId);
    const normalizedInputType = requireInputType(inputType);
    const epoch = this.epochValue;

    if (!this.settings.enabled) {
      return this.createLease({
        routeId: normalizedRouteId,
        inputType: normalizedInputType,
        epoch,
        generation: 0,
        mode: "disabled"
      });
    }

    const entry = this.getOrCreateEntry(normalizedRouteId, normalizedInputType);
    if (entry.state === "closed") {
      return this.createLease({
        routeId: normalizedRouteId,
        inputType: normalizedInputType,
        epoch,
        generation: entry.generation,
        mode: "normal"
      });
    }

    if (entry.state === "open") {
      const now = this.now();
      if (entry.retryAt === null || now < entry.retryAt) {
        entry.skips += 1;
        return null;
      }

      entry.state = "half_open";
      entry.generation += 1;
      return this.createLease({
        routeId: normalizedRouteId,
        inputType: normalizedInputType,
        epoch,
        generation: entry.generation,
        mode: "probe"
      });
    }

    entry.skips += 1;
    return null;
  }

  recordSuccess(lease: ModerationRouteCircuitBreakerLease): void {
    const record = this.readLease(lease);
    if (!record || record.epoch !== this.epochValue || record.mode === "disabled") {
      return;
    }

    const entry = this.getEntry(record.routeId, record.inputType);
    if (!entry || entry.generation !== record.generation) {
      return;
    }

    if (record.mode === "normal" && entry.state === "closed") {
      entry.consecutiveFailures = 0;
      entry.lastSuccessAt = this.now();
      return;
    }

    if (record.mode === "probe" && entry.state === "half_open") {
      entry.state = "closed";
      entry.consecutiveFailures = 0;
      entry.openedAt = null;
      entry.retryAt = null;
      entry.lastSuccessAt = this.now();
      entry.recoveries += 1;
      entry.generation += 1;
    }
  }

  recordFailure(
    lease: ModerationRouteCircuitBreakerLease,
    failureType: ModerationRouteCircuitBreakerFailureType
  ): void {
    if (!isFailureType(failureType)) {
      throw new Error(IMAGE_MODERATION_CIRCUIT_BREAKER_FAILURE_TYPE_ERROR);
    }

    const record = this.readLease(lease);
    if (!record || record.epoch !== this.epochValue || record.mode === "disabled") {
      return;
    }

    const entry = this.getEntry(record.routeId, record.inputType);
    if (!entry || entry.generation !== record.generation) {
      return;
    }

    const now = this.now();
    entry.lastFailureAt = now;
    entry.lastFailureType = failureType;

    if (record.mode === "normal" && entry.state === "closed") {
      entry.consecutiveFailures += 1;
      if (entry.consecutiveFailures < this.settings.failureThreshold) {
        return;
      }

      entry.state = "open";
      entry.openedAt = now;
      entry.retryAt = now + this.settings.cooldownMs;
      entry.opens += 1;
      entry.generation += 1;
      return;
    }

    if (record.mode === "probe" && entry.state === "half_open") {
      entry.state = "open";
      entry.openedAt = now;
      entry.retryAt = now + this.settings.cooldownMs;
      entry.consecutiveFailures = this.settings.failureThreshold;
      entry.opens += 1;
      entry.generation += 1;
    }
  }

  clear(): void {
    this.entries.clear();
    this.epochValue += 1;
  }

  syncSettings(settings: ModerationRouteCircuitBreakerSettings): void {
    const normalized = normalizeModerationRouteCircuitBreakerSettings(settings);
    if (sameSettings(this.settings, normalized)) {
      return;
    }
    this.settings = cloneSettings(normalized);
    this.clear();
  }

  applySettings(settings: ModerationRouteCircuitBreakerSettings): void {
    this.settings = cloneSettings(
      normalizeModerationRouteCircuitBreakerSettings(settings)
    );
    this.clear();
  }

  status(): ModerationRouteCircuitBreakerStatus {
    const routes: ModerationRouteCircuitBreakerRouteStatus[] = [];
    for (const [routeId, byInputType] of this.entries) {
      for (const [inputType, entry] of byInputType) {
        routes.push({
          routeId,
          inputType,
          state: entry.state,
          consecutiveFailures: entry.consecutiveFailures,
          openedAt: entry.openedAt,
          retryAt: entry.retryAt,
          lastFailureAt: entry.lastFailureAt,
          lastFailureType: entry.lastFailureType,
          lastSuccessAt: entry.lastSuccessAt,
          opens: entry.opens,
          recoveries: entry.recoveries,
          skips: entry.skips
        });
      }
    }

    routes.sort((left, right) => {
      if (left.routeId < right.routeId) {
        return -1;
      }
      if (left.routeId > right.routeId) {
        return 1;
      }
      return left.inputType < right.inputType ? -1 : left.inputType > right.inputType ? 1 : 0;
    });

    return {
      settings: cloneSettings(this.settings),
      epoch: this.epochValue,
      routes
    };
  }

  private getOrCreateEntry(
    routeId: string,
    inputType: ModerationRouteCircuitBreakerInputType
  ): CircuitEntry {
    let byInputType = this.entries.get(routeId);
    if (!byInputType) {
      byInputType = new Map();
      this.entries.set(routeId, byInputType);
    }
    let entry = byInputType.get(inputType);
    if (!entry) {
      entry = createClosedEntry();
      byInputType.set(inputType, entry);
    }
    return entry;
  }

  private getEntry(
    routeId: string,
    inputType: ModerationRouteCircuitBreakerInputType
  ): CircuitEntry | undefined {
    return this.entries.get(routeId)?.get(inputType);
  }

  private createLease(record: LeaseRecord): ModerationRouteCircuitBreakerLease {
    const token = Object.freeze({});
    this.leases.set(token, record);
    return token as ModerationRouteCircuitBreakerLease;
  }

  private readLease(
    lease: ModerationRouteCircuitBreakerLease
  ): LeaseRecord | undefined {
    if (typeof lease !== "object" || lease === null) {
      return undefined;
    }
    return this.leases.get(lease);
  }
}

export function createModerationRouteCircuitBreaker(options: {
  now?: CircuitBreakerClock;
  settings?: ModerationRouteCircuitBreakerSettings;
} = {}): ModerationRouteCircuitBreaker {
  return new ModerationRouteCircuitBreaker(options);
}
