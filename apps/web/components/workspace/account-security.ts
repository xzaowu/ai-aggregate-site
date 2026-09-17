import { apiUrl } from "../../lib/site-config";

export interface AccountSecurityMessages {
  requestFailed: string;
  apiUnavailable: string;
}

interface AccountSecurityErrorDetails {
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
}

export class AccountSecurityRequestError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, details: AccountSecurityErrorDetails = {}) {
    super(message);
    this.status = details.status;
    this.code = details.code;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

interface ChangeAccountPasswordInput {
  token: string;
  currentPassword: string;
  newPassword: string;
  messages: AccountSecurityMessages;
  fetchImpl?: typeof fetch;
}

interface RevokeAccountSessionsInput {
  token: string;
  messages: AccountSecurityMessages;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(response: Pick<Response, "text">): Promise<unknown> {
  try {
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function readSafeRetryAfterSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function readRetryAfterHeader(value: string | null): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;

  const seconds = Number(trimmed);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function getRetryAfterSeconds(
  response: Pick<Response, "headers">,
  body: unknown
): number | undefined {
  const bodyValue = isRecord(body)
    ? readSafeRetryAfterSeconds(body.retryAfterSeconds)
    : undefined;

  return bodyValue ?? readRetryAfterHeader(response.headers.get("Retry-After"));
}

function hasExactStatus(body: unknown, status: string): boolean {
  return (
    isRecord(body) &&
    Object.keys(body).length === 1 &&
    body.status === status
  );
}

function hasExpectedChangePasswordCode(
  body: unknown
): body is { code: "CURRENT_PASSWORD_INVALID" | "NEW_PASSWORD_INVALID" | "NEW_PASSWORD_MUST_DIFFER" | "CHANGE_PASSWORD_INVALID_REQUEST" } {
  if (!isRecord(body) || typeof body.code !== "string") return false;

  return (
    body.code === "CURRENT_PASSWORD_INVALID" ||
    body.code === "NEW_PASSWORD_INVALID" ||
    body.code === "NEW_PASSWORD_MUST_DIFFER" ||
    body.code === "CHANGE_PASSWORD_INVALID_REQUEST"
  );
}

function createChangePasswordError(
  response: Pick<Response, "status" | "headers">,
  body: unknown,
  messages: AccountSecurityMessages
): AccountSecurityRequestError {
  if (response.status === 401) {
    return new AccountSecurityRequestError(messages.requestFailed, {
      status: 401,
      code: "AUTHENTICATION_REQUIRED"
    });
  }

  if (response.status === 429) {
    return new AccountSecurityRequestError(messages.requestFailed, {
      status: 429,
      code: "CHANGE_PASSWORD_RATE_LIMITED",
      retryAfterSeconds: getRetryAfterSeconds(response, body)
    });
  }

  if (response.status === 400) {
    return new AccountSecurityRequestError(messages.requestFailed, {
      status: 400,
      code: hasExpectedChangePasswordCode(body)
        ? body.code
        : "CHANGE_PASSWORD_INVALID_REQUEST"
    });
  }

  return new AccountSecurityRequestError(messages.requestFailed, {
    status: response.status
  });
}

function createRevokeSessionsError(
  response: Pick<Response, "status" | "headers">,
  body: unknown,
  messages: AccountSecurityMessages
): AccountSecurityRequestError {
  if (response.status === 401) {
    return new AccountSecurityRequestError(messages.requestFailed, {
      status: 401,
      code: "AUTHENTICATION_REQUIRED"
    });
  }

  if (response.status === 429) {
    return new AccountSecurityRequestError(messages.requestFailed, {
      status: 429,
      code: "REVOKE_SESSIONS_RATE_LIMITED",
      retryAfterSeconds: getRetryAfterSeconds(response, body)
    });
  }

  return new AccountSecurityRequestError(messages.requestFailed, {
    status: response.status
  });
}

export async function changeAccountPassword({
  token,
  currentPassword,
  newPassword,
  messages,
  fetchImpl = fetch
}: ChangeAccountPasswordInput): Promise<void> {
  let response: Response;

  try {
    response = await fetchImpl(apiUrl("/auth/change-password"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ currentPassword, newPassword })
    });
  } catch {
    throw new AccountSecurityRequestError(messages.apiUnavailable);
  }

  const body = await readJsonBody(response);

  if (response.status === 200 && hasExactStatus(body, "PASSWORD_CHANGED")) {
    return;
  }

  throw createChangePasswordError(response, body, messages);
}

export async function revokeAccountSessions({
  token,
  messages,
  fetchImpl = fetch
}: RevokeAccountSessionsInput): Promise<void> {
  let response: Response;

  try {
    response = await fetchImpl(apiUrl("/auth/revoke-sessions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store",
      referrerPolicy: "no-referrer"
    });
  } catch {
    throw new AccountSecurityRequestError(messages.apiUnavailable);
  }

  const body = await readJsonBody(response);

  if (response.status === 200 && hasExactStatus(body, "SESSIONS_REVOKED")) {
    return;
  }

  throw createRevokeSessionsError(response, body, messages);
}
