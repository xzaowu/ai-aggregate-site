"use client";

import type {
  AdminAiModelSummary,
  AiProviderAccountSummary,
  SiteSettingSummary
} from "@ai-aggregate/shared";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { asArray } from "./admin-safe-data";
import type { AdminSettingsAreaId } from "./admin-navigation";
import {
  AdminFormActions,
  AdminFormField,
  AdminFormSection,
  adminControlClass
} from "./admin-layout";

export interface SettingsFormState {
  siteName: string;
  siteLogoText: string;
  siteLogoUrl: string;
  siteFaviconUrl: string;
  workspaceIconUrl: string;
  siteAnnouncement: string;
  publicNotice: string;
  publicNoticeEnabled: boolean;
  contactEmail: string;
  defaultModel: string;
  titleCoverBriefModelId: string;
  titleCoverBriefCostCredits: string;
  titleCoverBriefDailyBudgetCredits: string;
  guestModeEnabled: boolean;
  guestRateLimitEnabled: boolean;
  profileRateLimitEnabled: boolean;
  nicknameUpdateDailyLimit: string;
  avatarUpdateDailyLimit: string;
  referenceImageRateLimitEnabled: boolean;
  referenceImageDailyLimit: string;
  registrationEnabled: boolean;
  registrationClosedMessageZh: string;
  registrationClosedMessageEn: string;
  registrationEmailPolicyEnabled: boolean;
  registrationEmailPolicyMode: "ALL" | "ALLOWLIST" | "DENYLIST";
  registrationAllowedDomainsText: string;
  registrationBlockedDomainsText: string;
  maintenanceModeEnabled: boolean;
  maintenanceMessage: string;
  guestDailyLimit: string;
  guestPerModelHourlyLimit: string;
  guestBurstLimit: string;
  guestBurstWindowSeconds: string;
  guestChatConcurrencyLimit: string;
  userChatConcurrencyLimit: string;
  imageGenerationConcurrencyLimit: string;
  homeHeroTitle: string;
  homeHeroSubtitle: string;
  homePrimaryCta: string;
  homeSecondaryCta: string;
  betaNotice: string;
  homePrimaryCtaText: string;
  homeSecondaryCtaText: string;
  homeBetaNotice: string;
  homeRightCardNotice: string;
  footerSlogan: string;
  footerCopyright: string;
  footerLinksJson: string;
  homeFeatureCards: string;
  workspaceLinksLabel: string;
  workspaceTitle: string;
  workspaceSubtitle: string;
  workspacePromptPlaceholder: string;
  workspaceHint: string;
  workspaceHeroTitle: string;
  workspaceHeroSubtitle: string;
  workspacePromptCards: string;
  imagePromptCards: string;
  storagePackageEnabled?: boolean;
  storagePackagePriceCredits?: string;
  storagePackageDurationDays?: string;
  storagePackageAutoRenewEnabled?: boolean;
  storagePackageDescription?: string;
  checkInEnabled?: boolean;
  checkInDailyRewardCredits?: string;
  checkInStreakRewards?: string;
  referralEnabled?: boolean;
  referralInviterRewardCredits?: string;
  referralInviteeRewardCredits?: string;
  referralRewardTrigger?: string;
  referralRulesText?: string;
  helpContentJson: string;
}

interface AdminSettingsSectionProps {
  activeArea: AdminSettingsAreaId;
  form: SettingsFormState;
  models: AdminAiModelSummary[];
  providerAccounts?: AiProviderAccountSummary[];
  saving: boolean;
  settings: SiteSettingSummary[];
  onChange: (updates: Partial<SettingsFormState>) => void;
  onSave: () => void;
}

