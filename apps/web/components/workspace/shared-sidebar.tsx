"use client";

import type { LucideIcon } from "lucide-react";
import {
  PanelLeftClose,
  PanelRightOpen,
  Plus,
  Trash2
} from "lucide-react";
import React from "react";
import { useOptionalWorkspaceShellContext } from "./workspace-shell-context";

export function SecondarySidebarHeader({
  icon: Icon,
  iconClassName,
  title,
  collapsed,
  onToggle,
  toggleLabel,
  dataCollapseAttr,
  dataExpandAttr
}: {
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  toggleLabel?: string;
  dataCollapseAttr?: string;
  dataExpandAttr?: string;
}) {
  if (collapsed) {
    return (
      <div className="flex justify-center">
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label={toggleLabel ?? "Expand"}
          title={toggleLabel ?? "Expand"}
          onClick={onToggle}
          {...(dataExpandAttr ? { [dataExpandAttr]: "true" } : {})}
        >
          <PanelRightOpen className="size-5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 ${iconClassName ?? ""}`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </div>
      </div>
      <button
        type="button"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        aria-label={toggleLabel ?? "Collapse"}
        title={toggleLabel ?? "Collapse"}
        onClick={onToggle}
        {...(dataCollapseAttr ? { [dataCollapseAttr]: "true" } : {})}
      >
        <PanelLeftClose className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function SidebarSectionLabel({
  icon: Icon,
  label,
  dataAttr
}: {
  icon: LucideIcon;
  label: string;
  dataAttr?: string;
}) {
  return (
    <div
      className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500"
      {...(dataAttr ? { [dataAttr]: "true" } : {})}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </div>
  );
}

export function SidebarNewSessionButton({
  label,
  collapsibleLabel,
  collapsed,
  isLoggedIn,
  loginHint,
  loginLabel,
  onCreateSession,
  dataAttr
}: {
  label: string;
  collapsibleLabel?: string;
  collapsed: boolean;
  isLoggedIn: boolean;
  loginHint: string;
  loginLabel: string;
  onCreateSession: () => void;
  dataAttr?: string;
}) {
  const workspaceShell = useOptionalWorkspaceShellContext();

  if (!isLoggedIn) {
    if (collapsed) {
      return (
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label={loginLabel}
          title={loginLabel}
          onClick={() => workspaceShell?.openAuthDialog()}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      );
    }
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
        {loginHint}
        <button
          type="button"
          className="mt-3 inline-flex text-sm font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          onClick={() => workspaceShell?.openAuthDialog()}
        >
          {loginLabel}
        </button>
      </div>
    );
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
        aria-label={collapsibleLabel ?? label}
        title={collapsibleLabel ?? label}
        onClick={onCreateSession}
        {...(dataAttr ? { [dataAttr]: "true" } : {})}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
      onClick={onCreateSession}
      {...(dataAttr ? { [dataAttr]: "true" } : {})}
    >
      <Plus className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export interface WorkspaceHistoryItemProps {
  id: string;
  title: string;
  isActive: boolean;
  deleteLabel: string;
  onSelect: () => void;
  onDelete: () => void;
}

export function WorkspaceHistoryItem({
  id,
  title,
  isActive,
  deleteLabel,
  onSelect,
  onDelete
}: WorkspaceHistoryItemProps) {
  return (
    <div
      className={
        isActive
          ? "group flex min-w-0 items-stretch gap-1 rounded-2xl bg-slate-100 p-1.5 text-slate-900 ring-1 ring-slate-200 dark:bg-slate-800/80 dark:text-slate-100 dark:ring-slate-700"
          : "group flex min-w-0 items-stretch gap-1 rounded-2xl p-1.5 text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/80"
      }
    >
      <button
        type="button"
        className="min-w-0 flex-1 overflow-hidden rounded-xl px-2.5 py-1 text-left"
        onClick={onSelect}
      >
        <span className="block truncate text-sm font-semibold" title={title}>
          {title}
        </span>
      </button>
      <button
        type="button"
        className={
          isActive
            ? "shrink-0 rounded-xl px-2 text-slate-400 transition hover:bg-white/60 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            : "shrink-0 rounded-xl px-2 text-slate-300 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-600 dark:hover:bg-red-950 dark:hover:text-red-400"
        }
        aria-label={`${deleteLabel} ${title}`}
        title={deleteLabel}
        onClick={onDelete}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
