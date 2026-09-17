import { randomUUID } from "node:crypto";
import type { ImageRecoveryLock, ImageRecoveryLockLease } from "./image-recovery-scheduler";

const MAX_KEY_LENGTH = 512;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const IMAGE_RECOVERY_LOCK_RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end

return 0
`.trim();

export interface RedisImageRecoveryLockClient {
  set(
    key: string,
    value: string,
    options: {
      NX: true;
      PX: number;
    }
  ): Promise<string | null>;
  eval(
    script: string,
    options: {
      keys: string[];
      arguments: string[];
    }
  ): Promise<unknown>;
}

export interface RedisImageRecoveryLockOptions {
  client: RedisImageRecoveryLockClient;
  key: string;
  ttlMs: number;
  tokenFactory?: () => string;
}

function validateKey(key: string): void {
  if (
    key.trim().length === 0 ||
    key.length > MAX_KEY_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(key)
  ) {
    throw new TypeError("image recovery lock key is invalid");
  }
}

function validateTtlMs(ttlMs: number): void {
  if (
    !Number.isFinite(ttlMs) ||
    !Number.isInteger(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > MAX_TTL_MS
  ) {
    throw new TypeError("image recovery lock ttlMs is invalid");
  }
}

function validateToken(token: string): void {
  if (
    typeof token !== "string" ||
    token.trim().length === 0 ||
    CONTROL_CHARACTER_PATTERN.test(token)
  ) {
    throw new TypeError("image recovery lock token is invalid");
  }
}

function parseReleaseResult(value: unknown): 0 | 1 | null {
  if (value === 0 || value === 1) return value;
  if (value === 0n) return 0;
  if (value === 1n) return 1;
  if (value === "0") return 0;
  if (value === "1") return 1;
  return null;
}

function createLease(
  client: RedisImageRecoveryLockClient,
  key: string,
  token: string
): ImageRecoveryLockLease {
  let releasePromise: Promise<void> | undefined;

  const releaseToken = async (): Promise<void> => {
    const raw = await client.eval(IMAGE_RECOVERY_LOCK_RELEASE_LUA, {
      keys: [key],
      arguments: [token]
    });
    if (parseReleaseResult(raw) === null) {
      throw new Error("Unexpected Redis response while releasing image recovery lock");
    }
  };

  return {
    release(): Promise<void> {
      if (releasePromise !== undefined) return releasePromise;
      releasePromise = releaseToken();
      return releasePromise;
    }
  };
}

export function createRedisImageRecoveryLock(
  options: RedisImageRecoveryLockOptions
): ImageRecoveryLock {
  validateKey(options.key);
  validateTtlMs(options.ttlMs);

  const tokenFactory = options.tokenFactory ?? randomUUID;

  return {
    async acquire(): Promise<ImageRecoveryLockLease | null> {
      const token = tokenFactory();
      validateToken(token);

      const result = await options.client.set(options.key, token, {
        NX: true,
        PX: options.ttlMs
      });
      if (result === null) return null;
      if (result !== "OK") {
        throw new Error("Unexpected Redis response while acquiring image recovery lock");
      }
      return createLease(options.client, options.key, token);
    }
  };
}
