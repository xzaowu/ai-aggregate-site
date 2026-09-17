import type {
  AiAssetSummary,
  AiTaskStatus,
  AiTaskSummary,
  ImageGenerationResponse
} from "@ai-aggregate/shared";
import { describe, expect, it, vi } from "vitest";
import { createImageGenerationAttempt } from "./image-generation-attempt";
import {
  defaultImageGenerationPollAttempts,
  defaultImageGenerationPollIntervalMs,
  findImageTaskForPollingReconcile,
  submitAndReconcileImageGeneration
} from "./image-generation-reconciliation";

const submissionEndpoint = "/image/generate";
const tasksEndpoint = "/tasks?type=image&limit=20";
const requestStartedAt = new Date("2026-08-24T00:00:10.000Z");
const attempt = createImageGenerationAttempt(
  {
    prompt: "Headless reconciliation prompt",
    modelId: "image-model",
    size: "1024x1024",
    count: 1,
    mode: "text-to-image",
    clientEntryId: "client-entry-headless"
  },
  { createKey: () => "headless-attempt-key-0001" }
);

function createTask(
  status: AiTaskStatus,
  overrides: Partial<AiTaskSummary> = {}
): AiTaskSummary {
  return {
    id: `task-${status}`,
    userId: "user-1",
    type: "image",
    status,
    modelId: attempt.payload.modelId,
    prompt: attempt.payload.prompt,
    input: {
      mode: "text-to-image",
      size: "1024x1024",
      count: 1,
      clientEntryId: attempt.payload.clientEntryId
    },
    output:
      status === "succeeded"
        ? { images: ["/assets/asset-1/content"] }
        : null,
    costCredits: 2,
    errorMessage: status === "failed" ? "Safe reconciled failure" : null,
    createdAt: "2026-08-24T00:00:10.000Z",
    updatedAt: "2026-08-24T00:00:11.000Z",
    completedAt:
      status === "succeeded" || status === "failed"
        ? "2026-08-24T00:00:11.000Z"
        : null,
    ...overrides
  };
}

