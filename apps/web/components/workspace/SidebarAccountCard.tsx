"use client";

import type { AuthUser } from "@ai-aggregate/shared";
import {
  ChevronUp,
  ChevronDown,
  CircleHelp,
  Coins,
  MessageSquareText,
  ShieldCheck,
  UserRound,
  WalletCards
} from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n/use-i18n";
import { getUserDisplayName, getUserSeed } from "./user-identity";
import { UserAvatar } from "./UserAvatar";
import { useOptionalWorkspaceShellContext } from "./workspace-shell-context";

export interface SidebarAccountCardProps {
  user: AuthUser | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  remainingCredits: number | undefined;
  planName?: string;
  openBillingDialog: () => void;
  isCollapsed: boolean;
}

function getCreditsLabel(
  credits: number | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const display = credits != null ? credits.toLocaleString() : "0";
  return t("workspace.accountCard.credits", { credits: display });
}

export function SidebarAccountCard({
  user,
  isLoggedIn,
  isAdmin,
  remainingCredits,
  planName: _planName,
  openBillingDialog,
  isCollapsed
}: SidebarAccountCardProps) {
  const { t, locale } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [portalReady, setPortalReady] = useState(false);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    setPortalReady(typeof document !== "undefined");
  }, []);

  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  useEffect(() => {
    closeMenu();
  }, [isCollapsed, closeMenu]);

  useEffect(() => {
    if (!menuOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuStyle({
      position: "fixed",
      bottom: `${window.innerHeight - rect.top + 8}px`,
      left: `${rect.left}px`,
      minWidth: "13rem",
      zIndex: 50
    });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        cardRef.current &&
        !cardRef.current.contains(event.target as Node)
      ) {
        const menuEl = document.getElementById("account-card-menu-portal");
        if (menuEl && menuEl.contains(event.target as Node)) return;
        closeMenu();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    function handleResize() {
      closeMenu();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleResize);
    };
  }, [menuOpen, closeMenu]);

  const displayName = user ? getUserDisplayName(user, locale) : (locale === "zh-CN" ? "用户" : "User");
  const seed = user ? getUserSeed(user) : "user";
  const creditsLabel = getCreditsLabel(remainingCredits, t);
  const userEmail = user?.email ?? "";

  if (!isLoggedIn) {
    if (isCollapsed) {
      return (
        <button
          type="button"
          className="flex flex-col items-center gap-1 pt-3 cursor-pointer"
          aria-label={t("workspace.accountCard.login")}
          title={t("workspace.accountCard.login")}
          onClick={() => workspaceShell?.openAuthDialog()}
        >
          <UserAvatar isGuest size="md" seed="guest" />
        </button>
      );
    }

    return (
      <div className="mx-3 mt-3 w-[calc(100%-24px)] rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <UserAvatar isGuest size="md" seed="guest" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
              {t("workspace.accountCard.guest")}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
            onClick={() => workspaceShell?.openAuthDialog()}
          >
            <UserRound className="size-4" aria-hidden="true" />
            {t("workspace.accountCard.login")}
          </button>
        </div>
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5 pt-3" ref={cardRef}>
        <button
          type="button"
          ref={triggerRef}
          className="relative flex items-center justify-center cursor-pointer"
          aria-label={displayName}
          title={`${displayName} · ${creditsLabel}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <UserAvatar displayName={displayName} seed={seed} avatarUrl={user?.avatarUrl} token={workspaceShell?.shell.token} size="md" />
        </button>
        <button
          type="button"
          className="flex items-center justify-center rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
          aria-label={t("workspace.accountCard.recharge")}
          title={t("workspace.accountCard.recharge")}
          onClick={(event) => {
            event.stopPropagation();
            closeMenu();
            openBillingDialog();
          }}
        >
          <Coins className="size-4" aria-hidden="true" />
        </button>
        {portalReady &&
          createPortal(
            <div
              id="account-card-menu-portal"
              className={`fixed rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${menuOpen ? "" : "invisible pointer-events-none opacity-0"}`}
              role="menu"
              aria-label={t("workspace.accountCard.userMenu")}
              aria-hidden={!menuOpen}
              style={menuStyle}
            >
              <UserMenuItems
                userEmail={userEmail}
                isAdmin={isAdmin}
                t={t}
                closeMenu={closeMenu}
              />
            </div>,
            document.body
          )}
      </div>
    );
  }

  return (
    <div
      className="relative mx-3 mt-3 w-[calc(100%-24px)] rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-200 hover:bg-slate-50/80 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800/80"
      ref={cardRef}
    >
      <button
        type="button"
        ref={triggerRef}
        className="flex w-full items-center gap-3 px-3 pt-3 pb-2 text-left cursor-pointer rounded-t-2xl transition hover:bg-slate-50/80 dark:hover:bg-slate-800/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 focus-visible:outline-none"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        <UserAvatar displayName={displayName} seed={seed} avatarUrl={user?.avatarUrl} token={workspaceShell?.shell.token} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
              {displayName}
            </span>
            {menuOpen ? (
              <ChevronUp className="size-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            )}
          </div>
          <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            {creditsLabel}
          </div>
        </div>
      </button>

      <div className="border-t border-slate-100 dark:border-slate-700">
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-b-2xl px-4 py-2.5 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 active:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 focus-visible:outline-none dark:text-indigo-400 dark:hover:bg-indigo-950/50 dark:active:bg-indigo-950"
          onClick={(event) => {
            event.stopPropagation();
            closeMenu();
            openBillingDialog();
          }}
        >
          <WalletCards className="size-4" aria-hidden="true" />
          {t("workspace.accountCard.recharge")}
        </button>
      </div>

      {portalReady &&
        createPortal(
          <div
            id="account-card-menu-portal"
            className={`fixed rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${menuOpen ? "" : "invisible pointer-events-none opacity-0"}`}
            role="menu"
            aria-label={t("workspace.accountCard.userMenu")}
            aria-hidden={!menuOpen}
            style={menuStyle}
          >
            <UserMenuItems
              userEmail={userEmail}
              isAdmin={isAdmin}
              t={t}
              closeMenu={closeMenu}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

function UserMenuItems({
  userEmail,
  isAdmin,
  t,
  closeMenu
}: {
  userEmail: string;
  isAdmin: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  closeMenu: () => void;
}) {
  return (
    <>
      {userEmail ? (
        <div className="truncate px-3 pb-1.5 pt-1 text-xs text-slate-400 dark:text-slate-500" aria-label={userEmail}>
          {userEmail}
        </div>
      ) : null}
      <Link
        href="/account"
        className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
        role="menuitem"
        onClick={closeMenu}
      >
        <UserRound className="size-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        {t("workspace.accountCard.profile")}
      </Link>
      <Link
        href="/help"
        className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
        role="menuitem"
        onClick={closeMenu}
      >
        <CircleHelp className="size-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        {t("workspace.accountCard.help")}
      </Link>
      <Link
        href="/feedback"
        className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
        role="menuitem"
        onClick={closeMenu}
      >
        <MessageSquareText className="size-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        {t("workspace.accountCard.feedback")}
      </Link>
      {isAdmin ? (
        <Link
          href="/admin"
          className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
          role="menuitem"
          onClick={closeMenu}
        >
          <ShieldCheck className="size-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          {t("workspace.accountCard.admin")}
        </Link>
      ) : null}
    </>
  );
}
