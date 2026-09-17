import type { AuthResponse } from "@ai-aggregate/shared";
import { describe, expect, it, vi } from "vitest";
import {
  AuthSubmissionError,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  submitPasswordAuth
} from "./login-auth";

const authResponse: AuthResponse = {
  token: "token_123",
  user: {
    id: "user_1",
    email: "demo@example.com",
    role: "USER",
    credits: 10
  }
};

const messages = {
  apiUnavailable: "Unable to connect to the API server.",
  authFailed: "Authentication failed",
  invalidCredentials: "Incorrect email or password",
  registrationDisabled: "Registration is currently disabled."
};

const passwordResetRequestMessages = {
  apiUnavailable: "Password reset service unavailable",
  requestFailed: "Password reset request failed"
};

const passwordResetMessages = {
  retryableFailure: "Password reset could not be completed"
};

function pendingResponse(status = 202) {
  return new Response(
    JSON.stringify({
      status: "EMAIL_VERIFICATION_PENDING",
      message: "If the account can be verified, a verification email has been sent."
    }),
    { status }
  );
}

describe("submitPasswordAuth", () => {
  it("uses the configured API base URL and returns authenticated login results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(authResponse), { status: 200 })
    );

    await expect(
      submitPasswordAuth({
        apiBaseUrl: "https://api.example.com",
        mode: "login",
        email: "demo@example.com",
        password: "password123",
        messages,
        fetchImpl
      })
    ).resolves.toEqual({ kind: "AUTHENTICATED", auth: authResponse });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/auth/login",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("parses a 202 registration response as pending without token or user data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pendingResponse());

    const result = await submitPasswordAuth({
      apiBaseUrl: "https://api.example.com",
      mode: "register",
      email: "demo@example.com",
      password: "password123",
      messages,
      fetchImpl
    });

    expect(result).toEqual({ kind: "EMAIL_VERIFICATION_PENDING" });
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("user");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "demo@example.com", password: "password123" })
      })
    );
  });

  it("rejects legacy 200 AuthResponse registration success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(authResponse), { status: 200 })
    );

    await expect(
      submitPasswordAuth({
        mode: "register",
        email: "demo@example.com",
        password: "password123",
        messages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: messages.authFailed,
      status: 200
    });
  });

  it("rejects malformed registration 202 bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "UNEXPECTED" }), { status: 202 })
    );

    await expect(
      submitPasswordAuth({
        mode: "register",
        email: "demo@example.com",
        password: "password123",
        messages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: messages.authFailed,
      status: 202
    });
  });

  it("maps network fetch failures to a clear translated message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      submitPasswordAuth({
        apiBaseUrl: "https://api.example.com",
        mode: "login",
        email: "demo@example.com",
        password: "password123",
        messages,
        fetchImpl
      })
    ).rejects.toThrow(messages.apiUnavailable);
  });

  it("maps invalid credentials separately from network errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid email or password" }), {
        status: 401
      })
    );

    await expect(
      submitPasswordAuth({
        apiBaseUrl: "https://api.example.com",
        mode: "login",
        email: "demo@example.com",
        password: "wrong-password",
        messages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: messages.invalidCredentials,
      status: 401
    });
  });

  it("maps login 429 responses to the real rate-limit code without retaining secrets or raw messages", async () => {
    const passwordCanary = "login-password-canary";
    const tokenCanary = "login-token-canary";
    const rawApiMessage = `Raw API message ${passwordCanary} ${tokenCanary}`;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "AUTH_LOGIN_RATE_LIMITED",
          message: rawApiMessage,
          retryAfterSeconds: 12
        }),
        { status: 429, headers: { "Retry-After": "99" } }
      )
    );

    try {
      await submitPasswordAuth({
        apiBaseUrl: "https://api.example.com",
        mode: "login",
        email: "demo@example.com",
        password: passwordCanary,
        messages,
        fetchImpl
      });
      throw new Error("TEST_EXPECTED_LOGIN_RATE_LIMIT_REJECTION");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthSubmissionError);
      expect(error).toMatchObject({
        message: messages.authFailed,
        status: 429,
        code: "AUTH_LOGIN_RATE_LIMITED",
        retryAfterSeconds: 12
      });
      expect((error as Error).message).not.toContain(rawApiMessage);
      expect(error).not.toHaveProperty("password");
      expect(error).not.toHaveProperty("token");
      expect(JSON.stringify(error)).not.toContain(passwordCanary);
      expect(JSON.stringify(error)).not.toContain(tokenCanary);
    }
  });

  it("uses Retry-After for login 429 responses when the body has no retry seconds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "AUTH_LOGIN_RATE_LIMITED",
          message: "raw login rate-limit message"
        }),
        { status: 429, headers: { "Retry-After": "15" } }
      )
    );

    await expect(
      submitPasswordAuth({
        mode: "login",
        email: "demo@example.com",
        password: "password123",
        messages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: messages.authFailed,
      status: 429,
      code: "AUTH_LOGIN_RATE_LIMITED",
      retryAfterSeconds: 15
    });
  });

  it("leaves retryAfterSeconds undefined when login 429 retry values are unsafe", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "AUTH_LOGIN_RATE_LIMITED",
          retryAfterSeconds: 1.5
        }),
        { status: 429, headers: { "Retry-After": "not-a-number" } }
      )
    );

    await expect(
      submitPasswordAuth({
        mode: "login",
        email: "demo@example.com",
        password: "password123",
        messages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      status: 429,
      code: "AUTH_LOGIN_RATE_LIMITED",
      retryAfterSeconds: undefined
    });
  });

  it("keeps verification-required login status and code without requiring auth data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Email verification is required before login."
        }),
        { status: 403 }
      )
    );

    await expect(
      submitPasswordAuth({
        mode: "login",
        email: "demo@example.com",
        password: "password123",
        messages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: messages.authFailed,
      status: 403,
      code: "EMAIL_VERIFICATION_REQUIRED"
    });
  });

  it("does not expose API English messages as UI error copy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "UNSAFE_UPSTREAM_ERROR",
          message: "Raw English server message must never reach the dialog."
        }),
        { status: 500 }
      )
    );

    await expect(
      submitPasswordAuth({
        mode: "login",
        email: "demo@example.com",
        password: "password123",
        messages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: messages.authFailed,
      code: "UNSAFE_UPSTREAM_ERROR",
      status: 500
    });
  });
});

