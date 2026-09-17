import { describe, expect, it, vi } from "vitest";
import type { OrderStatus, UsageLogStatus, UserRole } from "@ai-aggregate/shared";
import { enUS } from "./dictionaries/en-US";
import { zhCN } from "./dictionaries/zh-CN";
import {
  createTranslator,
  defaultLocale,
  getAuditActionLabel,
  getOrderStatusLabel,
  getUsageLogStatusLabel,
  getUserRoleLabel,
  localeStorageKey,
  persistLocale,
  readStoredLocale
} from "./use-i18n";

function createStorage(initialValues: Record<string, string> = {}) {
  const values = new Map(Object.entries(initialValues));

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    value(key: string) {
      return values.get(key) ?? null;
    }
  };
}

describe("i18n helpers", () => {
  it("defaults to zh-CN when localStorage has no supported locale", () => {
    expect(defaultLocale).toBe("zh-CN");
    expect(readStoredLocale(createStorage())).toBe("zh-CN");
    expect(
      readStoredLocale(createStorage({ [localeStorageKey]: "fr-FR" }))
    ).toBe("zh-CN");
  });

  it("uses en-US from localStorage and persists locale changes", () => {
    const storage = createStorage({ [localeStorageKey]: "en-US" });

    expect(readStoredLocale(storage)).toBe("en-US");

    persistLocale(storage, "zh-CN");

    expect(storage.setItem).toHaveBeenCalledWith(localeStorageKey, "zh-CN");
    expect(storage.value(localeStorageKey)).toBe("zh-CN");
  });

  it("falls back to Chinese and then the key when translations are missing", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");

    expect(english("chat.title")).toBe("Chat");
    expect(english("test.onlyChineseFallback")).toBe("仅中文回退");
    expect(chinese("test.missingKey")).toBe("test.missingKey");
  });

  it("keeps pricing composed messages fully localized", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");

    expect(english("pricing.intro")).toBe(
      "Choose the credit package that fits your usage."
    );
    expect(english("pricing.manualNotice")).toBe(
      "Orders are currently confirmed manually. Credits will be added after an administrator confirms the order."
    );
    expect(english("pricing.orderCreatedMessage")).toBe(
      "Order created. Manual confirmation mode. Credits are issued after an admin confirms payment."
    );
    expect(chinese("pricing.intro")).toBe(
      "选择适合你的额度包。"
    );
    expect(chinese("pricing.manualNotice")).toBe(
      "当前为人工确认订单模式。提交订单后，管理员确认后会发放对应额度。"
    );
    expect(chinese("pricing.orderCreatedMessage")).toBe(
      "订单已创建。当前为人工确认模式，等待管理员确认后发放额度。"
    );
    expect(english("pricing.currentBalance")).toBe("Current balance");
    expect(english("pricing.singleUseDescription")).toBe(
      "Actual usage is calculated from the selected model and feature settings."
    );
    expect(chinese("pricing.currentBalance")).toBe("当前余额");
    expect(chinese("pricing.singleUseDescription")).toBe(
      "实际消耗按所选模型和功能配置计算。"
    );
  });

  it("translates model billing labels for both locales", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");

    expect(english("admin.modelBilling")).toBe("Model billing");
    expect(english("admin.creditCost")).toBe("Credit cost");
    expect(english("admin.allowGuestUsage")).toBe("Allow guest usage");
    expect(english("chat.recommended")).toBe("Recommended");
    expect(english("chat.group.free")).toBe("Free Models");
    expect(english("chat.group.reasoning")).toBe("Reasoning Models");
    expect(english("chat.group.advanced")).toBe("Advanced Models");
    expect(english("chat.group.coding")).toBe("Coding Models");
    expect(english("admin.modelTags")).toBe("Model tags");
    expect(english("admin.modelGroup")).toBe("Model group");
    expect(english("admin.modelCapability")).toBe("Model capability");
    expect(english("admin.modelCapability.image")).toBe("Image");
    expect(english("admin.modelDescription")).toBe("Model description");
    expect(english("admin.provider")).toBe("Provider");
    expect(english("admin.modelCompatibilityProvider")).toBe(
      "Legacy provider category"
    );
    expect(chinese("admin.modelCompatibilityProvider")).toBe(
      "旧版 Provider 分类"
    );
    expect(english("admin.group.siteProduct")).toBe("Site & Product");
    expect(chinese("admin.group.siteProduct")).toBe("站点与产品");
    expect(english("admin.settingsArea.brand")).toBe(
      "Brand & Public Pages"
    );
    expect(english("admin.settingsArea.workspace")).toBe(
      "Workspace & AI Workflows"
    );
    expect(english("admin.settingsArea.access")).toBe("Access & Limits");
    expect(english("admin.settingsArea.benefits")).toBe("Benefits & Growth");
    expect(english("admin.recommendedModel")).toBe("Recommended model");
    expect(english("chat.goodForGeneralChat")).toBe("Good for general chat");
    expect(english("chat.goodForComplexReasoning")).toBe(
      "Good for complex reasoning"
    );
    expect(english("chat.noModelsAvailable")).toBe("No models available");
    expect(english("chat.signInRequired")).toBe("Sign-in required");
    expect(english("chat.modelRequiresSignIn")).toBe(
      "This model requires sign-in"
    );
    expect(
      english("chat.insufficientCreditsForModel", {
        count: 3
      })
    ).toBe("Insufficient credits. This model requires 3 credits per message");
    expect(chinese("admin.modelBilling")).toBe("模型计费");
    expect(chinese("admin.creditCost")).toBe("单次消耗额度");
    expect(chinese("admin.modelCapability")).toBe("模型能力");
    expect(chinese("admin.modelCapability.image")).toBe("图像");
    expect(chinese("admin.allowGuestUsage")).toBe("允许游客使用");
    expect(chinese("chat.signInRequired")).toBe("登录后可用");
    expect(chinese("chat.modelRequiresSignIn")).toBe("该模型需要登录后使用");
    expect(
      chinese("chat.insufficientCreditsForModel", {
        count: 3
      })
    ).toBe("额度不足，当前模型每次需要 3 额度");
  });

  it("translates operations overview labels for both locales", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");

    expect(english("admin.operationsOverview")).toBe("Operations Overview");
    expect(english("admin.callsToday")).toBe("Calls Today");
    expect(english("admin.creditsUsedToday")).toBe("Credits Used Today");
    expect(english("admin.pendingOrders")).toBe("Pending Orders");
    expect(english("admin.topModelsByCalls")).toBe("Top Models by Calls");
    expect(english("admin.pendingOrdersNotice", { count: 2 })).toBe(
      "2 orders are waiting for confirmation"
    );
    expect(chinese("admin.operationsOverview")).toBe("运营概览");
    expect(chinese("admin.callsToday")).toBe("今日调用");
    expect(chinese("admin.creditsUsedToday")).toBe("今日消耗额度");
    expect(chinese("admin.pendingOrders")).toBe("待确认订单");
    expect(chinese("admin.topModelsByCalls")).toBe("模型调用排行");
    expect(chinese("admin.pendingOrdersNotice", { count: 2 })).toBe(
      "有 2 个订单等待确认"
    );
  });

  it("translates site settings labels for both locales", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");

    expect(english("admin.siteSettings")).toBe("Site Settings");
    expect(english("admin.setting.siteName")).toBe("Site name");
    expect(english("admin.setting.defaultModel")).toBe("Default model");
    expect(english("admin.setting.guestDailyLimit")).toBe("Guest daily limit");
    expect(english("admin.guestRateLimit.title")).toBe("Guest rate limiting");
    expect(english("admin.setting.guestPerModelHourlyLimit")).toBe(
      "Per-model hourly limit"
    );
    expect(english("admin.settingsSaved")).toBe("Site settings saved.");
    expect(english("admin.homeRightCardNotice")).toBe("Right-card notice");
    expect(english("admin.footerSlogan")).toBe("Footer slogan");
    expect(english("admin.settingGroup.basicSiteInfo")).toBe("Basic site info");
    expect(english("admin.settingGroup.chatWorkspace")).toBe(
      "Chat workspace settings"
    );
    expect(english("admin.settingGroup.notices")).toBe("Notices");
    expect(english("admin.settingGroup.legacyHomepage")).toBe(
      "Legacy homepage settings"
    );
    expect(english("admin.workspaceHeroTitle")).toBe("Workspace hero title");
    expect(english("admin.workspacePromptCards")).toBe("Workspace prompt cards");
    expect(english("admin.imagePromptCards")).toBe("Image creation prompt cards");
    expect(english("admin.legacyHomepageFieldHelp")).toBe(
      "Legacy homepage field. It may not take effect while chat workspace mode is active."
    );
    expect(english("chat.guestModeDisabled")).toBe(
      "Guest mode is disabled. Please sign in to continue."
    );
    expect(english("login.registrationDisabled")).toBe(
      "Registration is currently disabled."
    );
    expect(chinese("admin.siteSettings")).toBe("站点设置");
    expect(chinese("admin.setting.siteName")).toBe("站点名称");
    expect(chinese("admin.setting.defaultModel")).toBe("默认模型");
    expect(chinese("admin.setting.guestDailyLimit")).toBe("访客每日限额");
    expect(chinese("admin.guestRateLimit.title")).toBe("游客接口防刷");
    expect(chinese("admin.setting.guestPerModelHourlyLimit")).toBe(
      "单个模型每小时请求上限"
    );
  });

  it("marks setup plans as optional warning-only", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");

    expect(english("setup.optional")).toBe("Optional");
    expect(english("setup.skippable")).toBe("Skippable");
    expect(english("setup.planWarning")).toBe(
      "No plans are configured, so users cannot buy credits for now. You can configure plans later in Admin."
    );
    expect(chinese("setup.planWarning")).toBe(
      "未配置套餐，用户暂时无法购买额度，可稍后在后台配置。"
    );
  });

  it("translates known audit actions and formats unknown actions readably", () => {
    const english = createTranslator("en-US");

    expect(getAuditActionLabel("DELETE_MODEL", english)).toBe("Delete model");
    expect(getAuditActionLabel("ARCHIVE_FEEDBACK", english)).toBe(
      "Archive feedback"
    );
    expect(getAuditActionLabel("DELETE_FEEDBACK", english)).toBe(
      "Delete feedback"
    );
    expect(getAuditActionLabel("UPDATE_HOME_SETTINGS", english)).toBe(
      "Update home settings"
    );
    expect(getAuditActionLabel("SOME_NEW_ACTION", english)).toBe(
      "Some new action"
    );
  });

  it("translates admin section and model display-name labels for both locales", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");

    expect(english("admin.section.overview")).toBe("Overview");
    expect(english("admin.section.users")).toBe("Users");
    expect(english("admin.section.models")).toBe("Models");
    expect(english("admin.section.plans")).toBe("Plans");
    expect(english("admin.section.orders")).toBe("Orders");
    expect(english("admin.section.usage")).toBe("Usage Logs");
    expect(english("admin.section.settings")).toBe("Site Settings");
    expect(english("admin.addModel")).toBe("Add model");
    expect(english("admin.deleteModel")).toBe("Delete model");
    expect(english("admin.disableModel")).toBe("Disable model");
    expect(english("admin.enableModel")).toBe("Enable model");
    expect(english("admin.displayName")).toBe("Display name");
    expect(english("admin.realModelId")).toBe("Real model ID");
    expect(english("admin.customDisplayName")).toBe("Custom display name");
    expect(english("admin.displayNameHelp")).toBe(
      "Only affects frontend display, not backend routing"
    );
    expect(english("admin.copyModelId")).toBe("Copy model ID");
    expect(english("admin.modelIdCopied")).toBe("Model ID copied");
    expect(english("admin.confirmDeleteModel")).toBe("Delete this model?");
    expect(english("admin.noModels")).toBe("No models yet");

    expect(chinese("admin.section.overview")).toBe("概览");
    expect(chinese("admin.section.users")).toBe("用户");
    expect(chinese("admin.section.models")).toBe("模型");
    expect(chinese("admin.section.plans")).toBe("套餐");
    expect(chinese("admin.section.orders")).toBe("订单");
    expect(chinese("admin.section.usage")).toBe("使用记录");
    expect(chinese("admin.section.settings")).toBe("站点设置");
    expect(chinese("admin.addModel")).toBe("添加模型");
    expect(chinese("admin.deleteModel")).toBe("删除模型");
    expect(chinese("admin.disableModel")).toBe("停用模型");
    expect(chinese("admin.enableModel")).toBe("启用模型");
    expect(chinese("admin.displayName")).toBe("显示名称");
    expect(chinese("admin.realModelId")).toBe("真实模型 ID");
    expect(chinese("admin.customDisplayName")).toBe("自定义显示名称");
    expect(chinese("admin.displayNameHelp")).toBe(
      "仅影响前端显示，不影响后端对接"
    );
    expect(chinese("admin.copyModelId")).toBe("复制模型 ID");
    expect(chinese("admin.modelIdCopied")).toBe("模型 ID 已复制");
    expect(chinese("admin.confirmDeleteModel")).toBe("确认删除该模型？");
    expect(chinese("admin.noModels")).toBe("暂无模型");
  });

  it("translates order, usage, and role statuses for both locales", () => {
    const orderStatuses: OrderStatus[] = ["PENDING", "PAID", "CANCELLED"];
    const usageStatuses: UsageLogStatus[] = ["SUCCESS", "FAILED"];
    const roles: UserRole[] = ["USER", "ADMIN"];

    expect(orderStatuses.map((status) => getOrderStatusLabel(status, "zh-CN")))
      .toEqual(["待支付", "已支付", "已取消"]);
    expect(orderStatuses.map((status) => getOrderStatusLabel(status, "en-US")))
      .toEqual(["Pending payment", "Paid", "Cancelled"]);
    expect(createTranslator("zh-CN")("status.order.FAILED")).toBe("已失败");
    expect(createTranslator("en-US")("status.order.FAILED")).toBe("Failed");
    expect(usageStatuses.map((status) => getUsageLogStatusLabel(status, "zh-CN")))
      .toEqual(["成功", "失败"]);
    expect(usageStatuses.map((status) => getUsageLogStatusLabel(status, "en-US")))
      .toEqual(["Success", "Failed"]);
    expect(roles.map((role) => getUserRoleLabel(role, "zh-CN"))).toEqual([
      "用户",
      "管理员"
    ]);
    expect(roles.map((role) => getUserRoleLabel(role, "en-US"))).toEqual([
      "User",
      "Admin"
    ]);
  });

  it("provides every email-verification string in both locales without fallback", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");
    const keys = [
      "login.emailVerification.pendingTitle",
      "login.emailVerification.pendingDescription",
      "login.emailVerification.resend",
      "login.emailVerification.resending",
      "login.emailVerification.resendSuccess",
      "login.emailVerification.resendFailed",
      "login.emailVerification.resendRateLimited",
      "login.emailVerification.retryAfterSeconds",
      "login.emailVerification.backToLogin",
      "login.emailVerification.verifyLoading",
      "login.emailVerification.verified",
      "login.emailVerification.alreadyVerified",
      "login.emailVerification.invalidOrExpired",
      "login.emailVerification.retryableFailure",
      "login.emailVerification.retryVerification",
      "login.emailVerification.manualLogin"
    ];

    for (const key of keys) {
      expect(english(key)).not.toBe(key);
      expect(chinese(key)).not.toBe(key);
    }

    expect(english("login.emailVerification.pendingTitle")).toBe("Check your email");
    expect(chinese("login.emailVerification.pendingTitle")).toBe("请检查邮箱");
    expect(english("login.emailVerification.retryAfterSeconds", { seconds: 12 })).toBe(
      "Try again in 12 seconds."
    );
    expect(chinese("login.emailVerification.retryAfterSeconds", { seconds: 12 })).toBe(
      "请在 12 秒后重试。"
    );
  });

  it("provides login rate-limit strings in both locales without fallback", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");
    const keys = ["login.rateLimited", "login.rateLimitedWithSeconds"];

    for (const key of keys) {
      expect(enUS[key]).toBeDefined();
      expect(zhCN[key]).toBeDefined();
      expect(english(key)).toBe(enUS[key]);
      expect(chinese(key)).toBe(zhCN[key]);
    }

    expect(english("login.rateLimited")).toBe(
      "Too many login attempts. Please try again later."
    );
    expect(english("login.rateLimitedWithSeconds", { seconds: 12 })).toBe(
      "Too many login attempts. Please try again in 12 seconds."
    );
    expect(chinese("login.rateLimited")).toBe("登录尝试过于频繁，请稍后再试。");
    expect(chinese("login.rateLimitedWithSeconds", { seconds: 12 })).toBe(
      "登录尝试过于频繁，请在 12 秒后重试。"
    );
  });

  it("provides every password-reset string in both locales without fallback", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");
    const keys = [
      "login.passwordReset.forgotPassword",
      "login.passwordReset.requestTitle",
      "login.passwordReset.requestDescription",
      "login.passwordReset.emailLabel",
      "login.passwordReset.emailPlaceholder",
      "login.passwordReset.requestSubmit",
      "login.passwordReset.requesting",
      "login.passwordReset.requestPendingTitle",
      "login.passwordReset.requestPendingDescription",
      "login.passwordReset.backToLogin",
      "login.passwordReset.requestInvalidEmail",
      "login.passwordReset.requestFailed",
      "login.passwordReset.requestRateLimited",
      "login.passwordReset.retryAfterSeconds",
      "login.passwordReset.pageTitle",
      "login.passwordReset.pageDescription",
      "login.passwordReset.newPassword",
      "login.passwordReset.confirmPassword",
      "login.passwordReset.submit",
      "login.passwordReset.submitting",
      "login.passwordReset.passwordRequired",
      "login.passwordReset.passwordsDoNotMatch",
      "login.passwordReset.passwordTooShort",
      "login.passwordReset.passwordTooLong",
      "login.passwordReset.complete",
      "login.passwordReset.invalidOrExpired",
      "login.passwordReset.retryableFailure",
      "login.passwordReset.rateLimited",
      "login.passwordReset.manualLogin"
    ];

    for (const key of keys) {
      expect(enUS[key]).toBeDefined();
      expect(zhCN[key]).toBeDefined();
      expect(english(key)).toBe(enUS[key]);
      expect(chinese(key)).toBe(zhCN[key]);
    }

    expect(english("login.passwordReset.forgotPassword")).toBe("Forgot password?");
    expect(chinese("login.passwordReset.forgotPassword")).toBe("忘记密码？");
    expect(english("login.passwordReset.retryAfterSeconds", { seconds: 12 })).toBe(
      "Try again in 12 seconds."
    );
    expect(chinese("login.passwordReset.retryAfterSeconds", { seconds: 12 })).toBe(
      "请在 12 秒后重试。"
    );
  });

  it("provides every account-security string in both locales without fallback", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");
    const keys = [
      "account.security.title",
      "account.security.description",
      "account.security.changePassword",
      "account.security.changePasswordDescription",
      "account.security.currentPassword",
      "account.security.newPassword",
      "account.security.confirmPassword",
      "account.security.submitChangePassword",
      "account.security.changingPassword",
      "account.security.currentPasswordRequired",
      "account.security.currentPasswordInvalid",
      "account.security.newPasswordTooShort",
      "account.security.newPasswordTooLong",
      "account.security.passwordConfirmationMismatch",
      "account.security.newPasswordMustDiffer",
      "account.security.invalidRequest",
      "account.security.authenticationRequired",
      "account.security.passwordChanged",
      "account.security.requestFailed",
      "account.security.apiUnavailable",
      "account.security.rateLimited",
      "account.security.retryAfterSeconds",
      "account.security.cancel",
      "account.security.close",
      "account.security.deviceManagement",
      "account.security.deviceManagementDescription",
      "account.security.currentBrowserLogoutHint",
      "account.security.revokeSessions",
      "account.security.revokeSessionsDescription",
      "account.security.revokeSessionsConfirmTitle",
      "account.security.revokeSessionsConfirmDescription",
      "account.security.revokeSessionsCancel",
      "account.security.revokeSessionsConfirm",
      "account.security.revokingSessions",
      "account.security.sessionsRevoked",
      "account.security.changeEmail",
      "account.security.invoiceBilling",
      "account.security.comingSoon"
    ];

    for (const key of keys) {
      expect(enUS[key]).toBeDefined();
      expect(zhCN[key]).toBeDefined();
      expect(english(key)).toBe(enUS[key]);
      expect(chinese(key)).toBe(zhCN[key]);
    }

    expect(english("account.security.retryAfterSeconds", { seconds: 12 })).toBe(
      "Try again in 12 seconds."
    );
    expect(chinese("account.security.retryAfterSeconds", { seconds: 12 })).toBe(
      "请在 12 秒后重试。"
    );
  });

  it("provides symmetric Admin operations strings without fallback", () => {
    const english = createTranslator("en-US");
    const chinese = createTranslator("zh-CN");
    const keys = [
      "admin.operations",
      "admin.abnormalTasks",
      "admin.manualCompensations",
      "admin.budgets",
      "admin.noData",
      "admin.reliableStatus",
      "admin.refundUnknown",
      "admin.creditIncrease",
      "admin.creditDecrease",
      "admin.creditUnchanged",
      "admin.creditDeltaUnknown",
      "admin.taskId",
      "admin.userId",
      "admin.targetUserId",
      "admin.auditId",
      "admin.taskType",
      "admin.taskStatus",
      "admin.model",
      "admin.provider",
      "admin.route",
      "admin.created",
      "admin.updatedAt",
      "admin.errorClass",
      "admin.chargeStatus",
      "admin.creditReleaseStatus",
      "admin.refundStatus",
      "admin.costRecord",
      "admin.creditDelta",
      "admin.creditChangeStatus",
      "admin.period",
      "admin.scope",
      "admin.limit",
      "admin.used",
      "admin.remaining",
      "admin.costRecorded",
      "admin.costNotRecorded",
      "admin.taskType.image",
      "admin.taskType.video",
      "admin.taskType.ppt",
      "admin.taskType.document",
      "admin.taskStatus.pending",
      "admin.taskStatus.running",
      "admin.taskStatus.succeeded",
      "admin.taskStatus.failed",
      "admin.taskStatus.cancelled",
      "admin.reliableStatus.TASK_FAILED",
      "admin.reliableStatus.CHARGED_AND_FAILED",
      "admin.reliableStatus.BUDGET_NEAR_LIMIT",
      "admin.reliableStatus.BUDGET_EXHAUSTED",
      "admin.reliableStatus.UNKNOWN",
      "admin.chargeStatus.UNKNOWN",
      "admin.chargeStatus.RESERVED",
      "admin.chargeStatus.SETTLED",
      "admin.chargeStatus.RELEASED",
      "admin.creditReleaseStatus.UNKNOWN",
      "admin.creditReleaseStatus.NOT_RELEASED",
      "admin.creditReleaseStatus.RELEASED",
      "admin.compensationStatus.RECORDED",
      "admin.compensationStatus.UNKNOWN",
      "admin.budgetScope.image_generation",
      "admin.budgetScope.chat_completion",
      "admin.budgetScope.admin_provider_test",
      "admin.budgetScope.title_cover_visual_brief",
      "admin.budgetStatus.NOT_INITIALIZED",
      "admin.budgetStatus.NORMAL",
      "admin.budgetStatus.NEAR_LIMIT",
      "admin.budgetStatus.EXHAUSTED"
    ];

    for (const key of keys) {
      expect(enUS[key]).toBeDefined();
      expect(zhCN[key]).toBeDefined();
      expect(english(key)).toBe(enUS[key]);
      expect(chinese(key)).toBe(zhCN[key]);
    }
  });
});
