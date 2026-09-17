import type { ReactNode } from "react";
import React from "react";
import { WorkspaceSurfaceProvider } from "./workspace-shell-context";

export function AppShell({
  nav,
  sidebar,
  isNavCollapsed = false,
  children
}: {
  nav: ReactNode;
  sidebar: ReactNode | null;
  isNavCollapsed?: boolean;
  children: ReactNode;
}) {
  const gridClass = sidebar
    ? isNavCollapsed
      ? "grid h-full min-h-0 grid-cols-1 md:grid-cols-[72px_auto_minmax(0,1fr)] lg:grid-cols-[72px_auto_minmax(0,1fr)]"
      : "grid h-full min-h-0 grid-cols-1 md:grid-cols-[260px_auto_minmax(0,1fr)] lg:grid-cols-[260px_auto_minmax(0,1fr)]"
    : isNavCollapsed
      ? "grid h-full min-h-0 grid-cols-1 md:grid-cols-[72px_minmax(0,1fr)] lg:grid-cols-[72px_minmax(0,1fr)]"
      : "grid h-full min-h-0 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]";

  return (
    <WorkspaceSurfaceProvider surface="desktop">
      <div
        className="hidden h-[100dvh] min-h-0 overflow-hidden bg-slate-50 text-slate-950 md:block dark:bg-slate-950 dark:text-slate-100"
        data-desktop-workspace-shell="true"
      >
        <div className={gridClass}>
          {nav}
          {sidebar ? sidebar : null}
          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              data-workspace-page-frame="true"
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </WorkspaceSurfaceProvider>
  );
}
