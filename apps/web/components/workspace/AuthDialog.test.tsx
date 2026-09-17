// @vitest-environment jsdom

import type { AuthResponse, AuthUser } from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authTokenKey, authUserKey } from "../auth-state";
import {
  AuthSubmissionError,
  requestPasswordReset,
  resendEmailVerification,
  submitPasswordAuth
} from "../../app/login/login-auth";
import { AuthDialog } from "./AuthDialog";
import {
  isSafeInternalReturnTo,
  useWorkspaceShellContext,
  WorkspaceShellProvider
} from "./workspace-shell-context";

vi.mock("../../app/login/login-auth", async () => {
  const actual = await vi.importActual<typeof import("../../app/login/login-auth")>(
    "../../app/login/login-auth"
  );
  return {
    ...actual,
    submitPasswordAuth: vi.fn(),
    resendEmailVerification: vi.fn(),
    requestPasswordReset: vi.fn()
  };
});

vi.mock("../../lib/i18n/use-i18n", () => ({
  useI18n: () => ({
    locale: "en-US",
    setLocale: vi.fn(),
    t: (key: string, values: Record<string, string | number> = {}) => {
      const translations: Record<string, string> = {
        "login.emailVerification.pendingTitle": "Check your email",
        "login.emailVerification.pendingDescription":
          "If available, follow the verification instructions sent to your email before signing in.",
        "login.emailVerification.resend": "Resend verification email",
        "login.emailVerification.resending": "Resending...",
        "login.emailVerification.resendSuccess":
          "If available, a verification email has been sent.",
        "login.emailVerification.resendFailed":
          "Unable to resend the verification email. Please try again later.",
        "login.emailVerification.resendRateLimited": "Too many resend requests.",
        "login.emailVerification.retryAfterSeconds": "Try again in {seconds} seconds.",
        "login.emailVerification.backToLogin": "Back to login",
        "login.rateLimited": "Too many login attempts. Please try again later.",
        "login.rateLimitedWithSeconds": "Too many login attempts. Please try again in {seconds} seconds.",
        "login.apiUnavailable": "API service unavailable, please try again later",
        "login.passwordReset.forgotPassword": "Forgot password?",
        "login.passwordReset.requestTitle": "Reset your password",
        "login.passwordReset.requestDescription": "Enter your email to request a password reset.",
        "login.passwordReset.emailLabel": "Email",
        "login.passwordReset.emailPlaceholder": "name@example.com",
        "login.passwordReset.requestSubmit": "Send reset email",
        "login.passwordReset.requesting": "Sending...",
        "login.passwordReset.requestPendingTitle": "Check your email",
        "login.passwordReset.requestPendingDescription": "If the account for this email can reset its password, we have sent reset instructions. Check your inbox and spam folder.",
        "login.passwordReset.backToLogin": "Back to login",
        "login.passwordReset.requestInvalidEmail": "Enter a valid email address.",
        "login.passwordReset.requestFailed": "We could not request a password reset right now. Please try again later.",
        "login.passwordReset.requestRateLimited": "Too many password reset requests.",
        "login.passwordReset.retryAfterSeconds": "Try again in {seconds} seconds."
      };
      const template = translations[key] ?? key;
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
        const value = values[name];
        return value === undefined ? match : String(value);
      });
    }
  })
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })
}));

vi.mock("./BillingDialog", () => ({
  BillingDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen
      ? React.createElement("div", { role: "dialog", "data-billing-dialog": "true" }, "billing.dialogTitle")
      : null
}));

const mockedSubmitPasswordAuth = vi.mocked(submitPasswordAuth);
const mockedResendEmailVerification = vi.mocked(resendEmailVerification);
const mockedRequestPasswordReset = vi.mocked(requestPasswordReset);
const user: AuthUser = {
  id: "user-1",
  email: "mock@example.com",
  role: "USER",
  credits: 88
};
const authResponse: AuthResponse = { token: "mock-token", user };
const authenticatedSubmission = { kind: "AUTHENTICATED" as const, auth: authResponse };
const pendingSubmission = { kind: "EMAIL_VERIFICATION_PENDING" as const };

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(element);
  });
}

