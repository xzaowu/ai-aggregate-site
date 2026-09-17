"use client";

import {
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes
} from "@xyflow/react";
import {
  CircleAlert,
  CircleX,
  FileImage,
  LoaderCircle,
  Type,
  Video,
  type LucideIcon
} from "lucide-react";
import React, { memo } from "react";
import { MarkdownContent } from "../../../components/workspace/MarkdownContent";
import { ResolvedAssetImage } from "../../../components/workspace/ResolvedAssetImage";
import { ResolvedAssetVideo } from "../../../components/workspace/ResolvedAssetVideo";
import { useI18n } from "../../../lib/i18n/use-i18n";
import {
  useCreatorImageAssetDisplay,
  type CreatorImageAssetDisplayState
} from "./creator-image-asset-display";
import {
  useCreatorVideoAssetDisplay,
  type CreatorVideoAssetDisplayState
} from "./creator-video-asset-display";
import type { CreatorTextAiComposerView } from "./creator-text-ai-panel";
import type { CreatorVideoNodeExecutionView } from "./creator-video-composer-panel";
import type {
  CreatorContentNode,
  CreatorContentNodeKind
} from "./creator-canvas-document";
import type { CreatorImageNodeExecutionView } from "./creator-image-execution-state";

export interface CreatorCanvasViewActions {
  onTextChange: (nodeId: string, text: string) => void;
  onTextEditStart?: (nodeId: string) => void;
  onTextEditEnd?: (nodeId: string) => void;
  onChooseExistingImageAsset?: (nodeId: string) => void;
  onReplaceExistingImageAsset?: (nodeId: string) => void;
}

export interface CreatorCanvasViewData extends Record<string, unknown> {
  domainNode: CreatorContentNode;
  actions: CreatorCanvasViewActions;
  assetToken: string | null;
  imageAssetDisplay?: CreatorImageAssetDisplayState;
  videoAssetDisplay?: CreatorVideoAssetDisplayState;
  textAiComposer?: CreatorTextAiComposerView | null;
  imageExecution: CreatorImageNodeExecutionView | null;
  videoExecution?: CreatorVideoNodeExecutionView | null;
}

export type CreatorCanvasViewNode = Node<CreatorCanvasViewData, CreatorContentNodeKind>;
export type CreatorCanvasViewEdge = Edge<Record<string, never>, "smoothstep">;

export interface CreatorCanvasNodeDefinition {
  kind: CreatorContentNodeKind;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  component: React.ComponentType<NodeProps<CreatorCanvasViewNode>>;
  defaultWidth: number;
  minimapColor: string;
}

function CreatorCanvasConnectionHandles({
  kind,
  label
}: {
  kind: CreatorContentNodeKind;
  label: string;
}) {
  const { t } = useI18n();
  const canReceiveReference = kind === "text" || kind === "image" || kind === "video";
  const connectToLabel = t("creator.canvas.connectTo", { label });
  const connectFromLabel = t("creator.canvas.connectFrom", { label });
  return (
    <>
      {canReceiveReference ? (
        <Handle
          id="target"
          type="target"
          position={Position.Left}
          className="!size-3 !border-2 !border-white !bg-indigo-500 shadow-sm dark:!border-slate-900 dark:!bg-indigo-400"
          aria-label={connectToLabel}
          title={connectToLabel}
          data-creator-canvas-handle="target"
        />
      ) : null}
      <Handle
        id="source"
        type="source"
        position={Position.Right}
        className="!size-3 !border-2 !border-white !bg-indigo-500 shadow-sm dark:!border-slate-900 dark:!bg-indigo-400"
        aria-label={connectFromLabel}
        title={connectFromLabel}
        data-creator-canvas-handle="source"
      />
    </>
  );
}

function CreatorCanvasNodeCard({
  children,
  icon: Icon,
  kind,
  labelKey,
  nodeId,
  selected
}: {
  children: React.ReactNode;
  icon: LucideIcon;
  kind: CreatorContentNodeKind;
  labelKey: string;
  nodeId: string;
  selected: boolean;
}) {
  const { t } = useI18n();
  const label = t(labelKey);
  return (
    <section
      className={`relative w-full rounded-xl border bg-white p-3 shadow-md shadow-slate-950/10 transition dark:bg-slate-900 dark:shadow-black/30 ${
        selected
          ? "border-indigo-500 ring-2 ring-indigo-200 dark:border-indigo-400 dark:ring-indigo-900"
          : "border-slate-200 dark:border-slate-700"
      }`}
      aria-label={label}
      data-creator-canvas-node-id={nodeId}
      data-creator-canvas-node-kind={kind}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-950 dark:text-slate-100">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        {label}
      </div>
      <div className="mt-2">{children}</div>
      <CreatorCanvasConnectionHandles kind={kind} label={label} />
    </section>
  );
}

