"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AuthSubmissionError, resetPassword } from "../login/login-auth";
import { useI18n } from "../../lib/i18n/use-i18n";

type ResetPasswordState =
  | { status: "READY" }
  | { status: "SUBMITTING" }
  | { status: "COMPLETE" }
  | { status: "INVALID" }
  | { status: "RETRYABLE_ERROR" }
  | { status: "RATE_LIMITED"; retryAfterSeconds?: number };

function removeResetTokenFromAddressBar() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete("token");
  const relativeUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;

  window.history.replaceState(window.history.state, "", relativeUrl);
}

function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

function countUtf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [resetState, setResetState] = useState<ResetPasswordState>({ status: "READY" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const token = searchParams.get("token");
    const isMissingOrEmpty = token === null || token.trim().length === 0;

    if (searchParams.has("token")) {
      removeResetTokenFromAddressBar();
    }

    if (isMissingOrEmpty) {
      setResetState({ status: "INVALID" });
      return;
    }

    tokenRef.current = token;
  }, [searchParams]);

  const submitResetPassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitInFlightRef.current) return;

      setValidationError(null);
      const token = tokenRef.current;
      if (token === null) {
        setPassword("");
        setConfirmPassword("");
        setResetState({ status: "INVALID" });
        return;
      }

      if (!password || !confirmPassword) {
        setValidationError(t("login.passwordReset.passwordRequired"));
        return;
      }

      if (password !== confirmPassword) {
        setValidationError(t("login.passwordReset.passwordsDoNotMatch"));
        return;
      }

      if (countUnicodeCodePoints(password) < 8) {
        setValidationError(t("login.passwordReset.passwordTooShort"));
        return;
      }

      if (countUtf8Bytes(password) > 72) {
        setValidationError(t("login.passwordReset.passwordTooLong"));
        return;
      }

      submitInFlightRef.current = true;
      setResetState({ status: "SUBMITTING" });

      try {
        await resetPassword({
          token,
          password,
          messages: {
            retryableFailure: t("login.passwordReset.retryableFailure")
          }
        });
        tokenRef.current = null;
        setPassword("");
        setConfirmPassword("");
        setResetState({ status: "COMPLETE" });
      } catch (error) {
        setPassword("");
        setConfirmPassword("");

        if (
          error instanceof AuthSubmissionError &&
          error.status === 400 &&
          error.code === "PASSWORD_RESET_TOKEN_INVALID"
        ) {
          tokenRef.current = null;
          setResetState({ status: "INVALID" });
          return;
        }

        if (
          error instanceof AuthSubmissionError &&
          error.status === 429 &&
          error.code === "PASSWORD_RESET_RATE_LIMITED"
        ) {
          setResetState({
            status: "RATE_LIMITED",
            retryAfterSeconds: error.retryAfterSeconds
          });
          return;
        }

        setResetState({ status: "RETRYABLE_ERROR" });
      } finally {
        submitInFlightRef.current = false;
      }
    },
    [confirmPassword, password, t]
  );

  const showForm =
    resetState.status === "READY" ||
    resetState.status === "SUBMITTING" ||
    resetState.status === "RETRYABLE_ERROR" ||
    resetState.status === "RATE_LIMITED";
  const isSubmitting = resetState.status === "SUBMITTING";
  const responseMessage =
    resetState.status === "RETRYABLE_ERROR"
      ? t("login.passwordReset.retryableFailure")
      : resetState.status === "RATE_LIMITED"
        ? resetState.retryAfterSeconds === undefined
          ? t("login.passwordReset.rateLimited")
          : `${t("login.passwordReset.rateLimited")} ${t(
              "login.passwordReset.retryAfterSeconds",
              { seconds: resetState.retryAfterSeconds }
            )}`
        : null;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <h1 className="text-center text-xl font-semibold text-slate-950 dark:text-slate-100">
          {t("login.passwordReset.pageTitle")}
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
          {t("login.passwordReset.pageDescription")}
        </p>

        {resetState.status === "COMPLETE" ? (
          <div className="mt-6 text-center">
            <p
              className="text-sm font-medium text-emerald-700 dark:text-emerald-300"
              role="status"
              aria-live="polite"
            >
              {t("login.passwordReset.complete")}
            </p>
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                {t("login.passwordReset.manualLogin")}
              </Link>
            </div>
          </div>
        ) : resetState.status === "INVALID" ? (
          <div className="mt-6 text-center">
            <p
              className="text-sm font-medium text-red-600 dark:text-red-400"
              role="alert"
              aria-live="assertive"
            >
              {t("login.passwordReset.invalidOrExpired")}
            </p>
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                {t("login.passwordReset.manualLogin")}
              </Link>
            </div>
          </div>
        ) : showForm ? (
          <form className="mt-6 grid gap-4" noValidate onSubmit={submitResetPassword}>
            <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t("login.passwordReset.newPassword")}
              <input
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t("login.passwordReset.confirmPassword")}
              <input
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isSubmitting}
              />
            </label>

            {validationError ? (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
                role="alert"
                aria-live="assertive"
              >
                {validationError}
              </div>
            ) : null}

            {responseMessage ? (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
                role="alert"
                aria-live="assertive"
              >
                {responseMessage}
              </div>
            ) : null}

            <button
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 dark:hover:bg-indigo-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? t("login.passwordReset.submitting")
                : t("login.passwordReset.submit")}
            </button>
            <Link
              href="/login"
              className="text-center text-sm font-semibold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {t("login.passwordReset.manualLogin")}
            </Link>
          </form>
        ) : null}
      </section>
    </main>
  );
}

function ResetPasswordSuspenseFallback() {
  const { t } = useI18n();

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {t("login.passwordReset.pageTitle")}
      </p>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordSuspenseFallback />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
