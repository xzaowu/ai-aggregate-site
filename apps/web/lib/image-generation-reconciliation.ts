import type {
  AiAssetSummary,
  AiTaskDetailResponse,
  AiTaskSummary,
  ImageGenerationResponse
} from "@ai-aggregate/shared";
import type {
  GenericImageGenerationRequestPayload,
  ImageGenerationAttempt
} from "./image-generation-attempt";
import {
  sendImageGenerationAttempt,
  type ImageGenerationRequestResult
} from "./image-generation-request";

export const defaultImageGenerationPollAttempts = 8;
export const defaultImageGenerationPollIntervalMs = 2500;

export type ImageGenerationReconciliationMatchOptions = Readonly<{
  tasks: AiTaskSummary[];
  prompt: string;
  modelId: string;
  clientEntryId?: string | null;
  requestStartedAt: Date;
  now?: Date;
}>;

export type ImageGenerationLifecycleOutcome =
  | Readonly<{
      kind: "succeeded";
      source: "submission";
      submission: ImageGenerationRequestResult;
      task: AiTaskSummary;
      assets: AiAssetSummary[];
    }>
  | Readonly<{
      kind: "succeeded";
      source: "reconciliation";
      phase: "immediate" | "polling";
      submission: ImageGenerationRequestResult;
      task: AiTaskSummary;
      assets: AiAssetSummary[];
    }>
  | Readonly<{
      kind: "failed";
      source: "submission";
      submission: ImageGenerationRequestResult;
    }>
  | Readonly<{
      kind: "failed";
      source: "reconciliation";
      submission: ImageGenerationRequestResult;
      task: AiTaskSummary;
    }>
  | Readonly<{
      kind: "unresolved";
      submission: ImageGenerationRequestResult;
    }>
  | Readonly<{
      kind: "aborted";
      submission?: ImageGenerationRequestResult;
    }>;

export type ImageGenerationPollWait = (
  intervalMs: number,
  signal?: AbortSignal
) => Promise<void>;

export type SubmitAndReconcileImageGenerationOptions = Readonly<{
  attempt: ImageGenerationAttempt<GenericImageGenerationRequestPayload>;
  token: string;
  submissionEndpoint: string;
  tasksEndpoint: string;
  taskDetailEndpoint: (taskId: string) => string;
  fetchImplementation: typeof fetch;
  requestStartedAt: Date;
  signal?: AbortSignal;
  pollAttempts?: number;
  pollIntervalMs?: number;
  waitImplementation?: ImageGenerationPollWait;
  onFetchStarted?: () => void;
  onSubmissionSettled?: () => void;
  onPollingStarted?: () => void;
}>;

function readCappedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAiTaskSummary(value: unknown): value is AiTaskSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    (value.type === "image" ||
      value.type === "video" ||
      value.type === "ppt" ||
      value.type === "document") &&
    (value.status === "pending" ||
      value.status === "running" ||
      value.status === "succeeded" ||
      value.status === "failed" ||
      value.status === "cancelled") &&
    isNullableString(value.modelId) &&
    typeof value.prompt === "string" &&
    isRecord(value.input) &&
    (value.output === null || isRecord(value.output)) &&
    typeof value.costCredits === "number" &&
    isNullableString(value.errorMessage) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isNullableString(value.completedAt)
  );
}

function isAiAssetSummary(value: unknown): value is AiAssetSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    isNullableString(value.taskId) &&
    (value.type === "image" ||
      value.type === "video" ||
      value.type === "document") &&
    typeof value.url === "string" &&
    isNullableString(value.thumbnailUrl) &&
    isNullableString(value.title) &&
    (value.metadata === null || isRecord(value.metadata)) &&
    typeof value.createdAt === "string" &&
    (value.taskPrompt === undefined || isNullableString(value.taskPrompt))
  );
}

function readTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasResolvableImageOutput(task: AiTaskSummary): boolean {
  const output = task.output;
  if (!output) {
    return false;
  }

  return (
    (Array.isArray(output.images) &&
      output.images.some(
        (image) => typeof image === "string" && image.length > 0
      )) ||
    (typeof output.imageUrl === "string" && output.imageUrl.trim().length > 0)
  );
}

