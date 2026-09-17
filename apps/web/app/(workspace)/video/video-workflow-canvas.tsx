"use client";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodeProps,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FileImage, Type, Video, WandSparkles } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../lib/i18n/use-i18n";
import {
  canConnectVideoWorkflowEdge,
  connectVideoWorkflowEdge,
  createVideoWorkflowGraph,
  reconnectVideoWorkflowEdge,
  removeVideoWorkflowEdges,
  setVideoWorkflowMode,
  updateVideoWorkflowModelLabel,
  updateVideoWorkflowNodePosition,
  updateVideoWorkflowPrompt,
  updateVideoWorkflowReferenceFileName,
  validateVideoWorkflowGraph,
  type VideoWorkflowMode
} from "./video-workflow-graph";
import {
  fromReactFlowConnection,
  toReactFlowEdges,
  toReactFlowNodes,
  type VideoWorkflowViewEdge,
  type VideoWorkflowViewNode
} from "./video-workflow-react-flow";

const WORKFLOW_DESKTOP_QUERY = "(min-width: 768px)";

function NodeCard({
  children,
  icon: Icon,
  title,
  label
}: {
  children: React.ReactNode;
  icon: typeof Type;
  title: string;
  label: string;
}) {
  return (
    <section
      className="w-64 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-950/5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/20"
      aria-label={label}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
        <span className="inline-flex size-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const PromptWorkflowNode = memo(function PromptWorkflowNode({
  data
}: NodeProps<VideoWorkflowViewNode>) {
  const { t } = useI18n();
  const node = data.domainNode;
  if (node.kind !== "prompt") return null;
  return (
    <NodeCard
      icon={Type}
      title={t("multimodal.video.workflow.promptNode")}
      label={t("multimodal.video.workflow.promptNodeLabel")}
    >
      <textarea
        className="nodrag nowheel min-h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-indigo-900"
        value={node.data.prompt}
        onChange={(event) => data.actions.onPromptChange(event.target.value)}
        placeholder={t("multimodal.video.promptPlaceholder")}
        aria-label={t("multimodal.video.workflow.promptInput")}
        maxLength={4000}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        aria-label={t("multimodal.video.workflow.promptOutput")}
      />
    </NodeCard>
  );
});

const ReferenceWorkflowNode = memo(function ReferenceWorkflowNode({
  data
}: NodeProps<VideoWorkflowViewNode>) {
  const { t } = useI18n();
  const node = data.domainNode;
  if (node.kind !== "reference-image") return null;
  return (
    <NodeCard
      icon={FileImage}
      title={t("multimodal.video.workflow.referenceNode")}
      label={t("multimodal.video.workflow.referenceNodeLabel")}
    >
      <label className="grid gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
        {t("multimodal.video.workflow.referenceLocalOnly")}
        <input
          className="nodrag nowheel min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-2.5 file:py-2 file:font-semibold file:text-indigo-700 dark:file:bg-indigo-950 dark:file:text-indigo-300"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => data.actions.onReferenceFileNameChange(event.target.files?.[0]?.name ?? null)}
        />
      </label>
      <p className="mt-2 truncate text-xs text-slate-500 dark:text-slate-400">
        {node.data.fileName ?? t("multimodal.video.workflow.referencePlaceholder")}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        aria-label={t("multimodal.video.workflow.referenceOutput")}
      />
    </NodeCard>
  );
});

const GenerateWorkflowNode = memo(function GenerateWorkflowNode({
  data
}: NodeProps<VideoWorkflowViewNode>) {
  const { t } = useI18n();
  const node = data.domainNode;
  if (node.kind !== "video-generate") return null;
  return (
    <NodeCard
      icon={WandSparkles}
      title={t("multimodal.video.workflow.generateNode")}
      label={t("multimodal.video.workflow.generateNodeLabel")}
    >
      <dl className="grid min-w-0 gap-2 text-xs">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <dt className="shrink-0 text-slate-500 dark:text-slate-400">{t("multimodal.model")}</dt>
          <dd className="min-w-0 break-words text-right font-semibold text-slate-800 dark:text-slate-200">
            {node.data.modelLabel}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500 dark:text-slate-400">{t("multimodal.video.mode")}</dt>
          <dd className="font-semibold text-slate-800 dark:text-slate-200">
            {node.data.mode === "image-to-video"
              ? t("multimodal.video.imageToVideo")
              : t("multimodal.video.textToVideo")}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className="nodrag nowheel mt-3 min-h-10 w-full rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-400 disabled:cursor-not-allowed dark:bg-slate-800 dark:text-slate-500"
        disabled
      >
        {t("multimodal.video.workflow.executionPending")}
      </button>
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: "36%" }}
        aria-label={t("multimodal.video.workflow.promptInputPort")}
      />
      {node.data.mode === "image-to-video" ? (
        <Handle
          type="target"
          position={Position.Left}
          id="reference"
          style={{ top: "66%" }}
          aria-label={t("multimodal.video.workflow.referenceInputPort")}
        />
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        aria-label={t("multimodal.video.workflow.videoOutput")}
      />
    </NodeCard>
  );
});

const ResultWorkflowNode = memo(function ResultWorkflowNode({
  data
}: NodeProps<VideoWorkflowViewNode>) {
  const { t } = useI18n();
  const node = data.domainNode;
  if (node.kind !== "video-result") return null;
  return (
    <NodeCard
      icon={Video}
      title={t("multimodal.video.workflow.resultNode")}
      label={t("multimodal.video.workflow.resultNodeLabel")}
    >
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
        {t("multimodal.video.workflow.resultPending")}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        aria-label={t("multimodal.video.workflow.resultInput")}
      />
    </NodeCard>
  );
});

