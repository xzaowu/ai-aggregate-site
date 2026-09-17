"use client";

import type {
  AccountActivitySummary,
  AccountOverview,
  AuthUser,
  OrderSummary,
  UsageLogSummary
} from "@ai-aggregate/shared";
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck2,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Cloud,
  Coins,
  Crown,
  Gift,
  KeyRound,
  Layers3,
  Lightbulb,
  LogOut,
  Mail,
  Pencil,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  X
} from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUserRoleLabel, useI18n } from "../../lib/i18n/use-i18n";
import { apiUrl } from "../../lib/site-config";
import { prepareAvatarImage, avatarMaxBytes } from "../../lib/image-compress";
import { getUserDisplayName, getUserSeed } from "./user-identity";
import { UserAvatar } from "./UserAvatar";
import { validateAccountNickname } from "./account-profile";
import {
  getAccountActivityKindLabel,
  getAccountActivityStatusLabel,
  getAccountActivityTitle
} from "./account-activity-labels";
import AccountActivityModal from "./AccountActivityModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { MobileAccountLoadingSkeleton, MobileAccountPanel } from "./MobileAccountPanel";
import {
  WorkspaceToastContainer,
  useWorkspaceToast
} from "./workspace-toast";
import {
  invokeWorkspaceBillingAction,
  useOptionalWorkspaceShellContext
} from "./workspace-shell-context";
import {
  AccountSecurityRequestError,
  changeAccountPassword,
  revokeAccountSessions
} from "./account-security";

const supportedAvatarTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function localeText(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const ORDER_ACTIVITY_ID_PREFIX = "order:";
const ORDER_ACTIVITY_ID_MAX_LENGTH = 191;
const ORDER_ACTIVITY_ID_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export function getOrderIdFromAccountActivity(
  activity: AccountActivitySummary
): string | null {
  if (
    activity.kind !== "ORDER" ||
    !activity.id.startsWith(ORDER_ACTIVITY_ID_PREFIX)
  ) {
    return null;
  }

  const orderId = activity.id.slice(ORDER_ACTIVITY_ID_PREFIX.length);
  return orderId.length > 0 &&
    orderId === orderId.trim() &&
    Array.from(orderId).length <= ORDER_ACTIVITY_ID_MAX_LENGTH &&
    !ORDER_ACTIVITY_ID_CONTROL_CHARACTER_PATTERN.test(orderId)
    ? orderId
    : null;
}

interface StorageActivationResponse {
  storagePackage: AccountOverview["storagePackage"];
  quota: { remainingCredits: number };
  alreadyActive: boolean;
}

export type SecurityDialogState =
  | { kind: "change-password" }
  | { kind: "devices"; step: "details" | "confirm" }
  | { kind: "placeholder"; topic: "email" | "invoice" }
  | null;

export type MobileAccountDrawerKind = "check-in" | "referral" | "storage" | "activity" | "security" | null;

function createFallbackOverview(
  user: AuthUser | null,
  remainingCredits: number | null,
  planName: string | null,
  orders: OrderSummary[]
): AccountOverview {
  const safeUser = user ?? {
    id: "guest",
    email: "",
    role: "USER" as const,
    credits: 0
  };
  return {
    profile: safeUser,
    quota: { remainingCredits: Math.max(0, remainingCredits ?? safeUser.credits ?? 0) },
    plan: { name: planName || "Base plan", status: planName ? "ACTIVE" : "INACTIVE", expiresAt: null, nextBillingAt: null },
    storagePackage: {
      enabled: false,
      status: "INACTIVE",
      priceCredits: 0,
      durationDays: 0,
      autoRenewEnabled: false,
      autoRenewAvailable: false,
      description: "",
      startsAt: null,
      expiresAt: null
    },
    checkIn: {
      enabled: false,
      todayDate: new Date().toISOString().slice(0, 10),
      todayCheckedIn: false,
      currentStreak: 0,
      dailyRewardCredits: 0,
      streakRewards: {},
      checkedDates: []
    },
    referral: {
      enabled: false,
      code: null,
      invitedCount: 0,
      totalRewardCredits: 0,
      inviterRewardCredits: 0,
      inviteeRewardCredits: 0,
      rewardTrigger: "",
      rulesText: "",
      registrationIntegration: "PREPARATION"
    },
    activities: orders.slice(0, 10).map((order) => ({
      id: `order:${order.id}`,
      kind: "ORDER" as const,
      title: order.planName,
      status: order.status === "PAID" ? "SUCCESS" as const : order.status === "CANCELLED" ? "CANCELLED" as const : "PENDING" as const,
      amount: order.amount,
      creditsDelta: order.status === "PAID" ? order.credits : 0,
      createdAt: order.createdAt,
      completedAt: order.paidAt
    })),
    benefits: {
      storagePackageEnabled: false,
      storagePackagePriceCredits: 0,
      storagePackageDurationDays: 0,
      storagePackageAutoRenewEnabled: false,
      storagePackageDescription: "",
      checkInEnabled: false,
      checkInDailyRewardCredits: 0,
      checkInStreakRewards: {},
      referralEnabled: false,
      referralInviterRewardCredits: 0,
      referralInviteeRewardCredits: 0,
      referralRewardTrigger: "",
      referralRulesText: ""
    }
  };
}

export interface AccountPanelProps {
  token: string | null;
  user: AuthUser | null;
  remainingCredits: number | null;
  planName?: string | null;
  onLogout: () => void;
  initialOrders?: OrderSummary[];
  initialUsageLogs?: UsageLogSummary[];
  initialOverview?: AccountOverview;
  onOpenBilling?: () => void;
  loadOverview?: boolean;
  isMobileSurface?: boolean;
}

export type AccountLoadState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string }
  | { status: "ready"; overview: AccountOverview };

export function syncAccountOverviewWithShell(
  state: AccountLoadState,
  shell: {
    remainingCredits: number | undefined;
    planName: string | undefined;
  }
): AccountLoadState {
  if (state.status !== "ready" || shell.remainingCredits === undefined) {
    return state;
  }

  const remainingCredits = Math.max(0, shell.remainingCredits);
  const currentCredits = state.overview.quota.remainingCredits;
  const currentPlanName = state.overview.plan.name;
  const nextPlanName = shell.planName ?? currentPlanName;

  if (
    currentCredits === remainingCredits &&
    currentPlanName === nextPlanName
  ) {
    return state;
  }

  return {
    ...state,
    overview: {
      ...state.overview,
      quota: {
        ...state.overview.quota,
        remainingCredits
      },
      plan: {
        ...state.overview.plan,
        name: nextPlanName
      }
    }
  };
}

