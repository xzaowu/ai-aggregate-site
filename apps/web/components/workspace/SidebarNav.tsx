"use client";

import {
  BadgeDollarSign,
  Globe,
  LogIn,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Server,
  ShieldCheck,
  Sun,
  UserRound
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import type { Locale } from "../../lib/i18n/types";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  isWorkspaceNavItemActive,
  workspaceCreationNavItems,
  workspaceManagementNavItems,
  workspaceNavIconMap,
  workspaceServiceNavItems,
  type WorkspaceNavItemConfig,
  type WorkspaceNavKey,
  type WorkspacePanel
} from "./workspace-navigation";
import { SidebarAccountCard } from "./SidebarAccountCard";
import {
  invokeWorkspaceBillingAction,
  useOptionalWorkspaceShellContext
} from "./workspace-shell-context";

const localeOptions: Array<{ locale: Locale; labelKey: string }> = [
  { locale: "zh-CN", labelKey: "nav.zh" },
  { locale: "en-US", labelKey: "nav.en" }
];

export function getNextWorkspaceLocale(locale: Locale): Locale {
  return locale === "zh-CN" ? "en-US" : "zh-CN";
}

function railItemClass(active = false, collapsed = false, disabled = false) {
  if (collapsed) {
    if (disabled) {
      return "group flex size-11 cursor-not-allowed items-center justify-center rounded-xl text-slate-300 dark:text-slate-600";
    }
    return active
      ? "group flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-800"
      : "group flex size-11 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";
  }

  if (disabled) {
    return "group flex min-h-11 min-w-0 cursor-not-allowed items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-slate-300 dark:text-slate-600";
  }

  return active
    ? "group flex min-h-11 min-w-0 items-center justify-start gap-3 rounded-xl bg-indigo-50 px-3 py-2.5 text-left text-indigo-700 ring-1 ring-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-800"
    : "group flex min-h-11 min-w-0 items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";
}

function RailLabel({
  children,
  isCollapsed
}: {
  children: React.ReactNode;
  isCollapsed: boolean;
}) {
  if (isCollapsed) {
    return <span className="sr-only">{children}</span>;
  }

  return (
    <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold leading-none">
      {children}
    </span>
  );
}

