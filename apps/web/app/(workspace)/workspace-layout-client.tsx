"use client";

import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import { AppShell } from "../../components/workspace/AppShell";
import { CanvasWorkspaceShell } from "../../components/workspace/CanvasWorkspaceShell";
import { MobileWorkspaceShell } from "../../components/workspace/MobileWorkspaceShell";
import { SidebarNav } from "../../components/workspace/SidebarNav";
import { useWorkspaceShell } from "../../components/workspace/use-workspace-shell";
import { useResponsiveWorkspaceMode } from "../../hooks/use-responsive-workspace-mode";
import {
  useWorkspaceShellContext,
  WorkspaceShellLoadingShell,
  WorkspaceShellProvider,
  WorkspaceSurfaceProvider
} from "../../components/workspace/workspace-shell-context";
import {
  getWorkspaceActiveKey,
  getWorkspacePanelFromPathname,
  type WorkspaceNavKey
} from "../../components/workspace/workspace-navigation";
import { useI18n } from "../../lib/i18n/use-i18n";

const titleKeys: Partial<Record<WorkspaceNavKey | "more", string>> = {
  chat: "workspace.chat",
  image: "workspace.imageNav",
  video: "workspace.videoNav",
  canvas: "workspace.canvasNav",
  ppt: "workspace.pptNav",
  tasks: "workspace.tasksNav",
  assets: "workspace.assetsNav",
  models: "workspace.models",
  plans: "workspace.recharge",
  feedback: "workspace.feedback",
  help: "nav.help",
  account: "nav.account",
  links: "workspace.linksNav"
};

function WorkspaceLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const shell = useWorkspaceShell();
  const shellContext = useWorkspaceShellContext();
  const workspaceMode = useResponsiveWorkspaceMode();
  const activePanel = getWorkspacePanelFromPathname(pathname);
  const activeKey = getWorkspaceActiveKey(pathname, activePanel);
  const titleKey = activeKey ? titleKeys[activeKey] : null;
  const currentTitle =
    pathname === "/" && shellContext.currentTitle
      ? shellContext.currentTitle
      : titleKey
        ? t(titleKey)
        : t("workspace.workbench");
  const showChatSidebar = pathname === "/" && activePanel === null;
  const showImageCompactHeader = pathname === "/image" || pathname.startsWith("/image/");
  const showWorksCompactHeader =
    pathname === "/assets" ||
    pathname.startsWith("/assets/") ||
    pathname === "/tasks" ||
    pathname.startsWith("/tasks/");
  const createSession = shellContext.createSession ?? shell.createSession;

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem("ai-aggregate:sidebar-collapsed");
    setIsSidebarCollapsed(stored === "true");
  }, []);
  const toggleSidebarCollapsed = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("ai-aggregate:sidebar-collapsed", String(next));
      }
      return next;
    });
  };

  if (workspaceMode === null) {
    return <WorkspaceShellLoadingShell />;
  }

  const isCanvasRoute = pathname === "/canvas" || pathname.startsWith("/canvas/");
  const isCanvasEditorRoute = pathname === "/canvas";

  if (isCanvasEditorRoute && workspaceMode === "desktop") {
    return (
      <WorkspaceSurfaceProvider surface={workspaceMode}>
        <CanvasWorkspaceShell
          isLoggedIn={shell.isLoggedIn}
          isAdmin={shell.isAdmin}
          onLogout={shell.logout}
          siteName={shell.siteName}
          logoText={shell.logoText}
          logoUrl={shell.logoUrl}
          activePanel={activePanel}
          remainingCredits={shell.remainingCredits}
          planName={shell.planName}
          theme={shell.theme}
          onToggleTheme={shell.toggleTheme}
        >
          {children}
        </CanvasWorkspaceShell>
      </WorkspaceSurfaceProvider>
    );
  }

  if (workspaceMode === "mobile") {
    return (
      <MobileWorkspaceShell
        siteName={shell.siteName.length > 14 ? "AI" : shell.siteName}
        logoText={shell.logoText}
        logoUrl={shell.logoUrl}
        currentTitle={currentTitle}
        currentModelLabel={showChatSidebar ? shellContext.currentModelLabel : null}
        activePanel={activePanel}
        compactChatHeader={showChatSidebar}
        compactMenuOnly={showImageCompactHeader || showWorksCompactHeader || isCanvasRoute}
        hideMobileTopBar
        isLoggedIn={shell.isLoggedIn}
        isAdmin={shell.isAdmin}
        onNavigate={shell.navigateToWorkspacePanel}
        onCreateSession={createSession}
        onLogout={shell.logout}
      >
        {children}
      </MobileWorkspaceShell>
    );
  }

  return (
    <AppShell
      nav={
        <SidebarNav
          isLoggedIn={shell.isLoggedIn}
          isAdmin={shell.isAdmin}
          onLogout={shell.logout}
          siteName={shell.siteName}
          logoText={shell.logoText}
          logoUrl={shell.logoUrl}
          activePanel={activePanel}
          remainingCredits={shell.remainingCredits}
          planName={shell.planName}
          theme={shell.theme}
          onToggleTheme={shell.toggleTheme}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
        />
      }
      sidebar={showChatSidebar ? shellContext.sidebar : null}
      isNavCollapsed={isSidebarCollapsed}
    >
      {children}
    </AppShell>
  );
}

export function WorkspaceLayoutClient({
  children,
  gateUntilHydrated = true
}: {
  children: React.ReactNode;
  gateUntilHydrated?: boolean;
}) {
  return (
    <WorkspaceShellProvider gateUntilHydrated={gateUntilHydrated}>
      <WorkspaceLayoutInner>{children}</WorkspaceLayoutInner>
    </WorkspaceShellProvider>
  );
}
