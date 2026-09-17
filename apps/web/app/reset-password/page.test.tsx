// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "../../lib/site-config";
import ResetPasswordPage from "./page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

vi.mock("../../lib/i18n/use-i18n", () => ({
  useI18n: () => ({
    locale: "en-US",
    setLocale: vi.fn(),
    t: (key: string, values: Record<string, string | number> = {}) => {
      const translations: Record<string, string> = {
        "login.passwordReset.pageTitle": "Set a new password",
        "login.passwordReset.pageDescription": "Enter and confirm your new password.",
        "login.passwordReset.newPassword": "New password",
        "login.passwordReset.confirmPassword": "Confirm new password",
        "login.passwordReset.submit": "Reset password",
        "login.passwordReset.submitting": "Resetting...",
        "login.passwordReset.passwordRequired": "Enter and confirm your new password.",
        "login.passwordReset.passwordsDoNotMatch": "Passwords do not match.",
        "login.passwordReset.passwordTooShort": "Password must be at least 8 characters.",
        "login.passwordReset.passwordTooLong": "Password must be 72 UTF-8 bytes or fewer.",
        "login.passwordReset.complete": "Your password has been reset. You can now log in.",
        "login.passwordReset.invalidOrExpired": "This password reset link is invalid or expired.",
        "login.passwordReset.retryableFailure": "We could not reset your password right now. Please try again.",
        "login.passwordReset.rateLimited": "Too many password reset attempts.",
        "login.passwordReset.retryAfterSeconds": "Try again in {seconds} seconds.",
        "login.passwordReset.manualLogin": "Go to login"
      };
      const template = translations[key] ?? key;
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
        const value = values[name];
        return value === undefined ? match : String(value);
      });
    }
  })
}));

const resetTokenCanary = "reset-token-canary-not-for-dom";
const passwordCanary = "password-canary-123";

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let renderWithStrictMode = false;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function setPageUrl(path: string, state: unknown = null) {
  window.history.replaceState(state, "", path);
}

async function render(strict = false): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  renderWithStrictMode = strict;
  await act(async () => {
    root?.render(
      renderWithStrictMode ? (
        <React.StrictMode><ResetPasswordPage /></React.StrictMode>
      ) : (
        <ResetPasswordPage />
      )
    );
  });
}

