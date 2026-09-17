"use client";

import type { AccountActivitySummary, AccountOverview, AuthUser } from "@ai-aggregate/shared";
import {
  CalendarCheck2,
  Camera,
  Check,
  ChevronRight,
  Clipboard,
  Cloud,
  Copy,
  Globe,
  HelpCircle,
  KeyRound,
  Link as LinkIcon,
  LogOut,
  Menu,
  Moon,
  Pencil,
  ReceiptText,
  ShieldCheck,
  Sun,
  UserRound,
  Users,
  WalletCards,
  X
} from "lucide-react";
import Link from "next/link";
import React from "react";
import { AccountActivityContent } from "./AccountActivityModal";
import { MobileAccountDrawer, type MobileAccountDrawerVariant } from "./MobileAccountDrawer";
import type { SecurityDialogState } from "./AccountPanel";
import { UserAvatar } from "./UserAvatar";

type MobileDrawerKind = "check-in" | "referral" | "storage" | "activity" | "security" | null;

export interface MobileAccountPanelProps {
  overview: AccountOverview;
  profile: AuthUser;
  displayName: string;
  userSeed: string;
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onToggleLocale: () => void;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  avatarUploading: boolean;
  avatarPreviewUrl?: string | null;
  onAvatarFile: (file: File | undefined) => void;
  nicknameEditing: boolean;
  nicknameDraft: string;
  nicknameState: "idle" | "saving" | "saved" | "error";
  onBeginNicknameEdit: () => void;
  onNicknameDraftChange: (value: string) => void;
  onSaveNickname: () => void;
  onOpenBilling: () => void;
  onCancelOrder?: (activity: AccountActivitySummary) => void;
  cancellingActivityId?: string | null;
  cancelOrderLabel?: string;
  isAdmin: boolean;
  onLogout: () => void;
  drawer: MobileDrawerKind;
  drawerReturnFocusRef: React.RefObject<HTMLElement | null>;
  onOpenDrawer: (kind: Exclude<MobileDrawerKind, null>, trigger: HTMLElement) => void;
  onCloseDrawer: () => void;
  drawerPending: boolean;
  token: string;
  checkInLoading: boolean;
  onCheckIn: () => void;
  onCopyReferralCode: () => void;
  onCopyReferralInfo: () => void;
  rulesOpen: boolean;
  onToggleRules: () => void;
  storageActivating: boolean;
  autoRenewToggling: boolean;
  onActivateStorage: () => void;
  onToggleAutoRenew: () => void;
  securityDialog: SecurityDialogState;
  onOpenChangePassword: () => void;
  onOpenDeviceManagement: () => void;
  onSetSecurityDialog: (state: SecurityDialogState) => void;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  changePasswordError: string | null;
  changePasswordPending: boolean;
  onSubmitChangePassword: (event: React.FormEvent<HTMLFormElement>) => void;
  revokeSessionsError: string | null;
  revokeSessionsPending: boolean;
  onConfirmRevokeSessions: () => void;
}

function tx(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US");
}

function storageStatus(status: AccountOverview["storagePackage"]["status"], locale: string) {
  return status === "ACTIVE" ? tx(locale, "已开通", "Active") : status === "EXPIRED" ? tx(locale, "已过期", "Expired") : tx(locale, "未开通", "Not active");
}

