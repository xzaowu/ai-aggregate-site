import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODERATION_INPUT_CACHE_SETTINGS,
  ModerationInputCache,
  ModerationInputCacheEpochChangedError,
  buildModerationInputCacheKey,
  normalizeModerationInputCacheSettings,
  normalizeModerationInputText,
  type ModerationInputCacheSettings
} from "../src/moderation-input-cache";
import type { ImageModerationDecision } from "../src/image-moderation";

const POLICY = "policy-fingerprint";

function allowed(): ImageModerationDecision {
  return { status: "allowed" };
}

function blocked(): ImageModerationDecision {
  return { status: "blocked", categories: ["sexual"] };
}

function enabledSettings(
  overrides: Partial<ModerationInputCacheSettings> = {}
) {
  return normalizeModerationInputCacheSettings({
    ...DEFAULT_MODERATION_INPUT_CACHE_SETTINGS,
    enabled: true,
    ...overrides
  });
}

function createCache(input: {
  now?: () => number;
  settings?: ModerationInputCacheSettings;
} = {}) {
  return new ModerationInputCache({
    secret: "moderation-cache-test-secret",
    now: input.now,
    settings: input.settings ?? enabledSettings()
  });
}

describe("moderation input cache normalization and keys", () => {
  it("normalizes only line endings, outer whitespace, and Unicode NFC", () => {
    expect(normalizeModerationInputText(" \r\n a\r b \n ")).toBe("a\n b");
    expect(normalizeModerationInputText("e\u0301")).toBe("é");
    expect(normalizeModerationInputText("a  dog")).toBe("a  dog");
    expect(normalizeModerationInputText("a\ndog")).toBe("a\ndog");
  });

  it("uses HMAC-SHA256 over the fixed canonical payload", () => {
    const secret = Buffer.from("fixed-test-secret");
    const key = buildModerationInputCacheKey({
      secret,
      normalizedInput: "a dog",
      policyVersion: "v1",
      policyFingerprint: POLICY
    });
    const canonical = [
      JSON.stringify(1),
      JSON.stringify("text"),
      JSON.stringify("a dog"),
      JSON.stringify("v1"),
      JSON.stringify(POLICY)
    ].join("\u001f");
    expect(key).toBe(
      createHmac("sha256", secret).update(canonical).digest("hex")
    );
    expect(key).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("does not expose prompt data in status and distinguishes exact inputs", async () => {
    const cache = createCache();
    const execute = vi.fn(async () => allowed());
    await cache.getOrExecute({ text: "a dog", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "a dog\n", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "A dog", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "a dog.", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "a  dog", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "a\ndog", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "a\r\ndog", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "e\u0301", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "é", policyFingerprint: POLICY, execute });

    expect(execute).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(cache.status())).not.toContain("a dog");
    expect(JSON.stringify(cache.status())).not.toContain("é");
  });
});

describe("moderation input cache LRU and TTL", () => {
  it("uses separate TTLs and counts expiry on access", async () => {
    let now = 1_000;
    const cache = createCache({
      now: () => now,
      settings: enabledSettings({ allowedTtlMs: 60_000, blockedTtlMs: 120_000 })
    });
    const execute = vi.fn(async (text: string) =>
      text === "blocked" ? blocked() : allowed()
    );

    await cache.getOrExecute({ text: "allowed", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "blocked", policyFingerprint: POLICY, execute });
    now += 60_000;
    await cache.getOrExecute({ text: "allowed", policyFingerprint: POLICY, execute });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(cache.status().runtime.expired).toBe(1);
    now += 60_001;
    await cache.getOrExecute({ text: "blocked", policyFingerprint: POLICY, execute });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(cache.status().runtime.expired).toBe(3);
  });

  it("updates MRU order and evicts from the oldest end", async () => {
    const cache = createCache({
      settings: enabledSettings({ maxEntries: 100 })
    });
    const execute = vi.fn(async () => allowed());
    for (let index = 0; index < 100; index += 1) {
      await cache.getOrExecute({
        text: `prompt-${index}`,
        policyFingerprint: POLICY,
        execute
      });
    }
    await cache.getOrExecute({ text: "prompt-0", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "prompt-100", policyFingerprint: POLICY, execute });
    await cache.getOrExecute({ text: "prompt-1", policyFingerprint: POLICY, execute });

    expect(execute).toHaveBeenCalledTimes(102);
    expect(cache.status().runtime.evictions).toBe(2);
  });

  it("immediately evicts when maxEntries is reduced", async () => {
    const cache = createCache({
      settings: enabledSettings({ maxEntries: 200 })
    });
    const execute = vi.fn(async () => allowed());
    for (let index = 0; index < 150; index += 1) {
      await cache.getOrExecute({
        text: `prompt-${index}`,
        policyFingerprint: POLICY,
        execute
      });
    }
    cache.resizeMaxEntries(100);
    expect(cache.status().runtime.entries).toBe(100);
    expect(cache.status().runtime.evictions).toBe(50);
  });

  it("does not cache unavailable or thrown results", async () => {
    const cache = createCache();
    const unavailable = new Error("unavailable");
    const execute = vi.fn()
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(new Error("thrown"))
      .mockRejectedValueOnce(new Error("thrown"));

    await expect(cache.getOrExecute({ text: "unavailable", policyFingerprint: POLICY, execute }))
      .rejects.toBe(unavailable);
    await expect(cache.getOrExecute({ text: "unavailable", policyFingerprint: POLICY, execute }))
      .rejects.toBe(unavailable);
    await expect(cache.getOrExecute({ text: "thrown", policyFingerprint: POLICY, execute }))
      .rejects.toThrow("thrown");
    await expect(cache.getOrExecute({ text: "thrown", policyFingerprint: POLICY, execute }))
      .rejects.toThrow("thrown");
    expect(execute).toHaveBeenCalledTimes(4);
    expect(cache.status().runtime.entries).toBe(0);
  });
});

describe("moderation input singleflight", () => {
  it("rejects a stale expected epoch before reading, joining, or leading", async () => {
    const cache = createCache();
    const expectedEpoch = cache.currentEpoch;
    cache.clear();
    const execute = vi.fn(async () => allowed());

    await expect(
      cache.getOrExecute({
        expectedEpoch,
        text: "stale",
        policyFingerprint: POLICY,
        execute
      })
    ).rejects.toBeInstanceOf(ModerationInputCacheEpochChangedError);
    expect(execute).not.toHaveBeenCalled();
    expect(cache.status().runtime.misses).toBe(0);
    expect(cache.status().runtime.joins).toBe(0);
  });

  it("runs one leader for twenty identical concurrent inputs", async () => {
    let resolveLeader: ((value: ReturnType<typeof allowed>) => void) | undefined;
    const cache = createCache();
    const execute = vi.fn(
      () => new Promise<ReturnType<typeof allowed>>((resolve) => {
        resolveLeader = resolve;
      })
    );
    const requests = Array.from({ length: 20 }, () =>
      cache.getOrExecute({ text: "same", policyFingerprint: POLICY, execute })
    );
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    resolveLeader?.(allowed());
    const results = await Promise.all(requests);
    expect(results.filter((result) => result.cacheOutcome === "miss")).toHaveLength(1);
    expect(results.filter((result) => result.cacheOutcome === "joined")).toHaveLength(19);
    expect(results.every((result) => result.decision.status === "allowed")).toBe(true);
    expect(cache.status().runtime.joins).toBe(19);
  });

  it("shares blocked and unavailable outcomes with followers", async () => {
    let resolveBlocked: ((value: ReturnType<typeof blocked>) => void) | undefined;
    const blockedCache = createCache();
    const blockedExecute = vi.fn(
      () => new Promise<ReturnType<typeof blocked>>((resolve) => {
        resolveBlocked = resolve;
      })
    );
    const blockedRequests = [1, 2, 3].map(() =>
      blockedCache.getOrExecute({ text: "blocked", policyFingerprint: POLICY, execute: blockedExecute })
    );
    await Promise.resolve();
    resolveBlocked?.(blocked());
    const blockedResults = await Promise.all(blockedRequests);
    expect(blockedExecute).toHaveBeenCalledTimes(1);
    expect(blockedResults.every((result) => result.decision.status === "blocked")).toBe(true);

    let rejectUnavailable: ((error: Error) => void) | undefined;
    const unavailableCache = createCache();
    const unavailableExecute = vi.fn(
      () => new Promise<ReturnType<typeof allowed>>((_resolve, reject) => {
        rejectUnavailable = reject;
      })
    );
    const unavailableRequests = [1, 2, 3].map(() =>
      unavailableCache.getOrExecute({ text: "unavailable", policyFingerprint: POLICY, execute: unavailableExecute })
    );
    await Promise.resolve();
    rejectUnavailable?.(new Error("unavailable"));
    await expect(Promise.all(unavailableRequests)).rejects.toThrow("unavailable");
    expect(unavailableExecute).toHaveBeenCalledTimes(1);
    expect(unavailableCache.status().runtime.entries).toBe(0);
  });

  it("does not merge different policies or different inputs", async () => {
    const cache = createCache();
    const execute = vi.fn(async () => allowed());
    await Promise.all([
      cache.getOrExecute({ text: "same", policyFingerprint: "one", execute }),
      cache.getOrExecute({ text: "same", policyFingerprint: "two", execute }),
      cache.getOrExecute({ text: "different", policyFingerprint: "one", execute })
    ]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("does not merge when disabled, but still merges with cache disabled", async () => {
    const disabled = createCache({
      settings: enabledSettings({ enabled: true, singleflightEnabled: false })
    });
    const disabledExecute = vi.fn(async () => allowed());
    await Promise.all([
      disabled.getOrExecute({ text: "same", policyFingerprint: POLICY, execute: disabledExecute }),
      disabled.getOrExecute({ text: "same", policyFingerprint: POLICY, execute: disabledExecute })
    ]);
    expect(disabledExecute).toHaveBeenCalledTimes(2);

    const noCache = createCache({
      settings: enabledSettings({ enabled: false, singleflightEnabled: true })
    });
    let resolve: ((value: ReturnType<typeof allowed>) => void) | undefined;
    const noCacheExecute = vi.fn(
      () => new Promise<ReturnType<typeof allowed>>((next) => {
        resolve = next;
      })
    );
    const first = noCache.getOrExecute({ text: "same", policyFingerprint: POLICY, execute: noCacheExecute });
    const second = noCache.getOrExecute({ text: "same", policyFingerprint: POLICY, execute: noCacheExecute });
    await Promise.resolve();
    expect(noCacheExecute).toHaveBeenCalledTimes(1);
    resolve?.(allowed());
    expect((await Promise.all([first, second])).map((result) => result.cacheOutcome).sort()).toEqual([
      "joined",
      "miss"
    ]);
    expect(noCache.status().runtime.entries).toBe(0);
  });

  it("keeps old epochs from writing and does not delete a replacement promise", async () => {
    const cache = createCache();
    let resolveOld: ((value: ReturnType<typeof allowed>) => void) | undefined;
    let resolveNew: ((value: ReturnType<typeof allowed>) => void) | undefined;
    const execute = vi.fn()
      .mockImplementationOnce(() => new Promise<ReturnType<typeof allowed>>((resolve) => {
        resolveOld = resolve;
      }))
      .mockImplementationOnce(() => new Promise<ReturnType<typeof allowed>>((resolve) => {
        resolveNew = resolve;
      }));

    const old = cache.getOrExecute({ text: "same", policyFingerprint: POLICY, execute });
    await Promise.resolve();
    cache.clear();
    resolveOld?.(allowed());
    await old;
    const replacement = cache.getOrExecute({ text: "same", policyFingerprint: POLICY, execute });
    await Promise.resolve();
    resolveOld?.(allowed());
    expect(execute).toHaveBeenCalledTimes(2);
    resolveNew?.(allowed());
    await replacement;
    const joined = await cache.getOrExecute({ text: "same", policyFingerprint: POLICY, execute });
    expect(joined.cacheOutcome).toBe("hit");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("clears entries and advances epoch", async () => {
    const cache = createCache();
    await cache.getOrExecute({ text: "clear-me", policyFingerprint: POLICY, execute: async () => allowed() });
    const before = cache.status().runtime;
    cache.clear();
    const after = cache.status().runtime;
    expect(after.entries).toBe(0);
    expect(after.epoch).toBe(before.epoch + 1);
    expect(after.clears).toBe(before.clears + 1);
  });
});