export function WorkspaceLanguageSwitch({
  className = ""
}: {
  className?: string;
}) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800 ${className}`}
      aria-label={t("workspace.language")}
    >
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
        {localeOptions.map((option) => (
          <button
            key={option.locale}
            type="button"
            className={
              locale === option.locale
                ? "rounded-xl bg-white px-2 py-1.5 text-[11px] font-semibold leading-none text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-indigo-400"
                : "rounded-xl px-2 py-1.5 text-[11px] font-semibold leading-none text-slate-500 transition hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-200"
            }
            aria-label={t(option.labelKey)}
            aria-pressed={locale === option.locale}
            onClick={() => setLocale(option.locale)}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceHeaderActions({
  isLoggedIn,
  isAdmin
}: {
  isLoggedIn: boolean;
  isAdmin: boolean;
}) {
  const { t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();

  return (
    <div className="flex flex-wrap items-center gap-2 lg:hidden">
      {isLoggedIn ? (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400"
          onClick={() => {
            if (workspaceShell) {
              invokeWorkspaceBillingAction(workspaceShell.openBillingDialog);
            }
          }}
        >
          <BadgeDollarSign className="size-4" aria-hidden="true" />
          {t("workspace.recharge")}
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400"
          onClick={() => workspaceShell?.openAuthDialog({ intent: "billing" })}
        >
          <LogIn className="size-4" aria-hidden="true" />
          {t("workspace.recharge")}
        </button>
      )}
      <Link
        href="/links"
        className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400"
      >
        <Server className="size-4" aria-hidden="true" />
        {t("workspace.linksNav")}
      </Link>
      <Link
        href="/feedback"
        className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400"
      >
        <Send className="size-4" aria-hidden="true" />
        {t("workspace.feedback")}
      </Link>
      {isAdmin ? (
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400"
        >
          <ShieldCheck className="size-4" aria-hidden="true" />
          {t("nav.admin")}
        </Link>
      ) : null}
      {isLoggedIn ? (
        <Link
          href="/account"
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400"
        >
          <UserRound className="size-4" aria-hidden="true" />
          {t("nav.account")}
        </Link>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400"
          onClick={() => workspaceShell?.openAuthDialog()}
        >
          <LogIn className="size-4" aria-hidden="true" />
          {t("nav.login")}
        </button>
      )}
      <WorkspaceLanguageSwitch className="min-w-36" />
    </div>
  );
}

type NavItem = {
  key: WorkspaceNavKey;
  label: string;
  ariaLabel?: string;
  active: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  statusLabel?: string;
};

type NavSection = {
  key: string;
  label: string;
  items: NavItem[];
};

function createSidebarNavItem({
  item,
  pathname,
  activePanel,
  t
}: {
  item: WorkspaceNavItemConfig;
  pathname: string;
  activePanel: WorkspacePanel;
  t: (key: string) => string;
}): NavItem {
  const active = isWorkspaceNavItemActive(item, pathname, activePanel);

  return {
    key: item.key,
    label: t(item.labelKey),
    active,
    href: item.href,
    disabled: item.comingSoon,
    statusLabel: item.comingSoon ? t("workspace.comingSoon") : undefined
  };
}

function LanguageCompactToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      aria-label={t("workspace.language")}
      title={`${t("workspace.language")}: ${locale === "zh-CN" ? t("nav.zh") : t("nav.en")}`}
      onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
    >
      <Globe className="size-4" aria-hidden="true" />
    </button>
  );
}

function renderNavItem(
  item: NavItem,
  isCollapsed: boolean,
  t: (key: string) => string
) {
  const Icon = workspaceNavIconMap[item.key];
  const label = item.ariaLabel ?? item.label;
  const statusLabel = !isCollapsed ? item.statusLabel : undefined;
  const content = (
    <>
      <Icon
        className={isCollapsed ? "size-5" : "size-5 shrink-0"}
        aria-hidden="true"
      />
      <RailLabel isCollapsed={isCollapsed}>{item.label}</RailLabel>
      {statusLabel ? (
        <span className="ml-auto shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold leading-none text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-800">
          {statusLabel}
        </span>
      ) : null}
    </>
  );

  if (item.disabled) {
    return (
      <span
        key={item.key}
        className={railItemClass(item.active, isCollapsed, true)}
        aria-label={`${label} ${t("workspace.comingSoon")}`}
        title={`${label} - ${t("workspace.comingSoon")}`}
      >
        {content}
      </span>
    );
  }

  if (item.onClick) {
    return (
      <button
        key={item.key}
        type="button"
        className={railItemClass(item.active, isCollapsed)}
        aria-label={label}
        title={item.label}
        onClick={item.onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      key={item.key}
      href={item.href ?? "/"}
      className={railItemClass(item.active, isCollapsed)}
      aria-label={label}
      aria-current={item.active ? "page" : undefined}
      title={item.label}
    >
      {content}
    </Link>
  );
}

export function SidebarNav({
  isLoggedIn,
  isAdmin,
  onLogout,
  siteName,
  logoText,
  logoUrl,
  activePanel,
  remainingCredits,
  planName,
  theme,
  onToggleTheme,
  isCollapsed = false,
  onToggleCollapsed,
  onOpenBilling
}: {
  isLoggedIn: boolean;
  isAdmin: boolean;
  onLogout: () => void;
  siteName?: string;
  logoText?: string;
  logoUrl?: string | null;
  activePanel?: WorkspacePanel;
  remainingCredits?: number;
  planName?: string;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpenBilling?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const openBillingDialog = onOpenBilling ?? workspaceShell?.openBillingDialog;
  const [logoFailed, setLogoFailed] = useState(false);
  const activeKey =
    activePanel ?? (pathname === "/" ? "chat" : pathname.split("/")[1] || "chat");

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  const sidebarItemContext = {
    pathname,
    activePanel: activePanel ?? null,
    t
  };
  const creationItems: NavItem[] = workspaceCreationNavItems.map((item) =>
    createSidebarNavItem({ item, ...sidebarItemContext })
  );

  const managementItems: NavItem[] = workspaceManagementNavItems.map((item) =>
    createSidebarNavItem({ item, ...sidebarItemContext })
  );

  const serviceItems: NavItem[] = workspaceServiceNavItems.map((item) =>
    createSidebarNavItem({ item, ...sidebarItemContext })
  );

  const navSections: NavSection[] = [
    {
      key: "creation",
      label: t("workspace.groupCreation"),
      items: creationItems
    },
    {
      key: "management",
      label: t("workspace.groupManagement"),
      items: managementItems
    },
    {
      key: "service",
      label: t("workspace.groupService"),
      items: serviceItems
    }
  ];

  return (
    <aside
      className={`hidden h-[100dvh] overflow-hidden border-r border-slate-200 bg-white py-4 md:flex md:flex-col lg:flex lg:flex-col dark:border-slate-700 dark:bg-slate-950 ${
        isCollapsed ? "w-[72px] px-2" : "w-[260px] px-4"
      }`}
      data-active-panel={activeKey}
      data-sidebar-collapsed={isCollapsed ? "true" : "false"}
    >
      <div
        className={`flex items-center ${
          isCollapsed ? "justify-center gap-1" : "justify-between gap-2"
        }`}
      >
        <a
          href="/"
          className={`flex min-w-0 items-center rounded-2xl px-2 py-2 text-slate-950 transition hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800 ${
            isCollapsed ? "justify-center" : "gap-3"
          }`}
          aria-label={siteName || t("app.name")}
          title={siteName || t("app.name")}
        >
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 text-sm font-bold text-white shadow-sm">
            {logoUrl && !logoFailed ? (
              <img
                alt={siteName || t("app.name")}
                className="size-full bg-white object-contain"
                src={logoUrl}
                onError={() => setLogoFailed(true)}
              />
            ) : (
              logoText || "AI"
            )}
          </span>
          <span className={isCollapsed ? "sr-only" : "min-w-0"}>
            <span className="block truncate text-sm font-bold">
              {siteName || t("app.name")}
            </span>
            <span className="mt-0.5 block truncate text-xs font-medium text-slate-500 dark:text-slate-400">
              {t("workspace.workbench")}
            </span>
          </span>
        </a>
        {onToggleCollapsed ? (
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={
              isCollapsed ? t("workspace.expandSidebar") : t("workspace.collapseSidebar")
            }
            title={
              isCollapsed ? t("workspace.expandSidebar") : t("workspace.collapseSidebar")
            }
            onClick={onToggleCollapsed}
            data-sidebar-toggle="true"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="size-5" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-5" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      <nav
        className="mt-6 flex-1 min-h-0 overflow-y-auto"
        aria-label={t("workspace.menu")}
      >
        <div className="grid gap-4">
          {navSections.map((section) => (
            <div key={section.key} className="grid gap-1.5">
              <div
                className={
                  isCollapsed
                    ? "sr-only"
                    : "truncate px-3 text-xs font-bold uppercase leading-tight text-slate-400 dark:text-slate-500"
                }
              >
                {section.label}
              </div>
              <div className="grid gap-1">
                {section.items.map((item) =>
                  renderNavItem(item, isCollapsed, t)
                )}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer: account card, language/theme/logout */}
      <div className="shrink-0">
        <SidebarAccountCard
          user={workspaceShell?.shell.user ?? null}
          isLoggedIn={isLoggedIn}
          isAdmin={isAdmin}
          remainingCredits={remainingCredits}
          planName={planName}
          openBillingDialog={openBillingDialog ?? (() => {})}
          isCollapsed={isCollapsed}
        />
        <div
          className={`mt-3 ${
            isCollapsed
              ? "flex flex-col items-center gap-1.5 px-2"
              : "flex items-center justify-start gap-1 px-3"
          }`}
        >
          <LanguageCompactToggle />
          {onToggleTheme ? (
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label={
                theme === "dark" ? t("workspace.themeLight") : t("workspace.themeDark")
              }
              title={
                theme === "dark" ? t("workspace.themeLight") : t("workspace.themeDark")
              }
              onClick={onToggleTheme}
            >
              {theme === "dark" ? (
                <Sun className="size-4" aria-hidden="true" />
              ) : (
                <Moon className="size-4" aria-hidden="true" />
              )}
            </button>
          ) : null}
          {isLoggedIn ? (
            <button
              type="button"
              className={`flex items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
                isCollapsed ? "size-9" : "h-9 px-2 text-[11px] font-semibold"
              }`}
              onClick={onLogout}
              aria-label={t("nav.logout")}
              title={t("nav.logout")}
            >
              {isCollapsed ? (
                <LogOut className="size-4" aria-hidden="true" />
              ) : (
                t("nav.logout")
              )}
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