function storageStatusClass(status: AccountOverview["storagePackage"]["status"]) {
  return status === "ACTIVE" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : status === "EXPIRED" ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

export function MobileAccountPanel({
  overview,
  profile,
  displayName,
  userSeed,
  locale,
  t,
  theme,
  onToggleTheme,
  onToggleLocale,
  avatarInputRef,
  avatarUploading,
  avatarPreviewUrl,
  onAvatarFile,
  nicknameEditing,
  nicknameDraft,
  nicknameState,
  onBeginNicknameEdit,
  onNicknameDraftChange,
  onSaveNickname,
  onOpenBilling,
  onCancelOrder,
  cancellingActivityId = null,
  cancelOrderLabel = tx(locale, "取消订单", "Cancel order"),
  isAdmin,
  onLogout,
  drawer,
  drawerReturnFocusRef,
  onOpenDrawer,
  onCloseDrawer,
  drawerPending,
  token,
  checkInLoading,
  onCheckIn,
  onCopyReferralCode,
  onCopyReferralInfo,
  rulesOpen,
  onToggleRules,
  storageActivating,
  autoRenewToggling,
  onActivateStorage,
  onToggleAutoRenew,
  securityDialog,
  onOpenChangePassword,
  onOpenDeviceManagement,
  onSetSecurityDialog,
  currentPassword,
  newPassword,
  confirmPassword,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  changePasswordError,
  changePasswordPending,
  onSubmitChangePassword,
  revokeSessionsError,
  revokeSessionsPending,
  onConfirmRevokeSessions
}: MobileAccountPanelProps) {
  const [activeDrawer, setActiveDrawer] = React.useState<MobileDrawerKind>(drawer);
  const openDrawer = (kind: Exclude<MobileDrawerKind, null>, triggerElement: HTMLElement) => {
    setActiveDrawer(kind);
    onOpenDrawer(kind, triggerElement);
  };
  const closeDrawer = () => {
    if (drawerPending) return;
    setActiveDrawer(null);
    onCloseDrawer();
  };
  const trigger = (kind: Exclude<MobileDrawerKind, null>) => (event: React.MouseEvent<HTMLElement>) => openDrawer(kind, event.currentTarget);
  const orderedDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${overview.checkIn.todayDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
  const hasPendingOrder = overview.activities.some(
    (activity) => activity.kind === "ORDER" && activity.status === "PENDING"
  );
  const drawerTitle = activeDrawer === "check-in" ? tx(locale, "每日签到", "Daily check-in") : activeDrawer === "referral" ? tx(locale, "邀请有礼", "Referral rewards") : activeDrawer === "storage" ? tx(locale, "资源存储", "Resource storage") : activeDrawer === "activity" ? tx(locale, "订单与明细", "Orders and activity") : tx(locale, "账户安全", "Account security");
  const drawerVariant: MobileAccountDrawerVariant = activeDrawer === "check-in" || activeDrawer === "referral" ? "bottom" : "full";

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 px-3 pb-6 pt-3 dark:bg-slate-950 sm:px-5" data-account-page="m5-mobile" data-account-mobile-scroll>
      <div className="mx-auto grid min-w-0 max-w-xl gap-3">
        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-account-mobile-profile>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative shrink-0"><button type="button" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()} className="rounded-full disabled:opacity-60" aria-label={tx(locale, "上传头像", "Upload avatar")}><UserAvatar displayName={displayName} seed={userSeed} avatarUrl={avatarPreviewUrl ?? profile.avatarUrl} token={token} size="xl" /></button><button type="button" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()} className="absolute -bottom-1 -right-1 flex size-11 items-center justify-center rounded-full border-4 border-white bg-indigo-600 text-white shadow-sm disabled:opacity-60 dark:border-slate-900" aria-label={tx(locale, "上传头像", "Upload avatar")}><Camera className="size-5" /></button>{avatarUploading ? <span data-mobile-avatar-uploading className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/45 text-xs font-semibold text-white">{tx(locale, "上传中", "Uploading")}</span> : null}</div>
              <div className="min-w-0"><div className="flex min-w-0 items-center gap-2">{nicknameEditing ? <input autoFocus value={nicknameDraft} onChange={(event) => onNicknameDraftChange(event.target.value)} onBlur={onSaveNickname} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSaveNickname(); } }} className="min-w-0 w-full rounded-xl border border-indigo-300 bg-white px-2 py-1 text-lg font-bold text-slate-950 outline-none dark:border-indigo-700 dark:bg-slate-800 dark:text-slate-100" aria-label={tx(locale, "昵称", "Nickname")} /> : <button type="button" onClick={onBeginNicknameEdit} className="flex min-h-11 min-w-0 items-center gap-2 text-left text-lg font-bold text-slate-950 dark:text-slate-50"><span className="truncate">{displayName}</span><Pencil className="size-4 shrink-0 text-slate-400" /></button>}</div>{nicknameState === "error" ? <p className="mt-1 text-xs text-rose-600">{tx(locale, "昵称格式无效", "Invalid nickname")}</p> : null}<p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400" title={overview.plan.name}>{overview.plan.name}</p></div>
            </div>
            <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={onToggleTheme} className="flex size-11 items-center justify-center rounded-full border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300" aria-label={theme === "dark" ? t("workspace.themeLight") : t("workspace.themeDark")}>{theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}</button><button type="button" onClick={onToggleLocale} className="flex size-11 items-center justify-center rounded-full border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300" aria-label={t("workspace.language")}><Globe className="size-5" /></button></div>
          </div>
          <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { onAvatarFile(event.target.files?.[0]); event.target.value = ""; }} />
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800"><div className="min-w-0"><p className="text-xs text-slate-500 dark:text-slate-400">{tx(locale, "剩余额度", "Remaining credits")}</p><p className="mt-1 truncate text-3xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">{overview.quota.remainingCredits.toLocaleString()}</p></div><button type="button" onClick={onOpenBilling} className="flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-bold text-white shadow-sm"><WalletCards className="size-4" />{tx(locale, "充值", "Recharge")}</button></div>
        </section>

        {hasPendingOrder ? (
          <button
            type="button"
            className="flex min-h-16 items-center justify-between gap-3 rounded-[24px] border border-amber-200 bg-amber-50 px-4 text-left text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            onClick={onOpenBilling}
            data-account-pending-order-recovery="true"
            data-account-payment-resume="true"
          >
            <span className="min-w-0">
              <strong className="block text-sm">{tx(locale, "有待支付订单", "Pending payment available")}</strong>
              <span className="mt-1 block text-xs text-amber-800 dark:text-amber-300">{tx(locale, "复用原订单继续支付", "Continue with the existing order")}</span>
            </span>
            <span className="shrink-0 text-sm font-bold text-indigo-600 dark:text-indigo-400">{tx(locale, "继续支付", "Continue payment")}</span>
          </button>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <QuickCard icon={CalendarCheck2} title={tx(locale, "每日签到", "Daily check-in")} subtitle={!overview.checkIn.enabled ? tx(locale, "暂未开放", "Unavailable") : overview.checkIn.todayCheckedIn ? tx(locale, "今日已签到", "Checked in today") : tx(locale, `今日 +${overview.checkIn.dailyRewardCredits}`, `Today +${overview.checkIn.dailyRewardCredits}`)} onClick={trigger("check-in")} />
          <QuickCard icon={Users} title={tx(locale, "邀请有礼", "Referral rewards")} subtitle={overview.referral.enabled ? tx(locale, `已邀请 ${overview.referral.invitedCount} 人`, `${overview.referral.invitedCount} invited`) : tx(locale, "暂未开放", "Unavailable")} onClick={trigger("referral")} />
          <QuickCard icon={Cloud} title={tx(locale, "资源存储", "Resource storage")} subtitle={storageStatus(overview.storagePackage.status, locale)} onClick={trigger("storage")} />
          <QuickCard icon={ReceiptText} title={tx(locale, "订单与明细", "Orders & activity")} subtitle={tx(locale, "充值、套餐及额度记录", "Credits and account records")} onClick={trigger("activity")} />
        </div>

        <MobileMenuSection title={tx(locale, "账户与服务", "Account & services")}>
          <MobileMenuLink icon={Menu} label={tx(locale, "模型库", "Model library")} href="/models" />
          <MobileMenuButton icon={ShieldCheck} label={tx(locale, "账户安全", "Account security")} hint={tx(locale, "密码与登录设备", "Password and sessions")} onClick={trigger("security")} />
        </MobileMenuSection>
        <MobileMenuSection title={tx(locale, "使用与支持", "Use & support")}>
          <MobileMenuLink icon={HelpCircle} label={tx(locale, "使用说明", "Help")} href="/help" />
          <MobileMenuLink icon={WalletCards} label={tx(locale, "意见反馈", "Feedback")} href="/feedback" />
          <MobileMenuLink icon={LinkIcon} label={tx(locale, "外部链接", "External links")} href="/links" />
        </MobileMenuSection>
        {isAdmin ? <MobileMenuSection title={tx(locale, "管理员", "Admin")}><MobileMenuLink icon={Users} label={tx(locale, "管理后台", "Admin panel")} hint={tx(locale, "管理员", "Admin")} href="/admin" /></MobileMenuSection> : null}
        <button type="button" onClick={onLogout} className="min-h-12 rounded-2xl border border-rose-100 bg-white text-base font-bold text-rose-600 dark:border-rose-950 dark:bg-slate-900 dark:text-rose-400"><LogOut className="mr-2 inline size-4" />{tx(locale, "退出登录", "Log out")}</button>
      </div>

      {activeDrawer && activeDrawer !== "activity" ? <MobileAccountDrawer title={drawerTitle} labelledBy={`m5-account-${activeDrawer}-title`} variant={drawerVariant} pending={drawerPending} returnFocusRef={drawerReturnFocusRef} onClose={closeDrawer} closeLabel={tx(locale, "关闭", "Close")}>
        {activeDrawer === "check-in" ? <CheckInDrawerContent overview={overview} locale={locale} orderedDates={orderedDates} loading={checkInLoading} onCheckIn={onCheckIn} /> : null}
        {activeDrawer === "referral" ? <ReferralDrawerContent overview={overview} locale={locale} rulesOpen={rulesOpen} onToggleRules={onToggleRules} onCopyCode={onCopyReferralCode} onCopyInfo={onCopyReferralInfo} /> : null}
        {activeDrawer === "storage" ? <StorageDrawerContent overview={overview} locale={locale} activating={storageActivating} autoRenewToggling={autoRenewToggling} onActivate={onActivateStorage} onToggleAutoRenew={onToggleAutoRenew} /> : null}
        {activeDrawer === "security" ? <SecurityDrawerContent locale={locale} t={t} dialog={securityDialog} onOpenChangePassword={onOpenChangePassword} onOpenDevices={onOpenDeviceManagement} onSetDialog={onSetSecurityDialog} currentPassword={currentPassword} newPassword={newPassword} confirmPassword={confirmPassword} onCurrentPasswordChange={onCurrentPasswordChange} onNewPasswordChange={onNewPasswordChange} onConfirmPasswordChange={onConfirmPasswordChange} error={changePasswordError} pending={changePasswordPending} onSubmit={onSubmitChangePassword} revokeError={revokeSessionsError} revokePending={revokeSessionsPending} onConfirmRevoke={onConfirmRevokeSessions} /> : null}
      </MobileAccountDrawer> : null}
      {activeDrawer === "activity" ? <MobileAccountDrawer title={drawerTitle} labelledBy="m5-account-activity-title" variant="full" returnFocusRef={drawerReturnFocusRef} onClose={closeDrawer} closeLabel={tx(locale, "关闭", "Close")}><AccountActivityContent token={token} locale={locale} isOpen mobile onOpenBilling={() => { closeDrawer(); onOpenBilling(); }} {...(onCancelOrder ? { onCancelOrder: (activity: AccountActivitySummary) => { closeDrawer(); onCancelOrder(activity); } } : {})} cancellingActivityId={cancellingActivityId} cancelOrderLabel={cancelOrderLabel} /></MobileAccountDrawer> : null}
    </main>
  );
}

