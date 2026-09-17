import type {
  AdminOperationsBudget,
  AdminOperationsBudgetStatus,
  AdminOperationsCreditChangeStatus,
  AdminOperationsManualCompensation,
  AdminOperationsOverview,
  AdminOperationsTask,
  AdminOperationsTaskSafeErrorClass,
  AdminModelUsageStats,
  AdminOrderListResponse,
  AdminOrderSummary,
  AdminPaymentAttemptSummary,
  AdminOverview,
  AdminOverviewStats,
  AdminRecentFailureSummary,
  AdminGuestTrendPoint,
  AdminTrendPoint,
  AdminUserSummary,
  AiModelRouteSummary,
  AdminAiModelSummary,
  AiProviderAccountSummary,
  AiTaskStatus,
  AiTaskType,
  ModelCapability,
  ModelDisplaySurface,
  ModelProvider,
  OrderStatus,
  PlanSummary,
  ProviderAccountCapability,
  ProviderAccountType,
  SiteSettingSummary,
  UsageLogStatus,
  UsageLogSummary
} from "@ai-aggregate/shared";
import {
  adminOperationsBudgetScopes,
  normalizeModelImageInvokeMode,
  normalizeModelImageOutputParser,
  providerAccountTypes
} from "@ai-aggregate/shared";
import {
  normalizeModerationSettingsResponse,
  type AdminModerationSettings
} from "./admin-moderation";

const ADMIN_OPERATIONS_TASK_LIMIT = 50;
const ADMIN_OPERATIONS_COMPENSATION_LIMIT = 50;
const ADMIN_OPERATIONS_BUDGET_LIMIT = adminOperationsBudgetScopes.length;

export type AdminLoadAccessFailure = "unauthorized" | "forbidden";

export interface AdminLoadAccessGuard {
  begin: () => number;
  markAccessFailure: (
    generation: number,
    failure: AdminLoadAccessFailure
  ) => boolean;
  canCommit: (generation: number) => boolean;
  getAccessFailure: () => AdminLoadAccessFailure | null;
}

export function createAdminLoadAccessGuard(): AdminLoadAccessGuard {
  let generation = 0;
  let accessFailure: AdminLoadAccessFailure | null = null;

  return {
    begin() {
      generation += 1;
      accessFailure = null;
      return generation;
    },
    markAccessFailure(currentGeneration, failure) {
      if (currentGeneration !== generation) return false;
      if (failure === "unauthorized" || accessFailure === null) {
        accessFailure = failure;
      }
      return true;
    },
    canCommit(currentGeneration) {
      return currentGeneration === generation && accessFailure === null;
    },
    getAccessFailure() {
      return accessFailure;
    }
  };
}