const TextCanvasNode = memo(function TextCanvasNode({
  id,
  data,
  selected
}: NodeProps<CreatorCanvasViewNode>) {
  const { locale, t } = useI18n();
  const text = data.domainNode.kind === "text" ? data.domainNode.data.text : "";
  return (
    <>
      <CreatorCanvasNodeCard
        icon={Type}
        kind="text"
        labelKey="creator.canvas.node.text"
        nodeId={id}
        selected={selected}
      >
        <div
          className="relative max-h-40 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800"
          data-creator-canvas-text-preview="true"
        >
          {text.trim().length > 0 ? (
            <MarkdownContent
              content={text}
              locale={locale}
              variant="compact"
              className="max-h-36 overflow-hidden"
            />
          ) : (
            <p
              className="min-h-20 text-xs leading-5 text-slate-400 dark:text-slate-500"
              data-creator-canvas-text-placeholder="true"
            >
              {t("creator.canvas.textPlaceholder")}
            </p>
          )}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-slate-50 to-transparent dark:from-slate-800"
            aria-hidden="true"
            data-creator-canvas-text-preview-fade="true"
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
          <span data-creator-canvas-text-character-count="true">
            {t("creator.canvas.textCharacterCount", { count: text.length })}
          </span>
          {data.textAiComposer ? (
            <span data-creator-canvas-text-ai-indicator="true">
              {t("creator.canvas.textAi.title")}
            </span>
          ) : null}
        </div>
      </CreatorCanvasNodeCard>
    </>
  );
});