async function rerender(): Promise<void> {
  await act(async () => {
    root?.render(
      renderWithStrictMode ? (
        <React.StrictMode><ResetPasswordPage /></React.StrictMode>
      ) : (
        <ResetPasswordPage />
      )
    );
  });
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

function passwordInputs(): [HTMLInputElement, HTMLInputElement] {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  const password = inputs[0];
  const confirmation = inputs[1];
  if (!password || !confirmation) throw new Error("TEST_PASSWORD_INPUTS_MISSING");
  return [password, confirmation];
}

async function fillPasswordForm(password: string, confirmation = password) {
  const [passwordInput, confirmationInput] = passwordInputs();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      passwordInput,
      password
    );
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    passwordInput.dispatchEvent(new Event("change", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      confirmationInput,
      confirmation
    );
    confirmationInput.dispatchEvent(new Event("input", { bubbles: true }));
    confirmationInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitResetForm() {
  await act(async () => {
    document.querySelector<HTMLFormElement>("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
}

function requestOptions(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): RequestInit {
  const options = fetchMock.mock.calls[0]?.[1];
  if (!options) throw new Error("TEST_RESET_PASSWORD_FETCH_OPTIONS_MISSING");
  return options;
}

function requestBody(options: RequestInit): Record<string, unknown> {
  if (typeof options.body !== "string") {
    throw new Error("TEST_RESET_PASSWORD_REQUEST_BODY_MISSING");
  }

  const parsed: unknown = JSON.parse(options.body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("TEST_RESET_PASSWORD_REQUEST_BODY_INVALID");
  }

  return Object.fromEntries(Object.entries(parsed));
}

async function unmount(): Promise<void> {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  host = null;
  root = null;
  renderWithStrictMode = false;
}

afterEach(async () => {
  await unmount();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/reset-password");
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ResetPasswordPage", () => {
  it("cleans the query token before user submission while preserving safe URL state", async () => {
    const historyState = { source: "password-reset" };
    setPageUrl(`/reset-password?token=${resetTokenCanary}&safe=continue#section`, historyState);
    const replaceState = vi.spyOn(window.history, "replaceState");
    let locationAtFetch = "";
    const fetchMock = vi.fn<typeof fetch>(async () => {
      locationAtFetch = window.location.href;
      return jsonResponse({ status: "PASSWORD_RESET_COMPLETE" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await render(true);
    await flushEffects();
    await rerender();
    await flushEffects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?safe=continue");
    expect(window.location.hash).toBe("#section");
    expect(replaceState).toHaveBeenCalledWith(
      historyState,
      "",
      "/reset-password?safe=continue#section"
    );
    expect(document.body.textContent).not.toContain(resetTokenCanary);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    await fillPasswordForm(passwordCanary);
    await submitResetForm();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(locationAtFetch).not.toContain("token=");
  });

  it("shows invalid and makes no request when token is missing or empty", async () => {
    setPageUrl("/reset-password?safe=continue");
    const missingFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", missingFetch);
    await render();
    await flushEffects();

    expect(missingFetch).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("This password reset link is invalid or expired.");

    await unmount();
    setPageUrl("/reset-password?token=&safe=continue");
    const emptyFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", emptyFetch);
    await render();
    await flushEffects();

    expect(emptyFetch).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?safe=continue");
    expect(document.body.textContent).toContain("This password reset link is invalid or expired.");
  });

  it("renders two password inputs and performs local password validation without requests", async () => {
    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await flushEffects();

    const [passwordInput, confirmationInput] = passwordInputs();
    expect(passwordInput.type).toBe("password");
    expect(confirmationInput.type).toBe("password");
    expect(passwordInput.autocomplete).toBe("new-password");
    expect(confirmationInput.autocomplete).toBe("new-password");

    await submitResetForm();
    expect(document.body.textContent).toContain("Enter and confirm your new password.");
    await fillPasswordForm("password123", "different123");
    await submitResetForm();
    expect(document.body.textContent).toContain("Passwords do not match.");
    await fillPasswordForm("😀😀😀😀😀😀😀");
    await submitResetForm();
    expect(document.body.textContent).toContain("Password must be at least 8 characters.");
    await fillPasswordForm("😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀");
    await submitResetForm();
    expect(document.body.textContent).toContain("Password must be 72 UTF-8 bytes or fewer.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits a valid Unicode boundary password with the secure request contract", async () => {
    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "PASSWORD_RESET_COMPLETE", token: "unexpected-token", user: {} })
    );
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await flushEffects();

    await fillPasswordForm("😀😀😀😀😀😀😀😀");
    await submitResetForm();
    await flushEffects();

    const options = requestOptions(fetchMock);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(apiUrl("/auth/reset-password"));
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(options.cache).toBe("no-store");
    expect(options.referrerPolicy).toBe("no-referrer");
    const body = requestBody(options);
    expect(Object.keys(body)).toEqual(["token", "password"]);
    expect(typeof body.token).toBe("string");
    expect(typeof body.password).toBe("string");
    expect(document.body.textContent).toContain("Your password has been reset. You can now log in.");
    expect(document.body.textContent).not.toContain(resetTokenCanary);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.querySelector('a[href="/login"]')?.textContent).toContain("Go to login");
  });

  it("allows a password at the 72 UTF-8 byte limit", async () => {
    const password72Bytes = "😀".repeat(18);
    expect(Array.from(password72Bytes)).toHaveLength(18);
    expect(new TextEncoder().encode(password72Bytes)).toHaveLength(72);

    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "PASSWORD_RESET_COMPLETE" })
    );
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await flushEffects();
    await fillPasswordForm(password72Bytes);
    await submitResetForm();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = requestBody(requestOptions(fetchMock));
    expect(Object.keys(body)).toEqual(["token", "password"]);
    expect(body.password).toBe(password72Bytes);
    expect(document.body.textContent).toContain("Your password has been reset. You can now log in.");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("rejects a password at 73 UTF-8 bytes before any request", async () => {
    const password73Bytes = `${"😀".repeat(18)}a`;
    expect(Array.from(password73Bytes)).toHaveLength(19);
    expect(new TextEncoder().encode(password73Bytes)).toHaveLength(73);

    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await flushEffects();
    await fillPasswordForm(password73Bytes);
    await submitResetForm();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Password must be 72 UTF-8 bytes or fewer.");
    expect(document.body.textContent).not.toContain(password73Bytes);
    expect(document.querySelector("form")).not.toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("uses a synchronous submit latch for fast double-clicks", async () => {
    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const response = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => response.promise);
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await flushEffects();
    await fillPasswordForm(passwordCanary);

    const form = document.querySelector<HTMLFormElement>("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    response.resolve(jsonResponse({ status: "PASSWORD_RESET_COMPLETE" }));
    await flushEffects();
    expect(document.body.textContent).toContain("Your password has been reset. You can now log in.");
  });

  it("clears passwords and prevents another submission after success", async () => {
    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "PASSWORD_RESET_COMPLETE" })
    );
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await flushEffects();
    await fillPasswordForm(passwordCanary);
    await submitResetForm();
    await flushEffects();

    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    await rerender();
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("maps invalid tokens to the unified invalid state without exposing API text", async () => {
    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const rawApiMessage = "raw password reset invalid token message";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: "PASSWORD_RESET_TOKEN_INVALID", message: rawApiMessage }, 400)
    );
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await flushEffects();
    await fillPasswordForm(passwordCanary);
    await submitResetForm();
    await flushEffects();

    expect(document.body.textContent).toContain("This password reset link is invalid or expired.");
    expect(document.body.textContent).not.toContain(rawApiMessage);
    expect(document.querySelector("form")).toBeNull();
    await rerender();
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps rate limits safely and retains the token for a later retry", async () => {
    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const rawApiMessage = "raw password reset rate limit message";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "PASSWORD_RESET_RATE_LIMITED",
            message: rawApiMessage,
            retryAfterSeconds: 12
          },
          429
        )
      )
      .mockResolvedValueOnce(jsonResponse({ status: "PASSWORD_RESET_COMPLETE" }));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await flushEffects();
    await fillPasswordForm(passwordCanary);
    await submitResetForm();
    await flushEffects();

    expect(document.body.textContent).toContain(
      "Too many password reset attempts. Try again in 12 seconds."
    );
    expect(document.body.textContent).not.toContain(rawApiMessage);
    expect(passwordInputs()[0].value).toBe("");

    await fillPasswordForm(passwordCanary);
    await submitResetForm();
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Your password has been reset. You can now log in.");
  });

  it("keeps retryable failures static and allows a later re-entry retry", async () => {
    setPageUrl(`/reset-password?token=${resetTokenCanary}`);
    const rawApiMessage = "raw password reset server message";
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(jsonResponse({ message: rawApiMessage }, 500))
      .mockResolvedValueOnce(new Response("{", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ status: "PASSWORD_RESET_COMPLETE" }));
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await render();
    await flushEffects();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await fillPasswordForm(passwordCanary);
      await submitResetForm();
      await flushEffects();
      expect(document.body.textContent).toContain(
        "We could not reset your password right now. Please try again."
      );
      expect(document.body.textContent).not.toContain(rawApiMessage);
      expect(document.body.textContent).not.toContain(resetTokenCanary);
      expect(document.body.textContent).not.toContain(passwordCanary);
    }

    await fillPasswordForm(passwordCanary);
    await submitResetForm();
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(consoleError).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
