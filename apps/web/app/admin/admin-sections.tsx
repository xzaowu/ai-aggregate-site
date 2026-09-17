"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  adminSections,
  adminSettingsAreas,
  getAdminSectionFromPathname
} from "./admin-navigation";
import type {
  AdminSectionId,
  AdminSettingsAreaId
} from "./admin-navigation";

export {
  adminSections,
  defaultAdminSection,
  type AdminSectionId
} from "./admin-navigation";

export function AdminSectionTabs() {
  const { t } = useI18n();
  const activeSection = getAdminSectionFromPathname(usePathname());

  return (
    <nav
      aria-label="Admin sections"
      className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-sm"
      data-active-section={activeSection}
      role="tablist"
    >
      <div className="flex min-w-max gap-1">
        {adminSections.map((section) => {
          const isActive = activeSection === section.id;

          return (
            <Link
              key={section.id}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
                  : "rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
              }
              href={section.href}
              role="tab"
            >
              {t(section.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AdminSettingsAreaNavigation({
  activeArea
}: {
  activeArea: AdminSettingsAreaId;
}) {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("admin.settingsAreaNav")}
      className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
    >
      {adminSettingsAreas.map((area) => {
        const active = activeArea === area.id;

        return (
          <Link
            key={area.id}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"
                : "rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            }
            href={area.href}
          >
            {t(area.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminScrollableRegion({
  children,
  className = "",
  maxHeight
}: {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div
      className={maxHeight ? `overflow-auto ${className}` : `overflow-x-auto ${className}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {children}
    </div>
  );
}
