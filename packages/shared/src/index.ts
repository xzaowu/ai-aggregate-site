export type UserRole = "USER" | "ADMIN";

export * from "./provider-transport";

export type ModelProvider = "OPENAI_COMPATIBLE" | "SUB2API" | "NEW_API";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatSessionSummary {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorCanvasDocumentSummary {
  id: string;
  title: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorCanvasDocumentDetail extends CreatorCanvasDocumentSummary {
  state: unknown;
}

export interface CreatorCanvasDocumentListResponse {
  documents: CreatorCanvasDocumentSummary[];
}

export interface CreatorCanvasDocumentPagedListResponse
  extends CreatorCanvasDocumentListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CreatorCanvasDocumentResponse {
  document: CreatorCanvasDocumentDetail;
}

export interface ChatMessageRecord extends ChatMessage {
  id: string;
  sessionId: string;
  model: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  role: UserRole;
  credits: number;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export type FeedbackStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export interface FeedbackScreenshotUrlValidation {
  valid: boolean;
  value?: string;
}

export function validateFeedbackScreenshotUrl(
  value: unknown
): FeedbackScreenshotUrlValidation {
  if (value === undefined || value === null) {
    return { valid: true };
  }

  if (typeof value !== "string") {
    return { valid: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: true };
  }

  if (trimmed.length > 500) {
    return { valid: false };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false };
    }

    if (parsed.username || parsed.password) {
      return { valid: false };
    }

    return { valid: true, value: trimmed };
  } catch {
    return { valid: false };
  }
}

export const modelCapabilities = ["chat", "image", "video", "ppt"] as const;
export type ModelCapability = (typeof modelCapabilities)[number];

export const modelDisplaySurfaces = ["chat", "image", "video"] as const;
export type ModelDisplaySurface = (typeof modelDisplaySurfaces)[number];

export const modelImageInvokeModes = [
  "native-image",
  "anthropic-messages"
] as const;
export type ModelImageInvokeMode = (typeof modelImageInvokeModes)[number];

export const modelImageOutputParsers = [
  "native-image",
  "markdown-data-url"
] as const;
export type ModelImageOutputParser = (typeof modelImageOutputParsers)[number];

export const providerAccountTypes = [
  "OPENAI_COMPATIBLE",
  "SUB2API",
  "NEW_API",
  "ANTHROPIC",
  "AGNES_IMAGE"
] as const;
export type ProviderAccountType = (typeof providerAccountTypes)[number];

export const providerAccountCapabilities = [
  "chat",
  "image",
  "video",
  "ppt"
] as const;
export type ProviderAccountCapability =
  (typeof providerAccountCapabilities)[number];

export const aiTaskTypes = ["image", "video", "ppt", "document"] as const;
export type AiTaskType = (typeof aiTaskTypes)[number];

export const aiTaskStatuses = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled"
] as const;
export type AiTaskStatus = (typeof aiTaskStatuses)[number];

export const aiAssetTypes = ["image", "video", "document"] as const;
export type AiAssetType = (typeof aiAssetTypes)[number];

export const aiGenerationSizes = [
  "1024x1024",
  "1024x768",
  "768x1024",
  "1280x720",
  "720x1280"
] as const;
export type AiGenerationSize = (typeof aiGenerationSizes)[number];

export const aiGenerationCounts = [1, 2, 4] as const;
export type AiGenerationCount = (typeof aiGenerationCounts)[number];

export const imageGenerationModes = ["text-to-image", "image-to-image"] as const;
export type ImageGenerationMode = (typeof imageGenerationModes)[number];

export const imageGenerationWorkflows = [
  "precision-edit",
  "title-cover",
  "transcript-images"
] as const;
export type ImageGenerationWorkflow = (typeof imageGenerationWorkflows)[number];

export function isImageGenerationWorkflow(
  value: unknown
): value is ImageGenerationWorkflow {
  return (
    typeof value === "string" &&
    (imageGenerationWorkflows as readonly string[]).includes(value)
  );
}