describe("resendEmailVerification", () => {
  it("uses POST with an email-only payload and accepts the pending response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pendingResponse());

    await expect(
      resendEmailVerification({
        email: "demo@example.com",
        messages,
        fetchImpl
      })
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/resend-email-verification",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ email: "demo@example.com" })
      })
    );
    expect(fetchImpl.mock.calls[0]?.[1]).not.toMatchObject({ method: "GET" });
  });

  it("keeps body retryAfterSeconds on resend rate-limit errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "EMAIL_VERIFICATION_RESEND_RATE_LIMITED",
          message: "Too many verification email requests.",
          retryAfterSeconds: 12
        }),
        { status: 429, headers: { "Retry-After": "99" } }
      )
    );

    await expect(
      resendEmailVerification({ email: "demo@example.com", messages, fetchImpl })
    ).rejects.toMatchObject({
      message: messages.authFailed,
      status: 429,
      code: "EMAIL_VERIFICATION_RESEND_RATE_LIMITED",
      retryAfterSeconds: 12
    });
  });

  it("uses Retry-After when a resend rate-limit body has no retry seconds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "EMAIL_VERIFICATION_RESEND_RATE_LIMITED",
          message: "Too many verification email requests."
        }),
        { status: 429, headers: { "Retry-After": "15" } }
      )
    );

    await expect(
      resendEmailVerification({ email: "demo@example.com", messages, fetchImpl })
    ).rejects.toMatchObject({ retryAfterSeconds: 15 });
  });

  it.each([
    [{ retryAfterSeconds: -1 }, "NaN"],
    [{ retryAfterSeconds: -1 }, "Infinity"],
    [{ retryAfterSeconds: -1 }, "-3"],
    [{ retryAfterSeconds: -1 }, "1.5"],
    [{ retryAfterSeconds: "unexpected" }, "not-a-number"]
  ])("rejects unsafe retry values from %o and %s", async (body, header) => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "EMAIL_VERIFICATION_RESEND_RATE_LIMITED",
          message: "Too many verification email requests.",
          ...body
        }),
        { status: 429, headers: { "Retry-After": header } }
      )
    );

    try {
      await resendEmailVerification({ email: "demo@example.com", messages, fetchImpl });
      throw new Error("TEST_EXPECTED_RESEND_REJECTION");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthSubmissionError);
      expect((error as AuthSubmissionError).retryAfterSeconds).toBeUndefined();
    }
  });

  it("handles resend network and API failures with safe local errors", async () => {
    const networkFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const apiFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Raw English API failure" }), { status: 500 })
    );

    await expect(
      resendEmailVerification({ email: "demo@example.com", messages, fetchImpl: networkFetch })
    ).rejects.toThrow(messages.apiUnavailable);
    await expect(
      resendEmailVerification({ email: "demo@example.com", messages, fetchImpl: apiFetch })
    ).rejects.toMatchObject({ message: messages.authFailed, status: 500 });
  });
});