export function AdminSettingsSection({
  activeArea,
  form,
  models,
  providerAccounts = [],
  saving,
  settings,
  onChange,
  onSave
}: AdminSettingsSectionProps) {
  const { t } = useI18n();
  const safeModels = asArray<AdminAiModelSummary>(models);
  const safeSettings = asArray<SiteSettingSummary>(settings);
  const enabledModels = safeModels.filter((model) => model.enabled);
  const chatModels = safeModels.filter(
    (model) => model.enabled && model.capability === "chat"
  );
  const safeProviderAccounts = asArray<AiProviderAccountSummary>(providerAccounts);
  const routeCountFor = (model: AdminAiModelSummary): number =>
    (model.routes ?? []).filter((route) => {
      if (!route.enabled) return false;
      if (safeProviderAccounts.length === 0) return true;
      const provider = safeProviderAccounts.find(
        (account) => account.id === route.providerId
      );
      return Boolean(
        provider?.enabled && provider.capabilities.includes("chat")
      );
    }).length;
  const hasCurrentBriefModel = chatModels.some(
    (model) => model.slug === form.titleCoverBriefModelId
  );
  const currentBriefModel = chatModels.find(
    (model) => model.slug === form.titleCoverBriefModelId
  );
  const currentBriefModelUnavailable =
    Boolean(form.titleCoverBriefModelId) &&
    (!currentBriefModel || routeCountFor(currentBriefModel) === 0);
  const hasCurrentDefault = enabledModels.some(
    (model) => model.modelId === form.defaultModel
  );

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 sm:px-5">
        {t(`admin.settingsArea.${activeArea}`)}
      </div>
      <div className="grid min-w-0 gap-4 bg-slate-50/60 p-4 text-sm lg:grid-cols-2 xl:grid-cols-6">
        {activeArea === "brand" ? (
        <AdminSectionCard title={t("admin.settingGroup.basicBrand")} className="xl:col-span-3">
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <AdminField label={t("admin.setting.siteName")}>
              <AdminInput
                value={form.siteName}
                onChange={(siteName) => onChange({ siteName })}
              />
            </AdminField>
            <AdminField label={t("admin.setting.siteLogoText")}>
              <AdminInput
                placeholder="AI"
                value={form.siteLogoText}
                onChange={(siteLogoText) => onChange({ siteLogoText })}
              />
            </AdminField>
            <AdminField label={t("admin.setting.siteLogoUrl")} help={t("admin.logoUrlHelp")}>
              <AdminInput
                placeholder="https://example.com/logo.png"
                value={form.siteLogoUrl}
                onChange={(siteLogoUrl) => onChange({ siteLogoUrl })}
              />
            </AdminField>
            <AdminField label={t("admin.setting.siteFaviconUrl")} help={t("admin.faviconUrlHelp")}>
              <AdminInput
                placeholder="https://example.com/favicon.ico"
                value={form.siteFaviconUrl}
                onChange={(siteFaviconUrl) => onChange({ siteFaviconUrl })}
              />
            </AdminField>
          </div>
        </AdminSectionCard>
        ) : null}

        {activeArea === "workspace" ? (
        <AdminSectionCard title={t("admin.settingGroup.workspaceDisplay")} className="xl:col-span-3">
          <AdminField label={t("admin.workspaceTitle")}>
            <AdminInput
              value={form.workspaceTitle}
              onChange={(workspaceTitle) => onChange({ workspaceTitle })}
            />
          </AdminField>
          <AdminField label={t("admin.workspaceIconUrl")} help={t("admin.workspaceIconUrlHelp")}>
            <AdminInput
              placeholder="https://example.com/workspace-icon.png"
              value={form.workspaceIconUrl}
              onChange={(workspaceIconUrl) => onChange({ workspaceIconUrl })}
            />
          </AdminField>
          <AdminField label={t("admin.workspaceSubtitle")}>
            <AdminTextarea
              rows={3}
              value={form.workspaceSubtitle}
              onChange={(workspaceSubtitle) => onChange({ workspaceSubtitle })}
            />
          </AdminField>
          <AdminField label={t("admin.workspacePromptPlaceholder")}>
            <AdminInput
              value={form.workspacePromptPlaceholder}
              onChange={(workspacePromptPlaceholder) =>
                onChange({ workspacePromptPlaceholder })
              }
            />
          </AdminField>
          <AdminField label={t("admin.workspaceHint")}>
            <AdminTextarea
              rows={3}
              value={form.workspaceHint}
              onChange={(workspaceHint) => onChange({ workspaceHint })}
            />
          </AdminField>
          <AdminField
            label={t("admin.workspacePromptCards")}
            help={`${t("admin.workspacePromptCardsHelp")}\n${t("admin.validJsonArrayHelp")}`}
          >
            <AdminJsonTextarea
              rows={6}
              placeholder={`[{"title":"Plan an idea","description":"Turn an idea into next steps.","prompt":"Help me plan this idea:"}]`}
              value={form.workspacePromptCards}
              onChange={(workspacePromptCards) =>
                onChange({ workspacePromptCards })
              }
            />
          </AdminField>
          <AdminField
            label={t("admin.imagePromptCards")}
            help={`${t("admin.imagePromptCardsHelp")}\n${t("admin.validJsonArrayHelp")}`}
          >
            <AdminJsonTextarea
              rows={6}
              placeholder={`[{"title":"Product hero","description":"Create a clean commercial product image.","prompt":"Create a clean studio product hero","imageUrl":"https://example.com/image.jpg"}]`}
              value={form.imagePromptCards}
              onChange={(imagePromptCards) => onChange({ imagePromptCards })}
            />
          </AdminField>
        </AdminSectionCard>
        ) : null}

        {activeArea === "workspace" ? (
        <AdminSectionCard
          title={t("admin.titleCoverVisualBrief.title")}
          description={t("admin.titleCoverVisualBrief.description")}
          className="lg:col-span-2 xl:col-span-6"
        >
          <div className="grid min-w-0 gap-4 md:grid-cols-3">
            <AdminField
              label={t("admin.titleCoverVisualBrief.model")}
              help={
                currentBriefModelUnavailable
                  ? t("admin.titleCoverVisualBrief.unavailable", {
                      model: form.titleCoverBriefModelId
                    })
                  : undefined
              }
            >
              <AdminSelect
                value={form.titleCoverBriefModelId}
                onChange={(titleCoverBriefModelId) =>
                  onChange({ titleCoverBriefModelId })
                }
              >
                {!form.titleCoverBriefModelId ? (
                  <option value="">
                    {t("admin.titleCoverVisualBrief.selectModel")}
                  </option>
                ) : null}
                {form.titleCoverBriefModelId && !hasCurrentBriefModel ? (
                  <option value={form.titleCoverBriefModelId}>
                    {form.titleCoverBriefModelId} — {t("admin.titleCoverVisualBrief.unavailableShort")}
                  </option>
                ) : null}
                {chatModels.map((model) => {
                  const routeCount = routeCountFor(model);
                  return (
                    <option
                      key={model.id}
                      disabled={routeCount === 0}
                      value={model.slug}
                    >
                      {model.displayName ?? model.name} · {t(
                        routeCount === 1
                          ? "admin.titleCoverVisualBrief.route"
                          : "admin.titleCoverVisualBrief.routes",
                        { count: routeCount }
                      )}
                    </option>
                  );
                })}
              </AdminSelect>
            </AdminField>
            <AdminField label={t("admin.titleCoverVisualBrief.costCredits")}>
              <AdminInput
                max={100000}
                min={1}
                step={1}
                type="number"
                value={form.titleCoverBriefCostCredits}
                onChange={(titleCoverBriefCostCredits) =>
                  onChange({ titleCoverBriefCostCredits })
                }
              />
            </AdminField>
          </div>
        </AdminSectionCard>
        ) : null}

        {activeArea === "workspace" ? (
        <AdminSectionCard
          title={t("admin.settingGroup.workspaceDefaults")}
          className="xl:col-span-3"
        >
          <AdminField label={t("admin.setting.defaultModel")}>
            <AdminSelect
              value={form.defaultModel}
              onChange={(defaultModel) => onChange({ defaultModel })}
            >
              {!form.defaultModel ? (
                <option value="">{t("admin.setting.noDefaultModel")}</option>
              ) : null}
              {form.defaultModel && !hasCurrentDefault ? (
                <option value={form.defaultModel}>{form.defaultModel}</option>
              ) : null}
              {enabledModels.map((model) => (
                <option key={model.id} value={model.modelId}>
                  {model.name}
                </option>
              ))}
            </AdminSelect>
          </AdminField>
          <AdminField
            label={t("admin.setting.workspaceLinksLabel")}
            help={t("admin.legacyHomepageFieldHelp")}
          >
            <AdminInput
              value={form.workspaceLinksLabel}
              onChange={(workspaceLinksLabel) =>
                onChange({ workspaceLinksLabel })
              }
            />
          </AdminField>
        </AdminSectionCard>
        ) : null}

        {activeArea === "brand" ? (
        <AdminSectionCard title={t("admin.settingGroup.homeDisplay")} className="lg:col-span-2 xl:col-span-6">
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <AdminField label={t("admin.homeHeroTitle")}>
              <AdminInput
                value={form.homeHeroTitle}
                onChange={(homeHeroTitle) => onChange({ homeHeroTitle })}
              />
            </AdminField>
            <AdminField label={t("admin.homeHeroSubtitle")}>
              <AdminInput
                value={form.homeHeroSubtitle}
                onChange={(homeHeroSubtitle) => onChange({ homeHeroSubtitle })}
              />
            </AdminField>
            <AdminField label={t("admin.homePrimaryCta")}>
              <AdminInput
                value={form.homePrimaryCta}
                onChange={(homePrimaryCta) => onChange({ homePrimaryCta })}
              />
            </AdminField>
            <AdminField label={t("admin.homeSecondaryCta")}>
              <AdminInput
                value={form.homeSecondaryCta}
                onChange={(homeSecondaryCta) => onChange({ homeSecondaryCta })}
              />
            </AdminField>
          </div>
          <AdminField label={t("admin.betaNotice")}>
            <AdminTextarea
              rows={3}
              value={form.betaNotice}
              onChange={(betaNotice) => onChange({ betaNotice })}
            />
          </AdminField>
          <AdminField
            label={t("admin.homeRightCardNotice")}
            help={t("admin.legacyHomepageFieldHelp")}
          >
            <AdminInput
              value={form.homeRightCardNotice}
              onChange={(homeRightCardNotice) =>
                onChange({ homeRightCardNotice })
              }
            />
          </AdminField>
          <AdminField
            label={t("admin.homeFeatureCards")}
            help={`${t("admin.homeFeatureCardsHelp")}\n${t("admin.validJsonArrayHelp")}`}
          >
            <AdminJsonTextarea
              rows={5}
              placeholder={`[{"title":"Multi-model chat","description":"Choose models in one workspace."}]`}
              value={form.homeFeatureCards}
              onChange={(homeFeatureCards) => onChange({ homeFeatureCards })}
            />
          </AdminField>
        </AdminSectionCard>
        ) : null}

        {activeArea === "brand" ? (
        <AdminSectionCard title={t("admin.settingGroup.notices")} className="xl:col-span-3">
          <AdminField label={t("admin.publicNotice")}>
            <AdminTextarea
              rows={3}
              value={form.publicNotice}
              onChange={(publicNotice) => onChange({ publicNotice })}
            />
          </AdminField>
          <ToggleField
            checked={form.publicNoticeEnabled}
            label={t("admin.publicNoticeEnabled")}
            onChange={(publicNoticeEnabled) => onChange({ publicNoticeEnabled })}
          />
          <AdminField label={t("admin.setting.siteAnnouncement")} help={t("admin.legacyHomepageFieldHelp")}>
            <AdminTextarea
              rows={3}
              value={form.siteAnnouncement}
              onChange={(siteAnnouncement) => onChange({ siteAnnouncement })}
            />
          </AdminField>
        </AdminSectionCard>
        ) : null}

        {activeArea === "brand" ? (
        <AdminSectionCard title={t("admin.settingGroup.footerLinks")} className="xl:col-span-3">
          <AdminField label={t("admin.footerSlogan")}>
            <AdminInput
              value={form.footerSlogan}
              onChange={(footerSlogan) => onChange({ footerSlogan })}
            />
          </AdminField>
          <AdminField label={t("admin.footerCopyright")}>
            <AdminInput
              value={form.footerCopyright}
              onChange={(footerCopyright) => onChange({ footerCopyright })}
            />
          </AdminField>
          <AdminField
            label={t("admin.footerLinksJson")}
            help={`${t("admin.footerLinksResponsibilityHelp")}\n${t("admin.footerLinksJsonHelp")}\n${t("admin.validJsonArrayHelp")}`}
          >
            <AdminJsonTextarea
              rows={6}
              placeholder={`[{"label":"Terms","href":"/terms"},{"label":"Contact","href":"https://example.com/contact"}]`}
              value={form.footerLinksJson}
              onChange={(footerLinksJson) => onChange({ footerLinksJson })}
            />
          </AdminField>
        </AdminSectionCard>
        ) : null}

        {activeArea === "access" ? (
        <AdminSectionCard
          title={t("admin.settingGroup.access")}
          className="lg:col-span-2 xl:col-span-6"
        >
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <ToggleField
              checked={form.guestModeEnabled}
              label={t("admin.setting.guestModeEnabled")}
              onChange={(guestModeEnabled) => onChange({ guestModeEnabled })}
            />
            <ToggleField
              checked={form.maintenanceModeEnabled}
              label={t("admin.setting.maintenanceModeEnabled")}
              onChange={(maintenanceModeEnabled) =>
                onChange({ maintenanceModeEnabled })
              }
            />
            <AdminField label={t("admin.setting.maintenanceMessage")}>
              <AdminTextarea
                rows={3}
                value={form.maintenanceMessage}
                onChange={(maintenanceMessage) =>
                  onChange({ maintenanceMessage })
                }
              />
            </AdminField>
          </div>
        </AdminSectionCard>
        ) : null}

        {activeArea === "access" ? (
        <AdminSectionCard
          title="安全与注册 / Security & Registration"
          description="关闭后，新用户将无法注册，已有用户仍可正常登录。"
          className="lg:col-span-2 xl:col-span-6"
        >
          <div className="grid min-w-0 gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div className="grid min-w-0 gap-1">
              <h4 className="text-sm font-semibold text-slate-950">
                {t("admin.guestRateLimit.title")}
              </h4>
              <p className="text-xs leading-5 text-slate-600">
                {t("admin.guestRateLimit.description")}
              </p>
            </div>
            <ToggleField
              checked={form.guestRateLimitEnabled}
              label={t("admin.setting.guestRateLimitEnabled")}
              onChange={(guestRateLimitEnabled) =>
                onChange({ guestRateLimitEnabled })
              }
            />
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <AdminField
                label={t("admin.setting.guestDailyLimit")}
                help={t("admin.guestRateLimit.dailyHelp")}
              >
                <AdminInput
                  max={1000}
                  min={1}
                  step={1}
                  type="number"
                  value={form.guestDailyLimit}
                  onChange={(guestDailyLimit) => onChange({ guestDailyLimit })}
                />
              </AdminField>
              <AdminField
                label={t("admin.setting.guestPerModelHourlyLimit")}
                help={t("admin.guestRateLimit.modelHelp")}
              >
                <AdminInput
                  max={100}
                  min={1}
                  step={1}
                  type="number"
                  value={form.guestPerModelHourlyLimit}
                  onChange={(guestPerModelHourlyLimit) =>
                    onChange({ guestPerModelHourlyLimit })
                  }
                />
              </AdminField>
              <AdminField
                label={t("admin.setting.guestBurstLimit")}
                help={t("admin.guestRateLimit.burstHelp")}
              >
                <AdminInput
                  max={20}
                  min={1}
                  step={1}
                  type="number"
                  value={form.guestBurstLimit}
                  onChange={(guestBurstLimit) => onChange({ guestBurstLimit })}
                />
              </AdminField>
              <AdminField label={t("admin.setting.guestBurstWindowSeconds")}>
                <AdminInput
                  max={300}
                  min={1}
                  step={1}
                  type="number"
                  value={form.guestBurstWindowSeconds}
                  onChange={(guestBurstWindowSeconds) =>
                    onChange({ guestBurstWindowSeconds })
                  }
                />
              </AdminField>
            </div>
          </div>
          <div className="grid min-w-0 gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
            <div className="grid min-w-0 gap-1">
              <h4 className="text-sm font-semibold text-slate-950">
                {t("admin.concurrency.title")}
              </h4>
              <p className="text-xs leading-5 text-slate-600">
                {t("admin.concurrency.description")}
              </p>
              <p className="text-xs leading-5 text-slate-600">
                {t("admin.concurrency.warning")}
              </p>
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <AdminField
                label={t("admin.setting.guestChatConcurrencyLimit")}
                help={t("admin.concurrency.guestHelp")}
              >
                <AdminInput
                  max={5}
                  min={1}
                  step={1}
                  type="number"
                  value={form.guestChatConcurrencyLimit}
                  onChange={(guestChatConcurrencyLimit) =>
                    onChange({ guestChatConcurrencyLimit })
                  }
                />
              </AdminField>
              <AdminField
                label={t("admin.setting.userChatConcurrencyLimit")}
                help={t("admin.concurrency.userHelp")}
              >
                <AdminInput
                  max={10}
                  min={1}
                  step={1}
                  type="number"
                  value={form.userChatConcurrencyLimit}
                  onChange={(userChatConcurrencyLimit) =>
                    onChange({ userChatConcurrencyLimit })
                  }
                />
              </AdminField>
              <AdminField
                label={t("admin.setting.imageGenerationConcurrencyLimit")}
                help={t("admin.concurrency.imageHelp")}
              >
                <AdminInput
                  max={5}
                  min={1}
                  step={1}
                  type="number"
                  value={form.imageGenerationConcurrencyLimit}
                  onChange={(imageGenerationConcurrencyLimit) =>
                    onChange({ imageGenerationConcurrencyLimit })
                  }
                />
              </AdminField>
            </div>
          </div>
          <div className="grid min-w-0 gap-4 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
            <div className="grid min-w-0 gap-1">
              <h4 className="text-sm font-semibold text-slate-950">
                {t("admin.profileRateLimit.title")}
              </h4>
              <p className="text-xs leading-5 text-slate-600">
                {t("admin.profileRateLimit.description")}
              </p>
            </div>
            <ToggleField
              checked={form.profileRateLimitEnabled}
              label={t("admin.setting.profileRateLimitEnabled")}
              onChange={(profileRateLimitEnabled) =>
                onChange({ profileRateLimitEnabled })
              }
            />
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <AdminField
                label={t("admin.setting.nicknameUpdateDailyLimit")}
                help={t("admin.profileRateLimit.nicknameHelp")}
              >
                <AdminInput
                  max={20}
                  min={1}
                  step={1}
                  type="number"
                  value={form.nicknameUpdateDailyLimit}
                  onChange={(nicknameUpdateDailyLimit) =>
                    onChange({ nicknameUpdateDailyLimit })
                  }
                />
              </AdminField>
              <AdminField
                label={t("admin.setting.avatarUpdateDailyLimit")}
                help={t("admin.profileRateLimit.avatarHelp")}
              >
                <AdminInput
                  max={50}
                  min={1}
                  step={1}
                  type="number"
                  value={form.avatarUpdateDailyLimit}
                  onChange={(avatarUpdateDailyLimit) =>
                    onChange({ avatarUpdateDailyLimit })
                  }
                />
              </AdminField>
            </div>
          </div>
          <div className="grid min-w-0 gap-4 rounded-2xl border border-cyan-100 bg-cyan-50/50 p-4">
            <div className="grid min-w-0 gap-1">
              <h4 className="text-sm font-semibold text-slate-950">
                {t("admin.referenceImageRateLimit.title")}
              </h4>
              <p className="text-xs leading-5 text-slate-600">
                {t("admin.referenceImageRateLimit.description")}
              </p>
              <p className="text-xs leading-5 text-slate-600">
                {t("admin.referenceImageRateLimit.fixedLimits")}
              </p>
            </div>
            <ToggleField
              checked={form.referenceImageRateLimitEnabled}
              label={t("admin.setting.referenceImageRateLimitEnabled")}
              onChange={(referenceImageRateLimitEnabled) =>
                onChange({ referenceImageRateLimitEnabled })
              }
            />
            <AdminField
              label={t("admin.setting.referenceImageDailyLimit")}
              help={t("admin.referenceImageRateLimit.dailyHelp")}
            >
              <AdminInput
                max={200}
                min={1}
                step={1}
                type="number"
                value={form.referenceImageDailyLimit}
                onChange={(referenceImageDailyLimit) =>
                  onChange({ referenceImageDailyLimit })
                }
              />
            </AdminField>
          </div>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <ToggleField
                checked={form.registrationEnabled}
                label="全站开放注册 / Public registration"
                onChange={(registrationEnabled) => {
                  if (
                    !registrationEnabled &&
                    !window.confirm("关闭后，新用户将无法注册，已有用户仍可正常登录。")
                  ) return;
                  onChange({ registrationEnabled });
                }}
              />
            </div>
            <ToggleField
              checked={form.registrationEmailPolicyEnabled}
              label="启用邮箱域名策略 / Email domain policy"
              onChange={(registrationEmailPolicyEnabled) =>
                onChange({ registrationEmailPolicyEnabled })
              }
            />
            <AdminField label="注册关闭中文提示">
              <AdminTextarea rows={3} value={form.registrationClosedMessageZh} onChange={(registrationClosedMessageZh) => onChange({ registrationClosedMessageZh })} />
            </AdminField>
            <AdminField label="Registration closed message (English)">
              <AdminTextarea rows={3} value={form.registrationClosedMessageEn} onChange={(registrationClosedMessageEn) => onChange({ registrationClosedMessageEn })} />
            </AdminField>
            <AdminField label="策略模式 / Policy mode">
              <AdminSelect value={form.registrationEmailPolicyMode} onChange={(value) => onChange({ registrationEmailPolicyMode: value as SettingsFormState["registrationEmailPolicyMode"] })}>
                <option value="ALL">允许全部 / Allow all</option>
                <option value="ALLOWLIST">仅允许白名单 / Allowlist only</option>
                <option value="DENYLIST">黑名单模式 / Denylist</option>
              </AdminSelect>
            </AdminField>
            <div />
            <AdminField label="允许注册的邮箱域名" help="每行填写一个域名，不要包含 @、协议或路径。默认允许 gmail.com 和 qq.com。">
              <AdminTextarea rows={6} value={form.registrationAllowedDomainsText} onChange={(registrationAllowedDomainsText) => onChange({ registrationAllowedDomainsText })} />
            </AdminField>
            <AdminField label="禁止注册的邮箱域名">
              <AdminTextarea rows={6} value={form.registrationBlockedDomainsText} onChange={(registrationBlockedDomainsText) => onChange({ registrationBlockedDomainsText })} />
            </AdminField>
          </div>
        </AdminSectionCard>
        ) : null}

        {activeArea === "benefits" ? (
        <AdminSectionCard
          title={t("admin.settingGroup.benefitsGrowth")}
          className="lg:col-span-2 xl:col-span-6"
        >
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="font-semibold text-slate-950 dark:text-slate-100">每日签到</div>
              <ToggleField checked={form.checkInEnabled ?? false} label="启用每日签到" onChange={(checkInEnabled) => onChange({ checkInEnabled })} />
              <AdminField label="每日奖励额度"><AdminInput min={0} type="number" value={form.checkInDailyRewardCredits ?? ""} onChange={(checkInDailyRewardCredits) => onChange({ checkInDailyRewardCredits })} /></AdminField>
              <AdminField label="连续奖励 JSON" help='例如 {"3":5,"7":20}'><AdminJsonTextarea rows={4} value={form.checkInStreakRewards ?? "{}"} onChange={(checkInStreakRewards) => onChange({ checkInStreakRewards })} /></AdminField>
            </div>
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="font-semibold text-slate-950 dark:text-slate-100">邀请有礼</div>
              <ToggleField checked={form.referralEnabled ?? false} label="启用邀请有礼" onChange={(referralEnabled) => onChange({ referralEnabled })} />
              <AdminField label="邀请人奖励额度"><AdminInput min={0} type="number" value={form.referralInviterRewardCredits ?? ""} onChange={(referralInviterRewardCredits) => onChange({ referralInviterRewardCredits })} /></AdminField>
              <AdminField label="被邀请人奖励额度"><AdminInput min={0} type="number" value={form.referralInviteeRewardCredits ?? ""} onChange={(referralInviteeRewardCredits) => onChange({ referralInviteeRewardCredits })} /></AdminField>
              <AdminField label="奖励触发条件"><AdminInput value={form.referralRewardTrigger ?? ""} onChange={(referralRewardTrigger) => onChange({ referralRewardTrigger })} /></AdminField>
              <AdminField label="推广规则"><AdminTextarea rows={3} value={form.referralRulesText ?? ""} onChange={(referralRulesText) => onChange({ referralRulesText })} /></AdminField>
            </div>
          </div>
        </AdminSectionCard>
        ) : null}
        {activeArea === "brand" ? (
        <AdminSectionCard title="使用说明页面 / Help page" className="lg:col-span-2 xl:col-span-6">
          <AdminField
            label={t("admin.helpContentJson")}
            help={t("admin.helpContentJsonHelp")}
          >
            <AdminJsonTextarea
              rows={18}
              value={form.helpContentJson}
              onChange={(helpContentJson) => onChange({ helpContentJson })}
            />
          </AdminField>
        </AdminSectionCard>
        ) : null}

        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:col-span-2 xl:col-span-6">
          <div className="text-xs font-medium text-slate-500">
            {t("admin.settingsCount", { count: safeSettings.length })}
          </div>
          <AdminFormActions className="w-full sm:w-auto">
            <button
              className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:bg-indigo-300 sm:w-auto"
              type="button"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? t("admin.saving") : t("admin.saveSettings")}
            </button>
          </AdminFormActions>
        </div>
      </div>
    </section>
  );
}

