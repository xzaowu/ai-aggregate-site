import { isValidImagePromptCardsSetting } from "@ai-aggregate/shared";

export function isValidHomeFeatureCards(value: string): boolean {
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

export function isValidWorkspacePromptCards(value: string): boolean {
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
          isNonEmptyString(item.title) &&
          isNonEmptyString(item.description) &&
          isNonEmptyString(item.prompt)
        );
      })
    );
  } catch {
    return false;
  }
}

export function isValidImagePromptCards(value: string): boolean {
  return isValidImagePromptCardsSetting(value);
}

export function isValidFooterLinksJson(value: string): boolean {
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
          isNonEmptyString(item.label) &&
          isNonEmptyString(item.href)
      )
    );
  } catch {
    return false;
  }
}

export function isValidCheckInStreakRewards(value: string): boolean {
  try {
    const parsed = JSON.parse(value.trim() || "{}");
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.entries(parsed as Record<string, unknown>).every(
        ([day, reward]) =>
          /^\d+$/.test(day) &&
          Number(day) > 0 &&
          typeof reward === "number" &&
          Number.isInteger(reward) &&
          reward >= 0
      )
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidHelpContentJson(value: string): boolean {
  const raw = value.trim();
  if (!raw) return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const locales = ["zh-CN", "en-US"] as const;
    for (const locale of locales) {
      const lc = (parsed as Record<string, unknown>)[locale];
      if (!lc || typeof lc !== "object" || Array.isArray(lc)) continue;
      const content = lc as Record<string, unknown>;
      if ("title" in content && typeof content.title !== "string" && content.title !== undefined) return false;
      if ("overviewCards" in content) {
        if (!Array.isArray(content.overviewCards)) return false;
      }
      if ("quickStart" in content) {
        if (!Array.isArray(content.quickStart)) return false;
      }
      if ("serviceCards" in content) {
        if (!Array.isArray(content.serviceCards)) return false;
      }
      if ("faqs" in content) {
        if (!Array.isArray(content.faqs)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function domainJsonToMultiline(value: string | undefined, fallback: string[] = []): string {
  try {
    const parsed = JSON.parse(value ?? "") as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed.join("\n")
      : fallback.join("\n");
  } catch {
    return fallback.join("\n");
  }
}

function normalizeAdminDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253 || /[@*/:]/.test(trimmed) || trimmed.startsWith(".") || trimmed.endsWith(".")) return null;
  try {
    const hostname = new URL(`http://${trimmed}`).hostname.toLowerCase();
    if (hostname !== trimmed && !trimmed.includes("xn--")) {
      // URL normalizes internationalized domains to ASCII, which is allowed.
    }
    const labels = hostname.split(".");
    if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-") || !/^[a-z0-9-]+$/.test(label))) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function multilineDomainsToJson(value: string): string {
  const domains: string[] = [];
  const seen = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const domain = normalizeAdminDomain(line);
    if (!domain) throw new Error("INVALID_REGISTRATION_DOMAIN");
    if (seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  if (domains.length > 100) throw new Error("INVALID_REGISTRATION_DOMAIN");
  return JSON.stringify(domains);
}

export function isValidRegistrationSettings(form: SettingsFormState): boolean {
  if (form.registrationClosedMessageZh.length > 200 || form.registrationClosedMessageEn.length > 200) return false;
  try {
    const allowed = JSON.parse(multilineDomainsToJson(form.registrationAllowedDomainsText)) as string[];
    multilineDomainsToJson(form.registrationBlockedDomainsText);
    return !(form.registrationEmailPolicyEnabled && form.registrationEmailPolicyMode === "ALLOWLIST" && allowed.length === 0);
  } catch {
    return false;
  }
}

export function isValidGuestRateLimitSettings(
  form: Pick<
    SettingsFormState,
    | "guestDailyLimit"
    | "guestPerModelHourlyLimit"
    | "guestBurstLimit"
    | "guestBurstWindowSeconds"
  >
): boolean {
  const values = [
    [form.guestDailyLimit, 1, 1000],
    [form.guestPerModelHourlyLimit, 1, 100],
    [form.guestBurstLimit, 1, 20],
    [form.guestBurstWindowSeconds, 1, 300]
  ] as const;

  return values.every(([raw, min, max]) => {
    const value = Number(raw);
    return Number.isInteger(value) && value >= min && value <= max;
  });
}

export function isValidConcurrencySettings(
  form: Pick<
    SettingsFormState,
    | "guestChatConcurrencyLimit"
    | "userChatConcurrencyLimit"
    | "imageGenerationConcurrencyLimit"
  >
): boolean {
  const values = [
    [form.guestChatConcurrencyLimit, 1, 5],
    [form.userChatConcurrencyLimit, 1, 10],
    [form.imageGenerationConcurrencyLimit, 1, 5]
  ] as const;

  return values.every(([raw, min, max]) => {
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return false;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= min && value <= max;
  });
}

export function isValidProfileRateLimitSettings(
  form: Pick<
    SettingsFormState,
    "nicknameUpdateDailyLimit" | "avatarUpdateDailyLimit"
  >
): boolean {
  const values = [
    [form.nicknameUpdateDailyLimit, 1, 20],
    [form.avatarUpdateDailyLimit, 1, 50]
  ] as const;

  return values.every(([raw, min, max]) => {
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return false;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= min && value <= max;
  });
}

export function isValidReferenceImageRateLimitSettings(
  form: Pick<SettingsFormState, "referenceImageDailyLimit">
): boolean {
  const raw = form.referenceImageDailyLimit;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 200;
}

export function isValidTitleCoverVisualBriefSettings(
  form: Pick<
    SettingsFormState,
    | "titleCoverBriefModelId"
    | "titleCoverBriefCostCredits"
    | "titleCoverBriefDailyBudgetCredits"
  >
): boolean {
  const modelId = form.titleCoverBriefModelId.trim();
  const cost = form.titleCoverBriefCostCredits.trim();
  const dailyBudget = form.titleCoverBriefDailyBudgetCredits.trim();

  if (!modelId && !cost && !dailyBudget) {
    return true;
  }

  if (!modelId || !/^\d+$/u.test(cost) || !/^\d+$/u.test(dailyBudget)) {
    return false;
  }

  const costValue = Number(cost);
  const dailyBudgetValue = Number(dailyBudget);
  return (
    Number.isSafeInteger(costValue) &&
    costValue >= 1 &&
    costValue <= 100_000 &&
    Number.isSafeInteger(dailyBudgetValue) &&
    dailyBudgetValue >= 1 &&
    costValue <= dailyBudgetValue
  );
}

// ── Settings payload helpers ──────────────────────────────────────

import type { SettingsFormState } from "./admin-settings-section";

export { type SettingsFormState };

export function settingsFormToPayload(form: SettingsFormState) {
  const titleCoverVisualBriefSettings =
    form.titleCoverBriefModelId.trim() ||
    form.titleCoverBriefCostCredits.trim() ||
    form.titleCoverBriefDailyBudgetCredits.trim()
      ? [
          {
            key: "titleCoverBriefModelId",
            value: form.titleCoverBriefModelId.trim(),
            type: "string"
          },
          {
            key: "titleCoverBriefCostCredits",
            value: form.titleCoverBriefCostCredits.trim(),
            type: "number"
          },
          {
            key: "titleCoverBriefDailyBudgetCredits",
            value: form.titleCoverBriefDailyBudgetCredits.trim(),
            type: "number"
          }
        ]
      : [];

  return [
    { key: "siteName", value: form.siteName.trim(), type: "string" },
    { key: "siteLogoText", value: form.siteLogoText.trim(), type: "string" },
    {
      key: "siteLogoUrl",
      value: form.siteLogoUrl.trim(),
      type: "string"
    },
    {
      key: "siteFaviconUrl",
      value: form.siteFaviconUrl.trim(),
      type: "string"
    },
    {
      key: "workspaceIconUrl",
      value: form.workspaceIconUrl.trim(),
      type: "string"
    },
    {
      key: "siteAnnouncement",
      value: form.siteAnnouncement.trim(),
      type: "string"
    },
    { key: "publicNotice", value: form.publicNotice.trim(), type: "string" },
    {
      key: "publicNoticeEnabled",
      value: String(form.publicNoticeEnabled),
      type: "boolean"
    },
    { key: "contactEmail", value: form.contactEmail.trim(), type: "string" },
    { key: "defaultModel", value: form.defaultModel.trim(), type: "string" },
    ...titleCoverVisualBriefSettings,
    {
      key: "guestModeEnabled",
      value: String(form.guestModeEnabled),
      type: "boolean"
    },
    {
      key: "guestRateLimitEnabled",
      value: String(form.guestRateLimitEnabled),
      type: "boolean"
    },
    {
      key: "profileRateLimitEnabled",
      value: String(form.profileRateLimitEnabled),
      type: "boolean"
    },
    {
      key: "registrationEnabled",
      value: String(form.registrationEnabled),
      type: "boolean"
    },
    { key: "registrationClosedMessageZh", value: form.registrationClosedMessageZh.trim(), type: "string" },
    { key: "registrationClosedMessageEn", value: form.registrationClosedMessageEn.trim(), type: "string" },
    { key: "registrationEmailPolicyEnabled", value: String(form.registrationEmailPolicyEnabled), type: "boolean" },
    { key: "registrationEmailPolicyMode", value: form.registrationEmailPolicyMode, type: "string" },
    { key: "registrationAllowedDomainsJson", value: multilineDomainsToJson(form.registrationAllowedDomainsText), type: "json" },
    { key: "registrationBlockedDomainsJson", value: multilineDomainsToJson(form.registrationBlockedDomainsText), type: "json" },
    {
      key: "maintenanceModeEnabled",
      value: String(form.maintenanceModeEnabled),
      type: "boolean"
    },
    {
      key: "maintenanceMessage",
      value: form.maintenanceMessage.trim(),
      type: "string"
    },
    {
      key: "guestDailyLimit",
      value: form.guestDailyLimit.trim(),
      type: "number"
    },
    {
      key: "guestPerModelHourlyLimit",
      value: form.guestPerModelHourlyLimit.trim(),
      type: "number"
    },
    {
      key: "guestBurstLimit",
      value: form.guestBurstLimit.trim(),
      type: "number"
    },
    {
      key: "guestBurstWindowSeconds",
      value: form.guestBurstWindowSeconds.trim(),
      type: "number"
    },
    {
      key: "nicknameUpdateDailyLimit",
      value: form.nicknameUpdateDailyLimit.trim(),
      type: "number"
    },
    {
      key: "avatarUpdateDailyLimit",
      value: form.avatarUpdateDailyLimit.trim(),
      type: "number"
    },
    {
      key: "referenceImageRateLimitEnabled",
      value: String(form.referenceImageRateLimitEnabled),
      type: "boolean"
    },
    {
      key: "referenceImageDailyLimit",
      value: form.referenceImageDailyLimit.trim(),
      type: "number"
    },
    {
      key: "guestChatConcurrencyLimit",
      value: form.guestChatConcurrencyLimit.trim(),
      type: "number"
    },
    {
      key: "userChatConcurrencyLimit",
      value: form.userChatConcurrencyLimit.trim(),
      type: "number"
    },
    {
      key: "imageGenerationConcurrencyLimit",
      value: form.imageGenerationConcurrencyLimit.trim(),
      type: "number"
    },
    {
      key: "homeHeroTitle",
      value: form.homeHeroTitle.trim(),
      type: "string"
    },
    {
      key: "homeHeroSubtitle",
      value: form.homeHeroSubtitle.trim(),
      type: "string"
    },
    {
      key: "homePrimaryCta",
      value: form.homePrimaryCta.trim(),
      type: "string"
    },
    {
      key: "homeSecondaryCta",
      value: form.homeSecondaryCta.trim(),
      type: "string"
    },
    {
      key: "betaNotice",
      value: form.betaNotice.trim(),
      type: "string"
    },
    {
      key: "homePrimaryCtaText",
      value: (form.homePrimaryCta || form.homePrimaryCtaText).trim(),
      type: "string"
    },
    {
      key: "homeSecondaryCtaText",
      value: (form.homeSecondaryCta || form.homeSecondaryCtaText).trim(),
      type: "string"
    },
    {
      key: "homeBetaNotice",
      value: (form.betaNotice || form.homeBetaNotice).trim(),
      type: "string"
    },
    {
      key: "homeRightCardNotice",
      value: form.homeRightCardNotice.trim(),
      type: "string"
    },
    {
      key: "footerSlogan",
      value: form.footerSlogan.trim(),
      type: "string"
    },
    {
      key: "footerCopyright",
      value: form.footerCopyright.trim(),
      type: "string"
    },
    {
      key: "footerLinksJson",
      value: form.footerLinksJson.trim(),
      type: "json"
    },
    {
      key: "homeFeatureCards",
      value: form.homeFeatureCards.trim(),
      type: "string"
    },
    {
      key: "workspaceLinksLabel",
      value: form.workspaceLinksLabel.trim(),
      type: "string"
    },
    {
      key: "workspaceTitle",
      value: form.workspaceTitle.trim(),
      type: "string"
    },
    {
      key: "workspaceSubtitle",
      value: form.workspaceSubtitle.trim(),
      type: "string"
    },
    {
      key: "workspacePromptPlaceholder",
      value: form.workspacePromptPlaceholder.trim(),
      type: "string"
    },
    {
      key: "workspaceHint",
      value: form.workspaceHint.trim(),
      type: "string"
    },
    {
      key: "workspaceHeroTitle",
      value: (form.workspaceTitle || form.workspaceHeroTitle).trim(),
      type: "string"
    },
    {
      key: "workspaceHeroSubtitle",
      value: (form.workspaceSubtitle || form.workspaceHeroSubtitle).trim(),
      type: "string"
    },
    {
      key: "workspacePromptCards",
      value: form.workspacePromptCards.trim(),
      type: "string"
    },
    {
      key: "imagePromptCards",
      value: form.imagePromptCards.trim(),
      type: "string"
    },
    { key: "storagePackageEnabled", value: String(form.storagePackageEnabled ?? false), type: "boolean" },
    { key: "storagePackagePriceCredits", value: (form.storagePackagePriceCredits ?? "0").trim(), type: "number" },
    { key: "storagePackageDurationDays", value: (form.storagePackageDurationDays ?? "1").trim(), type: "number" },
    { key: "storagePackageAutoRenewEnabled", value: String(form.storagePackageAutoRenewEnabled ?? false), type: "boolean" },
    { key: "storagePackageDescription", value: (form.storagePackageDescription ?? "").trim(), type: "string" },
    { key: "checkInEnabled", value: String(form.checkInEnabled ?? false), type: "boolean" },
    { key: "checkInDailyRewardCredits", value: (form.checkInDailyRewardCredits ?? "0").trim(), type: "number" },
    { key: "checkInStreakRewards", value: (form.checkInStreakRewards ?? "{}").trim(), type: "json" },
    { key: "referralEnabled", value: String(form.referralEnabled ?? false), type: "boolean" },
    { key: "referralInviterRewardCredits", value: (form.referralInviterRewardCredits ?? "0").trim(), type: "number" },
    { key: "referralInviteeRewardCredits", value: (form.referralInviteeRewardCredits ?? "0").trim(), type: "number" },
    { key: "referralRewardTrigger", value: (form.referralRewardTrigger ?? "").trim(), type: "string" },
    { key: "referralRulesText", value: (form.referralRulesText ?? "").trim(), type: "string" },
    { key: "helpContentJson", value: form.helpContentJson.trim(), type: "json" }
  ];
}
