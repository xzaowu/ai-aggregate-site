// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "../../lib/site-config";
import {
  AccountSecurityRequestError,
  changeAccountPassword,
  revokeAccountSessions
} from "./account-security";

const messages = {
  requestFailed: "REQUEST_FAILED",
  apiUnavailable: "API_UNAVAILABLE"
};

const tokenCanary = "token-canary-not-for-error";
const passwordCanary = "password-canary-not-for-error";
const rawApiMessage = "raw-api-message-not-for-ui";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function requestOptions(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): RequestInit {
  const options = fetchMock.mock.calls[0]?.[1];
  if (!options) throw new Error("ACCOUNT_SECURITY_REQUEST_OPTIONS_MISSING");
  return options;
}

async function expectRequestError(action: () => Promise<void>): Promise<AccountSecurityRequestError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AccountSecurityRequestError) return error;
    throw error;
  }

  throw new Error("ACCOUNT_SECURITY_REQUEST_ERROR_EXPECTED");
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("changeAccountPassword", () => {
  it("uses the exact secure password-change request contract", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "PASSWORD_CHANGED" })
    );

    await changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: fetchMock
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(apiUrl("/auth/change-password"));
    const options = requestOptions(fetchMock);
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({
      Authorization: `Bearer ${tokenCanary}`,
      "Content-Type": "application/json"
    });
    expect(options.cache).toBe("no-store");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(typeof options.body).toBe("string");
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["currentPassword", "newPassword"]);
    expect(body.currentPassword === passwordCanary).toBe(true);
    expect(body.newPassword === "new-password").toBe(true);
  });

  it("strictly accepts only the expected 200 response", async () => {
    const invalidFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "PASSWORD_CHANGED", token: "unexpected" })
    );
    const error = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: invalidFetch
    }));

    expect(error.status).toBe(200);
    expect(error.message).toBe(messages.requestFailed);
  });

  it.each([
    "CURRENT_PASSWORD_INVALID",
    "NEW_PASSWORD_INVALID",
    "NEW_PASSWORD_MUST_DIFFER",
    "CHANGE_PASSWORD_INVALID_REQUEST"
  ] as const)("safely maps 400 %s", async (code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code, message: rawApiMessage }, 400)
    );
    const error = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: fetchMock
    }));

    expect(error.status).toBe(400);
    expect(error.code).toBe(code);
    expect(error.message).toBe(messages.requestFailed);
    expect(error.message.includes(rawApiMessage)).toBe(false);
    expect(JSON.stringify(error).includes(rawApiMessage)).toBe(false);
  });

  it("maps 401 to the fixed authentication-required code", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: rawApiMessage }, 401)
    );
    const error = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: fetchMock
    }));

    expect(error.status).toBe(401);
    expect(error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(error.message).toBe(messages.requestFailed);
  });

  it("prefers a safe 429 body retry value over Retry-After", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { code: "CHANGE_PASSWORD_RATE_LIMITED", retryAfterSeconds: 12, message: rawApiMessage },
        429,
        { "Retry-After": "60" }
      )
    );
    const error = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: fetchMock
    }));

    expect(error.code).toBe("CHANGE_PASSWORD_RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(12);
  });

  it("uses a positive Retry-After header only as the 429 fallback", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: rawApiMessage }, 429, { "Retry-After": "7" })
    );
    const error = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: fetchMock
    }));

    expect(error.retryAfterSeconds).toBe(7);
  });

  it.each([
    [500, messages.requestFailed],
    [503, messages.requestFailed]
  ])("keeps %s responses static", async (status, expectedMessage) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: rawApiMessage }, status)
    );
    const error = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: fetchMock
    }));

    expect(error.status).toBe(status);
    expect(error.message).toBe(expectedMessage);
    expect(error.message.includes(rawApiMessage)).toBe(false);
  });

  it("maps network errors, invalid JSON, and anomalous success bodies without raw data", async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network raw error"));
    const networkError = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: networkFetch
    }));
    expect(networkError.message).toBe(messages.apiUnavailable);

    const invalidJsonFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{", { status: 500 })
    );
    const invalidJsonError = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: invalidJsonFetch
    }));
    expect(invalidJsonError.message).toBe(messages.requestFailed);

    const unexpectedSuccessFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: rawApiMessage }, 200)
    );
    const unexpectedSuccessError = await expectRequestError(() => changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: unexpectedSuccessFetch
    }));
    expect(unexpectedSuccessError.message).toBe(messages.requestFailed);
    expect(unexpectedSuccessError.message.includes(rawApiMessage)).toBe(false);
    expect(JSON.stringify(unexpectedSuccessError).includes(tokenCanary)).toBe(false);
    expect(JSON.stringify(unexpectedSuccessError).includes(passwordCanary)).toBe(false);
  });
});