describe("requestPasswordReset", () => {
  it("posts only the email to the password-reset request endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "PASSWORD_RESET_PENDING" }), { status: 202 })
    );

    await expect(
      requestPasswordReset({
        email: "demo@example.com",
        messages: passwordResetRequestMessages,
        fetchImpl
      })
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/request-password-reset",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ email: "demo@example.com" })
      })
    );
    const options = fetchImpl.mock.calls[0]?.[1];
    expect(typeof options?.body).toBe("string");
    expect(Object.keys(JSON.parse(String(options?.body)))).toEqual(["email"]);
  });

  it("rejects unexpected 202 bodies and never uses API response messages", async () => {
    const rawApiMessage = "raw password reset API message";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "UNEXPECTED", message: rawApiMessage }), {
        status: 202
      })
    );

    await expect(
      requestPasswordReset({
        email: "demo@example.com",
        messages: passwordResetRequestMessages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: passwordResetRequestMessages.requestFailed,
      status: 202
    });

    try {
      await requestPasswordReset({
        email: "demo@example.com",
        messages: passwordResetRequestMessages,
        fetchImpl
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(rawApiMessage);
    }
  });

  it("keeps rate-limit retry seconds from the response body before the header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "PASSWORD_RESET_RATE_LIMITED",
          message: "raw rate-limit message",
          retryAfterSeconds: 12
        }),
        { status: 429, headers: { "Retry-After": "99" } }
      )
    );

    await expect(
      requestPasswordReset({
        email: "demo@example.com",
        messages: passwordResetRequestMessages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: passwordResetRequestMessages.requestFailed,
      status: 429,
      code: "PASSWORD_RESET_RATE_LIMITED",
      retryAfterSeconds: 12
    });
  });

  it("falls back to Retry-After and keeps network and server errors static", async () => {
    const rateLimitedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "PASSWORD_RESET_RATE_LIMITED" }), {
        status: 429,
        headers: { "Retry-After": "15" }
      })
    );
    const networkFetch = vi.fn().mockRejectedValue(new TypeError("failed to fetch"));
    const rawApiMessage = "raw server failure";
    const serverFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: rawApiMessage }), { status: 500 })
    );

    await expect(
      requestPasswordReset({
        email: "demo@example.com",
        messages: passwordResetRequestMessages,
        fetchImpl: rateLimitedFetch
      })
    ).rejects.toMatchObject({ retryAfterSeconds: 15 });
    await expect(
      requestPasswordReset({
        email: "demo@example.com",
        messages: passwordResetRequestMessages,
        fetchImpl: networkFetch
      })
    ).rejects.toThrow(passwordResetRequestMessages.apiUnavailable);
    await expect(
      requestPasswordReset({
        email: "demo@example.com",
        messages: passwordResetRequestMessages,
        fetchImpl: serverFetch
      })
    ).rejects.toMatchObject({
      message: passwordResetRequestMessages.requestFailed,
      status: 500
    });
  });
});

describe("resetPassword", () => {
  const resetTokenCanary = "reset-token-canary-not-for-ui";
  const passwordCanary = "password-canary-not-for-ui";

  it("posts only token and password with a no-referrer policy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "PASSWORD_RESET_COMPLETE" }), { status: 200 })
    );

    await expect(
      resetPassword({
        token: resetTokenCanary,
        password: passwordCanary,
        messages: passwordResetMessages,
        fetchImpl
      })
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/reset-password",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ token: resetTokenCanary, password: passwordCanary })
      })
    );
    const options = fetchImpl.mock.calls[0]?.[1];
    expect(Object.keys(JSON.parse(String(options?.body)))).toEqual(["token", "password"]);
  });

  it("maps invalid tokens to a safe error without retaining token or password", async () => {
    const rawApiMessage = "raw invalid token server message";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "PASSWORD_RESET_TOKEN_INVALID",
          message: rawApiMessage
        }),
        { status: 400 }
      )
    );

    try {
      await resetPassword({
        token: resetTokenCanary,
        password: passwordCanary,
        messages: passwordResetMessages,
        fetchImpl
      });
      throw new Error("TEST_EXPECTED_INVALID_RESET_REJECTION");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthSubmissionError);
      expect(error).toMatchObject({
        message: passwordResetMessages.retryableFailure,
        status: 400,
        code: "PASSWORD_RESET_TOKEN_INVALID"
      });
      expect((error as Error).message).not.toContain(rawApiMessage);
      expect(error).not.toHaveProperty("token");
      expect(error).not.toHaveProperty("password");
    }
  });

  it("maps rate limits and Retry-After safely", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "PASSWORD_RESET_RATE_LIMITED" }), {
        status: 429,
        headers: { "Retry-After": "9" }
      })
    );

    await expect(
      resetPassword({
        token: resetTokenCanary,
        password: passwordCanary,
        messages: passwordResetMessages,
        fetchImpl
      })
    ).rejects.toMatchObject({
      message: passwordResetMessages.retryableFailure,
      status: 429,
      code: "PASSWORD_RESET_RATE_LIMITED",
      retryAfterSeconds: 9
    });
  });

  it("uses the retryable static error for network, invalid JSON, unexpected success, and server failures", async () => {
    const networkFetch = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    const invalidJsonFetch = vi.fn().mockResolvedValue(new Response("{", { status: 200 }));
    const unexpectedSuccessFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "UNEXPECTED" }), { status: 200 })
    );
    const serverFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "raw 500 message" }), { status: 500 })
    );

    for (const fetchImpl of [
      networkFetch,
      invalidJsonFetch,
      unexpectedSuccessFetch,
      serverFetch
    ]) {
      await expect(
        resetPassword({
          token: resetTokenCanary,
          password: passwordCanary,
          messages: passwordResetMessages,
          fetchImpl
        })
      ).rejects.toMatchObject({ message: passwordResetMessages.retryableFailure });
    }
  });
});
