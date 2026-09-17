import type {
  ChatCreditRecoveryStore,
  RecoverExpiredChatReservationsResult
} from "../store";

export interface ChatCreditRecoveryLogger {
  info(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
}

export interface ChatCreditRecoveryTimer {
  setInterval(callback: () => void, intervalMs: number): NodeJS.Timeout;
  clearInterval(timer: NodeJS.Timeout): void;
}

export interface ChatCreditRecoveryServiceOptions {
  store: ChatCreditRecoveryStore;
  logger: ChatCreditRecoveryLogger;
  intervalMs?: number;
  batchLimit?: number;
  now?: () => Date;
  timer?: ChatCreditRecoveryTimer;
}

export interface CreateChatCreditRecoveryServiceFromEnvOptions {
  env: Partial<NodeJS.ProcessEnv>;
  store: object;
  logger: ChatCreditRecoveryLogger;
  now?: () => Date;
  timer?: ChatCreditRecoveryTimer;
  batchLimit?: number;
  schedulerFactory?: (
    options: ChatCreditRecoveryServiceOptions
  ) => ChatCreditRecoveryService;
}

export type ChatCreditRecoveryRunResult =
  | {
      status: "COMPLETED";
      result: RecoverExpiredChatReservationsResult;
      durationMs: number;
    }
  | {
      status: "FAILED";
      result: RecoverExpiredChatReservationsResult;
      durationMs: number;
    }
  | {
      status: "SKIPPED";
      reason: "RUN_IN_PROGRESS" | "SERVICE_STOPPED";
    };

export interface ChatCreditRecoveryService {
  ready(): Promise<void>;
  start(): void;
  runOnce(): Promise<ChatCreditRecoveryRunResult>;
  stop(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_BATCH_LIMIT = 100;
const MIN_INTERVAL_MS = 1;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

const defaultTimer: ChatCreditRecoveryTimer = {
  setInterval(callback, intervalMs) {
    return setInterval(callback, intervalMs);
  },
  clearInterval(timer) {
    clearInterval(timer);
  }
};

function validateIntervalMs(intervalMs: number): number {
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < MIN_INTERVAL_MS ||
    intervalMs > MAX_INTERVAL_MS
  ) {
    throw new TypeError("INVALID_CHAT_CREDIT_RECOVERY_INTERVAL_MS");
  }
  return intervalMs;
}

function validateBatchLimit(batchLimit: number): number {
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 1000) {
    throw new TypeError("INVALID_CHAT_CREDIT_RECOVERY_BATCH_LIMIT");
  }
  return batchLimit;
}

function emptyRecoveryResult(): RecoverExpiredChatReservationsResult {
  return {
    scanned: 0,
    settled: 0,
    released: 0,
    skipped: 0,
    failed: 0
  };
}

function createDisabledService(): ChatCreditRecoveryService {
  return {
    async ready(): Promise<void> {},
    start() {},
    runOnce(): Promise<ChatCreditRecoveryRunResult> {
      return Promise.resolve({
        status: "SKIPPED",
        reason: "SERVICE_STOPPED"
      });
    },
    async stop(): Promise<void> {},
    async close(): Promise<void> {}
  };
}

function isChatCreditRecoveryStore(
  value: object
): value is ChatCreditRecoveryStore {
  return typeof Reflect.get(value, "recoverExpiredChatReservations") === "function";
}

function parseIntervalMs(raw: string): number | undefined {
  const normalized = raw.trim();
  if (normalized.length === 0) return undefined;
  if (!/^\d+$/u.test(normalized)) {
    throw new TypeError("INVALID_CHAT_CREDIT_RECOVERY_INTERVAL_MS");
  }

  const intervalMs = Number(normalized);
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < MIN_INTERVAL_MS ||
    intervalMs > MAX_INTERVAL_MS
  ) {
    throw new TypeError("INVALID_CHAT_CREDIT_RECOVERY_INTERVAL_MS");
  }
  return intervalMs;
}

