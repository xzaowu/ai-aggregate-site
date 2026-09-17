import type { AuthResponse, AuthUser } from "@ai-aggregate/shared";
import { apiUrl } from "../../lib/site-config";

export type AuthMode = "login" | "register";

interface AuthMessages {
  apiUnavailable: string;
  authFailed: string;
  invalidCredentials: string;
  registrationDisabled: string;
}

interface SubmitPasswordAuthInput {
  /** @deprecated Use the built-in apiUrl() helper. Kept for backward compat. */
  apiBaseUrl?: string;
  mode: AuthMode;
  email: string;
  password: string;
  messages: AuthMessages;
  fetchImpl?: typeof fetch;
}

interface ResendEmailVerificationInput {
  email: string;
  messages: Pick<AuthMessages, "apiUnavailable" | "authFailed">;
  fetchImpl?: typeof fetch;
}

interface RequestPasswordResetInput {
  email: string;
  messages: {
    apiUnavailable: string;
    requestFailed: string;
  };
  fetchImpl?: typeof fetch;
}

interface ResetPasswordInput {
  token: string;
  password: string;
  messages: {
    retryableFailure: string;
  };
  fetchImpl?: typeof fetch;
}

interface AuthSubmissionErrorDetails {
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
}

export class AuthSubmissionError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, details: AuthSubmissionErrorDetails = {}) {
    super(message);
    this.name = "AuthSubmissionError";
    this.status = details.status;
    this.code = details.code;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

export type PasswordAuthSubmission =
  | {
      kind: "AUTHENTICATED";
      auth: AuthResponse;
    }
  | {
      kind: "EMAIL_VERIFICATION_PENDING";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.email === "string" &&
    value.email.trim().length > 0 &&
    (value.role === "USER" || value.role === "ADMIN") &&
    typeof value.credits === "number" &&
    Number.isFinite(value.credits)
  );
}

function isAuthResponse(value: unknown): value is AuthResponse {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    value.token.trim().length > 0 &&
    isAuthUser(value.user)
  );
}

function isEmailVerificationPending(value: unknown): boolean {
  return isRecord(value) && value.status === "EMAIL_VERIFICATION_PENDING";
}

function isPasswordResetPending(value: unknown): boolean {
  return isRecord(value) && value.status === "PASSWORD_RESET_PENDING";
}

function isPasswordResetComplete(value: unknown): boolean {
  return isRecord(value) && value.status === "PASSWORD_RESET_COMPLETE";
}

async function readJsonBody(response: Pick<Response, "text">): Promise<unknown> {
  try {
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function readErrorCode(body: unknown): string | undefined {
  return isRecord(body) && typeof body.code === "string" ? body.code : undefined;
}

function parseBodyRetryAfterSeconds(body: unknown): number | undefined {
  if (!isRecord(body) || typeof body.retryAfterSeconds !== "number") {
    return undefined;
  }

  const value = body.retryAfterSeconds;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseRetryAfterHeader(value: string | null): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function getRetryAfterSeconds(response: Pick<Response, "headers">, body: unknown) {
  return (
    parseBodyRetryAfterSeconds(body) ??
    parseRetryAfterHeader(response.headers.get("Retry-After"))
  );
}

function createAuthError(
  response: Pick<Response, "status" | "headers">,
  body: unknown,
  mode: AuthMode,
  messages: AuthMessages
): AuthSubmissionError {
  const code = readErrorCode(body);
  const message =
    response.status === 401
      ? messages.invalidCredentials
      : mode === "register" && response.status === 403
        ? messages.registrationDisabled
        : messages.authFailed;

  return new AuthSubmissionError(message, {
    status: response.status,
    code,
    retryAfterSeconds: getRetryAfterSeconds(response, body)
  });
}

function createResendError(
  response: Pick<Response, "status" | "headers">,
  body: unknown,
  messages: ResendEmailVerificationInput["messages"]
): AuthSubmissionError {
  return new AuthSubmissionError(messages.authFailed, {
    status: response.status,
    code: readErrorCode(body),
    retryAfterSeconds: getRetryAfterSeconds(response, body)
  });
}

export async function submitPasswordAuth({
  apiBaseUrl,
  mode,
  email,
  password,
  messages,
  fetchImpl = fetch
}: SubmitPasswordAuthInput): Promise<PasswordAuthSubmission> {
  const url = apiBaseUrl
    ? `${apiBaseUrl.replace(/\/+$/, "")}/auth/${mode}`
    : apiUrl(`/auth/${mode}`);
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    });
  } catch {
    throw new AuthSubmissionError(messages.apiUnavailable);
  }

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw createAuthError(response, body, mode, messages);
  }

  if (mode === "register") {
    if (response.status === 202 && isEmailVerificationPending(body)) {
      return { kind: "EMAIL_VERIFICATION_PENDING" };
    }
    throw new AuthSubmissionError(messages.authFailed, { status: response.status });
  }

  if (response.status === 200 && isAuthResponse(body)) {
    return { kind: "AUTHENTICATED", auth: body };
  }

  throw new AuthSubmissionError(messages.authFailed, { status: response.status });
}

export async function resendEmailVerification({
  email,
  messages,
  fetchImpl = fetch
}: ResendEmailVerificationInput): Promise<void> {
  let response: Response;

  try {
    response = await fetchImpl(apiUrl("/auth/resend-email-verification"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify({ email })
    });
  } catch {
    throw new AuthSubmissionError(messages.apiUnavailable);
  }

  const body = await readJsonBody(response);

  if (response.status === 202 && isEmailVerificationPending(body)) {
    return;
  }

  if (!response.ok) {
    throw createResendError(response, body, messages);
  }

  throw new AuthSubmissionError(messages.authFailed, { status: response.status });
}

export async function requestPasswordReset({
  email,
  messages,
  fetchImpl = fetch
}: RequestPasswordResetInput): Promise<void> {
  let response: Response;

  try {
    response = await fetchImpl(apiUrl("/auth/request-password-reset"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify({ email })
    });
  } catch {
    throw new AuthSubmissionError(messages.apiUnavailable);
  }

  const body = await readJsonBody(response);

  if (response.status === 202 && isPasswordResetPending(body)) {
    return;
  }

  if (response.status === 429) {
    throw new AuthSubmissionError(messages.requestFailed, {
      status: 429,
      code: "PASSWORD_RESET_RATE_LIMITED",
      retryAfterSeconds: getRetryAfterSeconds(response, body)
    });
  }

  throw new AuthSubmissionError(messages.requestFailed, { status: response.status });
}

export async function resetPassword({
  token,
  password,
  messages,
  fetchImpl = fetch
}: ResetPasswordInput): Promise<void> {
  let response: Response;

  try {
    response = await fetchImpl(apiUrl("/auth/reset-password"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ token, password })
    });
  } catch {
    throw new AuthSubmissionError(messages.retryableFailure);
  }

  const body = await readJsonBody(response);
  const code = readErrorCode(body);

  if (response.status === 200 && isPasswordResetComplete(body)) {
    return;
  }

  if (response.status === 400 && code === "PASSWORD_RESET_TOKEN_INVALID") {
    throw new AuthSubmissionError(messages.retryableFailure, {
      status: 400,
      code: "PASSWORD_RESET_TOKEN_INVALID"
    });
  }

  if (response.status === 429) {
    throw new AuthSubmissionError(messages.retryableFailure, {
      status: 429,
      code: "PASSWORD_RESET_RATE_LIMITED",
      retryAfterSeconds: getRetryAfterSeconds(response, body)
    });
  }

  throw new AuthSubmissionError(messages.retryableFailure, {
    status: response.status
  });
}