export async function refreshAdminDataAfterProviderMutation(
  loadCoreAdminData: () => Promise<boolean>,
  loadModerationData: () => Promise<boolean>
): Promise<boolean> {
  const [coreRefresh, moderationRefresh] = await Promise.all([
    loadCoreAdminData().catch(() => false),
    loadModerationData().catch(() => false)
  ]);

  return coreRefresh && moderationRefresh;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function formatAdminNumber(value: unknown): string {
  const number = toFiniteNumber(value);
  return number.toLocaleString();
}

export function formatAdminDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

export function shouldReloadAdminOverviewAfterModelUpdate(): boolean {
  return true;
}

export function normalizeAdminModerationResponse(
  value: unknown
): AdminModerationSettings {
  return normalizeModerationSettingsResponse(value);
}

export function normalizeAdminOverviewResponse(value: unknown): AdminOverview {
  const overview = asRecord(value);
  const users = asArray<unknown>(overview.users).map(normalizeAdminUser);
  const models = asArray<unknown>(overview.models).map(normalizeAiModel);
  const usageLogs = asArray<unknown>(overview.usageLogs).map(normalizeUsageLog);
  const totals = asRecord(overview.totals);

  return {
    users,
    models,
    usageLogs,
    totals: {
      users: toFiniteNumber(totals.users, users.length),
      usageSuccess: toFiniteNumber(totals.usageSuccess),
      usageFailed: toFiniteNumber(totals.usageFailed)
    },
    stats: normalizeAdminOverviewStats(overview.stats),
    operations: normalizeAdminOperations(overview.operations)
  };
}

export function normalizeAdminOperations(
  value: unknown
): AdminOperationsOverview {
  const operations = asRecord(value);
  const recentTasks = asArray<unknown>(operations.recentTasks)
    .map(normalizeAdminOperationsTask)
    .filter((task): task is AdminOperationsTask => task !== null)
    .slice(0, ADMIN_OPERATIONS_TASK_LIMIT);
  const manualCompensations = asArray<unknown>(operations.manualCompensations)
    .map(normalizeAdminManualCompensation)
    .filter(
      (compensation): compensation is AdminOperationsManualCompensation =>
        compensation !== null
    )
    .slice(0, ADMIN_OPERATIONS_COMPENSATION_LIMIT);
  const seenBudgetScopes = new Set<string>();
  const budgets = asArray<unknown>(operations.budgets)
    .map(normalizeAdminOperationsBudget)
    .filter((budget): budget is AdminOperationsBudget => {
      if (budget === null || seenBudgetScopes.has(budget.scope)) {
        return false;
      }

      seenBudgetScopes.add(budget.scope);
      return true;
    })
    .slice(0, ADMIN_OPERATIONS_BUDGET_LIMIT);

  return {
    recentTasks,
    budgets,
    manualCompensations
  };
}

function normalizeAdminOperationsTask(
  value: unknown
): AdminOperationsTask | null {
  const task = asRecord(value);
  const taskId = toSafeIdentifier(task.taskId);
  const userId = toSafeIdentifier(task.userId);
  const type = toAiTaskType(task.type);
  const status = toAiTaskStatus(task.status);
  const createdAt = toSafeDateString(task.createdAt);
  const updatedAt = toSafeDateString(task.updatedAt);

  if (!taskId || !userId || !type || !status || !createdAt || !updatedAt) {
    return null;
  }

  return {
    taskId,
    userId,
    type,
    status,
    modelId: toNullableSafeIdentifier(task.modelId),
    modelLabel: toNullableSafeIdentifier(task.modelLabel),
    providerLabel: toNullableSafeIdentifier(task.providerLabel),
    routeId: toNullableSafeIdentifier(task.routeId),
    createdAt,
    updatedAt,
    safeErrorClass: toTaskSafeErrorClass(task.safeErrorClass),
    chargeStatus: toChargeStatus(task.chargeStatus),
    creditReleaseStatus: toCreditReleaseStatus(task.creditReleaseStatus),
    refundStatus: "UNKNOWN",
    costRecorded:
      typeof task.costRecorded === "boolean" ? task.costRecorded : false
  };
}

function normalizeAdminOperationsBudget(
  value: unknown
): AdminOperationsBudget | null {
  const budget = asRecord(value);
  const scope = toBudgetScope(budget.scope);

  if (!scope) {
    return null;
  }

  const status = toBudgetStatus(budget.status);
  if (status === "NOT_INITIALIZED" || status === null) {
    return emptyAdminOperationsBudget(scope);
  }

  const periodKey = toSafePeriodKey(budget.periodKey);
  const limit = toNonNegativeFiniteNumber(budget.limit);
  const used = toNonNegativeFiniteNumber(budget.used);
  const remaining = toFiniteNumberOrNull(budget.remaining);
  const updatedAt = toSafeDateString(budget.updatedAt);

  if (
    budget.periodType !== "DAILY" ||
    !periodKey ||
    limit === null ||
    used === null ||
    remaining === null ||
    !updatedAt
  ) {
    return emptyAdminOperationsBudget(scope);
  }

  return {
    scope,
    periodType: "DAILY",
    periodKey,
    limit,
    used,
    remaining: Math.max(0, remaining),
    status,
    updatedAt
  };
}

function normalizeAdminManualCompensation(
  value: unknown
): AdminOperationsManualCompensation | null {
  const compensation = asRecord(value);
  const auditId = toSafeIdentifier(compensation.auditId);
  const targetUserId = toSafeIdentifier(compensation.targetUserId);
  const createdAt = toSafeDateString(compensation.createdAt);

  if (
    !auditId ||
    !targetUserId ||
    !createdAt ||
    compensation.action !== "UPDATE_USER_QUOTA"
  ) {
    return null;
  }

  const rawStatus = toCreditChangeStatus(compensation.creditChangeStatus);
  const rawDelta = toFiniteNumberOrNull(compensation.creditDelta);
  const creditChangeStatus: AdminOperationsCreditChangeStatus =
    rawStatus === "RECORDED" && rawDelta !== null ? "RECORDED" : "UNKNOWN";

  return {
    auditId,
    targetUserId,
    action: "UPDATE_USER_QUOTA",
    createdAt,
    creditChangeStatus,
    creditDelta: creditChangeStatus === "RECORDED" ? rawDelta : null
  };
}

function emptyAdminOperationsBudget(
  scope: AdminOperationsBudget["scope"]
): AdminOperationsBudget {
  return {
    scope,
    periodType: null,
    periodKey: null,
    limit: null,
    used: null,
    remaining: null,
    status: "NOT_INITIALIZED",
    updatedAt: null
  };
}

function toAiTaskType(value: unknown): AiTaskType | null {
  return value === "image" || value === "video" || value === "ppt" || value === "document"
    ? value
    : null;
}

function toAiTaskStatus(value: unknown): AiTaskStatus | null {
  return value === "pending" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : null;
}

function toTaskSafeErrorClass(value: unknown): AdminOperationsTaskSafeErrorClass {
  return value === "TASK_FAILED" ||
    value === "CHARGED_AND_FAILED" ||
    value === "SAFE_PROVIDER_ERROR" ||
    value === "INTERNAL_ERROR" ||
    value === "BUDGET_NEAR_LIMIT" ||
    value === "BUDGET_EXHAUSTED"
    ? value
    : "UNKNOWN";
}

function toChargeStatus(value: unknown): AdminOperationsTask["chargeStatus"] {
  return value === "RESERVED" || value === "SETTLED" || value === "RELEASED"
    ? value
    : "UNKNOWN";
}

function toCreditReleaseStatus(
  value: unknown
): AdminOperationsTask["creditReleaseStatus"] {
  return value === "NOT_RELEASED" || value === "RELEASED"
    ? value
    : "UNKNOWN";
}

function toCreditChangeStatus(
  value: unknown
): AdminOperationsCreditChangeStatus {
  return value === "RECORDED" ? "RECORDED" : "UNKNOWN";
}

function toBudgetScope(value: unknown): AdminOperationsBudget["scope"] | null {
  return adminOperationsBudgetScopes.includes(
    value as AdminOperationsBudget["scope"]
  )
    ? value as AdminOperationsBudget["scope"]
    : null;
}

function toBudgetStatus(value: unknown): AdminOperationsBudgetStatus | null {
  return value === "NORMAL" || value === "NEAR_LIMIT" || value === "EXHAUSTED"
    ? value
    : value === "NOT_INITIALIZED"
    ? value
    : null;
}

function toSafeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const identifier = value.trim();
  const lowerIdentifier = identifier.toLowerCase();
  if (
    identifier.length === 0 ||
    lowerIdentifier.includes("://") ||
    lowerIdentifier.startsWith("data:") ||
    lowerIdentifier.startsWith("javascript:")
  ) {
    return null;
  }

  return identifier;
}

