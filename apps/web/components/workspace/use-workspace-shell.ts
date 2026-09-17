"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  getPublicLogoText,
  getPublicLogoUrl,
  getPublicSiteName
} from "../../lib/public-branding";
import { usePublicSettings } from "../../lib/use-public-settings";
import {
  getWorkspacePanelUrl,
  type WorkspacePanel
} from "./workspace-navigation";
import { useWorkspaceShellContext } from "./workspace-shell-context";

export function useWorkspaceShell() {
  const router = useRouter();
  const publicSettings = usePublicSettings();
  const {
    shell,
    logout: ctxLogout,
    isBillingDialogOpen,
    openBillingDialog,
    closeBillingDialog,
    theme,
    toggleTheme
  } = useWorkspaceShellContext();

  const siteName = getPublicSiteName(publicSettings);
  const logoText = getPublicLogoText(publicSettings);
  const logoUrl = getPublicLogoUrl(publicSettings);

  const navigateToWorkspacePanel = useCallback(
    (panel: WorkspacePanel) => {
      router.push(getWorkspacePanelUrl(panel), { scroll: false });
    },
    [router]
  );

  const createSession = useCallback(() => {
    router.push("/");
  }, [router]);

  return {
    siteName,
    logoText,
    logoUrl,
    isLoggedIn: shell.isLoggedIn,
    isAdmin: shell.isAdmin,
    remainingCredits: shell.remainingCredits,
    planName: shell.planName,
    theme,
    logout: ctxLogout,
    navigateToWorkspacePanel,
    createSession,
    toggleTheme,
    isBillingDialogOpen,
    openBillingDialog,
    closeBillingDialog
  };
}
