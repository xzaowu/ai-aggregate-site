"use client";

import type { AuthUser } from "@ai-aggregate/shared";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from "react";

import {
  authTokenKey,
  authUserKey,
  clearStoredAuthState,
  readStoredAuthState
} from "../auth-state";
import { apiUrl } from "../../lib/site-config";
import { usePublicSettings } from "../../lib/use-public-settings";
import { useTheme } from "../../lib/use-theme";
import { AuthDialog } from "./AuthDialog";
import { BillingDialog } from "./BillingDialog";

interface QuotaData {
  remainingCredits: number;
  planName?: string;
}

export type WorkspaceAuthStatus = "unknown" | "guest" | "authenticated";

type AuthDialogMode = "login" | "register";
type AuthDialogIntent = "default" | "billing";

export function isSafeInternalReturnTo(
  value: string | null | undefined
): value is string {
  if (!value) return false;

  let candidate = value;
  for (let depth = 0; depth < 8; depth += 1) {
    const lower = candidate.toLowerCase();
    if (
      candidate.includes("\\") ||
      candidate.startsWith("//") ||
      lower.includes("://") ||
      lower.includes("javascript:") ||
      lower.includes("%5c") ||
      lower.includes("%2f%2f")
    ) {
      return false;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return false;
    }

    if (decoded === candidate) break;
    candidate = decoded;
  }

  const lower = candidate.toLowerCase();
  return (
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !candidate.includes("\\") &&
    !lower.includes("://") &&
    !lower.includes("javascript:")
  );
}

export interface WorkspaceShellState {
  authStatus: WorkspaceAuthStatus;
  hydrated: boolean;
  isLoggedIn: boolean;
  isAdmin: boolean;
  token: string | null;
  user: AuthUser | null;
  remainingCredits: number | undefined;
  planName: string | undefined;
}

type WorkspaceShellContextValue = {
  shell: WorkspaceShellState;
  logout: () => void;
  setAuthUser: (user: AuthUser) => void;
  refreshQuota: () => void;
  sidebar: ReactNode | null;
  setSidebar: (sidebar: ReactNode | null) => void;
  mobileDrawerPanel: ReactNode | null;
  setMobileDrawerPanel: (panel: ReactNode | null) => void;
  currentTitle: string | null;
  setCurrentTitle: (title: string | null) => void;
  currentModelLabel: string | null;
  setCurrentModelLabel: (label: string | null) => void;
  createSession: (() => void) | null;
  setCreateSession: (handler: (() => void) | null) => void;
  closeMobileDrawer: () => void;
  setCloseMobileDrawer: (handler: (() => void) | null) => void;
  isBillingDialogOpen: boolean;
  openBillingDialog: () => void;
  closeBillingDialog: () => void;
  isAuthDialogOpen: boolean;
  authDialogMode: AuthDialogMode;
  authDialogIntent: AuthDialogIntent;
  openAuthDialog: (opts?: { mode?: AuthDialogMode; intent?: AuthDialogIntent; returnTo?: string | null }) => void;
  closeAuthDialog: () => void;
  setAuthSession: (session: { token: string; user: AuthUser }) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
};

export type BillingDialogAction = "open" | "close";

export function reduceBillingDialogState(
  _isOpen: boolean,
  action: BillingDialogAction
): boolean {
  return action === "open";
}

export function invokeWorkspaceBillingAction(openBillingDialog: () => void): void {
  openBillingDialog();
}

export function WorkspaceShellLoadingShell() {
  return (
    <div
      className="flex min-h-[100dvh] w-full overflow-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
      data-workspace-auth-loading="true"
    >
      <aside className="hidden w-[260px] shrink-0 border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:block">
        <div className="h-10 w-36 rounded-2xl bg-slate-100 dark:bg-slate-800" />
        <div className="mt-8 grid gap-2">
          <div className="h-11 rounded-xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-11 rounded-xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-11 rounded-xl bg-slate-100 dark:bg-slate-800" />
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="h-14 shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="w-full max-w-4xl">
            <div className="h-8 w-2/5 rounded-xl bg-slate-200 dark:bg-slate-800" />
            <div className="mt-4 h-24 rounded-2xl bg-white shadow-sm dark:bg-slate-900" />
          </div>
        </div>
      </main>
    </div>
  );
}