export const titleCoverVisualStyles = [
  "minimal-modern",
  "energetic-motion",
  "professional-business",
  "warm-editorial"
] as const;
export type TitleCoverVisualStyle = (typeof titleCoverVisualStyles)[number];

/** Backward-compatible alias for existing Web-local Title Cover references. */
export const titleCoverStyles = titleCoverVisualStyles;
export type TitleCoverStyle = TitleCoverVisualStyle;

export const titleCoverOriginalTitleMaxCodePoints = 300;

export interface TitleCoverImageRequest {
  originalTitle: string;
  style: TitleCoverVisualStyle;
}

export function isTitleCoverVisualStyle(
  value: unknown
): value is TitleCoverVisualStyle {
  return (
    typeof value === "string" &&
    (titleCoverVisualStyles as readonly string[]).includes(value)
  );
}

export interface ImageReferenceInput {
  dataUrl: string;
  mimeType: string;
  name?: string;
  originalBytes?: number;
  compressedBytes?: number;
}

export interface PublicAiModelSummary {
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
  /** Compatibility allowance for enriched model sources; Prisma /models does not load routes. */
  routes?: AiModelRouteSummary[];
}

/** Backward-compatible public model DTO name. */
export type AiModelSummary = PublicAiModelSummary;

export interface AdminAiModelSummary {
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

export interface PublicVideoModelProfile {
  id: string;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  durationSeconds: number;
  resolution: string | null;
  aspectRatio: string;
}

export interface PublicVideoModelSummary {
  id: string;
  name: string;
  displayName?: string;
  slug: string;
  capability: "video";
  displaySurfaces: ["video"];
  group: string;
  tags: string[];
  shortDescription?: string;
  description?: string;
  enabled: true;
  creditCost: number;
  allowGuest: boolean;
  sortOrder: number;
  isRecommended: boolean;
  videoProfile: PublicVideoModelProfile;
}

export interface AiModelRouteSummary {
  id: string;
  modelId: string;
  /** Compatibility wire name for the selected AiProviderAccount id. */
  providerId: string;
  /** Compatibility wire name for the selected AiProviderAccount name. */
  providerName?: string;
  upstreamModel: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiModelRouteInput {
  modelId: string;
  /** Compatibility wire name for the selected AiProviderAccount id. */
  providerId: string;
  upstreamModel: string;
  priority?: number;
  enabled?: boolean;
}

export interface AiProviderAccountSummary {
  id: string;
  name: string;
  providerType: ProviderAccountType;
  baseUrl: string;
  capabilities: ProviderAccountCapability[];
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  configJson: Record<string, unknown> | null;
  notes: string | null;
  hasApiKey: boolean;
  hasCustomHeaders: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderAccountInput {
  name: string;
  providerType: ProviderAccountType;
  baseUrl: string;
  apiKey?: string;
  capabilities: ProviderAccountCapability[];
  enabled?: boolean;
  priority?: number;
  timeoutMs?: number;
  headersJson?: Record<string, unknown> | null;
  configJson?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface AiTaskSummary {
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
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AiAssetSummary {
  id: string;
  userId: string;
  taskId: string | null;
  type: AiAssetType;
  url: string;
  thumbnailUrl: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  taskPrompt?: string | null;
}

export interface ImageGenerationRequest {
  prompt: string;
  modelId: string;
  size: AiGenerationSize;
  count: AiGenerationCount;
  mode?: ImageGenerationMode;
  /** @deprecated Wire compatibility for existing single-reference clients. */
  referenceImage?: ImageReferenceInput;
  referenceImages?: ImageReferenceInput[];
  workflow?: ImageGenerationWorkflow;
  titleCover?: TitleCoverImageRequest;
}

export interface ImageGenerationResponse {
  task: AiTaskSummary;
  assets: AiAssetSummary[];
}

export interface AiTaskDetailResponse {
  task: AiTaskSummary;
  assets: AiAssetSummary[];
}

export interface AiAssetDetailResponse {
  asset: AiAssetSummary;
  task: AiTaskSummary | null;
}

export interface ChatCompletionRequest {
  sessionId?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatCompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatCompletionResponse {
  content: string;
  model: string;
  sessionId?: string;
  usage?: ChatCompletionUsage;
}

export interface UsageSummary {
  remainingCredits: number;
  logs: UsageLogSummary[];
  totalSuccessCount: number;
  totalFailureCount: number;
}

export type UsageLogStatus = "SUCCESS" | "FAILED";

export interface UsageLogSummary {
  id: string;
  userId: string | null;
  userEmail?: string | null;
  sessionId: string | null;
  model: string;
  modelDisplayName?: string;
  canonicalModel?: string | null;
  /** Current writes use the selected AiProviderAccount id; historical values are not FK-constrained. */
  providerId?: string | null;
  /** Current writes use the selected AiProviderAccount name; historical values are not identity-constrained. */
  providerName?: string | null;
  upstreamModel?: string | null;
  routeId?: string | null;
  fallbackAttempts?: number;
  status: UsageLogStatus;
  costCredits: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  role: UserRole;
  remainingCredits: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTrendPoint {
  date: string;
  calls: number;
  success: number;
  failed: number;
  creditsUsed: number;
  guestCalls: number;
}

export interface AdminGuestTrendPoint {
  date: string;
  calls: number;
}

export interface AdminModelUsageStats {
  model: string;
  displayName?: string;
  calls: number;
  success: number;
  failed: number;
  creditsUsed: number;
}

export interface AdminRecentFailureSummary {
  id: string;
  createdAt: string;
  userEmail: string | null;
  model: string;
  modelDisplayName?: string;
  errorSummary: string;
}

export interface AdminOverviewStats {
  users: {
    total: number;
    todayNew: number;
    todayActive: number;
    admins: number;
    regularUsers: number;
  };
  guests: {
    todayCalls: number;
    todayLimitExceeded: number;
  };
  usage: {
    todayCalls: number;
    todaySuccess: number;
    todayFailed: number;
    todayCreditsUsed: number;
    successRate: number;
  };
  orders: {
    total: number;
    pending: number;
    paid: number;
    cancelled: number;
    todayNew: number;
    todayConfirmed: number;
    todayPaid: number;
    todayRevenueCents: number;
  };
  quota: {
    remainingCreditsTotal: number;
    todayGrantedCredits: number;
    todayUsedCredits: number;
  };
  last7Days: AdminTrendPoint[];
  guestLast7Days: AdminGuestTrendPoint[];
  modelTopByCalls: AdminModelUsageStats[];
  modelTopByCredits: AdminModelUsageStats[];
  modelTopByFailures: AdminModelUsageStats[];
  models: AdminModelUsageStats[];
  modelUsageLast7Days: AdminModelUsageStats[];
  recentFailures: AdminRecentFailureSummary[];
  recentOrders: AdminOrderSummary[];
}

export const adminOperationsBudgetScopes = [
  "image_generation",
  "chat_completion",
  "admin_provider_test",
  "title_cover_visual_brief"
] as const;
export type AdminOperationsBudgetScope =
  (typeof adminOperationsBudgetScopes)[number];

export type AdminOperationsTaskSafeErrorClass =
  | "TASK_FAILED"
  | "CHARGED_AND_FAILED"
  | "SAFE_PROVIDER_ERROR"
  | "INTERNAL_ERROR"
  | "BUDGET_NEAR_LIMIT"
  | "BUDGET_EXHAUSTED"
  | "UNKNOWN";

export type AdminOperationsChargeStatus =
  | "UNKNOWN"
  | "RESERVED"
  | "SETTLED"
  | "RELEASED";

export type AdminOperationsCreditReleaseStatus =
  | "UNKNOWN"
  | "NOT_RELEASED"
  | "RELEASED";

export type AdminOperationsRefundStatus = "UNKNOWN";

export interface AdminOperationsTask {
  taskId: string;
  userId: string;
  type: AiTaskType;
  status: AiTaskStatus;
  modelId: string | null;
  modelLabel: string | null;
  providerLabel: string | null;
  routeId: string | null;
  createdAt: string;
  updatedAt: string;
  safeErrorClass: AdminOperationsTaskSafeErrorClass;
  chargeStatus: AdminOperationsChargeStatus;
  creditReleaseStatus: AdminOperationsCreditReleaseStatus;
  refundStatus: AdminOperationsRefundStatus;
  costRecorded: boolean;
}

export type AdminOperationsBudgetStatus =
  | "NOT_INITIALIZED"
  | "NORMAL"
  | "NEAR_LIMIT"
  | "EXHAUSTED";

export interface AdminOperationsBudget {
  scope: AdminOperationsBudgetScope;
  periodType: "DAILY" | null;
  periodKey: string | null;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  status: AdminOperationsBudgetStatus;
  updatedAt: string | null;
}

export type AdminOperationsManualCompensationAction = "UPDATE_USER_QUOTA";
export type AdminOperationsCreditChangeStatus = "RECORDED" | "UNKNOWN";

export interface AdminOperationsManualCompensation {
  auditId: string;
  targetUserId: string;
  action: AdminOperationsManualCompensationAction;
  createdAt: string;
  creditChangeStatus: AdminOperationsCreditChangeStatus;
  creditDelta: number | null;
}

export interface AdminOperationsOverview {
  recentTasks: AdminOperationsTask[];
  budgets: AdminOperationsBudget[];
  manualCompensations: AdminOperationsManualCompensation[];
}

export interface AdminOverview {
  users: AdminUserSummary[];
  models: AdminAiModelSummary[];
  usageLogs: UsageLogSummary[];
  totals: {
    users: number;
    usageSuccess: number;
    usageFailed: number;
  };
  stats: AdminOverviewStats;
  operations?: AdminOperationsOverview;
}

export type SiteSettingValueType = "string" | "boolean" | "number" | "json";

export interface SiteSettingSummary {
  key: string;
  value: string;
  type: SiteSettingValueType;
  description: string | null;
  updatedAt: string;
}

export interface ModerationRoute {
  id: string;
  providerAccountId: string;
  upstreamModel: string;
  endpointPath: string;
  priority: number;
  enabled: boolean;
  timeoutMs: number | null;
  supportsText: boolean;
  supportsImage: boolean;
}

export interface ModerationSettings {
  version: 1;
  enabled: boolean;
  routes: ModerationRoute[];
}

export interface AdminModerationRouteSummary extends ModerationRoute {
  providerAccountName: string | null;
  providerAccountEnabled: boolean;
  providerAccountCompatible: boolean;
}

export interface PublicSiteSettings {
  siteName?: string;
  siteLogoText?: string;
  siteLogoUrl?: string;
  siteFaviconUrl?: string;
  workspaceIconUrl?: string;
  siteAnnouncement?: string;
  contactEmail?: string;
  contactDescription?: string;
  contactWechat?: string;
  contactPublicAccount?: string;
  contactCommunityUrl?: string;
  contactQrImageUrl?: string;
  contactNotes?: string;
  contactExternalLinks?: string;
  defaultModel?: string;
  guestModeEnabled?: boolean;
  registrationEnabled?: boolean;
  registrationClosedMessageZh?: string;
  registrationClosedMessageEn?: string;
  maintenanceModeEnabled?: boolean;
  maintenanceMessage?: string;
  homeHeroTitle?: string;
  homeHeroSubtitle?: string;
  homePrimaryCta?: string;
  homeSecondaryCta?: string;
  betaNotice?: string;
  homePrimaryCtaText?: string;
  homeSecondaryCtaText?: string;
  homeBetaNotice?: string;
  homeRightCardNotice?: string;
  footerSlogan?: string;
  footerCopyright?: string;
  footerLinksJson?: string;
  homeFeatureCards?: string;
  workspaceLinksLabel?: string;
  workspaceTitle?: string;
  workspaceSubtitle?: string;
  workspacePromptPlaceholder?: string;
  workspaceHint?: string;
  workspaceHeroTitle?: string;
  workspaceHeroSubtitle?: string;
  workspacePromptCards?: string;
  imagePromptCards?: string;
  publicNotice?: string;
  publicNoticeEnabled?: boolean;
  helpContentJson?: string;
}

export interface ImagePromptCard {
  title: string;
  description: string;
  prompt: string;
  imageUrl?: string;
}

const privateAssetContentPathPattern = /^\/assets\/[A-Za-z0-9_-]+\/content$/;

function isPrivateIpv4Address(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6Address(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!normalized.includes(":")) {
    return false;
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

function isUnsafePublicImageHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    isPrivateIpv4Address(normalized) ||
    isPrivateIpv6Address(normalized)
  );
}

/**
 * Allows only public HTTPS URLs or same-origin public paths for image prompt
 * cards. Private asset content routes and credential-bearing URLs are never
 * valid public configuration values.
 */
export function isSafePublicImagePromptCardUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const url = value.trim();
  if (!url) {
    return false;
  }

  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) {
    try {
      const parsed = new URL(url, "https://public-image-card.invalid");
      return !privateAssetContentPathPattern.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !isUnsafePublicImageHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isImagePromptCardRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the JSON persisted for image-only prompt cards. A blank imageUrl
 * deliberately remains a text-card fallback, while malformed or unsafe URLs
 * reject the whole setting before it can become public.
 */
export function isValidImagePromptCardsSetting(value: string): boolean {
  const raw = value.trim();
  if (!raw) {
    return true;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return (
      Array.isArray(parsed) &&
      parsed.every((item) => {
        if (!isImagePromptCardRecord(item)) {
          return false;
        }

        const imageUrl = item.imageUrl;
        return (
          typeof item.title === "string" &&
          item.title.trim().length > 0 &&
          typeof item.description === "string" &&
          item.description.trim().length > 0 &&
          typeof item.prompt === "string" &&
          item.prompt.trim().length > 0 &&
          (imageUrl === undefined ||
            (typeof imageUrl === "string" &&
              (imageUrl.trim().length === 0 ||
                isSafePublicImagePromptCardUrl(imageUrl))))
        );
      })
    );
  } catch {
    return false;
  }
}

export type OrderStatus = "PENDING" | "PAID" | "CANCELLED";

export interface PlanSummary {
  id: string;
  name: string;
  price: number;
  credits: number;
  description: string;
  features: string[];
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderSummary {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  amount: number;
  credits: number;
  status: OrderStatus;
  paymentProvider: string | null;
  paymentType: string | null;
  paymentTradeNo: string | null;
  providerTradeNo: string | null;
  paymentUrl: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StoragePackageStatus = "ACTIVE" | "INACTIVE" | "EXPIRED";

export interface StoragePackageSummary {
  enabled: boolean;
  status: StoragePackageStatus;
  priceCredits: number;
  durationDays: number;
  autoRenewEnabled: boolean;
  autoRenewAvailable: boolean;
  description: string;
  startsAt: string | null;
  expiresAt: string | null;
}

export interface CheckInSummary {
  enabled: boolean;
  todayDate: string;
  todayCheckedIn: boolean;
  currentStreak: number;
  dailyRewardCredits: number;
  streakRewards: Record<string, number>;
  checkedDates: string[];
}

export interface ReferralSummary {
  enabled: boolean;
  code: string | null;
  invitedCount: number;
  totalRewardCredits: number;
  inviterRewardCredits: number;
  inviteeRewardCredits: number;
  rewardTrigger: string;
  rulesText: string;
  registrationIntegration: "READY" | "PREPARATION";
}

export type AccountActivityKind =
  | "ORDER"
  | "STORAGE_PACKAGE"
  | "CHECK_IN"
  | "REFERRAL_REWARD";

export interface AccountActivitySummary {
  id: string;
  kind: AccountActivityKind;
  title: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED";
  amount: number | null;
  creditsDelta: number;
  createdAt: string;
  completedAt: string | null;
}

export interface AccountActivityPage {
  items: AccountActivitySummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AccountBenefitSettings {
  storagePackageEnabled: boolean;
  storagePackagePriceCredits: number;
  storagePackageDurationDays: number;
  storagePackageAutoRenewEnabled: boolean;
  storagePackageDescription: string;
  checkInEnabled: boolean;
  checkInDailyRewardCredits: number;
  checkInStreakRewards: Record<string, number>;
  referralEnabled: boolean;
  referralInviterRewardCredits: number;
  referralInviteeRewardCredits: number;
  referralRewardTrigger: string;
  referralRulesText: string;
}

export interface AccountOverview {
  profile: AuthUser;
  quota: {
    remainingCredits: number;
  };
  plan: {
    name: string;
    status: "ACTIVE" | "INACTIVE";
    expiresAt: string | null;
    nextBillingAt: string | null;
  };
  storagePackage: StoragePackageSummary;
  checkIn: CheckInSummary;
  referral: ReferralSummary;
  activities: AccountActivitySummary[];
  benefits: AccountBenefitSettings;
}

export interface AdminPaymentAttemptSummary {
  id: string;
  orderId: string;
  ordinal: number;
  status: "PAID_REQUIRES_REVIEW";
  provider: string;
  paymentType: string;
  merchantTradeNo: string;
  providerTradeNo: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AdminOrderSummary extends Omit<OrderSummary, "paymentUrl"> {
  userEmail: string;
  reviewAttempts: AdminPaymentAttemptSummary[];
}

export interface AdminOrderListResponse {
  orders: AdminOrderSummary[];
  reviewOrderCount: number;
}

export interface EpayPaymentResponse {
  orderId: string;
  paymentProvider: string;
  paymentType: string;
  paymentTradeNo: string;
  paymentUrl: string;
}

export interface AdminAuditLogEntry {
  id: string;
  adminUserId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminStorageSubscriptionSummary {
  userId: string;
  userEmail: string;
  userName: string | null;
  status: "ACTIVE" | "INACTIVE" | "EXPIRED";
  priceCredits: number | null;
  durationDays: number | null;
  autoRenewEnabled: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdminStorageSubscriptionPage {
  items: AdminStorageSubscriptionSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type AdminStorageSubscriptionAction =
  | "ACTIVATE"
  | "EXTEND"
  | "DEACTIVATE"
  | "SET_AUTO_RENEW";

export interface FeedbackEntry {
  id: string;
  userId: string | null;
  userEmail: string | null;
  type: string;
  content: string;
  screenshotUrl: string | null;
  status: FeedbackStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinkEntry {
  id: string;
  title: string;
  url: string;
  description: string | null;
  category: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type DemoModelConfig = Pick<
  PublicAiModelSummary,
  | "name"
  | "slug"
  | "provider"
  | "modelId"
  | "description"
> &
  Partial<
    Pick<
      PublicAiModelSummary,
      | "creditCost"
      | "allowGuest"
      | "sortOrder"
      | "capability"
      | "displaySurfaces"
      | "group"
      | "tags"
      | "shortDescription"
      | "isRecommended"
      | "displayName"
    >
  >;

export const defaultDemoModelConfigs: DemoModelConfig[] = [
  {
    name: "GPT OSS 120B Free",
    slug: "gpt-oss-120b-free",
    provider: "SUB2API",
    modelId: "openai/gpt-oss-120b:free",
    capability: "chat",
    group: "free",
    tags: ["free", "general", "chat"],
    shortDescription: "Free model for general chat and lightweight tasks.",
    isRecommended: true,
    description: "Free GPT OSS 120B chat model available through Sub2API."
  },
  {
    name: "DeepSeek R1 Qwen3 8B",
    slug: "deepseek-r1-qwen3-8b",
    provider: "SUB2API",
    modelId: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
    capability: "chat",
    group: "reasoning",
    tags: ["reasoning", "deepseek", "analysis"],
    shortDescription: "Good for reasoning, analysis, and complex problem solving.",
    isRecommended: true,
    description: "Free DeepSeek R1 Qwen3 8B chat model available through Sub2API."
  }
];

export function createDemoModels(
  configs: readonly DemoModelConfig[] = defaultDemoModelConfigs
): PublicAiModelSummary[] {
  return configs.map((config, index) => ({
    id: `model_${config.slug}`,
    ...config,
    displayName: config.displayName ?? config.name,
    capability: config.capability ?? "chat",
    displaySurfaces: normalizeModelDisplaySurfaces(
      config.displaySurfaces,
      config.capability
    ),
    group: config.group ?? "advanced",
    tags: config.tags ?? [],
    shortDescription: config.shortDescription,
    enabled: true,
    maxReferenceImages: 1,
    creditCost: config.creditCost ?? 1,
    allowGuest: config.allowGuest ?? true,
    sortOrder: config.sortOrder ?? index,
    isRecommended: config.isRecommended ?? false
  }));
}

export const demoModels: PublicAiModelSummary[] = createDemoModels();

export const defaultDemoModelId = demoModels[0]?.modelId ?? "";

export const demoPlans: PlanSummary[] = [
  {
    id: "plan_free",
    name: "Free",
    price: 0,
    credits: 1000,
    description: "用于体验聊天和基础模型能力",
    features: ["基础聊天", "共享模型池", "社区支持"],
    enabled: true,
    sortOrder: 0,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z"
  },
  {
    id: "plan_pro",
    name: "Pro",
    price: 3900,
    credits: 100000,
    description: "适合个人高频使用和轻量团队试用",
    features: ["更高额度", "优先模型", "使用记录"],
    enabled: true,
    sortOrder: 1,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z"
  },
  {
    id: "plan_team",
    name: "Team",
    price: 9900,
    credits: 350000,
    description: "为团队预留的套餐配置入口",
    features: ["团队额度", "模型管理", "管理员入口"],
    enabled: true,
    sortOrder: 2,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z"
  }
];

export function isEnabledModel(model: PublicAiModelSummary): boolean {
  return model.enabled;
}

export function normalizeModelDisplaySurfaces(
  input: unknown,
  capability?: ModelCapability | string | null
): ModelDisplaySurface[] {
  const values = Array.isArray(input) ? input : [];
  const normalized = values.filter(
    (surface): surface is ModelDisplaySurface =>
      modelDisplaySurfaces.includes(surface as ModelDisplaySurface)
  );
  const unique = [...new Set(normalized)];

  if (Array.isArray(input)) {
    return unique;
  }

  if (capability === "image") {
    return ["image"];
  }

  if (capability === "chat" || capability === undefined || capability === null || capability === "") {
    return ["chat"];
  }

  return [];
}

export function isModelDisplaySurfaceCompatible(
  capability: ModelCapability | string | null | undefined,
  surface: ModelDisplaySurface
): boolean {
  return capability === surface;
}

export function normalizeModelImageInvokeMode(
  value: unknown
): ModelImageInvokeMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();

  return modelImageInvokeModes.includes(normalized as ModelImageInvokeMode)
    ? (normalized as ModelImageInvokeMode)
    : undefined;
}

export function normalizeModelImageOutputParser(
  value: unknown
): ModelImageOutputParser | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();

  return modelImageOutputParsers.includes(normalized as ModelImageOutputParser)
    ? (normalized as ModelImageOutputParser)
    : undefined;
}

export function isChatCapableModel(
  model: Pick<PublicAiModelSummary, "capability">
): boolean {
  return model.capability === "chat";
}

export function isImageCapableModel(
  model: Pick<PublicAiModelSummary, "capability">
): boolean {
  return model.capability === "image";
}

export function isVideoCapableModel(
  model: Pick<PublicAiModelSummary, "capability">
): boolean {
  return model.capability === "video";
}

export const MAX_CHAT_MESSAGE_LENGTH = 32_000;

export function getModelDisplayName(
  model: Pick<PublicAiModelSummary, "name" | "displayName">
): string {
  return model.displayName?.trim() || model.name;
}
