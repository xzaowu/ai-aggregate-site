import type {
  AdminAiModelSummary,
  SiteSettingSummary
} from "@ai-aggregate/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import type { Locale } from "../../lib/i18n/types";
import {
  AdminSettingsSection,
  AdminStorageOfferSettings,
  AdminTitleCoverBudgetSettings,
  type SettingsFormState
} from "./admin-settings-section";

const settings: SiteSettingSummary[] = [
  {
    key: "siteName",
    value: "AI Aggregate",
    type: "string",
    description: "Site name",
    updatedAt: "2026-06-11T00:00:00.000Z"
  },
  {
    key: "siteAnnouncement",
    value: "New models are available.",
    type: "string",
    description: "Announcement",
    updatedAt: "2026-06-11T00:00:00.000Z"
  },
  {
    key: "workspaceLinksLabel",
    value: "External resources",
    type: "string",
    description: "Workspace links label",
    updatedAt: "2026-06-11T00:00:00.000Z"
  },
  {
    key: "defaultModel",
    value: "gpt-test",
    type: "string",
    description: "Default model",
    updatedAt: "2026-06-11T00:00:00.000Z"
  }
];

const form: SettingsFormState = {
  siteName: "AI Aggregate",
  siteLogoText: "Agg",
  siteLogoUrl: "https://example.com/logo.png",
  siteFaviconUrl: "https://example.com/favicon.ico",
  workspaceIconUrl: "https://example.com/workspace-icon.png",
  siteAnnouncement: "New models are available.",
  publicNotice: "Public beta notice",
  publicNoticeEnabled: true,
  contactEmail: "support@example.com",
  defaultModel: "gpt-test",
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
  homeHeroTitle: "",
  homeHeroSubtitle: "",
  homePrimaryCta: "Start creating",
  homeSecondaryCta: "View plans",
  betaNotice: "Beta access",
  homePrimaryCtaText: "",
  homeSecondaryCtaText: "",
  homeBetaNotice: "",
  homeRightCardNotice: "",
  footerSlogan: "",
  footerCopyright: "Copyright 2026",
  footerLinksJson: JSON.stringify([{ label: "Status", href: "/status" }]),
  homeFeatureCards: "",
  workspaceLinksLabel: "External resources",
  workspaceTitle: "Custom workspace hero",
  workspaceSubtitle: "Custom workspace subtitle",
  workspacePromptPlaceholder: "Ask anything",
  workspaceHint: "Use concise prompts.",
  workspaceHeroTitle: "Custom workspace hero",
  workspaceHeroSubtitle: "Custom workspace subtitle",
  workspacePromptCards: JSON.stringify([
    {
      title: "Plan rollout",
      description: "Turn an idea into executable steps.",
      prompt: "Help me plan this rollout:"
    }
  ]),
  imagePromptCards: "",
  helpContentJson: ""
};

const models: AdminAiModelSummary[] = [
  {
    id: "model_gpt_test",
    name: "GPT Test",
    slug: "gpt-test",
    provider: "SUB2API",
    modelId: "gpt-test",
    capability: "chat",
    group: "free",
    tags: [],
    enabled: true,
    maxReferenceImages: 1,
    creditCost: 1,
    allowGuest: true,
    sortOrder: 0,
    isRecommended: true
  }
];

function renderWithLocale(
  locale: Locale,
  props: Partial<React.ComponentProps<typeof AdminSettingsSection>> = {}
) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminSettingsSection
        activeArea="brand"
        form={form}
        models={models}
        saving={false}
        settings={settings}
        onChange={vi.fn()}
        onSave={vi.fn()}
        {...props}
      />
    </I18nContext.Provider>
  );
}

