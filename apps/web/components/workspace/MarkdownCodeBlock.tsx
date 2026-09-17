"use client";

import React, { useEffect, useRef, useState } from "react";

export interface MarkdownClipboard {
  writeText: (text: string) => Promise<void>;
}

export async function copyMarkdownCode(
  rawCode: string,
  clipboard: MarkdownClipboard | null | undefined
): Promise<boolean> {
  if (!clipboard) {
    return false;
  }

  try {
    await clipboard.writeText(rawCode);
    return true;
  } catch {
    return false;
  }
}

function getLanguage(className: string | undefined): string {
  const match = /language-([\w-]+)/.exec(className ?? "");
  return match?.[1] ?? "text";
}

export function MarkdownCodeBlock({
  className,
  rawCode,
  copyLabel = "Copy",
  copiedLabel = "Copied"
}: {
  className?: string;
  rawCode: string;
  copyLabel?: string;
  copiedLabel?: string;
}) {
  const language = getLanguage(className);
  const [isCopied, setIsCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    const copied = await copyMarkdownCode(
      rawCode,
      typeof navigator === "undefined" ? undefined : navigator.clipboard
    );

    if (!copied) {
      return;
    }

    setIsCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setIsCopied(false);
      resetTimerRef.current = null;
    }, 1800);
  }

  return (
    <div
      className="my-4 min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
      data-markdown-code-language={language}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">
        <span className="min-w-0 truncate">{language}</span>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-slate-300 transition hover:bg-slate-800 hover:text-white"
          onClick={() => void handleCopy()}
          data-markdown-copy-button="true"
        >
          {isCopied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain p-3 text-sm leading-6 text-slate-100">
        <code className="block min-w-max whitespace-pre text-slate-100">{rawCode}</code>
      </pre>
    </div>
  );
}