async function rerender(element: React.ReactNode) {
  await act(async () => {
    root?.render(element);
  });
}

function getAuthInputs(): [HTMLInputElement, HTMLInputElement] {
  const inputs = document.querySelectorAll<HTMLInputElement>("input");
  const email = inputs[0];
  const password = inputs[1];
  if (!email || !password) throw new Error("TEST_AUTH_INPUTS_MISSING");
  return [email, password];
}

async function fillAuthForm(email: string, password: string) {
  const [emailInput, passwordInput] = getAuthInputs();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(emailInput, email);
    emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    emailInput.dispatchEvent(new Event("change", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(passwordInput, password);
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    passwordInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitAuthForm() {
  await act(async () => {
    document.querySelector<HTMLFormElement>("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
}

function forgotPasswordButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>("[data-forgot-password=\"true\"]");
  if (!button) throw new Error("TEST_FORGOT_PASSWORD_BUTTON_MISSING");
  return button;
}

function passwordResetRequestButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>("[data-request-password-reset=\"true\"]");
  if (!button) throw new Error("TEST_PASSWORD_RESET_REQUEST_BUTTON_MISSING");
  return button;
}

async function openForgotPassword() {
  await act(async () => {
    forgotPasswordButton().click();
  });
}

async function fillPasswordResetEmail(email: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="email"]');
  if (!input) throw new Error("TEST_PASSWORD_RESET_EMAIL_INPUT_MISSING");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitPasswordResetRequest() {
  await act(async () => {
    document.querySelector<HTMLFormElement>("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
}

async function renderPendingFromRegistration(onAuthSuccess = vi.fn()) {
  mockedSubmitPasswordAuth.mockResolvedValue(pendingSubmission);
  await render(
    <AuthDialog
      isOpen
      mode="register"
      onClose={vi.fn()}
      onAuthSuccess={onAuthSuccess}
    />
  );
  await fillAuthForm("pending@example.com", "password123");
  await submitAuthForm();
  return onAuthSuccess;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  mockedSubmitPasswordAuth.mockReset();
  mockedResendEmailVerification.mockReset();
  mockedRequestPasswordReset.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AuthDialog", () => {
  it("opens, switches between login/register, and closes via X, Escape, or backdrop", async () => {
    const onClose = vi.fn();
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={onClose}
        onAuthSuccess={vi.fn()}
      />
    );

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
        .find((button) => button.textContent?.includes("No account"))
        ?.click();
    });
    expect(document.body.textContent).toContain("Already have an account? Log in");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await rerender(
      <AuthDialog
        isOpen
        mode="login"
        onClose={onClose}
        onAuthSuccess={vi.fn()}
      />
    );
    const backdrop = document.querySelector<HTMLElement>('[role="dialog"]')?.parentElement;
    expect(backdrop).not.toBeNull();
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps normal login success storage, token/user, and callback behavior", async () => {
    mockedSubmitPasswordAuth.mockResolvedValue(authenticatedSubmission);
    const onAuthSuccess = vi.fn();
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={onAuthSuccess}
      />
    );

    await fillAuthForm("mock@example.com", "password123");
    await submitAuthForm();

    expect(mockedSubmitPasswordAuth).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "login", email: "mock@example.com" })
    );
    expect(window.localStorage.getItem(authTokenKey)).toBe("mock-token");
    expect(JSON.parse(window.localStorage.getItem(authUserKey) ?? "null")).toEqual(user);
    expect(onAuthSuccess).toHaveBeenCalledTimes(1);
    expect(onAuthSuccess).toHaveBeenCalledWith("mock-token", user);
  });

  it("enters pending after register without auth storage, callback, or navigation", async () => {
    window.history.replaceState(null, "", "/registration-origin");
    const onAuthSuccess = await renderPendingFromRegistration();

    expect(document.querySelector('[data-email-verification-pending="true"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Check your email");
    expect(document.body.textContent).toContain("Resend verification email");
    expect(document.body.textContent).toContain("Back to login");
    expect(onAuthSuccess).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(authTokenKey)).toBeNull();
    expect(window.localStorage.getItem(authUserKey)).toBeNull();
    expect(window.sessionStorage.getItem(authTokenKey)).toBeNull();
    expect(window.sessionStorage.getItem(authUserKey)).toBeNull();
    expect(location.pathname).toBe("/registration-origin");
  });

  it("enters pending only for the unverified login gate and never auto-resends", async () => {
    mockedSubmitPasswordAuth.mockRejectedValue(
      new AuthSubmissionError("Raw English API message", {
        status: 403,
        code: "EMAIL_VERIFICATION_REQUIRED"
      })
    );
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );

    await fillAuthForm("unverified@example.com", "password123");
    await submitAuthForm();

    expect(document.querySelector('[data-email-verification-pending="true"]')).not.toBeNull();
    expect(mockedResendEmailVerification).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Raw English API message");
  });

  it("keeps ordinary login 401 errors out of the pending view", async () => {
    mockedSubmitPasswordAuth.mockRejectedValue(
      new AuthSubmissionError("Raw English invalid credentials", { status: 401 })
    );
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );

    await fillAuthForm("wrong@example.com", "wrong-password");
    await submitAuthForm();

    expect(document.querySelector('[data-email-verification-pending="true"]')).toBeNull();
    expect(document.body.textContent).toContain("Invalid email or password");
    expect(document.body.textContent).not.toContain("Raw English invalid credentials");
  });

  it("shows login rate limits with safe retry seconds and clears only the password", async () => {
    const rawApiMessage = "Raw login rate-limit message";
    const onAuthSuccess = vi.fn();
    mockedSubmitPasswordAuth.mockRejectedValue(
      new AuthSubmissionError(rawApiMessage, {
        status: 429,
        code: "AUTH_LOGIN_RATE_LIMITED",
        retryAfterSeconds: 12
      })
    );
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={onAuthSuccess}
      />
    );

    await fillAuthForm("limited@example.com", "password123");
    await submitAuthForm();

    expect(document.body.textContent).toContain(
      "Too many login attempts. Please try again in 12 seconds."
    );
    expect(document.body.textContent).not.toContain("Authentication failed, please try again");
    expect(document.body.textContent).not.toContain("Invalid email or password");
    expect(document.body.textContent).not.toContain(rawApiMessage);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(getAuthInputs()[0].value).toBe("limited@example.com");
    expect(getAuthInputs()[1].value).toBe("");
    expect(onAuthSuccess).not.toHaveBeenCalled();
    expect(mockedSubmitPasswordAuth).toHaveBeenCalledTimes(1);
  });

  it("shows the generic login rate-limit message when retry seconds are unavailable", async () => {
    mockedSubmitPasswordAuth.mockRejectedValue(
      new AuthSubmissionError("Raw login rate-limit message", {
        status: 429,
        code: "AUTH_LOGIN_RATE_LIMITED"
      })
    );
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );

    await fillAuthForm("limited@example.com", "password123");
    await submitAuthForm();

    expect(document.body.textContent).toContain(
      "Too many login attempts. Please try again later."
    );
    expect(document.body.textContent).not.toContain("Authentication failed, please try again");
    expect(document.body.textContent).not.toContain("Invalid email or password");
    expect(document.body.textContent).not.toContain("Raw login rate-limit message");
  });

  it("keeps network and server login failures mapped to their safe local messages", async () => {
    mockedSubmitPasswordAuth
      .mockRejectedValueOnce(new AuthSubmissionError("raw network error"))
      .mockRejectedValueOnce(new AuthSubmissionError("raw server error", { status: 503 }));
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );

    await fillAuthForm("person@example.com", "password123");
    await submitAuthForm();
    expect(document.body.textContent).toContain(
      "API service unavailable, please try again later"
    );
    expect(document.body.textContent).not.toContain("raw network error");

    await fillAuthForm("person@example.com", "password123");
    await submitAuthForm();
    expect(document.body.textContent).toContain("Authentication failed, please try again");
    expect(document.body.textContent).not.toContain("raw server error");
    expect(mockedSubmitPasswordAuth).toHaveBeenCalledTimes(2);
  });

  it("resends using only the pending form email and shows a generic success message", async () => {
    await renderPendingFromRegistration();
    mockedResendEmailVerification.mockResolvedValue(undefined);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-resend-email-verification="true"]')?.click();
    });

    expect(mockedResendEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({ email: "pending@example.com" })
    );
    expect(document.body.textContent).toContain(
      "If available, a verification email has been sent."
    );
    expect(document.body.textContent).not.toContain("UNVERIFIED");
  });

  it("shows localized rate-limit guidance and safe retry seconds", async () => {
    await renderPendingFromRegistration();
    mockedResendEmailVerification.mockRejectedValue(
      new AuthSubmissionError("Too many verification email requests.", {
        status: 429,
        code: "EMAIL_VERIFICATION_RESEND_RATE_LIMITED",
        retryAfterSeconds: 12
      })
    );

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-resend-email-verification="true"]')?.click();
    });

    expect(document.body.textContent).toContain("Too many resend requests. Try again in 12 seconds.");
    expect(document.body.textContent).not.toContain("Too many verification email requests.");
  });

  it("shows a localized resend error for network failures", async () => {
    await renderPendingFromRegistration();
    mockedResendEmailVerification.mockRejectedValue(
      new AuthSubmissionError("Raw network error")
    );

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-resend-email-verification="true"]')?.click();
    });

    expect(document.body.textContent).toContain(
      "Unable to resend the verification email. Please try again later."
    );
    expect(document.body.textContent).not.toContain("Raw network error");
  });

  it("disables resend and uses a synchronous latch to block fast double-clicks", async () => {
    await renderPendingFromRegistration();
    let resolveResend: (() => void) | undefined;
    mockedResendEmailVerification.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveResend = resolve;
      })
    );
    const resendButton = document.querySelector<HTMLButtonElement>(
      '[data-resend-email-verification="true"]'
    );
    if (!resendButton) throw new Error("TEST_RESEND_BUTTON_MISSING");

    await act(async () => {
      resendButton.click();
      resendButton.click();
    });

    expect(mockedResendEmailVerification).toHaveBeenCalledTimes(1);
    expect(resendButton.disabled).toBe(true);
    expect(resendButton.textContent).toContain("Resending...");

    await act(async () => {
      resolveResend?.();
    });
    expect(resendButton.disabled).toBe(false);
  });

  it("clears pending and resend state when returning to login or closing", async () => {
    const onClose = vi.fn();
    const onAuthSuccess = vi.fn();
    mockedSubmitPasswordAuth
      .mockResolvedValueOnce(pendingSubmission)
      .mockResolvedValueOnce(pendingSubmission)
      .mockResolvedValueOnce(pendingSubmission);
    await render(
      <AuthDialog
        isOpen
        mode="register"
        onClose={onClose}
        onAuthSuccess={onAuthSuccess}
      />
    );
    await fillAuthForm("pending@example.com", "password123");
    await submitAuthForm();
    mockedResendEmailVerification.mockResolvedValue(undefined);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-resend-email-verification="true"]')?.click();
    });
    expect(document.body.textContent).toContain(
      "If available, a verification email has been sent."
    );

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-return-to-login="true"]')?.click();
    });
    expect(document.querySelector('[data-email-verification-pending="true"]')).toBeNull();
    expect(document.body.textContent).not.toContain(
      "If available, a verification email has been sent."
    );

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
        .find((button) => button.textContent?.includes("No account"))
        ?.click();
    });
    await fillAuthForm("pending@example.com", "password123");
    await submitAuthForm();
    expect(document.querySelector('[data-email-verification-pending="true"]')).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-email-verification-pending="true"]')).toBeNull();

    await rerender(
      <AuthDialog
        isOpen={false}
        mode="login"
        onClose={onClose}
        onAuthSuccess={onAuthSuccess}
      />
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await rerender(
      <AuthDialog
        isOpen
        mode="login"
        onClose={onClose}
        onAuthSuccess={onAuthSuccess}
      />
    );
    expect(document.querySelector('[data-email-verification-pending="true"]')).toBeNull();
    expect(document.body.textContent).not.toContain(
      "If available, a verification email has been sent."
    );

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
        .find((button) => button.textContent?.includes("No account"))
        ?.click();
    });
    await fillAuthForm("reopened@example.com", "password123");
    await submitAuthForm();

    expect(document.querySelector('[data-email-verification-pending="true"]')).not.toBeNull();
    expect(mockedSubmitPasswordAuth).toHaveBeenCalledTimes(3);
    expect(onAuthSuccess).not.toHaveBeenCalled();
  });

  it("does not display authentication tokens, verification URLs, or raw account state in pending", async () => {
    mockedSubmitPasswordAuth.mockRejectedValue(
      new AuthSubmissionError("token=raw-token https://example.test/verify-email?token=raw", {
        status: 403,
        code: "EMAIL_VERIFICATION_REQUIRED"
      })
    );
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );
    await fillAuthForm("safe@example.com", "password123");
    await submitAuthForm();

    expect(document.body.textContent).not.toContain("raw-token");
    expect(document.body.textContent).not.toContain("verify-email");
    expect(document.body.textContent).not.toContain("EMAIL_VERIFICATION_REQUIRED");
    expect(document.body.textContent).not.toContain("safe@example.com");
  });

  it("shows login submit button and the registration-closed notice when registrationEnabled is false", async () => {
    await render(
      <AuthDialog
        isOpen
        mode="login"
        registrationEnabled={false}
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );

    expect(document.body.textContent).toContain(
      "New user registration is currently unavailable. Existing users can still sign in."
    );

    const submitButton = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submitButton).not.toBeNull();
    expect(submitButton?.disabled).toBe(false);
    expect(submitButton?.textContent).toContain("Confirm login");

    const switchButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[type="button"]')
    ).find((button) => button.textContent?.includes("No account"));
    expect(switchButton).not.toBeUndefined();
    expect(switchButton?.disabled).toBe(true);
  });

  it("submits login successfully when registrationEnabled is false", async () => {
    mockedSubmitPasswordAuth.mockResolvedValue(authenticatedSubmission);
    const onAuthSuccess = vi.fn();
    await render(
      <AuthDialog
        isOpen
        mode="login"
        registrationEnabled={false}
        onClose={vi.fn()}
        onAuthSuccess={onAuthSuccess}
      />
    );

    await fillAuthForm("mock@example.com", "password123");
    await submitAuthForm();

    expect(mockedSubmitPasswordAuth).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "login", email: "mock@example.com" })
    );
    expect(window.localStorage.getItem(authTokenKey)).toBe("mock-token");
    expect(JSON.parse(window.localStorage.getItem(authUserKey) ?? "null")).toEqual(user);
    expect(onAuthSuccess).toHaveBeenCalledWith("mock-token", user);
  });

  it("shows the forgot-password entry only in login mode", async () => {
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );

    expect(document.querySelector('[data-forgot-password="true"]')).not.toBeNull();
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
        .find((button) => button.textContent?.includes("No account"))
        ?.click();
    });
    expect(document.querySelector('[data-forgot-password="true"]')).toBeNull();
  });

  it("carries the login email into forgot password and clears the password", async () => {
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );
    await fillAuthForm("person@example.com", "password123");
    await openForgotPassword();

    const resetEmail = document.querySelector<HTMLInputElement>('input[type="email"]');
    expect(resetEmail?.value).toBe("person@example.com");
    expect(document.querySelector('input[type="password"]')).toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-password-reset-back-to-login="true"]')?.click();
    });
    const [emailInput, passwordInput] = getAuthInputs();
    expect(emailInput.value).toBe("person@example.com");
    expect(passwordInput.value).toBe("");
  });

  it("validates the request email locally and keeps password-reset success generic", async () => {
    const onAuthSuccess = vi.fn();
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={onAuthSuccess}
      />
    );
    await openForgotPassword();
    await fillPasswordResetEmail("not-an-email");
    await submitPasswordResetRequest();
    expect(mockedRequestPasswordReset).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter a valid email address.");

    mockedRequestPasswordReset.mockResolvedValue(undefined);
    await fillPasswordResetEmail("person@example.com");
    await submitPasswordResetRequest();

    expect(mockedRequestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ email: "person@example.com" })
    );
    expect(document.querySelector('[data-password-reset-requested="true"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      "If the account for this email can reset its password, we have sent reset instructions. Check your inbox and spam folder."
    );
    expect(document.body.textContent).not.toContain("person@example.com");
    expect(onAuthSuccess).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(authTokenKey)).toBeNull();
    expect(window.localStorage.getItem(authUserKey)).toBeNull();
  });

  it("uses a synchronous latch for fast password-reset request double-clicks", async () => {
    let resolveRequest: (() => void) | undefined;
    mockedRequestPasswordReset.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveRequest = resolve;
      })
    );
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );
    await openForgotPassword();
    await fillPasswordResetEmail("person@example.com");
    const submit = passwordResetRequestButton();

    await act(async () => {
      submit.click();
      submit.click();
    });

    expect(mockedRequestPasswordReset).toHaveBeenCalledTimes(1);
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain("Sending...");

    await act(async () => {
      resolveRequest?.();
    });
    expect(document.querySelector('[data-password-reset-requested="true"]')).not.toBeNull();
  });

  it("maps password-reset rate limits without displaying API messages", async () => {
    const rawApiMessage = "raw password reset rate limit message";
    mockedRequestPasswordReset.mockRejectedValue(
      new AuthSubmissionError(rawApiMessage, {
        status: 429,
        code: "PASSWORD_RESET_RATE_LIMITED",
        retryAfterSeconds: 12
      })
    );
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );
    await openForgotPassword();
    await fillPasswordResetEmail("person@example.com");
    await submitPasswordResetRequest();

    expect(document.body.textContent).toContain(
      "Too many password reset requests. Try again in 12 seconds."
    );
    expect(document.body.textContent).not.toContain(rawApiMessage);
  });

  it("shows a static request failure for network and server errors", async () => {
    const rawApiMessage = "raw reset request server message";
    mockedRequestPasswordReset.mockRejectedValue(
      new AuthSubmissionError(rawApiMessage, { status: 503 })
    );
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );
    await openForgotPassword();
    await fillPasswordResetEmail("person@example.com");
    await submitPasswordResetRequest();

    expect(document.body.textContent).toContain(
      "We could not request a password reset right now. Please try again later."
    );
    expect(document.body.textContent).not.toContain(rawApiMessage);
  });

  it("clears password-reset state on close and on a login/register switch", async () => {
    const onClose = vi.fn();
    mockedRequestPasswordReset.mockResolvedValue(undefined);
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={onClose}
        onAuthSuccess={vi.fn()}
      />
    );
    await openForgotPassword();
    await fillPasswordResetEmail("person@example.com");
    await submitPasswordResetRequest();
    expect(document.querySelector('[data-password-reset-requested="true"]')).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-password-reset-requested="true"]')).toBeNull();
    expect(document.querySelector('[data-forgot-password="true"]')).not.toBeNull();

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
        .find((button) => button.textContent?.includes("No account"))
        ?.click();
    });
    expect(document.body.textContent).not.toContain(
      "If the account for this email can reset its password, we have sent reset instructions. Check your inbox and spam folder."
    );
    expect(document.querySelector('[data-forgot-password="true"]')).toBeNull();
  });

  it("uses the same forgot-password flow in the mobile dialog branch", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
    mockedRequestPasswordReset.mockResolvedValue(undefined);
    await render(
      <AuthDialog
        isOpen
        mode="login"
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    );
    await openForgotPassword();
    await fillPasswordResetEmail("person@example.com");
    await submitPasswordResetRequest();

    expect(document.querySelector('[data-password-reset-requested="true"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.className).toContain("rounded-t-2xl");
  });
});

