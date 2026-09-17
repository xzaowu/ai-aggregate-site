"use client";

import type { AuthUser } from "@ai-aggregate/shared";
import { LockKeyhole, LogIn, UserPlus, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { authTokenKey, authUserKey } from "../auth-state";
import {
  AuthSubmissionError,
  requestPasswordReset,
  resendEmailVerification,
  submitPasswordAuth
} from "../../app/login/login-auth";
import { useI18n } from "../../lib/i18n/use-i18n";

interface AuthDialogProps {
  isOpen: boolean;
  mode: "login" | "register";
  registrationEnabled?: boolean;
  registrationClosedMessageZh?: string;
  registrationClosedMessageEn?: string;
  onClose: () => void;
  onAuthSuccess: (token: string, user: AuthUser) => void;
}

function localeText(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

const DEFAULT_CLOSED_ZH = "当前暂未开放新用户注册，已有账号可正常登录。";
const DEFAULT_CLOSED_EN =
  "New user registration is currently unavailable. Existing users can still sign in.";

type AuthDialogView =
  | "AUTH_FORM"
  | "EMAIL_VERIFICATION_PENDING"
  | "FORGOT_PASSWORD"
  | "PASSWORD_RESET_REQUESTED";

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function AuthDialog({
  isOpen,
  mode: initialMode,
  registrationEnabled = true,
  registrationClosedMessageZh,
  registrationClosedMessageEn,
  onClose,
  onAuthSuccess
}: AuthDialogProps) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [view, setView] = useState<AuthDialogView>("AUTH_FORM");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isRequestingPasswordReset, setIsRequestingPasswordReset] = useState(false);
  const [passwordResetMessage, setPasswordResetMessage] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const resendInFlightRef = useRef(false);
  const passwordResetRequestInFlightRef = useRef(false);
  const passwordResetRequestEpochRef = useRef(0);

  const clearEmailVerificationState = useCallback(() => {
    resendInFlightRef.current = false;
    setPendingEmail(null);
    setIsResending(false);
    setResendMessage(null);
  }, []);

  const clearPasswordResetState = useCallback(() => {
    passwordResetRequestEpochRef.current += 1;
    passwordResetRequestInFlightRef.current = false;
    setIsRequestingPasswordReset(false);
    setPasswordResetMessage(null);
  }, []);

  const resetDialogState = useCallback(() => {
    clearEmailVerificationState();
    clearPasswordResetState();
    setMode(initialMode === "register" && !registrationEnabled ? "login" : initialMode);
    setView("AUTH_FORM");
    setEmail("");
    setPassword("");
    setError(null);
    setEmailError(null);
    setIsLoading(false);
  }, [clearEmailVerificationState, clearPasswordResetState, initialMode, registrationEnabled]);

  const handleClose = useCallback(() => {
    resetDialogState();
    onClose();
  }, [onClose, resetDialogState]);

  useEffect(() => {
    resetDialogState();
  }, [resetDialogState]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const timer = setTimeout(() => {
      emailInputRef.current?.focus();
    }, 100);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      clearTimeout(timer);
    };
  }, [handleClose, isOpen]);

  useEffect(() => {
    if (!isOpen) resetDialogState();
  }, [isOpen, resetDialogState]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      setEmailError(null);

      const normalizedEmail = email.trim();
      if (!normalizedEmail || !password) {
        setError(
          localeText(
            locale,
            "请输入邮箱和密码",
            "Please enter email and password"
          )
        );
        return;
      }

      if (mode === "register" && password.length < 8) {
        setError(
          localeText(
            locale,
            "密码至少需要 8 个字符",
            "Password must be at least 8 characters"
          )
        );
        return;
      }

      if (mode === "register" && !registrationEnabled) {
        setError(
          localeText(
            locale,
            "当前暂不开放注册",
            "Registration is currently disabled"
          )
        );
        return;
      }

      setIsLoading(true);

      try {
        const result = await submitPasswordAuth({
          mode,
          email: normalizedEmail,
          password,
          messages: {
            apiUnavailable: localeText(
              locale,
              "API 服务不可用，请稍后重试",
              "API service unavailable, please try again later"
            ),
            authFailed: localeText(
              locale,
              "认证失败，请重试",
              "Authentication failed, please try again"
            ),
            invalidCredentials: localeText(
              locale,
              "邮箱或密码错误",
              "Invalid email or password"
            ),
            registrationDisabled: localeText(
              locale,
              "当前暂不开放注册",
              "Registration is currently disabled"
            )
          }
        });

        if (result.kind === "EMAIL_VERIFICATION_PENDING") {
          setPendingEmail(normalizedEmail);
          setView("EMAIL_VERIFICATION_PENDING");
          setPassword("");
          return;
        }

        window.localStorage.setItem(authTokenKey, result.auth.token);
        window.localStorage.setItem(authUserKey, JSON.stringify(result.auth.user));
        onAuthSuccess(result.auth.token, result.auth.user);
      } catch (submitError) {
        if (submitError instanceof AuthSubmissionError) {
          if (
            mode === "login" &&
            submitError.status === 403 &&
            submitError.code === "EMAIL_VERIFICATION_REQUIRED"
          ) {
            setPendingEmail(normalizedEmail);
            setView("EMAIL_VERIFICATION_PENDING");
            setPassword("");
            return;
          }
          if (mode === "login" && submitError.status === 429) {
            setError(
              submitError.retryAfterSeconds === undefined
                ? t("login.rateLimited")
                : t("login.rateLimitedWithSeconds", {
                    seconds: submitError.retryAfterSeconds
                  })
            );
            setPassword("");
            return;
          }
          if (submitError.code === "REGISTRATION_CLOSED") {
            clearEmailVerificationState();
            clearPasswordResetState();
            setView("AUTH_FORM");
            setMode("login");
            setError(
              locale === "zh-CN"
                ? registrationClosedMessageZh || DEFAULT_CLOSED_ZH
                : registrationClosedMessageEn || DEFAULT_CLOSED_EN
            );
            return;
          }
          if (submitError.code === "EMAIL_DOMAIN_NOT_ALLOWED") {
            setEmailError(
              localeText(
                locale,
                "当前邮箱域名暂不支持注册，请更换常用邮箱。",
                "This email domain is not allowed for registration."
              )
            );
            return;
          }
          if (submitError.status === 401) {
            setError(
              localeText(locale, "邮箱或密码错误", "Invalid email or password")
            );
            return;
          }
          if (submitError.status === undefined) {
            setError(t("login.apiUnavailable"));
            return;
          }
        }
        setError(localeText(locale, "认证失败，请重试", "Authentication failed, please try again"));
      } finally {
        setIsLoading(false);
      }
    },
    [
      clearEmailVerificationState,
      clearPasswordResetState,
      email,
      locale,
      mode,
      onAuthSuccess,
      password,
      registrationClosedMessageEn,
      registrationClosedMessageZh,
      registrationEnabled
    ]
  );

  const handleResend = useCallback(async () => {
    if (!pendingEmail || resendInFlightRef.current) return;

    resendInFlightRef.current = true;
    setIsResending(true);
    setResendMessage(null);

    try {
      await resendEmailVerification({
        email: pendingEmail,
        messages: {
          apiUnavailable: localeText(
            locale,
            "API 服务不可用，请稍后重试",
            "API service unavailable, please try again later"
          ),
          authFailed: localeText(
            locale,
            "认证失败，请重试",
            "Authentication failed, please try again"
          )
        }
      });
      setResendMessage(t("login.emailVerification.resendSuccess"));
    } catch (resendError) {
      if (
        resendError instanceof AuthSubmissionError &&
        resendError.status === 429 &&
        resendError.code === "EMAIL_VERIFICATION_RESEND_RATE_LIMITED"
      ) {
        const retryAfterSeconds = resendError.retryAfterSeconds;
        setResendMessage(
          retryAfterSeconds === undefined
            ? t("login.emailVerification.resendRateLimited")
            : `${t("login.emailVerification.resendRateLimited")} ${t(
                "login.emailVerification.retryAfterSeconds",
                { seconds: retryAfterSeconds }
              )}`
        );
      } else {
        setResendMessage(t("login.emailVerification.resendFailed"));
      }
    } finally {
      resendInFlightRef.current = false;
      setIsResending(false);
    }
  }, [locale, pendingEmail, t]);

  const handleReturnToLogin = useCallback(() => {
    clearEmailVerificationState();
    setMode("login");
    setView("AUTH_FORM");
    setEmail("");
    setPassword("");
    setError(null);
    setEmailError(null);
    setIsLoading(false);
  }, [clearEmailVerificationState]);

  const handleForgotPassword = useCallback(() => {
    clearEmailVerificationState();
    clearPasswordResetState();
    setView("FORGOT_PASSWORD");
    setPassword("");
    setError(null);
    setEmailError(null);
    setIsLoading(false);
  }, [clearEmailVerificationState, clearPasswordResetState]);

  const handlePasswordResetReturnToLogin = useCallback(() => {
    clearPasswordResetState();
    setMode("login");
    setView("AUTH_FORM");
    setPassword("");
    setError(null);
    setEmailError(null);
    setIsLoading(false);
  }, [clearPasswordResetState]);

  const handlePasswordResetRequest = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (passwordResetRequestInFlightRef.current) return;

      const normalizedEmail = email.trim();
      setPasswordResetMessage(null);

      if (!isLikelyEmail(normalizedEmail)) {
        setPasswordResetMessage(t("login.passwordReset.requestInvalidEmail"));
        return;
      }

      const requestEpoch = passwordResetRequestEpochRef.current;
      passwordResetRequestInFlightRef.current = true;
      setIsRequestingPasswordReset(true);

      try {
        await requestPasswordReset({
          email: normalizedEmail,
          messages: {
            apiUnavailable: t("login.passwordReset.requestFailed"),
            requestFailed: t("login.passwordReset.requestFailed")
          }
        });

        if (requestEpoch !== passwordResetRequestEpochRef.current) return;
        setView("PASSWORD_RESET_REQUESTED");
      } catch (requestError) {
        if (requestEpoch !== passwordResetRequestEpochRef.current) return;

        if (
          requestError instanceof AuthSubmissionError &&
          requestError.status === 429 &&
          requestError.code === "PASSWORD_RESET_RATE_LIMITED"
        ) {
          const retryAfterSeconds = requestError.retryAfterSeconds;
          setPasswordResetMessage(
            retryAfterSeconds === undefined
              ? t("login.passwordReset.requestRateLimited")
              : `${t("login.passwordReset.requestRateLimited")} ${t(
                  "login.passwordReset.retryAfterSeconds",
                  { seconds: retryAfterSeconds }
                )}`
          );
          return;
        }

        setPasswordResetMessage(t("login.passwordReset.requestFailed"));
      } finally {
        if (requestEpoch === passwordResetRequestEpochRef.current) {
          passwordResetRequestInFlightRef.current = false;
          setIsRequestingPasswordReset(false);
        }
      }
    },
    [email, t]
  );

  const handleModeSwitch = useCallback(() => {
    if (mode === "login") {
      if (!registrationEnabled) return;
      setMode("register");
    } else {
      setMode("login");
    }
    clearEmailVerificationState();
    clearPasswordResetState();
    setView("AUTH_FORM");
    setError(null);
    setEmailError(null);
    setEmail("");
    setPassword("");
  }, [clearEmailVerificationState, clearPasswordResetState, mode, registrationEnabled]);

  const isEmailVerificationPending = view === "EMAIL_VERIFICATION_PENDING";
  const isForgotPassword = view === "FORGOT_PASSWORD";
  const isPasswordResetRequested = view === "PASSWORD_RESET_REQUESTED";
  const title = isEmailVerificationPending
    ? t("login.emailVerification.pendingTitle")
    : isForgotPassword
      ? t("login.passwordReset.requestTitle")
      : isPasswordResetRequested
        ? t("login.passwordReset.requestPendingTitle")
    : mode === "login"
      ? localeText(locale, "登录", "Log in")
      : localeText(locale, "注册", "Register");
  const description = isEmailVerificationPending
    ? t("login.emailVerification.pendingDescription")
    : isForgotPassword
      ? t("login.passwordReset.requestDescription")
      : isPasswordResetRequested
        ? t("login.passwordReset.requestPendingDescription")
    : mode === "login"
      ? localeText(
          locale,
          "使用邮箱和密码登录你的账户",
          "Log in with your email and password"
        )
      : localeText(
          locale,
          "创建新账户以开始使用",
          "Create a new account to get started"
        );
  const submitLabel = isLoading
    ? localeText(locale, "提交中…", "Submitting…")
    : mode === "login"
      ? localeText(locale, "确认登录", "Confirm login")
      : localeText(locale, "创建账户", "Create account");
  const switchLabel = mode === "login"
    ? localeText(locale, "还没有账户？立即注册", "No account? Register now")
    : localeText(locale, "已有账户？立即登录", "Already have an account? Log in");

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex bg-slate-950/45 p-0 dark:bg-slate-950/70 ${
        isMobile ? "items-end" : "items-center justify-center p-6"
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        className={`flex flex-col bg-white shadow-2xl dark:bg-slate-950 dark:shadow-[0_0_80px_rgba(0,0,0,0.4)] ${
          isMobile
            ? "w-full max-h-[88dvh] rounded-t-2xl"
            : "w-full max-w-[440px] rounded-2xl max-h-[85vh]"
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <h2
              id="auth-dialog-title"
              className="text-lg font-semibold text-slate-950 dark:text-slate-100"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {description}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label={localeText(locale, "关闭", "Close")}
            title={localeText(locale, "关闭", "Close")}
            onClick={handleClose}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        {isEmailVerificationPending ? (
          <div
            className="grid gap-4 overflow-y-auto px-5 py-5"
            data-email-verification-pending="true"
          >
            {resendMessage ? (
              <div
                className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300"
                role="status"
              >
                {resendMessage}
              </div>
            ) : null}
            <button
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 dark:hover:bg-indigo-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              type="button"
              data-resend-email-verification="true"
              onClick={handleResend}
              disabled={isResending}
            >
              {isResending
                ? t("login.emailVerification.resending")
                : t("login.emailVerification.resend")}
            </button>
            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-400"
              type="button"
              data-return-to-login="true"
              onClick={handleReturnToLogin}
            >
              <LogIn className="mr-1.5 inline size-4" aria-hidden="true" />
              {t("login.emailVerification.backToLogin")}
            </button>
          </div>
        ) : isPasswordResetRequested ? (
          <div
            className="grid gap-4 overflow-y-auto px-5 py-5"
            data-password-reset-requested="true"
          >
            <div
              className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300"
              role="status"
              aria-live="polite"
            >
              {t("login.passwordReset.requestPendingDescription")}
            </div>
            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-400"
              type="button"
              data-password-reset-back-to-login="true"
              onClick={handlePasswordResetReturnToLogin}
            >
              <LogIn className="mr-1.5 inline size-4" aria-hidden="true" />
              {t("login.passwordReset.backToLogin")}
            </button>
          </div>
        ) : isForgotPassword ? (
          <form
            className="grid gap-4 overflow-y-auto px-5 py-5"
            onSubmit={handlePasswordResetRequest}
            noValidate
          >
            <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t("login.passwordReset.emailLabel")}
              <input
                ref={emailInputRef}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("login.passwordReset.emailPlaceholder")}
                autoComplete="email"
                disabled={isRequestingPasswordReset}
              />
            </label>

            {passwordResetMessage ? (
              <div
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
                role="alert"
                aria-live="assertive"
              >
                {passwordResetMessage}
              </div>
            ) : null}

            <button
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 dark:hover:bg-indigo-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              type="submit"
              data-request-password-reset="true"
              disabled={isRequestingPasswordReset}
            >
              {isRequestingPasswordReset
                ? t("login.passwordReset.requesting")
                : t("login.passwordReset.requestSubmit")}
            </button>
            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-400"
              type="button"
              data-password-reset-back-to-login="true"
              onClick={handlePasswordResetReturnToLogin}
              disabled={isRequestingPasswordReset}
            >
              <LogIn className="mr-1.5 inline size-4" aria-hidden="true" />
              {t("login.passwordReset.backToLogin")}
            </button>
          </form>
        ) : (
          <form
            className="grid gap-4 overflow-y-auto px-5 py-5"
            onSubmit={handleSubmit}
          >
            <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              {localeText(locale, "邮箱", "Email")}
              <input
                ref={emailInputRef}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                disabled={isLoading}
              />
              {emailError ? (
                <span className="text-sm font-normal text-red-600 dark:text-red-400">{emailError}</span>
              ) : null}
            </label>

            <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              {localeText(locale, "密码", "Password")}
              <input
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={localeText(
                  locale,
                  "输入密码",
                  "Enter password"
                )}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                disabled={isLoading}
              />
            </label>

            {mode === "login" ? (
              <button
                className="justify-self-start text-sm font-semibold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                type="button"
                data-forgot-password="true"
                onClick={handleForgotPassword}
                disabled={isLoading}
              >
                {t("login.passwordReset.forgotPassword")}
              </button>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                {error}
              </div>
            ) : null}

            {!registrationEnabled ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
                {locale === "zh-CN"
                  ? registrationClosedMessageZh || DEFAULT_CLOSED_ZH
                  : registrationClosedMessageEn || DEFAULT_CLOSED_EN}
              </div>
            ) : null}

            <button
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 dark:hover:bg-indigo-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              type="submit"
              disabled={
                isLoading ||
                (mode === "register" && !registrationEnabled)
              }
            >
              {isLoading ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <LockKeyhole className="size-4" aria-hidden="true" />
              )}
              {submitLabel}
            </button>

            <button
              className={`rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-400 ${
                mode === "login" && !registrationEnabled
                  ? "cursor-not-allowed opacity-50"
                  : ""
              }`}
              type="button"
              onClick={handleModeSwitch}
              disabled={mode === "login" && !registrationEnabled}
            >
              {mode === "login" ? (
                <>
                  <UserPlus className="mr-1.5 inline size-4" aria-hidden="true" />
                  {switchLabel}
                </>
              ) : (
                <>
                  <LogIn className="mr-1.5 inline size-4" aria-hidden="true" />
                  {switchLabel}
                </>
              )}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
