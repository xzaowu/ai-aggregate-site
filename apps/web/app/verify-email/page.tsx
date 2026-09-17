"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { apiUrl } from "../../lib/site-config";

type VerificationState =
  | { status: "LOADING" }
  | { status: "VERIFIED" }
  | { status: "ALREADY_VERIFIED" }
  | { status: "INVALID" }
  | { status: "RETRYABLE_ERROR" };

type VerificationSuccessStatus = "VERIFIED" | "ALREADY_VERIFIED";

function readVerificationSuccessStatus(value: unknown): VerificationSuccessStatus | null {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return null;
  }

  const status = value.status;
  return status === "VERIFIED" || status === "ALREADY_VERIFIED" ? status : null;
}

function removeVerificationTokenFromAddressBar() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete("token");
  const relativeUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;

  window.history.replaceState(window.history.state, "", relativeUrl);
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [verificationState, setVerificationState] = useState<VerificationState>({
    status: "LOADING"
  });
  const tokenRef = useRef<string | null>(null);
  const requestInFlightRef = useRef(false);
  const initialAttemptStartedRef = useRef(false);

  const verifyEmail = useCallback(async () => {
    if (requestInFlightRef.current) return;

    const token = tokenRef.current;
    if (token === null) {
      setVerificationState({ status: "INVALID" });
      return;
    }

    requestInFlightRef.current = true;
    setVerificationState({ status: "LOADING" });

    try {
      const response = await fetch(apiUrl("/auth/verify-email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
        referrerPolicy: "no-referrer"
      });

      if (response.status === 400) {
        tokenRef.current = null;
        setVerificationState({ status: "INVALID" });
        return;
      }

      if (response.status !== 200) {
        setVerificationState({ status: "RETRYABLE_ERROR" });
        return;
      }

      const responseBody: unknown = await response.json();
      const status = readVerificationSuccessStatus(responseBody);

      if (status === "VERIFIED" || status === "ALREADY_VERIFIED") {
        tokenRef.current = null;
        setVerificationState({ status });
        return;
      }

      setVerificationState({ status: "RETRYABLE_ERROR" });
    } catch {
      setVerificationState({ status: "RETRYABLE_ERROR" });
    } finally {
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (initialAttemptStartedRef.current) return;
    initialAttemptStartedRef.current = true;

    const token = searchParams.get("token");
    const isMissingOrEmpty = token === null || token.trim().length === 0;

    if (searchParams.has("token")) {
      removeVerificationTokenFromAddressBar();
    }

    if (isMissingOrEmpty) {
      setVerificationState({ status: "INVALID" });
      return;
    }

    tokenRef.current = token;
    void verifyEmail();
  }, [searchParams, verifyEmail]);

  const loginLink = (
    <Link
      href="/login"
      className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
    >
      {t("login.emailVerification.manualLogin")}
    </Link>
  );

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        {verificationState.status === "LOADING" ? (
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300" aria-live="polite">
            {t("login.emailVerification.verifyLoading")}
          </p>
        ) : verificationState.status === "VERIFIED" ? (
          <div>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              {t("login.emailVerification.verified")}
            </p>
            <div className="mt-6">{loginLink}</div>
          </div>
        ) : verificationState.status === "ALREADY_VERIFIED" ? (
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("login.emailVerification.alreadyVerified")}
            </p>
            <div className="mt-6">{loginLink}</div>
          </div>
        ) : verificationState.status === "INVALID" ? (
          <div>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              {t("login.emailVerification.invalidOrExpired")}
            </p>
            <div className="mt-6">{loginLink}</div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              {t("login.emailVerification.retryableFailure")}
            </p>
            <button
              type="button"
              className="mt-6 inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => void verifyEmail()}
              disabled={requestInFlightRef.current}
            >
              {t("login.emailVerification.retryVerification")}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function VerifyEmailSuspenseFallback() {
  const { t } = useI18n();

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {t("login.emailVerification.verifyLoading")}
      </p>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailSuspenseFallback />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
