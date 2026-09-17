import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  readFileSync,
  rmdirSync,
  unlinkSync
} from "node:fs";
import {
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

const LOCK_ROOT = "/tmp";
const LOCK_TIMEOUT_MS = 180_000;
const MIN_POLL_INTERVAL_MS = 100;
const MAX_POLL_INTERVAL_MS = 250;
const OWNER_FILE_NAME = "owner.json";

export const IMAGE_RECOVERY_TEST_LOCK_NAME = "image-recovery-global-scan";

interface LockOwner {
  pid: number;
  token: string;
}

export interface CrossWorkerTestLock {
  release(): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return String((error as { code?: unknown }).code);
}

function lockDirectory(name: string, databaseUrl: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error("TEST_CROSS_WORKER_LOCK_NAME_INVALID");
  }
  const databaseDigest = createHash("sha256").update(databaseUrl).digest("hex");
  return join(LOCK_ROOT, `ai-aggregate-test-${name}-${databaseDigest.slice(0, 24)}.lock`);
}

async function readOwner(ownerPath: string): Promise<LockOwner | undefined> {
  let raw: string;
  try {
    raw = await readFile(ownerPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  try {
    const value = JSON.parse(raw) as Partial<LockOwner>;
    if (
      !Number.isInteger(value.pid) ||
      (value.pid ?? 0) <= 0 ||
      typeof value.token !== "string" ||
      value.token.length === 0
    ) {
      return undefined;
    }
    return { pid: value.pid!, token: value.token };
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

async function clearDeadOwner(
  lockPath: string,
  ownerPath: string
): Promise<boolean> {
  const owner = await readOwner(ownerPath);
  if (!owner || isProcessAlive(owner.pid)) {
    return false;
  }

  const currentOwner = await readOwner(ownerPath);
  if (
    !currentOwner ||
    currentOwner.pid !== owner.pid ||
    currentOwner.token !== owner.token
  ) {
    return false;
  }

  try {
    await unlink(ownerPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
  await rmdir(lockPath);
  return true;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function createLease(
  lockPath: string,
  ownerPath: string,
  owner: LockOwner
): CrossWorkerTestLock {
  let released = false;

  const releaseOnExit = (): void => {
    if (released) {
      return;
    }
    try {
      const currentOwner = JSON.parse(
        readFileSync(ownerPath, "utf8")
      ) as Partial<LockOwner>;
      if (currentOwner.token !== owner.token) {
        return;
      }
      unlinkSync(ownerPath);
      rmdirSync(lockPath);
      released = true;
    } catch {
      // Process-exit cleanup is best-effort; normal release remains authoritative.
    }
  };
  process.once("exit", releaseOnExit);

  return {
    async release(): Promise<void> {
      if (released) {
        return;
      }

      const currentOwner = await readOwner(ownerPath);
      if (currentOwner?.token !== owner.token) {
        released = true;
        process.removeListener("exit", releaseOnExit);
        return;
      }

      try {
        await unlink(ownerPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }
      try {
        await rmdir(lockPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }
      released = true;
      process.removeListener("exit", releaseOnExit);
    }
  };
}

export async function acquireCrossWorkerTestLock(input: {
  name: string;
  databaseUrl: string;
}): Promise<CrossWorkerTestLock> {
  const lockPath = lockDirectory(input.name, input.databaseUrl);
  const ownerPath = join(lockPath, OWNER_FILE_NAME);
  const owner: LockOwner = { pid: process.pid, token: randomUUID() };
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeFile(ownerPath, JSON.stringify(owner), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
      } catch (error) {
        try {
          await unlink(ownerPath);
        } catch (cleanupError) {
          if (errorCode(cleanupError) !== "ENOENT") {
            throw cleanupError;
          }
        }
        await rmdir(lockPath);
        throw error;
      }
      return createLease(lockPath, ownerPath, owner);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw error;
      }
    }

    if (await clearDeadOwner(lockPath, ownerPath)) {
      continue;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("TEST_CROSS_WORKER_LOCK_TIMEOUT");
    }
    const pollIntervalMs = randomInt(
      MIN_POLL_INTERVAL_MS,
      MAX_POLL_INTERVAL_MS + 1
    );
    await wait(Math.min(pollIntervalMs, remainingMs));
  }
}