interface ResponsibilitySettingsProps {
  form: SettingsFormState;
  saving: boolean;
  onChange: (updates: Partial<SettingsFormState>) => void;
  onSave: () => void;
}

export function AdminStorageOfferSettings({
  form,
  saving,
  onChange,
  onSave
}: ResponsibilitySettingsProps) {
  const { t } = useI18n();

  return (
    <AdminSectionCard
      title={t("admin.storageOfferTitle")}
      description={t("admin.storageOfferCommerceHelp")}
    >
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <ToggleField
          checked={form.storagePackageEnabled ?? false}
          label={t("admin.storageOfferEnabled")}
          onChange={(storagePackageEnabled) => onChange({ storagePackageEnabled })}
        />
        <AdminField label={t("admin.storageOfferPriceCredits")}>
          <AdminInput
            min={0}
            type="number"
            value={form.storagePackagePriceCredits ?? ""}
            onChange={(storagePackagePriceCredits) =>
              onChange({ storagePackagePriceCredits })
            }
          />
        </AdminField>
        <AdminField label={t("admin.storageOfferDurationDays")}>
          <AdminInput
            min={1}
            type="number"
            value={form.storagePackageDurationDays ?? ""}
            onChange={(storagePackageDurationDays) =>
              onChange({ storagePackageDurationDays })
            }
          />
        </AdminField>
        <ToggleField
          checked={form.storagePackageAutoRenewEnabled ?? false}
          label={t("admin.storageOfferAutoRenew")}
          onChange={(storagePackageAutoRenewEnabled) =>
            onChange({ storagePackageAutoRenewEnabled })
          }
        />
        <AdminField label={t("admin.storageOfferDescription")}>
          <AdminTextarea
            rows={3}
            value={form.storagePackageDescription ?? ""}
            onChange={(storagePackageDescription) =>
              onChange({ storagePackageDescription })
            }
          />
        </AdminField>
      </div>
      <ResponsibilitySaveButton saving={saving} onSave={onSave} />
    </AdminSectionCard>
  );
}

