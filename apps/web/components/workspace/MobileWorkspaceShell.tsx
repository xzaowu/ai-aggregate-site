"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { type ReactNode } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { WorkspaceSurfaceProvider } from "./workspace-shell-context";
import {
  getWorkspaceMobileNavKey,
  isWorkspaceMobileNavItemActive,
  mobileBottomWorkspaceNavItems,
  workspaceNavIconMap,
  type WorkspacePanel
} from "./workspace-navigation";
import { Badge } from "./ui";

function mobileNavItemClass(active: boolean) {
  return active
    ? "flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl bg-indigo-50 px-1.5 py-2 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
    : "flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";
}

export function MobileWorkspaceShell({
  siteName,
  logoText,
  logoUrl,
  currentTitle,
  currentModelLabel,
  activePanel,
  compactMenuOnly = false,
  hideMobileTopBar = false,
  children
}: {
  siteName: string;
  logoText?: string;
  logoUrl?: string | null;
  currentTitle: string;
  currentModelLabel: string | null;
  activePanel: WorkspacePanel;
  compactChatHeader?: boolean;
  compactMenuOnly?: boolean;
  hideMobileTopBar?: boolean;
  mobileDrawerPanelOverride?: ReactNode | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  onNavigate: (panel: WorkspacePanel) => void;
  onCreateSession: () => void;
  onLogout: () => void;
  onOpenBilling?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [logoFailed, setLogoFailed] = React.useState(false);
  const activeMobileKey = getWorkspaceMobileNavKey(pathname, activePanel);
  const logoFallback =
    logoText?.trim() || siteName.trim().slice(0, 2).toUpperCase() || "AI";

  React.useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  return (
    <WorkspaceSurfaceProvider surface="mobile">
      <div
        className="md:hidden flex min-h-[100dvh] w-full max-w-[100vw] flex-col overflow-x-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
        data-mobile-workspace-shell="true"
      >
        {!compactMenuOnly && !hideMobileTopBar ? (
          <header
            className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
            data-mobile-top-bar="true"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 text-xs font-bold text-white">
                {logoUrl && !logoFailed ? (
                  <img
                    alt={siteName}
                    className="size-full bg-white object-contain"
                    src={logoUrl}
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  logoFallback
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="min-w-0 truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
                  {currentTitle}
                </h1>
                {currentModelLabel ? (
                  <div className="mt-1 max-w-full">
                    <Badge tone="indigo" className="max-w-full truncate">
                      {currentModelLabel}
                    </Badge>
                  </div>
                ) : null}
              </div>
            </div>
          </header>
        ) : null}

        <main
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
          data-mobile-content-safe-bottom="true"
        >
          {children}
        </main>

        <nav
          aria-label={t("workspace.menu")}
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-[0_-12px_30px_rgba(0,0,0,0.3)]"
          data-active-panel={activeMobileKey ?? ""}
          data-mobile-bottom-nav="true"
          data-mobile-bottom-nav-count={String(mobileBottomWorkspaceNavItems.length)}
        >
          <div className="mx-auto flex w-full max-w-md gap-1.5">
            {mobileBottomWorkspaceNavItems.map((item) => {
              const NavIcon = workspaceNavIconMap[item.icon];
              const active = isWorkspaceMobileNavItemActive(
                item,
                pathname,
                activePanel
              );

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={mobileNavItemClass(active)}
                  data-mobile-nav-key={item.key}
                  data-panel-url={item.href}
                >
                  <NavIcon className="size-5" aria-hidden="true" />
                  <span className="max-w-full whitespace-nowrap text-[11px] font-semibold leading-none">
                    {t(item.labelKey)}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </WorkspaceSurfaceProvider>
  );
}