describe("admin settings section", () => {
  it("renders only Brand and Public Pages controls in English", () => {
    const html = renderWithLocale("en-US");

    expect(html).toContain("Brand &amp; Public Pages");
    expect(html).toContain("Site name");
    expect(html).toContain("Basic brand");
    expect(html).toContain("Home display");
    expect(html).toContain("Notices");
    expect(html).toContain("Footer and links");
    expect(html).toContain("Site Logo URL");
    expect(html).toContain("Logo text");
    expect(html).toContain("Favicon URL");
    expect(html).toContain("Public notice");
    expect(html).toContain("Footer copyright");
    expect(html).toContain("Footer links JSON");
    expect(html).toContain("Right-card notice");
    expect(html).toContain("Footer slogan");
    expect(html).toContain("Legacy homepage field");
    expect(html).toContain("Please enter a valid JSON array");
    expect(html).toContain("font-mono");
    expect(html).toContain("Expected format: JSON array of objects with label and href.");
    expect(html).toContain("This JSON controls footer navigation only");
    expect(html).toContain("Multi-model chat");
    expect(html).not.toContain("support@example.com");
    expect(html).not.toContain("Default model");
    expect(html).not.toContain("Public registration");
    expect(html).not.toContain("Enable daily check-in");
  });

  it("renders only Workspace and AI Workflow controls", () => {
    const html = renderWithLocale("en-US", { activeArea: "workspace" });

    expect(html).toContain("Workspace &amp; AI Workflows");
    expect(html).toContain("Workspace display");
    expect(html).toContain("Workspace defaults and legacy content");
    expect(html).toContain("Workspace icon URL");
    expect(html).toContain("Workspace prompt cards");
    expect(html).toContain("Image creation prompt cards");
    expect(html).toContain("Default model");
    expect(html).toContain("Title Cover Visual Brief");
    expect(html).not.toContain("Basic brand");
    expect(html).not.toContain("Public registration");
    expect(html).not.toContain("启用每日签到");
  });

  it("renders Access and Limits with one registration control", () => {
    const html = renderWithLocale("en-US", { activeArea: "access" });

    expect(html).toContain("Access &amp; Limits");
    expect(html).toContain("Guest mode enabled");
    expect(html).toContain("Guest daily limit");
    expect(html).toContain("Profile update protection");
    expect(html).toContain("Reference image protection");
    expect(html).toContain("Public registration");
    expect(html.match(/Public registration/g)).toHaveLength(1);
    expect(html).not.toContain("Default model");
    expect(html).not.toContain("Site name");
    expect(html).not.toContain("启用每日签到");
  });

  it("renders Benefits and Growth without Commerce storage controls", () => {
    const html = renderWithLocale("en-US", { activeArea: "benefits" });

    expect(html).toContain("Benefits &amp; Growth");
    expect(html).toContain("启用每日签到");
    expect(html).toContain("启用邀请有礼");
    expect(html).not.toContain("启用资源存储包");
    expect(html).not.toContain("Public registration");
    expect(html).not.toContain("Default model");
    expect(html).not.toContain("Site name");
  });

  it("renders storage offer policy as a Commerce responsibility", () => {
    const html = renderToStaticMarkup(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <AdminStorageOfferSettings
          form={{
            ...form,
            storagePackageEnabled: true,
            storagePackagePriceCredits: "60",
            storagePackageDurationDays: "30",
            storagePackageAutoRenewEnabled: true,
            storagePackageDescription: "Keep generated assets"
          }}
          saving={false}
          onChange={vi.fn()}
          onSave={vi.fn()}
        />
      </I18nContext.Provider>
    );

    expect(html).toContain("Storage Package Offer");
    expect(html).toContain("Commerce responsibility");
    expect(html).toContain("60");
    expect(html).toContain("30");
    expect(html).toContain("Keep generated assets");
  });

  it("moves only the Title Cover daily budget guardrail to Operations", () => {
    const workspaceHtml = renderWithLocale("en-US", {
      activeArea: "workspace",
      form: {
        ...form,
        titleCoverBriefCostCredits: "3",
        titleCoverBriefDailyBudgetCredits: "100"
      }
    });
    const operationsHtml = renderToStaticMarkup(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <AdminTitleCoverBudgetSettings
          form={{
            ...form,
            titleCoverBriefCostCredits: "3",
            titleCoverBriefDailyBudgetCredits: "100"
          }}
          saving={false}
          onChange={vi.fn()}
          onSave={vi.fn()}
        />
      </I18nContext.Provider>
    );

    expect(workspaceHtml).toContain("Internal cost credits");
    expect(workspaceHtml).not.toContain("Daily budget credits");
    expect(operationsHtml).toContain("Title Cover Budget Guardrail");
    expect(operationsHtml).toContain("Daily budget credits");
    expect(operationsHtml).toContain("100");
  });

  it("keeps settings textareas compact instead of rendering giant empty editors", () => {
    const html = renderWithLocale("en-US");

    expect(html).not.toContain("lg:min-h-[680px]");
    expect(html).toContain('rows="3"');
    expect(html).toContain('rows="5"');
  });

  it("uses shared form sections and associates field help with controls", () => {
    const html = renderWithLocale("en-US", { activeArea: "workspace" });

    expect(html).toContain('data-admin-form-section="true"');
    expect(html).toContain('data-admin-form-field="true"');
    expect(html).toMatch(/<input[^>]*id="admin-field-[^"]+"/);
    expect(html).toMatch(
      /<input[^>]*aria-describedby="admin-field-[^"]+-help"[^>]*>/
    );
    expect(html).toContain('data-admin-form-actions="true"');
  });

  it("keeps the existing save disabled state while using shared actions", () => {
    const html = renderWithLocale("en-US", { saving: true });

    expect(html).toMatch(/<button[^>]*disabled[^>]*>Saving\.\.\.<\/button>/);
    expect(html).toContain('data-admin-form-actions="true"');
  });

  it("renders with empty settings", () => {
    const html = renderWithLocale("en-US", {
      settings: []
    });

    expect(html).toContain("Brand &amp; Public Pages");
    expect(html).toContain("0 settings loaded");
  });

  it("offers only enabled chat models and shows enabled route counts for Title Cover Visual Brief", () => {
    const baseModel = models[0]!;
    const chatModel = {
      ...baseModel,
      id: "model-chatgpt",
      name: "ChatGPT",
      displayName: "ChatGPT",
      slug: "chatgpt",
      modelId: "chatgpt",
      routes: Array.from({ length: 4 }, (_, index) => ({
        id: `route-chatgpt-${index}`,
        modelId: "model-chatgpt",
        providerId: `provider-${index}`,
        upstreamModel: `chatgpt-${index}`,
        priority: index + 1,
        enabled: true,
        createdAt: "2026-06-11T00:00:00.000Z",
        updatedAt: "2026-06-11T00:00:00.000Z"
      }))
    } satisfies AdminAiModelSummary;
    const glmModel = {
      ...baseModel,
      id: "model-glm",
      name: "GLM",
      displayName: "GLM",
      slug: "glm",
      modelId: "glm",
      routes: [
        {
          id: "route-glm-1",
          modelId: "model-glm",
          providerId: "provider-glm",
          upstreamModel: "glm-upstream",
          priority: 1,
          enabled: true,
          createdAt: "2026-06-11T00:00:00.000Z",
          updatedAt: "2026-06-11T00:00:00.000Z"
        }
      ]
    } satisfies AdminAiModelSummary;
    const imageModel = {
      ...baseModel,
      id: "model-image",
      name: "Image only",
      slug: "image-only",
      modelId: "image-only",
      capability: "image" as const
    } satisfies AdminAiModelSummary;

    const html = renderWithLocale("en-US", {
      activeArea: "workspace",
      form: {
        ...form,
        titleCoverBriefModelId: "chatgpt",
        titleCoverBriefCostCredits: "2",
        titleCoverBriefDailyBudgetCredits: "100"
      },
      models: [chatModel, glmModel, imageModel]
    });

    expect(html).toContain("Title Cover Visual Brief");
    expect(html).toContain("ChatGPT · 4 routes");
    expect(html).toContain("GLM · 1 route");
    expect(html).not.toContain("Image only ·");
    expect(html).toContain("The selected logical model uses its configured Provider/Route fallback.");
    expect(html).toContain('value="chatgpt"');
    expect(html).toContain('value="2"');
    expect(html).not.toContain('value="100"');
  });

  it("renders when settings and models are missing", () => {
    expect(() =>
      renderWithLocale("en-US", {
        settings: undefined as unknown as SiteSettingSummary[],
        models: undefined as unknown as AdminAiModelSummary[]
      })
    ).not.toThrow();
  });

  it("renders site settings controls in Chinese", () => {
    const html = renderWithLocale("zh-CN", { activeArea: "access" });

    expect(html).toContain("访问与限制");
    expect(html).toContain("访客每日限额");
    expect(html).toContain("游客接口防刷");
    expect(html).toContain("单个模型每小时请求上限");
    expect(html).toContain("短时突发请求上限");
    expect(html).toContain("突发窗口秒数");
    expect(html).toContain("全站开放注册");
  });
});