const nodeTypes = {
  prompt: PromptWorkflowNode,
  "reference-image": ReferenceWorkflowNode,
  "video-generate": GenerateWorkflowNode,
  "video-result": ResultWorkflowNode
} satisfies NodeTypes;

function useDesktopCanvas(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(WORKFLOW_DESKTOP_QUERY);
    const update = () => setIsDesktop(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export function VideoWorkflowCanvas({ modelLabel }: { modelLabel: string }) {
  const { t } = useI18n();
  const isDesktop = useDesktopCanvas();
  const [mode, setMode] = useState<VideoWorkflowMode>("text-to-video");
  const [graph, setGraph] = useState(() => createVideoWorkflowGraph("text-to-video", modelLabel));
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setGraph((current) => updateVideoWorkflowModelLabel(current, modelLabel));
  }, [modelLabel]);

  const actions = useMemo(() => ({
    onPromptChange: (prompt: string) => setGraph((current) => updateVideoWorkflowPrompt(current, prompt)),
    onReferenceFileNameChange: (fileName: string | null) =>
      setGraph((current) => updateVideoWorkflowReferenceFileName(current, fileName))
  }), []);

  const nodes = useMemo(
    () => toReactFlowNodes(graph, actions, selectedNodeIds),
    [actions, graph, selectedNodeIds]
  );
  const edges = useMemo(
    () => toReactFlowEdges(graph, selectedEdgeIds),
    [graph, selectedEdgeIds]
  );

  const changeMode = useCallback((nextMode: VideoWorkflowMode) => {
    setMode(nextMode);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setGraph((current) => setVideoWorkflowMode(current, nextMode));
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<VideoWorkflowViewNode>[]) => {
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (selectionChanges.length > 0) {
      setSelectedNodeIds((current) => {
        const next = new Set(current);
        for (const change of selectionChanges) {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
        return next;
      });
    }
    const positionChanges = changes.filter((change) => change.type === "position");
    if (positionChanges.length > 0) {
      setGraph((current) => positionChanges.reduce(
        (next, change) => change.position
          ? updateVideoWorkflowNodePosition(next, change.id, change.position)
          : next,
        current
      ));
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removedIds = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
    if (removedIds.size > 0) {
      setGraph((current) => removeVideoWorkflowEdges(current, removedIds));
    }
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (selectionChanges.length > 0) {
      setSelectedEdgeIds((current) => {
        const next = new Set(current);
        for (const change of selectionChanges) {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
        return next;
      });
    }
  }, []);

  const isValidConnection = useCallback<IsValidConnection<VideoWorkflowViewEdge>>((connection) => {
    const candidate = fromReactFlowConnection(connection);
    return candidate ? canConnectVideoWorkflowEdge(graph, candidate) : false;
  }, [graph]);

  const onConnect = useCallback((connection: Connection) => {
    const candidate = fromReactFlowConnection(connection);
    if (!candidate) return;
    setGraph((current) => connectVideoWorkflowEdge(current, candidate));
  }, []);

  const onReconnect = useCallback((oldEdge: { id: string }, connection: Connection) => {
    const candidate = fromReactFlowConnection(connection);
    if (!candidate) return;
    setGraph((current) => reconnectVideoWorkflowEdge(current, oldEdge.id, candidate));
  }, []);

  const validation = useMemo(() => validateVideoWorkflowGraph(graph), [graph]);

  return (
    <section className="min-w-0" data-video-workflow-mode={mode}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">
            {t("multimodal.video.workflow.title")}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("multimodal.video.workflow.foundationNotice")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("multimodal.video.mode")}>
          {(["text-to-video", "image-to-video"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={mode === candidate
                ? "min-h-10 rounded-xl border border-indigo-300 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                : "min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"}
              aria-pressed={mode === candidate}
              data-workflow-mode-button={candidate}
              onClick={() => changeMode(candidate)}
            >
              {candidate === "text-to-video"
                ? t("multimodal.video.textToVideo")
                : t("multimodal.video.imageToVideo")}
            </button>
          ))}
        </div>
      </div>

      {isDesktop ? (
        <div
          className="h-[620px] min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm dark:border-slate-700 dark:bg-slate-950"
          data-video-workflow-canvas="desktop"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            isValidConnection={isValidConnection}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.45}
            maxZoom={1.8}
            nodesConnectable
            nodesDraggable
            edgesReconnectable
            elementsSelectable
            ariaLabelConfig={{
              "node.a11yDescription.default": t("multimodal.video.workflow.nodeA11yDescription")
            }}
          >
            <Background gap={24} size={1} />
            <Controls
              showInteractive={false}
              className="[&_button]:border-slate-200 [&_button]:bg-white [&_button]:text-slate-700 dark:[&_button]:border-slate-700 dark:[&_button]:bg-slate-900 dark:[&_button]:text-slate-200"
            />
          </ReactFlow>
        </div>
      ) : (
        <div
          className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
          data-video-workflow-mobile-summary="true"
        >
          <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">
            {t("multimodal.video.workflow.desktopEditingTitle")}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("multimodal.video.workflow.desktopEditingNotice")}
          </p>
          <ol className="mt-4 grid min-w-0 gap-2" aria-label={t("multimodal.video.workflow.summaryLabel")}>
            {graph.nodes.map((node, index) => (
              <li
                key={node.id}
                className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                data-workflow-summary-kind={node.kind}
              >
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {index + 1}
                </span>
                <span className="min-w-0 truncate">{t(`multimodal.video.workflow.kind.${node.kind}`)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!validation.valid ? (
        <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300" role="status">
          {t("multimodal.video.workflow.graphIncomplete")}
        </p>
      ) : null}
    </section>
  );
}