export function createChatCreditRecoveryServiceFromEnv(
  options: CreateChatCreditRecoveryServiceFromEnvOptions
): ChatCreditRecoveryService {
  const rawIntervalMs = options.env.CHAT_CREDIT_RECOVERY_INTERVAL_MS;
  const intervalMs =
    rawIntervalMs === undefined ? undefined : parseIntervalMs(rawIntervalMs);
  if (intervalMs === undefined) return createDisabledService();
  if (!isChatCreditRecoveryStore(options.store)) {
    throw new TypeError("INVALID_CHAT_CREDIT_RECOVERY_STORE");
  }

  const schedulerFactory =
    options.schedulerFactory ?? createChatCreditRecoveryService;
  return schedulerFactory({
    store: options.store,
    logger: options.logger,
    intervalMs,
    batchLimit: options.batchLimit,
    now: options.now,
    timer: options.timer
  });
}

export function createChatCreditRecoveryService(
  options: ChatCreditRecoveryServiceOptions
): ChatCreditRecoveryService {
  const intervalMs =
    options.intervalMs === undefined
      ? undefined
      : validateIntervalMs(options.intervalMs);
  const batchLimit = validateBatchLimit(options.batchLimit ?? DEFAULT_BATCH_LIMIT);
  const now = options.now ?? (() => new Date());
  const timerApi = options.timer ?? defaultTimer;

  let timer: NodeJS.Timeout | undefined;
  let currentRun: Promise<ChatCreditRecoveryRunResult> | undefined;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;

  const executeRecovery = async (): Promise<ChatCreditRecoveryRunResult> => {
    let startedAt = Date.now();

    try {
      const recoveryNow = now();
      startedAt = recoveryNow.getTime();
      const result = await options.store.recoverExpiredChatReservations({
        now: recoveryNow,
        limit: batchLimit
      });
      const durationMs = Math.max(0, now().getTime() - startedAt);
      options.logger.info(
        {
          event: "chat-credit-recovery-completed",
          scanned: result.scanned,
          settled: result.settled,
          released: result.released,
          skipped: result.skipped,
          failed: result.failed,
          durationMs
        },
        "chat credit recovery completed"
      );
      return { status: "COMPLETED", result, durationMs };
    } catch {
      const durationMs = Math.max(0, Date.now() - startedAt);
      const result = emptyRecoveryResult();
      result.failed = 1;
      options.logger.error(
        {
          event: "chat-credit-recovery-failed",
          errorCode: "CHAT_CREDIT_RECOVERY_FAILED",
          durationMs
        },
        "chat credit recovery failed"
      );
      return { status: "FAILED", result, durationMs };
    }
  };

  const runOnce = (): Promise<ChatCreditRecoveryRunResult> => {
    if (currentRun !== undefined) {
      options.logger.info(
        {
          event: "chat-credit-recovery-skipped",
          reason: "RUN_IN_PROGRESS"
        },
        "chat credit recovery skipped"
      );
      return Promise.resolve({
        status: "SKIPPED",
        reason: "RUN_IN_PROGRESS"
      });
    }
    if (stopped) {
      return Promise.resolve({
        status: "SKIPPED",
        reason: "SERVICE_STOPPED"
      });
    }

    const run = executeRecovery();
    currentRun = run;
    void run.then(
      () => {
        if (currentRun === run) currentRun = undefined;
      },
      () => {
        if (currentRun === run) currentRun = undefined;
      }
    );
    return run;
  };

  return {
    async ready(): Promise<void> {},
    start() {
      if (timer !== undefined || stopped || intervalMs === undefined) return;
      timer = timerApi.setInterval(() => {
        void runOnce().catch(() => undefined);
      }, intervalMs);
      timer.unref();
    },
    runOnce,
    stop(): Promise<void> {
      if (stopPromise !== undefined) return stopPromise;
      stopped = true;
      if (timer !== undefined) {
        timerApi.clearInterval(timer);
        timer = undefined;
      }
      const running = currentRun;
      stopPromise = (async () => {
        if (running !== undefined) await running;
      })();
      return stopPromise;
    },
    close(): Promise<void> {
      return this.stop();
    }
  };
}
