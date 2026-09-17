"use client";

import type {
  AdminAuditLogEntry,
  AdminOrderSummary,
  AdminOverview,
  AdminUserSummary,
  AiModelRouteSummary,
  AdminAiModelSummary,
  AiProviderAccountInput,
  AiProviderAccountSummary,
  FeedbackEntry,
  FeedbackStatus,
  LinkEntry,
  ModelCapability,
  ModelProvider,
  OrderStatus,
  PlanSummary,
  SiteSettingSummary
} from "@ai-aggregate/shared";
import {
  normalizeModelDisplaySurfaces,
  validateFeedbackScreenshotUrl
} from "@ai-aggregate/shared";
import {
  CheckCircle2,
  Copy,
  Save,
  Settings,
  Trash2,
  XCircle
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { getOrderPaymentMethodLabel } from "../../components/workspace/payment-methods";
import { useAdminAuth } from "./admin-auth-context";
import {
  getOrderStatusLabel,
  getAuditActionLabel,
  getUsageLogStatusLabel,
  getUserRoleLabel,
  useI18n
} from "../../lib/i18n/use-i18n";
import {
  AdminOperationsDetails,
  AdminOperationsOverview
} from "./admin-operations-overview";
import { GeneratedAssetStorageInfo } from "./generated-asset-storage-info";
import AdminStorageSubscriptions from "./admin-storage-subscriptions";
import {
  AdminModelsSection,
  type ModelFormState
} from "./admin-models-section";
import type { ModelRouteFormState } from "./admin-model-routes-editor";
import {
  AdminProviderAccountsSection,
  clearProviderAccountTestResult,
  getDefaultProviderAccountAnthropicAuthMode,
  getDefaultProviderAccountRequestFormat,
  mergeProviderAccountConfigJson,
  parseProviderAccountCapabilitiesInput,
  parseProviderAccountTestPayload,
  providerAccountToForm,
  type ProviderAccountFormState,
  type ProviderAccountTestResult
} from "./admin-provider-accounts-section";
import {
  buildModerationCircuitBreakerResetRequestInit,
  buildModerationCircuitBreakerSettingsRequestInit,
  buildModerationRouteTestRequestInit,
  canChangeProviderModerationEnabled,
  normalizeModerationCircuitBreakerStatus,
  createModerationRouteTestRegistry,
  getModerationCoverage,
  getModerationReferenceInfo,
  isSafeModerationEndpointPath,
  isProviderModerationDeclared,
  normalizeModerationTestResponseForRoute,
  tryAcquireModerationRouteDeleteLock,
  type AdminModerationSettings,
  type ModerationCircuitBreakerSettings,
  type ModerationCircuitBreakerStatus,
  type ModerationReferenceInfo,
  type ModerationRouteInput,
  type ModerationRouteTestResponse
} from "./admin-moderation";
import { AdminModerationSection } from "./admin-moderation-section";
import {
  formatPlanCentsForDisplay,
  formatPlanCentsForInput,
  parsePlanYuanInputToCents
} from "./admin-plan-price";
import {
  AdminOrdersFilters,
  AdminUsageFilters,
  AdminUsersFilters,
  buildAdminOrdersPath,
  buildAdminUsageLogsPath,
  buildAdminUsersPath,
  defaultAdminOrdersFilters,
  defaultAdminUsageFilters,
  defaultAdminUsersFilters,
  hasActiveOrdersFilters,
  hasActiveUsageFilters,
  hasActiveUsersFilters,
  type AdminOrdersFilterState,
  type AdminUsageFilterState,
  type AdminUsersFilterState
} from "./admin-filters";
import {
  AdminScrollableRegion,
  AdminSettingsAreaNavigation
} from "./admin-sections";
import {
  getAdminNavigationGroup,
  getAdminSectionDefinition,
  defaultAdminSettingsArea,
  getAdminSectionFromPathname,
  getAdminSettingsAreaFromPathname
} from "./admin-navigation";
import {
  AdminDataTable,
  AdminPageHeader,
  AdminPageShell,
  AdminSection,
  AdminSectionHeader,
  AdminStatusBadge,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell
} from "./admin-layout";
import {
  asArray,
  formatAdminDate,
  formatAdminNumber,
  createAdminLoadAccessGuard,
  normalizeAdminUser,
  normalizeAdminListResponse,
  normalizeAdminModerationResponse,
  normalizeAdminOrderListResponse,
  normalizeAdminOrderSummary,
  normalizeAdminOverviewResponse,
  normalizePlanSummary,
  normalizeProviderAccount,
  normalizeSiteSettingSummary,
  normalizeUsageLog,
  shouldReloadAdminOverviewAfterModelUpdate,
  refreshAdminDataAfterProviderMutation,
  type AdminLoadAccessFailure
} from "./admin-safe-data";
import { AdminContactSettings, type ContactFormState, contactFormToPayload } from "./admin-contact-settings";
import { AdminPaymentSettings } from "./admin-payment-settings";
import {
  AdminPaymentReviewBadge,
  AdminPaymentReviewDetails
} from "./admin-payment-review";
import {
  AdminSettingsSection,
  AdminStorageOfferSettings,
  AdminTitleCoverBudgetSettings,
  type SettingsFormState
} from "./admin-settings-section";
import { AdminSidebar } from "./admin-sidebar";
import {
  isValidFooterLinksJson,
  isValidHomeFeatureCards,
  isValidCheckInStreakRewards,
  isValidHelpContentJson,
  isValidGuestRateLimitSettings,
  isValidProfileRateLimitSettings,
  isValidConcurrencySettings,
  isValidRegistrationSettings,
  isValidReferenceImageRateLimitSettings,
  isValidTitleCoverVisualBriefSettings,
  isValidImagePromptCards,
  isValidWorkspacePromptCards,
  domainJsonToMultiline,
  settingsFormToPayload
} from "./admin-settings-validation";
import { AdminToastContainer, useAdminToast } from "./toast";
import { getSafeFeedbackScreenshotUrl } from "./feedback-screenshot-url";

import { apiUrl } from "../../lib/site-config";

type LoadState = "loading" | "ready" | "forbidden" | "error";

interface PlanFormState {
  name: string;
  price: string;
  credits: string;
  description: string;
  featuresText: string;
  enabled: boolean;
  sortOrder: string;
}

interface LinkFormState {
  title: string;
  url: string;
  category: string;
  description: string;
  enabled: boolean;
  sortOrder: string;
}

const emptyPlanForm: PlanFormState = {
  name: "",
  price: "0.00",
  credits: "100",
  description: "",
  featuresText: "",
  enabled: true,
  sortOrder: "0"
};

const emptyModelForm: ModelFormState = {
  name: "",
  displayName: "",
  modelId: "",
  provider: "SUB2API",
    providerAccountId: "",
    capability: "chat",
    displaySurfaces: ["chat"],
    imageInvokeMode: "native-image",
    imageOutputParser: "native-image",
    maxReferenceImages: "1",
    group: "advanced",
  tagsText: "",
  shortDescription: "",
  isRecommended: false,
  enabled: true,
  allowGuest: true,
  creditCost: "1",
  sortOrder: "0",
  iconUrl: "",
  iconText: "",
  iconColor: ""
};

const emptyModelRouteForm: ModelRouteFormState = {
  providerAccountId: "",
  upstreamModel: "",
  priority: "1",
  enabled: true
};

const emptyProviderAccountForm: ProviderAccountFormState = {
  name: "",
  providerType: "SUB2API",
  requestFormat: getDefaultProviderAccountRequestFormat("SUB2API"),
  anthropicAuthMode: getDefaultProviderAccountAnthropicAuthMode(
    "SUB2API",
    getDefaultProviderAccountRequestFormat("SUB2API")
  ),
  messagesPath: "",
  testModel: "",
  testCapability: "",
  baseUrl: "",
  apiKey: "",
  capabilitiesText: "chat",
  enabled: true,
  priority: "0",
  timeoutMs: "60000",
  headersJson: "",
  configJson: "",
  notes: "",
  moderationEnabled: false,
  moderationRequestFormat: "openai-moderation",
  moderationUpstreamModel: "omni-moderation-latest",
  moderationEndpointPath: "/v1/moderations",
  moderationSupportsText: true,
  moderationSupportsImage: true
};

const emptyLinkForm: LinkFormState = {
  title: "",
  url: "",
  category: "footer",
  description: "",
  enabled: true,
  sortOrder: "0"
};

const modelProviders: ModelProvider[] = [
  "SUB2API",
  "OPENAI_COMPATIBLE",
  "NEW_API"
];

const modelCapabilityOptions: ModelCapability[] = [
  "chat",
  "image",
  "video",
  "ppt"
];

const defaultSettingsForm: SettingsFormState = {
  siteName: "AI Aggregate",
  siteLogoText: "",
  siteLogoUrl: "",
  siteFaviconUrl: "",
  workspaceIconUrl: "",
  siteAnnouncement: "",
  publicNotice: "",
  publicNoticeEnabled: false,
  contactEmail: "",
  defaultModel: "",
  titleCoverBriefModelId: "",
  titleCoverBriefCostCredits: "",
  titleCoverBriefDailyBudgetCredits: "",
  guestModeEnabled: true,
  guestRateLimitEnabled: true,
  profileRateLimitEnabled: true,
  nicknameUpdateDailyLimit: "3",
  avatarUpdateDailyLimit: "5",
  referenceImageRateLimitEnabled: true,
  referenceImageDailyLimit: "20",
  registrationEnabled: false,
  registrationClosedMessageZh: "当前暂未开放新用户注册，已有账号可正常登录。",
  registrationClosedMessageEn: "New user registration is currently unavailable. Existing users can still sign in.",
  registrationEmailPolicyEnabled: true,
  registrationEmailPolicyMode: "ALLOWLIST",
  registrationAllowedDomainsText: "gmail.com\nqq.com",
  registrationBlockedDomainsText: "",
  maintenanceModeEnabled: false,
  maintenanceMessage: "",
  guestDailyLimit: "10",
  guestPerModelHourlyLimit: "5",
  guestBurstLimit: "2",
  guestBurstWindowSeconds: "10",
  guestChatConcurrencyLimit: "1",
  userChatConcurrencyLimit: "2",
  imageGenerationConcurrencyLimit: "1",
  homeHeroTitle: "",
  homeHeroSubtitle: "",
  homePrimaryCta: "",
  homeSecondaryCta: "",
  betaNotice: "",
  homePrimaryCtaText: "",
  homeSecondaryCtaText: "",
  homeBetaNotice: "",
  homeRightCardNotice: "",
  footerSlogan: "",
  footerCopyright: "",
  footerLinksJson: "",
  homeFeatureCards: "",
  workspaceLinksLabel: "",
  workspaceTitle: "",
  workspaceSubtitle: "",
  workspacePromptPlaceholder: "",
  workspaceHint: "",
  workspaceHeroTitle: "",
  workspaceHeroSubtitle: "",
  workspacePromptCards: "",
  imagePromptCards: "",
  storagePackageEnabled: false,
  storagePackagePriceCredits: "10",
  storagePackageDurationDays: "30",
  storagePackageAutoRenewEnabled: false,
  storagePackageDescription: "",
  checkInEnabled: false,
  checkInDailyRewardCredits: "0",
  checkInStreakRewards: "{}",
  referralEnabled: false,
  referralInviterRewardCredits: "0",
  referralInviteeRewardCredits: "0",
  referralRewardTrigger: "",
  referralRulesText: "",
  helpContentJson: ""
};

const defaultContactForm: ContactFormState = {
  contactDescription: "",
  contactEmail: "",
  contactWechat: "",
  contactPublicAccount: "",
  contactCommunityUrl: "",
  contactQrImageUrl: "",
  contactNotes: "",
  contactExternalLinks: []
};

async function readJsonError(response: Response): Promise<string> {
  const text = await response.text();

  if (!text.trim()) {
    return `Request failed (${response.status})`;
  }

  try {
    const body = JSON.parse(text) as { message?: unknown };
    return typeof body.message === "string" ? body.message : text;
  } catch {
    return text;
  }
}

function formatPrice(price: number, freeLabel: string): string {
  return formatPlanCentsForDisplay(price, freeLabel);
}

function formatDate(value: unknown): string {
  return formatAdminDate(value);
}

function planToForm(plan: PlanSummary): PlanFormState {
  return {
    name: plan.name,
    price: formatPlanCentsForInput(plan.price),
    credits: String(plan.credits),
    description: plan.description,
    featuresText: asArray<string>(plan.features).join("\n"),
    enabled: plan.enabled,
    sortOrder: String(plan.sortOrder)
  };
}

function modelToForm(model: AdminAiModelSummary): ModelFormState {
  return {
    name: model.name,
    displayName: model.displayName ?? "",
    modelId: model.modelId,
    provider: model.provider,
    providerAccountId: model.providerAccountId ?? "",
    capability: model.capability ?? "chat",
    displaySurfaces: normalizeModelDisplaySurfaces(
      model.displaySurfaces,
      model.capability
    ),
    imageInvokeMode: model.imageInvokeMode ?? "native-image",
    imageOutputParser: model.imageOutputParser ?? "native-image",
    maxReferenceImages: String(model.maxReferenceImages ?? 1),
    group: model.group,
    tagsText: asArray<string>(model.tags).join(", "),
    shortDescription: model.shortDescription ?? "",
    isRecommended: model.isRecommended,
    enabled: model.enabled,
    allowGuest: model.allowGuest,
    creditCost: String(model.creditCost),
    sortOrder: String(model.sortOrder),
    iconUrl: model.iconUrl ?? "",
    iconText: model.iconText ?? "",
    iconColor: model.iconColor ?? ""
  };
}

function parseFeatures(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0);
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function parsePlanForm(form: PlanFormState) {
  const price = parsePlanYuanInputToCents(form.price);
  const credits = Number(form.credits);
  const sortOrder = Number(form.sortOrder);

  if (
    form.name.trim().length === 0 ||
    price === null ||
    !Number.isInteger(credits) ||
    credits <= 0 ||
    !Number.isInteger(sortOrder)
  ) {
    return null;
  }

  return {
    name: form.name.trim(),
    price,
    credits,
    description: form.description.trim(),
    features: parseFeatures(form.featuresText),
    enabled: form.enabled,
    sortOrder
  };
}

export function parseModelForm(form: ModelFormState) {
  const creditCost = Number(form.creditCost);
  const maxReferenceImages = Number(form.maxReferenceImages);
  const sortOrder = Number(form.sortOrder);

  if (
    form.name.trim().length === 0 ||
    form.modelId.trim().length === 0 ||
    form.group.trim().length === 0 ||
    !Number.isInteger(creditCost) ||
    creditCost < 0 ||
    form.maxReferenceImages.trim().length === 0 ||
    !Number.isInteger(maxReferenceImages) ||
    maxReferenceImages < 0 ||
    maxReferenceImages > 4 ||
    !Number.isInteger(sortOrder)
  ) {
    return null;
  }

  return {
    name: form.name.trim(),
    displayName: form.displayName.trim(),
    modelId: form.modelId.trim(),
    provider: form.provider,
    providerAccountId: form.providerAccountId.trim() || null,
    capability: form.capability,
    displaySurfaces: normalizeModelDisplaySurfaces(
      form.displaySurfaces,
      form.capability
    ),
    imageInvokeMode: form.imageInvokeMode,
    imageOutputParser: form.imageOutputParser,
    maxReferenceImages,
    group: form.group.trim(),
    tags: parseTags(form.tagsText),
    shortDescription: form.shortDescription.trim(),
    isRecommended: form.isRecommended,
    enabled: form.enabled,
    allowGuest: form.allowGuest,
    creditCost,
    sortOrder,
    iconUrl: form.iconUrl.trim() || undefined,
    iconText: form.iconText.trim() || undefined,
    iconColor: form.iconColor.trim() || undefined
  };
}

function parseModelRouteForm(model: AdminAiModelSummary, form: ModelRouteFormState) {
  const priority = Number(form.priority);

  if (
    !model.id ||
    form.providerAccountId.trim().length === 0 ||
    form.upstreamModel.trim().length === 0 ||
    !Number.isInteger(priority)
  ) {
    return null;
  }

  return {
    modelId: model.id,
    providerId: form.providerAccountId.trim(),
    upstreamModel: form.upstreamModel.trim(),
    priority,
    enabled: form.enabled
  };
}

function parseJsonObjectField(value: string): Record<string, unknown> | null | false {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : false;
  } catch {
    return false;
  }
}

