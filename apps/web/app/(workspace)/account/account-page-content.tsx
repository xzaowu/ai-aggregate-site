"use client";

import { useCallback, useEffect, useState } from "react";
import { AccountPanel } from "../../../components/workspace/AccountPanel";
import {
  useOptionalWorkspaceSurface,
  useWorkspaceShellContext
} from "../../../components/workspace/workspace-shell-context";

export default function AccountPageContent() {
  const workspaceShell = useWorkspaceShellContext();
  const surface = useOptionalWorkspaceSurface();
  const [isActiveSurface, setIsActiveSurface] = useState(surface === null);
  const { shell, logout } = workspaceShell;
  const token = shell.token;
  const user = shell.user;
  const remainingCredits = shell.remainingCredits ?? null;

  const onLogout = useCallback(() => {
    logout();
    workspaceShell.openAuthDialog({ mode: "login" });
  }, [logout, workspaceShell]);

  useEffect(() => {
    if (!surface) {
      setIsActiveSurface(true);
      return;
    }

    const media = window.matchMedia("(min-width: 768px)");
    const update = () => {
      setIsActiveSurface(surface === "desktop" ? media.matches : !media.matches);
    };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [surface]);

  return (
    <AccountPanel
      token={token}
      user={user}
      remainingCredits={remainingCredits}
      planName={shell.planName}
      onLogout={onLogout}
      loadOverview={isActiveSurface}
      isMobileSurface={surface === "mobile"}
    />
  );
}