const ImageCanvasNode = memo(function ImageCanvasNode({
  id,
  data,
  selected
}: NodeProps<CreatorCanvasViewNode>) {
  const { t } = useI18n();
  const assetId = data.domainNode.kind === "image"
    ? data.domainNode.data.assetId
    : null;
  const isBound = assetId !== null;
  const fallbackDisplay = useCreatorImageAssetDisplay({
    assetId,
    token: data.assetToken,
    enabled: isBound && data.imageAssetDisplay === undefined
  });
  const display = data.imageAssetDisplay ?? fallbackDisplay;
  const executionStatus = data.imageExecution?.status ?? null;
  const executionLabel = executionStatus === "generating"
    ? t("creator.canvas.node.imageExecution.generating")
    : executionStatus === "checking"
      ? t("creator.canvas.node.imageExecution.checking")
      : executionStatus === "unresolved"
        ? t("creator.canvas.node.imageExecution.unresolved")
        : executionStatus === "failed"
          ? t("creator.canvas.node.imageExecution.failed")
          : null;
  const replaceBlockedByExecution =
    executionStatus !== null && executionStatus !== "failed";
  const replaceDisabled = !data.assetToken || replaceBlockedByExecution;
  const replaceTitle = !data.assetToken
    ? t("creator.canvas.assetPicker.loginRequired")
    : replaceBlockedByExecution
      ? t("creator.canvas.assetPicker.replaceUnavailable")
      : undefined;
  const boundFallback = (
    <span data-creator-canvas-image-preview-fallback="true">
      {t("creator.canvas.imageBound")}
    </span>
  );
  return (
    <>
      <CreatorCanvasNodeCard
        icon={FileImage}
        kind="image"
        labelKey="creator.canvas.node.image"
        nodeId={id}
        selected={selected}
      >
        <div
          className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border bg-slate-50 text-center text-xs leading-5 text-slate-500 dark:bg-slate-800/70 dark:text-slate-400 ${
            isBound
              ? "border-solid border-slate-200 dark:border-slate-700"
              : "flex-col gap-2 border-dashed border-slate-300 px-3 dark:border-slate-700"
          }`}
          data-creator-canvas-empty-state={isBound ? undefined : "image"}
          data-creator-canvas-media-state={isBound ? "bound" : "empty"}
          data-creator-canvas-image-preview={
            isBound && display.status === "ready" ? "ready" : undefined
          }
        >
          {isBound && display.status === "ready" ? (
            <ResolvedAssetImage
              src={display.logicalUrl}
              token={data.assetToken}
              alt={t("creator.canvas.imagePreview")}
              className="size-full object-cover"
              draggable={false}
              fallback={boundFallback}
            />
          ) : isBound ? (
            boundFallback
          ) : (
            <>
              <span>{t("creator.canvas.imageEmpty")}</span>
              <div className="nodrag nopan nowheel flex flex-col items-center gap-1">
                <button
                  type="button"
                  className="nodrag nopan nowheel inline-flex min-h-9 items-center rounded-lg bg-indigo-600 px-3 text-[11px] font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("creator.canvas.assetPicker.choose")}
                  disabled={!data.assetToken}
                  title={data.assetToken ? undefined : t("creator.canvas.assetPicker.loginRequired")}
                  data-creator-canvas-asset-picker-action="choose"
                  onClick={() => data.actions.onChooseExistingImageAsset?.(id)}
                >
                  {t("creator.canvas.assetPicker.choose")}
                </button>
                {!data.assetToken ? (
                  <span
                    className="text-[10px] text-slate-400 dark:text-slate-500"
                    data-creator-canvas-asset-picker-login-required="true"
                  >
                    {t("creator.canvas.assetPicker.loginRequired")}
                  </span>
                ) : null}
              </div>
            </>
          )}
          {executionStatus && executionLabel ? (
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-xs font-semibold ${
                executionStatus === "unresolved"
                  ? "bg-amber-100/90 text-amber-900 dark:bg-amber-950/90 dark:text-amber-100"
                  : executionStatus === "failed"
                    ? "bg-red-100/90 text-red-800 dark:bg-red-950/90 dark:text-red-100"
                    : "bg-slate-950/55 text-white"
              }`}
              role="status"
              aria-live="polite"
              data-creator-image-node-execution={executionStatus}
            >
              {executionStatus === "generating" || executionStatus === "checking" ? (
                <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              ) : executionStatus === "unresolved" ? (
                <CircleAlert className="size-5" aria-hidden="true" />
              ) : (
                <CircleX className="size-5" aria-hidden="true" />
              )}
              <span>{executionLabel}</span>
            </div>
          ) : null}
        </div>
        {isBound ? (
          <div className="nodrag nopan nowheel mt-2 flex flex-col items-start gap-1">
            <button
              type="button"
              className="nodrag nopan nowheel inline-flex min-h-9 items-center rounded-lg border border-indigo-200 px-3 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
              aria-label={t("creator.canvas.assetPicker.replace")}
              disabled={replaceDisabled}
              title={replaceTitle}
              data-creator-canvas-asset-picker-action="replace"
              onClick={() => data.actions.onReplaceExistingImageAsset?.(id)}
            >
              {t("creator.canvas.assetPicker.replace")}
            </button>
            {!data.assetToken ? (
              <span
                className="text-[10px] text-slate-400 dark:text-slate-500"
                data-creator-canvas-asset-picker-login-required="true"
              >
                {t("creator.canvas.assetPicker.loginRequired")}
              </span>
            ) : replaceBlockedByExecution ? (
              <span
                className="text-[10px] text-slate-400 dark:text-slate-500"
                data-creator-canvas-asset-picker-replace-unavailable="true"
              >
                {t("creator.canvas.assetPicker.replaceUnavailable")}
              </span>
            ) : null}
          </div>
        ) : null}
      </CreatorCanvasNodeCard>
    </>
  );
});

