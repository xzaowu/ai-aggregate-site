import { describe, expect, it, vi } from "vitest";
import {
  authTokenKey,
  authUserKey,
  clearStoredAuthState,
  getHeaderAuthLabel,
  readStoredAuthState
} from "./auth-state";
import { localeStorageKey } from "../lib/i18n/use-i18n";

function createStorage(initialValues: Record<string, string> = {}) {
  const values = new Map(Object.entries(initialValues));

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    value(key: string) {
      return values.get(key) ?? null;
    }
  };
}

describe("header auth state", () => {
  it("shows login state as logged out when token is missing", () => {
    const storage = createStorage();

    expect(readStoredAuthState(storage)).toEqual({
      token: null,
      user: null
    });
  });

  it("shows user state and hides login when token and user are present", () => {
    const storage = createStorage({
      [authTokenKey]: "token_123",
      [authUserKey]: JSON.stringify({
        id: "user_1",
        email: "person@example.com",
        role: "USER",
        credits: 1000
      })
    });
    const state = readStoredAuthState(storage);

    expect(state.token).toBe("token_123");
    expect(getHeaderAuthLabel(state, "Signed in")).toBe("person@example.com");
  });

  it("falls back to a logged-in label when token exists without user", () => {
    const storage = createStorage({
      [authTokenKey]: "token_123"
    });

    expect(getHeaderAuthLabel(readStoredAuthState(storage), "已登录")).toBe(
      "已登录"
    );
    expect(getHeaderAuthLabel(readStoredAuthState(storage), "Signed in")).toBe(
      "Signed in"
    );
  });

  it("does not crash and clears malformed localStorage user data", () => {
    const storage = createStorage({
      [authTokenKey]: "token_123",
      [authUserKey]: "{bad json"
    });

    expect(readStoredAuthState(storage)).toEqual({
      token: "token_123",
      user: null
    });
    expect(storage.removeItem).toHaveBeenCalledWith(authUserKey);
  });

  it("clears stored user data when the role is missing or invalid", () => {
    const storage = createStorage({
      [authTokenKey]: "token_123",
      [authUserKey]: JSON.stringify({
        id: "user_1",
        email: "person@example.com",
        role: "OWNER",
        credits: 1000
      })
    });

    expect(readStoredAuthState(storage)).toEqual({
      token: "token_123",
      user: null
    });
    expect(storage.removeItem).toHaveBeenCalledWith(authUserKey);
  });

  it("removes token and user on logout without clearing locale", () => {
    const storage = createStorage({
      [authTokenKey]: "token_123",
      [authUserKey]: "{}",
      [localeStorageKey]: "en-US"
    });

    clearStoredAuthState(storage);

    expect(storage.removeItem).toHaveBeenCalledWith(authTokenKey);
    expect(storage.removeItem).toHaveBeenCalledWith(authUserKey);
    expect(storage.value(localeStorageKey)).toBe("en-US");
  });
});
