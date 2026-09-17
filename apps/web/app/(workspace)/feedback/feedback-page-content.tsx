"use client";

import {
  validateFeedbackScreenshotUrl,
  type PublicSiteSettings
} from "@ai-aggregate/shared";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Mail,
  MessageCircle,
  MessageSquare,
  QrCode,
  Send
} from "lucide-react";
import Link from "next/link";
import React, { useState } from "react";
import { Button } from "../../../components/workspace/ui";
import { useWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { usePublicSettings } from "../../../lib/use-public-settings";
import { apiUrl } from "../../../lib/site-config";
import { MobilePageHeader } from "../../../components/workspace/MobilePageHeader";

const feedbackTypes = ["problem", "feature", "consultation", "other"] as const;

export function getFeedbackScreenshotUrlError(
  value: string
): "tooLong" | "invalid" | null {
  const validation = validateFeedbackScreenshotUrl(value);
  if (validation.valid) return null;
  return value.trim().length > 500 ? "tooLong" : "invalid";
}

interface ContactExternalLink {
  label: string;
  url: string;
}

function parseExternalLinks(raw: string | undefined): ContactExternalLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ContactExternalLink =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).label === "string" &&
        typeof (item as Record<string, unknown>).url === "string"
    );
  } catch {
    return [];
  }
}

function hasAnyContact(settings: PublicSiteSettings | null): boolean {
  if (!settings) return false;
  const links = parseExternalLinks(settings.contactExternalLinks);
  return (
    !!settings.contactDescription ||
    !!settings.contactEmail ||
    !!settings.contactWechat ||
    !!settings.contactPublicAccount ||
    !!settings.contactCommunityUrl ||
    !!settings.contactQrImageUrl ||
    !!settings.contactNotes ||
    links.length > 0
  );
}

