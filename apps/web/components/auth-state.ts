import type { AuthUser } from "@ai-aggregate/shared";

export const authTokenKey = "ai-aggregate-token";
export const authUserKey = "ai-aggregate-user";

export interface HeaderAuthState {
  token: string | null;
  user: AuthUser | null;
}

type AuthStorage = Pick<Storage, "getItem" | "removeItem">;

function isAuthUser(value: unknown): value is AuthUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    "email" in value &&
    typeof value.email === "string" &&
    value.email.trim().length > 0 &&
    "role" in value &&
    (value.role === "USER" || value.role === "ADMIN") &&
    "credits" in value &&
    typeof value.credits === "number"
  );
}

export function readStoredAuthState(storage: AuthStorage): HeaderAuthState {
  const token = storage.getItem(authTokenKey);

  if (!token) {
    return {
      token: null,
      user: null
    };
  }

  const storedUser = storage.getItem(authUserKey);

  if (!storedUser) {
    return {
      token,
      user: null
    };
  }

  try {
    const parsedUser = JSON.parse(storedUser) as unknown;

    if (!isAuthUser(parsedUser)) {
      storage.removeItem(authUserKey);
      return {
        token,
        user: null
      };
    }

    return {
      token,
      user: parsedUser
    };
  } catch {
    storage.removeItem(authUserKey);
    return {
      token,
      user: null
    };
  }
}

export function clearStoredAuthState(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(authTokenKey);
  storage.removeItem(authUserKey);
}

export function getHeaderAuthLabel(
  state: HeaderAuthState,
  fallbackLabel: string
): string {
  return state.user?.email ?? fallbackLabel;
}
