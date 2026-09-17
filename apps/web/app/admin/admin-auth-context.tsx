"use client";

import type { AuthUser } from "@ai-aggregate/shared";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import {
  authTokenKey,
  authUserKey,
  clearStoredAuthState,
  readStoredAuthState
} from "../../components/auth-state";

interface AdminAuthState {
  token: string | null;
  user: AuthUser | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
}

interface AdminAuthContextValue extends AdminAuthState {
  logout: () => void;
  setAuthUser: (user: AuthUser) => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function fetchStoredAuth(): { token: string | null; user: AuthUser | null } {
  if (typeof window === "undefined") {
    return { token: null, user: null };
  }
  return readStoredAuthState(window.localStorage);
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminAuthState>(() => {
    const auth = fetchStoredAuth();
    return {
      token: auth.token,
      user: auth.user,
      isLoggedIn: Boolean(auth.token),
      isAdmin: auth.user?.role === "ADMIN"
    };
  });

  const setAuthUser = useCallback(
    (user: AuthUser) => {
      window.localStorage.setItem(authUserKey, JSON.stringify(user));
      setState((prev) => ({ ...prev, user, isAdmin: user.role === "ADMIN" }));
    },
    []
  );

  const logout = useCallback(() => {
    clearStoredAuthState(window.localStorage);
    setState({
      token: null,
      user: null,
      isLoggedIn: false,
      isAdmin: false
    });
  }, []);

  // Sync across tabs when storage changes (e.g. logout in another tab)
  useEffect(() => {
    function handleStorageChange(event: StorageEvent) {
      if (event.key === authTokenKey || event.key === authUserKey) {
        const auth = fetchStoredAuth();
        setState({
          token: auth.token,
          user: auth.user,
          isLoggedIn: Boolean(auth.token),
          isAdmin: auth.user?.role === "ADMIN"
        });
      }
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return (
    <AdminAuthContext.Provider
      value={{ ...state, logout, setAuthUser }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return context;
}
