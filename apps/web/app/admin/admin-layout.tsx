"use client";

import { X } from "lucide-react";
import React from "react";

/* ------------------------------------------------------------------ */
/*  AdminPageShell – full-width content area next to the sidebar      */
/*  No mx-auto, no max-w, just padding that adapts to viewport.       */
/* ------------------------------------------------------------------ */

export function AdminPageShell({ children }: { children: React.ReactNode }) {
  return <div className="w-full min-w-0 px-4 py-6 sm:px-6 xl:px-8 2xl:px-10">{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  AdminPageHeader – compact inline header (no card / no shadow)     */
/* ------------------------------------------------------------------ */

export interface AdminPageHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  children
}: AdminPageHeaderProps) {
  return (
    <header
      className="flex flex-col gap-5 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-start sm:justify-between"
      data-admin-page-header="true"
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? (
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">
          {description}
        </p>
      </div>
      {children ? (
        <div className="flex w-full shrink-0 flex-wrap gap-3 sm:w-auto">
          {children}
        </div>
      ) : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminToolbar – lightweight inline toolbar for section actions     */
/* ------------------------------------------------------------------ */

export function AdminToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminSection – thin-bordered section (replaces heavy SectionCard) */
/* ------------------------------------------------------------------ */

export function AdminSection({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}
    >
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminSectionHeader – compact section title bar                   */
/* ------------------------------------------------------------------ */

export function AdminSectionHeader({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminDataTable – overflow-x-only table wrapper (no vert scroll)   */
/* ------------------------------------------------------------------ */

export function AdminDataTable({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 overflow-x-auto ${className}`}
      data-admin-data-region="true"
    >
      {children}
    </div>
  );
}

export const adminControlClass =
  "min-h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100";

export function AdminFormSection({
  title,
  description,
  className = "",
  children
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`grid min-w-0 content-start gap-4 rounded-xl border border-slate-200 bg-white p-4 ${className}`}
      data-admin-form-section="true"
    >
      <div className="grid min-w-0 gap-1">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        {description ? (
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function AdminFormField({
  label,
  help,
  error,
  className = "",
  children
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const fieldId = `admin-field-${React.useId().replace(/:/g, "")}`;
  const helpId = help ? `${fieldId}-help` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const control = React.isValidElement(children)
    ? React.cloneElement(
        children as React.ReactElement<Record<string, unknown>>,
        {
          id:
            typeof (children.props as { id?: unknown }).id === "string"
              ? (children.props as { id: string }).id
              : fieldId,
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
          ...(error ? { "aria-invalid": true } : {})
        }
      )
    : children;

  return (
    <div className={`grid min-w-0 gap-1.5 ${className}`} data-admin-form-field="true">
      <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-700">
        <span>{label}</span>
        {control}
      </label>
      {help ? (
        <p className="whitespace-pre-wrap text-xs leading-5 text-slate-500" id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-semibold leading-5 text-rose-700" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AdminFormMessage({
  children,
  tone,
  role,
  live = "polite",
  className = ""
}: {
  children: React.ReactNode;
  tone: "neutral" | "success" | "warning" | "error";
  role?: "status" | "alert";
  live?: "polite" | "assertive" | "off";
  className?: string;
}) {
  const tones = {
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-rose-200 bg-rose-50 text-rose-800"
  };

  return (
    <div
      aria-live={live}
      className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]} ${className}`}
      role={role}
      data-admin-form-message={tone}
    >
      {children}
    </div>
  );
}

export function AdminFormActions({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-wrap items-center justify-end gap-2 ${className}`}
      data-admin-form-actions="true"
    >
      {children}
    </div>
  );
}

export type AdminTableColumnPriority = "primary" | "secondary" | "tertiary";
export type AdminStatusTone =
  | "slate"
  | "indigo"
  | "emerald"
  | "amber"
  | "rose";

function adminColumnPriorityClass(priority: AdminTableColumnPriority): string {
  if (priority === "secondary") return "hidden sm:table-cell";
  if (priority === "tertiary") return "hidden lg:table-cell";
  return "";
}

export function AdminTableHeadCell({
  children,
  className = "",
  priority = "primary"
}: {
  children: React.ReactNode;
  className?: string;
  priority?: AdminTableColumnPriority;
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${adminColumnPriorityClass(priority)} ${className}`}
      data-admin-column-priority={priority}
      scope="col"
    >
      {children}
    </th>
  );
}

export function AdminTableCell({
  children,
  className = "",
  priority = "primary",
  title
}: {
  children: React.ReactNode;
  className?: string;
  priority?: AdminTableColumnPriority;
  title?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 align-middle ${adminColumnPriorityClass(priority)} ${className}`}
      data-admin-column-priority={priority}
      title={title}
    >
      {children}
    </td>
  );
}

export function AdminTableRow({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={`text-slate-700 transition-colors hover:bg-slate-50/80 ${className}`}
      data-admin-table-row="true"
    >
      {children}
    </tr>
  );
}

export function AdminTableEmptyRow({
  colSpan,
  children
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr data-admin-empty-state="true">
      <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}

export function AdminStatusBadge({
  children,
  tone
}: {
  children: React.ReactNode;
  tone: AdminStatusTone;
}) {
  const tones: Record<AdminStatusTone, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700"
  };

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-semibold leading-4 ${tones[tone]}`}
      data-admin-status-badge="true"
      data-admin-status-tone={tone}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminDrawer – native modal right-side drawer shell               */
/* ------------------------------------------------------------------ */

interface AdminDrawerContextValue {
  titleId: string;
  descriptionId: string;
}

const AdminDrawerContext = React.createContext<AdminDrawerContextValue | null>(null);

export function AdminDrawer({
  open,
  children,
  onClose
}: {
  open: boolean;
  children: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const titleId = `admin-drawer-title-${React.useId().replace(/:/g, "")}`;
  const descriptionId = `admin-drawer-description-${React.useId().replace(/:/g, "")}`;

  React.useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const activeElement = document.activeElement;
    openerRef.current =
      activeElement instanceof HTMLElement && !dialog.contains(activeElement)
        ? activeElement
        : null;

    if (!dialog.open) {
      if (typeof dialog.showModal !== "function") {
        return;
      }
      dialog.showModal();
    }

    dialog.querySelector<HTMLElement>("[data-admin-drawer-close=\"true\"]")?.focus();

    return () => {
      if (dialog.open) {
        dialog.close();
      }

      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && document.contains(opener)) {
        window.requestAnimationFrame(() => {
          if (document.contains(opener)) {
            opener.focus();
          }
        });
      }
    };
  }, [open]);

  if (!open) return null;

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <AdminDrawerContext.Provider value={{ titleId, descriptionId }}>
      <dialog
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="fixed inset-0 z-50 m-0 flex h-[100dvh] max-h-none w-full max-w-none justify-end overflow-hidden border-0 bg-slate-950/30 p-0 backdrop:bg-slate-950/30"
        data-admin-drawer-dialog="true"
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        onClick={handleBackdropClick}
      >
    <aside className="relative flex h-full min-h-0 min-w-0 w-full max-w-[860px] flex-col overflow-hidden bg-white shadow-2xl">
          {children}
        </aside>
      </dialog>
    </AdminDrawerContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminDrawerHeader – title + description + X close button         */
/* ------------------------------------------------------------------ */

export function AdminDrawerHeader({
  title,
  description,
  onClose,
  closeLabel,
  iconButtonClass
}: {
  title: string;
  description: string;
  onClose: () => void;
  closeLabel: string;
  iconButtonClass: string;
}) {
  const drawerContext = React.useContext(AdminDrawerContext);

  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-slate-950" id={drawerContext?.titleId}>
          {title}
        </h3>
        <p className="mt-1 text-sm leading-6 text-slate-500" id={drawerContext?.descriptionId}>
          {description}
        </p>
      </div>
      <button
        aria-label={closeLabel}
        className={`${iconButtonClass} min-h-10 min-w-10 shrink-0`}
        data-admin-drawer-close="true"
        type="button"
        onClick={onClose}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminDrawerBody – independently scrollable body area             */
/* ------------------------------------------------------------------ */

export function AdminDrawerBody({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/70 p-5">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminDrawerFooter – fixed bottom bar for save / cancel actions   */
/* ------------------------------------------------------------------ */

export function AdminDrawerFooter({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4">
      {children}
    </div>
  );
}
