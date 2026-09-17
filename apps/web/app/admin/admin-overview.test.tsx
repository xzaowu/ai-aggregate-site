// @vitest-environment jsdom

import {
  providerAccountTypes,
  type AdminOperationsOverview as AdminOperationsOverviewData,
  type AdminOverview,
  type SiteSettingSummary
} from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import type { Locale } from "../../lib/i18n/types";
import { authTokenKey, authUserKey } from "../../components/auth-state";
import AdminPage, {
  buildAdminSettingsRequestInit,
  parseModelForm,
  settingsToForm
} from "./admin-page-client";
import { AdminAuthProvider } from "./admin-auth-context";
import { getSafeFeedbackScreenshotUrl } from "./feedback-screenshot-url";
import { GeneratedAssetStorageInfo } from "./generated-asset-storage-info";
import {
  clearProviderAccountTestResult,
  getModelTestModelMismatchWarning,
  mergeProviderAccountConfigJson,
  parseProviderAccountTestPayload,
  providerAccountToForm,
  readProviderAccountTestModel,
  type ProviderAccountFormState
} from "./admin-provider-accounts-section";
import { AdminSidebar } from "./admin-sidebar";
import type { SettingsFormState } from "./admin-settings-section";
import { settingsFormToPayload } from "./admin-settings-validation";
import {
  AdminScrollableRegion,
  AdminSectionTabs,
  adminSections,
  defaultAdminSection
} from "./admin-sections";
import { getAdminSectionHref } from "./admin-navigation";
import { AdminToastContainer } from "./toast";
import {
  AdminOperationsDetails,
  AdminOperationsOverview
} from "./admin-operations-overview";
import {
  createAdminLoadAccessGuard,
  refreshAdminDataAfterProviderMutation
} from "./admin-safe-data";
import {
  AdminModelsSection,
  type ModelFormState
} from "./admin-models-section";
import type { ModelRouteFormState } from "./admin-model-routes-editor";
import {
  normalizeAdminOverviewResponse,
  normalizeAdminOperations,
  normalizeProviderAccount,
  shouldReloadAdminOverviewAfterModelUpdate
} from "./admin-safe-data";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const navigationState = { pathname: "/admin/overview" };
const adminRouter = { replace: vi.fn() };

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => adminRouter
}));

const overview: AdminOverview = {
  users: [],
  models: [],
  usageLogs: [],
  totals: {
    users: 12,
    usageSuccess: 30,
    usageFailed: 3
  },
  stats: {
    users: {
      total: 12,
      todayNew: 3,
      todayActive: 4,
      admins: 2,
      regularUsers: 10
    },
    guests: {
      todayCalls: 4,
      todayLimitExceeded: 0
    },
    usage: {
      todayCalls: 33,
      todaySuccess: 30,
      todayFailed: 3,
      todayCreditsUsed: 88,
      successRate: 30 / 33
    },
    orders: {
      total: 8,
      pending: 2,
      paid: 5,
      cancelled: 1,
      todayNew: 3,
      todayConfirmed: 2,
      todayPaid: 2,
      todayRevenueCents: 11800
    },
    quota: {
      remainingCreditsTotal: 1200,
      todayGrantedCredits: 500,
      todayUsedCredits: 88
    },
    last7Days: [
      {
        date: "2026-06-05",
        calls: 0,
        success: 0,
        failed: 0,
        creditsUsed: 0,
        guestCalls: 0
      },
      {
        date: "2026-06-06",
        calls: 2,
        success: 2,
        failed: 0,
        creditsUsed: 4,
        guestCalls: 1
      }
    ],
    guestLast7Days: [
      {
        date: "2026-06-05",
        calls: 0
      },
      {
        date: "2026-06-06",
        calls: 1
      }
    ],
    modelTopByCalls: [
      {
        model: "gpt-test",
        calls: 20,
        success: 19,
        failed: 1,
        creditsUsed: 40
      }
    ],
    modelTopByCredits: [
      {
        model: "expensive-test",
        calls: 10,
        success: 8,
        failed: 2,
        creditsUsed: 48
      }
    ],
    modelTopByFailures: [
      {
        model: "expensive-test",
        calls: 10,
        success: 8,
        failed: 2,
        creditsUsed: 48
      }
    ],
    models: [],
    modelUsageLast7Days: [],
    recentFailures: [],
    recentOrders: []
  }
};

const operations: AdminOperationsOverviewData = {
  recentTasks: [
    {
      taskId: "task_failed_1",
      userId: "user_1",
      type: "image",
      status: "failed",
      modelId: "image-model",
      modelLabel: "Image Model",
      providerLabel: "Provider A",
      routeId: "route_1",
      createdAt: "2026-07-25T10:00:00.000Z",
      updatedAt: "2026-07-25T10:01:00.000Z",
      safeErrorClass: "TASK_FAILED",
      chargeStatus: "RELEASED",
      creditReleaseStatus: "RELEASED",
      refundStatus: "UNKNOWN",
      costRecorded: false
    },
    {
      taskId: "task_charged_1",
      userId: "user_2",
      type: "image",
      status: "failed",
      modelId: "image-model-2",
      modelLabel: "Image Model 2",
      providerLabel: null,
      routeId: null,
      createdAt: "2026-07-25T11:00:00.000Z",
      updatedAt: "2026-07-25T11:01:00.000Z",
      safeErrorClass: "CHARGED_AND_FAILED",
      chargeStatus: "SETTLED",
      creditReleaseStatus: "NOT_RELEASED",
      refundStatus: "UNKNOWN",
      costRecorded: true
    }
  ],
  manualCompensations: [
    {
      auditId: "audit_plus",
      targetUserId: "user_plus",
      action: "UPDATE_USER_QUOTA",
      createdAt: "2026-07-25T12:00:00.000Z",
      creditChangeStatus: "RECORDED",
      creditDelta: 5
    },
    {
      auditId: "audit_minus",
      targetUserId: "user_minus",
      action: "UPDATE_USER_QUOTA",
      createdAt: "2026-07-25T12:01:00.000Z",
      creditChangeStatus: "RECORDED",
      creditDelta: -3
    },
    {
      auditId: "audit_zero",
      targetUserId: "user_zero",
      action: "UPDATE_USER_QUOTA",
      createdAt: "2026-07-25T12:02:00.000Z",
      creditChangeStatus: "RECORDED",
      creditDelta: 0
    },
    {
      auditId: "audit_unknown",
      targetUserId: "user_unknown",
      action: "UPDATE_USER_QUOTA",
      createdAt: "2026-07-25T12:03:00.000Z",
      creditChangeStatus: "UNKNOWN",
      creditDelta: null
    }
  ],
  budgets: [
    {
      scope: "image_generation",
      periodType: "DAILY",
      periodKey: "2026-07-25",
      limit: 100,
      used: 25,
      remaining: 75,
      status: "NORMAL",
      updatedAt: "2026-07-25T12:00:00.000Z"
    },
    {
      scope: "chat_completion",
      periodType: "DAILY",
      periodKey: "2026-07-25",
      limit: 100,
      used: 90,
      remaining: 10,
      status: "NEAR_LIMIT",
      updatedAt: "2026-07-25T12:00:00.000Z"
    },
    {
      scope: "admin_provider_test",
      periodType: "DAILY",
      periodKey: "2026-07-25",
      limit: 10,
      used: 10,
      remaining: 0,
      status: "EXHAUSTED",
      updatedAt: "2026-07-25T12:00:00.000Z"
    },
    {
      scope: "title_cover_visual_brief",
      periodType: "DAILY",
      periodKey: "2026-07-25",
      limit: 100,
      used: 2,
      remaining: 98,
      status: "NORMAL",
      updatedAt: "2026-07-25T12:00:00.000Z"
    }
  ]
};

const dataSurfaceUser = {
  id: "user_data_surface",
  email: "surface-user@example.com",
  role: "USER",
  remainingCredits: 42,
  createdAt: "2026-07-25T09:00:00.000Z",
  updatedAt: "2026-07-25T09:00:00.000Z"
};

const dataSurfaceModel = {
  id: "model_data_surface",
  name: "surface-model",
  displayName: "Surface Model",
  slug: "surface-model",
  provider: "SUB2API",
  providerAccountId: "provider_data_surface",
  capability: "chat",
  displaySurfaces: ["chat"],
  imageInvokeMode: "anthropic-messages",
  imageOutputParser: "markdown-data-url",
  maxReferenceImages: 0,
  modelId: "surface-real-model",
  group: "chat",
  tags: ["stable"],
  shortDescription: "Data surface fixture",
  enabled: true,
  creditCost: 2,
  allowGuest: true,
  sortOrder: 1,
  isRecommended: true,
  iconUrl: "",
  iconText: "SM",
  iconColor: "#2563eb",
  routes: [
    {
      id: "route_data_surface",
      modelId: "model_data_surface",
      providerId: "provider_data_surface",
      providerName: "Surface Provider",
      upstreamModel: "surface-upstream-model",
      priority: 1,
      enabled: true,
      createdAt: "2026-07-25T09:00:00.000Z",
      updatedAt: "2026-07-25T09:00:00.000Z"
    }
  ]
};

const dataSurfaceProviderAccount = {
  id: "provider_data_surface",
  name: "Surface Provider",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://provider.example/v1",
  capabilities: ["chat"],
  enabled: true,
  priority: 1,
  timeoutMs: 30000,
  configJson: { requestFormat: "openai-compatible", testModel: "surface-real-model" },
  notes: null,
  hasApiKey: true,
  hasCustomHeaders: false,
  createdAt: "2026-07-25T09:00:00.000Z",
  updatedAt: "2026-07-25T09:00:00.000Z"
};

const dataSurfaceOrder = {
  id: "order_data_surface",
  userId: dataSurfaceUser.id,
  planId: "plan_data_surface",
  planName: "Surface Plan",
  amount: 1990,
  credits: 100,
  status: "PENDING",
  paymentProvider: "epay",
  paymentType: "wxpay",
  paymentTradeNo: "merchant-trade-data-surface",
  providerTradeNo: "provider-trade-data-surface",
  paidAt: null,
  createdAt: "2026-07-25T09:00:00.000Z",
  updatedAt: "2026-07-25T09:00:00.000Z",
  userEmail: dataSurfaceUser.email,
  reviewAttempts: []
};

const dataSurfaceUsageLog = {
  id: "usage_data_surface",
  userId: dataSurfaceUser.id,
  userEmail: dataSurfaceUser.email,
  sessionId: "session_data_surface",
  model: "surface-real-model",
  modelDisplayName: "Surface Model",
  status: "FAILED",
  costCredits: 7,
  errorMessage: "provider raw error must not render",
  createdAt: "2026-07-25T09:00:00.000Z"
};

const dataSurfaceAuditLog = {
  id: "audit_data_surface",
  adminUserId: "admin_data_surface",
  adminEmail: "admin@example.com",
  action: "UPDATE_USER_QUOTA",
  targetType: "USER",
  targetId: dataSurfaceUser.id,
  summary: "Updated remaining credits",
  metadata: null,
  createdAt: "2026-07-25T09:00:00.000Z"
};

