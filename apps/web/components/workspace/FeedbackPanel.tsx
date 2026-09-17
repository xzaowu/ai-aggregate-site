"use client";

import { CheckCircle2, MessageSquare, Plus, X } from "lucide-react";
import React, { useState } from "react";
import { Button } from "../../components/workspace/ui";
import { useI18n } from "../../lib/i18n/use-i18n";
import { apiUrl } from "../../lib/site-config";
import { useOptionalWorkspaceShellContext } from "./workspace-shell-context";

const feedbackTypes = ["problem", "feature", "consultation", "other"] as const;

export interface FeedbackPanelProps {
  token: string | null;
  isLoggedIn: boolean;
}

export function FeedbackPanel({ token, isLoggedIn }: FeedbackPanelProps) {
  const { t } = useI18n();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<string>("problem");
  const [content, setContent] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openForm() {
    setMessage(null);
    setError(null);
    setShowForm(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim() || !token) return;

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
          const body = JSON.parse(text) as { message?: string };
          if (typeof body.message === "string") msg = body.message;
        } catch { /* use fallback */ }
        throw new Error(msg);
      }

      setMessage(t("feedback.submitted"));
      setContent("");
      setScreenshotUrl("");
      setType("problem");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("feedback.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // Logged-out state
  if (!isLoggedIn) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200">
            <MessageSquare className="size-6" aria-hidden="true" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-slate-950">
            {t("feedback.title")}
          </h3>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">
            {t("workspace.signInToSubmitFeedback")}
          </p>
          <div className="mt-6">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              onClick={() => workspaceShell?.openAuthDialog()}
            >
              {t("nav.login")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Sub-header with new feedback button */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {t("feedback.center")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{t("feedback.description")}</p>
          </div>
          <Button type="button" onClick={openForm}>
            <Plus className="size-4" aria-hidden="true" />
            {t("feedback.new")}
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200">
            <MessageSquare className="size-6" aria-hidden="true" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-slate-950">
            {t("feedback.emptyTitle")}
          </h3>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
            {t("feedback.emptyDescription")}
          </p>
          <div className="mt-6">
            <Button type="button" onClick={openForm}>
              <Plus className="size-4" aria-hidden="true" />
              {t("feedback.submitFeedback")}
            </Button>
          </div>

          {message ? (
            <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal form */}
      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">
                {t("feedback.submitFeedback")}
              </h2>
              <button
                className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                type="button"
                aria-label={t("feedback.close")}
                onClick={() => setShowForm(false)}
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            <form className="grid gap-5" onSubmit={handleSubmit}>
              <label className="grid gap-2 text-sm font-semibold text-slate-700">
                {t("feedback.type")}
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
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

              <label className="grid gap-2 text-sm font-semibold text-slate-700">
                {t("feedback.content")}
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  placeholder={t("feedback.contentPlaceholder")}
                  required
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-700">
                {t("feedback.screenshotUrl")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  placeholder={t("feedback.screenshotUrlPlaceholder")}
                  type="url"
                  value={screenshotUrl}
                  onChange={(e) => setScreenshotUrl(e.target.value)}
                />
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  {t("feedback.cancel")}
                </Button>
                <Button disabled={submitting || !content.trim()} type="submit">
                  {submitting ? t("feedback.submitting") : t("feedback.submit")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
