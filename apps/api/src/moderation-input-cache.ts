import { createHmac, randomBytes } from "node:crypto";
import type { ImageModerationDecision } from "./image-moderation";

export const IMAGE_MODERATION_CACHE_SETTINGS_KEY =
  "imageModerationCacheSettings";
export const IMAGE_MODERATION_CACHE_SETTINGS_ERROR =
  "IMAGE_MODERATION_CACHE_SETTINGS_INVALID";

export const DEFAULT_MODERATION_INPUT_CACHE_SETTINGS = {
  version: 1,
  enabled: false,
  singleflightEnabled: true,
  allowedTtlMs: 604_800_000,
  blockedTtlMs: 3_600_000,
  maxEntries: 10_000,
  policyVersion: "v1"
} as const;

export type ModerationInputCacheSettings = {
  version: 1;
  enabled: boolean;
  singleflightEnabled: boolean;
  allowedTtlMs: number;
  blockedTtlMs: number;
  maxEntries: number;
  policyVersion: string;
};

export type ModerationInputCacheOutcome =
  | "hit"
  | "miss"
  | "joined"
  | "bypass";

export class ModerationInputCacheEpochChangedError extends Error {
  constructor() {
    super("IMAGE_MODERATION_CACHE_EPOCH_CHANGED");
    this.name = "ModerationInputCacheEpochChangedError";
  }
}

export interface ModerationInputCacheStats {
  entries: number;
  inFlight: number;
  hits: number;
  misses: number;
  joins: number;
  writes: number;
  evictions: number;
  expired: number;
  clears: number;
  epoch: number;
}

export interface ModerationInputCacheStatus {
  settings: ModerationInputCacheSettings;
  runtime: ModerationInputCacheStats;
}

type CacheEntry = {
  decision: ImageModerationDecision;
  expiresAt: number;
  createdAt: number;
  epoch: number;
};

type CacheClock = () => number;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSettings(
  settings: ModerationInputCacheSettings
): ModerationInputCacheSettings {
  return { ...settings };
}

function cloneDecision(decision: ImageModerationDecision): ImageModerationDecision {
  return decision.status === "blocked"
    ? { status: "blocked", categories: [...decision.categories] }
    : { status: "allowed" };
}

function isCacheableDecision(
  value: unknown
): value is ImageModerationDecision {
  if (!isRecord(value)) {
    return false;
  }
  if (value.status === "allowed") {
    return true;
  }
  return (
    value.status === "blocked" &&
    Array.isArray(value.categories) &&
    value.categories.every((category) => typeof category === "string")
  );
}

function sameSettings(
  left: ModerationInputCacheSettings,
  right: ModerationInputCacheSettings
): boolean {
  return (
    left.version === right.version &&
    left.enabled === right.enabled &&
    left.singleflightEnabled === right.singleflightEnabled &&
    left.allowedTtlMs === right.allowedTtlMs &&
    left.blockedTtlMs === right.blockedTtlMs &&
    left.maxEntries === right.maxEntries &&
    left.policyVersion === right.policyVersion
  );
}

function requireSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(IMAGE_MODERATION_CACHE_SETTINGS_ERROR);
  }
  return value as number;
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