const VideoCanvasNode = memo(function VideoCanvasNode({
  id,
  data,
  selected
}: NodeProps<CreatorCanvasViewNode>) {
  const { t } = useI18n();
  const assetId = data.domainNode.kind === "video"
    ? data.domainNode.data.assetId
    : null;
  const isBound = assetId !== null;
  const fallbackDisplay = useCreatorVideoAssetDisplay({
    assetId,
    token: data.assetToken,
    enabled: isBound && !selected && data.videoAssetDisplay === undefined
  });
  const display = data.videoAssetDisplay ?? fallbackDisplay;
  const execution = data.videoExecution;
  const executionStatus = execution?.status ?? "idle";
  const executionLabel = executionStatus === "preparing"
    ? t("creator.canvas.node.videoExecution.preparing")
    : executionStatus === "submitting"
      ? t("creator.canvas.node.videoExecution.submitting")
      : executionStatus === "checking"
        ? t("creator.canvas.node.videoExecution.checking")
        : executionStatus === "unresolved"
          ? t("creator.canvas.node.videoExecution.unresolved")
          : executionStatus === "failed"
            ? execution?.errorMessage ?? t("creator.canvas.node.videoExecution.failed")
            : null;
  const boundFallback = (
    <span data-creator-canvas-video-preview-fallback="true">
      {t("creator.canvas.videoBound")}
    </span>
  );
  const expectedLogicalUrl = isBound ? `/assets/${assetId}/content` : null;
  const renderFullPreview = Boolean(
    isBound &&
    !selected &&
    display.status === "ready" &&
    display.logicalUrl === expectedLogicalUrl
  );
  return (
    <>
      <CreatorCanvasNodeCard
        icon={Video}
        kind="video"
        labelKey="creator.canvas.node.video"
        nodeId={id}
        selected={selected}
      >
        <div
          className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-slate-950 px-3 text-center text-xs text-slate-400 ${
            isBound ? "border border-slate-700" : "border border-dashed border-slate-700"
          }`}
          data-creator-canvas-empty-state={isBound ? undefined : "video"}
          data-creator-canvas-media-state={isBound ? "bound" : "empty"}
          data-creator-canvas-video-preview={
            renderFullPreview ? "ready" : isBound ? "bound-fallback" : undefined
          }
          data-creator-canvas-video-preview-renderer={renderFullPreview ? "full" : "fallback"}
        >
          {renderFullPreview ? (
            <ResolvedAssetVideo
              src={display.logicalUrl}
              token={data.assetToken}
              controls
              playsInline
              preload="metadata"
              className="size-full object-contain"
              fallback={boundFallback}
            />
          ) : isBound ? (
            boundFallback
          ) : (
            <span>{t("creator.canvas.videoEmpty")}</span>
          )}
          {executionStatus !== "idle" && executionLabel ? (
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-[11px] font-semibold ${
                executionStatus === "unresolved"
                  ? "bg-amber-100/90 text-amber-900 dark:bg-amber-950/90 dark:text-amber-100"
                  : executionStatus === "failed"
                    ? "bg-red-100/90 text-red-800 dark:bg-red-950/90 dark:text-red-100"
                    : "bg-slate-950/65 text-white"
              }`}
              role={executionStatus === "failed" ? "alert" : "status"}
              aria-live="polite"
              data-creator-video-node-execution={executionStatus}
            >
              {executionStatus === "preparing" || executionStatus === "submitting" || executionStatus === "checking" ? (
                <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              ) : executionStatus === "unresolved" ? (
                <CircleAlert className="size-5" aria-hidden="true" />
              ) : (
                <CircleX className="size-5" aria-hidden="true" />
              )}
              <span>{executionLabel}</span>
              {execution?.progress !== null && execution?.progress !== undefined ? (
                <span>{execution.progress}%</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </CreatorCanvasNodeCard>
    </>
  );
});

export const CREATOR_CANVAS_NODE_DEFINITIONS = Object.freeze({
  text: Object.freeze({
    kind: "text",
    labelKey: "creator.canvas.node.text",
    descriptionKey: "creator.canvas.nodeDescription.text",
    icon: Type,
    component: TextCanvasNode,
    defaultWidth: 320,
    minimapColor: "#4f46e5"
  }),
  image: Object.freeze({
    kind: "image",
    labelKey: "creator.canvas.node.image",
    descriptionKey: "creator.canvas.nodeDescription.image",
    icon: FileImage,
    component: ImageCanvasNode,
    defaultWidth: 320,
    minimapColor: "#0891b2"
  }),
  video: Object.freeze({
    kind: "video",
    labelKey: "creator.canvas.node.video",
    descriptionKey: "creator.canvas.nodeDescription.video",
    icon: Video,
    component: VideoCanvasNode,
    defaultWidth: 336,
    minimapColor: "#7c3aed"
  })
}) satisfies Readonly<
  Record<CreatorContentNodeKind, Readonly<CreatorCanvasNodeDefinition>>
>;

export const CREATOR_CANVAS_NODE_KINDS = Object.freeze(
  Object.keys(CREATOR_CANVAS_NODE_DEFINITIONS) as CreatorContentNodeKind[]
);

export const CREATOR_CANVAS_NODE_TYPES = Object.fromEntries(
  CREATOR_CANVAS_NODE_KINDS.map((kind) => [
    kind,
    CREATOR_CANVAS_NODE_DEFINITIONS[kind].component
  ])
) as NodeTypes;