const WorkspaceShellContext = createContext<WorkspaceShellContextValue | null>(
  null
);

export type WorkspaceSurface = "mobile" | "desktop";

const WorkspaceSurfaceContext = createContext<WorkspaceSurface | null>(null);

export function WorkspaceSurfaceProvider({
  surface,
  children
}: {
  surface: WorkspaceSurface;
  children: ReactNode;
}) {
  return (
    <WorkspaceSurfaceContext.Provider value={surface}>
      {children}
    </WorkspaceSurfaceContext.Provider>
  );
}

export function useOptionalWorkspaceSurface() {
  return useContext(WorkspaceSurfaceContext);
}

type WorkspaceAuthStorage = Pick<Storage, "getItem" | "removeItem">;

export function getInitialWorkspaceShellState(): WorkspaceShellState {
  return {
    authStatus: "unknown",
    hydrated: false,
    isLoggedIn: false,
    isAdmin: false,
    token: null,
    user: null,
    remainingCredits: undefined,
    planName: undefined,
  };
}

export function resolveWorkspaceAuthState(
  storage: WorkspaceAuthStorage
): Pick<
  WorkspaceShellState,
  "authStatus" | "hydrated" | "isLoggedIn" | "isAdmin" | "token" | "user"
> {
  const auth = readStoredAuthState(storage);

  return {
    authStatus: auth.token ? "authenticated" : "guest",
    hydrated: true,
    isLoggedIn: Boolean(auth.token),
    isAdmin: auth.user?.role === "ADMIN",
    token: auth.token,
    user: auth.user,
  };
}

function fetchStoredAuth(): Pick<
  WorkspaceShellState,
  "authStatus" | "hydrated" | "isLoggedIn" | "isAdmin" | "token" | "user"
> {
  if (typeof window === "undefined") {
    return {
      authStatus: "guest",
      hydrated: true,
      isLoggedIn: false,
      isAdmin: false,
      token: null,
      user: null,
    };
  }
  return resolveWorkspaceAuthState(window.localStorage);
}

function fetchQuota(token: string): Promise<QuotaData> {
  return fetch(apiUrl("/quota/me"), {
    headers: { Authorization: `Bearer ${token}` }
  }).then((res) => {
    if (!res.ok) throw new Error(`quota fetch failed (${res.status})`);
    return res.json() as Promise<QuotaData>;
  });
}