export function normalizeModerationInputCacheSettings(
  value: unknown
): ModerationInputCacheSettings {
  const keys = [
    "version",
    "enabled",
    "singleflightEnabled",
    "allowedTtlMs",
    "blockedTtlMs",
    "maxEntries",
    "policyVersion"
  ] as const;
  if (!isRecord(value) || !hasExactlyKeys(value, keys)) {
    throw new Error(IMAGE_MODERATION_CACHE_SETTINGS_ERROR);
  }

  const allowedTtlMs = requireSafeInteger(value.allowedTtlMs);
  const blockedTtlMs = requireSafeInteger(value.blockedTtlMs);
  const maxEntries = requireSafeInteger(value.maxEntries);
  const policyVersion =
    typeof value.policyVersion === "string" ? value.policyVersion.trim() : "";
  if (
    value.version !== 1 ||
    typeof value.enabled !== "boolean" ||
    typeof value.singleflightEnabled !== "boolean" ||
    allowedTtlMs < 60_000 ||
    allowedTtlMs > 2_592_000_000 ||
    blockedTtlMs < 60_000 ||
    blockedTtlMs > 86_400_000 ||
    maxEntries < 100 ||
    maxEntries > 50_000 ||
    policyVersion.length === 0 ||
    policyVersion.length > 64
  ) {
    throw new Error(IMAGE_MODERATION_CACHE_SETTINGS_ERROR);
  }

  return {
    version: 1,
    enabled: value.enabled,
    singleflightEnabled: value.singleflightEnabled,
    allowedTtlMs,
    blockedTtlMs,
    maxEntries,
    policyVersion
  };
}

export function parseModerationInputCacheSettings(
  value: string
): ModerationInputCacheSettings {
  try {
    return normalizeModerationInputCacheSettings(JSON.parse(value));
  } catch {
    throw new Error(IMAGE_MODERATION_CACHE_SETTINGS_ERROR);
  }
}

export function normalizeModerationInputText(input: string): string {
  return input.replace(/\r\n?/gu, "\n").trim().normalize("NFC");
}

function canonicalCacheKeyPayload(input: {
  normalizedInput: string;
  policyVersion: string;
  policyFingerprint: string;
}): string {
  // A fixed tuple keeps field order explicit and makes separator characters in
  // a prompt harmless because every string is JSON encoded first.
  return [
    JSON.stringify(1),
    JSON.stringify("text"),
    JSON.stringify(input.normalizedInput),
    JSON.stringify(input.policyVersion),
    JSON.stringify(input.policyFingerprint)
  ].join("\u001f");
}

