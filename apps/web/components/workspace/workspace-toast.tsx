"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

export type WorkspaceToastType = "success" | "error" | "info";

export interface WorkspaceToastItem {
  id: string;
  type: WorkspaceToastType;
  message: string;
}

interface WorkspaceToastContainerProps {
  toasts: WorkspaceToastItem[];
  onDismiss: (id: string) => void;
}

export function WorkspaceToastContainer({
  toasts,
  onDismiss
}: WorkspaceToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed right-4 top-4 z-50 grid gap-2"
      role="status"
    >
      {toasts.map((toast) => (
        <WorkspaceToast
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

function WorkspaceToast({
  toast,
  onDismiss
}: {
  toast: WorkspaceToastItem;
  onDismiss: (id: string) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const duration = toast.type === "error" ? 5000 : 3000;

    timerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.type, onDismiss]);

  const isSuccess = toast.type === "success";
  const isError = toast.type === "error";

  const borderClass = isSuccess
    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
    : isError
      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
      : "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300";

  const icon =
    isSuccess ? (
      <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    ) : isError ? (
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    ) : (
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    );

  return (
    <div
      className={`relative flex items-start gap-3 rounded-2xl border px-4 py-3 pr-10 text-sm font-medium shadow-lg ${borderClass}`}
    >
      {icon}
      <span className="min-w-0 break-words">{toast.message}</span>
      <button
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full opacity-70 transition hover:opacity-100"
        type="button"
        onClick={() => onDismiss(toast.id)}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

let nextToastId = 0;

export function useWorkspaceToast() {
  const [toasts, setToasts] = useState<WorkspaceToastItem[]>([]);

  const showToast = useCallback(
    (type: WorkspaceToastType, message: string) => {
      const id = `ws-toast-${++nextToastId}`;
      setToasts((current) => [...current, { id, type, message }]);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