function createAsset(taskId: string): AiAssetSummary {
  return {
    id: "asset-1",
    userId: "user-1",
    taskId,
    type: "image",
    url: "/assets/asset-1/content",
    thumbnailUrl: null,
    title: null,
    metadata: null,
    createdAt: "2026-08-24T00:00:11.000Z"
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function successResponse(task = createTask("succeeded")): ImageGenerationResponse {
  return { task, assets: [createAsset(task.id)] };
}

function lifecycleOptions(
  fetchImplementation: typeof fetch,
  overrides: Partial<Parameters<typeof submitAndReconcileImageGeneration>[0]> = {}
) {
  return {
    attempt,
    token: "token-1",
    submissionEndpoint,
    tasksEndpoint,
    taskDetailEndpoint: (taskId: string) => `/tasks/${taskId}`,
    fetchImplementation,
    requestStartedAt,
    ...overrides
  };
}

function requestMethod(init?: RequestInit) {
  return init?.method ?? "GET";
}

describe("submitAndReconcileImageGeneration", () => {
  it("returns direct success after exactly one POST and no reconciliation GET", async () => {
    const response = successResponse();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(response)
    );

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch)
    );

    expect(outcome).toMatchObject({
      kind: "succeeded",
      source: "submission",
      task: response.task,
      assets: response.assets
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestMethod(fetchMock.mock.calls[0]?.[1])).toBe("POST");
  });

  it.each([false, true])(
    "returns a terminal structured failure and preserves retryable=%s without GET",
    async (retryable) => {
      const fetchMock = vi.fn(async () =>
        jsonResponse(
          { code: "IMAGE_GENERATION_FAILED", message: "Safe failure", retryable },
          500
        )
      );

      const outcome = await submitAndReconcileImageGeneration(
        lifecycleOptions(fetchMock as typeof fetch)
      );

      if (outcome.kind !== "failed" || outcome.source !== "submission") {
        throw new Error("Expected a terminal submission failure");
      }
      expect(outcome.submission.decision).toEqual({
        kind: "structured_failure",
        terminal: true,
        retryable
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it("reconciles a 202 with one immediate GET and never sends a second POST", async () => {
    const onPollingStarted = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      requestMethod(init) === "POST"
        ? jsonResponse(
            { status: "in_progress", taskId: "task-running", retryAfterMs: 2500 },
            202
          )
        : jsonResponse({ tasks: [] })
    );

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, {
        pollAttempts: 0,
        onPollingStarted
      })
    );

    expect(outcome.kind).toBe("unresolved");
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "GET")).toHaveLength(1);
    expect(onPollingStarted).toHaveBeenCalledTimes(1);
  });

  it("reconciles a transport throw with GET and never sends another POST", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (requestMethod(init) === "POST") {
        throw new Error("Failed to fetch");
      }
      return jsonResponse({ tasks: [] });
    });

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, { pollAttempts: 0 })
    );

    if (outcome.kind !== "unresolved") {
      throw new Error("Expected unresolved transport reconciliation");
    }
    expect(outcome.submission.decision.kind).toBe("transport_uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
  });

  it("reconciles an unknown malformed HTTP response without another POST", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      requestMethod(init) === "POST"
        ? new Response("private malformed body", { status: 200 })
        : jsonResponse({ tasks: [] })
    );

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, { pollAttempts: 0 })
    );

    if (outcome.kind !== "unresolved") {
      throw new Error("Expected unresolved malformed response reconciliation");
    }
    expect(outcome.submission.decision.kind).toBe("unknown_http_response");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
  });

  it("returns an immediate authoritative success after list and detail GETs", async () => {
    const task = createTask("succeeded");
    const detail = successResponse(task);
    const waitImplementation = vi.fn(
      async (_intervalMs: number, _signal?: AbortSignal) => undefined
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestMethod(init) === "POST") {
        return jsonResponse(
          { status: "in_progress", taskId: task.id, retryAfterMs: 2500 },
          202
        );
      }
      return String(input) === tasksEndpoint
        ? jsonResponse({ tasks: [task] })
        : jsonResponse(detail);
    });

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, { waitImplementation })
    );

    expect(outcome).toMatchObject({
      kind: "succeeded",
      source: "reconciliation",
      phase: "immediate",
      task,
      assets: detail.assets
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(waitImplementation).not.toHaveBeenCalled();
  });

  it("ignores malformed task list members while matching a valid candidate", async () => {
    const task = createTask("succeeded");
    const detail = successResponse(task);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestMethod(init) === "POST") {
        return jsonResponse(
          { status: "in_progress", taskId: task.id, retryAfterMs: 2500 },
          202
        );
      }
      return String(input) === tasksEndpoint
        ? jsonResponse({ tasks: [null, task] })
        : jsonResponse(detail);
    });

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch)
    );

    expect(outcome).toMatchObject({
      kind: "succeeded",
      source: "reconciliation",
      phase: "immediate",
      task
    });
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
  });

  it("ignores a task with malformed input and never sends a second POST", async () => {
    const malformedTask = { ...createTask("succeeded"), input: null };
    const waitImplementation = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      requestMethod(init) === "POST"
        ? jsonResponse(
            { status: "in_progress", taskId: "task-succeeded", retryAfterMs: 2500 },
            202
          )
        : jsonResponse({ tasks: [malformedTask] })
    );

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, {
        pollAttempts: 1,
        waitImplementation
      })
    );

    expect(outcome.kind).toBe("unresolved");
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "GET")).toHaveLength(2);
    expect(waitImplementation).toHaveBeenCalledTimes(1);
  });

  it("treats malformed task detail as best-effort and continues polling", async () => {
    const task = createTask("succeeded");
    let listCalls = 0;
    const waitImplementation = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestMethod(init) === "POST") {
        return jsonResponse(
          { status: "in_progress", taskId: task.id, retryAfterMs: 2500 },
          202
        );
      }
      if (String(input) === tasksEndpoint) {
        listCalls += 1;
        return jsonResponse({ tasks: listCalls === 1 ? [task] : [] });
      }
      return jsonResponse({ task: {}, assets: [] });
    });

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, {
        pollAttempts: 1,
        waitImplementation
      })
    );

    expect(outcome.kind).toBe("unresolved");
    expect(listCalls).toBe(2);
    expect(waitImplementation).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
  });

  it("does not terminalize an immediate failed match and lets polling observe failure", async () => {
    const failedTask = createTask("failed");
    let listCalls = 0;
    const waitImplementation = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (requestMethod(init) === "POST") {
        return jsonResponse(
          { status: "in_progress", taskId: failedTask.id, retryAfterMs: 2500 },
          202
        );
      }
      listCalls += 1;
      return jsonResponse({ tasks: [failedTask] });
    });

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, {
        pollAttempts: 1,
        waitImplementation
      })
    );

    expect(outcome).toMatchObject({
      kind: "failed",
      source: "reconciliation",
      task: failedTask
    });
    expect(listCalls).toBe(2);
    expect(waitImplementation).toHaveBeenCalledTimes(1);
  });

  it("returns a polling success with authoritative detail and assets", async () => {
    const runningTask = createTask("running");
    const succeededTask = createTask("succeeded");
    const detail = successResponse(succeededTask);
    let listCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestMethod(init) === "POST") {
        return jsonResponse(
          { status: "in_progress", taskId: runningTask.id, retryAfterMs: 2500 },
          202
        );
      }
      if (String(input) === tasksEndpoint) {
        listCalls += 1;
        return jsonResponse({ tasks: [listCalls === 1 ? runningTask : succeededTask] });
      }
      return jsonResponse(detail);
    });

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, {
        waitImplementation: async () => undefined
      })
    );

    expect(outcome).toMatchObject({
      kind: "succeeded",
      source: "reconciliation",
      phase: "polling",
      task: succeededTask,
      assets: detail.assets
    });
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
  });

  it("returns a neutral failed task observed during polling", async () => {
    const runningTask = createTask("running");
    const failedTask = createTask("failed");
    let listCalls = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (requestMethod(init) === "POST") {
        return jsonResponse(
          { status: "in_progress", taskId: runningTask.id, retryAfterMs: 2500 },
          202
        );
      }
      listCalls += 1;
      return jsonResponse({ tasks: [listCalls === 1 ? runningTask : failedTask] });
    });

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, {
        waitImplementation: async () => undefined
      })
    );

    expect(outcome).toMatchObject({
      kind: "failed",
      source: "reconciliation",
      task: failedTask
    });
  });

  it("uses exactly eight default 2500ms polling waits before unresolved", async () => {
    const waitImplementation = vi.fn(
      async (_intervalMs: number, _signal?: AbortSignal) => undefined
    );
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      requestMethod(init) === "POST"
        ? Promise.reject(new Error("Failed to fetch"))
        : jsonResponse({ tasks: [] })
    );

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, { waitImplementation })
    );

    expect(outcome.kind).toBe("unresolved");
    expect(waitImplementation).toHaveBeenCalledTimes(defaultImageGenerationPollAttempts);
    expect(waitImplementation.mock.calls.map(([interval]) => interval)).toEqual(
      Array.from(
        { length: defaultImageGenerationPollAttempts },
        () => defaultImageGenerationPollIntervalMs
      )
    );
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "GET")).toHaveLength(9);
  });

  it("prefers exact clientEntryId matching over prompt, model, and time fallback", () => {
    const exactTask = createTask("failed", {
      id: "task-exact",
      prompt: "Different prompt",
      modelId: "different-model",
      createdAt: "2026-08-24T01:00:00.000Z"
    });
    const fallbackTask = createTask("succeeded", {
      id: "task-fallback",
      input: { mode: "text-to-image", size: "1024x1024", count: 1 },
      createdAt: "2026-08-24T00:00:10.000Z"
    });

    expect(
      findImageTaskForPollingReconcile({
        tasks: [fallbackTask, exactTask],
        prompt: attempt.payload.prompt,
        modelId: attempt.payload.modelId,
        clientEntryId: attempt.payload.clientEntryId,
        requestStartedAt,
        now: requestStartedAt
      })?.id
    ).toBe("task-exact");
  });

  it("preserves fallback prompt, model, time window, resolvable status, and ordering", () => {
    const baseInput = { mode: "text-to-image", size: "1024x1024", count: 1 };
    const closestOlder = createTask("running", {
      id: "task-closest-older",
      input: baseInput,
      createdAt: "2026-08-24T00:00:09.000Z"
    });
    const equallyCloseNewer = createTask("failed", {
      id: "task-equally-close-newer",
      input: baseInput,
      createdAt: "2026-08-24T00:00:11.000Z"
    });
    const wrongPrompt = createTask("failed", {
      id: "task-wrong-prompt",
      input: baseInput,
      prompt: "Wrong prompt",
      createdAt: "2026-08-24T00:00:10.000Z"
    });
    const wrongModel = createTask("failed", {
      id: "task-wrong-model",
      input: baseInput,
      modelId: "wrong-model",
      createdAt: "2026-08-24T00:00:10.000Z"
    });
    const tooEarly = createTask("failed", {
      id: "task-too-early",
      input: baseInput,
      createdAt: "2026-08-24T00:00:04.999Z"
    });
    const tooLate = createTask("failed", {
      id: "task-too-late",
      input: baseInput,
      createdAt: "2026-08-24T00:01:10.001Z"
    });

    expect(
      findImageTaskForPollingReconcile({
        tasks: [
          wrongPrompt,
          wrongModel,
          tooEarly,
          tooLate,
          closestOlder,
          equallyCloseNewer
        ],
        prompt: attempt.payload.prompt,
        modelId: attempt.payload.modelId,
        requestStartedAt,
        now: requestStartedAt
      })?.id
    ).toBe("task-equally-close-newer");
  });

  it("returns aborted before submission with zero POST", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, { signal: controller.signal })
    );

    expect(outcome).toEqual({ kind: "aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns aborted when the POST is aborted and performs no reconciliation GET", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );

    const pending = submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, { signal: controller.signal })
    );
    await Promise.resolve();
    controller.abort();
    const outcome = await pending;

    expect(outcome.kind).toBe("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestMethod(fetchMock.mock.calls[0]?.[1])).toBe("POST");
  });

  it("stops polling immediately when the signal aborts during its wait", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      requestMethod(init) === "POST"
        ? jsonResponse(
            { status: "in_progress", taskId: "task-running", retryAfterMs: 2500 },
            202
          )
        : jsonResponse({ tasks: [createTask("running")] })
    );
    const waitImplementation = vi.fn(async () => {
      controller.abort();
    });

    const outcome = await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, {
        signal: controller.signal,
        waitImplementation
      })
    );

    expect(outcome.kind).toBe("aborted");
    expect(waitImplementation).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => requestMethod(call[1]) === "GET")).toHaveLength(1);
  });

  it("forwards onFetchStarted exactly once", async () => {
    const onFetchStarted = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse(successResponse()));

    await submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, { onFetchStarted })
    );

    expect(onFetchStarted).toHaveBeenCalledTimes(1);
  });

  it("notifies submission settlement before long reconciliation completes", async () => {
    let resolveTasks: (response: Response) => void = () => {
      throw new Error("Tasks response resolver unavailable");
    };
    const tasksPending = new Promise<Response>((resolve) => {
      resolveTasks = resolve;
    });
    const events: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (requestMethod(init) === "POST") {
        events.push("post");
        return jsonResponse(
          { status: "in_progress", taskId: "task-running", retryAfterMs: 2500 },
          202
        );
      }
      events.push("get");
      return tasksPending;
    });

    const pending = submitAndReconcileImageGeneration(
      lifecycleOptions(fetchMock as typeof fetch, {
        pollAttempts: 0,
        onFetchStarted: () => events.push("fetch-started"),
        onSubmissionSettled: () => events.push("submission-settled")
      })
    );
    await vi.waitFor(() => {
      expect(events).toContain("get");
    });

    expect(events).toEqual([
      "fetch-started",
      "post",
      "submission-settled",
      "get"
    ]);
    resolveTasks(jsonResponse({ tasks: [] }));
    await expect(pending).resolves.toMatchObject({ kind: "unresolved" });
  });
});
