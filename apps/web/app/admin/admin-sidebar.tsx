"use client";

import {
  BarChart3,
  Cloud,
  Coins,
  Database,
  FileText,
  LayoutDashboard,
  Link2,
  Mail,
  MessageSquare,
  Server,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Users,
  WalletCards,
  X
} from "lucide-react";
import Link from "next/link";
import React from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  adminNavigationGroups,
  adminSidebarSections,
  getAdminSectionFromPathname,
  getAdminSidebarSection,
  type AdminNavigationGroupId,
  type AdminSectionId,
  type AdminSidebarIconKey
} from "./admin-navigation";

interface AdminSidebarItem {
  id: AdminSectionId;
  labelKey: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  href: string;
  groupId?: AdminNavigationGroupId;
}

const sidebarIconMap: Record<AdminSidebarIconKey, AdminSidebarItem["Icon"]> = {
  overview: LayoutDashboard,
  users: Users,
  feedback: MessageSquare,
  models: Database,
  providerAccounts: Server,
  moderation: ShieldCheck,
  plans: Coins,
  orders: ShoppingCart,
  payments: WalletCards,
  storageSubscriptions: Cloud,
  settings: Settings,
  links: Link2,
  contact: Mail,
  operations: SlidersHorizontal,
  usage: BarChart3,
  audit: FileText
};

const sidebarItems: AdminSidebarItem[] = adminSidebarSections.map((section) => ({
  id: section.id,
  labelKey: section.sidebar.labelKey,
  href: section.href,
  Icon: sidebarIconMap[section.sidebar.icon],
  groupId: section.sidebar.groupId
}));

const sidebarNavigation = [
  ...sidebarItems
    .filter((item) => !item.groupId)
    .map((item) => ({
      kind: "item" as const,
      order:
        adminSidebarSections.find((section) => section.id === item.id)?.sidebar
          .order ?? 0,
      item
    })),
  ...adminNavigationGroups.map((group) => ({
    kind: "group" as const,
    order: group.order,
    group,
    items: sidebarItems.filter((item) => item.groupId === group.id)
  }))
].sort((left, right) => left.order - right.order);

export interface AdminSidebarProps {
  onNavigate?: () => void;
}

export function AdminSidebar({ onNavigate }: AdminSidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const activeSection = getAdminSectionFromPathname(pathname);
  const activeSidebarSection = activeSection
    ? getAdminSidebarSection(activeSection)
    : null;

  return (
    <aside
      aria-label="Admin navigation"
      className="flex h-full flex-col border-r border-slate-200 bg-white"
    >
      {/* Branding area */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white">
          <Settings className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight text-slate-950">
            {t("admin.title")}
          </div>
          <div className="truncate text-[11px] font-medium text-slate-500">
            {t("admin.shellLabel")}
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="grid gap-2">
          {sidebarNavigation.map((entry) => {
            if (entry.kind === "item") {
              return (
                <AdminSidebarLink
                  key={entry.item.id}
                  active={activeSidebarSection?.id === entry.item.id}
                  item={entry.item}
                  label={t(entry.item.labelKey)}
                  onNavigate={onNavigate}
                />
              );
            }

            const active = entry.items.some(
              (item) => item.id === activeSidebarSection?.id
            );
            return (
              <section
                key={entry.group.id}
                aria-label={t(entry.group.labelKey)}
                className="grid gap-1 py-2"
                data-active={active ? "true" : "false"}
                data-admin-navigation-group={entry.group.id}
              >
                <div
                  className={
                    active
                      ? "border-l-2 border-indigo-600 px-3 pb-1 text-[11px] font-semibold tracking-wide text-indigo-700"
                      : "border-l-2 border-slate-200 px-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-400"
                  }
                >
                  {t(entry.group.labelKey)}
                </div>
                {entry.items.map((item) => (
                  <AdminSidebarLink
                    key={item.id}
                    active={activeSidebarSection?.id === item.id}
                    item={item}
                    label={t(item.labelKey)}
                    onNavigate={onNavigate}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </nav>

      {/* Back to site link */}
      <div className="border-t border-slate-200 px-3 py-4">
        <Link
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          href="/"
        >
          <X className="size-3.5" aria-hidden="true" />
          {t("admin.backToSite")}
        </Link>
      </div>
    </aside>
  );
}

function AdminSidebarLink({
  active,
  item,
  label,
  onNavigate
}: {
  active: boolean;
  item: AdminSidebarItem;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "flex min-w-0 items-center gap-3 rounded-lg border-l-2 border-indigo-600 bg-indigo-50 px-2.5 py-2.5 text-sm font-semibold text-indigo-700"
          : "flex min-w-0 items-center gap-3 rounded-lg border-l-2 border-transparent px-2.5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
      }
      href={item.href}
      onClick={onNavigate}
    >
      <item.Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export { sidebarItems };
