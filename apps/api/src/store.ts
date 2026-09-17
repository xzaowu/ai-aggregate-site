import {
  CreditReservationKind,
  CreditReservationStatus,
  IdempotencyOwnerType,
  IdempotencyRequestStatus,
  Prisma,
  PrismaClient,
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider,
  UserTokenKind,
  UsageLogAttemptStatus,
  type AccountCreditEvent,
  type CreditReservation,
  type IdempotencyRequest,
  type StorageObject
} from "@prisma/client";
import type {
  PaymentAttempt as PrismaPaymentAttempt,
  PaymentAttemptStatus
} from "@prisma/client";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  modelCapabilities,
  normalizeModelImageInvokeMode,
  normalizeModelImageOutputParser,
  normalizeModelDisplaySurfaces,
  normalizeProviderHeaders,
  isModelDisplaySurfaceCompatible,
  providerAccountCapabilities,
  providerAccountTypes
} from "@ai-aggregate/shared";
import type {
  AdminAuditLogEntry,
  AdminOrderSummary,
  AdminPaymentAttemptSummary,
  AdminOperationsChargeStatus,
  AdminOperationsCreditReleaseStatus,
  AdminOperationsManualCompensation,
  AdminOperationsRefundStatus,
  AdminOperationsTask,
  AdminOverviewStats,
  AdminAiModelSummary,
  AiAssetDetailResponse,
  AiAssetSummary,
  AiAssetType,
  AiModelRouteInput,
  AiModelRouteSummary,
  AdminUserSummary,
  AiProviderAccountInput,
  AiProviderAccountSummary,
  AiTaskDetailResponse,
  AiTaskStatus,
  AiTaskSummary,
  AiTaskType,
  ChatMessageRecord,
  ChatRole,
  ChatSessionSummary,
  FeedbackEntry,
  FeedbackStatus,
  LinkEntry,
  ModelCapability,
  ModelDisplaySurface,
  ModelImageInvokeMode,
  ModelImageOutputParser,
  ModelProvider,
  OrderStatus,
  OrderSummary,
  AccountActivityPage,
  AccountActivitySummary,
  AccountBenefitSettings,
  AccountOverview,
  AdminStorageSubscriptionPage,
  AdminStorageSubscriptionSummary,
  CheckInSummary,
  CreatorCanvasDocumentDetail,
  CreatorCanvasDocumentSummary,
  ReferralSummary,
  PlanSummary,
  ProviderAccountCapability,
  ProviderAccountType,
  SiteSettingSummary,
  SiteSettingValueType,
  UsageLogStatus,
  UsageLogSummary,
  UserRole
} from "@ai-aggregate/shared";
import {
  getIdempotencyClaimExpiresAt,
  getIdempotencyTerminalExpiresAt,
  hashUserIdempotencyOwner
} from "./idempotency";
import {
  INITIAL_PAYMENT_ATTEMPT_ORDINAL,
  createProviderTradeIdentityHash,
  validateInitialPaymentAttemptIdentity,
  validatePaymentAttemptCallbackIdentity,
  validatePaymentAttemptMerchantTradeNo,
  validatePaymentAttemptOrderId,
  validatePaymentAttemptOrdinal,
  validatePaymentAttemptStoredIdentity
} from "./payments/payment-attempt";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: string | null;
  sessionVersion: number;
  lastLoginAt: string | null;
  name?: string;
  avatarUrl?: string;
  avatarStorageObjectId?: string | null;
  role: UserRole;
  credits: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  emailVerifiedAt?: Date;
  lastLoginAt?: Date;
}

export interface RegisterUnverifiedUserAndIssueEmailVerificationTokenInput {
  email: string;
  passwordHash: string;
  tokenHash: string;
  expiresAt: Date;
}

export type RegisterUnverifiedUserAndIssueEmailVerificationTokenResult =
  | {
      status: "CREATED";
      userId: string;
      email: string;
    }
  | {
      status: "EXISTING_UNVERIFIED";
    }
  | {
      status: "ALREADY_VERIFIED";
    };

export interface RotateEmailVerificationTokenForEmailInput {
  email: string;
  tokenHash: string;
  expiresAt: Date;
}

export type RotateEmailVerificationTokenForEmailResult =
  | {
      status: "ISSUED";
      userId: string;
      email: string;
    }
  | {
      status: "NO_ACTION";
    };

export interface ConsumeEmailVerificationTokenInput {
  tokenHash: string;
  now: Date;
}

export type ConsumeEmailVerificationTokenResult =
  | {
      status: "VERIFIED";
      userId: string;
      sessionVersion: number;
    }
  | {
      status: "ALREADY_VERIFIED";
    }
  | {
      status: "INVALID_OR_EXPIRED";
    };

export interface RotatePasswordResetTokenForEmailInput {
  email: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
}

export type RotatePasswordResetTokenForEmailResult =
  | {
      status: "ISSUED";
      userId: string;
      email: string;
    }
  | {
      status: "NO_ACTION";
    };

export interface ConsumePasswordResetTokenInput {
  tokenHash: string;
  passwordHash: string;
  now: Date;
}

export type ConsumePasswordResetTokenResult =
  | {
      status: "RESET";
      userId: string;
      sessionVersion: number;
    }
  | {
      status: "INVALID_OR_EXPIRED";
    };

export const DEFAULT_BASE_PLAN_NAME = "Free";

export interface QuotaRecord {
  userId: string;
  remainingCredits: number;
}

export interface AdminFinancialActor {
  adminUserId: string;
  adminEmail: string;
}

export interface InitializedPaymentOrderSummary extends OrderSummary {
  paymentProvider: string;
  paymentType: string;
  paymentTradeNo: string;
  paymentUrl: string;
}

export interface CancelPendingOrderForUserInput {
  orderId: string;
  userId: string;
}

export type CancelPendingOrderForUserResult =
  | {
      status: "CANCELLED";
      order: OrderSummary;
      alreadyCancelled: boolean;
    }
  | {
      status:
        | "ORDER_PAID_CANNOT_BE_CANCELLED"
        | "NOT_FOUND_OR_NOT_OWNED"
        | "ORDER_STATUS_CONCURRENCY_CONFLICT";
      order: null;
    };

export interface InitializeInitialPaymentAttemptInput {
  orderId: string;
  provider: string;
  providerMerchantRef: string;
  paymentType: string;
  merchantTradeNo: string;
  paymentUrl: string;
}

export type InitializeInitialPaymentAttemptResult =
  | {
      status: "INITIALIZED" | "EXISTING_COMPATIBLE";
      order: InitializedPaymentOrderSummary;
      attempt: PaymentAttemptRecord;
    }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "PAYMENT_REFERENCE_CONFLICT" }
  | { status: "INVALID_ORDER_STATE" };

export type ConfirmPaidOrderFromPaymentResult =
  | { status: "PAID"; order: OrderSummary; alreadyPaid: false }
  | { status: "ALREADY_PAID"; order: OrderSummary; alreadyPaid: true }
  | {
      status:
        | "ORDER_NOT_FOUND"
        | "PAYMENT_REFERENCE_CONFLICT"
        | "PAYMENT_TYPE_MISMATCH"
        | "INVALID_ORDER_STATE";
      order: null;
      alreadyPaid: false;
    };

export interface PaymentAttemptRecord {
  id: string;
  orderId: string;
  ordinal: number;
  provider: string;
  providerMerchantRef: string;
  paymentType: string;
  merchantTradeNo: string;
  providerTradeNo: string | null;
  providerTradeIdentityHash: Buffer | null;
  status: PaymentAttemptStatus;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentAttemptReadStore {
  findPaymentAttemptByMerchantTradeNo(
    merchantTradeNo: string
  ): Promise<PaymentAttemptRecord | null>;
  findPaymentAttemptByOrderAndOrdinal(
    orderId: string,
    ordinal: number
  ): Promise<PaymentAttemptRecord | null>;
}

export interface SettlePaymentAttemptFromCallbackInput {
  provider: string;
  providerMerchantRef: string;
  paymentType: string;
  merchantTradeNo: string;
  providerTradeNo: string;
  amountCents: number;
  paidAt: Date;
}

export type SettlePaymentAttemptFromCallbackResult =
  | {
      status:
        | "PAID"
        | "EXACT_PAID_REPLAY"
        | "PAID_REQUIRES_REVIEW"
        | "EXACT_REVIEW_REPLAY"
        | "PAID_EVIDENCE_RECONCILED";
      orderId: string;
      paymentAttemptId: string;
    }
  | {
      status:
        | "PAYMENT_ATTEMPT_NOT_FOUND"
        | "ORDER_NOT_FOUND"
        | "PAYMENT_IDENTITY_MISMATCH"
        | "PAYMENT_AMOUNT_MISMATCH"
        | "PAYMENT_REFERENCE_CONFLICT"
        | "INVALID_PAYMENT_STATE";
    };

export interface PaymentAttemptSettlementStore {
  settlePaymentAttemptFromCallback(
    input: SettlePaymentAttemptFromCallbackInput
  ): Promise<SettlePaymentAttemptFromCallbackResult>;
}

export interface MaterializeLegacyPaymentAttemptFromCallbackInput
  extends SettlePaymentAttemptFromCallbackInput {
  orderId: string;
}

export interface LegacyPaymentAttemptMaterializationStore {
  materializeAndSettleLegacyPaymentAttemptFromCallback(
    input: MaterializeLegacyPaymentAttemptFromCallbackInput
  ): Promise<SettlePaymentAttemptFromCallbackResult>;
}

export interface AdminQuotaAdjustmentInput extends AdminFinancialActor {
  userId: string;
  remainingCredits: number;
}

export interface AdminQuotaAdjustmentResult {
  status: "UPDATED" | "NO_CHANGE";
  quota: QuotaRecord;
  balanceBefore: number;
  balanceAfter: number;
  deltaCredits: number;
  creditEvent: AccountCreditEventRecord | null;
  auditLog: AdminAuditLogEntry;
}

export type AccountCreditEventMetadataValue = string | number | boolean | null;
export type AccountCreditEventMetadata = Readonly<
  Record<string, AccountCreditEventMetadataValue>
>;

export interface AccountCreditEventRecord {
  id: string;
  userId: string;
  deltaCredits: number;
  balanceBefore: number;
  balanceAfter: number;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  createdAt: Date;
  metadata: AccountCreditEventMetadata | null;
}

export interface CreateAccountCreditEventInput {
  userId: string;
  deltaCredits: number;
  balanceBefore: number;
  balanceAfter: number;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  metadata?: AccountCreditEventMetadata | null;
  now?: Date;
}

export type CreateAccountCreditEventResult =
  | { status: "CREATED"; event: AccountCreditEventRecord }
  | { status: "DUPLICATE"; event: AccountCreditEventRecord };

export type ChatCreditReservationKind =
  Extract<CreditReservationKind, "CHAT_COMPLETION" | "CHAT_STREAM">;

export interface ReserveChatCreditsInput {
  userId: string;
  requestId: string;
  modelId: string;
  creditCost: number;
  kind: ChatCreditReservationKind;
  expiresAt: Date;
}

export type ReserveChatCreditsResult =
  | {
      ok: true;
      status: "CREATED" | "DUPLICATE";
      reservation: CreditReservation;
    }
  | {
      ok: false;
      reason:
        | "QUOTA_NOT_FOUND"
        | "INSUFFICIENT_CREDITS"
        | "INVALID_CONFIGURATION"
        | "IDEMPOTENCY_CONFLICT";
    };

export type ChatProviderAttemptTerminalStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN"
  | "ABORTED";

export interface ChatProviderAttemptRecord {
  id: string;
  reservationId: string | null;
  requestId: string;
  attemptIndex: number;
  status: UsageLogAttemptStatus;
  userId: string;
  model: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ClaimChatProviderAttemptInput {
  reservationId: string | null;
  userId?: string | null;
  requestId: string;
  attemptIndex: number;
  modelId: string;
  sessionId?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  upstreamModel?: string | null;
  routeId?: string | null;
  fallbackAttempts?: number;
  startedAt?: Date;
}

export type ClaimChatProviderAttemptResult =
  | {
      status: "CLAIMED" | "ALREADY_CLAIMED" | "ALREADY_TERMINAL";
      attempt: ChatProviderAttemptRecord;
    }
  | {
      status: "NOT_FOUND" | "INVALID_STATE" | "ATTEMPT_CONFLICT";
    };

export interface CompleteChatProviderAttemptInput {
  reservationId: string | null;
  requestId: string;
  attemptIndex: number;
  status: ChatProviderAttemptTerminalStatus;
  completedAt?: Date;
}

export type CompleteChatProviderAttemptResult =
  | {
      status: "UPDATED" | "ALREADY_TERMINAL";
      attempt: ChatProviderAttemptRecord;
    }
  | {
      status: "NOT_FOUND" | "ATTEMPT_CONFLICT" | "CONFLICTING_TERMINAL_STATUS";
    };

export interface ListExpiredChatReservationsOptions {
  now?: Date;
  limit?: number;
}

export interface RecoverExpiredChatReservationsOptions {
  now?: Date;
  limit?: number;
}

export interface RecoverExpiredChatReservationsResult {
  scanned: number;
  settled: number;
  released: number;
  skipped: number;
  failed: number;
}

export interface ExpiredChatReservationRecord {
  id: string;
  userId: string;
  requestId: string | null;
  kind: ChatCreditReservationKind;
  amountCredits: number;
  status: CreditReservationStatus;
  expiresAt: Date;
  providerAttemptStartedAt: Date | null;
}

export interface ChatCreditStore {
  reserveChatCredits(
    input: ReserveChatCreditsInput
  ): Promise<ReserveChatCreditsResult>;
  claimChatProviderAttempt(
    input: ClaimChatProviderAttemptInput
  ): Promise<ClaimChatProviderAttemptResult>;
  completeChatProviderAttempt(
    input: CompleteChatProviderAttemptInput
  ): Promise<CompleteChatProviderAttemptResult>;
  settleChatReservation(
    reservationId: string
  ): Promise<CreditReservationMutationResult>;
  releaseChatReservation(
    reservationId: string
  ): Promise<CreditReservationMutationResult>;
  listExpiredChatReservations(
    options?: ListExpiredChatReservationsOptions
  ): Promise<ExpiredChatReservationRecord[]>;
}

export interface ChatCreditRecoveryStore {
  recoverExpiredChatReservations(
    options?: RecoverExpiredChatReservationsOptions
  ): Promise<RecoverExpiredChatReservationsResult>;
}

export interface ReserveCreditsInput {
  userId: string;
  kind: CreditReservationKind;
  amountCredits: number;
  expiresAt: Date;
  aiTaskId?: string | null;
}

export interface CreateImageTaskWithReservationInput {
  userId: string;
  amountCredits: number;
  expiresAt: Date;
  task: Omit<AiTaskCreateInput, "userId">;
  reservationKind?: CreditReservationKind;
  idempotencyClaim?: ImageTaskIdempotencyClaimBinding;
}

export interface ImageTaskIdempotencyClaimBinding {
  requestId: string;
  requestFingerprint: Uint8Array;
  claimTokenHash: Uint8Array;
  now?: Date;
}

export interface IdempotencyTerminalMetadata {
  responseStatus?: number;
  responseCode?: string | null;
  completedAt?: Date;
}

export type ReserveCreditsResult =
  | { ok: true; reservation: CreditReservation }
  | { ok: false; reason: "QUOTA_NOT_FOUND" | "INSUFFICIENT_CREDITS" };

export type CreateImageTaskWithReservationResult =
  | {
      ok: true;
      task: AiTaskSummary;
      reservation: CreditReservation;
    }
  | {
      ok: false;
      reason:
        | "QUOTA_NOT_FOUND"
        | "INSUFFICIENT_CREDITS"
        | "IDEMPOTENCY_CLAIM_INVALID";
    };

export interface ClaimIdempotencyRequestInput {
  scope: string;
  ownerType: IdempotencyOwnerType;
  ownerKeyHash: Uint8Array;
  idempotencyKeyHash: Uint8Array;
  requestFingerprint: Uint8Array;
  claimTokenHash: Uint8Array;
  now?: Date;
}

export interface SafeIdempotencyRequestReference {
  id: string;
  aiTaskId: string | null;
  responseStatus: number | null;
  responseCode: string | null;
  expiresAt: Date | null;
  completedAt: Date | null;
}

export type ClaimIdempotencyRequestResult =
  | {
      status: "ACQUIRED";
      request: { id: string; claimExpiresAt: Date };
    }
  | {
      status: "IN_PROGRESS";
      request: { id: string; aiTaskId: string | null };
    }
  | {
      status: "SUCCEEDED" | "FAILED";
      request: SafeIdempotencyRequestReference;
    }
  | { status: "CONFLICT" };

export interface AbandonIdempotencyClaimInput {
  requestId: string;
  claimTokenHash: Uint8Array;
}

export type AbandonIdempotencyClaimResult =
  | { status: "ABANDONED" }
  | { status: "NOT_ABANDONED" };

export type ReadIdempotencyRequestStateInput = Pick<
  ClaimIdempotencyRequestInput,
  | "scope"
  | "ownerType"
  | "ownerKeyHash"
  | "idempotencyKeyHash"
  | "requestFingerprint"
>;

export type ReadIdempotencyRequestStateResult =
  | { status: "NOT_FOUND" }
  | { status: "CONFLICT" }
  | {
      status: "IN_PROGRESS";
      requestId: string;
      taskId: string | null;
    }
  | {
      status: "SUCCEEDED";
      requestId: string;
      taskId: string | null;
      responseStatus: 200;
      responseCode: null;
      completedAt: Date;
      expiresAt: Date;
    }
  | {
      status: "FAILED";
      requestId: string;
      taskId: string | null;
      responseStatus: number;
      responseCode: string | null;
      completedAt: Date;
      expiresAt: Date;
    };

export interface IdempotencyRequestStore {
  claimIdempotencyRequest(
    input: ClaimIdempotencyRequestInput
  ): Promise<ClaimIdempotencyRequestResult>;
  readIdempotencyRequestState(
    input: ReadIdempotencyRequestStateInput
  ): Promise<ReadIdempotencyRequestStateResult>;
  abandonIdempotencyClaim(
    input: AbandonIdempotencyClaimInput
  ): Promise<AbandonIdempotencyClaimResult>;
}

export type ConsumeGlobalBudgetInput = Readonly<{
  scope:
    | "image_generation"
    | "chat_completion"
    | "admin_provider_test"
    | "title_cover_visual_brief";
  periodType: "DAILY";
  periodKey: string;
  budgetCredits: number;
  costCredits: number;
}>;

export type ConsumeGlobalBudgetResult =
  | Readonly<{ status: "consumed" }>
  | Readonly<{ status: "exhausted" }>
  | Readonly<{ status: "unavailable" }>;

/**
 * Implementations must consume cost with one database-atomic operation that
 * cannot oversell the configured budget across application instances.
 * A consumed result is irreversible. The upper request-winner layer is
 * responsible for calling this method once per business request.
 * Inputs intentionally contain only scope, UTC window, budget, and cost; the
 * result distinguishes exhaustion from infrastructure unavailability without
 * exposing a balance or threshold.
 */
export interface GlobalBudgetStore {
  consumeGlobalBudget(
    input: ConsumeGlobalBudgetInput
  ): Promise<ConsumeGlobalBudgetResult>;
}

export type CreditReservationMutationStatus =
  | "UPDATED"
  | "ALREADY_SETTLED"
  | "ALREADY_RELEASED"
  | "INVALID_STATE"
  | "NOT_FOUND";

export interface CreditReservationMutationResult {
  status: CreditReservationMutationStatus;
}

export interface CompleteImageTaskWithReservationInput {
  taskId: string;
  reservationId: string;
  assets: ImageTaskCompletionAiAssetCreateInput[];
  output?: Record<string, unknown>;
  /** Credits to release for requested outputs that were not persisted. */
  refundCredits?: number;
  completedAt?: Date;
}

export interface CompleteImageTaskWithStorageObjectReservationInput {
  taskId: string;
  reservationId: string;
  assets: ImageTaskCompletionAiAssetCreateInput[];
  output?: Record<string, unknown>;
  /** Credits to release for requested outputs that were not persisted. */
  refundCredits?: number;
  completedAt?: Date;
}

export type CompleteImageTaskWithReservationStatus =
  | "UPDATED"
  | "ALREADY_COMPLETED"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "TASK_MISMATCH";

export interface CompleteImageTaskWithReservationResult {
  status: CompleteImageTaskWithReservationStatus;
  task?: AiTaskSummary;
  assets?: AiAssetSummary[];
}

export interface FailImageTaskAndReleaseReservationInput {
  taskId: string;
  reservationId: string;
  errorMessage?: string;
  idempotencyTerminal?: IdempotencyTerminalMetadata;
}

export type FailImageTaskAndReleaseReservationStatus =
  | "UPDATED"
  | "ALREADY_FAILED"
  | "ALREADY_RELEASED"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "TASK_MISMATCH";

export interface FailImageTaskAndReleaseReservationResult {
  status: FailImageTaskAndReleaseReservationStatus;
  task?: AiTaskSummary;
}

/**
 * Terminalizes an image task after a provider-success completion persistence
 * failure. The reservation is settled deliberately: this path must not refund
 * credits for work that has already been performed upstream.
 */
export interface FailImageTaskAndSettleReservationInput {
  taskId: string;
  reservationId: string;
  errorMessage: string;
  idempotencyTerminal?: IdempotencyTerminalMetadata;
}

export type FailImageTaskAndSettleReservationStatus =
  | "UPDATED"
  | "ALREADY_COMPLETED"
  | "ALREADY_FAILED"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "TASK_MISMATCH";

export interface FailImageTaskAndSettleReservationResult {
  status: FailImageTaskAndSettleReservationStatus;
  task?: AiTaskSummary;
}

export interface ReleaseExpiredCreditReservationsOptions {
  now?: Date;
  limit?: number;
}

export interface ReleaseExpiredCreditReservationsResult {
  scanned: number;
  released: number;
  skipped: number;
}

export interface RecoverExpiredImageReservationsOptions {
  now?: Date;
  graceMs?: number;
  limit?: number;
}

export interface RecoverExpiredImageReservationsResult {
  scanned: number;
  recovered: number;
  skipped: number;
}

export interface CreditReservationStore {
  reserveCredits(input: ReserveCreditsInput): Promise<ReserveCreditsResult>;
  createImageTaskWithReservation(
    input: CreateImageTaskWithReservationInput
  ): Promise<CreateImageTaskWithReservationResult>;
  settleCreditReservation(
    reservationId: string
  ): Promise<CreditReservationMutationResult>;
  releaseCreditReservation(
    reservationId: string
  ): Promise<CreditReservationMutationResult>;
  releaseExpiredCreditReservations(
    options?: ReleaseExpiredCreditReservationsOptions
  ): Promise<ReleaseExpiredCreditReservationsResult>;
  recoverExpiredImageReservations(
    options?: RecoverExpiredImageReservationsOptions
  ): Promise<RecoverExpiredImageReservationsResult>;
  completeImageTaskWithReservation(
    input: CompleteImageTaskWithReservationInput
  ): Promise<CompleteImageTaskWithReservationResult>;
  failImageTaskAndReleaseReservation(
    input: FailImageTaskAndReleaseReservationInput
  ): Promise<FailImageTaskAndReleaseReservationResult>;
  failImageTaskAndSettleReservation(
    input: FailImageTaskAndSettleReservationInput
  ): Promise<FailImageTaskAndSettleReservationResult>;
}

export interface StorageObjectImageTaskCompletionStore {
  completeImageTaskWithReservation(
    input: CompleteImageTaskWithStorageObjectReservationInput
  ): Promise<CompleteImageTaskWithReservationResult>;
}

export interface UsageSummaryRecord {
  remainingCredits: number;
  logs: UsageLogSummary[];
  totalSuccessCount: number;
  totalFailureCount: number;
}

export interface PlanInput {
  name: string;
  price: number;
  credits: number;
  description: string;
  features: string[];
  enabled: boolean;
  sortOrder: number;
}

export type PlanUpdateInput = Partial<PlanInput>;
export type ProviderAccountInput = AiProviderAccountInput;
export type ProviderAccountUpdateInput = Partial<AiProviderAccountInput>;

export interface ProviderAccountRuntime {
  id: string;
  name: string;
  providerType: ProviderAccountType;
  baseUrl: string;
  apiKey: string;
  capabilities: ProviderAccountCapability[];
  enabled: boolean;
  timeoutMs: number;
  headersJson: Record<string, unknown> | null;
  configJson: Record<string, unknown> | null;
}

export interface RuntimeAiModel {
  id: string;
  name: string;
  displayName?: string;
  slug: string;
  provider: ModelProvider;
  providerAccountId?: string | null;
  capability: ModelCapability;
  displaySurfaces?: ModelDisplaySurface[];
  imageInvokeMode?: ModelImageInvokeMode;
  imageOutputParser?: ModelImageOutputParser;
  maxReferenceImages: number;
  modelId: string;
  group: string;
  tags: string[];
  shortDescription?: string;
  enabled: boolean;
  creditCost: number;
  allowGuest: boolean;
  sortOrder: number;
  isRecommended: boolean;
  iconUrl?: string;
  iconText?: string;
  iconColor?: string;
  description?: string;
  routes?: AiModelRouteSummary[];
}

export interface ModelRouteRuntime extends AiModelRouteSummary {
  providerAccount: ProviderAccountRuntime & { priority: number };
}

export interface SiteSettingUpdateInput {
  key: string;
  value: string;
  type?: SiteSettingValueType;
  description?: string | null;
}

export interface SiteSettingAtomicUpdateInput {
  key: string;
  create: SiteSettingUpdateInput;
  update(
    current: SiteSettingSummary | null
  ): SiteSettingUpdateInput | Promise<SiteSettingUpdateInput>;
}

export interface AccountProfileUpdateInput {
  name?: string;
  avatarUrl?: string | null;
}

export interface StorageActivationResult {
  storagePackage: AccountOverview["storagePackage"];
  quota: QuotaRecord;
  alreadyActive: boolean;
}

export interface CheckInClaimResult {
  checkIn: CheckInSummary;
  quota: QuotaRecord;
  alreadyCheckedIn: boolean;
}

export interface ModelUpdateInput {
  name?: string;
  displayName?: string;
  modelId?: string;
  provider?: ModelProvider;
  providerAccountId?: string | null;
  capability?: ModelCapability;
  displaySurfaces?: ModelDisplaySurface[];
  imageInvokeMode?: ModelImageInvokeMode;
  imageOutputParser?: ModelImageOutputParser;
  maxReferenceImages?: number;
  group?: string;
  tags?: string[];
  shortDescription?: string;
  isRecommended?: boolean;
  enabled?: boolean;
  creditCost?: number;
  allowGuest?: boolean;
  sortOrder?: number;
  iconUrl?: string;
  iconText?: string;
  iconColor?: string;
}

export interface ModelInput {
  name: string;
  displayName: string;
  modelId: string;
  provider: ModelProvider;
  providerAccountId?: string | null;
  capability: ModelCapability;
  displaySurfaces?: ModelDisplaySurface[];
  imageInvokeMode?: ModelImageInvokeMode;
  imageOutputParser?: ModelImageOutputParser;
  maxReferenceImages?: number;
  group: string;
  tags: string[];
  shortDescription: string;
  creditCost: number;
  allowGuest: boolean;
  enabled: boolean;
  isRecommended: boolean;
  sortOrder: number;
  iconUrl?: string;
  iconText?: string;
  iconColor?: string;
}

export type ModelIdentityConflictKind =
  | "AMBIGUOUS_LEGACY_MODEL_ID"
  | "IDENTITY_COLLISION";

export class ModelIdentityConflictError extends Error {
  readonly code = "MODEL_IDENTITY_CONFLICT" as const;

  constructor(readonly kind: ModelIdentityConflictKind) {
    super("model identity configuration conflict");
    this.name = "ModelIdentityConflictError";
  }
}

export class ProviderAccountValidationError extends Error {
  readonly code = "PROVIDER_ACCOUNT_VALIDATION_FAILED" as const;

  constructor() {
    super("provider account validation failed");
    this.name = "ProviderAccountValidationError";
  }
}

export interface AdminUserListFilters {
  q?: string;
  role?: UserRole;
  page?: number;
  pageSize?: number;
}

export interface AdminUsageLogListFilters {
  q?: string;
  status?: UsageLogStatus;
  model?: string;
  limit?: number;
}

export interface AdminOrderListFilters {
  q?: string;
  status?: OrderStatus;
  paymentType?: string;
  review?: boolean;
  limit?: number;
}

export interface AiTaskListFilters {
  type?: AiTaskType;
  status?: AiTaskStatus;
  limit?: number;
}

export interface AiAssetListFilters {
  type?: AiAssetType;
  limit?: number;
}

export interface CreatorCanvasDocumentCreateInput {
  userId: string;
  title: string | null;
  state: Record<string, unknown>;
}

export interface CreatorCanvasDocumentUpdateInput {
  id: string;
  userId: string;
  expectedRevision: number;
  state?: Record<string, unknown>;
  title?: string | null;
}

export type CreatorCanvasDocumentUpdateResult =
  | Readonly<{
      status: "UPDATED";
      document: CreatorCanvasDocumentDetail;
    }>
  | Readonly<{ status: "NOT_FOUND" }>
  | Readonly<{ status: "CONFLICT" }>;

export interface AiTaskCreateInput {
  userId: string;
  type: AiTaskType;
  modelId?: string | null;
  prompt: string;
  input: Record<string, unknown>;
}

export const VIDEO_RUNTIME_INPUT_KEY = "__videoRuntime" as const;

export interface AiTaskRuntimeRecord {
  id: string;
  userId: string;
  type: AiTaskType;
  status: AiTaskStatus;
  modelId: string | null;
  prompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  costCredits: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

interface AiAssetCreateBaseInput {
  userId: string;
  taskId?: string | null;
  type: AiAssetType;
  thumbnailUrl?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ExternalUrlAiAssetCreateInput
  extends AiAssetCreateBaseInput {
  storageObjectId?: null;
  url: string;
}

export interface LocalStorageObjectAiAssetCreateInput
  extends AiAssetCreateBaseInput {
  storageObjectId: string;
  url?: never;
}

export type AiAssetCreateInput = ExternalUrlAiAssetCreateInput;

export type ImageTaskCompletionAiAssetCreateInput =
  | ExternalUrlAiAssetCreateInput
  | LocalStorageObjectAiAssetCreateInput;

export interface AiAssetStorageObjectReference {
  assetId: string;
  userId: string;
  storageObjectId: string | null;
}

export type DeleteAiAssetWithStorageObjectReferenceResult =
  | Readonly<{ status: "DELETED"; storageObjectId: string | null }>
  | Readonly<{ status: "NOT_FOUND"; storageObjectId: null }>;

export interface AiAssetStorageObjectReferenceStore {
  findAiAssetStorageObjectReferenceForUser(
    userId: string,
    assetId: string
  ): Promise<AiAssetStorageObjectReference | null>;
  deleteAiAssetForUserWithStorageObjectReference(
    userId: string,
    assetId: string
  ): Promise<DeleteAiAssetWithStorageObjectReferenceResult>;
}

export interface StorageObjectRecord {
  id: string;
  userId: string;
  storageProvider: StorageProvider;
  objectKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  source: StorageObjectSource;
  status: StorageObjectStatus;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePendingStorageObjectInput {
  userId: string;
  storageProvider: StorageProvider;
  objectKey: string;
  source: StorageObjectSource;
  expiresAt?: Date | null;
}

export interface MarkStorageObjectReadyInput {
  userId: string;
  id: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface OwnedStorageObjectInput {
  userId: string;
  id: string;
}

export type MarkStorageObjectReadyResult =
  | { status: "UPDATED" }
  | { status: "ALREADY_READY" }
  | { status: "INVALID_STATE" }
  | { status: "NOT_FOUND" };

export type MarkStorageObjectFailedResult =
  | { status: "UPDATED" }
  | { status: "ALREADY_FAILED" }
  | { status: "INVALID_STATE" }
  | { status: "NOT_FOUND" };

export type MarkStorageObjectDeletedResult =
  | { status: "UPDATED" }
  | { status: "ALREADY_DELETED" }
  | { status: "INVALID_STATE" }
  | { status: "NOT_FOUND" };

export type ClaimGeneratedStorageObjectForCompensationResult =
  | { status: "CLAIMED"; id: string; objectKey: string }
  | { status: "NOT_FOUND" }
  | { status: "NOT_ELIGIBLE" }
  | { status: "SKIPPED_REFERENCED" }
  | { status: "LOST_RACE" };

export type ReplaceUserAvatarReferenceInput =
  (
    | {
        kind: "LOCAL_STORAGE_OBJECT";
        userId: string;
        avatarUrl: string;
        storageObjectId: string;
      }
    | {
        kind: "EXTERNAL_URL";
        userId: string;
        avatarUrl: string;
      }
    | {
        kind: "CLEARED";
        userId: string;
      }
  ) & {
    profile?: Pick<AccountProfileUpdateInput, "name">;
  };

export type ReplaceUserAvatarReferenceResult =
  | {
      status: "UPDATED";
      user: UserRecord;
      replacedStorageObjectId: string | null;
    }
  | {
      status: "NOT_FOUND" | "STORAGE_OBJECT_UNAVAILABLE";
      user: null;
      replacedStorageObjectId: null;
    };

export interface UserAvatarReferenceStore {
  replaceUserAvatarReference(
    input: ReplaceUserAvatarReferenceInput
  ): Promise<ReplaceUserAvatarReferenceResult>;
}

export interface StorageObjectStore {
  createPendingStorageObject(
    input: CreatePendingStorageObjectInput
  ): Promise<StorageObjectRecord>;
  findStorageObjectForUser(
    userId: string,
    id: string
  ): Promise<StorageObjectRecord | null>;
  findReadyStorageObjectForUser(
    userId: string,
    id: string
  ): Promise<StorageObjectRecord | null>;
  markStorageObjectReady(
    input: MarkStorageObjectReadyInput
  ): Promise<MarkStorageObjectReadyResult>;
  markStorageObjectFailed(
    input: OwnedStorageObjectInput
  ): Promise<MarkStorageObjectFailedResult>;
  markStorageObjectDeleted(
    input: OwnedStorageObjectInput
  ): Promise<MarkStorageObjectDeletedResult>;
}

export interface GeneratedStorageObjectCompensationStore {
  claimGeneratedStorageObjectForCompensation(input: {
    userId: string;
    storageObjectId: string;
    now: Date;
  }): Promise<ClaimGeneratedStorageObjectForCompensationResult>;
  prepareDeletedGeneratedStorageObjectForPurge(
    storageObjectId: string
  ): Promise<PrepareDeletedGeneratedStorageObjectForPurgeResult>;
  finalizeDeletedGeneratedStorageObjectPurge(
    storageObjectId: string
  ): Promise<FinalizeDeletedGeneratedStorageObjectPurgeResult>;
}

export interface StorageObjectCleanupCandidate {
  id: string;
}

export interface ListReadyGeneratedStorageObjectCleanupCandidatesInput {
  readyBefore: Date;
  limit: number;
}

export interface ListDeletedGeneratedStorageObjectCleanupCandidatesInput {
  limit: number;
}

export type TombstoneReadyGeneratedStorageObjectForCleanupResult =
  | { status: "CLAIMED"; id: string; objectKey: string }
  | { status: "NOT_FOUND" }
  | { status: "NOT_ELIGIBLE" }
  | { status: "SKIPPED_REFERENCED" }
  | { status: "LOST_RACE" };

export type PrepareDeletedGeneratedStorageObjectForPurgeResult =
  | { status: "PREPARED"; id: string; objectKey: string }
  | { status: "NOT_FOUND" }
  | { status: "NOT_ELIGIBLE" }
  | { status: "SKIPPED_REFERENCED" };

export type FinalizeDeletedGeneratedStorageObjectPurgeResult =
  | { status: "PURGED" }
  | { status: "ALREADY_PURGED" }
  | { status: "NOT_ELIGIBLE" }
  | { status: "SKIPPED_REFERENCED" };

export interface StorageObjectCleanupStore {
  listReadyGeneratedStorageObjectCleanupCandidates(
    input: ListReadyGeneratedStorageObjectCleanupCandidatesInput
  ): Promise<StorageObjectCleanupCandidate[]>;
  listDeletedGeneratedStorageObjectCleanupCandidates(
    input: ListDeletedGeneratedStorageObjectCleanupCandidatesInput
  ): Promise<StorageObjectCleanupCandidate[]>;
  tombstoneReadyGeneratedStorageObjectForCleanup(input: {
    storageObjectId: string;
    readyBefore: Date;
    now: Date;
  }): Promise<TombstoneReadyGeneratedStorageObjectForCleanupResult>;
  prepareDeletedGeneratedStorageObjectForPurge(
    storageObjectId: string
  ): Promise<PrepareDeletedGeneratedStorageObjectForPurgeResult>;
  finalizeDeletedGeneratedStorageObjectPurge(
    storageObjectId: string
  ): Promise<FinalizeDeletedGeneratedStorageObjectPurgeResult>;
}

export interface AccountCreditEventStore {
  findAccountCreditEventByIdempotencyKey(
    idempotencyKey: string
  ): Promise<AccountCreditEventRecord | null>;
  listAccountCreditEventsForUser(
    userId: string,
    limit?: number
  ): Promise<AccountCreditEventRecord[]>;
}

export interface UserStore {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  getAccountOverview?(
    userId: string,
    benefits: AccountBenefitSettings,
    todayDate: string
  ): Promise<AccountOverview>;
  updateUserProfile?(
    userId: string,
    input: AccountProfileUpdateInput
  ): Promise<UserRecord | null>;
  saveAvatar?(userId: string, avatarUrl: string): Promise<UserRecord | null>;
  activateStoragePackage?(
    userId: string,
    input: {
      priceCredits: number;
      durationDays: number;
      description: string;
      autoRenewEnabled: boolean;
      idempotencyKey: string;
    }
  ): Promise<StorageActivationResult>;
  setStorageAutoRenew?(
    userId: string,
    enabled: boolean,
    benefits: AccountBenefitSettings
  ): Promise<AccountOverview["storagePackage"] | null>;
  listStorageSubscriptions?(input: {
    q?: string;
    status?: "ACTIVE" | "INACTIVE" | "EXPIRED" | "ALL";
    page: number;
    pageSize: number;
  }): Promise<AdminStorageSubscriptionPage>;
  updateStorageSubscription?(input: {
    userId: string;
    action: "ACTIVATE" | "EXTEND" | "DEACTIVATE" | "SET_AUTO_RENEW";
    durationDays?: number;
    enabled?: boolean;
    adminId: string;
    adminEmail: string;
    benefits: AccountBenefitSettings;
  }): Promise<AdminStorageSubscriptionSummary>;
  claimDailyCheckIn?(
    userId: string,
    input: {
      dateKey: string;
      dailyRewardCredits: number;
      streakRewards: Record<string, number>;
    }
  ): Promise<CheckInClaimResult>;
  listAccountActivities?(
    userId: string,
    page: number,
    pageSize: number
  ): Promise<AccountActivityPage>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  registerUnverifiedUserAndIssueEmailVerificationToken(
    input: RegisterUnverifiedUserAndIssueEmailVerificationTokenInput
  ): Promise<RegisterUnverifiedUserAndIssueEmailVerificationTokenResult>;
  rotateEmailVerificationTokenForEmail(
    input: RotateEmailVerificationTokenForEmailInput
  ): Promise<RotateEmailVerificationTokenForEmailResult>;
  consumeEmailVerificationToken(
    input: ConsumeEmailVerificationTokenInput
  ): Promise<ConsumeEmailVerificationTokenResult>;
  rotatePasswordResetTokenForEmail(
    input: RotatePasswordResetTokenForEmailInput
  ): Promise<RotatePasswordResetTokenForEmailResult>;
  consumePasswordResetToken(
    input: ConsumePasswordResetTokenInput
  ): Promise<ConsumePasswordResetTokenResult>;
  changePasswordForUser(input: {
    userId: string;
    expectedSessionVersion: number;
    expectedPasswordHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<
    | { status: "CHANGED" }
    | { status: "STALE_AUTH_STATE" }
  >;
  revokeUserSessions(input: {
    userId: string;
    expectedSessionVersion: number;
  }): Promise<
    | { status: "REVOKED" }
    | { status: "STALE_AUTH_STATE" }
  >;
  recordSuccessfulLogin(
    userId: string,
    now: Date
  ): Promise<{ sessionVersion: number } | null>;
  listSessions(userId: string): Promise<ChatSessionSummary[]>;
  createSession(input: {
    userId: string;
    title: string;
  }): Promise<ChatSessionSummary>;
  findSessionForUser(
    sessionId: string,
    userId: string
  ): Promise<ChatSessionSummary | null>;
  updateSessionTitle(
    sessionId: string,
    title: string
  ): Promise<ChatSessionSummary | null>;
  touchSession(sessionId: string): Promise<ChatSessionSummary | null>;
  listMessages(
    sessionId: string,
    userId: string
  ): Promise<ChatMessageRecord[] | null>;
  createMessage(input: {
    sessionId: string;
    role: ChatRole;
    content: string;
    model: string;
  }): Promise<ChatMessageRecord>;
  deleteSession(sessionId: string, userId: string): Promise<boolean>;
  listCreatorCanvasDocumentsForUser(
    userId: string,
    limit?: number
  ): Promise<CreatorCanvasDocumentSummary[]>;
  listCreatorCanvasDocumentsPageForUser(
    userId: string,
    page: number,
    pageSize: number
  ): Promise<{
    documents: CreatorCanvasDocumentSummary[];
    total: number;
  }>;
  findCreatorCanvasDocumentForUser(
    userId: string,
    documentId: string
  ): Promise<CreatorCanvasDocumentDetail | null>;
  createCreatorCanvasDocument(
    input: CreatorCanvasDocumentCreateInput
  ): Promise<CreatorCanvasDocumentDetail>;
  updateCreatorCanvasDocument(
    input: CreatorCanvasDocumentUpdateInput
  ): Promise<CreatorCanvasDocumentUpdateResult>;
  deleteCreatorCanvasDocumentForUser(
    userId: string,
    documentId: string
  ): Promise<boolean>;
  getQuota(userId: string): Promise<QuotaRecord>;
  deductQuota(userId: string, costCredits: number): Promise<QuotaRecord | null>;
  createUsageLog(input: {
    userId: string | null;
    sessionId: string | null;
    model: string;
    canonicalModel?: string | null;
    providerId?: string | null;
    providerName?: string | null;
    upstreamModel?: string | null;
    routeId?: string | null;
    fallbackAttempts?: number;
    status: UsageLogStatus;
    costCredits: number;
    errorMessage?: string | null;
    guestIp?: string | null;
    guestUsageDate?: string | null;
  }): Promise<UsageLogSummary>;
  countGuestUsageLogs(input: {
    guestIp: string;
    guestUsageDate: string;
  }): Promise<number>;
  getUsageSummary(userId: string, limit?: number): Promise<UsageSummaryRecord>;
  listAdminUsers(filters?: AdminUserListFilters): Promise<AdminUserSummary[]>;
  setQuota(userId: string, remainingCredits: number): Promise<QuotaRecord | null>;
  adjustUserQuotaWithAudit(
    input: AdminQuotaAdjustmentInput
  ): Promise<AdminQuotaAdjustmentResult | null>;
  listAdminUsageLogs(
    filters?: number | AdminUsageLogListFilters
  ): Promise<UsageLogSummary[]>;
  listAdminOperationsTasks(): Promise<AdminOperationsTask[]>;
  listAdminManualCompensations(): Promise<AdminOperationsManualCompensation[]>;
  countUsageLogs(status: UsageLogStatus): Promise<number>;
  getAdminOverviewStats(now?: Date): Promise<AdminOverviewStats>;
  listEnabledModels(
    filters?: ModelCapability | { capability?: ModelCapability; surface?: ModelDisplaySurface }
  ): Promise<RuntimeAiModel[]>;
  listAdminModels(): Promise<AdminAiModelSummary[]>;
  findModelByModelId(modelId: string): Promise<RuntimeAiModel | null>;
  findModelById(id: string): Promise<RuntimeAiModel | null>;
  createModel(input: ModelInput): Promise<AdminAiModelSummary>;
  updateModel(id: string, input: ModelUpdateInput): Promise<AdminAiModelSummary | null>;
  disableModel(id: string): Promise<AdminAiModelSummary | null>;
  deleteModel(id: string): Promise<{ deleted: true; model: AdminAiModelSummary } | { deleted: false; reason: string }>;
  listModelRoutes(modelId: string): Promise<AiModelRouteSummary[]>;
  listEnabledModelRoutesForModel(modelId: string): Promise<ModelRouteRuntime[]>;
  createModelRoute(input: AiModelRouteInput): Promise<AiModelRouteSummary>;
  updateModelRoute(
    id: string,
    input: Partial<Omit<AiModelRouteInput, "modelId">>
  ): Promise<AiModelRouteSummary | null>;
  disableModelRoute(id: string): Promise<AiModelRouteSummary | null>;
  listProviderAccounts(): Promise<AiProviderAccountSummary[]>;
  findProviderAccountById(id: string): Promise<AiProviderAccountSummary | null>;
  findProviderAccountRuntimeById(
    id: string
  ): Promise<ProviderAccountRuntime | null>;
  createProviderAccount(
    input: ProviderAccountInput
  ): Promise<AiProviderAccountSummary>;
  updateProviderAccount(
    id: string,
    input: ProviderAccountUpdateInput
  ): Promise<AiProviderAccountSummary | null>;
  disableProviderAccount(id: string): Promise<AiProviderAccountSummary | null>;
  listEnabledPlans(): Promise<PlanSummary[]>;
  listAdminPlans(): Promise<PlanSummary[]>;
  createPlan(input: PlanInput): Promise<PlanSummary>;
  updatePlan(id: string, input: PlanUpdateInput): Promise<PlanSummary | null>;
  listSettings(keys: readonly string[]): Promise<SiteSettingSummary[]>;
  listPublicSettings(): Promise<SiteSettingSummary[]>;
  getSetting(key: string): Promise<SiteSettingSummary | null>;
  updateSettings(input: SiteSettingUpdateInput[]): Promise<SiteSettingSummary[]>;
  updateSettingAtomically(
    input: SiteSettingAtomicUpdateInput
  ): Promise<SiteSettingSummary>;
  createOrder(input: {
    userId: string;
    planId: string;
  }): Promise<OrderSummary | null>;
  listOrdersForUser(userId: string): Promise<OrderSummary[]>;
  cancelPendingOrderForUser(
    input: CancelPendingOrderForUserInput
  ): Promise<CancelPendingOrderForUserResult>;
  listAdminOrders(
    filters?: number | AdminOrderListFilters
  ): Promise<AdminOrderSummary[]>;
  countAdminOrdersRequiringPaymentReview(): Promise<number>;
  findAdminOrderById(orderId: string): Promise<AdminOrderSummary | null>;
  findOrderById(orderId: string): Promise<OrderSummary | null>;
  initializeInitialPaymentAttempt(
    input: InitializeInitialPaymentAttemptInput
  ): Promise<InitializeInitialPaymentAttemptResult>;
  findOrderByPaymentTradeNo(paymentTradeNo: string): Promise<OrderSummary | null>;
  confirmPaidOrderFromPayment(
    orderId: string,
    data: {
      providerTradeNo: string;
      paidAt: Date;
      paymentType?: string;
    }
  ): Promise<ConfirmPaidOrderFromPaymentResult>;
  markOrderPaidByAdmin(
    input: AdminFinancialActor & { orderId: string }
  ): Promise<AdminOrderSummary | null>;
  updateOrderStatus(
    orderId: string,
    status: OrderStatus
  ): Promise<AdminOrderSummary | null>;
  createAuditLog(input: {
    adminUserId: string;
    adminEmail: string;
    action: string;
    targetType: string;
    targetId?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }): Promise<AdminAuditLogEntry>;
  listAdminAuditLogs(limit?: number): Promise<AdminAuditLogEntry[]>;
  createFeedback(input: {
    userId?: string;
    userEmail?: string;
    type: string;
    content: string;
    screenshotUrl?: string;
  }): Promise<FeedbackEntry>;
  listAdminFeedbacks(
    limit?: number,
    includeArchived?: boolean
  ): Promise<FeedbackEntry[]>;
  updateFeedbackStatus(
    feedbackId: string,
    status: FeedbackStatus
  ): Promise<FeedbackEntry | null>;
  archiveFeedback(feedbackId: string): Promise<FeedbackEntry | null>;
  createLink(input: {
    title: string;
    url: string;
    description?: string;
    category: string;
    enabled?: boolean;
    sortOrder?: number;
  }): Promise<LinkEntry>;
  updateLink(
    linkId: string,
    input: {
      title?: string;
      url?: string;
      description?: string;
      category?: string;
      enabled?: boolean;
      sortOrder?: number;
    }
  ): Promise<LinkEntry | null>;
  deleteLink(linkId: string): Promise<LinkEntry | null>;
  listAdminLinks(): Promise<LinkEntry[]>;
  listPublicLinks(category?: string): Promise<LinkEntry[]>;
  countAdmins(): Promise<number>;
  setUserRole(userId: string, role: "USER" | "ADMIN"): Promise<boolean>;
  getPaymentSetting(
    provider: string
  ): Promise<{
    id: string;
    provider: string;
    enabled: boolean;
    gatewayUrl: string | null;
    pid: string | null;
    encryptedKey: string | null;
    notifyUrl: string | null;
    returnUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;
  upsertPaymentSetting(
    provider: string,
    data: {
      enabled: boolean;
      gatewayUrl?: string | null;
      pid?: string | null;
      encryptedKey?: string | null;
      notifyUrl?: string | null;
      returnUrl?: string | null;
    }
  ): Promise<{
    id: string;
    provider: string;
    enabled: boolean;
    gatewayUrl: string | null;
    pid: string | null;
    encryptedKey: string | null;
    notifyUrl: string | null;
    returnUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  createAiTask(input: AiTaskCreateInput): Promise<AiTaskSummary>;
  updateAiTaskInput?(
    taskId: string,
    input: Record<string, unknown>
  ): Promise<AiTaskSummary | null>;
  findAiTaskRuntimeForUser?(
    userId: string,
    taskId: string
  ): Promise<AiTaskRuntimeRecord | null>;
  listRunningVideoTaskRuntime?(): Promise<AiTaskRuntimeRecord[]>;
  markAiTaskRunning(taskId: string): Promise<AiTaskSummary | null>;
  completeAiTaskWithAssets(
    taskId: string,
    data: {
      output: Record<string, unknown>;
      costCredits: number;
      assets: ExternalUrlAiAssetCreateInput[];
    }
  ): Promise<{ task: AiTaskSummary; assets: AiAssetSummary[] } | null>;
  failAiTask(
    taskId: string,
    errorMessage: string
  ): Promise<AiTaskSummary | null>;
  listAiTasksForUser(
    userId: string,
    filters?: AiTaskListFilters
  ): Promise<AiTaskSummary[]>;
  findAiTaskForUser(
    userId: string,
    taskId: string
  ): Promise<AiTaskDetailResponse | null>;
  listAiAssetsForUser(
    userId: string,
    filters?: AiAssetListFilters
  ): Promise<AiAssetSummary[]>;
  findAiAssetForUser(
    userId: string,
    assetId: string
  ): Promise<AiAssetDetailResponse | null>;
  deleteAiAssetForUser(userId: string, assetId: string): Promise<boolean>;
}

const STORAGE_OBJECT_KEY_MAX_LENGTH = 512;
const STORAGE_OBJECT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4"
]);
const STORAGE_OBJECT_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STORAGE_OBJECT_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const STORAGE_OBJECT_WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/;
const USER_AVATAR_URL_MAX_LENGTH = 500;
const AI_ASSET_STORAGE_OBJECT_UNIQUE_CONSTRAINT =
  "AiAsset_storageObjectId_key";
const AI_ASSET_INTERNAL_METADATA_KEYS = new Set([
  "storageKey",
  "storageProvider",
  "objectKey",
  "absolutePath"
]);

interface LockedUserAvatarReference {
  id: string;
  avatarStorageObjectId: string | null;
}

interface LockedAvatarStorageObject {
  id: string;
  userId: string;
  storageProvider: StorageProvider;
  mimeType: string | null;
  sizeBytes: bigint | null;
  sha256: string | null;
  source: StorageObjectSource;
  status: StorageObjectStatus;
  deletedAt: Date | null;
}

interface LockedGeneratedStorageObject {
  id: string;
  userId: string;
  storageProvider: StorageProvider;
  objectKey: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
  sha256: string | null;
  source: StorageObjectSource;
  status: StorageObjectStatus;
  deletedAt: Date | null;
}

interface LockedStorageObjectCleanupRecord {
  id: string;
  objectKey: string;
  storageProvider: StorageProvider;
  source: StorageObjectSource;
  status: StorageObjectStatus;
  deletedAt: Date | null;
  updatedAt: Date;
}

interface LockedAiAssetStorageObjectReference {
  id: string;
  userId: string;
  storageObjectId: string | null;
}

function normalizeStorageObjectUserId(userId: string): string {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new TypeError("INVALID_STORAGE_OBJECT_USER_ID");
  }

  return userId.trim();
}

function normalizeStorageObjectId(id: string): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new TypeError("INVALID_STORAGE_OBJECT_ID");
  }

  return id.trim();
}

function validateStorageCleanupDate(value: Date, code: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(code);
  }

  return value;
}

function validateStorageCleanupLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("INVALID_STORAGE_CLEANUP_LIMIT");
  }

  return limit;
}

function isReadyGeneratedStorageObjectCleanupEligible(
  storageObject: LockedStorageObjectCleanupRecord | undefined,
  readyBefore: Date
): storageObject is LockedStorageObjectCleanupRecord {
  return Boolean(
    storageObject &&
      storageObject.status === StorageObjectStatus.READY &&
      storageObject.storageProvider === StorageProvider.LOCAL &&
      storageObject.source === StorageObjectSource.GENERATED &&
      storageObject.deletedAt === null &&
      storageObject.updatedAt.getTime() <= readyBefore.getTime()
  );
}

function isReadyGeneratedStorageObjectCompensationEligible(
  storageObject: LockedStorageObjectCleanupRecord | undefined
): storageObject is LockedStorageObjectCleanupRecord {
  return Boolean(
    storageObject &&
      storageObject.status === StorageObjectStatus.READY &&
      storageObject.storageProvider === StorageProvider.LOCAL &&
      storageObject.source === StorageObjectSource.GENERATED &&
      storageObject.deletedAt === null
  );
}

function isDeletedGeneratedStorageObjectCleanupEligible(
  storageObject: LockedStorageObjectCleanupRecord | undefined,
  requireDeletedAt: boolean
): storageObject is LockedStorageObjectCleanupRecord {
  return Boolean(
    storageObject &&
      storageObject.status === StorageObjectStatus.DELETED &&
      storageObject.storageProvider === StorageProvider.LOCAL &&
      storageObject.source === StorageObjectSource.GENERATED &&
      (!requireDeletedAt || storageObject.deletedAt !== null)
  );
}

async function hasStorageObjectBusinessReference(
  tx: Prisma.TransactionClient,
  storageObjectId: string
): Promise<boolean> {
  const asset = await tx.aiAsset.findFirst({
    where: { storageObjectId },
    select: { id: true }
  });
  if (asset) {
    return true;
  }

  const avatarUser = await tx.user.findFirst({
    where: { avatarStorageObjectId: storageObjectId },
    select: { id: true }
  });

  return avatarUser !== null;
}

function validateStorageProvider(
  storageProvider: StorageProvider
): StorageProvider {
  if (!Object.values(StorageProvider).includes(storageProvider)) {
    throw new TypeError("INVALID_STORAGE_PROVIDER");
  }

  return storageProvider;
}

function validateStorageObjectSource(
  source: StorageObjectSource
): StorageObjectSource {
  if (!Object.values(StorageObjectSource).includes(source)) {
    throw new TypeError("INVALID_STORAGE_OBJECT_SOURCE");
  }

  return source;
}

function isValidStorageObjectKey(objectKey: unknown): objectKey is string {
  if (
    typeof objectKey !== "string" ||
    objectKey.length === 0 ||
    objectKey.length > STORAGE_OBJECT_KEY_MAX_LENGTH ||
    objectKey.trim() === "" ||
    objectKey.startsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.includes("\0") ||
    STORAGE_OBJECT_WINDOWS_DRIVE_PATTERN.test(objectKey) ||
    STORAGE_OBJECT_SCHEME_PATTERN.test(objectKey)
  ) {
    return false;
  }

  return !objectKey.split("/").some(
    (segment) => segment === "" || segment === "." || segment === ".."
  );
}

function validateStorageObjectKey(objectKey: string): string {
  if (!isValidStorageObjectKey(objectKey)) {
    throw new TypeError("INVALID_STORAGE_OBJECT_KEY");
  }

  return objectKey;
}

function validateStorageObjectExpiresAt(
  expiresAt?: Date | null
): Date | null {
  if (expiresAt === undefined || expiresAt === null) {
    return null;
  }

  if (
    !(expiresAt instanceof Date) ||
    !Number.isFinite(expiresAt.getTime())
  ) {
    throw new TypeError("INVALID_STORAGE_OBJECT_EXPIRES_AT");
  }

  return expiresAt;
}

function validateStorageObjectMimeType(mimeType: string): string {
  if (
    typeof mimeType !== "string" ||
    !STORAGE_OBJECT_MIME_TYPES.has(mimeType)
  ) {
    throw new TypeError("INVALID_STORAGE_OBJECT_MIME_TYPE");
  }

  return mimeType;
}

function validateStorageObjectSizeBytes(sizeBytes: number): bigint {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new TypeError("INVALID_STORAGE_OBJECT_SIZE_BYTES");
  }

  return BigInt(sizeBytes);
}

function validateStorageObjectSha256(sha256: string): string {
  if (
    typeof sha256 !== "string" ||
    !STORAGE_OBJECT_SHA256_PATTERN.test(sha256)
  ) {
    throw new TypeError("INVALID_STORAGE_OBJECT_SHA256");
  }

  return sha256;
}

function validateUserAvatarUrl(avatarUrl: string): string {
  if (
    typeof avatarUrl !== "string" ||
    avatarUrl.trim() === "" ||
    avatarUrl.length > USER_AVATAR_URL_MAX_LENGTH
  ) {
    throw new TypeError("INVALID_USER_AVATAR_URL");
  }

  return avatarUrl;
}

function isAvailableAvatarStorageObject(
  storageObject: LockedAvatarStorageObject | undefined,
  userId: string,
  storageObjectId: string
): storageObject is LockedAvatarStorageObject {
  return Boolean(
    storageObject &&
      storageObject.id === storageObjectId &&
      storageObject.userId === userId &&
      storageObject.status === StorageObjectStatus.READY &&
      storageObject.storageProvider === StorageProvider.LOCAL &&
      storageObject.source === StorageObjectSource.UPLOAD &&
      storageObject.deletedAt === null &&
      storageObject.mimeType !== null &&
      STORAGE_OBJECT_MIME_TYPES.has(storageObject.mimeType) &&
      storageObject.sizeBytes !== null &&
      storageObject.sizeBytes > 0n &&
      storageObject.sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER) &&
      storageObject.sha256 !== null &&
      STORAGE_OBJECT_SHA256_PATTERN.test(storageObject.sha256)
  );
}

type AiAssetCompletionErrorCode =
  | "AI_ASSET_CREATION_CONFLICT"
  | "AI_ASSET_LOCAL_URL_FORBIDDEN"
  | "AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED"
  | "AI_ASSET_STORAGE_OBJECT_UNAVAILABLE"
  | "AI_ASSET_TASK_OWNERSHIP_MISMATCH";

class AiAssetCompletionError extends Error {
  constructor(readonly code: AiAssetCompletionErrorCode) {
    super(code);
    this.name = "AiAssetCompletionError";
  }
}

function isLocalStorageObjectAiAssetCreateInput(
  asset: ImageTaskCompletionAiAssetCreateInput
): asset is LocalStorageObjectAiAssetCreateInput {
  return asset.storageObjectId !== undefined && asset.storageObjectId !== null;
}

function validateAiAssetCompletionInputs(
  assets: ImageTaskCompletionAiAssetCreateInput[],
  taskId: string,
  userId: string
): string[] {
  const storageObjectIds: string[] = [];
  const seenStorageObjectIds = new Set<string>();

  for (const asset of assets) {
    if (
      asset.userId !== userId ||
      (asset.taskId !== undefined &&
        asset.taskId !== null &&
        asset.taskId !== taskId)
    ) {
      throw new AiAssetCompletionError(
        "AI_ASSET_TASK_OWNERSHIP_MISMATCH"
      );
    }

    if (!isLocalStorageObjectAiAssetCreateInput(asset)) {
      continue;
    }
    if ("url" in asset) {
      throw new AiAssetCompletionError("AI_ASSET_LOCAL_URL_FORBIDDEN");
    }
    if (
      typeof asset.storageObjectId !== "string" ||
      asset.storageObjectId.trim() === ""
    ) {
      throw new AiAssetCompletionError(
        "AI_ASSET_STORAGE_OBJECT_UNAVAILABLE"
      );
    }

    const storageObjectId = asset.storageObjectId.trim();
    if (seenStorageObjectIds.has(storageObjectId)) {
      throw new AiAssetCompletionError(
        "AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED"
      );
    }
    seenStorageObjectIds.add(storageObjectId);
    storageObjectIds.push(storageObjectId);
  }

  return storageObjectIds.sort();
}

function isAvailableGeneratedStorageObject(
  storageObject: LockedGeneratedStorageObject | undefined,
  userId: string,
  storageObjectId: string
): storageObject is LockedGeneratedStorageObject {
  return Boolean(
    storageObject &&
      storageObject.id === storageObjectId &&
      storageObject.userId === userId &&
      storageObject.status === StorageObjectStatus.READY &&
      storageObject.storageProvider === StorageProvider.LOCAL &&
      isValidStorageObjectKey(storageObject.objectKey) &&
      storageObject.source === StorageObjectSource.GENERATED &&
      storageObject.deletedAt === null &&
      storageObject.mimeType !== null &&
      STORAGE_OBJECT_MIME_TYPES.has(storageObject.mimeType) &&
      storageObject.sizeBytes !== null &&
      storageObject.sizeBytes > 0n &&
      storageObject.sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER) &&
      storageObject.sha256 !== null &&
      STORAGE_OBJECT_SHA256_PATTERN.test(storageObject.sha256)
  );
}

async function validateGeneratedStorageObjectsForCompletion(
  tx: Prisma.TransactionClient,
  userId: string,
  storageObjectIds: string[],
  afterStorageObjectLocked?: (storageObjectId: string) => Promise<void>
): Promise<void> {
  for (const storageObjectId of storageObjectIds) {
    const storageObjects = await tx.$queryRaw<LockedGeneratedStorageObject[]>(
      Prisma.sql`
        SELECT
          \`id\`,
          \`userId\`,
          \`storageProvider\`,
          \`objectKey\`,
          \`mimeType\`,
          \`sizeBytes\`,
          \`sha256\`,
          \`source\`,
          \`status\`,
          \`deletedAt\`
        FROM \`StorageObject\`
        WHERE \`id\` = ${storageObjectId}
          AND \`userId\` = ${userId}
        FOR UPDATE
      `
    );
    if (
      !isAvailableGeneratedStorageObject(
        storageObjects[0],
        userId,
        storageObjectId
      )
    ) {
      throw new AiAssetCompletionError(
        "AI_ASSET_STORAGE_OBJECT_UNAVAILABLE"
      );
    }

    await afterStorageObjectLocked?.(storageObjectId);

    const linkedAsset = await tx.aiAsset.findFirst({
      where: { storageObjectId },
      select: { id: true }
    });
    if (linkedAsset) {
      throw new AiAssetCompletionError(
        "AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED"
      );
    }
  }
}

function normalizeAiAssetReferenceUserId(userId: string): string {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new TypeError("INVALID_AI_ASSET_REFERENCE_USER_ID");
  }
  return userId.trim();
}

function normalizeAiAssetReferenceId(assetId: string): string {
  if (typeof assetId !== "string" || assetId.trim() === "") {
    throw new TypeError("INVALID_AI_ASSET_REFERENCE_ID");
  }
  return assetId.trim();
}

function filterAiAssetMetadata(
  value: unknown
): Record<string, unknown> {
  const metadata = normalizeJsonRecord(value);
  const filtered: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(metadata)) {
    if (!AI_ASSET_INTERNAL_METADATA_KEYS.has(key)) {
      filtered[key] = entry;
    }
  }

  return filtered;
}

function isAiAssetStorageObjectUniqueConflict(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const meta = "meta" in error ? error.meta : undefined;
  const target =
    typeof meta === "object" && meta !== null && "target" in meta
      ? meta.target
      : undefined;
  if (target === AI_ASSET_STORAGE_OBJECT_UNIQUE_CONSTRAINT) {
    return true;
  }
  return (
    Array.isArray(target) &&
    target.length === 1 &&
    target[0] === "storageObjectId"
  );
}

async function findStorageObjectStatusForUser(
  client: PrismaClient,
  userId: string,
  id: string
): Promise<StorageObjectStatus | null> {
  const storageObject = await client.storageObject.findFirst({
    where: { id, userId },
    select: { status: true }
  });

  return storageObject?.status ?? null;
}

function normalizeReservationUserId(userId: string): string {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new Error("INVALID_CREDIT_RESERVATION_USER_ID");
  }

  return userId.trim();
}

const ACCOUNT_CREDIT_EVENT_MAX_INT = 2_147_483_647;
const ACCOUNT_CREDIT_EVENT_MIN_INT = -2_147_483_648;
const ACCOUNT_CREDIT_EVENT_MAX_QUERY_LIMIT = 100;
const ACCOUNT_CREDIT_EVENT_METADATA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const ACCOUNT_CREDIT_EVENT_FORBIDDEN_METADATA_KEY_PATTERN =
  /(password|token|jwt|secret|apikey|prompt|request|header|response|error|url|email|cookie|authorization|database|body|raw)/iu;

function normalizeAccountCreditEventUserId(userId: string): string {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new TypeError("INVALID_ACCOUNT_CREDIT_EVENT_USER_ID");
  }

  return userId.trim();
}

function normalizeAccountCreditEventText(
  value: string,
  maxLength: number,
  errorCode: string
): string {
  if (typeof value !== "string") {
    throw new TypeError(errorCode);
  }

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new TypeError(errorCode);
  }

  return normalized;
}

function validateAccountCreditEventInteger(
  value: number,
  errorCode: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < ACCOUNT_CREDIT_EVENT_MIN_INT ||
    value > ACCOUNT_CREDIT_EVENT_MAX_INT
  ) {
    throw new TypeError(errorCode);
  }

  return value;
}

function normalizeAccountCreditEventNow(now: Date | undefined): Date | undefined {
  if (now === undefined) {
    return undefined;
  }

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("INVALID_ACCOUNT_CREDIT_EVENT_NOW");
  }

  return now;
}

function isAccountCreditEventMetadataValue(
  value: unknown
): value is AccountCreditEventMetadataValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validateAccountCreditEventMetadataKey(key: string): void {
  if (
    !ACCOUNT_CREDIT_EVENT_METADATA_KEY_PATTERN.test(key) ||
    ACCOUNT_CREDIT_EVENT_FORBIDDEN_METADATA_KEY_PATTERN.test(key)
  ) {
    throw new TypeError("INVALID_ACCOUNT_CREDIT_EVENT_METADATA");
  }
}

function normalizeAccountCreditEventMetadata(
  metadata: AccountCreditEventMetadata | null | undefined
): Prisma.InputJsonObject | undefined {
  if (metadata === undefined || metadata === null) {
    return undefined;
  }

  const entries: Array<[string, AccountCreditEventMetadataValue]> = [];
  for (const [key, value] of Object.entries(metadata)) {
    validateAccountCreditEventMetadataKey(key);
    if (!isAccountCreditEventMetadataValue(value)) {
      throw new TypeError("INVALID_ACCOUNT_CREDIT_EVENT_METADATA");
    }
    entries.push([key, value]);
  }

  return Object.fromEntries(entries);
}

function toAccountCreditEventMetadata(
  metadata: Prisma.JsonValue | null
): AccountCreditEventMetadata | null {
  if (metadata === null) {
    return null;
  }

  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("INVALID_ACCOUNT_CREDIT_EVENT_PERSISTED_METADATA");
  }

  const normalized: Record<string, AccountCreditEventMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    validateAccountCreditEventMetadataKey(key);
    if (!isAccountCreditEventMetadataValue(value)) {
      throw new Error("INVALID_ACCOUNT_CREDIT_EVENT_PERSISTED_METADATA");
    }
    normalized[key] = value;
  }

  return Object.freeze(normalized);
}

function toAccountCreditEventRecord(
  event: AccountCreditEvent
): AccountCreditEventRecord {
  return {
    id: event.id,
    userId: event.userId,
    deltaCredits: event.deltaCredits,
    balanceBefore: event.balanceBefore,
    balanceAfter: event.balanceAfter,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    idempotencyKey: event.idempotencyKey,
    createdAt: new Date(event.createdAt.getTime()),
    metadata: toAccountCreditEventMetadata(event.metadata)
  };
}

async function findAccountCreditEventAfterUniqueConflict(
  tx: Prisma.TransactionClient,
  idempotencyKey: string
): Promise<AccountCreditEvent | null> {
  const events = await tx.$queryRaw<AccountCreditEvent[]>(Prisma.sql`
    SELECT id, userId, deltaCredits, balanceBefore, balanceAfter,
      sourceType, sourceId, idempotencyKey, createdAt, metadata
    FROM AccountCreditEvent
    WHERE idempotencyKey = ${idempotencyKey}
    FOR UPDATE
  `);
  return events[0] ?? null;
}

export async function createAccountCreditEventInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateAccountCreditEventInput
): Promise<CreateAccountCreditEventResult> {
  const userId = normalizeAccountCreditEventUserId(input.userId);
  const deltaCredits = validateAccountCreditEventInteger(
    input.deltaCredits,
    "INVALID_ACCOUNT_CREDIT_EVENT_DELTA"
  );
  const balanceBefore = validateAccountCreditEventInteger(
    input.balanceBefore,
    "INVALID_ACCOUNT_CREDIT_EVENT_BALANCE"
  );
  const balanceAfter = validateAccountCreditEventInteger(
    input.balanceAfter,
    "INVALID_ACCOUNT_CREDIT_EVENT_BALANCE"
  );
  if (deltaCredits === 0) {
    throw new TypeError("INVALID_ACCOUNT_CREDIT_EVENT_DELTA");
  }
  if (balanceAfter !== balanceBefore + deltaCredits) {
    throw new TypeError("INVALID_ACCOUNT_CREDIT_EVENT_BALANCE");
  }

  const sourceType = normalizeAccountCreditEventText(
    input.sourceType,
    64,
    "INVALID_ACCOUNT_CREDIT_EVENT_SOURCE_TYPE"
  );
  const sourceId = normalizeAccountCreditEventText(
    input.sourceId,
    191,
    "INVALID_ACCOUNT_CREDIT_EVENT_SOURCE_ID"
  );
  const idempotencyKey = normalizeAccountCreditEventText(
    input.idempotencyKey,
    191,
    "INVALID_ACCOUNT_CREDIT_EVENT_IDEMPOTENCY_KEY"
  );
  const metadata = normalizeAccountCreditEventMetadata(input.metadata);
  const now = normalizeAccountCreditEventNow(input.now);

  const existing = await tx.accountCreditEvent.findUnique({
    where: { idempotencyKey }
  });
  if (existing) {
    return { status: "DUPLICATE", event: toAccountCreditEventRecord(existing) };
  }

  try {
    const event = await tx.accountCreditEvent.create({
      data: {
        userId,
        deltaCredits,
        balanceBefore,
        balanceAfter,
        sourceType,
        sourceId,
        idempotencyKey,
        ...(metadata === undefined ? {} : { metadata }),
        ...(now === undefined ? {} : { createdAt: now })
      }
    });
    return { status: "CREATED", event: toAccountCreditEventRecord(event) };
  } catch (error) {
    if (isPrismaForeignKeyError(error)) {
      throw new Error("ACCOUNT_CREDIT_EVENT_USER_NOT_FOUND");
    }
    if (!isPrismaUniqueError(error)) {
      throw error;
    }

    const duplicate = await findAccountCreditEventAfterUniqueConflict(
      tx,
      idempotencyKey
    );
    if (!duplicate) {
      throw new Error("ACCOUNT_CREDIT_EVENT_DUPLICATE_RESOLUTION_FAILED");
    }
    return { status: "DUPLICATE", event: toAccountCreditEventRecord(duplicate) };
  }
}

const IDEMPOTENCY_REQUEST_UNIQUE_CONSTRAINT =
  "IdempotencyRequest_scope_owner_key_key";
const IDEMPOTENCY_CLAIM_MAX_ATTEMPTS = 5;

function normalizeIdempotencyScope(scope: string): string {
  if (typeof scope !== "string" || scope.length === 0 || scope.length > 64) {
    throw new TypeError("INVALID_IDEMPOTENCY_SCOPE");
  }
  return scope;
}

function normalizeIdempotencyRequestId(requestId: string): string {
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new TypeError("INVALID_IDEMPOTENCY_REQUEST_ID");
  }
  return requestId;
}

function normalizeIdempotencyHash(
  value: Uint8Array,
  errorCode: string
): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    throw new TypeError(errorCode);
  }
  const normalized = new Uint8Array(value.byteLength);
  normalized.set(value);
  return normalized;
}

function normalizeIdempotencyNow(now = new Date()): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("INVALID_IDEMPOTENCY_NOW");
  }
  return now;
}

function normalizeIdempotencyOwnerType(
  ownerType: IdempotencyOwnerType
): IdempotencyOwnerType {
  if (ownerType !== IdempotencyOwnerType.USER) {
    throw new TypeError("UNSUPPORTED_IDEMPOTENCY_OWNER_TYPE");
  }
  return ownerType;
}

const IDEMPOTENCY_RESPONSE_STATUS_MIN = 400;
const IDEMPOTENCY_RESPONSE_STATUS_MAX = 599;
const IDEMPOTENCY_RESPONSE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const IDEMPOTENCY_DEFAULT_FAIL_RESPONSE_STATUS = 500;
const IDEMPOTENCY_DEFAULT_FAIL_RESPONSE_CODE: string | null = null;
const IDEMPOTENCY_COMPLETE_RESPONSE_STATUS = 200;
const IDEMPOTENCY_COMPLETE_RESPONSE_CODE: string | null = null;
const IDEMPOTENCY_COMPLETION_FAIL_RESPONSE_STATUS = 500;
const IDEMPOTENCY_COMPLETION_FAIL_RESPONSE_CODE =
  "IMAGE_TASK_COMPLETION_FAILED";
const IDEMPOTENCY_RECOVERY_RESPONSE_STATUS = 500;
const IDEMPOTENCY_RECOVERY_RESPONSE_CODE = "IMAGE_GENERATION_EXPIRED";

function validateIdempotencyResponseStatus(
  value: unknown,
  errorCode: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < IDEMPOTENCY_RESPONSE_STATUS_MIN ||
    value > IDEMPOTENCY_RESPONSE_STATUS_MAX
  ) {
    throw new TypeError(errorCode);
  }
  return value;
}

function validateIdempotencyResponseCode(
  value: unknown,
  errorCode: string
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !IDEMPOTENCY_RESPONSE_CODE_PATTERN.test(value)
  ) {
    throw new TypeError(errorCode);
  }
  return value;
}

function validateIdempotencyCompletedAt(
  value: unknown,
  errorCode: string
): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(errorCode);
  }
  return value;
}

function normalizeIdempotencyTerminalMetadata(
  metadata: IdempotencyTerminalMetadata | undefined,
  defaults: {
    responseStatus: number;
    responseCode: string | null;
    completedAt: Date;
  }
): {
  responseStatus: number;
  responseCode: string | null;
  completedAt: Date;
} {
  if (metadata === undefined) {
    return defaults;
  }
  const responseStatus =
    metadata.responseStatus === undefined
      ? defaults.responseStatus
      : validateIdempotencyResponseStatus(
          metadata.responseStatus,
          "INVALID_IDEMPOTENCY_RESPONSE_STATUS"
        );
  const responseCode =
    metadata.responseCode === undefined
      ? defaults.responseCode
      : validateIdempotencyResponseCode(
          metadata.responseCode,
          "INVALID_IDEMPOTENCY_RESPONSE_CODE"
        );
  const completedAt =
    metadata.completedAt === undefined
      ? defaults.completedAt
      : validateIdempotencyCompletedAt(
          metadata.completedAt,
          "INVALID_IDEMPOTENCY_COMPLETED_AT"
        );
  return { responseStatus, responseCode, completedAt };
}

async function applyIdempotencyTerminalUpdate(
  tx: Prisma.TransactionClient,
  input: {
    aiTaskId: string;
    targetStatus:
      | typeof IdempotencyRequestStatus.SUCCEEDED
      | typeof IdempotencyRequestStatus.FAILED;
    responseStatus: number;
    responseCode: string | null;
    completedAt: Date;
  }
): Promise<void> {
  const existing = await tx.idempotencyRequest.findFirst({
    where: { aiTaskId: input.aiTaskId }
  });
  if (!existing) {
    return;
  }
  if (existing.status !== IdempotencyRequestStatus.IN_PROGRESS) {
    throw new Error("IDEMPOTENCY_TERMINAL_STATE_INVALID");
  }
  const expiresAt = getIdempotencyTerminalExpiresAt(input.completedAt);
  const update = await tx.idempotencyRequest.updateMany({
    where: {
      id: existing.id,
      status: IdempotencyRequestStatus.IN_PROGRESS,
      aiTaskId: input.aiTaskId
    },
    data: {
      status: input.targetStatus,
      responseStatus: input.responseStatus,
      responseCode: input.responseCode,
      completedAt: input.completedAt,
      expiresAt
    }
  });
  if (update.count !== 1) {
    throw new Error("IDEMPOTENCY_TERMINAL_CAS_FAILED");
  }
}

function idempotencyHashesEqual(
  left: Uint8Array,
  right: Uint8Array
): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function toSafeIdempotencyRequestReference(
  request: IdempotencyRequest
): SafeIdempotencyRequestReference {
  return {
    id: request.id,
    aiTaskId: request.aiTaskId,
    responseStatus: request.responseStatus,
    responseCode: request.responseCode,
    expiresAt: request.expiresAt,
    completedAt: request.completedAt
  };
}

function isTargetIdempotencyUniqueConflict(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const meta = "meta" in error ? error.meta : undefined;
  const target =
    typeof meta === "object" && meta !== null && "target" in meta
      ? meta.target
      : undefined;
  if (target === IDEMPOTENCY_REQUEST_UNIQUE_CONSTRAINT) {
    return true;
  }
  return (
    Array.isArray(target) &&
    target.length === 4 &&
    target[0] === "scope" &&
    target[1] === "ownerType" &&
    target[2] === "ownerKeyHash" &&
    target[3] === "idempotencyKeyHash"
  );
}

function normalizeImageTaskIdempotencyClaimBinding(
  input: ImageTaskIdempotencyClaimBinding | undefined,
  userId: string
):
  | {
      requestId: string;
      ownerKeyHash: Uint8Array<ArrayBuffer>;
      requestFingerprint: Uint8Array<ArrayBuffer>;
      claimTokenHash: Uint8Array<ArrayBuffer>;
      now: Date;
    }
  | undefined {
  if (!input) {
    return undefined;
  }
  return {
    requestId: normalizeIdempotencyRequestId(input.requestId),
    ownerKeyHash: normalizeIdempotencyHash(
      hashUserIdempotencyOwner(userId),
      "INVALID_IDEMPOTENCY_OWNER_HASH"
    ),
    requestFingerprint: normalizeIdempotencyHash(
      input.requestFingerprint,
      "INVALID_IDEMPOTENCY_REQUEST_FINGERPRINT"
    ),
    claimTokenHash: normalizeIdempotencyHash(
      input.claimTokenHash,
      "INVALID_IDEMPOTENCY_CLAIM_TOKEN_HASH"
    ),
    now: normalizeIdempotencyNow(input.now)
  };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateImageTaskCreateInput(
  task: CreateImageTaskWithReservationInput["task"],
  userId: string,
  reservationKind: CreditReservationKind = CreditReservationKind.IMAGE_GENERATION
): AiTaskCreateInput {
  if (!task || typeof task !== "object") {
    throw new TypeError("INVALID_GENERATION_TASK_INPUT");
  }

  const expectedType =
    reservationKind === CreditReservationKind.VIDEO_GENERATION
      ? "video"
      : "image";
  if (task.type !== expectedType) {
    throw new TypeError("INVALID_GENERATION_TASK_TYPE");
  }

  if (typeof task.prompt !== "string") {
    throw new TypeError("INVALID_AI_TASK_PROMPT");
  }

  if (
    task.modelId !== undefined &&
    task.modelId !== null &&
    typeof task.modelId !== "string"
  ) {
    throw new TypeError("INVALID_AI_TASK_MODEL_ID");
  }

  if (!isJsonRecord(task.input)) {
    throw new TypeError("INVALID_AI_TASK_INPUT");
  }

  return {
    userId,
    type: expectedType,
    modelId: task.modelId ?? null,
    prompt: task.prompt,
    input: task.input
  };
}

function normalizeReservationId(reservationId: string): string {
  if (typeof reservationId !== "string" || reservationId.trim() === "") {
    throw new Error("INVALID_CREDIT_RESERVATION_ID");
  }

  return reservationId.trim();
}

function normalizeOptionalReservationId(
  reservationId: string | null
): string | null {
  return reservationId === null ? null : normalizeReservationId(reservationId);
}

function validateReservationAmount(amountCredits: number): number {
  if (!Number.isInteger(amountCredits) || amountCredits <= 0) {
    throw new Error("INVALID_CREDIT_RESERVATION_AMOUNT");
  }

  return amountCredits;
}

function validateImageTaskReservationAmount(amountCredits: number): number {
  if (!Number.isInteger(amountCredits) || amountCredits < 0) {
    throw new Error("INVALID_CREDIT_RESERVATION_AMOUNT");
  }

  return amountCredits;
}

function validateReservationExpiry(expiresAt: Date): Date {
  if (
    !(expiresAt instanceof Date) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    throw new Error("INVALID_CREDIT_RESERVATION_EXPIRY");
  }

  return expiresAt;
}

function validateReservationKind(
  kind: CreditReservationKind
): CreditReservationKind {
  if (!Object.values(CreditReservationKind).includes(kind)) {
    throw new Error("INVALID_CREDIT_RESERVATION_KIND");
  }

  return kind;
}

const CHAT_CREDIT_MAX_INT = 2_147_483_647;

function normalizeChatCreditText(
  value: string,
  maxLength: number,
  errorCode: string
): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    Array.from(value.trim()).length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(errorCode);
  }

  return value.trim();
}

function normalizeOptionalChatCreditText(
  value: string | null | undefined,
  maxLength: number,
  errorCode: string
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeChatCreditText(value, maxLength, errorCode);
}

function validateChatCreditCost(creditCost: number): number {
  if (
    !Number.isSafeInteger(creditCost) ||
    creditCost < 0 ||
    creditCost > CHAT_CREDIT_MAX_INT
  ) {
    throw new TypeError("INVALID_CHAT_CREDIT_COST");
  }

  return creditCost;
}

function validateChatAttemptIndex(attemptIndex: number): number {
  if (
    !Number.isSafeInteger(attemptIndex) ||
    attemptIndex < 0 ||
    attemptIndex > CHAT_CREDIT_MAX_INT
  ) {
    throw new TypeError("INVALID_CHAT_ATTEMPT_INDEX");
  }

  return attemptIndex;
}

function validateChatAttemptDate(
  value: Date | undefined,
  errorCode: string
): Date {
  const date = value ?? new Date();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError(errorCode);
  }

  return date;
}

function validateChatAttemptFallbackAttempts(
  fallbackAttempts: number | undefined
): number {
  const value = fallbackAttempts ?? 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > CHAT_CREDIT_MAX_INT) {
    throw new TypeError("INVALID_CHAT_FALLBACK_ATTEMPTS");
  }

  return value;
}

function isChatReservationKind(
  kind: CreditReservationKind
): kind is ChatCreditReservationKind {
  return (
    kind === CreditReservationKind.CHAT_COMPLETION ||
    kind === CreditReservationKind.CHAT_STREAM
  );
}

function chatCreditEventContract(
  kind: ChatCreditReservationKind,
  phase: "CHARGE" | "RELEASE",
  reservationId: string
): Pick<CreateAccountCreditEventInput, "sourceType" | "sourceId" | "idempotencyKey"> {
  const stream = kind === CreditReservationKind.CHAT_STREAM;
  const sourceType = stream
    ? phase === "CHARGE"
      ? "CHAT_STREAM_CHARGE"
      : "CHAT_STREAM_RELEASE"
    : phase === "CHARGE"
      ? "CHAT_CHARGE"
      : "CHAT_RELEASE";
  const keyPrefix = stream
    ? phase === "CHARGE"
      ? "chat-stream-charge"
      : "chat-stream-release"
    : phase === "CHARGE"
      ? "chat-charge"
      : "chat-release";

  return {
    sourceType,
    sourceId: reservationId,
    idempotencyKey: `${keyPrefix}:${reservationId}`
  };
}

function classifyExistingChatReservation(
  input: Pick<ReserveChatCreditsInput, "kind" | "creditCost">,
  reservation: CreditReservation
): ReserveChatCreditsResult {
  if (
    reservation.kind !== input.kind ||
    reservation.amountCredits !== input.creditCost
  ) {
    return { ok: false, reason: "IDEMPOTENCY_CONFLICT" };
  }

  return {
    ok: true,
    status: "DUPLICATE",
    reservation
  };
}

function normalizeReservationTaskId(
  aiTaskId?: string | null
): string | null {
  if (aiTaskId === undefined || aiTaskId === null) {
    return null;
  }

  if (typeof aiTaskId !== "string" || aiTaskId.trim() === "") {
    throw new Error("INVALID_CREDIT_RESERVATION_TASK_ID");
  }

  return aiTaskId.trim();
}

function validateExpiredReservationReleaseNow(now: Date): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("INVALID_EXPIRED_CREDIT_RESERVATION_NOW");
  }

  return now;
}

function validateExpiredReservationReleaseLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
    throw new TypeError("INVALID_EXPIRED_CREDIT_RESERVATION_LIMIT");
  }

  return limit;
}

function validateExpiredImageReservationGrace(graceMs: number): number {
  if (!Number.isInteger(graceMs) || graceMs < 0 || graceMs > 15 * 60 * 1000) {
    throw new TypeError("INVALID_EXPIRED_IMAGE_RESERVATION_GRACE");
  }

  return graceMs;
}

function validateImageCompletionRefundCredits(
  refundCredits: number | undefined
): number {
  if (refundCredits === undefined) {
    return 0;
  }

  if (
    !Number.isSafeInteger(refundCredits) ||
    refundCredits < 0
  ) {
    throw new TypeError("INVALID_IMAGE_COMPLETION_REFUND_CREDITS");
  }

  return refundCredits;
}

function settleMutationResult(
  status: CreditReservationStatus
): CreditReservationMutationResult {
  switch (status) {
    case CreditReservationStatus.SETTLED:
      return { status: "ALREADY_SETTLED" };
    case CreditReservationStatus.RESERVED:
    case CreditReservationStatus.RELEASED:
      return { status: "INVALID_STATE" };
  }
}

function releaseMutationResult(
  status: CreditReservationStatus
): CreditReservationMutationResult {
  switch (status) {
    case CreditReservationStatus.RELEASED:
      return { status: "ALREADY_RELEASED" };
    case CreditReservationStatus.RESERVED:
    case CreditReservationStatus.SETTLED:
      return { status: "INVALID_STATE" };
  }
}

function toChatProviderAttemptRecord(log: {
  id: string;
  reservationId: string | null;
  requestId: string | null;
  attemptIndex: number | null;
  attemptStatus: UsageLogAttemptStatus | null;
  userId: string | null;
  model: string;
  createdAt: Date;
  attemptCompletedAt: Date | null;
}): ChatProviderAttemptRecord {
  if (
    log.requestId === null ||
    log.attemptIndex === null ||
    log.attemptStatus === null ||
    log.userId === null
  ) {
    throw new Error("CHAT_PROVIDER_ATTEMPT_RECORD_INCOMPLETE");
  }

  return {
    id: log.id,
    reservationId: log.reservationId,
    requestId: log.requestId,
    attemptIndex: log.attemptIndex,
    status: log.attemptStatus,
    userId: log.userId,
    model: log.model,
    createdAt: new Date(log.createdAt.getTime()),
    completedAt: log.attemptCompletedAt
      ? new Date(log.attemptCompletedAt.getTime())
      : null
  };
}

function toPrismaChatAttemptTerminalStatus(
  status: ChatProviderAttemptTerminalStatus
): UsageLogAttemptStatus {
  switch (status) {
    case "SUCCEEDED":
      return UsageLogAttemptStatus.SUCCEEDED;
    case "FAILED":
      return UsageLogAttemptStatus.FAILED;
    case "UNKNOWN":
      return UsageLogAttemptStatus.UNKNOWN;
    case "ABORTED":
      return UsageLogAttemptStatus.ABORTED;
  }
}

function toLegacyUsageLogStatus(
  status: UsageLogAttemptStatus
): UsageLogStatus {
  return status === UsageLogAttemptStatus.SUCCEEDED ? "SUCCESS" : "FAILED";
}

function isIncompleteAiTaskStatus(status: string): boolean {
  return status === "PENDING" || status === "RUNNING";
}

function toAiAssetCreateData(
  asset: ImageTaskCompletionAiAssetCreateInput,
  taskId: string,
  userId: string
): Prisma.AiAssetUncheckedCreateInput {
  const commonData = {
    userId,
    taskId,
    type: toPrismaAiAssetType(asset.type),
    thumbnailUrl: asset.thumbnailUrl ?? null,
    title: asset.title ?? null,
    metadata: asset.metadata
      ? (filterAiAssetMetadata(asset.metadata) as Prisma.InputJsonValue)
      : undefined
  };

  if (isLocalStorageObjectAiAssetCreateInput(asset)) {
    const id = randomUUID();
    return {
      ...commonData,
      id,
      storageObjectId: asset.storageObjectId.trim(),
      url: `/assets/${id}/content`
    };
  }

  return {
    ...commonData,
    storageObjectId: null,
    url: asset.url
  };
}

function toAiTaskCreateData(
  input: AiTaskCreateInput
): Prisma.AiTaskUncheckedCreateInput {
  return {
    userId: input.userId,
    type: toPrismaAiTaskType(input.type),
    status: "PENDING",
    modelId: input.modelId ?? null,
    prompt: input.prompt,
    input: input.input as Prisma.InputJsonValue
  };
}

class CompleteImageTaskMutationAbort extends Error {
  constructor(
    readonly result: CompleteImageTaskWithReservationResult
  ) {
    super("IMAGE_TASK_COMPLETION_NOT_UPDATED");
    this.name = "CompleteImageTaskMutationAbort";
  }
}

class FailImageTaskMutationAbort extends Error {
  constructor(
    readonly result: FailImageTaskAndReleaseReservationResult
  ) {
    super("IMAGE_TASK_FAILURE_NOT_UPDATED");
    this.name = "FailImageTaskMutationAbort";
  }
}

class FailImageTaskAndSettleReservationMutationAbort extends Error {
  constructor(
    readonly result: FailImageTaskAndSettleReservationResult
  ) {
    super("IMAGE_TASK_SETTLED_FAILURE_NOT_UPDATED");
    this.name = "FailImageTaskAndSettleReservationMutationAbort";
  }
}

class CreateImageTaskWithReservationAbort extends Error {
  constructor(
    readonly reason: Extract<
      CreateImageTaskWithReservationResult,
      { ok: false }
    >["reason"]
  ) {
    super("IMAGE_TASK_RESERVATION_TRANSACTION_ABORTED");
    this.name = "CreateImageTaskWithReservationAbort";
  }
}

const EMAIL_VERIFICATION_EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const EMAIL_VERIFICATION_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

interface LockedEmailVerificationUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
}

interface LockedEmailVerificationConsumeUser {
  id: string;
  emailVerifiedAt: Date | null;
}

interface LockedEmailVerificationToken {
  id: string;
  userId: string;
  kind: UserTokenKind;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface LockedPasswordResetUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
}

interface LockedPasswordResetConsumeUser {
  id: string;
}

interface LockedPasswordResetToken {
  id: string;
  userId: string;
  kind: UserTokenKind;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

function validateEmailVerificationEmail(email: unknown): asserts email is string {
  if (
    typeof email !== "string" ||
    email === "" ||
    email !== email.trim() ||
    email !== email.toLowerCase() ||
    email.length > 254 ||
    !EMAIL_VERIFICATION_EMAIL_PATTERN.test(email)
  ) {
    throw new TypeError("INVALID_EMAIL_VERIFICATION_EMAIL");
  }
}

function validateEmailVerificationPasswordHash(
  passwordHash: unknown
): asserts passwordHash is string {
  if (typeof passwordHash !== "string" || passwordHash === "") {
    throw new TypeError("INVALID_EMAIL_VERIFICATION_PASSWORD_HASH");
  }
}

function validateEmailVerificationTokenHash(
  tokenHash: unknown
): asserts tokenHash is string {
  if (
    typeof tokenHash !== "string" ||
    !EMAIL_VERIFICATION_TOKEN_HASH_PATTERN.test(tokenHash)
  ) {
    throw new TypeError("INVALID_EMAIL_VERIFICATION_TOKEN_HASH");
  }
}

function validateEmailVerificationExpiresAt(expiresAt: unknown): asserts expiresAt is Date {
  if (
    !(expiresAt instanceof Date) ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    throw new TypeError("INVALID_EMAIL_VERIFICATION_EXPIRES_AT");
  }
}

function validateEmailVerificationNow(now: unknown): asserts now is Date {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("INVALID_EMAIL_VERIFICATION_NOW");
  }
}

function validatePasswordResetEmail(email: unknown): asserts email is string {
  if (
    typeof email !== "string" ||
    email === "" ||
    email !== email.trim() ||
    email !== email.toLowerCase() ||
    email.length > 254 ||
    !EMAIL_VERIFICATION_EMAIL_PATTERN.test(email)
  ) {
    throw new TypeError("INVALID_PASSWORD_RESET_EMAIL");
  }
}

function validatePasswordResetTokenHash(
  tokenHash: unknown
): asserts tokenHash is string {
  if (
    typeof tokenHash !== "string" ||
    !EMAIL_VERIFICATION_TOKEN_HASH_PATTERN.test(tokenHash)
  ) {
    throw new TypeError("INVALID_PASSWORD_RESET_TOKEN_HASH");
  }
}

function validatePasswordResetPasswordHash(
  passwordHash: unknown
): asserts passwordHash is string {
  if (typeof passwordHash !== "string" || passwordHash === "") {
    throw new TypeError("INVALID_PASSWORD_RESET_PASSWORD_HASH");
  }
}

function validatePasswordResetNow(now: unknown): asserts now is Date {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("INVALID_PASSWORD_RESET_NOW");
  }
}

function validatePasswordResetExpiresAt(
  expiresAt: unknown,
  now: Date
): asserts expiresAt is Date {
  if (
    !(expiresAt instanceof Date) ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() <= now.getTime()
  ) {
    throw new TypeError("INVALID_PASSWORD_RESET_EXPIRES_AT");
  }
}

function isEmailVerificationUniqueConflict(
  error: unknown,
  constraint: string,
  fields: readonly string[]
): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const meta = "meta" in error ? error.meta : undefined;
  const target =
    typeof meta === "object" && meta !== null && "target" in meta
      ? meta.target
      : undefined;

  return (
    target === constraint ||
    (Array.isArray(target) &&
      target.length === fields.length &&
      target.every((field, index) => field === fields[index]))
  );
}

function isEmailVerificationUserEmailConflict(error: unknown): boolean {
  return isEmailVerificationUniqueConflict(error, "User_email_key", ["email"]);
}

function isEmailVerificationTokenHashConflict(error: unknown): boolean {
  return isEmailVerificationUniqueConflict(error, "UserToken_tokenHash_key", [
    "tokenHash"
  ]);
}

function isEmailVerificationUserTokenKindConflict(error: unknown): boolean {
  return isEmailVerificationUniqueConflict(error, "UserToken_userId_kind_key", [
    "userId",
    "kind"
  ]);
}

function isPasswordResetTokenHashConflict(error: unknown): boolean {
  return isEmailVerificationUniqueConflict(error, "UserToken_tokenHash_key", [
    "tokenHash"
  ]);
}

function isPasswordResetUserTokenKindConflict(error: unknown): boolean {
  return isEmailVerificationUniqueConflict(error, "UserToken_userId_kind_key", [
    "userId",
    "kind"
  ]);
}

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

const DEFAULT_USER_QUOTA_CREDITS = 20;
const USER_QUOTA_MAX_CREDITS = 2_147_483_647;

export const IMAGE_CREDIT_EVENT_SOURCE_TYPES = {
  CHARGE: "IMAGE_CHARGE",
  RELEASE: "IMAGE_RELEASE"
} as const;

export const VIDEO_CREDIT_EVENT_SOURCE_TYPES = {
  CHARGE: "VIDEO_CHARGE",
  RELEASE: "VIDEO_RELEASE"
} as const;

export type ImageCreditEventPath = keyof typeof IMAGE_CREDIT_EVENT_SOURCE_TYPES;

export function imageCreditEventContract(
  path: ImageCreditEventPath,
  reservationId: string
): Pick<
  CreateAccountCreditEventInput,
  "sourceType" | "sourceId" | "idempotencyKey"
> {
  const idempotencyPrefix = path === "CHARGE" ? "image-charge" : "image-release";

  return {
    sourceType: IMAGE_CREDIT_EVENT_SOURCE_TYPES[path],
    sourceId: reservationId,
    idempotencyKey: `${idempotencyPrefix}:${reservationId}`
  };
}

export function videoCreditEventContract(
  path: ImageCreditEventPath,
  reservationId: string
): Pick<
  CreateAccountCreditEventInput,
  "sourceType" | "sourceId" | "idempotencyKey"
> {
  const idempotencyPrefix = path === "CHARGE" ? "video-charge" : "video-release";

  return {
    sourceType: VIDEO_CREDIT_EVENT_SOURCE_TYPES[path],
    sourceId: reservationId,
    idempotencyKey: `${idempotencyPrefix}:${reservationId}`
  };
}

function generationCreditEventContract(
  kind: CreditReservationKind,
  path: ImageCreditEventPath,
  reservationId: string
): Pick<
  CreateAccountCreditEventInput,
  "sourceType" | "sourceId" | "idempotencyKey"
> {
  return kind === CreditReservationKind.VIDEO_GENERATION
    ? videoCreditEventContract(path, reservationId)
    : imageCreditEventContract(path, reservationId);
}

export const STORAGE_CREDIT_EVENT_SOURCE_TYPES = {
  PURCHASE: "STORAGE_PACKAGE_CHARGE"
} as const;

export function storagePurchaseCreditEventContract(
  subscriptionId: string,
  requestIdempotencyKey: string
): Pick<
  CreateAccountCreditEventInput,
  "sourceType" | "sourceId" | "idempotencyKey"
> {
  return {
    sourceType: STORAGE_CREDIT_EVENT_SOURCE_TYPES.PURCHASE,
    sourceId: subscriptionId,
    idempotencyKey: `storage-purchase:${requestIdempotencyKey}`
  };
}

export const CHECKIN_CREDIT_EVENT_SOURCE_TYPES = {
  REWARD: "CHECKIN_REWARD"
} as const;

export function dailyCheckInCreditEventContract(
  userId: string,
  dateKey: string,
  checkInId: string
): Pick<
  CreateAccountCreditEventInput,
  "sourceType" | "sourceId" | "idempotencyKey"
> {
  return {
    sourceType: CHECKIN_CREDIT_EVENT_SOURCE_TYPES.REWARD,
    sourceId: checkInId,
    idempotencyKey: `check-in:${userId}:${dateKey}`
  };
}

export const INITIAL_CREDIT_EVENT_SOURCE_TYPES = {
  CREATE_USER: "USER_INITIAL_GRANT",
  REGISTER_UNVERIFIED: "REGISTER_UNVERIFIED_INITIAL_GRANT",
  QUOTA_INITIALIZE: "QUOTA_INITIALIZE"
} as const;

export type InitialCreditEventPath = keyof typeof INITIAL_CREDIT_EVENT_SOURCE_TYPES;

export function initialCreditEventContract(
  path: InitialCreditEventPath,
  userId: string,
  sourceId: string
): Pick<CreateAccountCreditEventInput, "sourceType" | "sourceId" | "idempotencyKey"> {
  const idempotencyPrefix =
    path === "CREATE_USER"
      ? "user-init"
      : path === "REGISTER_UNVERIFIED"
        ? "register-init"
        : "quota-init";

  return {
    sourceType: INITIAL_CREDIT_EVENT_SOURCE_TYPES[path],
    sourceId,
    idempotencyKey: `${idempotencyPrefix}:${userId}`
  };
}

async function createInitialUserQuotaInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    path: InitialCreditEventPath;
    remainingCredits?: number;
    afterCreditEventCreated?: (input: {
      sourceType: string;
      sourceId: string;
    }) => Promise<void>;
  }
): Promise<{ id: string; userId: string; remainingCredits: number }> {
  const quota = await tx.userQuota.create({
    data: {
      userId: input.userId,
      remainingCredits: validateAdminQuotaCredits(
        input.remainingCredits ?? DEFAULT_USER_QUOTA_CREDITS
      )
    }
  });

  if (quota.remainingCredits > 0) {
    const eventResult = await createAccountCreditEventInTransaction(tx, {
      userId: input.userId,
      deltaCredits: quota.remainingCredits,
      balanceBefore: 0,
      balanceAfter: quota.remainingCredits,
      ...initialCreditEventContract(
        input.path,
        input.userId,
        input.path === "QUOTA_INITIALIZE" ? quota.id : input.userId
      )
    });
    if (eventResult.status !== "CREATED") {
      throw new Error("ACCOUNT_CREDIT_EVENT_IDEMPOTENCY_CONFLICT");
    }
    await input.afterCreditEventCreated?.({
      sourceType: eventResult.event.sourceType,
      sourceId: eventResult.event.sourceId
    });
  }

  return quota;
}

function validateAdminQuotaCredits(remainingCredits: number): number {
  if (
    !Number.isInteger(remainingCredits) ||
    remainingCredits < 0 ||
    remainingCredits > USER_QUOTA_MAX_CREDITS
  ) {
    throw new TypeError("INVALID_ADMIN_QUOTA_CREDITS");
  }

  return remainingCredits;
}

async function createAuditLogInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    adminUserId: string;
    adminEmail: string;
    action: string;
    targetType: string;
    targetId?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }
): Promise<AdminAuditLogEntry> {
  const log = await tx.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      adminEmail: input.adminEmail,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      summary: input.summary,
      metadata: input.metadata
        ? (redactSensitiveMetadata(input.metadata) as Prisma.InputJsonObject)
        : undefined
    }
  });

  return toAdminAuditLogEntry(log);
}

type PaidOrderRecord = Prisma.OrderGetPayload<{
  include: { plan: true; user: true };
}>;

interface MarkPaidOrderTransactionInput {
  orderId: string;
  paidAt: Date;
  providerTradeNo?: string;
  paymentType?: string;
  eventSourceType: "PAYMENT_PAID" | "ADMIN_MANUAL_PAID";
  auditActor?: AdminFinancialActor;
  afterAuditLogCreated?: PrismaUserStoreTestHooks["afterFinancialAuditLogCreated"];
  afterCreditEventCreated?: PrismaUserStoreTestHooks["afterFinancialCreditEventCreated"];
}

type MarkPaidOrderTransactionResult =
  | {
      status: "PAID";
      order: PaidOrderRecord;
      alreadyPaid: false;
      creditEvent: AccountCreditEventRecord | null;
      auditLog: AdminAuditLogEntry | null;
    }
  | {
      status: "ALREADY_PAID";
      order: PaidOrderRecord;
      alreadyPaid: true;
      creditEvent: AccountCreditEventRecord | null;
      auditLog: AdminAuditLogEntry | null;
    }
  | {
      status:
        | "ORDER_NOT_FOUND"
        | "PAYMENT_REFERENCE_CONFLICT"
        | "PAYMENT_TYPE_MISMATCH"
        | "INVALID_ORDER_STATE";
      order: null;
      alreadyPaid: false;
    };

interface ValidatedPaymentAttemptSettlementInput {
  provider: string;
  providerMerchantRef: string;
  paymentType: string;
  merchantTradeNo: string;
  providerTradeNo: string;
  providerTradeIdentityHash: Buffer;
  amountCents: number;
  paidAt: Date;
}

class PaymentAttemptSettlementCasError extends Error {
  constructor() {
    super("PAYMENT_ATTEMPT_SETTLEMENT_CAS_CONFLICT");
  }
}

class LegacyPaymentAttemptMaterializationRollbackError extends Error {
  constructor(
    readonly result: SettlePaymentAttemptFromCallbackResult
  ) {
    super("LEGACY_PAYMENT_ATTEMPT_MATERIALIZATION_ROLLBACK");
  }
}

function validatePaymentAttemptSettlementInput(
  input: SettlePaymentAttemptFromCallbackInput
): ValidatedPaymentAttemptSettlementInput {
  const identity = validatePaymentAttemptCallbackIdentity({
    provider: input.provider,
    providerMerchantRef: input.providerMerchantRef,
    paymentType: input.paymentType,
    merchantTradeNo: input.merchantTradeNo,
    providerTradeNo: input.providerTradeNo
  });

  if (
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents < 0 ||
    input.amountCents > 2_147_483_647
  ) {
    throw new TypeError("INVALID_PAYMENT_ATTEMPT_AMOUNT");
  }
  if (
    !(input.paidAt instanceof Date) ||
    !Number.isFinite(input.paidAt.getTime())
  ) {
    throw new TypeError("INVALID_PAYMENT_ATTEMPT_PAID_AT");
  }

  return {
    ...identity,
    providerTradeIdentityHash: createProviderTradeIdentityHash(identity),
    amountCents: input.amountCents,
    paidAt: input.paidAt
  };
}

function isSuccessfulPaymentAttemptSettlementResult(
  result: SettlePaymentAttemptFromCallbackResult
): result is Extract<
  SettlePaymentAttemptFromCallbackResult,
  { orderId: string; paymentAttemptId: string }
> {
  return "orderId" in result;
}

function validateHistoricalLegacyPaymentOrder(
  order: PaidOrderRecord,
  input: ValidatedPaymentAttemptSettlementInput & { orderId: string }
): SettlePaymentAttemptFromCallbackResult | null {
  if (
    order.id !== input.orderId ||
    (order.paymentProvider !== null &&
      order.paymentProvider !== input.provider) ||
    order.paymentType !== input.paymentType ||
    order.paymentTradeNo !== input.merchantTradeNo
  ) {
    return { status: "PAYMENT_IDENTITY_MISMATCH" };
  }
  if (order.amount !== input.amountCents) {
    return { status: "PAYMENT_AMOUNT_MISMATCH" };
  }

  if (order.status === "PENDING" || order.status === "CANCELLED") {
    return order.providerTradeNo === null && order.paidAt === null
      ? null
      : { status: "INVALID_PAYMENT_STATE" };
  }

  if (
    order.status !== "PAID" ||
    order.providerTradeNo === null ||
    !(order.paidAt instanceof Date) ||
    !Number.isFinite(order.paidAt.getTime())
  ) {
    return { status: "INVALID_PAYMENT_STATE" };
  }
  if (order.providerTradeNo !== input.providerTradeNo) {
    return { status: "PAYMENT_REFERENCE_CONFLICT" };
  }

  return null;
}

async function settleStrictInitialPaymentAttemptInTransaction(
  tx: Prisma.TransactionClient,
  input: ValidatedPaymentAttemptSettlementInput & { orderId: string },
  testHooks: PrismaUserStoreTestHooks | undefined
): Promise<SettlePaymentAttemptFromCallbackResult> {
  const [merchantAttemptRow, ordinalAttemptRow] = await Promise.all([
    tx.paymentAttempt.findUnique({
      where: { merchantTradeNo: input.merchantTradeNo }
    }),
    tx.paymentAttempt.findUnique({
      where: {
        orderId_ordinal: {
          orderId: input.orderId,
          ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL
        }
      }
    })
  ]);

  if (!merchantAttemptRow || !ordinalAttemptRow) {
    return { status: "PAYMENT_REFERENCE_CONFLICT" };
  }

  let merchantAttempt: PaymentAttemptRecord;
  let ordinalAttempt: PaymentAttemptRecord;
  try {
    merchantAttempt = toPaymentAttemptRecord(merchantAttemptRow);
    ordinalAttempt = toPaymentAttemptRecord(ordinalAttemptRow);
  } catch {
    return { status: "INVALID_PAYMENT_STATE" };
  }

  if (
    merchantAttempt.id !== ordinalAttempt.id ||
    merchantAttempt.orderId !== input.orderId ||
    merchantAttempt.ordinal !== INITIAL_PAYMENT_ATTEMPT_ORDINAL ||
    merchantAttempt.provider !== input.provider ||
    merchantAttempt.providerMerchantRef !== input.providerMerchantRef ||
    merchantAttempt.paymentType !== input.paymentType ||
    merchantAttempt.merchantTradeNo !== input.merchantTradeNo
  ) {
    return { status: "PAYMENT_REFERENCE_CONFLICT" };
  }

  return settlePaymentAttemptInTransaction(tx, input, testHooks);
}

async function materializeLegacyPaymentAttemptInTransaction(
  tx: Prisma.TransactionClient,
  input: ValidatedPaymentAttemptSettlementInput & { orderId: string },
  testHooks: PrismaUserStoreTestHooks | undefined
): Promise<SettlePaymentAttemptFromCallbackResult> {
  let order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { plan: true, user: true }
  });
  if (!order) {
    return { status: "ORDER_NOT_FOUND" };
  }

  const [merchantAttempt, ordinalAttempt] = await Promise.all([
    tx.paymentAttempt.findUnique({
      where: { merchantTradeNo: input.merchantTradeNo }
    }),
    tx.paymentAttempt.findUnique({
      where: {
        orderId_ordinal: {
          orderId: input.orderId,
          ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL
        }
      }
    })
  ]);
  if (merchantAttempt || ordinalAttempt) {
    return settleStrictInitialPaymentAttemptInTransaction(
      tx,
      input,
      testHooks
    );
  }

  const initialValidation = validateHistoricalLegacyPaymentOrder(order, input);
  if (initialValidation) {
    return initialValidation;
  }

  if (order.paymentProvider === null) {
    const normalized = await tx.order.updateMany({
      where: {
        id: input.orderId,
        paymentProvider: null,
        paymentType: input.paymentType,
        paymentTradeNo: input.merchantTradeNo,
        amount: input.amountCents
      },
      data: { paymentProvider: input.provider }
    });
    if (normalized.count !== 0 && normalized.count !== 1) {
      throw new LegacyPaymentAttemptMaterializationRollbackError({
        status: "INVALID_PAYMENT_STATE"
      });
    }

    order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { plan: true, user: true }
    });
    if (!order) {
      throw new LegacyPaymentAttemptMaterializationRollbackError({
        status: "ORDER_NOT_FOUND"
      });
    }
    const authoritativeValidation = validateHistoricalLegacyPaymentOrder(
      order,
      input
    );
    if (
      order.paymentProvider !== input.provider ||
      authoritativeValidation !== null
    ) {
      throw new LegacyPaymentAttemptMaterializationRollbackError(
        authoritativeValidation ?? {
          status: "PAYMENT_IDENTITY_MISMATCH"
        }
      );
    }
  }

  await tx.paymentAttempt.create({
    data: {
      orderId: input.orderId,
      ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
      provider: input.provider,
      providerMerchantRef: input.providerMerchantRef,
      paymentType: input.paymentType,
      merchantTradeNo: input.merchantTradeNo,
      providerTradeNo: null,
      providerTradeIdentityHash: null,
      status: "ACTIVE",
      paidAt: null
    }
  });

  const result = await settlePaymentAttemptInTransaction(tx, input, testHooks);
  if (!isSuccessfulPaymentAttemptSettlementResult(result)) {
    throw new LegacyPaymentAttemptMaterializationRollbackError(result);
  }

  return result;
}

function paymentAttemptIdentityMatchesCallback(
  attempt: PaymentAttemptRecord,
  input: ValidatedPaymentAttemptSettlementInput
): boolean {
  return (
    attempt.provider === input.provider &&
    attempt.providerMerchantRef === input.providerMerchantRef &&
    attempt.paymentType === input.paymentType &&
    attempt.merchantTradeNo === input.merchantTradeNo
  );
}

function hasNoPaymentAttemptReceipt(attempt: PaymentAttemptRecord): boolean {
  return (
    attempt.providerTradeNo === null &&
    attempt.providerTradeIdentityHash === null &&
    attempt.paidAt === null
  );
}

function hasCompletePaymentAttemptReceipt(
  attempt: PaymentAttemptRecord
): boolean {
  return (
    attempt.providerTradeNo !== null &&
    attempt.providerTradeIdentityHash !== null &&
    attempt.paidAt instanceof Date &&
    Number.isFinite(attempt.paidAt.getTime())
  );
}

function hasExactPaymentAttemptReceipt(
  attempt: PaymentAttemptRecord,
  input: ValidatedPaymentAttemptSettlementInput
): boolean {
  return (
    hasCompletePaymentAttemptReceipt(attempt) &&
    attempt.providerTradeNo === input.providerTradeNo &&
    attempt.providerTradeIdentityHash?.equals(
      input.providerTradeIdentityHash
    ) === true
  );
}

function successfulPaymentAttemptSettlementResult(
  status: Extract<
    SettlePaymentAttemptFromCallbackResult["status"],
    | "PAID"
    | "EXACT_PAID_REPLAY"
    | "PAID_REQUIRES_REVIEW"
    | "EXACT_REVIEW_REPLAY"
    | "PAID_EVIDENCE_RECONCILED"
  >,
  attempt: PaymentAttemptRecord
): SettlePaymentAttemptFromCallbackResult {
  return {
    status,
    orderId: attempt.orderId,
    paymentAttemptId: attempt.id
  };
}

function classifyTerminalPaymentAttempt(
  attempt: PaymentAttemptRecord,
  order: PaidOrderRecord,
  input: ValidatedPaymentAttemptSettlementInput
): SettlePaymentAttemptFromCallbackResult {
  if (!hasCompletePaymentAttemptReceipt(attempt)) {
    return { status: "INVALID_PAYMENT_STATE" };
  }
  if (!hasExactPaymentAttemptReceipt(attempt, input)) {
    return { status: "PAYMENT_REFERENCE_CONFLICT" };
  }

  if (attempt.status === "PAID") {
    if (
      order.status !== "PAID" ||
      order.paymentTradeNo !== attempt.merchantTradeNo ||
      order.providerTradeNo !== input.providerTradeNo ||
      !(order.paidAt instanceof Date) ||
      !Number.isFinite(order.paidAt.getTime()) ||
      attempt.paidAt?.getTime() !== order.paidAt.getTime()
    ) {
      return { status: "INVALID_PAYMENT_STATE" };
    }
    return successfulPaymentAttemptSettlementResult(
      "EXACT_PAID_REPLAY",
      attempt
    );
  }

  if (attempt.status === "PAID_REQUIRES_REVIEW") {
    const coherentCancelledOrder =
      order.status === "CANCELLED" &&
      order.providerTradeNo === null &&
      order.paidAt === null;
    const coherentNonWinningPaidOrder =
      order.status === "PAID" &&
      order.paidAt instanceof Date &&
      Number.isFinite(order.paidAt.getTime()) &&
      (order.providerTradeNo === null ||
        (order.providerTradeNo !== input.providerTradeNo &&
          order.paymentTradeNo !== attempt.merchantTradeNo));
    if (!coherentCancelledOrder && !coherentNonWinningPaidOrder) {
      return { status: "INVALID_PAYMENT_STATE" };
    }
    return successfulPaymentAttemptSettlementResult(
      "EXACT_REVIEW_REPLAY",
      attempt
    );
  }

  return { status: "INVALID_PAYMENT_STATE" };
}

async function isPaymentAttemptOrderIdentityCompatible(
  tx: Prisma.TransactionClient,
  order: PaidOrderRecord,
  attempt: PaymentAttemptRecord
): Promise<boolean> {
  if (
    order.id !== attempt.orderId ||
    order.paymentProvider !== attempt.provider ||
    order.paymentType !== attempt.paymentType
  ) {
    return false;
  }

  if (order.paymentTradeNo === attempt.merchantTradeNo) {
    return true;
  }

  // PF-1B-2A allows only the mirrored/current Attempt to win PENDING. The
  // ordinal>1 relaxation exists solely to record a real non-winning payment
  // after another settlement has already made the Order PAID.
  if (
    order.status !== "PAID" ||
    attempt.ordinal === INITIAL_PAYMENT_ATTEMPT_ORDINAL ||
    order.paymentTradeNo === null
  ) {
    return false;
  }

  const initialAttempt = await tx.paymentAttempt.findUnique({
    where: {
      orderId_ordinal: {
        orderId: order.id,
        ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL
      }
    }
  });
  if (!initialAttempt) {
    return false;
  }

  let mappedInitialAttempt: PaymentAttemptRecord;
  try {
    mappedInitialAttempt = toPaymentAttemptRecord(initialAttempt);
  } catch {
    return false;
  }

  return (
    mappedInitialAttempt.orderId === order.id &&
    mappedInitialAttempt.provider === attempt.provider &&
    mappedInitialAttempt.paymentType === attempt.paymentType &&
    mappedInitialAttempt.merchantTradeNo === order.paymentTradeNo
  );
}

async function persistPaymentAttemptReceipt(
  tx: Prisma.TransactionClient,
  attempt: PaymentAttemptRecord,
  input: ValidatedPaymentAttemptSettlementInput,
  targetStatus: "PAID" | "PAID_REQUIRES_REVIEW",
  resultStatus:
    | "PAID"
    | "PAID_REQUIRES_REVIEW"
    | "PAID_EVIDENCE_RECONCILED",
  paidAt: Date,
  financialWritesStaged: boolean
): Promise<SettlePaymentAttemptFromCallbackResult> {
  const update = await tx.paymentAttempt.updateMany({
    where: {
      id: attempt.id,
      orderId: attempt.orderId,
      provider: attempt.provider,
      providerMerchantRef: attempt.providerMerchantRef,
      paymentType: attempt.paymentType,
      merchantTradeNo: attempt.merchantTradeNo,
      status: attempt.status,
      providerTradeNo: null,
      providerTradeIdentityHash: null,
      paidAt: null
    },
    data: {
      providerTradeNo: input.providerTradeNo,
      providerTradeIdentityHash: Uint8Array.from(
        input.providerTradeIdentityHash
      ),
      paidAt,
      status: targetStatus
    }
  });

  if (update.count === 1) {
    return successfulPaymentAttemptSettlementResult(resultStatus, attempt);
  }

  if (financialWritesStaged) {
    throw new PaymentAttemptSettlementCasError();
  }

  const currentAttemptRow = await tx.paymentAttempt.findUnique({
    where: { merchantTradeNo: input.merchantTradeNo }
  });
  if (!currentAttemptRow) {
    return { status: "PAYMENT_ATTEMPT_NOT_FOUND" };
  }

  let currentAttempt: PaymentAttemptRecord;
  try {
    currentAttempt = toPaymentAttemptRecord(currentAttemptRow);
  } catch {
    return { status: "INVALID_PAYMENT_STATE" };
  }
  if (
    currentAttempt.id !== attempt.id ||
    currentAttempt.orderId !== attempt.orderId ||
    !paymentAttemptIdentityMatchesCallback(currentAttempt, input)
  ) {
    return { status: "PAYMENT_IDENTITY_MISMATCH" };
  }

  const currentOrder = await tx.order.findUnique({
    where: { id: currentAttempt.orderId },
    include: { plan: true, user: true }
  });
  if (!currentOrder) {
    return { status: "ORDER_NOT_FOUND" };
  }

  if (
    !(await isPaymentAttemptOrderIdentityCompatible(
      tx,
      currentOrder,
      currentAttempt
    ))
  ) {
    return { status: "PAYMENT_IDENTITY_MISMATCH" };
  }
  if (currentOrder.amount !== input.amountCents) {
    return { status: "PAYMENT_AMOUNT_MISMATCH" };
  }

  return classifyTerminalPaymentAttempt(currentAttempt, currentOrder, input);
}

async function markPaidOrderInTransaction(
  tx: Prisma.TransactionClient,
  input: MarkPaidOrderTransactionInput
): Promise<MarkPaidOrderTransactionResult> {
  if (!(input.paidAt instanceof Date) || !Number.isFinite(input.paidAt.getTime())) {
    throw new TypeError("INVALID_ORDER_PAID_AT");
  }

  const existing = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { plan: true, user: true }
  });

  if (!existing) {
    return {
      status: "ORDER_NOT_FOUND",
      order: null,
      alreadyPaid: false
    };
  }

  if (
    input.paymentType !== undefined &&
    existing.paymentType !== input.paymentType
  ) {
    return {
      status: "PAYMENT_TYPE_MISMATCH",
      order: null,
      alreadyPaid: false
    };
  }

  if (existing.status === "CANCELLED") {
    if (input.auditActor) {
      throw new Error("ORDER_CANCELLED_CANNOT_BE_PAID");
    }
    return {
      status: "INVALID_ORDER_STATE",
      order: null,
      alreadyPaid: false
    };
  }

  if (existing.status === "PAID") {
    if (
      input.paymentType !== undefined &&
      input.providerTradeNo !== undefined &&
      existing.providerTradeNo !== null &&
      existing.providerTradeNo !== input.providerTradeNo
    ) {
      return {
        status: "PAYMENT_REFERENCE_CONFLICT",
        order: null,
        alreadyPaid: false
      };
    }

    return {
      status: "ALREADY_PAID",
      order: existing,
      alreadyPaid: true,
      creditEvent: null,
      auditLog: null
    };
  }

  if (
    !Number.isSafeInteger(existing.credits) ||
    existing.credits <= 0 ||
    existing.credits > USER_QUOTA_MAX_CREDITS
  ) {
    throw new Error("ORDER_CREDITS_INVALID");
  }

  const statusUpdate = await tx.order.updateMany({
    where: {
      id: input.orderId,
      status: "PENDING"
    },
    data: {
      status: "PAID",
      paidAt: input.paidAt,
      ...(input.providerTradeNo !== undefined
        ? { providerTradeNo: input.providerTradeNo }
        : {})
    }
  });

  const paidOrder = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { plan: true, user: true }
  });

  if (!paidOrder) {
    return {
      status: "ORDER_NOT_FOUND",
      order: null,
      alreadyPaid: false
    };
  }

  if (statusUpdate.count === 0) {
    if (paidOrder.status === "PAID") {
      if (
        input.paymentType !== undefined &&
        input.providerTradeNo !== undefined &&
        paidOrder.providerTradeNo !== null &&
        paidOrder.providerTradeNo !== input.providerTradeNo
      ) {
        return {
          status: "PAYMENT_REFERENCE_CONFLICT",
          order: null,
          alreadyPaid: false
        };
      }

      return {
        status: "ALREADY_PAID",
        order: paidOrder,
        alreadyPaid: true,
        creditEvent: null,
        auditLog: null
      };
    }

    if (paidOrder.status === "CANCELLED" && input.auditActor) {
      throw new Error("ORDER_CANCELLED_CANNOT_BE_PAID");
    }
    return {
      status: "INVALID_ORDER_STATE",
      order: null,
      alreadyPaid: false
    };
  }

  const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM User
    WHERE id = ${paidOrder.userId}
    FOR UPDATE
  `);
  if (lockedUsers.length === 0) {
    throw new Error("ORDER_USER_NOT_FOUND");
  }

  const lockedQuotas = await tx.$queryRaw<
    Array<{ userId: string; remainingCredits: number }>
  >(Prisma.sql`
    SELECT userId, remainingCredits
    FROM UserQuota
    WHERE userId = ${paidOrder.userId}
    FOR UPDATE
  `);
  const balanceBefore =
    lockedQuotas[0]?.remainingCredits ?? DEFAULT_USER_QUOTA_CREDITS;
  validateAdminQuotaCredits(balanceBefore);
  const balanceAfter = balanceBefore + paidOrder.credits;
  validateAdminQuotaCredits(balanceAfter);
  const idempotencyKey = `${input.eventSourceType === "PAYMENT_PAID" ? "payment-paid" : "admin-paid"}:${paidOrder.id}`;

  const auditLog = input.auditActor
    ? await createAuditLogInTransaction(tx, {
        ...input.auditActor,
        action: "UPDATE_ORDER_STATUS",
        targetType: "Order",
        targetId: paidOrder.id,
        summary: "Admin marked an order as PAID.",
        metadata: {
          orderId: paidOrder.id,
          userId: paidOrder.userId,
          credits: paidOrder.credits,
          oldStatus: "PENDING",
          newStatus: "PAID",
          creditChangeStatus: "RECORDED",
          creditEventSourceId: paidOrder.id,
          creditEventIdempotencyKey: idempotencyKey
        }
      })
    : null;
  if (auditLog && input.afterAuditLogCreated) {
    await input.afterAuditLogCreated({
      action: auditLog.action,
      targetId: auditLog.targetId ?? paidOrder.id
    });
  }

  if (lockedQuotas.length === 0) {
    await tx.userQuota.create({
      data: {
        userId: paidOrder.userId,
        remainingCredits: balanceAfter
      }
    });
  } else {
    await tx.userQuota.update({
      where: { userId: paidOrder.userId },
      data: { remainingCredits: balanceAfter }
    });
  }

  const eventResult = await createAccountCreditEventInTransaction(tx, {
    userId: paidOrder.userId,
    deltaCredits: paidOrder.credits,
    balanceBefore,
    balanceAfter,
    sourceType: input.eventSourceType,
    sourceId: paidOrder.id,
    idempotencyKey,
    metadata: {
      orderId: paidOrder.id,
      credits: paidOrder.credits,
      balanceBefore,
      balanceAfter,
      ...(auditLog ? { adminAuditId: auditLog.id } : {})
    }
  });
  if (eventResult.status !== "CREATED") {
    throw new Error("ACCOUNT_CREDIT_EVENT_IDEMPOTENCY_CONFLICT");
  }
  if (input.afterCreditEventCreated) {
    await input.afterCreditEventCreated({
      sourceType: eventResult.event.sourceType,
      sourceId: eventResult.event.sourceId
    });
  }

  return {
    status: "PAID",
    order: paidOrder,
    alreadyPaid: false,
    creditEvent: eventResult.event,
    auditLog
  };
}

async function settleUnpaidPaymentAttemptAgainstTerminalOrder(
  tx: Prisma.TransactionClient,
  attempt: PaymentAttemptRecord,
  order: PaidOrderRecord,
  input: ValidatedPaymentAttemptSettlementInput
): Promise<SettlePaymentAttemptFromCallbackResult> {
  if (order.status === "CANCELLED") {
    if (order.providerTradeNo !== null || order.paidAt !== null) {
      return { status: "INVALID_PAYMENT_STATE" };
    }
    return persistPaymentAttemptReceipt(
      tx,
      attempt,
      input,
      "PAID_REQUIRES_REVIEW",
      "PAID_REQUIRES_REVIEW",
      input.paidAt,
      false
    );
  }

  if (order.status === "PAID") {
    if (
      !(order.paidAt instanceof Date) ||
      !Number.isFinite(order.paidAt.getTime())
    ) {
      return { status: "INVALID_PAYMENT_STATE" };
    }

    if (order.providerTradeNo === input.providerTradeNo) {
      if (order.paymentTradeNo !== attempt.merchantTradeNo) {
        return { status: "PAYMENT_REFERENCE_CONFLICT" };
      }
      return persistPaymentAttemptReceipt(
        tx,
        attempt,
        input,
        "PAID",
        "PAID_EVIDENCE_RECONCILED",
        order.paidAt,
        false
      );
    }

    if (
      order.providerTradeNo !== null &&
      order.paymentTradeNo === attempt.merchantTradeNo
    ) {
      return { status: "PAYMENT_REFERENCE_CONFLICT" };
    }

    return persistPaymentAttemptReceipt(
      tx,
      attempt,
      input,
      "PAID_REQUIRES_REVIEW",
      "PAID_REQUIRES_REVIEW",
      input.paidAt,
      false
    );
  }

  return { status: "INVALID_PAYMENT_STATE" };
}

async function settlePaymentAttemptInTransaction(
  tx: Prisma.TransactionClient,
  input: ValidatedPaymentAttemptSettlementInput,
  testHooks: PrismaUserStoreTestHooks | undefined
): Promise<SettlePaymentAttemptFromCallbackResult> {
  const attemptRow = await tx.paymentAttempt.findUnique({
    where: { merchantTradeNo: input.merchantTradeNo }
  });
  if (!attemptRow) {
    return { status: "PAYMENT_ATTEMPT_NOT_FOUND" };
  }

  let attempt: PaymentAttemptRecord;
  try {
    attempt = toPaymentAttemptRecord(attemptRow);
  } catch {
    return { status: "INVALID_PAYMENT_STATE" };
  }
  if (!paymentAttemptIdentityMatchesCallback(attempt, input)) {
    return { status: "PAYMENT_IDENTITY_MISMATCH" };
  }

  const order = await tx.order.findUnique({
    where: { id: attempt.orderId },
    include: { plan: true, user: true }
  });
  if (!order) {
    return { status: "ORDER_NOT_FOUND" };
  }
  if (!(await isPaymentAttemptOrderIdentityCompatible(tx, order, attempt))) {
    return { status: "PAYMENT_IDENTITY_MISMATCH" };
  }
  if (order.amount !== input.amountCents) {
    return { status: "PAYMENT_AMOUNT_MISMATCH" };
  }

  if (
    attempt.status === "PAID" ||
    attempt.status === "PAID_REQUIRES_REVIEW"
  ) {
    return classifyTerminalPaymentAttempt(attempt, order, input);
  }
  if (
    (attempt.status !== "ACTIVE" && attempt.status !== "RETIRED") ||
    !hasNoPaymentAttemptReceipt(attempt)
  ) {
    return { status: "INVALID_PAYMENT_STATE" };
  }

  if (order.status === "CANCELLED" || order.status === "PAID") {
    return settleUnpaidPaymentAttemptAgainstTerminalOrder(
      tx,
      attempt,
      order,
      input
    );
  }

  if (
    order.status !== "PENDING" ||
    order.providerTradeNo !== null ||
    order.paidAt !== null
  ) {
    return { status: "INVALID_PAYMENT_STATE" };
  }

  const financialResult = await markPaidOrderInTransaction(tx, {
    orderId: order.id,
    paidAt: input.paidAt,
    providerTradeNo: input.providerTradeNo,
    paymentType: input.paymentType,
    eventSourceType: "PAYMENT_PAID",
    afterCreditEventCreated: testHooks?.afterFinancialCreditEventCreated
  });

  if (financialResult.status === "PAID") {
    return persistPaymentAttemptReceipt(
      tx,
      attempt,
      input,
      "PAID",
      "PAID",
      input.paidAt,
      true
    );
  }

  const currentOrder = await tx.order.findUnique({
    where: { id: attempt.orderId },
    include: { plan: true, user: true }
  });
  if (!currentOrder) {
    return { status: "ORDER_NOT_FOUND" };
  }
  if (
    !(await isPaymentAttemptOrderIdentityCompatible(
      tx,
      currentOrder,
      attempt
    ))
  ) {
    return { status: "PAYMENT_IDENTITY_MISMATCH" };
  }
  if (currentOrder.amount !== input.amountCents) {
    return { status: "PAYMENT_AMOUNT_MISMATCH" };
  }

  if (
    currentOrder.status === "CANCELLED" ||
    currentOrder.status === "PAID"
  ) {
    return settleUnpaidPaymentAttemptAgainstTerminalOrder(
      tx,
      attempt,
      currentOrder,
      input
    );
  }

  return { status: "INVALID_PAYMENT_STATE" };
}

export interface PrismaUserStoreTestHooks {
  initialUserQuotaCredits?: number;
  afterFinancialAuditLogCreated?(input: {
    action: string;
    targetId: string;
  }): Promise<void>;
  afterFinancialCreditEventCreated?(input: {
    sourceType: string;
    sourceId: string;
  }): Promise<void>;
  afterChatCreditEventCreated?(input: {
    sourceType: string;
    sourceId: string;
  }): Promise<void>;
  afterStorageSubscriptionCreated?(input: {
    userId: string;
    subscriptionId: string;
  }): Promise<void>;
  afterStorageLedgerCreated?(input: {
    userId: string;
    subscriptionId: string;
  }): Promise<void>;
  afterDailyCheckInCreated?(input: {
    userId: string;
    checkInId: string;
    dateKey: string;
  }): Promise<void>;
  afterDailyLedgerCreated?(input: {
    userId: string;
    checkInId: string;
    dateKey: string;
  }): Promise<void>;
  afterCleanupStorageObjectLocked?(input: {
    phase: "tombstone" | "prepare" | "finalize";
    storageObjectId: string;
  }): Promise<void>;
  afterGeneratedStorageObjectLocked?(storageObjectId: string): Promise<void>;
}

export interface CreatePrismaUserStoreOptions {
  testHooks?: PrismaUserStoreTestHooks;
}

export function createPrismaUserStore(
  client = getPrismaClient(),
  options: CreatePrismaUserStoreOptions = {}
): UserStore &
  AccountCreditEventStore &
  Required<Pick<UserStore, "updateUserProfile">> &
  CreditReservationStore &
  ChatCreditStore &
  ChatCreditRecoveryStore &
  StorageObjectImageTaskCompletionStore &
  IdempotencyRequestStore &
  StorageObjectStore &
  StorageObjectCleanupStore &
  GeneratedStorageObjectCompensationStore &
  UserAvatarReferenceStore &
  AiAssetStorageObjectReferenceStore &
  PaymentAttemptReadStore &
  PaymentAttemptSettlementStore &
  LegacyPaymentAttemptMaterializationStore {
  const testHooks = options.testHooks;

  async function createImageCreditEvent(
    tx: Prisma.TransactionClient,
    input: CreateAccountCreditEventInput
  ): Promise<AccountCreditEventRecord> {
    const result = await createAccountCreditEventInTransaction(tx, input);
    if (result.status !== "CREATED") {
      throw new Error("IMAGE_CREDIT_EVENT_IDEMPOTENCY_CONFLICT");
    }
    await testHooks?.afterFinancialCreditEventCreated?.({
      sourceType: result.event.sourceType,
      sourceId: result.event.sourceId
    });
    return result.event;
  }

  async function createChatCreditEvent(
    tx: Prisma.TransactionClient,
    input: CreateAccountCreditEventInput
  ): Promise<AccountCreditEventRecord> {
    const result = await createAccountCreditEventInTransaction(tx, input);
    if (result.status !== "CREATED") {
      throw new Error("CHAT_CREDIT_EVENT_IDEMPOTENCY_CONFLICT");
    }
    await testHooks?.afterChatCreditEventCreated?.({
      sourceType: result.event.sourceType,
      sourceId: result.event.sourceId
    });
    return result.event;
  }

  return {
    async findUserByEmail(email) {
      const user = await client.user.findUnique({
        where: { email: email.toLowerCase() }
      });
      return user ? toUserRecord(user) : null;
    },
    async findUserById(id) {
      const user = await client.user.findUnique({
        where: { id }
      });
      return user ? toUserRecord(user) : null;
    },
    async recordSuccessfulLogin(userId, now) {
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("now must be a valid Date");
      }

      try {
        const user = await client.user.update({
          where: { id: userId },
          data: { lastLoginAt: now },
          select: { sessionVersion: true }
        });
        return { sessionVersion: user.sessionVersion };
      } catch (error) {
        if (isPrismaRecordNotFoundError(error)) {
          return null;
        }

        throw error;
      }
    },
    async getAccountOverview(userId, benefits, todayDate) {
      const user = await client.user.findUnique({
        where: { id: userId },
        include: {
          quota: true,
          storageSubscription: true,
          referralCode: true
        }
      });

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      const [paidOrder, checkIns, referralCount, referralRewards, ledgers, orders] =
        await Promise.all([
          client.order.findFirst({
            where: { userId, status: "PAID" },
            include: { plan: true },
            orderBy: { createdAt: "desc" }
          }),
          client.dailyCheckIn.findMany({
            where: { userId },
            orderBy: { checkInDate: "desc" },
            take: 7
          }),
          client.referralRelation.count({ where: { inviterId: userId } }),
          client.accountLedger.aggregate({
            where: { userId, kind: "REFERRAL_REWARD", status: "SUCCESS" },
            _sum: { creditsDelta: true }
          }),
          client.accountLedger.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 5
          }),
          client.order.findMany({
            where: { userId },
            include: { plan: true },
            orderBy: { createdAt: "desc" },
            take: 5
          })
        ]);

      const storage = toStoragePackageSummary(
        user.storageSubscription,
        benefits,
        new Date()
      );
      const checkIn = toCheckInSummary(checkIns, benefits, todayDate);
      const referralCode = await ensureReferralCode(client, userId, user.referralCode);
      const activities = mergeAccountActivities(orders, ledgers).slice(0, 5);
      const profile = toAuthUserRecord(user);

      return {
        profile,
        quota: {
          remainingCredits: Math.max(0, user.quota?.remainingCredits ?? 20)
        },
        plan: {
          name: paidOrder?.plan.name ?? DEFAULT_BASE_PLAN_NAME,
          status: paidOrder ? "ACTIVE" : "INACTIVE",
          expiresAt: null,
          nextBillingAt: null
        },
        storagePackage: storage,
        checkIn,
        referral: {
          enabled: benefits.referralEnabled,
          code: referralCode.code,
          invitedCount: referralCount,
          totalRewardCredits: Math.max(0, referralRewards._sum.creditsDelta ?? 0),
          inviterRewardCredits: benefits.referralInviterRewardCredits,
          inviteeRewardCredits: benefits.referralInviteeRewardCredits,
          rewardTrigger: benefits.referralRewardTrigger,
          rulesText: benefits.referralRulesText,
          registrationIntegration: "PREPARATION"
        },
        activities,
        benefits
      } satisfies AccountOverview;
    },
    async updateUserProfile(userId, input) {
      const user = await client.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {})
        }
      });
      return toUserRecord(user);
    },
    async saveAvatar(userId, avatarUrl) {
      const user = await client.user.update({
        where: { id: userId },
        data: { avatarUrl }
      });
      return toUserRecord(user);
    },
    async replaceUserAvatarReference(input) {
      const userId = normalizeStorageObjectUserId(input.userId);
      const avatarUrl =
        input.kind === "CLEARED"
          ? null
          : validateUserAvatarUrl(input.avatarUrl);
      const storageObjectId =
        input.kind === "LOCAL_STORAGE_OBJECT"
          ? normalizeStorageObjectId(input.storageObjectId)
          : null;

      return client.$transaction(
        async (tx) => {
          const users = await tx.$queryRaw<LockedUserAvatarReference[]>(
            Prisma.sql`
              SELECT \`id\`, \`avatarStorageObjectId\`
              FROM \`User\`
              WHERE \`id\` = ${userId}
              FOR UPDATE
            `
          );
          const currentUser = users[0];
          if (!currentUser) {
            return {
              status: "NOT_FOUND" as const,
              user: null,
              replacedStorageObjectId: null
            };
          }

          if (storageObjectId !== null) {
            const storageObjects =
              await tx.$queryRaw<LockedAvatarStorageObject[]>(
                Prisma.sql`
                  SELECT
                    \`id\`,
                    \`userId\`,
                    \`storageProvider\`,
                    \`mimeType\`,
                    \`sizeBytes\`,
                    \`sha256\`,
                    \`source\`,
                    \`status\`,
                    \`deletedAt\`
                  FROM \`StorageObject\`
                  WHERE \`id\` = ${storageObjectId}
                    AND \`userId\` = ${userId}
                  FOR UPDATE
                `
              );
            if (
              !isAvailableAvatarStorageObject(
                storageObjects[0],
                userId,
                storageObjectId
              )
            ) {
              return {
                status: "STORAGE_OBJECT_UNAVAILABLE" as const,
                user: null,
                replacedStorageObjectId: null
              };
            }
          }

          const replacedStorageObjectId =
            currentUser.avatarStorageObjectId === storageObjectId
              ? null
              : currentUser.avatarStorageObjectId;
          const user = await tx.user.update({
            where: { id: userId },
            data: {
              ...(input.profile?.name !== undefined
                ? { name: input.profile.name }
                : {}),
              avatarUrl,
              avatarStorageObjectId: storageObjectId
            }
          });

          return {
            status: "UPDATED" as const,
            user: toUserRecord(user),
            replacedStorageObjectId
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async activateStoragePackage(userId, input) {
      validateAdminQuotaCredits(input.priceCredits);
      const benefits: AccountBenefitSettings = {
        storagePackageEnabled: true,
        storagePackagePriceCredits: input.priceCredits,
        storagePackageDurationDays: input.durationDays,
        storagePackageAutoRenewEnabled: input.autoRenewEnabled,
        storagePackageDescription: input.description,
        checkInEnabled: true,
        checkInDailyRewardCredits: 0,
        checkInStreakRewards: {},
        referralEnabled: false,
        referralInviterRewardCredits: 0,
        referralInviteeRewardCredits: 0,
        referralRewardTrigger: "",
        referralRulesText: ""
      };

      const result = await client.$transaction(async (tx) => {
        const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM User
          WHERE id = ${userId}
          FOR UPDATE
        `);
        if (lockedUsers.length === 0) {
          throw new Error("USER_NOT_FOUND");
        }

        const existing = await tx.accountLedger.findUnique({
          where: { idempotencyKey: input.idempotencyKey }
        });
        if (existing) {
          if (existing.userId !== userId) {
            throw new Error("IDEMPOTENCY_KEY_ALREADY_USED");
          }
          const subscription = await tx.userStorageSubscription.findUnique({
            where: { userId }
          });
          const quota = await tx.userQuota.findUnique({ where: { userId } });
          if (!subscription) throw new Error("STORAGE_SUBSCRIPTION_NOT_FOUND");
          if (!quota) throw new Error("INSUFFICIENT_CREDITS");
          return {
            subscription,
            quota: toQuotaRecord(quota),
            alreadyActive: false
          };
        }

        const current = await tx.userStorageSubscription.findUnique({
          where: { userId }
        });
        const now = new Date();
        const lockedQuotas = await tx.$queryRaw<
          Array<{ userId: string; remainingCredits: number }>
        >(Prisma.sql`
          SELECT userId, remainingCredits
          FROM UserQuota
          WHERE userId = ${userId}
          FOR UPDATE
        `);
        const currentQuota = lockedQuotas[0];
        if (!currentQuota) {
          throw new Error("INSUFFICIENT_CREDITS");
        }
        validateAdminQuotaCredits(currentQuota.remainingCredits);

        if (current && current.expiresAt > now) {
          return {
            subscription: current,
            quota: toQuotaRecord(currentQuota),
            alreadyActive: true
          };
        }

        const updatedQuota = await tx.userQuota.updateMany({
          where: { userId, remainingCredits: { gte: input.priceCredits } },
          data: { remainingCredits: { decrement: input.priceCredits } }
        });
        if (updatedQuota.count === 0) {
          throw new Error("INSUFFICIENT_CREDITS");
        }

        const afterQuotaRows = await tx.$queryRaw<
          Array<{ userId: string; remainingCredits: number }>
        >(Prisma.sql`
          SELECT userId, remainingCredits
          FROM UserQuota
          WHERE userId = ${userId}
          FOR UPDATE
        `);
        const afterQuota = afterQuotaRows[0];
        if (!afterQuota) {
          throw new Error("QUOTA_NOT_FOUND_AFTER_UPDATE");
        }
        validateAdminQuotaCredits(afterQuota.remainingCredits);

        const subscription = await tx.userStorageSubscription.upsert({
          where: { userId },
          update: {
            priceCredits: input.priceCredits,
            durationDays: input.durationDays,
            startsAt: now,
            expiresAt: addDays(now, input.durationDays),
            autoRenewEnabled: false,
            lastRequestKey: input.idempotencyKey
          },
          create: {
            userId,
            priceCredits: input.priceCredits,
            durationDays: input.durationDays,
            startsAt: now,
            expiresAt: addDays(now, input.durationDays),
            autoRenewEnabled: false,
            lastRequestKey: input.idempotencyKey
          }
        });
        await testHooks?.afterStorageSubscriptionCreated?.({
          userId,
          subscriptionId: subscription.id
        });

        await tx.accountLedger.create({
          data: {
            userId,
            kind: "STORAGE_PACKAGE",
            title: "Storage package activation",
            creditsDelta: -input.priceCredits,
            amount: input.priceCredits,
            status: "SUCCESS",
            idempotencyKey: input.idempotencyKey,
            relatedRecordId: subscription.id,
            completedAt: now
          }
        });
        await testHooks?.afterStorageLedgerCreated?.({
          userId,
          subscriptionId: subscription.id
        });

        if (input.priceCredits > 0) {
          const eventResult = await createAccountCreditEventInTransaction(tx, {
            userId,
            deltaCredits: -input.priceCredits,
            balanceBefore: afterQuota.remainingCredits + input.priceCredits,
            balanceAfter: afterQuota.remainingCredits,
            ...storagePurchaseCreditEventContract(
              subscription.id,
              input.idempotencyKey
            )
          });
          if (eventResult.status !== "CREATED") {
            throw new Error("STORAGE_CREDIT_EVENT_IDEMPOTENCY_CONFLICT");
          }
          await testHooks?.afterFinancialCreditEventCreated?.({
            sourceType: eventResult.event.sourceType,
            sourceId: eventResult.event.sourceId
          });
        }

        return {
          subscription,
          quota: toQuotaRecord(afterQuota),
          alreadyActive: false
        };
      });

      return {
        storagePackage: toStoragePackageSummary(
          result.subscription,
          benefits,
          new Date()
        ),
        quota: result.quota,
        alreadyActive: result.alreadyActive
      };
    },
    async setStorageAutoRenew(userId, enabled, benefits) {
      const subscription = await client.userStorageSubscription.updateMany({
        where: { userId },
        data: { autoRenewEnabled: enabled }
      });
      if (subscription.count === 0) return null;
      const current = await client.userStorageSubscription.findUnique({ where: { userId } });
      return current ? toStoragePackageSummary(current, benefits, new Date()) : null;
    },
    async listStorageSubscriptions(input) {
      const { q, status, page, pageSize } = input;
      const skip = (page - 1) * pageSize;

      const whereUser: Prisma.UserWhereInput = {};
      if (q) {
        whereUser.OR = [
          { email: { contains: q } },
          { name: { contains: q } }
        ];
      }

      const [total, users] = await Promise.all([
        client.user.count({ where: whereUser }),
        client.user.findMany({
          where: whereUser,
          include: { storageSubscription: true },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          skip,
          take: pageSize
        })
      ]);

      const now = new Date();
      const items: AdminStorageSubscriptionSummary[] = users.map((u) => {
        const sub = u.storageSubscription;
        const subStatus: "ACTIVE" | "INACTIVE" | "EXPIRED" = !sub
          ? "INACTIVE"
          : sub.expiresAt > now
            ? "ACTIVE"
            : "EXPIRED";

        if (status && status !== "ALL") {
          if (status === "INACTIVE" && sub !== null) return null;
          if (status === "EXPIRED" && subStatus !== "EXPIRED") return null;
          if (status === "ACTIVE" && subStatus !== "ACTIVE") return null;
        }

        return {
          userId: u.id,
          userEmail: u.email,
          userName: u.name ?? null,
          status: subStatus,
          priceCredits: sub?.priceCredits ?? null,
          durationDays: sub?.durationDays ?? null,
          autoRenewEnabled: sub?.autoRenewEnabled ?? false,
          startsAt: sub?.startsAt.toISOString() ?? null,
          expiresAt: sub?.expiresAt.toISOString() ?? null,
          createdAt: sub?.createdAt.toISOString() ?? null,
          updatedAt: sub?.updatedAt.toISOString() ?? null
        };
      }).filter((item): item is AdminStorageSubscriptionSummary => item !== null);

      const filteredTotal = items.length === users.length ? total : users.length;

      return {
        items,
        page,
        pageSize,
        total: filteredTotal,
        totalPages: Math.ceil(filteredTotal / pageSize)
      };
    },
    async updateStorageSubscription(input) {
      const { userId, action, durationDays, enabled, adminId, adminEmail, benefits } = input;
      const now = new Date();

      const result = await client.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("USER_NOT_FOUND");

        let current = await tx.userStorageSubscription.findUnique({ where: { userId } });

        const previousState = current
          ? {
              status: current.expiresAt > now ? "ACTIVE" : "EXPIRED",
              expiresAt: current.expiresAt.toISOString(),
              autoRenewEnabled: current.autoRenewEnabled
            }
          : { status: "INACTIVE", expiresAt: null as string | null, autoRenewEnabled: false };

        let nextExpiresAt: Date | null = null;
        let nextAutoRenewEnabled: boolean | null = null;

        if (action === "ACTIVATE") {
          if (!durationDays || durationDays < 1 || durationDays > 3650) {
            throw new Error("INVALID_DURATION_DAYS");
          }
          const startsAt = now;
          nextExpiresAt = addDays(startsAt, durationDays);
          nextAutoRenewEnabled = false;
          current = await tx.userStorageSubscription.upsert({
            where: { userId },
            update: {
              priceCredits: benefits.storagePackagePriceCredits,
              durationDays,
              startsAt,
              expiresAt: nextExpiresAt,
              autoRenewEnabled: false,
              lastRequestKey: `admin-activate-${userId}-${now.getTime()}`
            },
            create: {
              userId,
              priceCredits: benefits.storagePackagePriceCredits,
              durationDays,
              startsAt,
              expiresAt: nextExpiresAt,
              autoRenewEnabled: false,
              lastRequestKey: `admin-activate-${userId}-${now.getTime()}`
            }
          });
        } else if (action === "EXTEND") {
          if (!current) throw new Error("STORAGE_NOT_FOUND");
          if (!durationDays || durationDays < 1 || durationDays > 3650) {
            throw new Error("INVALID_DURATION_DAYS");
          }
          const base = current.expiresAt > now ? current.expiresAt : now;
          nextExpiresAt = addDays(base, durationDays);
          nextAutoRenewEnabled = current.autoRenewEnabled;
          current = await tx.userStorageSubscription.update({
            where: { userId },
            data: { expiresAt: nextExpiresAt }
          });
        } else if (action === "DEACTIVATE") {
          if (!current) throw new Error("STORAGE_NOT_FOUND");
          nextExpiresAt = now;
          nextAutoRenewEnabled = false;
          current = await tx.userStorageSubscription.update({
            where: { userId },
            data: { expiresAt: now, autoRenewEnabled: false }
          });
        } else if (action === "SET_AUTO_RENEW") {
          if (enabled === undefined) throw new Error("ENABLED_REQUIRED");
          if (enabled && !benefits.storagePackageAutoRenewEnabled) {
            throw new Error("AUTO_RENEW_DISABLED");
          }
          if (!current) throw new Error("STORAGE_NOT_FOUND");
          if (enabled && current.expiresAt <= now) {
            throw new Error("STORAGE_EXPIRED");
          }
          nextAutoRenewEnabled = enabled;
          current = await tx.userStorageSubscription.update({
            where: { userId },
            data: { autoRenewEnabled: enabled }
          });
        }

        const newState = {
          status: current && current.expiresAt > now ? "ACTIVE" : current ? "EXPIRED" : "INACTIVE",
          expiresAt: current?.expiresAt.toISOString() ?? null,
          autoRenewEnabled: current?.autoRenewEnabled ?? false
        };

        await tx.adminAuditLog.create({
          data: {
            adminUserId: adminId,
            adminEmail,
            action: `STORAGE_${action}`,
            targetType: "USER_STORAGE_SUBSCRIPTION",
            targetId: userId,
            summary: `${action} storage subscription for user ${userId}`,
            metadata: {
              userId,
              userEmail: user.email,
              previousStatus: previousState.status,
              newStatus: newState.status,
              previousExpiresAt: previousState.expiresAt,
              newExpiresAt: newState.expiresAt,
              previousAutoRenew: previousState.autoRenewEnabled,
              newAutoRenew: newState.autoRenewEnabled,
              durationDays: durationDays ?? null,
              enabled: enabled ?? null
            }
          }
        });

        return {
          userId,
          userEmail: user.email,
          userName: user.name ?? null,
          status: newState.status as "ACTIVE" | "INACTIVE" | "EXPIRED",
          priceCredits: current?.priceCredits ?? null,
          durationDays: current?.durationDays ?? null,
          autoRenewEnabled: current?.autoRenewEnabled ?? false,
          startsAt: current?.startsAt.toISOString() ?? null,
          expiresAt: newState.expiresAt,
          createdAt: current?.createdAt.toISOString() ?? null,
          updatedAt: current?.updatedAt.toISOString() ?? null
        };
      });

      return result;
    },
    async claimDailyCheckIn(userId, input) {
      const key = `check-in:${userId}:${input.dateKey}`;
      try {
        const result = await client.$transaction(async (tx) => {
          const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM User
            WHERE id = ${userId}
            FOR UPDATE
          `);
          if (lockedUsers.length === 0) {
            throw new Error("USER_NOT_FOUND");
          }

          const lockedQuotaRows = await tx.$queryRaw<
            Array<{ userId: string; remainingCredits: number }>
          >(Prisma.sql`
            SELECT userId, remainingCredits
            FROM UserQuota
            WHERE userId = ${userId}
            FOR UPDATE
          `);
          const existing = await tx.dailyCheckIn.findUnique({
            where: { userId_checkInDate: { userId, checkInDate: input.dateKey } }
          });
          if (existing) {
            const quota = lockedQuotaRows[0];
            if (!quota) throw new Error("QUOTA_NOT_FOUND");
            return { existing, quota: toQuotaRecord(quota) };
          }
          const recent = await tx.dailyCheckIn.findMany({
            where: { userId },
            orderBy: { checkInDate: "desc" },
            take: 7
          });
          const previousDate = addDays(parseDateKey(input.dateKey), -1);
          const previous = recent[0];
          const streakDay = previous?.checkInDate === toDateKey(previousDate)
            ? previous.streakDay + 1
            : 1;
          const rewardCredits = input.dailyRewardCredits + (input.streakRewards[String(streakDay)] ?? 0);

          let balanceBefore = lockedQuotaRows[0]?.remainingCredits;
          if (balanceBefore === undefined) {
            const createdQuota = await createInitialUserQuotaInTransaction(tx, {
              userId,
              path: "QUOTA_INITIALIZE",
              afterCreditEventCreated:
                testHooks?.afterFinancialCreditEventCreated
            });
            balanceBefore = createdQuota.remainingCredits;
          }
          validateAdminQuotaCredits(balanceBefore);

          const checkIn = await tx.dailyCheckIn.create({
            data: {
              userId,
              checkInDate: input.dateKey,
              streakDay,
              rewardCredits
            }
          });
          await testHooks?.afterDailyCheckInCreated?.({
            userId,
            checkInId: checkIn.id,
            dateKey: input.dateKey
          });

          if (rewardCredits !== 0) {
            const updatedQuota = await tx.userQuota.updateMany({
              where: {
                userId,
                ...(rewardCredits > 0
                  ? { remainingCredits: { gte: 0 } }
                  : {})
              },
              data: { remainingCredits: { increment: rewardCredits } }
            });
            if (updatedQuota.count === 0) {
              throw new Error("QUOTA_UPDATE_FAILED");
            }
          }
          const afterQuotaRows = await tx.$queryRaw<
            Array<{ userId: string; remainingCredits: number }>
          >(Prisma.sql`
            SELECT userId, remainingCredits
            FROM UserQuota
            WHERE userId = ${userId}
            FOR UPDATE
          `);
          const afterQuota = afterQuotaRows[0];
          if (!afterQuota) {
            throw new Error("QUOTA_NOT_FOUND_AFTER_UPDATE");
          }
          validateAdminQuotaCredits(afterQuota.remainingCredits);

          await tx.accountLedger.create({
            data: {
              userId,
              kind: "CHECK_IN",
              title: "Daily check-in reward",
              creditsDelta: rewardCredits,
              amount: null,
              status: "SUCCESS",
              idempotencyKey: key,
              relatedRecordId: checkIn.id,
              completedAt: new Date()
            }
          });
          await testHooks?.afterDailyLedgerCreated?.({
            userId,
            checkInId: checkIn.id,
            dateKey: input.dateKey
          });

          if (rewardCredits !== 0) {
            const eventResult = await createAccountCreditEventInTransaction(tx, {
              userId,
              deltaCredits: rewardCredits,
              balanceBefore,
              balanceAfter: afterQuota.remainingCredits,
              ...dailyCheckInCreditEventContract(
                userId,
                input.dateKey,
                checkIn.id
              ),
              metadata: {
                checkInDate: input.dateKey,
                rewardType: "DAILY_CHECKIN"
              }
            });
            if (eventResult.status !== "CREATED") {
              throw new Error("CHECKIN_CREDIT_EVENT_IDEMPOTENCY_CONFLICT");
            }
            await testHooks?.afterFinancialCreditEventCreated?.({
              sourceType: eventResult.event.sourceType,
              sourceId: eventResult.event.sourceId
            });
          }

          return {
            checkIn,
            quota: toQuotaRecord(afterQuota)
          };
        });

        const checkIns = await client.dailyCheckIn.findMany({
          where: { userId },
          orderBy: { checkInDate: "desc" },
          take: 7
        });
        return {
          checkIn: toCheckInSummary(checkIns, {
            storagePackageEnabled: true,
            storagePackagePriceCredits: 0,
            storagePackageDurationDays: 1,
            storagePackageAutoRenewEnabled: false,
            storagePackageDescription: "",
            checkInEnabled: true,
            checkInDailyRewardCredits: input.dailyRewardCredits,
            checkInStreakRewards: input.streakRewards,
            referralEnabled: false,
            referralInviterRewardCredits: 0,
            referralInviteeRewardCredits: 0,
            referralRewardTrigger: "",
            referralRulesText: ""
          }, input.dateKey),
          quota: result.quota ?? await this.getQuota(userId),
          alreadyCheckedIn: "existing" in result
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const checkIns = await client.dailyCheckIn.findMany({
            where: { userId },
            orderBy: { checkInDate: "desc" },
            take: 7
          });
          return {
            checkIn: toCheckInSummary(checkIns, {
              storagePackageEnabled: true,
              storagePackagePriceCredits: 0,
              storagePackageDurationDays: 1,
              storagePackageAutoRenewEnabled: false,
              storagePackageDescription: "",
              checkInEnabled: true,
              checkInDailyRewardCredits: input.dailyRewardCredits,
              checkInStreakRewards: input.streakRewards,
              referralEnabled: false,
              referralInviterRewardCredits: 0,
              referralInviteeRewardCredits: 0,
              referralRewardTrigger: "",
              referralRulesText: ""
            }, input.dateKey),
            quota: await this.getQuota(userId),
            alreadyCheckedIn: true
          };
        }
        throw error;
      }
    },
    async listAccountActivities(userId, page, pageSize) {
      const safePage = Math.max(1, Number.isInteger(page) ? page : 1);
      const safePageSize = Math.min(100, Math.max(1, Number.isInteger(pageSize) ? pageSize : 20));

      const [orderCount, ledgerCount] = await Promise.all([
        client.order.count({ where: { userId } }),
        client.accountLedger.count({ where: { userId } })
      ]);
      const total = orderCount + ledgerCount;
      const totalPages = Math.max(1, Math.ceil(total / safePageSize));
      const skip = (safePage - 1) * safePageSize;

      const fetchLimit = skip + safePageSize;

      const [orders, ledgers] = await Promise.all([
        client.order.findMany({
          where: { userId },
          include: { plan: true },
          orderBy: { createdAt: "desc" },
          take: fetchLimit
        }),
        client.accountLedger.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: fetchLimit
        })
      ]);

      const merged = mergeAccountActivities(orders, ledgers);
      const items = merged.slice(skip, skip + safePageSize);

      return { items, page: safePage, pageSize: safePageSize, total, totalPages };
    },
    async createUser(input) {
      try {
        const user = await client.$transaction(
          async (tx) => {
            const createdUser = await tx.user.create({
              data: {
                email: input.email.toLowerCase(),
                passwordHash: input.passwordHash,
                ...(input.emailVerifiedAt === undefined
                  ? {}
                  : { emailVerifiedAt: input.emailVerifiedAt }),
                ...(input.lastLoginAt === undefined
                  ? {}
                  : { lastLoginAt: input.lastLoginAt })
              }
            });
            await createInitialUserQuotaInTransaction(tx, {
              userId: createdUser.id,
              path: "CREATE_USER",
              remainingCredits: testHooks?.initialUserQuotaCredits,
              afterCreditEventCreated:
                testHooks?.afterFinancialCreditEventCreated
            });
            return createdUser;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
        return toUserRecord(user);
      } catch (error) {
        if (isPrismaUniqueError(error)) {
          throw new Error("USER_EMAIL_EXISTS");
        }

        throw error;
      }
    },
    async registerUnverifiedUserAndIssueEmailVerificationToken(input) {
      validateEmailVerificationEmail(input.email);
      validateEmailVerificationPasswordHash(input.passwordHash);
      validateEmailVerificationTokenHash(input.tokenHash);
      validateEmailVerificationExpiresAt(input.expiresAt);

      const createUserAndToken = () =>
        client.$transaction(
          async (tx) => {
            const user = await tx.user.create({
              data: {
                email: input.email,
                passwordHash: input.passwordHash,
                emailVerifiedAt: null,
                lastLoginAt: null,
              },
              select: {
                id: true,
                email: true
              }
            });
            await createInitialUserQuotaInTransaction(tx, {
              userId: user.id,
              path: "REGISTER_UNVERIFIED",
              remainingCredits: testHooks?.initialUserQuotaCredits,
              afterCreditEventCreated:
                testHooks?.afterFinancialCreditEventCreated
            });
            await tx.userToken.create({
              data: {
                userId: user.id,
                kind: UserTokenKind.EMAIL_VERIFICATION,
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                usedAt: null
              }
            });
            return {
              status: "CREATED" as const,
              userId: user.id,
              email: user.email
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await createUserAndToken();
        } catch (error) {
          if (isEmailVerificationTokenHashConflict(error)) {
            throw new Error("EMAIL_VERIFICATION_TOKEN_HASH_CONFLICT");
          }
          if (isEmailVerificationUserTokenKindConflict(error)) {
            throw new Error("EMAIL_VERIFICATION_STORE_INVARIANT_VIOLATION");
          }
          if (!isEmailVerificationUserEmailConflict(error)) {
            throw error;
          }

          const existing = await client.user.findUnique({
            where: { email: input.email },
            select: { emailVerifiedAt: true }
          });
          if (existing) {
            return existing.emailVerifiedAt === null
              ? { status: "EXISTING_UNVERIFIED" as const }
              : { status: "ALREADY_VERIFIED" as const };
          }
        }
      }

      throw new Error("EMAIL_VERIFICATION_STORE_TRANSACTION_RACE");
    },
    async rotateEmailVerificationTokenForEmail(input) {
      validateEmailVerificationEmail(input.email);
      validateEmailVerificationTokenHash(input.tokenHash);
      validateEmailVerificationExpiresAt(input.expiresAt);

      try {
        return await client.$transaction(
          async (tx) => {
            const users = await tx.$queryRaw<LockedEmailVerificationUser[]>(
              Prisma.sql`
                SELECT \`id\`, \`email\`, \`emailVerifiedAt\`
                FROM \`User\`
                WHERE \`email\` = ${input.email}
                FOR UPDATE
              `
            );
            const user = users[0];
            if (!user || user.emailVerifiedAt !== null) {
              return { status: "NO_ACTION" as const };
            }

            await tx.userToken.upsert({
              where: {
                userId_kind: {
                  userId: user.id,
                  kind: UserTokenKind.EMAIL_VERIFICATION
                }
              },
              create: {
                userId: user.id,
                kind: UserTokenKind.EMAIL_VERIFICATION,
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                usedAt: null
              },
              update: {
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                usedAt: null
              }
            });

            return {
              status: "ISSUED" as const,
              userId: user.id,
              email: user.email
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (isEmailVerificationTokenHashConflict(error)) {
          throw new Error("EMAIL_VERIFICATION_TOKEN_HASH_CONFLICT");
        }
        if (isEmailVerificationUserTokenKindConflict(error)) {
          throw new Error("EMAIL_VERIFICATION_STORE_INVARIANT_VIOLATION");
        }

        throw error;
      }
    },
    async consumeEmailVerificationToken(input) {
      validateEmailVerificationTokenHash(input.tokenHash);
      validateEmailVerificationNow(input.now);

      const candidate = await client.userToken.findUnique({
        where: { tokenHash: input.tokenHash },
        select: { userId: true }
      });
      if (!candidate) {
        return { status: "INVALID_OR_EXPIRED" as const };
      }

      return client.$transaction(
        async (tx) => {
          const users = await tx.$queryRaw<LockedEmailVerificationConsumeUser[]>(
            Prisma.sql`
              SELECT \`id\`, \`emailVerifiedAt\`
              FROM \`User\`
              WHERE \`id\` = ${candidate.userId}
              FOR UPDATE
            `
          );
          const user = users[0];
          if (!user) {
            return { status: "INVALID_OR_EXPIRED" as const };
          }

          const tokens = await tx.$queryRaw<LockedEmailVerificationToken[]>(
            Prisma.sql`
              SELECT \`id\`, \`userId\`, \`kind\`, \`tokenHash\`, \`expiresAt\`, \`usedAt\`
              FROM \`UserToken\`
              WHERE \`tokenHash\` = ${input.tokenHash}
                AND \`kind\` = ${UserTokenKind.EMAIL_VERIFICATION}
              FOR UPDATE
            `
          );
          const token = tokens[0];
          if (
            !token ||
            token.userId !== user.id ||
            token.kind !== UserTokenKind.EMAIL_VERIFICATION
          ) {
            return { status: "INVALID_OR_EXPIRED" as const };
          }

          if (user.emailVerifiedAt !== null) {
            return { status: "ALREADY_VERIFIED" as const };
          }
          if (
            token.usedAt !== null ||
            token.expiresAt.getTime() <= input.now.getTime()
          ) {
            return { status: "INVALID_OR_EXPIRED" as const };
          }

          const userUpdate = await tx.user.updateMany({
            where: {
              id: user.id,
              emailVerifiedAt: null
            },
            data: {
              emailVerifiedAt: input.now,
              sessionVersion: {
                increment: 1
              }
            }
          });
          if (userUpdate.count !== 1) {
            throw new Error("EMAIL_VERIFICATION_STORE_INVARIANT_VIOLATION");
          }

          const tokenUpdate = await tx.userToken.updateMany({
            where: {
              id: token.id,
              userId: user.id,
              kind: UserTokenKind.EMAIL_VERIFICATION,
              tokenHash: input.tokenHash,
              usedAt: null,
              expiresAt: {
                gt: input.now
              }
            },
            data: {
              usedAt: input.now
            }
          });
          if (tokenUpdate.count !== 1) {
            throw new Error("EMAIL_VERIFICATION_STORE_INVARIANT_VIOLATION");
          }

          const verifiedUser = await tx.user.findUnique({
            where: { id: user.id },
            select: { sessionVersion: true }
          });
          if (!verifiedUser) {
            throw new Error("EMAIL_VERIFICATION_STORE_INVARIANT_VIOLATION");
          }

          return {
            status: "VERIFIED" as const,
            userId: user.id,
            sessionVersion: verifiedUser.sessionVersion
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async rotatePasswordResetTokenForEmail(input) {
      validatePasswordResetEmail(input.email);
      validatePasswordResetTokenHash(input.tokenHash);
      validatePasswordResetNow(input.now);
      validatePasswordResetExpiresAt(input.expiresAt, input.now);

      try {
        return await client.$transaction(
          async (tx) => {
            const users = await tx.$queryRaw<LockedPasswordResetUser[]>(
              Prisma.sql`
                SELECT \`id\`, \`email\`, \`emailVerifiedAt\`
                FROM \`User\`
                WHERE \`email\` = ${input.email}
                FOR UPDATE
              `
            );
            const user = users[0];
            if (!user || user.emailVerifiedAt === null) {
              return { status: "NO_ACTION" as const };
            }

            await tx.userToken.upsert({
              where: {
                userId_kind: {
                  userId: user.id,
                  kind: UserTokenKind.PASSWORD_RESET
                }
              },
              create: {
                userId: user.id,
                kind: UserTokenKind.PASSWORD_RESET,
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                usedAt: null
              },
              update: {
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                usedAt: null
              }
            });

            return {
              status: "ISSUED" as const,
              userId: user.id,
              email: user.email
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (isPasswordResetTokenHashConflict(error)) {
          throw new Error("PASSWORD_RESET_TOKEN_HASH_CONFLICT");
        }
        if (isPasswordResetUserTokenKindConflict(error)) {
          throw new Error("PASSWORD_RESET_STORE_INVARIANT_VIOLATION");
        }

        throw error;
      }
    },
    async consumePasswordResetToken(input) {
      validatePasswordResetTokenHash(input.tokenHash);
      validatePasswordResetPasswordHash(input.passwordHash);
      validatePasswordResetNow(input.now);

      const candidate = await client.userToken.findUnique({
        where: { tokenHash: input.tokenHash },
        select: { userId: true }
      });
      if (!candidate) {
        return { status: "INVALID_OR_EXPIRED" as const };
      }

      return client.$transaction(
        async (tx) => {
          const users = await tx.$queryRaw<LockedPasswordResetConsumeUser[]>(
            Prisma.sql`
              SELECT \`id\`
              FROM \`User\`
              WHERE \`id\` = ${candidate.userId}
              FOR UPDATE
            `
          );
          const user = users[0];
          if (!user) {
            return { status: "INVALID_OR_EXPIRED" as const };
          }

          const tokens = await tx.$queryRaw<LockedPasswordResetToken[]>(
            Prisma.sql`
              SELECT \`id\`, \`userId\`, \`kind\`, \`tokenHash\`, \`expiresAt\`, \`usedAt\`
              FROM \`UserToken\`
              WHERE \`tokenHash\` = ${input.tokenHash}
                AND \`kind\` = ${UserTokenKind.PASSWORD_RESET}
              FOR UPDATE
            `
          );
          const token = tokens[0];
          if (
            !token ||
            token.userId !== user.id ||
            token.kind !== UserTokenKind.PASSWORD_RESET ||
            token.usedAt !== null ||
            token.expiresAt.getTime() <= input.now.getTime()
          ) {
            return { status: "INVALID_OR_EXPIRED" as const };
          }

          const userUpdate = await tx.user.updateMany({
            where: { id: user.id },
            data: {
              passwordHash: input.passwordHash,
              sessionVersion: {
                increment: 1
              }
            }
          });
          if (userUpdate.count !== 1) {
            throw new Error("PASSWORD_RESET_STORE_INVARIANT_VIOLATION");
          }

          const tokenUpdate = await tx.userToken.updateMany({
            where: {
              id: token.id,
              userId: user.id,
              kind: UserTokenKind.PASSWORD_RESET,
              tokenHash: input.tokenHash,
              usedAt: null,
              expiresAt: {
                gt: input.now
              }
            },
            data: {
              usedAt: input.now
            }
          });
          if (tokenUpdate.count !== 1) {
            throw new Error("PASSWORD_RESET_STORE_INVARIANT_VIOLATION");
          }

          const resetUser = await tx.user.findUnique({
            where: { id: user.id },
            select: { sessionVersion: true }
          });
          if (!resetUser) {
            throw new Error("PASSWORD_RESET_STORE_INVARIANT_VIOLATION");
          }

          return {
            status: "RESET" as const,
            userId: user.id,
            sessionVersion: resetUser.sessionVersion
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async changePasswordForUser(input) {
      return client.$transaction(
        async (tx) => {
          const userUpdate = await tx.user.updateMany({
            where: {
              id: input.userId,
              sessionVersion: input.expectedSessionVersion,
              passwordHash: input.expectedPasswordHash
            },
            data: {
              passwordHash: input.passwordHash,
              sessionVersion: {
                increment: 1
              }
            }
          });
          if (userUpdate.count !== 1) {
            return { status: "STALE_AUTH_STATE" as const };
          }

          await tx.userToken.updateMany({
            where: {
              userId: input.userId,
              kind: UserTokenKind.PASSWORD_RESET,
              usedAt: null,
              expiresAt: {
                gt: input.now
              }
            },
            data: {
              usedAt: input.now
            }
          });

          return { status: "CHANGED" as const };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async revokeUserSessions(input) {
      const userUpdate = await client.user.updateMany({
        where: {
          id: input.userId,
          sessionVersion: input.expectedSessionVersion
        },
        data: {
          sessionVersion: {
            increment: 1
          }
        }
      });

      return userUpdate.count === 1
        ? { status: "REVOKED" as const }
        : { status: "STALE_AUTH_STATE" as const };
    },
    async listSessions(userId) {
      const sessions = await client.chatSession.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" }
      });
      return sessions.map(toSessionSummary);
    },
    async createSession(input) {
      const session = await client.chatSession.create({
        data: {
          userId: input.userId,
          title: input.title
        }
      });
      return toSessionSummary(session);
    },
    async findSessionForUser(sessionId, userId) {
      const session = await client.chatSession.findFirst({
        where: {
          id: sessionId,
          userId
        }
      });
      return session ? toSessionSummary(session) : null;
    },
    async updateSessionTitle(sessionId, title) {
      const session = await client.chatSession.update({
        where: { id: sessionId },
        data: { title }
      });
      return toSessionSummary(session);
    },
    async touchSession(sessionId) {
      const session = await client.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() }
      });
      return toSessionSummary(session);
    },
    async listMessages(sessionId, userId) {
      const session = await this.findSessionForUser(sessionId, userId);

      if (!session) {
        return null;
      }

      const messages = await client.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" }
      });
      return messages.map(toMessageRecord);
    },
    async createMessage(input) {
      const message = await client.chatMessage.create({
        data: input
      });
      await this.touchSession(input.sessionId);
      return toMessageRecord(message);
    },
    async deleteSession(sessionId, userId) {
      const session = await this.findSessionForUser(sessionId, userId);

      if (!session) {
        return false;
      }

      await client.chatSession.delete({
        where: { id: sessionId }
      });
      return true;
    },
    async listCreatorCanvasDocumentsForUser(userId, limit = 50) {
      const documents = await client.creatorCanvasDocument.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: Math.min(Math.max(limit, 1), 50),
        select: {
          id: true,
          title: true,
          revision: true,
          createdAt: true,
          updatedAt: true
        }
      });
      return documents.map(toCreatorCanvasDocumentSummary);
    },
    async listCreatorCanvasDocumentsPageForUser(userId, page, pageSize) {
      const safePage = Math.max(1, Number.isInteger(page) ? page : 1);
      const safePageSize = Math.min(
        50,
        Math.max(1, Number.isInteger(pageSize) ? pageSize : 20)
      );
      const where = { userId };
      const [total, documents] = await Promise.all([
        client.creatorCanvasDocument.count({ where }),
        client.creatorCanvasDocument.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: (safePage - 1) * safePageSize,
          take: safePageSize,
          select: {
            id: true,
            title: true,
            revision: true,
            createdAt: true,
            updatedAt: true
          }
        })
      ]);
      return {
        documents: documents.map(toCreatorCanvasDocumentSummary),
        total
      };
    },
    async findCreatorCanvasDocumentForUser(userId, documentId) {
      const document = await client.creatorCanvasDocument.findFirst({
        where: {
          id: documentId,
          userId
        }
      });
      return document ? toCreatorCanvasDocumentDetail(document) : null;
    },
    async createCreatorCanvasDocument(input) {
      const document = await client.creatorCanvasDocument.create({
        data: {
          userId: input.userId,
          title: input.title,
          state: input.state as Prisma.InputJsonValue
        }
      });
      return toCreatorCanvasDocumentDetail(document);
    },
    async updateCreatorCanvasDocument(input) {
      const existing = await client.creatorCanvasDocument.findFirst({
        where: {
          id: input.id,
          userId: input.userId
        },
        select: { id: true }
      });
      if (!existing) {
        return { status: "NOT_FOUND" as const };
      }

      const data: Prisma.CreatorCanvasDocumentUpdateManyMutationInput = {
        revision: { increment: 1 }
      };
      if (input.state !== undefined) {
        data.state = input.state as Prisma.InputJsonValue;
      }
      if (input.title !== undefined) {
        data.title = input.title;
      }

      const updated = await client.creatorCanvasDocument.updateMany({
        where: {
          id: input.id,
          userId: input.userId,
          revision: input.expectedRevision
        },
        data
      });
      if (updated.count !== 1) {
        return { status: "CONFLICT" as const };
      }

      const document = await client.creatorCanvasDocument.findFirst({
        where: {
          id: input.id,
          userId: input.userId
        }
      });
      return document
        ? { status: "UPDATED" as const, document: toCreatorCanvasDocumentDetail(document) }
        : { status: "NOT_FOUND" as const };
    },
    async deleteCreatorCanvasDocumentForUser(userId, documentId) {
      const deleted = await client.creatorCanvasDocument.deleteMany({
        where: {
          id: documentId,
          userId
        }
      });
      return deleted.count === 1;
    },
    async getQuota(userId) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const quota = await client.$transaction(
            async (tx) => {
              const existing = await tx.userQuota.findUnique({
                where: { userId }
              });
              if (existing) {
                return existing;
              }

              const user = await tx.user.findUnique({
                where: { id: userId },
                select: { id: true }
              });
              if (!user) {
                throw new Error("USER_NOT_FOUND");
              }

              return createInitialUserQuotaInTransaction(tx, {
                userId,
                path: "QUOTA_INITIALIZE",
                remainingCredits: testHooks?.initialUserQuotaCredits,
                afterCreditEventCreated:
                  testHooks?.afterFinancialCreditEventCreated
              });
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
            }
          );
          return toQuotaRecord(quota);
        } catch (error) {
          if (attempt === 0 && isPrismaUniqueError(error)) {
            continue;
          }
          throw error;
        }
      }

      throw new Error("QUOTA_INITIALIZATION_RETRY_EXHAUSTED");
    },
    async deductQuota(userId, costCredits) {
      const updated = await client.userQuota.updateMany({
        where: {
          userId,
          remainingCredits: {
            gte: costCredits
          }
        },
        data: {
          remainingCredits: {
            decrement: costCredits
          }
        }
      });

      if (updated.count === 0) {
        return null;
      }

      return this.getQuota(userId);
    },
    async findAccountCreditEventByIdempotencyKey(idempotencyKey) {
      const normalizedKey = normalizeAccountCreditEventText(
        idempotencyKey,
        191,
        "INVALID_ACCOUNT_CREDIT_EVENT_IDEMPOTENCY_KEY"
      );
      const event = await client.accountCreditEvent.findUnique({
        where: { idempotencyKey: normalizedKey }
      });
      return event ? toAccountCreditEventRecord(event) : null;
    },
    async listAccountCreditEventsForUser(userId, limit = 100) {
      const normalizedUserId = normalizeAccountCreditEventUserId(userId);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > ACCOUNT_CREDIT_EVENT_MAX_QUERY_LIMIT
      ) {
        throw new TypeError("INVALID_ACCOUNT_CREDIT_EVENT_LIMIT");
      }

      const events = await client.accountCreditEvent.findMany({
        where: { userId: normalizedUserId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit
      });
      return events.map(toAccountCreditEventRecord);
    },
    async claimIdempotencyRequest(input) {
      const scope = normalizeIdempotencyScope(input.scope);
      const ownerType = normalizeIdempotencyOwnerType(input.ownerType);
      const ownerKeyHash = normalizeIdempotencyHash(
        input.ownerKeyHash,
        "INVALID_IDEMPOTENCY_OWNER_HASH"
      );
      const idempotencyKeyHash = normalizeIdempotencyHash(
        input.idempotencyKeyHash,
        "INVALID_IDEMPOTENCY_KEY_HASH"
      );
      const requestFingerprint = normalizeIdempotencyHash(
        input.requestFingerprint,
        "INVALID_IDEMPOTENCY_REQUEST_FINGERPRINT"
      );
      const claimTokenHash = normalizeIdempotencyHash(
        input.claimTokenHash,
        "INVALID_IDEMPOTENCY_CLAIM_TOKEN_HASH"
      );
      const now = normalizeIdempotencyNow(input.now);
      const claimExpiresAt = getIdempotencyClaimExpiresAt(now);
      const uniqueWhere = {
        scope_ownerType_ownerKeyHash_idempotencyKeyHash: {
          scope,
          ownerType,
          ownerKeyHash,
          idempotencyKeyHash
        }
      };

      for (
        let createAttempt = 0;
        createAttempt < IDEMPOTENCY_CLAIM_MAX_ATTEMPTS;
        createAttempt += 1
      ) {
        try {
          const request = await client.idempotencyRequest.create({
            data: {
              scope,
              ownerType,
              ownerKeyHash,
              idempotencyKeyHash,
              requestFingerprint,
              status: IdempotencyRequestStatus.CLAIMED,
              claimTokenHash,
              claimExpiresAt
            }
          });
          return {
            status: "ACQUIRED" as const,
            request: { id: request.id, claimExpiresAt }
          };
        } catch (error) {
          if (!isTargetIdempotencyUniqueConflict(error)) {
            throw error;
          }
        }

        for (
          let resolveAttempt = 0;
          resolveAttempt < IDEMPOTENCY_CLAIM_MAX_ATTEMPTS;
          resolveAttempt += 1
        ) {
          const existing = await client.idempotencyRequest.findUnique({
            where: uniqueWhere
          });
          if (!existing) {
            break;
          }
          if (
            !idempotencyHashesEqual(
              existing.requestFingerprint,
              requestFingerprint
            )
          ) {
            return { status: "CONFLICT" as const };
          }
          if (existing.status === IdempotencyRequestStatus.SUCCEEDED) {
            return {
              status: "SUCCEEDED" as const,
              request: toSafeIdempotencyRequestReference(existing)
            };
          }
          if (existing.status === IdempotencyRequestStatus.FAILED) {
            return {
              status: "FAILED" as const,
              request: toSafeIdempotencyRequestReference(existing)
            };
          }
          if (existing.status === IdempotencyRequestStatus.IN_PROGRESS) {
            return {
              status: "IN_PROGRESS" as const,
              request: { id: existing.id, aiTaskId: existing.aiTaskId }
            };
          }

          const claimIsExpired =
            existing.claimExpiresAt !== null &&
            existing.claimExpiresAt.getTime() <= now.getTime();
          if (!claimIsExpired || existing.aiTaskId !== null) {
            return {
              status: "IN_PROGRESS" as const,
              request: { id: existing.id, aiTaskId: existing.aiTaskId }
            };
          }

          const takeover = await client.idempotencyRequest.updateMany({
            where: {
              id: existing.id,
              status: IdempotencyRequestStatus.CLAIMED,
              aiTaskId: null,
              claimExpiresAt: { lte: now }
            },
            data: {
              claimTokenHash,
              claimExpiresAt
            }
          });
          if (takeover.count === 1) {
            return {
              status: "ACQUIRED" as const,
              request: { id: existing.id, claimExpiresAt }
            };
          }
        }
      }

      throw new Error("IDEMPOTENCY_CLAIM_RETRY_EXHAUSTED");
    },
    async readIdempotencyRequestState(
      input: ReadIdempotencyRequestStateInput
    ): Promise<ReadIdempotencyRequestStateResult> {
      const scope = normalizeIdempotencyScope(input.scope);
      const ownerType = normalizeIdempotencyOwnerType(input.ownerType);
      const ownerKeyHash = normalizeIdempotencyHash(
        input.ownerKeyHash,
        "INVALID_IDEMPOTENCY_OWNER_HASH"
      );
      const idempotencyKeyHash = normalizeIdempotencyHash(
        input.idempotencyKeyHash,
        "INVALID_IDEMPOTENCY_KEY_HASH"
      );
      const requestFingerprint = normalizeIdempotencyHash(
        input.requestFingerprint,
        "INVALID_IDEMPOTENCY_REQUEST_FINGERPRINT"
      );
      const request = await client.idempotencyRequest.findUnique({
        where: {
          scope_ownerType_ownerKeyHash_idempotencyKeyHash: {
            scope,
            ownerType,
            ownerKeyHash,
            idempotencyKeyHash
          }
        },
        select: {
          id: true,
          status: true,
          requestFingerprint: true,
          aiTaskId: true,
          responseStatus: true,
          responseCode: true,
          completedAt: true,
          expiresAt: true
        }
      });

      if (!request) {
        return { status: "NOT_FOUND" };
      }
      if (!idempotencyHashesEqual(request.requestFingerprint, requestFingerprint)) {
        return { status: "CONFLICT" };
      }
      if (
        request.status === IdempotencyRequestStatus.CLAIMED ||
        request.status === IdempotencyRequestStatus.IN_PROGRESS
      ) {
        return {
          status: "IN_PROGRESS",
          requestId: request.id,
          taskId: request.aiTaskId
        };
      }
      if (request.status === IdempotencyRequestStatus.SUCCEEDED) {
        if (
          request.responseStatus !== IDEMPOTENCY_COMPLETE_RESPONSE_STATUS ||
          request.responseCode !== null ||
          !(request.completedAt instanceof Date) ||
          !Number.isFinite(request.completedAt.getTime()) ||
          !(request.expiresAt instanceof Date) ||
          !Number.isFinite(request.expiresAt.getTime())
        ) {
          throw new Error("INVALID_IDEMPOTENCY_TERMINAL_STATE");
        }
        return {
          status: "SUCCEEDED",
          requestId: request.id,
          taskId: request.aiTaskId,
          responseStatus: 200,
          responseCode: null,
          completedAt: request.completedAt,
          expiresAt: request.expiresAt
        };
      }
      if (request.status === IdempotencyRequestStatus.FAILED) {
        if (
          typeof request.responseStatus !== "number" ||
          !Number.isInteger(request.responseStatus) ||
          request.responseStatus < IDEMPOTENCY_RESPONSE_STATUS_MIN ||
          request.responseStatus > IDEMPOTENCY_RESPONSE_STATUS_MAX ||
          (request.responseCode !== null &&
            !IDEMPOTENCY_RESPONSE_CODE_PATTERN.test(request.responseCode)) ||
          !(request.completedAt instanceof Date) ||
          !Number.isFinite(request.completedAt.getTime()) ||
          !(request.expiresAt instanceof Date) ||
          !Number.isFinite(request.expiresAt.getTime())
        ) {
          throw new Error("INVALID_IDEMPOTENCY_TERMINAL_STATE");
        }
        return {
          status: "FAILED",
          requestId: request.id,
          taskId: request.aiTaskId,
          responseStatus: request.responseStatus,
          responseCode: request.responseCode,
          completedAt: request.completedAt,
          expiresAt: request.expiresAt
        };
      }
      throw new Error("INVALID_IDEMPOTENCY_TERMINAL_STATE");
    },
    async abandonIdempotencyClaim(input) {
      const requestId = normalizeIdempotencyRequestId(input.requestId);
      const claimTokenHash = normalizeIdempotencyHash(
        input.claimTokenHash,
        "INVALID_IDEMPOTENCY_CLAIM_TOKEN_HASH"
      );
      const deleted = await client.idempotencyRequest.deleteMany({
        where: {
          id: requestId,
          status: IdempotencyRequestStatus.CLAIMED,
          aiTaskId: null,
          claimTokenHash
        }
      });
      return deleted.count === 1
        ? { status: "ABANDONED" as const }
        : { status: "NOT_ABANDONED" as const };
    },
    async reserveChatCredits(input) {
      const userId = normalizeReservationUserId(input.userId);
      const requestId = normalizeChatCreditText(
        input.requestId,
        191,
        "INVALID_CHAT_REQUEST_ID"
      );
      normalizeChatCreditText(input.modelId, 191, "INVALID_CHAT_MODEL_ID");
      const creditCost = validateChatCreditCost(input.creditCost);
      const expiresAt = validateReservationExpiry(input.expiresAt);
      if (!isChatReservationKind(input.kind)) {
        throw new TypeError("INVALID_CHAT_RESERVATION_KIND");
      }
      if (creditCost === 0) {
        return {
          ok: false as const,
          reason: "INVALID_CONFIGURATION" as const
        };
      }

      const createReservation = async (): Promise<ReserveChatCreditsResult> =>
        client.$transaction(
          async (tx) => {
            const existing = await tx.creditReservation.findUnique({
              where: { requestId }
            });
            if (existing) {
              return classifyExistingChatReservation(
                { kind: input.kind, creditCost },
                existing
              );
            }

            const quotaUpdate = await tx.userQuota.updateMany({
              where: {
                userId,
                remainingCredits: {
                  gte: creditCost
                }
              },
              data: {
                remainingCredits: {
                  decrement: creditCost
                }
              }
            });

            if (quotaUpdate.count === 0) {
              const quota = await tx.userQuota.findUnique({
                where: { userId },
                select: { userId: true }
              });
              return quota
                ? { ok: false as const, reason: "INSUFFICIENT_CREDITS" as const }
                : { ok: false as const, reason: "QUOTA_NOT_FOUND" as const };
            }

            const quotaAfterUpdate = await tx.userQuota.findUnique({
              where: { userId },
              select: { remainingCredits: true }
            });
            if (!quotaAfterUpdate) {
              throw new Error("CHAT_CREDIT_QUOTA_NOT_FOUND");
            }

            const reservation = await tx.creditReservation.create({
              data: {
                userId,
                kind: input.kind,
                amountCredits: creditCost,
                status: CreditReservationStatus.RESERVED,
                expiresAt,
                requestId
              }
            });

            await createChatCreditEvent(tx, {
              userId,
              deltaCredits: -creditCost,
              balanceBefore: quotaAfterUpdate.remainingCredits + creditCost,
              balanceAfter: quotaAfterUpdate.remainingCredits,
              ...chatCreditEventContract(input.kind, "CHARGE", reservation.id)
            });

            return {
              ok: true as const,
              status: "CREATED" as const,
              reservation
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );

      try {
        return await createReservation();
      } catch (error) {
        if (!isPrismaUniqueError(error)) {
          throw error;
        }

        const existing = await client.creditReservation.findUnique({
          where: { requestId }
        });
        if (!existing) {
          throw new Error("CHAT_CREDIT_RESERVATION_IDEMPOTENCY_RESOLUTION_FAILED");
        }
        return classifyExistingChatReservation(
          { kind: input.kind, creditCost },
          existing
        );
      }
    },
    async claimChatProviderAttempt(input) {
      const reservationId = normalizeOptionalReservationId(input.reservationId);
      const inputUserId =
        reservationId === null
          ? normalizeReservationUserId(input.userId ?? "")
          : null;
      const requestId = normalizeChatCreditText(
        input.requestId,
        191,
        "INVALID_CHAT_REQUEST_ID"
      );
      const modelId = normalizeChatCreditText(
        input.modelId,
        191,
        "INVALID_CHAT_MODEL_ID"
      );
      const attemptIndex = validateChatAttemptIndex(input.attemptIndex);
      const startedAt = validateChatAttemptDate(
        input.startedAt,
        "INVALID_CHAT_ATTEMPT_STARTED_AT"
      );
      const sessionId = normalizeOptionalChatCreditText(
        input.sessionId,
        191,
        "INVALID_CHAT_SESSION_ID"
      );
      const providerId = normalizeOptionalChatCreditText(
        input.providerId,
        191,
        "INVALID_CHAT_PROVIDER_ID"
      );
      const providerName = normalizeOptionalChatCreditText(
        input.providerName,
        255,
        "INVALID_CHAT_PROVIDER_NAME"
      );
      const upstreamModel = normalizeOptionalChatCreditText(
        input.upstreamModel,
        255,
        "INVALID_CHAT_UPSTREAM_MODEL"
      );
      const routeId = normalizeOptionalChatCreditText(
        input.routeId,
        191,
        "INVALID_CHAT_ROUTE_ID"
      );
      const fallbackAttempts = validateChatAttemptFallbackAttempts(
        input.fallbackAttempts
      );

      try {
        return await client.$transaction(
          async (tx) => {
            const existingAttempt = await tx.usageLog.findFirst({
              where: { requestId, attemptIndex }
            });
            if (existingAttempt) {
              if (existingAttempt.reservationId !== reservationId) {
                return { status: "ATTEMPT_CONFLICT" as const };
              }
              const attempt = toChatProviderAttemptRecord(existingAttempt);
              return {
                status:
                  attempt.status === UsageLogAttemptStatus.STARTED
                    ? ("ALREADY_CLAIMED" as const)
                    : ("ALREADY_TERMINAL" as const),
                attempt
              };
            }

            let reservation: Awaited<
              ReturnType<typeof tx.creditReservation.findUnique>
            > = null;
            let attemptUserId = inputUserId;
            if (reservationId !== null) {
              reservation = await tx.creditReservation.findUnique({
                where: { id: reservationId }
              });
              if (!reservation) {
                return { status: "NOT_FOUND" as const };
              }
              if (
                !isChatReservationKind(reservation.kind) ||
                reservation.requestId !== requestId ||
                reservation.status !== CreditReservationStatus.RESERVED
              ) {
                return { status: "INVALID_STATE" as const };
              }

              attemptUserId = reservation.userId;
              if (reservation.providerAttemptStartedAt === null) {
                const markerUpdate = await tx.creditReservation.updateMany({
                  where: {
                    id: reservationId,
                    status: CreditReservationStatus.RESERVED,
                    providerAttemptStartedAt: null
                  },
                  data: {
                    providerAttemptStartedAt: startedAt
                  }
                });
                if (markerUpdate.count !== 1) {
                  const current = await tx.creditReservation.findUnique({
                    where: { id: reservationId }
                  });
                  if (
                    !current ||
                    current.status !== CreditReservationStatus.RESERVED ||
                    !isChatReservationKind(current.kind) ||
                    current.requestId !== requestId
                  ) {
                    return { status: "INVALID_STATE" as const };
                  }
                }
              }
            }

            const attemptLog = await tx.usageLog.create({
              data: {
                userId: attemptUserId,
                sessionId,
                model: modelId,
                canonicalModel: modelId,
                providerId,
                providerName,
                upstreamModel,
                routeId,
                fallbackAttempts,
                status: "FAILED",
                attemptStatus: UsageLogAttemptStatus.STARTED,
                attemptCompletedAt: null,
                costCredits: 0,
                errorMessage: null,
                reservationId,
                requestId,
                attemptIndex,
                createdAt: startedAt
              }
            });

            return {
              status: "CLAIMED" as const,
              attempt: toChatProviderAttemptRecord(attemptLog)
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (!isPrismaUniqueError(error)) {
          throw error;
        }

        const existingAttempt = await client.usageLog.findFirst({
          where: { requestId, attemptIndex }
        });
        if (!existingAttempt) {
          throw new Error("CHAT_PROVIDER_ATTEMPT_IDEMPOTENCY_RESOLUTION_FAILED");
        }
        if (existingAttempt.reservationId !== reservationId) {
          return { status: "ATTEMPT_CONFLICT" as const };
        }
        const attempt = toChatProviderAttemptRecord(existingAttempt);
        return {
          status:
            attempt.status === UsageLogAttemptStatus.STARTED
              ? ("ALREADY_CLAIMED" as const)
              : ("ALREADY_TERMINAL" as const),
          attempt
        };
      }
    },
    async completeChatProviderAttempt(input) {
      const reservationId = normalizeOptionalReservationId(input.reservationId);
      const requestId = normalizeChatCreditText(
        input.requestId,
        191,
        "INVALID_CHAT_REQUEST_ID"
      );
      const attemptIndex = validateChatAttemptIndex(input.attemptIndex);
      const attemptStatus = toPrismaChatAttemptTerminalStatus(input.status);
      const completedAt = validateChatAttemptDate(
        input.completedAt,
        "INVALID_CHAT_ATTEMPT_COMPLETED_AT"
      );

      return client.$transaction(
        async (tx) => {
          let reservation: Awaited<
            ReturnType<typeof tx.creditReservation.findUnique>
          > = null;
          if (reservationId !== null) {
            reservation = await tx.creditReservation.findUnique({
              where: { id: reservationId }
            });
            if (!reservation) {
              return { status: "NOT_FOUND" as const };
            }
            if (!isChatReservationKind(reservation.kind)) {
              return { status: "ATTEMPT_CONFLICT" as const };
            }
          }

          const existingAttempt = await tx.usageLog.findFirst({
            where: { requestId, attemptIndex }
          });
          if (!existingAttempt) {
            return { status: "NOT_FOUND" as const };
          }
          if (existingAttempt.reservationId !== reservationId) {
            return { status: "ATTEMPT_CONFLICT" as const };
          }

          if (existingAttempt.attemptStatus === attemptStatus) {
            return {
              status: "ALREADY_TERMINAL" as const,
              attempt: toChatProviderAttemptRecord(existingAttempt)
            };
          }
          if (existingAttempt.attemptStatus !== UsageLogAttemptStatus.STARTED) {
            return { status: "CONFLICTING_TERMINAL_STATUS" as const };
          }

          const attemptUpdate = await tx.usageLog.updateMany({
            where: {
              id: existingAttempt.id,
              reservationId,
              requestId,
              attemptIndex,
              attemptStatus: UsageLogAttemptStatus.STARTED
            },
            data: {
              status: toLegacyUsageLogStatus(attemptStatus),
              attemptStatus,
              attemptCompletedAt: completedAt,
              costCredits:
                attemptStatus === UsageLogAttemptStatus.FAILED
                  ? 0
                  : reservation?.amountCredits ?? 0
            }
          });
          if (attemptUpdate.count !== 1) {
            const currentAttempt = await tx.usageLog.findUnique({
              where: { id: existingAttempt.id }
            });
            if (!currentAttempt) {
              return { status: "NOT_FOUND" as const };
            }
            if (currentAttempt.attemptStatus === attemptStatus) {
              return {
                status: "ALREADY_TERMINAL" as const,
                attempt: toChatProviderAttemptRecord(currentAttempt)
              };
            }
            return { status: "CONFLICTING_TERMINAL_STATUS" as const };
          }

          const updatedAttempt = await tx.usageLog.findUnique({
            where: { id: existingAttempt.id }
          });
          if (!updatedAttempt) {
            return { status: "NOT_FOUND" as const };
          }
          return {
            status: "UPDATED" as const,
            attempt: toChatProviderAttemptRecord(updatedAttempt)
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async settleChatReservation(reservationId) {
      const id = normalizeReservationId(reservationId);
      const settledAt = new Date();
      const statusUpdate = await client.creditReservation.updateMany({
        where: {
          id,
          kind: {
            in: [
              CreditReservationKind.CHAT_COMPLETION,
              CreditReservationKind.CHAT_STREAM
            ]
          },
          status: CreditReservationStatus.RESERVED
        },
        data: {
          status: CreditReservationStatus.SETTLED,
          settledAt
        }
      });

      if (statusUpdate.count === 1) {
        return { status: "UPDATED" as const };
      }

      const reservation = await client.creditReservation.findUnique({
        where: { id }
      });
      return reservation && isChatReservationKind(reservation.kind)
        ? settleMutationResult(reservation.status)
        : { status: "INVALID_STATE" as const };
    },
    async releaseChatReservation(reservationId) {
      const id = normalizeReservationId(reservationId);

      return client.$transaction(
        async (tx) => {
          const reservation = await tx.creditReservation.findUnique({
            where: { id }
          });
          if (!reservation || !isChatReservationKind(reservation.kind)) {
            return { status: "INVALID_STATE" as const };
          }
          if (reservation.status !== CreditReservationStatus.RESERVED) {
            return releaseMutationResult(reservation.status);
          }

          const statusUpdate = await tx.creditReservation.updateMany({
            where: {
              id,
              kind: reservation.kind,
              status: CreditReservationStatus.RESERVED
            },
            data: {
              status: CreditReservationStatus.RELEASED,
              releasedAt: new Date()
            }
          });
          if (statusUpdate.count !== 1) {
            const currentReservation = await tx.creditReservation.findUnique({
              where: { id }
            });
            return currentReservation && isChatReservationKind(currentReservation.kind)
              ? releaseMutationResult(currentReservation.status)
              : { status: "INVALID_STATE" as const };
          }

          const quotaUpdate = await tx.userQuota.updateMany({
            where: { userId: reservation.userId },
            data: {
              remainingCredits: {
                increment: reservation.amountCredits
              }
            }
          });
          if (quotaUpdate.count !== 1) {
            throw new Error("CHAT_CREDIT_QUOTA_NOT_FOUND");
          }

          const quotaAfterUpdate = await tx.userQuota.findUnique({
            where: { userId: reservation.userId },
            select: { remainingCredits: true }
          });
          if (!quotaAfterUpdate) {
            throw new Error("CHAT_CREDIT_QUOTA_NOT_FOUND");
          }

          await createChatCreditEvent(tx, {
            userId: reservation.userId,
            deltaCredits: reservation.amountCredits,
            balanceBefore: quotaAfterUpdate.remainingCredits - reservation.amountCredits,
            balanceAfter: quotaAfterUpdate.remainingCredits,
            ...chatCreditEventContract(reservation.kind, "RELEASE", reservation.id)
          });

          return { status: "UPDATED" as const };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async listExpiredChatReservations(options = {}) {
      const now = validateExpiredReservationReleaseNow(
        options.now === undefined ? new Date() : options.now
      );
      const limit = validateExpiredReservationReleaseLimit(
        options.limit === undefined ? 100 : options.limit
      );
      const reservations = await client.creditReservation.findMany({
        where: {
          status: CreditReservationStatus.RESERVED,
          kind: {
            in: [
              CreditReservationKind.CHAT_COMPLETION,
              CreditReservationKind.CHAT_STREAM
            ]
          },
          expiresAt: { lte: now }
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: limit,
        select: {
          id: true,
          userId: true,
          requestId: true,
          kind: true,
          amountCredits: true,
          status: true,
          expiresAt: true,
          providerAttemptStartedAt: true
        }
      });
      return reservations.map((reservation) => ({
        ...reservation,
        kind: reservation.kind as ChatCreditReservationKind
      }));
    },
    async recoverExpiredChatReservations(options = {}) {
      const now = validateExpiredReservationReleaseNow(
        options.now === undefined ? new Date() : options.now
      );
      const limit = validateExpiredReservationReleaseLimit(
        options.limit === undefined ? 100 : options.limit
      );
      const candidates = await client.creditReservation.findMany({
        where: {
          status: CreditReservationStatus.RESERVED,
          kind: {
            in: [
              CreditReservationKind.CHAT_COMPLETION,
              CreditReservationKind.CHAT_STREAM
            ]
          },
          expiresAt: { lte: now }
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: limit,
        select: { id: true }
      });

      const result: RecoverExpiredChatReservationsResult = {
        scanned: candidates.length,
        settled: 0,
        released: 0,
        skipped: 0,
        failed: 0
      };

      for (const candidate of candidates) {
        try {
          const outcome = await client.$transaction(
            async (tx) => {
              const lockedReservations = await tx.$queryRaw<
                Array<{
                  id: string;
                  userId: string;
                  kind: CreditReservationKind;
                  amountCredits: number;
                  status: CreditReservationStatus;
                  expiresAt: Date;
                  providerAttemptStartedAt: Date | null;
                }>
              >(Prisma.sql`
                SELECT
                  \`id\`,
                  \`userId\`,
                  \`kind\`,
                  \`amountCredits\`,
                  \`status\`,
                  \`expiresAt\`,
                  \`providerAttemptStartedAt\`
                FROM \`CreditReservation\`
                WHERE \`id\` = ${candidate.id}
                FOR UPDATE
              `);
              const reservation = lockedReservations[0];

              if (
                !reservation ||
                reservation.status !== CreditReservationStatus.RESERVED ||
                !isChatReservationKind(reservation.kind) ||
                reservation.expiresAt.getTime() > now.getTime()
              ) {
                return "SKIPPED" as const;
              }

              const attempts = await tx.usageLog.findMany({
                where: { reservationId: reservation.id },
                select: { attemptStatus: true }
              });
              const hasSucceeded = attempts.some(
                (attempt) =>
                  attempt.attemptStatus === UsageLogAttemptStatus.SUCCEEDED
              );
              const allAttemptsFailed =
                attempts.length > 0 &&
                attempts.every(
                  (attempt) =>
                    attempt.attemptStatus === UsageLogAttemptStatus.FAILED
                );
              const shouldRelease =
                !hasSucceeded &&
                (allAttemptsFailed ||
                  (attempts.length === 0 &&
                    reservation.providerAttemptStartedAt === null));

              if (!shouldRelease) {
                const settled = await tx.creditReservation.updateMany({
                  where: {
                    id: reservation.id,
                    kind: reservation.kind,
                    status: CreditReservationStatus.RESERVED,
                    expiresAt: { lte: now }
                  },
                  data: {
                    status: CreditReservationStatus.SETTLED,
                    settledAt: now
                  }
                });
                return settled.count === 1 ? ("SETTLED" as const) : ("SKIPPED" as const);
              }

              const released = await tx.creditReservation.updateMany({
                where: {
                  id: reservation.id,
                  kind: reservation.kind,
                  status: CreditReservationStatus.RESERVED,
                  expiresAt: { lte: now }
                },
                data: {
                  status: CreditReservationStatus.RELEASED,
                  releasedAt: now
                }
              });
              if (released.count !== 1) {
                return "SKIPPED" as const;
              }

              const quotaUpdate = await tx.userQuota.updateMany({
                where: { userId: reservation.userId },
                data: {
                  remainingCredits: {
                    increment: reservation.amountCredits
                  }
                }
              });
              if (quotaUpdate.count !== 1) {
                throw new Error("CHAT_CREDIT_QUOTA_NOT_FOUND");
              }

              const quotaAfterUpdate = await tx.userQuota.findUnique({
                where: { userId: reservation.userId },
                select: { remainingCredits: true }
              });
              if (!quotaAfterUpdate) {
                throw new Error("CHAT_CREDIT_QUOTA_NOT_FOUND");
              }

              await createChatCreditEvent(tx, {
                userId: reservation.userId,
                deltaCredits: reservation.amountCredits,
                balanceBefore:
                  quotaAfterUpdate.remainingCredits - reservation.amountCredits,
                balanceAfter: quotaAfterUpdate.remainingCredits,
                ...chatCreditEventContract(reservation.kind, "RELEASE", reservation.id)
              });

              return "RELEASED" as const;
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
            }
          );

          if (outcome === "SETTLED") result.settled += 1;
          else if (outcome === "RELEASED") result.released += 1;
          else result.skipped += 1;
        } catch {
          result.failed += 1;
        }
      }

      return result;
    },
    async reserveCredits(input) {
      const userId = normalizeReservationUserId(input.userId);
      const amountCredits = validateReservationAmount(input.amountCredits);
      const expiresAt = validateReservationExpiry(input.expiresAt);
      const kind = validateReservationKind(input.kind);
      const aiTaskId = normalizeReservationTaskId(input.aiTaskId);

      return client.$transaction(async (tx) => {
        const quotaUpdate = await tx.userQuota.updateMany({
          where: {
            userId,
            remainingCredits: {
              gte: amountCredits
            }
          },
          data: {
            remainingCredits: {
              decrement: amountCredits
            }
          }
        });

        if (quotaUpdate.count === 0) {
          const quota = await tx.userQuota.findUnique({
            where: { userId }
          });

          return quota
            ? { ok: false, reason: "INSUFFICIENT_CREDITS" as const }
            : { ok: false, reason: "QUOTA_NOT_FOUND" as const };
        }

        const reservation = await tx.creditReservation.create({
          data: {
            userId,
            kind,
            amountCredits,
            status: CreditReservationStatus.RESERVED,
            expiresAt,
            aiTaskId
          }
        });

        return { ok: true as const, reservation };
      });
    },
    async createImageTaskWithReservation(input) {
      const userId = normalizeReservationUserId(input.userId);
      const amountCredits = validateImageTaskReservationAmount(input.amountCredits);
      const expiresAt = validateReservationExpiry(input.expiresAt);
      const reservationKind =
        input.reservationKind ?? CreditReservationKind.IMAGE_GENERATION;
      if (
        reservationKind !== CreditReservationKind.IMAGE_GENERATION &&
        reservationKind !== CreditReservationKind.VIDEO_GENERATION
      ) {
        throw new TypeError("INVALID_GENERATION_RESERVATION_KIND");
      }
      const taskInput = validateImageTaskCreateInput(
        input.task,
        userId,
        reservationKind
      );
      const idempotencyClaim = normalizeImageTaskIdempotencyClaimBinding(
        input.idempotencyClaim,
        userId
      );

      try {
        return await client.$transaction(async (tx) => {
          if (idempotencyClaim) {
            const claimUpdate = await tx.idempotencyRequest.updateMany({
              where: {
                id: idempotencyClaim.requestId,
                ownerType: IdempotencyOwnerType.USER,
                ownerKeyHash: idempotencyClaim.ownerKeyHash,
                requestFingerprint: idempotencyClaim.requestFingerprint,
                status: IdempotencyRequestStatus.CLAIMED,
                aiTaskId: null,
                claimTokenHash: idempotencyClaim.claimTokenHash,
                claimExpiresAt: { gt: idempotencyClaim.now }
              },
              data: {
                status: IdempotencyRequestStatus.IN_PROGRESS
              }
            });
            if (claimUpdate.count !== 1) {
              throw new CreateImageTaskWithReservationAbort(
                "IDEMPOTENCY_CLAIM_INVALID"
              );
            }
          }

          if (amountCredits > 0) {
            const quotaUpdate = await tx.userQuota.updateMany({
              where: {
                userId,
                remainingCredits: {
                  gte: amountCredits
                }
              },
              data: {
                remainingCredits: {
                  decrement: amountCredits
                }
              }
            });

            if (quotaUpdate.count === 0) {
              const quota = await tx.userQuota.findUnique({
                where: { userId }
              });
              const reason = quota
                ? ("INSUFFICIENT_CREDITS" as const)
                : ("QUOTA_NOT_FOUND" as const);
              if (idempotencyClaim) {
                throw new CreateImageTaskWithReservationAbort(reason);
              }
              return { ok: false as const, reason };
            }
          }

          const task = await tx.aiTask.create({
            data: toAiTaskCreateData(taskInput)
          });
          const reservation = await tx.creditReservation.create({
            data: {
              userId,
              kind: reservationKind,
              amountCredits,
              status: CreditReservationStatus.RESERVED,
              expiresAt,
              aiTaskId: task.id
            }
          });

          if (amountCredits > 0) {
            const quotaAfterUpdate = await tx.userQuota.findUnique({
              where: { userId },
              select: { remainingCredits: true }
            });
            if (!quotaAfterUpdate) {
              throw new Error("CREDIT_RESERVATION_QUOTA_NOT_FOUND");
            }

            await createImageCreditEvent(tx, {
              userId,
              deltaCredits: -amountCredits,
              balanceBefore: quotaAfterUpdate.remainingCredits + amountCredits,
              balanceAfter: quotaAfterUpdate.remainingCredits,
              ...generationCreditEventContract(
                reservationKind,
                "CHARGE",
                reservation.id
              )
            });
          }

          if (idempotencyClaim) {
            const bindingUpdate = await tx.idempotencyRequest.updateMany({
              where: {
                id: idempotencyClaim.requestId,
                ownerType: IdempotencyOwnerType.USER,
                ownerKeyHash: idempotencyClaim.ownerKeyHash,
                requestFingerprint: idempotencyClaim.requestFingerprint,
                status: IdempotencyRequestStatus.IN_PROGRESS,
                aiTaskId: null,
                claimTokenHash: idempotencyClaim.claimTokenHash
              },
              data: {
                aiTaskId: task.id,
                claimTokenHash: null,
                claimExpiresAt: null
              }
            });
            if (bindingUpdate.count !== 1) {
              throw new Error("IDEMPOTENCY_CLAIM_BINDING_UPDATE_FAILED");
            }
          }

          return {
            ok: true as const,
            task: toAiTaskSummary(task),
            reservation
          };
        });
      } catch (error) {
        if (error instanceof CreateImageTaskWithReservationAbort) {
          return { ok: false as const, reason: error.reason };
        }
        throw error;
      }
    },
    async settleCreditReservation(reservationId) {
      const id = normalizeReservationId(reservationId);
      const settledAt = new Date();
      const statusUpdate = await client.creditReservation.updateMany({
        where: {
          id,
          status: CreditReservationStatus.RESERVED
        },
        data: {
          status: CreditReservationStatus.SETTLED,
          settledAt
        }
      });

      if (statusUpdate.count === 1) {
        return { status: "UPDATED" as const };
      }

      const reservation = await client.creditReservation.findUnique({
        where: { id }
      });

      return reservation
        ? settleMutationResult(reservation.status)
        : { status: "NOT_FOUND" as const };
    },
    async releaseCreditReservation(reservationId) {
      const id = normalizeReservationId(reservationId);

      return client.$transaction(
        async (tx) => {
          const reservation = await tx.creditReservation.findUnique({
            where: { id }
          });

          if (!reservation) {
            return { status: "NOT_FOUND" as const };
          }

          if (reservation.status !== CreditReservationStatus.RESERVED) {
            return releaseMutationResult(reservation.status);
          }

          const statusUpdate = await tx.creditReservation.updateMany({
            where: {
              id,
              status: CreditReservationStatus.RESERVED
            },
            data: {
              status: CreditReservationStatus.RELEASED,
              releasedAt: new Date()
            }
          });

          if (statusUpdate.count === 0) {
            const currentReservation = await tx.creditReservation.findUnique({
              where: { id }
            });

            return currentReservation
              ? releaseMutationResult(currentReservation.status)
              : { status: "NOT_FOUND" as const };
          }

          if (reservation.amountCredits > 0) {
            const quotaUpdate = await tx.userQuota.updateMany({
              where: { userId: reservation.userId },
              data: {
                remainingCredits: {
                  increment: reservation.amountCredits
                }
              }
            });

            if (quotaUpdate.count !== 1) {
              throw new Error("CREDIT_RESERVATION_QUOTA_NOT_FOUND");
            }
          }

          return { status: "UPDATED" as const };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async releaseExpiredCreditReservations(options = {}) {
      const now = validateExpiredReservationReleaseNow(
        options.now === undefined ? new Date() : options.now
      );
      const limit = validateExpiredReservationReleaseLimit(
        options.limit === undefined ? 100 : options.limit
      );
      const reservations = await client.creditReservation.findMany({
        where: {
          status: CreditReservationStatus.RESERVED,
          expiresAt: {
            lte: now
          }
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: limit,
        select: {
          id: true
        }
      });

      let released = 0;
      let skipped = 0;

      for (const reservation of reservations) {
        const result = await this.releaseCreditReservation(reservation.id);
        if (result.status === "UPDATED") {
          released += 1;
        } else {
          skipped += 1;
        }
      }

      return {
        scanned: reservations.length,
        released,
        skipped
      };
    },
    async recoverExpiredImageReservations(options = {}) {
      const now = validateExpiredReservationReleaseNow(
        options.now === undefined ? new Date() : options.now
      );
      const graceMs = validateExpiredImageReservationGrace(
        options.graceMs === undefined ? 2 * 60 * 1000 : options.graceMs
      );
      const limit = validateExpiredReservationReleaseLimit(
        options.limit === undefined ? 50 : options.limit
      );
      const graceCutoff = new Date(now.getTime() - graceMs);
      const reservations = await client.creditReservation.findMany({
        where: {
          status: CreditReservationStatus.RESERVED,
          kind: CreditReservationKind.IMAGE_GENERATION,
          expiresAt: {
            lte: now
          },
          aiTaskId: {
            not: null
          },
          aiTask: {
            is: {
              status: {
                in: ["PENDING", "RUNNING"]
              },
              updatedAt: {
                lte: graceCutoff
              }
            }
          }
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: limit,
        select: {
          id: true,
          aiTaskId: true,
          expiresAt: true,
          aiTask: {
            select: {
              id: true,
              status: true,
              updatedAt: true
            }
          }
        }
      });

      let recovered = 0;
      let skipped = 0;

      for (const reservation of reservations) {
        if (!reservation.aiTaskId || !reservation.aiTask) {
          skipped += 1;
          continue;
        }

        const result = await this.failImageTaskAndReleaseReservation({
          taskId: reservation.aiTaskId,
          reservationId: reservation.id,
          errorMessage: "Image generation expired before completion",
          idempotencyTerminal: {
            responseStatus: IDEMPOTENCY_RECOVERY_RESPONSE_STATUS,
            responseCode: IDEMPOTENCY_RECOVERY_RESPONSE_CODE
          }
        });
        if (result.status === "UPDATED") {
          recovered += 1;
        } else {
          skipped += 1;
        }
      }

      return {
        scanned: reservations.length,
        recovered,
        skipped
      };
    },
    async completeImageTaskWithReservation(
      input: CompleteImageTaskWithStorageObjectReservationInput
    ) {
      const taskId = normalizeReservationTaskId(input.taskId);
      const reservationId = normalizeReservationId(input.reservationId);
      const refundCredits = validateImageCompletionRefundCredits(
        input.refundCredits
      );

      if (!taskId) {
        throw new Error("INVALID_IMAGE_TASK_ID");
      }

      if (input.completedAt !== undefined) {
        validateIdempotencyCompletedAt(
          input.completedAt,
          "INVALID_IDEMPOTENCY_COMPLETED_AT"
        );
      }

      try {
        return await client.$transaction(
          async (tx) => {
            const reservation = await tx.creditReservation.findUnique({
              where: { id: reservationId }
            });

            if (!reservation) {
              throw new CompleteImageTaskMutationAbort({ status: "NOT_FOUND" });
            }

            const task = await tx.aiTask.findUnique({
              where: { id: taskId }
            });

            if (!task) {
              throw new CompleteImageTaskMutationAbort({ status: "NOT_FOUND" });
            }

            if (reservation.aiTaskId !== taskId || reservation.userId !== task.userId) {
              throw new CompleteImageTaskMutationAbort({
                status: "TASK_MISMATCH"
              });
            }

            if (
              reservation.status === CreditReservationStatus.SETTLED &&
              task.status === "SUCCEEDED"
            ) {
              throw new CompleteImageTaskMutationAbort({
                status: "ALREADY_COMPLETED"
              });
            }

            if (
              reservation.status !== CreditReservationStatus.RESERVED ||
              !isIncompleteAiTaskStatus(task.status)
            ) {
              throw new CompleteImageTaskMutationAbort({
                status: "INVALID_STATE"
              });
            }

            if (refundCredits > reservation.amountCredits) {
              throw new TypeError("INVALID_IMAGE_COMPLETION_REFUND_CREDITS");
            }

            const storageObjectIds = validateAiAssetCompletionInputs(
              input.assets,
              taskId,
              task.userId
            );
            await validateGeneratedStorageObjectsForCompletion(
              tx,
              task.userId,
              storageObjectIds,
              testHooks?.afterGeneratedStorageObjectLocked
            );

            const aiAssetCreateData = input.assets.map((asset) =>
              toAiAssetCreateData(asset, taskId, task.userId)
            );
            const canonicalAssetUrls = aiAssetCreateData.map((asset) => asset.url);
            const canonicalOutput = {
              ...normalizeJsonRecord(input.output),
              ...(task.type === "VIDEO"
                ? { videos: canonicalAssetUrls }
                : { images: canonicalAssetUrls })
            };

            const settledAt =
              input.completedAt === undefined ? new Date() : input.completedAt;
            const reservationUpdate = await tx.creditReservation.updateMany({
              where: {
                id: reservationId,
                aiTaskId: taskId,
                status: CreditReservationStatus.RESERVED
              },
              data: {
                status: CreditReservationStatus.SETTLED,
                settledAt
              }
            });

            if (reservationUpdate.count !== 1) {
              const currentReservation = await tx.creditReservation.findUnique({
                where: { id: reservationId }
              });
              const currentTask = await tx.aiTask.findUnique({
                where: { id: taskId }
              });

              if (!currentReservation || !currentTask) {
                throw new CompleteImageTaskMutationAbort({
                  status: "NOT_FOUND"
                });
              }
              if (
                currentReservation.aiTaskId !== taskId ||
                currentReservation.userId !== currentTask.userId
              ) {
                throw new CompleteImageTaskMutationAbort({
                  status: "TASK_MISMATCH"
                });
              }
              if (
                currentReservation.status === CreditReservationStatus.SETTLED &&
                currentTask.status === "SUCCEEDED"
              ) {
                throw new CompleteImageTaskMutationAbort({
                  status: "ALREADY_COMPLETED"
                });
              }
              throw new CompleteImageTaskMutationAbort({
                status: "INVALID_STATE"
              });
            }

            let refundedBalanceAfter: number | null = null;
            if (refundCredits > 0) {
              const quotaUpdate = await tx.userQuota.updateMany({
                where: { userId: reservation.userId },
                data: {
                  remainingCredits: {
                    increment: refundCredits
                  }
                }
              });

              if (quotaUpdate.count !== 1) {
                throw new Error("CREDIT_RESERVATION_QUOTA_NOT_FOUND");
              }

              const quotaAfterUpdate = await tx.userQuota.findUnique({
                where: { userId: reservation.userId },
                select: { remainingCredits: true }
              });
              if (!quotaAfterUpdate) {
                throw new Error("CREDIT_RESERVATION_QUOTA_NOT_FOUND");
              }
              refundedBalanceAfter = quotaAfterUpdate.remainingCredits;
            }

            if (refundedBalanceAfter !== null) {
              await createImageCreditEvent(tx, {
                userId: reservation.userId,
                deltaCredits: refundCredits,
                balanceBefore: refundedBalanceAfter - refundCredits,
                balanceAfter: refundedBalanceAfter,
                ...generationCreditEventContract(
                  reservation.kind,
                  "RELEASE",
                  reservation.id
                )
              });
            }

            const taskUpdate = await tx.aiTask.updateMany({
              where: {
                id: taskId,
                userId: reservation.userId,
                status: {
                  in: ["PENDING", "RUNNING"]
                }
              },
              data: {
                status: "SUCCEEDED",
                output: canonicalOutput as Prisma.InputJsonValue,
                costCredits: reservation.amountCredits - refundCredits,
                errorMessage: null,
                completedAt: settledAt
              }
            });

            if (taskUpdate.count !== 1) {
              const currentReservation = await tx.creditReservation.findUnique({
                where: { id: reservationId }
              });
              const currentTask = await tx.aiTask.findUnique({
                where: { id: taskId }
              });

              if (!currentReservation || !currentTask) {
                throw new CompleteImageTaskMutationAbort({
                  status: "NOT_FOUND"
                });
              }
              if (
                currentReservation.aiTaskId !== taskId ||
                currentReservation.userId !== currentTask.userId
              ) {
                throw new CompleteImageTaskMutationAbort({
                  status: "TASK_MISMATCH"
                });
              }
              if (
                currentReservation.status === CreditReservationStatus.SETTLED &&
                currentTask.status === "SUCCEEDED"
              ) {
                throw new CompleteImageTaskMutationAbort({
                  status: "ALREADY_COMPLETED"
                });
              }
              throw new CompleteImageTaskMutationAbort({
                status: "INVALID_STATE"
              });
            }

            const updatedTask = await tx.aiTask.findUnique({
              where: { id: taskId }
            });

            if (!updatedTask) {
              throw new Error("IMAGE_TASK_NOT_FOUND_AFTER_UPDATE");
            }

            const assets = await Promise.all(
              aiAssetCreateData.map((asset) =>
                tx.aiAsset.create({
                  data: asset
                })
              )
            );

            await applyIdempotencyTerminalUpdate(tx, {
              aiTaskId: taskId,
              targetStatus: IdempotencyRequestStatus.SUCCEEDED,
              responseStatus: IDEMPOTENCY_COMPLETE_RESPONSE_STATUS,
              responseCode: IDEMPOTENCY_COMPLETE_RESPONSE_CODE,
              completedAt: settledAt
            });

            return {
              status: "UPDATED" as const,
              task: toAiTaskSummary(updatedTask),
              assets: assets.map((asset) => toAiAssetSummary(asset))
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (error instanceof CompleteImageTaskMutationAbort) {
          return error.result;
        }
        if (isAiAssetStorageObjectUniqueConflict(error)) {
          throw new AiAssetCompletionError(
            "AI_ASSET_STORAGE_OBJECT_ALREADY_LINKED"
          );
        }
        if (isPrismaUniqueError(error)) {
          throw new AiAssetCompletionError("AI_ASSET_CREATION_CONFLICT");
        }
        throw error;
      }
    },
    async failImageTaskAndSettleReservation(input) {
      const taskId = normalizeReservationTaskId(input.taskId);
      const reservationId = normalizeReservationId(input.reservationId);

      if (!taskId) {
        throw new Error("INVALID_IMAGE_TASK_ID");
      }

      const terminalDefaults = {
        responseStatus: IDEMPOTENCY_COMPLETION_FAIL_RESPONSE_STATUS,
        responseCode: IDEMPOTENCY_COMPLETION_FAIL_RESPONSE_CODE,
        completedAt: new Date()
      };
      const terminal = normalizeIdempotencyTerminalMetadata(
        input.idempotencyTerminal,
        terminalDefaults
      );

      try {
        return await client.$transaction(
          async (tx) => {
            const reservation = await tx.creditReservation.findUnique({
              where: { id: reservationId }
            });

            if (!reservation) {
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "NOT_FOUND"
              });
            }

            const task = await tx.aiTask.findUnique({
              where: { id: taskId }
            });

            if (!task) {
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "NOT_FOUND"
              });
            }

            if (reservation.aiTaskId !== taskId || reservation.userId !== task.userId) {
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "TASK_MISMATCH"
              });
            }

            const idempotencyRequest = await tx.idempotencyRequest.findUnique({
              where: { aiTaskId: taskId }
            });

            if (!idempotencyRequest) {
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "INVALID_STATE"
              });
            }

            if (
              reservation.status === CreditReservationStatus.SETTLED &&
              task.status === "SUCCEEDED" &&
              idempotencyRequest.status === IdempotencyRequestStatus.SUCCEEDED
            ) {
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "ALREADY_COMPLETED"
              });
            }

            if (
              reservation.status === CreditReservationStatus.SETTLED &&
              task.status === "FAILED" &&
              idempotencyRequest.status === IdempotencyRequestStatus.FAILED
            ) {
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "ALREADY_FAILED"
              });
            }

            if (
              reservation.status !== CreditReservationStatus.RESERVED ||
              !isIncompleteAiTaskStatus(task.status) ||
              idempotencyRequest.status !== IdempotencyRequestStatus.IN_PROGRESS
            ) {
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "INVALID_STATE"
              });
            }

            const settledAt = terminal.completedAt;
            const reservationUpdate = await tx.creditReservation.updateMany({
              where: {
                id: reservationId,
                aiTaskId: taskId,
                status: CreditReservationStatus.RESERVED
              },
              data: {
                status: CreditReservationStatus.SETTLED,
                settledAt
              }
            });

            if (reservationUpdate.count !== 1) {
              const [currentReservation, currentTask, currentIdempotencyRequest] =
                await Promise.all([
                  tx.creditReservation.findUnique({
                    where: { id: reservationId }
                  }),
                  tx.aiTask.findUnique({ where: { id: taskId } }),
                  tx.idempotencyRequest.findUnique({ where: { aiTaskId: taskId } })
                ]);

              if (!currentReservation || !currentTask) {
                throw new FailImageTaskAndSettleReservationMutationAbort({
                  status: "NOT_FOUND"
                });
              }
              if (
                currentReservation.aiTaskId !== taskId ||
                currentReservation.userId !== currentTask.userId
              ) {
                throw new FailImageTaskAndSettleReservationMutationAbort({
                  status: "TASK_MISMATCH"
                });
              }
              if (
                currentReservation.status === CreditReservationStatus.SETTLED &&
                currentTask.status === "SUCCEEDED" &&
                currentIdempotencyRequest?.status ===
                  IdempotencyRequestStatus.SUCCEEDED
              ) {
                throw new FailImageTaskAndSettleReservationMutationAbort({
                  status: "ALREADY_COMPLETED"
                });
              }
              if (
                currentReservation.status === CreditReservationStatus.SETTLED &&
                currentTask.status === "FAILED" &&
                currentIdempotencyRequest?.status ===
                  IdempotencyRequestStatus.FAILED
              ) {
                throw new FailImageTaskAndSettleReservationMutationAbort({
                  status: "ALREADY_FAILED"
                });
              }
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "INVALID_STATE"
              });
            }

            const taskUpdate = await tx.aiTask.updateMany({
              where: {
                id: taskId,
                userId: reservation.userId,
                status: {
                  in: ["PENDING", "RUNNING"]
                }
              },
              data: {
                status: "FAILED",
                errorMessage: input.errorMessage,
                costCredits: reservation.amountCredits,
                completedAt: settledAt
              }
            });

            if (taskUpdate.count !== 1) {
              const [currentReservation, currentTask, currentIdempotencyRequest] =
                await Promise.all([
                  tx.creditReservation.findUnique({
                    where: { id: reservationId }
                  }),
                  tx.aiTask.findUnique({ where: { id: taskId } }),
                  tx.idempotencyRequest.findUnique({ where: { aiTaskId: taskId } })
                ]);

              if (!currentReservation || !currentTask) {
                throw new FailImageTaskAndSettleReservationMutationAbort({
                  status: "NOT_FOUND"
                });
              }
              if (
                currentReservation.aiTaskId !== taskId ||
                currentReservation.userId !== currentTask.userId
              ) {
                throw new FailImageTaskAndSettleReservationMutationAbort({
                  status: "TASK_MISMATCH"
                });
              }
              if (
                currentReservation.status === CreditReservationStatus.SETTLED &&
                currentTask.status === "SUCCEEDED" &&
                currentIdempotencyRequest?.status ===
                  IdempotencyRequestStatus.SUCCEEDED
              ) {
                throw new FailImageTaskAndSettleReservationMutationAbort({
                  status: "ALREADY_COMPLETED"
                });
              }
              if (
                currentReservation.status === CreditReservationStatus.SETTLED &&
                currentTask.status === "FAILED" &&
                currentIdempotencyRequest?.status ===
                  IdempotencyRequestStatus.FAILED
              ) {
                throw new FailImageTaskAndSettleReservationMutationAbort({
                  status: "ALREADY_FAILED"
                });
              }
              throw new FailImageTaskAndSettleReservationMutationAbort({
                status: "INVALID_STATE"
              });
            }

            const updatedTask = await tx.aiTask.findUnique({
              where: { id: taskId }
            });

            if (!updatedTask) {
              throw new Error("IMAGE_TASK_NOT_FOUND_AFTER_UPDATE");
            }

            await applyIdempotencyTerminalUpdate(tx, {
              aiTaskId: taskId,
              targetStatus: IdempotencyRequestStatus.FAILED,
              responseStatus: terminal.responseStatus,
              responseCode: terminal.responseCode,
              completedAt: settledAt
            });

            return {
              status: "UPDATED" as const,
              task: toAiTaskSummary(updatedTask)
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (error instanceof FailImageTaskAndSettleReservationMutationAbort) {
          return error.result;
        }
        throw error;
      }
    },
    async failImageTaskAndReleaseReservation(input) {
      const taskId = normalizeReservationTaskId(input.taskId);
      const reservationId = normalizeReservationId(input.reservationId);

      if (!taskId) {
        throw new Error("INVALID_IMAGE_TASK_ID");
      }

      const terminalDefaults = {
        responseStatus: IDEMPOTENCY_DEFAULT_FAIL_RESPONSE_STATUS,
        responseCode: IDEMPOTENCY_DEFAULT_FAIL_RESPONSE_CODE,
        completedAt: new Date()
      };
      const terminal = normalizeIdempotencyTerminalMetadata(
        input.idempotencyTerminal,
        terminalDefaults
      );

      try {
        return await client.$transaction(
          async (tx) => {
            const reservation = await tx.creditReservation.findUnique({
              where: { id: reservationId }
            });

            if (!reservation) {
              throw new FailImageTaskMutationAbort({ status: "NOT_FOUND" });
            }

            const task = await tx.aiTask.findUnique({
              where: { id: taskId }
            });

            if (!task) {
              throw new FailImageTaskMutationAbort({ status: "NOT_FOUND" });
            }

            if (reservation.aiTaskId !== taskId || reservation.userId !== task.userId) {
              throw new FailImageTaskMutationAbort({ status: "TASK_MISMATCH" });
            }

            if (reservation.status === CreditReservationStatus.SETTLED) {
              throw new FailImageTaskMutationAbort({ status: "INVALID_STATE" });
            }

            if (reservation.status === CreditReservationStatus.RELEASED) {
              throw new FailImageTaskMutationAbort({
                status: task.status === "FAILED" ? "ALREADY_FAILED" : "ALREADY_RELEASED"
              });
            }

            if (
              reservation.status !== CreditReservationStatus.RESERVED ||
              !isIncompleteAiTaskStatus(task.status)
            ) {
              throw new FailImageTaskMutationAbort({ status: "INVALID_STATE" });
            }

            const releasedAt = terminal.completedAt;
            const reservationUpdate = await tx.creditReservation.updateMany({
              where: {
                id: reservationId,
                aiTaskId: taskId,
                status: CreditReservationStatus.RESERVED
              },
              data: {
                status: CreditReservationStatus.RELEASED,
                releasedAt
              }
            });

            if (reservationUpdate.count !== 1) {
              const currentReservation = await tx.creditReservation.findUnique({
                where: { id: reservationId }
              });
              const currentTask = await tx.aiTask.findUnique({
                where: { id: taskId }
              });

              if (!currentReservation || !currentTask) {
                throw new FailImageTaskMutationAbort({ status: "NOT_FOUND" });
              }
              if (
                currentReservation.aiTaskId !== taskId ||
                currentReservation.userId !== currentTask.userId
              ) {
                throw new FailImageTaskMutationAbort({
                  status: "TASK_MISMATCH"
                });
              }
              if (currentReservation.status === CreditReservationStatus.SETTLED) {
                throw new FailImageTaskMutationAbort({ status: "INVALID_STATE" });
              }
              if (currentReservation.status === CreditReservationStatus.RELEASED) {
                throw new FailImageTaskMutationAbort({
                  status: currentTask.status === "FAILED"
                    ? "ALREADY_FAILED"
                    : "ALREADY_RELEASED"
                });
              }
              throw new FailImageTaskMutationAbort({ status: "INVALID_STATE" });
            }

            let releasedBalanceAfter: number | null = null;
            if (reservation.amountCredits > 0) {
              const quotaUpdate = await tx.userQuota.updateMany({
                where: { userId: reservation.userId },
                data: {
                  remainingCredits: {
                    increment: reservation.amountCredits
                  }
                }
              });

              if (quotaUpdate.count !== 1) {
                throw new Error("CREDIT_RESERVATION_QUOTA_NOT_FOUND");
              }

              const quotaAfterUpdate = await tx.userQuota.findUnique({
                where: { userId: reservation.userId },
                select: { remainingCredits: true }
              });
              if (!quotaAfterUpdate) {
                throw new Error("CREDIT_RESERVATION_QUOTA_NOT_FOUND");
              }
              releasedBalanceAfter = quotaAfterUpdate.remainingCredits;
            }

            if (releasedBalanceAfter !== null) {
              await createImageCreditEvent(tx, {
                userId: reservation.userId,
                deltaCredits: reservation.amountCredits,
                balanceBefore: releasedBalanceAfter - reservation.amountCredits,
                balanceAfter: releasedBalanceAfter,
                ...generationCreditEventContract(
                  reservation.kind,
                  "RELEASE",
                  reservation.id
                )
              });
            }

            const taskUpdate = await tx.aiTask.updateMany({
              where: {
                id: taskId,
                userId: reservation.userId,
                status: {
                  in: ["PENDING", "RUNNING"]
                }
              },
              data: {
                status: "FAILED",
                errorMessage: input.errorMessage ?? "Image generation failed",
                costCredits: 0,
                completedAt: releasedAt
              }
            });

            if (taskUpdate.count !== 1) {
              const currentReservation = await tx.creditReservation.findUnique({
                where: { id: reservationId }
              });
              const currentTask = await tx.aiTask.findUnique({
                where: { id: taskId }
              });

              if (!currentReservation || !currentTask) {
                throw new FailImageTaskMutationAbort({ status: "NOT_FOUND" });
              }
              if (
                currentReservation.aiTaskId !== taskId ||
                currentReservation.userId !== currentTask.userId
              ) {
                throw new FailImageTaskMutationAbort({
                  status: "TASK_MISMATCH"
                });
              }
              if (currentReservation.status === CreditReservationStatus.SETTLED) {
                throw new FailImageTaskMutationAbort({ status: "INVALID_STATE" });
              }
              if (currentReservation.status === CreditReservationStatus.RELEASED) {
                throw new FailImageTaskMutationAbort({
                  status: currentTask.status === "FAILED"
                    ? "ALREADY_FAILED"
                    : "ALREADY_RELEASED"
                });
              }
              throw new FailImageTaskMutationAbort({ status: "INVALID_STATE" });
            }

            const updatedTask = await tx.aiTask.findUnique({
              where: { id: taskId }
            });

            if (!updatedTask) {
              throw new Error("IMAGE_TASK_NOT_FOUND_AFTER_UPDATE");
            }

            await applyIdempotencyTerminalUpdate(tx, {
              aiTaskId: taskId,
              targetStatus: IdempotencyRequestStatus.FAILED,
              responseStatus: terminal.responseStatus,
              responseCode: terminal.responseCode,
              completedAt: releasedAt
            });

            return {
              status: "UPDATED" as const,
              task: toAiTaskSummary(updatedTask)
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (error instanceof FailImageTaskMutationAbort) {
          return error.result;
        }
        throw error;
      }
    },
    async createUsageLog(input) {
      const log = await client.usageLog.create({
        data: {
          userId: input.userId,
          sessionId: input.sessionId,
          model: input.model,
          canonicalModel: input.canonicalModel ?? null,
          providerId: input.providerId ?? null,
          providerName: input.providerName ?? null,
          upstreamModel: input.upstreamModel ?? null,
          routeId: input.routeId ?? null,
          fallbackAttempts: input.fallbackAttempts ?? 0,
          status: input.status,
          costCredits: input.costCredits,
          errorMessage: input.errorMessage ?? null,
          guestIp: input.guestIp ?? null,
          guestUsageDate: input.guestUsageDate ?? null
        }
      });
      return toUsageLogSummary(log);
    },
    async countGuestUsageLogs(input) {
      return client.usageLog.count({
        where: {
          userId: null,
          guestIp: input.guestIp,
          guestUsageDate: input.guestUsageDate
        }
      });
    },
    async getUsageSummary(userId, limit = 20) {
      const [quota, logs, totalSuccessCount, totalFailureCount] =
        await Promise.all([
          this.getQuota(userId),
          client.usageLog.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: limit
          }),
          client.usageLog.count({
            where: {
              userId,
              status: "SUCCESS"
            }
          }),
          client.usageLog.count({
            where: {
              userId,
              status: "FAILED"
            }
          })
        ]);

      const modelIds = Array.from(new Set(logs.map((log) => log.model)));
      const logModels =
        modelIds.length > 0
          ? await client.aiModel.findMany({
              where: {
                modelId: {
                  in: modelIds
                }
              }
            })
          : [];
      const modelDisplayNames = new Map(
        logModels.map((model) => [
          model.modelId,
          model.displayName?.trim() || model.name
        ])
      );

      return {
        remainingCredits: quota.remainingCredits,
        logs: logs.map((log) =>
          toUsageLogSummary(log, modelDisplayNames.get(log.model))
        ),
        totalSuccessCount,
        totalFailureCount
      };
    },
    async listAdminUsers(filters = {}) {
      const q = filters.q?.trim();
      const users = await client.user.findMany({
        where: {
          ...(filters.role ? { role: filters.role } : {}),
          ...(q ? { email: { contains: q } } : {})
        },
        include: {
          quota: true
        },
        orderBy: { createdAt: "desc" },
        skip:
          filters.page && filters.pageSize
            ? (filters.page - 1) * filters.pageSize
            : undefined,
        take: filters.pageSize
      });

      return users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        remainingCredits: user.quota?.remainingCredits ?? 20,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      }));
    },
    async setQuota(userId, remainingCredits) {
      const user = await client.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return null;
      }

      const quota = await client.userQuota.upsert({
        where: { userId },
        update: { remainingCredits },
        create: {
          userId,
          remainingCredits
        }
      });

      return toQuotaRecord(quota);
    },
    async adjustUserQuotaWithAudit(input) {
      const remainingCredits = validateAdminQuotaCredits(input.remainingCredits);
      const operationId = randomUUID();
      const sourceId = operationId;
      const idempotencyKey = `admin-adjust:${operationId}`;

      return client.$transaction(
        async (tx) => {
          const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM User
            WHERE id = ${input.userId}
            FOR UPDATE
          `);
          if (lockedUsers.length === 0) {
            return null;
          }

          const lockedQuotas = await tx.$queryRaw<
            Array<{ userId: string; remainingCredits: number }>
          >(Prisma.sql`
            SELECT userId, remainingCredits
            FROM UserQuota
            WHERE userId = ${input.userId}
            FOR UPDATE
          `);
          const balanceBefore =
            lockedQuotas[0]?.remainingCredits ?? DEFAULT_USER_QUOTA_CREDITS;
          validateAdminQuotaCredits(balanceBefore);
          const deltaCredits = remainingCredits - balanceBefore;
          const status = deltaCredits === 0 ? "NO_CHANGE" : "UPDATED";

          const auditLog = await createAuditLogInTransaction(tx, {
            adminUserId: input.adminUserId,
            adminEmail: input.adminEmail,
            action: "UPDATE_USER_QUOTA",
            targetType: "User",
            targetId: input.userId,
            summary: "Admin updated a user's quota.",
            metadata: {
              balanceBefore,
              balanceAfter: remainingCredits,
              deltaCredits,
              creditChangeStatus: status === "UPDATED" ? "RECORDED" : "NO_CHANGE",
              creditEventSourceId: sourceId,
              creditEventIdempotencyKey: idempotencyKey
            }
          });
          if (testHooks?.afterFinancialAuditLogCreated) {
            await testHooks.afterFinancialAuditLogCreated({
              action: auditLog.action,
              targetId: auditLog.targetId ?? input.userId
            });
          }

          if (lockedQuotas.length === 0) {
            await tx.userQuota.create({
              data: {
                userId: input.userId,
                remainingCredits
              }
            });
          } else if (deltaCredits !== 0) {
            await tx.userQuota.update({
              where: { userId: input.userId },
              data: { remainingCredits }
            });
          }

          let creditEvent: AccountCreditEventRecord | null = null;
          if (deltaCredits !== 0) {
            const eventResult = await createAccountCreditEventInTransaction(tx, {
              userId: input.userId,
              deltaCredits,
              balanceBefore,
              balanceAfter: remainingCredits,
              sourceType: "ADMIN_QUOTA_ADJUSTMENT",
              sourceId,
              idempotencyKey,
              metadata: {
                adminAuditId: auditLog.id,
                balanceBefore,
                balanceAfter: remainingCredits,
                deltaCredits
              }
            });
            if (eventResult.status !== "CREATED") {
              throw new Error("ACCOUNT_CREDIT_EVENT_IDEMPOTENCY_CONFLICT");
            }
            if (testHooks?.afterFinancialCreditEventCreated) {
              await testHooks.afterFinancialCreditEventCreated({
                sourceType: eventResult.event.sourceType,
                sourceId: eventResult.event.sourceId
              });
            }
            creditEvent = eventResult.event;
          }

          return {
            status,
            quota: {
              userId: input.userId,
              remainingCredits
            },
            balanceBefore,
            balanceAfter: remainingCredits,
            deltaCredits,
            creditEvent,
            auditLog
          } satisfies AdminQuotaAdjustmentResult;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async listAdminUsageLogs(filters = 20) {
      const normalizedFilters =
        typeof filters === "number" ? { limit: filters } : filters;
      const q = normalizedFilters.q?.trim();
      const logs = await client.usageLog.findMany({
        where: {
          ...(normalizedFilters.status
            ? { status: normalizedFilters.status }
            : {}),
          ...(normalizedFilters.model ? { model: normalizedFilters.model } : {}),
          ...(q
            ? {
                OR: [
                  { model: { contains: q } },
                  { user: { is: { email: { contains: q } } } }
                ]
              }
            : {})
        },
        include: {
          user: {
            select: {
              email: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: normalizedFilters.limit ?? 20
      });

      return logs.map((log) => toUsageLogSummary(log));
    },
    async listAdminOperationsTasks() {
      const tasks = await client.aiTask.findMany({
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          modelId: true,
          costCredits: true,
          createdAt: true,
          updatedAt: true,
          creditReservation: {
            select: {
              kind: true,
              status: true
            }
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50
      });
      const modelIds = tasks.flatMap((task) =>
        task.modelId === null ? [] : [task.modelId]
      );
      const models =
        modelIds.length === 0
          ? []
          : await client.aiModel.findMany({
              where: { modelId: { in: [...new Set(modelIds)] } },
              select: {
                modelId: true,
                name: true,
                displayName: true
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
            });
      const modelLabels = new Map<string, string>();
      for (const model of models) {
        if (!modelLabels.has(model.modelId)) {
          modelLabels.set(model.modelId, model.displayName?.trim() || model.name);
        }
      }

      return tasks.map((task) =>
        toAdminOperationsTask({
          taskId: task.id,
          userId: task.userId,
          type: fromPrismaAiTaskType(task.type),
          status: fromPrismaAiTaskStatus(task.status),
          modelId: task.modelId,
          modelLabel: task.modelId
            ? (modelLabels.get(task.modelId) ?? null)
            : null,
          costCredits: task.costCredits,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          creditReservation: task.creditReservation
        })
      );
    },
    async listAdminManualCompensations() {
      const logs = await client.adminAuditLog.findMany({
        where: {
          action: "UPDATE_USER_QUOTA",
          targetType: "User",
          targetId: { not: null }
        },
        select: {
          id: true,
          action: true,
          targetId: true,
          metadata: true,
          createdAt: true
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50
      });

      return logs.flatMap((log) =>
        log.targetId === null
          ? []
          : (() => {
              const creditDelta = normalizeAdminManualCompensationCreditDelta(
                log.metadata
              );

              return [
                {
                  auditId: log.id,
                  targetUserId: log.targetId,
                  action: "UPDATE_USER_QUOTA" as const,
                  createdAt: log.createdAt.toISOString(),
                  creditChangeStatus:
                    creditDelta === null ? ("UNKNOWN" as const) : ("RECORDED" as const),
                  creditDelta
                }
              ];
            })()
      );
    },
    async countUsageLogs(status) {
      return client.usageLog.count({
        where: { status }
      });
    },
    async getAdminOverviewStats(now = new Date()) {
      const todayStart = startOfUtcDay(now);
      const tomorrowStart = addUtcDays(todayStart, 1);
      const sevenDayStart = addUtcDays(todayStart, -6);

      const [
        usersTotal,
        todayNewUsers,
        admins,
        regularUsers,
        usageLogs,
        remainingCredits,
        quotaRecords,
        ordersTotal,
        pendingOrders,
        paidOrders,
        cancelledOrders,
        todayNewOrders,
        todayConfirmedOrders,
        todayRevenue,
        todayGrantedCredits,
        modelRecords,
        recentFailedLogs,
        recentOrders
      ] = await Promise.all([
        client.user.count(),
        client.user.count({
          where: {
            createdAt: {
              gte: todayStart,
              lt: tomorrowStart
            }
          }
        }),
        client.user.count({
          where: { role: "ADMIN" }
        }),
        client.user.count({
          where: { role: "USER" }
        }),
        client.usageLog.findMany({
          select: {
            model: true,
            status: true,
            costCredits: true,
            userId: true,
            createdAt: true
          }
        }),
        client.userQuota.aggregate({
          _sum: {
            remainingCredits: true
          }
        }),
        client.userQuota.count(),
        client.order.count(),
        client.order.count({
          where: { status: "PENDING" }
        }),
        client.order.count({
          where: { status: "PAID" }
        }),
        client.order.count({
          where: { status: "CANCELLED" }
        }),
        client.order.count({
          where: {
            createdAt: {
              gte: todayStart,
              lt: tomorrowStart
            }
          }
        }),
        client.order.count({
          where: {
            status: "PAID",
            paidAt: {
              gte: todayStart,
              lt: tomorrowStart
            }
          }
        }),
        client.order.aggregate({
          _sum: {
            amount: true
          },
          where: {
            status: "PAID",
            paidAt: {
              gte: todayStart,
              lt: tomorrowStart
            }
          }
        }),
        client.order.aggregate({
          _sum: {
            credits: true
          },
          where: {
            status: "PAID",
            paidAt: {
              gte: todayStart,
              lt: tomorrowStart
            }
          }
        }),
        client.aiModel.findMany({
          select: {
            name: true,
            modelId: true,
            displayName: true
          }
        }),
        client.usageLog.findMany({
          where: { status: "FAILED" },
          include: {
            user: {
              select: {
                email: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: 5
        }),
        client.order.findMany({
          include: {
            plan: {
              select: {
                name: true
              }
            },
            user: {
              select: {
                email: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: 5
        })
      ]);

      const todayUsageLogs = usageLogs.filter((log) =>
        isWithinUtcRange(log.createdAt, todayStart, tomorrowStart)
      );
      const last7DayLogs = usageLogs.filter((log) =>
        isWithinUtcRange(log.createdAt, sevenDayStart, tomorrowStart)
      );
      const todaySuccess = todayUsageLogs.filter(
        (log) => log.status === "SUCCESS"
      ).length;
      const todayFailed = todayUsageLogs.filter(
        (log) => log.status === "FAILED"
      ).length;
      const todayCreditsUsed = sumCredits(todayUsageLogs);
      const todayGuestCalls = todayUsageLogs.filter((log) => log.userId === null)
        .length;
      const todayActiveUsers = new Set(
        todayUsageLogs
          .map((log) => log.userId)
          .filter((userId): userId is string => Boolean(userId))
      ).size;
      const displayNames = buildModelDisplayNames(modelRecords);
      const modelStats = buildModelUsageStats(usageLogs, displayNames);
      const modelStatsLast7Days = buildModelUsageStats(
        last7DayLogs,
        displayNames
      );

      return {
        users: {
          total: usersTotal,
          todayNew: todayNewUsers,
          todayActive: todayActiveUsers,
          admins,
          regularUsers
        },
        guests: {
          todayCalls: todayGuestCalls,
          todayLimitExceeded: 0
        },
        usage: {
          todayCalls: todayUsageLogs.length,
          todaySuccess,
          todayFailed,
          todayCreditsUsed,
          successRate:
            todayUsageLogs.length > 0 ? todaySuccess / todayUsageLogs.length : 0
        },
        orders: {
          total: ordersTotal,
          pending: pendingOrders,
          paid: paidOrders,
          cancelled: cancelledOrders,
          todayNew: todayNewOrders,
          todayConfirmed: todayConfirmedOrders,
          todayPaid: todayConfirmedOrders,
          todayRevenueCents: todayRevenue._sum.amount ?? 0
        },
        quota: {
          remainingCreditsTotal:
            (remainingCredits._sum.remainingCredits ?? 0) +
            Math.max(usersTotal - quotaRecords, 0) * 20,
          todayGrantedCredits: todayGrantedCredits._sum.credits ?? 0,
          todayUsedCredits: todayCreditsUsed
        },
        last7Days: buildLast7DayTrend(last7DayLogs, now),
        guestLast7Days: buildGuestLast7DayTrend(last7DayLogs, now),
        modelTopByCalls: topModelStats(modelStats, "calls"),
        modelTopByCredits: topModelStats(modelStats, "creditsUsed"),
        modelTopByFailures: topModelStats(modelStats, "failed"),
        models: modelStats,
        modelUsageLast7Days: topModelStats(modelStatsLast7Days, "calls"),
        recentFailures: recentFailedLogs.map((log) => ({
          id: log.id,
          createdAt: log.createdAt.toISOString(),
          userEmail: log.user?.email ?? null,
          model: log.model,
          ...(displayNames.get(log.model)
            ? { modelDisplayName: displayNames.get(log.model) }
            : {}),
          errorSummary: summarizeAdminFailure(log.errorMessage)
        })),
        recentOrders: recentOrders.map(toAdminOrderSummary)
      };
    },
    async listEnabledModels(filters) {
      const capability =
        typeof filters === "string" ? filters : filters?.capability;
      const surface = typeof filters === "string" ? undefined : filters?.surface;
      const models = await client.aiModel.findMany({
        where: {
          enabled: true,
          ...(capability ? { capability } : {})
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });

      return models
        .map(toRuntimeAiModel)
        .filter((model) =>
          surface
            ? isModelDisplaySurfaceCompatible(model.capability, surface) &&
              normalizeModelDisplaySurfaces(
                model.displaySurfaces,
                model.capability
              ).includes(surface)
            : true
        );
    },
    async listAdminModels() {
      const models = await client.aiModel.findMany({
        include: {
          routes: {
            include: {
              provider: {
                select: {
                  name: true
                }
              }
            },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
          }
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });

      return models.map(toAdminAiModelSummary);
    },
    async findModelByModelId(modelId) {
      const slugMatch = await client.aiModel.findUnique({
        where: { slug: modelId }
      });

      if (slugMatch) {
        return toRuntimeAiModel(slugMatch);
      }

      const legacyMatches = await client.aiModel.findMany({
        where: { modelId }
      });

      if (legacyMatches.length > 1) {
        throw new ModelIdentityConflictError("AMBIGUOUS_LEGACY_MODEL_ID");
      }

      return legacyMatches[0] ? toRuntimeAiModel(legacyMatches[0]) : null;
    },
    async findModelById(id) {
      const model = await client.aiModel.findUnique({
        where: { id }
      });

      return model ? toRuntimeAiModel(model) : null;
    },
    async createModel(input) {
      const slug = await createUniqueModelSlug(client, input.name, input.modelId);
      await assertModelIdentityMutation(client, {
        modelId: input.modelId,
        slug
      });

      const model = await client.aiModel.create({
        data: {
          name: input.name,
          displayName: input.displayName || null,
          slug,
          provider: input.provider,
          providerAccountId: input.providerAccountId ?? null,
          capability: input.capability,
          displaySurfaces: normalizeModelDisplaySurfaces(
            input.displaySurfaces,
            input.capability
          ),
          imageInvokeMode: input.imageInvokeMode ?? null,
          imageOutputParser: input.imageOutputParser ?? null,
          maxReferenceImages: input.maxReferenceImages ?? 1,
          modelId: input.modelId,
          enabled: input.enabled,
          creditCost: input.creditCost,
          allowGuest: input.allowGuest,
          sortOrder: input.sortOrder,
          group: input.group,
          tags: input.tags.join(","),
          shortDescription: input.shortDescription || null,
          isRecommended: input.isRecommended,
          iconUrl: input.iconUrl || null,
          iconText: input.iconText || null,
          iconColor: input.iconColor || null,
          description: input.shortDescription || null
        }
      });

      return toAdminAiModelSummary(model);
    },
    async updateModel(id, input) {
      const existing = await client.aiModel.findUnique({
        where: { id }
      });

      if (!existing) {
        return null;
      }

      if (input.modelId !== undefined && input.modelId !== existing.modelId) {
        await assertModelIdentityMutation(client, {
          modelId: input.modelId,
          slug: existing.slug,
          currentId: existing.id
        });
      }

      const model = await client.aiModel.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.displayName !== undefined
            ? { displayName: input.displayName || null }
            : {}),
          ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.provider !== undefined ? { provider: input.provider } : {}),
          ...(input.providerAccountId !== undefined
            ? { providerAccountId: input.providerAccountId }
            : {}),
          ...(input.capability !== undefined ? { capability: input.capability } : {}),
          ...(input.displaySurfaces !== undefined
            ? {
                displaySurfaces: normalizeModelDisplaySurfaces(
                  input.displaySurfaces,
                  input.capability ?? normalizeModelCapability(existing.capability)
                )
              }
            : {}),
          ...(input.imageInvokeMode !== undefined
            ? { imageInvokeMode: input.imageInvokeMode }
            : {}),
          ...(input.imageOutputParser !== undefined
            ? { imageOutputParser: input.imageOutputParser }
            : {}),
          ...(input.maxReferenceImages !== undefined
            ? { maxReferenceImages: input.maxReferenceImages }
            : {}),
          ...(input.group !== undefined ? { group: input.group } : {}),
          ...(input.tags !== undefined ? { tags: input.tags.join(",") } : {}),
          ...(input.shortDescription !== undefined
            ? { shortDescription: input.shortDescription || null }
            : {}),
          ...(input.isRecommended !== undefined
            ? { isRecommended: input.isRecommended }
            : {}),
          ...(input.creditCost !== undefined
            ? { creditCost: input.creditCost }
            : {}),
          ...(input.allowGuest !== undefined
            ? { allowGuest: input.allowGuest }
            : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.iconUrl !== undefined
            ? { iconUrl: input.iconUrl || null }
            : {}),
          ...(input.iconText !== undefined
            ? { iconText: input.iconText || null }
            : {}),
          ...(input.iconColor !== undefined
            ? { iconColor: input.iconColor || null }
            : {})
        }
      });

      return toAdminAiModelSummary(model);
    },
    async disableModel(id) {
      const existing = await client.aiModel.findUnique({
        where: { id }
      });

      if (!existing) {
        return null;
      }

      const model = await client.aiModel.update({
        where: { id },
        data: {
          enabled: false
        }
      });

      return toAdminAiModelSummary(model);
    },
    async deleteModel(id) {
      const existing = await client.aiModel.findUnique({
        where: { id }
      });

      if (!existing) {
        return { deleted: false, reason: "Model not found" };
      }

      // Safety: check if this is the current default model
      const defaultModelSetting = await client.siteSetting.findUnique({
        where: { key: "defaultModel" }
      });

      if (
        defaultModelSetting?.value?.trim() &&
        defaultModelSetting.value.trim() === existing.modelId
      ) {
        return {
          deleted: false,
          reason:
            "This model is the current default model. Please change the default model first."
        };
      }

      // Safety: check if this is the last enabled model
      const enabledCount = await client.aiModel.count({
        where: { enabled: true }
      });

      if (existing.enabled && enabledCount <= 1) {
        return {
          deleted: false,
          reason: "At least one enabled model must remain."
        };
      }

      const model = await client.aiModel.delete({
        where: { id }
      });

      return {
        deleted: true,
        model: toAdminAiModelSummary(model)
      };
    },
    async listModelRoutes(modelId) {
      const routes = await client.aiModelRoute.findMany({
        where: { modelId },
        include: {
          provider: {
            select: {
              name: true
            }
          }
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
      });

      return routes.map(toAiModelRouteSummary);
    },
    async listEnabledModelRoutesForModel(modelId) {
      const routes = await client.aiModelRoute.findMany({
        where: {
          modelId,
          enabled: true,
          provider: {
            enabled: true
          }
        },
        include: {
          provider: true
        },
        orderBy: [
          { priority: "asc" },
          { provider: { priority: "asc" } },
          { createdAt: "asc" }
        ]
      });

      return routes
        .filter((route) => !isProviderAccountRuntimeUnavailable(route.provider))
        .map((route) => ({
          ...toAiModelRouteSummary(route),
          providerAccount: {
            ...toProviderAccountRuntime(route.provider),
            priority: route.provider.priority
          }
        }));
    },
    async createModelRoute(input) {
      const route = await client.aiModelRoute.create({
        data: {
          modelId: input.modelId,
          providerId: input.providerId,
          upstreamModel: input.upstreamModel,
          priority: input.priority ?? 0,
          enabled: input.enabled ?? true
        },
        include: {
          provider: {
            select: {
              name: true
            }
          }
        }
      });

      return toAiModelRouteSummary(route);
    },
    async updateModelRoute(id, input) {
      const existing = await client.aiModelRoute.findUnique({
        where: { id }
      });

      if (!existing) {
        return null;
      }

      const route = await client.aiModelRoute.update({
        where: { id },
        data: {
          ...(input.providerId !== undefined ? { providerId: input.providerId } : {}),
          ...(input.upstreamModel !== undefined
            ? { upstreamModel: input.upstreamModel }
            : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {})
        },
        include: {
          provider: {
            select: {
              name: true
            }
          }
        }
      });

      return toAiModelRouteSummary(route);
    },
    async disableModelRoute(id) {
      return this.updateModelRoute(id, { enabled: false });
    },
    async listProviderAccounts() {
      const accounts = await client.aiProviderAccount.findMany({
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
      });

      return accounts.map(toAiProviderAccountSummary);
    },
    async findProviderAccountById(id) {
      const account = await client.aiProviderAccount.findUnique({
        where: { id }
      });

      return account ? toAiProviderAccountSummary(account) : null;
    },
    async findProviderAccountRuntimeById(id) {
      const account = await client.aiProviderAccount.findUnique({
        where: { id }
      });

      return account ? toProviderAccountRuntime(account) : null;
    },
    async createProviderAccount(input) {
      const account = await client.aiProviderAccount.create({
        data: {
          name: input.name,
          providerType: input.providerType,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey ?? "",
          capabilities: input.capabilities,
          enabled: input.enabled ?? true,
          priority: input.priority ?? 0,
          timeoutMs: input.timeoutMs ?? 60000,
          headersJson: (
            input.headersJson !== null && input.headersJson !== undefined
              ? input.headersJson
              : Prisma.DbNull
          ) as Prisma.AiProviderAccountCreateInput["headersJson"],
          configJson: (
            input.configJson !== null && input.configJson !== undefined
              ? input.configJson
              : Prisma.DbNull
          ) as Prisma.AiProviderAccountCreateInput["configJson"],
          notes: input.notes ?? null
        }
      });

      return toAiProviderAccountSummary(account);
    },
    async updateProviderAccount(id, input) {
      const existing = await client.aiProviderAccount.findUnique({
        where: { id }
      });

      if (!existing) {
        return null;
      }

      let normalizedApiKey: string | undefined;
      if (input.apiKey !== undefined) {
        normalizedApiKey = input.apiKey.trim();
        if (!normalizedApiKey) {
          throw new ProviderAccountValidationError();
        }
      }

      const account = await client.aiProviderAccount.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.providerType !== undefined
            ? { providerType: input.providerType }
            : {}),
          ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
          ...(normalizedApiKey !== undefined
            ? { apiKey: normalizedApiKey }
            : {}),
          ...(input.capabilities !== undefined
            ? { capabilities: input.capabilities }
            : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
          ...(input.headersJson !== undefined
            ? {
                headersJson: (
                  input.headersJson !== null
                    ? input.headersJson
                    : Prisma.DbNull
                ) as Prisma.AiProviderAccountUpdateInput["headersJson"]
              }
            : {}),
          ...(input.configJson !== undefined
            ? {
                configJson: (
                  input.configJson !== null
                    ? input.configJson
                    : Prisma.DbNull
                ) as Prisma.AiProviderAccountUpdateInput["configJson"]
              }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {})
        }
      });

      return toAiProviderAccountSummary(account);
    },
    async disableProviderAccount(id) {
      const existing = await client.aiProviderAccount.findUnique({
        where: { id }
      });

      if (!existing) {
        return null;
      }

      const account = await client.aiProviderAccount.update({
        where: { id },
        data: { enabled: false }
      });

      return toAiProviderAccountSummary(account);
    },
    async listEnabledPlans() {
      const plans = await client.plan.findMany({
        where: { enabled: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });

      return plans.map(toPlanSummary);
    },
    async listAdminPlans() {
      const plans = await client.plan.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });

      return plans.map(toPlanSummary);
    },
    async createPlan(input) {
      const plan = await client.plan.create({
        data: {
          name: input.name,
          price: input.price,
          credits: input.credits,
          description: input.description,
          features: input.features,
          enabled: input.enabled,
          sortOrder: input.sortOrder
        }
      });

      return toPlanSummary(plan);
    },
    async updatePlan(id, input) {
      const existing = await client.plan.findUnique({
        where: { id }
      });

      if (!existing) {
        return null;
      }

      const plan = await client.plan.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(input.credits !== undefined ? { credits: input.credits } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.features !== undefined ? { features: input.features } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {})
        }
      });

      return toPlanSummary(plan);
    },
    async listSettings(keys) {
      const settings = await client.siteSetting.findMany({
        where: {
          key: {
            in: [...keys]
          }
        },
        orderBy: { key: "asc" }
      });

      return settings.map(toSiteSettingSummary);
    },
    async listPublicSettings() {
      const settings = await client.siteSetting.findMany({
        where: {
          key: {
            in: publicSettingKeys
          }
        },
        orderBy: { key: "asc" }
      });

      return settings.map(toSiteSettingSummary);
    },
    async getSetting(key) {
      const setting = await client.siteSetting.findUnique({
        where: { key }
      });

      return setting ? toSiteSettingSummary(setting) : null;
    },
    async updateSettings(input) {
      const updates = await client.$transaction(
        input.map((setting) =>
          client.siteSetting.upsert({
            where: { key: setting.key },
            update: {
              value: setting.value,
              ...(setting.type !== undefined ? { type: setting.type } : {}),
              ...(setting.description !== undefined
                ? { description: setting.description }
                : {})
            },
            create: {
              key: setting.key,
              value: setting.value,
              type: setting.type ?? "string",
              description: setting.description ?? null
            }
          })
        )
      );

      return updates.map(toSiteSettingSummary);
    },
    async updateSettingAtomically(input) {
      return client.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO \`SiteSetting\` (\`key\`, \`value\`, \`type\`, \`description\`, \`updatedAt\`)
          VALUES (
            ${input.key},
            ${input.create.value},
            ${input.create.type ?? "string"},
            ${input.create.description ?? null},
            CURRENT_TIMESTAMP(3)
          )
          ON DUPLICATE KEY UPDATE \`key\` = \`key\`
        `;
        await tx.$queryRaw<Array<{ key: string }>>`
          SELECT \`key\`
          FROM \`SiteSetting\`
          WHERE \`key\` = ${input.key}
          FOR UPDATE
        `;
        const current = await tx.siteSetting.findUnique({
          where: { key: input.key }
        });
        const next = await input.update(
          current ? toSiteSettingSummary(current) : null
        );
        const saved = await tx.siteSetting.update({
          where: { key: input.key },
          data: {
            value: next.value,
            ...(next.type !== undefined ? { type: next.type } : {}),
            ...(next.description !== undefined
              ? { description: next.description }
              : {})
          }
        });
        return toSiteSettingSummary(saved);
      });
    },
    async createOrder(input) {
      const plan = await client.plan.findFirst({
        where: {
          id: input.planId,
          enabled: true
        }
      });

      if (!plan) {
        return null;
      }

      const pendingOrder = await client.order.findFirst({
        where: {
          userId: input.userId,
          planId: plan.id,
          status: "PENDING"
        },
        include: {
          plan: true
        },
        orderBy: { createdAt: "desc" }
      });

      if (pendingOrder) {
        return toOrderSummary(pendingOrder);
      }

      const order = await client.order.create({
        data: {
          userId: input.userId,
          planId: plan.id,
          amount: plan.price,
          credits: plan.credits,
          status: "PENDING"
        },
        include: {
          plan: true
        }
      });

      return toOrderSummary(order);
    },
    async listOrdersForUser(userId) {
      const orders = await client.order.findMany({
        where: { userId },
        include: {
          plan: true
        },
        orderBy: { createdAt: "desc" }
      });

      return orders.map(toOrderSummary);
    },
    async cancelPendingOrderForUser(input) {
      const ownershipScope = {
        id: input.orderId,
        userId: input.userId
      };
      const existing = await client.order.findFirst({
        where: ownershipScope,
        include: { plan: true }
      });

      if (!existing) {
        return { status: "NOT_FOUND_OR_NOT_OWNED", order: null };
      }

      if (existing.status === "PAID") {
        return { status: "ORDER_PAID_CANNOT_BE_CANCELLED", order: null };
      }

      if (existing.status === "CANCELLED") {
        return {
          status: "CANCELLED",
          order: toOrderSummary(existing),
          alreadyCancelled: true
        };
      }

      const statusUpdate = await client.order.updateMany({
        where: {
          ...ownershipScope,
          status: "PENDING"
        },
        data: {
          status: "CANCELLED"
        }
      });
      const current = await client.order.findFirst({
        where: ownershipScope,
        include: { plan: true }
      });

      if (!current) {
        return { status: "NOT_FOUND_OR_NOT_OWNED", order: null };
      }

      if (statusUpdate.count === 1) {
        if (current.status !== "CANCELLED") {
          return { status: "ORDER_STATUS_CONCURRENCY_CONFLICT", order: null };
        }
        return {
          status: "CANCELLED",
          order: toOrderSummary(current),
          alreadyCancelled: false
        };
      }

      if (current.status === "PAID") {
        return { status: "ORDER_PAID_CANNOT_BE_CANCELLED", order: null };
      }

      if (current.status === "CANCELLED") {
        return {
          status: "CANCELLED",
          order: toOrderSummary(current),
          alreadyCancelled: true
        };
      }

      return { status: "ORDER_STATUS_CONCURRENCY_CONFLICT", order: null };
    },
    async listAdminOrders(filters = 50) {
      const normalizedFilters =
        typeof filters === "number" ? { limit: filters } : filters;
      const q = normalizedFilters.q?.trim();
      const orders = await client.order.findMany({
        where: {
          ...(normalizedFilters.status
            ? { status: normalizedFilters.status }
            : {}),
          ...(normalizedFilters.paymentType
            ? { paymentType: normalizedFilters.paymentType }
            : {}),
          ...(normalizedFilters.review
            ? {
                paymentAttempts: {
                  some: { status: "PAID_REQUIRES_REVIEW" as const }
                }
              }
            : {}),
          ...(q
            ? {
                OR: [
                  { id: { contains: q } },
                  { plan: { is: { name: { contains: q } } } },
                  { user: { is: { email: { contains: q } } } },
                  { paymentTradeNo: { contains: q } },
                  { providerTradeNo: { contains: q } }
                ]
              }
            : {})
        },
        include: {
          plan: true,
          user: true,
          paymentAttempts: {
            where: { status: "PAID_REQUIRES_REVIEW" },
            orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }]
          }
        },
        orderBy: { createdAt: "desc" },
        take: normalizedFilters.limit ?? 50
      });

      return orders.map(toAdminOrderSummary);
    },
    async countAdminOrdersRequiringPaymentReview() {
      return client.order.count({
        where: {
          paymentAttempts: {
            some: { status: "PAID_REQUIRES_REVIEW" }
          }
        }
      });
    },
    async findAdminOrderById(orderId) {
      const order = await client.order.findUnique({
        where: { id: orderId },
        include: {
          plan: true,
          user: true,
          paymentAttempts: {
            where: { status: "PAID_REQUIRES_REVIEW" },
            orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }]
          }
        }
      });

      return order ? toAdminOrderSummary(order) : null;
    },
    async findOrderById(orderId) {
      const order = await client.order.findUnique({
        where: { id: orderId },
        include: {
          plan: true
        }
      });

      return order ? toOrderSummary(order) : null;
    },
    async findPaymentAttemptByMerchantTradeNo(merchantTradeNo) {
      const validatedMerchantTradeNo =
        validatePaymentAttemptMerchantTradeNo(merchantTradeNo);
      const attempt = await client.paymentAttempt.findUnique({
        where: { merchantTradeNo: validatedMerchantTradeNo }
      });

      return attempt ? toPaymentAttemptRecord(attempt) : null;
    },
    async findPaymentAttemptByOrderAndOrdinal(orderId, ordinal) {
      const validatedOrderId = validatePaymentAttemptOrderId(orderId);
      const validatedOrdinal = validatePaymentAttemptOrdinal(ordinal);
      const attempt = await client.paymentAttempt.findUnique({
        where: {
          orderId_ordinal: {
            orderId: validatedOrderId,
            ordinal: validatedOrdinal
          }
        }
      });

      return attempt ? toPaymentAttemptRecord(attempt) : null;
    },
    async settlePaymentAttemptFromCallback(input) {
      const validatedInput = validatePaymentAttemptSettlementInput(input);

      try {
        return await client.$transaction(
          (tx) =>
            settlePaymentAttemptInTransaction(tx, validatedInput, testHooks),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (isPrismaUniqueError(error)) {
          return { status: "PAYMENT_REFERENCE_CONFLICT" };
        }
        if (error instanceof PaymentAttemptSettlementCasError) {
          return { status: "INVALID_PAYMENT_STATE" };
        }
        throw error;
      }
    },
    async materializeAndSettleLegacyPaymentAttemptFromCallback(input) {
      const validatedInput = {
        ...validatePaymentAttemptSettlementInput(input),
        orderId: validatePaymentAttemptOrderId(input.orderId)
      };
      if (validatedInput.provider !== "epay") {
        return { status: "PAYMENT_IDENTITY_MISMATCH" };
      }

      try {
        return await client.$transaction(
          (tx) =>
            materializeLegacyPaymentAttemptInTransaction(
              tx,
              validatedInput,
              testHooks
            ),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (error instanceof LegacyPaymentAttemptMaterializationRollbackError) {
          return error.result;
        }
        if (isInitialPaymentAttemptUniqueConflict(error)) {
          try {
            return await client.$transaction(
              (tx) =>
                settleStrictInitialPaymentAttemptInTransaction(
                  tx,
                  validatedInput,
                  testHooks
                ),
              {
                isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
              }
            );
          } catch (convergenceError) {
            if (isPrismaUniqueError(convergenceError)) {
              return { status: "PAYMENT_REFERENCE_CONFLICT" };
            }
            if (convergenceError instanceof PaymentAttemptSettlementCasError) {
              return { status: "INVALID_PAYMENT_STATE" };
            }
            throw convergenceError;
          }
        }
        if (isPrismaUniqueError(error)) {
          return { status: "PAYMENT_REFERENCE_CONFLICT" };
        }
        if (error instanceof PaymentAttemptSettlementCasError) {
          return { status: "INVALID_PAYMENT_STATE" };
        }
        throw error;
      }
    },
    async initializeInitialPaymentAttempt(input) {
      const identity = validateInitialPaymentAttemptIdentity({
        orderId: input.orderId,
        provider: input.provider,
        providerMerchantRef: input.providerMerchantRef,
        paymentType: input.paymentType,
        merchantTradeNo: input.merchantTradeNo
      });
      const paymentUrl = validateInitialPaymentUrl(input.paymentUrl);

      try {
        return await client.$transaction(async (tx) => {
          const updatedCount = await tx.order.updateMany({
            where: {
              id: identity.orderId,
              status: "PENDING",
              paymentProvider: null,
              paymentType: null,
              paymentTradeNo: null,
              providerTradeNo: null,
              paymentUrl: null,
              paidAt: null
            },
            data: {
              paymentProvider: identity.provider,
              paymentType: identity.paymentType,
              paymentTradeNo: identity.merchantTradeNo,
              paymentUrl
            }
          });

          if (updatedCount.count === 0) {
            return readCommittedInitialPaymentAttemptState(tx, identity);
          }

          const attempt = await tx.paymentAttempt.create({
            data: {
              orderId: identity.orderId,
              ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
              provider: identity.provider,
              providerMerchantRef: identity.providerMerchantRef,
              paymentType: identity.paymentType,
              merchantTradeNo: identity.merchantTradeNo,
              providerTradeNo: null,
              providerTradeIdentityHash: null,
              status: "ACTIVE",
              paidAt: null
            }
          });

          const order = await tx.order.findUnique({
            where: { id: identity.orderId },
            include: { plan: true }
          });

          if (!order) {
            throw new Error("INITIAL_PAYMENT_ORDER_DISAPPEARED");
          }

          const initialized = toCompatibleInitialPaymentAttemptResult(
            "INITIALIZED",
            order,
            attempt,
            identity
          );
          if (!initialized) {
            throw new Error("INITIAL_PAYMENT_TRANSACTION_INCONSISTENT");
          }

          return initialized;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        });
      } catch (error) {
        if (isInitialPaymentAttemptUniqueConflict(error)) {
          return readCommittedInitialPaymentAttemptState(client, identity);
        }
        if (isPrismaUniqueError(error)) {
          return { status: "PAYMENT_REFERENCE_CONFLICT" };
        }
        throw error;
      }
    },
    async findOrderByPaymentTradeNo(paymentTradeNo) {
      const order = await client.order.findUnique({
        where: { paymentTradeNo },
        include: { plan: true }
      });

      return order ? toOrderSummary(order) : null;
    },
    async confirmPaidOrderFromPayment(orderId, data) {
      let result: MarkPaidOrderTransactionResult;

      try {
        result = await client.$transaction(
          (tx) =>
            markPaidOrderInTransaction(tx, {
              orderId,
              paidAt: data.paidAt,
              providerTradeNo: data.providerTradeNo,
              paymentType: data.paymentType,
              eventSourceType: "PAYMENT_PAID",
              afterCreditEventCreated: testHooks?.afterFinancialCreditEventCreated
            }),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
          }
        );
      } catch (error) {
        if (isPrismaUniqueError(error)) {
          return {
            status: "PAYMENT_REFERENCE_CONFLICT",
            order: null,
            alreadyPaid: false
          };
        }
        throw error;
      }

      if (result.status === "PAID") {
        return {
          status: "PAID",
          order: toOrderSummary(result.order),
          alreadyPaid: false
        };
      }

      if (result.status === "ALREADY_PAID") {
        return {
          status: "ALREADY_PAID",
          order: toOrderSummary(result.order),
          alreadyPaid: true
        };
      }

      return {
        status: result.status,
        order: null,
        alreadyPaid: false
      };
    },
    async markOrderPaidByAdmin(input) {
      const result = await client.$transaction(
        (tx) =>
          markPaidOrderInTransaction(tx, {
            orderId: input.orderId,
            paidAt: new Date(),
            eventSourceType: "ADMIN_MANUAL_PAID",
            auditActor: {
              adminUserId: input.adminUserId,
              adminEmail: input.adminEmail
            },
            afterAuditLogCreated: testHooks?.afterFinancialAuditLogCreated,
            afterCreditEventCreated: testHooks?.afterFinancialCreditEventCreated
          }),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );

      return result.status === "PAID" || result.status === "ALREADY_PAID"
        ? toAdminOrderSummary(result.order)
        : null;
    },
    async updateOrderStatus(orderId, status) {
      const existing = await client.order.findUnique({
        where: { id: orderId },
        include: {
          plan: true,
          user: true
        }
      });

      if (!existing) {
        return null;
      }

      if (existing.status === "PAID" && status === "CANCELLED") {
        throw new Error("ORDER_PAID_CANNOT_BE_CANCELLED");
      }

      if (status === "PAID") {
        throw new Error("ADMIN_PAID_REQUIRES_FINANCIAL_CONTEXT");
      }

      if (existing.status === status) {
        return toAdminOrderSummary(existing);
      }

      if (existing.status !== "PENDING") {
        throw new Error("ORDER_STATUS_NOT_EDITABLE");
      }

      if (status !== "CANCELLED") {
        throw new Error("ORDER_STATUS_NOT_EDITABLE");
      }

      const statusUpdate = await client.order.updateMany({
        where: {
          id: orderId,
          status: "PENDING"
        },
        data: {
          status: "CANCELLED",
          paidAt: null
        }
      });

      const current = await client.order.findUnique({
        where: { id: orderId },
        include: {
          plan: true,
          user: true
        }
      });

      if (!current) {
        return null;
      }

      if (statusUpdate.count === 1) {
        if (current.status !== "CANCELLED") {
          throw new Error("ORDER_STATUS_CONCURRENCY_CONFLICT");
        }
        return toAdminOrderSummary(current);
      }

      if (current.status === "PAID") {
        throw new Error("ORDER_PAID_CANNOT_BE_CANCELLED");
      }

      if (current.status === "CANCELLED") {
        return toAdminOrderSummary(current);
      }

      throw new Error("ORDER_STATUS_CONCURRENCY_CONFLICT");
    },
    async createAuditLog(input) {
      const log = await client.adminAuditLog.create({
        data: {
          adminUserId: input.adminUserId,
          adminEmail: input.adminEmail,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          summary: input.summary,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          metadata: (input.metadata
            ? redactSensitiveMetadata(input.metadata)
            : undefined) as any
        }
      });

      return toAdminAuditLogEntry(log);
    },
    async listAdminAuditLogs(limit = 50) {
      const logs = await client.adminAuditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit
      });

      return logs.map(toAdminAuditLogEntry);
    },
    async createFeedback(input) {
      const feedback = await client.feedback.create({
        data: {
          userId: input.userId ?? null,
          userEmail: input.userEmail ?? null,
          type: input.type,
          content: input.content,
          screenshotUrl: input.screenshotUrl ?? null
        }
      });

      return toFeedbackEntry(feedback);
    },
    async listAdminFeedbacks(limit = 50, includeArchived = false) {
      const feedbacks = await client.feedback.findMany({
        where: includeArchived ? undefined : { archivedAt: null },
        orderBy: { createdAt: "desc" },
        take: limit
      });

      return feedbacks.map(toFeedbackEntry);
    },
    async updateFeedbackStatus(feedbackId, status) {
      const existing = await client.feedback.findUnique({
        where: { id: feedbackId }
      });

      if (!existing) {
        return null;
      }

      const feedback = await client.feedback.update({
        where: { id: feedbackId },
        data: { status }
      });

      return toFeedbackEntry(feedback);
    },
    async archiveFeedback(feedbackId) {
      const existing = await client.feedback.findUnique({
        where: { id: feedbackId }
      });

      if (!existing) {
        return null;
      }

      const feedback = await client.feedback.update({
        where: { id: feedbackId },
        data: { archivedAt: existing.archivedAt ?? new Date() }
      });

      return toFeedbackEntry(feedback);
    },
    async createLink(input) {
      const link = await client.link.create({
        data: {
          title: input.title,
          url: input.url,
          description: input.description ?? null,
          category: input.category,
          enabled: input.enabled ?? true,
          sortOrder: input.sortOrder ?? 0
        }
      });

      return toLinkEntry(link);
    },
    async updateLink(linkId, input) {
      const existing = await client.link.findUnique({
        where: { id: linkId }
      });

      if (!existing) {
        return null;
      }

      const link = await client.link.update({
        where: { id: linkId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.description !== undefined
            ? { description: input.description || null }
            : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {})
        }
      });

      return toLinkEntry(link);
    },
    async deleteLink(linkId) {
      const existing = await client.link.findUnique({
        where: { id: linkId }
      });

      if (!existing) {
        return null;
      }

      const link = await client.link.delete({
        where: { id: linkId }
      });

      return toLinkEntry(link);
    },
    async listAdminLinks() {
      const links = await client.link.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }]
      });

      return links.map(toLinkEntry);
    },
    async listPublicLinks(category) {
      const links = await client.link.findMany({
        where: {
          enabled: true,
          ...(category ? { category } : {})
        },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }]
      });

      return links.map(toLinkEntry);
    },
    async countAdmins() {
      return client.user.count({ where: { role: "ADMIN" } });
    },
    async setUserRole(userId, role) {
      try {
        await client.user.update({
          where: { id: userId },
          data: { role }
        });
        return true;
      } catch {
        return false;
      }
    },
    async getPaymentSetting(provider) {
      const setting = await client.paymentSetting.findUnique({
        where: { provider }
      });
      return setting ?? null;
    },
    async upsertPaymentSetting(provider, data) {
      return client.paymentSetting.upsert({
        where: { provider },
        update: {
          enabled: data.enabled,
          ...(data.gatewayUrl !== undefined ? { gatewayUrl: data.gatewayUrl } : {}),
          ...(data.pid !== undefined ? { pid: data.pid } : {}),
          ...(data.encryptedKey !== undefined ? { encryptedKey: data.encryptedKey } : {}),
          ...(data.notifyUrl !== undefined ? { notifyUrl: data.notifyUrl } : {}),
          ...(data.returnUrl !== undefined ? { returnUrl: data.returnUrl } : {})
        },
        create: {
          provider,
          enabled: data.enabled,
          gatewayUrl: data.gatewayUrl ?? null,
          pid: data.pid ?? null,
          encryptedKey: data.encryptedKey ?? null,
          notifyUrl: data.notifyUrl ?? null,
          returnUrl: data.returnUrl ?? null
        }
      });
    },
    async createPendingStorageObject(input) {
      const userId = normalizeStorageObjectUserId(input.userId);
      const storageProvider = validateStorageProvider(input.storageProvider);
      const objectKey = validateStorageObjectKey(input.objectKey);
      const source = validateStorageObjectSource(input.source);
      const expiresAt = validateStorageObjectExpiresAt(input.expiresAt);

      try {
        const storageObject = await client.storageObject.create({
          data: {
            userId,
            storageProvider,
            objectKey,
            mimeType: null,
            sizeBytes: null,
            sha256: null,
            source,
            status: StorageObjectStatus.PENDING,
            expiresAt,
            deletedAt: null
          }
        });

        return toStorageObjectRecord(storageObject);
      } catch (error) {
        if (isPrismaUniqueError(error)) {
          throw new Error("STORAGE_OBJECT_KEY_CONFLICT");
        }
        throw error;
      }
    },
    async findStorageObjectForUser(userId, id) {
      const normalizedUserId = normalizeStorageObjectUserId(userId);
      const normalizedId = normalizeStorageObjectId(id);
      const storageObject = await client.storageObject.findFirst({
        where: {
          id: normalizedId,
          userId: normalizedUserId
        }
      });

      return storageObject ? toStorageObjectRecord(storageObject) : null;
    },
    async findReadyStorageObjectForUser(userId, id) {
      const normalizedUserId = normalizeStorageObjectUserId(userId);
      const normalizedId = normalizeStorageObjectId(id);
      const storageObject = await client.storageObject.findFirst({
        where: {
          id: normalizedId,
          userId: normalizedUserId,
          status: StorageObjectStatus.READY
        }
      });

      return storageObject ? toStorageObjectRecord(storageObject) : null;
    },
    async markStorageObjectReady(input) {
      const userId = normalizeStorageObjectUserId(input.userId);
      const id = normalizeStorageObjectId(input.id);
      const mimeType = validateStorageObjectMimeType(input.mimeType);
      const sizeBytes = validateStorageObjectSizeBytes(input.sizeBytes);
      const sha256 = validateStorageObjectSha256(input.sha256);
      const update = await client.storageObject.updateMany({
        where: {
          id,
          userId,
          status: StorageObjectStatus.PENDING
        },
        data: {
          status: StorageObjectStatus.READY,
          mimeType,
          sizeBytes,
          sha256
        }
      });

      if (update.count === 1) {
        return { status: "UPDATED" };
      }

      const status = await findStorageObjectStatusForUser(client, userId, id);
      if (status === null) {
        return { status: "NOT_FOUND" };
      }
      if (status === StorageObjectStatus.READY) {
        return { status: "ALREADY_READY" };
      }
      return { status: "INVALID_STATE" };
    },
    async markStorageObjectFailed(input) {
      const userId = normalizeStorageObjectUserId(input.userId);
      const id = normalizeStorageObjectId(input.id);
      const update = await client.storageObject.updateMany({
        where: {
          id,
          userId,
          status: StorageObjectStatus.PENDING
        },
        data: {
          status: StorageObjectStatus.FAILED
        }
      });

      if (update.count === 1) {
        return { status: "UPDATED" };
      }

      const status = await findStorageObjectStatusForUser(client, userId, id);
      if (status === null) {
        return { status: "NOT_FOUND" };
      }
      if (status === StorageObjectStatus.FAILED) {
        return { status: "ALREADY_FAILED" };
      }
      return { status: "INVALID_STATE" };
    },
    async markStorageObjectDeleted(input) {
      const userId = normalizeStorageObjectUserId(input.userId);
      const id = normalizeStorageObjectId(input.id);
      const update = await client.storageObject.updateMany({
        where: {
          id,
          userId,
          status: {
            in: [StorageObjectStatus.READY, StorageObjectStatus.FAILED]
          }
        },
        data: {
          status: StorageObjectStatus.DELETED,
          deletedAt: new Date()
        }
      });

      if (update.count === 1) {
        return { status: "UPDATED" };
      }

      const status = await findStorageObjectStatusForUser(client, userId, id);
      if (status === null) {
        return { status: "NOT_FOUND" };
      }
      if (status === StorageObjectStatus.DELETED) {
        return { status: "ALREADY_DELETED" };
      }
      return { status: "INVALID_STATE" };
    },
    async claimGeneratedStorageObjectForCompensation(input) {
      const userId = normalizeStorageObjectUserId(input.userId);
      const storageObjectId = normalizeStorageObjectId(input.storageObjectId);
      const now = validateStorageCleanupDate(
        input.now,
        "INVALID_STORAGE_CLEANUP_NOW"
      );

      return client.$transaction(
        async (tx) => {
          const storageObjects =
            await tx.$queryRaw<LockedStorageObjectCleanupRecord[]>(
              Prisma.sql`
                SELECT
                  \`id\`,
                  \`objectKey\`,
                  \`storageProvider\`,
                  \`source\`,
                  \`status\`,
                  \`deletedAt\`,
                  \`updatedAt\`
                FROM \`StorageObject\`
                WHERE \`id\` = ${storageObjectId}
                  AND \`userId\` = ${userId}
                FOR UPDATE
              `
            );
          const storageObject = storageObjects[0];
          if (!storageObject) {
            return { status: "NOT_FOUND" as const };
          }

          if (!isReadyGeneratedStorageObjectCompensationEligible(storageObject)) {
            return { status: "NOT_ELIGIBLE" as const };
          }

          if (await hasStorageObjectBusinessReference(tx, storageObjectId)) {
            return { status: "SKIPPED_REFERENCED" as const };
          }

          const update = await tx.storageObject.updateMany({
            where: {
              id: storageObjectId,
              userId,
              status: StorageObjectStatus.READY,
              storageProvider: StorageProvider.LOCAL,
              source: StorageObjectSource.GENERATED,
              deletedAt: null
            },
            data: {
              status: StorageObjectStatus.DELETED,
              deletedAt: now
            }
          });
          if (update.count !== 1) {
            return { status: "LOST_RACE" as const };
          }

          return {
            status: "CLAIMED" as const,
            id: storageObject.id,
            objectKey: storageObject.objectKey
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async listReadyGeneratedStorageObjectCleanupCandidates(input) {
      const readyBefore = validateStorageCleanupDate(
        input.readyBefore,
        "INVALID_STORAGE_CLEANUP_READY_BEFORE"
      );
      const limit = validateStorageCleanupLimit(input.limit);
      const candidates = await client.storageObject.findMany({
        where: {
          status: StorageObjectStatus.READY,
          storageProvider: StorageProvider.LOCAL,
          source: StorageObjectSource.GENERATED,
          deletedAt: null,
          updatedAt: { lte: readyBefore },
          assets: { none: {} },
          avatarUsers: { none: {} }
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: limit,
        select: { id: true }
      });

      return candidates;
    },
    async listDeletedGeneratedStorageObjectCleanupCandidates(input) {
      const limit = validateStorageCleanupLimit(input.limit);
      const candidates = await client.storageObject.findMany({
        where: {
          status: StorageObjectStatus.DELETED,
          storageProvider: StorageProvider.LOCAL,
          source: StorageObjectSource.GENERATED,
          deletedAt: { not: null },
          assets: { none: {} },
          avatarUsers: { none: {} }
        },
        orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
        take: limit,
        select: { id: true }
      });

      return candidates;
    },
    async tombstoneReadyGeneratedStorageObjectForCleanup(input) {
      const storageObjectId = normalizeStorageObjectId(input.storageObjectId);
      const readyBefore = validateStorageCleanupDate(
        input.readyBefore,
        "INVALID_STORAGE_CLEANUP_READY_BEFORE"
      );
      const now = validateStorageCleanupDate(
        input.now,
        "INVALID_STORAGE_CLEANUP_NOW"
      );

      return client.$transaction(
        async (tx) => {
          const storageObjects =
            await tx.$queryRaw<LockedStorageObjectCleanupRecord[]>(
              Prisma.sql`
                SELECT
                  \`id\`,
                  \`objectKey\`,
                  \`storageProvider\`,
                  \`source\`,
                  \`status\`,
                  \`deletedAt\`,
                  \`updatedAt\`
                FROM \`StorageObject\`
                WHERE \`id\` = ${storageObjectId}
                FOR UPDATE
              `
            );
          const storageObject = storageObjects[0];
          if (!storageObject) {
            return { status: "NOT_FOUND" as const };
          }

          if (
            !isReadyGeneratedStorageObjectCleanupEligible(
              storageObject,
              readyBefore
            )
          ) {
            return { status: "NOT_ELIGIBLE" as const };
          }

          await testHooks?.afterCleanupStorageObjectLocked?.({
            phase: "tombstone",
            storageObjectId
          });

          if (await hasStorageObjectBusinessReference(tx, storageObjectId)) {
            return { status: "SKIPPED_REFERENCED" as const };
          }

          const update = await tx.storageObject.updateMany({
            where: {
              id: storageObjectId,
              status: StorageObjectStatus.READY,
              deletedAt: null
            },
            data: {
              status: StorageObjectStatus.DELETED,
              deletedAt: now
            }
          });
          if (update.count !== 1) {
            return { status: "LOST_RACE" as const };
          }

          return {
            status: "CLAIMED" as const,
            id: storageObject.id,
            objectKey: storageObject.objectKey
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async prepareDeletedGeneratedStorageObjectForPurge(storageObjectId) {
      const normalizedStorageObjectId = normalizeStorageObjectId(storageObjectId);

      return client.$transaction(
        async (tx) => {
          const storageObjects =
            await tx.$queryRaw<LockedStorageObjectCleanupRecord[]>(
              Prisma.sql`
                SELECT
                  \`id\`,
                  \`objectKey\`,
                  \`storageProvider\`,
                  \`source\`,
                  \`status\`,
                  \`deletedAt\`,
                  \`updatedAt\`
                FROM \`StorageObject\`
                WHERE \`id\` = ${normalizedStorageObjectId}
                FOR UPDATE
              `
            );
          const storageObject = storageObjects[0];
          if (!storageObject) {
            return { status: "NOT_FOUND" as const };
          }

          if (
            !isDeletedGeneratedStorageObjectCleanupEligible(
              storageObject,
              true
            )
          ) {
            return { status: "NOT_ELIGIBLE" as const };
          }

          await testHooks?.afterCleanupStorageObjectLocked?.({
            phase: "prepare",
            storageObjectId: normalizedStorageObjectId
          });

          if (
            await hasStorageObjectBusinessReference(
              tx,
              normalizedStorageObjectId
            )
          ) {
            return { status: "SKIPPED_REFERENCED" as const };
          }

          return {
            status: "PREPARED" as const,
            id: storageObject.id,
            objectKey: storageObject.objectKey
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async finalizeDeletedGeneratedStorageObjectPurge(storageObjectId) {
      const normalizedStorageObjectId = normalizeStorageObjectId(storageObjectId);

      return client.$transaction(
        async (tx) => {
          const storageObjects =
            await tx.$queryRaw<LockedStorageObjectCleanupRecord[]>(
              Prisma.sql`
                SELECT
                  \`id\`,
                  \`objectKey\`,
                  \`storageProvider\`,
                  \`source\`,
                  \`status\`,
                  \`deletedAt\`,
                  \`updatedAt\`
                FROM \`StorageObject\`
                WHERE \`id\` = ${normalizedStorageObjectId}
                FOR UPDATE
              `
            );
          const storageObject = storageObjects[0];
          if (!storageObject) {
            return { status: "ALREADY_PURGED" as const };
          }

          if (
            !isDeletedGeneratedStorageObjectCleanupEligible(
              storageObject,
              false
            )
          ) {
            return { status: "NOT_ELIGIBLE" as const };
          }

          await testHooks?.afterCleanupStorageObjectLocked?.({
            phase: "finalize",
            storageObjectId: normalizedStorageObjectId
          });

          if (
            await hasStorageObjectBusinessReference(
              tx,
              normalizedStorageObjectId
            )
          ) {
            return { status: "SKIPPED_REFERENCED" as const };
          }

          const deleted = await tx.storageObject.deleteMany({
            where: { id: normalizedStorageObjectId }
          });
          if (deleted.count !== 1) {
            throw new Error("STORAGE_OBJECT_PURGE_DELETE_FAILED");
          }

          return { status: "PURGED" as const };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async createAiTask(input) {
      const task = await client.aiTask.create({
        data: toAiTaskCreateData(input)
      });

      return toAiTaskSummary(task);
    },
    async updateAiTaskInput(taskId, input) {
      try {
        const task = await client.aiTask.update({
          where: { id: taskId },
          data: { input: input as Prisma.InputJsonValue }
        });
        return toAiTaskSummary(task);
      } catch {
        return null;
      }
    },
    async findAiTaskRuntimeForUser(userId, taskId) {
      const task = await client.aiTask.findFirst({
        where: { id: taskId, userId }
      });
      return task ? toAiTaskRuntimeRecord(task) : null;
    },
    async listRunningVideoTaskRuntime() {
      const tasks = await client.aiTask.findMany({
        where: { type: "VIDEO", status: "RUNNING" },
        orderBy: { updatedAt: "asc" },
        take: 100
      });
      return tasks.map(toAiTaskRuntimeRecord);
    },
    async markAiTaskRunning(taskId) {
      try {
        const task = await client.aiTask.update({
          where: { id: taskId },
          data: { status: "RUNNING" }
        });

        return toAiTaskSummary(task);
      } catch {
        return null;
      }
    },
    async completeAiTaskWithAssets(taskId, data) {
      try {
        const result = await client.$transaction(async (tx) => {
          const task = await tx.aiTask.update({
            where: { id: taskId },
            data: {
              status: "SUCCEEDED",
              output: data.output as Prisma.InputJsonValue,
              costCredits: data.costCredits,
              errorMessage: null,
              completedAt: new Date()
            }
          });
          validateAiAssetCompletionInputs(data.assets, taskId, task.userId);

          const assets = await Promise.all(
            data.assets.map((asset) =>
              tx.aiAsset.create({
                data: toAiAssetCreateData(asset, taskId, task.userId)
              })
            )
          );

          return { task, assets };
        });

        return {
          task: toAiTaskSummary(result.task),
          assets: result.assets.map((asset) => toAiAssetSummary(asset))
        };
      } catch {
        return null;
      }
    },
    async failAiTask(taskId, errorMessage) {
      try {
        const task = await client.aiTask.update({
          where: { id: taskId },
          data: {
            status: "FAILED",
            errorMessage,
            costCredits: 0,
            completedAt: new Date()
          }
        });

        return toAiTaskSummary(task);
      } catch {
        return null;
      }
    },
    async listAiTasksForUser(userId, filters = {}) {
      const tasks = await client.aiTask.findMany({
        where: {
          userId,
          ...(filters.type ? { type: toPrismaAiTaskType(filters.type) } : {}),
          ...(filters.status
            ? { status: toPrismaAiTaskStatus(filters.status) }
            : {})
        },
        orderBy: { createdAt: "desc" },
        take: filters.limit ?? 50
      });

      return tasks.map(toAiTaskSummary);
    },
    async findAiTaskForUser(userId, taskId) {
      const task = await client.aiTask.findFirst({
        where: {
          id: taskId,
          userId
        },
        include: {
          assets: {
            orderBy: { createdAt: "desc" }
          }
        }
      });

      if (!task) {
        return null;
      }

      return {
        task: toAiTaskSummary(task),
        assets: task.assets.map((asset) => toAiAssetSummary(asset, task.prompt))
      };
    },
    async listAiAssetsForUser(userId, filters = {}) {
      const assets = await client.aiAsset.findMany({
        where: {
          userId,
          ...(filters.type ? { type: toPrismaAiAssetType(filters.type) } : {})
        },
        include: {
          task: {
            select: {
              prompt: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: filters.limit ?? 50
      });

      return assets.map((asset) =>
        toAiAssetSummary(asset, asset.task?.prompt ?? null)
      );
    },
    async findAiAssetForUser(userId, assetId) {
      const asset = await client.aiAsset.findFirst({
        where: {
          id: assetId,
          userId
        },
        include: {
          task: true
        }
      });

      if (!asset) {
        return null;
      }

      return {
        asset: toAiAssetSummary(asset, asset.task?.prompt ?? null),
        task: asset.task ? toAiTaskSummary(asset.task) : null
      };
    },
    async findAiAssetStorageObjectReferenceForUser(userId, assetId) {
      const normalizedUserId = normalizeAiAssetReferenceUserId(userId);
      const normalizedAssetId = normalizeAiAssetReferenceId(assetId);
      const asset = await client.aiAsset.findFirst({
        where: {
          id: normalizedAssetId,
          userId: normalizedUserId
        },
        select: {
          id: true,
          userId: true,
          storageObjectId: true
        }
      });

      return asset
        ? {
            assetId: asset.id,
            userId: asset.userId,
            storageObjectId: asset.storageObjectId
          }
        : null;
    },
    async deleteAiAssetForUserWithStorageObjectReference(userId, assetId) {
      const normalizedUserId = normalizeAiAssetReferenceUserId(userId);
      const normalizedAssetId = normalizeAiAssetReferenceId(assetId);

      return client.$transaction(
        async (tx) => {
          const assets =
            await tx.$queryRaw<LockedAiAssetStorageObjectReference[]>(
              Prisma.sql`
                SELECT \`id\`, \`userId\`, \`storageObjectId\`
                FROM \`AiAsset\`
                WHERE \`id\` = ${normalizedAssetId}
                  AND \`userId\` = ${normalizedUserId}
                FOR UPDATE
              `
            );
          const asset = assets[0];
          if (!asset) {
            return {
              status: "NOT_FOUND" as const,
              storageObjectId: null
            };
          }

          const deleted = await tx.aiAsset.deleteMany({
            where: {
              id: asset.id,
              userId: asset.userId
            }
          });
          if (deleted.count !== 1) {
            return {
              status: "NOT_FOUND" as const,
              storageObjectId: null
            };
          }

          return {
            status: "DELETED" as const,
            storageObjectId: asset.storageObjectId
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    },
    async deleteAiAssetForUser(userId, assetId) {
      const result = await client.aiAsset.deleteMany({
        where: {
          id: assetId,
          userId
        }
      });

      return result.count > 0;
    }
  };
}

const publicSettingKeys = [
  "siteName",
  "siteLogoText",
  "siteLogoUrl",
  "siteFaviconUrl",
  "workspaceIconUrl",
  "siteAnnouncement",
  "contactEmail",
  "defaultModel",
  "guestModeEnabled",
  "registrationEnabled",
  "registrationClosedMessageZh",
  "registrationClosedMessageEn",
  "maintenanceModeEnabled",
  "maintenanceMessage",
  "homeHeroTitle",
  "homeHeroSubtitle",
  "homePrimaryCtaText",
  "homeSecondaryCtaText",
  "homeBetaNotice",
  "homeRightCardNotice",
  "footerSlogan",
  "footerCopyright",
  "footerLinksJson",
  "homeFeatureCards",
  "workspaceLinksLabel",
  "workspaceTitle",
  "workspaceSubtitle",
  "workspacePromptPlaceholder",
  "workspaceHint",
  "workspaceHeroTitle",
  "workspaceHeroSubtitle",
  "workspacePromptCards",
  "imagePromptCards",
  "contactDescription",
  "contactWechat",
  "contactPublicAccount",
  "contactCommunityUrl",
  "contactQrImageUrl",
  "contactNotes",
  "contactExternalLinks",
  "helpContentJson"
];

type UsageStatsSource = {
  model: string;
  status: UsageLogStatus;
  costCredits: number;
  userId: string | null;
  createdAt: Date;
};

type ModelDisplayNameLookup = Map<string, string>;

type ModelStatsSortKey = "calls" | "creditsUsed" | "failed";

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWithinUtcRange(date: Date, start: Date, end: Date): boolean {
  return date >= start && date < end;
}

function sumCredits(logs: UsageStatsSource[]): number {
  return logs.reduce((total, log) => total + log.costCredits, 0);
}

function createTrendDates(now: Date): string[] {
  const todayStart = startOfUtcDay(now);

  return Array.from({ length: 7 }, (_, index) =>
    formatUtcDate(addUtcDays(todayStart, index - 6))
  );
}

function buildLast7DayTrend(logs: UsageStatsSource[], now: Date) {
  const buckets = new Map(
    createTrendDates(now).map((date) => [
      date,
      {
        date,
        calls: 0,
        success: 0,
        failed: 0,
        creditsUsed: 0,
        guestCalls: 0
      }
    ])
  );

  for (const log of logs) {
    const bucket = buckets.get(formatUtcDate(log.createdAt));

    if (!bucket) {
      continue;
    }

    bucket.calls += 1;
    bucket.creditsUsed += log.costCredits;

    if (log.status === "SUCCESS") {
      bucket.success += 1;
    } else {
      bucket.failed += 1;
    }

    if (log.userId === null) {
      bucket.guestCalls += 1;
    }
  }

  return [...buckets.values()];
}

function buildGuestLast7DayTrend(logs: UsageStatsSource[], now: Date) {
  return buildLast7DayTrend(logs, now).map((point) => ({
    date: point.date,
    calls: point.guestCalls
  }));
}

function buildModelUsageStats(
  logs: UsageStatsSource[],
  displayNames: ModelDisplayNameLookup = new Map()
) {
  const stats = new Map<string, AdminOverviewStats["models"][number]>();

  for (const log of logs) {
    const displayName = displayNames.get(log.model);
    const current =
      stats.get(log.model) ??
      ({
        model: log.model,
        ...(displayName ? { displayName } : {}),
        calls: 0,
        success: 0,
        failed: 0,
        creditsUsed: 0
      } satisfies AdminOverviewStats["models"][number]);

    current.calls += 1;
    current.creditsUsed += log.costCredits;

    if (log.status === "SUCCESS") {
      current.success += 1;
    } else {
      current.failed += 1;
    }

    stats.set(log.model, current);
  }

  return [...stats.values()].sort((a, b) => a.model.localeCompare(b.model));
}

function buildModelDisplayNames(
  models: Array<{ name: string; modelId: string; displayName: string | null }>
) {
  const displayNames: ModelDisplayNameLookup = new Map();

  for (const model of models) {
    const displayName = model.displayName ?? model.name;
    displayNames.set(model.modelId, displayName);
    displayNames.set(model.name, displayName);
  }

  return displayNames;
}

function summarizeAdminFailure(errorMessage: string | null | undefined): string {
  if (!errorMessage) {
    return "Model service temporarily unavailable";
  }

  if (
    /https?:\/\//i.test(errorMessage) ||
    /\bsk-[A-Za-z0-9_-]+/i.test(errorMessage) ||
    /api[_-]?key/i.test(errorMessage) ||
    /token/i.test(errorMessage) ||
    /secret/i.test(errorMessage) ||
    /stack/i.test(errorMessage) ||
    errorMessage.length > 120
  ) {
    return "Model service temporarily unavailable";
  }

  return errorMessage;
}

function topModelStats(
  stats: AdminOverviewStats["models"],
  key: ModelStatsSortKey
) {
  return [...stats]
    .filter((model) => model[key] > 0)
    .sort((a, b) => {
      if (b[key] !== a[key]) {
        return b[key] - a[key];
      }

      return a.model.localeCompare(b.model);
    })
    .slice(0, 5);
}

function toUserRecord(user: {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  sessionVersion: number;
  lastLoginAt: Date | null;
  name: string | null;
  avatarUrl?: string | null;
  avatarStorageObjectId?: string | null;
  role: UserRole;
  credits: number;
  createdAt: Date;
  updatedAt: Date;
}): UserRecord {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    sessionVersion: user.sessionVersion,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    ...(user.name ? { name: user.name } : {}),
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    avatarStorageObjectId: user.avatarStorageObjectId ?? null,
    role: user.role,
    credits: user.credits,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function toAuthUserRecord(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl?: string | null;
  role: UserRole;
  credits: number;
}): import("@ai-aggregate/shared").AuthUser {
  return {
    id: user.id,
    email: user.email,
    ...(user.name ? { name: user.name } : {}),
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    role: user.role,
    credits: user.credits
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toStoragePackageSummary(
  subscription: {
    priceCredits: number;
    durationDays: number;
    autoRenewEnabled: boolean;
    startsAt: Date;
    expiresAt: Date;
  } | null,
  benefits: AccountBenefitSettings,
  now: Date
): AccountOverview["storagePackage"] {
  const status = !subscription
    ? "INACTIVE"
    : subscription.expiresAt > now
      ? "ACTIVE"
      : "EXPIRED";

  return {
    enabled: benefits.storagePackageEnabled,
    status,
    priceCredits: benefits.storagePackagePriceCredits,
    durationDays: benefits.storagePackageDurationDays,
    autoRenewEnabled: subscription?.autoRenewEnabled ?? false,
    autoRenewAvailable: benefits.storagePackageAutoRenewEnabled,
    description: benefits.storagePackageDescription,
    startsAt: subscription?.startsAt.toISOString() ?? null,
    expiresAt: subscription?.expiresAt.toISOString() ?? null
  };
}

function toCheckInSummary(
  checkIns: Array<{ checkInDate: string; streakDay: number }>,
  benefits: AccountBenefitSettings,
  todayDate: string
): CheckInSummary {
  const todayCheckedIn = checkIns.some((item) => item.checkInDate === todayDate);
  let currentStreak = 0;
  let expectedDate = parseDateKey(todayDate);
  if (!todayCheckedIn) expectedDate = addDays(expectedDate, -1);
  for (const item of checkIns) {
    if (item.checkInDate !== toDateKey(expectedDate)) break;
    currentStreak = item.streakDay;
    expectedDate = addDays(expectedDate, -1);
  }
  return {
    enabled: benefits.checkInEnabled,
    todayDate,
    todayCheckedIn,
    currentStreak,
    dailyRewardCredits: benefits.checkInDailyRewardCredits,
    streakRewards: benefits.checkInStreakRewards,
    checkedDates: checkIns.map((item) => item.checkInDate)
  };
}

async function ensureReferralCode(
  client: PrismaClient,
  userId: string,
  current: { code: string } | null
): Promise<{ code: string }> {
  if (current) return current;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.referralCode.create({
        data: {
          userId,
          code: randomBytes(6).toString("base64url").slice(0, 8).toUpperCase()
        },
        select: { code: true }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await client.referralCode.findUnique({
          where: { userId },
          select: { code: true }
        });
        if (existing) return existing;
      } else {
        throw error;
      }
    }
  }

  throw new Error("REFERRAL_CODE_CREATE_FAILED");
}

function mergeAccountActivities(
  orders: Array<{
    id: string;
    plan: { name: string };
    amount: number;
    credits: number;
    status: OrderStatus;
    createdAt: Date;
    paidAt: Date | null;
  }>,
  ledgers: Array<{
    id: string;
    kind: string;
    title: string;
    creditsDelta: number;
    amount: number | null;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  }>
): AccountActivitySummary[] {
  const orderActivities: AccountActivitySummary[] = orders.map((order) => ({
    id: `order:${order.id}`,
    kind: "ORDER",
    title: order.plan.name,
    status: order.status === "PAID" ? "SUCCESS" : order.status === "CANCELLED" ? "CANCELLED" : "PENDING",
    amount: order.amount,
    creditsDelta: order.status === "PAID" ? order.credits : 0,
    createdAt: order.createdAt.toISOString(),
    completedAt: order.paidAt?.toISOString() ?? null
  }));
  const ledgerActivities: AccountActivitySummary[] = ledgers.map((ledger) => ({
    id: `ledger:${ledger.id}`,
    kind: ledger.kind === "CHECK_IN" ? "CHECK_IN" : ledger.kind === "REFERRAL_REWARD" ? "REFERRAL_REWARD" : "STORAGE_PACKAGE",
    title: ledger.title,
    status: ledger.status === "SUCCESS" ? "SUCCESS" : "FAILED",
    amount: ledger.amount,
    creditsDelta: ledger.creditsDelta,
    createdAt: ledger.createdAt.toISOString(),
    completedAt: ledger.completedAt?.toISOString() ?? null
  }));
  return [...orderActivities, ...ledgerActivities]
    .sort((a, b) => {
      const timeDiff = b.createdAt.localeCompare(a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      if (a.kind !== b.kind) return a.kind === "ORDER" ? -1 : 1;
      return b.id.localeCompare(a.id);
    });
}

function toSessionSummary(session: {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}): ChatSessionSummary {
  return {
    id: session.id,
    userId: session.userId,
    title: session.title,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString()
  };
}

function toCreatorCanvasDocumentSummary(document: {
  id: string;
  title: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}): CreatorCanvasDocumentSummary {
  return {
    id: document.id,
    title: document.title,
    revision: document.revision,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

function toCreatorCanvasDocumentDetail(document: {
  id: string;
  title: string | null;
  state: unknown;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}): CreatorCanvasDocumentDetail {
  return {
    ...toCreatorCanvasDocumentSummary(document),
    state: document.state
  };
}

function toMessageRecord(message: {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  model: string;
  createdAt: Date;
}): ChatMessageRecord {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role as ChatRole,
    content: message.content,
    model: message.model,
    createdAt: message.createdAt.toISOString()
  };
}

function toQuotaRecord(quota: {
  userId: string;
  remainingCredits: number;
}): QuotaRecord {
  return {
    userId: quota.userId,
    remainingCredits: quota.remainingCredits
  };
}

function toUsageLogSummary(log: {
  id: string;
  userId: string | null;
  user?: { email: string } | null;
  sessionId: string | null;
  model: string;
  canonicalModel?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  upstreamModel?: string | null;
  routeId?: string | null;
  fallbackAttempts?: number;
  status: UsageLogStatus;
  costCredits: number;
  errorMessage: string | null;
  createdAt: Date;
  guestIp?: string | null;
  guestUsageDate?: string | null;
}, modelDisplayName?: string): UsageLogSummary {
  return {
    id: log.id,
    userId: log.userId,
    ...(log.user ? { userEmail: log.user.email } : {}),
    sessionId: log.sessionId,
    model: log.model,
    ...(modelDisplayName ? { modelDisplayName } : {}),
    canonicalModel: log.canonicalModel ?? null,
    providerId: log.providerId ?? null,
    providerName: log.providerName ?? null,
    upstreamModel: log.upstreamModel ?? null,
    routeId: log.routeId ?? null,
    fallbackAttempts: log.fallbackAttempts ?? 0,
    status: log.status,
    costCredits: log.costCredits,
    errorMessage: log.errorMessage,
    createdAt: log.createdAt.toISOString()
  };
}

type AiModelProjectionRow = {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  provider: ModelProvider;
  providerAccountId: string | null;
  capability: string;
  displaySurfaces?: Prisma.JsonValue | null;
  imageInvokeMode?: string | null;
  imageOutputParser?: string | null;
  maxReferenceImages: number;
  modelId: string;
  enabled: boolean;
  creditCost: number;
  allowGuest: boolean;
  sortOrder: number;
  group: string;
  tags: string;
  shortDescription: string | null;
  isRecommended: boolean;
  iconUrl: string | null;
  iconText: string | null;
  iconColor: string | null;
  description: string | null;
  routes?: Array<{
    id: string;
    modelId: string;
    providerId: string;
    upstreamModel: string;
    priority: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    provider?: {
      name: string;
    };
  }>;
};

function toRuntimeAiModel(model: AiModelProjectionRow): RuntimeAiModel {
  return {
    id: model.id,
    name: model.name,
    ...(model.displayName ? { displayName: model.displayName } : {}),
    slug: model.slug,
    provider: model.provider,
    providerAccountId: model.providerAccountId,
    capability: normalizeModelCapability(model.capability),
    displaySurfaces: normalizeModelDisplaySurfaces(
      model.displaySurfaces,
      model.capability
    ),
    imageInvokeMode: normalizeModelImageInvokeMode(model.imageInvokeMode),
    imageOutputParser: normalizeModelImageOutputParser(model.imageOutputParser),
    maxReferenceImages: model.maxReferenceImages,
    modelId: model.modelId,
    group: model.group,
    tags: normalizeTags(model.tags),
    shortDescription: model.shortDescription ?? undefined,
    enabled: model.enabled,
    creditCost: model.creditCost,
    allowGuest: model.allowGuest,
    sortOrder: model.sortOrder,
    isRecommended: model.isRecommended,
    ...(model.iconUrl ? { iconUrl: model.iconUrl } : {}),
    ...(model.iconText ? { iconText: model.iconText } : {}),
    ...(model.iconColor ? { iconColor: model.iconColor } : {}),
    description: model.description ?? undefined,
    ...(model.routes ? { routes: model.routes.map(toAiModelRouteSummary) } : {})
  };
}

function toAdminAiModelSummary(
  model: AiModelProjectionRow
): AdminAiModelSummary {
  return {
    ...toRuntimeAiModel(model),
    ...(model.routes ? { routes: model.routes.map(toAiModelRouteSummary) } : {})
  };
}

function toAiModelRouteSummary(route: {
  id: string;
  modelId: string;
  providerId: string;
  upstreamModel: string;
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  provider?: {
    name: string;
  };
}): AiModelRouteSummary {
  const providerAccountName = route.provider?.name;

  return {
    id: route.id,
    modelId: route.modelId,
    providerId: route.providerId,
    ...(providerAccountName ? { providerName: providerAccountName } : {}),
    upstreamModel: route.upstreamModel,
    priority: route.priority,
    enabled: route.enabled,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString()
  };
}

function toAiProviderAccountSummary(account: {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  capabilities: unknown;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  headersJson: unknown;
  configJson: unknown;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AiProviderAccountSummary {
  return {
    id: account.id,
    name: account.name,
    providerType: normalizeProviderAccountType(account.providerType),
    baseUrl: account.baseUrl,
    capabilities: normalizeProviderAccountCapabilities(account.capabilities),
    enabled: account.enabled,
    priority: account.priority,
    timeoutMs: account.timeoutMs,
    configJson: normalizeJsonObject(account.configJson),
    notes: account.notes,
    hasApiKey: account.apiKey.length > 0,
    hasCustomHeaders:
      Object.keys(normalizeProviderHeaders(account.headersJson)).length > 0,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString()
  };
}

function toProviderAccountRuntime(account: {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  capabilities: unknown;
  enabled: boolean;
  timeoutMs: number;
  headersJson: unknown;
  configJson: unknown;
}): ProviderAccountRuntime {
  return {
    id: account.id,
    name: account.name,
    providerType: normalizeProviderAccountType(account.providerType),
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    capabilities: normalizeProviderAccountCapabilities(account.capabilities),
    enabled: account.enabled,
    timeoutMs: account.timeoutMs,
    headersJson: normalizeJsonObject(account.headersJson),
    configJson: normalizeJsonObject(account.configJson)
  };
}

function isProviderAccountRuntimeUnavailable(account: {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  capabilities: unknown;
}): boolean {
  return (
    !account.enabled ||
    !account.apiKey.trim() ||
    !account.baseUrl.trim() ||
    !normalizeProviderAccountCapabilities(account.capabilities).includes("chat")
  );
}

function normalizeProviderAccountType(value: string): ProviderAccountType {
  return providerAccountTypes.includes(value as ProviderAccountType)
    ? (value as ProviderAccountType)
    : "OPENAI_COMPATIBLE";
}

function normalizeProviderAccountCapabilities(
  value: unknown
): ProviderAccountCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((capability): capability is ProviderAccountCapability =>
    providerAccountCapabilities.includes(capability as ProviderAccountCapability)
  );
}

function normalizeJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toPlanSummary(plan: {
  id: string;
  name: string;
  price: number;
  credits: number;
  description: string | null;
  features: unknown;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): PlanSummary {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    credits: plan.credits,
    description: plan.description ?? "",
    features: normalizeFeatures(plan.features),
    enabled: plan.enabled,
    sortOrder: plan.sortOrder,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString()
  };
}

function toSiteSettingSummary(setting: {
  key: string;
  value: string;
  type: string;
  description: string | null;
  updatedAt: Date;
}): SiteSettingSummary {
  return {
    key: setting.key,
    value: setting.value,
    type: normalizeSettingType(setting.type),
    description: setting.description,
    updatedAt: setting.updatedAt.toISOString()
  };
}

function normalizeSettingType(type: string): SiteSettingValueType {
  return type === "boolean" || type === "number" || type === "json"
    ? type
    : "string";
}

function toOrderSummary(order: {
  id: string;
  userId: string;
  planId: string;
  amount: number;
  credits: number;
  status: OrderStatus;
  paymentProvider?: string | null;
  paymentType?: string | null;
  paymentTradeNo?: string | null;
  providerTradeNo?: string | null;
  paymentUrl?: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  plan: {
    name: string;
  };
}): OrderSummary {
  return {
    id: order.id,
    userId: order.userId,
    planId: order.planId,
    planName: order.plan.name,
    amount: order.amount,
    credits: order.credits,
    status: order.status,
    paymentProvider: order.paymentProvider ?? null,
    paymentType: order.paymentType ?? null,
    paymentTradeNo: order.paymentTradeNo ?? null,
    providerTradeNo: order.providerTradeNo ?? null,
    paymentUrl: order.paymentUrl ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}

function toPaymentAttemptRecord(
  attempt: PrismaPaymentAttempt
): PaymentAttemptRecord {
  const identity = validatePaymentAttemptStoredIdentity({
    id: attempt.id,
    orderId: attempt.orderId,
    ordinal: attempt.ordinal,
    provider: attempt.provider,
    providerMerchantRef: attempt.providerMerchantRef,
    paymentType: attempt.paymentType,
    merchantTradeNo: attempt.merchantTradeNo,
    providerTradeNo: attempt.providerTradeNo
  });
  const providerTradeIdentityHash =
    attempt.providerTradeIdentityHash === null
      ? null
      : Buffer.from(attempt.providerTradeIdentityHash);

  if (
    (identity.providerTradeNo === null) !==
      (providerTradeIdentityHash === null) ||
    (providerTradeIdentityHash !== null &&
      providerTradeIdentityHash.byteLength !== 32)
  ) {
    throw new TypeError("INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_IDENTITY_HASH");
  }

  if (
    identity.providerTradeNo !== null &&
    providerTradeIdentityHash !== null &&
    !providerTradeIdentityHash.equals(
      createProviderTradeIdentityHash({
        provider: identity.provider,
        providerMerchantRef: identity.providerMerchantRef,
        providerTradeNo: identity.providerTradeNo
      })
    )
  ) {
    throw new TypeError("INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_IDENTITY_HASH");
  }

  return {
    ...identity,
    providerTradeIdentityHash,
    status: attempt.status,
    paidAt: attempt.paidAt,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt
  };
}

type PaymentOrderWithPlan = Prisma.OrderGetPayload<{
  include: { plan: true };
}>;

type InitialPaymentAttemptStateClient = Pick<
  Prisma.TransactionClient,
  "order" | "paymentAttempt"
>;

const INITIAL_PAYMENT_ATTEMPT_ORDER_SLOT_UNIQUE_CONSTRAINT =
  "PaymentAttempt_orderId_ordinal_key";
const INITIAL_PAYMENT_ATTEMPT_MERCHANT_TRADE_NO_UNIQUE_CONSTRAINT =
  "PaymentAttempt_merchantTradeNo_key";
const INITIAL_PAYMENT_URL_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f]/u;

function validateInitialPaymentUrl(paymentUrl: unknown): string {
  if (
    typeof paymentUrl !== "string" ||
    paymentUrl.trim().length === 0 ||
    INITIAL_PAYMENT_URL_CONTROL_CHARACTER_PATTERN.test(paymentUrl)
  ) {
    throw new TypeError("INVALID_INITIAL_PAYMENT_URL");
  }

  return paymentUrl;
}

function toCompatibleInitialPaymentAttemptResult(
  status: "INITIALIZED" | "EXISTING_COMPATIBLE",
  order: PaymentOrderWithPlan,
  attempt: PrismaPaymentAttempt,
  expected: Omit<InitializeInitialPaymentAttemptInput, "paymentUrl">
): InitializeInitialPaymentAttemptResult | null {
  let mappedAttempt: PaymentAttemptRecord;
  try {
    mappedAttempt = toPaymentAttemptRecord(attempt);
  } catch {
    return null;
  }

  if (
    order.status !== "PENDING" ||
    order.paymentProvider !== expected.provider ||
    order.paymentType !== expected.paymentType ||
    order.paymentTradeNo !== expected.merchantTradeNo ||
    typeof order.paymentUrl !== "string" ||
    order.paymentUrl.trim().length === 0 ||
    order.providerTradeNo !== null ||
    order.paidAt !== null ||
    mappedAttempt.orderId !== order.id ||
    mappedAttempt.ordinal !== INITIAL_PAYMENT_ATTEMPT_ORDINAL ||
    mappedAttempt.provider !== order.paymentProvider ||
    mappedAttempt.providerMerchantRef !== expected.providerMerchantRef ||
    mappedAttempt.paymentType !== order.paymentType ||
    mappedAttempt.merchantTradeNo !== order.paymentTradeNo ||
    mappedAttempt.providerTradeNo !== null ||
    mappedAttempt.providerTradeIdentityHash !== null ||
    mappedAttempt.status !== "ACTIVE" ||
    mappedAttempt.paidAt !== null
  ) {
    return null;
  }

  const mappedOrder = toOrderSummary(order);
  return {
    status,
    order: {
      ...mappedOrder,
      paymentProvider: order.paymentProvider,
      paymentType: order.paymentType,
      paymentTradeNo: order.paymentTradeNo,
      paymentUrl: order.paymentUrl
    },
    attempt: mappedAttempt
  };
}

async function readCommittedInitialPaymentAttemptState(
  database: InitialPaymentAttemptStateClient,
  expected: Omit<InitializeInitialPaymentAttemptInput, "paymentUrl">
): Promise<InitializeInitialPaymentAttemptResult> {
  const order = await database.order.findUnique({
    where: { id: expected.orderId },
    include: { plan: true }
  });

  if (!order) {
    return { status: "ORDER_NOT_FOUND" };
  }
  if (order.status !== "PENDING") {
    return { status: "INVALID_ORDER_STATE" };
  }

  const attempt = await database.paymentAttempt.findUnique({
    where: {
      orderId_ordinal: {
        orderId: expected.orderId,
        ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL
      }
    }
  });
  if (!attempt) {
    return { status: "PAYMENT_REFERENCE_CONFLICT" };
  }

  return (
    toCompatibleInitialPaymentAttemptResult(
      "EXISTING_COMPATIBLE",
      order,
      attempt,
      expected
    ) ?? { status: "PAYMENT_REFERENCE_CONFLICT" }
  );
}

function isInitialPaymentAttemptUniqueConflict(error: unknown): boolean {
  if (!isPrismaUniqueError(error)) {
    return false;
  }

  const meta =
    typeof error === "object" && error !== null && "meta" in error
      ? error.meta
      : undefined;
  const target =
    typeof meta === "object" && meta !== null && "target" in meta
      ? meta.target
      : undefined;

  return (
    target === INITIAL_PAYMENT_ATTEMPT_ORDER_SLOT_UNIQUE_CONSTRAINT ||
    target === INITIAL_PAYMENT_ATTEMPT_MERCHANT_TRADE_NO_UNIQUE_CONSTRAINT ||
    (Array.isArray(target) &&
      ((target.length === 1 && target[0] === "merchantTradeNo") ||
        (target.length === 2 &&
          target[0] === "orderId" &&
          target[1] === "ordinal")))
  );
}

function toAdminPaymentAttemptSummary(
  attempt: PrismaPaymentAttempt
): AdminPaymentAttemptSummary {
  const record = toPaymentAttemptRecord(attempt);

  if (record.status !== "PAID_REQUIRES_REVIEW") {
    throw new TypeError("INVALID_ADMIN_PAYMENT_REVIEW_ATTEMPT_STATUS");
  }

  return {
    id: record.id,
    orderId: record.orderId,
    ordinal: record.ordinal,
    status: record.status,
    provider: record.provider,
    paymentType: record.paymentType,
    merchantTradeNo: record.merchantTradeNo,
    providerTradeNo: record.providerTradeNo,
    paidAt: record.paidAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString()
  };
}

function toAdminOrderSummary(order: Parameters<typeof toOrderSummary>[0] & {
  user: {
    email: string;
  };
  paymentAttempts?: PrismaPaymentAttempt[];
}): AdminOrderSummary {
  const { paymentUrl: _paymentUrl, ...safeOrder } = toOrderSummary(order);

  return {
    ...safeOrder,
    userEmail: order.user.email,
    reviewAttempts: (order.paymentAttempts ?? []).map(
      toAdminPaymentAttemptSummary
    )
  };
}

function toAiTaskSummary(task: {
  id: string;
  userId: string;
  type: string;
  status: string;
  modelId: string | null;
  prompt: string;
  input: unknown;
  output: unknown | null;
  costCredits: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): AiTaskSummary {
  return {
    id: task.id,
    userId: task.userId,
    type: fromPrismaAiTaskType(task.type),
    status: fromPrismaAiTaskStatus(task.status),
    modelId: task.modelId,
    prompt: task.prompt,
    input: toPublicAiTaskJsonRecord(task.input),
    output: task.output ? toPublicAiTaskJsonRecord(task.output) : null,
    costCredits: task.costCredits,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null
  };
}

function toPublicAiTaskJsonRecord(value: unknown): Record<string, unknown> {
  const record = normalizeJsonRecord(value);
  const publicRecord = { ...record };
  delete publicRecord[VIDEO_RUNTIME_INPUT_KEY];
  return publicRecord;
}

function toAiTaskRuntimeRecord(task: {
  id: string;
  userId: string;
  type: string;
  status: string;
  modelId: string | null;
  prompt: string;
  input: unknown;
  output: unknown | null;
  costCredits: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): AiTaskRuntimeRecord {
  return {
    id: task.id,
    userId: task.userId,
    type: fromPrismaAiTaskType(task.type),
    status: fromPrismaAiTaskStatus(task.status),
    modelId: task.modelId,
    prompt: task.prompt,
    input: normalizeJsonRecord(task.input),
    output: task.output ? normalizeJsonRecord(task.output) : null,
    costCredits: task.costCredits,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt
  };
}

function toAdminOperationsTask(input: {
  taskId: string;
  userId: string;
  type: AiTaskType;
  status: AiTaskStatus;
  modelId: string | null;
  modelLabel: string | null;
  costCredits: number;
  createdAt: Date;
  updatedAt: Date;
  creditReservation: {
    kind: CreditReservationKind;
    status: CreditReservationStatus;
  } | null;
}): AdminOperationsTask {
  const generationReservation =
    input.creditReservation?.kind === CreditReservationKind.IMAGE_GENERATION ||
    input.creditReservation?.kind === CreditReservationKind.VIDEO_GENERATION
      ? input.creditReservation
      : null;
  let chargeStatus: AdminOperationsChargeStatus = "UNKNOWN";
  let creditReleaseStatus: AdminOperationsCreditReleaseStatus = "UNKNOWN";

  if (generationReservation?.status === CreditReservationStatus.RESERVED) {
    chargeStatus = "RESERVED";
    creditReleaseStatus = "NOT_RELEASED";
  } else if (generationReservation?.status === CreditReservationStatus.SETTLED) {
    chargeStatus = "SETTLED";
    creditReleaseStatus = "NOT_RELEASED";
  } else if (generationReservation?.status === CreditReservationStatus.RELEASED) {
    chargeStatus = "RELEASED";
    creditReleaseStatus = "RELEASED";
  }

  const safeErrorClass =
    input.status === "failed"
      ? chargeStatus === "SETTLED"
        ? ("CHARGED_AND_FAILED" as const)
        : ("TASK_FAILED" as const)
      : ("UNKNOWN" as const);

  return {
    taskId: input.taskId,
    userId: input.userId,
    type: input.type,
    status: input.status,
    modelId: input.modelId,
    modelLabel: input.modelLabel,
    providerLabel: null,
    routeId: null,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    safeErrorClass,
    chargeStatus,
    creditReleaseStatus,
    refundStatus: "UNKNOWN" as AdminOperationsRefundStatus,
    costRecorded: input.costCredits > 0
  };
}

export function normalizeAdminManualCompensationCreditDelta(
  metadata: unknown
): number | null {
  if (!isPlainObject(metadata)) {
    return null;
  }

  const deltaCredits = metadata.deltaCredits;
  if (isSafeInteger(deltaCredits)) {
    return deltaCredits;
  }

  const oldCredits = metadata.oldCredits;
  const newCredits = metadata.newCredits;
  if (!isSafeInteger(oldCredits) || !isSafeInteger(newCredits)) {
    return null;
  }

  const historicalDelta = newCredits - oldCredits;
  return isSafeInteger(historicalDelta) ? historicalDelta : null;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function toStorageObjectRecord(
  storageObject: StorageObject
): StorageObjectRecord {
  let sizeBytes: number | null = null;
  if (storageObject.sizeBytes !== null) {
    sizeBytes = Number(storageObject.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new Error("INVALID_STORAGE_OBJECT_PERSISTED_SIZE_BYTES");
    }
  }

  return {
    id: storageObject.id,
    userId: storageObject.userId,
    storageProvider: storageObject.storageProvider,
    objectKey: storageObject.objectKey,
    mimeType: storageObject.mimeType,
    sizeBytes,
    sha256: storageObject.sha256,
    source: storageObject.source,
    status: storageObject.status,
    expiresAt: storageObject.expiresAt,
    deletedAt: storageObject.deletedAt,
    createdAt: storageObject.createdAt,
    updatedAt: storageObject.updatedAt
  };
}

function toAiAssetSummary(asset: {
  id: string;
  userId: string;
  taskId: string | null;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  title: string | null;
  metadata: unknown | null;
  createdAt: Date;
}, taskPrompt?: string | null): AiAssetSummary {
  return {
    id: asset.id,
    userId: asset.userId,
    taskId: asset.taskId,
    type: fromPrismaAiAssetType(asset.type),
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl,
    title: asset.title,
    metadata: asset.metadata ? filterAiAssetMetadata(asset.metadata) : null,
    createdAt: asset.createdAt.toISOString(),
    ...(taskPrompt !== undefined ? { taskPrompt } : {})
  };
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toPrismaAiTaskType(type: AiTaskType): "IMAGE" | "VIDEO" | "PPT" | "DOCUMENT" {
  return type.toUpperCase() as "IMAGE" | "VIDEO" | "PPT" | "DOCUMENT";
}

function fromPrismaAiTaskType(type: string): AiTaskType {
  return type.toLowerCase() as AiTaskType;
}

function toPrismaAiTaskStatus(
  status: AiTaskStatus
): "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" {
  return status.toUpperCase() as
    | "PENDING"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED";
}

function fromPrismaAiTaskStatus(status: string): AiTaskStatus {
  return status.toLowerCase() as AiTaskStatus;
}

function toPrismaAiAssetType(type: AiAssetType): "IMAGE" | "VIDEO" | "DOCUMENT" {
  return type.toUpperCase() as "IMAGE" | "VIDEO" | "DOCUMENT";
}

function fromPrismaAiAssetType(type: string): AiAssetType {
  return type.toLowerCase() as AiAssetType;
}

function normalizeFeatures(features: unknown): string[] {
  if (!Array.isArray(features)) {
    return [];
  }

  return features.filter(
    (feature): feature is string => typeof feature === "string"
  );
}

function normalizeModelCapability(value: string): ModelCapability {
  return modelCapabilities.includes(value as ModelCapability)
    ? (value as ModelCapability)
    : "chat";
}

function normalizeTags(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

async function createUniqueModelSlug(
  client: PrismaClient,
  name: string,
  modelId: string
): Promise<string> {
  const baseSlug =
    slugifyModelValue(name) || slugifyModelValue(modelId) || "model";
  let slug = baseSlug;
  let suffix = 1;

  while (await client.aiModel.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  return slug;
}

async function assertModelIdentityMutation(
  client: PrismaClient,
  input: { modelId: string; slug: string; currentId?: string }
): Promise<void> {
  const conflicts = await client.aiModel.findMany({
    where: {
      OR: [{ modelId: input.modelId }, { slug: input.modelId }, { modelId: input.slug }]
    },
    select: { id: true }
  });

  if (conflicts.some((conflict) => conflict.id !== input.currentId)) {
    throw new ModelIdentityConflictError("IDENTITY_COLLISION");
  }
}

function slugifyModelValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toFeedbackEntry(feedback: {
  id: string;
  userId: string | null;
  userEmail: string | null;
  type: string;
  content: string;
  screenshotUrl: string | null;
  status: FeedbackStatus;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): FeedbackEntry {
  return {
    id: feedback.id,
    userId: feedback.userId,
    userEmail: feedback.userEmail,
    type: feedback.type,
    content: feedback.content,
    screenshotUrl: feedback.screenshotUrl,
    status: feedback.status,
    archivedAt: feedback.archivedAt?.toISOString() ?? null,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString()
  };
}

function toLinkEntry(link: {
  id: string;
  title: string;
  url: string;
  description: string | null;
  category: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): LinkEntry {
  return {
    id: link.id,
    title: link.title,
    url: link.url,
    description: link.description,
    category: link.category,
    enabled: link.enabled,
    sortOrder: link.sortOrder,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString()
  };
}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isPrismaForeignKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  );
}

function isPrismaRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

const SENSITIVE_METADATA_KEYS = new Set([
  "AI_API_KEY",
  "JWT_SECRET",
  "DATABASE_URL",
  "SUB2API_KEY",
  "SUB2API_API_KEY",
  "SUB2API_BASE_URL",
  "PASSWORDHASH",
  "PASSWORD"
]);

function redactSensitiveMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    result[key] = SENSITIVE_METADATA_KEYS.has(key.toUpperCase())
      ? "[redacted]"
      : value;
  }

  return result;
}

function toAdminAuditLogEntry(log: {
  id: string;
  adminUserId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  metadata: unknown;
  createdAt: Date;
}): AdminAuditLogEntry {
  return {
    id: log.id,
    adminUserId: log.adminUserId,
    adminEmail: log.adminEmail,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    summary: log.summary,
    metadata: log.metadata as Record<string, unknown> | null,
    createdAt: log.createdAt.toISOString()
  };
}