function toNullableSafeIdentifier(value: unknown): string | null {
  return value === null || value === undefined ? null : toSafeIdentifier(value);
}

function toSafeDateString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toSafePeriodKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)
    ? value
    : null;
}

function toFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNonNegativeFiniteNumber(value: unknown): number | null {
  const number = toFiniteNumberOrNull(value);
  return number !== null && number >= 0 ? number : null;
}

export function normalizeAdminListResponse<T>(
  value: unknown,
  key: string,
  normalizeItem: (item: unknown) => T
): T[] {
  return asArray<unknown>(asRecord(value)[key]).map(normalizeItem);
}

export function normalizePlanSummary(value: unknown): PlanSummary {
  const plan = asRecord(value);

  return {
    id: toStringValue(plan.id),
    name: toStringValue(plan.name),
    price: toFiniteNumber(plan.price),
    credits: toFiniteNumber(plan.credits),
    description: toStringValue(plan.description),
    features: asArray<unknown>(plan.features).map(toStringValue),
    enabled: toBooleanValue(plan.enabled, true),
    sortOrder: toFiniteNumber(plan.sortOrder),
    createdAt: toStringValue(plan.createdAt),
    updatedAt: toStringValue(plan.updatedAt)
  };
}

export function normalizeAdminOrderSummary(value: unknown): AdminOrderSummary {
  const order = asRecord(value);

  return {
    id: toStringValue(order.id),
    userId: toStringValue(order.userId),
    planId: toStringValue(order.planId),
    planName: toStringValue(order.planName),
    amount: toFiniteNumber(order.amount),
    credits: toFiniteNumber(order.credits),
    status: toOrderStatus(order.status),
    paymentProvider: typeof order.paymentProvider === "string" ? order.paymentProvider : null,
    paymentType: typeof order.paymentType === "string" ? order.paymentType : null,
    paymentTradeNo: typeof order.paymentTradeNo === "string" ? order.paymentTradeNo : null,
    providerTradeNo: typeof order.providerTradeNo === "string" ? order.providerTradeNo : null,
    paidAt: typeof order.paidAt === "string" ? order.paidAt : null,
    createdAt: toStringValue(order.createdAt),
    updatedAt: toStringValue(order.updatedAt),
    userEmail: toStringValue(order.userEmail),
    reviewAttempts: asArray<unknown>(order.reviewAttempts)
      .map(normalizeAdminPaymentAttemptSummary)
      .filter(
        (attempt): attempt is AdminPaymentAttemptSummary => attempt !== null
      )
  };
}