function parseProviderAccountForm(
  form: ProviderAccountFormState,
  moderationReferenceInfo: ModerationReferenceInfo = { known: true, count: 0 }
): AiProviderAccountInput | null {
  const priority = Number(form.priority);
  const timeoutMs = Number(form.timeoutMs);
  const headersJson = parseJsonObjectField(form.headersJson);
  const rawConfigJson = parseJsonObjectField(form.configJson);
  const { capabilities, invalidCapabilities } =
    parseProviderAccountCapabilitiesInput(form.capabilitiesText);

  if (
    form.name.trim().length === 0 ||
    form.baseUrl.trim().length === 0 ||
    invalidCapabilities.length > 0 ||
    capabilities.length === 0 ||
    !Number.isInteger(priority) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    (form.moderationEnabled === true &&
      (!(form.moderationUpstreamModel ?? "").trim() ||
        !isSafeModerationEndpointPath(form.moderationEndpointPath) ||
        (!form.moderationSupportsText && !form.moderationSupportsImage))) ||
    (!form.moderationEnabled &&
      moderationReferenceInfo.known &&
      moderationReferenceInfo.count > 0) ||
    headersJson === false ||
    rawConfigJson === false
  ) {
    return null;
  }

  const configJson = mergeProviderAccountConfigJson(form, rawConfigJson);

  return {
    name: form.name.trim(),
    providerType: form.providerType,
    baseUrl: form.baseUrl.trim(),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    capabilities,
    enabled: form.enabled,
    priority,
    timeoutMs,
    ...(form.headersJson.trim() ? { headersJson } : {}),
    configJson,
    notes: form.notes.trim() || null
  };
}

function readOptionalProviderAccount(value: unknown): AiProviderAccountSummary | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const providerAccount = (value as { providerAccount?: unknown }).providerAccount;
  if (
    typeof providerAccount !== "object" ||
    providerAccount === null ||
    Array.isArray(providerAccount)
  ) {
    return null;
  }

  const normalized = normalizeProviderAccount(providerAccount);
  return normalized.id ? normalized : null;
}

function linkToForm(link: LinkEntry): LinkFormState {
  return {
    title: link.title,
    url: link.url,
    category: link.category,
    description: link.description ?? "",
    enabled: link.enabled,
    sortOrder: String(link.sortOrder)
  };
}

function parseLinkForm(form: LinkFormState) {
  const sortOrder = Number(form.sortOrder);

  if (
    form.title.trim().length === 0 ||
    form.url.trim().length === 0 ||
    form.category.trim().length === 0 ||
    !Number.isInteger(sortOrder)
  ) {
    return null;
  }

  return {
    title: form.title.trim(),
    url: form.url.trim(),
    category: form.category.trim(),
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    sortOrder
  };
}

function settingsValue(settings: SiteSettingSummary[], key: string) {
  return asArray<SiteSettingSummary>(settings).find(
    (setting) => setting.key === key
  )?.value;
}

function settingsBoolean(
  settings: SiteSettingSummary[],
  key: string,
  fallback: boolean
) {
  const value = settingsValue(settings, key);

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

export function settingsToForm(
  settings: SiteSettingSummary[]
): SettingsFormState {
  const safeSettings = asArray<SiteSettingSummary>(settings);

  return {
    siteName:
      settingsValue(safeSettings, "siteName") ?? defaultSettingsForm.siteName,
    siteLogoText:
      settingsValue(safeSettings, "siteLogoText") ??
      defaultSettingsForm.siteLogoText,
    siteLogoUrl:
      settingsValue(safeSettings, "siteLogoUrl") ??
      defaultSettingsForm.siteLogoUrl,
    siteFaviconUrl:
      settingsValue(safeSettings, "siteFaviconUrl") ??
      defaultSettingsForm.siteFaviconUrl,
    workspaceIconUrl:
      settingsValue(safeSettings, "workspaceIconUrl") ??
      defaultSettingsForm.workspaceIconUrl,
    siteAnnouncement:
      settingsValue(safeSettings, "siteAnnouncement") ??
      defaultSettingsForm.siteAnnouncement,
    publicNotice:
      settingsValue(safeSettings, "publicNotice") ??
      defaultSettingsForm.publicNotice,
    publicNoticeEnabled: settingsBoolean(
      safeSettings,
      "publicNoticeEnabled",
      false
    ),
    contactEmail:
      settingsValue(safeSettings, "contactEmail") ??
      defaultSettingsForm.contactEmail,
    defaultModel:
      settingsValue(safeSettings, "defaultModel") ??
      defaultSettingsForm.defaultModel,
    titleCoverBriefModelId:
      settingsValue(safeSettings, "titleCoverBriefModelId") ??
      defaultSettingsForm.titleCoverBriefModelId,
    titleCoverBriefCostCredits:
      settingsValue(safeSettings, "titleCoverBriefCostCredits") ??
      defaultSettingsForm.titleCoverBriefCostCredits,
    titleCoverBriefDailyBudgetCredits:
      settingsValue(safeSettings, "titleCoverBriefDailyBudgetCredits") ??
      defaultSettingsForm.titleCoverBriefDailyBudgetCredits,
    guestModeEnabled: settingsBoolean(safeSettings, "guestModeEnabled", true),
    guestRateLimitEnabled: settingsBoolean(
      safeSettings,
      "guestRateLimitEnabled",
      true
    ),
    profileRateLimitEnabled: settingsBoolean(
      safeSettings,
      "profileRateLimitEnabled",
      true
    ),
    nicknameUpdateDailyLimit:
      settingsValue(safeSettings, "nicknameUpdateDailyLimit") ??
      defaultSettingsForm.nicknameUpdateDailyLimit,
    avatarUpdateDailyLimit:
      settingsValue(safeSettings, "avatarUpdateDailyLimit") ??
      defaultSettingsForm.avatarUpdateDailyLimit,
    referenceImageRateLimitEnabled: settingsBoolean(
      safeSettings,
      "referenceImageRateLimitEnabled",
      true
    ),
    referenceImageDailyLimit:
      settingsValue(safeSettings, "referenceImageDailyLimit") ??
      defaultSettingsForm.referenceImageDailyLimit,
    registrationEnabled: settingsBoolean(
      safeSettings,
      "registrationEnabled",
      false
    ),
    registrationClosedMessageZh:
      settingsValue(safeSettings, "registrationClosedMessageZh") ??
      defaultSettingsForm.registrationClosedMessageZh,
    registrationClosedMessageEn:
      settingsValue(safeSettings, "registrationClosedMessageEn") ??
      defaultSettingsForm.registrationClosedMessageEn,
    registrationEmailPolicyEnabled: settingsBoolean(
      safeSettings,
      "registrationEmailPolicyEnabled",
      true
    ),
    registrationEmailPolicyMode: (["ALL", "ALLOWLIST", "DENYLIST"] as const).includes(
      settingsValue(safeSettings, "registrationEmailPolicyMode") as "ALL" | "ALLOWLIST" | "DENYLIST"
    )
      ? settingsValue(safeSettings, "registrationEmailPolicyMode") as "ALL" | "ALLOWLIST" | "DENYLIST"
      : "ALLOWLIST",
    registrationAllowedDomainsText: domainJsonToMultiline(
      settingsValue(safeSettings, "registrationAllowedDomainsJson") ?? undefined,
      ["gmail.com", "qq.com"]
    ),
    registrationBlockedDomainsText: domainJsonToMultiline(
      settingsValue(safeSettings, "registrationBlockedDomainsJson") ?? undefined
    ),
    maintenanceModeEnabled: settingsBoolean(
      safeSettings,
      "maintenanceModeEnabled",
      false
    ),
    maintenanceMessage:
      settingsValue(safeSettings, "maintenanceMessage") ??
      defaultSettingsForm.maintenanceMessage,
    guestDailyLimit:
      settingsValue(safeSettings, "guestDailyLimit") ??
      defaultSettingsForm.guestDailyLimit,
    guestPerModelHourlyLimit:
      settingsValue(safeSettings, "guestPerModelHourlyLimit") ??
      defaultSettingsForm.guestPerModelHourlyLimit,
    guestBurstLimit:
      settingsValue(safeSettings, "guestBurstLimit") ??
      defaultSettingsForm.guestBurstLimit,
    guestBurstWindowSeconds:
      settingsValue(safeSettings, "guestBurstWindowSeconds") ??
      defaultSettingsForm.guestBurstWindowSeconds,
    guestChatConcurrencyLimit:
      settingsValue(safeSettings, "guestChatConcurrencyLimit") ??
      defaultSettingsForm.guestChatConcurrencyLimit,
    userChatConcurrencyLimit:
      settingsValue(safeSettings, "userChatConcurrencyLimit") ??
      defaultSettingsForm.userChatConcurrencyLimit,
    imageGenerationConcurrencyLimit:
      settingsValue(safeSettings, "imageGenerationConcurrencyLimit") ??
      defaultSettingsForm.imageGenerationConcurrencyLimit,
    homeHeroTitle:
      settingsValue(safeSettings, "homeHeroTitle") ??
      defaultSettingsForm.homeHeroTitle,
    homeHeroSubtitle:
      settingsValue(safeSettings, "homeHeroSubtitle") ??
      defaultSettingsForm.homeHeroSubtitle,
    homePrimaryCta:
      settingsValue(safeSettings, "homePrimaryCta") ??
      settingsValue(safeSettings, "homePrimaryCtaText") ??
      defaultSettingsForm.homePrimaryCta,
    homeSecondaryCta:
      settingsValue(safeSettings, "homeSecondaryCta") ??
      settingsValue(safeSettings, "homeSecondaryCtaText") ??
      defaultSettingsForm.homeSecondaryCta,
    betaNotice:
      settingsValue(safeSettings, "betaNotice") ??
      settingsValue(safeSettings, "homeBetaNotice") ??
      defaultSettingsForm.betaNotice,
    homePrimaryCtaText:
      settingsValue(safeSettings, "homePrimaryCtaText") ??
      defaultSettingsForm.homePrimaryCtaText,
    homeSecondaryCtaText:
      settingsValue(safeSettings, "homeSecondaryCtaText") ??
      defaultSettingsForm.homeSecondaryCtaText,
    homeBetaNotice:
      settingsValue(safeSettings, "homeBetaNotice") ??
      defaultSettingsForm.homeBetaNotice,
    homeRightCardNotice:
      settingsValue(safeSettings, "homeRightCardNotice") ??
      defaultSettingsForm.homeRightCardNotice,
    footerSlogan:
      settingsValue(safeSettings, "footerSlogan") ??
      defaultSettingsForm.footerSlogan,
    footerCopyright:
      settingsValue(safeSettings, "footerCopyright") ??
      defaultSettingsForm.footerCopyright,
    footerLinksJson:
      settingsValue(safeSettings, "footerLinksJson") ??
      defaultSettingsForm.footerLinksJson,
    homeFeatureCards:
      settingsValue(safeSettings, "homeFeatureCards") ??
      defaultSettingsForm.homeFeatureCards,
    workspaceLinksLabel:
      settingsValue(safeSettings, "workspaceLinksLabel") ??
      defaultSettingsForm.workspaceLinksLabel,
    workspaceTitle:
      settingsValue(safeSettings, "workspaceTitle") ??
      settingsValue(safeSettings, "workspaceHeroTitle") ??
      defaultSettingsForm.workspaceTitle,
    workspaceSubtitle:
      settingsValue(safeSettings, "workspaceSubtitle") ??
      settingsValue(safeSettings, "workspaceHeroSubtitle") ??
      defaultSettingsForm.workspaceSubtitle,
    workspacePromptPlaceholder:
      settingsValue(safeSettings, "workspacePromptPlaceholder") ??
      defaultSettingsForm.workspacePromptPlaceholder,
    workspaceHint:
      settingsValue(safeSettings, "workspaceHint") ??
      defaultSettingsForm.workspaceHint,
    workspaceHeroTitle:
      settingsValue(safeSettings, "workspaceHeroTitle") ??
      defaultSettingsForm.workspaceHeroTitle,
    workspaceHeroSubtitle:
      settingsValue(safeSettings, "workspaceHeroSubtitle") ??
      defaultSettingsForm.workspaceHeroSubtitle,
    workspacePromptCards:
      settingsValue(safeSettings, "workspacePromptCards") ??
      defaultSettingsForm.workspacePromptCards,
    imagePromptCards:
      settingsValue(safeSettings, "imagePromptCards") ??
      defaultSettingsForm.imagePromptCards,
    storagePackageEnabled: settingsBoolean(safeSettings, "storagePackageEnabled", false),
    storagePackagePriceCredits: settingsValue(safeSettings, "storagePackagePriceCredits") ?? defaultSettingsForm.storagePackagePriceCredits,
    storagePackageDurationDays: settingsValue(safeSettings, "storagePackageDurationDays") ?? defaultSettingsForm.storagePackageDurationDays,
    storagePackageAutoRenewEnabled: settingsBoolean(safeSettings, "storagePackageAutoRenewEnabled", false),
    storagePackageDescription: settingsValue(safeSettings, "storagePackageDescription") ?? defaultSettingsForm.storagePackageDescription,
    checkInEnabled: settingsBoolean(safeSettings, "checkInEnabled", false),
    checkInDailyRewardCredits: settingsValue(safeSettings, "checkInDailyRewardCredits") ?? defaultSettingsForm.checkInDailyRewardCredits,
    checkInStreakRewards: settingsValue(safeSettings, "checkInStreakRewards") ?? defaultSettingsForm.checkInStreakRewards,
    referralEnabled: settingsBoolean(safeSettings, "referralEnabled", false),
    referralInviterRewardCredits: settingsValue(safeSettings, "referralInviterRewardCredits") ?? defaultSettingsForm.referralInviterRewardCredits,
    referralInviteeRewardCredits: settingsValue(safeSettings, "referralInviteeRewardCredits") ?? defaultSettingsForm.referralInviteeRewardCredits,
    referralRewardTrigger: settingsValue(safeSettings, "referralRewardTrigger") ?? defaultSettingsForm.referralRewardTrigger,
    referralRulesText: settingsValue(safeSettings, "referralRulesText") ?? defaultSettingsForm.referralRulesText,
    helpContentJson:
      settingsValue(safeSettings, "helpContentJson") ??
      defaultSettingsForm.helpContentJson
  };
}

export function buildAdminSettingsRequestInit(
  token: string,
  form: SettingsFormState
): RequestInit {
  return {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      settings: settingsFormToPayload(form)
    })
  };
}

function settingsToContactForm(settings: SiteSettingSummary[]): ContactFormState {
  const safeSettings = asArray<SiteSettingSummary>(settings);
  const externalLinksRaw = settingsValue(safeSettings, "contactExternalLinks");
  let contactExternalLinks: ContactFormState["contactExternalLinks"] = [];

  if (externalLinksRaw) {
    try {
      const parsed = JSON.parse(externalLinksRaw) as unknown;

      if (Array.isArray(parsed)) {
        contactExternalLinks = parsed.filter(
          (item): item is { label: string; url: string } =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as Record<string, unknown>).label === "string" &&
            typeof (item as Record<string, unknown>).url === "string"
        );
      }
    } catch {
      // ignore invalid JSON
    }
  }

  return {
    contactDescription:
      settingsValue(safeSettings, "contactDescription") ??
      defaultContactForm.contactDescription,
    contactEmail:
      settingsValue(safeSettings, "contactEmail") ??
      defaultContactForm.contactEmail,
    contactWechat:
      settingsValue(safeSettings, "contactWechat") ??
      defaultContactForm.contactWechat,
    contactPublicAccount:
      settingsValue(safeSettings, "contactPublicAccount") ??
      defaultContactForm.contactPublicAccount,
    contactCommunityUrl:
      settingsValue(safeSettings, "contactCommunityUrl") ??
      defaultContactForm.contactCommunityUrl,
    contactQrImageUrl:
      settingsValue(safeSettings, "contactQrImageUrl") ??
      defaultContactForm.contactQrImageUrl,
    contactNotes:
      settingsValue(safeSettings, "contactNotes") ??
      defaultContactForm.contactNotes,
    contactExternalLinks
  };
}

