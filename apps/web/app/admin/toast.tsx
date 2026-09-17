"use client";

import { CheckCircle2, X, XCircle } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

export type ToastType = "success" | "error";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface AdminToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  dismissLabel: string;
}

export function AdminToastContainer({
  toasts,
  onDismiss,
  dismissLabel
}: AdminToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed right-4 top-4 z-50 grid gap-3"
      role="status"
    >
      {toasts.map((toast) => (
        <AdminToast
          key={toast.id}
          toast={toast}
          dismissLabel={dismissLabel}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

function AdminToast({
  toast,
  dismissLabel,
  onDismiss
}: {
  toast: ToastItem;
  dismissLabel: string;
  onDismiss: (id: string) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast.type !== "success") return;

    timerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, 4000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.type, onDismiss]);

  const isSuccess = toast.type === "success";

  return (
    <div
      className={
        isSuccess
          ? "relative flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 pr-10 text-sm font-medium text-emerald-800 shadow-lg"
          : "relative flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 pr-10 text-sm font-medium text-rose-800 shadow-lg"
      }
    >
      {isSuccess ? (
        <CheckCircle2
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-emerald-600"
        />
      ) : (
        <XCircle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-rose-600"
        />
      )}
      <span className="min-w-0 break-words">{toast.message}</span>
      <button
        aria-label={dismissLabel}
        className={
          isSuccess
            ? "absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full text-emerald-600 transition hover:bg-emerald-100"
            : "absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full text-rose-600 transition hover:bg-rose-100"
        }
        type="button"
        onClick={() => onDismiss(toast.id)}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

let nextToastId = 0;

export function useAdminToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (type: ToastType, message: string) => {
      const id = `admin-toast-${++nextToastId}`;
      setToasts((current) => [...current, { id, type, message }]);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