export function normalizeAdminOrderListResponse(
  value: unknown
): AdminOrderListResponse {
  const response = asRecord(value);

  return {
    orders: asArray<unknown>(response.orders).map(normalizeAdminOrderSummary),
    reviewOrderCount: Math.max(
      0,
      Math.trunc(toFiniteNumber(response.reviewOrderCount))
    )
  };
}

export function normalizeAdminPaymentAttemptSummary(
  value: unknown
): AdminPaymentAttemptSummary | null {
  const attempt = asRecord(value);
  const ordinal = toFiniteNumber(attempt.ordinal);

  if (
    attempt.status !== "PAID_REQUIRES_REVIEW" ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1
  ) {
    return null;
  }

  return {
    id: toStringValue(attempt.id),
    orderId: toStringValue(attempt.orderId),
    ordinal,
    status: "PAID_REQUIRES_REVIEW",
    provider: toStringValue(attempt.provider),
    paymentType: toStringValue(attempt.paymentType),
    merchantTradeNo: toStringValue(attempt.merchantTradeNo),
    providerTradeNo:
      typeof attempt.providerTradeNo === "string"
        ? attempt.providerTradeNo
        : null,
    paidAt: typeof attempt.paidAt === "string" ? attempt.paidAt : null,
    createdAt: toStringValue(attempt.createdAt)
  };
}

export function normalizeSiteSettingSummary(value: unknown): SiteSettingSummary {
  const setting = asRecord(value);

  return {
    key: toStringValue(setting.key),
    value: toStringValue(setting.value),
    type:
      setting.type === "boolean" ||
      setting.type === "number" ||
      setting.type === "json"
        ? setting.type
        : "string",
    description:
      typeof setting.description === "string" ? setting.description : null,
    updatedAt: toStringValue(setting.updatedAt)
  };
}

export function normalizeAiModel(value: unknown): AdminAiModelSummary {
  const model = asRecord(value);

  return {
    id: toStringValue(model.id),
    name: toStringValue(model.name),
    displayName:
      typeof model.displayName === "string" ? model.displayName : undefined,
    slug: toStringValue(model.slug),
    provider: toModelProvider(model.provider),
    providerAccountId:
      typeof model.providerAccountId === "string" ? model.providerAccountId : null,
    capability: toModelCapability(model.capability),
    modelId: toStringValue(model.modelId),
    group: toStringValue(model.group),
    tags: asArray<unknown>(model.tags).map(toStringValue),
    shortDescription:
      typeof model.shortDescription === "string"
        ? model.shortDescription
        : undefined,
    enabled: toBooleanValue(model.enabled, true),
    creditCost: toFiniteNumber(model.creditCost, 1),
    allowGuest: toBooleanValue(model.allowGuest, false),
    sortOrder: toFiniteNumber(model.sortOrder),
    isRecommended: toBooleanValue(model.isRecommended, false),
    displaySurfaces: Array.isArray(model.displaySurfaces)
      ? asArray<ModelDisplaySurface>(model.displaySurfaces)
      : undefined,
    imageInvokeMode: normalizeModelImageInvokeMode(model.imageInvokeMode),
    imageOutputParser: normalizeModelImageOutputParser(model.imageOutputParser),
    maxReferenceImages: normalizeMaxReferenceImages(model.maxReferenceImages),
    iconUrl: typeof model.iconUrl === "string" ? model.iconUrl : undefined,
    iconText: typeof model.iconText === "string" ? model.iconText : undefined,
    iconColor:
      typeof model.iconColor === "string" ? model.iconColor : undefined,
    description:
      typeof model.description === "string" ? model.description : undefined,
    routes: asArray<unknown>(model.routes).map(normalizeModelRoute)
  };
}