export function AdminTitleCoverBudgetSettings({
  form,
  saving,
  onChange,
  onSave
}: ResponsibilitySettingsProps) {
  const { t } = useI18n();

  return (
    <AdminSectionCard
      title={t("admin.titleCoverBudgetOperationsTitle")}
      description={t("admin.titleCoverBudgetOperationsHelp")}
    >
      <div className="max-w-sm">
        <AdminField label={t("admin.titleCoverVisualBrief.dailyBudgetCredits")}>
          <AdminInput
            min={1}
            step={1}
            type="number"
            value={form.titleCoverBriefDailyBudgetCredits}
            onChange={(titleCoverBriefDailyBudgetCredits) =>
              onChange({ titleCoverBriefDailyBudgetCredits })
            }
          />
        </AdminField>
      </div>
      <ResponsibilitySaveButton saving={saving} onSave={onSave} />
    </AdminSectionCard>
  );
}

function ResponsibilitySaveButton({
  saving,
  onSave
}: {
  saving: boolean;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <AdminFormActions>
      <button
        className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:bg-indigo-300 sm:w-auto"
        type="button"
        disabled={saving}
        onClick={onSave}
      >
        {saving ? t("admin.saving") : t("admin.saveSettings")}
      </button>
    </AdminFormActions>
  );
}