export default function FeedbackPageContent() {
  const workspaceShell = useWorkspaceShellContext();
  const { shell } = workspaceShell;
  const token = shell.token;
  const isLoggedIn = shell.isLoggedIn;
  const { t } = useI18n();
  const publicSettings = usePublicSettings();

  const [type, setType] = useState<string>("problem");
  const [contactEmail, setContactEmail] = useState("");
  const [content, setContent] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim() || !token) return;

    const screenshotUrlError = getFeedbackScreenshotUrlError(screenshotUrl);
    if (screenshotUrlError) {
      setError(
        t(
          screenshotUrlError === "tooLong"
            ? "feedback.screenshotUrlTooLong"
            : "feedback.screenshotUrlInvalid"
        )
      );
      setMessage(null);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(apiUrl("/feedback"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          type,
          content: content.trim(),
          screenshotUrl: screenshotUrl.trim() || undefined
        })
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = t("feedback.submitFailed");
        try {
          const body = JSON.parse(text) as { code?: string; message?: string };
          if (body.code === "FEEDBACK_SCREENSHOT_URL_INVALID") {
            msg = t("feedback.screenshotUrlInvalid");
          } else if (typeof body.message === "string") {
            msg = body.message;
          }
        } catch { /* use fallback */ }
        throw new Error(msg);
      }

      setMessage(t("feedback.submitted"));
      setContent("");
      setScreenshotUrl("");
      setContactEmail("");
      setType("problem");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("feedback.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyText(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // clipboard write failed - ignore
    }
  }

  const externalLinks = parseExternalLinks(publicSettings?.contactExternalLinks);

  const contactCard = (() => {
    if (!hasAnyContact(publicSettings)) {
      return (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
            {t("feedback.contactSectionTitle")}
          </h2>
          <p className="mt-2 text-sm italic text-slate-400 dark:text-slate-500">
            {t("feedback.noContactConfigured")}
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
            {t("feedback.contactSectionTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("feedback.contactSectionDescription")}
          </p>
        </div>
        <div className="divide-y divide-slate-100 px-6 py-3 dark:divide-slate-700">
          {publicSettings?.contactDescription && (
            <div className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <MessageSquare className="size-3.5" />
              </span>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                {publicSettings.contactDescription}
              </p>
            </div>
          )}

          {publicSettings?.contactEmail && (
            <div className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Mail className="size-3.5" />
              </span>
              <a
                className="text-sm font-medium text-indigo-600 break-all hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline"
                href={`mailto:${publicSettings.contactEmail}`}
              >
                {publicSettings.contactEmail}
              </a>
            </div>
          )}

          {publicSettings?.contactWechat && (
            <div className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <MessageCircle className="size-3.5" />
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-sm text-slate-700 dark:text-slate-300 break-all">
                  {publicSettings.contactWechat}
                </span>
                <button
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                  type="button"
                  onClick={() =>
                    copyText(publicSettings.contactWechat!, "wechat")
                  }
                >
                  {copiedField === "wechat" ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copiedField === "wechat"
                    ? t("feedback.wechatCopied")
                    : t("feedback.copyWechat")}
                </button>
              </div>
            </div>
          )}

          {publicSettings?.contactPublicAccount && (
            <div className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Globe className="size-3.5" />
              </span>
              <p className="text-sm text-slate-700 dark:text-slate-300 break-all">
                {publicSettings.contactPublicAccount}
              </p>
            </div>
          )}

          {publicSettings?.contactCommunityUrl && (
            <div className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Globe className="size-3.5" />
              </span>
              <a
                className="text-sm font-medium text-indigo-600 break-all hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline"
                href={publicSettings.contactCommunityUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                {t("feedback.community")}
                <ExternalLink className="ml-1 inline size-3" />
              </a>
            </div>
          )}

          {publicSettings?.contactQrImageUrl && !qrError && (
            <div className="flex flex-col items-center gap-3 py-3">
              <span className="flex items-center gap-1.5 self-start text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-400">
                <QrCode className="size-3.5" />
                {t("feedback.qrCode")}
              </span>
              <img
                alt={t("feedback.qrCode")}
                className="mx-auto max-w-[200px] rounded-xl border border-slate-200 dark:border-slate-700 lg:max-w-[200px] max-w-[160px]"
                src={publicSettings.contactQrImageUrl}
                onError={() => setQrError(true)}
              />
            </div>
          )}

          {publicSettings?.contactNotes && (
            <div className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <MessageSquare className="size-3.5" />
              </span>
              <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                {publicSettings.contactNotes}
              </p>
            </div>
          )}

          {externalLinks.length > 0 && (
            <div className="py-2.5">
              <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-400">
                <ExternalLink className="size-3.5" />
                {t("feedback.externalLinks")}
              </span>
              <div className="grid gap-1.5 mt-1.5">
                {externalLinks.map((link, index) => (
                  <a
                    key={index}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 break-all hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline"
                    href={link.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {link.label}
                    <ExternalLink className="size-3" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  })();

  if (!isLoggedIn) {
    return (
      <>
        <MobilePageHeader title={t("feedback.title")} backHref="/account" />
        <div
          className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto"
          data-workspace-page-scroll="feedback"
        >
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 shadow-sm text-center dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                <MessageSquare className="size-6" />
              </span>
              <h3 className="mt-5 text-xl font-semibold text-slate-950 dark:text-slate-100">
                {t("feedback.title")}
              </h3>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
                {t("workspace.signInToSubmitFeedback")}
              </p>
              <div className="mt-6">
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                  onClick={() => workspaceShell.openAuthDialog()}
                >
                  {t("nav.login")}
                </button>
              </div>
            </div>
          </div>
          <div className="lg:col-span-1">
            {contactCard}
          </div>
          </div>
        </div>
        </div>
      </>
    );
  }

  return (
    <>
      <MobilePageHeader title={t("feedback.title")} backHref="/account" />
      <div
        className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto"
        data-workspace-page-scroll="feedback"
      >
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: Feedback form */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
            <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
                {t("feedback.submitFeedback")}
              </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t("feedback.description")}
              </p>
            </div>

            <form className="grid gap-5 px-6 py-5" noValidate onSubmit={handleSubmit}>
              <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {t("feedback.type")}
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-none dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {feedbackTypes.map((fbType) => (
                    <option key={fbType} value={fbType}>
                      {t(`feedback.type.${fbType}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {t("feedback.contactEmail")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-none dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                  placeholder="your@email.com"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {t("feedback.content")}
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-none dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                  placeholder={t("feedback.contentPlaceholder")}
                  required
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {t("feedback.screenshotUrl")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-none dark:placeholder:text-slate-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/40"
                  placeholder={t("feedback.screenshotUrlPlaceholder")}
                  type="url"
                  value={screenshotUrl}
                  onChange={(e) => setScreenshotUrl(e.target.value)}
                />
              </label>

              <div className="flex items-center justify-between gap-3 pt-2">
                <div>
                  {message && (
                    <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
                      <CheckCircle2 className="size-4" />
                      {message}
                    </div>
                  )}
                  {error && (
                    <div className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                      <AlertCircle className="size-4" />
                      {error}
                    </div>
                  )}
                </div>
                <Button
                  disabled={submitting || !content.trim()}
                  type="submit"
                >
                  <Send className="size-4" />
                  {submitting ? t("feedback.submitting") : t("feedback.submit")}
                </Button>
              </div>
            </form>
          </div>
        </div>

        {/* Right column: Contact info */}
        <div className="lg:col-span-1">
          {contactCard}
        </div>
      </div>
    </div>
      </div>
    </>
  );
}
