"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useId, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  workspaceCreationSurfaceNavItems,
  type WorkspaceCreationSurfaceKey
} from "./workspace-navigation";

export function CreationSurfaceSwitcher({
  activeSurface,
  className = ""
}: {
  activeSurface: WorkspaceCreationSurfaceKey;
  className?: string;
}) {
  const { t } = useI18n();
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const activeItem = workspaceCreationSurfaceNavItems.find(
    (item) => item.key === activeSurface
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!activeItem) return null;

  return (
    <div
      className={`relative min-w-0 ${className}`}
      data-creation-surface-switcher="true"
      data-creation-surface-active={activeSurface}
    >
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1 rounded-xl px-1 py-1 text-base font-bold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-100"
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
        data-creation-surface-trigger="true"
      >
        <span className="truncate">{t(activeItem.labelKey)}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </button>
      <nav
        id={menuId}
        className={`absolute left-0 top-10 z-40 grid w-52 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${
          isOpen ? "" : "hidden"
        }`}
        aria-label={t("workspace.mobile.creation")}
        aria-hidden={isOpen ? "false" : "true"}
        data-creation-surface-menu="true"
      >
        {workspaceCreationSurfaceNavItems.map((item) => {
          const active = item.key === activeSurface;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={
                active
                  ? "rounded-lg bg-indigo-50 px-3 py-2 text-left text-sm font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                  : "rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
              }
              aria-current={active ? "page" : undefined}
              onClick={() => setIsOpen(false)}
              data-creation-surface-option={item.key}
            >
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