const controlClass = `${adminControlClass} font-normal`;

function AdminSectionCard({
  title,
  description,
  className = "",
  children
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <AdminFormSection
      className={className}
      description={description}
      title={title}
    >
      {children}
    </AdminFormSection>
  );
}

function AdminField({
  label,
  help,
  children
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <AdminFormField help={help} label={label}>
      {children}
    </AdminFormField>
  );
}

interface AdminControlA11yProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

function AdminInput({
  value,
  type = "text",
  min,
  max,
  step,
  placeholder,
  onChange,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid
}: {
  value: string;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  onChange: (value: string) => void;
} & AdminControlA11yProps) {
  return (
    <input
      className={controlClass}
      id={id}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      max={max}
      min={min}
      placeholder={placeholder}
      type={type}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function AdminTextarea({
  value,
  rows = 3,
  placeholder,
  onChange,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid
}: {
  value: string;
  rows?: number;
  placeholder?: string;
  onChange: (value: string) => void;
} & AdminControlA11yProps) {
  return (
    <textarea
      className={`${controlClass} min-h-28 resize-y leading-6`}
      id={id}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      placeholder={placeholder}
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function AdminJsonTextarea(props: React.ComponentProps<typeof AdminTextarea>) {
  return (
    <textarea
      className={`${controlClass} min-h-36 resize-y font-mono text-xs leading-6`}
      id={props.id}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      placeholder={props.placeholder}
      rows={props.rows ?? 5}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function AdminSelect({
  value,
  children,
  onChange,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid
}: {
  value: string;
  children: React.ReactNode;
  onChange: (value: string) => void;
} & AdminControlA11yProps) {
  return (
    <select
      className={controlClass}
      id={id}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

function ToggleField({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
      <span className="min-w-0 break-words">{label}</span>
      <input
        checked={checked}
        className="size-4 shrink-0 rounded border-slate-300 text-indigo-600"
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
