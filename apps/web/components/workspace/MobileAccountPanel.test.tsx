// @vitest-environment jsdom

import type { AccountOverview, AuthUser } from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileAccountPanel } from "./MobileAccountPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user: AuthUser = { id: "user-1", email: "mobile@example.test", role: "USER", credits: 92, name: "随遇" };
const overview: AccountOverview = {
  profile: user,
  quota: { remainingCredits: 92 },
  plan: { name: "Free 套餐", status: "ACTIVE", expiresAt: null, nextBillingAt: null },
  storagePackage: { enabled: true, status: "INACTIVE", priceCredits: 10, durationDays: 30, autoRenewEnabled: false, autoRenewAvailable: true, description: "Conversations and creations stay available during the active period.", startsAt: null, expiresAt: null },
  checkIn: { enabled: true, todayDate: "2026-07-30", todayCheckedIn: false, currentStreak: 1, dailyRewardCredits: 1, streakRewards: { "3": 2, "7": 5 }, checkedDates: ["2026-07-30"] },
  referral: { enabled: true, code: "5MVUQ2GK", invitedCount: 0, totalRewardCredits: 0, inviterRewardCredits: 0, inviteeRewardCredits: 0, rewardTrigger: "Invite friends and earn credits", rulesText: "Invite rules", registrationIntegration: "PREPARATION" },
  activities: [],
  benefits: { storagePackageEnabled: true, storagePackagePriceCredits: 10, storagePackageDurationDays: 30, storagePackageAutoRenewEnabled: true, storagePackageDescription: "", checkInEnabled: true, checkInDailyRewardCredits: 1, checkInStreakRewards: { "3": 2, "7": 5 }, referralEnabled: true, referralInviterRewardCredits: 1, referralInviteeRewardCredits: 1, referralRewardTrigger: "Invite friends and earn credits", referralRulesText: "Invite rules" }
};

function mobileElement(isAdmin = false) {
  return (
    <MobileAccountPanel
      overview={overview}
      profile={user}
      displayName="随遇"
      userSeed="mobile@example.test"
      locale="zh-CN"
      t={(key) => ({ "workspace.themeLight": "浅色模式", "workspace.themeDark": "深色模式", "workspace.language": "语言" }[key] ?? key)}
      theme="light"
      onToggleTheme={vi.fn()}
      onToggleLocale={vi.fn()}
      avatarInputRef={{ current: null }}
      avatarUploading={false}
      onAvatarFile={vi.fn()}
      nicknameEditing={false}
      nicknameDraft="随遇"
      nicknameState="idle"
      onBeginNicknameEdit={vi.fn()}
      onNicknameDraftChange={vi.fn()}
      onSaveNickname={vi.fn()}
      onOpenBilling={vi.fn()}
      isAdmin={isAdmin}
      onLogout={vi.fn()}
      drawer={null}
      drawerReturnFocusRef={{ current: null }}
      onOpenDrawer={vi.fn()}
      onCloseDrawer={vi.fn()}
      drawerPending={false}
      token="token"
      checkInLoading={false}
      onCheckIn={vi.fn()}
      onCopyReferralCode={vi.fn()}
      onCopyReferralInfo={vi.fn()}
      rulesOpen={false}
      onToggleRules={vi.fn()}
      storageActivating={false}
      autoRenewToggling={false}
      onActivateStorage={vi.fn()}
      onToggleAutoRenew={vi.fn()}
      securityDialog={null}
      onOpenChangePassword={vi.fn()}
      onOpenDeviceManagement={vi.fn()}
      onSetSecurityDialog={vi.fn()}
      currentPassword=""
      newPassword=""
      confirmPassword=""
      onCurrentPasswordChange={vi.fn()}
      onNewPasswordChange={vi.fn()}
      onConfirmPasswordChange={vi.fn()}
      changePasswordError={null}
      changePasswordPending={false}
      onSubmitChangePassword={vi.fn()}
      revokeSessionsError={null}
      revokeSessionsPending={false}
      onConfirmRevokeSessions={vi.fn()}
    />
  );
}

function renderMobile(isAdmin = false) {
  return renderToStaticMarkup(mobileElement(isAdmin));
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.style.overflow = "";
  window.history.replaceState(null, "", "/account");
});

describe("MobileAccountPanel", () => {
  it("starts directly with the user card and uses real overview values", () => {
    const html = renderMobile();
    expect(html).toContain('data-account-page="m5-mobile"');
    expect(html).not.toContain("Account center");
    expect(html).toContain("Free 套餐");
    expect(html).toContain("92");
    expect(html).toContain("今日 +1");
    expect(html).toContain("已邀请 0 人");
    expect(html).toContain("订单与明细");
    expect(html).not.toContain("语言与外观");
  });

  it("keeps admin navigation out of ordinary user markup", () => {
    expect(renderMobile()).not.toContain("管理后台");
    expect(renderMobile(true)).toContain("管理后台");
  });

  it("opens each account drawer from a user click and closes before opening the next", async () => {
    host = document.createElement("div");
    document.body.append(host);
    window.history.replaceState(null, "", "/account");
    root = createRoot(host);
    await act(async () => root?.render(mobileElement()));
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>("[data-account-page='m5-mobile'] button")).every((button) => button.type === "button")).toBe(true);

    const entries = [
      ["每日签到", "每日签到"],
      ["邀请有礼", "邀请有礼"],
      ["资源存储", "资源存储"],
      ["订单与明细", "订单与明细"],
      ["账户安全", "账户安全"]
    ] as const;

    for (const [triggerText, title] of entries) {
      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-account-page='m5-mobile'] button"))
        .find((button) => button.textContent?.includes(triggerText));
      expect(trigger?.type).toBe("button");
      await act(async () => trigger?.click());
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(title);
      expect(window.location.pathname).toBe("/account");

      await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] [data-account-drawer-first-focus]')?.click());
      await act(async () => Promise.resolve());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
  });
});
