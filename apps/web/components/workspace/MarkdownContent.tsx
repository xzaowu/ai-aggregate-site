"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";

export type MarkdownContentVariant = "chat" | "compact" | "workspace";

function getCodeElementData(children: React.ReactNode) {
  const child = React.Children.toArray(children)[0];
  if (!React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)) {
    return null;
  }

  return {
    className: child.props.className,
    rawCode: String(child.props.children ?? "")
  };
}

function getCodeLanguage(className: string | undefined): string {
  const match = /language-([\w-]+)/.exec(className ?? "");
  return match?.[1] ?? "text";
}

function getRootClassName(
  variant: MarkdownContentVariant,
  className: string | undefined
): string {
  const base = variant === "chat"
    ? "chat-markdown min-w-0 max-w-full break-words text-slate-700 dark:text-slate-200 [overflow-wrap:anywhere]"
    : variant === "compact"
      ? "canvas-markdown canvas-markdown-compact min-w-0 max-w-full break-words text-xs leading-5 text-slate-700 dark:text-slate-200 [overflow-wrap:anywhere]"
      : "canvas-markdown min-w-0 max-w-full break-words text-sm leading-6 text-slate-700 dark:text-slate-200 [overflow-wrap:anywhere]";

  return [base, className].filter(Boolean).join(" ");
}

export function MarkdownContent({
  content,
  locale = "zh-CN",
  variant = "chat",
  headingIdPrefix,
  className
}: {
  content: string;
  locale?: string;
  variant?: MarkdownContentVariant;
  headingIdPrefix?: string;
  className?: string;
}) {
  const copyLabel = locale === "en-US" ? "Copy" : "复制";
  const copiedLabel = locale === "en-US" ? "Copied" : "已复制";
  let headingIndex = 0;
  const headingClassName = "text-slate-900 dark:text-slate-100";

  const components: Components = {
    h1: ({ node: _node, ...props }) => (
      <h1
        {...(headingIdPrefix
          ? { id: `${headingIdPrefix}-${headingIndex++}` }
          : {})}
        className={headingClassName}
        {...props}
      />
    ),
    h2: ({ node: _node, ...props }) => (
      <h2
        {...(headingIdPrefix
          ? { id: `${headingIdPrefix}-${headingIndex++}` }
          : {})}
        className={headingClassName}
        {...props}
      />
    ),
    h3: ({ node: _node, ...props }) => (
      <h3
        {...(headingIdPrefix
          ? { id: `${headingIdPrefix}-${headingIndex++}` }
          : {})}
        className={headingClassName}
        {...props}
      />
    ),
    table: ({ node: _node, ...props }) => (
      <div
        className={[
          variant === "chat" ? "my-4" : "my-2",
          "max-w-full",
          variant === "compact" ? "overflow-hidden" : "overflow-x-auto overscroll-x-contain",
          "rounded-xl border border-slate-200 dark:border-slate-700"
        ].join(" ")}
      >
        <table
          className={[
            "w-full border-collapse",
            variant === "compact" ? "min-w-0 table-fixed text-[10px] leading-4" : "min-w-[36rem] text-sm"
          ].join(" ")}
          {...props}
        />
      </div>
    ),
    thead: ({ node: _node, ...props }) => (
      <thead className="bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200" {...props} />
    ),
    th: ({ node: _node, ...props }) => (
      <th
        className={[
          "border-b border-slate-200 text-left font-semibold dark:border-slate-700",
          variant === "compact"
            ? "break-words px-1.5 py-1 [overflow-wrap:anywhere]"
            : "px-3 py-2"
        ].join(" ")}
        {...props}
      />
    ),
    td: ({ node: _node, ...props }) => (
      <td
        className={[
          "align-top break-words border-b border-slate-100 text-slate-700 [overflow-wrap:anywhere] dark:border-slate-800 dark:text-slate-300",
          variant === "compact" ? "px-1.5 py-1" : "px-3 py-2"
        ].join(" ")}
        {...props}
      />
    ),
    pre: ({ node: _node, children }) => {
      const code = getCodeElementData(children);
      if (variant === "compact") {
        return (
          <pre
            className="my-2 max-w-full overflow-hidden whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-2 text-[10px] leading-4 text-slate-100 [overflow-wrap:anywhere]"
            data-markdown-code-compact="true"
            {...(code
              ? { "data-markdown-code-language": getCodeLanguage(code.className) }
              : {})}
          >
            {children}
          </pre>
        );
      }
      return code ? (
        <MarkdownCodeBlock
          className={code.className}
          rawCode={code.rawCode}
          copyLabel={copyLabel}
          copiedLabel={copiedLabel}
        />
      ) : (
        <pre className="max-w-full overflow-x-auto overscroll-x-contain">{children}</pre>
      );
    },
    code: ({ node: _node, className: codeClassName, children, ...props }) => (
      <code
        className={codeClassName ?? "rounded bg-slate-100 px-1.5 py-0.5 text-slate-800 dark:bg-slate-800 dark:text-slate-100"}
        {...props}
      >
        {children}
      </code>
    ),
    blockquote: ({ node: _node, ...props }) => (
      <blockquote
        className="border-l-4 border-slate-300 bg-slate-50 pl-4 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
        {...props}
      />
    ),
    a: ({ node: _node, ...props }) => (
      <a
        className="break-all text-indigo-600 underline underline-offset-2 hover:text-indigo-700 dark:text-indigo-400 [overflow-wrap:anywhere]"
        {...props}
      />
    ),
    del: ({ node: _node, ...props }) => (
      <del className="text-slate-700 dark:text-slate-300" {...props} />
    ),
    hr: ({ node: _node, ...props }) => (
      <hr className="border-slate-200 dark:border-slate-700" {...props} />
    ),
    input: ({ node: _node, ...props }) => (
      <input className="mr-2 size-4 align-middle accent-indigo-600 opacity-100" {...props} />
    )
  };

  return (
    <div
      className={getRootClassName(variant, className)}
      {...(variant === "chat"
        ? {}
        : { "data-markdown-content-variant": variant })}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