export function MobileAccountLoadingSkeleton() {
  return <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 px-3 pb-6 pt-3 dark:bg-slate-950" data-account-page="m5-mobile-loading" data-account-mobile-scroll><div className="mx-auto grid max-w-xl gap-3"><div className="h-48 animate-pulse rounded-[28px] bg-white dark:bg-slate-900" /><div className="grid grid-cols-2 gap-3"><div className="h-28 animate-pulse rounded-[24px] bg-white dark:bg-slate-900" /><div className="h-28 animate-pulse rounded-[24px] bg-white dark:bg-slate-900" /><div className="h-28 animate-pulse rounded-[24px] bg-white dark:bg-slate-900" /><div className="h-28 animate-pulse rounded-[24px] bg-white dark:bg-slate-900" /></div></div></main>;
}

function QuickCard({ icon: Icon, title, subtitle, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string; onClick: (event: React.MouseEvent<HTMLElement>) => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-[118px] min-w-0 items-center gap-2 rounded-[24px] border border-slate-200 bg-white p-2.5 text-left shadow-sm dark:border-slate-800 dark:bg-slate-900"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"><Icon className="size-6" /></span><span className="min-w-0 flex-1"><strong className="block whitespace-nowrap text-sm font-bold text-slate-900 dark:text-slate-100" title={title}>{title}</strong><span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400" title={subtitle}>{subtitle}</span></span><ChevronRight className="size-4 shrink-0 text-slate-400" /></button>;
}

function MobileMenuSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h2 className="px-1 py-3 text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2><div className="divide-y divide-slate-100 dark:divide-slate-800">{children}</div></section>; }
function MobileMenuLink({ icon: Icon, label, hint, href }: { icon: React.ComponentType<{ className?: string }>; label: string; hint?: string; href: string }) { return <Link href={href} className="flex min-h-14 items-center gap-3 text-base font-semibold text-slate-800 dark:text-slate-100"><Icon className="size-5 shrink-0 text-slate-500 dark:text-slate-400" /><span className="min-w-0 flex-1 truncate">{label}</span>{hint ? <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">{hint}</span> : null}<ChevronRight className="size-5 shrink-0 text-slate-400" /></Link>; }
function MobileMenuButton({ icon: Icon, label, hint, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; hint?: string; onClick: (event: React.MouseEvent<HTMLElement>) => void }) { return <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 text-left text-base font-semibold text-slate-800 dark:text-slate-100"><Icon className="size-5 shrink-0 text-slate-500 dark:text-slate-400" /><span className="min-w-0 flex-1 truncate">{label}</span>{hint ? <span className="shrink-0 text-sm text-slate-400 dark:text-slate-500">{hint}</span> : null}<ChevronRight className="size-5 shrink-0 text-slate-400" /></button>; }

function CheckInDrawerContent({ overview, locale, orderedDates, loading, onCheckIn }: { overview: AccountOverview; locale: string; orderedDates: string[]; loading: boolean; onCheckIn: () => void }) { return <div className="px-5 pb-5"><div className="py-5 text-center"><p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tx(locale, "已连续签到", "Streak")} <strong className="text-indigo-600 dark:text-indigo-400">{overview.checkIn.currentStreak}</strong> {tx(locale, "天", "days")}</p><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{overview.checkIn.enabled ? tx(locale, `今日签到可得 +${overview.checkIn.dailyRewardCredits} 额度`, `Today earns +${overview.checkIn.dailyRewardCredits} credits`) : tx(locale, "签到功能暂未开放", "Check-in is unavailable")}</p></div><div className="grid grid-cols-7 gap-1">{orderedDates.map((date, index) => { const checked = overview.checkIn.checkedDates.includes(date); return <div key={date} className="text-center"><div className={`mx-auto flex size-10 items-center justify-center rounded-full border ${checked ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-200 text-slate-400 dark:border-slate-700"}`}>{checked ? <Check className="size-5" /> : <CalendarCheck2 className="size-4" />}</div><span className="mt-2 block text-[10px] text-slate-500">{tx(locale, `第${index + 1}天`, `Day ${index + 1}`)}</span></div>; })}</div><button type="button" disabled={!overview.checkIn.enabled || overview.checkIn.todayCheckedIn || loading} onClick={onCheckIn} className="mt-6 min-h-12 w-full rounded-2xl bg-indigo-600 text-base font-bold text-white disabled:opacity-50">{overview.checkIn.todayCheckedIn ? tx(locale, "今日已签到", "Checked in today") : loading ? tx(locale, "签到中…", "Checking in…") : tx(locale, "立即签到", "Check in")}</button><h3 className="mt-8 text-base font-bold text-slate-900 dark:text-slate-100">{tx(locale, "连续签到奖励", "Streak rewards")}</h3><div className="mt-3 grid grid-cols-2 gap-3">{Object.entries(overview.checkIn.streakRewards).sort(([a], [b]) => Number(a) - Number(b)).map(([days, reward]) => <div key={days} className="rounded-2xl bg-indigo-50 p-3 text-center dark:bg-indigo-950/40"><p className="text-sm text-slate-500 dark:text-slate-400">{tx(locale, `连续签到 ${days} 天`, `${days}-day streak`)}</p><p className="mt-1 font-bold text-indigo-600 dark:text-indigo-400">+{reward} {tx(locale, "额度", "credits")}</p></div>)}</div></div>; }

function ReferralDrawerContent({ overview, locale, rulesOpen, onToggleRules, onCopyCode, onCopyInfo }: { overview: AccountOverview; locale: string; rulesOpen: boolean; onToggleRules: () => void; onCopyCode: () => void; onCopyInfo: () => void }) { return <div className="px-5 pb-5"><p className="py-4 text-base text-slate-600 dark:text-slate-300">{overview.referral.rewardTrigger || tx(locale, "邀请好友，双方可得额度", "Invite friends and earn credits together")}</p><div className="flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/40"><span className="min-w-0 flex-1 truncate text-center font-mono text-2xl font-bold tracking-[0.18em] text-indigo-600 dark:text-indigo-300">{overview.referral.code ?? "—"}</span><button type="button" disabled={!overview.referral.code} onClick={onCopyCode} className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 disabled:opacity-40 dark:bg-slate-800" aria-label={tx(locale, "复制邀请码", "Copy invite code")}><Copy className="size-5" /></button></div><button type="button" disabled={!overview.referral.code} onClick={onCopyInfo} className="mt-4 min-h-12 w-full rounded-2xl bg-indigo-600 text-base font-bold text-white disabled:opacity-40"><Clipboard className="mr-2 inline size-4" />{tx(locale, "复制邀请信息", "Copy invitation info")}</button><button type="button" onClick={onToggleRules} className="mt-4 min-h-11 w-full text-sm font-semibold text-indigo-600 dark:text-indigo-400">{tx(locale, "查看推广规则", "View referral rules")}</button>{rulesOpen ? <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{overview.referral.rulesText || tx(locale, "暂无规则说明", "No referral rules are configured.")}</p> : null}<div className="mt-6 grid grid-cols-2 gap-3"><Metric label={tx(locale, "已邀请", "Invited")} value={String(overview.referral.invitedCount)} suffix={tx(locale, "人", "people")} /><Metric label={tx(locale, "累计奖励", "Rewards")} value={String(overview.referral.totalRewardCredits)} suffix={tx(locale, "额度", "credits")} /></div><p className="mt-6 text-center text-sm text-slate-400 dark:text-slate-500">{tx(locale, "注册邀请码绑定后续完善", "Registration invite-code binding will be completed later.")}</p></div>; }
function Metric({ label, value, suffix }: { label: string; value: string; suffix: string }) { return <div className="rounded-2xl bg-indigo-50/70 p-4 text-center dark:bg-indigo-950/40"><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold text-indigo-600 dark:text-indigo-400">{value}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{suffix}</p></div>; }

function StorageDrawerContent({ overview, locale, activating, autoRenewToggling, onActivate, onToggleAutoRenew }: { overview: AccountOverview; locale: string; activating: boolean; autoRenewToggling: boolean; onActivate: () => void; onToggleAutoRenew: () => void }) { const storage = overview.storagePackage; return <div className="flex min-h-full flex-col px-5 pb-5"><span className={`mt-3 inline-flex w-fit rounded-xl px-3 py-2 text-sm font-semibold ${storageStatusClass(storage.status)}`}>{storageStatus(storage.status, locale)}</span><p className="mt-5 text-base leading-7 text-slate-700 dark:text-slate-300">{storage.description || tx(locale, "开通后，对话、作品和资源可在有效期内长期保存。", "Keep conversations, creations, and resources available during the active period.")}</p><div className="mt-5 divide-y divide-slate-100 rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700"><InfoRow label={tx(locale, "服务价格", "Service price")} value={`${storage.priceCredits} ${tx(locale, "额度/月", "credits/mo")}`} /><InfoRow label={tx(locale, "到期时间", "Expires")} value={formatDate(storage.expiresAt, locale)} /></div><div className="mt-5 flex items-center justify-between gap-3"><div><p className="font-semibold text-slate-800 dark:text-slate-100">{tx(locale, "自动续费", "Auto-renew")}</p><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{storage.autoRenewAvailable ? tx(locale, "开通后可设置", "Available after activation") : tx(locale, "暂未开放", "Unavailable")}</p></div>{storage.autoRenewAvailable && storage.status === "ACTIVE" ? <button type="button" disabled={autoRenewToggling} onClick={onToggleAutoRenew} className={`relative h-7 w-12 rounded-full ${storage.autoRenewEnabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"}`} aria-label={tx(locale, "切换自动续费", "Toggle auto-renew")}><span className={`absolute top-1 size-5 rounded-full bg-white transition-transform ${storage.autoRenewEnabled ? "left-6" : "left-1"}`} /></button> : null}</div><div className="mt-5 rounded-2xl bg-indigo-50 p-4 text-sm leading-6 text-slate-700 dark:bg-indigo-950/40 dark:text-slate-300">{tx(locale, "适合经常使用资产库和内容创作的用户", "Suitable for users who frequently use the asset library and create content.")}</div><div className="mt-auto pt-8"><p className="text-center text-sm text-slate-500 dark:text-slate-400">{tx(locale, "当前余额", "Current balance")} <strong className="text-xl text-indigo-600 dark:text-indigo-400">{overview.quota.remainingCredits}</strong> {tx(locale, "额度", "credits")}</p><button type="button" disabled={!storage.enabled || storage.status === "ACTIVE" || activating} onClick={onActivate} className="mt-4 min-h-12 w-full rounded-2xl bg-indigo-600 text-base font-bold text-white disabled:opacity-50">{storage.status === "ACTIVE" ? tx(locale, "已开通", "Active") : activating ? tx(locale, "开通中…", "Activating…") : tx(locale, "立即开通", "Activate storage")}</button></div></div>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 px-4 py-4"><span className="text-sm text-slate-500 dark:text-slate-400">{label}</span><span className="min-w-0 truncate text-right font-semibold text-slate-800 dark:text-slate-100">{value}</span></div>; }

function SecurityDrawerContent({ locale, t, dialog, onOpenChangePassword, onOpenDevices, onSetDialog, currentPassword, newPassword, confirmPassword, onCurrentPasswordChange, onNewPasswordChange, onConfirmPasswordChange, error, pending, onSubmit, revokeError, revokePending, onConfirmRevoke }: { locale: string; t: MobileAccountPanelProps["t"]; dialog: SecurityDialogState; onOpenChangePassword: () => void; onOpenDevices: () => void; onSetDialog: (state: SecurityDialogState) => void; currentPassword: string; newPassword: string; confirmPassword: string; onCurrentPasswordChange: (value: string) => void; onNewPasswordChange: (value: string) => void; onConfirmPasswordChange: (value: string) => void; error: string | null; pending: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; revokeError: string | null; revokePending: boolean; onConfirmRevoke: () => void }) {
  if (dialog?.kind === "change-password") return <div className="px-5 pb-5"><SubtleBack label={tx(locale, "返回账户安全", "Back to account security")} onClick={() => { if (!pending) onSetDialog(null); }} /><form className="grid gap-4" noValidate onSubmit={onSubmit}><PasswordField label={t("account.security.currentPassword")} value={currentPassword} onChange={onCurrentPasswordChange} autoComplete="current-password" disabled={pending} /><PasswordField label={t("account.security.newPassword")} value={newPassword} onChange={onNewPasswordChange} autoComplete="new-password" disabled={pending} /><PasswordField label={t("account.security.confirmPassword")} value={confirmPassword} onChange={onConfirmPasswordChange} autoComplete="new-password" disabled={pending} />{error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p> : null}<button type="submit" disabled={pending} className="min-h-12 rounded-2xl bg-indigo-600 text-base font-bold text-white disabled:opacity-50">{pending ? t("account.security.changingPassword") : t("account.security.submitChangePassword")}</button></form></div>;
  if (dialog?.kind === "devices") return <div className="px-5 pb-5"><SubtleBack label={tx(locale, "返回账户安全", "Back to account security")} onClick={() => { if (!revokePending) onSetDialog(null); }} />{dialog.step === "details" ? <div className="grid gap-5"><p className="text-base leading-7 text-slate-600 dark:text-slate-300">{t("account.security.currentBrowserLogoutHint")}</p><button type="button" disabled={revokePending} onClick={() => onSetDialog({ kind: "devices", step: "confirm" })} className="min-h-12 rounded-2xl bg-rose-600 text-base font-bold text-white disabled:opacity-50">{t("account.security.revokeSessions")}</button></div> : <div className="grid gap-5"><p className="text-base leading-7 text-slate-600 dark:text-slate-300">{t("account.security.revokeSessionsConfirmDescription")}</p>{revokeError ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{revokeError}</p> : null}<button type="button" disabled={revokePending} onClick={onConfirmRevoke} className="min-h-12 rounded-2xl bg-rose-600 text-base font-bold text-white disabled:opacity-50">{revokePending ? t("account.security.revokingSessions") : t("account.security.revokeSessionsConfirm")}</button></div>}</div>;
  return <div className="grid gap-3 px-5 pb-5"><SecurityAction icon={KeyRound} label={t("account.security.changePassword")} hint={tx(locale, "定期更新密码保护账户", "Update your password regularly")} onClick={onOpenChangePassword} /><SecurityAction icon={ShieldCheck} label={t("account.security.deviceManagement")} hint={tx(locale, "退出其他已登录设备", "Sign out other devices")} onClick={onOpenDevices} /><div className="flex min-h-20 items-center gap-3 rounded-2xl border border-slate-200 px-4 opacity-55 dark:border-slate-700"><span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800"><UserRound className="size-6" /></span><span><strong className="block text-base text-slate-700 dark:text-slate-300">{t("account.security.changeEmail")}</strong><span className="mt-1 block text-sm text-slate-500">{tx(locale, "暂未开放", "Not available")}</span></span></div><p className="mt-4 text-center text-sm text-slate-400 dark:text-slate-500">{tx(locale, "修改安全信息时请确认当前登录状态", "Confirm your current sign-in before changing security information.")}</p></div>;
}
function SecurityAction({ icon: Icon, label, hint, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; hint: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="flex min-h-20 items-center gap-3 rounded-2xl border border-slate-200 px-4 text-left dark:border-slate-700"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"><Icon className="size-6" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-base text-slate-800 dark:text-slate-100">{label}</strong><span className="mt-1 block truncate text-sm text-slate-500 dark:text-slate-400">{hint}</span></span><ChevronRight className="size-5 text-slate-400" /></button>; }
function PasswordField({ label, value, onChange, autoComplete, disabled }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; disabled: boolean }) { return <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{label}<input type="password" autoComplete={autoComplete} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-slate-950 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" /></label>; }
function SubtleBack({ label, onClick }: { label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-indigo-600 dark:text-indigo-400"><ChevronRight className="size-4 rotate-180" />{label}</button>; }