const dataSurfaceOverview = {
  ...overview,
  users: [dataSurfaceUser],
  models: [dataSurfaceModel],
  usageLogs: [dataSurfaceUsageLog],
  operations
};

function renderWithLocale(
  locale: Locale,
  value: AdminOverview = overview
) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminOperationsOverview overview={value} />
    </I18nContext.Provider>
  );
}

function renderOperationsDetailsWithLocale(
  locale: Locale,
  value: AdminOverview = overview
) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminOperationsDetails overview={value} />
    </I18nContext.Provider>
  );
}

function renderAdminPageWithLocale(locale: Locale) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminAuthProvider>
        <AdminPage />
      </AdminAuthProvider>
    </I18nContext.Provider>
  );
}

let mountedDataSurfaceRoot: Root | null = null;
let mountedDataSurfaceHost: HTMLDivElement | null = null;
let restoreDialogMethods: (() => void) | null = null;

function mockNativeDialogMethods() {
  const dialogPrototype = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  const originalShowModal = dialogPrototype.showModal;
  const originalClose = dialogPrototype.close;

  Object.defineProperty(dialogPrototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    }
  });
  Object.defineProperty(dialogPrototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    }
  });

  return () => {
    if (originalShowModal) {
      Object.defineProperty(dialogPrototype, "showModal", {
        configurable: true,
        value: originalShowModal
      });
    } else {
      Reflect.deleteProperty(dialogPrototype, "showModal");
    }
    if (originalClose) {
      Object.defineProperty(dialogPrototype, "close", {
        configurable: true,
        value: originalClose
      });
    } else {
      Reflect.deleteProperty(dialogPrototype, "close");
    }
  };
}

beforeEach(() => {
  restoreDialogMethods = mockNativeDialogMethods();
});

afterEach(async () => {
  await act(async () => {
    mountedDataSurfaceRoot?.unmount();
  });
  mountedDataSurfaceRoot = null;
  mountedDataSurfaceHost?.remove();
  mountedDataSurfaceHost = null;
  navigationState.pathname = "/admin/overview";
  adminRouter.replace.mockReset();
  window.localStorage.clear();
  restoreDialogMethods?.();
  restoreDialogMethods = null;
  vi.unstubAllGlobals();
});

function dataSurfaceJsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function mountAdminDataSurface(pathname: string) {
  navigationState.pathname = pathname;
  window.localStorage.setItem(authTokenKey, "admin-data-surface-token");
  window.localStorage.setItem(
    authUserKey,
    JSON.stringify({
      id: "admin_data_surface",
      email: "admin@example.com",
      role: "ADMIN",
      credits: 0
    })
  );

  const fetchCalls: Array<{ method: string; url: string }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    fetchCalls.push({
      method: typeof init?.method === "string" ? init.method : "GET",
      url
    });

    if (url.includes("/admin/overview")) {
      return dataSurfaceJsonResponse(dataSurfaceOverview);
    }
    if (url.includes("/admin/users")) {
      return dataSurfaceJsonResponse({ users: [dataSurfaceUser] });
    }
    if (url.includes("/admin/plans")) {
      return dataSurfaceJsonResponse({ plans: [] });
    }
    if (url.includes("/admin/orders")) {
      return dataSurfaceJsonResponse({
        orders: [dataSurfaceOrder],
        reviewOrderCount: 0
      });
    }
    if (url.includes("/admin/usage-logs")) {
      return dataSurfaceJsonResponse({ usageLogs: [dataSurfaceUsageLog] });
    }
    if (url.includes("/admin/settings")) {
      return dataSurfaceJsonResponse({ settings: [] });
    }
    if (url.includes("/admin/audit-logs")) {
      return dataSurfaceJsonResponse({ logs: [dataSurfaceAuditLog] });
    }
    if (url.includes("/admin/feedbacks")) {
      return dataSurfaceJsonResponse({ feedbacks: [] });
    }
    if (url.includes("/admin/links")) {
      return dataSurfaceJsonResponse({ links: [] });
    }
    if (url.includes("/admin/provider-accounts")) {
      return dataSurfaceJsonResponse({
        providerAccounts: [dataSurfaceProviderAccount]
      });
    }
    if (url.includes("/admin/moderation/circuit-breaker")) {
      return dataSurfaceJsonResponse({
        settings: {
          version: 1,
          enabled: false,
          failureThreshold: 3,
          cooldownMs: 60000
        },
        epoch: 0,
        routes: []
      });
    }
    if (url.includes("/admin/moderation")) {
      return dataSurfaceJsonResponse({ version: 1, enabled: false, routes: [] });
    }

    return dataSurfaceJsonResponse({});
  });
  vi.stubGlobal("fetch", fetchImpl);

  mountedDataSurfaceHost = document.createElement("div");
  document.body.append(mountedDataSurfaceHost);
  mountedDataSurfaceRoot = createRoot(mountedDataSurfaceHost);
  await act(async () => {
    mountedDataSurfaceRoot?.render(
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <AdminAuthProvider>
          <AdminPage />
        </AdminAuthProvider>
      </I18nContext.Provider>
    );
  });

  for (let index = 0; index < 10; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  return { fetchCalls, host: mountedDataSurfaceHost };
}

async function unmountAdminDataSurface() {
  await act(async () => {
    mountedDataSurfaceRoot?.unmount();
  });
  mountedDataSurfaceRoot = null;
  mountedDataSurfaceHost?.remove();
  mountedDataSurfaceHost = null;
}

function renderAdminSectionTabs(locale: Locale, activeSection = defaultAdminSection) {
  navigationState.pathname = getAdminSectionHref(activeSection);
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminSectionTabs />
    </I18nContext.Provider>
  );
}

function renderAdminSidebar(locale: Locale, activeSection = defaultAdminSection) {
  navigationState.pathname = getAdminSectionHref(activeSection);
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminSidebar />
    </I18nContext.Provider>
  );
}

function renderAdminToast(locale: Locale) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminToastContainer
        toasts={[{ id: "toast_1", type: "success", message: "Site settings saved." }]}
        dismissLabel={createTranslator(locale)("admin.dismissMessage")}
        onDismiss={vi.fn()}
      />
    </I18nContext.Provider>
  );
}

const modelInputClass = "admin-input";
const modelCheckboxClass = "admin-checkbox";
const modelPrimaryButtonClass = "admin-primary-button";
const modelIconButtonClass = "admin-icon-button";
const modelToggleInlineClass = "admin-toggle";

const modelForm: ModelFormState = {
  name: "deepseek",
  displayName: "DeepSeek Chat",
  modelId: "deepseek-chat",
  provider: "SUB2API",
  providerAccountId: "provider_account_1",
  capability: "chat",
  displaySurfaces: ["chat", "image"],
  imageInvokeMode: "anthropic-messages",
  imageOutputParser: "markdown-data-url",
  maxReferenceImages: "1",
  group: "chat",
  tagsText: "chat, fast",
  shortDescription: "General chat model",
  isRecommended: true,
  enabled: true,
  allowGuest: true,
  creditCost: "1",
  sortOrder: "0",
  iconUrl: "",
  iconText: "DS",
  iconColor: "#2563eb"
};

const routeForm: ModelRouteFormState = {
  providerAccountId: "provider_account_1",
  upstreamModel: "deepseek-ai/DeepSeek-V3",
  priority: "1",
  enabled: true
};

function renderAdminModelsSection(
  locale: Locale,
  initialDrawerState:
    | { mode: "create" }
    | { mode: "edit"; modelId: string }
    | null = null,
  options: {
    capability?: ModelFormState["capability"];
    maxReferenceImages?: number;
    hydrateFromModel?: boolean;
  } = {}
) {
  const capability = options.capability ?? "chat";
  const maxReferenceImages = options.maxReferenceImages ?? 1;
  const form = {
    ...modelForm,
    capability,
    maxReferenceImages: String(maxReferenceImages)
  };
  const model = {
    id: "model_deepseek",
    name: "deepseek",
    displayName: "DeepSeek Chat",
    slug: "deepseek",
    provider: "SUB2API",
    providerAccountId: "provider_account_1",
    capability,
    displaySurfaces: ["chat", "image"],
    imageInvokeMode: "anthropic-messages",
    imageOutputParser: "markdown-data-url",
    maxReferenceImages,
    modelId: "deepseek-chat",
    group: "chat",
    tags: ["chat", "fast"],
    shortDescription: "General chat model",
    enabled: true,
    creditCost: 1,
    allowGuest: true,
    sortOrder: 0,
    isRecommended: true,
    iconUrl: "",
    iconText: "DS",
    iconColor: "#2563eb",
    routes: [
      {
        id: "route_1",
        modelId: "model_deepseek",
        providerId: "provider_account_1",
        providerName: "Sub2API Main",
        upstreamModel: "deepseek-ai/DeepSeek-V3",
        priority: 1,
        enabled: true,
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z"
      }
    ]
  };
  const providerAccount = {
    id: "provider_account_1",
    name: "Sub2API Main",
    providerType: "SUB2API",
    baseUrl: "https://sub2api.example",
    capabilities: ["chat"],
    enabled: true,
    priority: 0,
    timeoutMs: 60000,
    configJson: { testModel: "deepseek-chat" },
    notes: null,
    hasApiKey: true,
    hasCustomHeaders: false,
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z"
  };

  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminModelsSection
        checkboxClass={modelCheckboxClass}
        creatingModel={false}
        emptyModelRouteForm={{
          providerAccountId: "",
          upstreamModel: "",
          priority: "1",
          enabled: true
        }}
        iconButtonClass={modelIconButtonClass}
        inputClass={modelInputClass}
        initialDrawerState={initialDrawerState}
        modelCapabilityOptions={["chat", "image", "video", "ppt"]}
        modelInputs={options.hydrateFromModel ? {} : { model_deepseek: form }}
        modelProviders={["SUB2API", "OPENAI_COMPATIBLE", "NEW_API"]}
        modelRouteInputs={{ model_deepseek: routeForm }}
        models={[model] as never}
        newModel={form}
        primaryButtonClass={modelPrimaryButtonClass}
        providerAccounts={[providerAccount] as never}
        savingModelId={null}
        savingModelRouteId={null}
        toggleInlineClass={modelToggleInlineClass}
        onCopyModelId={vi.fn()}
        onCreateModel={vi.fn(async () => null)}
        onCreateModelRoute={vi.fn()}
        onDeleteModel={vi.fn()}
        onDisableModel={vi.fn()}
        onDisableModelRoute={vi.fn()}
        onModelInputsChange={vi.fn()}
        onModelRouteInputsChange={vi.fn()}
        onNewModelChange={vi.fn()}
        onUpdateModel={vi.fn()}
        onUpdateModelRoute={vi.fn()}
      />
    </I18nContext.Provider>
  );
}

function renderScrollableRegion() {
  return renderToStaticMarkup(
    <AdminScrollableRegion>
      <table>
        <tbody>
          <tr>
            <td>bounded content</td>
          </tr>
        </tbody>
      </table>
    </AdminScrollableRegion>
  );
}

