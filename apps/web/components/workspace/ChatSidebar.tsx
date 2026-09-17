"use client";

import { getModelDisplayName, type AiModelSummary } from "@ai-aggregate/shared";
import type { ChatSessionSummary } from "@ai-aggregate/shared";
import {
  Brain,
  Clock3,
  MessageSquare,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { ModelIcon } from "./ModelIcon";
import {
  SecondarySidebarHeader,
  SidebarNewSessionButton,
  SidebarSectionLabel,
  WorkspaceHistoryItem
} from "./shared-sidebar";

export interface FeaturedModelDef {
  model: AiModelSummary;
  isCurrent: boolean;
}

const chatSidebarCollapsedKey = "ai-aggregate:chat-sidebar-collapsed";

export function ChatSidebar({
  title,
  newChatLabel,
  historyLabel,
  noHistoryLabel,
  loginHint,
  loginLabel,
  sessions,
  currentSessionId,
  isLoggedIn,
  deleteLabel,
  featuredModelsLabel,
  moreModelsLabel,
  collapseSidebarLabel = "Collapse",
  expandSidebarLabel = "Expand",
  featuredModels,
  modelsPageHref,
  onSelectFeaturedModel,
  onCreateSession,
  onSelectSession,
  onDeleteSession
}: {
  title: string;
  newChatLabel: string;
  historyLabel: string;
  noHistoryLabel: string;
  loginHint: string;
  loginLabel: string;
  sessions: ChatSessionSummary[];
  currentSessionId: string | null;
  isLoggedIn: boolean;
  deleteLabel: string;
  /** Label for the Featured Models section */
  featuredModelsLabel?: string;
  /** Label for "More Models" link */
  moreModelsLabel?: string;
  /** Label for the collapse sidebar button */
  collapseSidebarLabel?: string;
  /** Label for the expand sidebar button */
  expandSidebarLabel?: string;
  /** Featured/selected chat models to display */
  featuredModels?: FeaturedModelDef[];
  /** Where "More Models" links to */
  modelsPageHref?: string;
  /** Called when a featured model is clicked */
  onSelectFeaturedModel?: (modelId: string) => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const showFeaturedModels =
    featuredModels && featuredModels.length > 0 && featuredModelsLabel;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(chatSidebarCollapsedKey);
    if (stored) {
      setIsCollapsed(stored === "true");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(chatSidebarCollapsedKey, String(isCollapsed));
  }, [isCollapsed]);

  return (
    <aside
      className={`hidden border-r border-slate-200 bg-slate-50/80 md:flex md:h-[100dvh] md:flex-col lg:flex lg:h-[100dvh] lg:flex-col overflow-x-hidden dark:border-slate-700 dark:bg-slate-900/80 ${
        isCollapsed
          ? "w-[56px] items-center px-2 py-4"
          : "w-[304px] px-4 py-4"
      }`}
      data-chat-sidebar="true"
      data-chat-sidebar-collapsed={isCollapsed ? "true" : "false"}
    >
      <SecondarySidebarHeader
        icon={MessageSquare}
        title={title}
        collapsed={isCollapsed}
        onToggle={() => setIsCollapsed(!isCollapsed)}
        toggleLabel={isCollapsed ? expandSidebarLabel : collapseSidebarLabel}
        dataCollapseAttr="data-chat-sidebar-collapse"
        dataExpandAttr="data-chat-sidebar-expand"
      />

      <div className={isCollapsed ? "mt-4 flex justify-center" : "mt-4"}>
        <SidebarNewSessionButton
          label={newChatLabel}
          collapsed={isCollapsed}
          isLoggedIn={isLoggedIn}
          loginHint={loginHint}
          loginLabel={loginLabel}
          onCreateSession={onCreateSession}
          dataAttr="data-new-chat-btn"
        />
      </div>

      {!isCollapsed && showFeaturedModels ? (
        <div className="mt-5" data-featured-models-section="true">
          <SidebarSectionLabel
            icon={Sparkles}
            label={featuredModelsLabel ?? ""}
          />
          <div className="mt-2 grid gap-1">
            {featuredModels!.map(({ model, isCurrent }) => (
              <button
                key={model.id}
                type="button"
                className={
                  isCurrent
                    ? "flex w-full items-center gap-3 rounded-xl bg-indigo-50 px-3 py-2 text-left text-indigo-700 ring-1 ring-indigo-100 transition dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-800"
                    : "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                }
                onClick={() => onSelectFeaturedModel?.(model.modelId)}
                data-featured-model={model.modelId}
                data-featured-model-current={isCurrent ? "true" : undefined}
              >
                <ModelIcon
                  model={model}
                  selected={isCurrent}
                  className="size-8 rounded-xl"
                  imageClassName="size-4"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {getModelDisplayName(model)}
                </span>
              </button>
            ))}
            {modelsPageHref ? (
              <Link
                href={modelsPageHref}
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
                data-more-models-link="true"
              >
                <Brain className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{moreModelsLabel}</span>
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {!isCollapsed ? (
        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <SidebarSectionLabel
            icon={Clock3}
            label={historyLabel}
            dataAttr="data-chat-history-section"
          />
          <div
            className="mt-3 grid max-h-56 gap-1 overflow-y-auto pr-1 lg:max-h-none"
            data-chat-history-list="true"
          >
            {sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                {noHistoryLabel}
              </div>
            ) : null}
            {sessions.map((session) => (
              <WorkspaceHistoryItem
                key={session.id}
                id={session.id}
                title={session.title}
                isActive={session.id === currentSessionId}
                deleteLabel={deleteLabel}
                onSelect={() => onSelectSession(session.id)}
                onDelete={() => onDeleteSession(session.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
