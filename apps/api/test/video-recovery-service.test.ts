import type { AiTaskRuntimeRecord, UserStore } from "../src/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoRecoveryServiceFromEnv } from "../src/recovery/video-recovery-service";

function runtimeTask(
  overrides: Partial<AiTaskRuntimeRecord> = {}
): AiTaskRuntimeRecord {
  const now = new Date("2026-08-14T00:00:00.000Z");
  return {
    id: "task-video-1",
    userId: "user-1",
    type: "video",
    status: "running",
    modelId: "video-model",
    prompt: "A recovery task",
    input: { mode: "text-to-video" },
    output: null,
    costCredits: 3,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides
  };
}

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("video recovery service", () => {
  const services: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    while (services.length > 0) {
      await services.pop()?.close();
    }
  });

  it("fails closed when recovery is disabled", async () => {
    const listRunningVideoTaskRuntime = vi.fn(async () => []);
    const recoverTask = vi.fn(async () => undefined);
    const service = createVideoRecoveryServiceFromEnv({
      env: { VIDEO_RECOVERY_ENABLED: "0" },
      store: { listRunningVideoTaskRuntime } satisfies Pick<
        UserStore,
        "listRunningVideoTaskRuntime"
      >,
      recoverTask,
      logger: logger()
    });
    services.push(service);

    await service.ready();
    service.start();
    await service.runOnce();

    expect(listRunningVideoTaskRuntime).not.toHaveBeenCalled();
    expect(recoverTask).not.toHaveBeenCalled();
  });

  it("scans only running video tasks and coalesces concurrent runs", async () => {
    const tasks = [
      runtimeTask(),
      runtimeTask({ id: "task-image", type: "image" }),
      runtimeTask({ id: "task-pending", status: "pending" })
    ];
    const listRunningVideoTaskRuntime = vi.fn(async () => tasks);
    let releaseRecovery: (() => void) | undefined;
    const recoveryStarted = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const recoverTask = vi.fn(async (task: AiTaskRuntimeRecord) => {
      expect(task.id).toBe("task-video-1");
      await recoveryStarted;
    });
    const logs = logger();
    const service = createVideoRecoveryServiceFromEnv({
      env: { VIDEO_RECOVERY_INTERVAL_MS: "1000" },
      store: { listRunningVideoTaskRuntime } satisfies Pick<
        UserStore,
        "listRunningVideoTaskRuntime"
      >,
      recoverTask,
      logger: logs
    });
    services.push(service);

    const firstRun = service.runOnce();
    await vi.waitFor(() => expect(recoverTask).toHaveBeenCalledTimes(1));
    const secondRun = service.runOnce();
    releaseRecovery?.();
    await Promise.all([firstRun, secondRun]);

    expect(listRunningVideoTaskRuntime).toHaveBeenCalledTimes(1);
    expect(recoverTask).toHaveBeenCalledTimes(1);
    expect(logs.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "video-recovery-completed",
        scanned: 3,
        recovered: 1
      }),
      expect.any(String)
    );
  });

  it("contains scan and task failures without unhandled rejection", async () => {
    const scanFailure = vi.fn(async () => {
      throw new Error("scan failure secret");
    });
    const scanLogger = logger();
    const scanService = createVideoRecoveryServiceFromEnv({
      env: { VIDEO_RECOVERY_INTERVAL_MS: "1000" },
      store: { listRunningVideoTaskRuntime: scanFailure } satisfies Pick<
        UserStore,
        "listRunningVideoTaskRuntime"
      >,
      recoverTask: vi.fn(async () => undefined),
      logger: scanLogger
    });
    services.push(scanService);

    await expect(scanService.runOnce()).resolves.toBeUndefined();
    expect(scanLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "video-recovery-scan-failed" }),
      expect.any(String)
    );
    expect(JSON.stringify(scanLogger.error.mock.calls)).not.toContain(
      "scan failure secret"
    );

    const taskLogger = logger();
    const taskFailure = vi.fn(async () => {
      throw new Error("task failure secret");
    });
    const taskService = createVideoRecoveryServiceFromEnv({
      env: { VIDEO_RECOVERY_INTERVAL_MS: "1000" },
      store: {
        listRunningVideoTaskRuntime: vi.fn(async () => [runtimeTask()])
      } satisfies Pick<UserStore, "listRunningVideoTaskRuntime">,
      recoverTask: taskFailure,
      logger: taskLogger
    });
    services.push(taskService);

    await expect(taskService.runOnce()).resolves.toBeUndefined();
    expect(taskLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "video-recovery-task-failed" }),
      expect.any(String)
    );
    expect(JSON.stringify(taskLogger.warn.mock.calls)).not.toContain(
      "task failure secret"
    );
  });
});