export function WorkspaceShellProvider({
  children,
  gateUntilHydrated = false
}: {
  children: ReactNode;
  gateUntilHydrated?: boolean;
}) {
  const publicSettings = usePublicSettings();
  const { theme, toggleTheme } = useTheme();
  const [shell, setShell] = useState<WorkspaceShellState>(
    getInitialWorkspaceShellState
  );
  const quotaRequestSeqRef = useRef(0);
  const [sidebar, setSidebarState] = useState<ReactNode | null>(null);
  const [mobileDrawerPanel, setMobileDrawerPanelState] =
    useState<ReactNode | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const [currentModelLabel, setCurrentModelLabel] = useState<string | null>(
    null
  );
  const [createSession, setCreateSessionState] = useState<
    (() => void) | null
  >(null);
  const [closeMobileDrawerHandler, setCloseMobileDrawerHandler] =
    useState<(() => void) | null>(null);
  const [isBillingDialogOpen, dispatchBillingDialog] = useReducer(
    reduceBillingDialogState,
    false
  );
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthDialogMode>("login");
  const [authDialogIntent, setAuthDialogIntent] = useState<AuthDialogIntent>("default");
  const [authReturnTo, setAuthReturnTo] = useState<string | null>(null);
  const authParamHandledRef = useRef(false);

  useEffect(() => {
    setShell((prev) => ({ ...prev, ...fetchStoredAuth() }));
  }, []);

  const setShellState = useCallback(
    (patch: Partial<WorkspaceShellState>) =>
      setShell((prev) => ({ ...prev, ...patch })),
    []
  );

  const refreshQuota = useCallback(() => {
    const token = shell.token;
    if (!token) return;
    quotaRequestSeqRef.current += 1;
    const seq = quotaRequestSeqRef.current;
    fetchQuota(token)
      .then((data) => {
        if (quotaRequestSeqRef.current !== seq) return;
        setShell((prev) => {
          if (prev.token !== token) return prev;
          return {
            ...prev,
            remainingCredits: data.remainingCredits,
            planName: data.planName ?? "free",
          };
        });
      })
      .catch(() => {
        if (quotaRequestSeqRef.current !== seq) return;
        setShell((prev) => {
          if (prev.token !== token) return prev;
          return { ...prev, remainingCredits: undefined, planName: undefined };
        });
      });
  }, [shell.token]);

  useEffect(() => {
    if (!shell.token) {
      setShellState({ remainingCredits: undefined, planName: undefined });
      return;
    }
    refreshQuota();
  }, [refreshQuota, shell.token]);

  const setAuthUser = useCallback(
    (user: AuthUser) => {
      window.localStorage.setItem(authUserKey, JSON.stringify(user));
      setShellState({
        authStatus: "authenticated",
        hydrated: true,
        isLoggedIn: true,
        user,
        isAdmin: user.role === "ADMIN"
      });
    },
    [setShellState]
  );

  const logout = useCallback(() => {
    clearStoredAuthState(window.localStorage);
    setShell({
      authStatus: "guest",
      hydrated: true,
      isLoggedIn: false,
      isAdmin: false,
      token: null,
      user: null,
      remainingCredits: undefined,
      planName: undefined,
    });
  }, []);

  const setSidebar = useCallback((nextSidebar: ReactNode | null) => {
    setSidebarState(nextSidebar);
  }, []);

  const setMobileDrawerPanel = useCallback((nextPanel: ReactNode | null) => {
    setMobileDrawerPanelState(nextPanel);
  }, []);

  const setCreateSession = useCallback(
    (handler: (() => void) | null) => {
      setCreateSessionState(() => handler);
    },
    []
  );

  const setCloseMobileDrawer = useCallback(
    (handler: (() => void) | null) => {
      setCloseMobileDrawerHandler(() => handler);
    },
    []
  );

  const closeMobileDrawer = useCallback(() => {
    closeMobileDrawerHandler?.();
  }, [closeMobileDrawerHandler]);

  const closeBillingDialog = useCallback(() => {
    dispatchBillingDialog("close");
  }, []);

  const openAuthDialog = useCallback((opts?: { mode?: AuthDialogMode; intent?: AuthDialogIntent; returnTo?: string | null }) => {
    const requestedMode = opts?.mode ?? "login";
    setAuthDialogMode(
      requestedMode === "register" && publicSettings?.registrationEnabled !== true
        ? "login"
        : requestedMode
    );
    setAuthDialogIntent(opts?.intent ?? "default");
    setAuthReturnTo(opts?.returnTo ?? null);
    setIsAuthDialogOpen(true);
  }, [publicSettings?.registrationEnabled]);

  const closeAuthDialog = useCallback(() => {
    setIsAuthDialogOpen(false);
  }, []);

  const setAuthSession = useCallback((session: { token: string; user: AuthUser }) => {
    window.localStorage.setItem(authTokenKey, session.token);
    window.localStorage.setItem(authUserKey, JSON.stringify(session.user));
    setShellState({
      authStatus: "authenticated",
      hydrated: true,
      isLoggedIn: true,
      isAdmin: session.user.role === "ADMIN",
      token: session.token,
      user: session.user,
    });
    refreshQuota();
  }, [refreshQuota, setShellState]);

  const openBillingDialog = useCallback(() => {
    if (shell.authStatus !== "authenticated") {
      openAuthDialog({ mode: "login", intent: "billing" });
      return;
    }
    dispatchBillingDialog("open");
  }, [shell.authStatus, openAuthDialog]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authParamHandledRef.current) {
      authParamHandledRef.current = true;
      const searchParams = new URLSearchParams(window.location.search);
      const authParam = searchParams.get("auth");
      if (authParam === "login" || authParam === "register") {
        const returnTo = searchParams.get("returnTo");
        let safeReturnTo: string | null = null;
        if (isSafeInternalReturnTo(returnTo)) {
          safeReturnTo = returnTo;
        }
        openAuthDialog({ mode: authParam === "register" ? "register" : "login", returnTo: safeReturnTo });
        const url = new URL(window.location.href);
        url.searchParams.delete("auth");
        url.searchParams.delete("returnTo");
        window.history.replaceState(null, "", url.toString());
      }
    }
  }, [openAuthDialog]);

  const value = useMemo(
    () => ({
      shell,
      logout,
      setAuthUser,
      refreshQuota,
      sidebar,
      setSidebar,
      mobileDrawerPanel,
      setMobileDrawerPanel,
      currentTitle,
      setCurrentTitle,
      currentModelLabel,
      setCurrentModelLabel,
      createSession,
      setCreateSession,
      closeMobileDrawer,
      setCloseMobileDrawer,
      isBillingDialogOpen,
      openBillingDialog,
      closeBillingDialog,
      isAuthDialogOpen,
      authDialogMode,
      authDialogIntent,
      openAuthDialog,
      closeAuthDialog,
      setAuthSession,
      theme,
      toggleTheme,
    }),
    [
      shell,
      logout,
      setAuthUser,
      refreshQuota,
      closeMobileDrawer,
      closeBillingDialog,
      createSession,
      currentModelLabel,
      currentTitle,
      isBillingDialogOpen,
      mobileDrawerPanel,
      openBillingDialog,
      setCloseMobileDrawer,
      setCreateSession,
      setMobileDrawerPanel,
      setSidebar,
      sidebar,
      isAuthDialogOpen,
      authDialogMode,
      authDialogIntent,
      openAuthDialog,
      closeAuthDialog,
      setAuthSession,
      theme,
      toggleTheme,
    ]
  );

  return (
    <WorkspaceShellContext.Provider value={value}>
      {gateUntilHydrated && !shell.hydrated ? (
        <WorkspaceShellLoadingShell />
      ) : (
        children
      )}
      <BillingDialog
        isOpen={isBillingDialogOpen}
        token={shell.token}
        remainingCredits={shell.remainingCredits ?? null}
        onClose={closeBillingDialog}
        onOrderCreated={refreshQuota}
        onRequireLogin={() => openAuthDialog({ intent: "billing" })}
      />
      <AuthDialog
        isOpen={isAuthDialogOpen}
        mode={authDialogMode}
        registrationEnabled={publicSettings?.registrationEnabled === true}
        registrationClosedMessageZh={publicSettings?.registrationClosedMessageZh}
        registrationClosedMessageEn={publicSettings?.registrationClosedMessageEn}
        onClose={closeAuthDialog}
        onAuthSuccess={(token, user) => {
          setAuthSession({ token, user });
          closeAuthDialog();
          if (isSafeInternalReturnTo(authReturnTo)) {
            window.location.href = authReturnTo;
            return;
          }
          if (authDialogIntent === "billing") {
            dispatchBillingDialog("open");
          }
        }}
      />
    </WorkspaceShellContext.Provider>
  );
}

export function useWorkspaceShellContext() {
  const context = useContext(WorkspaceShellContext);

  if (!context) {
    throw new Error(
      "useWorkspaceShellContext must be used within WorkspaceShellProvider"
    );
  }

  return context;
}

export function useOptionalWorkspaceShellContext() {
  return useContext(WorkspaceShellContext);
}
