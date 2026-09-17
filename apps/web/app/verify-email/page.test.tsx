// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "../../lib/site-config";
import VerifyEmailPage from "./page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

vi.mock("../../lib/i18n/use-i18n", () => ({
  useI18n: () => ({
    locale: "en-US",
    setLocale: vi.fn(),
    t: (key: string) => {
      const translations: Record<string, string> = {
        "login.emailVerification.verifyLoading": "Verifying your email...",
        "login.emailVerification.verified": "Your email has been verified.",
        "login.emailVerification.alreadyVerified": "This email has already been verified.",
        "login.emailVerification.invalidOrExpired": "This verification link is invalid or expired.",
        "login.emailVerification.retryableFailure":
          "We could not verify your email right now. Please try again.",
        "login.emailVerification.retryVerification": "Retry verification",
        "login.emailVerification.manualLogin": "Go to login"
      };
      return translations[key] ?? key;
    }
  })
}));

const testToken = "fixed-test-verification-token";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

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
  const page = <VerifyEmailPage />;
  await act(async () => {
    root?.render(strict ? <React.StrictMode>{page}</React.StrictMode> : page);
  });
}

async function rerender(): Promise<void> {
  await act(async () => {
    root?.render(<VerifyEmailPage />);
  });
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

function requestOptions(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): RequestInit {
  const options = fetchMock.mock.calls[0]?.[1];
  if (!options) throw new Error("TEST_VERIFY_EMAIL_FETCH_OPTIONS_MISSING");
  return options;
}

function requestBody(options: RequestInit): Record<string, unknown> {
  if (typeof options.body !== "string") {
    throw new Error("TEST_VERIFY_EMAIL_REQUEST_BODY_MISSING");
  }

  const parsed: unknown = JSON.parse(options.body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("TEST_VERIFY_EMAIL_REQUEST_BODY_INVALID");
  }

  return Object.fromEntries(Object.entries(parsed));
}

function retryButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.includes("Retry verification")
  );
  if (!button) throw new Error("TEST_VERIFY_EMAIL_RETRY_BUTTON_MISSING");
  return button;
}

async function unmount(): Promise<void> {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  host = null;
  root = null;
}

afterEach(async () => {
  await unmount();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/verify-email");
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VerifyEmailPage", () => {
  it("cleans the token before one secure POST while preserving safe URL state", async () => {
    const historyState = { source: "verification-email" };
    setPageUrl(`/verify-email?token=${testToken}&safe=continue#section`, historyState);
    const replaceState = vi.spyOn(window.history, "replaceState");
    let locationAtFetch = "";
    const fetchMock = vi.fn<typeof fetch>(async () => {
      locationAtFetch = window.location.href;
      return jsonResponse({ status: "VERIFIED" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(locationAtFetch).not.toContain("token=");
    expect(window.location.search).toBe("?safe=continue");
    expect(window.location.hash).toBe("#section");
    expect(replaceState).toHaveBeenCalledWith(
      historyState,
      "",
      "/verify-email?safe=continue#section"
    );

    const options = requestOptions(fetchMock);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(apiUrl("/auth/verify-email"));
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(options.cache).toBe("no-store");
    expect(options.referrerPolicy).toBe("no-referrer");
    const body = requestBody(options);
    expect(Object.keys(body)).toEqual(["token"]);
    expect(body.token).toBe(testToken);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);

    expect(document.body.textContent).toContain("Your email has been verified.");
    expect(document.body.textContent).not.toContain(testToken);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.pathname).toBe("/verify-email");
    expect(document.querySelector('a[href="/login"]')?.textContent).toContain("Go to login");
  });

  it("shows the already-verified state with a manual login link", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ status: "ALREADY_VERIFIED" }));
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();

    expect(document.body.textContent).toContain("This email has already been verified.");
    expect(document.querySelector('a[href="/login"]')?.textContent).toContain("Go to login");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows invalid without fetching when the token is missing", async () => {
    setPageUrl("/verify-email?safe=continue");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("This verification link is invalid or expired.");
    expect(window.location.search).toBe("?safe=continue");
  });

  it("cleans an empty token without fetching", async () => {
    setPageUrl("/verify-email?token=&safe=continue");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?safe=continue");
    expect(document.body.textContent).toContain("This verification link is invalid or expired.");
  });

  it("maps HTTP 400 to the safe invalid state without showing the API message", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const apiMessage = "unsafe API response";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ message: apiMessage }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();

    expect(document.body.textContent).toContain("This verification link is invalid or expired.");
    expect(document.body.textContent).not.toContain(apiMessage);
  });

  it("maps a network rejection to a retryable error", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();

    expect(document.body.textContent).toContain(
      "We could not verify your email right now. Please try again."
    );
    expect(retryButton().disabled).toBe(false);
  });

  it("maps HTTP 500 to a retryable error", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ message: "temporary failure" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();

    expect(document.body.textContent).toContain(
      "We could not verify your email right now. Please try again."
    );
  });

  it("maps invalid JSON and an unexpected 200 body to retryable errors", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(new Response("{", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ status: "UNEXPECTED" }));
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();
    expect(document.body.textContent).toContain(
      "We could not verify your email right now. Please try again."
    );

    await act(async () => {
      retryButton().click();
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain(
      "We could not verify your email right now. Please try again."
    );
  });

  it("retries with the retained token after a retryable failure", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(jsonResponse({ status: "VERIFIED" }));
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();
    await act(async () => {
      retryButton().click();
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(requestOptions(fetchMock)).token).toBe(testToken);
    expect(document.body.textContent).toContain("Your email has been verified.");
  });

  it("uses a synchronous request latch to prevent a fast retry double-click", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const retryResponse = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockImplementationOnce(() => retryResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();
    const retry = retryButton();
    await act(async () => {
      retry.click();
      retry.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    retryResponse.resolve(jsonResponse({ status: "VERIFIED" }));
    await flushEffects();
    expect(document.body.textContent).toContain("Your email has been verified.");
  });

  it("posts only once for the initial Strict Mode effect replay", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ status: "VERIFIED" }));
    vi.stubGlobal("fetch", fetchMock);

    await render(true);
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the initial POST on an ordinary rerender", async () => {
    setPageUrl(`/verify-email?token=${testToken}`);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ status: "VERIFIED" }));
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await flushEffects();
    await rerender();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
