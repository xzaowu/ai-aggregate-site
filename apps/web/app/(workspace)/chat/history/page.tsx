"use client";

import type { ChatSessionSummary } from "@ai-aggregate/shared";
import { Clock3, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { MobilePageHeader } from "../../../../components/workspace/MobilePageHeader";
import { useWorkspaceShellContext } from "../../../../components/workspace/workspace-shell-context";
import { useI18n } from "../../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../../lib/site-config";

type LoadState = "loading" | "ready" | "error";
type HistoryGroup = "today" | "yesterday" | "earlier";

const CHAT_HISTORY_PREVIEW_DEFERRED = "CHAT_HISTORY_PREVIEW_DEFERRED";

function sameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getHistoryGroup(value: string, now = new Date()): HistoryGroup {
  const date = new Date(value);
  if (sameLocalDate(date, now)) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return sameLocalDate(date, yesterday) ? "yesterday" : "earlier";
}

function formatUpdatedAt(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function ChatHistoryPage() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const { shell } = useWorkspaceShellContext();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");

  async function loadHistory() {
    if (!shell.token) {
      setSessions([]);
      setLoadState("ready");
      return;
    }

    setLoadState("loading");
    try {
      const response = await fetch(apiUrl("/chat/sessions"), {
        headers: { Authorization: `Bearer ${shell.token}` }
      });
      if (!response.ok) throw new Error("CHAT_HISTORY_LOAD_FAILED");
      const data = (await response.json()) as { sessions?: ChatSessionSummary[] };
      setSessions(
        (data.sessions ?? []).slice().sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt)
        )
      );
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    void loadHistory();
    // The shell token is the only source for this existing session list.
  }, [shell.token]);

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sessions.filter((session) =>
      normalized.length === 0 || session.title.toLowerCase().includes(normalized)
    );
  }, [query, sessions]);

  const groupedSessions = useMemo(() => {
    const groups: Record<HistoryGroup, ChatSessionSummary[]> = {
      today: [],
      yesterday: [],
      earlier: []
    };
    for (const session of filteredSessions) {
      groups[getHistoryGroup(session.updatedAt)].push(session);
    }
    return groups;
  }, [filteredSessions]);

  function openSession(sessionId: string) {
    router.push(`/?sessionId=${encodeURIComponent(sessionId)}`, { scroll: false });
  }

  async function deleteSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || !window.confirm(t("chat.deleteConfirm"))) return;
    try {
      const response = await fetch(apiUrl(`/chat/sessions/${sessionId}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${shell.token}` }
      });
      if (!response.ok) throw new Error("CHAT_HISTORY_DELETE_FAILED");
      setSessions((current) => current.filter((item) => item.id !== sessionId));
    } catch {
      setLoadState("error");
    }
  }

  const groupLabels: Record<HistoryGroup, string> = {
    today: locale === "zh-CN" ? "今天" : "Today",
    yesterday: locale === "zh-CN" ? "昨天" : "Yesterday",
    earlier: locale === "zh-CN" ? "更早" : "Earlier"
  };

  return (
    <>
      <MobilePageHeader
        title={t("chat.history")}
        backHref="/"
        backLabel={t("workspace.backToChat")}
        action={
          <button
            type="button"
            aria-label={t("chat.newChat")}
            onClick={() => router.push("/")}
            className="inline-flex size-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300"
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
        }
      />
      <div
        className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 px-5 py-3 dark:bg-slate-950"
        data-chat-history-page="true"
      >
        <div className="mx-auto grid max-w-2xl gap-4">
          <label className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t("models.searchLabel")}</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100"
              placeholder={t("models.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {loadState === "loading" ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400" data-chat-history-state="loading">
              {t("chat.loadingHistory")}
            </div>
          ) : loadState === "error" ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-8 text-center dark:border-rose-900 dark:bg-rose-950/30" data-chat-history-state="error">
              <p className="text-sm text-rose-700 dark:text-rose-300">{t("chat.loadHistoryFailed")}</p>
              <button type="button" className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => void loadHistory()}>
                {t("chat.retry")}
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center dark:border-slate-700 dark:bg-slate-900" data-chat-history-state="empty">
              <Clock3 className="mx-auto size-8 text-slate-400" aria-hidden="true" />
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("chat.noHistory")}</p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400" data-chat-history-state="no-results">
              {t("models.noResults")}
            </div>
          ) : (
            (Object.keys(groupedSessions) as HistoryGroup[]).map((group) =>
              groupedSessions[group].length > 0 ? (
                <section key={group} className="grid gap-2" data-chat-history-group={group}>
                  <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{groupLabels[group]}</h2>
                  {groupedSessions[group].map((session) => (
                    <article key={session.id} className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-chat-session-id={session.id}>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openSession(session.id)}>
                        <span className="block truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{session.title}</span>
                        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{formatUpdatedAt(session.updatedAt, locale)}</span>
                      </button>
                      <button type="button" aria-label={`${t("chat.deleteSession")} ${session.title}`} title={t("chat.deleteSession")} onClick={() => void deleteSession(session.id)} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-950/40 dark:hover:text-rose-300">
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </article>
                  ))}
                </section>
              ) : null
            )
          )}
          <span className="sr-only" data-chat-history-preview={CHAT_HISTORY_PREVIEW_DEFERRED}>
            {CHAT_HISTORY_PREVIEW_DEFERRED}
          </span>
        </div>
      </div>
    </>
  );
}
