import type { PublicSiteSettings } from "@ai-aggregate/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  domainJsonToMultiline,
  isValidHomeFeatureCards,
  isValidHelpContentJson,
  isValidGuestRateLimitSettings,
  isValidProfileRateLimitSettings,
  isValidReferenceImageRateLimitSettings,
  isValidTitleCoverVisualBriefSettings,
  isValidImagePromptCards,
  multilineDomainsToJson,
  isValidWorkspacePromptCards
} from "./admin-settings-validation";

describe("admin settings validation", () => {
  it("validates workspace prompt cards as title, description, and prompt objects", () => {
    expect(
      isValidWorkspacePromptCards(
        JSON.stringify([
          {
            title: "梳理想法",
            description: "帮我把一个想法拆成可执行计划，并列出下一步。",
            prompt: "帮我把这个想法拆成可执行计划："
          }
        ])
      )
    ).toBe(true);

    expect(isValidWorkspacePromptCards("")).toBe(true);
    expect(isValidWorkspacePromptCards("{")).toBe(false);
    expect(
      isValidWorkspacePromptCards(
        JSON.stringify([{ title: "Missing prompt", description: "No prompt" }])
      )
    ).toBe(false);
  });

  it("validates image prompt cards with optional safe public image URLs", () => {
    expect(
      isValidImagePromptCards(
        JSON.stringify([
          {
            title: "Image direction",
            description: "A concise visual direction.",
            prompt: "Create an image of:",
            imageUrl: "https://cdn.example.com/prompt-card.jpg"
          }
        ])
      )
    ).toBe(true);
    expect(isValidImagePromptCards(JSON.stringify([{ title: "Only a title" }]))).toBe(false);
    expect(
      isValidImagePromptCards(
        JSON.stringify([
          {
            title: "Unsafe image",
            description: "Unsafe public URL",
            prompt: "Create an image of:",
            imageUrl: `${"file"}:///tmp/image.png`
          }
        ])
      )
    ).toBe(false);
  });

  it("keeps existing home feature card validation", () => {
    expect(
      isValidHomeFeatureCards(
        JSON.stringify([{ title: "Feature", description: "Description" }])
      )
    ).toBe(true);
    expect(isValidHomeFeatureCards("1")).toBe(false);
  });

  it("rejects invalid help content before an admin save can be sent", () => {
    expect(isValidHelpContentJson("{")).toBe(false);
    expect(isValidHelpContentJson(JSON.stringify({ "zh-CN": {} }))).toBe(true);
    expect(isValidHelpContentJson("")).toBe(true);
  });

  it("converts domain JSON to multiline text and normalizes it for saving", () => {
    expect(domainJsonToMultiline('["gmail.com","qq.com"]')).toBe("gmail.com\nqq.com");
    expect(multilineDomainsToJson(" GMAIL.COM \n\nqq.com\ngmail.com")).toBe(
      '["gmail.com","qq.com"]'
    );
  });

  it("blocks invalid admin registration domains", () => {
    for (const value of ["*.gmail.com", "https://gmail.com", "user@gmail.com", "gmail.com:443"]) {
      expect(() => multilineDomainsToJson(value)).toThrow("INVALID_REGISTRATION_DOMAIN");
    }
  });

  it("accepts whole-number guest rate limits within every configured range", () => {
    expect(isValidGuestRateLimitSettings({
      guestDailyLimit: "1000",
      guestPerModelHourlyLimit: "100",
      guestBurstLimit: "20",
      guestBurstWindowSeconds: "300"
    })).toBe(true);
  });

  it.each([
    ["0", "5", "2", "10"],
    ["1001", "5", "2", "10"],
    ["10", "0", "2", "10"],
    ["10", "101", "2", "10"],
    ["10", "5", "0", "10"],
    ["10", "5", "21", "10"],
    ["10", "5", "2", "0"],
    ["10", "5", "2", "301"],
    ["10", "5.5", "2", "10"]
  ])("rejects out-of-range or fractional guest limits", (
    guestDailyLimit,
    guestPerModelHourlyLimit,
    guestBurstLimit,
    guestBurstWindowSeconds
  ) => {
    expect(isValidGuestRateLimitSettings({
      guestDailyLimit,
      guestPerModelHourlyLimit,
      guestBurstLimit,
      guestBurstWindowSeconds
    })).toBe(false);
  });

  it("accepts profile update limits only as whole numbers within range", () => {
    expect(isValidProfileRateLimitSettings({
      nicknameUpdateDailyLimit: "20",
      avatarUpdateDailyLimit: "50"
    })).toBe(true);
    for (const values of [
      { nicknameUpdateDailyLimit: "0", avatarUpdateDailyLimit: "5" },
      { nicknameUpdateDailyLimit: "21", avatarUpdateDailyLimit: "5" },
      { nicknameUpdateDailyLimit: "3.5", avatarUpdateDailyLimit: "5" },
      { nicknameUpdateDailyLimit: "3", avatarUpdateDailyLimit: "51" }
    ]) {
      expect(isValidProfileRateLimitSettings(values)).toBe(false);
    }
  });

  it("accepts reference image daily limits only from 1 to 200", () => {
    expect(isValidReferenceImageRateLimitSettings({ referenceImageDailyLimit: "20" })).toBe(true);
    for (const value of ["0", "-1", "1.5", "201", "NaN"]) {
      expect(isValidReferenceImageRateLimitSettings({ referenceImageDailyLimit: value })).toBe(false);
    }
  });

  it("validates Title Cover Visual Brief credits and permits an untouched ENV fallback", () => {
    expect(
      isValidTitleCoverVisualBriefSettings({
        titleCoverBriefModelId: "",
        titleCoverBriefCostCredits: "",
        titleCoverBriefDailyBudgetCredits: ""
      })
    ).toBe(true);
    expect(
      isValidTitleCoverVisualBriefSettings({
        titleCoverBriefModelId: "glm",
        titleCoverBriefCostCredits: "100000",
        titleCoverBriefDailyBudgetCredits: "100000"
      })
    ).toBe(true);
    for (const values of [
      {
        titleCoverBriefModelId: "glm",
        titleCoverBriefCostCredits: "0",
        titleCoverBriefDailyBudgetCredits: "100"
      },
      {
        titleCoverBriefModelId: "glm",
        titleCoverBriefCostCredits: "101",
        titleCoverBriefDailyBudgetCredits: "100"
      },
      {
        titleCoverBriefModelId: "",
        titleCoverBriefCostCredits: "2",
        titleCoverBriefDailyBudgetCredits: "100"
      }
    ]) {
      expect(isValidTitleCoverVisualBriefSettings(values)).toBe(false);
    }
  });

  it("keeps detailed guest thresholds out of PublicSiteSettings", () => {
    type DetailedGuestSetting =
      | "guestRateLimitEnabled"
      | "guestDailyLimit"
      | "guestPerModelHourlyLimit"
      | "guestBurstLimit"
      | "guestBurstWindowSeconds";
    type LeakedKey = Extract<keyof PublicSiteSettings, DetailedGuestSetting>;

    expectTypeOf<LeakedKey>().toEqualTypeOf<never>();

    type DetailedProfileSetting =
      | "profileRateLimitEnabled"
      | "nicknameUpdateDailyLimit"
      | "avatarUpdateDailyLimit";
    type ProfileLeakedKey = Extract<keyof PublicSiteSettings, DetailedProfileSetting>;

    expectTypeOf<ProfileLeakedKey>().toEqualTypeOf<never>();

    type TitleCoverLeakedKey = Extract<
      keyof PublicSiteSettings,
      | "titleCoverBriefModelId"
      | "titleCoverBriefCostCredits"
      | "titleCoverBriefDailyBudgetCredits"
    >;
    expectTypeOf<TitleCoverLeakedKey>().toEqualTypeOf<never>();
  });
});