export default function AdminPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const activeSection = getAdminSectionFromPathname(pathname);
  const activeSectionDefinition = activeSection
    ? getAdminSectionDefinition(activeSection)
    : null;
  const activeSettingsArea =
    getAdminSettingsAreaFromPathname(pathname) ?? defaultAdminSettingsArea;
  const hasValidAdminSection = activeSection !== null;
  const { locale, t } = useI18n();
  const { token: adminToken, logout } = useAdminAuth();
  const paymentMethodLabels = {
    alipay: t("payment.alipay"),
    wxpay: t("payment.wxpay"),
    onlinePayment: t("payment.onlinePayment"),
    empty: "-"
  };
  const [state, setState] = useState<LoadState>("loading");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [reviewOrderCount, setReviewOrderCount] = useState(0);
  const [settings, setSettings] = useState<SiteSettingSummary[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogEntry[]>([]);
  const [feedbacks, setFeedbacks] = useState<FeedbackEntry[]>([]);
  const [links, setLinks] = useState<LinkEntry[]>([]);
  const [providerAccounts, setProviderAccounts] = useState<
    AiProviderAccountSummary[]
  >([]);
  const [moderationSettings, setModerationSettings] =
    useState<AdminModerationSettings | null>(null);
  const [moderationLoadState, setModerationLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [moderationLoadError, setModerationLoadError] = useState<string | null>(
    null
  );
  const moderationLoadVersionRef = React.useRef(0);
  const [circuitBreakerStatus, setCircuitBreakerStatus] =
    useState<ModerationCircuitBreakerStatus | null>(null);
  const [circuitBreakerLoadState, setCircuitBreakerLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [circuitBreakerLoadError, setCircuitBreakerLoadError] = useState<
    string | null
  >(null);
  const circuitBreakerLoadVersionRef = React.useRef(0);
  const adminLoadAccessGuardRef = React.useRef(createAdminLoadAccessGuard());
  const [providerAccountInputs, setProviderAccountInputs] = useState<
    Record<string, ProviderAccountFormState>
  >({});
  const [linkDrafts, setLinkDrafts] = useState<Record<string, LinkFormState>>({});
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] =
    useState<SettingsFormState>(defaultSettingsForm);
  const [contactForm, setContactForm] =
    useState<ContactFormState>(defaultContactForm);
  const [savingContact, setSavingContact] = useState(false);
  const [quotaInputs, setQuotaInputs] = useState<Record<string, string>>({});
  const [planInputs, setPlanInputs] = useState<Record<string, PlanFormState>>(
    {}
  );
  const [modelInputs, setModelInputs] = useState<Record<string, ModelFormState>>(
    {}
  );
  const [modelRouteInputs, setModelRouteInputs] = useState<
    Record<string, ModelRouteFormState>
  >({});
  const [newPlan, setNewPlan] = useState<PlanFormState>(emptyPlanForm);
  const [newModel, setNewModel] = useState<ModelFormState>(emptyModelForm);
  const [newProviderAccount, setNewProviderAccount] =
    useState<ProviderAccountFormState>(emptyProviderAccountForm);
  const { toasts, showToast, dismissToast } = useAdminToast();
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);
  const [savingModelId, setSavingModelId] = useState<string | null>(null);
  const [savingModelRouteId, setSavingModelRouteId] = useState<string | null>(
    null
  );
  const [savingProviderAccountId, setSavingProviderAccountId] = useState<
    string | null
  >(null);
  const [testingProviderAccountId, setTestingProviderAccountId] = useState<
    string | null
  >(null);
  const [testingNewProviderAccount, setTestingNewProviderAccount] =
    useState(false);
  const [providerAccountTestResults, setProviderAccountTestResults] = useState<
    Record<string, ProviderAccountTestResult | undefined>
  >({});
  const providerAccountTestGenerationRef = React.useRef(
    new Map<string, number>()
  );
  const [moderationTestResults, setModerationTestResults] = useState<
    Record<string, ModerationRouteTestResponse | undefined>
  >({});
  const [testingModerationRouteIds, setTestingModerationRouteIds] = useState<
    Set<string>
  >(new Set());
  const moderationTestRegistryRef = React.useRef(
    createModerationRouteTestRegistry()
  );
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingModerationSettings, setSavingModerationSettings] = useState(false);
  const [savingCircuitBreakerSettings, setSavingCircuitBreakerSettings] =
    useState(false);
  const [resettingCircuitBreaker, setResettingCircuitBreaker] = useState(false);
  const [savingModerationRouteId, setSavingModerationRouteId] = useState<string | null>(
    null
  );
  const [deletingModerationRouteId, setDeletingModerationRouteId] = useState<string | null>(
    null
  );
  const deletingModerationRouteIdsRef = React.useRef(new Set<string>());
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [creatingModel, setCreatingModel] = useState(false);
  const [creatingProviderAccount, setCreatingProviderAccount] = useState(false);
  const [userFilters, setUserFilters] =
    useState<AdminUsersFilterState>(defaultAdminUsersFilters);
  const [orderFilters, setOrderFilters] =
    useState<AdminOrdersFilterState>(defaultAdminOrdersFilters);
  const [usageFilters, setUsageFilters] =
    useState<AdminUsageFilterState>(defaultAdminUsageFilters);
  const [showArchivedFeedback, setShowArchivedFeedback] = useState(false);
  const [newLink, setNewLink] = useState<LinkFormState>(emptyLinkForm);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(
    new Set()
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);

  function toggleOrderExpanded(orderId: string) {
    setExpandedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }

  async function copyToClipboard(text: string, fieldKey: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // clipboard write failed — ignore
    }
  }

  const [sidebarOpen, setSidebarOpen] = useState(false);

  function getToken(): string | null {
    return adminToken;
  }

  function authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`
    };
  }

  function beginAdminLoadGeneration(): number {
    return adminLoadAccessGuardRef.current.begin();
  }

  function nextProviderAccountTestGeneration(resultKey: string): number {
    const generation =
      (providerAccountTestGenerationRef.current.get(resultKey) ?? 0) + 1;
    providerAccountTestGenerationRef.current.set(resultKey, generation);
    return generation;
  }

  function invalidateProviderAccountTest(resultKey: string) {
    nextProviderAccountTestGeneration(resultKey);
    setProviderAccountTestResults((current) =>
      clearProviderAccountTestResult(current, resultKey)
    );
    if (resultKey === "new") {
      setTestingNewProviderAccount(false);
    } else {
      setTestingProviderAccountId((current) =>
        current === resultKey ? null : current
      );
    }
  }

  function isCurrentProviderAccountTest(
    resultKey: string,
    generation: number
  ): boolean {
    return providerAccountTestGenerationRef.current.get(resultKey) === generation;
  }

  function handleAdminAccessFailure(
    generation: number,
    failure: AdminLoadAccessFailure
  ): boolean {
    const previousFailure = adminLoadAccessGuardRef.current.getAccessFailure();
    if (
      !adminLoadAccessGuardRef.current.markAccessFailure(generation, failure)
    ) {
      return false;
    }

    const currentFailure = adminLoadAccessGuardRef.current.getAccessFailure();
    if (currentFailure === "unauthorized") {
      if (previousFailure !== "unauthorized") {
        logout();
        router.replace("/login");
      }
    } else {
      setState("forbidden");
    }
    return true;
  }

  function invalidateModerationTests(routeIds?: Iterable<string>) {
    const ids = moderationTestRegistryRef.current.invalidate(routeIds);
    setTestingModerationRouteIds(
      new Set(moderationTestRegistryRef.current.activeRouteIds)
    );
    if (ids.length > 0) {
      setModerationTestResults((current) => {
        const next = { ...current };
        for (const routeId of ids) {
          delete next[routeId];
        }
        return next;
      });
    }
  }

  function beginModerationRouteTest(routeId: string): number | null {
    if (moderationTestRegistryRef.current.activeRouteIds.has(routeId)) {
      return null;
    }

    const version = moderationTestRegistryRef.current.begin(routeId);
    if (version === null) return null;
    setTestingModerationRouteIds(
      new Set(moderationTestRegistryRef.current.activeRouteIds)
    );
    setModerationTestResults((current) => {
      const next = { ...current };
      delete next[routeId];
      return next;
    });
    return version;
  }

  function isCurrentModerationRouteTest(routeId: string, version: number): boolean {
    return moderationTestRegistryRef.current.isCurrent(routeId, version);
  }

  async function loadCoreAdminData(
    token: string,
    generation = beginAdminLoadGeneration()
  ): Promise<boolean> {
    const [overviewResponse, usersResponse, plansResponse, ordersResponse, usageLogsResponse, settingsResponse, auditLogsResponse, feedbacksResponse, linksResponse, providerAccountsResponse] =
      await Promise.all([
      fetch(apiUrl("/admin/overview"), {
        headers: authHeaders(token)
      }),
      fetch(apiUrl(buildAdminUsersPath(userFilters)), {
        headers: authHeaders(token)
      }),
      fetch(apiUrl("/admin/plans"), {
        headers: authHeaders(token)
      }),
      fetch(apiUrl(buildAdminOrdersPath(orderFilters)), {
        headers: authHeaders(token)
      }),
      fetch(apiUrl(buildAdminUsageLogsPath(usageFilters)), {
        headers: authHeaders(token)
      }),
      fetch(apiUrl("/admin/settings"), {
        headers: authHeaders(token)
      }),
      fetch(apiUrl("/admin/audit-logs?limit=50"), {
        headers: authHeaders(token)
      }),
      fetch(
        apiUrl(`/admin/feedbacks${
          showArchivedFeedback ? "?showArchived=true" : ""
        }`),
        {
        headers: authHeaders(token)
        }
      ),
      fetch(apiUrl("/admin/links"), {
        headers: authHeaders(token)
      }),
      fetch(apiUrl("/admin/provider-accounts"), {
        headers: authHeaders(token)
      }),
    ]);

    const coreResponses = [
      overviewResponse,
      usersResponse,
      plansResponse,
      ordersResponse,
      usageLogsResponse,
      settingsResponse,
      auditLogsResponse,
      feedbacksResponse,
      linksResponse,
      providerAccountsResponse
    ];
    if (coreResponses.some((response) => response.status === 401)) {
      handleAdminAccessFailure(generation, "unauthorized");
      return false;
    }
    if (coreResponses.some((response) => response.status === 403)) {
      handleAdminAccessFailure(generation, "forbidden");
      return false;
    }
    for (const response of coreResponses) {
      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }
    }

    const overviewData = normalizeAdminOverviewResponse(
      await overviewResponse.json()
    );
    const users = normalizeAdminListResponse(
      await usersResponse.json(),
      "users",
      normalizeAdminUser
    );
    const plans = normalizeAdminListResponse(
      await plansResponse.json(),
      "plans",
      normalizePlanSummary
    );
    const orderList = normalizeAdminOrderListResponse(
      await ordersResponse.json()
    );
    const usageLogs = normalizeAdminListResponse(
      await usageLogsResponse.json(),
      "usageLogs",
      normalizeUsageLog
    );
    const settings = normalizeAdminListResponse(
      await settingsResponse.json(),
      "settings",
      normalizeSiteSettingSummary
    );
    const auditLogs = normalizeAdminListResponse(
      await auditLogsResponse.json(),
      "logs",
      (entry: unknown) => entry as AdminAuditLogEntry
    );

    const feedbackData = normalizeAdminListResponse(
      await feedbacksResponse.json(),
      "feedbacks",
      (entry: unknown) => entry as FeedbackEntry
    );
    const linksData = normalizeAdminListResponse(
      await linksResponse.json(),
      "links",
      (entry: unknown) => entry as LinkEntry
    );
    const providerAccountsData = normalizeAdminListResponse(
      await providerAccountsResponse.json(),
      "providerAccounts",
      normalizeProviderAccount
    );

    if (!adminLoadAccessGuardRef.current.canCommit(generation)) {
      return false;
    }

    setOverview({
      ...overviewData,
      users,
      usageLogs
    });
    setAuditLogs(auditLogs);
    setFeedbacks(feedbackData);
    setLinks(linksData);
    setProviderAccounts(providerAccountsData);
    setProviderAccountInputs(
      Object.fromEntries(
        providerAccountsData.map((account) => [
          account.id,
          providerAccountToForm(account)
        ])
      )
    );
    setLinkDrafts(
      Object.fromEntries(linksData.map((link) => [link.id, linkToForm(link)]))
    );
    setPlans(plans);
    setOrders(orderList.orders);
    setReviewOrderCount(orderList.reviewOrderCount);
    setSettings(settings);
    setSettingsForm(settingsToForm(settings));
    setContactForm(settingsToContactForm(settings));
    setQuotaInputs(
      Object.fromEntries(
        users.map((user) => [
          user.id,
          String(user.remainingCredits)
        ])
      )
    );
    setPlanInputs(
      Object.fromEntries(plans.map((plan) => [plan.id, planToForm(plan)]))
    );
    setModelInputs(
      Object.fromEntries(
        overviewData.models.map((model) => [model.id, modelToForm(model)])
      )
    );
    setState("ready");
    return true;
  }

  async function loadModerationData(
    token: string,
    generation = beginAdminLoadGeneration()
  ): Promise<boolean> {
    const loadVersion = moderationLoadVersionRef.current + 1;
    moderationLoadVersionRef.current = loadVersion;
    invalidateModerationTests();
    setModerationLoadState("loading");
    setModerationLoadError(null);
    try {
      const response = await fetch(apiUrl("/admin/moderation"), {
        headers: authHeaders(token)
      });
      if (response.status === 401) {
        handleAdminAccessFailure(generation, "unauthorized");
        return false;
      }
      if (response.status === 403) {
        handleAdminAccessFailure(generation, "forbidden");
        return false;
      }
      if (!response.ok) {
        throw new Error(t("admin.contentSafetyLoadFailed"));
      }
      const nextSettings = normalizeAdminModerationResponse(
        await response.json()
      );
      if (
        moderationLoadVersionRef.current !== loadVersion ||
        !adminLoadAccessGuardRef.current.canCommit(generation)
      ) {
        return false;
      }
      setModerationSettings(nextSettings);
      setModerationLoadState("ready");
      setModerationLoadError(null);
      return true;
    } catch {
      if (
        moderationLoadVersionRef.current !== loadVersion ||
        !adminLoadAccessGuardRef.current.canCommit(generation)
      ) {
        return false;
      }
      setModerationLoadState("error");
      setModerationLoadError(t("admin.contentSafetyLoadFailed"));
      return false;
    }
  }

  async function reloadModerationData() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return false;
    }

    await loadModerationData(token);
  }

  async function loadCircuitBreakerData(
    token: string,
    generation = beginAdminLoadGeneration()
  ): Promise<boolean> {
    const loadVersion = circuitBreakerLoadVersionRef.current + 1;
    circuitBreakerLoadVersionRef.current = loadVersion;
    setCircuitBreakerLoadState("loading");
    setCircuitBreakerLoadError(null);
    try {
      const response = await fetch(apiUrl("/admin/moderation/circuit-breaker"), {
        headers: authHeaders(token)
      });
      if (response.status === 401) {
        handleAdminAccessFailure(generation, "unauthorized");
        return false;
      }
      if (response.status === 403) {
        handleAdminAccessFailure(generation, "forbidden");
        return false;
      }
      if (!response.ok) {
        throw new Error(t("admin.circuitBreakerLoadFailed"));
      }
      const nextStatus = normalizeModerationCircuitBreakerStatus(
        await response.json()
      );
      if (
        circuitBreakerLoadVersionRef.current !== loadVersion ||
        !adminLoadAccessGuardRef.current.canCommit(generation)
      ) {
        return false;
      }
      setCircuitBreakerStatus(nextStatus);
      setCircuitBreakerLoadState("ready");
      setCircuitBreakerLoadError(null);
      return true;
    } catch {
      if (
        circuitBreakerLoadVersionRef.current !== loadVersion ||
        !adminLoadAccessGuardRef.current.canCommit(generation)
      ) {
        return false;
      }
      setCircuitBreakerLoadState("error");
      setCircuitBreakerLoadError(t("admin.circuitBreakerLoadFailed"));
      return false;
    }
  }

  async function reloadCircuitBreakerData() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return false;
    }
    return loadCircuitBreakerData(token);
  }

  async function refreshAfterProviderAccountMutation(token: string) {
    const generation = beginAdminLoadGeneration();
    const refreshed = await refreshAdminDataAfterProviderMutation(
      () => loadCoreAdminData(token, generation),
      () => loadModerationData(token, generation)
    );
    void loadCircuitBreakerData(token, generation);

    if (!refreshed) {
      showToast("error", t("admin.providerAccountSavedRefreshFailed"));
    }
    return refreshed;
  }

  function applyProviderAccountLocally(account: AiProviderAccountSummary) {
    setProviderAccounts((current) => {
      const exists = current.some((item) => item.id === account.id);
      return exists
        ? current.map((item) => (item.id === account.id ? account : item))
        : [...current, account];
    });
    setProviderAccountInputs((current) => ({
      ...current,
      [account.id]: providerAccountToForm(account)
    }));
    invalidateProviderAccountTest(account.id);
  }

  useEffect(() => {
    if (!hasValidAdminSection) {
      return;
    }
    const adminToken = getToken();

    if (!adminToken) {
      router.replace("/login");
      return;
    }

    async function run(verifiedAdminToken: string) {
      const generation = beginAdminLoadGeneration();
      void loadModerationData(verifiedAdminToken, generation);
      void loadCircuitBreakerData(verifiedAdminToken, generation);
      try {
        await loadCoreAdminData(verifiedAdminToken, generation);
      } catch (loadError) {
        if (!adminLoadAccessGuardRef.current.canCommit(generation)) {
          return;
        }
        showToast('error',
          loadError instanceof Error ? loadError.message : t("admin.loadFailed")
        );
        setState("error");
      }
    }

    void run(adminToken);
  }, [
    adminToken,
    hasValidAdminSection,
    orderFilters,
    router,
    showArchivedFeedback,
    t,
    usageFilters,
    userFilters
  ]);

  async function updateQuota(user: AdminUserSummary) {
    const token = getToken();
    const remainingCredits = Number(quotaInputs[user.id]);

    if (!token) {
      router.replace("/login");
      return false;
    }

    if (!Number.isInteger(remainingCredits) || remainingCredits < 0) {
      showToast('error', t("admin.invalidCredits"));
      return;
    }

    setSavingUserId(user.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(
        apiUrl(`/admin/users/${user.id}/quota`),
        {
          method: "PATCH",
          headers: {
            ...authHeaders(token),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ remainingCredits })
        }
      );

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const updated = (await response.json()) as {
        userId: string;
        remainingCredits: number;
      };

      setOverview((current) =>
        current
          ? {
              ...current,
              users: asArray<AdminUserSummary>(current.users).map((currentUser) =>
                currentUser.id === updated.userId
                  ? {
                      ...currentUser,
                      remainingCredits: updated.remainingCredits
                    }
                  : currentUser
              )
            }
          : current
      );
      setQuotaInputs((current) => ({
        ...current,
        [updated.userId]: String(updated.remainingCredits)
      }));
      showToast('success', t("admin.creditsUpdated"));
    } catch (updateError) {
      showToast('error',
        updateError instanceof Error
          ? updateError.message
          : t("admin.updateCreditsFailed")
      );
    } finally {
      setSavingUserId(null);
    }
  }

  async function updateModel(model: AdminAiModelSummary) {
    const token = getToken();
    const form = modelInputs[model.id];
    const input = form ? parseModelForm(form) : null;

    if (!token) {
      router.replace("/login");
      return;
    }

    if (!input) {
      showToast('error', t("admin.invalidModel"));
      return;
    }

    setSavingModelId(model.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/models/${model.id}`), {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      await response.json();
      if (shouldReloadAdminOverviewAfterModelUpdate()) {
        await loadCoreAdminData(token);
      }
      showToast('success', t("admin.modelUpdated"));
    } catch (updateError) {
      showToast('error',
        updateError instanceof Error
          ? updateError.message
          : t("admin.updateModelFailed")
      );
    } finally {
      setSavingModelId(null);
    }
  }

  async function createModel(): Promise<AdminAiModelSummary | null> {
    const token = getToken();
    const input = parseModelForm(newModel);

    if (!token) {
      router.replace("/login");
      return null;
    }

    if (!input) {
      showToast('error', t("admin.invalidModel"));
      return null;
    }

    setCreatingModel(true);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl("/admin/models"), {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { model: unknown };
      const createdModel = normalizeAdminOverviewResponse({
        models: [data.model]
      }).models[0];

      if (!createdModel) {
        throw new Error(t("admin.createModelFailed"));
      }

      setOverview((current) =>
        current
          ? {
              ...current,
              models: [
                ...asArray<AdminAiModelSummary>(current.models),
                createdModel
              ]
            }
          : current
      );
      setModelInputs((current) => ({
        ...current,
        [createdModel.id]: modelToForm(createdModel)
      }));
      setNewModel(emptyModelForm);
      showToast('success', t("admin.modelCreated"));
      return createdModel;
    } catch (createError) {
      showToast('error',
        createError instanceof Error
          ? createError.message
          : t("admin.createModelFailed")
      );
      return null;
    } finally {
      setCreatingModel(false);
    }
  }

  async function createModelRoute(model: AdminAiModelSummary) {
    const token = getToken();
    const form = modelRouteInputs[model.id] ?? {
      ...emptyModelRouteForm,
      providerAccountId: providerAccounts[0]?.id ?? ""
    };
    const input = parseModelRouteForm(model, form);

    if (!token) {
      router.replace("/login");
      return;
    }

    if (!input) {
      showToast("error", t("admin.invalidModelRoute"));
      return;
    }

    setSavingModelRouteId(`new:${model.id}`);

    try {
      const response = await fetch(apiUrl("/admin/model-routes"), {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      await loadCoreAdminData(token);
      setModelRouteInputs((current) => ({
        ...current,
        [model.id]: {
          ...emptyModelRouteForm,
          providerAccountId: form.providerAccountId
        }
      }));
      showToast("success", t("admin.modelRouteCreated"));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : t("admin.createModelRouteFailed")
      );
    } finally {
      setSavingModelRouteId(null);
    }
  }

  async function updateModelRoute(
    model: AdminAiModelSummary,
    route: AiModelRouteSummary,
    patch: Partial<Pick<AiModelRouteSummary, "providerId" | "upstreamModel" | "priority" | "enabled">>
  ) {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    setSavingModelRouteId(route.id);

    try {
      const response = await fetch(apiUrl(`/admin/model-routes/${route.id}`), {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      await loadCoreAdminData(token);
      showToast("success", t("admin.modelRouteUpdated"));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : t("admin.updateModelRouteFailed")
      );
    } finally {
      setSavingModelRouteId(null);
    }
  }

  async function disableModelRoute(
    model: AdminAiModelSummary,
    route: AiModelRouteSummary
  ) {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    setSavingModelRouteId(route.id);

    try {
      const response = await fetch(apiUrl(`/admin/model-routes/${route.id}`), {
        method: "DELETE",
        headers: authHeaders(token)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      await loadCoreAdminData(token);
      showToast("success", t("admin.modelRouteDisabled"));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : t("admin.disableModelRouteFailed")
      );
    } finally {
      setSavingModelRouteId(null);
    }
  }

  async function createProviderAccount(): Promise<boolean> {
    const token = getToken();
    const input = parseProviderAccountForm(newProviderAccount);

    if (!token) {
      router.replace("/login");
      return false;
    }

    if (!input) {
      showToast('error', t("admin.invalidProviderAccount"));
      return false;
    }

    setCreatingProviderAccount(true);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl("/admin/provider-accounts"), {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const created = readOptionalProviderAccount(
        await response.json().catch(() => null)
      );
      if (created) {
        applyProviderAccountLocally(created);
      }
      invalidateModerationTests();
      setNewProviderAccount(emptyProviderAccountForm);
      showToast('success', t("admin.providerAccountCreated"));
      void refreshAfterProviderAccountMutation(token);
      return true;
    } catch (createError) {
      showToast('error',
        createError instanceof Error
          ? createError.message
          : t("admin.createProviderAccountFailed")
      );
      return false;
    } finally {
      setCreatingProviderAccount(false);
    }
  }

  async function testProviderAccountConnection(
    target:
      | { kind: "new"; form: ProviderAccountFormState }
      | {
          kind: "saved";
          account: AiProviderAccountSummary;
          form: ProviderAccountFormState;
        }
  ) {
    const token = getToken();
    const resultKey = target.kind === "new" ? "new" : target.account.id;
    const payload = parseProviderAccountTestPayload(
      target.form,
      target.kind === "saved" ? target.account.id : undefined
    );

    if (!token) {
      router.replace("/login");
      return;
    }

    if (!payload) {
      setProviderAccountTestResults((current) => ({
        ...current,
        [resultKey]: {
          status: "error",
          message: t("admin.invalidProviderAccount")
        }
      }));
      return;
    }

    const generation = nextProviderAccountTestGeneration(resultKey);

    if (target.kind === "new") {
      setTestingNewProviderAccount(true);
    } else {
      setTestingProviderAccountId(target.account.id);
    }
    setProviderAccountTestResults((current) => ({
      ...current,
      [resultKey]: undefined
    }));

    try {
      const response = await fetch(apiUrl("/admin/provider-accounts/test"), {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = (await response.json()) as {
        ok?: boolean;
        message?: string;
        code?: string;
        errorCode?: string;
        capability?: ProviderAccountTestResult["capability"];
        imageTransport?: ProviderAccountTestResult["imageTransport"];
        model?: string;
        latencyMs?: number;
        requestFormat?: ProviderAccountTestResult["requestFormat"];
        authMode?: ProviderAccountTestResult["authMode"];
        endpointPath?: string;
        statusCode?: number;
      } | null;

      if (!isCurrentProviderAccountTest(resultKey, generation)) {
        return;
      }

      if (!response.ok || data?.ok !== true) {
        setProviderAccountTestResults((current) => ({
          ...current,
          [resultKey]: {
            status: "error",
            message:
              typeof data?.message === "string"
                ? data.message
                : t("admin.providerAccountTestFailed"),
            capability:
              data?.capability === "chat" || data?.capability === "image"
                ? data.capability
                : undefined,
            imageTransport:
              data?.imageTransport === "openai-images" ||
              data?.imageTransport === "legacy-extra-body-v1"
                ? data.imageTransport
                : undefined,
            errorCode:
              typeof data?.errorCode === "string"
                ? data.errorCode
                : typeof data?.code === "string"
                  ? data.code
                  : undefined,
            model: typeof data?.model === "string" ? data.model : undefined,
            latencyMs:
              typeof data?.latencyMs === "number" ? data.latencyMs : undefined,
            requestFormat:
              typeof data?.requestFormat === "string"
                ? data.requestFormat
                : undefined,
            authMode:
              typeof data?.authMode === "string" ? data.authMode : undefined,
            endpointPath:
              typeof data?.endpointPath === "string"
                ? data.endpointPath
                : undefined,
            statusCode:
              typeof data?.statusCode === "number" ? data.statusCode : undefined
          }
        }));
        return;
      }

      setProviderAccountTestResults((current) => ({
        ...current,
        [resultKey]: {
          status: "success",
          message:
            typeof data?.message === "string"
              ? data.message
            : t("admin.providerAccountTestSuccess"),
          capability:
            data?.capability === "chat" || data?.capability === "image"
              ? data.capability
              : undefined,
          imageTransport:
            data?.imageTransport === "openai-images" ||
            data?.imageTransport === "legacy-extra-body-v1"
              ? data.imageTransport
              : undefined,
          errorCode:
            typeof data?.errorCode === "string"
              ? data.errorCode
              : typeof data?.code === "string"
                ? data.code
                : undefined,
          model: typeof data?.model === "string" ? data.model : undefined,
          latencyMs:
            typeof data?.latencyMs === "number" ? data.latencyMs : undefined,
          requestFormat:
            typeof data?.requestFormat === "string"
              ? data.requestFormat
              : undefined,
          authMode:
            typeof data?.authMode === "string" ? data.authMode : undefined,
          endpointPath:
            typeof data?.endpointPath === "string"
              ? data.endpointPath
              : undefined,
          statusCode:
            typeof data?.statusCode === "number" ? data.statusCode : undefined
        }
      }));
    } catch (testError) {
      if (!isCurrentProviderAccountTest(resultKey, generation)) {
        return;
      }
      setProviderAccountTestResults((current) => ({
        ...current,
        [resultKey]: {
          status: "error",
          message:
            testError instanceof Error
              ? testError.message
              : t("admin.providerAccountTestFailed")
        }
      }));
    } finally {
      if (!isCurrentProviderAccountTest(resultKey, generation)) {
        return;
      }
      if (target.kind === "new") {
        setTestingNewProviderAccount(false);
      } else {
        setTestingProviderAccountId(null);
      }
    }
  }

  async function updateProviderAccount(
    account: AiProviderAccountSummary
  ): Promise<boolean> {
    const token = getToken();
    const form = providerAccountInputs[account.id];
    const moderationReferenceInfo = getModerationReferenceInfo(
      moderationSettings,
      account.id
    );
    const currentModerationEnabled = isProviderModerationDeclared(account);

    if (
      form &&
      !canChangeProviderModerationEnabled(
        currentModerationEnabled,
        form.moderationEnabled === true,
        moderationReferenceInfo
      )
    ) {
      showToast(
        "error",
        !moderationReferenceInfo.known
          ? t("admin.providerModerationReferencesUnknown")
          : t("admin.providerModerationReferenced", {
              count: moderationReferenceInfo.count
            })
      );
      return false;
    }

    const input = form
      ? parseProviderAccountForm(form, moderationReferenceInfo)
      : null;

    if (!token) {
      router.replace("/login");
      return false;
    }

    if (!input) {
      showToast('error', t("admin.invalidProviderAccount"));
      return false;
    }

    invalidateProviderAccountTest(account.id);
    setSavingProviderAccountId(account.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/provider-accounts/${account.id}`), {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const updated = readOptionalProviderAccount(
        await response.json().catch(() => null)
      );
      if (updated) {
        applyProviderAccountLocally(updated);
      }
      invalidateModerationTests();
      showToast('success', t("admin.providerAccountUpdated"));
      void refreshAfterProviderAccountMutation(token);
      return true;
    } catch (updateError) {
      showToast('error',
        updateError instanceof Error
          ? updateError.message
          : t("admin.updateProviderAccountFailed")
      );
      return false;
    } finally {
      setSavingProviderAccountId(null);
    }
  }

  async function disableProviderAccount(
    account: AiProviderAccountSummary
  ): Promise<boolean> {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return false;
    }

    invalidateProviderAccountTest(account.id);
    setSavingProviderAccountId(account.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/provider-accounts/${account.id}`), {
        method: "DELETE",
        headers: authHeaders(token)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const disabled = readOptionalProviderAccount(
        await response.json().catch(() => null)
      );
      if (disabled) {
        applyProviderAccountLocally(disabled);
      } else {
        applyProviderAccountLocally({ ...account, enabled: false });
      }
      invalidateModerationTests();
      showToast('success', t("admin.providerAccountDisabled"));
      void refreshAfterProviderAccountMutation(token);
      return true;
    } catch (disableError) {
      showToast('error',
        disableError instanceof Error
          ? disableError.message
          : t("admin.disableProviderAccountFailed")
      );
      return false;
    } finally {
      setSavingProviderAccountId(null);
    }
  }

  async function updateModerationEnabled(enabled: boolean): Promise<boolean> {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return false;
    }

    if (enabled) {
      const coverage = getModerationCoverage(moderationSettings?.routes ?? []);
      if (!coverage.text || !coverage.image) {
        showToast(
          "error",
          !coverage.text && !coverage.image
            ? t("admin.moderationCoverageMissingBoth")
            : !coverage.text
              ? t("admin.moderationCoverageMissingText")
              : t("admin.moderationCoverageMissingImage")
        );
        return false;
      }
    }

    setSavingModerationSettings(true);
    try {
      const response = await fetch(apiUrl("/admin/moderation/settings"), {
        method: "PUT",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ enabled })
      });
      if (!response.ok) throw new Error(await readJsonError(response));
      const nextSettings = normalizeAdminModerationResponse(
        await response.json()
      );
      invalidateModerationTests();
      setModerationSettings(nextSettings);
      setModerationLoadState("ready");
      setModerationLoadError(null);
      showToast("success", t("admin.moderationSettingsSaved"));
      void loadCircuitBreakerData(token);
      return true;
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : t("admin.updateModerationSettingsFailed")
      );
      return false;
    } finally {
      setSavingModerationSettings(false);
    }
  }

  async function saveCircuitBreakerSettings(
    settings: ModerationCircuitBreakerSettings
  ): Promise<boolean> {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return false;
    }
    if (savingCircuitBreakerSettings || resettingCircuitBreaker) return false;

    const generation = beginAdminLoadGeneration();
    const requestVersion = circuitBreakerLoadVersionRef.current + 1;
    circuitBreakerLoadVersionRef.current = requestVersion;
    setSavingCircuitBreakerSettings(true);
    try {
      const response = await fetch(
        apiUrl("/admin/moderation/circuit-breaker/settings"),
        buildModerationCircuitBreakerSettingsRequestInit(token, settings)
      );
      if (response.status === 401) {
        handleAdminAccessFailure(generation, "unauthorized");
        return false;
      }
      if (response.status === 403) {
        handleAdminAccessFailure(generation, "forbidden");
        return false;
      }
      if (!response.ok) {
        throw new Error(t("admin.circuitBreakerSaveFailed"));
      }
      const nextStatus = normalizeModerationCircuitBreakerStatus(
        await response.json()
      );
      if (!adminLoadAccessGuardRef.current.canCommit(generation)) return false;
      setCircuitBreakerStatus(nextStatus);
      setCircuitBreakerLoadState("ready");
      setCircuitBreakerLoadError(null);
      showToast("success", t("admin.circuitBreakerSaveSuccess"));
      return true;
    } catch {
      showToast("error", t("admin.circuitBreakerSaveFailed"));
      return false;
    } finally {
      setSavingCircuitBreakerSettings(false);
    }
  }

  async function resetCircuitBreaker(): Promise<boolean> {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return false;
    }
    if (resettingCircuitBreaker || savingCircuitBreakerSettings) return false;

    const generation = beginAdminLoadGeneration();
    const requestVersion = circuitBreakerLoadVersionRef.current + 1;
    circuitBreakerLoadVersionRef.current = requestVersion;
    setResettingCircuitBreaker(true);
    try {
      const response = await fetch(
        apiUrl("/admin/moderation/circuit-breaker/reset"),
        buildModerationCircuitBreakerResetRequestInit(token)
      );
      if (response.status === 401) {
        handleAdminAccessFailure(generation, "unauthorized");
        return false;
      }
      if (response.status === 403) {
        handleAdminAccessFailure(generation, "forbidden");
        return false;
      }
      if (!response.ok) {
        throw new Error(t("admin.circuitBreakerResetFailed"));
      }
      const nextStatus = normalizeModerationCircuitBreakerStatus(
        await response.json()
      );
      if (!adminLoadAccessGuardRef.current.canCommit(generation)) return false;
      setCircuitBreakerStatus(nextStatus);
      setCircuitBreakerLoadState("ready");
      setCircuitBreakerLoadError(null);
      showToast("success", t("admin.circuitBreakerResetSuccess"));
      return true;
    } catch {
      showToast("error", t("admin.circuitBreakerResetFailed"));
      return false;
    } finally {
      setResettingCircuitBreaker(false);
    }
  }

  async function createModerationRoute(input: ModerationRouteInput): Promise<boolean> {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return false;
    }
    setSavingModerationRouteId("new");
    try {
      const response = await fetch(apiUrl("/admin/moderation/routes"), {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });
      if (!response.ok) throw new Error(await readJsonError(response));
      const nextSettings = normalizeAdminModerationResponse(
        await response.json()
      );
      invalidateModerationTests();
      setModerationSettings(nextSettings);
      showToast("success", t("admin.moderationRouteCreated"));
      void loadCircuitBreakerData(token);
      return true;
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : t("admin.createModerationRouteFailed")
      );
      return false;
    } finally {
      setSavingModerationRouteId(null);
    }
  }

  async function updateModerationRoute(
    routeId: string,
    input: ModerationRouteInput
  ): Promise<boolean> {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return false;
    }
    setSavingModerationRouteId(routeId);
    try {
      const response = await fetch(
        apiUrl(`/admin/moderation/routes/${routeId}`),
        {
          method: "PUT",
          headers: {
            ...authHeaders(token),
            "Content-Type": "application/json"
          },
          body: JSON.stringify(input)
        }
      );
      if (!response.ok) throw new Error(await readJsonError(response));
      const nextSettings = normalizeAdminModerationResponse(
        await response.json()
      );
      invalidateModerationTests([routeId]);
      setModerationSettings(nextSettings);
      showToast("success", t("admin.moderationRouteUpdated"));
      void loadCircuitBreakerData(token);
      return true;
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : t("admin.updateModerationRouteFailed")
      );
      return false;
    } finally {
      setSavingModerationRouteId(null);
    }
  }

  async function deleteModerationRoute(routeId: string): Promise<boolean> {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return false;
    }

    if (
      !tryAcquireModerationRouteDeleteLock(
        deletingModerationRouteIdsRef.current,
        routeId
      )
    ) {
      return false;
    }
    setDeletingModerationRouteId(routeId);
    try {
      const response = await fetch(
        apiUrl(`/admin/moderation/routes/${routeId}`),
        {
          method: "DELETE",
          headers: authHeaders(token)
        }
      );
      if (!response.ok) throw new Error(await readJsonError(response));
      const nextSettings = normalizeAdminModerationResponse(
        await response.json()
      );
      invalidateModerationTests([routeId]);
      setModerationSettings(nextSettings);
      showToast("success", t("admin.moderationRouteDeleted"));
      void loadCircuitBreakerData(token);
      return true;
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : t("admin.deleteModerationRouteFailed")
      );
      return false;
    } finally {
      setDeletingModerationRouteId(null);
      deletingModerationRouteIdsRef.current.delete(routeId);
    }
  }

  async function testModerationRoute(routeId: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    const version = beginModerationRouteTest(routeId);
    if (version === null) return;
    try {
      const response = await fetch(
        apiUrl(`/admin/moderation/routes/${routeId}/test`),
        buildModerationRouteTestRequestInit(token)
      );
      if (!response.ok) throw new Error(t("admin.moderationTestFailed"));
      const result = normalizeModerationTestResponseForRoute(
        await response.json(),
        routeId
      );
      if (isCurrentModerationRouteTest(routeId, version)) {
        setModerationTestResults((current) => ({
          ...current,
          [routeId]: result
        }));
      }
    } catch (error) {
      if (isCurrentModerationRouteTest(routeId, version)) {
        showToast(
          "error",
          t("admin.moderationTestFailed")
        );
      }
    } finally {
      if (isCurrentModerationRouteTest(routeId, version)) {
        moderationTestRegistryRef.current.finish(routeId, version);
        setTestingModerationRouteIds(
          new Set(moderationTestRegistryRef.current.activeRouteIds)
        );
      }
    }
  }

  async function disableModel(model: AdminAiModelSummary) {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    setSavingModelId(model.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/models/${model.id}/disable`), {
        method: "POST",
        headers: authHeaders(token)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { model: unknown };
      const disabledModel = normalizeAdminOverviewResponse({
        models: [data.model]
      }).models[0];

      if (!disabledModel) {
        throw new Error(t("admin.deleteModelFailed"));
      }

      setOverview((current) =>
        current
          ? {
              ...current,
              models: asArray<AdminAiModelSummary>(current.models).map((currentModel) =>
                currentModel.id === disabledModel.id ? disabledModel : currentModel
              )
            }
          : current
      );
      setModelInputs((current) => ({
        ...current,
        [disabledModel.id]: modelToForm(disabledModel)
      }));
      showToast('success', t("admin.modelDisabled"));
    } catch (deleteError) {
      showToast('error',
        deleteError instanceof Error
          ? deleteError.message
          : t("admin.deleteModelFailed")
      );
    } finally {
      setSavingModelId(null);
    }
  }

  async function deleteModel(model: AdminAiModelSummary) {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    setSavingModelId(model.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/models/${model.id}`), {
        method: "DELETE",
        headers: authHeaders(token)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      setOverview((current) =>
        current
          ? {
              ...current,
              models: asArray<AdminAiModelSummary>(current.models).filter(
                (m) => m.id !== model.id
              )
            }
          : current
      );
      setModelInputs((current) => {
        const next = { ...current };
        delete next[model.id];
        return next;
      });
      showToast('success', t("admin.modelDeleted"));
    } catch (deleteErr) {
      showToast('error',
        deleteErr instanceof Error
          ? deleteErr.message
          : t("admin.deleteModelFailed")
      );
    } finally {
      setSavingModelId(null);
    }
  }

  async function copyModelId(modelId: string) {
    try {
      await navigator.clipboard.writeText(modelId);
      showToast('success', t("admin.modelIdCopied"));
      /* toast self-dismisses */;
    } catch {
      /* toast self-dismisses */
    }
  }

  async function createPlan() {
    const token = getToken();
    const input = parsePlanForm(newPlan);

    if (!token) {
      router.replace("/login");
      return;
    }

    if (!input) {
      showToast('error', t("admin.invalidPlan"));
      return;
    }

    setCreatingPlan(true);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl("/admin/plans"), {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { plan: unknown };
      const plan = normalizePlanSummary(data.plan);
      setPlans((current) => [...asArray<PlanSummary>(current), plan]);
      setPlanInputs((current) => ({
        ...current,
        [plan.id]: planToForm(plan)
      }));
      setNewPlan(emptyPlanForm);
      showToast('success', t("admin.planCreated"));
    } catch (createError) {
      showToast('error',
        createError instanceof Error
          ? createError.message
          : t("admin.createPlanFailed")
      );
    } finally {
      setCreatingPlan(false);
    }
  }

  async function updatePlan(plan: PlanSummary) {
    const token = getToken();
    const form = planInputs[plan.id];
    const input = form ? parsePlanForm(form) : null;

    if (!token) {
      router.replace("/login");
      return;
    }

    if (!input) {
      showToast('error', t("admin.invalidPlan"));
      return;
    }

    setSavingPlanId(plan.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/plans/${plan.id}`), {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { plan: unknown };
      const updatedPlan = normalizePlanSummary(data.plan);
      setPlans((current) =>
        asArray<PlanSummary>(current).map((currentPlan) =>
          currentPlan.id === updatedPlan.id ? updatedPlan : currentPlan
        )
      );
      setPlanInputs((current) => ({
        ...current,
        [updatedPlan.id]: planToForm(updatedPlan)
      }));
      showToast('success', t("admin.planUpdated"));
    } catch (updateError) {
      showToast('error',
        updateError instanceof Error
          ? updateError.message
          : t("admin.updatePlanFailed")
      );
    } finally {
      setSavingPlanId(null);
    }
  }

  async function updateOrderStatus(order: AdminOrderSummary, status: OrderStatus) {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    setSavingOrderId(order.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(
        apiUrl(`/admin/orders/${order.id}/status`),
        {
          method: "PATCH",
          headers: {
            ...authHeaders(token),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status })
        }
      );

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { order: unknown };
      const updatedOrder = normalizeAdminOrderSummary(data.order);
      setOrders((current) =>
        asArray<AdminOrderSummary>(current).map((currentOrder) =>
          currentOrder.id === updatedOrder.id ? updatedOrder : currentOrder
        )
      );
      await loadCoreAdminData(token);
      showToast(
        "success",
        status === "PAID" ? t("admin.orderPaid") : t("admin.orderCancelled")
      );
    } catch (updateError) {
      showToast('error',
        updateError instanceof Error
          ? updateError.message
          : t("admin.updateOrderFailed")
      );
    } finally {
      setSavingOrderId(null);
    }
  }

  async function updateSettings() {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    if (!isValidHomeFeatureCards(settingsForm.homeFeatureCards)) {
      showToast('error', t("admin.homeFeatureCardsInvalid"));
      return;
    }

    if (!isValidWorkspacePromptCards(settingsForm.workspacePromptCards)) {
      showToast('error', t("admin.workspacePromptCardsInvalid"));
      return;
    }

    if (!isValidImagePromptCards(settingsForm.imagePromptCards)) {
      showToast('error', t("admin.imagePromptCardsInvalid"));
      return;
    }

    if (!isValidHelpContentJson(settingsForm.helpContentJson)) {
      showToast('error', t("admin.helpContentJsonInvalid"));
      return;
    }

    if (!isValidFooterLinksJson(settingsForm.footerLinksJson)) {
      showToast('error', t("admin.footerLinksJsonInvalid"));
      return;
    }

    if (!isValidRegistrationSettings(settingsForm)) {
      showToast("error", "安全与注册配置无效，请检查域名、策略模式和提示长度。");
      return;
    }

    if (!isValidGuestRateLimitSettings(settingsForm)) {
      showToast("error", t("admin.guestRateLimit.invalid"));
      return;
    }

    if (!isValidProfileRateLimitSettings(settingsForm)) {
      showToast("error", t("admin.profileRateLimit.invalid"));
      return;
    }

    if (!isValidReferenceImageRateLimitSettings(settingsForm)) {
      showToast("error", t("admin.referenceImageRateLimit.invalid"));
      return;
    }

    if (!isValidConcurrencySettings(settingsForm)) {
      showToast("error", t("admin.concurrency.invalid"));
      return;
    }

    if (!isValidTitleCoverVisualBriefSettings(settingsForm)) {
      showToast("error", t("admin.titleCoverVisualBrief.invalid"));
      return;
    }

    const accountBenefitNumbers = [
      settingsForm.storagePackagePriceCredits,
      settingsForm.checkInDailyRewardCredits,
      settingsForm.referralInviterRewardCredits,
      settingsForm.referralInviteeRewardCredits
    ].map(Number);
    const storageDurationDays = Number(settingsForm.storagePackageDurationDays);
    if (
      accountBenefitNumbers.some((value) => !Number.isInteger(value) || value < 0) ||
      !Number.isInteger(storageDurationDays) ||
      storageDurationDays <= 0 ||
      !isValidCheckInStreakRewards(settingsForm.checkInStreakRewards ?? "{}")
    ) {
      showToast('error', "账户与增长配置无效，请检查额度、有效天数和连续奖励 JSON。");
      return;
    }

    if (settingsForm.siteName.trim().length === 0) {
      showToast('error', t("admin.invalidSettings"));
      return;
    }

    setSavingSettings(true);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl("/admin/settings"), {
        ...buildAdminSettingsRequestInit(token, settingsForm)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const settings = normalizeAdminListResponse(
        await response.json(),
        "settings",
        normalizeSiteSettingSummary
      );

      setSettings((current) => {
        const merged = new Map(
          asArray<SiteSettingSummary>(current).map((setting) => [
            setting.key,
            setting
          ])
        );

        for (const setting of settings) {
          merged.set(setting.key, setting);
        }

        return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
      });
      showToast('success', t("admin.settingsSaved"));
    } catch (updateError) {
      showToast('error',
        updateError instanceof Error
          ? updateError.message
          : t("admin.updateSettingsFailed")
      );
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveContactSettings() {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    const validLinks = contactForm.contactExternalLinks.filter(
      (link) => link.label.trim().length > 0 && link.url.trim().length > 0
    );

    if (validLinks.length > 6) {
      showToast('error', t("admin.tooManyContactLinks"));
      return;
    }

    setSavingContact(true);

    try {
      const response = await fetch(apiUrl("/admin/settings"), {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          settings: contactFormToPayload({
            ...contactForm,
            contactExternalLinks: validLinks
          })
        })
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const settings = normalizeAdminListResponse(
        await response.json(),
        "settings",
        normalizeSiteSettingSummary
      );

      setSettings((current) => {
        const merged = new Map(
          asArray<SiteSettingSummary>(current).map((setting) => [
            setting.key,
            setting
          ])
        );

        for (const setting of settings) {
          merged.set(setting.key, setting);
        }

        return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
      });
      const savedContactForm = settingsToContactForm(settings);
      setContactForm(savedContactForm);
      setSettingsForm((current) => ({
        ...current,
        contactEmail: savedContactForm.contactEmail
      }));
      showToast('success', t("admin.contactSettingsSaved"));
    } catch (updateError) {
      showToast('error',
        updateError instanceof Error
          ? updateError.message
          : t("admin.updateContactSettingsFailed")
      );
    } finally {
      setSavingContact(false);
    }
  }

  function sortedLinks(nextLinks: LinkEntry[]) {
    return [...nextLinks].sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }

      return a.sortOrder - b.sortOrder;
    });
  }

  function updateLinkDraft(
    linkId: string,
    updates: Partial<LinkFormState>
  ) {
    setLinkDrafts((current) => {
      const link = links.find((entry) => entry.id === linkId);
      const existing = current[linkId] ?? (link ? linkToForm(link) : emptyLinkForm);

      return {
        ...current,
        [linkId]: {
          ...existing,
          ...updates
        }
      };
    });
  }

  async function createLink() {
    const token = getToken();
    const input = parseLinkForm(newLink);

    if (!token || !input) {
      return;
    }

    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl("/admin/links"), {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { link: LinkEntry };
      setLinks((current) => sortedLinks([...asArray<LinkEntry>(current), data.link]));
      setLinkDrafts((current) => ({
        ...current,
        [data.link.id]: linkToForm(data.link)
      }));
      setNewLink(emptyLinkForm);
      showToast('success', t("admin.addLink"));
    } catch (createError) {
      showToast('error',
        createError instanceof Error
          ? createError.message
          : t("admin.updateLink")
      );
    }
  }

  async function saveLink(link: LinkEntry) {
    const token = getToken();
    const input = parseLinkForm(linkDrafts[link.id] ?? linkToForm(link));

    if (!token || !input) {
      return;
    }

    setSavingLinkId(link.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/links/${link.id}`), {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { link: LinkEntry };
      setLinks((current) =>
        sortedLinks(
          asArray<LinkEntry>(current).map((entry) =>
            entry.id === data.link.id ? data.link : entry
          )
        )
      );
      setLinkDrafts((current) => ({
        ...current,
        [data.link.id]: linkToForm(data.link)
      }));
      showToast('success', t("admin.updateLink"));
    } catch (updateError) {
      showToast('error',
        updateError instanceof Error
          ? updateError.message
          : t("admin.updateLink")
      );
    } finally {
      setSavingLinkId(null);
    }
  }

  async function toggleLinkEnabled(link: LinkEntry) {
    const token = getToken();

    if (!token) {
      return;
    }

    setSavingLinkId(link.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/links/${link.id}`), {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          enabled: !link.enabled
        })
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { link: LinkEntry };
      setLinks((current) =>
        sortedLinks(
          asArray<LinkEntry>(current).map((entry) =>
            entry.id === data.link.id ? data.link : entry
          )
        )
      );
      setLinkDrafts((current) => ({
        ...current,
        [data.link.id]: linkToForm(data.link)
      }));
      showToast(
        "success",
        data.link.enabled ? t("admin.enabled") : t("admin.disabled")
      );
    } catch (toggleError) {
      showToast('error',
        toggleError instanceof Error
          ? toggleError.message
          : t("admin.updateLink")
      );
    } finally {
      setSavingLinkId(null);
    }
  }

  async function deleteLink(link: LinkEntry) {
    const token = getToken();

    if (!token || !window.confirm(t("admin.confirmDeleteLink"))) {
      return;
    }

    setSavingLinkId(link.id);
    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(apiUrl(`/admin/links/${link.id}`), {
        method: "DELETE",
        headers: authHeaders(token)
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      setLinks((current) =>
        asArray<LinkEntry>(current).filter((entry) => entry.id !== link.id)
      );
      setLinkDrafts((current) => {
        const next = { ...current };
        delete next[link.id];
        return next;
      });
      showToast('success', t("admin.linkDeleted"));
    } catch (deleteError) {
      showToast('error',
        deleteError instanceof Error
          ? deleteError.message
          : t("admin.deleteLink")
      );
    } finally {
      setSavingLinkId(null);
    }
  }

  async function archiveFeedback(feedback: FeedbackEntry) {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    /* toast self-dismisses */;
    /* toast self-dismisses */

    try {
      const response = await fetch(
        apiUrl(`/admin/feedbacks/${feedback.id}/archive`),
        {
          method: "POST",
          headers: authHeaders(token)
        }
      );

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const data = (await response.json()) as { feedback: FeedbackEntry };
      setFeedbacks((current) => {
        if (showArchivedFeedback) {
          return asArray<FeedbackEntry>(current).map((currentFeedback) =>
            currentFeedback.id === data.feedback.id
              ? data.feedback
              : currentFeedback
          );
        }

        return asArray<FeedbackEntry>(current).filter(
          (currentFeedback) => currentFeedback.id !== data.feedback.id
        );
      });
      await loadCoreAdminData(token);
      showToast('success', t("admin.feedbackArchived"));
    } catch (archiveError) {
      showToast('error',
        archiveError instanceof Error
          ? archiveError.message
          : t("admin.archiveFeedbackFailed")
      );
    }
  }

  if (!activeSection) {
    return null;
  }

  if (state === "loading") {
    return activeSectionDefinition ? (
      <PageState
        title={t(activeSectionDefinition.labelKey)}
        description={t(activeSectionDefinition.descriptionKey)}
        status={t("admin.loading")}
      />
    ) : (
      <PageState title={t("admin.title")} description={t("admin.loading")} />
    );
  }

  if (state === "forbidden") {
    return (
      <PageState
        title={t("admin.accessDenied")}
        description={t("admin.accessDeniedDetail")}
      />
    );
  }

  if (!overview) {
    return (
      <PageState
        title={t("admin.loadFailed")}
        description={t("admin.tryAgain")}
        tone="danger"
      />
    );
  }

  const safeOverview = normalizeAdminOverviewResponse(overview);
  const safePlans = asArray<PlanSummary>(plans);
  const safeOrders = asArray<AdminOrderSummary>(orders);
  const safeSettings = asArray<SiteSettingSummary>(settings);
  const usageModelOptions = safeOverview.models.map((model) => ({
    modelId: model.modelId,
    label: model.displayName?.trim() || model.name
  }));
  const activeGroup = activeSectionDefinition?.sidebar?.groupId
    ? getAdminNavigationGroup(activeSectionDefinition.sidebar.groupId)
    : null;
  const pageTitle = t(activeSectionDefinition?.labelKey ?? "admin.title");
  const pageDescription = t(
    activeSectionDefinition?.descriptionKey ?? "admin.description"
  );

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-950">
      <AdminToastContainer
        toasts={toasts}
        dismissLabel={t("admin.dismissMessage")}
        onDismiss={dismissToast}
      />
      <div className="flex min-h-[100dvh]">
        <div className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-0 h-[100dvh]">
            <AdminSidebar />
          </div>
        </div>

        <div
          className={
            sidebarOpen
              ? "fixed inset-0 z-40 bg-slate-950/35 opacity-100 transition lg:hidden"
              : "pointer-events-none fixed inset-0 z-40 bg-slate-950/35 opacity-0 transition lg:hidden"
          }
          aria-hidden={!sidebarOpen}
          onClick={() => setSidebarOpen(false)}
        />
        <div
          className={
            sidebarOpen
              ? "fixed left-0 top-0 z-50 h-[100dvh] w-[min(18rem,88vw)] translate-x-0 shadow-xl transition-transform lg:hidden"
              : "fixed left-0 top-0 z-50 h-[100dvh] w-[min(18rem,88vw)] -translate-x-full shadow-xl transition-transform lg:hidden"
          }
          aria-hidden={!sidebarOpen}
          id="admin-mobile-sidebar"
        >
          <AdminSidebar onNavigate={() => setSidebarOpen(false)} />
        </div>

        <main className="min-w-0 flex-1">
          <div
            className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden"
            data-admin-mobile-header="true"
          >
            <button
              type="button"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
              aria-label={t("workspace.menu")}
              aria-expanded={sidebarOpen}
              aria-controls="admin-mobile-sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <Settings className="size-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[11px] font-semibold tracking-wide text-slate-500"
                data-admin-mobile-page-group="true"
              >
                {activeGroup ? t(activeGroup.labelKey) : t("admin.title")}
              </div>
              <div
                className="truncate text-sm font-semibold tracking-tight text-slate-950"
                data-admin-mobile-page-title="true"
              >
                {pageTitle}
              </div>
            </div>
          </div>

          <AdminPageShell>
            <AdminPageHeader
              eyebrow={activeGroup ? t(activeGroup.labelKey) : t("admin.title")}
              title={pageTitle}
              description={pageDescription}
            />

      {activeSection === "overview" ? (
        <AdminOperationsOverview overview={safeOverview} />
      ) : null}

      {activeSection === "settings" ? (
        <div className="grid gap-4">
          <AdminSettingsAreaNavigation activeArea={activeSettingsArea} />
          <AdminSettingsSection
            activeArea={activeSettingsArea}
            form={settingsForm}
            models={safeOverview.models}
            providerAccounts={providerAccounts}
            saving={savingSettings}
            settings={safeSettings}
            onChange={(updates) =>
              setSettingsForm((current) => ({
                ...current,
                ...updates
              }))
            }
            onSave={() => void updateSettings()}
          />
        </div>
      ) : null}

      {activeSection === "payments" ? (
        <AdminPaymentSettings token={adminToken} />
      ) : null}

      {activeSection === "contact" ? (
        <AdminContactSettings
          form={contactForm}
          saving={savingContact}
          onChange={(updates) =>
            setContactForm((current) => ({
              ...current,
              ...updates
            }))
          }
          onSave={() => void saveContactSettings()}
        />
      ) : null}

      {activeSection === "providerAccounts" ? (
        <AdminProviderAccountsSection
            accounts={providerAccounts}
            newAccount={newProviderAccount}
            accountInputs={providerAccountInputs}
            creatingAccount={creatingProviderAccount}
            savingAccountId={savingProviderAccountId}
            testingNewAccount={testingNewProviderAccount}
            testingAccountId={testingProviderAccountId}
            testResults={providerAccountTestResults}
            moderationRoutes={moderationSettings?.routes ?? []}
            moderationReferenceDataAvailable={moderationSettings !== null}
            inputClass={inputClass}
            checkboxClass={checkboxClass}
            primaryButtonClass={primaryButtonClass}
            iconButtonClass={iconButtonClass}
            toggleInlineClass={toggleInlineClass}
            onNewAccountChange={(form) => {
              setNewProviderAccount(form);
              invalidateProviderAccountTest("new");
            }}
            onAccountInputChange={(id, form) => {
              setProviderAccountInputs((current) => ({
                ...current,
                [id]: form
              }));
              invalidateProviderAccountTest(id);
            }}
            onCreateAccount={createProviderAccount}
            onUpdateAccount={updateProviderAccount}
            onDisableAccount={(account) => void disableProviderAccount(account)}
            onTestNewAccount={() =>
              void testProviderAccountConnection({
                kind: "new",
                form: newProviderAccount
              })
            }
            onTestAccount={(account) =>
              void testProviderAccountConnection({
                kind: "saved",
                account,
                form:
                  providerAccountInputs[account.id] ?? providerAccountToForm(account)
              })
            }
        />
      ) : null}

      {activeSection === "moderation" ? (
        <AdminModerationSection
            settings={moderationSettings}
            loadState={moderationLoadState}
            loadError={moderationLoadError}
            accounts={providerAccounts}
            testResults={moderationTestResults}
            testingRouteIds={testingModerationRouteIds}
            savingSettings={savingModerationSettings}
            savingRouteId={savingModerationRouteId}
            deletingRouteId={deletingModerationRouteId}
            circuitBreakerStatus={circuitBreakerStatus}
            circuitBreakerLoadState={circuitBreakerLoadState}
            circuitBreakerLoadError={circuitBreakerLoadError}
            savingCircuitBreakerSettings={savingCircuitBreakerSettings}
            resettingCircuitBreaker={resettingCircuitBreaker}
            inputClass={inputClass}
            checkboxClass={checkboxClass}
            primaryButtonClass={primaryButtonClass}
            iconButtonClass={iconButtonClass}
            toggleInlineClass={toggleInlineClass}
            onReload={() => void reloadModerationData()}
            onToggleEnabled={updateModerationEnabled}
            onCreateRoute={createModerationRoute}
            onUpdateRoute={updateModerationRoute}
            onDeleteRoute={deleteModerationRoute}
            onTestRoute={(routeId) => void testModerationRoute(routeId)}
            onReloadCircuitBreaker={() => void reloadCircuitBreakerData()}
            onSaveCircuitBreakerSettings={saveCircuitBreakerSettings}
            onResetCircuitBreaker={resetCircuitBreaker}
        />
      ) : null}

      {activeSection === "users" ? (
      <AdminSection>
        <AdminSectionHeader title={t("admin.userManagement")} />
        <AdminUsersFilters
          value={userFilters}
          onChange={setUserFilters}
          onReset={() => setUserFilters(defaultAdminUsersFilters)}
        />
        <AdminDataTable className="bg-white">
          <table
            className="w-full min-w-[520px] text-left text-sm lg:min-w-[760px]"
            data-admin-data-surface="users"
          >
            <thead className="bg-slate-50">
              <tr>
                <AdminTableHeadCell>{t("admin.email")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">
                  {t("admin.role")}
                </AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.remainingCredits")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">
                  {t("admin.created")}
                </AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.action")}</AdminTableHeadCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {safeOverview.users.length === 0 ? (
                <AdminTableEmptyRow colSpan={5}>
                  {hasActiveUsersFilters(userFilters)
                    ? t("admin.noFilteredUsers")
                    : t("admin.noData")}
                </AdminTableEmptyRow>
              ) : (
                safeOverview.users.map((user) => (
                <tr key={user.id} className={tableRowClass} data-admin-table-row="true">
                  <AdminTableCell className="font-semibold text-slate-950">
                    {user.email}
                  </AdminTableCell>
                  <AdminTableCell priority="secondary">
                    <AdminStatusBadge tone={user.role === "ADMIN" ? "indigo" : "slate"}>
                      {getUserRoleLabel(user.role, locale)}
                    </AdminStatusBadge>
                  </AdminTableCell>
                  <AdminTableCell>
                    <input
                      className={`${inputClass} w-32`}
                      min={0}
                      type="number"
                      aria-label={`${t("admin.adjustCredits")} ${user.email}`}
                      value={quotaInputs[user.id] ?? ""}
                      onChange={(event) =>
                        setQuotaInputs((current) => ({
                          ...current,
                          [user.id]: event.target.value
                        }))
                      }
                    />
                  </AdminTableCell>
                  <AdminTableCell priority="secondary" className="text-slate-500">
                    {formatDate(user.createdAt)}
                  </AdminTableCell>
                  <AdminTableCell>
                    <button
                      className={`${primaryButtonClass} min-h-9`}
                      type="button"
                      disabled={savingUserId === user.id}
                      onClick={() => void updateQuota(user)}
                    >
                      <Save className="size-3.5" aria-hidden="true" />
                      {savingUserId === user.id
                        ? t("admin.saving")
                        : t("admin.saveCredits")}
                    </button>
                  </AdminTableCell>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminDataTable>
      </AdminSection>
      ) : null}

      {activeSection === "plans" ? (
      <AdminSection>
        <AdminSectionHeader title={t("admin.planManagement")} />
        <div className="grid gap-4 border-b border-slate-200 bg-slate-50/60 p-5 md:grid-cols-[1fr_120px_120px_96px_auto]">
          <input
            className={inputClass}
            placeholder={t("admin.planName")}
            value={newPlan.name}
            onChange={(event) =>
              setNewPlan((current) => ({ ...current, name: event.target.value }))
            }
          />
          <input
            className={inputClass}
            placeholder={t("pricing.price")}
            type="number"
            value={newPlan.price}
            onChange={(event) =>
              setNewPlan((current) => ({ ...current, price: event.target.value }))
            }
          />
          <input
            className={inputClass}
            placeholder={t("pricing.credits")}
            type="number"
            value={newPlan.credits}
            onChange={(event) =>
              setNewPlan((current) => ({
                ...current,
                credits: event.target.value
              }))
            }
          />
          <input
            className={inputClass}
            placeholder={t("admin.sort")}
            type="number"
            value={newPlan.sortOrder}
            onChange={(event) =>
              setNewPlan((current) => ({
                ...current,
                sortOrder: event.target.value
              }))
            }
          />
          <button
            className={primaryButtonClass}
            type="button"
            disabled={creatingPlan}
            onClick={() => void createPlan()}
          >
            <Save className="size-3.5" aria-hidden="true" />
            {creatingPlan ? t("admin.creating") : t("admin.createPlan")}
          </button>
          <textarea
            className={`${inputClass} md:col-span-2`}
            placeholder={t("admin.descriptionField")}
            rows={2}
            value={newPlan.description}
            onChange={(event) =>
              setNewPlan((current) => ({
                ...current,
                description: event.target.value
              }))
            }
          />
          <textarea
            className={`${inputClass} md:col-span-2`}
            placeholder={t("admin.featuresField")}
            rows={2}
            value={newPlan.featuresText}
            onChange={(event) =>
              setNewPlan((current) => ({
                ...current,
                featuresText: event.target.value
              }))
            }
          />
          <label className={toggleInlineClass}>
            <input
              checked={newPlan.enabled}
              className={checkboxClass}
              type="checkbox"
              onChange={(event) =>
                setNewPlan((current) => ({
                  ...current,
                  enabled: event.target.checked
                }))
              }
            />
            {t("admin.enabled")}
          </label>
        </div>
        <div className="grid gap-4 p-5">
          {safePlans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              {t("pricing.noPlans")}
            </div>
          ) : (
            safePlans.map((plan) => {
            const form = planInputs[plan.id] ?? planToForm(plan);

            return (
              <div
                key={plan.id}
                className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm lg:grid-cols-[1.2fr_110px_110px_90px_120px_auto]"
              >
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(event) =>
                    setPlanInputs((current) => ({
                      ...current,
                      [plan.id]: { ...form, name: event.target.value }
                    }))
                  }
                />
                <input
                  className={inputClass}
                  type="number"
                  value={form.price}
                  onChange={(event) =>
                    setPlanInputs((current) => ({
                      ...current,
                      [plan.id]: { ...form, price: event.target.value }
                    }))
                  }
                />
                <input
                  className={inputClass}
                  type="number"
                  value={form.credits}
                  onChange={(event) =>
                    setPlanInputs((current) => ({
                      ...current,
                      [plan.id]: { ...form, credits: event.target.value }
                    }))
                  }
                />
                <input
                  className={inputClass}
                  type="number"
                  value={form.sortOrder}
                  onChange={(event) =>
                    setPlanInputs((current) => ({
                      ...current,
                      [plan.id]: { ...form, sortOrder: event.target.value }
                    }))
                  }
                />
                <label className={toggleInlineClass}>
                  <input
                    checked={form.enabled}
                    className={checkboxClass}
                    type="checkbox"
                    onChange={(event) =>
                      setPlanInputs((current) => ({
                        ...current,
                        [plan.id]: { ...form, enabled: event.target.checked }
                      }))
                    }
                  />
                  {form.enabled ? t("admin.enabled") : t("admin.disabled")}
                </label>
                <button
                  className={primaryButtonClass}
                  type="button"
                  disabled={savingPlanId === plan.id}
                  onClick={() => void updatePlan(plan)}
                >
                  <Save className="size-3.5" aria-hidden="true" />
                  {savingPlanId === plan.id
                    ? t("admin.saving")
                    : t("admin.updatePlan")}
                </button>
                <textarea
                  className={`${inputClass} lg:col-span-3`}
                  rows={2}
                  value={form.description}
                  onChange={(event) =>
                    setPlanInputs((current) => ({
                      ...current,
                      [plan.id]: { ...form, description: event.target.value }
                    }))
                  }
                />
                <textarea
                  className={`${inputClass} lg:col-span-3`}
                  rows={2}
                  value={form.featuresText}
                  onChange={(event) =>
                    setPlanInputs((current) => ({
                      ...current,
                      [plan.id]: { ...form, featuresText: event.target.value }
                    }))
                  }
                />
              </div>
            );
            })
          )}
        </div>
      </AdminSection>
      ) : null}

      {activeSection === "orders" ? (
      <AdminSection>
        <AdminSectionHeader title={t("admin.orderManagement")} />
        <AdminOrdersFilters
          value={orderFilters}
          reviewOrderCount={reviewOrderCount}
          onChange={setOrderFilters}
          onReset={() => setOrderFilters(defaultAdminOrdersFilters)}
        />
        <AdminDataTable className="bg-white">
          <table
            className="w-full min-w-[680px] text-left text-sm lg:min-w-[1200px]"
            data-admin-data-surface="orders"
          >
            <thead className="bg-slate-50">
              <tr>
                <AdminTableHeadCell>{t("admin.user")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("pricing.plan")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.amount")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">
                  {t("pricing.credits")}
                </AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.orderStatus")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">
                  {t("payment.provider")}
                </AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">
                  {t("payment.tradeNo")}
                </AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">
                  {t("admin.providerTradeNo")}
                </AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">
                  {t("admin.created")}
                </AdminTableHeadCell>
                <AdminTableHeadCell priority="tertiary">
                  {t("admin.paid")}
                </AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.action")}</AdminTableHeadCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {safeOrders.length === 0 ? (
                <AdminTableEmptyRow colSpan={11}>
                  {hasActiveOrdersFilters(orderFilters)
                    ? t("admin.noFilteredOrders")
                    : t("admin.noOrders")}
                </AdminTableEmptyRow>
              ) : (
                safeOrders.map((order) => {
                  const isExpanded = expandedOrderIds.has(order.id);
                  const tradeNoKey = `trade_${order.id}`;
                  const providerTradeNoKey = `provider_${order.id}`;

                  return (
                    <React.Fragment key={order.id}>
                      <tr
                        className={
                          order.reviewAttempts.length > 0
                            ? `${tableRowClass} bg-amber-100/60`
                            : order.status === "PENDING"
                              ? `${tableRowClass} bg-amber-50/40`
                              : tableRowClass
                        }
                        data-admin-table-row="true"
                      >
                        <AdminTableCell
                          className="max-w-[160px] font-semibold text-slate-950"
                          title={order.userEmail}
                        >
                          <span className="block truncate">
                            {order.userEmail}
                          </span>
                        </AdminTableCell>
                        <AdminTableCell className="whitespace-nowrap">
                          {order.planName}
                        </AdminTableCell>
                        <AdminTableCell className="whitespace-nowrap">
                          {formatPrice(order.amount, t("pricing.free"))}
                        </AdminTableCell>
                        <AdminTableCell priority="secondary" className="whitespace-nowrap">
                          {formatAdminNumber(order.credits)}
                        </AdminTableCell>
                        <AdminTableCell className="whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={order.status}>
                              {getOrderStatusLabel(order.status, locale)}
                            </StatusBadge>
                            {order.reviewAttempts.length > 0 ? (
                              <AdminPaymentReviewBadge />
                            ) : null}
                          </div>
                        </AdminTableCell>
                        <AdminTableCell priority="secondary" className="text-xs whitespace-nowrap">
                          {order.paymentProvider || order.paymentType ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                              {getOrderPaymentMethodLabel(
                                order.paymentType,
                                order.paymentProvider,
                                paymentMethodLabels
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </AdminTableCell>
                        <AdminTableCell priority="tertiary" className="max-w-[150px]">
                          {order.paymentTradeNo ? (
                            <div className="flex items-center gap-1">
                              <span
                                className="truncate font-mono text-xs text-slate-600"
                                title={order.paymentTradeNo}
                              >
                                {order.paymentTradeNo}
                              </span>
                              <button
                                type="button"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                                title={t("admin.copy")}
                                onClick={() =>
                                  copyToClipboard(
                                    order.paymentTradeNo!,
                                    tradeNoKey
                                  )
                                }
                              >
                                {copiedField === tradeNoKey ? (
                                  <span className="text-[10px] font-medium text-emerald-600">
                                    ✓
                                  </span>
                                ) : (
                                  <Copy className="size-3" aria-hidden="true" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </AdminTableCell>
                        <AdminTableCell priority="tertiary" className="max-w-[150px]">
                          {order.providerTradeNo ? (
                            <div className="flex items-center gap-1">
                              <span
                                className="truncate font-mono text-xs text-slate-600"
                                title={order.providerTradeNo}
                              >
                                {order.providerTradeNo}
                              </span>
                              <button
                                type="button"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                                title={t("admin.copy")}
                                onClick={() =>
                                  copyToClipboard(
                                    order.providerTradeNo!,
                                    providerTradeNoKey
                                  )
                                }
                              >
                                {copiedField === providerTradeNoKey ? (
                                  <span className="text-[10px] font-medium text-emerald-600">
                                    ✓
                                  </span>
                                ) : (
                                  <Copy className="size-3" aria-hidden="true" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </AdminTableCell>
                        <AdminTableCell priority="tertiary" className="text-slate-500 whitespace-nowrap">
                          {formatDate(order.createdAt)}
                        </AdminTableCell>
                        <AdminTableCell priority="tertiary" className="text-slate-500 whitespace-nowrap">
                          {formatDate(order.paidAt)}
                        </AdminTableCell>
                        <AdminTableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            {order.status === "PENDING" &&
                            order.reviewAttempts.length === 0 ? (
                              <>
                                <button
                                  className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:bg-emerald-300"
                                  type="button"
                                  disabled={savingOrderId === order.id}
                                  onClick={() =>
                                    void updateOrderStatus(order, "PAID")
                                  }
                                >
                                  <CheckCircle2
                                    className="mr-1.5 size-3.5"
                                    aria-hidden="true"
                                  />
                                  {t("admin.confirmPaid")}
                                </button>
                                <button
                                  className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:text-rose-300"
                                  type="button"
                                  disabled={savingOrderId === order.id}
                                  onClick={() =>
                                    void updateOrderStatus(
                                      order,
                                      "CANCELLED"
                                    )
                                  }
                                >
                                  <XCircle
                                    className="mr-1.5 size-3.5"
                                    aria-hidden="true"
                                  />
                                  {t("admin.cancelOrder")}
                                </button>
                              </>
                            ) : (
                              <span className="text-xs font-medium text-slate-400">
                                {t("admin.noAction")}
                              </span>
                            )}
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
                              onClick={() => toggleOrderExpanded(order.id)}
                            >
                              {isExpanded
                                ? t("admin.hideDetails")
                                : t("admin.details")}
                            </button>
                          </div>
                        </AdminTableCell>
                      </tr>
                      {isExpanded ? (
                        <tr className="bg-slate-50/60">
                          <td colSpan={11} className="px-4 py-3">
                            <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("admin.orderId")}:
                                </span>{" "}
                                <span className="font-mono text-slate-600">
                                  {order.id}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("admin.user")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {order.userEmail}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("pricing.plan")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {order.planName}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("admin.amount")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {formatPrice(
                                    order.amount,
                                    t("pricing.free")
                                  )}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("pricing.credits")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {formatAdminNumber(order.credits)}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("admin.orderStatus")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {getOrderStatusLabel(
                                    order.status,
                                    locale
                                  )}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("payment.gateway")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {order.paymentProvider ?? "-"}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("payment.provider")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {getOrderPaymentMethodLabel(
                                    order.paymentType,
                                    order.paymentProvider,
                                    paymentMethodLabels
                                  )}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("payment.tradeNo")}:
                                </span>{" "}
                                <span className="font-mono text-slate-600 break-all">
                                  {order.paymentTradeNo ?? "-"}
                                </span>
                                {order.paymentTradeNo ? (
                                  <button
                                    type="button"
                                    className="ml-1 inline-flex size-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 align-text-bottom"
                                    title={t("admin.copy")}
                                    onClick={() =>
                                      copyToClipboard(
                                        order.paymentTradeNo!,
                                        `detail_${tradeNoKey}`
                                      )
                                    }
                                  >
                                    {copiedField ===
                                    `detail_${tradeNoKey}` ? (
                                      <span className="text-[10px] font-medium text-emerald-600">
                                        ✓
                                      </span>
                                    ) : (
                                      <Copy
                                        className="size-3"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </button>
                                ) : null}
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("admin.providerTradeNo")}:
                                </span>{" "}
                                <span className="font-mono text-slate-600 break-all">
                                  {order.providerTradeNo ?? "-"}
                                </span>
                                {order.providerTradeNo ? (
                                  <button
                                    type="button"
                                    className="ml-1 inline-flex size-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 align-text-bottom"
                                    title={t("admin.copy")}
                                    onClick={() =>
                                      copyToClipboard(
                                        order.providerTradeNo!,
                                        `detail_${providerTradeNoKey}`
                                      )
                                    }
                                  >
                                    {copiedField ===
                                    `detail_${providerTradeNoKey}` ? (
                                      <span className="text-[10px] font-medium text-emerald-600">
                                        ✓
                                      </span>
                                    ) : (
                                      <Copy
                                        className="size-3"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </button>
                                ) : null}
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("admin.created")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {formatDate(order.createdAt)}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-700">
                                  {t("admin.paid")}:
                                </span>{" "}
                                <span className="text-slate-600">
                                  {formatDate(order.paidAt)}
                                </span>
                              </div>
                              <AdminPaymentReviewDetails order={order} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </AdminDataTable>
      </AdminSection>
      ) : null}

      {activeSection === "storageSubscriptions" ? (
        <div className="grid gap-4">
          <AdminStorageOfferSettings
            form={settingsForm}
            saving={savingSettings}
            onChange={(updates) =>
              setSettingsForm((current) => ({
                ...current,
                ...updates
              }))
            }
            onSave={() => void updateSettings()}
          />
          <AdminSection>
            <AdminStorageSubscriptions />
          </AdminSection>
        </div>
      ) : null}

      {activeSection === "operations" ? (
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <AdminTitleCoverBudgetSettings
            form={settingsForm}
            saving={savingSettings}
            onChange={(updates) =>
              setSettingsForm((current) => ({
                ...current,
                ...updates
              }))
            }
            onSave={() => void updateSettings()}
          />
          <AdminOperationsDetails overview={safeOverview} />
          <div className="min-w-0 overflow-x-auto">
            <GeneratedAssetStorageInfo />
          </div>
        </div>
      ) : null}

      {activeSection === "models" ? (
        <AdminModelsSection
          checkboxClass={checkboxClass}
          creatingModel={creatingModel}
          emptyModelRouteForm={emptyModelRouteForm}
          iconButtonClass={iconButtonClass}
          inputClass={inputClass}
          modelCapabilityOptions={modelCapabilityOptions}
          modelInputs={modelInputs}
          modelProviders={modelProviders}
          modelRouteInputs={modelRouteInputs}
          models={safeOverview.models}
          newModel={newModel}
          primaryButtonClass={primaryButtonClass}
          providerAccounts={providerAccounts}
          savingModelId={savingModelId}
          savingModelRouteId={savingModelRouteId}
          toggleInlineClass={toggleInlineClass}
          onCopyModelId={(modelId) => void copyModelId(modelId)}
          onCreateModel={createModel}
          onCreateModelRoute={(model) => void createModelRoute(model)}
          onDeleteModel={(model) => void deleteModel(model)}
          onDisableModel={(model) => void disableModel(model)}
          onDisableModelRoute={(model, route) => void disableModelRoute(model, route)}
          onModelInputsChange={setModelInputs}
          onModelRouteInputsChange={setModelRouteInputs}
          onNewModelChange={setNewModel}
          onUpdateModel={(model) => void updateModel(model)}
          onUpdateModelRoute={(model, route, patch) =>
            void updateModelRoute(model, route, patch)
          }
        />
      ) : null}

      {activeSection === "audit" ? (
      <AdminSection>
        <AdminSectionHeader title={t("admin.auditLogs")} />
        <AdminDataTable className="bg-white">
          <table
            className="w-full min-w-[620px] text-left text-sm lg:min-w-[960px]"
            data-admin-data-surface="audit"
          >
            <thead className="bg-slate-50">
              <tr>
                <AdminTableHeadCell priority="secondary">
                  {t("admin.auditTime")}
                </AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.auditAdmin")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.auditAction")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">
                  {t("admin.auditTarget")}
                </AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.auditSummary")}</AdminTableHeadCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.length === 0 ? (
                <AdminTableEmptyRow colSpan={5}>{t("admin.noAuditLogs")}</AdminTableEmptyRow>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id} className={tableRowClass} data-admin-table-row="true">
                    <AdminTableCell priority="secondary" className="whitespace-nowrap text-slate-500">
                      {formatDate(log.createdAt)}
                    </AdminTableCell>
                    <AdminTableCell className="font-medium text-slate-700">
                      {log.adminEmail}
                    </AdminTableCell>
                    <AdminTableCell>
                      <AdminStatusBadge tone="indigo">
                        {getAuditActionLabel(log.action, t)}
                      </AdminStatusBadge>
                    </AdminTableCell>
                    <AdminTableCell priority="secondary" className="text-slate-500">
                      {log.targetType}
                      {log.targetId ? (
                        <span className="ml-1 font-mono text-xs text-slate-400">
                          ({log.targetId.slice(0, 12)}...)
                        </span>
                      ) : null}
                    </AdminTableCell>
                    <AdminTableCell className="max-w-xs truncate text-slate-700">
                      {log.summary}
                    </AdminTableCell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminDataTable>
      </AdminSection>
      ) : null}

      {activeSection === "feedback" ? (
      <AdminSection>
        <AdminSectionHeader title={t("admin.feedbackManagement")} />
        <div className="border-b border-slate-200 bg-slate-50/60 px-5 py-3">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              checked={showArchivedFeedback}
              className={checkboxClass}
              type="checkbox"
              onChange={(event) => setShowArchivedFeedback(event.target.checked)}
            />
            {t("admin.showArchivedFeedback")}
          </label>
        </div>
        <AdminScrollableRegion className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className={tableHeadClass}>
              <tr>
                <TableHead label={t("admin.auditTime")} />
                <TableHead label={t("admin.user")} />
                <TableHead label={t("admin.feedbackType")} />
                <TableHead label={t("admin.feedbackStatus")} />
                <TableHead label={t("admin.feedbackContent")} />
                <TableHead label={t("admin.feedbackScreenshot")} />
                <TableHead label={t("admin.action")} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {feedbacks.length === 0 ? (
                <EmptyRow colSpan={7} message={t("admin.noFeedbacks")} />
              ) : (
                feedbacks.map((fb) => (
                  <tr key={fb.id} className={tableRowClass}>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {formatDate(fb.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {fb.userEmail ?? fb.userId ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          fb.type === "problem"
                            ? "rose"
                            : fb.type === "feature"
                            ? "indigo"
                            : "slate"
                        }
                      >
                        {t(`feedback.type.${fb.type}` as never) || fb.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="grid gap-2">
                        <select
                          className={inputClass}
                          value={fb.status}
                          onChange={async (event) => {
                            const newStatus = event.target
                              .value as FeedbackStatus;
                            const token = getToken();
                            if (!token) {
                              router.replace("/login");
                              return;
                            }
                            try {
                              const response = await fetch(
                                apiUrl(`/admin/feedbacks/${fb.id}/status`),
                                {
                                  method: "PATCH",
                                  headers: {
                                    ...authHeaders(token),
                                    "Content-Type": "application/json"
                                  },
                                  body: JSON.stringify({ status: newStatus })
                                }
                              );
                              if (!response.ok) {
                                throw new Error(await readJsonError(response));
                              }
                              setFeedbacks((current) =>
                                asArray<FeedbackEntry>(current).map(
                                  (currentFb) =>
                                    currentFb.id === fb.id
                                      ? { ...currentFb, status: newStatus }
                                      : currentFb
                                )
                              );
                            } catch {
                              showToast('error', "Failed to update feedback status");
                            }
                          }}
                        >
                          {(
                            [
                              "OPEN",
                              "IN_PROGRESS",
                              "RESOLVED",
                              "CLOSED"
                            ] as FeedbackStatus[]
                          ).map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        {fb.archivedAt ? (
                          <Badge tone="slate">{t("admin.archivedFeedback")}</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-700">
                      {fb.content}
                    </td>
                    <td className="px-4 py-3">
                      {getSafeFeedbackScreenshotUrl(fb.screenshotUrl) ? (
                        <a
                          className="text-indigo-600 underline"
                          href={getSafeFeedbackScreenshotUrl(fb.screenshotUrl) ?? undefined}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {t("admin.feedbackScreenshot")}
                        </a>
                      ) : fb.screenshotUrl ? (
                        <span className="text-slate-400">
                          {t("admin.invalidFeedbackScreenshot")}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {fb.archivedAt ? (
                        <span className="text-xs font-medium text-slate-400">
                          {formatDate(fb.archivedAt)}
                        </span>
                      ) : (
                        <button
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
                          type="button"
                          onClick={() => void archiveFeedback(fb)}
                        >
                          {t("admin.archiveFeedback")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminScrollableRegion>
      </AdminSection>
      ) : null}

      {activeSection === "links" ? (
      <AdminSection>
        <AdminSectionHeader title={t("admin.linkManagement")} />
        <div className="grid gap-4 border-b border-slate-200 bg-slate-50/60 p-5 md:grid-cols-6">
          <input
            className={inputClass}
            placeholder={t("admin.linkTitle")}
            value={newLink.title}
            onChange={(event) =>
              setNewLink((current) => ({
                ...current,
                title: event.target.value
              }))
            }
          />
          <input
            className={inputClass}
            placeholder={t("admin.linkUrl")}
            value={newLink.url}
            onChange={(event) =>
              setNewLink((current) => ({
                ...current,
                url: event.target.value
              }))
            }
          />
          <input
            className={inputClass}
            placeholder={t("admin.linkDescription")}
            value={newLink.description}
            onChange={(event) =>
              setNewLink((current) => ({
                ...current,
                description: event.target.value
              }))
            }
          />
          <select
            className={inputClass}
            value={newLink.category}
            onChange={(event) =>
              setNewLink((current) => ({
                ...current,
                category: event.target.value
              }))
            }
          >
            {["footer", "friend", "api", "resource", "other"].map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder={t("admin.sort")}
            type="number"
            value={newLink.sortOrder}
            onChange={(event) =>
              setNewLink((current) => ({
                ...current,
                sortOrder: event.target.value
              }))
            }
          />
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
            <input
              checked={newLink.enabled}
              className="size-4 rounded border-slate-300 text-indigo-600"
              type="checkbox"
              onChange={(event) =>
                setNewLink((current) => ({
                  ...current,
                  enabled: event.target.checked
                }))
              }
            />
            {t("admin.enabled")}
          </label>
          <button
            className={primaryButtonClass}
            type="button"
            onClick={() => void createLink()}
          >
            <Save className="size-3.5" aria-hidden="true" />
            {t("admin.addLink")}
          </button>
        </div>
        <AdminScrollableRegion className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className={tableHeadClass}>
              <tr>
                <TableHead label={t("admin.linkTitle")} />
                <TableHead label={t("admin.linkUrl")} />
                <TableHead label={t("admin.linkCategory")} />
                <TableHead label={t("admin.linkDescription")} />
                <TableHead label={t("admin.enabled")} />
                <TableHead label={t("admin.sort")} />
                <TableHead label={t("admin.action")} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {links.length === 0 ? (
                <EmptyRow colSpan={7} message={t("admin.noLinks")} />
              ) : (
                links.map((link) => {
                  const draft = linkDrafts[link.id] ?? linkToForm(link);

                  return (
                  <tr key={link.id} className={tableRowClass}>
                    <td className="px-4 py-3">
                      <input
                        className={inputClass}
                        value={draft.title}
                        aria-label={`${t("admin.linkTitle")} ${link.title}`}
                        onChange={(event) =>
                          updateLinkDraft(link.id, {
                            title: event.target.value
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className={inputClass}
                        value={draft.url}
                        aria-label={`${t("admin.linkUrl")} ${link.title}`}
                        onChange={(event) =>
                          updateLinkDraft(link.id, {
                            url: event.target.value
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className={inputClass}
                        value={draft.category}
                        aria-label={`${t("admin.linkCategory")} ${link.title}`}
                        onChange={(event) =>
                          updateLinkDraft(link.id, {
                            category: event.target.value
                          })
                        }
                      >
                        {["footer", "friend", "api", "resource", "other"].map(
                          (cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          )
                        )}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className={inputClass}
                        value={draft.description}
                        aria-label={`${t("admin.linkDescription")} ${link.title}`}
                        onChange={(event) =>
                          updateLinkDraft(link.id, {
                            description: event.target.value
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 disabled:text-slate-400"
                        type="button"
                        disabled={savingLinkId === link.id}
                        onClick={() => void toggleLinkEnabled(link)}
                      >
                        {link.enabled
                          ? t("admin.disableLink")
                          : t("admin.enableLink")}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className={`${inputClass} w-24`}
                        type="number"
                        value={draft.sortOrder}
                        aria-label={`${t("admin.sort")} ${link.title}`}
                        onChange={(event) =>
                          updateLinkDraft(link.id, {
                            sortOrder: event.target.value
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={primaryButtonClass}
                          type="button"
                          disabled={savingLinkId === link.id}
                          onClick={() => void saveLink(link)}
                        >
                          <Save className="size-3.5" aria-hidden="true" />
                          {t("admin.updateLink")}
                        </button>
                        <button
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:text-rose-300"
                          type="button"
                          disabled={savingLinkId === link.id}
                          onClick={() => void deleteLink(link)}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          {t("admin.deleteLink")}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </AdminScrollableRegion>
      </AdminSection>
      ) : null}

      {activeSection === "usage" ? (
      <AdminSection>
        <AdminSectionHeader title={t("admin.recentCalls")} />
        <AdminUsageFilters
          models={usageModelOptions}
          value={usageFilters}
          onChange={setUsageFilters}
          onReset={() => setUsageFilters(defaultAdminUsageFilters)}
        />
        <AdminDataTable className="bg-white">
          <table
            className="w-full min-w-[520px] text-left text-sm lg:min-w-[860px]"
            data-admin-data-surface="usage"
          >
            <thead className="bg-slate-50">
              <tr>
                <AdminTableHeadCell priority="secondary">{t("admin.time")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.user")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.model")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.status")}</AdminTableHeadCell>
                <AdminTableHeadCell>{t("admin.cost")}</AdminTableHeadCell>
                <AdminTableHeadCell priority="secondary">{t("admin.error")}</AdminTableHeadCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {safeOverview.usageLogs.length === 0 ? (
                <AdminTableEmptyRow colSpan={6}>
                  {hasActiveUsageFilters(usageFilters)
                    ? t("admin.noFilteredUsageLogs")
                    : t("admin.noUsageLogs")}
                </AdminTableEmptyRow>
              ) : (
                safeOverview.usageLogs.map((log) => (
                  <tr key={log.id} className={tableRowClass} data-admin-table-row="true">
                    <AdminTableCell priority="secondary" className="text-slate-500">
                      {formatDate(log.createdAt)}
                    </AdminTableCell>
                    <AdminTableCell className="font-medium text-slate-700">
                      {log.userEmail ?? log.userId ?? t("admin.guest")}
                    </AdminTableCell>
                    <AdminTableCell className="font-semibold text-slate-950">
                      <div>{log.modelDisplayName ?? log.model}</div>
                      {log.modelDisplayName ? (
                        <div className="mt-1 max-w-[280px] truncate font-mono text-xs font-normal text-slate-500">
                          {log.model}
                        </div>
                      ) : null}
                    </AdminTableCell>
                    <AdminTableCell>
                      <AdminStatusBadge tone={log.status === "SUCCESS" ? "emerald" : "rose"}>
                        {getUsageLogStatusLabel(log.status, locale)}
                      </AdminStatusBadge>
                    </AdminTableCell>
                    <AdminTableCell>{log.costCredits}</AdminTableCell>
                    <AdminTableCell priority="secondary" className="max-w-xs truncate text-rose-700">
                      {log.status === "FAILED"
                        ? t("admin.safeFailureFallback")
                        : t("admin.notAvailable")}
                    </AdminTableCell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminDataTable>
      </AdminSection>
      ) : null}
        </AdminPageShell>
        </main>
      </div>
    </div>
  );
}

const inputClass =
  "min-h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100";
const checkboxClass = "size-4 rounded border-slate-300 text-indigo-600";
const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:bg-indigo-300 disabled:text-white/80";
const iconButtonClass =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700";
const tableHeadClass =
  "border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500";
const tableRowClass = "text-slate-700 transition hover:bg-slate-50/80";
const toggleInlineClass =
  "inline-flex min-h-10 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm";

function PageState({
  title,
  description,
  status,
  tone = "default"
}: {
  title: string;
  description: string;
  status?: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-16 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
        <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
        <p
          className={
            tone === "danger"
              ? "mt-3 text-sm leading-6 text-rose-700"
              : "mt-3 text-sm leading-6 text-slate-600"
          }
        >
          {description}
        </p>
        {status ? <p className="mt-2 text-xs font-medium text-slate-500">{status}</p> : null}
      </div>
    </div>
  );
}


function FieldHelp({ label, help }: { label: string; help: string }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold text-slate-700">{label}</div>
      <div>{help}</div>
    </div>
  );
}

function TableHead({ label }: { label: string }) {
  return <th className="px-4 py-3 font-semibold tracking-normal">{label}</th>;
}

function EmptyRow({
  colSpan,
  message
}: {
  colSpan: number;
  message: string;
}) {
  return (
    <tr>
      <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={colSpan}>
        {message}
      </td>
    </tr>
  );
}

function Badge({
  children,
  tone
}: {
  children: React.ReactNode;
  tone: "slate" | "indigo" | "emerald" | "amber" | "rose";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700"
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function StatusBadge({
  status,
  children
}: {
  status: OrderStatus;
  children: React.ReactNode;
}) {
  const tone =
    status === "PAID" ? "emerald" : status === "CANCELLED" ? "rose" : "amber";

  return <AdminStatusBadge tone={tone}>{children}</AdminStatusBadge>;
}
