import {
  AIProviderAbortError,
  AIProviderRequestError,
  AIProviderResponseFormatError,
  AIProviderRouteUnavailableError,
  AIProviderSubmissionUncertainError,
  AIProviderTimeoutError,
  createAgnesImageAdapter,
  createAnthropicChatAdapter,
  createOpenAICompatibleAdapter,
  isValidGeneratedImageBase64,
  isValidGeneratedImageUrl,
  parseGeneratedImageDataUrl,
  parseChatFormatImageResponseOutputs,
  resolveImageTransport,
  createApimartVideoAdapter,
  resolveApimartVideoProfile,
  type AnthropicAuthMode,
  type ChatCompletionAdapter,
  type GeneratedImageOutput,
  type ImageGenerationAdapter,
  type ImageTransport,
  type ParsedChatFormatImage,
  type StreamingChatCompletionAdapter,
  type VideoReferenceMimeType,
  type VideoGenerationAdapter
} from "@ai-aggregate/ai-adapters";
import {
  CreditReservationKind,
  IdempotencyOwnerType,
  StorageObjectSource,
  StorageObjectStatus,
  StorageProvider
} from "@prisma/client";
import {
  adminOperationsBudgetScopes,
  type AdminOverview,
  type AdminAiModelSummary,
  type AdminOperationsBudget,
  type AiAssetSummary,
  aiAssetTypes,
  aiGenerationCounts,
  aiGenerationSizes,
  aiTaskStatuses,
  aiTaskTypes,
  type AuthResponse,
  type AuthUser,
  type AccountBenefitSettings,
  type AccountOverview,
  type ChatCompletionRequest,
  type ChatMessage,
  type ChatSessionSummary,
  type CreatorCanvasDocumentDetail,
  type CreatorCanvasDocumentListResponse,
  type CreatorCanvasDocumentPagedListResponse,
  type CreatorCanvasDocumentResponse,
  type EpayPaymentResponse,
  type AiModelRouteInput,
  type AiAssetType,
  type AiGenerationCount,
  type AiGenerationSize,
  type ImageGenerationMode,
  type ImageReferenceInput,
  type TitleCoverImageRequest,
  type AiTaskStatus,
  type AiTaskSummary,
  type PublicAiModelSummary,
  type PublicVideoModelSummary,
  type AiProviderAccountSummary,
  type AdminModerationRouteSummary,
  type AiTaskType,
  MAX_CHAT_MESSAGE_LENGTH,
  modelCapabilities,
  modelDisplaySurfaces,
  normalizeModelImageInvokeMode,
  normalizeModelImageOutputParser,
  normalizeModelDisplaySurfaces,
  isImageGenerationWorkflow,
  providerAccountCapabilities,
  providerAccountTypes,
  type ModelCapability,
  type ModelDisplaySurface,
  type ModelImageInvokeMode,
  type ModelImageOutputParser,
  type ModelProvider,
  type OrderSummary,
  type OrderStatus,
  type ProviderAccountCapability,
  type ProviderAccountType,
  type PublicSiteSettings,
  type ModerationRoute,
  type ModerationSettings,
  type SiteSettingValueType,
  type RegisterRequest,
  type UsageLogStatus,
  type UsageSummary,
  type UserRole,
  isChatCapableModel,
  isImageCapableModel,
  isVideoCapableModel,
  isModelDisplaySurfaceCompatible,
  isTitleCoverVisualStyle,
  isValidImagePromptCardsSetting,
  normalizeProviderHeaders,
  validateFeedbackScreenshotUrl
} from "@ai-aggregate/shared";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions
} from "fastify";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  createJwt,
  hashPassword,
  validatePasswordForSet,
  verifyJwt,
  verifyPasswordWithTimingProtection
} from "./auth";
import {
  buildPasswordResetUrl,
  createPasswordResetExpiry,
  createPasswordResetToken,
  hashPasswordResetToken
} from "./password-reset";
import {
  buildEmailVerificationUrl,
  createEmailVerificationExpiry,
  createEmailVerificationToken,
  hashEmailVerificationToken
} from "./email-verification";
import {
  type EmailVerificationMailer,
  type PasswordResetMailer
} from "./mailer";
import {
  DEFAULT_GENERATED_ASSETS_MAX_BYTES,
  LocalStorageObjectContentService,
  LocalStorageObjectError,
  LocalStorageObjectService,
  createLocalStorageObjectFileRemover,
  registerGeneratedAssetsRoute,
  resolveGeneratedAssetsDir,
  resolveGeneratedAssetsMaxBytes,
  resolveGeneratedAssetsPublicPath,
  type GeneratedAssetMimeType,
  type LocalStorageObjectFileRemover
} from "./asset-storage";
import {
  calculateChatAttemptCost,
  calculateImageEstimatedCost,
  decideGlobalAdminProviderTestBudget,
  decideGlobalChatAttemptCost,
  decideGlobalImageRequestCost,
  getUtcDailyBudgetPeriodKey,
  resolveGlobalChatBudgetConfig,
  resolveGlobalAdminProviderTestBudgetConfig,
  resolveGlobalImageBudgetConfig
} from "./global-budget";
import {
  createPrismaGlobalBudgetStore,
  type AdminGlobalBudgetReadStore
} from "./global-budget-store";
import {
  createRateLimiterFromConfig,
  RATE_LIMITS,
  type RateLimiter,
  type RateLimitPolicy,
  RateLimiterUnavailableError,
  resolveRateLimitConfig
} from "./rate-limit";
import {
  CONCURRENCY_LEASE_MS,
  createConcurrencyLimiterFromConfig,
  runWithConcurrencyLease,
  type ConcurrencyLimiter,
  ConcurrencyLimiterUnavailableError,
  resolveConcurrencyConfig
} from "./concurrency";
import {
  createImageRecoveryServiceFromEnv,
  type ImageRecoveryService
} from "./recovery/image-recovery-service";
import {
  createVideoRecoveryServiceFromEnv,
  type VideoRecoveryService
} from "./recovery/video-recovery-service";
import {
  createChatCreditRecoveryServiceFromEnv,
  type ChatCreditRecoveryService
} from "./recovery/chat-credit-recovery-scheduler";
import {
  createStorageCleanupServiceFromEnv,
  type StorageCleanupService
} from "./storage-cleanup-service";
import {
  buildEpayPaymentUrl,
  convertEpayMoneyToCents,
  createPaymentTradeNo,
  epaySafeConfig,
  isEpayPaymentType,
  isSuccessTradeStatus,
  normalizeEpayPaymentTypes,
  parseEpayNotifyParams,
  readEpayCallbackVerificationConfig,
  readEpayConfig,
  readEpayConfigFromDb,
  verifyEpaySignature,
  type EpayConfig,
  type EpayCallbackVerificationConfig,
  type EpayPaymentType,
  type EpaySafeConfig
} from "./payments/epay";
import {
  recoverExistingEpayPaymentSession,
  type EpayRecoveryResult
} from "./payments/epay-recovery";
import { INITIAL_PAYMENT_ATTEMPT_ORDINAL } from "./payments/payment-attempt";
import {
  decryptPaymentSecret,
  encryptPaymentSecret
} from "./payments/encryption";
import {
  createPrismaUserStore,
  type AiAssetStorageObjectReferenceStore,
  type ChatCreditStore,
  type ModelRouteRuntime,
  type ModelInput,
  type ProviderAccountRuntime,
  type RuntimeAiModel,
  type ProviderAccountInput,
  type ProviderAccountUpdateInput,
  ModelIdentityConflictError,
  ProviderAccountValidationError,
  type SiteSettingUpdateInput,
  type CreditReservationStore,
  type CreatorCanvasDocumentUpdateInput,
  type GlobalBudgetStore,
  type ImageTaskCompletionAiAssetCreateInput,
  type IdempotencyRequestStore,
  type LegacyPaymentAttemptMaterializationStore,
  type GeneratedStorageObjectCompensationStore,
  type PaymentAttemptRecord,
  type PaymentAttemptReadStore,
  type PaymentAttemptSettlementStore,
  type StorageObjectRecord,
  type StorageObjectStore,
  type UserAvatarReferenceStore,
  type UserRecord,
  type UserStore
} from "./store";
import {
  VIDEO_RUNTIME_INPUT_KEY,
  type AiTaskRuntimeRecord
} from "./store";
import { DEFAULT_BASE_PLAN_NAME } from "./store";
import {
  buildImageGenerationRequestFingerprint,
  buildReferenceImageFingerprint,
  buildReferenceImageFingerprints,
  hashIdempotencyClaimToken,
  hashIdempotencyKey,
  hashUserIdempotencyOwner,
  IMAGE_GENERATE_IDEMPOTENCY_SCOPE,
  VIDEO_GENERATE_IDEMPOTENCY_SCOPE,
  buildVideoGenerationRequestFingerprint,
  parseIdempotencyKeyHeader
} from "./idempotency";
import {
  DEFAULT_REGISTRATION_CLOSED_MESSAGE_EN,
  DEFAULT_REGISTRATION_CLOSED_MESSAGE_ZH,
  isRegistrationEmailAllowed,
  parseDomainListSetting,
  resolveRegistrationEmailPolicy
} from "./security/email-domain-policy";
import {
  createRemoteImageFetcher,
  RemoteImageFetcherError,
  type RemoteImageFetcher
} from "./remote-image-fetcher";
import {
  createRemoteImageStorageService,
  RemoteImageStorageError,
  type RemoteImageStorageService
} from "./remote-image-storage";
import {
  RemoteImageUrlPolicyError,
  parseRemoteImageAllowedHostRules,
  validateRemoteImageDownloadUrl,
  type RemoteImageAllowedHostRule
} from "./remote-image-url-policy";
import { RemoteImageBodyError } from "./remote-image-body";
import { resolveTrustProxy } from "./security/trust-proxy";
import {
  createImageModerationClient,
  createRoutedImageModerationClient,
  ImageModerationRequestError,
  ImageModerationResponseError,
  ImageModerationTimeoutError,
  ImageModerationUnavailableError,
  IMAGE_MODERATION_SETTINGS_KEY,
  buildModerationPolicyFingerprint,
  isModerationProviderAccountCompatible,
  normalizeModerationSettings,
  resolveModerationProviderAttempts,
  resolveImageModerationConfig,
  type ImageModerationClient,
  type ImageModerationConfig,
  type ImageModerationDecision,
  type ModerationInputType,
  type ModerationProviderAccount
} from "./image-moderation";
import {
  DEFAULT_MODERATION_INPUT_CACHE_SETTINGS,
  IMAGE_MODERATION_CACHE_SETTINGS_KEY,
  ModerationInputCacheEpochChangedError,
  ModerationInputCache,
  normalizeModerationInputCacheSettings,
  parseModerationInputCacheSettings,
  type ModerationInputCacheSettings
} from "./moderation-input-cache";
import {
  DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS,
  IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_KEY,
  ModerationRouteCircuitBreaker,
  normalizeModerationRouteCircuitBreakerSettings,
  parseModerationRouteCircuitBreakerSettings,
  type ModerationRouteCircuitBreakerSettings
} from "./moderation-route-circuit-breaker";
import {
  buildTitleCoverImagePrompt,
  normalizeTitleCoverOriginalTitle,
  resolveTitleCoverVisualBriefConfig,
  runTitleCoverVisualBrief,
  TITLE_COVER_VISUAL_BRIEF_BUDGET_SCOPE,
  TITLE_COVER_VISUAL_BRIEF_PURPOSE,
  TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS,
  type TitleCoverVisualBriefDatabaseSettings,
  type TitleCoverVisualBriefConfigResult,
  type TitleCoverVisualBriefProviderAttempt
} from "./title-cover-visual-brief";

export type { UserRecord, UserStore } from "./store";

export type ServerStore =
  UserStore &
  PaymentAttemptReadStore &
  PaymentAttemptSettlementStore &
  LegacyPaymentAttemptMaterializationStore &
  Required<Pick<UserStore, "updateUserProfile">> &
  CreditReservationStore &
  ChatCreditStore &
  IdempotencyRequestStore &
  Required<
    Pick<
      AiAssetStorageObjectReferenceStore,
      | "findAiAssetStorageObjectReferenceForUser"
      | "deleteAiAssetForUserWithStorageObjectReference"
    >
  > &
  StorageObjectStore &
  GeneratedStorageObjectCompensationStore &
  UserAvatarReferenceStore;

export type AvatarStorageObjectService = Pick<
  LocalStorageObjectService,
  "persistLocalImageStorageObject"
>;

export type VideoStorageObjectService = Pick<
  LocalStorageObjectService,
  "persistLocalVideoStorageObject"
>;

export type AssetContentService = Pick<
  LocalStorageObjectContentService,
  "openLocalStorageObjectContent"
>;

export type RemoteImageFetcherService = Pick<
  RemoteImageFetcher,
  "fetchRemoteImage"
>;

export type RemoteImageStoragePersistenceService = Pick<
  RemoteImageStorageService,
  "persistRemoteImage"
>;

export interface ServerOptions {
  emailVerificationMailer?: EmailVerificationMailer;
  passwordResetMailer?: PasswordResetMailer;
  publicWebUrl?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  fetchImpl?: typeof fetch;
  imageAdapter?: ImageGenerationAdapter;
  videoAdapter?: VideoGenerationAdapter;
  imageModerationClient?: ImageModerationClient;
  store?: ServerStore;
  avatarStorageObjectService?: AvatarStorageObjectService;
  videoStorageObjectService?: VideoStorageObjectService;
  assetContentService?: AssetContentService;
  storageObjectFileRemover?: LocalStorageObjectFileRemover;
  remoteImageFetcher?: RemoteImageFetcherService;
  remoteImageStorageService?: RemoteImageStoragePersistenceService;
  rateLimiter?: RateLimiter & { ready?(): Promise<void> };
  concurrencyLimiter?: ConcurrencyLimiter & { ready?(): Promise<void> };
  imageRecoveryService?: ImageRecoveryService;
  videoRecoveryService?: VideoRecoveryService;
  chatCreditRecoveryService?: ChatCreditRecoveryService;
  storageCleanupService?: StorageCleanupService;
  globalBudgetStore?: GlobalBudgetStore;
  globalBudgetNow?: () => Date;
  moderationInputCacheSecret?: Uint8Array | string;
  moderationInputCacheNow?: () => number;
  moderationRouteCircuitBreakerNow?: () => number;
  logger?: FastifyServerOptions["logger"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emptyAdminOperationsBudget(
  scope: (typeof adminOperationsBudgetScopes)[number]
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

function isAdminGlobalBudgetReadStore(
  store: GlobalBudgetStore
): store is GlobalBudgetStore & AdminGlobalBudgetReadStore {
  return (
    "listAdminBudgetPeriods" in store &&
    typeof store.listAdminBudgetPeriods === "function"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const ORDER_ROUTE_ID_MAX_LENGTH = 191;
const ORDER_ROUTE_ID_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const ORDER_ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

function isValidOrderRouteId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= ORDER_ROUTE_ID_MAX_LENGTH &&
    !ORDER_ROUTE_ID_CONTROL_CHARACTER_PATTERN.test(value) &&
    ORDER_ROUTE_ID_PATTERN.test(value)
  );
}

function isSetupTokenMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function isStorageObjectPublicPath(
  requestUrl: string,
  generatedAssetsPublicPath: string
): boolean {
  const requestPath = requestUrl.split("?", 1)[0];
  const prefix = `${generatedAssetsPublicPath}/`;

  if (!requestPath?.startsWith(prefix)) {
    return false;
  }

  try {
    const objectKey = decodeURIComponent(requestPath.slice(prefix.length));
    return (
      objectKey === "images" ||
      objectKey.startsWith("images/") ||
      objectKey === "videos" ||
      objectKey.startsWith("videos/")
    );
  } catch {
    return false;
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    ...(user.name ? { name: user.name } : {}),
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    role: user.role,
    credits: user.credits
  };
}

const defaultAccountBenefits: AccountBenefitSettings = {
  storagePackageEnabled: false,
  storagePackagePriceCredits: 10,
  storagePackageDurationDays: 30,
  storagePackageAutoRenewEnabled: false,
  storagePackageDescription: "Keep your resources available for longer.",
  checkInEnabled: false,
  checkInDailyRewardCredits: 0,
  checkInStreakRewards: {},
  referralEnabled: false,
  referralInviterRewardCredits: 0,
  referralInviteeRewardCredits: 0,
  referralRewardTrigger: "After a referred user completes a qualifying purchase.",
  referralRulesText: "Referral rewards will be available after registration integration is enabled."
};

function createAuthResponse(user: UserRecord, jwtSecret: string): AuthResponse {
  return {
    user: toAuthUser(user),
    token: createJwt(user.id, user.sessionVersion, jwtSecret)
  };
}

function parseRegisterRequest(body: unknown): RegisterRequest | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  if (!isNonEmptyString(body.email) || typeof body.password !== "string") {
    return undefined;
  }

  return {
    email: body.email.trim().toLowerCase(),
    password: body.password
  };
}

function parseLoginRequest(
  body: unknown
): { email: string; password: unknown } | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  if (!isNonEmptyString(body.email)) {
    return undefined;
  }

  return {
    email: body.email.trim().toLowerCase(),
    password: body.password
  };
}

function parseChangePasswordRequest(
  body: unknown
): { currentPassword: unknown; newPassword: unknown } | undefined {
  if (
    !isRecord(body) ||
    Array.isArray(body) ||
    ["email", "userId", "accountId", "role"].some((key) => key in body)
  ) {
    return undefined;
  }

  return {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword
  };
}

function parseEmailVerificationResendRequest(
  body: unknown
): { email: string } | undefined {
  if (!isRecord(body) || !isNonEmptyString(body.email)) {
    return undefined;
  }

  return {
    email: body.email.trim().toLowerCase()
  };
}

function parsePasswordResetRequest(
  body: unknown
): { email: string } | undefined {
  if (
    !isRecord(body) ||
    Array.isArray(body) ||
    !isNonEmptyString(body.email)
  ) {
    return undefined;
  }

  return {
    email: body.email.trim().toLowerCase()
  };
}

function parsePasswordResetConsumeRequest(
  body: unknown
): { token: unknown; password: unknown } | undefined {
  if (!isRecord(body) || Array.isArray(body)) {
    return undefined;
  }

  return {
    token: body.token,
    password: body.password
  };
}

function parseChatCompletionRequest(
  body: unknown,
  defaultModel: string
): ChatCompletionRequest | undefined {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return undefined;
  }

  const messages = body.messages.filter((message) => {
    return (
      isRecord(message) &&
      ["system", "user", "assistant"].includes(String(message.role)) &&
      isNonEmptyString(message.content)
    );
  }) as ChatMessage[];

  if (messages.length === 0) {
    return undefined;
  }

  return {
    ...(isNonEmptyString(body.sessionId)
      ? { sessionId: body.sessionId.trim() }
      : {}),
    model: isNonEmptyString(body.model) ? body.model.trim() : defaultModel,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content
    })),
    temperature:
      typeof body.temperature === "number" ? body.temperature : undefined
  };
}

type ParsedNonStreamChatCompletionRequest = {
  request: ChatCompletionRequest;
  stateless?: boolean;
  suppliedSessionId: boolean;
};

function parseNonStreamChatCompletionRequest(
  body: unknown,
  defaultModel: string
): ParsedNonStreamChatCompletionRequest | undefined {
  if (
    !isRecord(body) ||
    ("stateless" in body && typeof body.stateless !== "boolean")
  ) {
    return undefined;
  }

  const request = parseChatCompletionRequest(body, defaultModel);
  if (!request) {
    return undefined;
  }

  return {
    request,
    suppliedSessionId: "sessionId" in body,
    ...(typeof body.stateless === "boolean"
      ? { stateless: body.stateless }
      : {})
  };
}

const MAX_IMAGE_PROMPT_LENGTH = 4_000;
const REFERENCE_IMAGE_MAX_COUNT = 4;
const REFERENCE_IMAGE_MAX_BYTES_EACH = 5 * 1024 * 1024;
const REFERENCE_IMAGE_MAX_BYTES_TOTAL = 10 * 1024 * 1024;
const REFERENCE_IMAGE_MAX_ENCODED_PAYLOAD_LENGTH =
  Math.ceil(REFERENCE_IMAGE_MAX_BYTES_EACH / 3) * 4;
const IMAGE_GENERATE_BODY_LIMIT_BYTES = 16 * 1024 * 1024;
const VIDEO_GENERATE_BODY_LIMIT_BYTES = 16 * 1024 * 1024;
const IMAGE_CREDIT_RESERVATION_TTL_MS = 15 * 60 * 1000;
const VIDEO_CREDIT_RESERVATION_TTL_MS = 60 * 60 * 1000;
const CHAT_CREDIT_RESERVATION_TTL_MS = 15 * 60 * 1000;
const IMAGE_PROVIDER_TIMEOUT_DEFAULT_MS = 60000;
const ADMIN_DIAGNOSTIC_MAX_TIMEOUT_MS = 60000;
const IMAGE_PROVIDER_TIMEOUT_MAX_MS = 10 * 60 * 1000;
const VIDEO_PROVIDER_TIMEOUT_DEFAULT_MS = 60_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_MAX_POLL_ATTEMPTS = 120;
const DEFAULT_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_RESULT_MAX_REDIRECTS = 3;
const VIDEO_RESULT_DOWNLOAD_MAX_ATTEMPTS = 2;
const VIDEO_RESULT_READINESS_MAX_TIMEOUT_ROUNDS = 8;
const IMAGE_AGNES_BATCH_TIMEOUT_MAX_MS = 4 * IMAGE_PROVIDER_TIMEOUT_DEFAULT_MS;
const IMAGE_GENERATE_USER_RATE_LIMIT = {
  limit: 60,
  windowMs: 10 * 60 * 1000
} as const;
const IMAGE_IDEMPOTENCY_RETRY_AFTER_MS = 2_000;
const SUPPORTED_REFERENCE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

type ImageGenerateValidationError = {
  statusCode: 400 | 413;
  code:
    | "REFERENCE_IMAGE_COUNT_EXCEEDED"
    | "REFERENCE_IMAGE_INVALID"
    | "REFERENCE_IMAGE_TOO_LARGE"
    | "REFERENCE_IMAGES_TOTAL_TOO_LARGE";
  message: string;
};

class ImageProviderTimeoutError extends Error {
  constructor() {
    super("image provider request timed out");
    this.name = "ImageProviderTimeoutError";
  }
}

class ImageProviderInvalidResponseError extends Error {
  constructor() {
    super("image provider returned no valid image output");
    this.name = "ImageProviderInvalidResponseError";
  }
}

class ImageAssetPersistenceError extends Error {
  readonly diagnostic: ImagePersistenceDiagnostic;

  constructor(diagnostic: ImagePersistenceDiagnostic) {
    super("image asset persistence failed");
    this.name = "ImageAssetPersistenceError";
    this.diagnostic = diagnostic;
  }
}

type ImagePersistenceReasonCode =
  | "OUTPUT_MISSING"
  | "URL_INVALID"
  | "URL_HOST_NOT_ALLOWED"
  | "URL_ADDRESS_REJECTED"
  | "REDIRECT_REJECTED"
  | "DOWNLOAD_TIMEOUT"
  | "DOWNLOAD_NETWORK_FAILED"
  | "DOWNLOAD_HTTP_STATUS"
  | "DOWNLOAD_CONTENT_TYPE"
  | "DOWNLOAD_TOO_LARGE"
  | "DOWNLOAD_EMPTY"
  | "TEMP_FILE_FAILED"
  | "WRITE_FAILED"
  | "RENAME_FAILED"
  | "STORAGE_OBJECT_FAILED"
  | "ASSET_DATABASE_FAILED"
  | "TASK_DATABASE_FAILED"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UPSTREAM_FAILED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REQUEST_FAILED"
  | "UNKNOWN_PERSISTENCE_FAILURE";

type ImagePersistenceStage =
  | "provider-output"
  | "url-policy"
  | "dns"
  | "connect"
  | "headers"
  | "redirect"
  | "body"
  | "temp-file"
  | "rename"
  | "storage-object"
  | "asset-db"
  | "task-db"
  | "provider-request"
  | "unknown";

type ImagePersistenceErrorClass =
  | "AIProviderRequestError"
  | "ImageAssetPersistenceError"
  | "ImageProviderInvalidResponseError"
  | "ImageProviderTimeoutError"
  | "LocalStorageObjectError"
  | "RemoteImageBodyError"
  | "RemoteImageFetcherError"
  | "RemoteImageStorageError"
  | "RemoteImageUrlPolicyError"
  | "UnknownError";

interface ImagePersistenceDiagnostic {
  reasonCode: ImagePersistenceReasonCode;
  stage: ImagePersistenceStage;
  errorClass: ImagePersistenceErrorClass;
  status?: number;
  redirectCount?: number;
  byteCount?: number;
}

function createImageAssetPersistenceError(
  error?: unknown
): ImageAssetPersistenceError {
  return new ImageAssetPersistenceError(
    error === undefined
      ? {
          reasonCode: "UNKNOWN_PERSISTENCE_FAILURE",
          stage: "unknown",
          errorClass: "ImageAssetPersistenceError"
        }
      : mapImagePersistenceError(error)
  );
}

function mapImagePersistenceError(error: unknown): ImagePersistenceDiagnostic {
  if (error instanceof ImageAssetPersistenceError) {
    return error.diagnostic;
  }

  if (error instanceof RemoteImageUrlPolicyError) {
    return {
      reasonCode:
        error.reason === "HOST_NOT_ALLOWED"
          ? "URL_HOST_NOT_ALLOWED"
          : "URL_INVALID",
      stage: "url-policy",
      errorClass: "RemoteImageUrlPolicyError"
    };
  }

  if (error instanceof RemoteImageFetcherError) {
    const redirectFailure =
      error.code === "REMOTE_IMAGE_REDIRECT_INVALID" ||
      error.code === "REMOTE_IMAGE_REDIRECT_LIMIT" ||
      error.code === "REMOTE_IMAGE_REDIRECT_LOOP";
    const base = redirectFailure
      ? {
          reasonCode: "REDIRECT_REJECTED" as const,
          stage: "redirect" as const
        }
      : mapRemoteImageFetcherFailure(error);

    return {
      ...base,
      errorClass: "RemoteImageFetcherError",
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.redirectCount === undefined
        ? {}
        : { redirectCount: error.redirectCount })
    };
  }

  if (error instanceof RemoteImageBodyError) {
    const base = mapRemoteImageBodyFailure(error);
    return {
      ...base,
      errorClass: "RemoteImageBodyError",
      ...(error.byteCount === undefined ? {} : { byteCount: error.byteCount })
    };
  }

  if (error instanceof RemoteImageStorageError) {
    return {
      ...mapRemoteImageStorageFailure(error),
      errorClass: "RemoteImageStorageError"
    };
  }

  if (error instanceof LocalStorageObjectError) {
    return {
      ...mapLocalStorageObjectFailure(error),
      errorClass: "LocalStorageObjectError"
    };
  }

  if (error instanceof AIProviderRequestError) {
    const status = safeImageHttpStatus(error.statusCode);
    const reasonCode =
      status === 401 || status === 403
        ? "PROVIDER_AUTH_FAILED"
        : status === 429
          ? "PROVIDER_RATE_LIMITED"
          : status !== undefined && status >= 500 && status <= 599
            ? "PROVIDER_UPSTREAM_FAILED"
            : "PROVIDER_REQUEST_FAILED";

    return {
      reasonCode,
      stage: "provider-request",
      errorClass: "AIProviderRequestError",
      ...(status === undefined ? {} : { status })
    };
  }

  if (error instanceof AIProviderResponseFormatError) {
    return {
      reasonCode: "PROVIDER_INVALID_RESPONSE",
      stage: "provider-output",
      errorClass: "ImageProviderInvalidResponseError"
    };
  }

  if (
    error instanceof ImageProviderTimeoutError ||
    error instanceof AIProviderTimeoutError
  ) {
    return {
      reasonCode: "PROVIDER_TIMEOUT",
      stage: "provider-request",
      errorClass: "ImageProviderTimeoutError"
    };
  }

  if (error instanceof ImageProviderInvalidResponseError) {
    return {
      reasonCode: "PROVIDER_INVALID_RESPONSE",
      stage: "provider-output",
      errorClass: "ImageProviderInvalidResponseError"
    };
  }

  return {
    reasonCode: "UNKNOWN_PERSISTENCE_FAILURE",
    stage: "unknown",
    errorClass: "UnknownError"
  };
}

function mapRemoteImageFetcherFailure(
  error: RemoteImageFetcherError
): Pick<ImagePersistenceDiagnostic, "reasonCode" | "stage"> {
  switch (error.code) {
    case "REMOTE_IMAGE_ADDRESS_FORBIDDEN":
    case "REMOTE_IMAGE_ADDRESS_LIMIT":
      return { reasonCode: "URL_ADDRESS_REJECTED", stage: "dns" };
    case "REMOTE_IMAGE_DNS_TIMEOUT":
    case "REMOTE_IMAGE_CONNECT_TIMEOUT":
    case "REMOTE_IMAGE_HEADERS_TIMEOUT":
    case "REMOTE_IMAGE_TIMEOUT":
      return {
        reasonCode: "DOWNLOAD_TIMEOUT",
        stage: mapFetcherStage(error.stage)
      };
    case "REMOTE_IMAGE_HTTP_STATUS":
      return { reasonCode: "DOWNLOAD_HTTP_STATUS", stage: "headers" };
    case "REMOTE_IMAGE_CONTENT_ENCODING_FORBIDDEN":
      return { reasonCode: "DOWNLOAD_CONTENT_TYPE", stage: "headers" };
    case "REMOTE_IMAGE_DNS_FAILED":
    case "REMOTE_IMAGE_CONNECT_FAILED":
      return {
        reasonCode: "DOWNLOAD_NETWORK_FAILED",
        stage: mapFetcherStage(error.stage)
      };
    case "REMOTE_IMAGE_ABORTED":
      return { reasonCode: "UNKNOWN_PERSISTENCE_FAILURE", stage: "unknown" };
  }

  return { reasonCode: "UNKNOWN_PERSISTENCE_FAILURE", stage: "unknown" };
}

function mapRemoteImageBodyFailure(
  error: RemoteImageBodyError
): Pick<ImagePersistenceDiagnostic, "reasonCode" | "stage"> {
  switch (error.code) {
    case "REMOTE_IMAGE_BODY_TIMEOUT":
      return { reasonCode: "DOWNLOAD_TIMEOUT", stage: "body" };
    case "REMOTE_IMAGE_TOO_LARGE":
      return { reasonCode: "DOWNLOAD_TOO_LARGE", stage: "body" };
    case "REMOTE_IMAGE_EMPTY":
      return { reasonCode: "DOWNLOAD_EMPTY", stage: "body" };
    case "REMOTE_IMAGE_MAGIC_UNSUPPORTED":
    case "REMOTE_IMAGE_FORMAT_INVALID":
    case "REMOTE_IMAGE_MIME_MISMATCH":
    case "REMOTE_IMAGE_LENGTH_MISMATCH":
      return { reasonCode: "DOWNLOAD_CONTENT_TYPE", stage: "body" };
    case "REMOTE_IMAGE_DESTINATION_FAILED":
      return { reasonCode: "WRITE_FAILED", stage: "body" };
    case "REMOTE_IMAGE_STREAM_FAILED":
      return { reasonCode: "DOWNLOAD_NETWORK_FAILED", stage: "body" };
    case "REMOTE_IMAGE_ABORTED":
    case "REMOTE_IMAGE_ALREADY_CONSUMED":
      return { reasonCode: "UNKNOWN_PERSISTENCE_FAILURE", stage: "body" };
  }

  return { reasonCode: "UNKNOWN_PERSISTENCE_FAILURE", stage: "body" };
}

function mapRemoteImageStorageFailure(
  error: RemoteImageStorageError
): Pick<ImagePersistenceDiagnostic, "reasonCode" | "stage"> {
  switch (error.code) {
    case "REMOTE_IMAGE_STORAGE_DIRECTORY_FAILED":
    case "REMOTE_IMAGE_STORAGE_TEMP_FILE_FAILED":
    case "REMOTE_IMAGE_STORAGE_FINAL_FILE_FAILED":
      return { reasonCode: "TEMP_FILE_FAILED", stage: "temp-file" };
    case "REMOTE_IMAGE_STORAGE_SYNC_FAILED":
      return { reasonCode: "WRITE_FAILED", stage: "temp-file" };
    case "REMOTE_IMAGE_STORAGE_RENAME_FAILED":
      return { reasonCode: "RENAME_FAILED", stage: "rename" };
    case "REMOTE_IMAGE_STORAGE_OBJECT_FAILED":
    case "REMOTE_IMAGE_STORAGE_READY_FAILED":
    case "REMOTE_IMAGE_STORAGE_STATE_UNKNOWN":
      return { reasonCode: "STORAGE_OBJECT_FAILED", stage: "storage-object" };
    case "REMOTE_IMAGE_STORAGE_INPUT_INVALID":
      return {
        reasonCode: "UNKNOWN_PERSISTENCE_FAILURE",
        stage: "unknown"
      };
  }

  return { reasonCode: "UNKNOWN_PERSISTENCE_FAILURE", stage: "unknown" };
}

function mapLocalStorageObjectFailure(
  error: LocalStorageObjectError
): Pick<ImagePersistenceDiagnostic, "reasonCode" | "stage"> {
  if (error.code === "LOCAL_STORAGE_WRITE_FAILED") {
    return { reasonCode: "WRITE_FAILED", stage: "temp-file" };
  }

  return { reasonCode: "STORAGE_OBJECT_FAILED", stage: "storage-object" };
}

function isInvalidGeneratedImageOutputError(error: unknown): boolean {
  if (error instanceof RemoteImageUrlPolicyError) {
    return true;
  }

  if (error instanceof LocalStorageObjectError) {
    return (
      error.code === "INVALID_IMAGE_DATA_URL" ||
      error.code === "IMAGE_TOO_LARGE" ||
      error.code === "IMAGE_SIGNATURE_MISMATCH"
    );
  }

  if (error instanceof RemoteImageBodyError) {
    return (
      error.code === "REMOTE_IMAGE_TOO_LARGE" ||
      error.code === "REMOTE_IMAGE_EMPTY" ||
      error.code === "REMOTE_IMAGE_MAGIC_UNSUPPORTED" ||
      error.code === "REMOTE_IMAGE_FORMAT_INVALID" ||
      error.code === "REMOTE_IMAGE_MIME_MISMATCH" ||
      error.code === "REMOTE_IMAGE_LENGTH_MISMATCH"
    );
  }

  if (error instanceof RemoteImageFetcherError) {
    return (
      error.code === "REMOTE_IMAGE_ADDRESS_FORBIDDEN" ||
      error.code === "REMOTE_IMAGE_ADDRESS_LIMIT" ||
      error.code === "REMOTE_IMAGE_REDIRECT_INVALID" ||
      error.code === "REMOTE_IMAGE_REDIRECT_LIMIT" ||
      error.code === "REMOTE_IMAGE_REDIRECT_LOOP" ||
      error.code === "REMOTE_IMAGE_HTTP_STATUS" ||
      error.code === "REMOTE_IMAGE_CONTENT_ENCODING_FORBIDDEN"
    );
  }

  return false;
}

function mapFetcherStage(
  stage: RemoteImageFetcherError["stage"]
): ImagePersistenceStage {
  return stage === "dns" ||
    stage === "connect" ||
    stage === "headers" ||
    stage === "redirect"
    ? stage
    : "unknown";
}

function safeImageHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

function safeImageDurationMs(startedAt: number): number {
  const duration = Date.now() - startedAt;
  return Number.isSafeInteger(duration) && duration >= 0 ? duration : 0;
}

function hashImagePrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function isValidImageProviderTimeoutMs(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function resolveAgnesBatchTimeoutMs({
  count,
  perRequestTimeoutMs
}: {
  count: AiGenerationCount;
  perRequestTimeoutMs: number;
}): number {
  if (count === 1) {
    return perRequestTimeoutMs;
  }

  return Math.min(
    perRequestTimeoutMs * count,
    IMAGE_AGNES_BATCH_TIMEOUT_MAX_MS
  );
}

async function runImageProviderWithTimeout<T>({
  timeoutMs,
  operation
}: {
  timeoutMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ImageProviderTimeoutError());
    }, timeoutMs);
    timeoutHandle.unref();
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } catch (error) {
    if (timedOut) {
      throw new ImageProviderTimeoutError();
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function resolveAdminDiagnosticTimeoutMs({
  requestTimeoutMs,
  providerTimeoutMs
}: {
  requestTimeoutMs?: number;
  providerTimeoutMs?: number;
}): number {
  return Math.min(
    requestTimeoutMs ?? providerTimeoutMs ?? ADMIN_DIAGNOSTIC_MAX_TIMEOUT_MS,
    ADMIN_DIAGNOSTIC_MAX_TIMEOUT_MS
  );
}

async function runAdminDiagnosticWithTimeout<T>({
  timeoutMs,
  operation
}: {
  timeoutMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let abortCalled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const operationPromise = Promise.resolve().then(() =>
    operation(controller.signal)
  );
  const timeout = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (!abortCalled) {
        abortCalled = true;
        controller.abort();
      }
      reject(new AIProviderTimeoutError());
    }, timeoutMs);
    timeoutHandle.unref();
  });

  try {
    return await Promise.race([operationPromise, timeout]);
  } catch (error) {
    if (timedOut) {
      void operationPromise.catch(() => undefined);
      throw new AIProviderTimeoutError();
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

const referenceImageCountExceededError: ImageGenerateValidationError = {
  statusCode: 400,
  code: "REFERENCE_IMAGE_COUNT_EXCEEDED",
  message: "参考图片数量超过限制"
};

const referenceImageInvalidError: ImageGenerateValidationError = {
  statusCode: 400,
  code: "REFERENCE_IMAGE_INVALID",
  message: "参考图片格式不受支持"
};

const referenceImageTooLargeError: ImageGenerateValidationError = {
  statusCode: 413,
  code: "REFERENCE_IMAGE_TOO_LARGE",
  message: "单张参考图片超过大小限制"
};

const referenceImagesTotalTooLargeError: ImageGenerateValidationError = {
  statusCode: 413,
  code: "REFERENCE_IMAGES_TOTAL_TOO_LARGE",
  message: "参考图片总大小超过限制"
};

type ParsedReferenceImageResult =
  | { image: ImageReferenceInput; decodedBytes: number }
  | { error: ImageGenerateValidationError };

function isAiGenerationSize(value: unknown): value is AiGenerationSize {
  return aiGenerationSizes.includes(value as AiGenerationSize);
}

function isAiGenerationCount(value: unknown): value is AiGenerationCount {
  return aiGenerationCounts.includes(value as AiGenerationCount);
}

function isImageGenerationMode(value: unknown): value is ImageGenerationMode {
  return value === "text-to-image" || value === "image-to-image";
}

function parseReferenceImage(value: unknown): ParsedReferenceImageResult {
  if (!isRecord(value)) {
    return { error: referenceImageInvalidError };
  }

  if (!isNonEmptyString(value.dataUrl) || !isNonEmptyString(value.mimeType)) {
    return { error: referenceImageInvalidError };
  }

  const mimeType = value.mimeType.trim().toLowerCase();

  if (!SUPPORTED_REFERENCE_IMAGE_TYPES.has(mimeType)) {
    return { error: referenceImageInvalidError };
  }

  const dataUrl = value.dataUrl;
  const dataUrlMatch = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(
    dataUrl
  );

  if (
    !dataUrlMatch ||
    dataUrlMatch[1]?.toLowerCase() !== mimeType
  ) {
    return { error: referenceImageInvalidError };
  }

  const encoded = dataUrlMatch[2] ?? "";

  if (
    !encoded ||
    encoded.length > REFERENCE_IMAGE_MAX_ENCODED_PAYLOAD_LENGTH ||
    encoded.length % 4 !== 0
  ) {
    return {
      error: encoded.length > REFERENCE_IMAGE_MAX_ENCODED_PAYLOAD_LENGTH
        ? referenceImageTooLargeError
        : referenceImageInvalidError
    };
  }

  const decoded = Buffer.from(encoded, "base64");

  if (decoded.length === 0) {
    return { error: referenceImageInvalidError };
  }

  if (decoded.length > REFERENCE_IMAGE_MAX_BYTES_EACH) {
    return { error: referenceImageTooLargeError };
  }

  const originalBytes =
    typeof value.originalBytes === "number" &&
    Number.isSafeInteger(value.originalBytes) &&
    value.originalBytes > 0
      ? value.originalBytes
      : undefined;
  const compressedBytes =
    typeof value.compressedBytes === "number" &&
    Number.isSafeInteger(value.compressedBytes) &&
    value.compressedBytes > 0
      ? value.compressedBytes
      : undefined;

  return {
    image: {
      dataUrl,
      mimeType,
      ...(isNonEmptyString(value.name)
        ? { name: value.name.trim().slice(0, 120) }
        : {}),
      ...(originalBytes ? { originalBytes } : {}),
      ...(compressedBytes ? { compressedBytes } : {})
    },
    decodedBytes: decoded.length
  };
}

type ImageReferenceMetadata = {
  mimeType: string;
  name: string | null;
  originalBytes: number | null;
  compressedBytes: number | null;
};

function projectReferenceImageMetadata(
  referenceImages: readonly ImageReferenceInput[] | undefined
):
  | Record<string, never>
  | {
      referenceImages: ImageReferenceMetadata[];
      referenceImage?: ImageReferenceMetadata;
    } {
  if (!referenceImages || referenceImages.length === 0) {
    return {};
  }

  const metadata = referenceImages.map((referenceImage) => ({
    mimeType: referenceImage.mimeType,
    name: referenceImage.name ?? null,
    originalBytes: referenceImage.originalBytes ?? null,
    compressedBytes: referenceImage.compressedBytes ?? null
  }));

  return {
    referenceImages: metadata,
    ...(metadata.length === 1 ? { referenceImage: metadata[0]! } : {})
  };
}

function parseImageGenerateRequest(body: unknown) {
  if (!isRecord(body)) {
    return undefined;
  }

  if (
    !isNonEmptyString(body.prompt) ||
    body.prompt.trim().length > MAX_IMAGE_PROMPT_LENGTH ||
    !isNonEmptyString(body.modelId) ||
    !isAiGenerationSize(body.size) ||
    !isAiGenerationCount(body.count)
  ) {
    return undefined;
  }

  if (body.mode !== undefined && !isImageGenerationMode(body.mode)) {
    return undefined;
  }

  const mode = body.mode ?? "text-to-image";
  const workflow = body.workflow;
  if (workflow !== undefined && !isImageGenerationWorkflow(workflow)) {
    return undefined;
  }

  if (
    workflow === "precision-edit" &&
    (mode !== "image-to-image" || body.titleCover !== undefined)
  ) {
    return undefined;
  }

  if (
    workflow === "transcript-images" &&
    (mode !== "text-to-image" ||
      body.count !== 1 ||
      body.referenceImage !== undefined ||
      body.referenceImages !== undefined ||
      body.titleCover !== undefined)
  ) {
    return undefined;
  }

  let titleCover: TitleCoverImageRequest | undefined;
  if (body.titleCover !== undefined) {
    if (workflow !== "title-cover" || !isRecord(body.titleCover)) {
      return undefined;
    }

    const originalTitle = normalizeTitleCoverOriginalTitle(
      body.titleCover.originalTitle
    );
    if (!originalTitle || !isTitleCoverVisualStyle(body.titleCover.style)) {
      return undefined;
    }

    titleCover = {
      originalTitle,
      style: body.titleCover.style
    };
  }

  if (workflow === "title-cover" && !titleCover) {
    return undefined;
  }

  if (workflow === undefined && body.titleCover !== undefined) {
    return undefined;
  }

  const hasLegacyReferenceImage = body.referenceImage !== undefined;
  const hasReferenceImages = body.referenceImages !== undefined;

  if (hasLegacyReferenceImage && hasReferenceImages) {
    return undefined;
  }

  let referenceImages: ImageReferenceInput[] | undefined;
  if (mode === "text-to-image") {
    if (hasLegacyReferenceImage || hasReferenceImages) {
      return undefined;
    }
  } else {
    if (!hasLegacyReferenceImage && !hasReferenceImages) {
      return undefined;
    }

    const referenceImageValues = hasLegacyReferenceImage
      ? Array.isArray(body.referenceImage)
        ? null
        : [body.referenceImage]
      : Array.isArray(body.referenceImages)
        ? body.referenceImages
        : null;

    if (!referenceImageValues || referenceImageValues.length === 0) {
      return undefined;
    }
    if (referenceImageValues.length > REFERENCE_IMAGE_MAX_COUNT) {
      return { error: referenceImageCountExceededError };
    }

    let totalBytes = 0;
    referenceImages = [];
    for (const referenceImageValue of referenceImageValues) {
      const parsedReferenceImage = parseReferenceImage(referenceImageValue);
      if ("error" in parsedReferenceImage) {
        return { error: parsedReferenceImage.error };
      }
      totalBytes += parsedReferenceImage.decodedBytes;
      referenceImages.push(parsedReferenceImage.image);
    }

    if (totalBytes > REFERENCE_IMAGE_MAX_BYTES_TOTAL) {
      return { error: referenceImagesTotalTooLargeError };
    }
    if (workflow === "precision-edit" && referenceImages.length !== 1) {
      return undefined;
    }
  }

  const imageSessionId =
    typeof body.imageSessionId === "string" && body.imageSessionId.trim()
      ? body.imageSessionId.trim().slice(0, 128)
      : undefined;
  const clientEntryId =
    typeof body.clientEntryId === "string" && body.clientEntryId.trim()
      ? body.clientEntryId.trim().slice(0, 128)
      : undefined;
  const imageSessionTitle =
    typeof body.imageSessionTitle === "string" && body.imageSessionTitle.trim()
      ? body.imageSessionTitle.trim().slice(0, 120)
      : undefined;

  return {
    prompt: body.prompt.trim(),
    modelId: body.modelId.trim(),
    size: body.size,
    count: body.count,
    mode,
    ...(workflow ? { workflow } : {}),
    ...(workflow === "title-cover" && titleCover ? { titleCover } : {}),
    ...(imageSessionId ? { imageSessionId } : {}),
    ...(clientEntryId ? { clientEntryId } : {}),
    ...(imageSessionTitle ? { imageSessionTitle } : {}),
    ...(referenceImages ? { referenceImages } : {})
  };
}

type VideoGenerateBody = {
  prompt: string;
  modelId: string;
  mode: "text-to-video" | "image-to-video";
  referenceImage?: ImageReferenceInput;
};

function isValidVideoReferenceSignature(
  image: ImageReferenceInput
): boolean {
  const encoded = extractReferenceImageBase64(image);
  if (!encoded) {
    return false;
  }
  const bytes = Buffer.from(encoded, "base64");
  if (image.mimeType === "image/png") {
    return (
      bytes.byteLength >= 8 &&
      bytes.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    );
  }
  if (image.mimeType === "image/jpeg") {
    return (
      bytes.byteLength >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  if (image.mimeType === "image/webp") {
    return (
      bytes.byteLength >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function parseVideoGenerateRequest(
  body: unknown
): VideoGenerateBody | { error: ImageGenerateValidationError } | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const allowedKeys = new Set([
    "modelId",
    "mode",
    "prompt",
    "reference",
    "referenceImage"
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return undefined;
  }
  if (
    !isNonEmptyString(body.modelId) ||
    !isNonEmptyString(body.prompt) ||
    body.prompt.trim().length > MAX_IMAGE_PROMPT_LENGTH ||
    (body.mode !== "text-to-video" && body.mode !== "image-to-video")
  ) {
    return undefined;
  }

  if (body.reference !== undefined && body.referenceImage !== undefined) {
    return undefined;
  }
  const referenceValue = body.referenceImage ?? body.reference;
  if (body.mode === "text-to-video" && referenceValue !== undefined) {
    return undefined;
  }
  if (body.mode === "image-to-video" && referenceValue === undefined) {
    return undefined;
  }

  let referenceImage: ImageReferenceInput | undefined;
  if (referenceValue !== undefined) {
    const parsed = parseReferenceImage(referenceValue);
    if ("error" in parsed) {
      return { error: parsed.error };
    }
    referenceImage = parsed.image;
    if (!isValidVideoReferenceSignature(referenceImage)) {
      return { error: referenceImageInvalidError };
    }
  }

  return {
    modelId: body.modelId.trim(),
    mode: body.mode,
    prompt: body.prompt.trim(),
    ...(referenceImage ? { referenceImage } : {})
  };
}

async function fetchBoundedVideoResult(input: {
  url: string;
  providerBaseUrl: string;
  allowedHostRules: readonly RemoteImageAllowedHostRule[];
  fetchImpl?: typeof fetch;
  remoteFetcher: RemoteImageFetcherService;
  timeoutMs: number;
  maxBytes: number;
}): Promise<Buffer> {
  let providerUrl: URL;
  try {
    providerUrl = new URL(input.providerBaseUrl);
  } catch {
    throw new Error("VIDEO_PROVIDER_BASE_URL_INVALID");
  }
  const allowedHostRules = [
    ...input.allowedHostRules,
    { kind: "exact", hostname: providerUrl.hostname.toLowerCase() },
    { kind: "exact", hostname: "upload.apimart.ai" }
  ] as const;
  const resultUrl = validateRemoteImageDownloadUrl(input.url, allowedHostRules);

  if (input.fetchImpl === undefined) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const fetched = await input.remoteFetcher.fetchRemoteImage({
        url: resultUrl.url.href,
        allowedHosts: allowedHostRules,
        signal: controller.signal
      });
      const contentType = fetched.contentType?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "video/mp4") {
        fetched.cancel();
        throw new Error("VIDEO_RESULT_MIME_INVALID");
      }

      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of fetched.stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.byteLength;
          if (total > input.maxBytes) {
            fetched.cancel();
            throw new Error("VIDEO_RESULT_TOO_LARGE");
          }
          chunks.push(bytes);
        }
      } catch (error) {
        fetched.cancel();
        throw error;
      }

      return validateBoundedVideoResultBytes(
        Buffer.concat(chunks, total),
        input.maxBytes
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), input.timeoutMs);
  const visitedUrls = new Set<string>([resultUrl.url.href]);
  let currentUrl = resultUrl.url.href;
  let redirectCount = 0;
  try {
    let response: Response;
    for (;;) {
      response = await input.fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal
      });
      if (!isVideoResultRedirectStatus(response.status)) {
        break;
      }

      await cancelFetchResponseBody(response);
      if (redirectCount >= VIDEO_RESULT_MAX_REDIRECTS) {
        throw new Error("VIDEO_RESULT_REDIRECT_LIMIT");
      }
      const location = response.headers.get("location")?.trim();
      if (!location) {
        throw new Error("VIDEO_RESULT_REDIRECT_INVALID");
      }

      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, currentUrl);
      } catch {
        throw new Error("VIDEO_RESULT_REDIRECT_INVALID");
      }
      let validatedRedirectUrl: ReturnType<typeof validateRemoteImageDownloadUrl>;
      try {
        validatedRedirectUrl = validateRemoteImageDownloadUrl(
          redirectUrl.href,
          allowedHostRules
        );
      } catch {
        throw new Error("VIDEO_RESULT_REDIRECT_INVALID");
      }
      const nextUrl = validatedRedirectUrl.url.href;
      if (visitedUrls.has(nextUrl)) {
        throw new Error("VIDEO_RESULT_REDIRECT_LOOP");
      }
      visitedUrls.add(nextUrl);
      currentUrl = nextUrl;
      redirectCount += 1;
    }

    if (!response.ok) {
      throw new Error("VIDEO_RESULT_HTTP_STATUS");
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "video/mp4") {
      throw new Error("VIDEO_RESULT_MIME_INVALID");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isSafeInteger(declaredLength) &&
      declaredLength > input.maxBytes
    ) {
      throw new Error("VIDEO_RESULT_TOO_LARGE");
    }

    if (!response.body) {
      const bytes = Buffer.from(await response.arrayBuffer());
      return validateBoundedVideoResultBytes(bytes, input.maxBytes);
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        total += next.value.byteLength;
        if (total > input.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error("VIDEO_RESULT_TOO_LARGE");
        }
        chunks.push(Buffer.from(next.value));
      }
    } finally {
      reader.releaseLock();
    }
    return validateBoundedVideoResultBytes(Buffer.concat(chunks, total), input.maxBytes);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchVideoResultWithBoundedRetry(
  input: Parameters<typeof fetchBoundedVideoResult>[0]
): Promise<Buffer> {
  for (
    let attempt = 1;
    attempt <= VIDEO_RESULT_DOWNLOAD_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await fetchBoundedVideoResult(input);
    } catch (error) {
      if (
        attempt < VIDEO_RESULT_DOWNLOAD_MAX_ATTEMPTS &&
        error instanceof RemoteImageFetcherError &&
        error.code === "REMOTE_IMAGE_HEADERS_TIMEOUT" &&
        error.stage === "headers"
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("VIDEO_RESULT_DOWNLOAD_FAILED");
}

function isVideoResultReadinessTimeout(
  error: unknown
): error is RemoteImageFetcherError {
  return (
    error instanceof RemoteImageFetcherError &&
    error.code === "REMOTE_IMAGE_HEADERS_TIMEOUT" &&
    error.stage === "headers"
  );
}

function isVideoResultRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function cancelFetchResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The redirect response is already being discarded.
  }
}

function validateBoundedVideoResultBytes(
  bytes: Buffer,
  maxBytes: number
): Buffer {
  if (bytes.byteLength > maxBytes) {
    throw new Error("VIDEO_RESULT_TOO_LARGE");
  }
  if (
    bytes.byteLength < 8 ||
    bytes.subarray(4, 8).toString("ascii") !== "ftyp"
  ) {
    throw new Error("VIDEO_RESULT_SIGNATURE_INVALID");
  }
  return bytes;
}

function extractReferenceImageBase64(referenceImage: ImageReferenceInput) {
  const dataUrlPrefix = `data:${referenceImage.mimeType};base64,`;

  if (!referenceImage.dataUrl.startsWith(dataUrlPrefix)) {
    return undefined;
  }

  const encoded = referenceImage.dataUrl.slice(dataUrlPrefix.length);

  if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) {
    return undefined;
  }

  return encoded;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const features = value.filter(
    (feature): feature is string =>
      typeof feature === "string" && feature.trim().length > 0
  );

  return features.map((feature) => feature.trim());
}

function isModelProvider(value: unknown): value is ModelProvider {
  return (
    value === "OPENAI_COMPATIBLE" ||
    value === "SUB2API" ||
    value === "NEW_API"
  );
}

function isModelCapability(value: unknown): value is ModelCapability {
  return modelCapabilities.includes(value as ModelCapability);
}

function isModelDisplaySurface(value: unknown): value is ModelDisplaySurface {
  return modelDisplaySurfaces.includes(value as ModelDisplaySurface);
}

function isProviderAccountType(value: unknown): value is ProviderAccountType {
  return providerAccountTypes.includes(value as ProviderAccountType);
}

function isProviderAccountCapability(
  value: unknown
): value is ProviderAccountCapability {
  return providerAccountCapabilities.includes(
    value as ProviderAccountCapability
  );
}

function parseProviderAccountCapabilities(
  value: unknown
): ProviderAccountCapability[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const capabilities = value.filter(isProviderAccountCapability);

  return capabilities.length === value.length ? capabilities : undefined;
}

function parseProviderAccountTestCapabilities(
  value: unknown
): ProviderAccountCapability[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const capabilities = value.filter(isProviderAccountCapability);

  return capabilities.length === value.length ? capabilities : undefined;
}

function parseOptionalJsonObject(
  value: unknown
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (isRecord(value) && !Array.isArray(value)) {
    return value;
  }

  return undefined;
}

function parseProviderAccountCreateRequest(
  body: unknown
): ProviderAccountInput | undefined {
  if (
    !isRecord(body) ||
    !isNonEmptyString(body.name) ||
    !isProviderAccountType(body.providerType) ||
    !isNonEmptyString(body.baseUrl)
  ) {
    return undefined;
  }

  const capabilities = parseProviderAccountCapabilities(body.capabilities);
  const headersJson =
    "headersJson" in body ? parseOptionalJsonObject(body.headersJson) : null;
  const configJson =
    "configJson" in body ? parseOptionalJsonObject(body.configJson) : null;

  if (
    !capabilities ||
    headersJson === undefined ||
    configJson === undefined ||
    ("apiKey" in body && typeof body.apiKey !== "string") ||
    ("enabled" in body && typeof body.enabled !== "boolean") ||
    ("priority" in body &&
      (typeof body.priority !== "number" || !Number.isInteger(body.priority))) ||
    ("timeoutMs" in body &&
      (typeof body.timeoutMs !== "number" ||
        !Number.isInteger(body.timeoutMs) ||
        body.timeoutMs <= 0)) ||
    ("notes" in body &&
      typeof body.notes !== "string" &&
      body.notes !== null)
  ) {
    return undefined;
  }

  return {
    name: body.name.trim(),
    providerType: body.providerType,
    baseUrl: body.baseUrl.trim(),
    apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
    capabilities,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    priority: typeof body.priority === "number" ? body.priority : 0,
    timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : 60000,
    headersJson,
    configJson,
    notes: typeof body.notes === "string"
      ? body.notes.trim()
      : body.notes === null
        ? null
        : undefined
  };
}

function parseProviderAccountUpdateRequest(
  body: unknown
): ProviderAccountUpdateInput | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const update: ProviderAccountUpdateInput = {};

  if ("name" in body) {
    if (!isNonEmptyString(body.name)) {
      return undefined;
    }
    update.name = body.name.trim();
  }

  if ("providerType" in body) {
    if (!isProviderAccountType(body.providerType)) {
      return undefined;
    }
    update.providerType = body.providerType;
  }

  if ("baseUrl" in body) {
    if (!isNonEmptyString(body.baseUrl)) {
      return undefined;
    }
    update.baseUrl = body.baseUrl.trim();
  }

  if ("apiKey" in body) {
    if (!isNonEmptyString(body.apiKey)) {
      return undefined;
    }
    update.apiKey = body.apiKey.trim();
  }

  if ("capabilities" in body) {
    const capabilities = parseProviderAccountCapabilities(body.capabilities);

    if (!capabilities) {
      return undefined;
    }

    update.capabilities = capabilities;
  }

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return undefined;
    }
    update.enabled = body.enabled;
  }

  if ("priority" in body) {
    if (typeof body.priority !== "number" || !Number.isInteger(body.priority)) {
      return undefined;
    }
    update.priority = body.priority;
  }

  if ("timeoutMs" in body) {
    if (
      typeof body.timeoutMs !== "number" ||
      !Number.isInteger(body.timeoutMs) ||
      body.timeoutMs <= 0
    ) {
      return undefined;
    }
    update.timeoutMs = body.timeoutMs;
  }

  if ("headersJson" in body) {
    const headersJson = parseOptionalJsonObject(body.headersJson);

    if (headersJson === undefined) {
      return undefined;
    }

    update.headersJson = headersJson;
  }

  if ("configJson" in body) {
    const configJson = parseOptionalJsonObject(body.configJson);

    if (configJson === undefined) {
      return undefined;
    }

    update.configJson = configJson;
  }

  if ("notes" in body) {
    if (typeof body.notes !== "string" && body.notes !== null) {
      return undefined;
    }
    update.notes = typeof body.notes === "string" ? body.notes.trim() : null;
  }

  return update;
}

function parsePlanCreateRequest(body: unknown) {
  if (!isRecord(body) || !isNonEmptyString(body.name)) {
    return undefined;
  }

  const features = parseStringArray(body.features);

  if (
    typeof body.price !== "number" ||
    !Number.isInteger(body.price) ||
    body.price < 0 ||
    typeof body.credits !== "number" ||
    !Number.isInteger(body.credits) ||
    body.credits <= 0 ||
    !features
  ) {
    return undefined;
  }

  return {
    name: body.name.trim(),
    price: body.price,
    credits: body.credits,
    description: isNonEmptyString(body.description)
      ? body.description.trim()
      : "",
    features,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    sortOrder:
      typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)
        ? body.sortOrder
        : 0
  };
}

function parsePlanUpdateRequest(body: unknown) {
  if (!isRecord(body)) {
    return undefined;
  }

  const update: {
    name?: string;
    price?: number;
    credits?: number;
    description?: string;
    features?: string[];
    enabled?: boolean;
    sortOrder?: number;
  } = {};

  if ("name" in body) {
    if (!isNonEmptyString(body.name)) {
      return undefined;
    }
    update.name = body.name.trim();
  }

  if ("price" in body) {
    if (
      typeof body.price !== "number" ||
      !Number.isInteger(body.price) ||
      body.price < 0
    ) {
      return undefined;
    }
    update.price = body.price;
  }

  if ("credits" in body) {
    if (
      typeof body.credits !== "number" ||
      !Number.isInteger(body.credits) ||
      body.credits <= 0
    ) {
      return undefined;
    }
    update.credits = body.credits;
  }

  if ("description" in body) {
    update.description = isNonEmptyString(body.description)
      ? body.description.trim()
      : "";
  }

  if ("features" in body) {
    const features = parseStringArray(body.features);

    if (!features) {
      return undefined;
    }

    update.features = features;
  }

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return undefined;
    }
    update.enabled = body.enabled;
  }

  if ("sortOrder" in body) {
    if (
      typeof body.sortOrder !== "number" ||
      !Number.isInteger(body.sortOrder)
    ) {
      return undefined;
    }
    update.sortOrder = body.sortOrder;
  }

  return update;
}

function parseModelDisplaySurfaces(
  value: unknown,
  capability: ModelCapability | undefined,
  present: boolean
): ModelDisplaySurface[] | undefined {
  if (!present) {
    return normalizeModelDisplaySurfaces(undefined, capability);
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const surfaces = normalizeModelDisplaySurfaces(value, capability);
  if (
    value.some(
      (surface) =>
        typeof surface !== "string" ||
        !modelDisplaySurfaces.includes(surface as ModelDisplaySurface)
    ) ||
    surfaces.some(
      (surface) =>
        capability !== undefined &&
        !isModelDisplaySurfaceCompatible(capability, surface)
    )
  ) {
    return undefined;
  }

  return surfaces;
}

function hasCompatibleModelDisplaySurfaces(
  capability: ModelCapability,
  surfaces: ModelDisplaySurface[]
): boolean {
  return surfaces.every((surface) =>
    isModelDisplaySurfaceCompatible(capability, surface)
  );
}

function parseModelCreateRequest(body: unknown): ModelInput | undefined {
  if (
    !isRecord(body) ||
    !isNonEmptyString(body.name) ||
    !isNonEmptyString(body.modelId)
  ) {
    return undefined;
  }

  const tags = parseStringArray(body.tags);
  const capability = "capability" in body ? body.capability : "chat";

  if (
    !isModelProvider(body.provider) ||
    !isModelCapability(capability) ||
    !isNonEmptyString(body.group) ||
    !tags ||
    typeof body.creditCost !== "number" ||
    !Number.isInteger(body.creditCost) ||
    body.creditCost < 0 ||
    typeof body.sortOrder !== "number" ||
    !Number.isInteger(body.sortOrder)
  ) {
    return undefined;
  }

  const imageInvokeMode = parseOptionalModelImageInvokeMode(
    body.imageInvokeMode
  );
  const imageOutputParser = parseOptionalModelImageOutputParser(
    body.imageOutputParser
  );
  const maxReferenceImages =
    "maxReferenceImages" in body ? body.maxReferenceImages : 1;

  if (
    !imageInvokeMode.valid ||
    !imageOutputParser.valid ||
    typeof maxReferenceImages !== "number" ||
    !Number.isInteger(maxReferenceImages) ||
    maxReferenceImages < 0 ||
    maxReferenceImages > 4
  ) {
    return undefined;
  }

  const displaySurfaces = parseModelDisplaySurfaces(
    body.displaySurfaces,
    capability,
    "displaySurfaces" in body
  );
  if (!displaySurfaces) {
    return undefined;
  }

  return {
    name: body.name.trim(),
    displayName:
      typeof body.displayName === "string" ? body.displayName.trim() : "",
    modelId: body.modelId.trim(),
    provider: body.provider,
    providerAccountId:
      typeof body.providerAccountId === "string" && body.providerAccountId.trim()
        ? body.providerAccountId.trim()
        : null,
    capability,
    displaySurfaces,
    imageInvokeMode: imageInvokeMode.value,
    imageOutputParser: imageOutputParser.value,
    maxReferenceImages,
    group: body.group.trim(),
    tags,
    shortDescription:
      typeof body.shortDescription === "string"
        ? body.shortDescription.trim()
        : "",
    creditCost: body.creditCost,
    allowGuest: typeof body.allowGuest === "boolean" ? body.allowGuest : true,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    isRecommended:
      typeof body.isRecommended === "boolean" ? body.isRecommended : false,
    sortOrder: body.sortOrder,
    iconUrl:
      typeof body.iconUrl === "string" ? body.iconUrl.trim() : undefined,
    iconText:
      typeof body.iconText === "string" ? body.iconText.trim() : undefined,
    iconColor:
      typeof body.iconColor === "string" ? body.iconColor.trim() : undefined
  };
}

function parseOptionalModelImageInvokeMode(
  value: unknown
): { valid: true; value?: ModelImageInvokeMode } | { valid: false } {
  if (value === undefined || value === null || value === "") {
    return { valid: true };
  }

  const normalized = normalizeModelImageInvokeMode(value);

  return normalized ? { valid: true, value: normalized } : { valid: false };
}

function parseOptionalModelImageOutputParser(
  value: unknown
): { valid: true; value?: ModelImageOutputParser } | { valid: false } {
  if (value === undefined || value === null || value === "") {
    return { valid: true };
  }

  const normalized = normalizeModelImageOutputParser(value);

  return normalized ? { valid: true, value: normalized } : { valid: false };
}

function parseModelUpdateRequest(body: unknown) {
  if (!isRecord(body)) {
    return undefined;
  }

  const update: {
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
  } = {};

  if ("name" in body) {
    if (!isNonEmptyString(body.name)) {
      return undefined;
    }
    update.name = body.name.trim();
  }

  if ("displayName" in body) {
    if (typeof body.displayName !== "string") {
      return undefined;
    }
    update.displayName = body.displayName.trim();
  }

  if ("modelId" in body) {
    if (!isNonEmptyString(body.modelId)) {
      return undefined;
    }
    update.modelId = body.modelId.trim();
  }

  if ("provider" in body) {
    if (!isModelProvider(body.provider)) {
      return undefined;
    }
    update.provider = body.provider;
  }

  if ("providerAccountId" in body) {
    if (body.providerAccountId !== null && typeof body.providerAccountId !== "string") {
      return undefined;
    }
    update.providerAccountId =
      typeof body.providerAccountId === "string" && body.providerAccountId.trim()
        ? body.providerAccountId.trim()
        : null;
  }

  if ("capability" in body) {
    if (!isModelCapability(body.capability)) {
      return undefined;
    }
    update.capability = body.capability;
  }

  if ("displaySurfaces" in body) {
    const displaySurfaces = parseModelDisplaySurfaces(
      body.displaySurfaces,
      update.capability,
      true
    );
    if (!displaySurfaces) {
      return undefined;
    }
    update.displaySurfaces = displaySurfaces;
  }

  if ("imageInvokeMode" in body) {
    const imageInvokeMode = parseOptionalModelImageInvokeMode(
      body.imageInvokeMode
    );

    if (!imageInvokeMode.valid) {
      return undefined;
    }

    if (imageInvokeMode.value) {
      update.imageInvokeMode = imageInvokeMode.value;
    }
  }

  if ("imageOutputParser" in body) {
    const imageOutputParser = parseOptionalModelImageOutputParser(
      body.imageOutputParser
    );

    if (!imageOutputParser.valid) {
      return undefined;
    }

    if (imageOutputParser.value) {
      update.imageOutputParser = imageOutputParser.value;
    }
  }

  if ("maxReferenceImages" in body) {
    if (
      typeof body.maxReferenceImages !== "number" ||
      !Number.isInteger(body.maxReferenceImages) ||
      body.maxReferenceImages < 0 ||
      body.maxReferenceImages > 4
    ) {
      return undefined;
    }
    update.maxReferenceImages = body.maxReferenceImages;
  }

  if ("group" in body) {
    if (!isNonEmptyString(body.group)) {
      return undefined;
    }
    update.group = body.group.trim();
  }

  if ("tags" in body) {
    const tags = parseStringArray(body.tags);

    if (!tags) {
      return undefined;
    }

    update.tags = tags;
  }

  if ("shortDescription" in body) {
    update.shortDescription = isNonEmptyString(body.shortDescription)
      ? body.shortDescription.trim()
      : "";
  }

  if ("isRecommended" in body) {
    if (typeof body.isRecommended !== "boolean") {
      return undefined;
    }
    update.isRecommended = body.isRecommended;
  }

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return undefined;
    }
    update.enabled = body.enabled;
  }

  if ("creditCost" in body) {
    if (
      typeof body.creditCost !== "number" ||
      !Number.isInteger(body.creditCost) ||
      body.creditCost < 0
    ) {
      return undefined;
    }
    update.creditCost = body.creditCost;
  }

  if ("allowGuest" in body) {
    if (typeof body.allowGuest !== "boolean") {
      return undefined;
    }
    update.allowGuest = body.allowGuest;
  }

  if ("sortOrder" in body) {
    if (
      typeof body.sortOrder !== "number" ||
      !Number.isInteger(body.sortOrder)
    ) {
      return undefined;
    }
    update.sortOrder = body.sortOrder;
  }

  if ("iconUrl" in body) {
    if (typeof body.iconUrl !== "string" && body.iconUrl !== null) {
      return undefined;
    }
    update.iconUrl = typeof body.iconUrl === "string" ? body.iconUrl.trim() : "";
  }

  if ("iconText" in body) {
    if (typeof body.iconText !== "string" && body.iconText !== null) {
      return undefined;
    }
    update.iconText = typeof body.iconText === "string" ? body.iconText.trim() : "";
  }

  if ("iconColor" in body) {
    if (typeof body.iconColor !== "string" && body.iconColor !== null) {
      return undefined;
    }
    update.iconColor = typeof body.iconColor === "string" ? body.iconColor.trim() : "";
  }

  return update;
}

function parseModelRouteCreateRequest(body: unknown): AiModelRouteInput | undefined {
  if (
    !isRecord(body) ||
    !isNonEmptyString(body.modelId) ||
    !isNonEmptyString(body.providerId) ||
    !isNonEmptyString(body.upstreamModel)
  ) {
    return undefined;
  }

  if (
    "priority" in body &&
    (typeof body.priority !== "number" || !Number.isInteger(body.priority))
  ) {
    return undefined;
  }

  const providerAccountId = body.providerId.trim();

  return {
    modelId: body.modelId.trim(),
    providerId: providerAccountId,
    upstreamModel: body.upstreamModel.trim(),
    priority: typeof body.priority === "number" ? body.priority : 0,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true
  };
}

function parseModelRouteUpdateRequest(body: unknown) {
  if (!isRecord(body)) {
    return undefined;
  }

  const update: Partial<Omit<AiModelRouteInput, "modelId">> = {};

  if ("providerId" in body) {
    if (!isNonEmptyString(body.providerId)) {
      return undefined;
    }
    const providerAccountId = body.providerId.trim();
    update.providerId = providerAccountId;
  }

  if ("upstreamModel" in body) {
    if (!isNonEmptyString(body.upstreamModel)) {
      return undefined;
    }
    update.upstreamModel = body.upstreamModel.trim();
  }

  if ("priority" in body) {
    if (
      typeof body.priority !== "number" ||
      !Number.isInteger(body.priority)
    ) {
      return undefined;
    }
    update.priority = body.priority;
  }

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return undefined;
    }
    update.enabled = body.enabled;
  }

  return Object.keys(update).length > 0 ? update : undefined;
}

const moderationRouteCreateKeys = new Set([
  "providerAccountId",
  "upstreamModel",
  "endpointPath",
  "priority",
  "enabled",
  "timeoutMs",
  "supportsText",
  "supportsImage"
]);

function hasOnlyModerationRouteKeys(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) => moderationRouteCreateKeys.has(key));
}

function parseModerationRouteCreateRequest(
  body: unknown
): Omit<ModerationRoute, "id"> | undefined {
  if (
    !isRecord(body) ||
    !hasOnlyModerationRouteKeys(body) ||
    !isNonEmptyString(body.providerAccountId)
  ) {
    return undefined;
  }

  for (const key of ["upstreamModel", "endpointPath"] as const) {
    if (key in body && !isNonEmptyString(body[key])) {
      return undefined;
    }
  }
  if (
    ("priority" in body &&
      (typeof body.priority !== "number" || !Number.isSafeInteger(body.priority))) ||
    ("enabled" in body && typeof body.enabled !== "boolean") ||
    ("timeoutMs" in body &&
      body.timeoutMs !== null &&
      (typeof body.timeoutMs !== "number" ||
        !Number.isSafeInteger(body.timeoutMs))) ||
    ("supportsText" in body && typeof body.supportsText !== "boolean") ||
    ("supportsImage" in body && typeof body.supportsImage !== "boolean")
  ) {
    return undefined;
  }

  return {
    providerAccountId: body.providerAccountId.trim(),
    upstreamModel:
      typeof body.upstreamModel === "string"
        ? body.upstreamModel.trim()
        : "omni-moderation-latest",
    endpointPath:
      typeof body.endpointPath === "string"
        ? body.endpointPath.trim()
        : "/v1/moderations",
    priority: typeof body.priority === "number" ? body.priority : 1,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    timeoutMs: body.timeoutMs === undefined ? null : body.timeoutMs as number | null,
    supportsText: typeof body.supportsText === "boolean" ? body.supportsText : true,
    supportsImage: typeof body.supportsImage === "boolean" ? body.supportsImage : true
  };
}

function parseModerationRouteUpdateRequest(
  body: unknown
): Partial<Omit<ModerationRoute, "id">> | undefined {
  if (!isRecord(body) || !hasOnlyModerationRouteKeys(body)) {
    return undefined;
  }

  const update: Partial<Omit<ModerationRoute, "id">> = {};
  if ("providerAccountId" in body) {
    if (!isNonEmptyString(body.providerAccountId)) {
      return undefined;
    }
    update.providerAccountId = body.providerAccountId.trim();
  }
  if ("upstreamModel" in body) {
    if (!isNonEmptyString(body.upstreamModel)) {
      return undefined;
    }
    update.upstreamModel = body.upstreamModel.trim();
  }
  if ("endpointPath" in body) {
    if (!isNonEmptyString(body.endpointPath)) {
      return undefined;
    }
    update.endpointPath = body.endpointPath.trim();
  }
  if ("priority" in body) {
    if (typeof body.priority !== "number" || !Number.isSafeInteger(body.priority)) {
      return undefined;
    }
    update.priority = body.priority;
  }
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return undefined;
    }
    update.enabled = body.enabled;
  }
  if ("timeoutMs" in body) {
    if (
      body.timeoutMs !== null &&
      (typeof body.timeoutMs !== "number" || !Number.isSafeInteger(body.timeoutMs))
    ) {
      return undefined;
    }
    update.timeoutMs = body.timeoutMs as number | null;
  }
  if ("supportsText" in body) {
    if (typeof body.supportsText !== "boolean") {
      return undefined;
    }
    update.supportsText = body.supportsText;
  }
  if ("supportsImage" in body) {
    if (typeof body.supportsImage !== "boolean") {
      return undefined;
    }
    update.supportsImage = body.supportsImage;
  }

  return Object.keys(update).length > 0 ? update : undefined;
}

function parseModerationSettingsEnabledUpdate(
  body: unknown
): boolean | undefined {
  return isRecord(body) && Object.keys(body).length === 1 &&
    typeof body.enabled === "boolean"
    ? body.enabled
    : undefined;
}

function parseModerationInputCacheSettingsRequest(
  body: unknown
): ModerationInputCacheSettings | undefined {
  try {
    return normalizeModerationInputCacheSettings(body);
  } catch {
    return undefined;
  }
}

function parseModerationRouteCircuitBreakerSettingsRequest(
  body: unknown
): ModerationRouteCircuitBreakerSettings | undefined {
  try {
    return normalizeModerationRouteCircuitBreakerSettings(body);
  } catch {
    return undefined;
  }
}

const editableSettingKeys = new Set([
  "siteName",
  "siteLogoText",
  "siteLogoUrl",
  "siteFaviconUrl",
  "workspaceIconUrl",
  "siteAnnouncement",
  "publicNotice",
  "publicNoticeEnabled",
  "contactEmail",
  "defaultModel",
  TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.modelId,
  TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.costCredits,
  TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.dailyBudgetCredits,
  "aiBaseUrl",
  "guestModeEnabled",
  "guestRateLimitEnabled",
  "registrationEnabled",
  "registrationClosedMessageZh",
  "registrationClosedMessageEn",
  "registrationEmailPolicyEnabled",
  "registrationEmailPolicyMode",
  "registrationAllowedDomainsJson",
  "registrationBlockedDomainsJson",
  "maintenanceModeEnabled",
  "maintenanceMessage",
  "guestDailyLimit",
  "guestPerModelHourlyLimit",
  "guestBurstLimit",
  "guestBurstWindowSeconds",
  "profileRateLimitEnabled",
  "nicknameUpdateDailyLimit",
  "avatarUpdateDailyLimit",
  "referenceImageRateLimitEnabled",
  "referenceImageDailyLimit",
  "guestChatConcurrencyLimit",
  "userChatConcurrencyLimit",
  "imageGenerationConcurrencyLimit",
  "homeHeroTitle",
  "homeHeroSubtitle",
  "homePrimaryCta",
  "homeSecondaryCta",
  "betaNotice",
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
  "paymentMethods",
  "contactDescription",
  "contactWechat",
  "contactPublicAccount",
  "contactCommunityUrl",
  "contactQrImageUrl",
  "contactNotes",
  "contactExternalLinks"
  ,"storagePackageEnabled"
  ,"storagePackagePriceCredits"
  ,"storagePackageDurationDays"
  ,"storagePackageAutoRenewEnabled"
  ,"storagePackageDescription"
  ,"checkInEnabled"
  ,"checkInDailyRewardCredits"
  ,"checkInStreakRewards"
  ,"referralEnabled"
  ,"referralInviterRewardCredits"
  ,"referralInviteeRewardCredits"
  ,"referralRewardTrigger"
  ,"referralRulesText",
  "helpContentJson"
]);

const publicSettingKeys = new Set([
  "siteName",
  "siteLogoText",
  "siteLogoUrl",
  "siteFaviconUrl",
  "workspaceIconUrl",
  "siteAnnouncement",
  "publicNotice",
  "publicNoticeEnabled",
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
  "homePrimaryCta",
  "homeSecondaryCta",
  "betaNotice",
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
  "contactExternalLinks"
  ,"storagePackageEnabled"
  ,"storagePackagePriceCredits"
  ,"storagePackageDurationDays"
  ,"storagePackageAutoRenewEnabled"
  ,"storagePackageDescription"
  ,"checkInEnabled"
  ,"checkInDailyRewardCredits"
  ,"checkInStreakRewards"
  ,"referralEnabled"
  ,"referralInviterRewardCredits"
  ,"referralInviteeRewardCredits"
  ,"referralRewardTrigger"
  ,"referralRulesText",
  "helpContentJson"
]);

const forbiddenSettingKeys = new Set([
  "aiApiKey",
  "AI_API_KEY",
  "JWT_SECRET",
  "DATABASE_URL",
  "SUB2API_KEY",
  "SUB2API_API_KEY",
  "SUB2API_BASE_URL"
]);

function isSettingValueType(value: unknown): value is SiteSettingValueType {
  return (
    value === "string" ||
    value === "boolean" ||
    value === "number" ||
    value === "json"
  );
}

function isTitleCoverVisualBriefSettingKey(
  key: string
): key is (typeof TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS)[keyof typeof TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS] {
  return (
    key === TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.modelId ||
    key === TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.costCredits ||
    key === TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.dailyBudgetCredits
  );
}

function validateTitleCoverVisualBriefSettingInput(setting: {
  key: string;
  value: string;
  type: SiteSettingValueType;
}): void {
  if (!isTitleCoverVisualBriefSettingKey(setting.key)) {
    return;
  }

  if (setting.key === TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.modelId) {
    if (
      setting.type !== "string" ||
      setting.value.trim().length === 0 ||
      Array.from(setting.value.trim()).length > 128
    ) {
      throw new Error("INVALID_TITLE_COVER_BRIEF_SETTING");
    }
    return;
  }

  const value = parseStrictSettingInteger(setting.value);
  if (
    setting.type !== "number" ||
    value === null ||
    value < 1 ||
    (setting.key === TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.costCredits &&
      value > 100_000)
  ) {
    throw new Error("INVALID_TITLE_COVER_BRIEF_SETTING");
  }
}

function parseSettingsPatchRequest(
  body: unknown
): SiteSettingUpdateInput[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.settings)) {
    return undefined;
  }

  const settings: SiteSettingUpdateInput[] = [];
  const submittedValues = new Map<string, string>();

  for (const setting of body.settings) {
    if (!isRecord(setting) || !isNonEmptyString(setting.key)) {
      return undefined;
    }

    const key = setting.key.trim();

    if (
      forbiddenSettingKeys.has(key.toUpperCase()) ||
      !editableSettingKeys.has(key)
    ) {
      throw new Error("SETTING_KEY_NOT_ALLOWED");
    }

    if (!isSettingValueType(setting.type)) {
      return undefined;
    }

    if (typeof setting.value !== "string") {
      return undefined;
    }

    validateTitleCoverVisualBriefSettingInput({
      key,
      value: setting.value,
      type: setting.type
    });

    submittedValues.set(key, setting.value);

    if (
      (key === "registrationEnabled" || key === "registrationEmailPolicyEnabled") &&
      setting.value !== "true" &&
      setting.value !== "false"
    ) {
      throw new Error("INVALID_REGISTRATION_SETTING");
    }

    if (
      key === "guestRateLimitEnabled" &&
      (setting.type !== "boolean" ||
        (setting.value !== "true" && setting.value !== "false"))
    ) {
      throw new Error("INVALID_GUEST_RATE_LIMIT_SETTING");
    }

    if (
      key === "profileRateLimitEnabled" &&
      (setting.type !== "boolean" ||
        (setting.value !== "true" && setting.value !== "false"))
    ) {
      throw new Error("INVALID_PROFILE_RATE_LIMIT_SETTING");
    }

    if (
      key === "referenceImageRateLimitEnabled" &&
      (setting.type !== "boolean" ||
        (setting.value !== "true" && setting.value !== "false"))
    ) {
      throw new Error("INVALID_REFERENCE_IMAGE_RATE_LIMIT_SETTING");
    }

    if (key === "referenceImageDailyLimit") {
      const value = parseStrictSettingInteger(setting.value);
      if (
        setting.type !== "number" ||
        value === null ||
        value < 1 ||
        value > 200
      ) {
        throw new Error("INVALID_REFERENCE_IMAGE_RATE_LIMIT_SETTING");
      }
    }

    const profileRateLimitNumberRanges: Record<
      "nicknameUpdateDailyLimit" | "avatarUpdateDailyLimit",
      readonly [number, number]
    > = {
      nicknameUpdateDailyLimit: [1, 20],
      avatarUpdateDailyLimit: [1, 50]
    };
    const profileRateLimitRange =
      profileRateLimitNumberRanges[
        key as "nicknameUpdateDailyLimit" | "avatarUpdateDailyLimit"
      ];
    if (profileRateLimitRange) {
      const value = parseStrictSettingInteger(setting.value);
      if (
        setting.type !== "number" ||
        value === null ||
        value < profileRateLimitRange[0] ||
        value > profileRateLimitRange[1]
      ) {
        throw new Error("INVALID_PROFILE_RATE_LIMIT_SETTING");
      }
    }

    const guestRateLimitNumberRanges: Record<string, readonly [number, number]> = {
      guestDailyLimit: [1, 1000],
      guestPerModelHourlyLimit: [1, 100],
      guestBurstLimit: [1, 20],
      guestBurstWindowSeconds: [1, 300]
    };
    const guestRateLimitRange = guestRateLimitNumberRanges[key];
    if (guestRateLimitRange) {
      const value = Number(setting.value);
      if (
        setting.type !== "number" ||
        !Number.isInteger(value) ||
        value < guestRateLimitRange[0] ||
        value > guestRateLimitRange[1]
      ) {
        throw new Error("INVALID_GUEST_RATE_LIMIT_SETTING");
      }
    }

    const concurrencyRanges: Record<ConcurrencySettingKey, readonly [number, number]> = {
      guestChatConcurrencyLimit: [1, 5],
      userChatConcurrencyLimit: [1, 10],
      imageGenerationConcurrencyLimit: [1, 5]
    };
    const concurrencyRange = concurrencyRanges[key as ConcurrencySettingKey];
    if (concurrencyRange) {
      const value = parseStrictSettingInteger(setting.value);
      if (
        setting.type !== "number" ||
        value === null ||
        value < concurrencyRange[0] ||
        value > concurrencyRange[1]
      ) {
        throw new Error("INVALID_CONCURRENCY_SETTING");
      }
    }

    if (
      key === "registrationEmailPolicyMode" &&
      !["ALL", "ALLOWLIST", "DENYLIST"].includes(setting.value)
    ) {
      throw new Error("INVALID_REGISTRATION_SETTING");
    }

    if (
      (key === "registrationClosedMessageZh" || key === "registrationClosedMessageEn") &&
      setting.value.length > 200
    ) {
      throw new Error("INVALID_REGISTRATION_SETTING");
    }

    if (
      key === "registrationAllowedDomainsJson" ||
      key === "registrationBlockedDomainsJson"
    ) {
      try {
        parseDomainListSetting(setting.value);
      } catch {
        throw new Error("INVALID_REGISTRATION_DOMAIN_LIST");
      }
    }

    if (
      key === "homeFeatureCards" &&
      !isValidHomeFeatureCardsSetting(setting.value)
    ) {
      throw new Error("INVALID_HOME_FEATURE_CARDS");
    }

    if (
      key === "workspacePromptCards" &&
      !isValidPromptCardsSetting(setting.value)
    ) {
      throw new Error("INVALID_WORKSPACE_PROMPT_CARDS");
    }

    if (
      key === "imagePromptCards" &&
      !isValidImagePromptCardsSetting(setting.value)
    ) {
      throw new Error("INVALID_IMAGE_PROMPT_CARDS");
    }

    if (
      key === "helpContentJson" &&
      !isValidHelpContentJsonSetting(setting.value)
    ) {
      throw new Error("INVALID_HELP_CONTENT_JSON");
    }

    if (
      (key === "siteLogoUrl" ||
        key === "siteFaviconUrl" ||
        key === "workspaceIconUrl" ||
        key === "contactQrImageUrl" ||
        key === "contactCommunityUrl") &&
      !isSafePublicAssetUrl(setting.value)
    ) {
      throw new Error("INVALID_PUBLIC_ASSET_URL");
    }

    if (key === "footerLinksJson" && !isValidFooterLinksSetting(setting.value)) {
      throw new Error("INVALID_FOOTER_LINKS_JSON");
    }

    if (key === "contactExternalLinks" && !isValidContactExternalLinks(setting.value)) {
      throw new Error("INVALID_CONTACT_EXTERNAL_LINKS");
    }

    if (
      [
        "storagePackagePriceCredits",
        "checkInDailyRewardCredits",
        "referralInviterRewardCredits",
        "referralInviteeRewardCredits"
      ].includes(key)
    ) {
      const value = Number(setting.value);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("INVALID_ACCOUNT_BENEFIT_NUMBER");
      }
    }

    if (key === "storagePackageDurationDays") {
      const value = Number(setting.value);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("INVALID_ACCOUNT_BENEFIT_DURATION");
      }
    }

    if (key === "checkInStreakRewards" && parseStreakRewards(setting.value) === null) {
      throw new Error("INVALID_CHECK_IN_STREAK_REWARDS");
    }

    settings.push({
      key,
      value: setting.value,
      type: setting.type,
      description:
        typeof setting.description === "string"
          ? setting.description
          : undefined
    });
  }

  if (
    submittedValues.get("registrationEmailPolicyEnabled") === "true" &&
    submittedValues.get("registrationEmailPolicyMode") === "ALLOWLIST" &&
    submittedValues.has("registrationAllowedDomainsJson") &&
    parseDomainListSetting(submittedValues.get("registrationAllowedDomainsJson")!).length === 0
  ) {
    throw new Error("EMPTY_REGISTRATION_ALLOWLIST");
  }

  return settings;
}

function isSafePublicAssetUrl(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed) {
    return true;
  }

  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("//");
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function parseProfileNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const characterCount = Array.from(trimmed).length;
  if (
    characterCount < 2 ||
    characterCount > 30 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function isSafeAvatarUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidAvatarDataUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const dataUrl = value.trim();
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(
    dataUrl
  );
  const encoded = match?.[2];
  if (!encoded || encoded.length % 4 !== 0) return false;

  const decoded = Buffer.from(encoded, "base64");
  return (
    decoded.length > 0 &&
    decoded.length <= MAX_AVATAR_DATA_URL_BYTES &&
    decoded.toString("base64") === encoded
  );
}

function isValidFooterLinksSetting(value: string): boolean {
  const raw = value.trim();

  if (!raw) {
    return true;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    return (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          isRecord(item) &&
          typeof item.label === "string" &&
          item.label.trim().length > 0 &&
          typeof item.href === "string" &&
          isSafePublicAssetUrl(item.href)
      )
    );
  } catch {
    return false;
  }
}

function isValidContactExternalLinks(value: string): boolean {
  const raw = value.trim();

  if (!raw) {
    return true;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    return (
      Array.isArray(parsed) &&
      parsed.length <= 6 &&
      parsed.every((item) => {
        if (!isRecord(item)) return false;
        const label = typeof item.label === "string" ? item.label.trim() : "";
        const url = typeof item.url === "string" ? item.url.trim() : "";
        return (
          label.length > 0 &&
          label.length <= 50 &&
          url.length > 0 &&
          url.length <= 1024 &&
          isSafePublicAssetUrl(url)
        );
      })
    );
  } catch {
    return false;
  }
}

function isValidHomeFeatureCardsSetting(value: string): boolean {
  const raw = value.trim();

  if (!raw) {
    return true;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    return (
      Array.isArray(parsed) &&
      parsed.every((item) => {
        if (typeof item === "string") {
          return item.trim().length > 0;
        }

        if (!isRecord(item)) {
          return false;
        }

        return (
          typeof item.title === "string" &&
          item.title.trim().length > 0 &&
          (!("description" in item) ||
            typeof item.description === "string")
        );
      })
    );
  } catch {
    return false;
  }
}

function isValidPromptCardsSetting(value: string): boolean {
  const raw = value.trim();

  if (!raw) {
    return true;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    return (
      Array.isArray(parsed) &&
      parsed.every((item) => {
        if (!isRecord(item)) {
          return false;
        }

        return (
          typeof item.title === "string" &&
          item.title.trim().length > 0 &&
          typeof item.description === "string" &&
          item.description.trim().length > 0 &&
          typeof item.prompt === "string" &&
          item.prompt.trim().length > 0
        );
      })
    );
  } catch {
    return false;
  }
}

function isValidHelpContentJsonSetting(value: string): boolean {
  const raw = value.trim();

  if (!raw) {
    return true;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return false;
    }

    const locales = ["zh-CN", "en-US"] as const;

    for (const locale of locales) {
      const lc = (parsed as Record<string, unknown>)[locale];
      if (!lc || typeof lc !== "object" || Array.isArray(lc)) {
        continue;
      }

      const content = lc as Record<string, unknown>;

      if ("title" in content && typeof content.title !== "string" && content.title !== undefined) {
        return false;
      }

      if ("overviewCards" in content) {
        if (!Array.isArray(content.overviewCards)) {
          return false;
        }
      }

      if ("quickStart" in content) {
        if (!Array.isArray(content.quickStart)) {
          return false;
        }
      }

      if ("serviceCards" in content) {
        if (!Array.isArray(content.serviceCards)) {
          return false;
        }
      }

      if ("faqs" in content) {
        if (!Array.isArray(content.faqs)) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

function insufficientCreditsMessage(creditCost: number): string {
  return `额度不足，当前模型每次需要 ${creditCost} 额度`;
}

function parseOrderStatus(value: unknown): OrderStatus | undefined {
  return value === "PAID" || value === "CANCELLED" || value === "PENDING"
    ? value
    : undefined;
}

function parseUserRole(value: unknown): UserRole | undefined {
  return value === "ADMIN" || value === "USER" ? value : undefined;
}

function parseUsageLogStatus(value: unknown): UsageLogStatus | undefined {
  return value === "SUCCESS" || value === "FAILED" ? value : undefined;
}

function parseAiTaskTypeFilter(value: unknown): AiTaskType | undefined {
  return aiTaskTypes.includes(value as AiTaskType)
    ? (value as AiTaskType)
    : undefined;
}

function parseAiTaskStatusFilter(value: unknown): AiTaskStatus | undefined {
  return aiTaskStatuses.includes(value as AiTaskStatus)
    ? (value as AiTaskStatus)
    : undefined;
}

function parseAiAssetTypeFilter(value: unknown): AiAssetType | undefined {
  return aiAssetTypes.includes(value as AiAssetType)
    ? (value as AiAssetType)
    : undefined;
}

function parsePaymentTypeFilter(value: unknown): "alipay" | "wxpay" | undefined {
  return value === "alipay" || value === "wxpay" ? value : undefined;
}

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isCanvasDocumentState(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    !Array.isArray(value) &&
    (value.schemaVersion === 1 || value.schemaVersion === 2);
}

function parseCanvasDocumentTitle(
  value: unknown
): { ok: true; title: string | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, title: null };
  }
  if (typeof value !== "string" || value.trim().length > 200) {
    return { ok: false };
  }
  const title = value.trim();
  return { ok: true, title: title || null };
}

function parseCanvasDocumentExpectedRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function searchParamValue(
  searchParams: URLSearchParams,
  key: string
): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function getBearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function resolveChatRequestId(request: FastifyRequest): string {
  const requestId = request.id.trim();
  return requestId.length > 0 && requestId.length <= 191
    ? requestId
    : randomBytes(16).toString("hex");
}

const PRIVATE_ASSET_CONTENT_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp"
]);
const PRIVATE_VIDEO_CONTENT_MIME_TYPES = new Set<string>(["video/mp4"]);

type ReadyLocalPrivateImageStorageObject = StorageObjectRecord & {
  mimeType: GeneratedAssetMimeType;
  sizeBytes: number;
  sha256: string;
};

function normalizeAssetContentId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPrivateAssetContentMimeType(
  value: string | null
): value is GeneratedAssetMimeType {
  return (
    value !== null &&
    PRIVATE_ASSET_CONTENT_MIME_TYPES.has(value)
  );
}

function isPrivateVideoContentMimeType(
  value: string | null
): value is "video/mp4" {
  return value !== null && PRIVATE_VIDEO_CONTENT_MIME_TYPES.has(value);
}

function isReadyLocalPrivateImageStorageObject(
  storageObject: StorageObjectRecord,
  authenticatedUserId: string,
  expectedStorageObjectId: string,
  expectedSource: StorageObjectSource
): storageObject is ReadyLocalPrivateImageStorageObject {
  return (
    storageObject.id === expectedStorageObjectId &&
    storageObject.userId === authenticatedUserId &&
    storageObject.status === StorageObjectStatus.READY &&
    storageObject.storageProvider === StorageProvider.LOCAL &&
    storageObject.source === expectedSource &&
    storageObject.deletedAt === null &&
    isPrivateAssetContentMimeType(storageObject.mimeType) &&
    storageObject.sizeBytes !== null &&
    Number.isSafeInteger(storageObject.sizeBytes) &&
    storageObject.sizeBytes > 0 &&
    storageObject.sha256 !== null &&
    /^[0-9a-f]{64}$/u.test(storageObject.sha256) &&
    typeof storageObject.objectKey === "string" &&
    storageObject.objectKey.trim().length > 0
  );
}

function isReadyLocalGeneratedImageStorageObject(
  storageObject: StorageObjectRecord,
  authenticatedUserId: string,
  expectedStorageObjectId: string
): storageObject is ReadyLocalPrivateImageStorageObject {
  return isReadyLocalPrivateImageStorageObject(
    storageObject,
    authenticatedUserId,
    expectedStorageObjectId,
    StorageObjectSource.GENERATED
  );
}

function isReadyLocalGeneratedVideoStorageObject(
  storageObject: StorageObjectRecord,
  authenticatedUserId: string,
  expectedStorageObjectId: string
): storageObject is ReadyLocalPrivateImageStorageObject & {
  mimeType: "video/mp4";
} {
  return (
    storageObject.id === expectedStorageObjectId &&
    storageObject.userId === authenticatedUserId &&
    storageObject.status === StorageObjectStatus.READY &&
    storageObject.storageProvider === StorageProvider.LOCAL &&
    storageObject.source === StorageObjectSource.GENERATED &&
    storageObject.deletedAt === null &&
    isPrivateVideoContentMimeType(storageObject.mimeType) &&
    storageObject.sizeBytes !== null &&
    Number.isSafeInteger(storageObject.sizeBytes) &&
    storageObject.sizeBytes > 0 &&
    storageObject.sha256 !== null &&
    /^[0-9a-f]{64}$/u.test(storageObject.sha256) &&
    typeof storageObject.objectKey === "string" &&
    storageObject.objectKey.trim().length > 0
  );
}

type ParsedByteRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "range"; start: number; end: number };

function parseVideoByteRange(
  value: unknown,
  sizeBytes: number
): ParsedByteRange {
  if (value === undefined) {
    return { kind: "none" };
  }
  if (
    typeof value !== "string" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return { kind: "invalid" };
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    return { kind: "invalid" };
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "") {
    const suffixLength = Number(endText);
    if (
      !Number.isSafeInteger(suffixLength) ||
      suffixLength <= 0
    ) {
      return { kind: "invalid" };
    }
    return {
      kind: "range",
      start: Math.max(0, sizeBytes - suffixLength),
      end: sizeBytes - 1
    };
  }

  const start = Number(startText);
  const requestedEnd = endText === "" ? sizeBytes - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= sizeBytes
  ) {
    return { kind: "invalid" };
  }

  return {
    kind: "range",
    start,
    end: Math.min(requestedEnd, sizeBytes - 1)
  };
}

function isReadyLocalAvatarStorageObject(
  storageObject: StorageObjectRecord,
  authenticatedUserId: string,
  expectedStorageObjectId: string
): storageObject is ReadyLocalPrivateImageStorageObject {
  return isReadyLocalPrivateImageStorageObject(
    storageObject,
    authenticatedUserId,
    expectedStorageObjectId,
    StorageObjectSource.UPLOAD
  );
}

function latestUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find((message) => message.role === "user");
}

function createSessionTitle(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  const hasCjk = /[\u3400-\u9fff]/.test(compact);
  const maxLength = hasCjk ? 20 : 40;

  return compact.length > maxLength
    ? compact.slice(0, maxLength)
    : compact || "新会话";
}

function summarizeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "chat completion failed";
  return message.length > 500 ? message.slice(0, 500) : message;
}

const developmentCorsOrigins = [
  "http://localhost:3000",
  "http://localhost:3001"
];

const guestLimitExceededMessage =
  "游客今日体验次数已用完，请登录后继续使用。";
const guestRateLimitDefaults = {
  enabled: true,
  dailyLimit: 10,
  perModelHourlyLimit: 5,
  burstLimit: 2,
  burstWindowSeconds: 10
} as const;

const profileRateLimitDefaults = {
  enabled: true,
  nicknameDailyLimit: 3,
  avatarDailyLimit: 5
} as const;

const referenceImageRateLimitDefaults = {
  enabled: true,
  dailyLimit: 20
} as const;

const PROFILE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFERENCE_IMAGE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_AVATAR_DATA_URL_BYTES = 2 * 1024 * 1024;

const concurrencyLimitDefaults = {
  guestChat: 1,
  userChat: 2,
  imageGeneration: 1
} as const;

interface ConcurrencyLimitSettings {
  guestChat: number;
  userChat: number;
  imageGeneration: number;
}

type ConcurrencySettingKey =
  | "guestChatConcurrencyLimit"
  | "userChatConcurrencyLimit"
  | "imageGenerationConcurrencyLimit";

interface GuestRateLimitSettings {
  enabled: boolean;
  dailyLimit: number;
  perModelHourlyLimit: number;
  burstLimit: number;
  burstWindowSeconds: number;
}

type GuestRateLimitSettingKey =
  | "guestRateLimitEnabled"
  | "guestDailyLimit"
  | "guestPerModelHourlyLimit"
  | "guestBurstLimit"
  | "guestBurstWindowSeconds";

type ProfileRateLimitSettingKey =
  | "profileRateLimitEnabled"
  | "nicknameUpdateDailyLimit"
  | "avatarUpdateDailyLimit";

type ReferenceImageRateLimitSettingKey =
  | "referenceImageRateLimitEnabled"
  | "referenceImageDailyLimit";

function parseCommaSeparatedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== "*");
}

function resolveCorsOrigins(env: Partial<NodeJS.ProcessEnv>): string[] {
  if (env.NODE_ENV === "production") {
    return parseCommaSeparatedOrigins(env.CORS_ORIGINS);
  }

  return developmentCorsOrigins;
}

function parseGuestDailyLimit(value: string | undefined): number {
  const parsed = Number(value ?? String(guestRateLimitDefaults.dailyLimit));

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000
    ? parsed
    : guestRateLimitDefaults.dailyLimit;
}

function parseSettingBoolean(value: string | null | undefined): boolean | null {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

function parseSettingNumber(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseStrictSettingInteger(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseStreakRewards(value: string | null | undefined): Record<string, number> | null {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    const entries = Object.entries(parsed);
    const result: Record<string, number> = {};
    for (const [day, reward] of entries) {
      if (!/^\d+$/.test(day) || Number(day) <= 0 || typeof reward !== "number" || !Number.isInteger(reward) || reward < 0) {
        return null;
      }
      result[day] = reward;
    }
    return result;
  } catch {
    return null;
  }
}

function resolveGuestUsageDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function resolveClientIp(request: FastifyRequest): string {
  return request.ip;
}

const emailVerificationPendingResponse = {
  status: "EMAIL_VERIFICATION_PENDING",
  message: "If the account can be verified, a verification email has been sent."
};

const emailVerificationTokenInvalidResponse = {
  code: "EMAIL_VERIFICATION_TOKEN_INVALID",
  message: "Verification token is invalid or expired."
};

const emailVerificationResendRateLimitRejection = {
  code: "EMAIL_VERIFICATION_RESEND_RATE_LIMITED",
  message: "Too many verification email requests."
};

const emailVerificationResendIpRateLimit: RateLimitPolicy = {
  limit: 10,
  windowMs: 30 * 60 * 1000
};

const emailVerificationResendEmailCooldownRateLimit: RateLimitPolicy = {
  limit: 1,
  windowMs: 5 * 60 * 1000
};

const emailVerificationResendEmailDailyRateLimit: RateLimitPolicy = {
  limit: 5,
  windowMs: 24 * 60 * 60 * 1000
};

const passwordResetPendingResponse = {
  status: "PASSWORD_RESET_PENDING"
};

const passwordResetCompleteResponse = {
  status: "PASSWORD_RESET_COMPLETE"
};

const passwordResetTokenInvalidResponse = {
  code: "PASSWORD_RESET_TOKEN_INVALID",
  message: "Password reset link is invalid or expired."
};

const passwordResetRateLimitRejection = {
  code: "PASSWORD_RESET_RATE_LIMITED",
  message: "Too many password reset requests."
};

const passwordResetConsumeRateLimitRejection = {
  code: "PASSWORD_RESET_RATE_LIMITED",
  message: "Too many password reset attempts."
};

const loginRateLimitRejection = {
  code: "AUTH_LOGIN_RATE_LIMITED",
  message: "Too many login attempts."
};

const changePasswordRateLimitRejection = {
  code: "CHANGE_PASSWORD_RATE_LIMITED",
  message: "Too many password change attempts."
};

const revokeSessionsRateLimitRejection = {
  code: "REVOKE_SESSIONS_RATE_LIMITED",
  message: "Too many session revocation attempts."
};

const passwordResetRequestIpRateLimit: RateLimitPolicy = {
  limit: 5,
  windowMs: 15 * 60 * 1000
};

const passwordResetConsumeIpRateLimit: RateLimitPolicy = {
  limit: 10,
  windowMs: 15 * 60 * 1000
};

const passwordResetRequestEmailCooldownRateLimit: RateLimitPolicy = {
  limit: 1,
  windowMs: 5 * 60 * 1000
};

const passwordResetRequestEmailDailyRateLimit: RateLimitPolicy = {
  limit: 5,
  windowMs: 24 * 60 * 60 * 1000
};

const loginEmailRateLimit: RateLimitPolicy = {
  limit: 5,
  windowMs: 15 * 60 * 1000
};

const changePasswordIpRateLimit: RateLimitPolicy = {
  limit: 10,
  windowMs: 15 * 60 * 1000
};

const changePasswordUserRateLimit: RateLimitPolicy = {
  limit: 5,
  windowMs: 15 * 60 * 1000
};

const revokeSessionsIpRateLimit: RateLimitPolicy = {
  limit: 20,
  windowMs: 15 * 60 * 1000
};

const revokeSessionsUserRateLimit: RateLimitPolicy = {
  limit: 3,
  windowMs: 15 * 60 * 1000
};

function sendEmailVerificationPending(reply: FastifyReply): FastifyReply {
  return reply
    .header("Cache-Control", "no-store")
    .code(202)
    .send(emailVerificationPendingResponse);
}

function sendEmailVerificationTokenInvalid(reply: FastifyReply): FastifyReply {
  return reply
    .header("Cache-Control", "no-store")
    .code(400)
    .send(emailVerificationTokenInvalidResponse);
}

function sendPasswordResetPending(reply: FastifyReply): FastifyReply {
  return reply.code(202).send(passwordResetPendingResponse);
}

function sendPasswordResetTokenInvalid(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(passwordResetTokenInvalidResponse);
}

function hashEmailVerificationResendEmail(
  normalizedEmail: string,
  jwtSecret: string
): string {
  return createHmac("sha256", jwtSecret)
    .update(`email-verification-resend:${normalizedEmail}`)
    .digest("hex");
}

function hashPasswordResetRequestEmail(
  normalizedEmail: string,
  jwtSecret: string
): string {
  return createHmac("sha256", jwtSecret)
    .update(`password-reset-request:${normalizedEmail}`)
    .digest("hex");
}

function hashLoginEmail(normalizedEmail: string, jwtSecret: string): string {
  return createHmac("sha256", jwtSecret)
    .update(`auth-login:${normalizedEmail}`)
    .digest("hex");
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) {
    return "UnknownError";
  }

  const name = error.name;
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)
    ? name
    : "UnknownError";
}

type VideoAssetPersistenceFailurePhase =
  | "result-download"
  | "storage-persist";

const VIDEO_ASSET_PERSISTENCE_FIXED_ERROR_CODES: ReadonlySet<string> =
  new Set([
    "VIDEO_PROVIDER_BASE_URL_INVALID",
    "VIDEO_RESULT_MIME_INVALID",
    "VIDEO_RESULT_TOO_LARGE",
    "VIDEO_RESULT_REDIRECT_LIMIT",
    "VIDEO_RESULT_REDIRECT_INVALID",
    "VIDEO_RESULT_REDIRECT_LOOP",
    "VIDEO_RESULT_HTTP_STATUS",
    "VIDEO_RESULT_SIGNATURE_INVALID"
  ]);

function safeVideoAssetPersistenceErrorCode(
  error: unknown
): string | undefined {
  let candidate: string | undefined;
  if (
    error instanceof RemoteImageFetcherError ||
    error instanceof LocalStorageObjectError ||
    error instanceof RemoteImageUrlPolicyError
  ) {
    candidate = error.code;
  } else if (
    error instanceof Error &&
    VIDEO_ASSET_PERSISTENCE_FIXED_ERROR_CODES.has(error.message)
  ) {
    candidate = error.message;
  }

  return typeof candidate === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(candidate)
    ? candidate
    : undefined;
}

function getVideoAssetPersistenceFailureErrorFields(
  error: unknown
): Record<string, unknown> {
  const errorCode = safeVideoAssetPersistenceErrorCode(error);
  const base = {
    errorType: safeErrorName(error),
    ...(errorCode === undefined ? {} : { errorCode })
  };

  if (!(error instanceof RemoteImageFetcherError)) {
    if (error instanceof RemoteImageUrlPolicyError) {
      return {
        ...base,
        policyReason: error.reason
      };
    }
    return base;
  }

  const status = safeImageHttpStatus(error.status);
  const redirectCount =
    typeof error.redirectCount === "number" &&
    Number.isSafeInteger(error.redirectCount) &&
    error.redirectCount >= 0
      ? error.redirectCount
      : undefined;

  return {
    ...base,
    stage: error.stage,
    ...(status === undefined ? {} : { status }),
    ...(redirectCount === undefined ? {} : { redirectCount })
  };
}

function logVideoAssetPersistenceFailure(
  logger: FastifyInstance["log"],
  taskId: string,
  phase: VideoAssetPersistenceFailurePhase,
  error: unknown
): void {
  logger.error(
    {
      event: "video-asset-persistence-failed",
      taskId,
      phase,
      ...getVideoAssetPersistenceFailureErrorFields(error)
    },
    "video asset persistence failed"
  );
}

function logVideoResultDownloadReadinessDeferred(
  logger: FastifyInstance["log"],
  taskId: string,
  timeoutRound: number,
  error: RemoteImageFetcherError
): void {
  logger.warn(
    {
      event: "video-result-download-readiness-deferred",
      taskId,
      timeoutRound,
      maxTimeoutRounds: VIDEO_RESULT_READINESS_MAX_TIMEOUT_ROUNDS,
      errorCode: error.code,
      stage: error.stage
    },
    "video result download deferred while the provider result becomes ready"
  );
}

type BestEffortAuditLogInput = Parameters<ServerStore["createAuditLog"]>[0];

function fireAndForgetAuditLog(
  request: FastifyRequest,
  store: Pick<ServerStore, "createAuditLog">,
  input: BestEffortAuditLogInput
): void {
  void store.createAuditLog(input).catch((error: unknown) => {
    const errorCode =
      isRecord(error) &&
      typeof error.code === "string" &&
      /^[A-Za-z0-9_]{1,64}$/u.test(error.code)
        ? error.code
        : undefined;

    request.log.error(
      {
        auditAction: input.action,
        auditTargetType: input.targetType,
        auditTargetId: input.targetId ?? null,
        errorType: safeErrorName(error),
        ...(errorCode ? { errorCode } : {})
      },
      "failed to write admin audit log"
    );
  });
}

async function enforceRateLimit({
  request,
  reply,
  rateLimiter,
  key,
  policy,
  routeIdentifier,
  rejection,
  unavailableRejection
}: {
  request: FastifyRequest;
  reply: FastifyReply;
  rateLimiter: RateLimiter;
  key: string;
  policy: RateLimitPolicy;
  routeIdentifier: string;
  rejection?: { code: string; message: string; retryable?: boolean };
  unavailableRejection?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}): Promise<boolean> {
  try {
    const result = await rateLimiter.consume(key, policy);
    reply.header("X-RateLimit-Limit", String(result.limit));
    reply.header("X-RateLimit-Remaining", String(result.remaining));
    if (result.allowed) return false;

    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    reply.header("Retry-After", String(retryAfterSeconds));
    reply.code(429).send({
      ...(rejection ? { code: rejection.code } : {}),
      message: rejection?.message ?? "请求过于频繁，请稍后再试",
      retryAfterSeconds,
      ...(rejection?.retryable === undefined
        ? {}
        : { retryable: rejection.retryable })
    });
    return true;
  } catch (error) {
    request.log.warn({
      route: routeIdentifier,
      errorType: error instanceof RateLimiterUnavailableError
        ? error.name
        : "RateLimiterError"
    }, "rate limiter unavailable");
    reply.code(503).send({
      code: unavailableRejection?.code ?? "RATE_LIMIT_UNAVAILABLE",
      message:
        unavailableRejection?.message ?? "服务暂时不可用，请稍后重试",
      ...(unavailableRejection
        ? { retryable: unavailableRejection.retryable }
        : {})
    });
    return true;
  }
}

/** Safe user-facing message for AI provider / upstream model failures. */
const providerErrorMessage = "模型服务暂时不可用，请稍后再试";
const imageIdempotencyFailureMessages: Record<string, string> = {
  IDEMPOTENCY_REQUEST_FAILED: "图片生成请求未完成，请使用新的幂等键重试",
  REFERENCE_IMAGE_RATE_LIMITED: "参考图片请求过于频繁，请稍后再试",
  IMAGE_TASK_START_FAILED: "图片任务启动失败，请稍后重试",
  IMAGE_TASK_COMPLETION_FAILED: "图片任务完成确认失败，请稍后重试",
  IMAGE_TASK_FAILURE_FAILED: "图片任务失败确认失败，请稍后重试",
  IMAGE_PROVIDER_FAILED: providerErrorMessage,
  IMAGE_PROVIDER_TIMEOUT: providerErrorMessage,
  IMAGE_PROVIDER_INVALID_RESPONSE: "模型服务返回了无效图片结果，请稍后重试",
  IMAGE_ASSET_PERSISTENCE_FAILED: "图片资源保存失败，请稍后重试",
  IMAGE_PROMPT_BLOCKED: "该提示词可能包含不适合生成的内容，请修改后重试。",
  IMAGE_SAFETY_CHECK_UNAVAILABLE: "内容安全检查暂时不可用，本次额度已退回。",
  IMAGE_OUTPUT_BLOCKED: "生成结果未通过安全检查，本次额度已退回。",
  IMAGE_REQUEST_COST_EXCEEDED: "图片请求成本超出允许范围",
  GLOBAL_IMAGE_BUDGET_EXHAUSTED: "图片生成服务暂时不可用，请稍后重试",
  GLOBAL_IMAGE_BUDGET_UNAVAILABLE: "图片生成服务暂时不可用，请稍后重试",
  GLOBAL_CHAT_BUDGET_EXHAUSTED: "对话服务暂时不可用，请稍后重试",
  GLOBAL_CHAT_BUDGET_UNAVAILABLE: "对话服务暂时不可用，请稍后重试",
  CHAT_ATTEMPT_COST_EXCEEDED: "请求成本超出允许范围",
  IMAGE_GENERATION_FAILED: "服务暂时不可用，请稍后再试"
};

function getImageIdempotencyFailureMessage(code: string | null): string {
  return imageIdempotencyFailureMessages[code ?? "IDEMPOTENCY_REQUEST_FAILED"] ??
    "服务暂时不可用，请稍后再试";
}

function sendImageGenerationFailure(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  extra: Record<string, unknown> = {}
): FastifyReply {
  reply.code(statusCode).send({
    message: getImageIdempotencyFailureMessage(code),
    code,
    ...extra
  });
  return reply;
}

function sendIdempotencyConflict(reply: FastifyReply): FastifyReply {
  reply.code(409).send({
    message: "该 Idempotency-Key 已用于不同的请求",
    code: "IDEMPOTENCY_KEY_CONFLICT",
    retryable: false
  });
  return reply;
}

function sendIdempotencyResultUnavailable(reply: FastifyReply): FastifyReply {
  reply.code(410).send({
    message: "幂等请求结果已不可用",
    code: "IDEMPOTENCY_RESULT_UNAVAILABLE",
    retryable: false
  });
  return reply;
}

/** Safe user-facing message for unexpected internal / database errors. */
const internalErrorMessage = "服务暂时不可用，请稍后再试";

type ChatCreditCostContract = {
  userChargeCredits: number;
  providerBudgetCredits: number;
};

function resolveChatCreditCostContract(
  creditCost: unknown
): ChatCreditCostContract | null {
  if (creditCost === 0) {
    return {
      userChargeCredits: 0,
      providerBudgetCredits: 1
    };
  }

  if (
    typeof creditCost !== "number" ||
    !Number.isSafeInteger(creditCost) ||
    creditCost < 0
  ) {
    return null;
  }

  return {
    userChargeCredits: creditCost,
    providerBudgetCredits: creditCost
  };
}

const imageModelUnavailableMessage = "image model is not available";
const referenceImagePayloadTooLargeMessage =
  "参考图过大，请压缩后重试 / Reference image is too large. Please compress it and try again.";

const videoIdempotencyFailureMessages: Record<string, string> = {
  VIDEO_GENERATION_FAILED: providerErrorMessage,
  VIDEO_PROVIDER_FAILED: providerErrorMessage,
  VIDEO_PROVIDER_TIMEOUT: providerErrorMessage,
  VIDEO_SUBMISSION_UNCERTAIN: "视频提交状态不确定，请稍后重试",
  VIDEO_PROVIDER_INVALID_RESPONSE: "模型服务返回了无效视频结果，请稍后重试",
  VIDEO_TASK_START_FAILED: "视频任务启动失败，请稍后重试",
  VIDEO_TASK_POLL_FAILED: "视频任务状态暂时不可用，请稍后重试",
  VIDEO_ASSET_PERSISTENCE_FAILED: "视频资源保存失败，请稍后重试",
  VIDEO_TASK_COMPLETION_FAILED: "视频任务完成确认失败，请稍后重试",
  VIDEO_TASK_FAILURE_FAILED: "视频任务失败确认失败，请稍后重试",
  IDEMPOTENCY_REQUEST_FAILED: "视频生成请求未完成，请使用新的幂等键重试"
};

function getVideoIdempotencyFailureMessage(code: string | null): string {
  return videoIdempotencyFailureMessages[code ?? "VIDEO_GENERATION_FAILED"] ??
    providerErrorMessage;
}

function isVideoSubmissionUncertainError(error: unknown): boolean {
  return (
    error instanceof AIProviderSubmissionUncertainError ||
    error instanceof AIProviderTimeoutError ||
    (error instanceof AIProviderRequestError && error.statusCode === undefined)
  );
}

function sendVideoGenerationFailure(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  extra: Record<string, unknown> = {}
): FastifyReply {
  return reply.code(statusCode).send({
    message: getVideoIdempotencyFailureMessage(code),
    code,
    ...extra
  });
}

function resolveVideoMaxBytes(env: Partial<NodeJS.ProcessEnv>): number {
  const configured = Number(env.VIDEO_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, DEFAULT_VIDEO_MAX_BYTES)
    : DEFAULT_VIDEO_MAX_BYTES;
}

function resolveVideoPollIntervalMs(env: Partial<NodeJS.ProcessEnv>): number {
  const configured = Number(env.VIDEO_POLL_INTERVAL_MS);
  return Number.isSafeInteger(configured) && configured >= 100
    ? Math.min(configured, 60_000)
    : VIDEO_POLL_INTERVAL_MS;
}

function resolveVideoPollAttempts(env: Partial<NodeJS.ProcessEnv>): number {
  const configured = Number(env.VIDEO_MAX_POLL_ATTEMPTS);
  return Number.isSafeInteger(configured) && configured >= 1
    ? Math.min(configured, VIDEO_MAX_POLL_ATTEMPTS)
    : VIDEO_MAX_POLL_ATTEMPTS;
}

type VideoRuntimeStatus = "submitted" | "processing" | "downloading" | "stored";

interface VideoRuntimeState {
  version: 1;
  protocol: "apimart-task-v1";
  operationId: string;
  reservationId: string;
  providerAccountId: string;
  routeId: string;
  upstreamModel: string;
  profileId: string;
  mode: "text-to-video" | "image-to-video";
  status: VideoRuntimeStatus;
  progress?: number;
  storageObjectId?: string;
  resultDownloadTimeoutRounds?: number;
}

function parseVideoRuntimeState(value: unknown): VideoRuntimeState | null {
  if (!isRecord(value)) return null;
  const requiredStrings = [
    value.operationId,
    value.reservationId,
    value.providerAccountId,
    value.routeId,
    value.upstreamModel,
    value.profileId
  ];
  if (
    value.version !== 1 ||
    value.protocol !== "apimart-task-v1" ||
    requiredStrings.some(
      (entry) => typeof entry !== "string" || entry.trim().length === 0
    ) ||
    (value.mode !== "text-to-video" && value.mode !== "image-to-video") ||
    (value.status !== "submitted" &&
      value.status !== "processing" &&
      value.status !== "downloading" &&
      value.status !== "stored")
  ) {
    return null;
  }
  if (
    value.progress !== undefined &&
    (typeof value.progress !== "number" ||
      !Number.isSafeInteger(value.progress) ||
      value.progress < 0 ||
      value.progress > 100)
  ) {
    return null;
  }
  if (
    value.storageObjectId !== undefined &&
    (typeof value.storageObjectId !== "string" ||
      value.storageObjectId.trim().length === 0)
  ) {
    return null;
  }
  if (
    value.resultDownloadTimeoutRounds !== undefined &&
    (typeof value.resultDownloadTimeoutRounds !== "number" ||
      !Number.isSafeInteger(value.resultDownloadTimeoutRounds) ||
      value.resultDownloadTimeoutRounds < 0)
  ) {
    return null;
  }

  const operationId = value.operationId as string;
  const reservationId = value.reservationId as string;
  const providerAccountId = value.providerAccountId as string;
  const routeId = value.routeId as string;
  const upstreamModel = value.upstreamModel as string;
  const profileId = value.profileId as string;
  const mode = value.mode as "text-to-video" | "image-to-video";
  const status = value.status as VideoRuntimeStatus;
  const progress =
    typeof value.progress === "number" ? value.progress : undefined;
  const storageObjectId =
    typeof value.storageObjectId === "string"
      ? value.storageObjectId
      : undefined;
  const resultDownloadTimeoutRounds =
    typeof value.resultDownloadTimeoutRounds === "number"
      ? value.resultDownloadTimeoutRounds
      : 0;

  return {
    version: 1,
    protocol: "apimart-task-v1",
    operationId,
    reservationId,
    providerAccountId,
    routeId,
    upstreamModel,
    profileId,
    mode,
    status,
    ...(progress === undefined ? {} : { progress }),
    ...(storageObjectId === undefined ? {} : { storageObjectId }),
    resultDownloadTimeoutRounds
  };
}

/**
 * Return a safe user-facing message for upstream AI errors.
 * Never exposes raw provider body, status codes, or URLs.
 */
function safeProviderErrorMessage(_raw: string): string {
  return providerErrorMessage;
}

function sanitizeTaskDetailError(task: AiTaskSummary): AiTaskSummary {
  const message = task.errorMessage;

  if (!message) {
    return task;
  }

  const looksLikeRawProviderError =
    message.startsWith("AI provider") ||
    /https?:\/\//i.test(message) ||
    /\bsk-[a-z0-9_-]+/i.test(message);

  return looksLikeRawProviderError
    ? { ...task, errorMessage: providerErrorMessage }
    : task;
}

/**
 * Redact known secret values from a string before logging or storing.
 * Covers all environment-configured secrets and tokens.
 */
function redactSecrets(
  message: string,
  env: Partial<NodeJS.ProcessEnv>,
  extraSecrets: string[] = []
): string {
  const secrets = [
    env.AI_API_KEY,
    env.JWT_SECRET,
    env.DATABASE_URL,
    env.PAYMENT_SETTINGS_SECRET,
    env.SETUP_TOKEN,
    env.SUB2API_KEY,
    env.SUB2API_API_KEY,
    process.env.EPAY_KEY,
    ...extraSecrets
  ].filter(
    (secret): secret is string => typeof secret === "string" && secret.length > 0
  );

  return secrets.reduce(
    (current, secret) =>
      current.split(secret).join("[redacted]"),
    message
  );
}

function summarizePublicError(
  error: unknown,
  env: Partial<NodeJS.ProcessEnv>
): string {
  // For AI provider errors, return safe user-facing message
  const rawMessage = summarizeError(error);
  if (rawMessage.startsWith("AI provider")) {
    return safeProviderErrorMessage(rawMessage);
  }
  // For unexpected errors, return safe internal error message
  return internalErrorMessage;
}

function isRetryableChatProviderError(error: unknown): boolean {
  if (error instanceof AIProviderAbortError) {
    return false;
  }

  if (error instanceof AIProviderTimeoutError) {
    return true;
  }

  if (error instanceof AIProviderResponseFormatError) {
    return false;
  }

  if (error instanceof AIProviderRouteUnavailableError) {
    return true;
  }

  if (error instanceof AIProviderRequestError) {
    return (
      error.statusCode === undefined ||
      [404, 408, 429, 500, 502, 503, 504].includes(error.statusCode)
    );
  }

  const rawMessage = summarizeError(error).toLowerCase();
  if (
    rawMessage.includes("content safety") ||
    rawMessage.includes("safety") ||
    rawMessage.includes("request format")
  ) {
    return false;
  }

  const routeUnavailableMessage =
    rawMessage.includes("model not found") ||
    rawMessage.includes("model does not exist") ||
    rawMessage.includes("invalid model") ||
    rawMessage.includes("no such model") ||
    rawMessage.includes("model unavailable") ||
    rawMessage.includes("model not available") ||
    rawMessage.includes("unsupported model") ||
    rawMessage.includes("upstream unavailable");

  if (routeUnavailableMessage) {
    return true;
  }

  if (
    rawMessage.includes("401") ||
    rawMessage.includes("403")
  ) {
    return false;
  }

  return (
    rawMessage.includes("timeout") ||
    rawMessage.includes("timed out") ||
    rawMessage.includes("network") ||
    rawMessage.includes("fetch failed") ||
    rawMessage.includes("econnreset") ||
    rawMessage.includes("enotfound") ||
    rawMessage.includes("404") ||
    rawMessage.includes("408") ||
    rawMessage.includes("503") ||
    rawMessage.includes("502") ||
    rawMessage.includes("504") ||
    rawMessage.includes("500") ||
    rawMessage.includes("429")
  );
}

function isProviderAccountImageUnavailable(
  account: ProviderAccountRuntime | null
): boolean {
  return (
    !account ||
    !account.enabled ||
    !account.apiKey.trim() ||
    !account.baseUrl.trim() ||
    !account.capabilities.includes("image")
  );
}

function isProviderAccountVideoUnavailable(
  account: ProviderAccountRuntime | null
): boolean {
  return (
    !account ||
    !account.enabled ||
    !account.apiKey.trim() ||
    !account.baseUrl.trim() ||
    !account.capabilities.includes("video") ||
    account.configJson?.videoProtocol !== "apimart-task-v1"
  );
}

function isProviderAccountChatUnavailable(
  account: ProviderAccountRuntime | null
): boolean {
  return (
    !account ||
    !account.enabled ||
    !account.apiKey.trim() ||
    !account.baseUrl.trim() ||
    !account.capabilities.includes("chat")
  );
}

function isOpenAICompatibleChatProviderType(
  providerType: ProviderAccountType
): boolean {
  return (
    providerType === "OPENAI_COMPATIBLE" ||
    providerType === "SUB2API" ||
    providerType === "NEW_API"
  );
}

function resolveProviderMaxTokens(
  configJson: Record<string, unknown> | null
): number | undefined {
  const value =
    configJson?.maxTokens ?? configJson?.max_tokens ?? configJson?.maxOutputTokens;

  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 4096
    ? value
    : undefined;
}

const providerAccountTestModelRequiredMessage =
  "请在 configJson 中填写 testModel，或先创建并绑定一个对应能力的模型。";
const providerAccountTestUnsupportedMessage =
  "当前供应商不支持所选测试能力。";
const providerAccountTestFailedMessage =
  "连接测试失败，请检查 Base URL、API Key、模型名或供应商格式。";
const adminDiagnosticTimeoutMessage =
  "测试超时，请检查上游服务或提高可用性后重试。";
const providerAccountTestSuccessMessage = "连接测试成功";
const globalAdminProviderTestBudgetUnavailableMessage =
  "供应商测试服务暂时不可用，请稍后重试";
const providerTestImagePrompt = "A red apple on a plain white background.";
type ProviderTestCapability = "chat" | "image";

function isProviderTestCapability(
  value: unknown
): value is ProviderTestCapability {
  return value === "chat" || value === "image";
}

function providerTestErrorCode(
  error: unknown,
  prefix: "PROVIDER_TEST" | "ROUTE_TEST"
): string {
  if (error instanceof AIProviderTimeoutError) {
    return `${prefix}_TIMEOUT`;
  }

  if (error instanceof AIProviderResponseFormatError) {
    return `${prefix}_INVALID_RESPONSE`;
  }

  return `${prefix}_REQUEST_FAILED`;
}

function adminDiagnosticErrorMessage(error: unknown, fallback: string): string {
  return error instanceof AIProviderTimeoutError
    ? adminDiagnosticTimeoutMessage
    : fallback;
}

function validProviderTestImageOutputCount(
  outputs: GeneratedImageOutput[]
): number {
  return outputs.filter((output) =>
    output.sourceType === "base64"
      ? isValidGeneratedImageBase64(output.base64)
      : isValidGeneratedImageUrl(output.url)
  ).length;
}

type ProviderAccountRequestFormat = "openai-compatible" | "anthropic";

interface ProviderAccountTestRequest {
  providerAccountId?: string;
  providerType?: ProviderAccountType;
  baseUrl?: string;
  apiKey?: string;
  headersJson?: Record<string, unknown> | null;
  configJson?: Record<string, unknown> | null;
  testModel?: string;
  requestFormat?: ProviderAccountRequestFormat;
  anthropicAuthMode?: AnthropicAuthMode;
  authHeaderMode?: AnthropicAuthMode;
  authMode?: AnthropicAuthMode;
  capabilities?: ProviderAccountCapability[];
  testCapability?: ProviderTestCapability;
  timeoutMs?: number;
}

function isProviderAccountRequestFormat(
  value: unknown
): value is ProviderAccountRequestFormat {
  return value === "openai-compatible" || value === "anthropic";
}

function getDefaultProviderAccountRequestFormat(
  providerType: ProviderAccountType
): ProviderAccountRequestFormat {
  return providerType === "ANTHROPIC" ? "anthropic" : "openai-compatible";
}

function readRequestFormatConfigValue(
  configJson: Record<string, unknown> | null | undefined
): ProviderAccountRequestFormat | undefined {
  const value =
    configJson?.requestFormat ?? configJson?.adapterFormat ?? configJson?.chatFormat;

  return isProviderAccountRequestFormat(value) ? value : undefined;
}

function resolveProviderAccountRequestFormat({
  request,
  providerAccount,
  providerType
}: {
  request?: ProviderAccountTestRequest;
  providerAccount?: ProviderAccountRuntime | null;
  providerType: ProviderAccountType;
}): ProviderAccountRequestFormat {
  return (
    request?.requestFormat ??
    readRequestFormatConfigValue(request?.configJson) ??
    readRequestFormatConfigValue(providerAccount?.configJson) ??
    getDefaultProviderAccountRequestFormat(providerType)
  );
}

function supportsNativeChatImageBatch({
  providerType,
  requestFormat,
  messagesPath
}: {
  providerType: ProviderAccountType;
  requestFormat: ProviderAccountRequestFormat;
  messagesPath: string;
}): boolean {
  return (
    providerType === "SUB2API" &&
    requestFormat === "anthropic" &&
    messagesPath === "/v1/messages"
  );
}

function isAnthropicAuthMode(value: unknown): value is AnthropicAuthMode {
  return value === "x-api-key" || value === "bearer" || value === "both";
}

function readAnthropicAuthModeConfigValue(
  configJson: Record<string, unknown> | null | undefined
): AnthropicAuthMode | undefined {
  const value =
    configJson?.anthropicAuthMode ??
    configJson?.authHeaderMode ??
    configJson?.authMode;

  return isAnthropicAuthMode(value) ? value : undefined;
}

function getDefaultAnthropicAuthMode({
  providerType,
  requestFormat
}: {
  providerType: ProviderAccountType;
  requestFormat: ProviderAccountRequestFormat;
}): AnthropicAuthMode {
  if (
    requestFormat === "anthropic" &&
    (providerType === "SUB2API" ||
      providerType === "NEW_API" ||
      providerType === "OPENAI_COMPATIBLE")
  ) {
    return "both";
  }

  return "x-api-key";
}

function resolveAnthropicAuthMode({
  request,
  providerAccount,
  providerType,
  requestFormat
}: {
  request?: ProviderAccountTestRequest;
  providerAccount?: ProviderAccountRuntime | null;
  providerType: ProviderAccountType;
  requestFormat: ProviderAccountRequestFormat;
}): AnthropicAuthMode {
  return (
    request?.authMode ??
    request?.anthropicAuthMode ??
    request?.authHeaderMode ??
    readAnthropicAuthModeConfigValue(request?.configJson) ??
    readAnthropicAuthModeConfigValue(providerAccount?.configJson) ??
    getDefaultAnthropicAuthMode({ providerType, requestFormat })
  );
}

function normalizeAnthropicMessagesPath(value: string | undefined): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return "/v1/messages";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function readAnthropicMessagesPathConfigValue(
  configJson: Record<string, unknown> | null | undefined
): string | undefined {
  return (
    readStringConfigValue(configJson, "messagesPath") ||
    readStringConfigValue(configJson, "anthropicMessagesPath")
  );
}

function resolveAnthropicMessagesPath({
  request,
  providerAccount
}: {
  request?: ProviderAccountTestRequest;
  providerAccount?: ProviderAccountRuntime | null;
}): string {
  return normalizeAnthropicMessagesPath(
    readAnthropicMessagesPathConfigValue(request?.configJson) ||
      readAnthropicMessagesPathConfigValue(providerAccount?.configJson)
  );
}

function resolveAnthropicEndpointPath({
  baseUrl,
  messagesPath
}: {
  baseUrl: string;
  messagesPath: string;
}): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  try {
    const pathname = new URL(normalizedBaseUrl).pathname;

    if (pathname.endsWith("/messages")) {
      return pathname;
    }

    if (pathname.endsWith("/v1") && messagesPath === "/v1/messages") {
      return "/v1/messages";
    }
  } catch {
    // Keep diagnostics path-only and fall through to the configured path.
  }

  return messagesPath;
}

function resolveAnthropicMessagesEndpointUrl({
  baseUrl,
  messagesPath
}: {
  baseUrl: string;
  messagesPath: string;
}): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  try {
    const pathname = new URL(normalizedBaseUrl).pathname;

    if (pathname.endsWith("/messages")) {
      return normalizedBaseUrl;
    }

    if (pathname.endsWith("/v1") && messagesPath === "/v1/messages") {
      return `${normalizedBaseUrl}/messages`;
    }
  } catch {
    // Keep request construction path-only and fall through to configured path.
  }

  return `${normalizedBaseUrl}${messagesPath}`;
}

function buildAnthropicMessagesHeaders(
  apiKey: string,
  authMode: AnthropicAuthMode,
  headersJson?: Record<string, unknown> | null
): Record<string, string> {
  const safeCustomHeaders = normalizeProviderHeaders(headersJson);
  for (const name of [
    "authorization",
    "content-type",
    "x-api-key",
    "anthropic-version"
  ]) {
    delete safeCustomHeaders[name];
  }

  return {
    ...safeCustomHeaders,
    "Content-Type": "application/json",
    ...(authMode === "x-api-key" || authMode === "both"
      ? { "x-api-key": apiKey }
      : {}),
    ...(authMode === "bearer" || authMode === "both"
      ? { Authorization: `Bearer ${apiKey}` }
      : {}),
    "anthropic-version": "2023-06-01"
  };
}

async function fetchAnthropicMessagesImageOutputs({
  fetcher,
  endpointUrl,
  endpointPath,
  apiKey,
  authMode,
  headersJson,
  requestBody,
  signal
}: {
  fetcher: typeof fetch;
  endpointUrl: string;
  endpointPath: string;
  apiKey: string;
  authMode: AnthropicAuthMode;
  headersJson: Record<string, unknown> | null;
  requestBody: Record<string, unknown>;
  signal: AbortSignal;
}): Promise<ParsedChatFormatImage[]> {
  let response: Response;
  try {
    response = await fetcher(endpointUrl, {
      method: "POST",
      headers: buildAnthropicMessagesHeaders(apiKey, authMode, headersJson),
      body: JSON.stringify(requestBody),
      signal
    });
  } catch (error) {
    if (
      error instanceof AIProviderAbortError ||
      error instanceof AIProviderRequestError ||
      error instanceof AIProviderResponseFormatError ||
      error instanceof AIProviderTimeoutError
    ) {
      throw error;
    }

    throw new AIProviderRequestError("AI provider request failed", {
      endpointPath
    });
  }

  if (!response.ok) {
    await response.text().catch(() => "");
    throw new AIProviderRequestError("AI provider request failed", {
      statusCode: response.status,
      endpointPath
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AIProviderResponseFormatError();
  }

  return parseChatFormatImageResponseOutputs(payload);
}

function parseProviderAccountTestRequest(
  body: unknown
): ProviderAccountTestRequest | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const request: ProviderAccountTestRequest = {};

  if ("providerAccountId" in body) {
    if (
      body.providerAccountId !== undefined &&
      typeof body.providerAccountId !== "string"
    ) {
      return undefined;
    }
    if (typeof body.providerAccountId === "string") {
      request.providerAccountId = body.providerAccountId.trim();
    }
  }

  if ("providerType" in body) {
    if (
      body.providerType !== undefined &&
      !isProviderAccountType(body.providerType)
    ) {
      return undefined;
    }
    if (body.providerType !== undefined) {
      request.providerType = body.providerType;
    }
  }

  if ("baseUrl" in body) {
    if (body.baseUrl !== undefined && typeof body.baseUrl !== "string") {
      return undefined;
    }
    if (typeof body.baseUrl === "string") {
      request.baseUrl = body.baseUrl.trim();
    }
  }

  if ("apiKey" in body) {
    if (body.apiKey !== undefined && typeof body.apiKey !== "string") {
      return undefined;
    }
    if (typeof body.apiKey === "string") {
      request.apiKey = body.apiKey;
    }
  }

  if ("headersJson" in body) {
    const headersJson = parseOptionalJsonObject(body.headersJson);

    if (headersJson === undefined) {
      return undefined;
    }

    request.headersJson = headersJson;
  }

  if ("configJson" in body) {
    const configJson = parseOptionalJsonObject(body.configJson);

    if (configJson === undefined) {
      return undefined;
    }

    request.configJson = configJson;
  }

  if ("testModel" in body) {
    if (body.testModel !== undefined && typeof body.testModel !== "string") {
      return undefined;
    }
    if (typeof body.testModel === "string") {
      request.testModel = body.testModel.trim();
    }
  }

  if ("requestFormat" in body) {
    if (
      body.requestFormat !== undefined &&
      !isProviderAccountRequestFormat(body.requestFormat)
    ) {
      return undefined;
    }
    if (body.requestFormat !== undefined) {
      request.requestFormat = body.requestFormat;
    }
  }

  for (const key of ["anthropicAuthMode", "authHeaderMode", "authMode"] as const) {
    if (key in body) {
      if (body[key] !== undefined && !isAnthropicAuthMode(body[key])) {
        return undefined;
      }
      if (body[key] !== undefined) {
        request[key] = body[key];
      }
    }
  }

  if ("capabilities" in body) {
    const capabilities = parseProviderAccountTestCapabilities(body.capabilities);

    if (!capabilities) {
      return undefined;
    }

    request.capabilities = capabilities;
  }

  if ("testCapability" in body) {
    if (
      body.testCapability !== undefined &&
      !isProviderTestCapability(body.testCapability)
    ) {
      return undefined;
    }
    if (body.testCapability !== undefined) {
      request.testCapability = body.testCapability;
    }
  }

  if ("timeoutMs" in body) {
    if (
      body.timeoutMs !== undefined &&
      (typeof body.timeoutMs !== "number" ||
        !isValidImageProviderTimeoutMs(body.timeoutMs))
    ) {
      return undefined;
    }
    if (typeof body.timeoutMs === "number") {
      request.timeoutMs = body.timeoutMs;
    }
  }

  if (!request.providerAccountId && !request.providerType) {
    return undefined;
  }

  return request;
}

function readStringConfigValue(
  configJson: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const value = configJson?.[key];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function resolveProviderAccountTestMaxTokens(
  configJson: Record<string, unknown> | null
): number {
  const value = configJson?.testMaxTokens;

  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 64;
}

function buildAnthropicRequestDiagnostic({
  source,
  model,
  messages,
  maxTokens,
  temperature,
  stream,
  endpointPath,
  requestFormat,
  anthropicAuthMode,
  statusCode,
  latencyMs
}: {
  source: "provider-test" | "formal-chat" | "stream-chat";
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  stream: boolean;
  endpointPath: string;
  requestFormat: ProviderAccountRequestFormat;
  anthropicAuthMode: AnthropicAuthMode;
  statusCode?: number;
  latencyMs: number;
}) {
  const outboundMessages = messages.filter(
    (message) => message.role === "user" || message.role === "assistant"
  );
  const roleCounts = outboundMessages.reduce<Record<string, number>>(
    (counts, message) => ({
      ...counts,
      [message.role]: (counts[message.role] ?? 0) + 1
    }),
    {}
  );
  const rolesSummary = ["user", "assistant"]
    .filter((role) => roleCounts[role])
    .map((role) => `${role}:${roleCounts[role]}`)
    .join(",");

  return {
    source,
    model,
    messagesCount: outboundMessages.length,
    rolesSummary,
    hasSystem: messages.some((message) => message.role === "system"),
    maxTokens,
    temperature,
    stream,
    endpointPath,
    requestFormat,
    anthropicAuthMode,
    ...(typeof statusCode === "number" ? { statusCode } : {}),
    latencyMs
  };
}

interface ChatProviderRuntime {
  adapter: ChatCompletionAdapter & StreamingChatCompletionAdapter;
  requestFormat: ProviderAccountRequestFormat | null;
  anthropicAuthMode: AnthropicAuthMode | null;
  endpointPath: string | null;
  providerType: ProviderAccountType | null;
  providerAccount: ProviderAccountRuntime | null;
  maxTokens: number | null;
  route: ModelRouteRuntime | null;
  upstreamModel: string;
}

interface ImageProviderRouteAttempt {
  providerAccount: ProviderAccountRuntime | null;
  routeId?: string;
  upstreamModel: string;
  imageResponseFormat: "url" | "b64_json";
  imageTransport: ImageTransport;
}

interface VideoProviderRouteAttempt {
  providerAccount: ProviderAccountRuntime;
  routeId: string;
  upstreamModel: string;
  profile: NonNullable<ReturnType<typeof resolveApimartVideoProfile>>;
}

interface ProviderAttemptDiagnosticMetadata {
  providerId?: string;
  providerName?: string;
  routeId?: string;
  upstreamModel?: string;
  attemptIndex?: number;
  endpointPath?: string;
  statusCode?: number;
  willFallback?: boolean;
  providerAttemptDurationMs?: number;
}

function resolveImageResponseFormatConfig(
  configJson: Record<string, unknown> | null | undefined
): "url" | "b64_json" | null {
  const value = configJson?.imageResponseFormat;

  if (value === undefined || value === null || value === "") {
    return "url";
  }

  return value === "url" || value === "b64_json" ? value : null;
}

interface ChatRouteAttemptResult {
  runtime: ChatProviderRuntime;
  attemptIndex: number;
  fallbackAttempts: number;
}

type ChatStreamEvent = "meta" | "delta" | "done" | "error";

function writeChatStreamEvent(
  reply: FastifyReply,
  event: ChatStreamEvent,
  data: Record<string, unknown>
): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getChatStreamErrorCode(error: unknown): string {
  const rawMessage = summarizeError(error);

  return rawMessage.startsWith("AI provider")
    ? "PROVIDER_ERROR"
    : "STREAM_ERROR";
}

function logChatRouteFailure({
  logger,
  source,
  runtime,
  model,
  body,
  error,
  startedAt,
  willFallback
}: {
  logger: FastifyInstance["log"];
  source: "formal-chat" | "stream-chat";
  runtime: ChatProviderRuntime;
  model: string;
  body: ChatCompletionRequest;
  error: unknown;
  startedAt: number;
  willFallback: boolean;
}): void {
  const rawMessage = summarizeError(error);
  const isProviderError =
    error instanceof AIProviderAbortError
      ? false
      : error instanceof AIProviderRequestError ||
          error instanceof AIProviderTimeoutError ||
          error instanceof AIProviderResponseFormatError ||
          rawMessage.startsWith("AI provider");
  const providerStatusCode =
    error instanceof AIProviderRequestError ? error.statusCode : undefined;
  const upstreamStatusCode =
    typeof providerStatusCode === "number" &&
    Number.isSafeInteger(providerStatusCode) &&
    providerStatusCode >= 100 &&
    providerStatusCode <= 599
      ? providerStatusCode
      : undefined;
  const upstreamEndpointPath =
    error instanceof AIProviderRequestError
      ? error.endpointPath
      : runtime.endpointPath;
  const errorName =
    error instanceof AIProviderRequestError
      ? "ProviderTransportError"
      : safeErrorName(error);

  if (
    runtime.providerAccount &&
    runtime.requestFormat === "anthropic" &&
    runtime.providerType &&
    runtime.anthropicAuthMode &&
    runtime.endpointPath &&
    runtime.maxTokens
  ) {
    logger.error(
      {
        ...buildAnthropicRequestDiagnostic({
          source,
          model: runtime.upstreamModel,
          messages: body.messages,
          maxTokens: runtime.maxTokens,
          temperature: body.temperature,
          stream: source === "stream-chat",
          endpointPath: upstreamEndpointPath ?? runtime.endpointPath,
          requestFormat: runtime.requestFormat,
          anthropicAuthMode: runtime.anthropicAuthMode,
          statusCode: upstreamStatusCode,
          latencyMs: Date.now() - startedAt
        }),
        providerType: runtime.providerType,
        hasProviderAccount: true,
        providerId: runtime.providerAccount.id,
        providerName: runtime.providerAccount.name,
        routeId: runtime.route?.id ?? null,
        canonicalId: model,
        upstreamModel: runtime.upstreamModel,
        willFallback
      },
      source === "formal-chat"
        ? "formal chat Anthropic provider-account route failed"
        : "stream chat Anthropic provider-account route failed"
    );
  }

  logger.error(
    {
      errorName,
      ...(upstreamStatusCode === undefined
        ? {}
        : { statusCode: upstreamStatusCode }),
      isProviderError,
      canonicalId: model,
      providerId: runtime.providerAccount?.id ?? null,
      providerName: runtime.providerAccount?.name ?? null,
      upstreamModel: runtime.upstreamModel,
      routeId: runtime.route?.id ?? null,
      willFallback
    },
    `${source} model route failed`
  );
}

async function resolveProviderAccountTestModel({
  request,
  providerAccount,
  store,
  capability
}: {
  request: ProviderAccountTestRequest;
  providerAccount: ProviderAccountRuntime | null;
  store: UserStore;
  capability: ProviderTestCapability;
}): Promise<string | null> {
  const requestConfig = request.configJson;
  const savedConfig = providerAccount?.configJson;
  const explicitModel =
    request.testModel ||
    readStringConfigValue(requestConfig, "testModel") ||
    readStringConfigValue(requestConfig, "model") ||
    readStringConfigValue(savedConfig, "testModel") ||
    readStringConfigValue(savedConfig, "model");

  if (explicitModel) {
    return explicitModel;
  }

  if (providerAccount?.id) {
    const boundModel = (await store.listEnabledModels(capability)).find(
      (model) => model.providerAccountId === providerAccount.id
    );

    if (boundModel?.modelId.trim()) {
      return boundModel.modelId.trim();
    }

    const routedModel = (await store.listAdminModels()).find(
      (model) =>
        model.enabled &&
        model.capability === capability &&
        model.routes?.some(
          (route) =>
            route.providerId === providerAccount.id &&
            route.enabled &&
            route.upstreamModel.trim().length > 0
        )
    );
    const routedModelUpstream = routedModel?.routes?.find(
      (route) =>
        route.providerId === providerAccount.id &&
        route.enabled &&
        route.upstreamModel.trim().length > 0
    )?.upstreamModel;

    if (routedModelUpstream?.trim()) {
      return routedModelUpstream.trim();
    }
  }

  return null;
}

async function markReplacedAvatarStorageObjectDeleted({
  store,
  userId,
  storageObjectId
}: {
  store: Pick<StorageObjectStore, "markStorageObjectDeleted">;
  userId: string;
  storageObjectId: string | null;
}): Promise<void> {
  if (storageObjectId === null) {
    return;
  }

  try {
    await store.markStorageObjectDeleted({
      userId,
      id: storageObjectId
    });
  } catch {
    // The committed avatar replacement remains authoritative.
  }
}

async function markDeletedAiAssetStorageObject({
  store,
  userId,
  storageObjectId
}: {
  store: Pick<StorageObjectStore, "markStorageObjectDeleted">;
  userId: string;
  storageObjectId: string | null;
}): Promise<void> {
  if (
    storageObjectId === null ||
    storageObjectId.trim().length === 0
  ) {
    return;
  }

  try {
    await store.markStorageObjectDeleted({
      userId,
      id: storageObjectId
    });
  } catch {
    // The committed AiAsset deletion remains authoritative.
  }
}

function toPublicAiModelSummary(model: RuntimeAiModel): PublicAiModelSummary {
  return {
    id: model.id,
    name: model.name,
    ...(model.displayName ? { displayName: model.displayName } : {}),
    slug: model.slug,
    provider: model.provider,
    ...(model.providerAccountId !== undefined
      ? { providerAccountId: model.providerAccountId }
      : {}),
    capability: model.capability,
    ...(model.displaySurfaces !== undefined
      ? { displaySurfaces: model.displaySurfaces }
      : {}),
    ...(model.imageInvokeMode !== undefined
      ? { imageInvokeMode: model.imageInvokeMode }
      : {}),
    ...(model.imageOutputParser !== undefined
      ? { imageOutputParser: model.imageOutputParser }
      : {}),
    maxReferenceImages: model.maxReferenceImages,
    modelId: model.modelId,
    group: model.group,
    tags: model.tags,
    ...(model.shortDescription !== undefined
      ? { shortDescription: model.shortDescription }
      : {}),
    enabled: model.enabled,
    creditCost: model.creditCost,
    allowGuest: model.allowGuest,
    sortOrder: model.sortOrder,
    isRecommended: model.isRecommended,
    ...(model.iconUrl !== undefined ? { iconUrl: model.iconUrl } : {}),
    ...(model.iconText !== undefined ? { iconText: model.iconText } : {}),
    ...(model.iconColor !== undefined ? { iconColor: model.iconColor } : {}),
    ...(model.description !== undefined
      ? { description: model.description }
      : {}),
    ...(model.routes !== undefined ? { routes: model.routes } : {})
  };
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const env = options.env ?? process.env;
  const imageModerationConfig: ImageModerationConfig =
    resolveImageModerationConfig(env);
  const configuredEmailVerificationMailer = options.emailVerificationMailer;
  if (configuredEmailVerificationMailer === undefined) {
    throw new Error("EMAIL_VERIFICATION_DEPENDENCIES_REQUIRED");
  }
  const emailVerificationMailer = configuredEmailVerificationMailer;
  if (typeof emailVerificationMailer.sendEmailVerification !== "function") {
    throw new Error("EMAIL_VERIFICATION_DEPENDENCIES_REQUIRED");
  }
  const configuredPublicWebUrl = options.publicWebUrl;
  if (configuredPublicWebUrl === undefined) {
    throw new Error("EMAIL_VERIFICATION_DEPENDENCIES_REQUIRED");
  }
  const publicWebUrl = configuredPublicWebUrl;
  if (typeof publicWebUrl !== "string" || publicWebUrl.length === 0) {
    throw new Error("EMAIL_VERIFICATION_DEPENDENCIES_REQUIRED");
  }
  const passwordResetMailer = options.passwordResetMailer;
  const jwtSecret = env.JWT_SECRET ?? "";
  if (!jwtSecret.trim()) {
    throw new Error("EMAIL_VERIFICATION_DEPENDENCIES_REQUIRED");
  }
  const store = options.store ?? createPrismaUserStore();
  const generatedAssetsDir = resolveGeneratedAssetsDir(env);
  const generatedAssetsPublicPath = resolveGeneratedAssetsPublicPath(env);
  const configuredGeneratedAssetDownloadAllowedHosts =
    env.GENERATED_ASSET_DOWNLOAD_ALLOWED_HOSTS;
  let remoteImageAllowedHostRules: readonly RemoteImageAllowedHostRule[] = [];
  if (
    typeof configuredGeneratedAssetDownloadAllowedHosts === "string" &&
    configuredGeneratedAssetDownloadAllowedHosts.trim().length > 0
  ) {
    try {
      remoteImageAllowedHostRules = parseRemoteImageAllowedHostRules(
        configuredGeneratedAssetDownloadAllowedHosts
      );
    } catch {
      throw new Error("generated asset download configuration is invalid");
    }
  }
  const remoteImageFetcher =
    options.remoteImageFetcher ?? createRemoteImageFetcher();
  const remoteImageStorageService =
    options.remoteImageStorageService ??
    createRemoteImageStorageService({
      storageObjectStore: store,
      generatedAssetsDir
    });
  const localStorageObjectService =
    options.avatarStorageObjectService ??
    new LocalStorageObjectService({ store, env });
  const videoStorageObjectService =
    options.videoStorageObjectService ??
    new LocalStorageObjectService({ store, env });
  const storageObjectFileRemover =
    options.storageObjectFileRemover ??
    createLocalStorageObjectFileRemover({ baseDir: generatedAssetsDir });
  const assetContentService =
    options.assetContentService ??
    new LocalStorageObjectContentService({ env });
  const videoPollIntervalMs = resolveVideoPollIntervalMs(env);
  const videoMaxPollAttempts = resolveVideoPollAttempts(env);
  const videoMaxBytes = resolveVideoMaxBytes(env);
  const globalImageBudgetConfigResult = resolveGlobalImageBudgetConfig(env);
  const globalChatBudgetConfigResult = resolveGlobalChatBudgetConfig(env);
  const globalAdminProviderTestBudgetConfigResult =
    resolveGlobalAdminProviderTestBudgetConfig(env);
  const globalBudgetStore =
    options.globalBudgetStore ?? createPrismaGlobalBudgetStore();
  const globalBudgetNow = options.globalBudgetNow ?? (() => new Date());
  const injectedRateLimiter = options.rateLimiter;
  const createdRateLimiter = injectedRateLimiter
    ? {
        rateLimiter: injectedRateLimiter,
        ready: async () => {
          await injectedRateLimiter.ready?.();
        }
      }
    : createRateLimiterFromConfig(resolveRateLimitConfig(env));
  const rateLimiter = createdRateLimiter.rateLimiter;
  const injectedConcurrencyLimiter = options.concurrencyLimiter;
  const createdConcurrencyLimiter = injectedConcurrencyLimiter
    ? {
        concurrencyLimiter: injectedConcurrencyLimiter,
        ready: async () => {
          await injectedConcurrencyLimiter.ready?.();
        }
      }
    : createConcurrencyLimiterFromConfig(resolveConcurrencyConfig(env));
  const concurrencyLimiter = createdConcurrencyLimiter.concurrencyLimiter;
  const server = Fastify({
    logger: options.logger ?? true,
    trustProxy: resolveTrustProxy(env.TRUST_PROXY),
    bodyLimit: 1 * 1024 * 1024
  });
  const moderationInputCache = new ModerationInputCache({
    secret: options.moderationInputCacheSecret,
    now: options.moderationInputCacheNow
  });
  let moderationCacheSettingsMutationGeneration = 0;
  let moderationCacheSettingsSyncTail: Promise<void> = Promise.resolve();
  const moderationRouteCircuitBreaker = new ModerationRouteCircuitBreaker({
    now: options.moderationRouteCircuitBreakerNow
  });
  let moderationCircuitBreakerSettingsMutationGeneration = 0;
  let moderationCircuitBreakerSettingsSyncTail: Promise<void> = Promise.resolve();

  type ImageModerationRuntime = {
    enabled: boolean;
    client?: ImageModerationClient;
    moderationModel: string | null;
    prepareText?: (policyVersion: string) => Promise<{
      policyFingerprint: string;
      moderate(input: string): Promise<ImageModerationDecision>;
    }>;
  };

  const injectedImageModerationClient = options.imageModerationClient;
  let legacyImageModerationClient: ImageModerationClient | undefined;
  if (
    imageModerationConfig.mode === "enforce" &&
    imageModerationConfig.legacyConfigValid
  ) {
    try {
      legacyImageModerationClient = createImageModerationClient({
        apiKey: imageModerationConfig.apiKey,
        baseUrl: imageModerationConfig.baseUrl,
        model: imageModerationConfig.model,
        timeoutMs: imageModerationConfig.timeoutMs,
        fetchImpl: options.fetchImpl
      });
    } catch {
      legacyImageModerationClient = undefined;
    }
  }

  type ModerationInputCacheSettingsRead = {
    observedGeneration: number;
    value: string | null;
  };

  async function readModerationInputCacheSettings(): Promise<ModerationInputCacheSettingsRead> {
    const observedGeneration = moderationCacheSettingsMutationGeneration;
    const setting = await store.getSetting(IMAGE_MODERATION_CACHE_SETTINGS_KEY);
    return {
      observedGeneration,
      value: setting?.value ?? null
    };
  }

  function parseModerationInputCacheSettingsRead(
    read: ModerationInputCacheSettingsRead
  ): ModerationInputCacheSettings {
    return read.value === null
      ? { ...DEFAULT_MODERATION_INPUT_CACHE_SETTINGS }
      : parseModerationInputCacheSettings(read.value);
  }

  async function syncModerationInputCacheSettings(): Promise<ModerationInputCacheSettings> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const read = await readModerationInputCacheSettings();
      if (read.observedGeneration !== moderationCacheSettingsMutationGeneration) {
        continue;
      }
      const settings = parseModerationInputCacheSettingsRead(read);
      if (read.observedGeneration !== moderationCacheSettingsMutationGeneration) {
        continue;
      }
      moderationInputCache.syncSettings(settings);
      return settings;
    }
    throw new ModerationInputCacheEpochChangedError();
  }

  async function applyCommittedModerationInputCacheSettings(): Promise<ModerationInputCacheSettings> {
    ++moderationCacheSettingsMutationGeneration;
    const operation = moderationCacheSettingsSyncTail.then(async () => {
      while (true) {
        const read = await readModerationInputCacheSettings();
        if (read.observedGeneration !== moderationCacheSettingsMutationGeneration) {
          continue;
        }
        const settings = parseModerationInputCacheSettingsRead(read);
        if (read.observedGeneration !== moderationCacheSettingsMutationGeneration) {
          continue;
        }
        moderationInputCache.applySettings(settings);
        return settings;
      }
    });
    moderationCacheSettingsSyncTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  type ModerationCircuitBreakerSettingsRead = {
    observedGeneration: number;
    value: string | null;
  };

  async function readModerationCircuitBreakerSettings(): Promise<ModerationCircuitBreakerSettingsRead> {
    const observedGeneration = moderationCircuitBreakerSettingsMutationGeneration;
    const setting = await store.getSetting(
      IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_KEY
    );
    return {
      observedGeneration,
      value: setting?.value ?? null
    };
  }

  function parseModerationCircuitBreakerSettingsRead(
    read: ModerationCircuitBreakerSettingsRead
  ): ModerationRouteCircuitBreakerSettings {
    return read.value === null
      ? { ...DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS }
      : parseModerationRouteCircuitBreakerSettings(read.value);
  }

  async function syncModerationRouteCircuitBreakerSettings(): Promise<ModerationRouteCircuitBreakerSettings> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const read = await readModerationCircuitBreakerSettings();
      if (
        read.observedGeneration !==
        moderationCircuitBreakerSettingsMutationGeneration
      ) {
        continue;
      }
      const settings = parseModerationCircuitBreakerSettingsRead(read);
      if (
        read.observedGeneration !==
        moderationCircuitBreakerSettingsMutationGeneration
      ) {
        continue;
      }
      moderationRouteCircuitBreaker.syncSettings(settings);
      return settings;
    }
    throw new Error("IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_UNAVAILABLE");
  }

  async function applyCommittedModerationRouteCircuitBreakerSettings(): Promise<ModerationRouteCircuitBreakerSettings> {
    ++moderationCircuitBreakerSettingsMutationGeneration;
    const operation = moderationCircuitBreakerSettingsSyncTail.then(async () => {
      while (true) {
        const read = await readModerationCircuitBreakerSettings();
        if (
          read.observedGeneration !==
          moderationCircuitBreakerSettingsMutationGeneration
        ) {
          continue;
        }
        const settings = parseModerationCircuitBreakerSettingsRead(read);
        if (
          read.observedGeneration !==
          moderationCircuitBreakerSettingsMutationGeneration
        ) {
          continue;
        }
        moderationRouteCircuitBreaker.applySettings(settings);
        return settings;
      }
    });
    moderationCircuitBreakerSettingsSyncTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  function invalidateModerationInputCache(): void {
    try {
      moderationInputCache.clear();
    } catch {
      // The cache is process-local and its invalidation must never change a
      // successful settings, route, or provider-account mutation.
    }
  }

  function invalidateModerationRuntimeState(): void {
    invalidateModerationInputCache();
    try {
      moderationRouteCircuitBreaker.clear();
    } catch {
      // The breaker is process-local and its invalidation must never change a
      // successful settings, route, or provider-account mutation.
    }
  }

  async function resolveImageModerationRuntime(): Promise<ImageModerationRuntime> {
    if (imageModerationConfig.mode === "off") {
      return { enabled: false, moderationModel: null };
    }

    let persistedSetting;
    try {
      persistedSetting = await store.getSetting(IMAGE_MODERATION_SETTINGS_KEY);
    } catch {
      return { enabled: true, moderationModel: null };
    }

    if (!persistedSetting) {
      if (injectedImageModerationClient) {
        return {
          enabled: true,
          client: injectedImageModerationClient,
          moderationModel: imageModerationConfig.model,
          prepareText: async (policyVersion) => ({
            policyFingerprint: buildModerationPolicyFingerprint({
              policyVersion,
              legacy: {
                model: imageModerationConfig.model,
                endpointPath: "/moderations",
                baseUrl: imageModerationConfig.baseUrl,
                timeoutMs: imageModerationConfig.timeoutMs
              }
            }),
            moderate: (input: string) =>
              injectedImageModerationClient.moderateText(input)
          })
        };
      }
      if (legacyImageModerationClient) {
        return {
          enabled: true,
          client: legacyImageModerationClient,
          moderationModel: imageModerationConfig.model,
          prepareText: async (policyVersion) => ({
            policyFingerprint: buildModerationPolicyFingerprint({
              policyVersion,
              legacy: {
                model: imageModerationConfig.model,
                endpointPath: "/moderations",
                baseUrl: imageModerationConfig.baseUrl,
                timeoutMs: imageModerationConfig.timeoutMs
              }
            }),
            moderate: (input: string) => legacyImageModerationClient!.moderateText(input)
          })
        };
      }
      return { enabled: true, moderationModel: null };
    }

    let settings: ModerationSettings;
    try {
      settings = normalizeModerationSettings(JSON.parse(persistedSetting.value));
    } catch {
      return { enabled: true, moderationModel: null };
    }
    if (!settings.enabled) {
      return { enabled: false, moderationModel: null };
    }

    try {
      await syncModerationRouteCircuitBreakerSettings();
    } catch {
      return { enabled: true, moderationModel: null };
    }

    const resolveAttempts = async (
      inputType: ModerationInputType
    ): Promise<ReturnType<typeof resolveModerationProviderAttempts>> => {
      const accountIds = [
        ...new Set(settings.routes.map((route) => route.providerAccountId))
      ];
      const providerAccounts = (
        await Promise.all(
          accountIds.map((accountId) =>
            store.findProviderAccountRuntimeById(accountId)
          )
        )
      ).filter(
        (account): account is ProviderAccountRuntime => account !== null
      );
      return resolveModerationProviderAttempts({
        settings,
        providerAccounts,
        inputType
      });
    };
    const client = createRoutedImageModerationClient({
      fetchImpl: options.fetchImpl,
      log: (entry) => server.log.info(entry, "image moderation route attempt"),
      resolveAttempts,
      circuitBreaker: moderationRouteCircuitBreaker
    });

    return {
      enabled: true,
      client,
      moderationModel: "routed",
      prepareText: async (policyVersion) => {
        const attempts = await resolveAttempts("text");
        const textClient = createRoutedImageModerationClient({
          fetchImpl: options.fetchImpl,
          log: (entry) => server.log.info(entry, "image moderation route attempt"),
          resolveAttempts: () => attempts,
          circuitBreaker: moderationRouteCircuitBreaker
        });
        return {
          policyFingerprint: buildModerationPolicyFingerprint({
            policyVersion,
            attempts
          }),
          moderate: (input: string) => textClient.moderateText(input)
        };
      }
    };
  }

  const imageRecoveryService = options.imageRecoveryService ??
    createImageRecoveryServiceFromEnv({
      env,
      store,
      logger: server.log
    });
  const chatCreditRecoveryService =
    options.chatCreditRecoveryService ??
    createChatCreditRecoveryServiceFromEnv({
      env,
      store,
      logger: server.log
    });
  const storageCleanupService = options.storageCleanupService ??
    createStorageCleanupServiceFromEnv({
      env,
      store,
      generatedAssetsDir,
      logger: server.log
    });
  let videoRecoveryService: VideoRecoveryService | undefined;
  const corsOrigins = resolveCorsOrigins(env);
  const guestDailyLimit = parseGuestDailyLimit(env.GUEST_DAILY_LIMIT);

  async function sendEmailVerificationMail(input: {
    operation: "register" | "resend";
    to: string;
    rawToken: string;
    expiresAt: Date;
  }): Promise<void> {
    const verificationUrl = buildEmailVerificationUrl(
      publicWebUrl,
      input.rawToken
    );

    try {
      await emailVerificationMailer.sendEmailVerification({
        to: input.to,
        verificationUrl,
        expiresAt: input.expiresAt
      });
    } catch (error) {
      server.log.warn({
        event: "email_verification_mail_send_failed",
        operation: input.operation,
        errorName: safeErrorName(error)
      });
    }
  }

  async function sendPasswordResetMail(input: {
    to: string;
    rawToken: string;
    expiresAt: Date;
  }): Promise<void> {
    try {
      const resetUrl = buildPasswordResetUrl(publicWebUrl, input.rawToken);
      if (!passwordResetMailer) {
        throw new Error("PASSWORD_RESET_MAILER_UNAVAILABLE");
      }

      await passwordResetMailer.sendPasswordReset({
        to: input.to,
        resetUrl,
        expiresAt: input.expiresAt
      });
    } catch (error) {
      server.log.warn({
        event: "password_reset_mail_send_failed",
        operation: "request",
        errorName: safeErrorName(error)
      });
    }
  }

  server.addHook("onReady", async () => {
    await createdRateLimiter.ready();
    await createdConcurrencyLimiter.ready();
    await imageRecoveryService.ready();
    await storageCleanupService.ready();
    await chatCreditRecoveryService.ready();
    await videoRecoveryService?.ready();
    chatCreditRecoveryService.start();
    videoRecoveryService?.start();
  });
  server.addHook("onClose", async () => {
    try {
      await chatCreditRecoveryService.close();
    } catch {
      server.log.warn(
        { errorCode: "CHAT_CREDIT_RECOVERY_CLOSE_FAILED" },
        "chat credit recovery service close failed"
      );
    }
    try {
      await storageCleanupService.close();
    } catch {
      server.log.warn(
        { errorCode: "STORAGE_CLEANUP_CLOSE_FAILED" },
        "storage cleanup service close failed"
      );
    }
    try {
      await imageRecoveryService.close();
    } catch {
      server.log.warn(
        { errorType: "ImageRecoveryServiceCloseError" },
        "image recovery service close failed"
      );
    }
    try {
      await videoRecoveryService?.close();
    } catch {
      server.log.warn(
        { errorType: "VideoRecoveryServiceCloseError" },
        "video recovery service close failed"
      );
    }
    try {
      await rateLimiter.close();
    } catch {
      server.log.warn({ errorType: "RateLimiterCloseError" }, "rate limiter close failed");
    }
    try {
      await concurrencyLimiter.close();
    } catch {
      server.log.warn(
        { errorType: "ConcurrencyLimiterCloseError" },
        "concurrency limiter close failed"
      );
    }
  });

  server.addHook("onRequest", async (request, reply) => {
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      isStorageObjectPublicPath(request.url, generatedAssetsPublicPath)
    ) {
      return reply.code(404).send({ error: "asset not found" });
    }
  });

  registerGeneratedAssetsRoute(server, { env });

  async function getSettingValue(key: string): Promise<string | null> {
    const setting = await store.getSetting(key);

    return setting?.value ?? null;
  }

  async function resolveTitleCoverVisualBriefRuntimeConfig(): Promise<TitleCoverVisualBriefConfigResult> {
    const keys = [
      TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.modelId,
      TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.costCredits,
      TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.dailyBudgetCredits
    ] as const;

    try {
      const settings = await Promise.all(
        keys.map((key) => store.getSetting(key))
      );
      const databaseSettings: TitleCoverVisualBriefDatabaseSettings = {};

      settings.forEach((setting, index) => {
        if (setting) {
          const key = keys[index];
          if (key) {
            databaseSettings[key] = setting.value;
          }
        }
      });

      return resolveTitleCoverVisualBriefConfig(env, databaseSettings);
    } catch {
      return { status: "invalid", reason: "SETTINGS_UNAVAILABLE" };
    }
  }

  async function validateTitleCoverVisualBriefAdminSettings(
    input: SiteSettingUpdateInput[]
  ): Promise<void> {
    const keys = [
      TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.modelId,
      TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.costCredits,
      TITLE_COVER_VISUAL_BRIEF_SETTING_KEYS.dailyBudgetCredits
    ] as const;
    const relevantInput = input.filter((setting) =>
      isTitleCoverVisualBriefSettingKey(setting.key)
    );

    if (relevantInput.length === 0) {
      return;
    }

    const currentSettings = await Promise.all(
      keys.map((key) => store.getSetting(key))
    );
    const databaseSettings: TitleCoverVisualBriefDatabaseSettings = {};
    currentSettings.forEach((setting, index) => {
      if (setting) {
        const key = keys[index];
        if (key) {
          databaseSettings[key] = setting.value;
        }
      }
    });
    for (const setting of relevantInput) {
      if (isTitleCoverVisualBriefSettingKey(setting.key)) {
        databaseSettings[setting.key] = setting.value;
      }
    }

    const configResult = resolveTitleCoverVisualBriefConfig(
      env,
      databaseSettings
    );
    if (configResult.status !== "valid") {
      throw new Error("INVALID_TITLE_COVER_BRIEF_SETTING");
    }

    let model: RuntimeAiModel | null;
    try {
      model = await store.findModelByModelId(configResult.config.modelId);
    } catch {
      model = null;
    }
    if (
      !model ||
      model.slug !== configResult.config.modelId ||
      !model.enabled ||
      !isChatCapableModel(model)
    ) {
      throw new Error("INVALID_TITLE_COVER_BRIEF_MODEL");
    }

    let routes: ModelRouteRuntime[];
    try {
      routes = await store.listEnabledModelRoutesForModel(model.id);
    } catch {
      routes = [];
    }
    if (routes.length === 0) {
      throw new Error("INVALID_TITLE_COVER_BRIEF_MODEL");
    }
  }

  async function resolveConcurrencyLimitSettings(): Promise<ConcurrencyLimitSettings> {
    const keys = [
      "guestChatConcurrencyLimit",
      "userChatConcurrencyLimit",
      "imageGenerationConcurrencyLimit"
    ] as const satisfies readonly ConcurrencySettingKey[];
    const values = await Promise.all(keys.map((key) => getSettingValue(key)));
    const settings = new Map(keys.map((key, index) => [key, values[index]]));

    const resolveLimit = (
      key: ConcurrencySettingKey,
      fallback: number,
      min: number,
      max: number
    ): number => {
      const raw = settings.get(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = parseStrictSettingInteger(raw);
      if (parsed !== null && parsed >= min && parsed <= max) return parsed;
      server.log.warn(
        { settingKey: key },
        "invalid concurrency setting; using safe default"
      );
      return fallback;
    };

    return {
      guestChat: resolveLimit(
        "guestChatConcurrencyLimit",
        concurrencyLimitDefaults.guestChat,
        1,
        5
      ),
      userChat: resolveLimit(
        "userChatConcurrencyLimit",
        concurrencyLimitDefaults.userChat,
        1,
        10
      ),
      imageGeneration: resolveLimit(
        "imageGenerationConcurrencyLimit",
        concurrencyLimitDefaults.imageGeneration,
        1,
        5
      )
    };
  }

  async function runWithRequestConcurrency<T>({
    request,
    key,
    limit,
    routeIdentifier,
    task
  }: {
    request: FastifyRequest;
    key: string;
    limit: number;
    routeIdentifier: string;
    task: () => Promise<T>;
  }): Promise<
    | { acquired: true; value: T }
    | { acquired: false; retryAfterMs: number }
    | null
  > {
    try {
      return await runWithConcurrencyLease(
        concurrencyLimiter,
        key,
        { limit, leaseMs: CONCURRENCY_LEASE_MS },
        task,
        {
          onRenewFailure: () => {
            request.log.warn(
              { route: routeIdentifier, errorType: "ConcurrencyLimiterUnavailableError" },
              "concurrency lease renewal failed"
            );
          },
          onReleaseFailure: () => {
            request.log.warn(
              { route: routeIdentifier, errorType: "ConcurrencyLimiterUnavailableError" },
              "concurrency lease release failed"
            );
          }
        }
      );
    } catch (error) {
      request.log.warn(
        {
          route: routeIdentifier,
          errorType: error instanceof ConcurrencyLimiterUnavailableError
            ? error.name
            : "ConcurrencyLimiterError"
        },
        "concurrency limiter unavailable"
      );
      return null;
    }
  }

  function sendConcurrencyUnavailable(
    reply: FastifyReply,
    rejection?: { retryable: boolean }
  ): FastifyReply {
    return reply.code(503).send({
      code: "CONCURRENCY_LIMIT_UNAVAILABLE",
      message: "服务暂时不可用，请稍后重试",
      ...(rejection ? { retryable: rejection.retryable } : {})
    });
  }

  function sendConcurrencyLimited(
    reply: FastifyReply,
    type: "chat" | "image" | "video",
    retryAfterMs: number,
    rejection?: { retryable: boolean }
  ): FastifyReply {
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    reply.header("Retry-After", String(retryAfterSeconds));
    return reply.code(429).send(
      type === "chat"
        ? {
            code: "CHAT_CONCURRENCY_LIMITED",
            message: "当前正在处理其他请求，请等待完成后重试",
            retryAfterSeconds,
            ...(rejection ? { retryable: rejection.retryable } : {})
          }
        : type === "image"
          ? {
            code: "IMAGE_CONCURRENCY_LIMITED",
            message: "当前正在生成其他图片，请等待完成后重试",
            retryAfterSeconds,
            ...(rejection ? { retryable: rejection.retryable } : {})
          }
          : {
              code: "VIDEO_CONCURRENCY_LIMITED",
              message: "当前正在生成其他视频，请等待完成后重试",
              retryAfterSeconds,
              ...(rejection ? { retryable: rejection.retryable } : {})
            }
    );
  }

  async function resolveAllowedPaymentTypes(): Promise<EpayPaymentType[]> {
    return normalizeEpayPaymentTypes(await getSettingValue("paymentMethods"));
  }

  async function resolveBooleanSetting(
    key: string,
    fallback: boolean
  ): Promise<boolean> {
    return parseSettingBoolean(await getSettingValue(key)) ?? fallback;
  }

  async function resolveGuestRateLimitSettings(): Promise<GuestRateLimitSettings> {
    const keys = [
      "guestRateLimitEnabled",
    "guestDailyLimit",
    "guestPerModelHourlyLimit",
    "guestBurstLimit",
    "guestBurstWindowSeconds"
    ] as const satisfies readonly GuestRateLimitSettingKey[];
    const values = await Promise.all(keys.map((key) => getSettingValue(key)));
    const settings = new Map(keys.map((key, index) => [key, values[index]]));

    const resolveBoolean = (key: GuestRateLimitSettingKey, fallback: boolean): boolean => {
      const raw = settings.get(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = parseSettingBoolean(raw);
      if (parsed !== null) return parsed;
      server.log.warn({ settingKey: key }, "invalid guest rate limit setting; using safe default");
      return fallback;
    };
    const resolveInteger = (
      key: GuestRateLimitSettingKey,
      fallback: number,
      min: number,
      max: number
    ): number => {
      const raw = settings.get(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = parseSettingNumber(raw);
      if (parsed !== null && parsed >= min && parsed <= max) return parsed;
      server.log.warn({ settingKey: key }, "invalid guest rate limit setting; using safe default");
      return fallback;
    };

    return {
      enabled: resolveBoolean("guestRateLimitEnabled", guestRateLimitDefaults.enabled),
      dailyLimit: resolveInteger("guestDailyLimit", guestDailyLimit, 1, 1000),
      perModelHourlyLimit: resolveInteger(
        "guestPerModelHourlyLimit",
        guestRateLimitDefaults.perModelHourlyLimit,
        1,
        100
      ),
      burstLimit: resolveInteger(
        "guestBurstLimit",
        guestRateLimitDefaults.burstLimit,
        1,
        20
      ),
      burstWindowSeconds: resolveInteger(
        "guestBurstWindowSeconds",
        guestRateLimitDefaults.burstWindowSeconds,
        1,
        300
      )
    };
  }

  async function resolveProfileRateLimitSettings(): Promise<{
    enabled: boolean;
    nicknameDailyLimit: number;
    avatarDailyLimit: number;
  }> {
    const keys = [
      "profileRateLimitEnabled",
      "nicknameUpdateDailyLimit",
      "avatarUpdateDailyLimit"
    ] as const satisfies readonly ProfileRateLimitSettingKey[];
    const values = await Promise.all(keys.map((key) => getSettingValue(key)));
    const settings = new Map(keys.map((key, index) => [key, values[index]]));

    const resolveBoolean = (key: ProfileRateLimitSettingKey, fallback: boolean): boolean => {
      const raw = settings.get(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = parseSettingBoolean(raw);
      if (parsed !== null) return parsed;
      server.log.warn({ settingKey: key }, "invalid profile rate limit setting; using safe default");
      return fallback;
    };
    const resolveInteger = (
      key: ProfileRateLimitSettingKey,
      fallback: number,
      min: number,
      max: number
    ): number => {
      const raw = settings.get(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = parseStrictSettingInteger(raw);
      if (parsed !== null && parsed >= min && parsed <= max) return parsed;
      server.log.warn({ settingKey: key }, "invalid profile rate limit setting; using safe default");
      return fallback;
    };

    return {
      enabled: resolveBoolean("profileRateLimitEnabled", profileRateLimitDefaults.enabled),
      nicknameDailyLimit: resolveInteger(
        "nicknameUpdateDailyLimit",
        profileRateLimitDefaults.nicknameDailyLimit,
        1,
        20
      ),
      avatarDailyLimit: resolveInteger(
        "avatarUpdateDailyLimit",
        profileRateLimitDefaults.avatarDailyLimit,
        1,
        50
      )
    };
  }

  async function resolveReferenceImageRateLimitSettings(): Promise<{
    enabled: boolean;
    dailyLimit: number;
  }> {
    const keys = [
      "referenceImageRateLimitEnabled",
      "referenceImageDailyLimit"
    ] as const satisfies readonly ReferenceImageRateLimitSettingKey[];
    const values = await Promise.all(keys.map((key) => getSettingValue(key)));
    const settings = new Map(keys.map((key, index) => [key, values[index]]));

    const rawEnabled = settings.get("referenceImageRateLimitEnabled");
    const parsedEnabled = parseSettingBoolean(rawEnabled);
    const enabled =
      rawEnabled === null || rawEnabled === undefined
        ? referenceImageRateLimitDefaults.enabled
        : parsedEnabled ?? referenceImageRateLimitDefaults.enabled;

    if (rawEnabled !== null && rawEnabled !== undefined && parsedEnabled === null) {
      server.log.warn(
        { settingKey: "referenceImageRateLimitEnabled" },
        "invalid reference image rate limit setting; using safe default"
      );
    }

    const rawDailyLimit = settings.get("referenceImageDailyLimit");
    const parsedDailyLimit = parseStrictSettingInteger(rawDailyLimit);
    const dailyLimit =
      rawDailyLimit === null || rawDailyLimit === undefined
        ? referenceImageRateLimitDefaults.dailyLimit
        : parsedDailyLimit !== null && parsedDailyLimit >= 1 && parsedDailyLimit <= 200
          ? parsedDailyLimit
          : referenceImageRateLimitDefaults.dailyLimit;

    if (
      rawDailyLimit !== null &&
      rawDailyLimit !== undefined &&
      (parsedDailyLimit === null || parsedDailyLimit < 1 || parsedDailyLimit > 200)
    ) {
      server.log.warn(
        { settingKey: "referenceImageDailyLimit" },
        "invalid reference image rate limit setting; using safe default"
      );
    }

    return { enabled, dailyLimit };
  }

  async function enforceReferenceImageRateLimit({
    request,
    reply,
    userId,
    limit
  }: {
    request: FastifyRequest;
    reply: FastifyReply;
    userId: string;
    limit: number;
  }): Promise<
    | { status: "ALLOWED" }
    | { status: "LIMITED"; retryAfterMs: number }
    | { status: "UNAVAILABLE" }
  > {
    try {
      const result = await rateLimiter.consume(`image:reference:user:${userId}`, {
        limit,
        windowMs: REFERENCE_IMAGE_RATE_LIMIT_WINDOW_MS
      });
      reply.header("X-RateLimit-Limit", String(result.limit));
      reply.header("X-RateLimit-Remaining", String(result.remaining));

      return result.allowed
        ? { status: "ALLOWED" }
        : { status: "LIMITED", retryAfterMs: result.retryAfterMs };
    } catch (error) {
      request.log.warn(
        {
          route: "POST /image/generate reference image",
          errorType: error instanceof RateLimiterUnavailableError
            ? error.name
            : "RateLimiterError"
        },
        "reference image rate limiter unavailable"
      );
      return { status: "UNAVAILABLE" };
    }
  }

  async function enforceProfileRateLimit({
    request,
    reply,
    userId,
    kind,
    limit
  }: {
    request: FastifyRequest;
    reply: FastifyReply;
    userId: string;
    kind: "nickname" | "avatar";
    limit: number;
  }): Promise<boolean> {
    return enforceRateLimit({
      request,
      reply,
      rateLimiter,
      key: `profile:${kind}:user:${userId}`,
      policy: { limit, windowMs: PROFILE_RATE_LIMIT_WINDOW_MS },
      routeIdentifier: `profile ${kind} update`,
      rejection: kind === "nickname"
        ? {
            code: "NICKNAME_UPDATE_RATE_LIMITED",
            message: "昵称修改过于频繁，请稍后再试"
          }
        : {
            code: "AVATAR_UPDATE_RATE_LIMITED",
            message: "头像修改过于频繁，请稍后再试"
          }
    });
  }

  async function enforceGuestChatRateLimits({
    request,
    reply,
    modelConfig,
    guestIp,
    guestUsageDate,
    routeIdentifier
  }: {
    request: FastifyRequest;
    reply: FastifyReply;
    modelConfig: RuntimeAiModel;
    guestIp: string;
    guestUsageDate: string;
    routeIdentifier: string;
  }): Promise<boolean> {
    const config = await resolveGuestRateLimitSettings();

    if (await enforceRateLimit({
      request,
      reply,
      rateLimiter,
      key: `chat:ip:${guestIp}`,
      policy: RATE_LIMITS.chatGuest,
      routeIdentifier
    })) return true;

    if (config.enabled) {
      if (await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: `guest:chat:burst:ip:${guestIp}`,
        policy: {
          limit: config.burstLimit,
          windowMs: config.burstWindowSeconds * 1000
        },
        routeIdentifier,
        rejection: {
          code: "GUEST_BURST_RATE_LIMITED",
          message: "请求过于频繁，请稍后再试"
        }
      })) return true;

      if (await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: `guest:chat:model:${modelConfig.id}:ip:${guestIp}`,
        policy: {
          limit: config.perModelHourlyLimit,
          windowMs: 60 * 60 * 1000
        },
        routeIdentifier,
        rejection: {
          code: "GUEST_MODEL_RATE_LIMITED",
          message: "当前模型请求过于频繁，请稍后再试"
        }
      })) return true;
    }

    const guestUsageCount = await store.countGuestUsageLogs({
      guestIp,
      guestUsageDate
    });
    if (guestUsageCount >= config.dailyLimit) {
      reply.code(429).send({ message: guestLimitExceededMessage });
      return true;
    }

    return false;
  }

  async function resolveAccountBenefits(): Promise<AccountBenefitSettings> {
    const [
      storagePackageEnabled,
      storagePackagePriceCredits,
      storagePackageDurationDays,
      storagePackageAutoRenewEnabled,
      storagePackageDescription,
      checkInEnabled,
      checkInDailyRewardCredits,
      checkInStreakRewards,
      referralEnabled,
      referralInviterRewardCredits,
      referralInviteeRewardCredits,
      referralRewardTrigger,
      referralRulesText
    ] = await Promise.all([
      getSettingValue("storagePackageEnabled"),
      getSettingValue("storagePackagePriceCredits"),
      getSettingValue("storagePackageDurationDays"),
      getSettingValue("storagePackageAutoRenewEnabled"),
      getSettingValue("storagePackageDescription"),
      getSettingValue("checkInEnabled"),
      getSettingValue("checkInDailyRewardCredits"),
      getSettingValue("checkInStreakRewards"),
      getSettingValue("referralEnabled"),
      getSettingValue("referralInviterRewardCredits"),
      getSettingValue("referralInviteeRewardCredits"),
      getSettingValue("referralRewardTrigger"),
      getSettingValue("referralRulesText")
    ]);
    const streakRewards = parseStreakRewards(checkInStreakRewards);
    const durationDays = parseSettingNumber(storagePackageDurationDays);
    return {
      storagePackageEnabled: parseSettingBoolean(storagePackageEnabled) ?? defaultAccountBenefits.storagePackageEnabled,
      storagePackagePriceCredits: parseSettingNumber(storagePackagePriceCredits) ?? defaultAccountBenefits.storagePackagePriceCredits,
      storagePackageDurationDays: durationDays && durationDays > 0 ? durationDays : defaultAccountBenefits.storagePackageDurationDays,
      storagePackageAutoRenewEnabled: parseSettingBoolean(storagePackageAutoRenewEnabled) ?? defaultAccountBenefits.storagePackageAutoRenewEnabled,
      storagePackageDescription: storagePackageDescription?.trim() || defaultAccountBenefits.storagePackageDescription,
      checkInEnabled: parseSettingBoolean(checkInEnabled) ?? defaultAccountBenefits.checkInEnabled,
      checkInDailyRewardCredits: parseSettingNumber(checkInDailyRewardCredits) ?? defaultAccountBenefits.checkInDailyRewardCredits,
      checkInStreakRewards: streakRewards ?? defaultAccountBenefits.checkInStreakRewards,
      referralEnabled: parseSettingBoolean(referralEnabled) ?? defaultAccountBenefits.referralEnabled,
      referralInviterRewardCredits: parseSettingNumber(referralInviterRewardCredits) ?? defaultAccountBenefits.referralInviterRewardCredits,
      referralInviteeRewardCredits: parseSettingNumber(referralInviteeRewardCredits) ?? defaultAccountBenefits.referralInviteeRewardCredits,
      referralRewardTrigger: referralRewardTrigger?.trim() || defaultAccountBenefits.referralRewardTrigger,
      referralRulesText: referralRulesText?.trim() || defaultAccountBenefits.referralRulesText
    };
  }

  /** Resolve the secret used for encrypting sensitive DB-stored settings. */
  function getEncryptionSecret(): string {
    return (env.PAYMENT_SETTINGS_SECRET || env.JWT_SECRET || "").trim();
  }

  /**
   * Get the effective AI provider config: DB (SiteSetting) first, env fallback.
   * The API key stored in the DB is encrypted.
   */
  async function getEffectiveAiConfig(): Promise<{ baseUrl: string; apiKey: string }> {
    const dbBaseUrl = (await getSettingValue("aiBaseUrl"))?.trim();
    const dbApiKeyEncrypted = (await getSettingValue("aiApiKey"))?.trim();

    if (dbBaseUrl && dbApiKeyEncrypted) {
      const secret = getEncryptionSecret();
      if (secret) {
        const decrypted = decryptPaymentSecret(dbApiKeyEncrypted, secret);
        if (decrypted) {
          return { baseUrl: dbBaseUrl, apiKey: decrypted };
        }
      }
    }

    // Fall back to env vars
    return {
      baseUrl: env.AI_BASE_URL ?? "",
      apiKey: env.AI_API_KEY ?? ""
    };
  }

  async function resolveDefaultModel(): Promise<string> {
    const configuredModel = (await getSettingValue("defaultModel"))?.trim();

    if (configuredModel) {
      let model: RuntimeAiModel | null;
      try {
        model = await store.findModelByModelId(configuredModel);
      } catch (error) {
        if (error instanceof ModelIdentityConflictError) {
          return env.DEFAULT_MODEL ?? "";
        }
        throw error;
      }

      if (model?.enabled) {
        return configuredModel;
      }
    }

    return env.DEFAULT_MODEL ?? "";
  }

  async function resolveNativeImageProviderAttempts(
    modelConfig: RuntimeAiModel
  ): Promise<
    | ImageProviderRouteAttempt[]
    | {
        error:
          | "model is not available"
          | "invalid image response format"
          | "invalid image transport";
      }
  > {
    const routes = await store.listModelRoutes(modelConfig.id);
    const enabledRoutes = routes.filter((route) => route.enabled);

    // Enabled routes are authoritative. Direct binding is only considered when
    // no enabled route exists, preserving the legacy fallback contract.
    if (enabledRoutes.length > 0) {
      const attempts: ImageProviderRouteAttempt[] = [];

      for (const route of enabledRoutes) {
        const providerAccount =
          await store.findProviderAccountRuntimeById(route.providerId);

        if (!providerAccount || isProviderAccountImageUnavailable(providerAccount)) {
          continue;
        }

        let imageTransport: ImageTransport;
        try {
          imageTransport = resolveImageTransport({
            providerType: providerAccount.providerType,
            configJson: providerAccount.configJson
          });
        } catch {
          return { error: "invalid image transport" };
        }

        const imageResponseFormat = resolveImageResponseFormatConfig(
          providerAccount.configJson
        );
        if (!imageResponseFormat) {
          return { error: "invalid image response format" };
        }

        attempts.push({
          providerAccount,
          routeId: route.id,
          upstreamModel: route.upstreamModel,
          imageResponseFormat,
          imageTransport
        });
      }

      return attempts.length > 0
        ? attempts
        : { error: "model is not available" };
    }

    if (modelConfig.providerAccountId) {
      const providerAccount = await store.findProviderAccountRuntimeById(
        modelConfig.providerAccountId
      );

      if (!providerAccount || isProviderAccountImageUnavailable(providerAccount)) {
        return { error: "model is not available" };
      }

      let imageTransport: ImageTransport;
      try {
        imageTransport = resolveImageTransport({
          providerType: providerAccount.providerType,
          configJson: providerAccount.configJson
        });
      } catch {
        return { error: "invalid image transport" };
      }

      const imageResponseFormat = resolveImageResponseFormatConfig(
        providerAccount.configJson
      );
      if (!imageResponseFormat) {
        return { error: "invalid image response format" };
      }

      return [
        {
          providerAccount,
          routeId: undefined,
          upstreamModel: modelConfig.modelId,
          imageResponseFormat,
          imageTransport
        }
      ];
    }

    return [
      {
        providerAccount: null,
        routeId: undefined,
        upstreamModel: modelConfig.modelId,
        imageResponseFormat: "url",
        imageTransport: "openai-images"
      }
    ];
  }

  async function resolveVideoProviderAttempts(
    modelConfig: RuntimeAiModel
  ): Promise<VideoProviderRouteAttempt[] | { error: "model is not available" }> {
    const routes = await store.listModelRoutes(modelConfig.id);
    const attempts: VideoProviderRouteAttempt[] = [];

    for (const route of routes.filter((candidate) => candidate.enabled)) {
      const providerAccount = await store.findProviderAccountRuntimeById(
        route.providerId
      );
      if (isProviderAccountVideoUnavailable(providerAccount)) {
        continue;
      }
      const profile = resolveApimartVideoProfile(route.upstreamModel);
      if (!profile) {
        continue;
      }
      attempts.push({
        providerAccount: providerAccount!,
        routeId: route.id,
        upstreamModel: route.upstreamModel,
        profile
      });
    }

    return attempts.length > 0
      ? attempts
      : { error: "model is not available" };
  }

  async function resolveChatProviderRuntime({
    model,
    defaultModel,
    modelConfig
  }: {
    model: string;
    defaultModel: string;
    modelConfig: RuntimeAiModel;
  }): Promise<ChatProviderRuntime | { error: "model is not available" }> {
    // The first enabled route wins; direct provider binding is legacy fallback
    // only when no enabled route is available.
    const routes = await store.listEnabledModelRoutesForModel(modelConfig.id);

    const firstRoute = routes[0];
    if (firstRoute) {
      return createChatProviderRuntimeForRoute(firstRoute, model);
    }

    if (modelConfig.providerAccountId) {
      const providerAccount = await store.findProviderAccountRuntimeById(
        modelConfig.providerAccountId
      );

      if (
        !providerAccount ||
        isProviderAccountChatUnavailable(providerAccount)
      ) {
        return { error: "model is not available" };
      }

      return createChatProviderRuntimeForProvider(providerAccount, model, null);
    }

    const aiConfig = await getEffectiveAiConfig();

    return {
      adapter: createOpenAICompatibleAdapter({
        baseUrl: aiConfig.baseUrl,
        apiKey: aiConfig.apiKey,
        defaultModel,
        fetchImpl: options.fetchImpl
      }),
      requestFormat: null,
      anthropicAuthMode: null,
      endpointPath: null,
      providerType: null,
      providerAccount: null,
      maxTokens: null,
      route: null,
      upstreamModel: model || defaultModel
    };
  }

  async function resolveChatProviderRuntimeAttempts({
    model,
    defaultModel,
    modelConfig
  }: {
    model: string;
    defaultModel: string;
    modelConfig: RuntimeAiModel;
  }): Promise<ChatProviderRuntime[] | { error: "model is not available" }> {
    const routes = await store.listEnabledModelRoutesForModel(modelConfig.id);

    if (routes.length > 0) {
      const runtimes = routes
        .map((route) => createChatProviderRuntimeForRoute(route, model))
        .filter(
          (runtime): runtime is ChatProviderRuntime =>
            !("error" in runtime)
        );

      return runtimes.length > 0 ? runtimes : { error: "model is not available" };
    }

    const runtime = await resolveChatProviderRuntime({
      model,
      defaultModel,
      modelConfig
    });

    return "error" in runtime ? runtime : [runtime];
  }

  async function resolveTitleCoverVisualBriefProviderAttempts(
    modelId: string
  ): Promise<
    TitleCoverVisualBriefProviderAttempt[] | { error: "model-unavailable" }
  > {
    let modelConfig: RuntimeAiModel | null;
    try {
      modelConfig = await store.findModelByModelId(modelId);
    } catch {
      return { error: "model-unavailable" };
    }

    if (!modelConfig?.enabled || !isChatCapableModel(modelConfig)) {
      return { error: "model-unavailable" };
    }

    let routes: ModelRouteRuntime[];
    try {
      routes = await store.listEnabledModelRoutesForModel(modelConfig.id);
    } catch {
      return { error: "model-unavailable" };
    }

    if (routes.length === 0) {
      return { error: "model-unavailable" };
    }

    const runtimes = await resolveChatProviderRuntimeAttempts({
      model: modelId,
      defaultModel: modelConfig.modelId,
      modelConfig
    });
    if ("error" in runtimes) {
      return { error: "model-unavailable" };
    }

    return runtimes
      .filter(
        (runtime) =>
          runtime.route !== null &&
          runtime.providerAccount !== null &&
          !isProviderAccountChatUnavailable(runtime.providerAccount)
      )
      .map((runtime) => ({
        adapter: runtime.adapter,
        providerId: runtime.providerAccount?.id ?? null,
        providerName: runtime.providerAccount?.name ?? null,
        routeId: runtime.route?.id ?? null,
        upstreamModel: runtime.upstreamModel
      }));
  }

  function createChatProviderRuntimeForRoute(
    route: ModelRouteRuntime,
    canonicalModel: string
  ): ChatProviderRuntime | { error: "model is not available" } {
    return createChatProviderRuntimeForProvider(
      route.providerAccount,
      route.upstreamModel,
      route,
      canonicalModel
    );
  }

  function createChatProviderRuntimeForProvider(
    providerAccount: ProviderAccountRuntime,
    upstreamModel: string,
    route: ModelRouteRuntime | null,
    canonicalModel = upstreamModel
  ): ChatProviderRuntime | { error: "model is not available" } {
    const requestFormat = getDefaultProviderAccountRequestFormat(
      providerAccount.providerType
    );
    const authMode = getDefaultAnthropicAuthMode({
      providerType: providerAccount.providerType,
      requestFormat
    });
    const endpointPath = requestFormat === "anthropic" ? "/v1/messages" : null;

    if (providerAccount.providerType === "ANTHROPIC") {
      const maxTokens =
        resolveProviderMaxTokens(providerAccount.configJson) ?? 4096;

      return {
        adapter: createAnthropicChatAdapter({
          baseUrl: providerAccount.baseUrl,
          apiKey: providerAccount.apiKey,
          defaultModel: upstreamModel,
          maxTokens,
          headersJson: providerAccount.headersJson,
          timeoutMs: providerAccount.timeoutMs,
          fetchImpl: options.fetchImpl
        }),
        requestFormat,
        anthropicAuthMode: authMode,
        endpointPath,
        providerType: providerAccount.providerType,
        providerAccount,
        maxTokens,
        route,
        upstreamModel
      };
    }

    if (isOpenAICompatibleChatProviderType(providerAccount.providerType)) {
      return {
        adapter: createOpenAICompatibleAdapter({
          baseUrl: providerAccount.baseUrl,
          apiKey: providerAccount.apiKey,
          defaultModel: upstreamModel || canonicalModel,
          headersJson: providerAccount.headersJson,
          timeoutMs: providerAccount.timeoutMs,
          fetchImpl: options.fetchImpl
        }),
        requestFormat,
        anthropicAuthMode: authMode,
        endpointPath,
        providerType: providerAccount.providerType,
        providerAccount,
        maxTokens: null,
        route,
        upstreamModel
      };
    }

    return { error: "model is not available" };
  }

  async function buildPublicSettings(): Promise<PublicSiteSettings> {
    const settings = await store.listPublicSettings();
    const values = new Map(settings.map((setting) => [setting.key, setting.value]));
    const defaultModel = values.get("defaultModel")?.trim();
    let defaultModelConfig: RuntimeAiModel | null = null;
    if (defaultModel) {
      try {
        defaultModelConfig = await store.findModelByModelId(defaultModel);
      } catch (error) {
        if (!(error instanceof ModelIdentityConflictError)) {
          throw error;
        }
      }
    }

    return {
      siteName: values.get("siteName") ?? undefined,
      siteLogoText: values.get("siteLogoText") ?? undefined,
      siteLogoUrl: values.get("siteLogoUrl") ?? undefined,
      siteFaviconUrl: values.get("siteFaviconUrl") ?? undefined,
      workspaceIconUrl: values.get("workspaceIconUrl") ?? undefined,
      siteAnnouncement: values.get("siteAnnouncement") ?? undefined,
      publicNotice: values.get("publicNotice") ?? undefined,
      publicNoticeEnabled:
        parseSettingBoolean(values.get("publicNoticeEnabled")) ?? false,
      contactEmail: values.get("contactEmail") ?? undefined,
      contactDescription: values.get("contactDescription") ?? undefined,
      contactWechat: values.get("contactWechat") ?? undefined,
      contactPublicAccount: values.get("contactPublicAccount") ?? undefined,
      contactCommunityUrl: values.get("contactCommunityUrl") ?? undefined,
      contactQrImageUrl: values.get("contactQrImageUrl") ?? undefined,
      contactNotes: values.get("contactNotes") ?? undefined,
      contactExternalLinks: values.get("contactExternalLinks") ?? undefined,
      guestModeEnabled:
        parseSettingBoolean(values.get("guestModeEnabled")) ?? true,
      registrationEnabled:
        parseSettingBoolean(values.get("registrationEnabled")) ?? false,
      registrationClosedMessageZh:
        values.get("registrationClosedMessageZh")?.trim() ||
        DEFAULT_REGISTRATION_CLOSED_MESSAGE_ZH,
      registrationClosedMessageEn:
        values.get("registrationClosedMessageEn")?.trim() ||
        DEFAULT_REGISTRATION_CLOSED_MESSAGE_EN,
      maintenanceModeEnabled:
        parseSettingBoolean(values.get("maintenanceModeEnabled")) ?? false,
      maintenanceMessage: values.get("maintenanceMessage") ?? undefined,
      homeHeroTitle: values.get("homeHeroTitle") ?? undefined,
      homeHeroSubtitle: values.get("homeHeroSubtitle") ?? undefined,
      homePrimaryCta: values.get("homePrimaryCta") ?? undefined,
      homeSecondaryCta: values.get("homeSecondaryCta") ?? undefined,
      betaNotice: values.get("betaNotice") ?? undefined,
      homePrimaryCtaText: values.get("homePrimaryCtaText") ?? undefined,
      homeSecondaryCtaText: values.get("homeSecondaryCtaText") ?? undefined,
      homeBetaNotice: values.get("homeBetaNotice") ?? undefined,
      homeRightCardNotice: values.get("homeRightCardNotice") ?? undefined,
      footerSlogan: values.get("footerSlogan") ?? undefined,
      footerCopyright: values.get("footerCopyright") ?? undefined,
      footerLinksJson: values.get("footerLinksJson") ?? undefined,
      homeFeatureCards: values.get("homeFeatureCards") ?? undefined,
      workspaceLinksLabel: values.get("workspaceLinksLabel") ?? undefined,
      workspaceTitle: values.get("workspaceTitle") ?? undefined,
      workspaceSubtitle: values.get("workspaceSubtitle") ?? undefined,
      workspacePromptPlaceholder:
        values.get("workspacePromptPlaceholder") ?? undefined,
      workspaceHint: values.get("workspaceHint") ?? undefined,
      workspaceHeroTitle: values.get("workspaceHeroTitle") ?? undefined,
      workspaceHeroSubtitle: values.get("workspaceHeroSubtitle") ?? undefined,
      workspacePromptCards: values.get("workspacePromptCards") ?? undefined,
      imagePromptCards: (() => {
        const value = values.get("imagePromptCards");
        return value && isValidImagePromptCardsSetting(value) ? value : undefined;
      })(),
      helpContentJson: values.get("helpContentJson") ?? undefined,
      ...(defaultModelConfig?.enabled ? { defaultModel } : {})
    };
  }

  server.setErrorHandler((error, request, reply) => {
    // Log sanitized error info for debugging without exposing secrets or raw bodies
    const errorName = error instanceof Error ? error.name : "Error";
    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const fastifyErrorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    server.log.error(
      { err: { name: errorName, code: errorCode, hasStack: error instanceof Error } },
      "unhandled request error"
    );
    const statusCode = errorCode && errorCode >= 400 ? errorCode : 500;

    const isImageJsonParsingError =
      request.routeOptions.url === "/image/generate" &&
      (fastifyErrorCode === "FST_ERR_CTP_EMPTY_JSON_BODY" ||
        fastifyErrorCode === "FST_ERR_CTP_INVALID_JSON_BODY");
    const isImageBodyLimitError =
      request.routeOptions.url === "/image/generate" &&
      fastifyErrorCode === "FST_ERR_CTP_BODY_TOO_LARGE";

    if (isImageJsonParsingError || isImageBodyLimitError) {
      void sendImageGenerationFailure(
        reply,
        isImageBodyLimitError ? 413 : 400,
        isImageBodyLimitError
          ? "IMAGE_REQUEST_TOO_LARGE"
          : "INVALID_IMAGE_REQUEST",
        {
          message: isImageBodyLimitError
            ? referenceImagePayloadTooLargeMessage
            : "valid image generation fields are required",
          retryable: false
        }
      );
      return;
    }

    if (statusCode === 413) {
      void reply.code(413).send({
        message: referenceImagePayloadTooLargeMessage
      });
      return;
    }

    void reply.code(statusCode).send({
      message: internalErrorMessage
    });
  });

  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
    rejection?: {
      unauthorized: { code: string; message: string; retryable: boolean };
      unavailable: { code: string; message: string; retryable: boolean };
    }
  ): Promise<UserRecord | null> {
    const token = getBearerToken(request);

    if (!token) {
      void reply.code(401).send(
        rejection?.unauthorized ?? { message: "authentication required" }
      );
      return null;
    }

    try {
      const jwt = verifyJwt(token, env.JWT_SECRET ?? "");

      if (!jwt) {
        void reply.code(401).send(
          rejection?.unauthorized ?? { message: "authentication required" }
        );
        return null;
      }

      const user = await store.findUserById(jwt.userId);

      if (!user || user.sessionVersion !== jwt.sessionVersion) {
        void reply.code(401).send(
          rejection?.unauthorized ?? { message: "authentication required" }
        );
        return null;
      }

      return user;
    } catch {
      void reply.code(500).send(
        rejection?.unavailable ?? { message: "authentication failed" }
      );
      return null;
    }
  }

  async function authenticateAdmin(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<UserRecord | null> {
    const user = await authenticate(request, reply);

    if (!user) {
      return null;
    }

    if (user.role !== "ADMIN") {
      void reply.code(403).send({
        message: "admin access required"
      });
      return null;
    }

    return user;
  }

  const moderationSettingsDescription =
    "Admin-configured OpenAI-compatible moderation routes";
  const moderationCacheSettingsDescription =
    "Process-local image input moderation cache settings";
  const moderationCircuitBreakerSettingsDescription =
    "Process-local image moderation route circuit breaker settings";

  function parseStoredModerationSettings(value: string): ModerationSettings {
    try {
      return normalizeModerationSettings(JSON.parse(value));
    } catch {
      throw new Error("MODERATION_SETTINGS_INVALID");
    }
  }

  async function readAdminModerationSettings(): Promise<ModerationSettings> {
    const setting = await store.getSetting(IMAGE_MODERATION_SETTINGS_KEY);
    return setting
      ? parseStoredModerationSettings(setting.value)
      : {
          version: 1,
          enabled: true,
          routes: []
        };
  }

  async function saveModerationSettingsAtomically(
    mutate: (current: ModerationSettings) => ModerationSettings
  ): Promise<ModerationSettings> {
    const saved = await store.updateSettingAtomically({
      key: IMAGE_MODERATION_SETTINGS_KEY,
      create: {
        key: IMAGE_MODERATION_SETTINGS_KEY,
        value: JSON.stringify({ version: 1, enabled: true, routes: [] }),
        type: "json",
        description: moderationSettingsDescription
      },
      update: (current) => {
        const base = current
          ? parseStoredModerationSettings(current.value)
          : { version: 1 as const, enabled: true, routes: [] };
        const next = normalizeModerationSettings(mutate(base));
        return {
          key: IMAGE_MODERATION_SETTINGS_KEY,
          value: JSON.stringify(next),
          type: "json",
          description: moderationSettingsDescription
        };
      }
    });
    return parseStoredModerationSettings(saved.value);
  }

  function moderationErrorCode(error: unknown): string {
    const code = error instanceof Error ? error.message : "";
    return /^(?:MODERATION_|IMAGE_MODERATION_)/u.test(code)
      ? code
      : "MODERATION_SETTINGS_INVALID";
  }

  function sendModerationWriteError(reply: FastifyReply, error: unknown) {
    const code = moderationErrorCode(error);
    const statusCode =
      code === "MODERATION_ROUTE_NOT_FOUND" ? 404 : 400;
    return reply.code(statusCode).send({
      message:
        code === "MODERATION_ROUTE_NOT_FOUND"
          ? "moderation route not found"
          : "moderation settings are invalid",
      code
    });
  }

  async function toAdminModerationSettings(
    settings: ModerationSettings
  ): Promise<{
    version: 1;
    enabled: boolean;
    routes: AdminModerationRouteSummary[];
  }> {
    const routes = await Promise.all(
      settings.routes.map(async (route) => {
        const account = await store.findProviderAccountRuntimeById(
          route.providerAccountId
        );
        return {
          ...route,
          providerAccountName: account?.name ?? null,
          providerAccountEnabled: account?.enabled ?? false,
          providerAccountCompatible: account
            ? isModerationProviderAccountCompatible(account)
            : false
        } satisfies AdminModerationRouteSummary;
      })
    );
    return { version: 1, enabled: settings.enabled, routes };
  }

  void server.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"]
  });
  void server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        imgSrc: ["'self'", "data:"]
      }
    },
    hsts: env.NODE_ENV === "production"
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false
  });

  server.get("/health", async () => {
    return {
      status: "ok",
      service: "ai-aggregate-api"
    };
  });

  server.get("/health/ready", async (_request, reply) => {
    try {
      await store.getSetting("setupCompleted");
      return reply.header("Cache-Control", "no-store").send({
        status: "ready"
      });
    } catch {
      return reply.code(503).header("Cache-Control", "no-store").send({
        status: "not_ready"
      });
    }
  });

  // -----------------------------------------------------------------------
  // Setup wizard
  // -----------------------------------------------------------------------

  server.get("/setup/status", async (_request, reply) => {
    const setting = await store.getSetting("setupCompleted");
    const setupCompleted = setting?.value === "true";

    if (setupCompleted) {
      return reply.header("Cache-Control", "no-store").send({
        setupCompleted: true
      });
    }

    const adminCount = await store.countAdmins();
    const enabledModels = await store.listEnabledModels("chat");
    const defaultModel = (await getSettingValue("defaultModel"))?.trim() || env.DEFAULT_MODEL || "";
    const defaultModelEnabled = enabledModels.some((m) => m.modelId === defaultModel && m.enabled);
    const jwtConfigured = Boolean(env.JWT_SECRET?.trim());
    const paymentSecretConfigured = Boolean(env.PAYMENT_SETTINGS_SECRET?.trim());
    const setupTokenConfigured = Boolean(env.SETUP_TOKEN?.trim());
    const apiBaseUrlConfigured = Boolean(env.APP_URL || process.env.NEXT_PUBLIC_API_BASE_URL);
    const corsConfigured = env.NODE_ENV !== "production" || Boolean(env.CORS_ORIGINS?.trim());

    // AI config: check DB-stored settings first, then env
    const dbAiBaseUrl = (await getSettingValue("aiBaseUrl"))?.trim();
    const dbAiApiKey = (await getSettingValue("aiApiKey"))?.trim();
    const hasAiConfig = Boolean(
      (env.AI_BASE_URL?.trim() && env.AI_API_KEY?.trim()) ||
      (dbAiBaseUrl && dbAiApiKey)
    );

    // Check if basic site settings are configured
    const siteName = (await getSettingValue("siteName"))?.trim();
    const hasSiteConfig = Boolean(siteName);

    // Check if there are any plans configured
    const allPlans = await store.listAdminPlans();
    const planCount = allPlans.length;

    return reply.header("Cache-Control", "no-store").send({
      setupCompleted,
      databaseConnected: true,
      jwtSecretConfigured: jwtConfigured,
      paymentSecretConfigured,
      setupTokenConfigured,
      apiBaseUrlConfigured,
      corsOriginsConfigured: corsConfigured,
      hasAiConfig,
      adminExists: adminCount > 0,
      enabledModelCount: enabledModels.length,
      defaultModel,
      defaultModelEnabled,
      hasSiteConfig,
      planCount,
      requiredComplete:
        jwtConfigured &&
        adminCount > 0 &&
        hasAiConfig &&
        enabledModels.length > 0 &&
        defaultModelEnabled
    });
  });

  server.post("/setup/configure", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;

    if (!body || typeof body !== "object") {
      return reply.code(400).send({ message: "valid body required" });
    }

    const setupToken = env.SETUP_TOKEN?.trim();
    if (!setupToken) {
      return reply.code(503).send({
        code: "SETUP_TOKEN_NOT_CONFIGURED",
        message: "setup token is not configured"
      });
    }

    const setupCompletedSetting = await store.getSetting("setupCompleted");
    const isSetupDone = setupCompletedSetting?.value === "true";
    if (isSetupDone) {
      return reply.code(409).send({
        code: "SETUP_ALREADY_COMPLETED",
        message: "setup already completed"
      });
    }

    const provided = typeof body.setupToken === "string" ? body.setupToken.trim() : "";

    if (!provided || !isSetupTokenMatch(provided, setupToken)) {
      return reply.code(403).send({
        code: "SETUP_TOKEN_INVALID",
        message: "invalid setup token"
      });
    }

    if (!isSetupDone) {
      const setupKey = `setup:ip:${resolveClientIp(request)}`;
      if (await enforceRateLimit({ request, reply, rateLimiter, key: setupKey,
        policy: RATE_LIMITS.setupConfigure, routeIdentifier: "POST /setup/configure" })) return reply;
    }

    const adminCount = await store.countAdmins();

    // Only allow creating first admin
    if (adminCount === 0) {
      const email = typeof body.adminEmail === "string" ? body.adminEmail.trim() : "";
      const password = typeof body.adminPassword === "string" ? body.adminPassword : "";
      const passwordValidation = validatePasswordForSet(password);

      if (!email || passwordValidation !== "VALID") {
        return reply.code(400).send({
          message: "admin email and password (min 8 chars) are required when no admin exists"
        });
      }

      try {
        const passwordHash = await hashPassword(password);
        const newUser = await store.createUser({
          email,
          passwordHash,
          emailVerifiedAt: new Date()
        });

        // Promote to admin
        await store.setUserRole(newUser.id, "ADMIN");
      } catch (error) {
        if (error instanceof Error && error.message === "USER_EMAIL_EXISTS") {
          return reply.code(409).send({ message: "email already registered" });
        }
        throw error;
      }
    }

    // ---- AI provider settings (store in DB with encrypted key) ----
    const aiBaseUrl = typeof body.aiBaseUrl === "string" ? body.aiBaseUrl.trim() : "";
    const aiApiKey = typeof body.aiApiKey === "string" ? body.aiApiKey.trim() : "";

    const settingsToUpdate: SiteSettingUpdateInput[] = [];

    if (aiBaseUrl) {
      settingsToUpdate.push({
        key: "aiBaseUrl",
        value: aiBaseUrl,
        type: "string" as SiteSettingValueType
      });

      if (aiApiKey) {
        const encryptionSecret = getEncryptionSecret();
        if (!encryptionSecret) {
          return reply.code(400).send({
            message: "PAYMENT_SETTINGS_SECRET or JWT_SECRET must be configured to store the AI API key securely"
          });
        }
        const encryptedKey = encryptPaymentSecret(aiApiKey, encryptionSecret);
        settingsToUpdate.push({
          key: "aiApiKey",
          value: encryptedKey,
          type: "string" as SiteSettingValueType
        });
      }
    }

    // ---- Basic site settings ----
    if (typeof body.siteName === "string" && body.siteName.trim()) {
      settingsToUpdate.push({
        key: "siteName",
        value: body.siteName.trim(),
        type: "string" as SiteSettingValueType
      });
    }

    if (typeof body.siteAnnouncement === "string" && body.siteAnnouncement.trim()) {
      settingsToUpdate.push({
        key: "siteAnnouncement",
        value: body.siteAnnouncement.trim(),
        type: "string" as SiteSettingValueType
      });
    }

    if (typeof body.contactEmail === "string" && body.contactEmail.trim()) {
      settingsToUpdate.push({
        key: "contactEmail",
        value: body.contactEmail.trim(),
        type: "string" as SiteSettingValueType
      });
    }

    // ---- Models ----
    const modelsInput = Array.isArray(body.models) ? body.models : [];
    const createdModelIds: string[] = [];

    for (let i = 0; i < modelsInput.length; i++) {
      const m = modelsInput[i] as Record<string, unknown> | undefined;
      if (!m || typeof m !== "object") continue;

      const mName = typeof m.name === "string" ? m.name.trim() : "";
      const mModelId = typeof m.modelId === "string" ? m.modelId.trim() : "";
      if (!mName || !mModelId) continue;

      const capability =
        typeof m.capability === "string" && isModelCapability(m.capability)
          ? m.capability
          : "chat";

      const importDisplaySurfaces = Array.isArray(m.displaySurfaces)
        ? m.displaySurfaces.filter(isModelDisplaySurface)
        : undefined;

      const modelInput: ModelInput = {
        name: mName,
        displayName: typeof m.displayName === "string" ? m.displayName.trim() : mName,
        modelId: mModelId,
        provider: isModelProvider(m.provider) ? m.provider : "OPENAI_COMPATIBLE",
        capability,
        ...(importDisplaySurfaces && importDisplaySurfaces.length > 0
          ? { displaySurfaces: importDisplaySurfaces }
          : {}),
        group: typeof m.group === "string" ? m.group.trim() : "general",
        tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [],
        shortDescription: typeof m.shortDescription === "string" ? m.shortDescription.trim() : "",
        creditCost: typeof m.creditCost === "number" && Number.isInteger(m.creditCost) && m.creditCost >= 0 ? m.creditCost : 0,
        allowGuest: typeof m.allowGuest === "boolean" ? m.allowGuest : true,
        enabled: true,
        isRecommended: typeof m.isRecommended === "boolean" ? m.isRecommended : false,
        sortOrder: typeof m.sortOrder === "number" && Number.isInteger(m.sortOrder) ? m.sortOrder : i,
        iconUrl: typeof m.iconUrl === "string" ? m.iconUrl.trim() : undefined,
        iconText: typeof m.iconText === "string" ? m.iconText.trim() : undefined,
        iconColor: typeof m.iconColor === "string" ? m.iconColor.trim() : undefined
      };

      try {
        const created = await store.createModel(modelInput);
        createdModelIds.push(created.id);
      } catch (err) {
        server.log.warn({ err, modelName: mName }, "Failed to create model during setup");
      }
    }

    // If at least one model was created and no defaultModel is set, use the first
    if (createdModelIds.length > 0 && modelsInput.length > 0) {
      const firstModel = modelsInput[0] as Record<string, unknown> | undefined;
      const firstModelId = firstModel && typeof firstModel.modelId === "string"
        ? firstModel.modelId.trim()
        : "";
      const existingDefault = (await getSettingValue("defaultModel"))?.trim();
      if (firstModelId && !existingDefault) {
        settingsToUpdate.push({
          key: "defaultModel",
          value: firstModelId,
          type: "string" as SiteSettingValueType
        });
      }
    }

    // Persist all settings
    if (settingsToUpdate.length > 0) {
      await store.updateSettings(settingsToUpdate);
    }

    // Mark setup as complete
    await store.updateSettings([{
      key: "setupCompleted",
      value: "true",
      type: "boolean" as SiteSettingValueType
    }]);

    return {
      ok: true,
      setupCompleted: true,
      modelsCreated: createdModelIds.length
    };
  });

  server.post("/auth/register", async (request, reply) => {
    if (!(await resolveBooleanSetting("registrationEnabled", false))) {
      return reply.code(403).send({
        code: "REGISTRATION_CLOSED",
        message:
          (await getSettingValue("registrationClosedMessageZh"))?.trim() ||
          DEFAULT_REGISTRATION_CLOSED_MESSAGE_ZH
      });
    }

    const registerIp = resolveClientIp(request);
    const registerKey = `register:ip:${registerIp}`;
    if (await enforceRateLimit({ request, reply, rateLimiter, key: registerKey,
      policy: RATE_LIMITS.register, routeIdentifier: "POST /auth/register" })) return reply;

    const body = parseRegisterRequest(request.body);

    if (!body || !isEmail(body.email)) {
      return reply.code(400).send({
        message: "valid email is required"
      });
    }

    const passwordValidation = validatePasswordForSet(body.password);

    if (passwordValidation === "TOO_SHORT") {
      return reply.code(400).send({
        message: "password must be at least 8 characters"
      });
    }

    if (passwordValidation === "TOO_LONG") {
      return reply.code(400).send({
        message: "password must be at most 72 bytes"
      });
    }

    const policySettings = await Promise.all(
      [
        "registrationEmailPolicyEnabled",
        "registrationEmailPolicyMode",
        "registrationAllowedDomainsJson",
        "registrationBlockedDomainsJson"
      ].map(async (key) => [key, await getSettingValue(key)] as const)
    );
    const policy = resolveRegistrationEmailPolicy(
      new Map(
        policySettings.flatMap(([key, value]) =>
          value === null ? [] : [[key, value] as const]
        )
      ),
      () => server.log.warn("Invalid registration email policy; safe defaults applied")
    );
    if (!isRegistrationEmailAllowed(body.email, policy)) {
      return reply.code(400).send({
        code: "EMAIL_DOMAIN_NOT_ALLOWED",
        message: "当前邮箱域名暂不支持注册，请更换常用邮箱。"
      });
    }

    try {
      const passwordHash = await hashPassword(body.password);
      const { rawToken, tokenHash } = createEmailVerificationToken();
      const expiresAt = createEmailVerificationExpiry();
      const registration =
        await store.registerUnverifiedUserAndIssueEmailVerificationToken({
        email: body.email,
        passwordHash,
        tokenHash,
        expiresAt
      });

      if (registration.status === "CREATED") {
        await sendEmailVerificationMail({
          operation: "register",
          to: body.email,
          rawToken,
          expiresAt
        });
      }

      return sendEmailVerificationPending(reply);
    } catch {
      return reply.code(500).send({
        message: "register failed"
      });
    }
  });

  server.post("/auth/login", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const body = parseLoginRequest(request.body);

    if (!body) {
      return reply.code(400).send({
        message: "email and password are required"
      });
    }

    if (
      typeof body.password !== "string" ||
      Buffer.byteLength(body.password, "utf8") > 72
    ) {
      return reply.code(401).send({
        message: "invalid email or password"
      });
    }

    if (!isEmail(body.email)) {
      return reply.code(401).send({
        message: "invalid email or password"
      });
    }

    const loginIpKey = `auth-login:ip:${resolveClientIp(request)}`;
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: loginIpKey,
        policy: RATE_LIMITS.login,
        routeIdentifier: "POST /auth/login",
        rejection: loginRateLimitRejection
      })
    ) {
      return reply;
    }

    const loginEmailHash = hashLoginEmail(body.email, jwtSecret);
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: `auth-login:email:${loginEmailHash}`,
        policy: loginEmailRateLimit,
        routeIdentifier: "POST /auth/login",
        rejection: loginRateLimitRejection
      })
    ) {
      return reply;
    }

    try {
      const user = await store.findUserByEmail(body.email);
      const passwordMatches = await verifyPasswordWithTimingProtection(
        body.password,
        user?.passwordHash ?? null
      );

      if (!user || !passwordMatches) {
        return reply.code(401).send({
          message: "invalid email or password"
        });
      }

      if (user.emailVerifiedAt === null) {
        return reply
          .header("Cache-Control", "no-store")
          .code(403)
          .send({
            code: "EMAIL_VERIFICATION_REQUIRED",
            message: "Email verification is required before login."
          });
      }

      const login = await store.recordSuccessfulLogin(user.id, new Date());

      if (!login) {
        return reply.code(401).send({
          message: "invalid email or password"
        });
      }

      return createAuthResponse(
        { ...user, sessionVersion: login.sessionVersion },
        env.JWT_SECRET ?? ""
      );
    } catch {
      return reply.code(500).send({
        message: "login failed"
      });
    }
  });

  server.post(
    "/auth/verify-email",
    {
      schema: {
        body: {
          type: "object",
          required: ["token"],
          additionalProperties: false,
          properties: {
            token: { type: "string" }
          }
        }
      },
      attachValidation: true
    },
    async (request, reply) => {
      if (request.validationError) {
        return sendEmailVerificationTokenInvalid(reply);
      }

      const token = isRecord(request.body) ? request.body.token : undefined;
      const tokenHash = hashEmailVerificationToken(token);
      if (tokenHash === null) {
        return sendEmailVerificationTokenInvalid(reply);
      }

      try {
        const result = await store.consumeEmailVerificationToken({
          tokenHash,
          now: new Date()
        });

        if (result.status === "VERIFIED") {
          return reply
            .header("Cache-Control", "no-store")
            .code(200)
            .send({ status: "VERIFIED" });
        }

        if (result.status === "ALREADY_VERIFIED") {
          return reply
            .header("Cache-Control", "no-store")
            .code(200)
            .send({ status: "ALREADY_VERIFIED" });
        }

        return sendEmailVerificationTokenInvalid(reply);
      } catch {
        return reply
          .header("Cache-Control", "no-store")
          .code(500)
          .send({ message: "email verification failed" });
      }
    }
  );

  server.post(
    "/auth/resend-email-verification",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: {
            email: { type: "string" }
          }
        }
      },
      attachValidation: true
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send({
          message: "valid email is required"
        });
      }

      const body = parseEmailVerificationResendRequest(request.body);
      if (!body || !isEmail(body.email)) {
        return reply.code(400).send({
          message: "valid email is required"
        });
      }

      const ipKey = `email-verification-resend:ip:${resolveClientIp(request)}`;
      if (
        await enforceRateLimit({
          request,
          reply,
          rateLimiter,
          key: ipKey,
          policy: emailVerificationResendIpRateLimit,
          routeIdentifier: "POST /auth/resend-email-verification",
          rejection: emailVerificationResendRateLimitRejection
        })
      ) {
        return reply;
      }

      const emailHash = hashEmailVerificationResendEmail(body.email, jwtSecret);
      if (
        await enforceRateLimit({
          request,
          reply,
          rateLimiter,
          key: `email-verification-resend:email-cooldown:${emailHash}`,
          policy: emailVerificationResendEmailCooldownRateLimit,
          routeIdentifier: "POST /auth/resend-email-verification",
          rejection: emailVerificationResendRateLimitRejection
        })
      ) {
        return reply;
      }

      if (
        await enforceRateLimit({
          request,
          reply,
          rateLimiter,
          key: `email-verification-resend:email-day:${emailHash}`,
          policy: emailVerificationResendEmailDailyRateLimit,
          routeIdentifier: "POST /auth/resend-email-verification",
          rejection: emailVerificationResendRateLimitRejection
        })
      ) {
        return reply;
      }

      try {
        const { rawToken, tokenHash } = createEmailVerificationToken();
        const expiresAt = createEmailVerificationExpiry();
        const result = await store.rotateEmailVerificationTokenForEmail({
          email: body.email,
          tokenHash,
          expiresAt
        });

        if (result.status === "ISSUED") {
          await sendEmailVerificationMail({
            operation: "resend",
            to: body.email,
            rawToken,
            expiresAt
          });
        }

        return sendEmailVerificationPending(reply);
      } catch {
        return reply.code(500).send({
          message: "email verification resend failed"
        });
      }
    }
  );

  server.post("/auth/request-password-reset", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const body = parsePasswordResetRequest(request.body);
    if (!body || !isEmail(body.email)) {
      return reply.code(400).send({
        message: "valid email is required"
      });
    }

    const ipKey = `password-reset-request:ip:${resolveClientIp(request)}`;
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: ipKey,
        policy: passwordResetRequestIpRateLimit,
        routeIdentifier: "POST /auth/request-password-reset",
        rejection: passwordResetRateLimitRejection
      })
    ) {
      return reply;
    }

    const emailHash = hashPasswordResetRequestEmail(body.email, jwtSecret);
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: `password-reset-request:email-cooldown:${emailHash}`,
        policy: passwordResetRequestEmailCooldownRateLimit,
        routeIdentifier: "POST /auth/request-password-reset",
        rejection: passwordResetRateLimitRejection
      })
    ) {
      return reply;
    }

    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: `password-reset-request:email-day:${emailHash}`,
        policy: passwordResetRequestEmailDailyRateLimit,
        routeIdentifier: "POST /auth/request-password-reset",
        rejection: passwordResetRateLimitRejection
      })
    ) {
      return reply;
    }

    try {
      const now = new Date();
      const { rawToken, tokenHash } = createPasswordResetToken();
      const expiresAt = createPasswordResetExpiry(now);
      const result = await store.rotatePasswordResetTokenForEmail({
        email: body.email,
        tokenHash,
        expiresAt,
        now
      });

      if (result.status === "ISSUED") {
        await sendPasswordResetMail({
          to: result.email,
          rawToken,
          expiresAt
        });
      }
    } catch (error) {
      server.log.warn({
        event: "password_reset_request_failed",
        operation: "request",
        errorName: safeErrorName(error)
      });
    }

    return sendPasswordResetPending(reply);
  });

  server.post("/auth/reset-password", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const body = parsePasswordResetConsumeRequest(request.body);
    const ipKey = `password-reset-consume:ip:${resolveClientIp(request)}`;
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: ipKey,
        policy: passwordResetConsumeIpRateLimit,
        routeIdentifier: "POST /auth/reset-password",
        rejection: passwordResetConsumeRateLimitRejection
      })
    ) {
      return reply;
    }

    const tokenHash = hashPasswordResetToken(body?.token);
    if (tokenHash === null) {
      return sendPasswordResetTokenInvalid(reply);
    }

    const passwordValidation = validatePasswordForSet(body?.password);
    if (passwordValidation === "INVALID_TYPE") {
      return reply.code(400).send({
        message: "valid email is required"
      });
    }
    if (passwordValidation === "TOO_SHORT") {
      return reply.code(400).send({
        message: "password must be at least 8 characters"
      });
    }
    if (passwordValidation === "TOO_LONG") {
      return reply.code(400).send({
        message: "password must be at most 72 bytes"
      });
    }

    try {
      const passwordHash = await hashPassword(body!.password as string);
      const result = await store.consumePasswordResetToken({
        tokenHash,
        passwordHash,
        now: new Date()
      });

      if (result.status === "RESET") {
        return reply.code(200).send(passwordResetCompleteResponse);
      }

      return sendPasswordResetTokenInvalid(reply);
    } catch {
      return reply.code(500).send({
        message: "password reset failed"
      });
    }
  });

  server.post("/auth/change-password", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const user = await authenticate(request, reply);
    if (!user) {
      return reply;
    }

    const body = parseChangePasswordRequest(request.body);
    if (
      !body ||
      typeof body.currentPassword !== "string" ||
      typeof body.newPassword !== "string"
    ) {
      return reply.code(400).send({
        code: "CHANGE_PASSWORD_INVALID_REQUEST",
        message: "Current password and new password are required."
      });
    }

    if (validatePasswordForSet(body.newPassword) !== "VALID") {
      return reply.code(400).send({
        code: "NEW_PASSWORD_INVALID",
        message: "New password does not meet password requirements."
      });
    }

    if (
      body.currentPassword.length === 0 ||
      Buffer.byteLength(body.currentPassword, "utf8") > 72
    ) {
      return reply.code(400).send({
        code: "CURRENT_PASSWORD_INVALID",
        message: "Current password is incorrect."
      });
    }

    const ipKey = `auth-change-password:ip:${resolveClientIp(request)}`;
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: ipKey,
        policy: changePasswordIpRateLimit,
        routeIdentifier: "POST /auth/change-password",
        rejection: changePasswordRateLimitRejection
      })
    ) {
      return reply;
    }

    const userKey = `auth-change-password:user:${user.id}`;
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: userKey,
        policy: changePasswordUserRateLimit,
        routeIdentifier: "POST /auth/change-password",
        rejection: changePasswordRateLimitRejection
      })
    ) {
      return reply;
    }

    try {
      const passwordMatches = await verifyPasswordWithTimingProtection(
        body.currentPassword,
        user.passwordHash
      );
      if (!passwordMatches) {
        return reply.code(400).send({
          code: "CURRENT_PASSWORD_INVALID",
          message: "Current password is incorrect."
        });
      }

      if (body.newPassword === body.currentPassword) {
        return reply.code(400).send({
          code: "NEW_PASSWORD_MUST_DIFFER",
          message: "New password must be different from the current password."
        });
      }

      const passwordHash = await hashPassword(body.newPassword);
      const result = await store.changePasswordForUser({
        userId: user.id,
        expectedSessionVersion: user.sessionVersion,
        expectedPasswordHash: user.passwordHash,
        passwordHash,
        now: new Date()
      });

      if (result.status === "STALE_AUTH_STATE") {
        return reply.code(401).send({
          message: "authentication required"
        });
      }

      return reply.code(200).send({ status: "PASSWORD_CHANGED" });
    } catch {
      return reply.code(500).send({
        message: "password change failed"
      });
    }
  });

  server.post("/auth/revoke-sessions", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const user = await authenticate(request, reply);
    if (!user) {
      return reply;
    }

    const ipKey = `auth-revoke-sessions:ip:${resolveClientIp(request)}`;
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: ipKey,
        policy: revokeSessionsIpRateLimit,
        routeIdentifier: "POST /auth/revoke-sessions",
        rejection: revokeSessionsRateLimitRejection
      })
    ) {
      return reply;
    }

    const userKey = `auth-revoke-sessions:user:${user.id}`;
    if (
      await enforceRateLimit({
        request,
        reply,
        rateLimiter,
        key: userKey,
        policy: revokeSessionsUserRateLimit,
        routeIdentifier: "POST /auth/revoke-sessions",
        rejection: revokeSessionsRateLimitRejection
      })
    ) {
      return reply;
    }

    try {
      const result = await store.revokeUserSessions({
        userId: user.id,
        expectedSessionVersion: user.sessionVersion
      });

      if (result.status === "STALE_AUTH_STATE") {
        return reply.code(401).send({
          message: "authentication required"
        });
      }

      return reply.code(200).send({ status: "SESSIONS_REVOKED" });
    } catch {
      return reply.code(500).send({
        message: "session revocation failed"
      });
    }
  });

  server.get("/auth/me", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    return {
      user: toAuthUser(user)
    };
  });

  server.get("/account/overview", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    void reply.header("Cache-Control", "no-store");
    const benefits = await resolveAccountBenefits();
    const todayDate = resolveGuestUsageDate();
    if (store.getAccountOverview) {
      return store.getAccountOverview(user.id, benefits, todayDate);
    }
    const [quota, orders] = await Promise.all([
      store.getQuota(user.id),
      store.listOrdersForUser(user.id)
    ]);
    const latestPaid = orders.find((order) => order.status === "PAID");
    const fallback: AccountOverview = {
      profile: toAuthUser(user),
      quota: { remainingCredits: Math.max(0, quota.remainingCredits) },
      plan: {
        name: latestPaid?.planName ?? DEFAULT_BASE_PLAN_NAME,
        status: latestPaid ? "ACTIVE" : "INACTIVE",
        expiresAt: null,
        nextBillingAt: null
      },
      storagePackage: {
        enabled: benefits.storagePackageEnabled,
        status: "INACTIVE",
        priceCredits: benefits.storagePackagePriceCredits,
        durationDays: benefits.storagePackageDurationDays,
        autoRenewEnabled: false,
        autoRenewAvailable: benefits.storagePackageAutoRenewEnabled,
        description: benefits.storagePackageDescription,
        startsAt: null,
        expiresAt: null
      },
      checkIn: {
        enabled: benefits.checkInEnabled,
        todayDate,
        todayCheckedIn: false,
        currentStreak: 0,
        dailyRewardCredits: benefits.checkInDailyRewardCredits,
        streakRewards: benefits.checkInStreakRewards,
        checkedDates: []
      },
      referral: {
        enabled: benefits.referralEnabled,
        code: null,
        invitedCount: 0,
        totalRewardCredits: 0,
        inviterRewardCredits: benefits.referralInviterRewardCredits,
        inviteeRewardCredits: benefits.referralInviteeRewardCredits,
        rewardTrigger: benefits.referralRewardTrigger,
        rulesText: benefits.referralRulesText,
        registrationIntegration: "PREPARATION"
      },
      activities: orders.slice(0, 10).map((order) => ({
        id: `order:${order.id}`,
        kind: "ORDER",
        title: order.planName,
        status: order.status === "PAID" ? "SUCCESS" : order.status === "CANCELLED" ? "FAILED" : "PENDING",
        amount: order.amount,
        creditsDelta: order.status === "PAID" ? order.credits : 0,
        createdAt: order.createdAt,
        completedAt: order.paidAt
      })),
      benefits
    };
    return fallback;
  });

  server.patch("/account/profile", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    if (!isRecord(request.body)) {
      return reply.code(400).send({
        code: "INVALID_PROFILE_INPUT",
        message: "profile update is required"
      });
    }
    const allowed = new Set(["name", "nickname", "avatarUrl"]);
    if (Object.keys(request.body).some((key) => !allowed.has(key))) {
      return reply.code(400).send({
        code: "INVALID_PROFILE_INPUT",
        message: "profile field is not allowed"
      });
    }
    const rawName = request.body.nickname ?? request.body.name;
    const input: { name?: string; avatarUrl?: string | null } = {};
    if (rawName !== undefined) {
      const name = parseProfileNickname(rawName);
      if (!name) {
        return reply.code(400).send({
          code: "INVALID_PROFILE_INPUT",
          message: "nickname must be between 2 and 30 characters and contain no control characters"
        });
      }
      input.name = name;
    }
    if ("avatarUrl" in request.body) {
      if (request.body.avatarUrl !== null && typeof request.body.avatarUrl !== "string") {
        return reply.code(400).send({
          code: "INVALID_PROFILE_INPUT",
          message: "avatarUrl must be a string or null"
        });
      }
      const avatarUrl = typeof request.body.avatarUrl === "string" ? request.body.avatarUrl.trim() : null;
      if (avatarUrl !== null && !isSafeAvatarUrl(avatarUrl)) {
        return reply.code(400).send({
          code: "INVALID_PROFILE_INPUT",
          message: "avatarUrl must be a valid http or https URL no longer than 2048 characters"
        });
      }
      input.avatarUrl = avatarUrl;
    }
    if (Object.keys(input).length === 0) {
      return reply.code(400).send({
        code: "INVALID_PROFILE_INPUT",
        message: "profile update is required"
      });
    }

    const profileRateLimits = await resolveProfileRateLimitSettings();
    if (profileRateLimits.enabled) {
      if (
        input.name !== undefined &&
        await enforceProfileRateLimit({
          request,
          reply,
          userId: user.id,
          kind: "nickname",
          limit: profileRateLimits.nicknameDailyLimit
        })
      ) {
        return reply;
      }
      if (
        input.avatarUrl !== undefined &&
        await enforceProfileRateLimit({
          request,
          reply,
          userId: user.id,
          kind: "avatar",
          limit: profileRateLimits.avatarDailyLimit
        })
      ) {
        return reply;
      }
    }

    if (input.avatarUrl === undefined) {
      try {
        const updated = await store.updateUserProfile(user.id, input);
        return updated
          ? { user: toAuthUser(updated) }
          : reply.code(404).send({ message: "user not found" });
      } catch {
        return reply.code(500).send({ message: "profile update failed" });
      }
    }

    try {
      const replacement =
        input.avatarUrl === null
          ? await store.replaceUserAvatarReference({
              kind: "CLEARED",
              userId: user.id,
              ...(input.name !== undefined
                ? { profile: { name: input.name } }
                : {})
            })
          : await store.replaceUserAvatarReference({
              kind: "EXTERNAL_URL",
              userId: user.id,
              avatarUrl: input.avatarUrl,
              ...(input.name !== undefined
                ? { profile: { name: input.name } }
                : {})
            });

      if (replacement.status === "NOT_FOUND") {
        return reply.code(404).send({ message: "user not found" });
      }
      if (replacement.status !== "UPDATED") {
        return reply.code(500).send({ message: "profile update failed" });
      }

      await markReplacedAvatarStorageObjectDeleted({
        store,
        userId: user.id,
        storageObjectId: replacement.replacedStorageObjectId
      });
      return { user: toAuthUser(replacement.user) };
    } catch {
      return reply.code(500).send({ message: "profile update failed" });
    }
  });

  server.post("/account/avatar", { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    if (
      !isRecord(request.body) ||
      !isValidAvatarDataUrl(request.body.dataUrl)
    ) {
      return reply.code(400).send({
        code: "INVALID_AVATAR_INPUT",
        message: "avatar data is invalid"
      });
    }

    const profileRateLimits = await resolveProfileRateLimitSettings();
    if (
      profileRateLimits.enabled &&
      await enforceProfileRateLimit({
        request,
        reply,
        userId: user.id,
        kind: "avatar",
        limit: profileRateLimits.avatarDailyLimit
      })
    ) {
      return reply;
    }
    try {
      const persisted =
        await localStorageObjectService.persistLocalImageStorageObject({
          userId: user.id,
          source: StorageObjectSource.UPLOAD,
          dataUrl: request.body.dataUrl.trim(),
          maxBytes: MAX_AVATAR_DATA_URL_BYTES
        });
      const replacement = await store.replaceUserAvatarReference({
        kind: "LOCAL_STORAGE_OBJECT",
        userId: user.id,
        avatarUrl: persisted.publicUrl,
        storageObjectId: persisted.storageObjectId
      });

      if (replacement.status !== "UPDATED") {
        return reply.code(400).send({
          code: "INVALID_AVATAR_INPUT",
          message: "avatar data is invalid"
        });
      }

      await markReplacedAvatarStorageObjectDeleted({
        store,
        userId: user.id,
        storageObjectId: replacement.replacedStorageObjectId
      });
      return { user: toAuthUser(replacement.user) };
    } catch {
      request.log.warn(
        { route: "POST /account/avatar", errorType: "AvatarStorageError" },
        "avatar upload rejected"
      );
      return reply.code(400).send({
        code: "INVALID_AVATAR_INPUT",
        message: "avatar data is invalid"
      });
    }
  });

  server.get("/account/avatar/content", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const sendNotFound = () =>
      reply.code(404).send({
        message: "avatar not found"
      });

    try {
      const storageObjectId = user.avatarStorageObjectId;

      if (
        typeof storageObjectId !== "string" ||
        storageObjectId.trim().length === 0
      ) {
        return sendNotFound();
      }

      const storageObject = await store.findReadyStorageObjectForUser(
        user.id,
        storageObjectId
      );

      if (
        !storageObject ||
        !isReadyLocalAvatarStorageObject(
          storageObject,
          user.id,
          storageObjectId
        )
      ) {
        return sendNotFound();
      }

      const content =
        await assetContentService.openLocalStorageObjectContent({
          objectKey: storageObject.objectKey,
          expectedSizeBytes: storageObject.sizeBytes
        });

      return reply
        .header("Content-Type", storageObject.mimeType)
        .header("Content-Length", content.sizeBytes)
        .header("Content-Disposition", "inline")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store")
        .header("Vary", "Authorization")
        .send(content.stream);
    } catch {
      return sendNotFound();
    }
  });

  server.post("/account/storage-package/activate", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const benefits = await resolveAccountBenefits();
    if (!benefits.storagePackageEnabled) return reply.code(403).send({ message: "storage package is disabled" });
    if (!store.activateStoragePackage) return reply.code(503).send({ message: "storage package is unavailable" });
    const idempotencyKey = request.headers["idempotency-key"] || (isRecord(request.body) && request.body.idempotencyKey);
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length < 8 || idempotencyKey.length > 191) {
      return reply.code(400).send({ message: "idempotency key is required" });
    }
    try {
      const result = await store.activateStoragePackage(user.id, {
        priceCredits: benefits.storagePackagePriceCredits,
        durationDays: benefits.storagePackageDurationDays,
        description: benefits.storagePackageDescription,
        autoRenewEnabled: benefits.storagePackageAutoRenewEnabled,
        idempotencyKey: idempotencyKey.trim()
      });
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "INSUFFICIENT_CREDITS") {
        return reply.code(402).send({ message: "insufficient credits" });
      }
      if (error instanceof Error && error.message === "IDEMPOTENCY_KEY_ALREADY_USED") {
        return reply.code(409).send({ message: "idempotency key is already used" });
      }
      throw error;
    }
  });

  server.patch("/account/storage-package/auto-renew", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    void reply.header("Cache-Control", "no-store");
    const benefits = await resolveAccountBenefits();
    if (!benefits.storagePackageAutoRenewEnabled) {
      return reply.code(403).send({ message: "auto-renewal is not available" });
    }
    if (!store.setStorageAutoRenew) return reply.code(503).send({ message: "storage auto-renewal is unavailable" });
    if (!isRecord(request.body) || typeof request.body.enabled !== "boolean") {
      return reply.code(400).send({ message: "enabled must be a boolean" });
    }
    const result = await store.setStorageAutoRenew(user.id, request.body.enabled, benefits);
    if (!result) {
      return reply.code(409).send({ message: "storage package not found" });
    }
    return { storagePackage: result };
  });

  server.get("/account/check-in", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const overview = store.getAccountOverview
      ? await store.getAccountOverview(user.id, await resolveAccountBenefits(), resolveGuestUsageDate())
      : null;
    return { checkIn: overview?.checkIn ?? null };
  });

  server.post("/account/check-in", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const benefits = await resolveAccountBenefits();
    if (!benefits.checkInEnabled) return reply.code(403).send({ message: "check-in is disabled" });
    if (!store.claimDailyCheckIn) return reply.code(503).send({ message: "check-in is unavailable" });
    try {
      return await store.claimDailyCheckIn(user.id, {
        dateKey: resolveGuestUsageDate(),
        dailyRewardCredits: benefits.checkInDailyRewardCredits,
        streakRewards: benefits.checkInStreakRewards
      });
    } catch (error) {
      throw error;
    }
  });

  server.get("/account/referral", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const overview = store.getAccountOverview
      ? await store.getAccountOverview(user.id, await resolveAccountBenefits(), resolveGuestUsageDate())
      : null;
    return { referral: overview?.referral ?? null };
  });

  server.get("/account/activities", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    if (!store.listAccountActivities) return reply.code(503).send({ message: "activities endpoint is unavailable" });
    const rawPage = Number((request.query as Record<string, unknown>)?.page ?? 1);
    const rawPageSize = Number((request.query as Record<string, unknown>)?.pageSize ?? 20);
    return store.listAccountActivities(user.id, rawPage, rawPageSize);
  });

  server.get("/account/activity", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return reply;
    const overview = store.getAccountOverview
      ? await store.getAccountOverview(user.id, await resolveAccountBenefits(), resolveGuestUsageDate())
      : null;
    if (overview) return { activities: overview.activities };
    const orders = await store.listOrdersForUser(user.id);
    return {
      activities: orders.slice(0, 10).map((order) => ({
        id: `order:${order.id}`,
        kind: "ORDER" as const,
        title: order.planName,
        status: order.status === "PAID" ? "SUCCESS" as const : order.status === "CANCELLED" ? "FAILED" as const : "PENDING" as const,
        amount: order.amount,
        creditsDelta: order.status === "PAID" ? order.credits : 0,
        createdAt: order.createdAt,
        completedAt: order.paidAt
      }))
    };
  });

  server.get("/public/account-benefits", async () => ({
    benefits: await resolveAccountBenefits()
  }));

  server.get<{ Querystring: { capability?: string; surface?: string } }>("/models", async (request, reply) => {
    const capability = request.query.capability ?? undefined;
    const surface = request.query.surface ?? undefined;

    if (capability !== undefined && !isModelCapability(capability)) {
      return reply.code(400).send({
        message: "valid model capability is required"
      });
    }

    if (surface !== undefined && !isModelDisplaySurface(surface)) {
      return reply.code(400).send({
        message: "valid model display surface is required"
      });
    }

    const enabledModels = await store.listEnabledModels({ capability, surface });
    const publicModels: Array<PublicAiModelSummary | PublicVideoModelSummary> = [];

    for (const model of enabledModels) {
      if (model.capability !== "video") {
        publicModels.push(toPublicAiModelSummary(model));
        continue;
      }

      if (!normalizeModelDisplaySurfaces(model.displaySurfaces, model.capability).includes("video")) {
        continue;
      }

      let attempts: VideoProviderRouteAttempt[] | { error: "model is not available" };
      try {
        attempts = await resolveVideoProviderAttempts(model);
      } catch {
        continue;
      }
      if ("error" in attempts) {
        continue;
      }
      const profile = attempts[0]?.profile;
      if (!profile) {
        continue;
      }

      publicModels.push({
        id: model.id,
        name: model.name,
        ...(model.displayName ? { displayName: model.displayName } : {}),
        slug: model.slug,
        capability: "video",
        displaySurfaces: ["video"],
        group: model.group,
        tags: model.tags,
        ...(model.shortDescription
          ? { shortDescription: model.shortDescription }
          : {}),
        ...(model.description ? { description: model.description } : {}),
        enabled: true,
        creditCost: model.creditCost,
        allowGuest: model.allowGuest,
        sortOrder: model.sortOrder,
        isRecommended: model.isRecommended,
        videoProfile: {
          id: profile.id,
          supportsTextToVideo: profile.supportsTextToVideo,
          supportsImageToVideo: profile.supportsImageToVideo,
          durationSeconds: profile.durationSeconds,
          resolution: profile.resolution,
          aspectRatio: profile.aspectRatio
        }
      });
    }

    return { models: publicModels };
  });

  server.get("/plans", async () => {
    return {
      plans: await store.listEnabledPlans()
    };
  });

  server.get("/settings/public", async () => {
    return {
      settings: await buildPublicSettings()
    };
  });

  server.get("/links", async () => {
    return {
      links: await store.listPublicLinks()
    };
  });

  server.post("/feedback", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    if (!isRecord(request.body) || !isNonEmptyString(request.body.content)) {
      return reply.code(400).send({
        message: "feedback content is required"
      });
    }

    const type =
      typeof request.body.type === "string" &&
      ["problem", "feature", "consultation", "other"].includes(
        request.body.type
      )
        ? request.body.type
        : "other";

    const screenshotUrlValidation = validateFeedbackScreenshotUrl(
      request.body.screenshotUrl
    );
    if (!screenshotUrlValidation.valid) {
      return reply.code(400).send({
        code: "FEEDBACK_SCREENSHOT_URL_INVALID",
        message: "截图链接格式不正确"
      });
    }

    const feedbackKey = `feedback:user:${user.id}`;
    if (await enforceRateLimit({ request, reply, rateLimiter, key: feedbackKey,
      policy: RATE_LIMITS.feedback, routeIdentifier: "POST /feedback" })) return reply;

    const feedback = await store.createFeedback({
      userId: user.id,
      userEmail: user.email,
      type,
      content: request.body.content.trim(),
      screenshotUrl: screenshotUrlValidation.value
    });

    return { feedback };
  });

  server.post("/orders", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const ordersKey = `orders:user:${user.id}`;
    if (await enforceRateLimit({ request, reply, rateLimiter, key: ordersKey,
      policy: RATE_LIMITS.ordersCreate, routeIdentifier: "POST /orders" })) return reply;

    if (!isRecord(request.body) || !isNonEmptyString(request.body.planId)) {
      return reply.code(400).send({
        message: "planId is required"
      });
    }

    const order = await store.createOrder({
      userId: user.id,
      planId: request.body.planId.trim()
    });

    if (!order) {
      return reply.code(400).send({
        message: "plan is not available"
      });
    }

    return { order };
  });

  server.get("/orders/me", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    return {
      orders: await store.listOrdersForUser(user.id)
    };
  });

  server.post<{
    Params: { id: string };
  }>("/orders/:id/cancel", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    if (!isValidOrderRouteId(request.params.id)) {
      return reply.code(400).send({
        message: "invalid order id"
      });
    }

    if (
      request.body !== undefined &&
      request.body !== null &&
      (!isRecord(request.body) || Object.keys(request.body).length > 0)
    ) {
      return reply.code(400).send({
        message: "request body must be empty"
      });
    }

    const cancelKey = `cancel-order:user:${user.id}`;
    if (await enforceRateLimit({ request, reply, rateLimiter, key: cancelKey,
      policy: RATE_LIMITS.orderPay, routeIdentifier: "POST /orders/:id/cancel" })) return reply;

    const result = await store.cancelPendingOrderForUser({
      orderId: request.params.id,
      userId: user.id
    });

    if (result.status === "CANCELLED") {
      return {
        order: result.order,
        alreadyCancelled: result.alreadyCancelled
      };
    }

    if (result.status === "ORDER_PAID_CANNOT_BE_CANCELLED") {
      return reply.code(409).send({
        message: "paid orders cannot be cancelled"
      });
    }

    if (result.status === "NOT_FOUND_OR_NOT_OWNED") {
      return reply.code(404).send({
        message: "order not found"
      });
    }

    return reply.code(409).send({
      message: "order cancellation is currently unavailable"
    });
  });

  server.get("/payments/epay/status", async () => {
    const safeConfig = epaySafeConfig(await getEffectiveEpayConfig());

    return {
      enabled: safeConfig.enabled,
      misconfigured: safeConfig.misconfigured,
      missingFields: safeConfig.missingFields,
      paymentMethods: await resolveAllowedPaymentTypes()
    };
  });

  server.post<{
    Params: { id: string };
  }>(
    "/orders/:id/pay",
    async (request, reply): Promise<EpayPaymentResponse | FastifyReply> => {
      const user = await authenticate(request, reply);

      if (!user) {
        return reply;
      }

      const payKey = `pay:user:${user.id}`;
      if (await enforceRateLimit({ request, reply, rateLimiter, key: payKey,
        policy: RATE_LIMITS.orderPay, routeIdentifier: "POST /orders/:id/pay" })) return reply;

      // Validate and resolve the order
      const order = await store.findOrderById(request.params.id);

      if (!order) {
        return reply.code(404).send({
          message: "order not found"
        });
      }

      if (order.userId !== user.id) {
        return reply.code(403).send({
          message: "you can only pay your own orders"
        });
      }

      if (order.status !== "PENDING") {
        return reply.code(400).send({
          message: order.status === "PAID"
            ? "order is already paid"
            : "cancelled orders cannot be paid"
        });
      }

      // Validate EPay configuration (DB first, env fallback)
      const epayConfig = await getEffectiveEpayConfig();
      const safeConfig = epaySafeConfig(epayConfig);

      if (!safeConfig.enabled) {
        return reply.code(503).send({
          message: safeConfig.misconfigured
            ? "payment provider is not fully configured"
            : "payment is currently disabled"
        });
      }

      // Parse an optional requested payment type before branching between a
      // first payment and recovery of an existing Provider session.
      let requestedPaymentType: EpayPaymentType | undefined;

      if (isRecord(request.body) && "paymentType" in request.body) {
        if (!isEpayPaymentType(request.body.paymentType)) {
          return reply.code(400).send({
            message: "unsupported payment type"
          });
        }

        requestedPaymentType = request.body.paymentType;
      }

      const existingPaymentTradeNo =
        typeof order.paymentTradeNo === "string" &&
        order.paymentTradeNo.trim().length > 0
          ? order.paymentTradeNo
          : null;
      const allowedPaymentTypes = await resolveAllowedPaymentTypes();

      if (existingPaymentTradeNo !== null) {
        if (
          order.paymentProvider !== "epay" ||
          !isEpayPaymentType(order.paymentType)
        ) {
          return reply.code(502).send({
            message: "payment recovery is currently unavailable"
          });
        }

        let existingAttempt: PaymentAttemptRecord | null;
        try {
          existingAttempt =
            await store.findPaymentAttemptByMerchantTradeNo(
              existingPaymentTradeNo
            );

          if (
            existingAttempt === null &&
            (await store.findPaymentAttemptByOrderAndOrdinal(
              order.id,
              INITIAL_PAYMENT_ATTEMPT_ORDINAL
            )) !== null
          ) {
            return reply.code(502).send({
              message: "payment recovery is currently unavailable"
            });
          }
        } catch {
          return reply.code(502).send({
            message: "payment recovery is currently unavailable"
          });
        }

        let recoveryPaymentTradeNo = existingPaymentTradeNo;
        let recoveryPaymentType = order.paymentType;

        if (existingAttempt !== null) {
          if (
            order.providerTradeNo !== null ||
            order.paidAt !== null ||
            existingAttempt.orderId !== order.id ||
            existingAttempt.provider !== "epay" ||
            existingAttempt.merchantTradeNo !== existingPaymentTradeNo ||
            !isEpayPaymentType(existingAttempt.paymentType) ||
            existingAttempt.paymentType !== order.paymentType ||
            existingAttempt.status !== "ACTIVE" ||
            existingAttempt.paidAt !== null ||
            existingAttempt.providerTradeNo !== null ||
            existingAttempt.providerTradeIdentityHash !== null ||
            existingAttempt.providerMerchantRef !== epayConfig.pid
          ) {
            return reply.code(502).send({
              message: "payment recovery is currently unavailable"
            });
          }

          recoveryPaymentTradeNo = existingAttempt.merchantTradeNo;
          recoveryPaymentType = existingAttempt.paymentType;
        }

        if (!allowedPaymentTypes.includes(recoveryPaymentType)) {
          return reply.code(400).send({
            message: "unsupported payment type"
          });
        }

        if (
          requestedPaymentType !== undefined &&
          requestedPaymentType !== recoveryPaymentType
        ) {
          return reply.code(409).send({
            message: "payment type does not match existing payment session"
          });
        }

        let recovery: EpayRecoveryResult;
        try {
          recovery = await recoverExistingEpayPaymentSession({
            env,
            config: epayConfig,
            paymentTradeNo: recoveryPaymentTradeNo,
            paymentType: recoveryPaymentType,
            amountCents: order.amount,
            fetchImpl: options.fetchImpl ?? fetch
          });
        } catch {
          return reply.code(502).send({
            message: "payment recovery is currently unavailable"
          });
        }

        if (recovery.status === "PAID") {
          return reply.code(409).send({
            message:
              "payment provider reports this order as paid; wait for payment confirmation"
          });
        }

        return {
          orderId: order.id,
          paymentProvider: "epay",
          paymentType: recoveryPaymentType,
          paymentTradeNo: recoveryPaymentTradeNo,
          paymentUrl: recovery.paymentUrl
        };
      }

      // First payment keeps the existing supported/enabled method behavior.
      const paymentType = requestedPaymentType ?? "alipay";

      if (!allowedPaymentTypes.includes(paymentType)) {
        return reply.code(400).send({
          message: "unsupported payment type"
        });
      }

      const paymentTradeNo = createPaymentTradeNo(order.id);

      // Build payment URL using database values (NOT frontend input)
      const paymentUrl = buildEpayPaymentUrl(epayConfig, {
        paymentType,
        outTradeNo: paymentTradeNo,
        name: order.planName,
        moneyCents: order.amount
      });

      // Initialize Attempt A and the legacy Order compatibility mirrors in one
      // transaction. A concurrent loser may only adopt a fully consistent
      // committed winner.
      const initialized = await store.initializeInitialPaymentAttempt({
        orderId: order.id,
        provider: "epay",
        providerMerchantRef: epayConfig.pid,
        paymentType,
        merchantTradeNo: paymentTradeNo,
        paymentUrl
      });

      if (initialized.status === "ORDER_NOT_FOUND") {
        return reply.code(404).send({
          message: "order not found"
        });
      }

      if (initialized.status === "PAYMENT_REFERENCE_CONFLICT") {
        return reply.code(409).send({
          message: "payment reference conflict"
        });
      }

      if (initialized.status === "INVALID_ORDER_STATE") {
        return reply.code(400).send({
          message: "order is no longer pending"
        });
      }

      return {
        orderId: initialized.order.id,
        paymentProvider: "epay",
        paymentType,
        paymentTradeNo: initialized.order.paymentTradeNo,
        paymentUrl: initialized.order.paymentUrl
      };
    }
  );

  // -----------------------------------------------------------------------
  // EPay notify callback
  // -----------------------------------------------------------------------

  /**
   * Get the effective EPay config: DB PaymentSetting first, env as fallback.
   */
  async function resolveEffectiveEpayConfig(
    dbSetting: Awaited<ReturnType<UserStore["getPaymentSetting"]>>
  ): Promise<EpayConfig> {
    if (!dbSetting) {
      return readEpayConfig(env);
    }

    // Decrypt key if present
    let decryptedKey: string | null = null;
    const paymentSecret = env.PAYMENT_SETTINGS_SECRET?.trim();

    if (dbSetting.encryptedKey && paymentSecret) {
      decryptedKey = decryptPaymentSecret(dbSetting.encryptedKey, paymentSecret);
    }

    return readEpayConfigFromDb(
      {
        id: dbSetting.id,
        provider: dbSetting.provider,
        enabled: dbSetting.enabled,
        gatewayUrl: dbSetting.gatewayUrl,
        pid: dbSetting.pid,
        decryptedKey,
        notifyUrl: dbSetting.notifyUrl,
        returnUrl: dbSetting.returnUrl,
        createdAt: dbSetting.createdAt.toISOString(),
        updatedAt: dbSetting.updatedAt.toISOString()
      },
      env
    );
  }

  async function getEffectiveEpayConfig(): Promise<EpayConfig> {
    return resolveEffectiveEpayConfig(await store.getPaymentSetting("epay"));
  }

  async function getAdminSafeEpaySettings() {
    const dbSetting = await store.getPaymentSetting("epay");
    const effectiveConfig = await resolveEffectiveEpayConfig(dbSetting);
    const safeConfig = epaySafeConfig(effectiveConfig);

    return {
      enabled: effectiveConfig.enabled,
      gatewayUrl: dbSetting?.gatewayUrl ?? effectiveConfig.gatewayUrl,
      pid: dbSetting?.pid ?? effectiveConfig.pid,
      notifyUrl: dbSetting?.notifyUrl ?? effectiveConfig.notifyUrl,
      returnUrl: dbSetting?.returnUrl ?? effectiveConfig.returnUrl,
      paymentMethods: await resolveAllowedPaymentTypes(),
      hasKey: safeConfig.hasKey,
      source: safeConfig.source,
      misconfigured: safeConfig.misconfigured,
      missingFields: safeConfig.missingFields
    };
  }

  /**
   * Resolve only the server-side merchant identity and key needed to verify an
   * already initiated callback. This deliberately ignores the initiation
   * enabled flag and does not require navigation or payment-method settings.
   */
  async function getEpayCallbackVerificationConfig(): Promise<EpayCallbackVerificationConfig | null> {
    const dbSetting = await store.getPaymentSetting("epay");

    if (!dbSetting) {
      return readEpayCallbackVerificationConfig(null, env);
    }

    let decryptedKey: string | null = null;
    const paymentSecret = env.PAYMENT_SETTINGS_SECRET?.trim();

    if (dbSetting.encryptedKey && paymentSecret) {
      decryptedKey = decryptPaymentSecret(dbSetting.encryptedKey, paymentSecret);
    }

    return readEpayCallbackVerificationConfig(
      {
        pid: dbSetting.pid,
        decryptedKey
      },
      env
    );
  }

  async function handleEpayNotify(
    params: Record<string, string | string[] | undefined>
  ): Promise<string> {
    // 1. Parse required fields
    const notify = parseEpayNotifyParams(params);

    if (!notify) {
      return "fail";
    }

    // 2. Read callback-only verification material and verify the signature.
    // Payment identity is not looked up until after cryptographic validation.
    let callbackConfig: EpayCallbackVerificationConfig | null;
    try {
      callbackConfig = await getEpayCallbackVerificationConfig();
    } catch {
      return "fail";
    }

    if (
      callbackConfig === null ||
      !verifyEpaySignature(notify, callbackConfig.key, notify.sign)
    ) {
      return "fail";
    }

    // 3. Verify the generated signing contract and trade status
    if (notify.sign_type !== "MD5") {
      return "fail";
    }

    if (!isSuccessTradeStatus(notify.trade_status)) {
      return "fail";
    }

    // 4. Accept only protocol-supported types. The current initiation
    // allowlist must not invalidate an already initialized signed payment.
    if (!isEpayPaymentType(notify.type)) {
      return "fail";
    }

    // 5. Verify callback identity against the callback-only merchant config.
    if (notify.pid !== callbackConfig.pid) {
      return "fail";
    }

    // 6. Resolve Attempt identity first. Only Orders with no initial Attempt
    // history may use the historical legacy mirror fallback.
    let attempt: PaymentAttemptRecord | null;
    try {
      attempt = await store.findPaymentAttemptByMerchantTradeNo(
        notify.out_trade_no
      );
    } catch {
      return "fail";
    }

    let order: OrderSummary | null;

    if (attempt !== null) {
      if (
        attempt.provider !== "epay" ||
        attempt.providerMerchantRef !== notify.pid ||
        attempt.paymentType !== notify.type ||
        attempt.merchantTradeNo !== notify.out_trade_no
      ) {
        return "fail";
      }

      try {
        order = await store.findOrderById(attempt.orderId);
      } catch {
        return "fail";
      }

      if (
        order === null ||
        order.id !== attempt.orderId ||
        (order.paymentProvider !== null && order.paymentProvider !== "epay") ||
        order.paymentType !== attempt.paymentType
      ) {
        return "fail";
      }
    } else {
      try {
        order = await store.findOrderByPaymentTradeNo(notify.out_trade_no);

        if (order !== null) {
          const lifecycleAttempt =
            await store.findPaymentAttemptByOrderAndOrdinal(
              order.id,
              INITIAL_PAYMENT_ATTEMPT_ORDINAL
            );
          if (lifecycleAttempt !== null) {
            if (
              lifecycleAttempt.orderId !== order.id ||
              lifecycleAttempt.ordinal !== INITIAL_PAYMENT_ATTEMPT_ORDINAL ||
              lifecycleAttempt.provider !== "epay" ||
              lifecycleAttempt.providerMerchantRef !== notify.pid ||
              lifecycleAttempt.paymentType !== notify.type ||
              lifecycleAttempt.merchantTradeNo !== notify.out_trade_no
            ) {
              return "fail";
            }

            // A concurrent identical callback may have materialized ordinal 1
            // after the primary merchant lookup missed. Route the authoritative
            // committed Attempt through the existing settlement state machine.
            attempt = lifecycleAttempt;
          }
        }
      } catch {
        return "fail";
      }
    }

    if (!order) {
      return "fail";
    }

    // 7. Verify payment provider and the frozen/persisted payment type.
    if (order.paymentProvider && order.paymentProvider !== "epay") {
      return "fail";
    }

    if (order.paymentType !== notify.type) {
      return "fail";
    }

    // 8. Verify amount matches
    const callbackCents = convertEpayMoneyToCents(notify.money);

    if (callbackCents === null || callbackCents !== order.amount) {
      return "fail";
    }

    // 9. Attempt-backed callbacks use the atomic receipt/Order/entitlement
    // state machine. The Store authoritatively classifies winner conflicts,
    // durable review anomalies, and exact replays.
    if (attempt !== null) {
      let result: Awaited<
        ReturnType<PaymentAttemptSettlementStore["settlePaymentAttemptFromCallback"]>
      >;
      try {
        result = await store.settlePaymentAttemptFromCallback({
          provider: attempt.provider,
          providerMerchantRef: attempt.providerMerchantRef,
          paymentType: attempt.paymentType,
          merchantTradeNo: attempt.merchantTradeNo,
          providerTradeNo: notify.trade_no,
          amountCents: callbackCents,
          paidAt: new Date()
        });
      } catch (error) {
        server.log.error(
          {
            errorType: error instanceof Error ? error.name : "UnknownError"
          },
          "EPay PaymentAttempt callback settlement unavailable"
        );
        return "fail";
      }

      if (
        result.status === "PAID" ||
        result.status === "EXACT_PAID_REPLAY" ||
        result.status === "PAID_REQUIRES_REVIEW" ||
        result.status === "EXACT_REVIEW_REPLAY" ||
        result.status === "PAID_EVIDENCE_RECONCILED"
      ) {
        if (result.status === "PAID_REQUIRES_REVIEW") {
          server.log.warn(
            {
              paymentSettlementStatus: result.status,
              orderId: result.orderId,
              paymentAttemptId: result.paymentAttemptId
            },
            "EPay PaymentAttempt callback durably recorded for review"
          );
        }
        return "success";
      }

      server.log.warn(
        { paymentSettlementStatus: result.status },
        "EPay PaymentAttempt callback settlement rejected"
      );
      return "fail";
    }

    // 10. True historical legacy callbacks materialize ordinal-1 evidence and
    // settle in one Store transaction. No legacy callback may commit an ACTIVE
    // Attempt before its terminal payment result.
    let result: Awaited<
      ReturnType<
        LegacyPaymentAttemptMaterializationStore["materializeAndSettleLegacyPaymentAttemptFromCallback"]
      >
    >;
    try {
      result =
        await store.materializeAndSettleLegacyPaymentAttemptFromCallback({
          orderId: order.id,
          provider: "epay",
          providerMerchantRef: callbackConfig.pid,
          paymentType: notify.type,
          merchantTradeNo: notify.out_trade_no,
          providerTradeNo: notify.trade_no,
          amountCents: callbackCents,
          paidAt: new Date()
        });
    } catch (error) {
      server.log.error(
        {
          errorType: error instanceof Error ? error.name : "UnknownError"
        },
        "EPay historical PaymentAttempt callback settlement unavailable"
      );
      return "fail";
    }

    if (
      result.status === "PAID" ||
      result.status === "EXACT_PAID_REPLAY" ||
      result.status === "PAID_REQUIRES_REVIEW" ||
      result.status === "EXACT_REVIEW_REPLAY" ||
      result.status === "PAID_EVIDENCE_RECONCILED"
    ) {
      if (result.status === "PAID_REQUIRES_REVIEW") {
        server.log.warn(
          {
            paymentSettlementStatus: result.status,
            orderId: result.orderId,
            paymentAttemptId: result.paymentAttemptId
          },
          "EPay historical PaymentAttempt callback durably recorded for review"
        );
      }
      return "success";
    }

    server.log.warn(
      { paymentSettlementStatus: result.status },
      "EPay historical PaymentAttempt callback settlement rejected"
    );
    return "fail";
  }

  server.post("/payments/epay/notify", async (request, reply) => {
    let body: Record<string, string | string[] | undefined> | undefined;

    // EPay sends application/x-www-form-urlencoded; Fastify may parse it
    // as a JSON-like object if @fastify/formbody is registered, or keep it
    // as a raw buffer. Handle both cases.
    if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
      body = request.body as Record<string, string | string[] | undefined>;
    } else {
      // Try to parse the raw body as URL-encoded form data
      const raw = request.body as string | Buffer | undefined;
      if (typeof raw === "string" && raw.trim().length > 0) {
        const searchParams = new URLSearchParams(raw);
        body = Object.fromEntries(searchParams.entries());
      } else if (Buffer.isBuffer(raw) && raw.length > 0) {
        const searchParams = new URLSearchParams(raw.toString("utf8"));
        body = Object.fromEntries(searchParams.entries());
      }
    }

    if (!body || typeof body !== "object") {
      return reply.type("text/plain").send("fail");
    }

    const result = await handleEpayNotify(body);
    return reply.type("text/plain").send(result);
  });

  server.get("/payments/epay/notify", async (request, reply) => {
    const query = request.query as Record<string, string | string[] | undefined> | undefined;

    if (!query || typeof query !== "object") {
      return reply.type("text/plain").send("fail");
    }

    const result = await handleEpayNotify(query);
    return reply.type("text/plain").send(result);
  });

  // -----------------------------------------------------------------------
  // Admin payment settings
  // -----------------------------------------------------------------------

  server.get("/admin/payment-settings/epay", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    return getAdminSafeEpaySettings();
  });

  server.patch("/admin/payment-settings/epay", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({ message: "valid fields are required" });
    }

    const body = request.body as Record<string, unknown>;

    const enabled =
      typeof body.enabled === "boolean" ? body.enabled : undefined;
    const gatewayUrl =
      typeof body.gatewayUrl === "string" ? body.gatewayUrl.trim() : undefined;
    const pid =
      typeof body.pid === "string" ? body.pid.trim() : undefined;
    const notifyUrl =
      typeof body.notifyUrl === "string" ? body.notifyUrl.trim() : undefined;
    const returnUrl =
      typeof body.returnUrl === "string" ? body.returnUrl.trim() : undefined;
    const newKey =
      typeof body.key === "string" ? body.key.trim() : undefined;
    const paymentMethods =
      "paymentMethods" in body
        ? normalizeEpayPaymentTypes(body.paymentMethods)
        : undefined;

    // Resolve encrypted key
    let encryptedKey: string | null | undefined;

    if (newKey !== undefined && newKey.length > 0) {
      const paymentSecret = env.PAYMENT_SETTINGS_SECRET?.trim();

      if (!paymentSecret) {
        return reply.code(400).send({
          message: "payment settings secret is not configured"
        });
      }

      encryptedKey = encryptPaymentSecret(newKey, paymentSecret);
    } else if (newKey !== undefined && newKey.length === 0) {
      // Empty key: keep existing
      encryptedKey = undefined;
    } else {
      // Omitted: keep existing
      encryptedKey = undefined;
    }

    const preservedEnabled =
      enabled ?? (await getEffectiveEpayConfig()).enabled;
    const updated = await store.upsertPaymentSetting("epay", {
      enabled: preservedEnabled,
      ...(gatewayUrl !== undefined ? { gatewayUrl } : {}),
      ...(pid !== undefined ? { pid } : {}),
      ...(encryptedKey !== undefined ? { encryptedKey } : {}),
      ...(notifyUrl !== undefined ? { notifyUrl } : {}),
      ...(returnUrl !== undefined ? { returnUrl } : {})
    });

    if (paymentMethods) {
      await store.updateSettings([
        {
          key: "paymentMethods",
          value: JSON.stringify(paymentMethods),
          type: "json",
          description: "Allowed EPay payment methods"
        }
      ]);
    }

    // Audit log (safe fields only)
    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "UPDATE_PAYMENT_SETTINGS",
      targetType: "PaymentSetting",
      targetId: updated.id,
      summary: `Admin updated EPay payment settings.`,
      metadata: {
        enabled: updated.enabled,
        gatewayUrlChanged: gatewayUrl !== undefined,
        pidChanged: pid !== undefined,
        notifyUrlChanged: notifyUrl !== undefined,
        returnUrlChanged: returnUrl !== undefined,
        paymentMethodsChanged: paymentMethods !== undefined,
        keyUpdated: newKey !== undefined && newKey.length > 0
      }
    });

    return getAdminSafeEpaySettings();
  });

  server.get("/admin/moderation", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    try {
      const settings = await readAdminModerationSettings();
      return { settings: await toAdminModerationSettings(settings) };
    } catch {
      return reply.code(503).send({
        message: "moderation settings are unavailable",
        code: "MODERATION_SETTINGS_UNAVAILABLE"
      });
    }
  });

  server.get("/admin/moderation/cache", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    try {
      await syncModerationInputCacheSettings();
      return moderationInputCache.status();
    } catch {
      return reply.code(503).send({
        message: "moderation cache settings are unavailable",
        code: "IMAGE_MODERATION_CACHE_SETTINGS_UNAVAILABLE"
      });
    }
  });

  server.get("/admin/moderation/circuit-breaker", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    try {
      await syncModerationRouteCircuitBreakerSettings();
      return reply.header("Cache-Control", "no-store").send(
        moderationRouteCircuitBreaker.status()
      );
    } catch {
      return reply.code(503).send({
        message: "moderation circuit breaker settings are unavailable",
        code: "IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_UNAVAILABLE"
      });
    }
  });

  server.put(
    "/admin/moderation/circuit-breaker/settings",
    async (request, reply) => {
      const admin = await authenticateAdmin(request, reply);
      if (!admin) {
        return reply;
      }

      const input = parseModerationRouteCircuitBreakerSettingsRequest(
        request.body
      );
      if (!input) {
        return reply.code(400).send({
          message: "valid complete moderation circuit breaker settings are required",
          code: "IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_INVALID"
        });
      }

      try {
        await store.updateSettingAtomically({
          key: IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_KEY,
          create: {
            key: IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_KEY,
            value: JSON.stringify(DEFAULT_MODERATION_ROUTE_CIRCUIT_BREAKER_SETTINGS),
            type: "json",
            description: moderationCircuitBreakerSettingsDescription
          },
          update: (current) => {
            if (current) {
              parseModerationRouteCircuitBreakerSettings(current.value);
            }
            return {
              key: IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_KEY,
              value: JSON.stringify(input),
              type: "json",
              description: moderationCircuitBreakerSettingsDescription
            };
          }
        });
        const appliedSettings =
          await applyCommittedModerationRouteCircuitBreakerSettings();
        const status = moderationRouteCircuitBreaker.status();
        fireAndForgetAuditLog(request, store, {
          adminUserId: admin.id,
          adminEmail: admin.email,
          action: "UPDATE_MODERATION_CIRCUIT_BREAKER_SETTINGS",
          targetType: "ModerationRouteCircuitBreakerSettings",
          targetId: IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_KEY,
          summary: "Admin updated moderation route circuit breaker settings.",
          metadata: { ...appliedSettings }
        });
        return status;
      } catch {
        return reply.code(503).send({
          message: "moderation circuit breaker settings are unavailable",
          code: "IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_UNAVAILABLE"
        });
      }
    }
  );

  server.post("/admin/moderation/circuit-breaker/reset", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }
    if (request.body !== undefined) {
      return reply.code(400).send({
        message: "moderation circuit breaker reset does not accept a body",
        code: "IMAGE_MODERATION_CIRCUIT_BREAKER_RESET_BODY_FORBIDDEN"
      });
    }

    try {
      await syncModerationRouteCircuitBreakerSettings();
      moderationRouteCircuitBreaker.clear();
      const status = moderationRouteCircuitBreaker.status();
      fireAndForgetAuditLog(request, store, {
        adminUserId: admin.id,
        adminEmail: admin.email,
        action: "RESET_MODERATION_CIRCUIT_BREAKER",
        targetType: "ModerationRouteCircuitBreaker",
        targetId: IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_KEY,
        summary: "Admin reset the moderation route circuit breaker.",
        metadata: {
          epoch: status.epoch,
          routes: status.routes.length
        }
      });
      return status;
    } catch {
      return reply.code(503).send({
        message: "moderation circuit breaker settings are unavailable",
        code: "IMAGE_MODERATION_CIRCUIT_BREAKER_SETTINGS_UNAVAILABLE"
      });
    }
  });

  server.put("/admin/moderation/cache/settings", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    const input = parseModerationInputCacheSettingsRequest(request.body);
    if (!input) {
      return reply.code(400).send({
        message: "valid complete moderation cache settings are required",
        code: "IMAGE_MODERATION_CACHE_SETTINGS_INVALID"
      });
    }

    try {
      await store.updateSettingAtomically({
        key: IMAGE_MODERATION_CACHE_SETTINGS_KEY,
        create: {
          key: IMAGE_MODERATION_CACHE_SETTINGS_KEY,
          value: JSON.stringify(DEFAULT_MODERATION_INPUT_CACHE_SETTINGS),
          type: "json",
          description: moderationCacheSettingsDescription
        },
        update: () => ({
          key: IMAGE_MODERATION_CACHE_SETTINGS_KEY,
          value: JSON.stringify(input),
          type: "json",
          description: moderationCacheSettingsDescription
        })
      });
      const appliedSettings = await applyCommittedModerationInputCacheSettings();
      const status = moderationInputCache.status();
      fireAndForgetAuditLog(request, store, {
        adminUserId: admin.id,
        adminEmail: admin.email,
        action: "UPDATE_MODERATION_CACHE_SETTINGS",
        targetType: "ModerationInputCacheSettings",
        targetId: IMAGE_MODERATION_CACHE_SETTINGS_KEY,
        summary: "Admin updated moderation input cache settings.",
        metadata: { ...appliedSettings }
      });
      return { ...status, settings: appliedSettings };
    } catch {
      return reply.code(503).send({
        message: "moderation cache settings are unavailable",
        code: "IMAGE_MODERATION_CACHE_SETTINGS_UNAVAILABLE"
      });
    }
  });

  server.post("/admin/moderation/cache/clear", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }
    if (request.body !== undefined) {
      return reply.code(400).send({
        message: "moderation cache clear does not accept a body",
        code: "IMAGE_MODERATION_CACHE_CLEAR_BODY_FORBIDDEN"
      });
    }

    try {
      await syncModerationInputCacheSettings();
      moderationInputCache.clear();
      const status = moderationInputCache.status();
      fireAndForgetAuditLog(request, store, {
        adminUserId: admin.id,
        adminEmail: admin.email,
        action: "CLEAR_MODERATION_INPUT_CACHE",
        targetType: "ModerationInputCache",
        targetId: IMAGE_MODERATION_CACHE_SETTINGS_KEY,
        summary: "Admin cleared the moderation input cache.",
        metadata: {
          entries: status.runtime.entries,
          inFlight: status.runtime.inFlight,
          epoch: status.runtime.epoch
        }
      });
      return status;
    } catch {
      return reply.code(503).send({
        message: "moderation cache settings are unavailable",
        code: "IMAGE_MODERATION_CACHE_SETTINGS_UNAVAILABLE"
      });
    }
  });

  server.put("/admin/moderation/settings", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    const enabled = parseModerationSettingsEnabledUpdate(request.body);
    if (enabled === undefined) {
      return reply.code(400).send({
        message: "enabled must be a boolean",
        code: "MODERATION_ENABLED_INVALID"
      });
    }

    try {
      const settings = await saveModerationSettingsAtomically((current) => ({
        ...current,
        enabled
      }));
      invalidateModerationRuntimeState();
      fireAndForgetAuditLog(request, store, {
        adminUserId: admin.id,
        adminEmail: admin.email,
        action: "UPDATE_MODERATION_SETTINGS",
        targetType: "ModerationSettings",
        targetId: IMAGE_MODERATION_SETTINGS_KEY,
        summary: "Admin updated moderation settings enabled state.",
        metadata: { enabled }
      });
      return { settings: await toAdminModerationSettings(settings) };
    } catch (error) {
      return sendModerationWriteError(reply, error);
    }
  });

  server.post("/admin/moderation/routes", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    const input = parseModerationRouteCreateRequest(request.body);
    if (!input) {
      return reply.code(400).send({
        message: "valid moderation route fields are required",
        code: "MODERATION_ROUTE_INVALID"
      });
    }

    const providerAccount = await store.findProviderAccountRuntimeById(
      input.providerAccountId
    );
    if (!providerAccount) {
      return reply.code(404).send({
        message: "provider account not found",
        code: "MODERATION_PROVIDER_ACCOUNT_NOT_FOUND"
      });
    }
    const moderationDeclaration = providerAccount.configJson?.moderation;
    if (
      !isRecord(moderationDeclaration) ||
      moderationDeclaration.requestFormat !== "openai-moderation"
    ) {
      return reply.code(400).send({
        message: "provider account is not compatible with moderation",
        code: "MODERATION_REQUEST_FORMAT_UNSUPPORTED"
      });
    }

    try {
      const routeId = randomUUID();
      const settings = await saveModerationSettingsAtomically((current) => {
        const nextPriority =
          isRecord(request.body) && "priority" in request.body
            ? input.priority
            : current.routes.reduce(
                (maximum, route) => Math.max(maximum, route.priority),
                0
              ) + 1;
        const route: ModerationRoute = {
          id: routeId,
          ...input,
          priority: nextPriority
        };
        return {
          ...current,
          routes: [...current.routes, route]
        };
      });
      invalidateModerationRuntimeState();
      const savedRoute = settings.routes.find((route) => route.id === routeId);
      fireAndForgetAuditLog(request, store, {
        adminUserId: admin.id,
        adminEmail: admin.email,
        action: "CREATE_MODERATION_ROUTE",
        targetType: "ModerationRoute",
        targetId: routeId,
        summary: "Admin created a moderation route.",
        metadata: {
          providerAccountId: input.providerAccountId,
          upstreamModel: input.upstreamModel,
          endpointPath: input.endpointPath,
          priority: savedRoute?.priority
        }
      });
      return { settings: await toAdminModerationSettings(settings) };
    } catch (error) {
      return sendModerationWriteError(reply, error);
    }
  });

  server.put<{
    Params: { routeId: string };
  }>("/admin/moderation/routes/:routeId", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    const input = parseModerationRouteUpdateRequest(request.body);
    if (!input) {
      return reply.code(400).send({
        message: "valid moderation route fields are required",
        code: "MODERATION_ROUTE_INVALID"
      });
    }
    if (input.providerAccountId) {
      const providerAccount = await store.findProviderAccountRuntimeById(
        input.providerAccountId
      );
      if (!providerAccount) {
        return reply.code(404).send({
          message: "provider account not found",
          code: "MODERATION_PROVIDER_ACCOUNT_NOT_FOUND"
        });
      }
      const moderationDeclaration = providerAccount.configJson?.moderation;
      if (
        !isRecord(moderationDeclaration) ||
        moderationDeclaration.requestFormat !== "openai-moderation"
      ) {
        return reply.code(400).send({
          message: "provider account is not compatible with moderation",
          code: "MODERATION_REQUEST_FORMAT_UNSUPPORTED"
        });
      }
    }

    try {
      const settings = await saveModerationSettingsAtomically((current) => {
        const index = current.routes.findIndex(
          (route) => route.id === request.params.routeId
        );
        if (index < 0) {
          throw new Error("MODERATION_ROUTE_NOT_FOUND");
        }
        const routes = [...current.routes];
        const existingRoute = routes[index];
        if (!existingRoute) {
          throw new Error("MODERATION_ROUTE_NOT_FOUND");
        }
        routes[index] = { ...existingRoute, ...input };
        return { ...current, routes };
      });
      invalidateModerationRuntimeState();
      fireAndForgetAuditLog(request, store, {
        adminUserId: admin.id,
        adminEmail: admin.email,
        action: "UPDATE_MODERATION_ROUTE",
        targetType: "ModerationRoute",
        targetId: request.params.routeId,
        summary: "Admin updated a moderation route.",
        metadata: { changedFields: Object.keys(input) }
      });
      return { settings: await toAdminModerationSettings(settings) };
    } catch (error) {
      return sendModerationWriteError(reply, error);
    }
  });

  server.delete<{
    Params: { routeId: string };
  }>("/admin/moderation/routes/:routeId", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    try {
      const settings = await saveModerationSettingsAtomically((current) => {
        if (!current.routes.some((route) => route.id === request.params.routeId)) {
          throw new Error("MODERATION_ROUTE_NOT_FOUND");
        }
        return {
          ...current,
          routes: current.routes.filter((route) => route.id !== request.params.routeId)
        };
      });
      invalidateModerationRuntimeState();
      fireAndForgetAuditLog(request, store, {
        adminUserId: admin.id,
        adminEmail: admin.email,
        action: "DELETE_MODERATION_ROUTE",
        targetType: "ModerationRoute",
        targetId: request.params.routeId,
        summary: "Admin deleted a moderation route."
      });
      return { settings: await toAdminModerationSettings(settings) };
    } catch (error) {
      return sendModerationWriteError(reply, error);
    }
  });

  const safeModerationImageDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  server.post<{
    Params: { routeId: string };
  }>("/admin/moderation/routes/:routeId/test", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) {
      return reply;
    }

    if (request.body !== undefined) {
      return reply.code(400).send({
        message: "moderation route tests use fixed safe inputs",
        code: "MODERATION_ROUTE_TEST_INPUT_FORBIDDEN"
      });
    }

    let settings: ModerationSettings;
    try {
      settings = await readAdminModerationSettings();
    } catch {
      return reply.code(503).send({
        message: "moderation settings are unavailable",
        code: "MODERATION_SETTINGS_UNAVAILABLE"
      });
    }
    const route = settings.routes.find((item) => item.id === request.params.routeId);
    if (!route) {
      return reply.code(404).send({
        message: "moderation route not found",
        code: "MODERATION_ROUTE_NOT_FOUND"
      });
    }

    const providerAccount = await store.findProviderAccountRuntimeById(
      route.providerAccountId
    );
    const accountDeclaration = providerAccount?.configJson?.moderation;
    const accountDeclarationCompatible =
      isRecord(accountDeclaration) &&
      accountDeclaration.requestFormat === "openai-moderation";
    const accountAvailable = Boolean(
      providerAccount?.enabled &&
        providerAccount.apiKey.trim() &&
        providerAccount.baseUrl.trim()
    );
    const baseErrorType = !providerAccount
      ? "account_unavailable"
      : !accountDeclarationCompatible
        ? "incompatible"
        : !accountAvailable
          ? "account_unavailable"
          : null;

    type RouteTestResult = {
      supported: boolean;
      /** `ok` means the fixed sample produced a valid moderation decision. */
      ok: boolean;
      decision: "allowed" | "blocked" | null;
      latencyMs: number | null;
      errorType:
        | "timeout"
        | "request_error"
        | "invalid_response"
        | "account_unavailable"
        | "incompatible"
        | "unknown"
        | null;
    };

    const runRouteTest = async (
      inputType: ModerationInputType,
      input: string,
      supported: boolean
    ): Promise<RouteTestResult> => {
      if (!supported) {
        return {
          supported: false,
          ok: false,
          decision: null,
          latencyMs: null,
          errorType: null
        };
      }
      if (!providerAccount || baseErrorType) {
        return {
          supported: true,
          ok: false,
          decision: null,
          latencyMs: null,
          errorType: baseErrorType ?? "account_unavailable"
        };
      }

      const testSettings: ModerationSettings = {
        ...settings,
        enabled: true,
        routes: [{ ...route, enabled: true }]
      };
      const attempts = resolveModerationProviderAttempts({
        settings: testSettings,
        providerAccounts: [providerAccount],
        inputType
      });
      if (attempts.length !== 1) {
        return {
          supported: true,
          ok: false,
          decision: null,
          latencyMs: null,
          errorType: "incompatible"
        };
      }

      const client = createRoutedImageModerationClient({
        fetchImpl: options.fetchImpl,
        resolveAttempts: () => attempts
      });
      const startedAt = Date.now();
      try {
        const decision =
          inputType === "text"
            ? await client.moderateText(input)
            : await client.moderateImage({ url: input });
        return {
          supported: true,
          ok: true,
          decision: decision.status,
          latencyMs: Date.now() - startedAt,
          errorType: null
        };
      } catch (error) {
        return {
          supported: true,
          ok: false,
          decision: null,
          latencyMs: Date.now() - startedAt,
          errorType:
            error instanceof ImageModerationTimeoutError
              ? "timeout"
              : error instanceof ImageModerationRequestError
                ? "request_error"
            : error instanceof ImageModerationResponseError
              ? "invalid_response"
              : error instanceof ImageModerationUnavailableError
                ? error.lastErrorType ?? "unknown"
              : "unknown"
        };
      }
    };

    const text = await runRouteTest(
      "text",
      "A red apple on a wooden table.",
      route.supportsText
    );
    const image = await runRouteTest(
      "image",
      safeModerationImageDataUrl,
      route.supportsImage
    );
    return {
      routeId: route.id,
      compatible:
        (text.supported || image.supported) &&
        (!text.supported || text.ok) &&
        (!image.supported || image.ok),
      text,
      image
    };
  });

  server.get(
    "/admin/overview",
    async (request, reply): Promise<AdminOverview | FastifyReply> => {
      const admin = await authenticateAdmin(request, reply);

      if (!admin) {
        return reply;
      }

      void reply.header("Cache-Control", "no-store");

      const budgetRows = isAdminGlobalBudgetReadStore(globalBudgetStore)
        ? globalBudgetStore
            .listAdminBudgetPeriods(globalBudgetNow())
            .catch(() => adminOperationsBudgetScopes.map(emptyAdminOperationsBudget))
        : Promise.resolve(adminOperationsBudgetScopes.map(emptyAdminOperationsBudget));

      const [
        users,
        models,
        usageLogs,
        usageSuccess,
        usageFailed,
        stats,
        recentTasks,
        manualCompensations,
        budgets
      ] =
        await Promise.all([
          store.listAdminUsers(),
          store.listAdminModels(),
          store.listAdminUsageLogs(20),
          store.countUsageLogs("SUCCESS"),
          store.countUsageLogs("FAILED"),
          store.getAdminOverviewStats(),
          store.listAdminOperationsTasks(),
          store.listAdminManualCompensations(),
          budgetRows
        ]);

      return {
        users,
        models,
        usageLogs,
        totals: {
          users: users.length,
          usageSuccess,
          usageFailed
        },
        stats,
        operations: {
          recentTasks,
          budgets,
          manualCompensations
        }
      };
    }
  );

  server.get("/admin/users", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const searchParams = new URL(
      request.url,
      "http://localhost"
    ).searchParams;
    const page = parsePositiveInt(searchParams.get("page"));
    const rawPageSize = parsePositiveInt(searchParams.get("pageSize"));
    const pageSize = rawPageSize
      ? Math.min(Math.max(rawPageSize, 1), 100)
      : undefined;

    return {
      users: await store.listAdminUsers({
        q: searchParamValue(searchParams, "q"),
        role: parseUserRole(searchParams.get("role")),
        page,
        pageSize
      })
    };
  });

  server.get("/admin/usage-logs", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const searchParams = new URL(
      request.url,
      "http://localhost"
    ).searchParams;

    return {
      usageLogs: await store.listAdminUsageLogs({
        q: searchParamValue(searchParams, "q"),
        status: parseUsageLogStatus(searchParams.get("status")),
        model: searchParamValue(searchParams, "model"),
        limit: Math.min(
          Math.max(parsePositiveInt(searchParams.get("limit")) ?? 50, 1),
          100
        )
      })
    };
  });

  server.get("/admin/audit-logs", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const searchParams = new URL(
      request.url,
      "http://localhost"
    ).searchParams;
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit
      ? Math.min(Math.max(Number(rawLimit) || 50, 1), 100)
      : 50;

    return {
      logs: await store.listAdminAuditLogs(limit)
    };
  });

  server.get("/admin/storage-subscriptions", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) return reply;
    if (!store.listStorageSubscriptions) return reply.code(503).send({ message: "storage subscriptions endpoint is unavailable" });
    const query = request.query as Record<string, unknown>;
    const q = typeof query.q === "string" ? query.q : undefined;
    const rawStatus = typeof query.status === "string" ? query.status : "ALL";
    const status = ["ACTIVE", "INACTIVE", "EXPIRED", "ALL"].includes(String(rawStatus)) ? String(rawStatus) as "ACTIVE" | "INACTIVE" | "EXPIRED" | "ALL" : "ALL";
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = [10, 20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : 20;
    return store.listStorageSubscriptions({ q, status, page, pageSize });
  });

  server.patch("/admin/storage-subscriptions/:userId", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    if (!admin) return reply;
    if (!store.updateStorageSubscription) return reply.code(503).send({ message: "storage update endpoint is unavailable" });
    if (!isRecord(request.body) || typeof request.body.action !== "string") {
      return reply.code(400).send({ message: "action is required" });
    }
    const action = request.body.action as string;
    if (!["ACTIVATE", "EXTEND", "DEACTIVATE", "SET_AUTO_RENEW"].includes(action)) {
      return reply.code(400).send({ message: "invalid action" });
    }
    const durationDays = typeof request.body.durationDays === "number" ? request.body.durationDays : undefined;
    if ((action === "ACTIVATE" || action === "EXTEND") && (durationDays === undefined || durationDays < 1 || durationDays > 3650)) {
      return reply.code(400).send({ message: "durationDays must be between 1 and 3650" });
    }
    const rawEnabled = (request.body as Record<string, unknown>).enabled;
    const enabled: boolean | undefined = action === "SET_AUTO_RENEW" ? rawEnabled as boolean | undefined : undefined;
    if (action === "SET_AUTO_RENEW" && typeof enabled !== "boolean") {
      return reply.code(400).send({ message: "enabled must be a boolean for SET_AUTO_RENEW" });
    }
    const params = request.params as Record<string, string>;
    const userId = params.userId;
    if (!userId) return reply.code(400).send({ message: "userId is required" });
    const benefits = await resolveAccountBenefits();
    try {
      const result = await store.updateStorageSubscription({
        userId,
        action: action as "ACTIVATE" | "EXTEND" | "DEACTIVATE" | "SET_AUTO_RENEW",
        durationDays,
        enabled,
        adminId: admin.id,
        adminEmail: admin.email,
        benefits
      });
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "USER_NOT_FOUND") {
        return reply.code(404).send({ message: "user not found" });
      }
      if (error instanceof Error && error.message === "STORAGE_NOT_FOUND") {
        return reply.code(409).send({ message: "storage subscription not found" });
      }
      if (error instanceof Error && error.message === "AUTO_RENEW_DISABLED") {
        return reply.code(403).send({ message: "auto-renewal is disabled globally" });
      }
      if (error instanceof Error && error.message === "STORAGE_EXPIRED") {
        return reply.code(409).send({ message: "cannot enable auto-renew for expired subscription" });
      }
      throw error;
    }
  });

  server.get("/admin/feedbacks", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const searchParams = new URL(
      request.url,
      "http://localhost"
    ).searchParams;
    const showArchived = searchParams.get("showArchived") === "true";

    return {
      feedbacks: await store.listAdminFeedbacks(50, showArchived)
    };
  });

  server.post<{
    Params: { routeId: string };
  }>("/admin/model-routes/:routeId/test", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const routeId = request.params.routeId.trim();
    let model: AdminAiModelSummary | undefined;
    let route: NonNullable<AdminAiModelSummary["routes"]>[number] | undefined;

    try {
      const models = await store.listAdminModels();
      for (const candidate of models) {
        const candidateRoute = candidate.routes?.find(
          (item) => item.id === routeId
        );
        if (candidateRoute) {
          model = candidate;
          route = candidateRoute;
          break;
        }
      }
    } catch {
      return reply.code(503).send({
        success: false,
        code: "ROUTE_TEST_LOOKUP_FAILED",
        errorCode: "ROUTE_TEST_LOOKUP_FAILED",
        message: "线路测试暂时不可用"
      });
    }

    if (!model || !route) {
      return reply.code(404).send({
        success: false,
        code: "ROUTE_TEST_NOT_FOUND",
        errorCode: "ROUTE_TEST_NOT_FOUND",
        message: "model route not found"
      });
    }

    const providerAccount = await store.findProviderAccountRuntimeById(
      route.providerId
    );
    if (!providerAccount) {
      return reply.code(404).send({
        success: false,
        routeEnabled: route.enabled,
        code: "ROUTE_TEST_PROVIDER_NOT_FOUND",
        errorCode: "ROUTE_TEST_PROVIDER_NOT_FOUND",
        message: "provider account not found"
      });
    }

    const routeState = {
      routeEnabled: route.enabled,
      providerEnabled: providerAccount.enabled
    };
    const capability = model.capability;

    if (capability !== "chat" && capability !== "image") {
      return reply.code(400).send({
        success: false,
        ...routeState,
        capability,
        code: "ROUTE_TEST_CAPABILITY_UNSUPPORTED",
        errorCode: "ROUTE_TEST_CAPABILITY_UNSUPPORTED",
        message: "当前线路模型能力不支持线路测试"
      });
    }

    const imageInvokeMode = model.imageInvokeMode ?? "native-image";
    const imageOutputParser = model.imageOutputParser ?? "native-image";
    const usesChatFormatImage =
      imageInvokeMode === "anthropic-messages" &&
      imageOutputParser === "markdown-data-url";

    if (
      capability === "image" &&
      (!usesChatFormatImage && imageInvokeMode !== "native-image" ||
        usesChatFormatImage && providerAccount.providerType === "AGNES_IMAGE")
    ) {
      return reply.code(400).send({
        success: false,
        ...routeState,
        capability,
        code: "ROUTE_TEST_INVOKE_MODE_UNSUPPORTED",
        errorCode: "ROUTE_TEST_INVOKE_MODE_UNSUPPORTED",
        message: "当前图像 invoke mode 不支持 route test"
      });
    }

    if (!providerAccount.capabilities.includes(capability)) {
      return reply.code(400).send({
        success: false,
        ...routeState,
        capability,
        code: "ROUTE_TEST_CAPABILITY_UNSUPPORTED",
        errorCode: "ROUTE_TEST_CAPABILITY_UNSUPPORTED",
        message: "provider account 不支持当前模型能力"
      });
    }

    const upstreamModel = route.upstreamModel.trim();
    if (!upstreamModel) {
      return reply.code(400).send({
        success: false,
        ...routeState,
        capability,
        code: "ROUTE_TEST_MODEL_INVALID",
        errorCode: "ROUTE_TEST_MODEL_INVALID",
        message: "线路 upstreamModel 无效"
      });
    }

    const configJson = providerAccount.configJson;
    const headersJson = providerAccount.headersJson;
    const providerTimeoutMs = providerAccount.timeoutMs;
    if (!isValidImageProviderTimeoutMs(providerTimeoutMs)) {
      return reply.code(400).send({
        success: false,
        ...routeState,
        capability,
        upstreamModel,
        code: "ROUTE_TEST_TIMEOUT_INVALID",
        errorCode: "ROUTE_TEST_TIMEOUT_INVALID",
        message: "provider timeoutMs 无效"
      });
    }
    const timeoutMs = resolveAdminDiagnosticTimeoutMs({
      providerTimeoutMs
    });

    const configuredRequestFormat = resolveProviderAccountRequestFormat({
      providerAccount,
      providerType: providerAccount.providerType
    });
    const requestFormat =
      capability === "chat"
        ? getDefaultProviderAccountRequestFormat(providerAccount.providerType)
        : configuredRequestFormat;
    const authMode =
      capability === "chat"
        ? getDefaultAnthropicAuthMode({
            providerType: providerAccount.providerType,
            requestFormat
          })
        : resolveAnthropicAuthMode({
            providerAccount,
            providerType: providerAccount.providerType,
            requestFormat
          });
    const messagesPath =
      capability === "chat"
        ? "/v1/messages"
        : resolveAnthropicMessagesPath({ providerAccount });
    let imageTransport: ImageTransport | "anthropic-messages" | undefined;
    if (capability === "image") {
      try {
        const resolvedImageTransport = resolveImageTransport({
          providerType: providerAccount.providerType,
          configJson
        });
        imageTransport = usesChatFormatImage
          ? "anthropic-messages"
          : resolvedImageTransport;
      } catch {
        return reply.code(400).send({
          success: false,
          ...routeState,
          capability,
          upstreamModel,
          code: "IMAGE_TRANSPORT_INVALID",
          errorCode: "IMAGE_TRANSPORT_INVALID",
          message: "imageTransport 配置不受支持"
        });
      }
    }

    if (!providerAccount.baseUrl.trim() || !providerAccount.apiKey.trim()) {
      return reply.code(502).send({
        success: false,
        ...routeState,
        capability,
        upstreamModel,
        ...(capability === "image"
          ? { imageTransport }
          : { requestFormat }),
        code: "ROUTE_TEST_REQUEST_FAILED",
        errorCode: "ROUTE_TEST_REQUEST_FAILED",
        message: "线路测试失败，请检查 Provider Account 配置"
      });
    }

    const startedAt = Date.now();
    let chatAdapter: ChatCompletionAdapter | undefined;
    let imageAdapter: ImageGenerationAdapter | undefined;
    try {
      if (capability === "image") {
        const imageResponseFormat = resolveImageResponseFormatConfig(configJson);
        if (!imageResponseFormat || !imageTransport) {
          return reply.code(400).send({
            success: false,
            ...routeState,
            capability,
            upstreamModel,
            imageTransport,
            code: "ROUTE_TEST_CONFIG_INVALID",
            errorCode: "ROUTE_TEST_CONFIG_INVALID",
            message: "图像线路测试配置不受支持"
          });
        }

        if (imageTransport !== "anthropic-messages") {
          imageAdapter =
            imageTransport === "legacy-extra-body-v1"
              ? createAgnesImageAdapter({
                  baseUrl: providerAccount.baseUrl,
                  apiKey: providerAccount.apiKey,
                  defaultModel: upstreamModel,
                  timeoutMs,
                  headersJson,
                  fetchImpl: options.fetchImpl
                })
              : createOpenAICompatibleAdapter({
                  baseUrl: providerAccount.baseUrl,
                  apiKey: providerAccount.apiKey,
                  defaultModel: upstreamModel,
                  imageResponseFormat,
                  timeoutMs,
                  headersJson,
                  fetchImpl: options.fetchImpl
                });
        }
      } else {
        if (
          providerAccount.providerType !== "ANTHROPIC" &&
          !isOpenAICompatibleChatProviderType(providerAccount.providerType)
        ) {
          return reply.code(400).send({
            success: false,
            ...routeState,
            capability,
            upstreamModel,
            requestFormat,
            code: "ROUTE_TEST_CAPABILITY_UNSUPPORTED",
            errorCode: "ROUTE_TEST_CAPABILITY_UNSUPPORTED",
            message: "当前 provider transport 不支持聊天线路测试"
          });
        }

        chatAdapter =
          providerAccount.providerType === "ANTHROPIC"
            ? createAnthropicChatAdapter({
                baseUrl: providerAccount.baseUrl,
                apiKey: providerAccount.apiKey,
                defaultModel: upstreamModel,
                maxTokens: resolveProviderAccountTestMaxTokens(configJson),
                headersJson,
                timeoutMs,
                fetchImpl: options.fetchImpl
              })
            : createOpenAICompatibleAdapter({
                baseUrl: providerAccount.baseUrl,
                apiKey: providerAccount.apiKey,
                defaultModel: upstreamModel,
                timeoutMs,
                headersJson,
                fetchImpl: options.fetchImpl
              });
      }
    } catch {
      return reply.code(502).send({
        success: false,
        ...routeState,
        capability,
        upstreamModel,
        ...(capability === "image"
          ? { imageTransport }
          : { requestFormat }),
        code: "ROUTE_TEST_REQUEST_FAILED",
        errorCode: "ROUTE_TEST_REQUEST_FAILED",
        message: "线路测试失败，请检查 Provider Account 配置"
      });
    }

    const budgetDecision = decideGlobalAdminProviderTestBudget(
      globalAdminProviderTestBudgetConfigResult
    );
    if (budgetDecision.status === "unavailable") {
      return reply.code(503).send({
        success: false,
        ...routeState,
        capability,
        upstreamModel,
        code: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
        errorCode: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
        message: globalAdminProviderTestBudgetUnavailableMessage,
        retryable: false
      });
    }
    if (budgetDecision.status === "attempt_cost_exceeded") {
      return reply.code(400).send({
        success: false,
        ...routeState,
        capability,
        upstreamModel,
        code: "ADMIN_PROVIDER_TEST_COST_EXCEEDED",
        errorCode: "ADMIN_PROVIDER_TEST_COST_EXCEEDED",
        message: "供应商测试单次成本超过预算上限",
        retryable: false
      });
    }

    if (budgetDecision.status === "allowed") {
      let consumeResult:
        | Awaited<ReturnType<GlobalBudgetStore["consumeGlobalBudget"]>>
        | undefined;
      try {
        consumeResult = await globalBudgetStore.consumeGlobalBudget({
          scope: "admin_provider_test",
          periodType: "DAILY",
          periodKey: getUtcDailyBudgetPeriodKey(globalBudgetNow()),
          budgetCredits: budgetDecision.dailyBudgetCredits,
          costCredits: budgetDecision.attemptCostCredits
        });
      } catch {
        return reply.code(503).send({
          success: false,
          ...routeState,
          capability,
          upstreamModel,
          code: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
          errorCode: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
          message: globalAdminProviderTestBudgetUnavailableMessage,
          retryable: false
        });
      }

      if (consumeResult.status === "exhausted") {
        return reply.code(503).send({
          success: false,
          ...routeState,
          capability,
          upstreamModel,
          code: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_EXHAUSTED",
          errorCode: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_EXHAUSTED",
          message: "供应商测试预算已用尽，请稍后重试",
          retryable: false
        });
      }
      if (consumeResult.status === "unavailable") {
        return reply.code(503).send({
          success: false,
          ...routeState,
          capability,
          upstreamModel,
          code: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
          errorCode: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
          message: globalAdminProviderTestBudgetUnavailableMessage,
          retryable: false
        });
      }
    }

    try {
      if (capability === "image") {
        if (imageTransport === "anthropic-messages") {
          const imageEndpointPath = resolveAnthropicEndpointPath({
            baseUrl: providerAccount.baseUrl,
            messagesPath
          });
          const imageRequestBody = {
            model: upstreamModel,
            max_tokens: resolveProviderMaxTokens(configJson) ?? 4096,
            messages: [
              { role: "user", content: providerTestImagePrompt }
            ],
            ...(supportsNativeChatImageBatch({
              providerType: providerAccount.providerType,
              requestFormat,
              messagesPath
            })
              ? { n: 1 }
              : {})
          };
          const imageOutputs = await runAdminDiagnosticWithTimeout({
            timeoutMs,
            operation: (signal) =>
              fetchAnthropicMessagesImageOutputs({
                fetcher: options.fetchImpl ?? fetch,
                endpointUrl: resolveAnthropicMessagesEndpointUrl({
                  baseUrl: providerAccount.baseUrl,
                  messagesPath
                }),
                endpointPath: imageEndpointPath,
                apiKey: providerAccount.apiKey,
                authMode,
                headersJson,
                requestBody: imageRequestBody,
                signal
              })
          });
          if (imageOutputs.length < 1) {
            throw new AIProviderResponseFormatError();
          }

          return {
            success: true,
            ...routeState,
            capability,
            imageTransport,
            upstreamModel,
            imageCount: imageOutputs.length,
            endpointPath: imageEndpointPath,
            latencyMs: Date.now() - startedAt
          };
        }

        const adapter = imageAdapter;
        if (!adapter || !imageTransport) {
          throw new AIProviderResponseFormatError();
        }
        const imageResult = await runAdminDiagnosticWithTimeout({
          timeoutMs,
          operation: (signal) =>
            adapter.createImageGeneration({
              model: upstreamModel,
              prompt: providerTestImagePrompt,
              size: "1024x1024",
              count: 1,
              signal
            })
        });
        const imageCount = validProviderTestImageOutputCount(
          imageResult.images
        );
        if (imageCount < 1) {
          throw new AIProviderResponseFormatError();
        }

        return {
          success: true,
          ...routeState,
          capability,
          imageTransport,
          upstreamModel,
          imageCount,
          endpointPath:
            imageTransport === "openai-images"
              ? "/images/generations"
              : "/v1/images/generations",
          latencyMs: Date.now() - startedAt
        };
      }

      const adapter = chatAdapter;
      if (!adapter) {
        throw new AIProviderResponseFormatError();
      }
      await runAdminDiagnosticWithTimeout({
        timeoutMs,
        operation: (signal) =>
          adapter.createChatCompletion({
            model: upstreamModel,
            temperature: 0,
            messages: [{ role: "user", content: "Reply with OK only." }],
            signal
          })
      });

      return {
        success: true,
        ...routeState,
        capability,
        requestFormat,
        upstreamModel,
        endpointPath:
          requestFormat === "anthropic"
            ? resolveAnthropicEndpointPath({
                baseUrl: providerAccount.baseUrl,
                messagesPath
              })
            : "/chat/completions",
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      const statusCode =
        error instanceof AIProviderRequestError &&
        typeof error.statusCode === "number" &&
        Number.isSafeInteger(error.statusCode) &&
        error.statusCode >= 100 &&
        error.statusCode <= 599
          ? error.statusCode
          : undefined;
      const endpointPath =
        error instanceof AIProviderRequestError
          ? error.endpointPath
          : capability === "image"
            ? imageTransport === "anthropic-messages"
              ? resolveAnthropicEndpointPath({
                  baseUrl: providerAccount.baseUrl,
                  messagesPath
                })
              : imageTransport === "openai-images"
              ? "/images/generations"
              : "/v1/images/generations"
            : requestFormat === "anthropic"
              ? resolveAnthropicEndpointPath({
                  baseUrl: providerAccount.baseUrl,
                  messagesPath
                })
              : "/chat/completions";
      const errorCode = providerTestErrorCode(error, "ROUTE_TEST");

      return reply.code(502).send({
        success: false,
        ...routeState,
        capability,
        upstreamModel,
        ...(capability === "image"
          ? { imageTransport }
          : { requestFormat }),
        ...(endpointPath ? { endpointPath } : {}),
        ...(statusCode === undefined ? {} : { statusCode }),
        code: errorCode,
        errorCode,
        message: adminDiagnosticErrorMessage(
          error,
          "线路测试失败，请检查 Provider Account、模型或供应商格式"
        ),
        latencyMs: Date.now() - startedAt
      });
    }
  });

  server.patch<{
    Params: { id: string };
  }>("/admin/feedbacks/:id/status", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    if (!isRecord(request.body) || !isNonEmptyString(request.body.status)) {
      return reply.code(400).send({
        message: "status is required"
      });
    }

    const status = request.body.status.trim();
    const validStatuses: string[] = [
      "OPEN",
      "IN_PROGRESS",
      "RESOLVED",
      "CLOSED"
    ];

    if (!validStatuses.includes(status)) {
      return reply.code(400).send({
        message: "invalid status"
      });
    }

    const feedback = await store.updateFeedbackStatus(
      request.params.id,
      status as "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"
    );

    if (!feedback) {
      return reply.code(404).send({
        message: "feedback not found"
      });
    }

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "UPDATE_FEEDBACK_STATUS",
      targetType: "Feedback",
      targetId: feedback.id,
      summary: `Admin updated feedback status to ${status}.`,
      metadata: {
        newStatus: status
      }
    });

    return { feedback };
  });

  server.post<{
    Params: { id: string };
  }>("/admin/feedbacks/:id/archive", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const feedback = await store.archiveFeedback(request.params.id);

    if (!feedback) {
      return reply.code(404).send({
        message: "feedback not found"
      });
    }

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "ARCHIVE_FEEDBACK",
      targetType: "Feedback",
      targetId: feedback.id,
      summary: "Admin archived feedback.",
      metadata: {
        feedbackType: feedback.type,
        feedbackStatus: feedback.status
      }
    });

    return { feedback };
  });

  server.get("/admin/links", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    return {
      links: await store.listAdminLinks()
    };
  });

  server.post("/admin/links", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    if (
      !isRecord(request.body) ||
      !isNonEmptyString(request.body.title) ||
      !isNonEmptyString(request.body.url) ||
      !isNonEmptyString(request.body.category)
    ) {
      return reply.code(400).send({
        message: "title, url, and category are required"
      });
    }

    const link = await store.createLink({
      title: request.body.title.trim(),
      url: request.body.url.trim(),
      description:
        typeof request.body.description === "string"
          ? request.body.description.trim() || undefined
          : undefined,
      category: request.body.category.trim(),
      enabled:
        typeof request.body.enabled === "boolean" ? request.body.enabled : true,
      sortOrder:
        typeof request.body.sortOrder === "number" &&
        Number.isInteger(request.body.sortOrder)
          ? request.body.sortOrder
          : 0
    });

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "CREATE_LINK",
      targetType: "Link",
      targetId: link.id,
      summary: `Admin created link ${link.title}.`,
      metadata: {
        linkTitle: link.title,
        linkCategory: link.category
      }
    });

    return { link };
  });

  server.patch<{
    Params: { id: string };
  }>("/admin/links/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({
        message: "valid link fields are required"
      });
    }

    const input: {
      title?: string;
      url?: string;
      description?: string;
      category?: string;
      enabled?: boolean;
      sortOrder?: number;
    } = {};

    if ("title" in request.body) {
      if (!isNonEmptyString(request.body.title)) {
        return reply.code(400).send({ message: "invalid title" });
      }
      input.title = request.body.title.trim();
    }

    if ("url" in request.body) {
      if (!isNonEmptyString(request.body.url)) {
        return reply.code(400).send({ message: "invalid url" });
      }
      input.url = request.body.url.trim();
    }

    if ("description" in request.body) {
      input.description =
        typeof request.body.description === "string"
          ? request.body.description.trim() || undefined
          : undefined;
    }

    if ("category" in request.body) {
      if (!isNonEmptyString(request.body.category)) {
        return reply.code(400).send({ message: "invalid category" });
      }
      input.category = request.body.category.trim();
    }

    if ("enabled" in request.body) {
      if (typeof request.body.enabled !== "boolean") {
        return reply.code(400).send({ message: "enabled must be boolean" });
      }
      input.enabled = request.body.enabled;
    }

    if ("sortOrder" in request.body) {
      if (
        typeof request.body.sortOrder !== "number" ||
        !Number.isInteger(request.body.sortOrder)
      ) {
        return reply.code(400).send({ message: "invalid sortOrder" });
      }
      input.sortOrder = request.body.sortOrder;
    }

    const link = await store.updateLink(request.params.id, input);

    if (!link) {
      return reply.code(404).send({
        message: "link not found"
      });
    }

    const auditAction = input.enabled === false ? "DISABLE_LINK" : "UPDATE_LINK";

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: auditAction,
      targetType: "Link",
      targetId: link.id,
      summary:
        auditAction === "DISABLE_LINK"
          ? `Admin disabled link ${link.title}.`
          : `Admin updated link ${link.title}.`,
      metadata: {
        linkTitle: link.title,
        changedFields: Object.keys(input)
      }
    });

    return { link };
  });

  server.delete<{
    Params: { id: string };
  }>("/admin/links/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const link = await store.deleteLink(request.params.id);

    if (!link) {
      return reply.code(404).send({
        message: "link not found"
      });
    }

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "DELETE_LINK",
      targetType: "Link",
      targetId: link.id,
      summary: `Admin deleted link ${link.title}.`,
      metadata: {
        linkTitle: link.title,
        linkCategory: link.category
      }
    });

    return { ok: true };
  });

  server.get("/admin/settings", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    return {
      settings: await store.listSettings([...editableSettingKeys])
    };
  });

  server.patch("/admin/settings", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    let input: SiteSettingUpdateInput[] | undefined;

    try {
      input = parseSettingsPatchRequest(request.body);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "SETTING_KEY_NOT_ALLOWED"
      ) {
        return reply.code(400).send({
          message: "setting key is not allowed"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_HOME_FEATURE_CARDS"
      ) {
        return reply.code(400).send({
          message: "Please enter a valid JSON array"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_WORKSPACE_PROMPT_CARDS"
      ) {
        return reply.code(400).send({
          message: "Please enter a valid workspace prompt cards JSON array"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_IMAGE_PROMPT_CARDS"
      ) {
        return reply.code(400).send({
          message: "Please enter a valid image prompt cards JSON array"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_HELP_CONTENT_JSON"
      ) {
        return reply.code(400).send({
          message: "Please enter valid Help content JSON"
        });
      }

      if (
        error instanceof Error &&
        (error.message === "INVALID_REGISTRATION_SETTING" ||
          error.message === "INVALID_REGISTRATION_DOMAIN_LIST" ||
          error.message === "EMPTY_REGISTRATION_ALLOWLIST")
      ) {
        return reply.code(400).send({
          message: "Invalid security and registration settings"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_GUEST_RATE_LIMIT_SETTING"
      ) {
        return reply.code(400).send({
          message: "Invalid guest rate limit settings"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_PROFILE_RATE_LIMIT_SETTING"
      ) {
        return reply.code(400).send({
          message: "Invalid profile rate limit settings"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_REFERENCE_IMAGE_RATE_LIMIT_SETTING"
      ) {
        return reply.code(400).send({
          message: "Invalid reference image rate limit settings"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_CONCURRENCY_SETTING"
      ) {
        return reply.code(400).send({
          message: "Invalid concurrency settings"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_CONTACT_EXTERNAL_LINKS"
      ) {
        return reply.code(400).send({
          message: "Invalid contact external links format"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_PUBLIC_ASSET_URL"
      ) {
        return reply.code(400).send({
          message: "Invalid URL format"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_ACCOUNT_BENEFIT_NUMBER"
      ) {
        return reply.code(400).send({
          message: "Account benefit credits must be a non-negative integer"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_ACCOUNT_BENEFIT_DURATION"
      ) {
        return reply.code(400).send({
          message: "Storage package duration must be a positive integer"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_CHECK_IN_STREAK_REWARDS"
      ) {
        return reply.code(400).send({
          message: "Check-in streak rewards must be valid JSON with positive days and non-negative rewards"
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_TITLE_COVER_BRIEF_SETTING"
      ) {
        return reply.code(400).send({
          message: "Title Cover Visual Brief settings are invalid"
        });
      }

      throw error;
    }

    if (!input) {
      return reply.code(400).send({
        message: "valid settings are required"
      });
    }

    try {
      await validateTitleCoverVisualBriefAdminSettings(input);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "INVALID_TITLE_COVER_BRIEF_SETTING" ||
          error.message === "INVALID_TITLE_COVER_BRIEF_MODEL")
      ) {
        return reply.code(400).send({
          message:
            error.message === "INVALID_TITLE_COVER_BRIEF_MODEL"
              ? "Title Cover Visual Brief model must be an enabled chat model with an enabled route"
              : "Title Cover Visual Brief settings are invalid"
        });
      }
      throw error;
    }

    const registrationUpdate = input.find(
      (setting) => setting.key === "registrationEnabled"
    );
    const previousRegistrationEnabled = registrationUpdate
      ? parseSettingBoolean(
          (await store.getSetting("registrationEnabled"))?.value
        ) ?? false
      : null;
    const updatedSettings = await store.updateSettings(input);

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "UPDATE_SITE_SETTINGS",
      targetType: "SiteSetting",
      summary: "Admin updated site settings.",
      metadata: {
        changedKeys: input.map((s) => s.key)
      }
    });

    if (registrationUpdate) {
      const nextEnabled = registrationUpdate.value === "true";
      if (previousRegistrationEnabled !== nextEnabled) {
        fireAndForgetAuditLog(request, store, {
          adminUserId: admin.id,
          adminEmail: admin.email,
          action: nextEnabled ? "ENABLE_REGISTRATION" : "DISABLE_REGISTRATION",
          targetType: "SiteSetting",
          targetId: "registrationEnabled",
          summary: nextEnabled
            ? "Admin enabled registration."
            : "Admin disabled registration.",
          metadata: {
            previousEnabled: previousRegistrationEnabled,
            nextEnabled
          }
        });
      }
    }

    return {
      settings: updatedSettings
    };
  });

  server.patch<{
    Params: { id: string };
  }>("/admin/users/:id/quota", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    if (
      !isRecord(request.body) ||
      typeof request.body.remainingCredits !== "number" ||
      !Number.isInteger(request.body.remainingCredits) ||
      request.body.remainingCredits < 0
    ) {
      return reply.code(400).send({
        message: "remainingCredits must be a non-negative integer"
      });
    }

    const result = await store.adjustUserQuotaWithAudit({
      userId: request.params.id,
      remainingCredits: request.body.remainingCredits,
      adminUserId: admin.id,
      adminEmail: admin.email
    });

    if (!result) {
      return reply.code(404).send({
        message: "user not found"
      });
    }

    return result.quota;
  });

  server.post("/admin/models", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const input = parseModelCreateRequest(request.body);

    if (!input) {
      return reply.code(400).send({
        message: "valid model fields are required"
      });
    }

    if (
      input.providerAccountId &&
      !(await store.findProviderAccountById(input.providerAccountId))
    ) {
      return reply.code(400).send({
        message: "provider account not found"
      });
    }

    let model: AdminAiModelSummary;
    try {
      model = await store.createModel(input);
    } catch (error) {
      if (error instanceof ModelIdentityConflictError) {
        return reply.code(409).send({
          message: "model identity conflicts with existing configuration",
          code: "MODEL_IDENTITY_CONFLICT"
        });
      }
      throw error;
    }

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "CREATE_MODEL",
      targetType: "AiModel",
      targetId: model.id,
      summary: `Admin created model ${model.name}.`,
      metadata: {
        modelName: model.name,
        modelId: model.modelId,
        provider: model.provider
      }
    });

    return {
      model
    };
  });

  server.patch<{
    Params: { id: string };
  }>("/admin/models/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const input = parseModelUpdateRequest(request.body);

    if (!input) {
      return reply.code(400).send({
        message: "valid model fields are required"
      });
    }

    const existingModel = await store.findModelById(request.params.id);
    if (!existingModel) {
      return reply.code(404).send({
        message: "model not found"
      });
    }

    if (
      (input.capability !== undefined || input.displaySurfaces !== undefined) &&
      !hasCompatibleModelDisplaySurfaces(
        input.capability ?? existingModel.capability,
        input.displaySurfaces ??
          normalizeModelDisplaySurfaces(
            existingModel.displaySurfaces,
            existingModel.capability
          )
      )
    ) {
      return reply.code(400).send({
        message: "model display surface is incompatible with capability"
      });
    }

    if (
      input.providerAccountId &&
      !(await store.findProviderAccountById(input.providerAccountId))
    ) {
      return reply.code(400).send({
        message: "provider account not found"
      });
    }

    let model: AdminAiModelSummary | null;
    try {
      model = await store.updateModel(request.params.id, input);
    } catch (error) {
      if (error instanceof ModelIdentityConflictError) {
        return reply.code(409).send({
          message: "model identity conflicts with existing configuration",
          code: "MODEL_IDENTITY_CONFLICT"
        });
      }
      throw error;
    }

    if (!model) {
      return reply.code(404).send({
        message: "model not found"
      });
    }

    const changedFields = Object.keys(input);
    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "UPDATE_MODEL",
      targetType: "AiModel",
      targetId: model.id,
      summary: `Admin updated model ${model.name}: ${changedFields.join(", ")}.`,
      metadata: {
        modelName: model.name,
        modelId: model.modelId,
        changedFields
      }
    });

    return { model };
  });

  server.delete<{
    Params: { id: string };
  }>("/admin/models/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const result = await store.deleteModel(request.params.id);

    if (!result.deleted) {
      return reply.code(400).send({
        message: result.reason
      });
    }

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "DELETE_MODEL",
      targetType: "AiModel",
      targetId: result.model.id,
      summary: `Admin deleted model ${result.model.name}.`,
      metadata: {
        modelName: result.model.name,
        modelId: result.model.modelId
      }
    });

    return { model: result.model };
  });

  server.post<{
    Params: { id: string };
  }>("/admin/models/:id/disable", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const model = await store.disableModel(request.params.id);

    if (!model) {
      return reply.code(404).send({
        message: "model not found"
      });
    }

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "DISABLE_MODEL",
      targetType: "AiModel",
      targetId: model.id,
      summary: `Admin disabled model ${model.name}.`,
      metadata: {
        modelName: model.name,
        modelId: model.modelId
      }
    });

    return { model };
  });

  server.post("/admin/model-routes", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const input = parseModelRouteCreateRequest(request.body);

    if (!input) {
      return reply.code(400).send({
        message: "valid model route fields are required"
      });
    }

    const [model, providerAccount] = await Promise.all([
      store.findModelById(input.modelId),
      store.findProviderAccountById(input.providerId)
    ]);

    if (!model) {
      return reply.code(404).send({ message: "model not found" });
    }

    if (!providerAccount) {
      return reply.code(404).send({ message: "provider account not found" });
    }

    const route = await store.createModelRoute(input);

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "CREATE_MODEL_ROUTE",
      targetType: "AiModelRoute",
      targetId: route.id,
      summary: `Admin created model route for ${model.name}.`,
      metadata: {
        modelId: model.id,
        canonicalId: model.slug,
        providerId: providerAccount.id,
        upstreamModel: route.upstreamModel,
        priority: route.priority
      }
    });

    return { route };
  });

  server.patch<{
    Params: { id: string };
  }>("/admin/model-routes/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const input = parseModelRouteUpdateRequest(request.body);

    if (!input) {
      return reply.code(400).send({
        message: "valid model route fields are required"
      });
    }

    const providerAccountId = input.providerId;
    if (
      providerAccountId &&
      !(await store.findProviderAccountById(providerAccountId))
    ) {
      return reply.code(404).send({ message: "provider account not found" });
    }

    const route = await store.updateModelRoute(request.params.id, input);

    if (!route) {
      return reply.code(404).send({ message: "model route not found" });
    }

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "UPDATE_MODEL_ROUTE",
      targetType: "AiModelRoute",
      targetId: route.id,
      summary: `Admin updated model route ${route.id}.`,
      metadata: {
        changedFields: Object.keys(input),
        providerId: route.providerId,
        upstreamModel: route.upstreamModel,
        priority: route.priority,
        enabled: route.enabled
      }
    });

    return { route };
  });

  server.delete<{
    Params: { id: string };
  }>("/admin/model-routes/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const route = await store.disableModelRoute(request.params.id);

    if (!route) {
      return reply.code(404).send({ message: "model route not found" });
    }

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "DISABLE_MODEL_ROUTE",
      targetType: "AiModelRoute",
      targetId: route.id,
      summary: `Admin disabled model route ${route.id}.`,
      metadata: {
        providerId: route.providerId,
        upstreamModel: route.upstreamModel
      }
    });

    return { route };
  });

  server.get("/admin/plans", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    return {
      plans: await store.listAdminPlans()
    };
  });

  server.post("/admin/plans", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const input = parsePlanCreateRequest(request.body);

    if (!input) {
      return reply.code(400).send({
        message: "valid plan fields are required"
      });
    }

    const plan = await store.createPlan(input);

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "CREATE_PLAN",
      targetType: "Plan",
      targetId: plan.id,
      summary: `Admin created plan ${plan.name}.`,
      metadata: {
        planName: plan.name,
        price: plan.price,
        credits: plan.credits
      }
    });

    return {
      plan
    };
  });

  server.patch<{
    Params: { id: string };
  }>("/admin/plans/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const input = parsePlanUpdateRequest(request.body);

    if (!input) {
      return reply.code(400).send({
        message: "valid plan fields are required"
      });
    }

    const plan = await store.updatePlan(request.params.id, input);

    if (!plan) {
      return reply.code(404).send({
        message: "plan not found"
      });
    }

    const changedFields = Object.keys(input);
    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "UPDATE_PLAN",
      targetType: "Plan",
      targetId: plan.id,
      summary: `Admin updated plan ${plan.name}: ${changedFields.join(", ")}.`,
      metadata: {
        planName: plan.name,
        changedFields
      }
    });

    return { plan };
  });

  server.get("/admin/orders", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const searchParams = new URL(
      request.url,
      "http://localhost"
    ).searchParams;

    const [orders, reviewOrderCount] = await Promise.all([
      store.listAdminOrders({
        q: searchParamValue(searchParams, "q"),
        status: parseOrderStatus(searchParams.get("status")),
        paymentType: parsePaymentTypeFilter(searchParams.get("paymentType")),
        review: searchParams.get("review") === "true" ? true : undefined,
        limit: Math.min(
          Math.max(parsePositiveInt(searchParams.get("limit")) ?? 50, 1),
          100
        )
      }),
      store.countAdminOrdersRequiringPaymentReview()
    ]);

    return {
      orders,
      reviewOrderCount
    };
  });

  server.get("/admin/provider-accounts", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    return {
      providerAccounts: await store.listProviderAccounts()
    };
  });

  server.post("/admin/provider-accounts", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const input = parseProviderAccountCreateRequest(request.body);

    if (!input) {
      return reply.code(400).send({
        message: "valid provider account fields are required"
      });
    }

    const providerAccount = await store.createProviderAccount(input);
    invalidateModerationRuntimeState();

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "CREATE_PROVIDER_ACCOUNT",
      targetType: "AiProviderAccount",
      targetId: providerAccount.id,
      summary: `Admin created provider account ${providerAccount.name}.`,
      metadata: {
        providerAccountName: providerAccount.name,
        providerType: providerAccount.providerType,
        capabilities: providerAccount.capabilities,
        hasApiKey: providerAccount.hasApiKey
      }
    });

    return {
      providerAccount
    };
  });

  server.post("/admin/provider-accounts/test", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const testRequest = parseProviderAccountTestRequest(request.body);

    if (!testRequest) {
      return reply.code(400).send({
        message: "valid provider account test fields are required"
      });
    }

    const savedProviderAccount = testRequest.providerAccountId
      ? await store.findProviderAccountRuntimeById(testRequest.providerAccountId)
      : null;

    if (testRequest.providerAccountId && !savedProviderAccount) {
      return reply.code(404).send({
        message: "provider account not found"
      });
    }

    const providerType =
      savedProviderAccount?.providerType ?? testRequest.providerType;

    if (!providerType) {
      return reply.code(400).send({
        message: "valid provider account test fields are required"
      });
    }

    const effectiveCapabilities =
      testRequest.capabilities ?? savedProviderAccount?.capabilities ?? [];
    const testableCapabilities = Array.from(
      new Set(
        effectiveCapabilities.filter(
          (capability): capability is ProviderTestCapability =>
            capability === "chat" || capability === "image"
        )
      )
    );
    const capability = testRequest.testCapability;

    if (!capability && testableCapabilities.length === 0) {
      return reply.code(400).send({
        ok: false,
        code: "PROVIDER_TEST_CAPABILITY_UNSUPPORTED",
        errorCode: "PROVIDER_TEST_CAPABILITY_UNSUPPORTED",
        message: providerAccountTestUnsupportedMessage
      });
    }

    if (!capability && testableCapabilities.length > 1) {
      return reply.code(400).send({
        ok: false,
        code: "TEST_CAPABILITY_REQUIRED",
        errorCode: "TEST_CAPABILITY_REQUIRED",
        message: "同时支持聊天和图像时必须明确选择测试能力"
      });
    }

    const effectiveCapability = capability ?? testableCapabilities[0];
    if (
      !effectiveCapability ||
      !effectiveCapabilities.includes(effectiveCapability)
    ) {
      return reply.code(400).send({
        ok: false,
        capability: capability ?? null,
        code: "PROVIDER_TEST_CAPABILITY_UNSUPPORTED",
        errorCode: "PROVIDER_TEST_CAPABILITY_UNSUPPORTED",
        message: providerAccountTestUnsupportedMessage
      });
    }

    if (
      effectiveCapability === "chat" &&
      providerType !== "ANTHROPIC" &&
      !isOpenAICompatibleChatProviderType(providerType)
    ) {
      return reply.code(400).send({
        ok: false,
        capability: effectiveCapability,
        code: "PROVIDER_TEST_CAPABILITY_UNSUPPORTED",
        errorCode: "PROVIDER_TEST_CAPABILITY_UNSUPPORTED",
        message: providerAccountTestUnsupportedMessage
      });
    }

    const configuredRequestFormat = resolveProviderAccountRequestFormat({
      request: testRequest,
      providerAccount: savedProviderAccount,
      providerType
    });
    const requestFormat =
      effectiveCapability === "chat"
        ? getDefaultProviderAccountRequestFormat(providerType)
        : configuredRequestFormat;
    const authMode =
      effectiveCapability === "chat"
        ? getDefaultAnthropicAuthMode({ providerType, requestFormat })
        : resolveAnthropicAuthMode({
            request: testRequest,
            providerAccount: savedProviderAccount,
            providerType,
            requestFormat
          });
    const messagesPath =
      effectiveCapability === "chat"
        ? "/v1/messages"
        : resolveAnthropicMessagesPath({
            request: testRequest,
            providerAccount: savedProviderAccount
          });
    const configJson =
      testRequest.configJson !== undefined
        ? testRequest.configJson
        : savedProviderAccount?.configJson ?? null;
    const baseUrl =
      testRequest.baseUrl?.trim() || savedProviderAccount?.baseUrl.trim() || "";
    const apiKey =
      typeof testRequest.apiKey === "string" && testRequest.apiKey.trim()
        ? testRequest.apiKey.trim()
        : savedProviderAccount?.apiKey.trim() ?? "";
    const headersJson =
      testRequest.headersJson !== undefined
        ? testRequest.headersJson
        : savedProviderAccount?.headersJson ?? null;
    const configuredTimeoutMs =
      testRequest.timeoutMs ??
      savedProviderAccount?.timeoutMs ??
      IMAGE_PROVIDER_TIMEOUT_DEFAULT_MS;

    if (!isValidImageProviderTimeoutMs(configuredTimeoutMs)) {
      return reply.code(400).send({
        ok: false,
        capability: effectiveCapability,
        code: "PROVIDER_TEST_TIMEOUT_INVALID",
        errorCode: "PROVIDER_TEST_TIMEOUT_INVALID",
        message: "timeoutMs 必须是正整数"
      });
    }
    const timeoutMs = resolveAdminDiagnosticTimeoutMs({
      requestTimeoutMs: testRequest.timeoutMs,
      providerTimeoutMs: savedProviderAccount?.timeoutMs
    });

    let imageTransport: ImageTransport | undefined;
    if (effectiveCapability === "image") {
      try {
        imageTransport = resolveImageTransport({
          providerType,
          configJson
        });
      } catch {
        return reply.code(400).send({
          ok: false,
          capability: effectiveCapability,
          code: "IMAGE_TRANSPORT_INVALID",
          errorCode: "IMAGE_TRANSPORT_INVALID",
          message: "imageTransport 配置不受支持"
        });
      }
    }

    const model = await resolveProviderAccountTestModel({
      request: testRequest,
      providerAccount: savedProviderAccount,
      store,
      capability: effectiveCapability
    });

    if (!model) {
      return reply.code(400).send({
        ok: false,
        message: providerAccountTestModelRequiredMessage
      });
    }

    const startedAt = Date.now();
    const testMessages: ChatMessage[] = [
      {
        role: "user",
        content: "Reply with OK only."
      }
    ];
    const testMaxTokens = resolveProviderAccountTestMaxTokens(configJson);

    if (!baseUrl || !apiKey) {
      return reply.code(502).send({
        ok: false,
        message: providerAccountTestFailedMessage,
        capability: effectiveCapability,
        providerType,
        requestFormat,
        ...(imageTransport ? { imageTransport } : {}),
        ...(requestFormat === "anthropic" ? { authMode } : {}),
        model,
        latencyMs: Date.now() - startedAt
      });
    }

    let chatAdapter: ChatCompletionAdapter | undefined;
    let imageAdapter: ImageGenerationAdapter | undefined;
    try {
      if (effectiveCapability === "image") {
        const imageResponseFormat = resolveImageResponseFormatConfig(configJson);
        if (!imageResponseFormat) {
          return reply.code(400).send({
            ok: false,
            capability: effectiveCapability,
            imageTransport,
            code: "PROVIDER_TEST_CONFIG_INVALID",
            errorCode: "PROVIDER_TEST_CONFIG_INVALID",
            message: "图像测试配置不受支持"
          });
        }

        imageAdapter =
          imageTransport === "legacy-extra-body-v1"
            ? createAgnesImageAdapter({
                baseUrl,
                apiKey,
                defaultModel: model,
                timeoutMs,
                headersJson,
                fetchImpl: options.fetchImpl
              })
            : createOpenAICompatibleAdapter({
                baseUrl,
                apiKey,
                defaultModel: model,
                imageResponseFormat,
                timeoutMs,
                headersJson,
                fetchImpl: options.fetchImpl
              });
      } else {
        chatAdapter =
          providerType === "ANTHROPIC"
            ? createAnthropicChatAdapter({
                baseUrl,
                apiKey,
                defaultModel: model,
                maxTokens: testMaxTokens,
                headersJson,
                timeoutMs,
                fetchImpl: options.fetchImpl
              })
            : createOpenAICompatibleAdapter({
                baseUrl,
                apiKey,
                defaultModel: model,
                timeoutMs,
                headersJson,
                fetchImpl: options.fetchImpl
              });
      }
    } catch {
      return reply.code(502).send({
        ok: false,
        message: providerAccountTestFailedMessage,
        capability: effectiveCapability,
        providerType,
        requestFormat,
        ...(imageTransport ? { imageTransport } : {}),
        ...(requestFormat === "anthropic" ? { authMode } : {}),
        model,
        latencyMs: Date.now() - startedAt
      });
    }

    const budgetDecision = decideGlobalAdminProviderTestBudget(
      globalAdminProviderTestBudgetConfigResult
    );
    if (budgetDecision.status === "unavailable") {
      return reply.code(503).send({
        ok: false,
        message: globalAdminProviderTestBudgetUnavailableMessage,
        code: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
        retryable: false
      });
    }
    if (budgetDecision.status === "attempt_cost_exceeded") {
      return reply.code(400).send({
        ok: false,
        message: "供应商测试单次成本超过预算上限",
        code: "ADMIN_PROVIDER_TEST_COST_EXCEEDED",
        retryable: false
      });
    }

    if (budgetDecision.status === "allowed") {
      let consumeResult:
        | Awaited<ReturnType<GlobalBudgetStore["consumeGlobalBudget"]>>
        | undefined;
      try {
        consumeResult = await globalBudgetStore.consumeGlobalBudget({
          scope: "admin_provider_test",
          periodType: "DAILY",
          periodKey: getUtcDailyBudgetPeriodKey(globalBudgetNow()),
          budgetCredits: budgetDecision.dailyBudgetCredits,
          costCredits: budgetDecision.attemptCostCredits
        });
      } catch {
        return reply.code(503).send({
          ok: false,
          message: globalAdminProviderTestBudgetUnavailableMessage,
          code: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
          retryable: false
        });
      }

      if (consumeResult.status === "exhausted") {
        return reply.code(503).send({
          ok: false,
          message: "供应商测试预算已用尽，请稍后重试",
          code: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_EXHAUSTED",
          retryable: false
        });
      }
      if (consumeResult.status === "unavailable") {
        return reply.code(503).send({
          ok: false,
          message: globalAdminProviderTestBudgetUnavailableMessage,
          code: "GLOBAL_ADMIN_PROVIDER_TEST_BUDGET_UNAVAILABLE",
          retryable: false
        });
      }
    }

    try {
      if (effectiveCapability === "image") {
        const adapter = imageAdapter;
        if (!adapter || !imageTransport) {
          throw new AIProviderResponseFormatError();
        }

        const imageResult = await runAdminDiagnosticWithTimeout({
          timeoutMs,
          operation: (signal) =>
            adapter.createImageGeneration({
              model,
              prompt: providerTestImagePrompt,
              size: "1024x1024",
              count: 1,
              signal
            })
        });
        const imageCount = validProviderTestImageOutputCount(
          imageResult.images
        );
        if (imageCount < 1) {
          throw new AIProviderResponseFormatError();
        }

        return {
          ok: true,
          capability: effectiveCapability,
          providerType,
          imageTransport,
          endpointPath:
            imageTransport === "openai-images"
              ? "/images/generations"
              : "/v1/images/generations",
          model,
          imageCount,
          latencyMs: Date.now() - startedAt,
          message: providerAccountTestSuccessMessage
        };
      }

      const adapter = chatAdapter;
      if (!adapter) {
        throw new AIProviderResponseFormatError();
      }

      await runAdminDiagnosticWithTimeout({
        timeoutMs,
        operation: (signal) =>
          adapter.createChatCompletion({
            model,
            temperature: 0,
            messages: testMessages,
            signal
          })
      });
      const latencyMs = Date.now() - startedAt;

      if (requestFormat === "anthropic") {
        server.log.info(
          buildAnthropicRequestDiagnostic({
            source: "provider-test",
            model,
            messages: testMessages,
            maxTokens: testMaxTokens,
            temperature: 0,
            stream: false,
            endpointPath: resolveAnthropicEndpointPath({
              baseUrl,
              messagesPath
            }),
            requestFormat,
            anthropicAuthMode: authMode,
            statusCode: 200,
            latencyMs
          }),
          "provider-test Anthropic request summary"
        );
      }

      return {
        ok: true,
        capability: effectiveCapability,
        providerType,
        requestFormat,
        ...(requestFormat === "anthropic"
          ? {
              authMode,
              endpointPath: resolveAnthropicEndpointPath({
                baseUrl,
                messagesPath
              })
            }
          : { endpointPath: "/chat/completions" }),
        model,
        latencyMs,
        message: providerAccountTestSuccessMessage
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const statusCode =
        error instanceof AIProviderRequestError ? error.statusCode : undefined;
      const endpointPath =
        error instanceof AIProviderRequestError
          ? error.endpointPath
          : effectiveCapability === "image"
            ? imageTransport === "openai-images"
              ? "/images/generations"
              : "/v1/images/generations"
            : requestFormat === "anthropic"
              ? resolveAnthropicEndpointPath({ baseUrl, messagesPath })
              : "/chat/completions";

      server.log.warn(
        {
          capability: effectiveCapability,
          providerType,
          ...(requestFormat === "anthropic" && effectiveCapability === "chat"
            ? {
                ...buildAnthropicRequestDiagnostic({
                  source: "provider-test",
                  model,
                  messages: testMessages,
                  maxTokens: testMaxTokens,
                  temperature: 0,
                  stream: false,
                  endpointPath:
                    endpointPath ??
                    resolveAnthropicEndpointPath({ baseUrl, messagesPath }),
                  requestFormat,
                  anthropicAuthMode: authMode,
                  statusCode,
                  latencyMs
                }),
                authMode
              }
            : {
                ...(effectiveCapability === "image"
                  ? { imageTransport }
                  : { requestFormat }),
                statusCode
              }),
          providerAccountId: savedProviderAccount?.id ?? null,
          hasOverrideApiKey: Boolean(testRequest.apiKey?.trim())
        },
        "Provider account test connection failed."
      );

      return reply.code(502).send({
        ok: false,
        message: adminDiagnosticErrorMessage(
          error,
          providerAccountTestFailedMessage
        ),
        capability: effectiveCapability,
        providerType,
        ...(effectiveCapability === "image"
          ? { imageTransport, endpointPath }
          : {
              requestFormat,
              ...(requestFormat === "anthropic"
                ? { authMode, endpointPath }
                : { endpointPath })
            }),
        ...(typeof statusCode === "number" ? { statusCode } : {}),
        code: providerTestErrorCode(error, "PROVIDER_TEST"),
        errorCode: providerTestErrorCode(error, "PROVIDER_TEST"),
        model,
        latencyMs
      });
    }
  });

  server.patch<{
    Params: { id: string };
  }>("/admin/provider-accounts/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const input = parseProviderAccountUpdateRequest(request.body);

    if (!input) {
      return reply.code(400).send({
        message: "valid provider account fields are required"
      });
    }

    let providerAccount: AiProviderAccountSummary | null;
    try {
      providerAccount = await store.updateProviderAccount(
        request.params.id,
        input
      );
    } catch (error) {
      if (error instanceof ProviderAccountValidationError) {
        return reply.code(400).send({
          message: "valid provider account fields are required"
        });
      }
      throw error;
    }

    if (!providerAccount) {
      return reply.code(404).send({
        message: "provider account not found"
      });
    }
    invalidateModerationRuntimeState();

    const changedFields = Object.keys(input).map((field) =>
      field === "apiKey" ? "apiKeyUpdated" : field
    );
    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "UPDATE_PROVIDER_ACCOUNT",
      targetType: "AiProviderAccount",
      targetId: providerAccount.id,
      summary: `Admin updated provider account ${providerAccount.name}: ${changedFields.join(", ")}.`,
      metadata: {
        providerAccountName: providerAccount.name,
        providerType: providerAccount.providerType,
        changedFields
      }
    });

    return { providerAccount };
  });

  server.delete<{
    Params: { id: string };
  }>("/admin/provider-accounts/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    const providerAccount = await store.disableProviderAccount(
      request.params.id
    );

    if (!providerAccount) {
      return reply.code(404).send({
        message: "provider account not found"
      });
    }
    invalidateModerationRuntimeState();

    fireAndForgetAuditLog(request, store, {
      adminUserId: admin.id,
      adminEmail: admin.email,
      action: "DISABLE_PROVIDER_ACCOUNT",
      targetType: "AiProviderAccount",
      targetId: providerAccount.id,
      summary: `Admin disabled provider account ${providerAccount.name}.`,
      metadata: {
        providerAccountName: providerAccount.name,
        providerType: providerAccount.providerType
      }
    });

    return { providerAccount };
  });

  server.patch<{
    Params: { id: string };
  }>("/admin/orders/:id/status", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);

    if (!admin) {
      return reply;
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({
        message: "status is required"
      });
    }

    const status = parseOrderStatus(request.body.status);

    if (!status || status === "PENDING") {
      return reply.code(400).send({
        message: "status must be PAID or CANCELLED"
      });
    }

    try {
      if (status === "PAID") {
        const order = await store.markOrderPaidByAdmin({
          orderId: request.params.id,
          adminUserId: admin.id,
          adminEmail: admin.email
        });

        if (!order) {
          return reply.code(404).send({
            message: "order not found"
          });
        }

        return { order };
      }

      const oldOrder = await store.findAdminOrderById(request.params.id);
      const order = await store.updateOrderStatus(request.params.id, status);

      if (!order) {
        return reply.code(404).send({
          message: "order not found"
        });
      }

      fireAndForgetAuditLog(request, store, {
        adminUserId: admin.id,
        adminEmail: admin.email,
        action: "UPDATE_ORDER_STATUS",
        targetType: "Order",
        targetId: order.id,
        summary: `Admin changed order status from ${oldOrder?.status ?? "?"} to ${status}.`,
        metadata: {
          oldStatus: oldOrder?.status,
          newStatus: status,
          userEmail: order.userEmail
        }
      });

      return { order };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "ORDER_CANCELLED_CANNOT_BE_PAID"
      ) {
        return reply.code(400).send({
          message: "cancelled orders cannot be marked paid"
        });
      }

      if (
        error instanceof Error &&
        error.message === "ORDER_PAID_CANNOT_BE_CANCELLED"
      ) {
        return reply.code(400).send({
          message: "paid orders cannot be cancelled"
        });
      }

      if (error instanceof Error && error.message === "ORDER_CREDITS_INVALID") {
        return reply.code(400).send({
          message: "order credits must be a positive integer"
        });
      }

      throw error;
    }
  });

  server.get("/chat/sessions", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    return {
      sessions: await store.listSessions(user.id)
    };
  });

  server.post("/chat/sessions", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const title =
      isRecord(request.body) && isNonEmptyString(request.body.title)
        ? request.body.title.trim()
        : "新会话";

    return {
      session: await store.createSession({
        userId: user.id,
        title
      })
    };
  });

  server.get<{
    Params: { id: string };
  }>("/chat/sessions/:id/messages", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const messages = await store.listMessages(request.params.id, user.id);

    if (!messages) {
      return reply.code(404).send({
        message: "chat session not found"
      });
    }

    return {
      messages
    };
  });

  server.patch<{
    Params: { id: string };
  }>("/chat/sessions/:id", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const title =
      isRecord(request.body) && isNonEmptyString(request.body.title)
        ? request.body.title.trim()
        : undefined;

    if (!title || title.length === 0) {
      return reply.code(400).send({
        message: "title is required"
      });
    }

    if (title.length > 200) {
      return reply.code(400).send({
        message: "title too long"
      });
    }

    const session = await store.findSessionForUser(request.params.id, user.id);

    if (!session) {
      return reply.code(404).send({
        message: "chat session not found"
      });
    }

    const updated = await store.updateSessionTitle(
      request.params.id,
      title
    );

    return {
      session: updated
    };
  });

  server.delete<{
    Params: { id: string };
  }>("/chat/sessions/:id", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const deleted = await store.deleteSession(request.params.id, user.id);

    if (!deleted) {
      return reply.code(404).send({
        message: "chat session not found"
      });
    }

    return {
      ok: true
    };
  });

  server.get("/canvas/documents", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const searchParams = new URL(request.url, "http://localhost").searchParams;
    const hasPagedQuery =
      searchParams.has("page") || searchParams.has("pageSize");
    if (hasPagedQuery) {
      const page = parsePositiveInt(searchParams.get("page")) ?? 1;
      const pageSize = Math.min(
        parsePositiveInt(searchParams.get("pageSize")) ?? 20,
        50
      );
      const result = await store.listCreatorCanvasDocumentsPageForUser(
        user.id,
        page,
        pageSize
      );
      const response: CreatorCanvasDocumentPagedListResponse = {
        documents: result.documents,
        page,
        pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / pageSize))
      };
      return response;
    }
    const limit = Math.min(
      parsePositiveInt(searchParams.get("limit")) ?? 50,
      50
    );
    const response: CreatorCanvasDocumentListResponse = {
      documents: await store.listCreatorCanvasDocumentsForUser(user.id, limit)
    };
    return response;
  });

  server.get<{
    Params: { id: string };
  }>("/canvas/documents/:id", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }
    const document = await store.findCreatorCanvasDocumentForUser(
      user.id,
      request.params.id
    );
    if (!document) {
      return reply.code(404).send({
        message: "canvas document not found"
      });
    }
    const response: CreatorCanvasDocumentResponse = { document };
    return response;
  });

  server.post("/canvas/documents", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }
    if (!isRecord(request.body) || Array.isArray(request.body)) {
      return reply.code(400).send({
        message: "canvas document state is required"
      });
    }
    if (!isCanvasDocumentState(request.body.state)) {
      return reply.code(400).send({
        code: "INVALID_CANVAS_DOCUMENT_STATE",
        message: "canvas document state is invalid"
      });
    }
    const title = parseCanvasDocumentTitle(request.body.title);
    if (!title.ok) {
      return reply.code(400).send({
        message: "canvas document title is invalid"
      });
    }

    const document = await store.createCreatorCanvasDocument({
      userId: user.id,
      title: title.title,
      state: request.body.state
    });
    const response: CreatorCanvasDocumentResponse = { document };
    return reply.code(201).send(response);
  });

  server.patch<{
    Params: { id: string };
  }>("/canvas/documents/:id", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }
    if (!isRecord(request.body) || Array.isArray(request.body)) {
      return reply.code(400).send({
        message: "canvas document state or title and expectedRevision are required"
      });
    }
    const hasState = Object.prototype.hasOwnProperty.call(request.body, "state");
    const hasTitle = Object.prototype.hasOwnProperty.call(request.body, "title");
    if (!hasState && !hasTitle) {
      return reply.code(400).send({
        message: "canvas document state or title is required"
      });
    }
    if (hasState && !isCanvasDocumentState(request.body.state)) {
      return reply.code(400).send({
        code: "INVALID_CANVAS_DOCUMENT_STATE",
        message: "canvas document state is invalid"
      });
    }
    const expectedRevision = parseCanvasDocumentExpectedRevision(
      request.body.expectedRevision
    );
    if (expectedRevision === null) {
      return reply.code(400).send({
        message: "expectedRevision must be a positive integer"
      });
    }

    const title = hasTitle
      ? parseCanvasDocumentTitle(request.body.title)
      : null;
    if (title && !title.ok) {
      return reply.code(400).send({
        message: "canvas document title is invalid"
      });
    }

    const updateInput: CreatorCanvasDocumentUpdateInput = {
      id: request.params.id,
      userId: user.id,
      expectedRevision
    };
    if (hasState) {
      updateInput.state = request.body.state as Record<string, unknown>;
    }
    if (title?.ok) updateInput.title = title.title;

    const result = await store.updateCreatorCanvasDocument(updateInput);
    if (result.status === "NOT_FOUND") {
      return reply.code(404).send({
        message: "canvas document not found"
      });
    }
    if (result.status === "CONFLICT") {
      return reply.code(409).send({
        code: "CANVAS_DOCUMENT_REVISION_CONFLICT",
        message: "canvas document was updated elsewhere"
      });
    }
    const response: CreatorCanvasDocumentResponse = {
      document: result.document
    };
    return response;
  });

  server.delete<{
    Params: { id: string };
  }>("/canvas/documents/:id", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }
    const deleted = await store.deleteCreatorCanvasDocumentForUser(
      user.id,
      request.params.id
    );
    if (!deleted) {
      return reply.code(404).send({
        message: "canvas document not found"
      });
    }
    return { ok: true };
  });

  server.post("/chat/completions", async (request, reply) => {
    const bearerToken = getBearerToken(request);
    const user = bearerToken ? await authenticate(request, reply) : null;

    if (bearerToken && !user) {
      return reply;
    }

    if (!user && !(await resolveBooleanSetting("guestModeEnabled", true))) {
      return reply.code(403).send({
        message: "guest mode is disabled; please sign in"
      });
    }

    const defaultModel = await resolveDefaultModel();
    const parsedBody = parseNonStreamChatCompletionRequest(
      request.body,
      defaultModel
    );

    if (!parsedBody) {
      return reply.code(400).send({
        message: "at least one message is required"
      });
    }

    const { request: body, stateless, suppliedSessionId } = parsedBody;
    const isStateless = stateless === true;
    if (isStateless && !user) {
      return reply.code(401).send({
        message: "authentication required"
      });
    }
    if (isStateless && suppliedSessionId) {
      return reply.code(400).send({
        message: "stateless completions cannot use a sessionId"
      });
    }

    const userMessage = latestUserMessage(body.messages);

    if (!userMessage) {
      return reply.code(400).send({
        message: "at least one user message is required"
      });
    }

    if (userMessage.content.length > MAX_CHAT_MESSAGE_LENGTH) {
      return reply.code(400).send({
        message: "消息内容过长，请缩短后重试"
      });
    }

    if (user && await enforceRateLimit({
      request,
      reply,
      rateLimiter,
      key: `chat:user:${user.id}`,
      policy: RATE_LIMITS.chatLoggedIn,
      routeIdentifier: "POST /chat/completions"
    })) return reply;

    const model = body.model.trim() || defaultModel;
    let modelConfig: RuntimeAiModel | null;
    try {
      modelConfig = await store.findModelByModelId(model);
    } catch (error) {
      if (error instanceof ModelIdentityConflictError) {
        return reply.code(503).send({
          message: "对话服务暂时不可用，请稍后重试"
        });
      }
      throw error;
    }

    if (!modelConfig?.enabled || !isChatCapableModel(modelConfig)) {
      return reply.code(400).send({
        message: "model is not available"
      });
    }

    const chatCreditCostContract = resolveChatCreditCostContract(
      modelConfig.creditCost
    );
    if (!chatCreditCostContract) {
      return reply.code(503).send({
        message: "对话服务暂时不可用，请稍后重试",
        code: "GLOBAL_CHAT_BUDGET_UNAVAILABLE",
        retryable: false
      });
    }

    const { userChargeCredits, providerBudgetCredits } =
      chatCreditCostContract;

    let session: ChatSessionSummary | null = null;
    const guestIp = user ? null : resolveClientIp(request);
    const guestUsageDate = user ? null : resolveGuestUsageDate();

    if (user) {
      const modelQuota = await store.getQuota(user.id);

      if (modelQuota.remainingCredits < userChargeCredits) {
        return reply.code(402).send({
          message: insufficientCreditsMessage(userChargeCredits)
        });
      }

      if (!isStateless) {
        session = body.sessionId
          ? await store.findSessionForUser(body.sessionId, user.id)
          : null;

        if (body.sessionId && !session) {
          return reply.code(404).send({
            message: "chat session not found"
          });
        }
      }

      const quota = await store.getQuota(user.id);

      if (modelConfig.creditCost > 0 && quota.remainingCredits <= 0) {
        return reply.code(402).send({
          message: "额度不足"
        });
      }

      if (!isStateless) {
        const isNewSession = !session;

        session ??= await store.createSession({
          userId: user.id,
          title: createSessionTitle(userMessage.content)
        });

        if (isNewSession) {
          await store.updateSessionTitle(
            session.id,
            createSessionTitle(userMessage.content)
          );
        }

        await store.createMessage({
          sessionId: session.id,
          role: "user",
          content: userMessage.content,
          model: modelConfig.slug || model
        });
      }
    } else if (!isStateless && guestIp && guestUsageDate) {
      if (!modelConfig.allowGuest) {
        return reply.code(403).send({
          message: "该模型需要登录后使用。"
        });
      }

      if (await enforceGuestChatRateLimits({
        request,
        reply,
        modelConfig,
        guestIp,
        guestUsageDate,
        routeIdentifier: "POST /chat/completions"
      })) return reply;
    }

    const chatRequestId = user ? resolveChatRequestId(request) : null;

    const concurrencySettings = await resolveConcurrencyLimitSettings();
    const concurrencyResult = await runWithRequestConcurrency({
      request,
      key: user ? `chat:user:${user.id}` : `chat:guest:ip:${guestIp}`,
      limit: user
        ? concurrencySettings.userChat
        : concurrencySettings.guestChat,
      routeIdentifier: "POST /chat/completions",
      task: async () => {
        let chatReservationId: string | null = null;
        let chatAttemptStarted = false;

        const releaseUserChatReservation = async (): Promise<boolean> => {
          if (!user || !chatReservationId) {
            return true;
          }

          try {
            const result = await store.releaseChatReservation(chatReservationId);
            return (
              result.status === "UPDATED" ||
              result.status === "ALREADY_RELEASED"
            );
          } catch {
            return false;
          }
        };

        const recordLegacyFailureForGuest = async (errorMessage: string) => {
          if (user) {
            return;
          }

          await store.createUsageLog({
            userId: null,
            sessionId: null,
            model,
            canonicalModel: modelConfig.slug || model,
            status: "FAILED",
            costCredits: 0,
            errorMessage,
            guestIp,
            guestUsageDate
          });
        };

        try {
          const attempts = await resolveChatProviderRuntimeAttempts({
            model,
            defaultModel,
            modelConfig
          });

          if ("error" in attempts) {
            return reply.code(400).send({
              message: attempts.error
            });
          }

          if (user && userChargeCredits > 0) {
            if (!chatRequestId) {
              return reply.code(500).send({ message: internalErrorMessage });
            }

            const reserved = await store.reserveChatCredits({
              userId: user.id,
              requestId: chatRequestId,
              modelId: modelConfig.slug || model,
              creditCost: userChargeCredits,
              kind: CreditReservationKind.CHAT_COMPLETION,
              expiresAt: new Date(Date.now() + CHAT_CREDIT_RESERVATION_TTL_MS)
            });

            if (!reserved.ok) {
              if (
                reserved.reason === "INSUFFICIENT_CREDITS" ||
                reserved.reason === "QUOTA_NOT_FOUND"
              ) {
                return reply.code(402).send({ message: "额度不足" });
              }

              return reply.code(503).send({
                message: "对话服务暂时不可用，请稍后重试",
                code: "GLOBAL_CHAT_BUDGET_UNAVAILABLE",
                retryable: false
              });
            }

            chatReservationId = reserved.reservation.id;
          }

          let chatBudgetEnforced: {
            dailyBudgetCredits: number;
            costCredits: number;
          } | null = null;
          type ChatBudgetLoopError = { statusCode: number; code: string };
          let budgetError: ChatBudgetLoopError | null = null;

          if (globalChatBudgetConfigResult.status === "invalid") {
            budgetError = {
              statusCode: 503,
              code: "GLOBAL_CHAT_BUDGET_UNAVAILABLE"
            };
          } else if (globalChatBudgetConfigResult.config.mode === "enforced") {
            const chatBudgetCostResult = calculateChatAttemptCost({
              modelCreditCost: providerBudgetCredits
            });

            if (chatBudgetCostResult.status === "invalid") {
              budgetError = {
                statusCode: 503,
                code: "GLOBAL_CHAT_BUDGET_UNAVAILABLE"
              };
            } else {
              const chatBudgetDecision = decideGlobalChatAttemptCost(
                globalChatBudgetConfigResult,
                chatBudgetCostResult.costCredits
              );

              if (chatBudgetDecision === "attempt_cost_exceeded") {
                budgetError = {
                  statusCode: 400,
                  code: "CHAT_ATTEMPT_COST_EXCEEDED"
                };
              } else if (chatBudgetDecision !== "allowed") {
                budgetError = {
                  statusCode: 503,
                  code: "GLOBAL_CHAT_BUDGET_UNAVAILABLE"
                };
              } else {
                chatBudgetEnforced = {
                  dailyBudgetCredits:
                    globalChatBudgetConfigResult.config.dailyBudgetCredits,
                  costCredits: chatBudgetCostResult.costCredits
                };
              }
            }
          }

          const releaseBeforeProviderFailure = async (): Promise<boolean> =>
            releaseUserChatReservation();

          if (budgetError) {
            const released = await releaseBeforeProviderFailure();
            if (!released) {
              return reply.code(500).send({ message: internalErrorMessage });
            }
            await recordLegacyFailureForGuest(budgetError.code);
            return reply.code(budgetError.statusCode).send({
              message:
                budgetError.code === "CHAT_ATTEMPT_COST_EXCEEDED"
                  ? "请求成本超出允许范围"
                  : "对话服务暂时不可用，请稍后重试",
              code: budgetError.code,
              retryable: false
            });
          }

          let completionResult:
            | {
                completion: Awaited<
                  ReturnType<ChatCompletionAdapter["createChatCompletion"]>
                >;
                routeAttempt: ChatRouteAttemptResult;
              }
            | null = null;
          let lastError: unknown = null;

          for (let index = 0; index < attempts.length; index += 1) {
            const runtime = attempts[index]!;
            if (chatBudgetEnforced) {
              const periodKey = getUtcDailyBudgetPeriodKey(globalBudgetNow());
              let consumeResult:
                | Awaited<ReturnType<GlobalBudgetStore["consumeGlobalBudget"]>>
                | undefined;
              try {
                consumeResult = await globalBudgetStore.consumeGlobalBudget({
                  scope: "chat_completion",
                  periodType: "DAILY",
                  periodKey,
                  budgetCredits: chatBudgetEnforced.dailyBudgetCredits,
                  costCredits: chatBudgetEnforced.costCredits
                });
              } catch {
                consumeResult = undefined;
              }
              if (consumeResult?.status !== "consumed") {
                budgetError = {
                  statusCode: 503,
                  code:
                    consumeResult?.status === "exhausted"
                      ? "GLOBAL_CHAT_BUDGET_EXHAUSTED"
                      : "GLOBAL_CHAT_BUDGET_UNAVAILABLE"
                };
                break;
              }
            }

            const providerRequestStartedAt = Date.now();
            if (user && chatRequestId) {
              let claimResult:
                | Awaited<ReturnType<ChatCreditStore["claimChatProviderAttempt"]>>
                | undefined;
              try {
                claimResult = await store.claimChatProviderAttempt({
                  reservationId: chatReservationId,
                  userId: user.id,
                  requestId: chatRequestId,
                  attemptIndex: index,
                  modelId: modelConfig.slug || model,
                  sessionId: session?.id ?? null,
                  providerId: runtime.providerAccount?.id ?? null,
                  providerName: runtime.providerAccount?.name ?? null,
                  upstreamModel: runtime.upstreamModel,
                  routeId: runtime.route?.id ?? null,
                  fallbackAttempts: index,
                  startedAt: new Date(providerRequestStartedAt)
                });
              } catch {
                const released = await releaseBeforeProviderFailure();
                if (!released) {
                  return reply.code(500).send({ message: internalErrorMessage });
                }
                return reply.code(500).send({ message: internalErrorMessage });
              }

              if (claimResult.status !== "CLAIMED") {
                const released = await releaseBeforeProviderFailure();
                if (!released) {
                  return reply.code(500).send({ message: internalErrorMessage });
                }
                return reply.code(500).send({ message: internalErrorMessage });
              }
              chatAttemptStarted = true;
            }

            const routeAttempt: ChatRouteAttemptResult = {
              runtime,
              attemptIndex: index,
              fallbackAttempts: index
            };

            try {
              const completion = await runtime.adapter.createChatCompletion({
                ...body,
                model: runtime.upstreamModel
              });
              completionResult = { completion, routeAttempt };
              break;
            } catch (error) {
              lastError = error;

              if (user && chatRequestId) {
                let completedAttempt:
                  | Awaited<
                      ReturnType<
                        ChatCreditStore["completeChatProviderAttempt"]
                      >
                    >
                  | undefined;
                try {
                  completedAttempt =
                    await store.completeChatProviderAttempt({
                      reservationId: chatReservationId,
                      requestId: chatRequestId,
                      attemptIndex: index,
                      status: "FAILED"
                    });
                } catch {
                  return reply.code(500).send({ message: internalErrorMessage });
                }

                const failedAttemptPersisted =
                  completedAttempt.status === "UPDATED" ||
                  (completedAttempt.status === "ALREADY_TERMINAL" &&
                    completedAttempt.attempt.status === "FAILED");
                if (!failedAttemptPersisted) {
                  return reply.code(500).send({ message: internalErrorMessage });
                }
              }

              logChatRouteFailure({
                logger: server.log,
                source: "formal-chat",
                runtime,
                model,
                body,
                error,
                startedAt: providerRequestStartedAt,
                willFallback:
                  index < attempts.length - 1 &&
                  isRetryableChatProviderError(error)
              });

              if (
                index >= attempts.length - 1 ||
                !isRetryableChatProviderError(error)
              ) {
                break;
              }
            }
          }

          if (budgetError) {
            const released = await releaseBeforeProviderFailure();
            if (!released) {
              return reply.code(500).send({ message: internalErrorMessage });
            }
            await recordLegacyFailureForGuest(budgetError.code);
            return reply.code(budgetError.statusCode).send({
              message: "对话服务暂时不可用，请稍后重试",
              code: budgetError.code,
              retryable: false
            });
          }

          if (!completionResult) {
            const released = await releaseBeforeProviderFailure();
            if (!released) {
              return reply.code(500).send({ message: internalErrorMessage });
            }

            const providerError = lastError ?? new Error("AI provider request failed");
            const rawMessage = summarizeError(providerError);
            const message = summarizePublicError(providerError, env);
            const statusCode = rawMessage.startsWith("AI provider") ? 502 : 500;
            await recordLegacyFailureForGuest(message);
            return reply.code(statusCode).send({ message });
          }

          const { completion, routeAttempt } = completionResult;
          const usageRoute = routeAttempt.runtime.route;
          const usageProviderAccount = routeAttempt.runtime.providerAccount;
          const usageFields = {
            canonicalModel: modelConfig.slug || model,
            providerId: usageProviderAccount?.id ?? null,
            providerName: usageProviderAccount?.name ?? null,
            upstreamModel: routeAttempt.runtime.upstreamModel,
            routeId: usageRoute?.id ?? null,
            fallbackAttempts: routeAttempt.fallbackAttempts
          };

          if (isStateless) {
            if (!user || !chatRequestId) {
              return reply.code(500).send({ message: internalErrorMessage });
            }
            try {
              if (chatReservationId) {
                const settled = await store.settleChatReservation(chatReservationId);
                if (
                  settled.status !== "UPDATED" &&
                  settled.status !== "ALREADY_SETTLED"
                ) {
                  return reply.code(500).send({ message: internalErrorMessage });
                }
              }

              const completedAttempt =
                await store.completeChatProviderAttempt({
                  reservationId: chatReservationId,
                  requestId: chatRequestId,
                  attemptIndex: routeAttempt.attemptIndex,
                  status: "SUCCEEDED"
                });
              const successAttemptPersisted =
                completedAttempt.status === "UPDATED" ||
                (completedAttempt.status === "ALREADY_TERMINAL" &&
                  completedAttempt.attempt.status === "SUCCEEDED");
              if (!successAttemptPersisted) {
                return reply.code(500).send({ message: internalErrorMessage });
              }
            } catch {
              return reply.code(500).send({ message: internalErrorMessage });
            }
            return completion;
          }

          if (!session) {
            await store.createUsageLog({
              userId: null,
              sessionId: null,
              model: completion.model,
              ...usageFields,
              status: "SUCCESS",
              costCredits: 0,
              errorMessage: null,
              guestIp,
              guestUsageDate
            });
            return completion;
          }

          if (!user || !chatRequestId) {
            return completion;
          }

          try {
            if (chatReservationId) {
              const settled = await store.settleChatReservation(chatReservationId);
              if (
                settled.status !== "UPDATED" &&
                settled.status !== "ALREADY_SETTLED"
              ) {
                return reply.code(500).send({ message: internalErrorMessage });
              }
            }

            await store.createMessage({
              sessionId: session.id,
              role: "assistant",
              content: completion.content,
              model: modelConfig.slug || model
            });

            const completedAttempt =
              await store.completeChatProviderAttempt({
                reservationId: chatReservationId,
                requestId: chatRequestId,
                attemptIndex: routeAttempt.attemptIndex,
                status: "SUCCEEDED"
              });
            const successAttemptPersisted =
              completedAttempt.status === "UPDATED" ||
              (completedAttempt.status === "ALREADY_TERMINAL" &&
                completedAttempt.attempt.status === "SUCCEEDED");
            if (!successAttemptPersisted) {
              return reply.code(500).send({ message: internalErrorMessage });
            }
          } catch {
            return reply.code(500).send({ message: internalErrorMessage });
          }

          return {
            ...completion,
            sessionId: session.id
          };
        } catch (error) {
          if (user && chatReservationId && !chatAttemptStarted) {
            const released = await releaseUserChatReservation();
            if (!released) {
              return reply.code(500).send({ message: internalErrorMessage });
            }
          }

          const rawMessage = summarizeError(error);
          const isProviderError = rawMessage.startsWith("AI provider");
          const message = summarizePublicError(error, env);
          const statusCode = isProviderError ? 502 : 500;

          await recordLegacyFailureForGuest(message);

          return reply.code(statusCode).send({
            message
          });
        }
      }
    });

    if (!concurrencyResult) return sendConcurrencyUnavailable(reply);
    if (!concurrencyResult.acquired) {
      return sendConcurrencyLimited(reply, "chat", concurrencyResult.retryAfterMs);
    }
    return concurrencyResult.value;
  });

  server.post("/chat/completions/stream", async (request, reply) => {
    const bearerToken = getBearerToken(request);
    const user = bearerToken ? await authenticate(request, reply) : null;

    if (bearerToken && !user) {
      return reply;
    }

    if (!user && !(await resolveBooleanSetting("guestModeEnabled", true))) {
      return reply.code(403).send({
        message: "guest mode is disabled; please sign in"
      });
    }

    const defaultModel = await resolveDefaultModel();
    const body = parseChatCompletionRequest(request.body, defaultModel);

    if (!body) {
      return reply.code(400).send({
        message: "at least one message is required"
      });
    }

    const userMessage = latestUserMessage(body.messages);

    if (!userMessage) {
      return reply.code(400).send({
        message: "at least one user message is required"
      });
    }

    if (userMessage.content.length > MAX_CHAT_MESSAGE_LENGTH) {
      return reply.code(400).send({
        message: "消息内容过长，请缩短后重试"
      });
    }

    if (user && await enforceRateLimit({
      request,
      reply,
      rateLimiter,
      key: `chat:user:${user.id}`,
      policy: RATE_LIMITS.chatLoggedIn,
      routeIdentifier: "POST /chat/completions/stream"
    })) return reply;

    const model = body.model.trim() || defaultModel;
    let modelConfig: RuntimeAiModel | null;
    try {
      modelConfig = await store.findModelByModelId(model);
    } catch (error) {
      if (error instanceof ModelIdentityConflictError) {
        return reply.code(503).send({
          message: "对话服务暂时不可用，请稍后重试"
        });
      }
      throw error;
    }

    if (!modelConfig?.enabled || !isChatCapableModel(modelConfig)) {
      return reply.code(400).send({
        message: "model is not available"
      });
    }

    const chatCreditCostContract = resolveChatCreditCostContract(
      modelConfig.creditCost
    );
    if (!chatCreditCostContract) {
      return reply.code(503).send({
        message: "对话服务暂时不可用，请稍后重试",
        code: "GLOBAL_CHAT_BUDGET_UNAVAILABLE",
        retryable: false
      });
    }

    const { userChargeCredits, providerBudgetCredits } =
      chatCreditCostContract;

    let session: ChatSessionSummary | null = null;
    const guestIp = user ? null : resolveClientIp(request);
    const guestUsageDate = user ? null : resolveGuestUsageDate();

    if (user) {
      const modelQuota = await store.getQuota(user.id);

      if (modelQuota.remainingCredits < userChargeCredits) {
        return reply.code(402).send({
          message: insufficientCreditsMessage(userChargeCredits)
        });
      }

      session = body.sessionId
        ? await store.findSessionForUser(body.sessionId, user.id)
        : null;

      if (body.sessionId && !session) {
        return reply.code(404).send({
          message: "chat session not found"
        });
      }

      const quota = await store.getQuota(user.id);

      if (modelConfig.creditCost > 0 && quota.remainingCredits <= 0) {
        return reply.code(402).send({
          message: "额度不足"
        });
      }

      const isNewSession = !session;

      session ??= await store.createSession({
        userId: user.id,
        title: createSessionTitle(userMessage.content)
      });

      if (isNewSession) {
        await store.updateSessionTitle(
          session.id,
          createSessionTitle(userMessage.content)
        );
      }

      await store.createMessage({
        sessionId: session.id,
        role: "user",
        content: userMessage.content,
        model: modelConfig.slug || model
      });
    } else if (guestIp && guestUsageDate) {
      if (!modelConfig.allowGuest) {
        return reply.code(403).send({
          message: "该模型需要登录后使用。"
        });
      }

      if (await enforceGuestChatRateLimits({
        request,
        reply,
        modelConfig,
        guestIp,
        guestUsageDate,
        routeIdentifier: "POST /chat/completions/stream"
      })) return reply;
    }

    const chatRequestId = user ? resolveChatRequestId(request) : null;

    const providerRuntimes = await resolveChatProviderRuntimeAttempts({
      model,
      defaultModel,
      modelConfig
    });

    if ("error" in providerRuntimes) {
      return reply.code(400).send({
        message: providerRuntimes.error
      });
    }

    const concurrencySettings = await resolveConcurrencyLimitSettings();
    const concurrencyResult = await runWithRequestConcurrency({
      request,
      key: user ? `chat:user:${user.id}` : `chat:guest:ip:${guestIp}`,
      limit: user
        ? concurrencySettings.userChat
        : concurrencySettings.guestChat,
      routeIdentifier: "POST /chat/completions/stream",
      task: async () => {
        let clientAborted = false;
        let responseEnded = false;
        const clientAbortController = new AbortController();
        let chatReservationId: string | null = null;
        let reservationSettled = false;
        let reservationReleased = false;
        let releaseAttempted = false;
        let settleAttempted = false;
        let currentAttemptClaimed = false;
        let currentAttemptTerminal = false;
        let currentAttemptIndex: number | null = null;
        let providerInvocationStarted = false;
        let providerStarted = false;
        let attemptStateUnknown = false;

        const abortForClientDisconnect = () => {
          if (
            responseEnded ||
            reply.raw.writableEnded ||
            reply.raw.writableFinished ||
            clientAborted
          ) {
            return;
          }
          clientAborted = true;
          clientAbortController.abort();
        };

        const requestSocket = request.raw.socket;
        const cleanupClientAbortListeners = () => {
          request.raw.off("aborted", abortForClientDisconnect);
          reply.raw.off("close", abortForClientDisconnect);
          requestSocket?.off("close", abortForClientDisconnect);
        };
        const setupClientAbortListeners = () => {
          request.raw.on("aborted", abortForClientDisconnect);
          reply.raw.on("close", abortForClientDisconnect);
          requestSocket?.on("close", abortForClientDisconnect);
        };

        setupClientAbortListeners();

        const runChatRequest = async () => {

        const isClientAborted = () => {
          if (request.raw.aborted || request.raw.socket?.destroyed) {
            abortForClientDisconnect();
          }
          return clientAborted;
        };

        const safeEnd = () => {
          if (!responseEnded && !reply.raw.writableEnded) {
            const clientWasAborted = isClientAborted();
            responseEnded = true;
            if (!clientWasAborted) {
              reply.raw.end();
            }
          }
        };

        const safeWriteEvent = (
          event: ChatStreamEvent,
          data: Record<string, unknown>
        ) => {
          if (!isClientAborted() && !reply.raw.writableEnded) {
            writeChatStreamEvent(reply, event, data);
          }
        };

        const releaseUserChatReservation = async (): Promise<boolean> => {
          if (
            !user ||
            !chatReservationId ||
            reservationSettled ||
            reservationReleased
          ) {
            return true;
          }
          if (releaseAttempted) {
            return false;
          }
          releaseAttempted = true;

          try {
            const result = await store.releaseChatReservation(chatReservationId);
            if (
              result.status === "UPDATED" ||
              result.status === "ALREADY_RELEASED"
            ) {
              reservationReleased = true;
              return true;
            }
            if (result.status === "ALREADY_SETTLED") {
              reservationSettled = true;
              return true;
            }
            return false;
          } catch {
            return false;
          }
        };

        const settleUserChatReservation = async (): Promise<boolean> => {
          if (!user || reservationReleased) {
            return chatReservationId === null;
          }
          if (!chatReservationId) {
            return true;
          }
          if (reservationSettled) {
            return true;
          }
          if (settleAttempted) {
            return false;
          }
          settleAttempted = true;

          try {
            const result = await store.settleChatReservation(chatReservationId);
            if (
              result.status === "UPDATED" ||
              result.status === "ALREADY_SETTLED"
            ) {
              reservationSettled = true;
              return true;
            }
            return false;
          } catch {
            return false;
          }
        };

        const completeCurrentAttempt = async (
          status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "ABORTED"
        ): Promise<boolean> => {
          if (
            !user ||
            !chatRequestId ||
            !currentAttemptClaimed ||
            currentAttemptTerminal ||
            currentAttemptIndex === null
          ) {
            return true;
          }

          try {
            const result = await store.completeChatProviderAttempt({
              reservationId: chatReservationId,
              requestId: chatRequestId,
              attemptIndex: currentAttemptIndex,
              status
            });
            if (result.status === "UPDATED") {
              currentAttemptTerminal = true;
              return true;
            }
            if (
              result.status === "ALREADY_TERMINAL" &&
              String(result.attempt.status) === status
            ) {
              currentAttemptTerminal = true;
              return true;
            }
            return false;
          } catch {
            return false;
          }
        };

        const recordGuestFailure = async (errorMessage: string) => {
          if (user) {
            return;
          }

          await store.createUsageLog({
            userId: null,
            sessionId: session?.id ?? null,
            model,
            canonicalModel: modelConfig.slug || model,
            status: "FAILED",
            costCredits: 0,
            errorMessage,
            guestIp,
            guestUsageDate
          });
        };

        const sendSafeSseFailure = async (error: unknown) => {
          const rawMessage = summarizeError(error);
          const message = summarizePublicError(error, env);
          server.log.error(
            {
              source: "stream-chat",
              errorName: safeErrorName(error),
              isProviderError: rawMessage.startsWith("AI provider")
            },
            "chat completion stream failed"
          );
          await recordGuestFailure(message);
          safeWriteEvent("error", {
            message,
            code: getChatStreamErrorCode(error)
          });
          safeEnd();
        };

        type ChatStreamBudgetErrorCode =
          | "GLOBAL_CHAT_BUDGET_EXHAUSTED"
          | "GLOBAL_CHAT_BUDGET_UNAVAILABLE";

        const sendBudgetJsonError = async (
          code:
            | ChatStreamBudgetErrorCode
            | "CHAT_ATTEMPT_COST_EXCEEDED"
        ): Promise<FastifyReply> => {
          await recordGuestFailure(code);
          if (isClientAborted() || reply.raw.writableEnded) {
            return reply;
          }
          const attemptCostExceeded = code === "CHAT_ATTEMPT_COST_EXCEEDED";
          return reply.code(attemptCostExceeded ? 400 : 503).send({
            message: attemptCostExceeded
              ? "请求成本超出允许范围"
              : "对话服务暂时不可用，请稍后重试",
            code,
            retryable: false
          });
        };

        if (isClientAborted()) {
          return reply;
        }

        if (user && userChargeCredits > 0) {
          if (!chatRequestId) {
            return reply.code(500).send({ message: internalErrorMessage });
          }

          let reserved: Awaited<ReturnType<ChatCreditStore["reserveChatCredits"]>>;
          try {
            reserved = await store.reserveChatCredits({
              userId: user.id,
              requestId: chatRequestId,
              modelId: modelConfig.slug || model,
              creditCost: userChargeCredits,
              kind: CreditReservationKind.CHAT_STREAM,
              expiresAt: new Date(Date.now() + CHAT_CREDIT_RESERVATION_TTL_MS)
            });
          } catch {
            return reply.code(503).send({
              message: "对话服务暂时不可用，请稍后重试",
              code: "GLOBAL_CHAT_BUDGET_UNAVAILABLE",
              retryable: false
            });
          }

          if (!reserved.ok) {
            if (
              reserved.reason === "INSUFFICIENT_CREDITS" ||
              reserved.reason === "QUOTA_NOT_FOUND"
            ) {
              return reply.code(402).send({ message: "额度不足" });
            }

            return reply.code(503).send({
              message: "对话服务暂时不可用，请稍后重试",
              code: "GLOBAL_CHAT_BUDGET_UNAVAILABLE",
              retryable: false
            });
          }

          chatReservationId = reserved.reservation.id;
        }

        let chatBudgetEnforced: {
          dailyBudgetCredits: number;
          costCredits: number;
        } | null = null;
        let budgetErrorBeforeHeaders:
          | ChatStreamBudgetErrorCode
          | "CHAT_ATTEMPT_COST_EXCEEDED"
          | null = null;

        if (globalChatBudgetConfigResult.status === "invalid") {
          budgetErrorBeforeHeaders = "GLOBAL_CHAT_BUDGET_UNAVAILABLE";
        } else if (globalChatBudgetConfigResult.config.mode === "enforced") {
          const chatBudgetCostResult = calculateChatAttemptCost({
            modelCreditCost: providerBudgetCredits
          });

          if (chatBudgetCostResult.status === "invalid") {
            budgetErrorBeforeHeaders = "GLOBAL_CHAT_BUDGET_UNAVAILABLE";
          } else {
            const chatBudgetDecision = decideGlobalChatAttemptCost(
              globalChatBudgetConfigResult,
              chatBudgetCostResult.costCredits
            );

            if (chatBudgetDecision === "attempt_cost_exceeded") {
              budgetErrorBeforeHeaders = "CHAT_ATTEMPT_COST_EXCEEDED";
            } else if (chatBudgetDecision !== "allowed") {
              budgetErrorBeforeHeaders = "GLOBAL_CHAT_BUDGET_UNAVAILABLE";
            } else {
              chatBudgetEnforced = {
                dailyBudgetCredits:
                  globalChatBudgetConfigResult.config.dailyBudgetCredits,
                costCredits: chatBudgetCostResult.costCredits
              };
            }
          }
        }

        const releaseBeforeProviderFailure = async (): Promise<boolean> =>
          releaseUserChatReservation();

        if (budgetErrorBeforeHeaders) {
          const released = await releaseBeforeProviderFailure();
          if (!released) {
            return reply.code(500).send({ message: internalErrorMessage });
          }
          return sendBudgetJsonError(budgetErrorBeforeHeaders);
        }

        const consumeGlobalChatBudget = async (): Promise<
          "consumed" | "exhausted" | "unavailable"
        > => {
          if (!chatBudgetEnforced) {
            return "consumed";
          }

          if (
            !Number.isSafeInteger(chatBudgetEnforced.costCredits) ||
            chatBudgetEnforced.costCredits <= 0
          ) {
            return "unavailable";
          }

          let consumeResult:
            | Awaited<ReturnType<GlobalBudgetStore["consumeGlobalBudget"]>>
            | undefined;
          try {
            consumeResult = await globalBudgetStore.consumeGlobalBudget({
              scope: "chat_completion",
              periodType: "DAILY",
              periodKey: getUtcDailyBudgetPeriodKey(globalBudgetNow()),
              budgetCredits: chatBudgetEnforced.dailyBudgetCredits,
              costCredits: chatBudgetEnforced.costCredits
            });
          } catch {
            return "unavailable";
          }

          return consumeResult?.status ?? "unavailable";
        };

        const firstBudgetResult = await consumeGlobalChatBudget();
        if (firstBudgetResult !== "consumed") {
          const released = await releaseBeforeProviderFailure();
          if (!released) {
            return reply.code(500).send({ message: internalErrorMessage });
          }
          return sendBudgetJsonError(
            firstBudgetResult === "exhausted"
              ? "GLOBAL_CHAT_BUDGET_EXHAUSTED"
              : "GLOBAL_CHAT_BUDGET_UNAVAILABLE"
          );
        }
        if (isClientAborted()) {
          const released = await releaseBeforeProviderFailure();
          if (!released) {
            return reply.code(500).send({ message: internalErrorMessage });
          }
          return reply;
        }

        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        });

        safeWriteEvent("meta", {
          sessionId: session?.id ?? null,
          model
        });

        try {
          let streamResult:
            | {
                completion: Awaited<
                  ReturnType<
                    StreamingChatCompletionAdapter["createStreamingChatCompletion"]
                  >
                >;
                routeAttempt: ChatRouteAttemptResult;
              }
            | null = null;
          let lastError: unknown = null;
          let budgetErrorAfterHeaders: ChatStreamBudgetErrorCode | null = null;

          for (let index = 0; index < providerRuntimes.length; index += 1) {
            const runtime = providerRuntimes[index]!;

            if (isClientAborted()) {
              break;
            }

            if (index > 0) {
              const budgetResult = await consumeGlobalChatBudget();
              if (budgetResult !== "consumed") {
                budgetErrorAfterHeaders =
                  budgetResult === "exhausted"
                    ? "GLOBAL_CHAT_BUDGET_EXHAUSTED"
                    : "GLOBAL_CHAT_BUDGET_UNAVAILABLE";
                break;
              }
              if (isClientAborted()) {
                break;
              }
            }

            if (isClientAborted()) {
              break;
            }

            currentAttemptIndex = index;
            currentAttemptClaimed = false;
            currentAttemptTerminal = false;
            providerInvocationStarted = false;
            providerStarted = false;

            const routeAttempt: ChatRouteAttemptResult = {
              runtime,
              attemptIndex: index,
              fallbackAttempts: index
            };
            const providerRequestStartedAt = Date.now();

            if (user && chatRequestId) {
              let claimResult:
                | Awaited<
                    ReturnType<ChatCreditStore["claimChatProviderAttempt"]>
                  >
                | undefined;
              try {
                claimResult = await store.claimChatProviderAttempt({
                  reservationId: chatReservationId,
                  userId: user.id,
                  requestId: chatRequestId,
                  attemptIndex: index,
                  modelId: modelConfig.slug || model,
                  sessionId: session?.id ?? null,
                  providerId: runtime.providerAccount?.id ?? null,
                  providerName: runtime.providerAccount?.name ?? null,
                  upstreamModel: runtime.upstreamModel,
                  routeId: runtime.route?.id ?? null,
                  fallbackAttempts: index,
                  startedAt: new Date(providerRequestStartedAt)
                });
              } catch {
                attemptStateUnknown = true;
                lastError = new Error("CHAT_STREAM_ATTEMPT_MARKER_FAILED");
                break;
              }

              if (claimResult.status !== "CLAIMED") {
                lastError = new Error("CHAT_STREAM_ATTEMPT_MARKER_INVALID");
                break;
              }
              currentAttemptClaimed = true;
            }

            try {
              providerInvocationStarted = true;
              const completion =
                await runtime.adapter.createStreamingChatCompletion({
                  ...body,
                  model: runtime.upstreamModel,
                  signal: clientAbortController.signal,
                  onDelta: async (delta) => {
                    if (isClientAborted() || reply.raw.writableEnded) {
                      throw new Error("client aborted");
                    }

                    providerStarted = true;
                    if (user && !(await settleUserChatReservation())) {
                      throw new Error("CHAT_STREAM_SETTLE_FAILED");
                    }
                    if (isClientAborted() || reply.raw.writableEnded) {
                      throw new Error("client aborted");
                    }

                    safeWriteEvent("delta", {
                      content: delta.content
                    });
                  }
                });
              providerStarted = true;
              if (user && !(await settleUserChatReservation())) {
                throw new Error("CHAT_STREAM_SETTLE_FAILED");
              }
              streamResult = { completion, routeAttempt };
              break;
            } catch (error) {
              lastError = error;
              const rawMessage = summarizeError(error);
              const disconnected =
                isClientAborted() || rawMessage === "client aborted";
              const attemptStarted = providerStarted;
              const terminalStatus = attemptStarted
                ? disconnected
                  ? ("ABORTED" as const)
                  : ("UNKNOWN" as const)
                : disconnected && providerInvocationStarted
                  ? ("UNKNOWN" as const)
                  : ("FAILED" as const);
              if (!(await completeCurrentAttempt(terminalStatus))) {
                attemptStateUnknown = true;
              }

              const canFallback =
                !disconnected &&
                !attemptStarted &&
                !attemptStateUnknown &&
                index < providerRuntimes.length - 1 &&
                isRetryableChatProviderError(error);

              logChatRouteFailure({
                logger: server.log,
                source: "stream-chat",
                runtime,
                model,
                body,
                error,
                startedAt: providerRequestStartedAt,
                willFallback: canFallback
              });

              if (!canFallback) {
                break;
              }
            }
          }

          if (budgetErrorAfterHeaders) {
            const released =
              !attemptStateUnknown &&
              !reservationSettled &&
              !providerStarted &&
              (await releaseBeforeProviderFailure());
            if (!released && !reservationSettled) {
              await sendSafeSseFailure(new Error("CHAT_STREAM_RELEASE_FAILED"));
              return reply;
            }
            safeWriteEvent("error", {
              message: "对话服务暂时不可用，请稍后重试",
              code: budgetErrorAfterHeaders
            });
            safeEnd();
            return reply;
          }

          if (isClientAborted()) {
            if (
              !attemptStateUnknown &&
              !reservationSettled &&
              !providerStarted
            ) {
              const released = await releaseBeforeProviderFailure();
              if (!released) {
                return reply;
              }
            }
            safeEnd();
            return reply;
          }

          if (!streamResult) {
            if (!attemptStateUnknown && !reservationSettled && !providerStarted) {
              const released = await releaseBeforeProviderFailure();
              if (!released) {
                await sendSafeSseFailure(new Error("CHAT_STREAM_RELEASE_FAILED"));
                return reply;
              }
            }
            await sendSafeSseFailure(
              lastError ?? new Error("AI provider stream response format is invalid")
            );
            return reply;
          }

          const { completion, routeAttempt } = streamResult;

          if (isClientAborted()) {
            if (!(await completeCurrentAttempt("ABORTED"))) {
              attemptStateUnknown = true;
            }
            safeEnd();
            return reply;
          }

          const usageProviderAccount = routeAttempt.runtime.providerAccount;
          const usageFields = {
            canonicalModel: modelConfig.slug || model,
            providerId: usageProviderAccount?.id ?? null,
            providerName: usageProviderAccount?.name ?? null,
            upstreamModel: routeAttempt.runtime.upstreamModel,
            routeId: routeAttempt.runtime.route?.id ?? null,
            fallbackAttempts: routeAttempt.fallbackAttempts
          };

          if (!user) {
            await store.createUsageLog({
              userId: null,
              sessionId: session?.id ?? null,
              model: completion.model,
              ...usageFields,
              status: "SUCCESS",
              costCredits: 0,
              errorMessage: null,
              guestIp,
              guestUsageDate
            });
            safeWriteEvent("done", {
              sessionId: session?.id ?? null,
              model: completion.model
            });
            safeEnd();
            return reply;
          }

          if (!session || !chatRequestId) {
            throw new Error("CHAT_STREAM_SESSION_STATE_INVALID");
          }

          if (
            chatReservationId &&
            !reservationSettled &&
            !(await settleUserChatReservation())
          ) {
            throw new Error("CHAT_STREAM_SETTLE_FAILED");
          }

          await store.createMessage({
            sessionId: session.id,
            role: "assistant",
            content: completion.content,
            model: modelConfig.slug || model
          });

          if (!(await completeCurrentAttempt("SUCCEEDED"))) {
            attemptStateUnknown = true;
            throw new Error("CHAT_STREAM_ATTEMPT_TERMINAL_FAILED");
          }
          safeWriteEvent("done", {
            sessionId: session.id,
            model: completion.model
          });
          safeEnd();
          return reply;
        } catch (error) {
          const rawMessage = summarizeError(error);
          const disconnected =
            isClientAborted() || rawMessage === "client aborted";

          if (currentAttemptClaimed && !currentAttemptTerminal) {
            const terminalStatus = providerStarted
              ? disconnected
                ? ("ABORTED" as const)
                : ("UNKNOWN" as const)
              : providerInvocationStarted
                ? ("UNKNOWN" as const)
                : ("FAILED" as const);
            if (!(await completeCurrentAttempt(terminalStatus))) {
              attemptStateUnknown = true;
            }
          }

          if (
            !disconnected &&
            !attemptStateUnknown &&
            !reservationSettled &&
            !providerStarted
          ) {
            const released = await releaseBeforeProviderFailure();
            if (!released && !reservationSettled) {
              await sendSafeSseFailure(new Error("CHAT_STREAM_RELEASE_FAILED"));
              return reply;
            }
          }

          if (disconnected) {
            safeEnd();
            return reply;
          }

          await sendSafeSseFailure(error);
          return reply;
        }
        };

        try {
          return await runChatRequest();
        } finally {
          cleanupClientAbortListeners();
        }
      }
    });

    if (!concurrencyResult) return sendConcurrencyUnavailable(reply);
    if (!concurrencyResult.acquired) {
      return sendConcurrencyLimited(reply, "chat", concurrencyResult.retryAfterMs);
    }
    return concurrencyResult.value;
  });

  type ImageIdempotencyReadState = Awaited<
    ReturnType<IdempotencyRequestStore["readIdempotencyRequestState"]>
  >;

  type PendingChatFormatImageOutput =
    {
      index: number;
      kind: "LOCAL_STORAGE_OBJECT";
      storageObjectId: string;
      mimeType: GeneratedAssetMimeType;
    };

  type ModeratableImageOutput = GeneratedImageOutput | ParsedChatFormatImage;

  type ImageModerationOutputResult =
    | { status: "allowed"; output: ModeratableImageOutput }
    | { status: "blocked"; output: ModeratableImageOutput; categories: string[] }
    | { status: "failed"; output: ModeratableImageOutput };

  type ImageModerationBatchResult = {
    results: ImageModerationOutputResult[];
    latencyMs: number;
  };

  function detectModerationImageMimeType(
    base64: string
  ): "image/png" | "image/jpeg" | "image/webp" | null {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, "base64");
    } catch {
      return null;
    }

    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
    if (
      bytes.byteLength >= pngSignature.byteLength &&
      bytes.subarray(0, pngSignature.byteLength).equals(pngSignature)
    ) {
      return "image/png";
    }

    if (
      bytes.byteLength >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    ) {
      return "image/jpeg";
    }

    if (
      bytes.byteLength >= 20 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp";
    }

    return null;
  }

  function toModerationImageInput(
    image: ModeratableImageOutput
  ): { url: string } | null {
    if (image.sourceType === "url") {
      return typeof image.url === "string" && image.url.trim()
        ? { url: image.url }
        : null;
    }

    if (image.sourceType === "data-url") {
      return typeof image.dataUrl === "string" && image.dataUrl.trim()
        ? { url: image.dataUrl }
        : null;
    }

    if (image.sourceType === "base64") {
      const mimeType = detectModerationImageMimeType(image.base64);
      return mimeType
        ? { url: `data:${mimeType};base64,${image.base64}` }
        : null;
    }

    return null;
  }

  function normalizeModerationDecision(
    decision: ImageModerationDecision
  ): { status: "allowed" } | { status: "blocked"; categories: string[] } | null {
    if (decision.status === "allowed") {
      return { status: "allowed" };
    }
    if (
      decision.status === "blocked" &&
      Array.isArray(decision.categories) &&
      decision.categories.every((category) => typeof category === "string")
    ) {
      return {
        status: "blocked",
        categories: [...new Set(decision.categories)].sort()
      };
    }
    return null;
  }

  async function moderateImageOutputs(
    outputs: ModeratableImageOutput[],
    maxConcurrency: number,
    moderationRuntime: ImageModerationRuntime
  ): Promise<ImageModerationBatchResult> {
    if (!moderationRuntime.enabled) {
      return {
        results: outputs.map((output) => ({ status: "allowed", output })),
        latencyMs: 0
      };
    }

    const startedAt = Date.now();
    const results: Array<ImageModerationOutputResult | undefined> = new Array(
      outputs.length
    );
    let nextIndex = 0;
    const moderateOne = async (
      output: ModeratableImageOutput
    ): Promise<ImageModerationOutputResult> => {
      const input = toModerationImageInput(output);
      if (!input || !moderationRuntime.client) {
        return { status: "failed", output };
      }

      try {
        const decision = normalizeModerationDecision(
          await moderationRuntime.client.moderateImage(input)
        );
        if (!decision) {
          return { status: "failed", output };
        }
        const blockedCategories =
          decision.status === "blocked"
            ? decision.categories.filter((category) => category === "sexual")
            : [];
        return blockedCategories.length > 0
          ? { status: "blocked", output, categories: blockedCategories }
          : { status: "allowed", output };
      } catch {
        return { status: "failed", output };
      }
    };
    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex++;
        const output = outputs[index];
        if (output === undefined) {
          return;
        }
        results[index] = await moderateOne(output);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(Math.max(1, maxConcurrency), outputs.length) },
        () => worker()
      )
    );
    const completedResults = outputs.map(
      (output, index): ImageModerationOutputResult =>
        results[index] ?? { status: "failed", output }
    );

    return {
      results: completedResults,
      latencyMs: safeImageDurationMs(startedAt)
    };
  }

  async function moderateImagePrompt(
    prompt: string,
    resolveModerationRuntime: () => Promise<ImageModerationRuntime>
  ): Promise<
    (
      | { status: "allowed"; latencyMs: number }
      | { status: "blocked"; categories: string[]; latencyMs: number }
      | { status: "failed"; latencyMs: number }
    ) & { runtime: ImageModerationRuntime }
  > {
    const startedAt = Date.now();
    let moderationRuntime: ImageModerationRuntime = {
      enabled: true,
      moderationModel: null
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const expectedEpoch = moderationInputCache.currentEpoch;
      try {
        moderationRuntime = await resolveModerationRuntime();
        if (moderationInputCache.currentEpoch !== expectedEpoch) {
          throw new ModerationInputCacheEpochChangedError();
        }
        if (!moderationRuntime.enabled) {
          return { status: "allowed", latencyMs: 0, runtime: moderationRuntime };
        }
        if (!moderationRuntime.client || !moderationRuntime.prepareText) {
          return {
            status: "failed",
            latencyMs: safeImageDurationMs(startedAt),
            runtime: moderationRuntime
          };
        }

        const cacheSettings = await syncModerationInputCacheSettings();
        if (moderationInputCache.currentEpoch !== expectedEpoch) {
          throw new ModerationInputCacheEpochChangedError();
        }
        const prepared = await moderationRuntime.prepareText(
          cacheSettings.policyVersion
        );
        const cached = await moderationInputCache.getOrExecute({
          expectedEpoch,
          text: prompt,
          policyFingerprint: prepared.policyFingerprint,
          execute: prepared.moderate
        });
        if (moderationInputCache.currentEpoch !== expectedEpoch) {
          throw new ModerationInputCacheEpochChangedError();
        }
        const decision = normalizeModerationDecision(cached.decision);
        if (!decision) {
          return {
            status: "failed",
            latencyMs: safeImageDurationMs(startedAt),
            runtime: moderationRuntime
          };
        }
        server.log.info(
          {
            inputType: "text",
            outcome: decision.status,
            cacheOutcome: cached.cacheOutcome,
            latencyMs: safeImageDurationMs(startedAt),
            routeId: null,
            providerAccountId: null,
            attemptCount: 0,
            failoverCount: 0
          },
          "image moderation cache result"
        );
        return decision.status === "blocked"
          ? {
              status: "blocked",
              categories: decision.categories,
              latencyMs: safeImageDurationMs(startedAt),
              runtime: moderationRuntime
            }
          : {
              status: "allowed",
              latencyMs: safeImageDurationMs(startedAt),
              runtime: moderationRuntime
            };
      } catch (error) {
        if (error instanceof ModerationInputCacheEpochChangedError && attempt === 0) {
          continue;
        }
        return {
          status: "failed",
          latencyMs: safeImageDurationMs(startedAt),
          runtime: moderationRuntime
        };
      }
    }

    return {
      status: "failed",
      latencyMs: safeImageDurationMs(startedAt),
      runtime: moderationRuntime
    };
  }

  function normalizeImageProviderOutputs(
    outputs: GeneratedImageOutput[]
  ): GeneratedImageOutput[] {
    return outputs
      .filter((output) =>
        output.sourceType === "url"
          ? isValidGeneratedImageUrl(output.url)
          : isValidGeneratedImageBase64(output.base64)
      );
  }

  type PreparedImageOutput = {
    storageObjectId: string;
    mimeType: GeneratedAssetMimeType;
    revisedPrompt?: string;
  };

  async function persistGeneratedImageOutput(input: {
    userId: string;
    image: GeneratedImageOutput | ParsedChatFormatImage;
  }): Promise<PreparedImageOutput | null> {
    const { image } = input;
    const revisedPrompt =
      "revisedPrompt" in image && typeof image.revisedPrompt === "string"
        ? { revisedPrompt: image.revisedPrompt }
        : {};

    if (image.sourceType === "base64") {
      if (!isValidGeneratedImageBase64(image.base64)) {
        return null;
      }

      try {
        const stored =
          await localStorageObjectService.persistLocalImageStorageObject({
            userId: input.userId,
            source: StorageObjectSource.GENERATED,
            base64: image.base64,
            maxBytes: DEFAULT_GENERATED_ASSETS_MAX_BYTES
          });
        return {
          storageObjectId: stored.storageObjectId,
          mimeType: stored.mimeType,
          ...revisedPrompt
        };
      } catch (error) {
        if (isInvalidGeneratedImageOutputError(error)) {
          return null;
        }
        throw createImageAssetPersistenceError(error);
      }
    }

    if (image.sourceType === "data-url") {
      if (!image.dataUrl || !parseGeneratedImageDataUrl(image.dataUrl)) {
        return null;
      }

      try {
        const stored =
          await localStorageObjectService.persistLocalImageStorageObject({
            userId: input.userId,
            source: StorageObjectSource.GENERATED,
            dataUrl: image.dataUrl,
            maxBytes: DEFAULT_GENERATED_ASSETS_MAX_BYTES
          });
        return {
          storageObjectId: stored.storageObjectId,
          mimeType: stored.mimeType
        };
      } catch (error) {
        if (isInvalidGeneratedImageOutputError(error)) {
          return null;
        }
        throw createImageAssetPersistenceError(error);
      }
    }

    if (!isValidGeneratedImageUrl(image.url)) {
      return null;
    }

    if (remoteImageAllowedHostRules.length === 0) {
      throw createImageAssetPersistenceError();
    }

    try {
      validateRemoteImageDownloadUrl(
        image.url,
        remoteImageAllowedHostRules
      );
      const fetchResult = await remoteImageFetcher.fetchRemoteImage({
        url: image.url,
        allowedHosts: remoteImageAllowedHostRules
      });
      const stored = await remoteImageStorageService.persistRemoteImage({
        userId: input.userId,
        fetchResult
      });
      return {
        storageObjectId: stored.storageObjectId,
        mimeType: stored.mimeType,
        ...revisedPrompt
      };
    } catch (error) {
      if (isInvalidGeneratedImageOutputError(error)) {
        return null;
      }
      throw createImageAssetPersistenceError(error);
    }
  }

  function getCanonicalImageSuccessAssets(
    assets: AiAssetSummary[]
  ): AiAssetSummary[] {
    return assets.map((asset, fallbackIndex) => ({
      asset,
      index:
        typeof asset.metadata?.imageOutputIndex === "number" &&
        Number.isInteger(asset.metadata.imageOutputIndex) &&
        asset.metadata.imageOutputIndex >= 0
          ? asset.metadata.imageOutputIndex
          : null,
      fallbackIndex
    }))
      .sort((left, right) =>
        left.index === null
          ? right.index === null
            ? left.asset.id.localeCompare(right.asset.id) ||
              left.fallbackIndex - right.fallbackIndex
            : 1
          : right.index === null
            ? -1
            : left.index - right.index ||
              left.asset.id.localeCompare(right.asset.id) ||
              left.fallbackIndex - right.fallbackIndex
      )
      .map(({ asset }) => asset);
  }

  function sendIdempotencyInProgress(
    reply: FastifyReply,
    taskId: string | null
  ): FastifyReply {
    reply.header(
      "Retry-After",
      String(IMAGE_IDEMPOTENCY_RETRY_AFTER_MS / 1_000)
    );
    reply.code(202).send({
      status: "in_progress",
      taskId,
      retryAfterMs: IMAGE_IDEMPOTENCY_RETRY_AFTER_MS
    });
    return reply;
  }

  async function sendIdempotencySucceededReplay(
    userId: string,
    taskId: string | null,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    if (!taskId) {
      return sendIdempotencyResultUnavailable(reply);
    }

    let detail: Awaited<ReturnType<UserStore["findAiTaskForUser"]>> = null;
    let readFailed = false;
    try {
      detail = await store.findAiTaskForUser(userId, taskId);
    } catch {
      readFailed = true;
    }

    if (readFailed) {
      return sendImageGenerationFailure(
        reply,
        500,
        "IMAGE_GENERATION_FAILED"
      );
    }
    if (!detail) {
      return sendIdempotencyResultUnavailable(reply);
    }

    const assets = getCanonicalImageSuccessAssets(detail.assets);

    reply.code(200).send({ task: detail.task, assets });
    return reply;
  }

  function sendIdempotencyFailedReplay(
    reply: FastifyReply,
    responseStatus: number,
    responseCode: string | null
  ): FastifyReply {
    const code = responseCode ?? "IDEMPOTENCY_REQUEST_FAILED";
    reply.code(responseStatus).send({
      message: getImageIdempotencyFailureMessage(code),
      code,
      retryable: false
    });
    return reply;
  }

  async function replyFromIdempotencyReadState(
    userId: string,
    state: ImageIdempotencyReadState,
    reply: FastifyReply
  ): Promise<boolean> {
    switch (state.status) {
      case "NOT_FOUND":
        return false;
      case "CONFLICT":
        sendIdempotencyConflict(reply);
        return true;
      case "IN_PROGRESS":
        sendIdempotencyInProgress(reply, state.taskId);
        return true;
      case "SUCCEEDED":
        await sendIdempotencySucceededReplay(userId, state.taskId, reply);
        return true;
      case "FAILED":
        sendIdempotencyFailedReplay(
          reply,
          state.responseStatus,
          state.responseCode
        );
        return true;
    }
  }

  async function replyFromWinnerTerminalReadState(
    userId: string,
    state: ImageIdempotencyReadState,
    reply: FastifyReply,
    uncertaintyCode:
      | "IMAGE_TASK_COMPLETION_FAILED"
      | "IMAGE_TASK_FAILURE_FAILED"
  ): Promise<FastifyReply> {
    if (state.status === "SUCCEEDED") {
      return sendIdempotencySucceededReplay(userId, state.taskId, reply);
    }
    if (state.status === "FAILED") {
      return sendIdempotencyFailedReplay(
        reply,
        state.responseStatus,
        state.responseCode
      );
    }
    return sendImageGenerationFailure(reply, 500, uncertaintyCode);
  }

  server.post(
    "/image/generate",
    { bodyLimit: IMAGE_GENERATE_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const user = await authenticate(request, reply, {
        unauthorized: {
          code: "AUTHENTICATION_REQUIRED",
          message: "authentication required",
          retryable: false
        },
        unavailable: {
          code: "AUTHENTICATION_FAILED",
          message: "authentication failed",
          retryable: true
        }
      });

      if (!user) {
        return reply;
      }

      if (
        await enforceRateLimit({
          request,
          reply,
          rateLimiter,
          key: ["image", "generate", "user", user.id].join(":"),
          policy: IMAGE_GENERATE_USER_RATE_LIMIT,
          routeIdentifier: "POST /image/generate",
          rejection: {
            code: "IMAGE_RATE_LIMITED",
            message: "请求过于频繁，请稍后再试",
            retryable: true
          },
          unavailableRejection: {
            code: "RATE_LIMIT_UNAVAILABLE",
            message: "服务暂时不可用，请稍后重试",
            retryable: true
          }
        })
      ) {
        return reply;
      }

      const parsedIdempotencyKey = parseIdempotencyKeyHeader(
        request.headers["idempotency-key"]
      );
      if (!parsedIdempotencyKey.ok) {
        return reply.code(400).send({
          message: parsedIdempotencyKey.reason === "MISSING"
            ? "Idempotency-Key is required"
            : "Idempotency-Key is invalid",
          code: parsedIdempotencyKey.reason === "MISSING"
            ? "IDEMPOTENCY_KEY_MISSING"
            : "IDEMPOTENCY_KEY_INVALID",
          retryable: false
        });
      }

      const body = parseImageGenerateRequest(request.body);

      if (!body) {
        return reply.code(400).send({
          code: "INVALID_IMAGE_REQUEST",
          message: "valid image generation fields are required",
          retryable: false
        });
      }

      if ("error" in body) {
        const error = body.error;
        if (error === undefined) {
          return reply.code(400).send({
            code: "INVALID_IMAGE_REQUEST",
            message: "valid image generation fields are required",
            retryable: false
          });
        }

        return reply.code(error.statusCode).send({
          code: error.code,
          message: error.message,
          retryable: false
        });
      }

      let requestFingerprint: Uint8Array;
      try {
        const referenceImageFingerprints = buildReferenceImageFingerprints(
          body.referenceImages
        );
        requestFingerprint = buildImageGenerationRequestFingerprint({
          modelId: body.modelId,
          prompt: body.prompt,
          size: body.size,
          count: body.count,
          mode: body.mode,
          ...(body.workflow ? { workflow: body.workflow } : {}),
          ...(body.workflow === "title-cover" && body.titleCover
            ? {
                titleCoverOriginalTitle: body.titleCover.originalTitle,
                titleCoverStyle: body.titleCover.style
              }
            : {}),
          ...(body.imageSessionId
            ? { imageSessionId: body.imageSessionId }
            : {}),
          ...(body.clientEntryId
            ? { clientEntryId: body.clientEntryId }
            : {}),
          ...(body.imageSessionTitle
            ? { imageSessionTitle: body.imageSessionTitle }
            : {}),
          ...(referenceImageFingerprints
            ? { referenceImageFingerprints }
            : {})
        });
      } catch {
        return reply.code(400).send({
          code: "INVALID_IMAGE_REQUEST",
          message: "valid image generation fields are required",
          retryable: false
        });
      }

      const ownerKeyHash = hashUserIdempotencyOwner(user.id);
      const idempotencyKeyHash = hashIdempotencyKey(parsedIdempotencyKey.key);
      const claimTokenHash = hashIdempotencyClaimToken(
        randomBytes(32).toString("base64url")
      );
      const readInput = {
        scope: IMAGE_GENERATE_IDEMPOTENCY_SCOPE,
        ownerType: IdempotencyOwnerType.USER,
        ownerKeyHash,
        idempotencyKeyHash,
        requestFingerprint
      };

      const readIdempotencyState = async (): Promise<
        | { ok: true; state: ImageIdempotencyReadState }
        | { ok: false }
      > => {
        try {
          return {
            ok: true,
            state: await store.readIdempotencyRequestState(readInput)
          };
        } catch {
          request.log.warn(
            {
              route: "POST /image/generate",
              errorType: "IdempotencyReadError"
            },
            "image idempotency state read failed"
          );
          return { ok: false };
        }
      };

      let claim: Awaited<
        ReturnType<IdempotencyRequestStore["claimIdempotencyRequest"]>
      > | undefined;
      try {
        claim = await store.claimIdempotencyRequest({
          ...readInput,
          claimTokenHash
        });
      } catch {
        request.log.warn(
          {
            route: "POST /image/generate",
            errorType: "IdempotencyClaimError"
          },
          "image idempotency claim failed"
        );
      }

      if (!claim) {
        return sendImageGenerationFailure(
          reply,
          500,
          "IMAGE_GENERATION_FAILED"
        );
      }

      if (claim.status === "IN_PROGRESS") {
        return sendIdempotencyInProgress(reply, claim.request.aiTaskId);
      }
      if (claim.status === "SUCCEEDED") {
        await sendIdempotencySucceededReplay(
          user.id,
          claim.request.aiTaskId,
          reply
        );
        return reply;
      }
      if (claim.status === "FAILED") {
        return sendIdempotencyFailedReplay(
          reply,
          claim.request.responseStatus ?? 500,
          claim.request.responseCode
        );
      }
      if (claim.status === "CONFLICT") {
        return sendIdempotencyConflict(reply);
      }

      const claimContext = {
        requestId: claim.request.id,
        requestFingerprint,
        claimTokenHash
      };

      const abandonBeforeBind = async (
        fallback: () => FastifyReply
      ): Promise<FastifyReply> => {
        try {
          const abandoned = await store.abandonIdempotencyClaim({
            requestId: claimContext.requestId,
            claimTokenHash: claimContext.claimTokenHash
          });

          if (abandoned.status === "ABANDONED") {
            return fallback();
          }
        } catch {
          request.log.warn(
            {
              route: "POST /image/generate",
              errorType: "IdempotencyAbandonError"
            },
            "image idempotency claim abandon failed"
          );
        }

        const read = await readIdempotencyState();
        if (!read.ok) {
          return sendImageGenerationFailure(
            reply,
            500,
            "IMAGE_GENERATION_FAILED"
          );
        }

        const replaySent = await replyFromIdempotencyReadState(
          user.id,
          read.state,
          reply
        );
        return replaySent ? reply : fallback();
      };

      let modelConfig;
      let providerAccount: ProviderAccountRuntime | null = null;
      let imageProviderAttempts: ImageProviderRouteAttempt[] = [];
      let usesChatFormatImage: boolean;
      let costCredits: number;

      try {
        modelConfig = await store.findModelByModelId(body.modelId);

        if (!modelConfig?.enabled || !isImageCapableModel(modelConfig)) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 400, "IMAGE_MODEL_UNAVAILABLE", {
              message: imageModelUnavailableMessage,
              retryable: false
            })
          );
        }

        if (
          !Number.isInteger(modelConfig.maxReferenceImages) ||
          modelConfig.maxReferenceImages < 0 ||
          modelConfig.maxReferenceImages > REFERENCE_IMAGE_MAX_COUNT
        ) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(
              reply,
              400,
              "IMAGE_RUNTIME_CONFIG_UNSUPPORTED",
              {
                message: "image runtime config is not supported",
                retryable: false
              }
            )
          );
        }

        const referenceImageCount = body.referenceImages?.length ?? 0;
        if (referenceImageCount > modelConfig.maxReferenceImages) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(
              reply,
              referenceImageCountExceededError.statusCode,
              referenceImageCountExceededError.code,
              {
                message: referenceImageCountExceededError.message,
                retryable: false
              }
            )
          );
        }

        const imageInvokeMode = modelConfig.imageInvokeMode ?? "native-image";
        const imageOutputParser =
          modelConfig.imageOutputParser ?? "native-image";
        usesChatFormatImage =
          imageInvokeMode === "anthropic-messages" &&
          imageOutputParser === "markdown-data-url";

        if (usesChatFormatImage && referenceImageCount > 1) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(
              reply,
              503,
              "IMAGE_PROVIDER_RUNTIME_UNAVAILABLE",
              {
                message: providerErrorMessage,
                retryable: false
              }
            )
          );
        }

        if (
          imageInvokeMode !== "native-image" &&
          imageInvokeMode !== "anthropic-messages"
        ) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(
              reply,
              400,
              "IMAGE_RUNTIME_CONFIG_UNSUPPORTED",
              {
                message: "image runtime config is not supported",
                retryable: false
              }
            )
          );
        }

        if (imageInvokeMode === "anthropic-messages" && !usesChatFormatImage) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(
              reply,
              400,
              "IMAGE_RUNTIME_CONFIG_UNSUPPORTED",
              {
                message: "image runtime config is not supported",
                retryable: false
              }
            )
          );
        }

        if (
          usesChatFormatImage &&
          body.mode !== "text-to-image" &&
          body.mode !== "image-to-image"
        ) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 400, "IMAGE_TO_IMAGE_UNAVAILABLE", {
              message: "image-to-image is not available for this model",
              retryable: false
            })
          );
        }

        const resolvedImageProviderAttempts =
          await resolveNativeImageProviderAttempts(modelConfig);

        if ("error" in resolvedImageProviderAttempts) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 400, "IMAGE_MODEL_UNAVAILABLE", {
              message: imageModelUnavailableMessage,
              retryable: false
            })
          );
        }

        imageProviderAttempts = resolvedImageProviderAttempts;

        if (!usesChatFormatImage) {
          if (referenceImageCount > 1) {
            imageProviderAttempts = imageProviderAttempts.filter(
              (attempt) => attempt.imageTransport === "openai-images"
            );

            if (imageProviderAttempts.length === 0) {
              return abandonBeforeBind(() =>
                sendImageGenerationFailure(
                  reply,
                  503,
                  "IMAGE_PROVIDER_RUNTIME_UNAVAILABLE",
                  {
                    message: providerErrorMessage,
                    retryable: false
                  }
                )
              );
            }
          }

          imageProviderAttempts = imageProviderAttempts.filter((attempt) =>
            isValidImageProviderTimeoutMs(
              attempt.providerAccount?.timeoutMs ??
                IMAGE_PROVIDER_TIMEOUT_DEFAULT_MS
            )
          );

          if (imageProviderAttempts.length === 0) {
            return abandonBeforeBind(() =>
              sendImageGenerationFailure(
                reply,
                503,
                "IMAGE_PROVIDER_RUNTIME_UNAVAILABLE",
                {
                  message: providerErrorMessage,
                  retryable: true
                }
              )
            );
          }
        }

        providerAccount = imageProviderAttempts[0]?.providerAccount ?? null;

        if (usesChatFormatImage && !providerAccount) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 400, "IMAGE_MODEL_UNAVAILABLE", {
              message: imageModelUnavailableMessage,
              retryable: false
            })
          );
        }

        if (
          usesChatFormatImage &&
          providerAccount &&
          (!providerAccount.enabled ||
            !providerAccount.apiKey.trim() ||
            !providerAccount.baseUrl.trim())
        ) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 400, "IMAGE_MODEL_UNAVAILABLE", {
              message: imageModelUnavailableMessage,
              retryable: false
            })
          );
        }

        if (
          usesChatFormatImage &&
          imageProviderAttempts.some((attempt) => {
            const account = attempt.providerAccount;
            return (
              !account ||
              resolveProviderAccountRequestFormat({
                providerAccount: account,
                providerType: account.providerType
              }) !== "anthropic"
            );
          })
        ) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(
              reply,
              400,
              "IMAGE_RUNTIME_CONFIG_UNSUPPORTED",
              {
                message: "image runtime config is not supported",
                retryable: false
              }
            )
          );
        }

        if (
          !usesChatFormatImage &&
          modelConfig.providerAccountId &&
          isProviderAccountImageUnavailable(providerAccount)
        ) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 400, "IMAGE_MODEL_UNAVAILABLE", {
              message: imageModelUnavailableMessage,
              retryable: false
            })
          );
        }

        if (
          usesChatFormatImage &&
          body.mode === "image-to-image" &&
          body.referenceImages?.[0] &&
          !extractReferenceImageBase64(body.referenceImages[0])
        ) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 400, "INVALID_IMAGE_REQUEST", {
              message: "valid image generation fields are required",
              retryable: false
            })
          );
        }

        costCredits = modelConfig.creditCost * body.count;
        if (
          !Number.isFinite(costCredits) ||
          !Number.isInteger(costCredits) ||
          costCredits < 0
        ) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 503, "IMAGE_REQUEST_COST_INVALID", {
              message: providerErrorMessage,
              retryable: false
            })
          );
        }
      } catch (error) {
        if (error instanceof ModelIdentityConflictError) {
          return abandonBeforeBind(() =>
            sendImageGenerationFailure(reply, 503, "IMAGE_MODEL_UNAVAILABLE", {
              message: imageModelUnavailableMessage,
              retryable: false
            })
          );
        }
        request.log.warn(
          {
            route: "POST /image/generate",
            errorType: "ImagePreBindValidationError"
          },
          "image generation pre-bind validation failed"
        );
        return abandonBeforeBind(() =>
          sendImageGenerationFailure(reply, 500, "IMAGE_GENERATION_FAILED", {
            retryable: true
          })
        );
      }

      let concurrencySettings;
      try {
        concurrencySettings = await resolveConcurrencyLimitSettings();
      } catch {
        request.log.warn(
          {
            route: "POST /image/generate",
            errorType: "ImageConcurrencySettingsError"
          },
          "image generation concurrency settings failed"
        );
        return abandonBeforeBind(() =>
          sendConcurrencyUnavailable(reply, { retryable: true })
        );
      }

      const concurrencyResult = await runWithRequestConcurrency({
        request,
        key: ["image", "user", user.id].join(":"),
        limit: concurrencySettings.imageGeneration,
        routeIdentifier: "POST /image/generate",
        task: async () => {
          const promptModeration = await moderateImagePrompt(
            body.prompt,
            resolveImageModerationRuntime
          );
          const imageModerationRuntime = promptModeration.runtime;
          if (
            promptModeration.status === "blocked" &&
            promptModeration.categories.some(
              (category) => category === "sexual" || category === "sexual/minors"
            )
          ) {
            request.log.warn(
              {
                route: "POST /image/generate",
                errorType: "ImagePromptBlocked",
                promptHash: hashImagePrompt(body.prompt),
                blockedCategories: promptModeration.categories,
                moderationLatencyMs: promptModeration.latencyMs,
                moderationModel: imageModerationRuntime.moderationModel
              },
              "image prompt blocked by moderation"
            );
            return abandonBeforeBind(() =>
              sendImageGenerationFailure(reply, 422, "IMAGE_PROMPT_BLOCKED", {
                retryable: false
              })
            );
          }
          if (promptModeration.status === "failed") {
            request.log.warn(
              {
                route: "POST /image/generate",
                errorType: "ImagePromptModerationUnavailable",
                promptHash: hashImagePrompt(body.prompt),
                moderationLatencyMs: promptModeration.latencyMs,
                moderationModel: imageModerationRuntime.moderationModel
              },
              "image prompt moderation unavailable"
            );
            return abandonBeforeBind(() =>
              sendImageGenerationFailure(
                reply,
                503,
                "IMAGE_SAFETY_CHECK_UNAVAILABLE",
                {
                  retryable: true,
                  message: "内容安全检查暂时不可用，请稍后再试。"
                }
              )
            );
          }

          let taskId: string | null = null;
          let reservationId: string | null = null;
          let imagePhase: "provider" | "persistence" = "provider";
          let imageOperationStartedAt: number | null = null;
          let imagePhaseStartedAt: number | null = null;
          let providerDurationMs: number | undefined;
          let persistenceDurationMs: number | undefined;
          const preparedStorageObjectIds = new Set<string>();

          const startImageProviderPhase = (): void => {
            finishImagePhase();
            imagePhase = "provider";
            imageOperationStartedAt ??= Date.now();
            imagePhaseStartedAt = Date.now();
          };
          const startImagePersistencePhase = (): void => {
            finishImagePhase();
            imagePhase = "persistence";
            imagePhaseStartedAt = Date.now();
          };
          const finishImagePhase = (): void => {
            if (imagePhaseStartedAt === null) {
              return;
            }
            if (imagePhase === "provider") {
              providerDurationMs =
                (providerDurationMs ?? 0) + safeImageDurationMs(imagePhaseStartedAt);
            } else {
              persistenceDurationMs =
                (persistenceDurationMs ?? 0) +
                safeImageDurationMs(imagePhaseStartedAt);
            }
            imagePhaseStartedAt = null;
          };

          const compensatePreparedImageStorageObjects = async (
            state: ImageIdempotencyReadState | null
          ): Promise<void> => {
            if (preparedStorageObjectIds.size === 0) {
              return;
            }

            let finalState = state;
            if (finalState === null) {
              const read = await readIdempotencyState();
              if (!read.ok) {
                request.log.warn(
                  {
                    route: "POST /image/generate",
                    errorType: "ImageStorageCompensationStateReadError",
                    objectCount: preparedStorageObjectIds.size
                  },
                  "image storage compensation state read failed"
                );
                return;
              }
              finalState = read.state;
            }

            if (
              finalState.status !== "FAILED" ||
              finalState.taskId !== taskId
            ) {
              return;
            }

            let failureCount = 0;
            let deferredCount = 0;
            for (const storageObjectId of preparedStorageObjectIds) {
              let claim;
              try {
                claim =
                  await store.claimGeneratedStorageObjectForCompensation({
                    userId: user.id,
                    storageObjectId,
                    now: new Date()
                  });
              } catch {
                failureCount += 1;
                continue;
              }

              if (claim.status !== "CLAIMED") {
                if (claim.status !== "NOT_FOUND") {
                  deferredCount += 1;
                }
                continue;
              }

              let prepared;
              try {
                prepared =
                  await store.prepareDeletedGeneratedStorageObjectForPurge(
                    claim.id
                  );
              } catch {
                failureCount += 1;
                continue;
              }

              if (prepared.status !== "PREPARED") {
                if (prepared.status !== "NOT_FOUND") {
                  deferredCount += 1;
                }
                continue;
              }

              let fileResult;
              try {
                fileResult =
                  await storageObjectFileRemover.removeLocalStorageObjectFile(
                    prepared.objectKey
                  );
              } catch {
                failureCount += 1;
                continue;
              }

              if (
                fileResult.status !== "REMOVED" &&
                fileResult.status !== "NOT_FOUND"
              ) {
                failureCount += 1;
                continue;
              }

              let finalized;
              try {
                finalized =
                  await store.finalizeDeletedGeneratedStorageObjectPurge(
                    claim.id
                  );
              } catch {
                failureCount += 1;
                continue;
              }

              if (
                finalized.status !== "PURGED" &&
                finalized.status !== "ALREADY_PURGED"
              ) {
                deferredCount += 1;
              }
            }

            if (failureCount > 0 || deferredCount > 0) {
              request.log.warn(
                {
                  route: "POST /image/generate",
                  errorType: "ImageStorageCompensationError",
                  objectCount: preparedStorageObjectIds.size,
                  failureCount,
                  deferredCount
                },
                "image storage compensation incomplete"
              );
            }
          };

          const reconcileWinnerTerminal = async (
            uncertaintyCode:
              | "IMAGE_TASK_COMPLETION_FAILED"
              | "IMAGE_TASK_FAILURE_FAILED"
          ): Promise<FastifyReply> => {
            const read = await readIdempotencyState();
            if (!read.ok) {
              return sendImageGenerationFailure(
                reply,
                500,
                uncertaintyCode
              );
            }

            await compensatePreparedImageStorageObjects(
              read.state.status === "FAILED" ? read.state : null
            );

            return replyFromWinnerTerminalReadState(
              user.id,
              read.state,
              reply,
              uncertaintyCode
            );
          };

          const completeBoundImageTask = async ({
            assets,
            output
          }: {
          assets: ImageTaskCompletionAiAssetCreateInput[];
          output: Record<string, unknown>;
        }): Promise<FastifyReply> => {
            const acceptedOutputCount = assets.length;
            if (acceptedOutputCount > body.count) {
              throw new Error("IMAGE_ACCEPTED_OUTPUT_COUNT_INVALID");
            }
            const missingOutputCount = body.count - acceptedOutputCount;
            const refundCredits = modelConfig.creditCost * missingOutputCount;
            let completionFailed = false;
            let completed:
              | Awaited<
                  ReturnType<
                    CreditReservationStore["completeImageTaskWithReservation"]
                  >
                >
              | undefined;
            try {
              completed = await store.completeImageTaskWithReservation({
                taskId: taskId!,
                reservationId: reservationId!,
                assets,
                output,
                refundCredits
              });
            } catch {
              completionFailed = true;
            }

            if (completionFailed) {
              request.log.warn(
                {
                  route: "POST /image/generate",
                  errorType: "ImageCompletionError"
                },
                "image completion lifecycle failed"
              );
            }

            if (
              completed?.status === "UPDATED" &&
              completed.task &&
              completed.assets
            ) {
              return reply.code(200).send({
                task: completed.task,
                assets: getCanonicalImageSuccessAssets(completed.assets)
              });
            }

            const winner = await readIdempotencyState();
            if (!winner.ok) {
              return sendImageGenerationFailure(
                reply,
                500,
                "IMAGE_TASK_COMPLETION_FAILED"
              );
            }
            if (
              winner.state.status === "SUCCEEDED" ||
              winner.state.status === "FAILED"
            ) {
              return replyFromWinnerTerminalReadState(
                user.id,
                winner.state,
                reply,
                "IMAGE_TASK_COMPLETION_FAILED"
              );
            }

            if (
              winner.state.status === "IN_PROGRESS" &&
              winner.state.taskId === taskId &&
              taskId !== null &&
              reservationId !== null
            ) {
              let currentTask: Awaited<
                ReturnType<UserStore["findAiTaskForUser"]>
              > = null;
              try {
                currentTask = await store.findAiTaskForUser(user.id, taskId);
              } catch {
                currentTask = null;
              }

              if (
                currentTask &&
                (currentTask.task.status === "pending" ||
                  currentTask.task.status === "running")
              ) {
                try {
                  const terminalize = completionFailed
                    ? store.failImageTaskAndReleaseReservation
                    : store.failImageTaskAndSettleReservation;
                  await terminalize({
                    taskId,
                    reservationId,
                    errorMessage: getImageIdempotencyFailureMessage(
                      "IMAGE_TASK_COMPLETION_FAILED"
                    ),
                    idempotencyTerminal: {
                      responseStatus: 500,
                      responseCode: "IMAGE_TASK_COMPLETION_FAILED"
                    }
                  });
                } catch {
                  request.log.warn(
                    {
                      route: "POST /image/generate",
                      errorType: "ImageCompletionTerminalizationError"
                    },
                    "image completion terminalization failed"
                  );
                }
              }
            }

            return reconcileWinnerTerminal("IMAGE_TASK_COMPLETION_FAILED");
          };

          const failBoundImageTask = async ({
            responseStatus,
            responseCode,
            retryAfterMs,
            retryable,
            message
          }: {
            responseStatus: number;
            responseCode: string;
            retryAfterMs?: number;
            retryable?: boolean;
            message?: string;
          }): Promise<FastifyReply> => {
            if (retryAfterMs !== undefined) {
              reply.header(
                "Retry-After",
                String(Math.max(1, Math.ceil(retryAfterMs / 1_000)))
              );
            }

            let failed:
              | Awaited<
                  ReturnType<
                    CreditReservationStore["failImageTaskAndReleaseReservation"]
                  >
                >
              | undefined;
            let failureMutationThrew = false;
            try {
              failed = await store.failImageTaskAndReleaseReservation({
                taskId: taskId!,
                reservationId: reservationId!,
                errorMessage: getImageIdempotencyFailureMessage(responseCode),
                idempotencyTerminal: {
                  responseStatus,
                  responseCode
                }
              });
            } catch {
              failureMutationThrew = true;
            }

            if (failureMutationThrew) {
              request.log.warn(
                {
                  route: "POST /image/generate",
                  errorType: "ImageFailureLifecycleError"
                },
                "image failure lifecycle failed"
              );
            }

            if (failed?.status === "UPDATED") {
              await compensatePreparedImageStorageObjects(null);
              return sendImageGenerationFailure(
                reply,
                responseStatus,
                responseCode,
                {
                  ...(retryAfterMs === undefined
                    ? {}
                    : {
                        retryAfterSeconds: Math.max(
                          1,
                          Math.ceil(retryAfterMs / 1_000)
                        )
                      }),
                  ...(responseCode === "IMAGE_PROVIDER_TIMEOUT"
                    ? { retryable: false }
                    : {}),
                  ...(retryable === undefined ? {} : { retryable }),
                  ...(message === undefined ? {} : { message })
                }
              );
            }

            return reconcileWinnerTerminal("IMAGE_TASK_FAILURE_FAILED");
          };

          let created;
          try {
            created = await store.createImageTaskWithReservation({
              userId: user.id,
              amountCredits: costCredits,
              expiresAt: new Date(
                Date.now() + IMAGE_CREDIT_RESERVATION_TTL_MS
              ),
              idempotencyClaim: {
                ...claimContext,
                now: new Date()
              },
              task: {
                type: "image",
                modelId: modelConfig.modelId,
                prompt: body.prompt,
                input: {
                  mode: body.mode,
                  size: body.size,
                  count: body.count,
                  ...(body.workflow ? { workflow: body.workflow } : {}),
                  ...(body.workflow === "title-cover" && body.titleCover
                    ? { titleCover: body.titleCover }
                    : {}),
                  ...(body.imageSessionId
                    ? { imageSessionId: body.imageSessionId }
                    : {}),
                  ...(body.clientEntryId
                    ? { clientEntryId: body.clientEntryId }
                    : {}),
                  ...(body.imageSessionTitle
                    ? { imageSessionTitle: body.imageSessionTitle }
                    : {}),
                  ...projectReferenceImageMetadata(body.referenceImages)
                }
              }
            });
          } catch {
            request.log.warn(
              {
                route: "POST /image/generate",
                errorType: "ImageCreateBindError"
              },
              "image task create-bind failed"
            );
            return abandonBeforeBind(() =>
              sendImageGenerationFailure(
                reply,
                500,
                "IMAGE_GENERATION_FAILED",
                { retryable: true }
              )
            );
          }

          if (!created.ok) {
            if (
              created.reason === "INSUFFICIENT_CREDITS" ||
              created.reason === "QUOTA_NOT_FOUND"
            ) {
              return abandonBeforeBind(() =>
                sendImageGenerationFailure(reply, 402, "INSUFFICIENT_CREDITS", {
                  message: "额度不足",
                  retryable: false
                })
              );
            }

            return abandonBeforeBind(() =>
              sendImageGenerationFailure(
                reply,
                500,
                "IMAGE_GENERATION_FAILED",
                { retryable: true }
              )
            );
          }

          taskId = created.task.id;
          reservationId = created.reservation.id;
          let imageProviderPrompt = body.prompt;
          let lastProviderDiagnosticMetadata:
            | ProviderAttemptDiagnosticMetadata
            | undefined;

          try {
            if ((body.referenceImages?.length ?? 0) > 0) {
              const referenceImageRateLimits =
                await resolveReferenceImageRateLimitSettings();
              if (referenceImageRateLimits.enabled) {
                const referenceImageRateLimit =
                  await enforceReferenceImageRateLimit({
                    request,
                    reply,
                    userId: user.id,
                    limit: referenceImageRateLimits.dailyLimit
                  });

                if (referenceImageRateLimit.status === "LIMITED") {
                  return failBoundImageTask({
                    responseStatus: 429,
                    responseCode: "REFERENCE_IMAGE_RATE_LIMITED",
                    retryAfterMs: referenceImageRateLimit.retryAfterMs
                  });
                }
                if (referenceImageRateLimit.status === "UNAVAILABLE") {
                  return failBoundImageTask({
                    responseStatus: 500,
                    responseCode: "IMAGE_GENERATION_FAILED"
                  });
                }
              }
            }

            if (body.workflow === "title-cover" && body.titleCover) {
              const titleCoverVisualBriefConfigResult =
                await resolveTitleCoverVisualBriefRuntimeConfig();
              const visualBriefResult = await runTitleCoverVisualBrief({
                config: titleCoverVisualBriefConfigResult,
                originalTitle: body.titleCover.originalTitle,
                style: body.titleCover.style,
                size: body.size,
                hasReferenceImage: (body.referenceImages?.length ?? 0) > 0,
                consumeBudget: async ({ budgetCredits, costCredits }) => {
                  try {
                    const result = await globalBudgetStore.consumeGlobalBudget({
                      scope: TITLE_COVER_VISUAL_BRIEF_BUDGET_SCOPE,
                      periodType: "DAILY",
                      periodKey: getUtcDailyBudgetPeriodKey(globalBudgetNow()),
                      budgetCredits,
                      costCredits
                    });
                    return result.status;
                  } catch {
                    return "unavailable" as const;
                  }
                },
                resolveAttempts:
                  resolveTitleCoverVisualBriefProviderAttempts,
                isRetryableProviderError: isRetryableChatProviderError,
                onEvent: (event) => {
                  request.log.info(
                    {
                      purpose: TITLE_COVER_VISUAL_BRIEF_PURPOSE,
                      modelId:
                        titleCoverVisualBriefConfigResult.status === "valid"
                          ? titleCoverVisualBriefConfigResult.config.modelId
                          : null,
                      providerId: event.providerId,
                      providerName: event.providerName,
                      routeId: event.routeId,
                      upstreamModel: event.upstreamModel,
                      phase: event.phase,
                      attemptIndex: event.attemptIndex,
                      status: event.status,
                      providerCallCount: event.providerCallCount,
                      outputCodePoints: event.outputCodePoints,
                      durationMs: event.durationMs,
                      configuredCostCredits:
                        titleCoverVisualBriefConfigResult.status === "valid"
                          ? titleCoverVisualBriefConfigResult.config.costCredits
                          : null,
                      fallbackAttempts: event.fallbackAttempts,
                      budgetScope: TITLE_COVER_VISUAL_BRIEF_BUDGET_SCOPE
                    },
                    "title cover visual brief"
                  );
                }
              });

              if (!visualBriefResult.ok) {
                return failBoundImageTask({
                  responseStatus: 500,
                  responseCode: "IMAGE_GENERATION_FAILED",
                  retryable: false
                });
              }

              imageProviderPrompt = buildTitleCoverImagePrompt({
                visualBrief: visualBriefResult.visualBrief,
                style: body.titleCover.style,
                size: body.size,
                hasReferenceImage: (body.referenceImages?.length ?? 0) > 0
              });
            }

            let running;
            try {
              running = await store.markAiTaskRunning(taskId);
            } catch {
              return failBoundImageTask({
                responseStatus: 500,
                responseCode: "IMAGE_TASK_START_FAILED"
              });
            }

            if (!running) {
              return failBoundImageTask({
                responseStatus: 500,
                responseCode: "IMAGE_TASK_START_FAILED"
              });
            }

            if (globalImageBudgetConfigResult.status !== "valid") {
              return failBoundImageTask({
                responseStatus: 503,
                responseCode: "GLOBAL_IMAGE_BUDGET_UNAVAILABLE",
                retryable: false
              });
            }

            if (globalImageBudgetConfigResult.config.mode === "enforced") {
              const costResult = calculateImageEstimatedCost({
                modelCreditCost: modelConfig.creditCost,
                count: body.count
              });
              const globalImageBudgetDecision =
                costResult.status === "valid"
                  ? decideGlobalImageRequestCost(
                      globalImageBudgetConfigResult,
                      costResult.costCredits
                    )
                  : "unavailable";

              if (globalImageBudgetDecision === "request_cost_exceeded") {
                return failBoundImageTask({
                  responseStatus: 400,
                  responseCode: "IMAGE_REQUEST_COST_EXCEEDED",
                  retryable: false
                });
              }

              if (globalImageBudgetDecision === "unavailable") {
                return failBoundImageTask({
                  responseStatus: 503,
                  responseCode: "GLOBAL_IMAGE_BUDGET_UNAVAILABLE",
                  retryable: false
                });
              }

              if (globalImageBudgetDecision === "allowed") {
                if (costResult.status !== "valid") {
                  return failBoundImageTask({
                    responseStatus: 503,
                    responseCode: "GLOBAL_IMAGE_BUDGET_UNAVAILABLE",
                    retryable: false
                  });
                }

                let globalBudgetResult:
                  | Awaited<ReturnType<GlobalBudgetStore["consumeGlobalBudget"]>>
                  | undefined;
                try {
                  globalBudgetResult = await globalBudgetStore.consumeGlobalBudget({
                    scope: "image_generation",
                    periodType: "DAILY",
                    periodKey: getUtcDailyBudgetPeriodKey(globalBudgetNow()),
                    budgetCredits:
                      globalImageBudgetConfigResult.config.dailyBudgetCredits,
                    costCredits: costResult.costCredits
                  });
                } catch {
                  globalBudgetResult = undefined;
                }

                if (globalBudgetResult?.status !== "consumed") {
                  return failBoundImageTask({
                    responseStatus: 503,
                    responseCode:
                      globalBudgetResult?.status === "exhausted"
                        ? "GLOBAL_IMAGE_BUDGET_EXHAUSTED"
                        : "GLOBAL_IMAGE_BUDGET_UNAVAILABLE",
                    retryable: false
                  });
                }
              }
            }

            if (usesChatFormatImage) {
              const referenceImage = body.referenceImages?.[0];
              const referenceImageBase64 =
                body.mode === "image-to-image" && referenceImage
                  ? extractReferenceImageBase64(referenceImage)
                  : undefined;
              const userMessageContent =
                body.mode === "image-to-image" && referenceImage
                  ? [
                      {
                        type: "image",
                        source: {
                          type: "base64",
                          media_type: referenceImage.mimeType,
                          data: referenceImageBase64!
                        }
                      },
                      {
                        type: "text",
                        text: imageProviderPrompt
                      }
                    ]
                  : imageProviderPrompt;
              const fetcher = options.fetchImpl ?? fetch;
              let lastChatProviderError: unknown;

              for (const imageProviderAttempt of imageProviderAttempts) {
                startImageProviderPhase();
                const account = imageProviderAttempt.providerAccount;
                if (!account) {
                  continue;
                }

                const requestFormat = resolveProviderAccountRequestFormat({
                  providerAccount: account,
                  providerType: account.providerType
                });
                const messagesPath = resolveAnthropicMessagesPath({
                  providerAccount: account
                });
                const endpointPath = resolveAnthropicEndpointPath({
                  baseUrl: account.baseUrl,
                  messagesPath
                });
                const endpointUrl = resolveAnthropicMessagesEndpointUrl({
                  baseUrl: account.baseUrl,
                  messagesPath
                });
                const authMode = resolveAnthropicAuthMode({
                  providerAccount: account,
                  providerType: account.providerType,
                  requestFormat
                });
                const maxTokens =
                  resolveProviderMaxTokens(account.configJson) ?? 4096;
                const supportsNativeBatch = supportsNativeChatImageBatch({
                  providerType: account.providerType,
                  requestFormat,
                  messagesPath
                });
                const requestBody = {
                  model: imageProviderAttempt.upstreamModel,
                  max_tokens: maxTokens,
                  messages: [{ role: "user", content: userMessageContent }],
                  ...(supportsNativeBatch ? { n: body.count } : {})
                };
                const attemptTimeoutMs = Math.min(
                  account.timeoutMs ?? IMAGE_PROVIDER_TIMEOUT_DEFAULT_MS,
                  IMAGE_PROVIDER_TIMEOUT_MAX_MS
                );
                let parsedImages: ParsedChatFormatImage[];
                try {
                  parsedImages = await runImageProviderWithTimeout({
                    timeoutMs: attemptTimeoutMs,
                    operation: (signal) =>
                      fetchAnthropicMessagesImageOutputs({
                        fetcher,
                        endpointUrl,
                        endpointPath,
                        apiKey: account.apiKey,
                        authMode,
                        headersJson: account.headersJson,
                        requestBody,
                        signal
                      })
                  });
                } catch (error) {
                  if (
                    error instanceof AIProviderRequestError &&
                    error.statusCode === 429
                  ) {
                    lastChatProviderError = error;
                    continue;
                  }
                  throw error;
                }

                if (parsedImages.length === 0) {
                  throw new ImageProviderInvalidResponseError();
                }

                lastProviderDiagnosticMetadata = undefined;

                const moderationCandidates = parsedImages;
                const moderation = await moderateImageOutputs(
                  moderationCandidates,
                  body.count,
                  imageModerationRuntime
                );
                const approvedImages = moderation.results
                  .filter((result) => result.status === "allowed")
                  .map((result) => result.output);
                const blockedCount = moderation.results.filter(
                  (result) => result.status === "blocked"
                ).length;
                const moderationFailedCount = moderation.results.filter(
                  (result) => result.status === "failed"
                ).length;
                const blockedCategories = [
                  ...new Set(
                    moderation.results.flatMap((result) =>
                      result.status === "blocked" ? result.categories : []
                    )
                  )
                ].sort();

                if (
                  imageModerationRuntime.enabled &&
                  approvedImages.length === 0
                ) {
                  request.log.warn(
                    {
                      route: "POST /image/generate",
                      taskId,
                      modelId: modelConfig.modelId,
                      providerType: imageProviderAttempt.providerAccount
                        ?.providerType,
                      requestedCount: body.count,
                      providerOutputCount: moderationCandidates.length,
                      approvedCount: 0,
                      blockedCount,
                      moderationFailedCount,
                      blockedCategories,
                      moderationLatencyMs: moderation.latencyMs,
                      moderationModel: imageModerationRuntime.moderationModel,
                      promptHash: hashImagePrompt(body.prompt)
                    },
                    "image output moderation rejected all outputs"
                  );
                  return failBoundImageTask({
                    responseStatus: blockedCount > 0 ? 422 : 503,
                    responseCode:
                      blockedCount > 0
                        ? "IMAGE_OUTPUT_BLOCKED"
                        : "IMAGE_SAFETY_CHECK_UNAVAILABLE",
                    retryable: blockedCount > 0 ? false : true,
                    ...(blockedCount > 0
                      ? {}
                      : {
                          message:
                            "内容安全检查暂时不可用，本次额度已退回。"
                        })
                  });
                }

                startImagePersistencePhase();
                const pendingOutputs: PendingChatFormatImageOutput[] = [];

                for (const image of approvedImages) {
                  if (pendingOutputs.length >= body.count) {
                    break;
                  }
                  const stored = await persistGeneratedImageOutput({
                    userId: user.id,
                    image
                  });
                  if (stored) {
                    preparedStorageObjectIds.add(stored.storageObjectId);
                    pendingOutputs.push({
                      index: pendingOutputs.length,
                      kind: "LOCAL_STORAGE_OBJECT",
                      ...stored
                    });
                  }
                }

                if (pendingOutputs.length === 0) {
                  if (
                    imageModerationRuntime.enabled &&
                    (blockedCount > 0 || moderationFailedCount > 0)
                  ) {
                    return failBoundImageTask({
                      responseStatus: blockedCount > 0 ? 422 : 503,
                      responseCode:
                        blockedCount > 0
                          ? "IMAGE_OUTPUT_BLOCKED"
                          : "IMAGE_SAFETY_CHECK_UNAVAILABLE",
                      retryable: blockedCount > 0 ? false : true,
                      ...(blockedCount > 0
                        ? {}
                        : {
                            message:
                              "内容安全检查暂时不可用，本次额度已退回。"
                          })
                    });
                  }
                  throw new ImageProviderInvalidResponseError();
                }

                if (imageModerationRuntime.enabled) {
                  request.log.info(
                    {
                      route: "POST /image/generate",
                      taskId,
                      modelId: modelConfig.modelId,
                      providerType: imageProviderAttempt.providerAccount
                        ?.providerType,
                      requestedCount: body.count,
                      providerOutputCount: moderationCandidates.length,
                      approvedCount: pendingOutputs.length,
                      blockedCount,
                      moderationFailedCount,
                      blockedCategories,
                      moderationLatencyMs: moderation.latencyMs,
                      moderationModel: imageModerationRuntime.moderationModel,
                      promptHash: hashImagePrompt(body.prompt)
                    },
                    "image output moderation completed"
                  );
                }

                const completionAssets: ImageTaskCompletionAiAssetCreateInput[] =
                  pendingOutputs.map((output) => {
                    const metadata = {
                      imageOutputIndex: output.index,
                      mode: body.mode,
                      modelId: modelConfig.modelId,
                      size: body.size,
                      count: body.count,
                      sourceType: "chat-format-image",
                      imageInvokeMode: modelConfig.imageInvokeMode ??
                        "native-image",
                      imageOutputParser: modelConfig.imageOutputParser ??
                        "native-image",
                      ...projectReferenceImageMetadata(body.referenceImages),
                      mimeType: output.mimeType
                    };
                    const title =
                      pendingOutputs.length > 1
                        ? body.prompt.slice(0, 80) + " #" + String(output.index + 1)
                        : body.prompt.slice(0, 80);

                    return {
                      userId: user.id,
                      taskId,
                      type: "image",
                      storageObjectId: output.storageObjectId,
                      title,
                      metadata
                    };
                  });

                return completeBoundImageTask({
                  output: {
                    mode: body.mode,
                    images: [],
                    size: body.size,
                    count: completionAssets.length,
                    sourceType: "chat-format-image"
                  },
                  assets: completionAssets
                });
              }

              throw lastChatProviderError ?? new ImageProviderInvalidResponseError();
            }

            let pendingNativeOutputs:
              | Array<PreparedImageOutput & { index: number }>
              | undefined;
            let lastProviderError: unknown;

            for (const [attemptIndex, imageProviderAttempt] of imageProviderAttempts.entries()) {
              startImageProviderPhase();
              const attemptStartedAt = Date.now();
              const attemptProviderAccount =
                imageProviderAttempt.providerAccount;
              const effectiveImageProviderTimeoutMs = Math.min(
                attemptProviderAccount?.timeoutMs ??
                  IMAGE_PROVIDER_TIMEOUT_DEFAULT_MS,
                IMAGE_PROVIDER_TIMEOUT_MAX_MS
              );
              const usesLegacyImageTransport =
                imageProviderAttempt.imageTransport === "legacy-extra-body-v1";
              const imageProviderEndpointPath = usesLegacyImageTransport
                ? "/v1/images/generations"
                : (body.referenceImages?.length ?? 0) > 0
                  ? "/images/edits"
                  : "/images/generations";
              const adapter =
                usesLegacyImageTransport
                  ? createAgnesImageAdapter({
                      baseUrl: attemptProviderAccount!.baseUrl,
                      apiKey: attemptProviderAccount!.apiKey,
                      defaultModel: imageProviderAttempt.upstreamModel,
                      timeoutMs: effectiveImageProviderTimeoutMs,
                      batchTimeoutMs: resolveAgnesBatchTimeoutMs({
                        count: body.count,
                        perRequestTimeoutMs: effectiveImageProviderTimeoutMs
                      }),
                      headersJson: attemptProviderAccount!.headersJson,
                      fetchImpl: options.fetchImpl
                    })
                  : options.imageAdapter ??
                    (attemptProviderAccount
                      ? createOpenAICompatibleAdapter({
                          baseUrl: attemptProviderAccount.baseUrl,
                          apiKey: attemptProviderAccount.apiKey,
                          defaultModel: imageProviderAttempt.upstreamModel,
                          imageResponseFormat:
                            imageProviderAttempt.imageResponseFormat,
                          timeoutMs: effectiveImageProviderTimeoutMs,
                          headersJson: attemptProviderAccount.headersJson,
                          fetchImpl: options.fetchImpl
                        })
                      : createOpenAICompatibleAdapter({
                          ...(await getEffectiveAiConfig()),
                          defaultModel: imageProviderAttempt.upstreamModel,
                          timeoutMs: effectiveImageProviderTimeoutMs,
                          fetchImpl: options.fetchImpl
                        }));

              let providerResult: Awaited<
                ReturnType<ImageGenerationAdapter["createImageGeneration"]>
              >;
              const imageGenerationRequest = {
                model: imageProviderAttempt.upstreamModel,
                prompt: imageProviderPrompt,
                size: body.size,
                count: body.count,
                ...(body.referenceImages
                  ? { referenceImages: body.referenceImages }
                  : {})
              };
              try {
                providerResult = usesLegacyImageTransport
                  ? await adapter.createImageGeneration(imageGenerationRequest)
                  : await runImageProviderWithTimeout({
                      timeoutMs: effectiveImageProviderTimeoutMs,
                      operation: (signal) =>
                        adapter.createImageGeneration({
                          ...imageGenerationRequest,
                          signal
                        })
                    });
              } catch (error) {
                lastProviderError = error;
                lastProviderDiagnosticMetadata = {
                  ...(attemptProviderAccount?.id
                    ? { providerId: attemptProviderAccount.id }
                    : {}),
                  ...(attemptProviderAccount?.name
                    ? { providerName: attemptProviderAccount.name }
                    : {}),
                  ...(imageProviderAttempt.routeId
                    ? { routeId: imageProviderAttempt.routeId }
                    : {}),
                  upstreamModel: imageProviderAttempt.upstreamModel,
                  attemptIndex,
                  endpointPath: imageProviderEndpointPath,
                  ...(error instanceof AIProviderRequestError &&
                  safeImageHttpStatus(error.statusCode) !== undefined
                    ? { statusCode: safeImageHttpStatus(error.statusCode) }
                    : {}),
                  willFallback: attemptIndex < imageProviderAttempts.length - 1,
                  providerAttemptDurationMs: safeImageDurationMs(attemptStartedAt)
                };
                continue;
              }

              const normalizedImages = normalizeImageProviderOutputs(
                providerResult.images
              );
              if (normalizedImages.length === 0) {
                lastProviderError = new ImageProviderInvalidResponseError();
                lastProviderDiagnosticMetadata = {
                  ...(attemptProviderAccount?.id
                    ? { providerId: attemptProviderAccount.id }
                    : {}),
                  ...(attemptProviderAccount?.name
                    ? { providerName: attemptProviderAccount.name }
                    : {}),
                  ...(imageProviderAttempt.routeId
                    ? { routeId: imageProviderAttempt.routeId }
                    : {}),
                  upstreamModel: imageProviderAttempt.upstreamModel,
                  attemptIndex,
                  endpointPath: imageProviderEndpointPath,
                  willFallback: attemptIndex < imageProviderAttempts.length - 1,
                  providerAttemptDurationMs: safeImageDurationMs(attemptStartedAt)
                };
                continue;
              }

              lastProviderDiagnosticMetadata = undefined;

              const moderationCandidates = normalizedImages;
              const moderation = await moderateImageOutputs(
                moderationCandidates,
                body.count,
                imageModerationRuntime
              );
              const approvedImages = moderation.results
                .filter((result) => result.status === "allowed")
                .map((result) => result.output);
              const blockedCount = moderation.results.filter(
                (result) => result.status === "blocked"
              ).length;
              const moderationFailedCount = moderation.results.filter(
                (result) => result.status === "failed"
              ).length;
              const blockedCategories = [
                ...new Set(
                  moderation.results.flatMap((result) =>
                    result.status === "blocked" ? result.categories : []
                  )
                )
              ].sort();

              if (
                imageModerationRuntime.enabled &&
                approvedImages.length === 0
              ) {
                request.log.warn(
                  {
                    route: "POST /image/generate",
                    taskId,
                    modelId: modelConfig.modelId,
                    providerType: attemptProviderAccount?.providerType,
                    requestedCount: body.count,
                    providerOutputCount: moderationCandidates.length,
                    approvedCount: 0,
                    blockedCount,
                    moderationFailedCount,
                    blockedCategories,
                    moderationLatencyMs: moderation.latencyMs,
                    moderationModel: imageModerationRuntime.moderationModel,
                    promptHash: hashImagePrompt(body.prompt)
                  },
                  "image output moderation rejected all outputs"
                );
                return failBoundImageTask({
                  responseStatus: blockedCount > 0 ? 422 : 503,
                  responseCode:
                    blockedCount > 0
                      ? "IMAGE_OUTPUT_BLOCKED"
                      : "IMAGE_SAFETY_CHECK_UNAVAILABLE",
                  retryable: blockedCount > 0 ? false : true,
                  ...(blockedCount > 0
                    ? {}
                    : {
                        message:
                          "内容安全检查暂时不可用，本次额度已退回。"
                      })
                });
              }

              startImagePersistencePhase();
              const preparedOutputs: Array<PreparedImageOutput & { index: number }> = [];
              for (const image of approvedImages) {
                if (preparedOutputs.length >= body.count) {
                  break;
                }
                const stored = await persistGeneratedImageOutput({
                  userId: user.id,
                  image
                });
                if (stored) {
                  preparedStorageObjectIds.add(stored.storageObjectId);
                  preparedOutputs.push({
                    index: preparedOutputs.length,
                    ...stored
                  });
                }
              }

              if (preparedOutputs.length === 0) {
                if (
                  imageModerationRuntime.enabled &&
                  (blockedCount > 0 || moderationFailedCount > 0)
                ) {
                  return failBoundImageTask({
                    responseStatus: blockedCount > 0 ? 422 : 503,
                    responseCode:
                      blockedCount > 0
                        ? "IMAGE_OUTPUT_BLOCKED"
                        : "IMAGE_SAFETY_CHECK_UNAVAILABLE",
                    retryable: blockedCount > 0 ? false : true,
                    ...(blockedCount > 0
                      ? {}
                      : {
                          message:
                            "内容安全检查暂时不可用，本次额度已退回。"
                        })
                  });
                }
                lastProviderError = new ImageProviderInvalidResponseError();
                lastProviderDiagnosticMetadata = {
                  ...(attemptProviderAccount?.id
                    ? { providerId: attemptProviderAccount.id }
                    : {}),
                  ...(attemptProviderAccount?.name
                    ? { providerName: attemptProviderAccount.name }
                    : {}),
                  ...(imageProviderAttempt.routeId
                    ? { routeId: imageProviderAttempt.routeId }
                    : {}),
                  upstreamModel: imageProviderAttempt.upstreamModel,
                  attemptIndex,
                  endpointPath: imageProviderEndpointPath,
                  willFallback: attemptIndex < imageProviderAttempts.length - 1,
                  providerAttemptDurationMs: safeImageDurationMs(attemptStartedAt)
                };
                continue;
              }

              if (imageModerationRuntime.enabled) {
                request.log.info(
                  {
                    route: "POST /image/generate",
                    taskId,
                    modelId: modelConfig.modelId,
                    providerType: attemptProviderAccount?.providerType,
                    requestedCount: body.count,
                    providerOutputCount: moderationCandidates.length,
                    approvedCount: preparedOutputs.length,
                    blockedCount,
                    moderationFailedCount,
                    blockedCategories,
                    moderationLatencyMs: moderation.latencyMs,
                    moderationModel: imageModerationRuntime.moderationModel,
                    promptHash: hashImagePrompt(body.prompt)
                  },
                  "image output moderation completed"
                );
              }

              pendingNativeOutputs = preparedOutputs;
              break;
            }

            if (!pendingNativeOutputs) {
              throw lastProviderError ?? new ImageProviderInvalidResponseError();
            }

            const completionAssets: ImageTaskCompletionAiAssetCreateInput[] =
              pendingNativeOutputs.map((output) => ({
                userId: user.id,
                taskId,
                type: "image",
                storageObjectId: output.storageObjectId,
                title:
                  pendingNativeOutputs.length > 1
                    ? body.prompt.slice(0, 80) + " #" + String(output.index + 1)
                    : body.prompt.slice(0, 80),
                metadata: {
                  imageOutputIndex: output.index,
                  mode: body.mode,
                  modelId: modelConfig.modelId,
                  size: body.size,
                  count: body.count,
                  ...projectReferenceImageMetadata(body.referenceImages),
                  ...(output.revisedPrompt === undefined
                    ? {}
                    : { revisedPrompt: output.revisedPrompt }),
                  mimeType: output.mimeType
                }
              }));

            return completeBoundImageTask({
              output: {
                mode: body.mode,
                images: [],
                size: body.size,
                count: completionAssets.length
              },
              assets: completionAssets
            });
          } catch (error) {
            finishImagePhase();
            const imageDurationStartedAt =
              imageOperationStartedAt ?? Date.now();
            const isProviderError =
              error instanceof AIProviderRequestError ||
              error instanceof AIProviderResponseFormatError ||
              summarizeError(error).startsWith("AI provider");
            const responseStatus =
              error instanceof ImageProviderTimeoutError ||
                error instanceof AIProviderTimeoutError
                ? 504
                : error instanceof ImageProviderInvalidResponseError ||
                    error instanceof AIProviderResponseFormatError
                  ? 502
                  : error instanceof ImageAssetPersistenceError
                    ? 500
                    : isProviderError
                      ? 502
                      : 500;
            const responseCode =
              error instanceof ImageProviderTimeoutError ||
                error instanceof AIProviderTimeoutError
                ? "IMAGE_PROVIDER_TIMEOUT"
                : error instanceof ImageProviderInvalidResponseError ||
                    error instanceof AIProviderResponseFormatError
                  ? "IMAGE_PROVIDER_INVALID_RESPONSE"
                  : error instanceof ImageAssetPersistenceError
                    ? "IMAGE_ASSET_PERSISTENCE_FAILED"
                    : isProviderError
                      ? "IMAGE_PROVIDER_FAILED"
                      : "IMAGE_GENERATION_FAILED";

            request.log.error(
              {
                route: "POST /image/generate",
                requestId: claimContext.requestId,
                taskId,
                reservationId,
                ...mapImagePersistenceError(error),
                ...(lastProviderDiagnosticMetadata ?? {}),
                durationMs: safeImageDurationMs(imageDurationStartedAt),
                ...(providerDurationMs === undefined
                  ? {}
                  : { providerDurationMs }),
                ...(persistenceDurationMs === undefined
                  ? {}
                  : { persistenceDurationMs })
              },
              "image generation failed"
            );

            return failBoundImageTask({
              responseStatus,
              responseCode
            });
          }
        }
      });

      if (!concurrencyResult) {
        return abandonBeforeBind(() =>
          sendConcurrencyUnavailable(reply, { retryable: true })
        );
      }
      if (!concurrencyResult.acquired) {
        return abandonBeforeBind(() =>
          sendConcurrencyLimited(
            reply,
            "image",
            concurrencyResult.retryAfterMs,
            { retryable: true }
          )
        );
      }
      return concurrencyResult.value;
    }
  );

  const activeVideoRecoveryTasks = new Set<string>();

  async function updateVideoRuntimeState(
    task: AiTaskRuntimeRecord,
    state: VideoRuntimeState
  ): Promise<boolean> {
    if (typeof store.updateAiTaskInput !== "function") {
      return false;
    }

    try {
      const publicStatus =
        state.status === "submitted" ? "pending" : "running";
      const nextInput = {
        ...task.input,
        videoStatus: publicStatus,
        ...(state.progress === undefined
          ? {}
          : { videoProgress: state.progress }),
        [VIDEO_RUNTIME_INPUT_KEY]: state
      };
      const updated = await store.updateAiTaskInput(task.id, {
        ...nextInput
      });
      if (!updated) return false;
      task.input = nextInput;
      return true;
    } catch {
      return false;
    }
  }

  async function failVideoTask(
    task: Pick<AiTaskRuntimeRecord, "id" | "userId">,
    state: VideoRuntimeState,
    input: {
      release: boolean;
      responseStatus: number;
      responseCode: string;
    }
  ): Promise<void> {
    const errorMessage = getVideoIdempotencyFailureMessage(input.responseCode);
    try {
      const result = input.release
        ? await store.failImageTaskAndReleaseReservation({
            taskId: task.id,
            reservationId: state.reservationId,
            errorMessage,
            idempotencyTerminal: {
              responseStatus: input.responseStatus,
              responseCode: input.responseCode
            }
          })
        : await store.failImageTaskAndSettleReservation({
            taskId: task.id,
            reservationId: state.reservationId,
            errorMessage,
            idempotencyTerminal: {
              responseStatus: input.responseStatus,
              responseCode: input.responseCode
            }
          });

      if (
        result.status !== "UPDATED" &&
        result.status !== "ALREADY_FAILED" &&
        result.status !== "ALREADY_COMPLETED"
      ) {
        server.log.warn(
          {
            event: "video-task-failure-lifecycle-incomplete",
            taskId: task.id,
            mutationStatus: result.status
          },
          "video task failure lifecycle was not completed"
        );
      }
    } catch (error) {
      server.log.warn(
        {
          event: "video-task-failure-lifecycle-failed",
          taskId: task.id,
          errorType: safeErrorName(error)
        },
        "video task failure lifecycle failed"
      );
    }
  }

  async function completeVideoTask(
    task: AiTaskRuntimeRecord,
    state: VideoRuntimeState,
    profile: NonNullable<ReturnType<typeof resolveApimartVideoProfile>>,
    storageObjectId: string
  ): Promise<boolean> {
    try {
      const result = await store.completeImageTaskWithReservation({
        taskId: task.id,
        reservationId: state.reservationId,
        assets: [
          {
            userId: task.userId,
            taskId: task.id,
            type: "video",
            storageObjectId,
            title: task.prompt.slice(0, 120),
            metadata: {
              mode: state.mode,
              profileId: profile.id,
              durationSeconds: profile.durationSeconds,
              resolution: profile.resolution,
              aspectRatio: profile.aspectRatio,
              mimeType: "video/mp4"
            }
          }
        ],
        output: {
          mode: state.mode,
          profileId: profile.id,
          durationSeconds: profile.durationSeconds,
          resolution: profile.resolution,
          aspectRatio: profile.aspectRatio
        }
      });

      if (result.status === "UPDATED" || result.status === "ALREADY_COMPLETED") {
        return true;
      }

      server.log.warn(
        {
          event: "video-task-completion-incomplete",
          taskId: task.id,
          mutationStatus: result.status
        },
        "video task completion was not applied"
      );
      return false;
    } catch (error) {
      server.log.warn(
        {
          event: "video-task-completion-failed",
          taskId: task.id,
          errorType: safeErrorName(error)
        },
        "video task completion failed"
      );
      return false;
    }
  }

  async function recoverVideoTask(
    taskId: string,
    userId: string
  ): Promise<void> {
    if (activeVideoRecoveryTasks.has(taskId)) return;
    activeVideoRecoveryTasks.add(taskId);

    try {
      if (typeof store.findAiTaskRuntimeForUser !== "function") {
        return;
      }

      const task = await store.findAiTaskRuntimeForUser(userId, taskId);
      if (
        !task ||
        task.userId !== userId ||
        task.type !== "video" ||
        (task.status !== "pending" && task.status !== "running")
      ) {
        return;
      }

      const state = parseVideoRuntimeState(task.input[VIDEO_RUNTIME_INPUT_KEY]);
      if (!state) {
        server.log.warn(
          { event: "video-runtime-state-invalid", taskId: task.id },
          "video runtime state is invalid"
        );
        return;
      }

      const providerAccount =
        await store.findProviderAccountRuntimeById(state.providerAccountId);
      const profile = resolveApimartVideoProfile(state.upstreamModel);
      if (
        !providerAccount ||
        isProviderAccountVideoUnavailable(providerAccount) ||
        !profile ||
        profile.id !== state.profileId
      ) {
        await failVideoTask(task, state, {
          release: false,
          responseStatus: 502,
          responseCode: "VIDEO_TASK_POLL_FAILED"
        });
        return;
      }

      const committedProviderAccount = providerAccount;

      const adapter =
        options.videoAdapter ??
        createApimartVideoAdapter({
          baseUrl: committedProviderAccount.baseUrl,
          apiKey: committedProviderAccount.apiKey,
          headersJson: committedProviderAccount.headersJson,
          timeoutMs: Math.min(
            committedProviderAccount.timeoutMs || VIDEO_PROVIDER_TIMEOUT_DEFAULT_MS,
            IMAGE_PROVIDER_TIMEOUT_MAX_MS
          ),
          fetchImpl: options.fetchImpl
        });

      if (state.status === "stored" && state.storageObjectId) {
        const completed = await completeVideoTask(
          task,
          state,
          profile,
          state.storageObjectId
        );
        if (!completed) {
          await failVideoTask(task, state, {
            release: false,
            responseStatus: 500,
            responseCode: "VIDEO_TASK_COMPLETION_FAILED"
          });
        }
        return;
      }

      let currentState = state;
      for (let attempt = 0; attempt < videoMaxPollAttempts; attempt += 1) {
        let polled: Awaited<ReturnType<VideoGenerationAdapter["pollVideoGeneration"]>>;
        try {
          polled = await adapter.pollVideoGeneration({
            operationId: currentState.operationId
          });
        } catch (error) {
          if (
            error instanceof AIProviderRequestError &&
            error.statusCode === 429
          ) {
            const retryAfterMs = Math.min(
              60_000,
              Math.max(250, error.retryAfterMs ?? videoPollIntervalMs)
            );
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(resolve, retryAfterMs);
              timeout.unref();
            });
            continue;
          }

          if (isRetryableChatProviderError(error)) {
            server.log.warn(
              {
                event: "video-task-poll-retryable-failed",
                taskId: task.id,
                errorType: safeErrorName(error)
              },
              "video task polling will resume later"
            );
            return;
          }

          await failVideoTask(task, currentState, {
            release: true,
            responseStatus: 502,
            responseCode:
              error instanceof AIProviderResponseFormatError
                ? "VIDEO_PROVIDER_INVALID_RESPONSE"
                : "VIDEO_TASK_POLL_FAILED"
          });
          return;
        }

        if (polled.status === "failed" || polled.status === "cancelled") {
          await failVideoTask(task, currentState, {
            release: true,
            responseStatus: 502,
            responseCode: "VIDEO_PROVIDER_FAILED"
          });
          return;
        }

        if (polled.status === "pending" || polled.status === "processing") {
          currentState = {
            ...currentState,
            status: polled.status === "pending" ? "submitted" : "processing",
            ...(polled.progress === undefined
              ? {}
              : { progress: polled.progress })
          };
          if (!(await updateVideoRuntimeState(task, currentState))) {
            await failVideoTask(task, currentState, {
              release: false,
              responseStatus: 500,
              responseCode: "VIDEO_TASK_POLL_FAILED"
            });
            return;
          }
          if (attempt + 1 >= videoMaxPollAttempts) return;
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, videoPollIntervalMs);
            timeout.unref();
          });
          continue;
        }

        currentState = {
          ...currentState,
          status: "downloading",
          ...(polled.progress === undefined
            ? {}
            : { progress: polled.progress })
        };
        if (!(await updateVideoRuntimeState(task, currentState))) {
          await failVideoTask(task, currentState, {
            release: false,
            responseStatus: 500,
            responseCode: "VIDEO_ASSET_PERSISTENCE_FAILED"
          });
          return;
        }

        let bytes: Buffer;
        try {
          bytes = await fetchVideoResultWithBoundedRetry({
            url: polled.resultUrl,
            providerBaseUrl: committedProviderAccount.baseUrl,
            allowedHostRules: remoteImageAllowedHostRules,
            fetchImpl: options.fetchImpl,
            remoteFetcher: remoteImageFetcher,
            timeoutMs: Math.min(
              committedProviderAccount.timeoutMs || VIDEO_PROVIDER_TIMEOUT_DEFAULT_MS,
              IMAGE_PROVIDER_TIMEOUT_MAX_MS
            ),
            maxBytes: videoMaxBytes
          });
        } catch (error) {
          if (isVideoResultReadinessTimeout(error)) {
            const timeoutRound =
              (currentState.resultDownloadTimeoutRounds ?? 0) + 1;
            currentState = {
              ...currentState,
              status: "downloading",
              resultDownloadTimeoutRounds: timeoutRound
            };
            const runtimeUpdated = await updateVideoRuntimeState(
              task,
              currentState
            );
            if (
              timeoutRound < VIDEO_RESULT_READINESS_MAX_TIMEOUT_ROUNDS &&
              runtimeUpdated
            ) {
              logVideoResultDownloadReadinessDeferred(
                server.log,
                task.id,
                timeoutRound,
                error
              );
              return;
            }
          }

          logVideoAssetPersistenceFailure(
            server.log,
            task.id,
            "result-download",
            error
          );
          await failVideoTask(task, currentState, {
            release: false,
            responseStatus: 502,
            responseCode: "VIDEO_ASSET_PERSISTENCE_FAILED"
          });
          return;
        }

        let storageObjectId = currentState.storageObjectId;
        if (!storageObjectId) {
          try {
            const stored =
              await videoStorageObjectService.persistLocalVideoStorageObject({
                userId: task.userId,
                source: StorageObjectSource.GENERATED,
                maxBytes: videoMaxBytes,
                bytes
              });
            storageObjectId = stored.storageObjectId;
          } catch (error) {
            logVideoAssetPersistenceFailure(
              server.log,
              task.id,
              "storage-persist",
              error
            );
            await failVideoTask(task, currentState, {
              release: false,
              responseStatus: 502,
              responseCode: "VIDEO_ASSET_PERSISTENCE_FAILED"
            });
            return;
          }
        }

        currentState = {
          ...currentState,
          status: "stored",
          storageObjectId
        };
        if (!(await updateVideoRuntimeState(task, currentState))) {
          await failVideoTask(task, currentState, {
            release: false,
            responseStatus: 500,
            responseCode: "VIDEO_ASSET_PERSISTENCE_FAILED"
          });
          return;
        }

        const completed = await completeVideoTask(
          task,
          currentState,
          profile,
          storageObjectId
        );
        if (!completed) {
          await failVideoTask(task, currentState, {
            release: false,
            responseStatus: 500,
            responseCode: "VIDEO_TASK_COMPLETION_FAILED"
          });
        }
        return;
      }
    } catch (error) {
      server.log.warn(
        {
          event: "video-recovery-task-unhandled",
          taskId,
          errorType: safeErrorName(error)
        },
        "video recovery task failed safely"
      );
    } finally {
      activeVideoRecoveryTasks.delete(taskId);
    }
  }

  videoRecoveryService =
    options.videoRecoveryService ??
    createVideoRecoveryServiceFromEnv({
      env,
      store,
      recoverTask: (task) => recoverVideoTask(task.id, task.userId),
      logger: server.log
    });

  const VIDEO_IDEMPOTENCY_RETRY_AFTER_MS = 2_000;

  function sendVideoIdempotencyInProgress(
    reply: FastifyReply,
    taskId: string | null
  ): FastifyReply {
    reply.header(
      "Retry-After",
      String(VIDEO_IDEMPOTENCY_RETRY_AFTER_MS / 1_000)
    );
    return reply.code(202).send({
      status: "in_progress",
      taskId,
      retryAfterMs: VIDEO_IDEMPOTENCY_RETRY_AFTER_MS
    });
  }

  async function sendVideoIdempotencySucceededReplay(
    userId: string,
    taskId: string | null,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    if (!taskId) return sendIdempotencyResultUnavailable(reply);
    let detail: Awaited<ReturnType<UserStore["findAiTaskForUser"]>> = null;
    try {
      detail = await store.findAiTaskForUser(userId, taskId);
    } catch {
      return sendVideoGenerationFailure(reply, 500, "VIDEO_GENERATION_FAILED");
    }
    if (!detail) return sendIdempotencyResultUnavailable(reply);
    return reply.code(200).send({ task: detail.task, assets: detail.assets });
  }

  function sendVideoIdempotencyFailedReplay(
    reply: FastifyReply,
    responseStatus: number,
    responseCode: string | null
  ): FastifyReply {
    const code = responseCode ?? "VIDEO_GENERATION_FAILED";
    return sendVideoGenerationFailure(reply, responseStatus, code, {
      retryable: false
    });
  }

  server.post(
    "/video/generate",
    { bodyLimit: VIDEO_GENERATE_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return reply;

      if (
        await enforceRateLimit({
          request,
          reply,
          rateLimiter,
          key: ["video", "generate", "user", user.id].join(":"),
          policy: IMAGE_GENERATE_USER_RATE_LIMIT,
          routeIdentifier: "POST /video/generate"
        })
      ) {
        return reply;
      }

      const parsedIdempotencyKey = parseIdempotencyKeyHeader(
        request.headers["idempotency-key"]
      );
      if (!parsedIdempotencyKey.ok) {
        return reply.code(400).send({
          message:
            parsedIdempotencyKey.reason === "MISSING"
              ? "Idempotency-Key is required"
              : "Idempotency-Key is invalid",
          code:
            parsedIdempotencyKey.reason === "MISSING"
              ? "IDEMPOTENCY_KEY_MISSING"
              : "IDEMPOTENCY_KEY_INVALID"
        });
      }

      const body = parseVideoGenerateRequest(request.body);
      if (!body) {
        return reply.code(400).send({
          message: "valid video generation fields are required"
        });
      }
      if ("error" in body) {
        return reply.code(body.error.statusCode).send({
          code: body.error.code,
          message: body.error.message
        });
      }

      let requestFingerprint: Uint8Array;
      try {
        requestFingerprint = buildVideoGenerationRequestFingerprint({
          modelId: body.modelId,
          mode: body.mode,
          prompt: body.prompt,
          ...(body.referenceImage
            ? {
                referenceFingerprint: buildReferenceImageFingerprint(
                  body.referenceImage
                )
              }
            : {})
        });
      } catch {
        return reply.code(400).send({
          message: "valid video generation fields are required"
        });
      }

      const readInput = {
        scope: VIDEO_GENERATE_IDEMPOTENCY_SCOPE,
        ownerType: IdempotencyOwnerType.USER,
        ownerKeyHash: hashUserIdempotencyOwner(user.id),
        idempotencyKeyHash: hashIdempotencyKey(parsedIdempotencyKey.key),
        requestFingerprint
      };
      const claimTokenHash = hashIdempotencyClaimToken(
        randomBytes(32).toString("base64url")
      );

      let claim: Awaited<
        ReturnType<IdempotencyRequestStore["claimIdempotencyRequest"]>
      >;
      try {
        claim = await store.claimIdempotencyRequest({
          ...readInput,
          claimTokenHash
        });
      } catch {
        return sendVideoGenerationFailure(
          reply,
          500,
          "VIDEO_GENERATION_FAILED"
        );
      }

      if (claim.status === "IN_PROGRESS") {
        return sendVideoIdempotencyInProgress(reply, claim.request.aiTaskId);
      }
      if (claim.status === "SUCCEEDED") {
        return sendVideoIdempotencySucceededReplay(
          user.id,
          claim.request.aiTaskId,
          reply
        );
      }
      if (claim.status === "FAILED") {
        return sendVideoIdempotencyFailedReplay(
          reply,
          claim.request.responseStatus ?? 500,
          claim.request.responseCode
        );
      }
      if (claim.status === "CONFLICT") return sendIdempotencyConflict(reply);

      const claimContext = {
        requestId: claim.request.id,
        requestFingerprint,
        claimTokenHash
      };

      const abandonVideoClaim = async (
        fallback: () => FastifyReply
      ): Promise<FastifyReply> => {
        try {
          const abandoned = await store.abandonIdempotencyClaim({
            requestId: claimContext.requestId,
            claimTokenHash: claimContext.claimTokenHash
          });
          if (abandoned.status === "ABANDONED") return fallback();
        } catch {
          request.log.warn(
            { route: "POST /video/generate", errorType: "IdempotencyAbandonError" },
            "video idempotency claim abandon failed"
          );
        }

        try {
          const read = await store.readIdempotencyRequestState(readInput);
          if (read.status === "IN_PROGRESS") {
            sendVideoIdempotencyInProgress(reply, read.taskId);
            return reply;
          }
          if (read.status === "SUCCEEDED") {
            return sendVideoIdempotencySucceededReplay(user.id, read.taskId, reply);
          }
          if (read.status === "FAILED") {
            return sendVideoIdempotencyFailedReplay(
              reply,
              read.responseStatus,
              read.responseCode
            );
          }
          if (read.status === "CONFLICT") return sendIdempotencyConflict(reply);
        } catch {
          return sendVideoGenerationFailure(
            reply,
            500,
            "VIDEO_GENERATION_FAILED"
          );
        }
        return fallback();
      };

      let modelConfig: RuntimeAiModel | null;
      let videoProviderAttempts: VideoProviderRouteAttempt[];
      let costCredits: number;
      try {
        modelConfig = await store.findModelByModelId(body.modelId);
        if (
          !modelConfig?.enabled ||
          !isVideoCapableModel(modelConfig) ||
          !normalizeModelDisplaySurfaces(
            modelConfig.displaySurfaces,
            modelConfig.capability
          ).includes("video")
        ) {
          return abandonVideoClaim(() =>
            reply.code(400).send({ message: "video model is not available" })
          );
        }

        const attempts = await resolveVideoProviderAttempts(modelConfig);
        if ("error" in attempts) {
          return abandonVideoClaim(() =>
            reply.code(400).send({ message: "video model is not available" })
          );
        }
        videoProviderAttempts = attempts.filter((attempt) =>
          body.mode === "text-to-video"
            ? attempt.profile.supportsTextToVideo
            : attempt.profile.supportsImageToVideo
        );
        if (videoProviderAttempts.length === 0) {
          return abandonVideoClaim(() =>
            reply.code(400).send({
              message: "video mode is not available for this model"
            })
          );
        }

        costCredits = modelConfig.creditCost;
        if (
          !Number.isSafeInteger(costCredits) ||
          costCredits < 0
        ) {
          return abandonVideoClaim(() =>
            sendVideoGenerationFailure(reply, 503, "VIDEO_GENERATION_FAILED")
          );
        }
      } catch (error) {
        if (error instanceof ModelIdentityConflictError) {
          return abandonVideoClaim(() =>
            reply.code(503).send({ message: "video model is not available" })
          );
        }
        request.log.warn(
          { route: "POST /video/generate", errorType: safeErrorName(error) },
          "video pre-bind validation failed"
        );
        return abandonVideoClaim(() =>
          sendVideoGenerationFailure(reply, 500, "VIDEO_GENERATION_FAILED")
        );
      }

      if (
        typeof store.updateAiTaskInput !== "function" ||
        typeof store.findAiTaskRuntimeForUser !== "function"
      ) {
        return abandonVideoClaim(() =>
          sendVideoGenerationFailure(reply, 503, "VIDEO_GENERATION_FAILED")
        );
      }

      const concurrencySettings = await resolveConcurrencyLimitSettings();
      const concurrencyResult = await runWithRequestConcurrency({
        request,
        key: ["video", "user", user.id].join(":"),
        limit: concurrencySettings.imageGeneration,
        routeIdentifier: "POST /video/generate",
        task: async (): Promise<FastifyReply> => {
          let created: Awaited<
            ReturnType<CreditReservationStore["createImageTaskWithReservation"]>
          >;
          try {
            created = await store.createImageTaskWithReservation({
              userId: user.id,
              amountCredits: costCredits,
              expiresAt: new Date(Date.now() + VIDEO_CREDIT_RESERVATION_TTL_MS),
              reservationKind: CreditReservationKind.VIDEO_GENERATION,
              idempotencyClaim: {
                ...claimContext,
                now: new Date()
              },
              task: {
                type: "video",
                modelId: modelConfig!.modelId,
                prompt: body.prompt,
                input: {
                  mode: body.mode,
                  ...(body.referenceImage
                    ? {
                        referenceImage: {
                          mimeType: body.referenceImage.mimeType,
                          name: body.referenceImage.name ?? null,
                          originalBytes: body.referenceImage.originalBytes ?? null,
                          compressedBytes:
                            body.referenceImage.compressedBytes ?? null
                        }
                      }
                    : {})
                }
              }
            });
          } catch (error) {
            request.log.warn(
              { route: "POST /video/generate", errorType: safeErrorName(error) },
              "video task create-bind failed"
            );
            return sendVideoGenerationFailure(
              reply,
              500,
              "VIDEO_GENERATION_FAILED"
            );
          }

          if (!created.ok) {
            if (
              created.reason === "INSUFFICIENT_CREDITS" ||
              created.reason === "QUOTA_NOT_FOUND"
            ) {
              return reply.code(402).send({ message: "额度不足" });
            }
            return sendVideoGenerationFailure(
              reply,
              500,
              "VIDEO_GENERATION_FAILED"
            );
          }

          const taskId = created.task.id;
          const reservationId = created.reservation.id;
          let accepted: {
            operationId: string;
            attempt: VideoProviderRouteAttempt;
          } | undefined;
          let lastProviderError: unknown;

          const referenceImage = body.referenceImage
            ? (() => {
                const encoded = extractReferenceImageBase64(body.referenceImage!);
                if (!encoded) return undefined;
                return {
                  bytes: Buffer.from(encoded, "base64"),
                  mimeType: body.referenceImage!.mimeType as VideoReferenceMimeType,
                  ...(body.referenceImage!.name
                    ? { filename: body.referenceImage!.name }
                    : {})
                };
              })()
            : undefined;

          if (body.mode === "image-to-video" && !referenceImage) {
            await failVideoTask(
              {
                id: taskId,
                userId: user.id
              },
              {
                version: 1,
                protocol: "apimart-task-v1",
                operationId: "not-created",
                reservationId,
                providerAccountId: videoProviderAttempts[0]!.providerAccount.id,
                routeId: videoProviderAttempts[0]!.routeId,
                upstreamModel: videoProviderAttempts[0]!.upstreamModel,
                profileId: videoProviderAttempts[0]!.profile.id,
                mode: body.mode,
                status: "submitted"
              },
              {
                release: true,
                responseStatus: 400,
                responseCode: "VIDEO_GENERATION_FAILED"
              }
            );
            return sendVideoGenerationFailure(
              reply,
              400,
              "VIDEO_GENERATION_FAILED"
            );
          }

          for (const attempt of videoProviderAttempts) {
            const account = attempt.providerAccount;
            const adapter =
              options.videoAdapter ??
              createApimartVideoAdapter({
                baseUrl: account.baseUrl,
                apiKey: account.apiKey,
                headersJson: account.headersJson,
                timeoutMs: Math.min(
                  account.timeoutMs || VIDEO_PROVIDER_TIMEOUT_DEFAULT_MS,
                  IMAGE_PROVIDER_TIMEOUT_MAX_MS
                ),
                fetchImpl: options.fetchImpl
              });

            try {
              const result = await adapter.startVideoGeneration({
                model: attempt.upstreamModel,
                prompt: body.prompt,
                mode: body.mode,
                profile: attempt.profile,
                ...(referenceImage ? { referenceImage } : {})
              });
              accepted = {
                operationId: result.operationId,
                attempt
              };
              if (
                typeof result.operationId !== "string" ||
                result.operationId.trim().length === 0
              ) {
                accepted = undefined;
                throw new AIProviderResponseFormatError();
              }
              break;
            } catch (error) {
              lastProviderError = error;
              if (isVideoSubmissionUncertainError(error)) {
                request.log.warn(
                  {
                    event: "video-submission-uncertain",
                    taskId,
                    routeId: attempt.routeId,
                    errorType: safeErrorName(error)
                  },
                  "video Provider submission outcome is uncertain"
                );
                break;
              }
              if (
                !isRetryableChatProviderError(error) ||
                attempt === videoProviderAttempts[videoProviderAttempts.length - 1]
              ) {
                break;
              }
            }
          }

          if (!accepted) {
            const submissionUncertain = isVideoSubmissionUncertainError(
              lastProviderError
            );
            const responseStatus =
              lastProviderError instanceof AIProviderTimeoutError ? 504 : 502;
            const responseCode =
              submissionUncertain
                ? "VIDEO_SUBMISSION_UNCERTAIN"
                : lastProviderError instanceof AIProviderTimeoutError
                  ? "VIDEO_PROVIDER_TIMEOUT"
                : lastProviderError instanceof AIProviderResponseFormatError
                  ? "VIDEO_PROVIDER_INVALID_RESPONSE"
                  : "VIDEO_PROVIDER_FAILED";
            await failVideoTask(
              { id: taskId, userId: user.id },
              {
                version: 1,
                protocol: "apimart-task-v1",
                operationId: "not-accepted",
                reservationId,
                providerAccountId: videoProviderAttempts[0]!.providerAccount.id,
                routeId: videoProviderAttempts[0]!.routeId,
                upstreamModel: videoProviderAttempts[0]!.upstreamModel,
                profileId: videoProviderAttempts[0]!.profile.id,
                mode: body.mode,
                status: "submitted"
              },
              { release: true, responseStatus, responseCode }
            );
            return sendVideoGenerationFailure(reply, responseStatus, responseCode);
          }

          const committedState: VideoRuntimeState = {
            version: 1,
            protocol: "apimart-task-v1",
            operationId: accepted.operationId,
            reservationId,
            providerAccountId: accepted.attempt.providerAccount.id,
            routeId: accepted.attempt.routeId,
            upstreamModel: accepted.attempt.upstreamModel,
            profileId: accepted.attempt.profile.id,
            mode: body.mode,
            status: "submitted",
            progress: 0
          };
          const runtimeTask: AiTaskRuntimeRecord = {
            id: taskId,
            userId: user.id,
            type: "video",
            status: "pending",
            modelId: modelConfig!.modelId,
            prompt: body.prompt,
            input: {
              mode: body.mode,
              [VIDEO_RUNTIME_INPUT_KEY]: committedState
            },
            output: null,
            costCredits,
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null
          };

          if (!(await updateVideoRuntimeState(runtimeTask, committedState))) {
            await failVideoTask(runtimeTask, committedState, {
              release: false,
              responseStatus: 500,
              responseCode: "VIDEO_TASK_START_FAILED"
            });
            return sendVideoGenerationFailure(reply, 500, "VIDEO_TASK_START_FAILED");
          }

          let running: AiTaskSummary | null;
          try {
            running = await store.markAiTaskRunning(taskId);
          } catch {
            running = null;
          }
          if (!running) {
            await failVideoTask(runtimeTask, committedState, {
              release: false,
              responseStatus: 500,
              responseCode: "VIDEO_TASK_START_FAILED"
            });
            return sendVideoGenerationFailure(reply, 500, "VIDEO_TASK_START_FAILED");
          }

          void recoverVideoTask(taskId, user.id).catch((error) => {
            request.log.warn(
              {
                event: "video-request-recovery-background-failed",
                taskId,
                errorType: safeErrorName(error)
              },
              "video request recovery background failed"
            );
          });

          return reply.code(202).send({
            status: "in_progress",
            taskId,
            retryAfterMs: VIDEO_IDEMPOTENCY_RETRY_AFTER_MS
          });
        }
      });

      if (!concurrencyResult) {
        return abandonVideoClaim(() => sendConcurrencyUnavailable(reply));
      }
      if (!concurrencyResult.acquired) {
        return abandonVideoClaim(() =>
          sendConcurrencyLimited(reply, "video", concurrencyResult.retryAfterMs)
        );
      }
      return concurrencyResult.value;
    }
  );

  server.get("/tasks", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const searchParams = new URL(request.url, "http://localhost").searchParams;

    return {
      tasks: await store.listAiTasksForUser(user.id, {
        type: parseAiTaskTypeFilter(searchParams.get("type")),
        status: parseAiTaskStatusFilter(searchParams.get("status")),
        limit: Math.min(
          Math.max(parsePositiveInt(searchParams.get("limit")) ?? 50, 1),
          100
        )
      })
    };
  });

  server.get("/tasks/:id", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const { id } = request.params as { id?: string };
    const detail = id ? await store.findAiTaskForUser(user.id, id) : null;

    if (!detail) {
      return reply.code(404).send({
        message: "task not found"
      });
    }

    return {
      task: sanitizeTaskDetailError(detail.task),
      assets:
        detail.task.type === "image"
          ? getCanonicalImageSuccessAssets(detail.assets)
          : detail.assets
    };
  });

  server.get("/assets", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const searchParams = new URL(request.url, "http://localhost").searchParams;

    return {
      assets: await store.listAiAssetsForUser(user.id, {
        type: parseAiAssetTypeFilter(searchParams.get("type")),
        limit: Math.min(
          Math.max(parsePositiveInt(searchParams.get("limit")) ?? 50, 1),
          100
        )
      })
    };
  });

  server.get("/assets/:id/content", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const sendNotFound = () =>
      reply.code(404).send({
        message: "asset not found"
      });

    try {
      const { id } = request.params as { id?: string };
      const assetId = normalizeAssetContentId(id);

      if (!assetId) {
        return sendNotFound();
      }

      const assetReference =
        await store.findAiAssetStorageObjectReferenceForUser(
          user.id,
          assetId
        );

      if (
        !assetReference ||
        assetReference.assetId !== assetId ||
        assetReference.userId !== user.id ||
        typeof assetReference.storageObjectId !== "string" ||
        assetReference.storageObjectId.trim().length === 0
      ) {
        return sendNotFound();
      }

      const storageObjectId = assetReference.storageObjectId;
      const storageObject = await store.findReadyStorageObjectForUser(
        user.id,
        storageObjectId
      );

      if (!storageObject) {
        return sendNotFound();
      }

      const isImage = isReadyLocalGeneratedImageStorageObject(
        storageObject,
        user.id,
        storageObjectId
      );
      const isVideo = isReadyLocalGeneratedVideoStorageObject(
        storageObject,
        user.id,
        storageObjectId
      );
      if (!isImage && !isVideo) return sendNotFound();

      if (isVideo) {
        const parsedRange = parseVideoByteRange(
          request.headers.range,
          storageObject.sizeBytes
        );
        if (parsedRange.kind === "invalid") {
          return reply
            .code(416)
            .header("Accept-Ranges", "bytes")
            .header("Content-Range", `bytes */${storageObject.sizeBytes}`)
            .header("Cache-Control", "private, max-age=3600")
            .header("Vary", "Authorization")
            .send({ message: "range not satisfiable" });
        }

        const content =
          parsedRange.kind === "range"
            ? await assetContentService.openLocalStorageObjectContent({
                objectKey: storageObject.objectKey,
                expectedSizeBytes: storageObject.sizeBytes,
                start: parsedRange.start,
                end: parsedRange.end
              })
            : await assetContentService.openLocalStorageObjectContent({
                objectKey: storageObject.objectKey,
                expectedSizeBytes: storageObject.sizeBytes
              });

        const response = reply
          .code(parsedRange.kind === "range" ? 206 : 200)
          .header("Content-Type", "video/mp4")
          .header("Content-Length", content.sizeBytes)
          .header("Accept-Ranges", "bytes")
          .header("Content-Disposition", "inline")
          .header("X-Content-Type-Options", "nosniff")
          .header("Cache-Control", "private, max-age=3600")
          .header("Vary", "Authorization");
        if (parsedRange.kind === "range") {
          response.header(
            "Content-Range",
            `bytes ${parsedRange.start}-${parsedRange.end}/${storageObject.sizeBytes}`
          );
        }
        return response.send(content.stream);
      }

      const content =
        await assetContentService.openLocalStorageObjectContent({
          objectKey: storageObject.objectKey,
          expectedSizeBytes: storageObject.sizeBytes
        });

      return reply
        .header("Content-Type", storageObject.mimeType)
        .header("Content-Length", content.sizeBytes)
        .header("Content-Disposition", "inline")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, max-age=3600")
        .header("Vary", "Authorization")
        .send(content.stream);
    } catch {
      return sendNotFound();
    }
  });

  server.get("/assets/:id", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const { id } = request.params as { id?: string };
    const detail = id ? await store.findAiAssetForUser(user.id, id) : null;

    if (!detail) {
      return reply.code(404).send({
        message: "asset not found"
      });
    }

    return {
      asset: detail.asset,
      task: detail.task ? sanitizeTaskDetailError(detail.task) : null
    };
  });

  server.delete("/assets/:id", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const { id } = request.params as { id?: string };
    const deletion = id
      ? await store.deleteAiAssetForUserWithStorageObjectReference(
          user.id,
          id
        )
      : { status: "NOT_FOUND" as const, storageObjectId: null };

    if (deletion.status === "NOT_FOUND") {
      return reply.code(404).send({
        message: "asset not found"
      });
    }

    await markDeletedAiAssetStorageObject({
      store,
      userId: user.id,
      storageObjectId: deletion.storageObjectId
    });

    return { ok: true };
  });

  server.get("/usage/me", async (request, reply): Promise<UsageSummary | FastifyReply> => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    return store.getUsageSummary(user.id, 20);
  });

  server.get("/quota/me", async (request, reply) => {
    const user = await authenticate(request, reply);

    if (!user) {
      return reply;
    }

    const quota = await store.getQuota(user.id);
    const latestPaidOrder = (await store.listOrdersForUser(user.id)).find(
      (order) => order.status === "PAID"
    );

    return {
      remainingCredits: Math.max(0, quota.remainingCredits),
      planName: latestPaidOrder?.planName ?? DEFAULT_BASE_PLAN_NAME
    };
  });

  return server;
}