function renderGeneratedAssetStorageInfo(locale: Locale) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <GeneratedAssetStorageInfo />
    </I18nContext.Provider>
  );
}

describe("admin settings payload", () => {
  it("includes branding settings in the site settings payload", () => {
    const form: SettingsFormState = {
      siteName: "AI Aggregate",
      siteLogoText: "Agg",
      siteLogoUrl: "https://example.com/logo.png",
      siteFaviconUrl: "https://example.com/favicon.ico",
      workspaceIconUrl: "https://example.com/workspace-icon.png",
      siteAnnouncement: "",
      publicNotice: "Public beta",
      publicNoticeEnabled: true,
      contactEmail: "support@example.com",
      defaultModel: "gpt-test",
      titleCoverBriefModelId: "gpt-test",
      titleCoverBriefCostCredits: "2",
      titleCoverBriefDailyBudgetCredits: "100",
      guestModeEnabled: true,
      guestRateLimitEnabled: true,
      profileRateLimitEnabled: true,
      nicknameUpdateDailyLimit: "3",
      avatarUpdateDailyLimit: "5",
      referenceImageRateLimitEnabled: true,
      referenceImageDailyLimit: "20",
      registrationEnabled: true,
      registrationClosedMessageZh: "关闭",
      registrationClosedMessageEn: "Closed",
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
      homeHeroTitle: "Home",
      homeHeroSubtitle: "Subtitle",
      homePrimaryCta: "Start",
      homeSecondaryCta: "Plans",
      betaNotice: "Beta",
      homePrimaryCtaText: "",
      homeSecondaryCtaText: "",
      homeBetaNotice: "",
      homeRightCardNotice: "",
      footerSlogan: "",
      footerCopyright: "Copyright 2026",
      footerLinksJson: "[{\"label\":\"Status\",\"href\":\"/status\"}]",
      homeFeatureCards: "",
      workspaceLinksLabel: "",
      workspaceTitle: "Workspace",
      workspaceSubtitle: "Workspace subtitle",
      workspacePromptPlaceholder: "Ask anything",
      workspaceHint: "Use concise prompts.",
      workspaceHeroTitle: "",
      workspaceHeroSubtitle: "",
      workspacePromptCards: "",
      imagePromptCards: "",
      helpContentJson: ""
    };

    expect(settingsFormToPayload(form)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "siteLogoText", value: "Agg" }),
        expect.objectContaining({
          key: "siteLogoUrl",
          value: "https://example.com/logo.png"
        }),
        expect.objectContaining({ key: "siteFaviconUrl" }),
        expect.objectContaining({
          key: "workspaceIconUrl",
          value: "https://example.com/workspace-icon.png"
        }),
        expect.objectContaining({ key: "workspaceTitle", value: "Workspace" }),
        expect.objectContaining({
          key: "workspacePromptPlaceholder",
          value: "Ask anything"
        }),
        expect.objectContaining({ key: "footerCopyright" }),
        expect.objectContaining({ key: "imagePromptCards", value: "" }),
        expect.objectContaining({
          key: "titleCoverBriefModelId",
          value: "gpt-test",
          type: "string"
        }),
        expect.objectContaining({
          key: "titleCoverBriefCostCredits",
          value: "2",
          type: "number"
        }),
        expect.objectContaining({
          key: "titleCoverBriefDailyBudgetCredits",
          value: "100",
          type: "number"
        }),
        expect.objectContaining({ key: "footerLinksJson", type: "json" }),
        expect.objectContaining({ key: "publicNoticeEnabled", value: "true" }),
        expect.objectContaining({
          key: "guestRateLimitEnabled",
          value: "true"
        }),
        expect.objectContaining({
          key: "profileRateLimitEnabled",
          value: "true",
          type: "boolean"
        }),
        expect.objectContaining({
          key: "nicknameUpdateDailyLimit",
          value: "3",
          type: "number"
        }),
        expect.objectContaining({
          key: "avatarUpdateDailyLimit",
          value: "5",
          type: "number"
        }),
        expect.objectContaining({
          key: "guestDailyLimit",
          value: "10",
          type: "number"
        }),
        expect.objectContaining({
          key: "guestPerModelHourlyLimit",
          value: "5",
          type: "number"
        }),
        expect.objectContaining({
          key: "guestBurstLimit",
          value: "2",
          type: "number"
        }),
        expect.objectContaining({
          key: "guestBurstWindowSeconds",
          value: "10",
          type: "number"
        })
      ])
    );
  });

  it("preserves hidden settings when one visible responsibility field changes", () => {
    const completeForm: SettingsFormState = {
      siteName: "Original site",
      siteLogoText: "AI",
      siteLogoUrl: "https://example.com/logo.png",
      siteFaviconUrl: "https://example.com/favicon.ico",
      workspaceIconUrl: "https://example.com/workspace.png",
      siteAnnouncement: "Announcement",
      publicNotice: "Notice",
      publicNoticeEnabled: true,
      contactEmail: "contact@example.com",
      defaultModel: "gpt-test",
      titleCoverBriefModelId: "gpt-test",
      titleCoverBriefCostCredits: "2",
      titleCoverBriefDailyBudgetCredits: "100",
      guestModeEnabled: true,
      guestRateLimitEnabled: true,
      profileRateLimitEnabled: true,
      nicknameUpdateDailyLimit: "3",
      avatarUpdateDailyLimit: "5",
      referenceImageRateLimitEnabled: true,
      referenceImageDailyLimit: "20",
      registrationEnabled: false,
      registrationClosedMessageZh: "暂停注册",
      registrationClosedMessageEn: "Registration paused",
      registrationEmailPolicyEnabled: true,
      registrationEmailPolicyMode: "ALLOWLIST",
      registrationAllowedDomainsText: "gmail.com\nqq.com",
      registrationBlockedDomainsText: "blocked.example",
      maintenanceModeEnabled: false,
      maintenanceMessage: "Maintenance",
      guestDailyLimit: "10",
      guestPerModelHourlyLimit: "5",
      guestBurstLimit: "2",
      guestBurstWindowSeconds: "10",
      guestChatConcurrencyLimit: "1",
      userChatConcurrencyLimit: "2",
      imageGenerationConcurrencyLimit: "1",
      homeHeroTitle: "Hero",
      homeHeroSubtitle: "Subtitle",
      homePrimaryCta: "Start",
      homeSecondaryCta: "Learn",
      betaNotice: "Beta",
      homePrimaryCtaText: "Start",
      homeSecondaryCtaText: "Learn",
      homeBetaNotice: "Beta",
      homeRightCardNotice: "Right card",
      footerSlogan: "Footer",
      footerCopyright: "Copyright",
      footerLinksJson: '[{"label":"Status","href":"/status"}]',
      homeFeatureCards: '[{"title":"Feature","description":"Description"}]',
      workspaceLinksLabel: "Resources",
      workspaceTitle: "Workspace",
      workspaceSubtitle: "Workspace subtitle",
      workspacePromptPlaceholder: "Ask",
      workspaceHint: "Hint",
      workspaceHeroTitle: "Workspace",
      workspaceHeroSubtitle: "Workspace subtitle",
      workspacePromptCards: '[{"title":"Plan","description":"Plan it","prompt":"Plan:"}]',
      imagePromptCards: '[{"title":"Image","description":"Create","prompt":"Create:"}]',
      storagePackageEnabled: true,
      storagePackagePriceCredits: "25",
      storagePackageDurationDays: "30",
      storagePackageAutoRenewEnabled: true,
      storagePackageDescription: "Storage",
      checkInEnabled: true,
      checkInDailyRewardCredits: "2",
      checkInStreakRewards: '{"3":5}',
      referralEnabled: true,
      referralInviterRewardCredits: "8",
      referralInviteeRewardCredits: "4",
      referralRewardTrigger: "FIRST_PAID_ORDER",
      referralRulesText: "Rules",
      helpContentJson: '{"en-US":{}}'
    };
    const loadedSettings: SiteSettingSummary[] = settingsFormToPayload(completeForm).map(
      (setting) => ({
        ...setting,
        type: setting.type as SiteSettingSummary["type"],
        description: setting.key,
        updatedAt: "2026-08-29T00:00:00.000Z"
      })
    );
    const loadedForm = settingsToForm(loadedSettings);
    const originalPayload = settingsFormToPayload(loadedForm);
    const request = buildAdminSettingsRequestInit("test-admin-token", {
      ...loadedForm,
      siteName: "Updated brand"
    });
    const requestBody = JSON.parse(String(request.body)) as {
      settings: ReturnType<typeof settingsFormToPayload>;
    };
    const savedPayload = requestBody.settings;
    const originalByKey = new Map(
      originalPayload.map((setting) => [setting.key, setting])
    );

    expect(savedPayload.find((setting) => setting.key === "siteName")?.value).toBe(
      "Updated brand"
    );
    expect(request.method).toBe("PATCH");
    expect(request.headers).toEqual({
      Authorization: "Bearer test-admin-token",
      "Content-Type": "application/json"
    });
    for (const setting of savedPayload) {
      if (setting.key === "siteName") continue;
      expect(setting).toEqual(originalByKey.get(setting.key));
    }
    expect(savedPayload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "contactEmail", value: "contact@example.com" }),
        expect.objectContaining({ key: "defaultModel", value: "gpt-test" }),
        expect.objectContaining({ key: "registrationEnabled", value: "false" }),
        expect.objectContaining({ key: "referralEnabled", value: "true" }),
        expect.objectContaining({ key: "titleCoverBriefDailyBudgetCredits", value: "100" })
      ])
    );
  });
});

describe("admin loading guards", () => {
  it("A: does not report a core network failure after moderation marks 403", () => {
    const guard = createAdminLoadAccessGuard();
    const generation = guard.begin();

    expect(guard.markAccessFailure(generation, "forbidden")).toBe(true);
    expect(guard.canCommit(generation)).toBe(false);
    expect(guard.getAccessFailure()).toBe("forbidden");
  });

  it("B: keeps 401 terminal and prevents a second ordinary core failure", () => {
    const guard = createAdminLoadAccessGuard();
    const generation = guard.begin();

    expect(guard.markAccessFailure(generation, "unauthorized")).toBe(true);
    expect(guard.markAccessFailure(generation, "unauthorized")).toBe(true);
    expect(guard.getAccessFailure()).toBe("unauthorized");
    expect(guard.canCommit(generation)).toBe(false);
  });

  it("C: reports an ordinary core 500 when no access failure exists", () => {
    const guard = createAdminLoadAccessGuard();
    const generation = guard.begin();

    expect(guard.canCommit(generation)).toBe(true);
    expect(guard.getAccessFailure()).toBeNull();
  });

  it("D: lets a later moderation 403 supersede an earlier core error", () => {
    const guard = createAdminLoadAccessGuard();
    const generation = guard.begin();

    expect(guard.canCommit(generation)).toBe(true);
    expect(guard.markAccessFailure(generation, "forbidden")).toBe(true);
    expect(guard.canCommit(generation)).toBe(false);
    expect(guard.getAccessFailure()).toBe("forbidden");
  });

  it("gives unauthorized the highest priority and rejects stale generations", () => {
    const guard = createAdminLoadAccessGuard();
    const generation = guard.begin();

    expect(guard.markAccessFailure(generation, "forbidden")).toBe(true);
    expect(guard.markAccessFailure(generation, "unauthorized")).toBe(true);
    expect(guard.getAccessFailure()).toBe("unauthorized");
    expect(guard.canCommit(generation)).toBe(false);

    const nextGeneration = guard.begin();
    expect(guard.markAccessFailure(generation, "forbidden")).toBe(false);
    expect(guard.canCommit(nextGeneration)).toBe(true);
  });

  it("keeps ordinary moderation refresh errors independent from core readiness", () => {
    const guard = createAdminLoadAccessGuard();
    const generation = guard.begin();
    expect(guard.canCommit(generation)).toBe(true);
    expect(guard.getAccessFailure()).toBeNull();
  });

  it("preserves a real false core refresh result", async () => {
    const loadCoreAdminData = vi.fn().mockResolvedValue(false);
    const loadModerationData = vi.fn().mockResolvedValue(true);

    await expect(
      refreshAdminDataAfterProviderMutation(
        loadCoreAdminData,
        loadModerationData
      )
    ).resolves.toBe(false);
    expect(loadCoreAdminData).toHaveBeenCalledTimes(1);
    expect(loadModerationData).toHaveBeenCalledTimes(1);
  });
});

