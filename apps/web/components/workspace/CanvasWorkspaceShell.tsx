"use client";

import { Menu, Sparkles, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { SidebarNav } from "./SidebarNav";
import { useOptionalWorkspaceShellContext } from "./workspace-shell-context";
import type { WorkspacePanel } from "./workspace-navigation";

const CANVAS_NAV_DRAWER_ID = "creator-canvas-navigation-drawer";

export function CanvasWorkspaceShell({
  children,
  isLoggedIn,
  isAdmin,
  onLogout,
  currentTitle,
  siteName,
  logoText,
  logoUrl,
  activePanel,
  remainingCredits,
  planName,
  theme,
  onToggleTheme
}: {
  children: React.ReactNode;
  isLoggedIn: boolean;
  isAdmin: boolean;
  onLogout: () => void;
  currentTitle?: string | null;
  siteName?: string;
  logoText?: string;
  logoUrl?: string | null;
  activePanel?: WorkspacePanel;
  remainingCredits?: number;
  planName?: string;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}) {
  const { t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const contextTitle = workspaceShell?.shell.authStatus === "authenticated"
    ? workspaceShell.currentTitle
    : null;
  const displayTitle = (
    currentTitle !== undefined ? currentTitle : contextTitle
  )?.trim() || t("creator.canvas.persistence.untitled");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isDrawerOpen) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDrawerOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [isDrawerOpen]);

  return (
    <div
      className="relative flex h-[100dvh] min-h-0 min-w-0 w-full overflow-hidden bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
      data-canvas-fullscreen-editor-shell="true"
      data-canvas-permanent-sidebar="false"
    >
      {children}

      <header
        className="pointer-events-none absolute left-4 top-4 z-30 flex min-w-0 items-center"
        data-creator-canvas-top-bar="true"
      >
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 pr-4 shadow-xl shadow-slate-950/10 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/30">
          <button
            ref={triggerRef}
            type="button"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label={t("workspace.menu")}
            aria-controls={CANVAS_NAV_DRAWER_ID}
            aria-expanded={isDrawerOpen}
            onClick={() => setIsDrawerOpen(true)}
            data-canvas-nav-trigger="true"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <span className="h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              <h1
                className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100"
                data-creator-canvas-current-title="true"
              >
                {displayTitle}
              </h1>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
              {t("creator.canvas.workspaceSubtitle")}
            </p>
          </div>
        </div>
      </header>

      {isDrawerOpen ? (
        <div className="absolute inset-0 z-50" data-canvas-nav-overlay="true">
          <button
            type="button"
            className="absolute inset-0 size-full cursor-default bg-slate-950/45 backdrop-blur-[1px]"
            aria-label={t("workspace.closeMenu")}
            onClick={() => setIsDrawerOpen(false)}
            data-canvas-nav-backdrop="true"
          />
          <section
            id={CANVAS_NAV_DRAWER_ID}
            className="absolute inset-y-0 left-0 w-[292px] max-w-[calc(100vw-2rem)] bg-white shadow-2xl dark:bg-slate-950"
            role="dialog"
            aria-modal="true"
            aria-label={t("workspace.menu")}
            data-canvas-nav-drawer="true"
          >
            <SidebarNav
              isLoggedIn={isLoggedIn}
              isAdmin={isAdmin}
              onLogout={onLogout}
              siteName={siteName}
              logoText={logoText}
              logoUrl={logoUrl}
              activePanel={activePanel}
              remainingCredits={remainingCredits}
              planName={planName}
              theme={theme}
              onToggleTheme={onToggleTheme}
            />
            <button
              ref={closeRef}
              type="button"
              className="absolute right-3 top-5 z-10 inline-flex size-9 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={t("workspace.closeMenu")}
              onClick={() => setIsDrawerOpen(false)}
              data-canvas-nav-close="true"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
