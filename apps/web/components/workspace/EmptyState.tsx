import { Sparkles } from "lucide-react";
import React, { useState } from "react";
import { PromptSuggestionCard } from "./PromptSuggestionCard";
import { IconBadge } from "./ui";
import { CHAT_CONTENT_CLASS_NAME } from "../../lib/chat-layout";

export interface PromptSuggestion {
  title: string;
  description: string;
  prompt: string;
}

export function EmptyState({
  headline,
  subtitle,
  promptSuggestionsLabel,
  mode = "desktop",
  suggestions,
  onSelectPrompt,
  workspaceIconUrl,
  workspaceIconText,
}: {
  headline: string;
  subtitle: string;
  promptSuggestionsLabel: string;
  mode?: "desktop" | "mobile";
  suggestions: PromptSuggestion[];
  onSelectPrompt: (prompt: string) => void;
  workspaceIconUrl?: string | null;
  workspaceIconText?: string;
}) {
  if (mode === "mobile") {
    return (
      <div className={`${CHAT_CONTENT_CLASS_NAME} flex min-h-full items-center justify-center overflow-x-hidden py-8`}>
        <section className="grid max-w-sm justify-items-center text-center">
          <div className="mb-4 flex justify-center">
            <WorkspaceHeroIcon
              url={workspaceIconUrl}
              text={workspaceIconText}
              label={headline}
              className="size-14 rounded-3xl"
            />
          </div>
          <h1 className="text-balance text-2xl font-semibold leading-8 text-slate-950 dark:text-slate-100">
            {headline}
          </h1>
          <p className="mt-3 max-w-full break-words text-sm leading-6 text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className={`${CHAT_CONTENT_CLASS_NAME} grid gap-8 py-10 lg:py-14`}>
      <section className="text-center">
        <div className="mx-auto mb-5 flex justify-center">
          <WorkspaceHeroIcon
            url={workspaceIconUrl}
            text={workspaceIconText}
            label={headline}
          />
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl dark:text-slate-100">
          {headline}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-500 sm:text-base dark:text-slate-400">
          {subtitle}
        </p>
      </section>

      <section>
        <div className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
          {promptSuggestionsLabel}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {suggestions.map((suggestion) => (
            <PromptSuggestionCard
              key={suggestion.title}
              title={suggestion.title}
              description={suggestion.description}
              onSelect={() => onSelectPrompt(suggestion.prompt)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Renders the workspace hero icon: logo URL + text fallback + Sparkles fallback.
 */
function WorkspaceHeroIcon({
  url,
  text,
  label,
  className = "size-12 rounded-3xl",
}: {
  url?: string | null;
  text?: string;
  label: string;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (url && !imgFailed) {
    return (
      <span
        className={`${className} inline-flex size-12 shrink-0 overflow-hidden bg-indigo-600`}
      >
        <img
          alt={label}
          src={url}
          onError={() => setImgFailed(true)}
          className="size-full object-contain"
        />
      </span>
    );
  }

  if (text) {
    return (
      <span
        className={`${className} inline-flex size-12 shrink-0 items-center justify-center bg-indigo-600 text-sm font-bold text-white`}
      >
        {text.slice(0, 2)}
      </span>
    );
  }

  return (
    <IconBadge
      icon={Sparkles}
      label={label}
      className="size-12 rounded-3xl bg-indigo-600 text-white"
    />
  );
}