export function normalizeModelRoute(value: unknown): AiModelRouteSummary {
  const route = asRecord(value);

  return {
    id: toStringValue(route.id),
    modelId: toStringValue(route.modelId),
    providerId: toStringValue(route.providerId),
    providerName:
      typeof route.providerName === "string" ? route.providerName : undefined,
    upstreamModel: toStringValue(route.upstreamModel),
    priority: toFiniteNumber(route.priority),
    enabled: toBooleanValue(route.enabled, true),
    createdAt: toStringValue(route.createdAt),
    updatedAt: toStringValue(route.updatedAt)
  };
}

export function normalizeProviderAccount(
  value: unknown
): AiProviderAccountSummary {
  const account = asRecord(value);

  return {
    id: toStringValue(account.id),
    name: toStringValue(account.name),
    providerType: toProviderAccountType(account.providerType),
    baseUrl: toStringValue(account.baseUrl),
    capabilities: asArray<unknown>(account.capabilities).map(
      toProviderAccountCapability
    ),
    enabled: toBooleanValue(account.enabled, true),
    priority: toFiniteNumber(account.priority),
    timeoutMs: toFiniteNumber(account.timeoutMs),
    configJson: toNullableRecord(account.configJson),
    notes: typeof account.notes === "string" ? account.notes : null,
    hasApiKey: toBooleanValue(account.hasApiKey, false),
    hasCustomHeaders: toBooleanValue(account.hasCustomHeaders, false),
    createdAt: toStringValue(account.createdAt),
    updatedAt: toStringValue(account.updatedAt)
  };
}

export function normalizeAdminOverviewStats(value: unknown): AdminOverviewStats {
  const stats = asRecord(value);
  const users = asRecord(stats.users);
  const guests = asRecord(stats.guests);
  const usage = asRecord(stats.usage);
  const orders = asRecord(stats.orders);
  const quota = asRecord(stats.quota);

  return {
    users: {
      total: toFiniteNumber(users.total),
      todayNew: toFiniteNumber(users.todayNew),
      todayActive: toFiniteNumber(users.todayActive),
      admins: toFiniteNumber(users.admins),
      regularUsers: toFiniteNumber(users.regularUsers)
    },
    guests: {
      todayCalls: toFiniteNumber(guests.todayCalls),
      todayLimitExceeded: toFiniteNumber(guests.todayLimitExceeded)
    },
    usage: {
      todayCalls: toFiniteNumber(usage.todayCalls),
      todaySuccess: toFiniteNumber(usage.todaySuccess),
      todayFailed: toFiniteNumber(usage.todayFailed),
      todayCreditsUsed: toFiniteNumber(usage.todayCreditsUsed),
      successRate: toRateValue(usage.successRate)
    },
    orders: {
      total: toFiniteNumber(orders.total),
      pending: toFiniteNumber(orders.pending),
      paid: toFiniteNumber(orders.paid),
      cancelled: toFiniteNumber(orders.cancelled),
      todayNew: toFiniteNumber(orders.todayNew),
      todayConfirmed: toFiniteNumber(orders.todayConfirmed),
      todayPaid: toFiniteNumber(orders.todayPaid),
      todayRevenueCents: toFiniteNumber(orders.todayRevenueCents)
    },
    quota: {
      remainingCreditsTotal: toFiniteNumber(quota.remainingCreditsTotal),
      todayGrantedCredits: toFiniteNumber(quota.todayGrantedCredits),
      todayUsedCredits: toFiniteNumber(quota.todayUsedCredits)
    },
    last7Days: asArray<unknown>(stats.last7Days).map(normalizeTrendPoint),
    guestLast7Days: asArray<unknown>(stats.guestLast7Days).map(
      normalizeGuestTrendPoint
    ),
    modelTopByCalls: asArray<unknown>(stats.modelTopByCalls).map(
      normalizeModelUsageStats
    ),
    modelTopByCredits: asArray<unknown>(stats.modelTopByCredits).map(
      normalizeModelUsageStats
    ),
    modelTopByFailures: asArray<unknown>(stats.modelTopByFailures).map(
      normalizeModelUsageStats
    ),
    models: asArray<unknown>(stats.models).map(normalizeModelUsageStats),
    modelUsageLast7Days: asArray<unknown>(stats.modelUsageLast7Days).map(
      normalizeModelUsageStats
    ),
    recentFailures: asArray<unknown>(stats.recentFailures).map(
      normalizeRecentFailure
    ),
    recentOrders: asArray<unknown>(stats.recentOrders).map(
      normalizeAdminOrderSummary
    )
  };
}

