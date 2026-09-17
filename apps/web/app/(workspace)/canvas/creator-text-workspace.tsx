"use client";

import { Eye, Pencil, Sparkles } from "lucide-react";
import React, { useState } from "react";
import { MarkdownContent } from "../../../components/workspace/MarkdownContent";
import { useI18n } from "../../../lib/i18n/use-i18n";
import {
  CreatorTextAiComposerPanel,
  type CreatorTextAiComposerView
} from "./creator-text-ai-panel";
import type { CreatorNodeWorkspaceRenderMode } from "./creator-node-workspace";

type CreatorTextWorkspaceView = "read" | "edit";

export interface CreatorTextWorkspaceProps {
  text: string;
  textAiComposer: CreatorTextAiComposerView | null;
  mode?: CreatorNodeWorkspaceRenderMode;
  onTextChange: (text: string) => void;
  onTextEditStart?: () => void;
  onTextEditEnd?: () => void;
}

function stopCanvasPropagation(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

function TextEditor({
  text,
  mode,
  onTextChange,
  onTextEditStart,
  onTextEditEnd,
  placeholder,
  label
}: {
  text: string;
  mode: CreatorNodeWorkspaceRenderMode;
  onTextChange: (text: string) => void;
  onTextEditStart?: () => void;
  onTextEditEnd?: () => void;
  placeholder: string;
  label: string;
}) {
  return (
    <textarea
      className={`nodrag nopan nowheel min-h-44 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-indigo-900 ${
        mode === "focus" ? "min-h-[24rem]" : ""
      }`}
      value={text}
      onFocus={onTextEditStart}
      onBlur={onTextEditEnd}
      onChange={(event) => onTextChange(event.target.value)}
      onKeyDown={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
      placeholder={placeholder}
      aria-label={label}
      data-creator-text-workspace-editor="true"
      data-creator-text-workspace-editor-mode={mode}
    />
  );
}

function TextPreview({
  text,
  emptyLabel,
  mode,
  locale
}: {
  text: string;
  emptyLabel: string;
  mode: CreatorNodeWorkspaceRenderMode;
  locale: string;
}) {
  return text.trim().length > 0 ? (
    <MarkdownContent
      content={text}
      locale={locale}
      variant={mode === "focus" ? "workspace" : "compact"}
      className="min-w-0"
    />
  ) : (
    <p
      className="text-sm leading-6 text-slate-400 dark:text-slate-500"
      data-creator-text-workspace-empty="true"
    >
      {emptyLabel}
    </p>
  );
}

function TextWorkspaceControls({
  view,
  onViewChange,
  readLabel,
  editLabel
}: {
  view: CreatorTextWorkspaceView;
  onViewChange: (view: CreatorTextWorkspaceView) => void;
  readLabel: string;
  editLabel: string;
}) {
  return (
    <div
      className="nodrag nopan nowheel inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800"
      role="tablist"
      aria-label={`${readLabel} / ${editLabel}`}
      onKeyDown={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <button
        type="button"
        role="tab"
        className={`nodrag nopan nowheel inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
          view === "read"
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        }`}
        aria-selected={view === "read"}
        onClick={() => onViewChange("read")}
        data-creator-text-workspace-view="read"
      >
        <Eye className="size-3.5" aria-hidden="true" />
        {readLabel}
      </button>
      <button
        type="button"
        role="tab"
        className={`nodrag nopan nowheel inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
          view === "edit"
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        }`}
        aria-selected={view === "edit"}
        onClick={() => onViewChange("edit")}
        data-creator-text-workspace-view="edit"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        {editLabel}
      </button>
    </div>
  );
}

export function CreatorTextWorkspace({
  text,
  textAiComposer,
  mode = "workspace",
  onTextChange,
  onTextEditStart,
  onTextEditEnd
}: CreatorTextWorkspaceProps) {
  const { locale, t } = useI18n();
  const [view, setView] = useState<CreatorTextWorkspaceView>("read");
  const characterCount = t("creator.canvas.textCharacterCount", { count: text.length });
  const currentTextLabel = t("creator.canvas.textWorkspace.currentText");
  const editor = (
    <TextEditor
      text={text}
      mode={mode}
      onTextChange={onTextChange}
      onTextEditStart={onTextEditStart}
      onTextEditEnd={onTextEditEnd}
      placeholder={t("creator.canvas.textPlaceholder")}
      label={t("creator.canvas.textInput")}
    />
  );

  if (mode === "focus") {
    return (
      <div
        className="nodrag nopan nowheel flex min-w-0 flex-col gap-5"
        data-creator-text-workspace="true"
        data-creator-text-workspace-mode="focus"
        onKeyDown={stopCanvasPropagation}
        onPointerDown={stopCanvasPropagation}
        onWheel={stopCanvasPropagation}
      >
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <section className="nodrag nopan nowheel min-w-0" aria-labelledby="creator-text-source-label">
            <div className="flex items-center justify-between gap-3">
              <h3 id="creator-text-source-label" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {currentTextLabel}
              </h3>
              <span className="text-[10px] text-slate-400 dark:text-slate-500" data-creator-text-character-count="true">
                {characterCount}
              </span>
            </div>
            <div className="mt-2">{editor}</div>
          </section>
          <section className="nodrag nopan nowheel min-w-0" aria-labelledby="creator-text-preview-label">
            <h3 id="creator-text-preview-label" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t("creator.canvas.textWorkspace.preview")}
            </h3>
            <div className="mt-2 min-h-44 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800" data-creator-text-workspace-preview="true">
              <TextPreview
                text={text}
                emptyLabel={t("creator.canvas.textPlaceholder")}
                mode={mode}
                locale={locale}
              />
            </div>
          </section>
        </div>
        {textAiComposer ? (
          <section className="nodrag nopan nowheel border-t border-slate-200 pt-4 dark:border-slate-700" data-creator-text-workspace-ai="true">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Sparkles className="size-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              {t("creator.canvas.textWorkspace.ai")}
            </div>
            <CreatorTextAiComposerPanel {...textAiComposer} presentation="workspace" />
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="nodrag nopan nowheel flex min-w-0 flex-col gap-3"
      data-creator-text-workspace="true"
      data-creator-text-workspace-mode="workspace"
      onKeyDown={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <div className="flex items-center justify-between gap-3">
        <TextWorkspaceControls
          view={view}
          onViewChange={setView}
          readLabel={t("creator.canvas.textWorkspace.read")}
          editLabel={t("creator.canvas.textWorkspace.edit")}
        />
        <span className="text-[10px] text-slate-400 dark:text-slate-500" data-creator-text-character-count="true">
          {characterCount}
        </span>
      </div>
      <section className="min-w-0" aria-label={currentTextLabel}>
        <h3 className="sr-only">{currentTextLabel}</h3>
        {view === "edit" ? (
          editor
        ) : (
          <div
            className="min-h-44 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
            data-creator-text-workspace-preview="true"
          >
            <TextPreview
              text={text}
              emptyLabel={t("creator.canvas.textPlaceholder")}
              mode={mode}
              locale={locale}
            />
          </div>
        )}
      </section>
      {textAiComposer ? (
        <section className="nodrag nopan nowheel border-t border-slate-200 pt-3 dark:border-slate-700" data-creator-text-workspace-ai="true">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Sparkles className="size-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            {t("creator.canvas.textWorkspace.ai")}
          </div>
          <CreatorTextAiComposerPanel {...textAiComposer} presentation="workspace" />
        </section>
      ) : null}
    </div>
  );
}