function isResolvableImageTaskStatus(task: AiTaskSummary): boolean {
  if (task.status === "succeeded") {
    return hasResolvableImageOutput(task);
  }

  return (
    task.status === "failed" ||
    task.status === "pending" ||
    task.status === "running"
  );
}

export function findImageTaskForPollingReconcile({
  tasks,
  prompt,
  modelId,
  clientEntryId,
  requestStartedAt,
  now = new Date()
}: ImageGenerationReconciliationMatchOptions): AiTaskSummary | null {
  const normalizedClientEntryId = readCappedString(clientEntryId, 128);

  if (normalizedClientEntryId) {
    const clientEntryMatches = tasks.filter(
      (task) =>
        task.type === "image" &&
        readCappedString(task.input.clientEntryId, 128) ===
          normalizedClientEntryId
    );

    if (clientEntryMatches.length > 0) {
      const latestMatch = clientEntryMatches.sort((left, right) => {
        const leftCreatedAt = readTimestamp(left.createdAt) ?? 0;
        const rightCreatedAt = readTimestamp(right.createdAt) ?? 0;
        return rightCreatedAt - leftCreatedAt;
      })[0] ?? null;

      return latestMatch && isResolvableImageTaskStatus(latestMatch)
        ? latestMatch
        : null;
    }
  }

  const windowStart = requestStartedAt.getTime() - 5000;
  const windowEnd = now.getTime() + 60000;
  const matches = tasks.filter((task) => {
    if (task.type !== "image" || task.prompt !== prompt) {
      return false;
    }

    if (task.modelId && task.modelId !== modelId) {
      return false;
    }

    const createdAt = readTimestamp(task.createdAt);
    if (createdAt === null || createdAt < windowStart || createdAt > windowEnd) {
      return false;
    }

    return isResolvableImageTaskStatus(task);
  });

  return matches.sort((left, right) => {
    const leftCreatedAt = readTimestamp(left.createdAt) ?? 0;
    const rightCreatedAt = readTimestamp(right.createdAt) ?? 0;
    const distanceDelta =
      Math.abs(leftCreatedAt - requestStartedAt.getTime()) -
      Math.abs(rightCreatedAt - requestStartedAt.getTime());

    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    return rightCreatedAt - leftCreatedAt;
  })[0] ?? null;
}

export function findImageTaskForFailedFetchReconcile(
  options: ImageGenerationReconciliationMatchOptions
): AiTaskSummary | null {
  const matchedTask = findImageTaskForPollingReconcile(options);
  return matchedTask?.status === "succeeded" ? matchedTask : null;
}

async function defaultWait(intervalMs: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      signal?.removeEventListener("abort", finish);
      resolve();
    };

    timeoutId = setTimeout(finish, intervalMs);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) {
      finish();
    }
  });
}

async function fetchImageTasksForReconcile({
  endpoint,
  token,
  fetchImplementation,
  signal
}: {
  endpoint: string;
  token: string;
  fetchImplementation: typeof fetch;
  signal?: AbortSignal;
}): Promise<AiTaskSummary[]> {
  if (signal?.aborted) {
    return [];
  }

  try {
    const response = await fetchImplementation(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      ...(signal ? { signal } : {})
    });
    if (signal?.aborted || !response.ok) {
      return [];
    }

    const data = (await response.json()) as unknown;
    return isRecord(data) && Array.isArray(data.tasks)
      ? data.tasks.filter(isAiTaskSummary)
      : [];
  } catch {
    return [];
  }
}

async function fetchImageTaskDetail({
  endpoint,
  token,
  fetchImplementation,
  signal
}: {
  endpoint: string;
  token: string;
  fetchImplementation: typeof fetch;
  signal?: AbortSignal;
}): Promise<AiTaskDetailResponse | null> {
  if (signal?.aborted) {
    return null;
  }

  try {
    const response = await fetchImplementation(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      ...(signal ? { signal } : {})
    });
    if (signal?.aborted || !response.ok) {
      return null;
    }

    const data = (await response.json()) as unknown;
    return isRecord(data) &&
      isAiTaskSummary(data.task) &&
      Array.isArray(data.assets)
      ? { task: data.task, assets: data.assets.filter(isAiAssetSummary) }
      : null;
  } catch {
    return null;
  }
}

