import type { LucideIcon } from "lucide-react";
import React from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const variants = {
    primary:
      "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:text-white/80 dark:hover:bg-indigo-500 dark:disabled:bg-slate-700",
    secondary:
      "border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-indigo-200 hover:text-indigo-700 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-indigo-400 dark:disabled:text-slate-600",
    ghost:
      "text-slate-600 hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-400 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 dark:disabled:text-slate-600"
  };

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-none ${className}`}
    >
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = "slate",
  className = ""
}: {
  children: ReactNode;
  tone?: "slate" | "indigo" | "emerald" | "amber";
  className?: string;
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
    amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
  };

  return (
    <span
      className={`inline-flex min-w-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function IconBadge({
  icon: Icon,
  label,
  className = ""
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 ${className}`}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