describe("revokeAccountSessions", () => {
  it("uses the exact bodyless secure revoke request contract", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "SESSIONS_REVOKED" })
    );

    await revokeAccountSessions({ token: tokenCanary, messages, fetchImpl: fetchMock });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(apiUrl("/auth/revoke-sessions"));
    const options = requestOptions(fetchMock);
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ Authorization: `Bearer ${tokenCanary}` });
    expect(options.cache).toBe("no-store");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect("body" in options).toBe(false);
    expect(JSON.stringify(options).includes("userId")).toBe(false);
    expect(JSON.stringify(options).includes("email")).toBe(false);
    expect(JSON.stringify(options).includes("sessionVersion")).toBe(false);
  });

  it("strictly accepts only the expected revoke success body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "SESSIONS_REVOKED", token: "unexpected" })
    );
    const error = await expectRequestError(() => revokeAccountSessions({
      token: tokenCanary,
      messages,
      fetchImpl: fetchMock
    }));

    expect(error.status).toBe(200);
    expect(error.message).toBe(messages.requestFailed);
  });

  it("maps revoke 401 and 429 with safe codes and retry metadata", async () => {
    const unauthorizedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: rawApiMessage }, 401)
    );
    const unauthorized = await expectRequestError(() => revokeAccountSessions({
      token: tokenCanary,
      messages,
      fetchImpl: unauthorizedFetch
    }));
    expect(unauthorized.code).toBe("AUTHENTICATION_REQUIRED");

    const rateLimitedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { code: "REVOKE_SESSIONS_RATE_LIMITED", retryAfterSeconds: 9, message: rawApiMessage },
        429,
        { "Retry-After": "30" }
      )
    );
    const rateLimited = await expectRequestError(() => revokeAccountSessions({
      token: tokenCanary,
      messages,
      fetchImpl: rateLimitedFetch
    }));
    expect(rateLimited.code).toBe("REVOKE_SESSIONS_RATE_LIMITED");
    expect(rateLimited.retryAfterSeconds).toBe(9);

    const headerFallbackFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: rawApiMessage }, 429, { "Retry-After": "8" })
    );
    const headerFallback = await expectRequestError(() => revokeAccountSessions({
      token: tokenCanary,
      messages,
      fetchImpl: headerFallbackFetch
    }));
    expect(headerFallback.retryAfterSeconds).toBe(8);
  });

  it("keeps revoke network, server, and invalid JSON errors static and sensitive-free", async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network raw error"));
    const networkError = await expectRequestError(() => revokeAccountSessions({
      token: tokenCanary,
      messages,
      fetchImpl: networkFetch
    }));
    expect(networkError.message).toBe(messages.apiUnavailable);

    const serverFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: rawApiMessage }, 500))
      .mockResolvedValueOnce(jsonResponse({ message: rawApiMessage }, 503))
      .mockResolvedValueOnce(new Response("{", { status: 500 }));
    const serverError = await expectRequestError(() => revokeAccountSessions({
      token: tokenCanary,
      messages,
      fetchImpl: serverFetch
    }));
    const unavailableError = await expectRequestError(() => revokeAccountSessions({
      token: tokenCanary,
      messages,
      fetchImpl: serverFetch
    }));
    const invalidJsonError = await expectRequestError(() => revokeAccountSessions({
      token: tokenCanary,
      messages,
      fetchImpl: serverFetch
    }));

    expect(serverError.message).toBe(messages.requestFailed);
    expect(unavailableError.message).toBe(messages.requestFailed);
    expect(invalidJsonError.message).toBe(messages.requestFailed);
    expect(serverError.message.includes(rawApiMessage)).toBe(false);
    expect(JSON.stringify(serverError).includes(tokenCanary)).toBe(false);
  });

  it("does not write either browser storage while making account-security requests", async () => {
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "PASSWORD_CHANGED" }))
      .mockResolvedValueOnce(jsonResponse({ status: "SESSIONS_REVOKED" }));

    await changeAccountPassword({
      token: tokenCanary,
      currentPassword: passwordCanary,
      newPassword: "new-password",
      messages,
      fetchImpl: fetchMock
    });
    await revokeAccountSessions({ token: tokenCanary, messages, fetchImpl: fetchMock });

    expect(storageSetItem).not.toHaveBeenCalled();
  });
});