export async function submitAndReconcileImageGeneration({
  attempt,
  token,
  submissionEndpoint,
  tasksEndpoint,
  taskDetailEndpoint,
  fetchImplementation,
  requestStartedAt,
  signal,
  pollAttempts = defaultImageGenerationPollAttempts,
  pollIntervalMs = defaultImageGenerationPollIntervalMs,
  waitImplementation = defaultWait,
  onFetchStarted,
  onSubmissionSettled,
  onPollingStarted
}: SubmitAndReconcileImageGenerationOptions): Promise<ImageGenerationLifecycleOutcome> {
  if (signal?.aborted) {
    return { kind: "aborted" };
  }

  let submission: ImageGenerationRequestResult;
  try {
    submission = await sendImageGenerationAttempt({
      attempt,
      token,
      endpoint: submissionEndpoint,
      fetchImplementation,
      ...(signal ? { signal } : {}),
      ...(onFetchStarted ? { onFetchStarted } : {})
    });
  } finally {
    onSubmissionSettled?.();
  }

  if (signal?.aborted) {
    return { kind: "aborted", submission };
  }

  if (submission.decision.kind === "success") {
    const response = submission.body as ImageGenerationResponse;
    return {
      kind: "succeeded",
      source: "submission",
      submission,
      task: response.task,
      assets: response.assets
    };
  }

  if (submission.decision.terminal) {
    return { kind: "failed", source: "submission", submission };
  }

  if (
    submission.decision.kind !== "in_progress" &&
    submission.decision.kind !== "transport_uncertain" &&
    submission.decision.kind !== "unknown_http_response"
  ) {
    return { kind: "unresolved", submission };
  }

  if (signal?.aborted) {
    return { kind: "aborted", submission };
  }

  const immediateTasks = await fetchImageTasksForReconcile({
    endpoint: tasksEndpoint,
    token,
    fetchImplementation,
    ...(signal ? { signal } : {})
  });
  if (signal?.aborted) {
    return { kind: "aborted", submission };
  }

  const immediateMatch = findImageTaskForFailedFetchReconcile({
    tasks: immediateTasks,
    prompt: attempt.payload.prompt,
    modelId: attempt.payload.modelId,
    clientEntryId: attempt.payload.clientEntryId,
    requestStartedAt
  });
  if (immediateMatch) {
    const detail = await fetchImageTaskDetail({
      endpoint: taskDetailEndpoint(immediateMatch.id),
      token,
      fetchImplementation,
      ...(signal ? { signal } : {})
    });
    if (signal?.aborted) {
      return { kind: "aborted", submission };
    }
    if (detail) {
      return {
        kind: "succeeded",
        source: "reconciliation",
        phase: "immediate",
        submission,
        task: detail.task,
        assets: detail.assets
      };
    }
  }

  onPollingStarted?.();

  for (let pollAttempt = 0; pollAttempt < pollAttempts; pollAttempt += 1) {
    if (signal?.aborted) {
      return { kind: "aborted", submission };
    }

    await waitImplementation(pollIntervalMs, signal);
    if (signal?.aborted) {
      return { kind: "aborted", submission };
    }

    const tasks = await fetchImageTasksForReconcile({
      endpoint: tasksEndpoint,
      token,
      fetchImplementation,
      ...(signal ? { signal } : {})
    });
    if (signal?.aborted) {
      return { kind: "aborted", submission };
    }

    const matchedTask = findImageTaskForPollingReconcile({
      tasks,
      prompt: attempt.payload.prompt,
      modelId: attempt.payload.modelId,
      clientEntryId: attempt.payload.clientEntryId,
      requestStartedAt
    });
    if (!matchedTask) {
      continue;
    }

    if (matchedTask.status === "failed") {
      return {
        kind: "failed",
        source: "reconciliation",
        submission,
        task: matchedTask
      };
    }

    if (matchedTask.status !== "succeeded") {
      continue;
    }

    const detail = await fetchImageTaskDetail({
      endpoint: taskDetailEndpoint(matchedTask.id),
      token,
      fetchImplementation,
      ...(signal ? { signal } : {})
    });
    if (signal?.aborted) {
      return { kind: "aborted", submission };
    }
    if (detail) {
      return {
        kind: "succeeded",
        source: "reconciliation",
        phase: "polling",
        submission,
        task: detail.task,
        assets: detail.assets
      };
    }
  }

  return signal?.aborted
    ? { kind: "aborted", submission }
    : { kind: "unresolved", submission };
}