export function AccountPanel({
  token,
  user,
  remainingCredits,
  planName = null,
  onLogout,
  initialOrders,
  initialOverview,
  onOpenBilling,
  loadOverview = true,
  isMobileSurface = false
}: AccountPanelProps) {
  const { locale, setLocale, t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const openBillingDialog = onOpenBilling ?? workspaceShell?.openBillingDialog ?? (() => undefined);
  const handleOpenBilling = () => invokeWorkspaceBillingAction(openBillingDialog);
  const initial = initialOverview ?? (initialOrders !== undefined ? createFallbackOverview(user, remainingCredits, planName, initialOrders) : undefined);
  const [loadState, setLoadState] = useState<AccountLoadState>(initial ? { status: "ready", overview: initial } : { status: "loading" });
  const [nicknameEditing, setNicknameEditing] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameState, setNicknameState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const nicknameSaveInFlightRef = useRef(false);
  const lastNicknameSavedValueRef = useRef<string | null>(null);
  const nicknameRef = useRef<HTMLDivElement>(null);
  const { toasts, showToast, dismissToast } = useWorkspaceToast();
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarUploadInFlightRef = useRef(false);
  const avatarPreviewUrlRef = useRef<string | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [storageActivating, setStorageActivating] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [cancelOrderActivity, setCancelOrderActivity] = useState<AccountActivitySummary | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const cancelOrderInFlightRef = useRef(false);
  const [mobileDrawer, setMobileDrawer] = useState<MobileAccountDrawerKind>(null);
  const mobileDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const [autoRenewToggling, setAutoRenewToggling] = useState(false);
  const [securityDialog, setSecurityDialog] = useState<SecurityDialogState>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const currentPasswordInputRef = useRef<HTMLInputElement>(null);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordPending, setChangePasswordPending] = useState(false);
  const changePasswordInFlightRef = useRef(false);
  const [revokeSessionsError, setRevokeSessionsError] = useState<string | null>(null);
  const [revokeSessionsPending, setRevokeSessionsPending] = useState(false);
  const revokeSessionsInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const setAuthUser = workspaceShell?.setAuthUser;
  const refreshQuota = workspaceShell?.refreshQuota;
  const shellRemainingCredits = workspaceShell?.shell.remainingCredits;
  const shellPlanName = workspaceShell?.shell.planName;
  const isAdmin = workspaceShell?.shell.isAdmin ?? user?.role === "ADMIN";
  const theme = workspaceShell?.theme ?? "light";
  const toggleTheme = workspaceShell?.toggleTheme ?? (() => undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const previewUrl = avatarPreviewUrlRef.current;
      if (previewUrl !== null) {
        URL.revokeObjectURL(previewUrl);
        avatarPreviewUrlRef.current = null;
      }
    };
  }, []);

  const refreshOverview = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    const response = await fetch(apiUrl("/account/overview"), {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      cache: "no-store"
    });
    if (response.status === 401) throw new Error("unauthenticated");
    if (!response.ok) throw new Error("account overview failed");
    const data = (await response.json()) as AccountOverview;
    setLoadState({ status: "ready", overview: data });
    setAuthUser?.(data.profile);
  }, [setAuthUser, token]);

  useEffect(() => {
    if (!loadOverview) return;
    if (!token) {
      setLoadState({ status: "unauthenticated" });
      return;
    }
    if (initialOverview || initialOrders) return;
    const controller = new AbortController();
    void refreshOverview(controller.signal).catch((error) => {
      if (controller.signal.aborted) return;
      if (error instanceof Error && error.message === "unauthenticated") {
        setLoadState({ status: "unauthenticated" });
      } else {
        setLoadState({ status: "error", message: localeText(locale, "加载个人中心失败", "Failed to load account center") });
      }
    });
    return () => controller.abort();
  }, [initialOrders, initialOverview, loadOverview, locale, refreshOverview, token]);

  useEffect(() => {
    setLoadState((currentState) => syncAccountOverviewWithShell(currentState, {
      remainingCredits: shellRemainingCredits,
      planName: shellPlanName
    }));
  }, [shellPlanName, shellRemainingCredits]);

  const overview = loadState.status === "ready" ? loadState.overview : null;
  const profile = overview?.profile ?? user;
  const displayName = profile ? getUserDisplayName(profile, locale) : "";
  const userSeed = profile ? getUserSeed(profile) : "guest";
  const hasPendingOrder = overview?.activities.some(
    (activity) => activity.kind === "ORDER" && activity.status === "PENDING"
  ) ?? false;

  const saveNickname = useCallback(async () => {
    if (!token || !profile || nicknameState === "saving" || nicknameSaveInFlightRef.current) return;
    const current = profile.name?.trim() ?? "";
    const validation = validateAccountNickname(nicknameDraft, current);
    if (!validation.valid && validation.reason === "empty") {
      setNicknameEditing(false);
      return;
    }
    if (!validation.valid) {
      setNicknameState("error");
      return;
    }
    if (!validation.changed) {
      setNicknameEditing(false);
      return;
    }
    const next = validation.value;
    if (lastNicknameSavedValueRef.current === next) {
      setNicknameEditing(false);
      return;
    }
    nicknameSaveInFlightRef.current = true;
    setNicknameState("saving");
    try {
      const response = await fetch(apiUrl("/account/profile"), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: next })
      });
      if (!response.ok) throw new Error("nickname update failed");
      const data = (await response.json()) as { user: AuthUser };
      setLoadState((currentState) => currentState.status === "ready" ? { ...currentState, overview: { ...currentState.overview, profile: data.user } } : currentState);
      setAuthUser?.(data.user);
      lastNicknameSavedValueRef.current = next;
      setNicknameState("saved");
      setNicknameEditing(false);
      window.setTimeout(() => setNicknameState("idle"), 1800);
    } catch {
      setNicknameState("error");
    } finally {
      nicknameSaveInFlightRef.current = false;
    }
  }, [nicknameDraft, nicknameState, profile, setAuthUser, token]);

  useEffect(() => {
    function handleOutside(event: PointerEvent) {
      if (nicknameEditing && nicknameRef.current && !nicknameRef.current.contains(event.target as Node)) void saveNickname();
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [nicknameEditing, saveNickname]);

  function beginNicknameEdit() {
    setNicknameDraft(profile?.name?.trim() ?? "");
    setNicknameState("idle");
    setNicknameEditing(true);
  }

  const openMobileDrawer = useCallback((kind: Exclude<MobileAccountDrawerKind, null>, trigger: HTMLElement) => {
    mobileDrawerReturnFocusRef.current = trigger;
    setSecurityDialog(null);
    setActivityModalOpen(false);
    setMobileDrawer(kind);
  }, []);

  const closeMobileDrawer = useCallback(() => {
    if (avatarUploading || storageActivating || checkInLoading || autoRenewToggling || changePasswordPending || revokeSessionsPending) return;
    setMobileDrawer(null);
    setActivityModalOpen(false);
    setSecurityDialog(null);
  }, [avatarUploading, autoRenewToggling, changePasswordPending, checkInLoading, revokeSessionsPending, storageActivating]);

  async function uploadAvatar(file: File | undefined) {
    if (!file || !token || avatarUploading || avatarUploadInFlightRef.current) return;
    if (!supportedAvatarTypes.has(file.type)) {
      showToast("error", localeText(locale, "仅支持 PNG、JPG 或 WebP 图片", "Only PNG, JPG, or WebP images are supported."));
      return;
    }
    const previousPreviewUrl = avatarPreviewUrlRef.current;
    if (previousPreviewUrl !== null) {
      URL.revokeObjectURL(previousPreviewUrl);
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    avatarPreviewUrlRef.current = nextPreviewUrl;
    setAvatarPreviewUrl(nextPreviewUrl);
    avatarUploadInFlightRef.current = true;
    setAvatarUploading(true);
    try {
      const prepared = await prepareAvatarImage(file);
      const response = await fetch(apiUrl("/account/avatar"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: prepared.dataUrl })
      });
      if (!response.ok) throw new Error("avatar upload failed");
      const data = (await response.json()) as { user: AuthUser };
      setLoadState((currentState) => currentState.status === "ready" ? { ...currentState, overview: { ...currentState.overview, profile: data.user } } : currentState);
      setAuthUser?.(data.user);
      URL.revokeObjectURL(nextPreviewUrl);
      if (avatarPreviewUrlRef.current === nextPreviewUrl) {
        avatarPreviewUrlRef.current = null;
        setAvatarPreviewUrl(null);
      }
      if (prepared.compressed) {
        showToast("success", localeText(locale, `已自动压缩 ${formatBytes(prepared.originalBytes)} → ${formatBytes(prepared.outputBytes)}，头像上传成功`, `Compressed ${formatBytes(prepared.originalBytes)} → ${formatBytes(prepared.outputBytes)}, avatar uploaded successfully.`));
      } else {
        showToast("success", localeText(locale, "头像上传成功", "Avatar uploaded successfully."));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      URL.revokeObjectURL(nextPreviewUrl);
      if (avatarPreviewUrlRef.current === nextPreviewUrl) {
        avatarPreviewUrlRef.current = null;
        setAvatarPreviewUrl(null);
      }
      if (message.includes("image too large even after compression")) {
        showToast("error", localeText(locale, "头像过大，压缩后仍超过 2MB", "Avatar is too large even after compression."));
      } else {
        showToast("error", localeText(locale, "头像上传失败，请重试", "Avatar upload failed. Please try again."));
      }
    } finally {
      avatarUploadInFlightRef.current = false;
      setAvatarUploading(false);
    }
  }

  async function activateStorage() {
    if (!token || !overview || storageActivating || !overview.storagePackage.enabled) return;
    setStorageActivating(true);
    try {
      const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `storage-${Date.now()}`;
      const response = await fetch(apiUrl("/account/storage-package/activate"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ idempotencyKey: key })
      });
      if (!response.ok) throw new Error(response.status === 402 ? "insufficient" : "storage failed");
      const data = (await response.json()) as StorageActivationResponse;
      setLoadState((currentState) => {
        if (currentState.status !== "ready") return currentState;
        return {
          ...currentState,
          overview: {
            ...currentState.overview,
            storagePackage: data.storagePackage,
            quota: {
              ...currentState.overview.quota,
              remainingCredits: data.quota.remainingCredits
            }
          }
        };
      });
      refreshQuota?.();
      showToast("success", data.alreadyActive
        ? localeText(locale, "资源存储包当前仍有效", "Storage package is still active.")
        : localeText(locale, "资源存储包已开通", "Storage package activated.")
      );
      void refreshOverview().catch(() => {});
    } catch (error) {
      showToast("error", error instanceof Error && error.message === "insufficient" ? localeText(locale, "额度不足，请先充值", "Not enough credits. Recharge first.") : localeText(locale, "资源存储包开通失败，请重试", "Storage package activation failed. Please try again."));
    } finally {
      setStorageActivating(false);
    }
  }

  async function checkIn() {
    if (!token || !overview?.checkIn.enabled || overview.checkIn.todayCheckedIn || checkInLoading) return;
    setCheckInLoading(true);
    try {
      const response = await fetch(apiUrl("/account/check-in"), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("check-in failed");
      await refreshOverview();
      refreshQuota?.();
    } catch {
      showToast("error", localeText(locale, "签到失败，请重试", "Check-in failed. Please try again."));
    } finally {
      setCheckInLoading(false);
    }
  }

  async function toggleAutoRenew() {
    if (!token || !overview || autoRenewToggling) return;
    if (!overview.storagePackage.autoRenewAvailable) {
      showToast("info", localeText(locale, "自动续费当前不可用", "Auto-renewal is currently unavailable."));
      return;
    }
    if (overview.storagePackage.status !== "ACTIVE") {
      showToast("info", localeText(locale, "请先开通资源存储包", "Please activate a storage package first."));
      return;
    }
    const next = !overview.storagePackage.autoRenewEnabled;
    setAutoRenewToggling(true);
    try {
      const response = await fetch(apiUrl("/account/storage-package/auto-renew"), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next })
      });
      if (response.status === 403) {
        showToast("error", localeText(locale, "自动续费当前不可用", "Auto-renewal is currently unavailable."));
        return;
      }
      if (response.status === 409) {
        showToast("error", localeText(locale, "请先开通资源存储包", "Please activate a storage package first."));
        return;
      }
      if (!response.ok) throw new Error("auto-renew failed");
      const data = (await response.json()) as { storagePackage: AccountOverview["storagePackage"] };
      setLoadState((currentState) => {
        if (currentState.status !== "ready") return currentState;
        return {
          ...currentState,
          overview: {
            ...currentState.overview,
            storagePackage: data.storagePackage
          }
        };
      });
      showToast("success", next
        ? localeText(locale, "已保存自动续费偏好", "Auto-renew preference saved.")
        : localeText(locale, "已关闭自动续费偏好", "Auto-renew preference disabled.")
      );
    } catch {
      showToast("error", localeText(locale, "操作失败，请重试", "Action failed. Please try again."));
    } finally {
      setAutoRenewToggling(false);
    }
  }

  function requestCancelOrder(activity: AccountActivitySummary) {
    if (
      activity.status !== "PENDING" ||
      !getOrderIdFromAccountActivity(activity) ||
      cancelOrderInFlightRef.current
    ) {
      return;
    }
    setCancelOrderActivity(activity);
  }

  function closeCancelOrderDialog() {
    if (!cancelOrderInFlightRef.current) {
      setCancelOrderActivity(null);
    }
  }

  async function confirmCancelOrder() {
    const orderId = cancelOrderActivity
      ? getOrderIdFromAccountActivity(cancelOrderActivity)
      : null;
    if (!token || !orderId || cancelOrderInFlightRef.current) return;

    cancelOrderInFlightRef.current = true;
    setCancellingOrderId(orderId);
    try {
      const response = await fetch(
        apiUrl(`/orders/${encodeURIComponent(orderId)}/cancel`),
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!response.ok) throw new Error("order cancellation failed");

      const data = (await response.json()) as { order?: OrderSummary };
      if (data.order?.id !== orderId || data.order.status !== "CANCELLED") {
        throw new Error("invalid order cancellation response");
      }
      if (!mountedRef.current) return;

      setLoadState((currentState) => {
        if (currentState.status !== "ready") return currentState;
        return {
          ...currentState,
          overview: {
            ...currentState.overview,
            activities: currentState.overview.activities.map((activity) =>
              activity.id === `${ORDER_ACTIVITY_ID_PREFIX}${orderId}`
                ? {
                    ...activity,
                    status: "CANCELLED",
                    completedAt: null
                  }
                : activity
            )
          }
        };
      });
      setCancelOrderActivity(null);
      showToast("success", t("account.orderCancelled"));
    } catch {
      if (mountedRef.current) {
        setCancelOrderActivity(null);
        showToast("error", t("account.orderCancelFailed"));
      }
    } finally {
      cancelOrderInFlightRef.current = false;
      if (mountedRef.current) setCancellingOrderId(null);
    }
  }

  async function copyReferralCode() {
    const code = overview?.referral.code;
    if (!code || !navigator.clipboard) {
      showToast("error", localeText(locale, "复制失败", "Copy failed."));
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      showToast("success", localeText(locale, "邀请码已复制", "Invite code copied."));
    } catch {
      showToast("error", localeText(locale, "复制失败", "Copy failed."));
    }
  }

  async function copyReferralInfo() {
    const code = overview?.referral.code;
    if (!code || !navigator.clipboard) {
      showToast("error", localeText(locale, "复制失败", "Copy failed."));
      return;
    }
    try {
      await navigator.clipboard.writeText(`${localeText(locale, "邀请码", "Invite code")}: ${code}`);
      showToast("success", localeText(locale, "邀请信息已复制", "Invitation info copied."));
    } catch {
      showToast("error", localeText(locale, "复制失败", "Copy failed."));
    }
  }

  function clearChangePasswordState() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setChangePasswordError(null);
    setChangePasswordPending(false);
  }

  function openChangePasswordDialog() {
    clearChangePasswordState();
    setSecurityDialog({ kind: "change-password" });
  }

  function closeChangePasswordDialog() {
    if (changePasswordInFlightRef.current) return;
    clearChangePasswordState();
    setSecurityDialog(null);
  }

  function clearRevokeSessionsState() {
    setRevokeSessionsError(null);
    setRevokeSessionsPending(false);
  }

  function openDeviceManagementDialog() {
    clearRevokeSessionsState();
    setSecurityDialog({ kind: "devices", step: "details" });
  }

  function closeDeviceManagementDialog() {
    if (revokeSessionsInFlightRef.current) return;
    clearRevokeSessionsState();
    setSecurityDialog(null);
  }

  function openPlaceholderDialog(topic: "email" | "invoice") {
    setSecurityDialog({ kind: "placeholder", topic });
  }

  function closePlaceholderDialog() {
    setSecurityDialog(null);
  }

  function formatRateLimitedError(retryAfterSeconds: number | undefined): string {
    if (retryAfterSeconds === undefined) return t("account.security.rateLimited");
    return `${t("account.security.rateLimited")} ${t("account.security.retryAfterSeconds", { seconds: retryAfterSeconds })}`;
  }

  function getChangePasswordErrorMessage(error: AccountSecurityRequestError): string {
    if (error.status === undefined) {
      return t("account.security.apiUnavailable");
    }

    if (error.status === 429) {
      return formatRateLimitedError(error.retryAfterSeconds);
    }

    switch (error.code) {
      case "CURRENT_PASSWORD_INVALID":
        return t("account.security.currentPasswordInvalid");
      case "NEW_PASSWORD_MUST_DIFFER":
        return t("account.security.newPasswordMustDiffer");
      case "NEW_PASSWORD_INVALID":
      case "CHANGE_PASSWORD_INVALID_REQUEST":
        return t("account.security.invalidRequest");
      default:
        return t("account.security.requestFailed");
    }
  }

  async function submitChangePassword(event: React.FormEvent) {
    event.preventDefault();
    if (changePasswordInFlightRef.current) return;

    setChangePasswordError(null);

    if (!token) {
      setChangePasswordError(t("account.security.authenticationRequired"));
      return;
    }

    if (!currentPassword) {
      setChangePasswordError(t("account.security.currentPasswordRequired"));
      return;
    }

    if (new TextEncoder().encode(currentPassword).length > 72) {
      setChangePasswordError(t("account.security.currentPasswordInvalid"));
      return;
    }

    if (Array.from(newPassword).length < 8) {
      setChangePasswordError(t("account.security.newPasswordTooShort"));
      return;
    }

    if (new TextEncoder().encode(newPassword).length > 72) {
      setChangePasswordError(t("account.security.newPasswordTooLong"));
      return;
    }

    if (confirmPassword !== newPassword) {
      setChangePasswordError(t("account.security.passwordConfirmationMismatch"));
      return;
    }

    if (newPassword === currentPassword) {
      setChangePasswordError(t("account.security.newPasswordMustDiffer"));
      return;
    }

    changePasswordInFlightRef.current = true;
    setChangePasswordPending(true);

    try {
      await changeAccountPassword({
        token,
        currentPassword,
        newPassword,
        messages: {
          requestFailed: t("account.security.requestFailed"),
          apiUnavailable: t("account.security.apiUnavailable")
        }
      });

      if (!mountedRef.current) return;
      clearChangePasswordState();
      setSecurityDialog(null);
      onLogout();
    } catch (error) {
      if (!mountedRef.current) return;

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      if (error instanceof AccountSecurityRequestError && error.status === 401) {
        setChangePasswordError(null);
        setSecurityDialog(null);
        onLogout();
        return;
      }

      setChangePasswordError(
        error instanceof AccountSecurityRequestError
          ? getChangePasswordErrorMessage(error)
          : t("account.security.requestFailed")
      );
    } finally {
      changePasswordInFlightRef.current = false;
      if (mountedRef.current) setChangePasswordPending(false);
    }
  }

  async function confirmRevokeSessions() {
    if (revokeSessionsInFlightRef.current) return;

    if (!token) {
      setRevokeSessionsError(t("account.security.authenticationRequired"));
      return;
    }

    revokeSessionsInFlightRef.current = true;
    setRevokeSessionsPending(true);
    setRevokeSessionsError(null);

    try {
      await revokeAccountSessions({
        token,
        messages: {
          requestFailed: t("account.security.requestFailed"),
          apiUnavailable: t("account.security.apiUnavailable")
        }
      });

      if (!mountedRef.current) return;
      clearRevokeSessionsState();
      setSecurityDialog(null);
      onLogout();
    } catch (error) {
      if (!mountedRef.current) return;

      if (error instanceof AccountSecurityRequestError && error.status === 401) {
        setRevokeSessionsError(null);
        setSecurityDialog(null);
        onLogout();
        return;
      }

      if (error instanceof AccountSecurityRequestError && error.status === 429) {
        setRevokeSessionsError(formatRateLimitedError(error.retryAfterSeconds));
        return;
      }

      setRevokeSessionsError(
        error instanceof AccountSecurityRequestError && error.status === undefined
          ? t("account.security.apiUnavailable")
          : t("account.security.requestFailed")
      );
    } finally {
      revokeSessionsInFlightRef.current = false;
      if (mountedRef.current) setRevokeSessionsPending(false);
    }
  }

  if (!token || loadState.status === "unauthenticated") {
    return <div className="flex flex-1 items-center justify-center px-4 py-12"><div className="text-center"><UserRound className="mx-auto size-10 text-indigo-500" /><h3 className="mt-4 text-xl font-semibold text-slate-950 dark:text-slate-100">{localeText(locale, "个人中心", "Account center")}</h3><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{localeText(locale, "登录后管理个人资料与账户权益", "Sign in to manage your profile and account benefits.")}</p><div className="mt-5 grid gap-2 sm:grid-cols-2"><button type="button" className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white" onClick={() => workspaceShell?.openAuthDialog()}>{localeText(locale, "登录", "Log in")}</button><Link href="/plans" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40" data-account-view-plans="true">{localeText(locale, "查看套餐与价格", "View plans & pricing")}<ArrowRight className="size-4" aria-hidden="true" /></Link></div></div></div>;
  }
  if (loadState.status === "loading") return isMobileSurface ? <MobileAccountLoadingSkeleton /> : <div className="flex flex-1 items-center justify-center text-sm text-slate-500">{localeText(locale, "正在加载个人中心…", "Loading account center…")}</div>;
  if (loadState.status === "error" || !overview || !profile) return <div className="flex flex-1 items-center justify-center px-4"><div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><p>{loadState.status === "error" ? loadState.message : localeText(locale, "个人中心不可用", "Account center unavailable")}</p>{loadState.status === "error" ? <button type="button" onClick={() => { void refreshOverview().catch(() => undefined); }} className="mt-3 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold dark:border-red-800">{localeText(locale, "重试", "Retry")}</button> : null}</div></div>;

  const planIcon = overview.plan.name.toLowerCase().includes("pro") ? Crown : overview.plan.name.toLowerCase().includes("max") || overview.plan.name.toLowerCase().includes("team") ? Layers3 : Sparkles;
  const PlanIcon = planIcon;
  const orderedDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${overview.checkIn.todayDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });

  if (isMobileSurface) {
    return (
      <>
        <MobileAccountPanel
        overview={overview}
        profile={profile}
        displayName={displayName}
        userSeed={userSeed}
        locale={locale}
        t={t}
        theme={theme}
        onToggleTheme={toggleTheme}
        onToggleLocale={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
        avatarInputRef={avatarInputRef}
        avatarUploading={avatarUploading}
        avatarPreviewUrl={avatarPreviewUrl}
        onAvatarFile={(file) => { void uploadAvatar(file); }}
        nicknameEditing={nicknameEditing}
        nicknameDraft={nicknameDraft}
        nicknameState={nicknameState}
        onBeginNicknameEdit={beginNicknameEdit}
        onNicknameDraftChange={setNicknameDraft}
        onSaveNickname={() => { void saveNickname(); }}
        onOpenBilling={handleOpenBilling}
        onCancelOrder={requestCancelOrder}
        cancellingActivityId={cancellingOrderId ? `${ORDER_ACTIVITY_ID_PREFIX}${cancellingOrderId}` : null}
        cancelOrderLabel={t("account.cancelOrder")}
        isAdmin={isAdmin}
        onLogout={onLogout}
        drawer={mobileDrawer}
        drawerReturnFocusRef={mobileDrawerReturnFocusRef}
        onOpenDrawer={openMobileDrawer}
        onCloseDrawer={closeMobileDrawer}
        drawerPending={Boolean(avatarUploading || storageActivating || checkInLoading || autoRenewToggling || changePasswordPending || revokeSessionsPending)}
        token={token}
        checkInLoading={checkInLoading}
        onCheckIn={() => { void checkIn(); }}
        onCopyReferralCode={() => { void copyReferralCode(); }}
        onCopyReferralInfo={() => { void copyReferralInfo(); }}
        rulesOpen={rulesOpen}
        onToggleRules={() => setRulesOpen((open) => !open)}
        storageActivating={storageActivating}
        autoRenewToggling={autoRenewToggling}
        onActivateStorage={() => { void activateStorage(); }}
        onToggleAutoRenew={() => { void toggleAutoRenew(); }}
        securityDialog={securityDialog}
        onOpenChangePassword={openChangePasswordDialog}
        onOpenDeviceManagement={openDeviceManagementDialog}
        onSetSecurityDialog={(state) => setSecurityDialog(state)}
        currentPassword={currentPassword}
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        onCurrentPasswordChange={setCurrentPassword}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        changePasswordError={changePasswordError}
        changePasswordPending={changePasswordPending}
        onSubmitChangePassword={submitChangePassword}
        revokeSessionsError={revokeSessionsError}
        revokeSessionsPending={revokeSessionsPending}
        onConfirmRevokeSessions={() => { void confirmRevokeSessions(); }}
        />
        <ConfirmDialog
          isOpen={cancelOrderActivity !== null}
          title={t("account.cancelOrderConfirmTitle")}
          message={t("account.cancelOrderConfirmMessage")}
          confirmLabel={cancellingOrderId ? t("account.cancellingOrder") : t("account.cancelOrderConfirm")}
          cancelLabel={t("account.security.cancel")}
          onConfirm={() => { void confirmCancelOrder(); }}
          onCancel={closeCancelOrderDialog}
        />
        <WorkspaceToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-5 dark:bg-slate-950 sm:px-6 lg:px-8" data-account-page="ux-5">
      <div className="mx-auto max-w-[1440px]" data-account-mobile-order="profile,subscription,storage,check-in,referral,activity,security">
        <header className="mb-5 flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-3xl">{localeText(locale, "个人中心", "Account center")}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{localeText(locale, "管理个人资料、套餐订阅、资源存储与推广权益", "Manage your profile, plans, resource storage, and growth benefits.")}</p>
        </header>

        <div className="grid min-w-0 gap-4 lg:grid-cols-4">
          <section data-account-card="profile" className="account-card lg:col-span-2"><CardTitle icon={UserRound} title={localeText(locale, "个人资料", "Personal information")} /><div className="grid gap-5 p-5 sm:grid-cols-[190px_minmax(0,1fr)]"><div className="flex flex-col items-center gap-3"><div className="relative"><UserAvatar displayName={displayName} seed={userSeed} avatarUrl={avatarPreviewUrl ?? profile.avatarUrl} token={token} size="xl" /><button type="button" className="absolute -bottom-1 -right-1 inline-flex size-9 items-center justify-center rounded-full border-4 border-white bg-slate-100 text-slate-600 shadow-sm dark:border-slate-900 dark:bg-slate-800 dark:text-slate-200" onClick={() => avatarInputRef.current?.click()} aria-label={localeText(locale, "上传头像", "Upload avatar")}><Camera className="size-4" /></button></div><input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { void uploadAvatar(event.target.files?.[0]); event.target.value = ""; }} /><button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">{avatarUploading ? localeText(locale, "上传中…", "Uploading…") : localeText(locale, "上传头像", "Upload avatar")}</button></div><div className="space-y-4"><div ref={nicknameRef}><div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{localeText(locale, "昵称", "Nickname")}</div>{nicknameEditing ? <input autoFocus value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value)} onBlur={() => { void saveNickname(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveNickname(); } if (event.key === "Escape") { setNicknameEditing(false); setNicknameState("idle"); } }} className="block w-full rounded-xl border border-indigo-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-none dark:border-indigo-700 dark:bg-slate-800 dark:text-slate-100" /> : <button type="button" onClick={beginNicknameEdit} className="account-field flex w-full items-center gap-2 cursor-pointer"><span className="flex-1 truncate text-left text-sm font-semibold text-slate-900 dark:text-slate-100">{displayName}</span><Pencil className="size-3.5 shrink-0 text-slate-400" /></button>}{nicknameState === "error" ? <p className="mt-1 text-xs text-rose-600">{localeText(locale, "昵称格式无效", "Invalid nickname format.")}</p> : null}</div><div><div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{localeText(locale, "绑定邮箱", "Bound email")}</div><div className="account-field flex items-center gap-2"><span className="flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{profile.email}</span><button type="button" onClick={() => openPlaceholderDialog("email")} className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">{t("account.security.changeEmail")}</button></div></div><div className="flex flex-wrap gap-2"><span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">{getUserRoleLabel(profile.role, locale)}</span><span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><BadgeCheck className="size-3.5" />{localeText(locale, "账号正常", "Account active")}</span></div></div></div></section>

          <section data-account-card="subscription" className="account-card lg:col-span-2"><CardTitle icon={Crown} title={localeText(locale, "当前订阅", "Current subscription")} titleAddon={<span className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{overview.plan.name}</span>} /><div className="grid gap-4 p-5 sm:grid-cols-[155px_minmax(0,1fr)]"><div className="flex min-h-[118px] items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-sky-50 text-indigo-600 dark:from-indigo-950/60 dark:via-slate-900 dark:to-sky-950/40"><PlanIcon className="size-12" /><span className="sr-only">{overview.plan.name}</span></div><div className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm"><DataPair label={localeText(locale, "当前计划", "Current plan")} value={overview.plan.name} /><DataPair label={localeText(locale, "剩余额度", "Remaining credits")} value={`${overview.quota.remainingCredits.toLocaleString()} ${localeText(locale, "额度", "credits")}`} /><DataPair label={localeText(locale, "下次结算", "Next billing")} value={formatDate(overview.plan.nextBillingAt, locale)} /><DataPair label={localeText(locale, "订阅状态", "Status")} value={overview.plan.status === "ACTIVE" ? localeText(locale, "有效", "Active") : localeText(locale, "基础套餐", "Base plan")} /></div></div><div className="grid gap-3 border-t border-slate-100 p-5 dark:border-slate-800 sm:grid-cols-2"><button type="button" onClick={handleOpenBilling} className="primary-action"><Crown className="size-4" />{localeText(locale, "管理订阅套餐", "Manage plans")}</button><button type="button" onClick={handleOpenBilling} className="secondary-action"><WalletCards className="size-4" />{localeText(locale, "充值额度", "Recharge credits")}</button></div></section>

          <section data-account-card="storage" className="account-card relative overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-sky-50 dark:from-indigo-950/50 dark:via-slate-900 dark:to-sky-950/30 lg:col-span-2"><div className="pointer-events-none absolute -right-3 -top-3 text-indigo-200/70 dark:text-indigo-800/40"><Cloud className="size-32" /></div><CardTitle icon={Cloud} title={localeText(locale, "资源存储包", "Storage package")} titleAddon={<span className={storageStatusColor(overview.storagePackage.status)}>{storageStatusLabel(overview.storagePackage.status, locale)}</span>} /><p className="relative px-5 text-sm leading-6 text-slate-600 dark:text-slate-300">{overview.storagePackage.description || localeText(locale, "开通后，您的对话、作品和资源可在有效期内长期保存。", "Keep your conversations, creations, and resources available during the active period.")}</p><div className="relative m-5 grid gap-3 rounded-2xl border border-white/80 bg-white/75 p-4 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 sm:grid-cols-2"><DataPair label={localeText(locale, "服务价格", "Price")} value={`${overview.storagePackage.priceCredits} ${localeText(locale, "额度/月", "credits/mo")}`} /><DataPair label={localeText(locale, "到期时间", "Expires")} value={formatDate(overview.storagePackage.expiresAt, locale)} /></div><div className="relative mx-5 mb-5 flex items-center justify-between gap-3 rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70"><span className="font-semibold text-slate-700 dark:text-slate-200">{localeText(locale, "自动续费偏好", "Auto-renew preference")}</span>{overview.storagePackage.autoRenewAvailable ? (overview.storagePackage.status === "ACTIVE" ? <button type="button" onClick={() => void toggleAutoRenew()} disabled={autoRenewToggling} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${autoRenewToggling ? "opacity-60" : ""} ${overview.storagePackage.autoRenewEnabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600"}`}><span className={`inline-block size-4 transform rounded-full bg-white shadow-sm transition-transform ${overview.storagePackage.autoRenewEnabled ? "translate-x-6" : "translate-x-1"}`} /></button> : <span className="text-xs text-slate-400 dark:text-slate-500">{localeText(locale, "开通后可设置", "Available after activation")}</span>) : <span className="text-xs text-slate-400 dark:text-slate-500">{localeText(locale, "后续开放", "Coming later")}</span>}</div><div className="relative flex flex-col gap-3 px-5 pb-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400"><Lightbulb className="size-4 shrink-0" /><span>{localeText(locale, "推荐给高频使用资产库和内容创作的用户", "Recommended for users who frequently use asset library and content creation.")}</span></div><button type="button" disabled={!overview.storagePackage.enabled || overview.storagePackage.status === "ACTIVE" || storageActivating} onClick={() => void activateStorage()} className="primary-action shrink-0">{overview.storagePackage.status === "ACTIVE" ? <><BadgeCheck className="size-4" />{localeText(locale, "已开通", "Active")}</> : storageActivating ? localeText(locale, "开通中…", "Activating…") : localeText(locale, "立即开通", "Activate storage")}</button></div></section>

          <section data-account-card="check-in" className="account-card lg:col-span-1"><CardTitle icon={CalendarCheck2} title={localeText(locale, "每日签到", "Daily check-in")} /><div className="p-5"><div className="flex items-end justify-between"><div><div className="text-2xl font-bold text-slate-950 dark:text-slate-50">{localeText(locale, "已连续签到", "Streak")} {overview.checkIn.currentStreak} {localeText(locale, "天", "days")}</div><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{localeText(locale, "今日签到可得", "Today earns")} <span className="font-bold text-amber-600">+{overview.checkIn.dailyRewardCredits}</span> {localeText(locale, "额度", "credits")}</p></div><CalendarCheck2 className="size-10 text-indigo-500" /></div><button type="button" disabled={!overview.checkIn.enabled || overview.checkIn.todayCheckedIn || checkInLoading} onClick={() => void checkIn()} className="primary-action mt-5 w-full">{overview.checkIn.todayCheckedIn ? <><Check className="size-4" />{localeText(locale, "今日已签到", "Checked in today")}</> : checkInLoading ? localeText(locale, "签到中…", "Checking in…") : localeText(locale, "立即签到", "Check in")}</button><div className="mt-5 grid grid-cols-7 gap-1 border-t border-slate-100 pt-4 dark:border-slate-800">{orderedDates.map((date, index) => { const checked = overview.checkIn.checkedDates.includes(date); return <div key={date} className="text-center"><div className="text-[10px] text-slate-400">{localeText(locale, "第", "Day ")}{index + 1}</div><div className={`mx-auto mt-1 flex size-6 items-center justify-center rounded-full border ${checked ? "border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50" : "border-slate-200 text-slate-300 dark:border-slate-700"}`}>{checked ? <Check className="size-3" /> : <span className="size-1 rounded-full bg-current" />}</div></div>; })}</div></div></section>

          <section data-account-card="referral" className="account-card lg:col-span-1"><CardTitle icon={Gift} title={localeText(locale, "邀请有礼", "Referral rewards")} /><div className="p-5"><p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{overview.referral.registrationIntegration === "PREPARATION" ? localeText(locale, "邀请码已生成；注册绑定将在后续安全阶段接入。", "Your code is ready; registration binding will be added in the next security phase.") : overview.referral.rewardTrigger}</p><div className="mt-3 flex items-center gap-2"><div className="min-w-0 flex-1 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-2.5 text-center font-mono text-sm font-bold tracking-wide text-slate-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-slate-100">{overview.referral.code ?? "—"}</div><button type="button" disabled={!overview.referral.code} onClick={() => void copyReferralCode()} className="secondary-action shrink-0 px-3" title={localeText(locale, "复制邀请码", "Copy code")}><Clipboard className="size-4" /></button></div><button type="button" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400" onClick={() => setRulesOpen(true)}>{localeText(locale, "查看推广规则", "View referral rules")}<ChevronRight className="size-3.5" /></button><div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 dark:border-slate-800"><DataPair label={localeText(locale, "已邀请人数", "Invited")} value={`${overview.referral.invitedCount}`} /><DataPair label={localeText(locale, "累计奖励", "Rewards")} value={`${overview.referral.totalRewardCredits} ${localeText(locale, "额度", "credits")}`} /></div></div></section>

          <section data-account-card="activity" className="account-card lg:col-span-2"><CardTitle icon={ReceiptText} title={localeText(locale, "订单与开通记录", "Orders and activations")} action={<button type="button" onClick={() => setActivityModalOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 hover:border-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40">{localeText(locale, "查看更多", "View more")}<ChevronRight className="size-3" /></button>} />{hasPendingOrder ? <div className="mx-5 mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between" data-account-pending-order-recovery="true"><div><p className="font-semibold">{localeText(locale, "有待支付订单", "Pending payment available")}</p><p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">{localeText(locale, "继续支付会复用原订单，不会创建新订单。", "Continue payment reuses the existing order and does not create a new one.")}</p></div><button type="button" onClick={handleOpenBilling} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white transition hover:bg-amber-700" data-account-payment-resume="true">{t("payment.continuePayment")}</button></div> : null}<div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs sm:text-sm"><thead className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400"><tr><th className="px-5 py-3 font-medium">{localeText(locale, "项目", "Item")}</th><th className="px-5 py-3 font-medium">{localeText(locale, "类型", "Type")}</th><th className="px-5 py-3 font-medium">{localeText(locale, "状态", "Status")}</th><th className="px-5 py-3 font-medium">{localeText(locale, "额度", "Credits")}</th><th className="px-5 py-3 font-medium">{localeText(locale, "创建时间", "Created")}</th></tr></thead><tbody>{overview.activities.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500 dark:text-slate-400">{localeText(locale, "暂无订单或账户变动记录", "No orders or account activity yet.")}</td></tr> : overview.activities.map((activity) => <ActivityRow key={activity.id} activity={activity} locale={locale} onOpenBilling={handleOpenBilling} onCancelOrder={requestCancelOrder} cancellingOrderId={cancellingOrderId} cancelOrderLabel={t("account.cancelOrder")} cancellingOrderLabel={t("account.cancellingOrder")} />)}</tbody></table></div></section>

          <section data-account-card="security" className="account-card lg:col-span-2"><CardTitle icon={ShieldCheck} title={t("account.security.title")} /><div className="grid gap-3 p-5 sm:grid-cols-2"><ActionRow icon={KeyRound} label={t("account.security.changePassword")} onClick={openChangePasswordDialog} /><ActionRow icon={Mail} label={t("account.security.changeEmail")} onClick={() => openPlaceholderDialog("email")} /><ActionRow icon={ShieldCheck} label={t("account.security.deviceManagement")} onClick={openDeviceManagementDialog} /><ActionRow icon={ReceiptText} label={t("account.security.invoiceBilling")} onClick={() => openPlaceholderDialog("invoice")} /><button type="button" onClick={onLogout} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-red-600 transition hover:border-red-200 hover:bg-red-50 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/30 sm:col-span-2"><LogOut className="size-4" />{localeText(locale, "退出登录", "Log out")}</button></div></section>
        </div>
      </div>
      {rulesOpen ? <Modal title={localeText(locale, "推广规则", "Referral rules")} onClose={() => setRulesOpen(false)} closeLabel={localeText(locale, "关闭", "Close")}><p className="whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{overview.referral.rulesText || localeText(locale, "暂无规则说明", "No referral rules are configured.")}</p></Modal> : null}
      {securityDialog?.kind === "change-password" ? <AccountSecurityDialog dialogId="account-change-password-dialog" title={t("account.security.changePassword")} description={t("account.security.changePasswordDescription")} closeLabel={t("account.security.close")} pending={changePasswordPending} initialFocusRef={currentPasswordInputRef} onClose={closeChangePasswordDialog}><form className="grid gap-4" noValidate onSubmit={submitChangePassword}><label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{t("account.security.currentPassword")}<input ref={currentPasswordInputRef} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={changePasswordPending} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40" /></label><label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{t("account.security.newPassword")}<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={changePasswordPending} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40" /></label><label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{t("account.security.confirmPassword")}<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={changePasswordPending} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40" /></label>{changePasswordError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{changePasswordError}</p> : null}<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={changePasswordPending} onClick={closeChangePasswordDialog} className="secondary-action justify-center">{t("account.security.cancel")}</button><button type="submit" disabled={changePasswordPending} className="primary-action justify-center">{changePasswordPending ? t("account.security.changingPassword") : t("account.security.submitChangePassword")}</button></div></form></AccountSecurityDialog> : null}
      {securityDialog?.kind === "devices" ? <AccountSecurityDialog dialogId="account-device-management-dialog" title={securityDialog.step === "confirm" ? t("account.security.revokeSessionsConfirmTitle") : t("account.security.deviceManagement")} description={securityDialog.step === "confirm" ? t("account.security.revokeSessionsConfirmDescription") : t("account.security.deviceManagementDescription")} closeLabel={t("account.security.close")} pending={revokeSessionsPending} onClose={closeDeviceManagementDialog}>{securityDialog.step === "details" ? <div className="grid gap-5"><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{t("account.security.currentBrowserLogoutHint")}</p><button type="button" onClick={() => { if (!revokeSessionsInFlightRef.current) { setRevokeSessionsError(null); setSecurityDialog({ kind: "devices", step: "confirm" }); } }} disabled={revokeSessionsPending} className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">{t("account.security.revokeSessions")}</button></div> : <div className="grid gap-5">{revokeSessionsError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{revokeSessionsError}</p> : null}<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={revokeSessionsPending} onClick={() => { if (!revokeSessionsInFlightRef.current) { setRevokeSessionsError(null); setSecurityDialog({ kind: "devices", step: "details" }); } }} className="secondary-action justify-center">{t("account.security.revokeSessionsCancel")}</button><button type="button" disabled={revokeSessionsPending} onClick={() => void confirmRevokeSessions()} className="justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">{revokeSessionsPending ? t("account.security.revokingSessions") : t("account.security.revokeSessionsConfirm")}</button></div></div>}</AccountSecurityDialog> : null}
      {securityDialog?.kind === "placeholder" ? <AccountSecurityDialog dialogId={`account-${securityDialog.topic}-placeholder-dialog`} title={securityDialog.topic === "email" ? t("account.security.changeEmail") : t("account.security.invoiceBilling")} description={t("account.security.comingSoon")} closeLabel={t("account.security.close")} onClose={closePlaceholderDialog}><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{t("account.security.comingSoon")}</p></AccountSecurityDialog> : null}
      <AccountActivityModal token={token} locale={locale} isOpen={activityModalOpen} onClose={() => setActivityModalOpen(false)} onOpenBilling={handleOpenBilling} onCancelOrder={requestCancelOrder} cancellingActivityId={cancellingOrderId ? `${ORDER_ACTIVITY_ID_PREFIX}${cancellingOrderId}` : null} cancelOrderLabel={t("account.cancelOrder")} />
      <ConfirmDialog
        isOpen={cancelOrderActivity !== null}
        title={t("account.cancelOrderConfirmTitle")}
        message={t("account.cancelOrderConfirmMessage")}
        confirmLabel={cancellingOrderId ? t("account.cancellingOrder") : t("account.cancelOrderConfirm")}
        cancelLabel={t("account.security.cancel")}
        onConfirm={() => { void confirmCancelOrder(); }}
        onCancel={closeCancelOrderDialog}
      />
      <WorkspaceToastContainer toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

function CardTitle({ icon: Icon, title, titleAddon, action }: { icon: React.ComponentType<{ className?: string }>; title: string; titleAddon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-50">
        <Icon className="size-5 shrink-0 text-indigo-500" />
        <span>{title}</span>
        {titleAddon}
      </div>
      {action}
    </div>
  );
}

function DataPair({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><div className="text-xs text-slate-500 dark:text-slate-400">{label}</div><div className="mt-1 truncate font-semibold text-slate-900 dark:text-slate-100">{value}</div></div>; }
function storageStatusLabel(status: AccountOverview["storagePackage"]["status"], locale: string) { return status === "ACTIVE" ? localeText(locale, "已开通", "Active") : status === "EXPIRED" ? localeText(locale, "已过期", "Expired") : localeText(locale, "未开通", "Not active"); }
function storageStatusColor(status: AccountOverview["storagePackage"]["status"]) { return `shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${status === "ACTIVE" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : status === "EXPIRED" ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`; }
function ActivityRow({ activity, locale, onOpenBilling, onCancelOrder, cancellingOrderId, cancelOrderLabel, cancellingOrderLabel }: { activity: AccountActivitySummary; locale: string; onOpenBilling: () => void; onCancelOrder: (activity: AccountActivitySummary) => void; cancellingOrderId: string | null; cancelOrderLabel: string; cancellingOrderLabel: string }) { const orderId = getOrderIdFromAccountActivity(activity); const isCancelling = orderId !== null && orderId === cancellingOrderId; return <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="max-w-[180px] truncate px-5 py-3 font-semibold text-slate-800 dark:text-slate-100">{getAccountActivityTitle(activity, locale)}</td><td className="px-5 py-3 text-slate-500 dark:text-slate-400">{getAccountActivityKindLabel(activity, locale)}</td><td className="px-5 py-3"><div className="grid justify-items-start gap-2"><span className={`rounded-md px-2 py-1 text-xs font-semibold ${activity.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : activity.status === "PENDING" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" : activity.status === "CANCELLED" ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"}`}>{getAccountActivityStatusLabel(activity, locale)}</span>{activity.kind === "ORDER" && activity.status === "PENDING" ? <div className="flex flex-wrap gap-2"><button type="button" onClick={onOpenBilling} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400" data-account-payment-resume="true">{localeText(locale, "继续支付", "Continue payment")}</button><button type="button" disabled={isCancelling} onClick={() => onCancelOrder(activity)} className="text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-400" data-account-order-cancel="true" data-order-activity-id={activity.id}>{isCancelling ? cancellingOrderLabel : cancelOrderLabel}</button></div> : null}</div></td><td className={`px-5 py-3 font-semibold ${activity.creditsDelta < 0 ? "text-red-600" : "text-emerald-600"}`}>{activity.creditsDelta > 0 ? "+" : ""}{activity.creditsDelta}</td><td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-slate-400">{formatDate(activity.createdAt, locale)}</td></tr>; }
function ActionRow({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50/50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-indigo-950/30"><Icon className="size-5 text-slate-500 dark:text-slate-400" /><span className="min-w-0 flex-1 truncate">{label}</span><ChevronRight className="size-4 text-slate-400" /></button>; }
function AccountSecurityDialog({ dialogId, title, description, closeLabel, pending = false, initialFocusRef, onClose, children }: { dialogId: string; title: string; description: string; closeLabel: string; pending?: boolean; initialFocusRef?: React.RefObject<HTMLElement | null>; onClose: () => void; children: React.ReactNode }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(pending);

  useEffect(() => {
    onCloseRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) onCloseRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    (initialFocusRef?.current ?? closeButtonRef.current)?.focus();
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 dark:bg-slate-950/70" data-account-security-backdrop="true" onMouseDown={(event) => { if (!pending && event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby={dialogId} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h2 id={dialogId} className="text-lg font-semibold text-slate-950 dark:text-slate-100">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p></div><button ref={closeButtonRef} type="button" disabled={pending} onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300" aria-label={closeLabel} title={closeLabel}><X className="size-5" aria-hidden="true" /></button></div><div className="mt-5">{children}</div></section></div>;
}
function Modal({ title, children, onClose, closeLabel }: { title: string; children: React.ReactNode; onClose: () => void; closeLabel: string }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-bold text-slate-950 dark:text-slate-50">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={closeLabel}>×</button></div><div className="mt-4">{children}</div><button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">{closeLabel}</button></div></div>; }
