import { describe, expect, it } from "vitest";
import {
  getAccountActivityStatusLabel,
  getAccountActivityTitle,
  getAccountActivityKindLabel
} from "./account-activity-labels";

function act(kind: "ORDER" | "STORAGE_PACKAGE" | "CHECK_IN" | "REFERRAL_REWARD", title?: string) {
  return {
    id: "1",
    kind,
    title: title ?? "Default",
    status: "SUCCESS" as const,
    amount: null,
    creditsDelta: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: null
  };
}

describe("getAccountActivityTitle", () => {
  it("returns ORDER plan name in zh-CN", () => {
    expect(getAccountActivityTitle(act("ORDER", "专业版 Pro"), "zh-CN")).toBe("专业版 Pro");
  });
  it("returns ORDER plan name in en-US", () => {
    expect(getAccountActivityTitle(act("ORDER", "Pro Plan"), "en-US")).toBe("Pro Plan");
  });
  it("returns STORAGE_PACKAGE zh title", () => {
    expect(getAccountActivityTitle(act("STORAGE_PACKAGE", "Storage package activation"), "zh-CN")).toBe("资源存储包开通");
  });
  it("returns STORAGE_PACKAGE en title", () => {
    expect(getAccountActivityTitle(act("STORAGE_PACKAGE", "Storage package activation"), "en-US")).toBe("Storage package activation");
  });
  it("returns CHECK_IN zh title", () => {
    expect(getAccountActivityTitle(act("CHECK_IN", "Daily check-in reward"), "zh-CN")).toBe("每日签到奖励");
  });
  it("returns CHECK_IN en title", () => {
    expect(getAccountActivityTitle(act("CHECK_IN", "Daily check-in reward"), "en-US")).toBe("Daily check-in reward");
  });
  it("returns REFERRAL_REWARD zh title", () => {
    expect(getAccountActivityTitle(act("REFERRAL_REWARD", "Referral reward"), "zh-CN")).toBe("邀请奖励");
  });
  it("returns REFERRAL_REWARD en title", () => {
    expect(getAccountActivityTitle(act("REFERRAL_REWARD", "Referral reward"), "en-US")).toBe("Referral reward");
  });
  it("does not depend on database title for non-ORDER kinds", () => {
    expect(getAccountActivityTitle(act("STORAGE_PACKAGE", "Some old English string"), "zh-CN")).toBe("资源存储包开通");
  });
});

describe("getAccountActivityKindLabel", () => {
  it("returns ORDER zh label", () => {
    expect(getAccountActivityKindLabel(act("ORDER"), "zh-CN")).toBe("套餐订单");
  });
  it("returns ORDER en label", () => {
    expect(getAccountActivityKindLabel(act("ORDER"), "en-US")).toBe("Plan order");
  });
  it("returns STORAGE_PACKAGE zh label", () => {
    expect(getAccountActivityKindLabel(act("STORAGE_PACKAGE"), "zh-CN")).toBe("资源存储包");
  });
  it("returns STORAGE_PACKAGE en label", () => {
    expect(getAccountActivityKindLabel(act("STORAGE_PACKAGE"), "en-US")).toBe("Storage");
  });
  it("returns CHECK_IN zh label", () => {
    expect(getAccountActivityKindLabel(act("CHECK_IN"), "zh-CN")).toBe("签到奖励");
  });
  it("returns CHECK_IN en label", () => {
    expect(getAccountActivityKindLabel(act("CHECK_IN"), "en-US")).toBe("Check-in");
  });
  it("returns REFERRAL_REWARD zh label", () => {
    expect(getAccountActivityKindLabel(act("REFERRAL_REWARD"), "zh-CN")).toBe("邀请奖励");
  });
  it("returns REFERRAL_REWARD en label", () => {
    expect(getAccountActivityKindLabel(act("REFERRAL_REWARD"), "en-US")).toBe("Referral");
  });
});

describe("getAccountActivityStatusLabel", () => {
  it.each([
    ["PENDING", "处理中", "Pending"],
    ["SUCCESS", "已完成", "Completed"],
    ["FAILED", "失败", "Failed"],
    ["CANCELLED", "已取消", "Cancelled"]
  ] as const)("keeps %s presentation semantics distinct", (status, zh, en) => {
    const activity = { ...act("ORDER"), status };

    expect(getAccountActivityStatusLabel(activity, "zh-CN")).toBe(zh);
    expect(getAccountActivityStatusLabel(activity, "en-US")).toBe(en);
  });
});