export function normalizeAdminUser(value: unknown): AdminUserSummary {
  const user = asRecord(value);

  return {
    id: toStringValue(user.id),
    email: toStringValue(user.email),
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    remainingCredits: toFiniteNumber(user.remainingCredits),
    createdAt: toStringValue(user.createdAt),
    updatedAt: toStringValue(user.updatedAt)
  };
}

export function normalizeUsageLog(value: unknown): UsageLogSummary {
  const log = asRecord(value);

  return {
    id: toStringValue(log.id),
    userId: typeof log.userId === "string" ? log.userId : null,
    userEmail: typeof log.userEmail === "string" ? log.userEmail : null,
    sessionId: typeof log.sessionId === "string" ? log.sessionId : null,
    model: toStringValue(log.model),
    modelDisplayName:
      typeof log.modelDisplayName === "string"
        ? log.modelDisplayName
        : undefined,
    status: toUsageLogStatus(log.status),
    costCredits: toFiniteNumber(log.costCredits),
    errorMessage: null,
    createdAt: toStringValue(log.createdAt)
  };
}

function normalizeTrendPoint(value: unknown): AdminTrendPoint {
  const point = asRecord(value);

  return {
    date: toStringValue(point.date),
    calls: toFiniteNumber(point.calls),
    success: toFiniteNumber(point.success),
    failed: toFiniteNumber(point.failed),
    creditsUsed: toFiniteNumber(point.creditsUsed),
    guestCalls: toFiniteNumber(point.guestCalls)
  };
}

function normalizeGuestTrendPoint(value: unknown): AdminGuestTrendPoint {
  const point = asRecord(value);

  return {
    date: toStringValue(point.date),
    calls: toFiniteNumber(point.calls)
  };
}

function normalizeModelUsageStats(value: unknown): AdminModelUsageStats {
  const stats = asRecord(value);

  return {
    model: toStringValue(stats.model),
    displayName:
      typeof stats.displayName === "string" ? stats.displayName : undefined,
    calls: toFiniteNumber(stats.calls),
    success: toFiniteNumber(stats.success),
    failed: toFiniteNumber(stats.failed),
    creditsUsed: toFiniteNumber(stats.creditsUsed)
  };
}

function normalizeRecentFailure(value: unknown): AdminRecentFailureSummary {
  const failure = asRecord(value);

  return {
    id: toStringValue(failure.id),
    createdAt: toStringValue(failure.createdAt),
    userEmail: typeof failure.userEmail === "string" ? failure.userEmail : null,
    model: toStringValue(failure.model),
    modelDisplayName:
      typeof failure.modelDisplayName === "string"
        ? failure.modelDisplayName
        : undefined,
    errorSummary: toStringValue(failure.errorSummary)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function toNullableRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeMaxReferenceImages(value: unknown): number {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(number) && number >= 0 && number <= 4 ? number : 1;
}

function toRateValue(value: unknown): number {
  const number = toFiniteNumber(value);
  return Math.min(Math.max(number, 0), 1);
}

function toBooleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toOrderStatus(value: unknown): OrderStatus {
  return value === "PAID" || value === "CANCELLED" ? value : "PENDING";
}

function toUsageLogStatus(value: unknown): UsageLogStatus {
  return value === "SUCCESS" ? "SUCCESS" : "FAILED";
}

function toModelCapability(value: unknown): ModelCapability {
  return value === "image" || value === "video" || value === "ppt"
    ? value
    : "chat";
}

function toModelProvider(value: unknown): ModelProvider {
  if (value === "OPENAI_COMPATIBLE" || value === "NEW_API") {
    return value;
  }

  return "SUB2API";
}

function toProviderAccountType(value: unknown): ProviderAccountType {
  if (providerAccountTypes.some((providerType) => providerType === value)) {
    return value as ProviderAccountType;
  }

  throw new Error("unsupported provider account type");
}

function toProviderAccountCapability(value: unknown): ProviderAccountCapability {
  if (value === "image" || value === "video" || value === "ppt") {
    return value;
  }

  return "chat";
}