describe("WorkspaceShellProvider auth flow", () => {
  it("keeps the current /help path and refreshes quota once after login", async () => {
    window.history.replaceState(null, "", "/help");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const body = path.endsWith("/settings/public")
        ? {
            settings: {
              registrationEnabled: true,
              registrationClosedMessageZh: "当前暂未开放新用户注册，已有账号可正常登录。",
              registrationClosedMessageEn:
                "New user registration is currently unavailable. Existing users can still sign in."
            }
          }
        : { remainingCredits: 88, planName: "Mock Pro" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    function Probe() {
      const { shell, openAuthDialog } = useWorkspaceShellContext();
      return (
        <>
          <output data-token={shell.token ?? ""} data-email={shell.user?.email ?? ""} />
          <button type="button" onClick={() => openAuthDialog()}>Open auth</button>
        </>
      );
    }

    await render(<WorkspaceShellProvider><Probe /></WorkspaceShellProvider>);
    await act(async () => document.querySelector<HTMLButtonElement>("button")?.click());
    mockedSubmitPasswordAuth.mockResolvedValue(authenticatedSubmission);
    await fillAuthForm("mock@example.com", "password123");
    await submitAuthForm();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(location.pathname).toBe("/help");
    expect(document.querySelector("output")?.getAttribute("data-token")).toBe("mock-token");
    expect(document.querySelector("output")?.getAttribute("data-email")).toBe("mock@example.com");
    const requestedPaths = fetchMock.mock.calls.map(([input]) =>
      new URL(String(input), "http://localhost").pathname
    );
    expect(requestedPaths.filter((path) => path.endsWith("/quota/me"))).toHaveLength(1);
    expect(requestedPaths.filter((path) => path.endsWith("/settings/public"))).toHaveLength(1);
  });

  it("opens exactly one BillingDialog after billing intent login", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const body = path.endsWith("/quota/me")
        ? { remainingCredits: 88, planName: "Mock Pro" }
        : path.endsWith("/plans")
          ? { plans: [] }
          : path.endsWith("/orders/me")
            ? { orders: [] }
            : { enabled: false, paymentMethods: ["alipay"] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    function Probe() {
      const { openBillingDialog } = useWorkspaceShellContext();
      return <button type="button" data-open-billing onClick={openBillingDialog}>Open billing</button>;
    }

    await render(<WorkspaceShellProvider><Probe /></WorkspaceShellProvider>);
    await act(async () => document.querySelector<HTMLButtonElement>("[data-open-billing]")?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    mockedSubmitPasswordAuth.mockResolvedValue(authenticatedSubmission);
    await fillAuthForm("mock@example.com", "password123");
    await submitAuthForm();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(document.querySelectorAll('[data-billing-dialog="true"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("billing.dialogTitle");
  });

  it.each([
    ["/help", true],
    ["//evil.com", false],
    ["http://evil.com", false],
    ["https://evil.com", false],
    ["javascript:alert(1)", false],
    ["/%5C%5Cevil.com", false],
    ["/%2525255C%2525255Cevil.com", false]
  ])("validates returnTo %s as %s", (value, expected) => {
    expect(isSafeInternalReturnTo(value)).toBe(expected);
  });
});