export function buildModerationInputCacheKey(input: {
  secret: Uint8Array;
  normalizedInput: string;
  policyVersion: string;
  policyFingerprint: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(
      canonicalCacheKeyPayload({
        normalizedInput: input.normalizedInput,
        policyVersion: input.policyVersion,
        policyFingerprint: input.policyFingerprint
      })
    )
    .digest("hex");
}

export class ModerationInputCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<
    string,
    Promise<ImageModerationDecision>
  >();
  private readonly secret: Uint8Array;
  private readonly now: CacheClock;
  private settings: ModerationInputCacheSettings;
  private epochValue = 0;
  private hitsValue = 0;
  private missesValue = 0;
  private joinsValue = 0;
  private writesValue = 0;
  private evictionsValue = 0;
  private expiredValue = 0;
  private clearsValue = 0;

  constructor(options: {
    secret?: Uint8Array | string;
    now?: CacheClock;
    settings?: ModerationInputCacheSettings;
  } = {}) {
    const secret =
      typeof options.secret === "string"
        ? Buffer.from(options.secret, "utf8")
        : options.secret;
    this.secret = new Uint8Array(secret ?? randomBytes(32));
    if (this.secret.byteLength === 0) {
      throw new Error("MODERATION_CACHE_SECRET_INVALID");
    }
    this.now = options.now ?? Date.now;
    this.settings = cloneSettings(
      options.settings ?? DEFAULT_MODERATION_INPUT_CACHE_SETTINGS
    );
    normalizeModerationInputCacheSettings(this.settings);
  }

  get currentEpoch(): number {
    return this.epochValue;
  }

  syncSettings(settings: ModerationInputCacheSettings): void {
    const normalized = normalizeModerationInputCacheSettings(settings);
    if (sameSettings(this.settings, normalized)) {
      return;
    }
    this.settings = cloneSettings(normalized);
    this.clear();
  }

  applySettings(settings: ModerationInputCacheSettings): void {
    this.settings = cloneSettings(
      normalizeModerationInputCacheSettings(settings)
    );
    this.clear();
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.epochValue += 1;
    this.clearsValue += 1;
  }

  resizeMaxEntries(maxEntries: number): void {
    const normalized = requireSafeInteger(maxEntries);
    if (normalized < 100 || normalized > 50_000) {
      throw new Error(IMAGE_MODERATION_CACHE_SETTINGS_ERROR);
    }
    this.settings = { ...this.settings, maxEntries: normalized };
    this.evictToLimit();
  }

  private evictToLimit(): void {
    while (this.entries.size > this.settings.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") {
        return;
      }
      this.entries.delete(oldest);
      this.evictionsValue += 1;
    }
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.epoch !== this.epochValue) {
        this.entries.delete(key);
        continue;
      }
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        this.expiredValue += 1;
      }
    }
  }

  private read(key: string): ImageModerationDecision | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.epoch !== this.epochValue) {
      this.entries.delete(key);
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.expiredValue += 1;
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return cloneDecision(entry.decision);
  }

  private write(
    key: string,
    decision: ImageModerationDecision,
    epoch: number,
    settings: ModerationInputCacheSettings
  ): void {
    if (epoch !== this.epochValue || !settings.enabled) {
      return;
    }
    const ttlMs = decision.status === "allowed"
      ? settings.allowedTtlMs
      : settings.blockedTtlMs;
    const entry: CacheEntry = {
      decision: cloneDecision(decision),
      expiresAt: this.now() + ttlMs,
      createdAt: this.now(),
      epoch
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.writesValue += 1;
    this.evictToLimit();
  }

  async getOrExecute(input: {
    expectedEpoch?: number;
    text: string;
    policyFingerprint: string;
    execute(normalizedInput: string): Promise<ImageModerationDecision>;
  }): Promise<{
    decision: ImageModerationDecision;
    cacheOutcome: ModerationInputCacheOutcome;
  }> {
    const expectedEpoch = input.expectedEpoch ?? this.epochValue;
    if (expectedEpoch !== this.epochValue) {
      throw new ModerationInputCacheEpochChangedError();
    }
    const normalizedInput = normalizeModerationInputText(input.text);
    const settings = this.settings;
    const epoch = this.epochValue;
    const key = buildModerationInputCacheKey({
      secret: this.secret,
      normalizedInput,
      policyVersion: settings.policyVersion,
      policyFingerprint: input.policyFingerprint
    });

    if (settings.enabled) {
      const cached = this.read(key);
      if (cached) {
        this.hitsValue += 1;
        return { decision: cached, cacheOutcome: "hit" };
      }
    }

    if (!settings.enabled && !settings.singleflightEnabled) {
      return {
        decision: await input.execute(normalizedInput),
        cacheOutcome: "bypass"
      };
    }

    if (settings.singleflightEnabled) {
      const current = this.inFlight.get(key);
      if (current) {
        this.joinsValue += 1;
        return {
          decision: await current,
          cacheOutcome: "joined"
        };
      }
    }

    this.missesValue += 1;
    const promise = Promise.resolve().then(() => input.execute(normalizedInput));
    if (settings.singleflightEnabled) {
      this.inFlight.set(key, promise);
    }

    void promise.then(
      (decision) => {
        if (isCacheableDecision(decision)) {
          this.write(key, decision, epoch, settings);
        }
      },
      () => undefined
    ).then(() => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    });

    return {
      decision: await promise,
      cacheOutcome: "miss"
    };
  }

  status(): ModerationInputCacheStatus {
    this.purgeExpired();
    return {
      settings: cloneSettings(this.settings),
      runtime: {
        entries: this.entries.size,
        inFlight: this.inFlight.size,
        hits: this.hitsValue,
        misses: this.missesValue,
        joins: this.joinsValue,
        writes: this.writesValue,
        evictions: this.evictionsValue,
        expired: this.expiredValue,
        clears: this.clearsValue,
        epoch: this.epochValue
      }
    };
  }
}

export function createModerationInputCache(options: {
  secret?: Uint8Array | string;
  now?: CacheClock;
  settings?: ModerationInputCacheSettings;
} = {}): ModerationInputCache {
  return new ModerationInputCache(options);
}