describe("admin operations overview", () => {
  it("keeps only HTTP(S) feedback screenshot URLs clickable", () => {
    expect(getSafeFeedbackScreenshotUrl("https://example.com/screenshot")).toBe(
      "https://example.com/screenshot"
    );
    expect(getSafeFeedbackScreenshotUrl("http://example.com/screenshot")).toBe(
      "http://example.com/screenshot"
    );
    expect(getSafeFeedbackScreenshotUrl("javascript:alert(1)")).toBeNull();
    expect(getSafeFeedbackScreenshotUrl("https://user:password@example.com/image")).toBeNull();
    expect(getSafeFeedbackScreenshotUrl("https://[invalid")).toBeNull();
  });

  it("renders operations overview cards and tables in Chinese", () => {
    const html = renderWithLocale("zh-CN");

    expect(html).toContain("运营概览");
    expect(html).toContain("今日调用");
    expect(html).toContain("今日消耗额度");
    expect(html).toContain("待确认订单");
    expect(html).toContain("最近 7 天趋势");
    expect(html).toContain("模型调用排行");
    expect(html).toContain("有 2 个订单等待确认");
  });

  it("renders operations overview cards and tables in English", () => {
    const html = renderWithLocale("en-US");

    expect(html).toContain("Operations Overview");
    expect(html).toContain("Calls Today");
    expect(html).toContain("Credits Used Today");
    expect(html).toContain("Pending Orders");
    expect(html).toContain("Last 7 Days");
    expect(html).toContain("Top Models by Calls");
    expect(html).toContain("2 orders are waiting for confirmation");
  });

  it("keeps the dashboard hierarchy compact and preserves the pending order alert", () => {
    const html = renderWithLocale("en-US");
    const document = new DOMParser().parseFromString(html, "text/html");
    const dashboard = document.querySelector(
      '[data-admin-overview-dashboard="true"]'
    );
    const primaryMetrics = dashboard?.querySelector(
      '[data-admin-primary-metrics="true"]'
    );
    const secondaryMetrics = dashboard?.querySelector(
      '[data-admin-secondary-metrics="true"]'
    );

    expect(dashboard).toBeTruthy();
    expect(primaryMetrics?.children).toHaveLength(6);
    expect(secondaryMetrics?.children).toHaveLength(8);
    expect(primaryMetrics?.textContent).toContain("Calls Today");
    expect(primaryMetrics?.textContent).toContain("Success Rate");
    expect(primaryMetrics?.textContent).toContain("Today Failed Requests");
    expect(secondaryMetrics?.textContent).toContain("Pending Orders");
    expect(html).toContain('role="alert"');
    expect(html).toContain("2 orders are waiting for confirmation");
    expect(html).not.toContain("shadow-sm");
  });

  it("normalizes the final operations contract and preserves safe fields", () => {
    const normalized = normalizeAdminOperations(operations);

    expect(normalized).toEqual(operations);
    expect(normalized.recentTasks[0]).toMatchObject({
      taskId: "task_failed_1",
      safeErrorClass: "TASK_FAILED",
      refundStatus: "UNKNOWN"
    });
    expect(normalized.manualCompensations.map((item) => item.creditDelta)).toEqual([
      5,
      -3,
      0,
      null
    ]);
    expect(normalized.budgets.map((item) => item.scope)).toEqual([
      "image_generation",
      "chat_completion",
      "admin_provider_test",
      "title_cover_visual_brief"
    ]);
  });

  it("keeps old API responses and malformed arrays in safe empty states", () => {
    expect(normalizeAdminOverviewResponse({}).operations).toEqual({
      recentTasks: [],
      budgets: [],
      manualCompensations: []
    });
    expect(
      normalizeAdminOperations({
        recentTasks: "not-an-array",
        manualCompensations: {},
        budgets: null
      })
    ).toEqual({
      recentTasks: [],
      budgets: [],
      manualCompensations: []
    });
  });

  it("bounds operations, rejects unknown states, and sanitizes sensitive fields", () => {
    const normalized = normalizeAdminOperations({
      recentTasks: Array.from({ length: 55 }, (_, index) => ({
        taskId: `task_${index}`,
        userId: "user_safe",
        type: "image",
        status: "failed",
        modelId: "image-model",
        modelLabel: "Image Model",
        providerLabel: "https://provider.invalid/secret",
        routeId: "route_safe",
        createdAt: "2026-07-25T10:00:00.000Z",
        updatedAt: "2026-07-25T10:01:00.000Z",
        safeErrorClass: "UNTRUSTED_RAW_STATE",
        chargeStatus: "UNTRUSTED_CHARGE_STATE",
        creditReleaseStatus: "UNTRUSTED_RELEASE_STATE",
        refundStatus: "REFUND_FAILED",
        costRecorded: "yes",
        prompt: "PROMPT_SHOULD_NOT_ENTER_RESULT",
        errorMessage: "RAW_PROVIDER_ERROR_SHOULD_NOT_ENTER_RESULT",
        providerResponse: "https://provider.invalid/response"
      })),
      manualCompensations: [
        ...Array.from({ length: 55 }, (_, index) => ({
          auditId: `audit_${index}`,
          targetUserId: "user_safe",
          action: "UPDATE_USER_QUOTA",
          createdAt: "2026-07-25T10:00:00.000Z",
          creditChangeStatus: "RECORDED",
          creditDelta: index
        })),
        {
          auditId: "audit_bad_recorded",
          targetUserId: "user_safe",
          action: "UPDATE_USER_QUOTA",
          createdAt: "2026-07-25T10:00:00.000Z",
          creditChangeStatus: "RECORDED",
          creditDelta: Number.POSITIVE_INFINITY,
          summary: "SUMMARY_SHOULD_NOT_REPAIR_STATE"
        },
        {
          auditId: "audit_bad_unknown",
          targetUserId: "user_safe",
          action: "UPDATE_USER_QUOTA",
          createdAt: "2026-07-25T10:00:00.000Z",
          creditChangeStatus: "UNKNOWN",
          creditDelta: 99
        }
      ],
      budgets: [
        {
          scope: "image_generation",
          periodType: "DAILY",
          periodKey: "2026-07-25",
          limit: Number.NaN,
          used: 4,
          remaining: -5,
          status: "UNTRUSTED_BUDGET_STATE",
          updatedAt: "2026-07-25T10:00:00.000Z",
          metadata: { providerUrl: "https://provider.invalid" }
        },
        { scope: "unknown_scope", status: "NORMAL" }
      ]
    });

    expect(normalized.recentTasks).toHaveLength(50);
    expect(normalized.recentTasks[0]).toMatchObject({
      safeErrorClass: "UNKNOWN",
      chargeStatus: "UNKNOWN",
      creditReleaseStatus: "UNKNOWN",
      refundStatus: "UNKNOWN",
      costRecorded: false,
      providerLabel: null
    });
    expect(normalized.recentTasks[0]).not.toHaveProperty("prompt");
    expect(normalized.recentTasks[0]).not.toHaveProperty("errorMessage");
    expect(normalized.manualCompensations).toHaveLength(50);
    expect(normalized.budgets).toEqual([
      expect.objectContaining({
        scope: "image_generation",
        status: "NOT_INITIALIZED",
        limit: null,
        used: null,
        remaining: null
      })
    ]);
  });

  it("renders abnormal tasks with neutral unknown refund wording", () => {
    const html = renderOperationsDetailsWithLocale("en-US", { ...overview, operations });

    expect(html).toContain("Abnormal tasks");
    expect(html).toContain("Task failed");
    expect(html).toContain("Charged and failed");
    expect(html).toContain("Cannot be determined from current records");
    expect(html).not.toContain("Refund failed");
    expect(html).not.toContain("Refund missing");
    expect(html).not.toContain("Unrefunded");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("min-w-[1500px]");
  });

  it("renders positive, negative, zero, and unknown compensation deltas", () => {
    const html = renderOperationsDetailsWithLocale("zh-CN", { ...overview, operations });

    expect(html).toContain("人工补偿");
    expect(html).toContain("增加 +5");
    expect(html).toContain("减少 -3");
    expect(html).toContain("无变化 0");
    expect(html).toContain("无法由当前记录判断");
    expect(html).toContain("人工调整用户额度");
    expect(html).not.toContain("audit_bad");
  });

  it("renders all four budget scopes and explicit budget states", () => {
    const html = renderOperationsDetailsWithLocale("en-US", { ...overview, operations });

    expect(html).toContain("Budgets");
    expect(html).toContain("Image generation");
    expect(html).toContain("Chat completion");
    expect(html).toContain("Admin provider test");
    expect(html).toContain("Title Cover visual brief");
    expect(html).toContain("Normal");
    expect(html).toContain("Near limit");
    expect(html).toContain("Exhausted");
    expect(html).toContain("Remaining");
  });

  it("keeps Overview concise while detailed operations remain addressable", () => {
    const overviewHtml = renderWithLocale("en-US");
    const operationsHtml = renderOperationsDetailsWithLocale("en-US");

    expect(overviewHtml).toContain("Operations Overview");
    expect(overviewHtml).toContain("Recent Failures");
    expect(overviewHtml).toContain("Recent Orders");
    expect(overviewHtml).toContain('href="/admin/operations"');
    expect(overviewHtml).toContain("View detailed operations");
    expect(overviewHtml).not.toContain("Abnormal tasks");
    expect(overviewHtml).not.toContain("Manual compensations");
    expect(overviewHtml).not.toContain("Budgets");
    expect(operationsHtml).toContain("Abnormal tasks");
    expect(operationsHtml).toContain("Manual compensations");
    expect(operationsHtml).toContain("Budgets");
    expect(operationsHtml).toContain("No data");
  });

  it("preserves the complete data-surface columns and values across Admin routes", async () => {
    const cases = [
      {
        pathname: "/admin/users",
        surface: "users",
        headers: ["Email", "Role", "Remaining credits", "Created", "Action"],
        values: ["surface-user@example.com", "42", "Save credits"]
      },
      {
        pathname: "/admin/models",
        surface: "models",
        headers: [
          "Model name",
          "Custom display name",
          "Real model ID",
          "Canonical ID",
          "Legacy provider category",
          "Display surfaces",
          "Image runtime config",
          "Model group",
          "Enabled",
          "Allow guest usage",
          "Recommended model",
          "Enabled routes",
          "admin.actions"
        ],
        values: ["Surface Model", "surface-real-model", "1 / 1", "Details"]
      },
      {
        pathname: "/admin/provider-accounts",
        surface: "provider-accounts",
        headers: [
          "Account name",
          "Provider type",
          "Request format",
          "Base URL",
          "Capabilities",
          "Priority",
          "Timeout ms",
          "Test status",
          "Enabled",
          "Actions"
        ],
        values: [
          "Surface Provider",
          "https://provider.example/v1",
          "Test connection",
          "Edit account",
          "Disable account"
        ]
      },
      {
        pathname: "/admin/orders",
        surface: "orders",
        headers: [
          "User",
          "Plan",
          "Amount",
          "Credits",
          "Order status",
          "Payment method",
          "Trade number",
          "Provider trade no",
          "Created",
          "Paid",
          "Action"
        ],
        values: [
          "surface-user@example.com",
          "Surface Plan",
          "merchant-trade-data-surface",
          "provider-trade-data-surface",
          "Confirm paid",
          "Cancel order",
          "Details"
        ]
      },
      {
        pathname: "/admin/usage",
        surface: "usage",
        headers: ["Time", "User", "Model", "Status", "Cost", "Error"],
        values: [
          "surface-user@example.com",
          "Surface Model",
          "Failed",
          "7",
          "Model service temporarily unavailable"
        ]
      },
      {
        pathname: "/admin/audit",
        surface: "audit",
        headers: ["Time", "Admin", "Action", "Target", "Summary"],
        values: ["admin@example.com", "USER", "Updated remaining credits"]
      }
    ];

    for (const item of cases) {
      const { fetchCalls, host } = await mountAdminDataSurface(item.pathname);
      if (!host) throw new Error(`missing host for ${item.pathname}`);
      const table = host.querySelector(
        `table[data-admin-data-surface="${item.surface}"]`
      );
      if (!table) throw new Error(`missing table for ${item.pathname}`);

      const headerCells = Array.from(
        table.querySelectorAll<HTMLTableCellElement>("thead th")
      );
      const headerText = headerCells.map((cell) => cell.textContent?.trim());
      expect(headerText).toEqual(expect.arrayContaining(item.headers));
      expect(table.querySelector('tbody tr[data-admin-table-row="true"]')).toBeTruthy();
      for (const value of item.values) {
        if (item.surface === "users" && value === "42") {
          expect(
            (table.querySelector('input[type="number"]') as HTMLInputElement | null)?.value
          ).toBe("42");
        } else {
          expect(table.textContent).toContain(value);
        }
      }

      const primaryHeader = headerCells.find(
        (cell) => cell.dataset.adminColumnPriority === "primary"
      );
      const secondaryHeader = headerCells.find(
        (cell) => cell.dataset.adminColumnPriority === "secondary"
      );
      expect(primaryHeader).toBeTruthy();
      expect(secondaryHeader?.className).toContain("hidden sm:table-cell");
      expect(host.querySelector('[data-admin-overview-metrics="true"]')).toBeNull();
      expect(fetchCalls.every((call) => call.method === "GET")).toBe(true);
      await unmountAdminDataSurface();
    }

    const { host, fetchCalls } = await mountAdminDataSurface("/admin/operations");
    if (!host) throw new Error("missing operations host");
    const abnormalTasks = host.querySelector(
      'table[data-admin-data-surface="operations-abnormal-tasks"]'
    );
    const compensations = host.querySelector(
      'table[data-admin-data-surface="operations-manual-compensations"]'
    );
    const budgets = host.querySelector(
      'table[data-admin-data-surface="operations-budgets"]'
    );

    expect(abnormalTasks?.textContent).toContain("task_failed_1");
    expect(abnormalTasks?.textContent).toContain("Task failed");
    expect(abnormalTasks?.textContent).toContain("Charged and failed");
    expect(abnormalTasks?.textContent).toContain("Recorded");
    expect(compensations?.textContent).toContain("user_plus");
    expect(compensations?.textContent).toContain("Increase +5");
    expect(budgets?.textContent).toContain("Image generation");
    expect(budgets?.textContent).toContain("Near limit");
    expect(abnormalTasks?.querySelectorAll("thead th")).toHaveLength(14);
    expect(compensations?.querySelectorAll("thead th")).toHaveLength(6);
    expect(budgets?.querySelectorAll("thead th")).toHaveLength(7);
    expect(abnormalTasks?.querySelector('th[data-admin-column-priority="primary"]')).toBeTruthy();
    expect(abnormalTasks?.querySelector('th[data-admin-column-priority="tertiary"]')).toBeTruthy();
    expect(host.querySelector('[data-admin-overview-metrics="true"]')).toBeNull();
    expect(fetchCalls.every((call) => call.method === "GET")).toBe(true);
  });

  it("keeps Overview metrics owned by the dashboard instead of the page header", async () => {
    const overviewResult = await mountAdminDataSurface("/admin/overview");
    if (!overviewResult.host) throw new Error("missing overview host");
    const header = overviewResult.host.querySelector(
      '[data-admin-page-header="true"]'
    );
    const dashboard = overviewResult.host.querySelector(
      '[data-admin-overview-dashboard="true"]'
    );
    const primaryMetrics = dashboard?.querySelector(
      '[data-admin-primary-metrics="true"]'
    );
    const secondaryMetrics = dashboard?.querySelector(
      '[data-admin-secondary-metrics="true"]'
    );

    expect(header?.querySelector('[data-admin-overview-metrics="true"]')).toBeNull();
    expect(header?.textContent).not.toContain("Total Users");
    expect(header?.textContent).not.toContain("Calls Today");
    expect(header?.textContent).not.toContain("Pending Orders");
    expect(dashboard).toBeTruthy();
    expect(primaryMetrics?.children).toHaveLength(6);
    expect(secondaryMetrics?.children).toHaveLength(8);
    for (const label of [
      "Total Users",
      "Today Active Users",
      "Calls Today",
      "Today Failed Requests",
      "Today Paid Orders",
      "Today Revenue",
      "Pending Orders",
      "Total Remaining Credits",
      "Success Rate",
      "Users",
      "New Users Today",
      "Admins",
      "Paid Orders",
      "Cancelled Orders"
    ]) {
      expect(dashboard?.textContent).toContain(label);
    }
    for (const value of ["12", "4", "33", "3", "2", "¥118.00", "1200", "91%", "10", "5", "1"]) {
      expect(dashboard?.textContent).toContain(value);
    }
    expect(dashboard?.querySelector('[role="alert"]')?.textContent).toContain(
      "2 orders are waiting for confirmation"
    );
    expect(dashboard?.querySelector('table[data-admin-data-surface="overview-trend"]')).toBeTruthy();
    expect(
      dashboard?.querySelectorAll('table[data-admin-data-surface="overview-trend"] thead th')
    ).toHaveLength(6);
    expect(overviewResult.fetchCalls.every((call) => call.method === "GET")).toBe(true);

    await unmountAdminDataSurface();
    const modelsResult = await mountAdminDataSurface("/admin/models");
    if (!modelsResult.host) throw new Error("missing models host");
    expect(
      modelsResult.host.querySelector('[data-admin-overview-metrics="true"]')
    ).toBeNull();
    expect(
      modelsResult.host.querySelector('[data-admin-overview-dashboard="true"]')
    ).toBeNull();
    expect(modelsResult.host.querySelector('[data-admin-data-surface="models"]')).toBeTruthy();
  });

  it("renders public beta operations cards and recent sections", () => {
    const enhancedOverview = {
      ...overview,
      stats: {
        ...overview.stats,
        users: {
          ...overview.stats.users,
          todayActive: 2
        },
        orders: {
          ...overview.stats.orders,
          todayPaid: 1,
          todayRevenueCents: 5900
        },
        recentFailures: [
          {
            id: "usage_failed_1",
            createdAt: "2026-06-11T12:00:00.000Z",
            userEmail: "buyer@example.com",
            model: "deepseek-test",
            modelDisplayName: "DeepSeek Beta",
            errorSummary: "Model service temporarily unavailable"
          }
        ],
        recentOrders: [
          {
            id: "order_paid_1",
            userId: "user_1",
            userEmail: "buyer@example.com",
            planId: "plan_team",
            planName: "Team",
            amount: 5900,
            credits: 100,
            status: "PAID",
            paymentProvider: "epay",
            paymentType: "wxpay",
            paymentTradeNo: "order_paid_1",
            providerTradeNo: null,
            paymentUrl: null,
            paidAt: "2026-06-11T12:00:00.000Z",
            createdAt: "2026-06-11T11:59:00.000Z",
            updatedAt: "2026-06-11T12:00:00.000Z"
          }
        ],
        modelUsageLast7Days: [
          {
            model: "deepseek-test",
            displayName: "DeepSeek Beta",
            calls: 7,
            success: 5,
            failed: 2,
            creditsUsed: 14
          }
        ]
      }
    } as unknown as AdminOverview;

    const html = renderWithLocale("en-US", enhancedOverview);

    expect(html).toContain("Today Active Users");
    expect(html).toContain("Today Failed Requests");
    expect(html).toContain("Today Paid Orders");
    expect(html).toContain("Today Revenue");
    expect(html).toContain("Total Remaining Credits");
    expect(html).toContain("Recent Failures");
    expect(html).toContain("Model service temporarily unavailable");
    expect(html).toContain("buyer@example.com");
    expect(html).toContain("Recent Orders");
    expect(html).toContain("Team");
    expect(html).toContain("WeChat Pay");
    expect(html).toContain("Last 7 Days Model Usage");
    expect(html).toContain("DeepSeek Beta");
    expect(html).toContain("Top Models by Calls");
    expect(html).toContain("Top Models by Credits");
    expect(html).toContain("Top Models by Failures");
    expect(html).toContain("gpt-test");
    expect(html).toContain("expensive-test");
    expect(html).toContain("7");
    expect(html).toContain("14");
    expect(html).toContain('data-admin-data-region="true"');
    expect(html).toContain('data-admin-data-surface="overview-trend"');
    expect(html).toContain('href="/admin/operations"');
    expect(html).toContain("View detailed operations");
    expect(html).toContain("Last 7 days");
  });

  it("uses the safe failure fallback while preserving failure identity", () => {
    const value = {
      ...overview,
      stats: {
        ...overview.stats,
        recentFailures: [
          {
            id: "usage_failed_without_summary",
            createdAt: "2026-06-11T12:00:00.000Z",
            userEmail: null,
            model: "safe-fallback-model",
            modelDisplayName: null,
            errorSummary: ""
          }
        ]
      }
    } as unknown as AdminOverview;

    const html = renderWithLocale("en-US", value);

    expect(html).toContain("safe-fallback-model");
    expect(html).toContain("Guest");
    expect(html).toContain("Model service temporarily unavailable");
    expect(html).not.toContain("provider raw error");
  });

  it("renders when stats is missing", () => {
    const partialOverview = {
      users: [],
      models: [],
      usageLogs: [],
      totals: {
        users: 0,
        usageSuccess: 0,
        usageFailed: 0
      }
    } as unknown as AdminOverview;

    expect(() => renderWithLocale("en-US", partialOverview)).not.toThrow();
    expect(renderWithLocale("en-US", partialOverview)).toContain(
      "Operations Overview"
    );
  });

  it("renders when stats arrays are missing", () => {
    const partialOverview = {
      ...overview,
      stats: {
        users: overview.stats.users,
        usage: overview.stats.usage,
        orders: overview.stats.orders
      }
    } as unknown as AdminOverview;

    const html = renderWithLocale("en-US", partialOverview);

    expect(html).toContain("No data");
    expect(html).toContain("Top Models by Calls");
  });

  it("normalizes missing admin overview arrays and stats", () => {
    const normalized = normalizeAdminOverviewResponse({});

    expect(normalized.users).toEqual([]);
    expect(normalized.models).toEqual([]);
    expect(normalized.usageLogs).toEqual([]);
    expect(normalized.stats.users.total).toBe(0);
    expect(normalized.stats.last7Days).toEqual([]);
  });

  it("preserves full admin overview data during normalization", () => {
    const normalized = normalizeAdminOverviewResponse(overview);

    expect(normalized.users).toEqual(overview.users);
    expect(normalized.models).toEqual(overview.models);
    expect(normalized.usageLogs).toEqual(overview.usageLogs);
    expect(normalized.stats.orders.pending).toBe(2);
    expect(normalized.stats.last7Days).toHaveLength(2);
  });

  it("preserves model icon fields during normalization", () => {
    const normalized = normalizeAdminOverviewResponse({
      models: [
        {
          id: "model_icon",
          name: "Icon Model",
          slug: "icon-model",
          provider: "SUB2API",
          providerAccountId: "provider_account_1",
          modelId: "icon-model",
          group: "free",
          tags: ["icon"],
          enabled: true,
          creditCost: 1,
          allowGuest: true,
          sortOrder: 0,
          isRecommended: false,
          iconUrl: "https://example.com/icon.png",
          iconText: "IM",
          iconColor: "#2563eb"
        }
      ]
    });

    expect(normalized.models[0]).toMatchObject({
      iconUrl: "https://example.com/icon.png",
      iconText: "IM",
      iconColor: "#2563eb",
      providerAccountId: "provider_account_1"
    });
  });

  it("preserves model image runtime config during normalization", () => {
    const normalized = normalizeAdminOverviewResponse({
      models: [
        {
          id: "model_image_runtime",
          name: "Image Runtime",
          slug: "image-runtime",
          provider: "SUB2API",
          providerAccountId: null,
          capability: "image",
          displaySurfaces: ["image"],
          imageInvokeMode: "anthropic-messages",
          imageOutputParser: "markdown-data-url",
          maxReferenceImages: 4,
          modelId: "gpt-image-2",
          group: "image",
          tags: ["image"],
          enabled: true,
          creditCost: 1,
          allowGuest: true,
          sortOrder: 0,
          isRecommended: false
        }
      ]
    });

    expect(normalized.models[0]).toMatchObject({
      imageInvokeMode: "anthropic-messages",
      imageOutputParser: "markdown-data-url",
      maxReferenceImages: 4
    });
  });

  it("falls back safely for missing or invalid maxReferenceImages data", () => {
    const normalized = normalizeAdminOverviewResponse({
      models: [
        { id: "missing", maxReferenceImages: undefined },
        { id: "negative", maxReferenceImages: -1 },
        { id: "too-many", maxReferenceImages: 5 },
        { id: "fractional", maxReferenceImages: 1.5 },
        { id: "nan", maxReferenceImages: Number.NaN }
      ]
    });

    expect(normalized.models.map((model) => model.maxReferenceImages)).toEqual([
      1,
      1,
      1,
      1,
      1
    ]);
  });

  it("ignores invalid or missing model image runtime config during normalization", () => {
    const normalized = normalizeAdminOverviewResponse({
      models: [
        {
          id: "model_invalid_runtime",
          name: "Invalid Runtime",
          slug: "invalid-runtime",
          provider: "SUB2API",
          capability: "chat",
          imageInvokeMode: "bad-mode",
          imageOutputParser: "bad-parser",
          modelId: "invalid-runtime",
          group: "chat",
          tags: [],
          enabled: true,
          creditCost: 1,
          allowGuest: true,
          sortOrder: 0,
          isRecommended: false
        },
        {
          id: "model_missing_runtime",
          name: "Missing Runtime",
          slug: "missing-runtime",
          provider: "SUB2API",
          capability: "chat",
          modelId: "missing-runtime",
          group: "chat",
          tags: [],
          enabled: true,
          creditCost: 1,
          allowGuest: true,
          sortOrder: 1,
          isRecommended: false
        }
      ]
    });

    expect(normalized.models).toHaveLength(2);
    expect(normalized.models[0]?.imageInvokeMode).toBeUndefined();
    expect(normalized.models[0]?.imageOutputParser).toBeUndefined();
    expect(normalized.models[1]?.imageInvokeMode).toBeUndefined();
    expect(normalized.models[1]?.imageOutputParser).toBeUndefined();
  });

  it("preserves admin model routes during normalization", () => {
    const normalized = normalizeAdminOverviewResponse({
      models: [
        {
          id: "model_deepseek",
          name: "DeepSeek",
          slug: "deepseek",
          provider: "SUB2API",
          providerAccountId: null,
          capability: "chat",
          modelId: "deepseek-chat",
          group: "chat",
          tags: ["chat"],
          enabled: true,
          creditCost: 1,
          allowGuest: true,
          sortOrder: 0,
          isRecommended: true,
          routes: [
            {
              id: "route_1",
              modelId: "model_deepseek",
              providerId: "provider_account_1",
              providerName: "Sub2API Main",
              upstreamModel: "deepseek-ai/DeepSeek-V3",
              priority: 1,
              enabled: true,
              createdAt: "2026-07-05T00:00:00.000Z",
              updatedAt: "2026-07-05T00:00:00.000Z"
            }
          ]
        }
      ]
    });

    expect(normalized.models[0]?.routes).toEqual([
      {
        id: "route_1",
        modelId: "model_deepseek",
        providerId: "provider_account_1",
        providerName: "Sub2API Main",
        upstreamModel: "deepseek-ai/DeepSeek-V3",
        priority: 1,
        enabled: true,
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z"
      }
    ]);
  });

  it("requires a full admin overview reload after model updates", () => {
    expect(shouldReloadAdminOverviewAfterModelUpdate()).toBe(true);
  });

  it("normalizes provider account safe fields without apiKey", () => {
    const normalized = normalizeProviderAccount({
      id: "provider_account_1",
      name: "OpenRouter backup",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://openrouter.example/v1",
      capabilities: ["chat", "image"],
      enabled: true,
      priority: 10,
      timeoutMs: 45000,
      headersJson: { "X-Test": "yes" },
      configJson: { region: "global" },
      notes: "backup",
      hasApiKey: true,
      hasCustomHeaders: true,
      maskedApiKey: "sk-live...abcd",
      apiKey: "sk-live-full-secret"
    });

    expect(normalized).toMatchObject({
      id: "provider_account_1",
      name: "OpenRouter backup",
      providerType: "OPENAI_COMPATIBLE",
      capabilities: ["chat", "image"],
      hasApiKey: true,
      hasCustomHeaders: true
    });
    expect(normalized).not.toHaveProperty("apiKey");
    expect(normalized).not.toHaveProperty("headersJson");
    expect(normalized).not.toHaveProperty("maskedApiKey");
  });

  it.each(providerAccountTypes)(
    "preserves %s through provider account normalization and form projection",
    (providerType) => {
      const normalized = normalizeProviderAccount({
        id: `provider_account_${providerType.toLowerCase()}`,
        name: `${providerType} account`,
        providerType,
        baseUrl: "https://provider.example/v1",
        capabilities: ["chat"],
        enabled: true,
        priority: 1,
        timeoutMs: 60000,
        configJson: null,
        notes: null,
        hasApiKey: true,
        hasCustomHeaders: false,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z"
      });
      const form = providerAccountToForm(normalized);

      expect(normalized.providerType).toBe(providerType);
      expect(form.providerType).toBe(providerType);
    }
  );

  it("fails closed instead of remapping an unknown provider account type", () => {
    expect(() =>
      normalizeProviderAccount({
        id: "provider_account_unknown",
        name: "Unknown provider",
        providerType: "FUTURE_PROVIDER",
        baseUrl: "https://provider.example/v1",
        capabilities: ["chat"],
        enabled: true,
        priority: 1,
        timeoutMs: 60000,
        configJson: null,
        notes: null,
        hasApiKey: true,
        hasCustomHeaders: false,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z"
      })
    ).toThrow("unsupported provider account type");
  });

  it("builds new provider account test payload for the test endpoint", () => {
    expect(
      parseProviderAccountTestPayload({
        name: "",
        providerType: "ANTHROPIC",
        requestFormat: "anthropic",
        anthropicAuthMode: "x-api-key",
        messagesPath: "",
        testModel: "claude-3-5-haiku-latest",
        testCapability: "chat",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
        capabilitiesText: "chat",
        enabled: true,
        priority: "0",
        timeoutMs: "60000",
        headersJson: "{}",
        configJson: "{\"testModel\":\"claude-3-5-haiku-latest\"}",
        notes: ""
      })
    ).toEqual({
      providerType: "ANTHROPIC",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      requestFormat: "anthropic",
      anthropicAuthMode: "x-api-key",
      testCapability: "chat",
      testModel: "claude-3-5-haiku-latest",
      timeoutMs: 60000,
      headersJson: {},
      configJson: {
        requestFormat: "anthropic",
        anthropicAuthMode: "x-api-key",
        testModel: "claude-3-5-haiku-latest"
      },
      capabilities: ["chat"]
    });
  });

  it("builds saved provider account test payload with providerAccountId and overrides", () => {
    expect(
      parseProviderAccountTestPayload(
        {
          name: "Claude Direct",
          providerType: "ANTHROPIC",
          requestFormat: "anthropic",
          anthropicAuthMode: "x-api-key",
          messagesPath: "/v1/messages",
          testModel: "claude-3-5-haiku-latest",
          testCapability: "chat",
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: "",
          capabilitiesText: "chat",
          enabled: true,
          priority: "0",
          timeoutMs: "60000",
          headersJson: "",
          configJson: "{\"testModel\":\"claude-3-5-haiku-latest\",\"max_tokens\":64}",
          notes: ""
        },
        "provider_account_1"
      )
    ).toEqual({
      providerAccountId: "provider_account_1",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
      requestFormat: "anthropic",
      anthropicAuthMode: "x-api-key",
      testCapability: "chat",
      testModel: "claude-3-5-haiku-latest",
      timeoutMs: 60000,
      configJson: {
        requestFormat: "anthropic",
        anthropicAuthMode: "x-api-key",
        messagesPath: "/v1/messages",
        testModel: "claude-3-5-haiku-latest",
        max_tokens: 64
      },
      capabilities: ["chat"]
    });
  });

  it("sends an empty capabilities override for an edited saved provider form", () => {
    const payload = parseProviderAccountTestPayload(
      {
        name: "Saved Chat Provider",
        providerType: "OPENAI_COMPATIBLE",
        requestFormat: "openai-compatible",
        anthropicAuthMode: "x-api-key",
        messagesPath: "",
        testModel: "saved-chat-model",
        testCapability: "",
        baseUrl: "",
        apiKey: "",
        capabilitiesText: "",
        enabled: true,
        priority: "0",
        timeoutMs: "60000",
        headersJson: "",
        configJson: "{\"testModel\":\"saved-chat-model\"}",
        notes: ""
      },
      "provider_account_saved_chat"
    );

    expect(payload).toMatchObject({
      providerAccountId: "provider_account_saved_chat",
      capabilities: []
    });
  });

  it("sends an explicit image capability and effective test transport fields", () => {
    const payload = parseProviderAccountTestPayload(
      {
        name: "Image Provider",
        providerType: "OPENAI_COMPATIBLE",
        requestFormat: "openai-compatible",
        anthropicAuthMode: "x-api-key",
        messagesPath: "",
        testModel: "image-upstream-model",
        testCapability: "image",
        baseUrl: "https://images.example/v1",
        apiKey: "sk-image-test",
        capabilitiesText: "chat, image",
        enabled: true,
        priority: "0",
        timeoutMs: "1234",
        headersJson: '{"x-provider-test":"header-secret"}',
        configJson:
          '{"testModel":"image-upstream-model","imageTransport":"openai-images"}',
        notes: ""
      },
      "provider_account_image"
    );

    expect(payload).toMatchObject({
      providerAccountId: "provider_account_image",
      testCapability: "image",
      testModel: "image-upstream-model",
      timeoutMs: 1234,
      headersJson: { "x-provider-test": "header-secret" },
      configJson: {
        requestFormat: "openai-compatible",
        testModel: "image-upstream-model",
        imageTransport: "openai-images"
      },
      capabilities: ["chat", "image"]
    });
  });

  it("requires an explicit test capability when a provider supports chat and image", () => {
    const baseForm: ProviderAccountFormState = {
      name: "Multi-capability Provider",
      providerType: "OPENAI_COMPATIBLE" as const,
      requestFormat: "openai-compatible" as const,
      anthropicAuthMode: "x-api-key" as const,
      messagesPath: "",
      testModel: "provider-model",
      testCapability: "chat" as const,
      baseUrl: "https://provider.example/v1",
      apiKey: "sk-provider-test",
      capabilitiesText: "chat",
      enabled: true,
      priority: "0",
      timeoutMs: "60000",
      headersJson: "{}",
      configJson: "{}",
      notes: ""
    };

    const chatOnlyPayload = parseProviderAccountTestPayload(baseForm);
    expect(chatOnlyPayload).toMatchObject({
      testCapability: "chat",
      capabilities: ["chat"]
    });

    const multiCapabilityForm: ProviderAccountFormState = {
      ...baseForm,
      capabilitiesText: "chat, image",
      testCapability: ""
    };
    const unselectedPayload = parseProviderAccountTestPayload(
      multiCapabilityForm
    );
    expect(unselectedPayload).not.toBeNull();
    expect(unselectedPayload).not.toHaveProperty("testCapability");
    expect(unselectedPayload?.configJson).not.toHaveProperty("testCapability");

    const imageSelectedForm: ProviderAccountFormState = {
      ...multiCapabilityForm,
      testCapability: "image"
    };
    expect(parseProviderAccountTestPayload(imageSelectedForm)).toMatchObject({
      testCapability: "image"
    });

    const chatSelectedForm: ProviderAccountFormState = {
      ...multiCapabilityForm,
      testCapability: "chat"
    };
    expect(parseProviderAccountTestPayload(chatSelectedForm)).toMatchObject({
      testCapability: "chat"
    });
  });

  it("clears a stale provider test result when the edited account changes", () => {
    const current = {
      provider_account_1: {
        status: "success" as const,
        message: "old result"
      },
      other_account: {
        status: "success" as const,
        message: "keep result"
      }
    };

    expect(
      clearProviderAccountTestResult(current, "provider_account_1")
    ).toEqual({
      other_account: current.other_account
    });
  });

  it("merges provider account requestFormat and testModel into configJson for saving", () => {
    expect(
      mergeProviderAccountConfigJson(
        {
          name: "SUB2API Claude",
          providerType: "SUB2API",
          requestFormat: "anthropic",
          anthropicAuthMode: "both",
          messagesPath: "/v1/messages",
          testModel: "claude-3-5-haiku-latest",
          testCapability: "chat",
          baseUrl: "https://sub2api.example",
          apiKey: "",
          capabilitiesText: "chat",
          enabled: true,
          priority: "0",
          timeoutMs: "60000",
          headersJson: "",
          configJson: "{\"region\":\"global\"}",
          notes: ""
        },
        { region: "global" }
      )
    ).toEqual({
      region: "global",
      requestFormat: "anthropic",
      anthropicAuthMode: "both",
      messagesPath: "/v1/messages",
      testModel: "claude-3-5-haiku-latest"
    });
  });

  it("defines model management help copy for key fields", () => {
    const t = createTranslator("en-US");

    expect(t("admin.modelNameHelp")).toContain("Internal backend name");
    expect(t("admin.displayNameHelp")).toContain("frontend display");
    expect(t("admin.realModelIdHelp")).toContain("upstream API");
    expect(t("admin.modelProviderHelp")).toContain("compatibility");
    expect(t("admin.modelProviderAccountHelp")).toContain("compatibility fallback");
    expect(t("admin.modelCapabilityHelp")).toContain("displaySurfaces");
    expect(t("admin.modelGroupHelp")).toContain("Frontend model grouping");
    expect(t("admin.creditCostHelp")).toContain("successful call");
    expect(t("admin.sortHelp")).toContain("Lower numbers");
    expect(t("admin.modelList")).toBe("Model list");
    expect(t("admin.addModel")).toBe("Add model");
    expect(t("admin.editModel")).toBe("Edit model");
    expect(t("admin.basicInfo")).toBe("Basic info");
    expect(t("admin.modelRoutes")).toBe("Model routes");
    expect(t("admin.modelRoutesAuthorityHelp")).toContain("primary runtime path");
    expect(t("admin.modelLegacyBinding")).toContain("Legacy direct binding");
    expect(t("admin.dangerZone")).toBe("Dangerous actions");
    expect(t("admin.details")).toBe("Details");
    expect(t("admin.enableModel")).toBe("Enable model");
    expect(t("admin.disableModel")).toBe("Disable model");
    expect(t("admin.enabledRoutes")).toBe("Enabled routes");
    expect(t("admin.totalRoutes")).toBe("Total routes");
    expect(t("admin.upstreamModelId")).toBe("Upstream model ID");
    expect(t("admin.routePriority")).toBe("Route priority");
    expect(t("admin.addRoute")).toBe("Add route");
    expect(t("admin.saveRoute")).toBe("Save route");
  });

  it("renders the admin model table with model summaries", () => {
    const html = renderAdminModelsSection("en-US");

    expect(html).toContain("Model list");
    expect(html).toContain("<table");
    expect(html).toContain("DeepSeek Chat");
    expect(html).toContain("deepseek-chat");
    expect(html).toContain("Canonical ID");
    expect(html).toMatch(
      /<th[^>]*>Legacy provider category<\/th>/
    );
    expect(html).not.toMatch(/<th[^>]*>Provider<\/th>/);
    expect(html).toContain("SUB2API");
    expect(html).toContain("Display surfaces");
    expect(html).toContain("Show in both");
    expect(html).toContain("Image runtime config");
    expect(html).toContain("Anthropic Messages");
    expect(html).toContain("Markdown data URL");
    expect(html).toContain("chat");
    expect(html).toContain("Allow guest usage");
    expect(html).toContain("Recommended model");
    expect(html).toContain("Enabled routes");
    expect(html).toContain(">Details<");
  });

  it("renders the model detail drawer entry sections", () => {
    const html = renderAdminModelsSection("en-US", {
      mode: "edit",
      modelId: "model_deepseek"
    });

    expect(html).toContain("Edit model");
    expect(html).toContain("Basic info");
    expect(html).toContain("Display surfaces");
    expect(html).toContain("Only affects page display and does not change invocation mode.");
    expect(html).toContain("Image runtime config");
    expect(html).toContain("Configure this only for models shown in Image creation.");
    expect(html).toContain("Image invocation mode");
    expect(html).toContain("Image output parser");
    expect(html).toContain('value="anthropic-messages" selected');
    expect(html).toContain('value="markdown-data-url" selected');
    expect(html).toContain("The backend does not yet support chat-format image generation.");
    expect(html).toContain("Model routes");
    expect(html).toContain("Enabled routes are the primary runtime path");
    expect(html).toContain("Legacy direct binding (compatibility)");
    expect(html).toContain("no enabled route");
    expect(html).toContain("Dangerous actions");
    expect(html).toContain(">Save<");

    const host = document.createElement("div");
    host.innerHTML = html;
    const dialog = host.querySelector<HTMLDialogElement>(
      'dialog[data-admin-drawer-dialog="true"]'
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const titleId = dialog?.getAttribute("aria-labelledby");
    const descriptionId = dialog?.getAttribute("aria-describedby");
    expect(titleId).toBeTruthy();
    expect(descriptionId).toBeTruthy();
    expect(host.querySelector(`[id="${titleId}"]`)).toBeTruthy();
    expect(host.querySelector(`[id="${descriptionId}"]`)).toBeTruthy();
    expect(dialog?.querySelector('[data-admin-drawer-close="true"]')).toBeTruthy();
    expect(host.querySelector('[data-admin-form-section="true"]')).toBeTruthy();
    expect(host.querySelector('[data-admin-form-actions="true"]')).toBeTruthy();
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label^="Model name"]')?.id
    ).toMatch(/^admin-field-/);
  });

  it("shows maxReferenceImages only for image-capable model drawers", () => {
    const imageHtml = renderAdminModelsSection(
      "en-US",
      { mode: "edit", modelId: "model_deepseek" },
      { capability: "image", maxReferenceImages: 4, hydrateFromModel: true }
    );
    const chatHtml = renderAdminModelsSection("en-US", {
      mode: "edit",
      modelId: "model_deepseek"
    });

    expect(imageHtml).toContain("Maximum reference images");
    const imageHost = document.createElement("div");
    imageHost.innerHTML = imageHtml;
    const imageInput = imageHost.querySelector<HTMLInputElement>(
      'input[aria-label^="Maximum reference images"]'
    );
    expect(imageInput?.max).toBe("4");
    expect(imageInput?.min).toBe("0");
    expect(imageInput?.step).toBe("1");
    expect(imageInput?.value).toBe("4");
    expect(imageHtml).toContain("maximum reference-image count");
    expect(chatHtml).not.toContain("Maximum reference images");
  });

  it("defaults a new image model maxReferenceImages field to 1", () => {
    const html = renderAdminModelsSection(
      "en-US",
      { mode: "create" },
      { capability: "image" }
    );

    expect(html).toContain("Maximum reference images");
    const host = document.createElement("div");
    host.innerHTML = html;
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label^="Maximum reference images"]'
    );
    expect(input?.max).toBe("4");
    expect(input?.min).toBe("0");
    expect(input?.step).toBe("1");
    expect(input?.value).toBe("1");
  });

  it("parses only integer maxReferenceImages values from 0 through 4", () => {
    expect(
      parseModelForm({ ...modelForm, maxReferenceImages: "0" })
    ).toMatchObject({ maxReferenceImages: 0 });
    expect(
      parseModelForm({ ...modelForm, maxReferenceImages: "4" })
    ).toMatchObject({ maxReferenceImages: 4 });

    for (const maxReferenceImages of ["-1", "5", "1.5", "not-a-number"]) {
      expect(parseModelForm({ ...modelForm, maxReferenceImages })).toBeNull();
    }
  });

  it("renders the admin model routes area and route fields", () => {
    const html = renderAdminModelsSection("en-US", {
      mode: "edit",
      modelId: "model_deepseek"
    });

    expect(html).toContain("Provider account");
    expect(html).toContain("Upstream model ID");
    expect(html).toContain("Route priority");
    expect(html).toContain("Enabled routes");
    expect(html).toContain("Total routes");
    expect(html).toContain("Sub2API Main");
    expect(html).toContain("deepseek-ai/DeepSeek-V3");
    expect(html).toContain("测试此线路");
  });

  it("keeps add route, save model, and save route controls available", () => {
    const html = renderAdminModelsSection("en-US", {
      mode: "edit",
      modelId: "model_deepseek"
    });

    expect(html).toContain("Add route");
    expect(html).toContain("Save route");
    expect(html).toContain("Disable route");
    expect(html).toContain(">Save<");
  });

  it("warns when a bound provider account testModel differs from the real model ID", () => {
    const warning = getModelTestModelMismatchWarning(
      {
        modelId: "deepseek-v4-flash",
        providerAccountId: "provider_account_1"
      },
      [
        {
          id: "provider_account_1",
          name: "SUB2API Claude",
          providerType: "SUB2API",
          baseUrl: "https://sub2api.example",
          capabilities: ["chat"],
          enabled: true,
          priority: 0,
          timeoutMs: 60000,
          configJson: { testModel: "deepseek-v4-flash-free" },
          notes: null,
          hasApiKey: true,
          hasCustomHeaders: false,
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z"
        }
      ]
    );

    expect(warning).toBe("deepseek-v4-flash-free");
    expect(createTranslator("zh-CN")("admin.modelTestModelMismatchWarning")).toBe(
      "测试连接使用的是 testModel，正式聊天使用当前模型的真实模型 ID。请确认两者是否一致。"
    );
  });

  it("does not warn when testModel matches the real model ID or no provider account is bound", () => {
    const account = {
      id: "provider_account_1",
      name: "SUB2API Claude",
      providerType: "SUB2API" as const,
      baseUrl: "https://sub2api.example",
      capabilities: ["chat" as const],
      enabled: true,
      priority: 0,
      timeoutMs: 60000,
      configJson: { testModel: "deepseek-v4-flash" },
      notes: null,
      hasApiKey: true,
      hasCustomHeaders: false,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    };

    expect(readProviderAccountTestModel(account)).toBe("deepseek-v4-flash");
    expect(
      getModelTestModelMismatchWarning(
        {
          modelId: "deepseek-v4-flash",
          providerAccountId: "provider_account_1"
        },
        [account]
      )
    ).toBeNull();
    expect(
      getModelTestModelMismatchWarning(
        {
          modelId: "deepseek-v4-flash",
          providerAccountId: ""
        },
        [account]
      )
    ).toBeNull();
  });

  it("keeps model save parsing independent from provider account testModel", () => {
    const form = {
      modelId: "deepseek-v4-flash",
      providerAccountId: "provider_account_1"
    };
    const warning = getModelTestModelMismatchWarning(form, [
      {
        id: "provider_account_1",
        name: "SUB2API Claude",
        providerType: "SUB2API",
        baseUrl: "https://sub2api.example",
        capabilities: ["chat"],
        enabled: true,
        priority: 0,
        timeoutMs: 60000,
        configJson: { testModel: "deepseek-v4-flash-free" },
        notes: null,
        hasApiKey: true,
        hasCustomHeaders: false,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z"
      }
    ]);

    expect(warning).toBe("deepseek-v4-flash-free");
    expect(form.modelId).toBe("deepseek-v4-flash");
    expect(form.modelId).not.toBe("deepseek-v4-flash-free");
  });

  it("renders /admin while loading", () => {
    const html = renderAdminPageWithLocale("en-US");

    expect(html).toContain("Overview");
    expect(html).toContain(
      "Monitor key user, usage, order, and operational signals."
    );
    expect(html).toContain("Loading admin data...");
    expect(html).not.toContain('href="/pricing"');
    expect(html).not.toContain("©");
  });

  it("defines Overview as the default admin section", () => {
    expect(defaultAdminSection).toBe("overview");
    expect(adminSections.map((section) => section.id)).toEqual([
      "overview",
      "users",
      "feedback",
      "models",
      "providerAccounts",
      "moderation",
      "plans",
      "orders",
      "payments",
      "storageSubscriptions",
      "settings",
      "links",
      "contact",
      "operations",
      "usage",
      "audit"
    ]);
  });

  it("renders section navigation with the active section highlighted", () => {
    const html = renderAdminSectionTabs("en-US");

    expect(html).toContain('role="tablist"');
    expect(html).toContain("Overview");
    expect(html).toContain("Users");
    expect(html).toContain("Models");
    expect(html).toContain("Provider Accounts");
    expect(html).toContain("Usage Logs");
    expect(html).toContain('aria-current="page"');
  });

  it("can render Models as the active admin navigation tab", () => {
    const html = renderAdminSectionTabs("en-US", "models");

    expect(html).toContain("Models");
    expect(html).toContain('data-active-section="models"');
  });

  it("renders the admin sidebar navigation and highlights the active section", () => {
    const html = renderAdminSidebar("zh-CN", "models");

    expect(html).toContain("仪表盘");
    expect(html).toContain("用户与额度");
    expect(html).toContain("用户反馈");
    expect(html).toContain("模型管理");
    expect(html).toContain("供应商账号");
    expect(html).toContain("AI 平台");
    expect(html).toContain("信任与安全");
    expect(html).toContain("内容审核");
    expect(html).toContain("套餐与定价");
    expect(html).toContain("订单与复核");
    expect(html).toContain("支付方式");
    expect(html).toContain("使用记录");
    expect(html).toContain("审计日志");
    expect(html).toContain("站点与产品");
    expect(html).toContain("商业");
    expect(html).toContain("客户");
    expect(html).toContain("运营");
    expect(html).toContain("失败与预算");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("bg-indigo-50");
  });

  it("keeps Site and Product highlighted for the legacy settings cluster", () => {
    const html = renderAdminSidebar("en-US", "payments");

    expect(html).toContain("Site &amp; Product");
    expect(html).toContain('aria-current="page"');
  });

  it("renders admin save feedback as a fixed toast", () => {
    const html = renderAdminToast("en-US");

    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain("fixed right-4 top-4");
    expect(html).toContain("Site settings saved.");
    expect(html).toContain('aria-label="Dismiss message"');
  });

  it("defaults to overflow-x without vertical height constraint", () => {
    const html = renderScrollableRegion();

    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("max-h-[520px]");
    expect(html).toContain("bounded content");
  });

  it("supports opt-in vertical scrolling via maxHeight prop", () => {
    const html = renderToStaticMarkup(
      <AdminScrollableRegion maxHeight="300px">
        <table><tbody><tr><td>long</td></tr></tbody></table>
      </AdminScrollableRegion>
    );

    expect(html).toContain("max-height:300px");
    expect(html).toContain("overflow-auto");
    expect(html).toContain("long");
  });

  // Payment observability tests
  it("has payment provider and trade number i18n keys", () => {
    const t = createTranslator("zh-CN");
    expect(t("payment.provider")).toBe("支付方式");
    expect(t("payment.tradeNo")).toBe("交易号");
  });

  it("payment i18n keys do not expose EPAY_KEY", () => {
    const t = createTranslator("zh-CN");
    const tEn = createTranslator("en-US");
    // No translation key should contain "EPAY_KEY" or similar sensitive terms
    const keys = [
      "payment.provider", "payment.tradeNo", "payment.payNow",
      "payment.success", "payment.pending", "payment.cancelled",
      "admin.paymentSettings", "admin.merchantKey"
    ];
    for (const key of keys) {
      expect(t(key)).not.toContain("EPAY_KEY");
      expect(t(key)).not.toContain("secret");
      expect(tEn(key)).not.toContain("EPAY_KEY");
      expect(tEn(key)).not.toContain("secret");
    }
  });

  it("renders generated asset storage info in Chinese", () => {
    const html = renderGeneratedAssetStorageInfo("zh-CN");

    expect(html).toContain("生成资产存储说明");
    expect(html).toContain("GENERATED_ASSETS_DIR");
    expect(html).toContain("GENERATED_ASSETS_PUBLIC_PATH");
    expect(html).toContain("Docker/GHCR");
    expect(html).toContain("只读说明");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("type=\"submit\"");
  });

  it("renders generated asset storage info in English", () => {
    const html = renderGeneratedAssetStorageInfo("en-US");

    expect(html).toContain("Generated asset storage");
    expect(html).toContain("GENERATED_ASSETS_DIR");
    expect(html).toContain("GENERATED_ASSETS_PUBLIC_PATH");
    expect(html).toContain("persistent volume");
    expect(html).toContain("read-only");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("type=\"submit\"");
  });

  it("shows Docker volume example and future object storage notice", () => {
    const html = renderGeneratedAssetStorageInfo("en-US");

    expect(html).toContain("docker-compose");
    expect(html).toContain("/app/storage/generated-assets");
    expect(html).toContain("Cloudflare R2");
    expect(html).toContain("object storage");
  });

  it("does not contain editable form elements or save buttons", () => {
    const htmlZh = renderGeneratedAssetStorageInfo("zh-CN");
    const htmlEn = renderGeneratedAssetStorageInfo("en-US");

    for (const html of [htmlZh, htmlEn]) {
      expect(html).not.toContain("<input");
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain("<select");
      expect(html).not.toContain("type=\"submit\"");
      expect(html).not.toContain("保存");
      expect(html).not.toContain("Save");
    }
  });
});
