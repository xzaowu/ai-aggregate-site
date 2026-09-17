import type { AccountActivitySummary, AccountActivityKind } from "@ai-aggregate/shared";

const zhActivityTitles: Record<AccountActivityKind, string> = {
  ORDER: "",
  STORAGE_PACKAGE: "资源存储包开通",
  CHECK_IN: "每日签到奖励",
  REFERRAL_REWARD: "邀请奖励"
};

const enActivityTitles: Record<AccountActivityKind, string> = {
  ORDER: "",
  STORAGE_PACKAGE: "Storage package activation",
  CHECK_IN: "Daily check-in reward",
  REFERRAL_REWARD: "Referral reward"
};

export function getAccountActivityTitle(
  activity: AccountActivitySummary,
  locale: string
): string {
  if (activity.kind === "ORDER") {
    return activity.title;
  }

  const titles = locale === "zh-CN" ? zhActivityTitles : enActivityTitles;
  return titles[activity.kind] || activity.title;
}

const zhKindLabels: Record<AccountActivityKind, string> = {
  ORDER: "套餐订单",
  STORAGE_PACKAGE: "资源存储包",
  CHECK_IN: "签到奖励",
  REFERRAL_REWARD: "邀请奖励"
};

const enKindLabels: Record<AccountActivityKind, string> = {
  ORDER: "Plan order",
  STORAGE_PACKAGE: "Storage",
  CHECK_IN: "Check-in",
  REFERRAL_REWARD: "Referral"
};

export function getAccountActivityKindLabel(
  activity: AccountActivitySummary,
  locale: string
): string {
  const labels = locale === "zh-CN" ? zhKindLabels : enKindLabels;
  return labels[activity.kind] || activity.kind;
}

const zhStatusLabels: Record<AccountActivitySummary["status"], string> = {
  PENDING: "处理中",
  SUCCESS: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消"
};

const enStatusLabels: Record<AccountActivitySummary["status"], string> = {
  PENDING: "Pending",
  SUCCESS: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled"
};

export function getAccountActivityStatusLabel(
  activity: AccountActivitySummary,
  locale: string
): string {
  const labels = locale === "zh-CN" ? zhStatusLabels : enStatusLabels;
  return labels[activity.status];
}
