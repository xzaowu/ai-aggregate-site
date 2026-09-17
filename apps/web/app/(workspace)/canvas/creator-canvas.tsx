"use client";

import type {
  AiGenerationCount,
  AiModelSummary,
  CreatorCanvasDocumentSummary,
  PublicVideoModelSummary
} from "@ai-aggregate/shared";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  getViewportForBounds,
  useKeyPress,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
  type XYPosition
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import "@xyflow/react/dist/style.css";
import {
  Copy,
  FilePlus2,
  FolderOpen,
  MousePointer2,
  Redo2,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";
import {
  createImageGenerationAttempt,
  createSecureUuid,
  isStructuredImageGenerationFailureBody,
  type GenericImageGenerationRequestPayload,
  type ImageGenerationAttempt
} from "../../../lib/image-generation-attempt";
import type { ImageAspectRatio } from "../../../lib/image-generation-aspect";
import {
  submitAndReconcileImageGeneration
} from "../../../lib/image-generation-reconciliation";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { isAbortError } from "../../../lib/private-asset-content";
import { generateSessionTitle } from "../../../lib/session-title";
import { apiUrl } from "../../../lib/site-config";
import {
  CREATOR_CANVAS_MAX_ZOOM,
  CREATOR_CANVAS_MIN_ZOOM,
  bindCreatorCanvasImageAsset,
  canConnectCreatorCanvasNodes,
  connectCreatorCanvasNodes,
  createInitialCreatorCanvasDocument,
  parseCreatorCanvasDocument,
  reconnectCreatorCanvasEdge,
  replaceCreatorCanvasImageAsset,
  removeCreatorCanvasEdge,
  removeCreatorCanvasNode,
  updateCreatorCanvasNodePosition,
  updateCreatorCanvasText,
  updateCreatorCanvasViewport,
  type CreatorCanvasDocumentV1,
  type CreatorContentNode,
  type CreatorContentNodeKind,
  type CreatorTextAiConfig
} from "./creator-canvas-document";
import { CreatorCanvasAssetPicker } from "./creator-canvas-asset-picker";
import {
  CreatorCanvasSavedDocumentsDialog,
  type CreatorCanvasDocumentRenameResult
} from "./creator-canvas-saved-documents-dialog";
import {
  areCreatorCanvasHistorySnapshotsSemanticallyEqual,
  createCreatorCanvasHistorySnapshot,
  CreatorCanvasHistory,
  type CreatorCanvasHistorySnapshot
} from "./creator-canvas-history";
import {
  captureCreatorCanvasGraphClipboard,
  cloneCreatorCanvasGraphForPaste,
  type CreatorCanvasGraphClipboard,
  type CreatorCanvasGraphPasteResult
} from "./creator-canvas-graph-clipboard";
import {
  CREATOR_CANVAS_LOCAL_PLACEMENT_CLEARANCE,
  planCreatorCanvasResultSiblingPositions,
  type CreatorCanvasSize
} from "./creator-canvas-local-placement";
import {
  CREATOR_CANVAS_RESULT_REVEAL_DURATION_MS,
  CREATOR_CANVAS_RESULT_REVEAL_SAFE_INSET,
  canCreatorCanvasFlowBoundsFitAtZoom,
  createCreatorCanvasSafeViewportRect,
  getCreatorCanvasBoundedZoomFloor,
  getCreatorCanvasMinimalPanDelta,
  isCreatorCanvasRectFullyVisible,
  type CreatorCanvasRevealRect
} from "./creator-canvas-result-reveal";
import {
  CREATOR_CANVAS_NODE_DEFINITIONS,
  CREATOR_CANVAS_NODE_KINDS,
  CREATOR_CANVAS_NODE_TYPES,
  type CreatorCanvasViewEdge,
  type CreatorCanvasViewNode
} from "./creator-canvas-node-registry";
import {
  CreatorNodeWorkspace,
  type CreatorNodeWorkspaceRect
} from "./creator-node-workspace";
import {
  fromCreatorCanvasReactFlowConnection,
  toCreatorCanvasReactFlowEdges,
  toCreatorCanvasReactFlowNodes,
  type CreatorCanvasNodeRendererState
} from "./creator-canvas-react-flow";
import {
  createCreatorImageComposerDraft,
  editCreatorImagePrompt,
  filterCreatorImageModels,
  getCreatorImageReferenceCandidates,
  pruneCreatorImageComposerDrafts,
  reconcileCreatorImageComposerDraft,
  resetCreatorImagePrompt,
  selectCreatorImagePromptSeed,
  setCreatorImageComposerOperation,
  type CreatorImageComposerDraft,
  type CreatorImageComposerOperation
} from "./creator-image-composer";
import {
  useCreatorImageAssetDisplay,
  type CreatorImageAssetDisplayState
} from "./creator-image-asset-display";
import { useCreatorVideoAssetDisplay } from "./creator-video-asset-display";
import {
  getCreatorCanvasPersistedStateFingerprint,
  parseCreatorCanvasPersistedState,
  serializeCreatorCanvasPersistedState
} from "./creator-canvas-persistence";
import { CreatorCanvasRecipeStarter } from "./creator-canvas-recipe-starter";
import {
  createCreatorCanvasRecipeSnapshot,
  PRODUCT_AD_SHORT_VIDEO_RECIPE
} from "./creator-canvas-recipes";
import type { CreatorImageComposerView } from "./creator-image-composer-panel";
import type { CreatorImageExecutionStatus } from "./creator-image-execution-state";
import type {
  CreatorVideoComposerExecutionView,
  CreatorVideoComposerView,
  CreatorVideoExecutionStatus,
  CreatorVideoNodeExecutionView
} from "./creator-video-composer-panel";
import {
  compileCreatorTextAiPrompt,
  filterCreatorTextAiModels,
  getCreatorTextAiEffectiveModelId,
  getCreatorTextAiIncomingTextOutputs,
  parseCreatorTextAiCompletionResponse,
  validateCreatorTextAiExecution
} from "./creator-text-ai";
import type {
  CreatorTextAiComposerView,
  CreatorTextAiExecutionStatus
} from "./creator-text-ai-panel";
import { CreatorImageWorkspace } from "./creator-image-workspace";
import { CreatorTextWorkspace } from "./creator-text-workspace";
import { CreatorVideoWorkspace } from "./creator-video-workspace";
import {
  CreatorImageReferencePreparationError,
  compileCreatorImageExecutionIntent,
  prepareCreatorImageGenerationPayload
} from "./creator-image-execution";
import { applyCreatorImageResults } from "./creator-image-result-application";
import { buildCreatorNodeComposerContext } from "./creator-node-composer-context";
import {
  clampCreatorVideoRetryAfterMs,
  compileCreatorVideoExecutionIntent,
  createCreatorVideoExecutionAttempt,
  createCreatorVideoSubmissionPayload,
  parseCreatorVideoSubmissionResponse,
  parseCreatorVideoTaskDetail,
  prepareCreatorVideoSubmissionPayload,
  readCreatorVideoTaskProgress,
  selectCreatorVideoTerminalAsset,
  waitForCreatorVideoDelay,
  CREATOR_VIDEO_POLL_INTERVAL_MS,
  CREATOR_VIDEO_POLL_MAX_ATTEMPTS,
  CREATOR_VIDEO_SUBMISSION_REPLAY_DELAY_MS,
  type CreatorVideoExecutionAttempt,
  type CreatorVideoExecutionIntent,
  type CreatorVideoSubmissionPayload,
  type CreatorVideoTaskDetail
} from "./creator-video-execution";
import {
  applyCreatorVideoResult
} from "./creator-video-result-application";
import {
  cloneCreatorVideoComposerDraft,
  createCreatorVideoComposerDraft,
  editCreatorVideoPrompt,
  getCreatorVideoCompatibleModels,
  getCreatorVideoEffectiveModelId,
  reconcileCreatorVideoComposerDraft,
  resetCreatorVideoPrompt,
  seedCreatorVideoPromptOnce,
  selectCreatorVideoImageReference,
  selectCreatorVideoPromptSeed,
  setCreatorVideoComposerMode,
  type CreatorVideoComposerDraft,
  type CreatorVideoComposerMode
} from "./creator-video-composer";

type NodeContextMenu = {
  nodeId: string;
  x: number;
  y: number;
};

type CreateMenu = {
  flowPosition: XYPosition;
  x: number;
  y: number;
};

type CreatorImageExecutionRuntimeState = Readonly<{
  status: CreatorImageExecutionStatus;
  errorMessage: string | null;
}>;

type ActiveCreatorImageExecution = {
  targetNodeId: string;
  controller: AbortController;
  attempt: ImageGenerationAttempt<GenericImageGenerationRequestPayload> | null;
  requestStartedAt: Date | null;
  viewportRevisionAtGenerationStart: number;
};

type ActiveCreatorTextAiExecution = {
  targetNodeId: string;
  controller: AbortController;
  generation: number;
  canvasGeneration: number;
  authIdentity: string;
};

type ActiveCreatorVideoExecution = {
  targetNodeId: string;
  controller: AbortController;
  generation: number;
  canvasGeneration: number;
  authIdentity: string;
  attempt: CreatorVideoExecutionAttempt | null;
  intent: CreatorVideoExecutionIntent;
  payload: CreatorVideoSubmissionPayload | null;
  taskId: string | null;
  retryAfterMs: number;
  viewportRevisionAtGenerationStart: number;
  pollingAttempts: number;
  submissionReplayCount: number;
  recoveryInFlight: boolean;
};

type CreatorVideoExecutionRuntimeState = Readonly<{
  status: CreatorVideoExecutionStatus;
  progress: number | null;
  taskId: string | null;
  errorMessage: string | null;
}>;

type CreatorTextAiExecutionRuntimeState = Readonly<{
  status: CreatorTextAiExecutionStatus;
  errorMessage: string | null;
}>;

type PendingCreatorCanvasResultReveal = Readonly<{
  token: number;
  targetNodeId: string;
  createdNodeIds: readonly string[];
  viewportRevisionAtGenerationStart: number;
}>;

type CreatorCanvasRuntimeState = Readonly<{
  document: CreatorCanvasDocumentV1;
  pendingResultReveals: readonly PendingCreatorCanvasResultReveal[];
}>;

type CreatorCanvasAssetPickerIntent = Readonly<
  | { mode: "bind"; nodeId: string; expectedAssetId: null }
  | { mode: "replace"; nodeId: string; expectedAssetId: string }
>;

type CreatorCanvasLiveMutation = Readonly<{
  document: CreatorCanvasDocumentV1;
  imageComposerDrafts?: ReadonlyMap<string, CreatorImageComposerDraft>;
  videoComposerDrafts?: ReadonlyMap<string, CreatorVideoComposerDraft>;
}>;

function isCreatorCanvasImageReplaceExecutionBlocked(
  status: CreatorImageExecutionStatus | undefined
): boolean {
  return status !== undefined && status !== "idle" && status !== "failed";
}

type CreatorCanvasPersistenceLoadState =
  | "initializing"
  | "loading"
  | "auth-required"
  | "error"
  | "ready";

type CreatorCanvasPersistenceFeedback = "error" | "conflict" | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const CREATOR_CANVAS_TITLE_MAX_LENGTH = 200;

export function deriveCreatorCanvasTitle(
  document: CreatorCanvasDocumentV1
): string | null {
  const firstTextNode = document.nodes.find(
    (node) => node.kind === "text" && node.data.text.trim().length > 0
  );
  if (!firstTextNode || firstTextNode.kind !== "text") return null;

  const parsedTitle = generateSessionTitle(firstTextNode.data.text).trim();
  const title = parsedTitle.slice(0, CREATOR_CANVAS_TITLE_MAX_LENGTH).trim();
  return title || null;
}

function parseCanvasDocumentMetadata(value: unknown): {
  detail: Record<string, unknown>;
  summary: CreatorCanvasDocumentSummary;
} {
  if (!isRecord(value) || !isRecord(value.document)) {
    throw new Error("CREATOR_CANVAS_DOCUMENT_RESPONSE_INVALID");
  }
  const detail = value.document;
  if (
    typeof detail.id !== "string" ||
    detail.id.trim().length === 0 ||
    (detail.title !== null && typeof detail.title !== "string") ||
    typeof detail.revision !== "number" ||
    !Number.isSafeInteger(detail.revision) ||
    detail.revision <= 0 ||
    typeof detail.createdAt !== "string" ||
    detail.createdAt.trim().length === 0 ||
    typeof detail.updatedAt !== "string" ||
    detail.updatedAt.trim().length === 0
  ) {
    throw new Error("CREATOR_CANVAS_DOCUMENT_DETAIL_INVALID");
  }
  const summary: CreatorCanvasDocumentSummary = {
    id: detail.id,
    title: typeof detail.title === "string"
      ? detail.title.trim() || null
      : null,
    revision: detail.revision,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  };
  return { detail, summary };
}

function parseCanvasDocumentResponse(value: unknown) {
  const { detail, summary } = parseCanvasDocumentMetadata(value);
  const parsed = parseCreatorCanvasPersistedState(detail.state);
  if (!parsed.ok) {
    throw new Error("CREATOR_CANVAS_PERSISTED_STATE_INVALID");
  }
  return {
    ...summary,
    document: parsed.state.document,
    imageComposerDrafts: parsed.imageComposerDrafts,
    videoComposerDrafts: parsed.videoComposerDrafts
  };
}

function replaceCanvasDocumentUrl(canvasId: string | null): void {
  if (typeof window === "undefined") return;
  const url = canvasId
    ? `/canvas?canvasId=${encodeURIComponent(canvasId)}`
    : "/canvas";
  window.history.replaceState(window.history.state, "", url);
}

let canvasIdSequence = 0;

const CREATOR_CANVAS_INITIAL_PLACEMENT_SLOTS: readonly XYPosition[] = [
  { x: -200, y: -160 },
  { x: 200, y: -160 },
  { x: -200, y: 100 },
  { x: 200, y: 100 }
];

function createCanvasId(prefix: string, existingIds: ReadonlySet<string>): string {
  let id: string;
  canvasIdSequence += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    do {
      id = `${prefix}-${crypto.randomUUID()}`;
    } while (existingIds.has(id));
    return id;
  }
  do {
    id = `${prefix}-${Date.now()}-${canvasIdSequence}`;
    canvasIdSequence += 1;
  } while (existingIds.has(id));
  return id;
}

function createDomainNode(
  kind: CreatorContentNodeKind,
  id: string,
  position: XYPosition
): CreatorContentNode {
  switch (kind) {
    case "text":
      return { id, kind, position, data: { text: "" } };
    case "image":
      return { id, kind, position, data: { assetId: null } };
    case "video":
      return { id, kind, position, data: { assetId: null } };
  }
}

function duplicateDomainNode(node: CreatorContentNode, id: string): CreatorContentNode {
  const position = { x: node.position.x + 32, y: node.position.y + 32 };
  switch (node.kind) {
    case "text":
      return {
        id,
        kind: node.kind,
        position,
        data: {
          text: node.data.text,
          ...(node.data.ai
            ? { ai: { ...node.data.ai } }
            : {})
        }
      };
    case "image":
      return { id, kind: node.kind, position, data: { ...node.data } };
    case "video":
      return { id, kind: node.kind, position, data: { ...node.data } };
  }
}

function readCreatorCanvasRuntimeDimension(
  measured: number | undefined,
  explicit: number | undefined,
  fallback: number
): number {
  if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
    return measured;
  }
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return fallback;
}

function getCreatorCanvasRuntimeNodeSize(
  node: CreatorContentNode,
  rendererState: CreatorCanvasNodeRendererState | undefined
): CreatorCanvasSize {
  const fallback = CREATOR_CANVAS_NODE_DEFINITIONS[node.kind].defaultWidth;
  return {
    width: readCreatorCanvasRuntimeDimension(
      rendererState?.measured?.width,
      rendererState?.width,
      fallback
    ),
    height: readCreatorCanvasRuntimeDimension(
      rendererState?.measured?.height,
      rendererState?.height,
      fallback
    )
  };
}

function toCreatorCanvasScreenRect(
  reactFlow: ReactFlowInstance<CreatorCanvasViewNode, CreatorCanvasViewEdge>,
  flowRect: CreatorCanvasRevealRect
): CreatorCanvasRevealRect {
  const topLeft = reactFlow.flowToScreenPosition({ x: flowRect.x, y: flowRect.y });
  const bottomRight = reactFlow.flowToScreenPosition({
    x: flowRect.x + flowRect.width,
    y: flowRect.y + flowRect.height
  });
  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y)
  };
}

function clampMenuPosition(
  element: HTMLDivElement | null,
  clientX: number,
  clientY: number,
  width = 224,
  height = 188
): { x: number; y: number } {
  const bounds = element?.getBoundingClientRect();
  if (!bounds) return { x: 16, y: 16 };
  return {
    x: Math.max(12, Math.min(clientX - bounds.left, bounds.width - width - 12)),
    y: Math.max(12, Math.min(clientY - bounds.top, bounds.height - height - 12))
  };
}

export function CreatorCanvas({
  initialDocument,
  initialModels = []
}: {
  initialDocument?: CreatorCanvasDocumentV1;
  initialModels?: AiModelSummary[];
} = {}) {
  const { t } = useI18n();
  const router = useRouter();
  const workspaceShell = useOptionalWorkspaceShellContext();
  const assetToken = workspaceShell?.shell.token ?? null;
  const workspaceAuthStatus = workspaceShell?.shell.authStatus ?? "guest";
  const workspaceUserId = workspaceShell?.shell.user?.id ?? null;
  const workspaceAuthIdentity = `${workspaceAuthStatus}:${workspaceUserId ?? ""}:${assetToken ?? ""}`;
  const workspaceAuthIdentityRef = useRef(workspaceAuthIdentity);
  workspaceAuthIdentityRef.current = workspaceAuthIdentity;
  const refreshQuota = workspaceShell?.refreshQuota;
  const setWorkspaceCurrentTitle = workspaceShell?.setCurrentTitle;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasLayoutRevision, setCanvasLayoutRevision] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setCanvasLayoutRevision((current) => current + 1);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const reconnectingEdgeIdRef = useRef<string | null>(null);
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance<
    CreatorCanvasViewNode,
    CreatorCanvasViewEdge
  > | null>(null);
  const [canvasRuntimeState, setCanvasRuntimeState] = useState<CreatorCanvasRuntimeState>(() => {
    const parsed = initialDocument
      ? parseCreatorCanvasDocument(initialDocument)
      : null;
    return {
      document: parsed?.ok
        ? parsed.document
        : createInitialCreatorCanvasDocument(),
      pendingResultReveals: []
    };
  });
  const canvasDocument = canvasRuntimeState.document;
  const canvasDocumentRef = useRef(canvasDocument);
  canvasDocumentRef.current = canvasDocument;
  const isMountedRef = useRef(true);
  const nextRevealTokenRef = useRef(0);
  const processedResultRevealTokensRef = useRef<Set<number>>(new Set());
  const viewportMovementRevisionRef = useRef(0);
  const viewportMovementActiveRef = useRef(false);
  const activeImageExecutionsRef = useRef<
    Map<string, ActiveCreatorImageExecution>
  >(new Map());
  const activeTextAiExecutionsRef = useRef<Map<string, ActiveCreatorTextAiExecution>>(
    new Map()
  );
  const activeVideoExecutionsRef = useRef<Map<string, ActiveCreatorVideoExecution>>(
    new Map()
  );
  const canvasSessionGenerationRef = useRef(0);
  const textAiExecutionGenerationRef = useRef(0);
  const videoExecutionGenerationRef = useRef(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [rendererStateByNodeId, setRendererStateByNodeId] = useState<
    Map<string, CreatorCanvasNodeRendererState>
  >(() => new Map());
  const rendererStateByNodeIdRef = useRef(rendererStateByNodeId);
  rendererStateByNodeIdRef.current = rendererStateByNodeId;
  const [contextMenu, setContextMenu] = useState<NodeContextMenu | null>(null);
  const [createMenu, setCreateMenu] = useState<CreateMenu | null>(null);
  const [assetPickerIntent, setAssetPickerIntent] =
    useState<CreatorCanvasAssetPickerIntent | null>(null);
  const [imageModels, setImageModels] = useState<AiModelSummary[]>(() =>
    filterCreatorImageModels(initialModels)
  );
  const [imageModelsLoading, setImageModelsLoading] = useState(
    initialModels.length === 0
  );
  const [textAiModels, setTextAiModels] = useState<AiModelSummary[]>(() =>
    filterCreatorTextAiModels(initialModels)
  );
  const [textAiModelsLoading, setTextAiModelsLoading] = useState(true);
  const [videoModels, setVideoModels] = useState<PublicVideoModelSummary[]>([]);
  const [videoModelsLoading, setVideoModelsLoading] = useState(true);
  const [imageComposerDrafts, setImageComposerDrafts] = useState<
    Map<string, CreatorImageComposerDraft>
  >(() => new Map());
  const imageComposerDraftsRef = useRef(imageComposerDrafts);
  imageComposerDraftsRef.current = imageComposerDrafts;
  const [videoComposerDrafts, setVideoComposerDrafts] = useState<
    Map<string, CreatorVideoComposerDraft>
  >(() => new Map());
  const videoComposerDraftsRef = useRef(videoComposerDrafts);
  videoComposerDraftsRef.current = videoComposerDrafts;
  const isCanvasSemanticallyEmpty =
    canvasDocument.nodes.length === 0 &&
    canvasDocument.edges.length === 0 &&
    imageComposerDrafts.size === 0 &&
    videoComposerDrafts.size === 0;
  const historyRef = useRef<CreatorCanvasHistory | null>(null);
  if (!historyRef.current) historyRef.current = new CreatorCanvasHistory();
  const [historyRevision, setHistoryRevision] = useState(0);
  const textEditTransactionNodeIdRef = useRef<string | null>(null);
  const nodeDragTransactionActiveRef = useRef(false);
  const [imageExecutionRuntimeByNodeId, setImageExecutionRuntimeByNodeId] =
    useState<Map<string, CreatorImageExecutionRuntimeState>>(() => new Map());
  const imageExecutionRuntimeByNodeIdRef = useRef(imageExecutionRuntimeByNodeId);
  imageExecutionRuntimeByNodeIdRef.current = imageExecutionRuntimeByNodeId;
  const [textAiExecutionRuntimeByNodeId, setTextAiExecutionRuntimeByNodeId] =
    useState<Map<string, CreatorTextAiExecutionRuntimeState>>(() => new Map());
  const textAiExecutionRuntimeByNodeIdRef = useRef(textAiExecutionRuntimeByNodeId);
  textAiExecutionRuntimeByNodeIdRef.current = textAiExecutionRuntimeByNodeId;
  const [videoExecutionRuntimeByNodeId, setVideoExecutionRuntimeByNodeId] = useState<
    Map<string, CreatorVideoExecutionRuntimeState>
  >(() => new Map());
  const videoExecutionRuntimeByNodeIdRef = useRef(videoExecutionRuntimeByNodeId);
  videoExecutionRuntimeByNodeIdRef.current = videoExecutionRuntimeByNodeId;
  const [persistenceLoadState, setPersistenceLoadState] =
    useState<CreatorCanvasPersistenceLoadState>("initializing");
  const [savedCanvasId, setSavedCanvasId] = useState<string | null>(null);
  const [savedCanvasRevision, setSavedCanvasRevision] = useState<number | null>(null);
  const [savedCanvasTitle, setSavedCanvasTitle] = useState<string | null>(null);
  const [savedCanvasFingerprint, setSavedCanvasFingerprint] = useState<string | null>(null);
  const [persistenceFeedback, setPersistenceFeedback] =
    useState<CreatorCanvasPersistenceFeedback>(null);
  const [persistenceSaving, setPersistenceSaving] = useState(false);
  const [persistenceRenaming, setPersistenceRenaming] = useState(false);
  const [savedDocumentsDialogOpen, setSavedDocumentsDialogOpen] = useState(false);
  const persistenceInitializedRef = useRef(false);
  const persistenceAuthenticatedUserIdRef = useRef<string | null>(null);
  const persistenceRequestedCanvasIdRef = useRef<string | null>(null);
  const persistenceRequestIdRef = useRef(0);
  const persistenceRequestControllerRef = useRef<AbortController | null>(null);
  const persistenceSaveIdRef = useRef(0);
  const persistenceSaveControllerRef = useRef<AbortController | null>(null);
  const persistenceRenameIdRef = useRef(0);
  const persistenceRenameControllerRef = useRef<AbortController | null>(null);
  const graphClipboardRef = useRef<CreatorCanvasGraphClipboard | null>(null);
  const graphPasteIndexRef = useRef(0);

  const clearGraphClipboard = useCallback(() => {
    graphClipboardRef.current = null;
    graphPasteIndexRef.current = 0;
  }, []);

  const applyLiveCanvasState = useCallback((
    nextDocument: CreatorCanvasDocumentV1,
    nextImageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft> =
      imageComposerDraftsRef.current,
    nextVideoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> =
      videoComposerDraftsRef.current
  ) => {
    const nextDrafts = nextImageComposerDrafts instanceof Map
      ? nextImageComposerDrafts
      : new Map(nextImageComposerDrafts);
    const nextVideoDrafts = nextVideoComposerDrafts instanceof Map
      ? nextVideoComposerDrafts
      : new Map(nextVideoComposerDrafts);
    const documentChanged = nextDocument !== canvasDocumentRef.current;
    const draftsChanged = nextDrafts !== imageComposerDraftsRef.current;
    const videoDraftsChanged = nextVideoDrafts !== videoComposerDraftsRef.current;
    canvasDocumentRef.current = nextDocument;
    imageComposerDraftsRef.current = nextDrafts;
    videoComposerDraftsRef.current = nextVideoDrafts;
    if (documentChanged) {
      setCanvasRuntimeState((current) => current.document === nextDocument
        ? current
        : { ...current, document: nextDocument });
    }
    if (draftsChanged) setImageComposerDrafts(nextDrafts);
    if (videoDraftsChanged) setVideoComposerDrafts(nextVideoDrafts);
  }, []);

  const applyLoadedCanvasState = useCallback((
    nextDocument: CreatorCanvasDocumentV1,
    nextImageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>,
    nextVideoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
  ) => {
    const nextDrafts = new Map(nextImageComposerDrafts);
    const nextVideoDrafts = new Map(nextVideoComposerDrafts);
    canvasDocumentRef.current = nextDocument;
    imageComposerDraftsRef.current = nextDrafts;
    videoComposerDraftsRef.current = nextVideoDrafts;
    setCanvasRuntimeState({
      document: nextDocument,
      pendingResultReveals: []
    });
    setImageComposerDrafts(nextDrafts);
    setVideoComposerDrafts(nextVideoDrafts);
  }, []);

  const setTextAiExecutionRuntime = useCallback((
    nodeId: string,
    runtime: CreatorTextAiExecutionRuntimeState | null
  ) => {
    if (!isMountedRef.current) return;
    setTextAiExecutionRuntimeByNodeId((current) => {
      if (runtime === null) {
        if (!current.has(nodeId)) return current;
        const next = new Map(current);
        next.delete(nodeId);
        return next;
      }
      const existing = current.get(nodeId);
      if (
        existing?.status === runtime.status &&
        existing.errorMessage === runtime.errorMessage
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(nodeId, runtime);
      return next;
    });
  }, []);

  const invalidateTextAiExecutions = useCallback((advanceCanvasGeneration = false) => {
    if (advanceCanvasGeneration) canvasSessionGenerationRef.current += 1;
    textAiExecutionGenerationRef.current += 1;
    for (const execution of activeTextAiExecutionsRef.current.values()) {
      execution.controller.abort();
    }
    activeTextAiExecutionsRef.current.clear();
    if (isMountedRef.current) setTextAiExecutionRuntimeByNodeId(new Map());
  }, []);

  const setVideoExecutionRuntime = useCallback((
    nodeId: string,
    runtime: CreatorVideoExecutionRuntimeState | null
  ) => {
    if (!isMountedRef.current) return;
    setVideoExecutionRuntimeByNodeId((current) => {
      if (runtime === null) {
        if (!current.has(nodeId)) return current;
        const next = new Map(current);
        next.delete(nodeId);
        return next;
      }
      const existing = current.get(nodeId);
      if (
        existing?.status === runtime.status &&
        existing.progress === runtime.progress &&
        existing.taskId === runtime.taskId &&
        existing.errorMessage === runtime.errorMessage
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(nodeId, runtime);
      return next;
    });
  }, []);

  const invalidateVideoExecutions = useCallback((advanceCanvasGeneration = false) => {
    if (advanceCanvasGeneration) canvasSessionGenerationRef.current += 1;
    videoExecutionGenerationRef.current += 1;
    for (const execution of activeVideoExecutionsRef.current.values()) {
      execution.controller.abort();
    }
    activeVideoExecutionsRef.current.clear();
    if (isMountedRef.current) setVideoExecutionRuntimeByNodeId(new Map());
  }, []);

  const resetCanvasSession = useCallback((
    nextDocument: CreatorCanvasDocumentV1,
    nextImageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft> = new Map(),
    nextVideoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
  ) => {
    invalidateTextAiExecutions(true);
    invalidateVideoExecutions();
    clearGraphClipboard();
    textEditTransactionNodeIdRef.current = null;
    nodeDragTransactionActiveRef.current = false;
    processedResultRevealTokensRef.current.clear();
    viewportMovementActiveRef.current = false;
    viewportMovementRevisionRef.current += 1;
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setRendererStateByNodeId(new Map());
    setContextMenu(null);
    setCreateMenu(null);
    setAssetPickerIntent(null);
    setImageExecutionRuntimeByNodeId(new Map());
    setTextAiExecutionRuntimeByNodeId(new Map());
    setVideoExecutionRuntimeByNodeId(new Map());
    historyRef.current = new CreatorCanvasHistory();
    setHistoryRevision((current) => current + 1);
    applyLoadedCanvasState(nextDocument, nextImageComposerDrafts, nextVideoComposerDrafts);
  }, [
    applyLoadedCanvasState,
    clearGraphClipboard,
    invalidateTextAiExecutions,
    invalidateVideoExecutions
  ]);

  const applyCreatorCanvasRecipe = useCallback(() => {
    if (
      !isCanvasSemanticallyEmpty ||
      persistenceLoadState !== "ready" ||
      persistenceSaving ||
      persistenceRenaming ||
      activeImageExecutionsRef.current.size > 0
    ) {
      return;
    }

    const recipe = createCreatorCanvasRecipeSnapshot(
      PRODUCT_AD_SHORT_VIDEO_RECIPE.id,
      {
        instructions: {
          creative: t(PRODUCT_AD_SHORT_VIDEO_RECIPE.creativeInstructionKey),
          keyframe: t(PRODUCT_AD_SHORT_VIDEO_RECIPE.keyframeInstructionKey),
          motion: t(PRODUCT_AD_SHORT_VIDEO_RECIPE.motionInstructionKey)
        }
      }
    );
    resetCanvasSession(
      recipe.document,
      recipe.imageComposerDrafts,
      recipe.videoComposerDrafts
    );
    if (reactFlow?.viewportInitialized) {
      void reactFlow.setViewport(recipe.document.viewport, {
        duration: 0,
        interpolate: "linear"
      }).catch(() => undefined);
    }
    setSavedDocumentsDialogOpen(false);
    setSavedCanvasId(null);
    setSavedCanvasRevision(null);
    setSavedCanvasTitle(null);
    setSavedCanvasFingerprint(null);
    persistenceRequestedCanvasIdRef.current = null;
    setPersistenceFeedback(null);
    setPersistenceLoadState("ready");
    replaceCanvasDocumentUrl(null);
  }, [
    isCanvasSemanticallyEmpty,
    persistenceLoadState,
    persistenceRenaming,
    persistenceSaving,
    reactFlow,
    resetCanvasSession,
    t
  ]);

  useEffect(() => {
    if (!setWorkspaceCurrentTitle) return;
    setWorkspaceCurrentTitle(savedCanvasTitle);
    return () => setWorkspaceCurrentTitle(null);
  }, [savedCanvasTitle, setWorkspaceCurrentTitle]);

  const readHistorySnapshot = useCallback((): CreatorCanvasHistorySnapshot =>
    createCreatorCanvasHistorySnapshot(
      canvasDocumentRef.current,
      imageComposerDraftsRef.current,
      videoComposerDraftsRef.current
    ), []);

  const recordHistoryTransition = useCallback((
    before: CreatorCanvasHistorySnapshot,
    after: CreatorCanvasHistorySnapshot
  ): boolean => {
    const recorded = historyRef.current?.record(before, after) ?? false;
    if (recorded) setHistoryRevision((current) => current + 1);
    return recorded;
  }, []);

  const finishTextEditTransaction = useCallback((): boolean => {
    if (!textEditTransactionNodeIdRef.current) return false;
    textEditTransactionNodeIdRef.current = null;
    const recorded = historyRef.current?.commitTransaction(readHistorySnapshot()) ?? false;
    if (recorded) setHistoryRevision((current) => current + 1);
    return recorded;
  }, [readHistorySnapshot]);

  const clearSelectedCanvasTransientState = useCallback(() => {
    finishTextEditTransaction();
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
  }, [finishTextEditTransaction]);

  const finishNodeDragTransaction = useCallback((): boolean => {
    if (!nodeDragTransactionActiveRef.current) return false;
    nodeDragTransactionActiveRef.current = false;
    const recorded = historyRef.current?.commitTransaction(readHistorySnapshot()) ?? false;
    if (recorded) setHistoryRevision((current) => current + 1);
    return recorded;
  }, [readHistorySnapshot]);

  const flushOpenHistoryTransactions = useCallback((): boolean => {
    const textRecorded = finishTextEditTransaction();
    const dragRecorded = finishNodeDragTransaction();
    return textRecorded || dragRecorded;
  }, [finishNodeDragTransaction, finishTextEditTransaction]);

  const beginTextEditTransaction = useCallback((nodeId: string) => {
    if (textEditTransactionNodeIdRef.current === nodeId) return;
    finishTextEditTransaction();
    finishNodeDragTransaction();
    const started = historyRef.current?.beginTransaction(readHistorySnapshot()) ?? false;
    if (started) textEditTransactionNodeIdRef.current = nodeId;
  }, [finishNodeDragTransaction, finishTextEditTransaction, readHistorySnapshot]);

  const updateOpenHistoryTransaction = useCallback(() => {
    if (!historyRef.current?.hasOpenTransaction) return;
    historyRef.current.updateTransaction(readHistorySnapshot());
  }, [readHistorySnapshot]);

  const commitSemanticMutation = useCallback((
    mutate: (current: {
      document: CreatorCanvasDocumentV1;
      imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>;
      videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft>;
    }) => CreatorCanvasLiveMutation | null
  ): boolean => {
    flushOpenHistoryTransactions();
    const before = readHistorySnapshot();
    const outcome = mutate({
      document: canvasDocumentRef.current,
      imageComposerDrafts: imageComposerDraftsRef.current,
      videoComposerDrafts: videoComposerDraftsRef.current
    });
    if (!outcome) return false;
    const nextDrafts = outcome.imageComposerDrafts ?? imageComposerDraftsRef.current;
    const nextVideoDrafts = outcome.videoComposerDrafts ?? videoComposerDraftsRef.current;
    const after = createCreatorCanvasHistorySnapshot(
      outcome.document,
      nextDrafts,
      nextVideoDrafts
    );
    const semanticChanged = !areCreatorCanvasHistorySnapshotsSemanticallyEqual(
      before,
      after
    );
    applyLiveCanvasState(outcome.document, nextDrafts, nextVideoDrafts);
    return semanticChanged && recordHistoryTransition(before, after);
  }, [
    applyLiveCanvasState,
    flushOpenHistoryTransactions,
    readHistorySnapshot,
    recordHistoryTransition
  ]);

  const getGraphPasteAnchor = useCallback((): XYPosition => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!reactFlow || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      return { x: 0, y: 0 };
    }
    return reactFlow.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2
    });
  }, [reactFlow]);

  const copyCanvasGraph = useCallback(() => {
    const snapshot = captureCreatorCanvasGraphClipboard(
      canvasDocumentRef.current,
      selectedNodeIdsRef.current,
      imageComposerDraftsRef.current,
      videoComposerDraftsRef.current
    );
    if (!snapshot) return;
    graphClipboardRef.current = snapshot;
    graphPasteIndexRef.current = 0;
  }, []);

  const pasteCanvasGraph = useCallback(() => {
    if (activeImageExecutionsRef.current.size > 0) return;
    const clipboard = graphClipboardRef.current;
    if (!clipboard) return;

    let pasteResult: CreatorCanvasGraphPasteResult | null = null;
    const committed = commitSemanticMutation(({ document, imageComposerDrafts, videoComposerDrafts }) => {
      if (activeImageExecutionsRef.current.size > 0) return null;
      const result = cloneCreatorCanvasGraphForPaste(
        clipboard,
        document,
        imageComposerDrafts,
        {
          anchor: getGraphPasteAnchor(),
          pasteIndex: graphPasteIndexRef.current,
          createId: createCanvasId
        },
        videoComposerDrafts
      );
      if (!result) return null;
      pasteResult = result;
      return {
        document: result.document,
        imageComposerDrafts: result.imageComposerDrafts,
        videoComposerDrafts: result.videoComposerDrafts
      };
    });
    const committedPasteResult = pasteResult as CreatorCanvasGraphPasteResult | null;
    if (!committed || !committedPasteResult) return;

    graphPasteIndexRef.current += 1;
    setSelectedNodeIds(new Set(committedPasteResult.pastedNodeIds));
    setSelectedEdgeIds(new Set());
    setContextMenu(null);
    setCreateMenu(null);
  }, [commitSemanticMutation, getGraphPasteAnchor]);

  const consumePendingResultReveal = useCallback((token: number) => {
    setCanvasRuntimeState((current) => {
      if (current.pendingResultReveals[0]?.token !== token) return current;
      return {
        ...current,
        pendingResultReveals: current.pendingResultReveals.slice(1)
      };
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearGraphClipboard();
      for (const execution of activeImageExecutionsRef.current.values()) {
        execution.controller.abort();
      }
      activeImageExecutionsRef.current.clear();
      textAiExecutionGenerationRef.current += 1;
      for (const execution of activeTextAiExecutionsRef.current.values()) {
        execution.controller.abort();
      }
      activeTextAiExecutionsRef.current.clear();
      videoExecutionGenerationRef.current += 1;
      for (const execution of activeVideoExecutionsRef.current.values()) {
        execution.controller.abort();
      }
      activeVideoExecutionsRef.current.clear();
      processedResultRevealTokensRef.current.clear();
    };
  }, [clearGraphClipboard]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setImageModelsLoading(true);
    void fetch(apiUrl("/models?surface=image"), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("CREATOR_IMAGE_MODELS_UNAVAILABLE");
        const data = (await response.json()) as { models?: AiModelSummary[] };
        return filterCreatorImageModels(Array.isArray(data.models) ? data.models : []);
      })
      .then((models) => {
        if (active) setImageModels(models);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setImageModelsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setVideoModelsLoading(true);
    void fetch(apiUrl("/models?capability=video&surface=video"), {
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("CREATOR_VIDEO_MODELS_UNAVAILABLE");
        const data = (await response.json()) as { models?: PublicVideoModelSummary[] };
        return Array.isArray(data.models) ? data.models : [];
      })
      .then((models) => {
        if (active) setVideoModels(models);
      })
      .catch(() => {
        if (active) setVideoModels([]);
      })
      .finally(() => {
        if (active) setVideoModelsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setTextAiModelsLoading(true);
    void fetch(apiUrl("/models?capability=chat&surface=chat"), {
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("CREATOR_TEXT_AI_MODELS_UNAVAILABLE");
        const data = (await response.json()) as { models?: AiModelSummary[] };
        return filterCreatorTextAiModels(Array.isArray(data.models) ? data.models : []);
      })
      .then((models) => {
        if (active) setTextAiModels(models);
      })
      .catch(() => {
        if (active) setTextAiModels([]);
      })
      .finally(() => {
        if (active) setTextAiModelsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const loadPersistedCanvasDocument = useCallback(async (
    canvasId: string,
    token: string
  ) => {
    invalidateTextAiExecutions(true);
    invalidateVideoExecutions();
    clearGraphClipboard();
    persistenceRequestControllerRef.current?.abort();
    const requestId = ++persistenceRequestIdRef.current;
    const controller = new AbortController();
    persistenceRequestControllerRef.current = controller;
    persistenceRequestedCanvasIdRef.current = canvasId;
    setPersistenceLoadState("loading");
    setPersistenceFeedback(null);
    try {
      const response = await fetch(
        apiUrl(`/canvas/documents/${encodeURIComponent(canvasId)}`),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        }
      );
      if (!response.ok) {
        throw new Error("CREATOR_CANVAS_DOCUMENT_LOAD_FAILED");
      }
      const parsed = parseCanvasDocumentResponse(await response.json() as unknown);
      if (
        requestId !== persistenceRequestIdRef.current ||
        controller.signal.aborted
      ) {
        return;
      }
      resetCanvasSession(
        parsed.document,
        parsed.imageComposerDrafts,
        parsed.videoComposerDrafts
      );
      setSavedCanvasId(parsed.id);
      setSavedCanvasRevision(parsed.revision);
      setSavedCanvasTitle(parsed.title);
      setSavedCanvasFingerprint(
        getCreatorCanvasPersistedStateFingerprint(
          parsed.document,
          parsed.imageComposerDrafts,
          parsed.videoComposerDrafts
        )
      );
      setPersistenceLoadState("ready");
      replaceCanvasDocumentUrl(parsed.id);
    } catch (error) {
      if (
        requestId !== persistenceRequestIdRef.current ||
        controller.signal.aborted ||
        isAbortError(error)
      ) {
        return;
      }
      setPersistenceLoadState("error");
      setPersistenceFeedback("error");
    } finally {
      if (persistenceRequestIdRef.current === requestId) {
        persistenceRequestControllerRef.current = null;
      }
    }
  }, [
    clearGraphClipboard,
    invalidateTextAiExecutions,
    invalidateVideoExecutions,
    resetCanvasSession
  ]);

  useEffect(() => {
    const authStatus = workspaceShell?.shell.authStatus ?? "guest";
    if (authStatus === "unknown") return;

    const canvasId = typeof window === "undefined"
      ? null
      : new URL(window.location.href).searchParams.get("canvasId")?.trim() || null;
    persistenceRequestedCanvasIdRef.current = canvasId;
    if (!canvasId) {
      if (persistenceInitializedRef.current) return;
      persistenceInitializedRef.current = true;
      persistenceAuthenticatedUserIdRef.current = null;
      setSavedCanvasId(null);
      setSavedCanvasRevision(null);
      setSavedCanvasTitle(null);
      setSavedCanvasFingerprint(null);
      setPersistenceLoadState("ready");
      return;
    }

    const authenticatedUserId = workspaceShell?.shell.user?.id ?? null;
    if (authStatus !== "authenticated" || !assetToken || !authenticatedUserId) {
      persistenceInitializedRef.current = false;
      persistenceAuthenticatedUserIdRef.current = null;
      persistenceRequestIdRef.current += 1;
      persistenceRequestControllerRef.current?.abort();
      persistenceRequestControllerRef.current = null;
      persistenceSaveIdRef.current += 1;
      persistenceSaveControllerRef.current?.abort();
      persistenceSaveControllerRef.current = null;
      persistenceRenameIdRef.current += 1;
      persistenceRenameControllerRef.current?.abort();
      persistenceRenameControllerRef.current = null;
      setPersistenceSaving(false);
      setPersistenceRenaming(false);
      setSavedCanvasTitle(null);
      setSavedDocumentsDialogOpen(false);
      setPersistenceFeedback(null);
      setPersistenceLoadState("auth-required");
      return;
    }
    if (
      persistenceInitializedRef.current &&
      persistenceAuthenticatedUserIdRef.current === authenticatedUserId
    ) {
      return;
    }
    persistenceInitializedRef.current = true;
    persistenceAuthenticatedUserIdRef.current = authenticatedUserId;
    setSavedCanvasTitle(null);
    void loadPersistedCanvasDocument(canvasId, assetToken);
  }, [
    assetToken,
    loadPersistedCanvasDocument,
    workspaceShell?.shell.authStatus,
    workspaceShell?.shell.user?.id
  ]);

  const previousWorkspaceAuthIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousWorkspaceAuthIdentityRef.current;
    if (previous !== null && previous !== workspaceAuthIdentity) {
      clearGraphClipboard();
      invalidateTextAiExecutions();
      invalidateVideoExecutions();
      clearSelectedCanvasTransientState();
    }
    previousWorkspaceAuthIdentityRef.current = workspaceAuthIdentity;
  }, [
    clearGraphClipboard,
    clearSelectedCanvasTransientState,
    invalidateTextAiExecutions,
    invalidateVideoExecutions,
    workspaceAuthIdentity
  ]);

  useEffect(() => () => {
    persistenceRequestIdRef.current += 1;
    persistenceRequestControllerRef.current?.abort();
    persistenceSaveIdRef.current += 1;
    persistenceSaveControllerRef.current?.abort();
    persistenceRenameIdRef.current += 1;
    persistenceRenameControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const nodeIds = new Set(canvasDocument.nodes.map((node) => node.id));
    const current = imageComposerDraftsRef.current;
    if (Array.from(current.keys()).every((nodeId) => nodeIds.has(nodeId))) return;
    applyLiveCanvasState(
      canvasDocumentRef.current,
      pruneCreatorImageComposerDrafts(current, nodeIds)
    );
  }, [applyLiveCanvasState, canvasDocument.nodes]);

  useEffect(() => {
    const videoNodeIds = new Set(
      canvasDocument.nodes
        .filter((node) => node.kind === "video")
        .map((node) => node.id)
    );
    const current = videoComposerDraftsRef.current;
    if (Array.from(current.keys()).every((nodeId) => videoNodeIds.has(nodeId))) return;
    const next = new Map(
      Array.from(current).filter(([nodeId]) => videoNodeIds.has(nodeId))
    );
    applyLiveCanvasState(
      canvasDocumentRef.current,
      imageComposerDraftsRef.current,
      next
    );
  }, [applyLiveCanvasState, canvasDocument.nodes]);

  useEffect(() => {
    const pendingReveal = canvasRuntimeState.pendingResultReveals[0];
    if (!pendingReveal || !isMountedRef.current) return;
    const processedTokens = processedResultRevealTokensRef.current;
    if (processedTokens.has(pendingReveal.token)) {
      consumePendingResultReveal(pendingReveal.token);
      return;
    }

    const consume = () => {
      processedTokens.add(pendingReveal.token);
      consumePendingResultReveal(pendingReveal.token);
    };
    if (
      viewportMovementActiveRef.current ||
      pendingReveal.viewportRevisionAtGenerationStart !==
        viewportMovementRevisionRef.current
    ) {
      consume();
      return;
    }

    const documentNodeIds = new Set(canvasDocument.nodes.map((node) => node.id));
    if (
      !documentNodeIds.has(pendingReveal.targetNodeId) ||
      pendingReveal.createdNodeIds.some((nodeId) => !documentNodeIds.has(nodeId))
    ) {
      consume();
      return;
    }
    if (!reactFlow?.viewportInitialized) return;

    const targetNode = reactFlow.getNode(pendingReveal.targetNodeId);
    const createdNodes = pendingReveal.createdNodeIds.map((nodeId) =>
      reactFlow.getNode(nodeId)
    );
    if (
      !targetNode ||
      createdNodes.some((node) =>
        !node ||
        typeof node.measured?.width !== "number" ||
        node.measured.width <= 0 ||
        typeof node.measured.height !== "number" ||
        node.measured.height <= 0
      )
    ) {
      return;
    }

    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    if (!canvasBounds || canvasBounds.width <= 0 || canvasBounds.height <= 0) {
      return;
    }
    const readyCreatedNodes = createdNodes.flatMap((node) => node ? [node] : []);
    const createdBounds = reactFlow.getNodesBounds(readyCreatedNodes);
    const safeViewportRect = createCreatorCanvasSafeViewportRect({
      x: canvasBounds.left,
      y: canvasBounds.top,
      width: canvasBounds.width,
      height: canvasBounds.height
    });
    const createdScreenRect = toCreatorCanvasScreenRect(reactFlow, createdBounds);
    if (isCreatorCanvasRectFullyVisible(createdScreenRect, safeViewportRect)) {
      consume();
      return;
    }

    const currentViewport = reactFlow.getViewport();
    const minimumAllowedZoom = getCreatorCanvasBoundedZoomFloor(
      currentViewport.zoom,
      CREATOR_CANVAS_MIN_ZOOM
    );
    const targetHasMeasuredDimensions =
      typeof targetNode.measured?.width === "number" &&
      targetNode.measured.width > 0 &&
      typeof targetNode.measured.height === "number" &&
      targetNode.measured.height > 0;
    const contextBounds = targetHasMeasuredDimensions
      ? reactFlow.getNodesBounds([targetNode, ...readyCreatedNodes])
      : createdBounds;
    const viewportSize = {
      width: canvasBounds.width,
      height: canvasBounds.height
    };
    const revealBounds = canCreatorCanvasFlowBoundsFitAtZoom(
      contextBounds,
      viewportSize,
      minimumAllowedZoom
    )
      ? contextBounds
      : createdBounds;

    let nextViewport: Viewport;
    if (canCreatorCanvasFlowBoundsFitAtZoom(
      revealBounds,
      viewportSize,
      currentViewport.zoom
    )) {
      const revealScreenRect = toCreatorCanvasScreenRect(reactFlow, revealBounds);
      const panDelta = getCreatorCanvasMinimalPanDelta(
        revealScreenRect,
        safeViewportRect
      );
      nextViewport = {
        x: currentViewport.x + panDelta.x,
        y: currentViewport.y + panDelta.y,
        zoom: currentViewport.zoom
      };
    } else {
      nextViewport = getViewportForBounds(
        revealBounds,
        canvasBounds.width,
        canvasBounds.height,
        minimumAllowedZoom,
        currentViewport.zoom,
        `${CREATOR_CANVAS_RESULT_REVEAL_SAFE_INSET}px`
      );
    }

    consume();
    if (!isMountedRef.current) return;
    void reactFlow.setViewport(nextViewport, {
      duration: CREATOR_CANVAS_RESULT_REVEAL_DURATION_MS,
      interpolate: "linear"
    }).catch(() => undefined);
  }, [
    canvasDocument.nodes,
    canvasRuntimeState.pendingResultReveals,
    consumePendingResultReveal,
    reactFlow,
    rendererStateByNodeId
  ]);

  const selectedImageComposerContext = useMemo(() => {
    if (selectedNodeIds.size !== 1 || selectedEdgeIds.size !== 0) return null;
    const selectedNodeId = selectedNodeIds.values().next().value as string | undefined;
    if (!selectedNodeId) return null;
    const context = buildCreatorNodeComposerContext(canvasDocument, selectedNodeId);
    return context?.node.kind === "image" ? context : null;
  }, [canvasDocument, selectedEdgeIds.size, selectedNodeIds]);

  const selectedTextAiContext = useMemo(() => {
    if (selectedNodeIds.size !== 1 || selectedEdgeIds.size !== 0) return null;
    const selectedNodeId = selectedNodeIds.values().next().value as string | undefined;
    if (!selectedNodeId) return null;
    const context = buildCreatorNodeComposerContext(canvasDocument, selectedNodeId);
    const node = context?.node;
    return node?.kind === "text" && context
      ? { ...context, node }
      : null;
  }, [canvasDocument, selectedEdgeIds.size, selectedNodeIds]);

  const selectedImageAssetId = selectedImageComposerContext?.node.kind === "image"
    ? selectedImageComposerContext.node.data.assetId
    : null;
  const selectedImageAssetDisplay = useCreatorImageAssetDisplay({
    assetId: selectedImageAssetId,
    token: assetToken,
    enabled: selectedImageAssetId !== null
  });
  const selectedTextAiModelId = useMemo(
    () => selectedTextAiContext
      ? getCreatorTextAiEffectiveModelId(
          selectedTextAiContext.node.data.ai?.modelId,
          textAiModels
        ) ?? ""
      : "",
    [selectedTextAiContext, textAiModels]
  );

  const selectedImageComposerDraft = useMemo(() => {
    if (!selectedImageComposerContext) return null;
    const current = imageComposerDrafts.get(selectedImageComposerContext.node.id) ??
      createCreatorImageComposerDraft(imageModels[0]?.slug ?? "");
    return reconcileCreatorImageComposerDraft(
      current,
      selectedImageComposerContext,
      imageModels
    );
  }, [imageComposerDrafts, imageModels, selectedImageComposerContext]);

  useEffect(() => {
    if (!selectedImageComposerContext || !selectedImageComposerDraft) return;
    const nodeId = selectedImageComposerContext.node.id;
    const current = imageComposerDraftsRef.current;
    if (current.get(nodeId) === selectedImageComposerDraft) return;
    const next = new Map(current);
    next.set(nodeId, selectedImageComposerDraft);
    applyLiveCanvasState(canvasDocumentRef.current, next);
  }, [applyLiveCanvasState, selectedImageComposerContext, selectedImageComposerDraft]);

  const updateSelectedImageComposerDraft = useCallback((
    update: (draft: CreatorImageComposerDraft) => CreatorImageComposerDraft
  ) => {
    if (!selectedImageComposerContext) return;
    const nodeId = selectedImageComposerContext.node.id;
    const current = imageComposerDraftsRef.current;
    const draft = current.get(nodeId) ??
      createCreatorImageComposerDraft(imageModels[0]?.slug ?? "");
    const nextDraft = reconcileCreatorImageComposerDraft(
      update(draft),
      selectedImageComposerContext,
      imageModels
    );
    if (draft === nextDraft) return;
    const next = new Map(current);
    next.set(nodeId, nextDraft);
    applyLiveCanvasState(canvasDocumentRef.current, next);
  }, [applyLiveCanvasState, imageModels, selectedImageComposerContext]);

  const updateTextAiConfig = useCallback((
    nodeId: string,
    update: (config: CreatorTextAiConfig) => CreatorTextAiConfig
  ) => {
    commitSemanticMutation(({ document }) => {
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.kind !== "text") return null;
      const current: CreatorTextAiConfig = node.data.ai
        ? { ...node.data.ai }
        : { instruction: "", modelId: "" };
      const next = update(current);
      if (
        typeof next.instruction !== "string" ||
        typeof next.modelId !== "string"
      ) {
        return null;
      }
      return {
        document: {
          ...document,
          nodes: document.nodes.map((candidate) =>
            candidate.id === nodeId && candidate.kind === "text"
              ? { ...candidate, data: { ...candidate.data, ai: { ...next } } }
              : candidate
          )
        }
      };
    });
  }, [commitSemanticMutation]);

  const setImageExecutionRuntime = useCallback((
    nodeId: string,
    runtime: CreatorImageExecutionRuntimeState | null
  ) => {
    if (!isMountedRef.current) return;
    setImageExecutionRuntimeByNodeId((current) => {
      if (runtime === null) {
        if (!current.has(nodeId)) return current;
        const next = new Map(current);
        next.delete(nodeId);
        return next;
      }
      const existing = current.get(nodeId);
      if (
        existing?.status === runtime.status &&
        existing.errorMessage === runtime.errorMessage
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(nodeId, runtime);
      return next;
    });
  }, []);

  const abortImageExecution = useCallback((nodeId: string) => {
    const execution = activeImageExecutionsRef.current.get(nodeId);
    execution?.controller.abort();
    activeImageExecutionsRef.current.delete(nodeId);
    setImageExecutionRuntime(nodeId, null);
  }, [setImageExecutionRuntime]);

  const abortTextAiExecution = useCallback((nodeId: string) => {
    const execution = activeTextAiExecutionsRef.current.get(nodeId);
    execution?.controller.abort();
    activeTextAiExecutionsRef.current.delete(nodeId);
    setTextAiExecutionRuntime(nodeId, null);
  }, [setTextAiExecutionRuntime]);

  const executeTextAi = useCallback(async (targetNodeId: string) => {
    if (activeTextAiExecutionsRef.current.has(targetNodeId)) return;
    const target = canvasDocumentRef.current.nodes.find(
      (node) => node.id === targetNodeId
    );
    if (!target || target.kind !== "text") return;

    if (
      workspaceAuthStatus !== "authenticated" ||
      !assetToken ||
      !workspaceUserId
    ) {
      setTextAiExecutionRuntime(targetNodeId, {
        status: "failed",
        errorMessage: t("creator.canvas.textAi.loginRequired")
      });
      return;
    }

    const effectiveModelId = getCreatorTextAiEffectiveModelId(
      target.data.ai?.modelId,
      textAiModels
    );
    const validation = validateCreatorTextAiExecution({
      instruction: target.data.ai?.instruction ?? "",
      modelId: effectiveModelId
    });
    if (!validation.ok) {
      setTextAiExecutionRuntime(targetNodeId, {
        status: "failed",
        errorMessage: validation.reason === "blank-instruction"
          ? t("creator.canvas.textAi.blankInstruction")
          : t("creator.canvas.textAi.noModels")
      });
      return;
    }

    const prompt = compileCreatorTextAiPrompt(
      canvasDocumentRef.current,
      targetNodeId,
      target.data.ai?.instruction ?? ""
    );
    const controller = new AbortController();
    const execution: ActiveCreatorTextAiExecution = {
      targetNodeId,
      controller,
      generation: textAiExecutionGenerationRef.current,
      canvasGeneration: canvasSessionGenerationRef.current,
      authIdentity: workspaceAuthIdentityRef.current
    };
    activeTextAiExecutionsRef.current.set(targetNodeId, execution);
    setTextAiExecutionRuntime(targetNodeId, {
      status: "executing",
      errorMessage: null
    });

    const isCurrentExecution = () => {
      const active = activeTextAiExecutionsRef.current.get(targetNodeId);
      return (
        isMountedRef.current &&
        active === execution &&
        !controller.signal.aborted &&
        execution.generation === textAiExecutionGenerationRef.current &&
        execution.canvasGeneration === canvasSessionGenerationRef.current &&
        execution.authIdentity === workspaceAuthIdentityRef.current &&
        canvasDocumentRef.current.nodes.some(
          (node) => node.id === targetNodeId && node.kind === "text"
        )
      );
    };

    try {
      const response = await fetch(apiUrl("/chat/completions"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${assetToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          stateless: true,
          model: validation.modelId,
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error("CREATOR_TEXT_AI_REQUEST_FAILED");
      const parsed = parseCreatorTextAiCompletionResponse(
        await response.json() as unknown
      );
      if (!parsed.ok) throw new Error("CREATOR_TEXT_AI_RESPONSE_INVALID");
      if (!isCurrentExecution()) return;

      const applyTextAiResultToSnapshot = (snapshot: CreatorCanvasHistorySnapshot) => {
        const currentTarget = snapshot.document.nodes.find(
          (node) => node.id === targetNodeId
        );
        if (!currentTarget || currentTarget.kind !== "text") return null;
        return {
          snapshot: createCreatorCanvasHistorySnapshot(
            {
              ...snapshot.document,
              nodes: snapshot.document.nodes.map((node) =>
                node.id === targetNodeId && node.kind === "text"
                  ? { ...node, data: { ...node.data, text: parsed.content } }
                  : node
              )
            },
            snapshot.imageComposerDrafts,
            snapshot.videoComposerDrafts
          ),
          value: null
        };
      };
      let resultApplied = false;
      if (historyRef.current?.hasOpenTransaction) {
        const interleaved = historyRef.current.interleaveOpenTransaction(
          readHistorySnapshot(),
          applyTextAiResultToSnapshot
        );
        if (interleaved) {
          applyLiveCanvasState(
            interleaved.current.document,
            interleaved.current.imageComposerDrafts,
            interleaved.current.videoComposerDrafts
          );
          resultApplied = true;
          if (interleaved.recorded) {
            setHistoryRevision((current) => current + 1);
          }
        }
      } else {
        commitSemanticMutation(({ document, imageComposerDrafts, videoComposerDrafts }) => {
          const outcome = applyTextAiResultToSnapshot(
            createCreatorCanvasHistorySnapshot(
              document,
              imageComposerDrafts,
              videoComposerDrafts
            )
          );
          if (!outcome) return null;
          resultApplied = true;
          return {
            document: outcome.snapshot.document,
            imageComposerDrafts: outcome.snapshot.imageComposerDrafts,
            videoComposerDrafts: outcome.snapshot.videoComposerDrafts
          };
        });
      }
      if (!resultApplied) {
        activeTextAiExecutionsRef.current.delete(targetNodeId);
        setTextAiExecutionRuntime(targetNodeId, null);
        refreshQuota?.();
        return;
      }
      if (!isCurrentExecution()) return;
      activeTextAiExecutionsRef.current.delete(targetNodeId);
      setTextAiExecutionRuntime(targetNodeId, null);
      refreshQuota?.();
    } catch (error) {
      if (!isCurrentExecution()) return;
      activeTextAiExecutionsRef.current.delete(targetNodeId);
      if (isAbortError(error) || controller.signal.aborted) {
        setTextAiExecutionRuntime(targetNodeId, null);
        return;
      }
      setTextAiExecutionRuntime(targetNodeId, {
        status: "failed",
        errorMessage: t("creator.canvas.textAi.executionFailed")
      });
      refreshQuota?.();
    }
  }, [
    applyLiveCanvasState,
    assetToken,
    commitSemanticMutation,
    refreshQuota,
    readHistorySnapshot,
    setTextAiExecutionRuntime,
    t,
    textAiModels,
    workspaceAuthStatus,
    workspaceUserId
  ]);

  const runImageGenerationAttempt = useCallback(async (
    execution: ActiveCreatorImageExecution & {
      attempt: ImageGenerationAttempt<GenericImageGenerationRequestPayload>;
      requestStartedAt: Date;
    },
    token: string
  ) => {
    const outcome = await submitAndReconcileImageGeneration({
      attempt: execution.attempt,
      token,
      submissionEndpoint: apiUrl("/image/generate"),
      tasksEndpoint: apiUrl("/tasks?type=image&limit=20"),
      taskDetailEndpoint: (taskId) => apiUrl(`/tasks/${taskId}`),
      fetchImplementation: fetch,
      requestStartedAt: execution.requestStartedAt,
      signal: execution.controller.signal,
      onPollingStarted: () => {
        const active = activeImageExecutionsRef.current.get(
          execution.targetNodeId
        );
        if (
          active?.controller === execution.controller &&
          !execution.controller.signal.aborted
        ) {
          setImageExecutionRuntime(execution.targetNodeId, {
            status: "checking",
            errorMessage: null
          });
        }
      }
    });

    const active = activeImageExecutionsRef.current.get(execution.targetNodeId);
    if (
      !isMountedRef.current ||
      active?.controller !== execution.controller ||
      execution.controller.signal.aborted ||
      outcome.kind === "aborted"
    ) {
      return;
    }

    if (outcome.kind === "unresolved") {
      setImageExecutionRuntime(execution.targetNodeId, {
        status: "unresolved",
        errorMessage: null
      });
      return;
    }

    activeImageExecutionsRef.current.delete(execution.targetNodeId);

    if (outcome.kind === "failed") {
      let errorMessage = t("multimodal.error.generateFailed");
      if (
        outcome.source === "submission" &&
        isStructuredImageGenerationFailureBody(outcome.submission.body)
      ) {
        errorMessage = outcome.submission.body.message;
      } else if (
        outcome.source === "reconciliation" &&
        outcome.task.errorMessage?.trim()
      ) {
        errorMessage = outcome.task.errorMessage;
      }
      setImageExecutionRuntime(execution.targetNodeId, {
        status: "failed",
        errorMessage
      });
      return;
    }

    const orderedAssetIds = outcome.assets.flatMap((asset) =>
      asset.type === "image" && asset.id.trim() ? [asset.id] : []
    );
    if (orderedAssetIds.length === 0) {
      setImageExecutionRuntime(execution.targetNodeId, {
        status: "failed",
        errorMessage: t("multimodal.error.generateFailed")
      });
      return;
    }

    const revealToken = ++nextRevealTokenRef.current;
    const rendererSnapshot = new Map(rendererStateByNodeIdRef.current);
    const frozenExistingIds = new Set(
      canvasDocumentRef.current.nodes.map((node) => node.id)
    );
    const frozenSiblingNodeIds = Array.from(
      { length: orderedAssetIds.length },
      () => {
        const id = createCanvasId("image", frozenExistingIds);
        frozenExistingIds.add(id);
        return id;
      }
    );
    const applyResultToSnapshot = (snapshot: CreatorCanvasHistorySnapshot) => {
      const target = snapshot.document.nodes.find(
        (node) => node.id === execution.targetNodeId && node.kind === "image"
      );
      if (!target || target.kind !== "image") return null;
      const targetSize = getCreatorCanvasRuntimeNodeSize(
        target,
        rendererSnapshot.get(target.id)
      );
      const siblingCount = target.data.assetId === null
        ? Math.max(0, orderedAssetIds.length - 1)
        : orderedAssetIds.length;
      const siblingPositions = planCreatorCanvasResultSiblingPositions({
        targetRect: { ...target.position, ...targetSize },
        occupiedRects: snapshot.document.nodes.map((node) => ({
          ...node.position,
          ...getCreatorCanvasRuntimeNodeSize(
            node,
            rendererSnapshot.get(node.id)
          )
        })),
        resultSize: targetSize,
        siblingCount,
        clearance: CREATOR_CANVAS_LOCAL_PLACEMENT_CLEARANCE
      });
      const result = applyCreatorImageResults({
        document: snapshot.document,
        targetNodeId: execution.targetNodeId,
        orderedAssetIds,
        siblingPositions,
        createNodeId: (_assetId, index) => frozenSiblingNodeIds[index] ?? ""
      });
      if (!result.ok) return null;
      return {
        snapshot: createCreatorCanvasHistorySnapshot(
          result.document,
          snapshot.imageComposerDrafts,
          snapshot.videoComposerDrafts
        ),
        value: result.createdNodeIds
      };
    };
    const hasOpenHistoryTransaction = historyRef.current?.hasOpenTransaction ?? false;
    let committed = false;
    let createdNodeIds: string[] = [];
    if (hasOpenHistoryTransaction) {
      const interleaved = historyRef.current?.interleaveOpenTransaction(
        readHistorySnapshot(),
        applyResultToSnapshot
      );
      if (interleaved) {
        applyLiveCanvasState(
          interleaved.current.document,
          interleaved.current.imageComposerDrafts,
          interleaved.current.videoComposerDrafts
        );
        createdNodeIds = [...interleaved.value];
        committed = interleaved.recorded;
        if (interleaved.recorded) {
          setHistoryRevision((current) => current + 1);
        }
      }
    } else {
      committed = commitSemanticMutation(({ document, imageComposerDrafts, videoComposerDrafts }) => {
        const outcome = applyResultToSnapshot(
          createCreatorCanvasHistorySnapshot(
            document,
            imageComposerDrafts,
            videoComposerDrafts
          )
        );
        if (!outcome) return null;
        createdNodeIds = [...outcome.value];
        return {
          document: outcome.snapshot.document,
          imageComposerDrafts: outcome.snapshot.imageComposerDrafts,
          videoComposerDrafts: outcome.snapshot.videoComposerDrafts
        };
      });
    }
    if (committed && createdNodeIds.length > 0) {
      setCanvasRuntimeState((current) => ({
        ...current,
        pendingResultReveals: [
          ...current.pendingResultReveals,
          {
            token: revealToken,
            targetNodeId: execution.targetNodeId,
            createdNodeIds,
            viewportRevisionAtGenerationStart:
              execution.viewportRevisionAtGenerationStart
          }
        ]
      }));
    }
    setImageExecutionRuntime(execution.targetNodeId, null);
  }, [
    applyLiveCanvasState,
    commitSemanticMutation,
    readHistorySnapshot,
    setImageExecutionRuntime,
    t
  ]);

  const executeNewImageGeneration = useCallback(async (
    targetNodeId: string,
    draft: CreatorImageComposerDraft,
    context: NonNullable<typeof selectedImageComposerContext>
  ) => {
    if (activeImageExecutionsRef.current.has(targetNodeId) || !assetToken) {
      return;
    }
    const compiled = compileCreatorImageExecutionIntent({
      draft,
      context,
      models: imageModels
    });
    if (!compiled.ok) {
      return;
    }

    const controller = new AbortController();
    const execution: ActiveCreatorImageExecution = {
      targetNodeId,
      controller,
      attempt: null,
      requestStartedAt: null,
      viewportRevisionAtGenerationStart: viewportMovementRevisionRef.current
    };
    activeImageExecutionsRef.current.set(targetNodeId, execution);
    setImageExecutionRuntime(targetNodeId, {
      status: compiled.intent.mode === "image-to-image" ? "preparing" : "submitting",
      errorMessage: null
    });

    try {
      const payload = await prepareCreatorImageGenerationPayload({
        intent: compiled.intent,
        token: assetToken,
        clientEntryId: createSecureUuid(),
        controller
      });
      if (
        controller.signal.aborted ||
        !canvasDocumentRef.current.nodes.some(
          (node) => node.id === targetNodeId && node.kind === "image"
        )
      ) {
        abortImageExecution(targetNodeId);
        return;
      }

      const attempt = createImageGenerationAttempt(payload);
      const requestStartedAt = new Date();
      execution.attempt = attempt;
      execution.requestStartedAt = requestStartedAt;
      setImageExecutionRuntime(targetNodeId, {
        status: "submitting",
        errorMessage: null
      });
      await runImageGenerationAttempt(
        { ...execution, attempt, requestStartedAt },
        assetToken
      );
    } catch (error) {
      const active = activeImageExecutionsRef.current.get(targetNodeId);
      if (active?.controller !== controller) return;
      activeImageExecutionsRef.current.delete(targetNodeId);
      if (
        isAbortError(error) ||
        (controller.signal.aborted &&
          !(error instanceof CreatorImageReferencePreparationError))
      ) {
        setImageExecutionRuntime(targetNodeId, null);
        return;
      }
      setImageExecutionRuntime(targetNodeId, {
        status: "failed",
        errorMessage: error instanceof CreatorImageReferencePreparationError
          ? t(error.errorKey)
          : t("multimodal.error.generateFailed")
      });
    }
  }, [
    abortImageExecution,
    assetToken,
    imageModels,
    runImageGenerationAttempt,
    setImageExecutionRuntime,
    t
  ]);

  const resumeImageGeneration = useCallback(async (targetNodeId: string) => {
    const retained = activeImageExecutionsRef.current.get(targetNodeId);
    if (
      !assetToken ||
      !retained?.attempt ||
      !retained.requestStartedAt ||
      imageExecutionRuntimeByNodeId.get(targetNodeId)?.status !== "unresolved" ||
      !canvasDocumentRef.current.nodes.some(
        (node) => node.id === targetNodeId && node.kind === "image"
      )
    ) {
      return;
    }

    const controller = new AbortController();
    const execution = {
      targetNodeId,
      controller,
      attempt: retained.attempt,
      requestStartedAt: retained.requestStartedAt,
      viewportRevisionAtGenerationStart: retained.viewportRevisionAtGenerationStart
    };
    activeImageExecutionsRef.current.set(targetNodeId, execution);
    setImageExecutionRuntime(targetNodeId, {
      status: "submitting",
      errorMessage: null
    });
    try {
      await runImageGenerationAttempt(execution, assetToken);
    } catch (error) {
      const active = activeImageExecutionsRef.current.get(targetNodeId);
      if (active?.controller !== controller) return;
      activeImageExecutionsRef.current.delete(targetNodeId);
      setImageExecutionRuntime(
        targetNodeId,
        controller.signal.aborted || isAbortError(error)
          ? null
          : {
              status: "failed",
              errorMessage: t("multimodal.error.generateFailed")
            }
      );
    }
  }, [
    assetToken,
    imageExecutionRuntimeByNodeId,
    runImageGenerationAttempt,
    setImageExecutionRuntime,
    t
  ]);

  const selectedVideoComposerContext = useMemo(() => {
    if (selectedNodeIds.size !== 1 || selectedEdgeIds.size !== 0) return null;
    const selectedNodeId = selectedNodeIds.values().next().value as string | undefined;
    if (!selectedNodeId) return null;
    const context = buildCreatorNodeComposerContext(canvasDocument, selectedNodeId);
    return context?.node.kind === "video" ? context : null;
  }, [canvasDocument, selectedEdgeIds.size, selectedNodeIds]);

  const selectedVideoAssetId = selectedVideoComposerContext?.node.kind === "video"
    ? selectedVideoComposerContext.node.data.assetId
    : null;
  const selectedVideoAssetDisplay = useCreatorVideoAssetDisplay({
    assetId: selectedVideoAssetId,
    token: assetToken,
    enabled: selectedVideoAssetId !== null
  });

  const selectedVideoComposerDraft = useMemo(() => {
    if (!selectedVideoComposerContext) return null;
    const current = videoComposerDrafts.get(selectedVideoComposerContext.node.id) ??
      createCreatorVideoComposerDraft(
        getCreatorVideoEffectiveModelId(
          undefined,
          "text-to-video",
          videoModels
        ) ?? ""
      );
    return reconcileCreatorVideoComposerDraft(
      current,
      selectedVideoComposerContext,
      videoModels
    );
  }, [selectedVideoComposerContext, videoComposerDrafts, videoModels]);

  const updateSelectedVideoComposerDraft = useCallback((
    update: (draft: CreatorVideoComposerDraft) => CreatorVideoComposerDraft
  ) => {
    if (!selectedVideoComposerContext) return;
    const nodeId = selectedVideoComposerContext.node.id;
    const current = videoComposerDraftsRef.current.get(nodeId) ??
      createCreatorVideoComposerDraft(
        getCreatorVideoEffectiveModelId(undefined, "text-to-video", videoModels) ?? ""
      );
    const nextDraft = reconcileCreatorVideoComposerDraft(
      update(cloneCreatorVideoComposerDraft(current)),
      selectedVideoComposerContext,
      videoModels
    );
    if (JSON.stringify(current) === JSON.stringify(nextDraft)) return;
    const next = new Map(videoComposerDraftsRef.current);
    next.set(nodeId, nextDraft);
    commitSemanticMutation(({ document, imageComposerDrafts }) => ({
      document,
      imageComposerDrafts,
      videoComposerDrafts: next
    }));
  }, [commitSemanticMutation, selectedVideoComposerContext, videoModels]);

  const applyVideoResultToCanvas = useCallback((
    execution: ActiveCreatorVideoExecution,
    assetId: string
  ): { applied: boolean; createdNodeIds: string[] } => {
    const rendererSnapshot = new Map(rendererStateByNodeIdRef.current);
    const currentTarget = canvasDocumentRef.current.nodes.find(
      (node) => node.id === execution.targetNodeId && node.kind === "video"
    );
    if (!currentTarget || currentTarget.kind !== "video") {
      return { applied: false, createdNodeIds: [] };
    }
    const frozenExistingIds = new Set(
      canvasDocumentRef.current.nodes.map((node) => node.id)
    );
    const transactionStart = historyRef.current?.getOpenTransactionStart();
    const transactionStartTarget = transactionStart?.document.nodes.find(
      (node) => node.id === execution.targetNodeId && node.kind === "video"
    );
    const frozenSiblingNodeId = (
      currentTarget.data.assetId !== null ||
      (transactionStartTarget?.kind === "video" && transactionStartTarget.data.assetId !== null)
    )
      ? createCanvasId("video", frozenExistingIds)
      : "";
    const applyResultToSnapshot = (snapshot: CreatorCanvasHistorySnapshot) => {
      const target = snapshot.document.nodes.find(
        (node) => node.id === execution.targetNodeId && node.kind === "video"
      );
      if (!target || target.kind !== "video") return null;
      let siblingPosition: XYPosition | undefined;
      if (target.data.assetId !== null) {
        const targetSize = getCreatorCanvasRuntimeNodeSize(
          target,
          rendererSnapshot.get(target.id)
        );
        const positions = planCreatorCanvasResultSiblingPositions({
          targetRect: { ...target.position, ...targetSize },
          occupiedRects: snapshot.document.nodes.map((node) => ({
            ...node.position,
            ...getCreatorCanvasRuntimeNodeSize(node, rendererSnapshot.get(node.id))
          })),
          resultSize: targetSize,
          siblingCount: 1,
          clearance: CREATOR_CANVAS_LOCAL_PLACEMENT_CLEARANCE
        });
        siblingPosition = positions[0];
      }
      const result = applyCreatorVideoResult({
        document: snapshot.document,
        targetNodeId: execution.targetNodeId,
        assetId,
        siblingPosition,
        createNodeId: () => frozenSiblingNodeId
      });
      if (!result.ok) return null;
      return {
        snapshot: createCreatorCanvasHistorySnapshot(
          result.document,
          snapshot.imageComposerDrafts,
          snapshot.videoComposerDrafts
        ),
        value: result.createdNodeIds
      };
    };

    let createdNodeIds: string[] = [];
    const hasOpenTransaction = historyRef.current?.hasOpenTransaction ?? false;
    if (hasOpenTransaction) {
      const interleaved = historyRef.current?.interleaveOpenTransaction(
        readHistorySnapshot(),
        applyResultToSnapshot
      );
      if (!interleaved) return { applied: false, createdNodeIds: [] };
      applyLiveCanvasState(
        interleaved.current.document,
        interleaved.current.imageComposerDrafts,
        interleaved.current.videoComposerDrafts
      );
      createdNodeIds = [...interleaved.value];
      if (interleaved.recorded) setHistoryRevision((current) => current + 1);
      return { applied: true, createdNodeIds };
    }

    let applied = false;
    const committed = commitSemanticMutation(({ document, imageComposerDrafts, videoComposerDrafts }) => {
      const outcome = applyResultToSnapshot(
        createCreatorCanvasHistorySnapshot(
          document,
          imageComposerDrafts,
          videoComposerDrafts
        )
      );
      if (!outcome) return null;
      applied = true;
      createdNodeIds = [...outcome.value];
      return {
        document: outcome.snapshot.document,
        imageComposerDrafts: outcome.snapshot.imageComposerDrafts,
        videoComposerDrafts: outcome.snapshot.videoComposerDrafts
      };
    });
    return { applied: committed && applied, createdNodeIds };
  }, [
    applyLiveCanvasState,
    commitSemanticMutation,
    readHistorySnapshot
  ]);

  const isCurrentVideoExecution = useCallback((
    execution: ActiveCreatorVideoExecution
  ): boolean => {
    const active = activeVideoExecutionsRef.current.get(execution.targetNodeId);
    return Boolean(
      isMountedRef.current &&
      active === execution &&
      !execution.controller.signal.aborted &&
      execution.generation === videoExecutionGenerationRef.current &&
      execution.canvasGeneration === canvasSessionGenerationRef.current &&
      execution.authIdentity === workspaceAuthIdentityRef.current &&
      canvasDocumentRef.current.nodes.some(
        (node) => node.id === execution.targetNodeId && node.kind === "video"
      )
    );
  }, []);

  const finishVideoExecution = useCallback((
    execution: ActiveCreatorVideoExecution,
    runtime: CreatorVideoExecutionRuntimeState | null,
    refresh = true
  ) => {
    if (activeVideoExecutionsRef.current.get(execution.targetNodeId) !== execution) return;
    activeVideoExecutionsRef.current.delete(execution.targetNodeId);
    setVideoExecutionRuntime(execution.targetNodeId, runtime);
    if (refresh) refreshQuota?.();
  }, [refreshQuota, setVideoExecutionRuntime]);

  const applyTerminalVideoDetail = useCallback((
    execution: ActiveCreatorVideoExecution,
    detail: CreatorVideoTaskDetail
  ): "completed" | "failed" | "stale" => {
    if (!isCurrentVideoExecution(execution)) return "stale";
    if (detail.task.status === "failed") {
      finishVideoExecution(execution, {
        status: "failed",
        progress: readCreatorVideoTaskProgress(detail.task),
        taskId: detail.task.id,
        errorMessage: t("creator.canvas.videoComposer.taskFailed")
      });
      return "failed";
    }
    if (detail.task.status !== "succeeded") return "failed";
    const terminal = selectCreatorVideoTerminalAsset(detail, detail.task.id);
    if (!terminal) {
      finishVideoExecution(execution, {
        status: "failed",
        progress: null,
        taskId: detail.task.id,
        errorMessage: t("creator.canvas.videoComposer.resultUnavailable")
      });
      return "failed";
    }
    const result = applyVideoResultToCanvas(execution, terminal.asset.id);
    if (!result.applied) {
      if (isCurrentVideoExecution(execution)) finishVideoExecution(execution, null, false);
      return "stale";
    }
    const revealToken = ++nextRevealTokenRef.current;
    if (result.createdNodeIds.length > 0) {
      setCanvasRuntimeState((current) => ({
        ...current,
        pendingResultReveals: [
          ...current.pendingResultReveals,
          {
            token: revealToken,
            targetNodeId: execution.targetNodeId,
            createdNodeIds: result.createdNodeIds,
            viewportRevisionAtGenerationStart: execution.viewportRevisionAtGenerationStart
          }
        ]
      }));
    }
    finishVideoExecution(execution, null);
    return "completed";
  }, [
    applyVideoResultToCanvas,
    finishVideoExecution,
    isCurrentVideoExecution,
    setVideoExecutionRuntime,
    t
  ]);

  const observeVideoTask = useCallback(async (
    execution: ActiveCreatorVideoExecution,
    taskId: string,
    token: string
  ): Promise<"completed" | "failed" | "unresolved" | "stale"> => {
    execution.taskId = taskId;
    execution.pollingAttempts = 0;
    setVideoExecutionRuntime(execution.targetNodeId, {
      status: "checking",
      progress: null,
      taskId,
      errorMessage: null
    });
    while (execution.pollingAttempts < CREATOR_VIDEO_POLL_MAX_ATTEMPTS) {
      if (!isCurrentVideoExecution(execution)) return "stale";
      execution.pollingAttempts += 1;
      let response: Response;
      try {
        response = await fetch(apiUrl(`/tasks/${encodeURIComponent(taskId)}`), {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: execution.controller.signal
        });
      } catch (error) {
        if (!isCurrentVideoExecution(execution)) return "stale";
        if (isAbortError(error)) return "stale";
        setVideoExecutionRuntime(execution.targetNodeId, {
          status: "unresolved",
          progress: null,
          taskId,
          errorMessage: null
        });
        return "unresolved";
      }
      if (!response.ok) {
        if (!isCurrentVideoExecution(execution)) return "stale";
        setVideoExecutionRuntime(execution.targetNodeId, {
          status: "unresolved",
          progress: null,
          taskId,
          errorMessage: null
        });
        return "unresolved";
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        if (!isCurrentVideoExecution(execution)) return "stale";
        setVideoExecutionRuntime(execution.targetNodeId, {
          status: "unresolved",
          progress: null,
          taskId,
          errorMessage: null
        });
        return "unresolved";
      }
      const detail = parseCreatorVideoTaskDetail(raw);
      if (!detail || detail.task.id !== taskId) {
        if (!isCurrentVideoExecution(execution)) return "stale";
        setVideoExecutionRuntime(execution.targetNodeId, {
          status: "unresolved",
          progress: null,
          taskId,
          errorMessage: null
        });
        return "unresolved";
      }
      const progress = readCreatorVideoTaskProgress(detail.task);
      if (detail.task.status === "succeeded" || detail.task.status === "failed") {
        return applyTerminalVideoDetail(execution, detail);
      }
      setVideoExecutionRuntime(execution.targetNodeId, {
        status: "checking",
        progress,
        taskId,
        errorMessage: null
      });
      if (execution.pollingAttempts >= CREATOR_VIDEO_POLL_MAX_ATTEMPTS) break;
      try {
        await waitForCreatorVideoDelay(CREATOR_VIDEO_POLL_INTERVAL_MS, execution.controller.signal);
      } catch (error) {
        if (!isCurrentVideoExecution(execution) || isAbortError(error)) return "stale";
        setVideoExecutionRuntime(execution.targetNodeId, {
          status: "unresolved",
          progress: null,
          taskId,
          errorMessage: null
        });
        return "unresolved";
      }
    }
    if (isCurrentVideoExecution(execution)) {
      setVideoExecutionRuntime(execution.targetNodeId, {
        status: "unresolved",
        progress: null,
        taskId,
        errorMessage: null
      });
      return "unresolved";
    }
    return "stale";
  }, [
    applyTerminalVideoDetail,
    isCurrentVideoExecution,
    setVideoExecutionRuntime
  ]);

  const submitVideoAttempt = useCallback(async (
    execution: ActiveCreatorVideoExecution,
    token: string
  ): Promise<"completed" | "failed" | "unresolved" | "stale"> => {
    const attempt = execution.attempt;
    if (!attempt) return "stale";
    setVideoExecutionRuntime(execution.targetNodeId, {
      status: "submitting",
      progress: null,
      taskId: execution.taskId,
      errorMessage: null
    });
    let response: Response;
    try {
      response = await fetch(apiUrl("/video/generate"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key
        },
        body: JSON.stringify(attempt.payload),
        signal: execution.controller.signal
      });
    } catch (error) {
      if (!isCurrentVideoExecution(execution) || isAbortError(error)) return "stale";
      setVideoExecutionRuntime(execution.targetNodeId, {
        status: "unresolved",
        progress: null,
        taskId: execution.taskId,
        errorMessage: null
      });
      return "unresolved";
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      raw = null;
    }
    const submissionUncertain = (
      typeof raw === "object" &&
      raw !== null &&
      !Array.isArray(raw) &&
      (raw as { code?: unknown }).code === "VIDEO_SUBMISSION_UNCERTAIN"
    );
    if (submissionUncertain) {
      if (!isCurrentVideoExecution(execution)) return "stale";
      setVideoExecutionRuntime(execution.targetNodeId, {
        status: "unresolved",
        progress: null,
        taskId: null,
        errorMessage: null
      });
      return "unresolved";
    }
    const parsed = parseCreatorVideoSubmissionResponse(response.status, raw);
    if (parsed.kind === "failed") {
      if (!isCurrentVideoExecution(execution)) return "stale";
      if (response.ok) {
        setVideoExecutionRuntime(execution.targetNodeId, {
          status: "unresolved",
          progress: null,
          taskId: execution.taskId,
          errorMessage: null
        });
        return "unresolved";
      }
      finishVideoExecution(execution, {
        status: "failed",
        progress: null,
        taskId: null,
        errorMessage: parsed.reason === "conflict"
          ? t("creator.canvas.videoComposer.idempotencyConflict")
          : t("creator.canvas.videoComposer.submissionFailed")
      });
      return "stale";
    }
    if (parsed.kind === "replayed") {
      execution.taskId = parsed.detail.task.id;
      if (parsed.detail.task.status === "pending" || parsed.detail.task.status === "running") {
        return observeVideoTask(execution, parsed.detail.task.id, token);
      }
      return applyTerminalVideoDetail(execution, parsed.detail);
    }
    if (parsed.taskId) {
      execution.taskId = parsed.taskId;
      return observeVideoTask(execution, parsed.taskId, token);
    }

    if (!isCurrentVideoExecution(execution)) return "stale";
    if (execution.submissionReplayCount >= 1) {
      setVideoExecutionRuntime(execution.targetNodeId, {
        status: "unresolved",
        progress: null,
        taskId: null,
        errorMessage: null
      });
      return "unresolved";
    }
    execution.submissionReplayCount += 1;
    try {
      await waitForCreatorVideoDelay(
        parsed.retryAfterMs || CREATOR_VIDEO_SUBMISSION_REPLAY_DELAY_MS,
        execution.controller.signal
      );
    } catch (error) {
      if (!isCurrentVideoExecution(execution) || isAbortError(error)) return "stale";
      setVideoExecutionRuntime(execution.targetNodeId, {
        status: "unresolved",
        progress: null,
        taskId: execution.taskId,
        errorMessage: null
      });
      return "unresolved";
    }
    if (!isCurrentVideoExecution(execution)) return "stale";
    execution.taskId = null;
    return submitVideoAttempt(execution, token);
  }, [
    applyTerminalVideoDetail,
    finishVideoExecution,
    isCurrentVideoExecution,
    observeVideoTask,
    setVideoExecutionRuntime,
    t
  ]);

  const executeVideoGeneration = useCallback(async (
    targetNodeId: string,
    draft: CreatorVideoComposerDraft,
    context: NonNullable<typeof selectedVideoComposerContext>
  ) => {
    if (activeVideoExecutionsRef.current.has(targetNodeId)) return;
    if (workspaceAuthStatus !== "authenticated" || !assetToken || !workspaceUserId) {
      setVideoExecutionRuntime(targetNodeId, {
        status: "failed",
        progress: null,
        taskId: null,
        errorMessage: t("creator.canvas.videoComposer.loginRequired")
      });
      return;
    }
    const compiled = compileCreatorVideoExecutionIntent({
      draft,
      context,
      models: videoModels
    });
    if (!compiled.ok) {
      setVideoExecutionRuntime(targetNodeId, {
        status: "failed",
        progress: null,
        taskId: null,
        errorMessage: compiled.error === "PROMPT_REQUIRED"
          ? t("creator.canvas.videoComposer.promptRequired")
          : compiled.error === "REFERENCE_REQUIRED"
            ? t("creator.canvas.videoComposer.referenceRequired")
            : t("creator.canvas.videoComposer.modelUnavailable")
      });
      return;
    }
    const controller = new AbortController();
    const execution: ActiveCreatorVideoExecution = {
      targetNodeId,
      controller,
      generation: videoExecutionGenerationRef.current,
      canvasGeneration: canvasSessionGenerationRef.current,
      authIdentity: workspaceAuthIdentityRef.current,
      attempt: null,
      intent: compiled.intent,
      payload: null,
      taskId: null,
      retryAfterMs: 0,
      viewportRevisionAtGenerationStart: viewportMovementRevisionRef.current,
      pollingAttempts: 0,
      submissionReplayCount: 0,
      recoveryInFlight: false
    };
    activeVideoExecutionsRef.current.set(targetNodeId, execution);
    setVideoExecutionRuntime(targetNodeId, {
      status: compiled.intent.mode === "image-to-video" ? "preparing" : "submitting",
      progress: null,
      taskId: null,
      errorMessage: null
    });
    try {
      const payload = await prepareCreatorVideoSubmissionPayload({
        intent: compiled.intent,
        token: assetToken,
        controller
      });
      if (!isCurrentVideoExecution(execution)) return;
      const attempt = createCreatorVideoExecutionAttempt(payload);
      execution.payload = attempt.payload;
      execution.attempt = attempt;
      await submitVideoAttempt(execution, assetToken);
    } catch (error) {
      if (!isCurrentVideoExecution(execution)) return;
      if (isAbortError(error) || controller.signal.aborted) {
        finishVideoExecution(execution, null, false);
        return;
      }
      const errorMessage = error instanceof Error && error.name === "CreatorVideoReferencePreparationError"
        ? t((error as unknown as { errorKey: string }).errorKey)
        : t("creator.canvas.videoComposer.submissionFailed");
      finishVideoExecution(execution, {
        status: "failed",
        progress: null,
        taskId: null,
        errorMessage
      });
    }
  }, [
    assetToken,
    finishVideoExecution,
    isCurrentVideoExecution,
    setVideoExecutionRuntime,
    submitVideoAttempt,
    t,
    videoModels,
    workspaceAuthStatus,
    workspaceUserId
  ]);

  const resumeVideoGeneration = useCallback(async (targetNodeId: string) => {
    const retained = activeVideoExecutionsRef.current.get(targetNodeId);
    if (
      !assetToken ||
      !retained?.attempt ||
      retained.recoveryInFlight ||
      videoExecutionRuntimeByNodeId.get(targetNodeId)?.status !== "unresolved" ||
      !canvasDocumentRef.current.nodes.some(
        (node) => node.id === targetNodeId && node.kind === "video"
      )
    ) return;
    const controller = new AbortController();
    const execution: ActiveCreatorVideoExecution = {
      ...retained,
      controller,
      generation: videoExecutionGenerationRef.current,
      authIdentity: workspaceAuthIdentityRef.current,
      pollingAttempts: 0,
      submissionReplayCount: retained.submissionReplayCount,
      recoveryInFlight: true
    };
    activeVideoExecutionsRef.current.set(targetNodeId, execution);
    setVideoExecutionRuntime(targetNodeId, {
      status: execution.taskId ? "checking" : "submitting",
      progress: null,
      taskId: execution.taskId,
      errorMessage: null
    });
    try {
      if (execution.taskId) {
        await observeVideoTask(execution, execution.taskId, assetToken);
      } else {
        await submitVideoAttempt(execution, assetToken);
      }
    } catch (error) {
      if (!isCurrentVideoExecution(execution)) return;
      if (isAbortError(error)) {
        finishVideoExecution(execution, null, false);
      } else {
        setVideoExecutionRuntime(execution.targetNodeId, {
          status: "unresolved",
          progress: null,
          taskId: execution.taskId,
          errorMessage: null
        });
      }
    } finally {
      execution.recoveryInFlight = false;
    }
  }, [
    assetToken,
    finishVideoExecution,
    isCurrentVideoExecution,
    observeVideoTask,
    setVideoExecutionRuntime,
    submitVideoAttempt,
    t,
    videoExecutionRuntimeByNodeId
  ]);

  const abortVideoExecution = useCallback((nodeId: string) => {
    const execution = activeVideoExecutionsRef.current.get(nodeId);
    execution?.controller.abort();
    activeVideoExecutionsRef.current.delete(nodeId);
    setVideoExecutionRuntime(nodeId, null);
  }, [setVideoExecutionRuntime]);

  const selectedImageComposerView = useMemo<CreatorImageComposerView | null>(() => {
    if (!selectedImageComposerContext || !selectedImageComposerDraft) return null;
    return {
      context: selectedImageComposerContext,
      draft: selectedImageComposerDraft,
      models: imageModels,
      modelsLoading: imageModelsLoading,
      onPromptChange: (prompt) =>
        updateSelectedImageComposerDraft((draft) =>
          editCreatorImagePrompt(draft, prompt)
        ),
      onPromptReset: () =>
        updateSelectedImageComposerDraft(resetCreatorImagePrompt),
      onTextSourceSelect: (nodeId) => {
        const reference = selectedImageComposerContext.incomingReferences.find(
          (candidate) =>
            candidate.sourceNode.id === nodeId && candidate.sourceNode.kind === "text"
        );
        if (reference) {
          updateSelectedImageComposerDraft((draft) =>
            selectCreatorImagePromptSeed(draft, reference)
          );
        }
      },
      onOperationChange: (operation: CreatorImageComposerOperation) =>
        updateSelectedImageComposerDraft((draft) =>
          setCreatorImageComposerOperation(
            draft,
            operation,
            selectedImageComposerContext
          )
        ),
      onImageReferenceSelect: (nodeId) => {
        if (
          getCreatorImageReferenceCandidates(selectedImageComposerContext).some(
            (candidate) => candidate.nodeId === nodeId
          )
        ) {
          updateSelectedImageComposerDraft((draft) => ({
            ...draft,
            selectedImageReferenceNodeId: nodeId
          }));
        }
      },
      onModelChange: (modelId) => {
        if (imageModels.some((model) => model.slug === modelId)) {
          updateSelectedImageComposerDraft((draft) => ({ ...draft, modelId }));
        }
      },
      onAspectRatioChange: (aspectRatio: ImageAspectRatio) =>
        updateSelectedImageComposerDraft((draft) => ({ ...draft, aspectRatio })),
      onCountChange: (count: AiGenerationCount) =>
        updateSelectedImageComposerDraft((draft) => ({ ...draft, count })),
      execution: {
        ...(imageExecutionRuntimeByNodeId.get(
          selectedImageComposerContext.node.id
        ) ?? { status: "idle" as const, errorMessage: null }),
        authenticated: Boolean(assetToken),
        onExecute: () => {
          void executeNewImageGeneration(
            selectedImageComposerContext.node.id,
            selectedImageComposerDraft,
            selectedImageComposerContext
          );
        },
        onResume: () => {
          void resumeImageGeneration(selectedImageComposerContext.node.id);
        }
      }
    };
  }, [
    assetToken,
    executeNewImageGeneration,
    imageExecutionRuntimeByNodeId,
    imageModels,
    imageModelsLoading,
    resumeImageGeneration,
    selectedImageComposerContext,
    selectedImageComposerDraft,
    updateSelectedImageComposerDraft
  ]);

  const selectedTextAiComposerView = useMemo<CreatorTextAiComposerView | null>(() => {
    if (!selectedTextAiContext) return null;
    const nodeId = selectedTextAiContext.node.id;
    const runtime = textAiExecutionRuntimeByNodeId.get(nodeId) ?? {
      status: "idle" as const,
      errorMessage: null
    };
    return {
      instruction: selectedTextAiContext.node.data.ai?.instruction ?? "",
      modelId: selectedTextAiModelId,
      models: textAiModels,
      modelsLoading: textAiModelsLoading,
      incomingTextCount: getCreatorTextAiIncomingTextOutputs(
        canvasDocument,
        nodeId
      ).length,
      authenticated: workspaceAuthStatus === "authenticated" && Boolean(assetToken),
      onInstructionChange: (instruction) => {
        updateTextAiConfig(nodeId, (config) => ({
          ...config,
          instruction,
          modelId: config.modelId || selectedTextAiModelId
        }));
      },
      onModelChange: (modelId) => {
        if (!textAiModels.some((model) => model.modelId === modelId)) return;
        updateTextAiConfig(nodeId, (config) => ({ ...config, modelId }));
      },
      execution: {
        ...runtime,
        onExecute: () => {
          void executeTextAi(nodeId);
        }
      }
    };
  }, [
    assetToken,
    canvasDocument,
    executeTextAi,
    selectedTextAiContext,
    selectedTextAiModelId,
    textAiExecutionRuntimeByNodeId,
    textAiModels,
    textAiModelsLoading,
    updateTextAiConfig,
    workspaceAuthStatus
  ]);

  const selectedVideoComposerView = useMemo<CreatorVideoComposerView | null>(() => {
    if (!selectedVideoComposerContext || !selectedVideoComposerDraft) return null;
    const nodeId = selectedVideoComposerContext.node.id;
    const runtime = videoExecutionRuntimeByNodeId.get(nodeId) ?? {
      status: "idle" as const,
      progress: null,
      taskId: null,
      errorMessage: null
    };
    const effectiveModelId = getCreatorVideoEffectiveModelId(
      selectedVideoComposerDraft.modelId,
      selectedVideoComposerDraft.mode,
      videoModels
    );
    return {
      context: selectedVideoComposerContext,
      draft: selectedVideoComposerDraft,
      models: getCreatorVideoCompatibleModels(videoModels, selectedVideoComposerDraft.mode),
      modelsLoading: videoModelsLoading,
      effectiveModel: effectiveModelId
        ? videoModels.find((model) => model.slug === effectiveModelId) ?? null
        : null,
      onPromptChange: (prompt) => updateSelectedVideoComposerDraft((draft) =>
        editCreatorVideoPrompt(draft, prompt)
      ),
      onPromptReset: () => updateSelectedVideoComposerDraft(resetCreatorVideoPrompt),
      onTextSourceSelect: (sourceNodeId) => {
        const reference = selectedVideoComposerContext.incomingReferences.find(
          (candidate) => candidate.sourceNode.id === sourceNodeId && candidate.sourceNode.kind === "text"
        );
        if (reference) {
          updateSelectedVideoComposerDraft((draft) =>
            selectCreatorVideoPromptSeed(draft, reference)
          );
        }
      },
      onImageReferenceSelect: (sourceNodeId) => updateSelectedVideoComposerDraft((draft) =>
        selectCreatorVideoImageReference(
          draft,
          sourceNodeId,
          selectedVideoComposerContext
        )
      ),
      onModeChange: (mode) => updateSelectedVideoComposerDraft((draft) =>
        setCreatorVideoComposerMode(draft, mode, selectedVideoComposerContext)
      ),
      onModelChange: (modelId) => {
        if (getCreatorVideoCompatibleModels(videoModels, selectedVideoComposerDraft.mode)
          .some((model) => model.slug === modelId)) {
          updateSelectedVideoComposerDraft((draft) => ({ ...draft, modelId }));
        }
      },
      execution: {
        ...runtime,
        authenticated: workspaceAuthStatus === "authenticated" && Boolean(assetToken),
        onExecute: () => {
          void executeVideoGeneration(
            nodeId,
            selectedVideoComposerDraft,
            selectedVideoComposerContext
          );
        },
        onResume: () => {
          void resumeVideoGeneration(nodeId);
        }
      } satisfies CreatorVideoComposerExecutionView
    };
  }, [
    assetToken,
    executeVideoGeneration,
    resumeVideoGeneration,
    selectedVideoComposerContext,
    selectedVideoComposerDraft,
    setVideoExecutionRuntime,
    updateSelectedVideoComposerDraft,
    videoExecutionRuntimeByNodeId,
    videoModels,
    videoModelsLoading,
    workspaceAuthStatus
  ]);

  const updateText = useCallback((nodeId: string, text: string) => {
    if (textEditTransactionNodeIdRef.current !== nodeId) {
      beginTextEditTransaction(nodeId);
    }
    const result = updateCreatorCanvasText(canvasDocumentRef.current, nodeId, text);
    if (!result.ok) return;
    applyLiveCanvasState(result.document);
    updateOpenHistoryTransaction();
  }, [
    applyLiveCanvasState,
    beginTextEditTransaction,
    updateOpenHistoryTransaction
  ]);

  const endTextEdit = useCallback((nodeId: string) => {
    if (textEditTransactionNodeIdRef.current !== nodeId) return;
    finishTextEditTransaction();
  }, [finishTextEditTransaction]);

  const selectedTextWorkspaceNodeId = selectedTextAiContext?.node.id ?? null;
  const previousTextWorkspaceNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousTextWorkspaceNodeIdRef.current;
    if (previous !== null && previous !== selectedTextWorkspaceNodeId) {
      finishTextEditTransaction();
    }
    previousTextWorkspaceNodeIdRef.current = selectedTextWorkspaceNodeId;
  }, [finishTextEditTransaction, selectedTextWorkspaceNodeId]);

  const selectedWorkspaceNode = selectedTextAiContext?.node ??
    selectedImageComposerContext?.node ??
    selectedVideoComposerContext?.node ??
    null;
  const selectedWorkspaceGeometry = useMemo<{
    anchorRect: CreatorNodeWorkspaceRect;
    viewportRect: CreatorNodeWorkspaceRect;
  } | null>(() => {
    if (!selectedWorkspaceNode || !reactFlow) return null;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const fallbackWidth = typeof window !== "undefined" && window.innerWidth > 0
      ? window.innerWidth
      : 1024;
    const fallbackHeight = typeof window !== "undefined" && window.innerHeight > 0
      ? window.innerHeight
      : 768;
    const viewportWidth = bounds.width > 0 ? bounds.width : fallbackWidth;
    const viewportHeight = bounds.height > 0 ? bounds.height : fallbackHeight;
    const node = selectedWorkspaceNode;
    const size = getCreatorCanvasRuntimeNodeSize(
      node,
      rendererStateByNodeId.get(node.id)
    );
    return {
      anchorRect: toCreatorCanvasScreenRect(reactFlow, {
        x: node.position.x,
        y: node.position.y,
        width: size.width,
        height: size.height
      }),
      viewportRect: {
        x: bounds.left,
        y: bounds.top,
        width: viewportWidth,
        height: viewportHeight
      }
    };
  }, [
    canvasLayoutRevision,
    reactFlow,
    rendererStateByNodeId,
    selectedWorkspaceNode
  ]);

  const closeSelectedNodeWorkspace = useCallback(() => {
    clearSelectedCanvasTransientState();
  }, [clearSelectedCanvasTransientState]);

  const openAssetPicker = useCallback((nodeId: string) => {
    if (!assetToken) return;
    const target = canvasDocumentRef.current.nodes.find((node) => node.id === nodeId);
    if (!target || target.kind !== "image" || target.data.assetId !== null) return;
    setAssetPickerIntent({
      mode: "bind",
      nodeId,
      expectedAssetId: null
    });
  }, [assetToken]);

  const openReplaceAssetPicker = useCallback((nodeId: string) => {
    if (!assetToken) return;
    const target = canvasDocumentRef.current.nodes.find((node) => node.id === nodeId);
    if (!target || target.kind !== "image" || target.data.assetId === null) return;
    if (isCreatorCanvasImageReplaceExecutionBlocked(
      imageExecutionRuntimeByNodeIdRef.current.get(nodeId)?.status
    )) {
      return;
    }
    setAssetPickerIntent({
      mode: "replace",
      nodeId,
      expectedAssetId: target.data.assetId
    });
  }, [assetToken]);

  const closeAssetPicker = useCallback(() => {
    setAssetPickerIntent(null);
  }, []);

  const selectExistingImageAsset = useCallback((assetId: string) => {
    const intent = assetPickerIntent;
    if (!intent) {
      closeAssetPicker();
      return;
    }

    const targetNodeId = intent.nodeId;
    const currentTarget = canvasDocumentRef.current.nodes.find(
      (node) => node.id === targetNodeId
    );
    if (!currentTarget || currentTarget.kind !== "image") {
      closeAssetPicker();
      return;
    }
    const currentExecutionStatus = imageExecutionRuntimeByNodeIdRef.current
      .get(targetNodeId)?.status;
    if (
      intent.mode === "replace" &&
      isCreatorCanvasImageReplaceExecutionBlocked(currentExecutionStatus)
    ) {
      closeAssetPicker();
      return;
    }
    const committed = commitSemanticMutation(({ document }) => {
      if (
        intent.mode === "replace" &&
        isCreatorCanvasImageReplaceExecutionBlocked(
          imageExecutionRuntimeByNodeIdRef.current.get(targetNodeId)?.status
        )
      ) {
        return null;
      }
      const result = intent.mode === "bind"
        ? bindCreatorCanvasImageAsset(document, targetNodeId, assetId)
        : replaceCreatorCanvasImageAsset(
            document,
            targetNodeId,
            intent.expectedAssetId,
            assetId
          );
      return result.ok ? { document: result.document } : null;
    });
    if (committed) {
      setSelectedNodeIds(new Set([targetNodeId]));
      setSelectedEdgeIds(new Set());
    }
    closeAssetPicker();
  }, [
    assetPickerIntent,
    closeAssetPicker,
    commitSemanticMutation
  ]);

  const viewActions = useMemo(() => ({
    onTextChange: updateText,
    onTextEditStart: beginTextEditTransaction,
    onTextEditEnd: endTextEdit,
    onChooseExistingImageAsset: openAssetPicker,
    onReplaceExistingImageAsset: openReplaceAssetPicker
  }), [
    beginTextEditTransaction,
    endTextEdit,
    openAssetPicker,
    openReplaceAssetPicker,
    updateText
  ]);
  const getNodeAriaLabel = useCallback(
    (kind: CreatorContentNodeKind) => t(CREATOR_CANVAS_NODE_DEFINITIONS[kind].labelKey),
    [t]
  );
  const imageAssetDisplayByNodeId = useMemo(() => {
    if (!selectedImageComposerContext) {
      return new Map<string, CreatorImageAssetDisplayState>();
    }
    return new Map([[
      selectedImageComposerContext.node.id,
      selectedImageAssetDisplay
    ]]);
  }, [selectedImageAssetDisplay, selectedImageComposerContext]);
  const textAiComposerByNodeId = useMemo(() => {
    if (!selectedTextAiContext || !selectedTextAiComposerView) {
      return new Map<string, CreatorTextAiComposerView>();
    }
    return new Map([[selectedTextAiContext.node.id, selectedTextAiComposerView]]);
  }, [selectedTextAiComposerView, selectedTextAiContext]);
  const videoExecutionByNodeId = useMemo(() => {
    return new Map<string, CreatorVideoNodeExecutionView>(
      Array.from(videoExecutionRuntimeByNodeId, ([nodeId, runtime]) => [nodeId, runtime])
    );
  }, [videoExecutionRuntimeByNodeId]);
  const imageExecutionStatusByNodeId = useMemo(
    () => new Map(
      Array.from(imageExecutionRuntimeByNodeId, ([nodeId, runtime]) => [
        nodeId,
        runtime.status
      ])
    ),
    [imageExecutionRuntimeByNodeId]
  );
  const nodes = useMemo(
    () => toCreatorCanvasReactFlowNodes(
      canvasDocument,
      viewActions,
      selectedNodeIds,
      getNodeAriaLabel,
      rendererStateByNodeId,
      assetToken,
      imageAssetDisplayByNodeId,
      imageExecutionStatusByNodeId,
      textAiComposerByNodeId,
      videoExecutionByNodeId
    ),
    [
      assetToken,
      canvasDocument,
      getNodeAriaLabel,
      imageAssetDisplayByNodeId,
      imageExecutionStatusByNodeId,
      rendererStateByNodeId,
      selectedNodeIds,
      textAiComposerByNodeId,
      videoExecutionByNodeId,
      viewActions
    ]
  );
  const edges = useMemo(
    () => toCreatorCanvasReactFlowEdges(canvasDocument, selectedEdgeIds),
    [canvasDocument, selectedEdgeIds]
  );

  const addNode = useCallback((kind: CreatorContentNodeKind, position: XYPosition) => {
    let createdNodeId: string | null = null;
    const committed = commitSemanticMutation(({ document }) => {
      const id = createCanvasId(kind, new Set(document.nodes.map((node) => node.id)));
      const node = createDomainNode(kind, id, position);
      const next = parseCreatorCanvasDocument({
        ...document,
        nodes: [...document.nodes, node]
      });
      if (!next.ok) return null;
      createdNodeId = id;
      return { document: next.document };
    });
    if (committed && createdNodeId) {
      setSelectedNodeIds(new Set([createdNodeId]));
      setSelectedEdgeIds(new Set());
    }
    setCreateMenu(null);
    setContextMenu(null);
  }, [commitSemanticMutation]);

  const addNodeAtViewportCenter = useCallback((kind: CreatorContentNodeKind) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const center = reactFlow && bounds
      ? reactFlow.screenToFlowPosition({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2
        })
      : { x: 0, y: 0 };
    const slotIndex = nodes.length % CREATOR_CANVAS_INITIAL_PLACEMENT_SLOTS.length;
    const slot = CREATOR_CANVAS_INITIAL_PLACEMENT_SLOTS[slotIndex] ?? { x: 0, y: 0 };
    const layerOffset = Math.floor(nodes.length / CREATOR_CANVAS_INITIAL_PLACEMENT_SLOTS.length) * 24;
    addNode(kind, {
      x: center.x + slot.x - CREATOR_CANVAS_NODE_DEFINITIONS[kind].defaultWidth / 2 + layerOffset,
      y: center.y + slot.y - 64 + layerOffset
    });
  }, [addNode, nodes.length, reactFlow]);

  const duplicateNode = useCallback((nodeId: string) => {
    let duplicatedNodeId: string | null = null;
    const committed = commitSemanticMutation(({ document, videoComposerDrafts }) => {
      const source = document.nodes.find((node) => node.id === nodeId);
      if (!source) return null;
      const nextId = createCanvasId(
        source.kind,
        new Set(document.nodes.map((node) => node.id))
      );
      const next = parseCreatorCanvasDocument({
        ...document,
        nodes: [...document.nodes, duplicateDomainNode(source, nextId)]
      });
      if (!next.ok) return null;
      duplicatedNodeId = nextId;
      if (source.kind !== "video") return { document: next.document };
      const sourceDraft = videoComposerDrafts.get(nodeId);
      if (!sourceDraft) return { document: next.document };
      const nextVideoDrafts = new Map(videoComposerDrafts);
      nextVideoDrafts.set(nextId, {
        ...cloneCreatorVideoComposerDraft(sourceDraft),
        selectedImageReferenceNodeId: null,
        promptSeedSourceNodeId: null
      });
      return {
        document: next.document,
        videoComposerDrafts: nextVideoDrafts
      };
    });
    if (committed && duplicatedNodeId) {
      setSelectedNodeIds(new Set([duplicatedNodeId]));
      setSelectedEdgeIds(new Set());
    }
    setContextMenu(null);
  }, [commitSemanticMutation]);

  const deleteNode = useCallback((nodeId: string) => {
    abortImageExecution(nodeId);
    abortTextAiExecution(nodeId);
    abortVideoExecution(nodeId);
    commitSemanticMutation(({ document, imageComposerDrafts, videoComposerDrafts }) => {
      const result = removeCreatorCanvasNode(document, nodeId);
      if (!result.ok) return null;
      const nextDrafts = new Map(imageComposerDrafts);
      nextDrafts.delete(nodeId);
      const nextVideoDrafts = new Map(videoComposerDrafts);
      nextVideoDrafts.delete(nodeId);
      return {
        document: result.document,
        imageComposerDrafts: nextDrafts,
        videoComposerDrafts: nextVideoDrafts
      };
    });
    setSelectedNodeIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setContextMenu(null);
  }, [abortImageExecution, abortTextAiExecution, abortVideoExecution, commitSemanticMutation]);

  const handleNodesChange = useCallback((changes: NodeChange<CreatorCanvasViewNode>[]) => {
    for (const change of changes) {
      if (change.type === "remove") {
        abortImageExecution(change.id);
        abortTextAiExecution(change.id);
        abortVideoExecution(change.id);
      }
    }
    setRendererStateByNodeId((current) => {
      const next = new Map(current);
      for (const change of changes) {
        if (change.type === "dimensions") {
          const existing = next.get(change.id) ?? {};
          next.set(change.id, {
            ...existing,
            measured: change.dimensions ? { ...change.dimensions } : existing.measured,
            resizing: change.resizing ?? existing.resizing,
            width: change.setAttributes === true || change.setAttributes === "width"
              ? change.dimensions?.width
              : existing.width,
            height: change.setAttributes === true || change.setAttributes === "height"
              ? change.dimensions?.height
              : existing.height
          });
        } else if (change.type === "position" && typeof change.dragging === "boolean") {
          next.set(change.id, { ...next.get(change.id), dragging: change.dragging });
        } else if (change.type === "remove") {
          next.delete(change.id);
        }
      }
      return next;
    });
    setSelectedNodeIds((current) => {
      const next = new Set(current);
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        } else if (change.type === "remove") {
          next.delete(change.id);
        }
      }
      return next;
    });
    const hasSemanticChange = changes.some((change) =>
      (change.type === "position" && Boolean(change.position)) ||
      change.type === "remove"
    );
    const hadDragTransaction = nodeDragTransactionActiveRef.current;
    if (hasSemanticChange && !hadDragTransaction) finishTextEditTransaction();
    if (hasSemanticChange) {
      const before = hadDragTransaction ? null : readHistorySnapshot();
      let nextDocument = canvasDocumentRef.current;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          const result = updateCreatorCanvasNodePosition(nextDocument, change.id, change.position);
          if (result.ok) nextDocument = result.document;
        } else if (change.type === "remove") {
          const result = removeCreatorCanvasNode(nextDocument, change.id);
          if (result.ok) nextDocument = result.document;
        }
      }
      let nextDrafts = imageComposerDraftsRef.current;
      let nextVideoDrafts = videoComposerDraftsRef.current;
      const removedIds = new Set(
        changes
          .filter((change) => change.type === "remove")
          .map((change) => change.id)
      );
      if (removedIds.size > 0 && Array.from(removedIds).some((id) => nextDrafts.has(id))) {
        nextDrafts = new Map(
          Array.from(nextDrafts).filter(([id]) => !removedIds.has(id))
        );
      }
      if (removedIds.size > 0 && Array.from(removedIds).some((id) => nextVideoDrafts.has(id))) {
        nextVideoDrafts = new Map(
          Array.from(nextVideoDrafts).filter(([id]) => !removedIds.has(id))
        );
      }
      applyLiveCanvasState(nextDocument, nextDrafts, nextVideoDrafts);
      const after = readHistorySnapshot();
      if (hadDragTransaction) {
        historyRef.current?.updateTransaction(after);
      } else if (before) {
        recordHistoryTransition(before, after);
      }
    }
    if (changes.some((change) => change.type === "remove")) {
      setContextMenu(null);
    }
  }, [
    abortImageExecution,
    abortTextAiExecution,
    abortVideoExecution,
    applyLiveCanvasState,
    finishTextEditTransaction,
    readHistorySnapshot,
    recordHistoryTransition
  ]);

  const handleEdgesChange = useCallback((changes: EdgeChange<CreatorCanvasViewEdge>[]) => {
    setSelectedEdgeIds((current) => {
      const next = new Set(current);
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        } else if (change.type === "remove") {
          next.delete(change.id);
        }
      }
      return next;
    });
    if (changes.some((change) => change.type === "remove")) {
      commitSemanticMutation(({ document }) => {
        let next = document;
        for (const change of changes) {
          if (change.type !== "remove") continue;
          const result = removeCreatorCanvasEdge(next, change.id);
          if (result.ok) next = result.document;
        }
        return { document: next };
      });
    }
  }, [commitSemanticMutation]);

  const isValidConnection = useCallback((connection: Connection | CreatorCanvasViewEdge) => {
    const candidate = fromCreatorCanvasReactFlowConnection(connection);
    if (!candidate) return false;
    const reconnectingEdgeId = reconnectingEdgeIdRef.current;
    return reconnectingEdgeId
      ? reconnectCreatorCanvasEdge(canvasDocument, reconnectingEdgeId, candidate).ok
      : canConnectCreatorCanvasNodes(canvasDocument, candidate).valid;
  }, [canvasDocument]);

  const handleConnect = useCallback((connection: Connection) => {
    const candidate = fromCreatorCanvasReactFlowConnection(connection);
    if (!candidate) return;
    commitSemanticMutation(({ document }) => {
      const edgeId = createCanvasId("edge", new Set(document.edges.map((edge) => edge.id)));
      const result = connectCreatorCanvasNodes(document, { id: edgeId, ...candidate });
      return result.ok ? { document: result.document } : null;
    });
  }, [commitSemanticMutation]);

  const handleReconnect = useCallback((edge: CreatorCanvasViewEdge, connection: Connection) => {
    const candidate = fromCreatorCanvasReactFlowConnection(connection);
    if (!candidate) return;
    commitSemanticMutation(({ document }) => {
      const result = reconnectCreatorCanvasEdge(document, edge.id, candidate);
      return result.ok ? { document: result.document } : null;
    });
  }, [commitSemanticMutation]);

  const handleMoveStart = useCallback(() => {
    viewportMovementActiveRef.current = true;
    viewportMovementRevisionRef.current += 1;
    setCanvasLayoutRevision((current) => current + 1);
  }, []);

  const handleMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    viewportMovementActiveRef.current = false;
    viewportMovementRevisionRef.current += 1;
    setCanvasLayoutRevision((current) => current + 1);
    const result = updateCreatorCanvasViewport(canvasDocumentRef.current, viewport);
    if (result.ok) applyLiveCanvasState(result.document);
  }, [applyLiveCanvasState]);

  const handleNodeDragStart = useCallback((
    _event: MouseEvent | TouchEvent,
    _node: CreatorCanvasViewNode,
    _nodes: CreatorCanvasViewNode[]
  ) => {
    if (nodeDragTransactionActiveRef.current) return;
    finishTextEditTransaction();
    const started = historyRef.current?.beginTransaction(readHistorySnapshot()) ?? false;
    if (started) nodeDragTransactionActiveRef.current = true;
  }, [finishTextEditTransaction, readHistorySnapshot]);

  const handleNodeDragStop = useCallback((
    _event: MouseEvent | TouchEvent,
    _node: CreatorCanvasViewNode,
    _nodes: CreatorCanvasViewNode[]
  ) => {
    finishNodeDragTransaction();
  }, [finishNodeDragTransaction]);

  const restoreHistory = useCallback((direction: "undo" | "redo"): boolean => {
    if (activeImageExecutionsRef.current.size > 0) return false;
    flushOpenHistoryTransactions();
    if (activeImageExecutionsRef.current.size > 0) return false;

    const current = readHistorySnapshot();
    const restored = direction === "undo"
      ? historyRef.current?.undo(current)
      : historyRef.current?.redo(current);
    if (!restored) return false;

    applyLiveCanvasState(
      restored.document,
      restored.imageComposerDrafts,
      restored.videoComposerDrafts
    );
    const nodeIds = new Set(restored.document.nodes.map((node) => node.id));
    const edgeIds = new Set(restored.document.edges.map((edge) => edge.id));
    setSelectedNodeIds((currentIds) => {
      const next = new Set(
        Array.from(currentIds).filter((nodeId) => nodeIds.has(nodeId))
      );
      return next.size === currentIds.size ? currentIds : next;
    });
    setSelectedEdgeIds((currentIds) => {
      const next = new Set(
        Array.from(currentIds).filter((edgeId) => edgeIds.has(edgeId))
      );
      return next.size === currentIds.size ? currentIds : next;
    });
    setHistoryRevision((revision) => revision + 1);
    return true;
  }, [
    applyLiveCanvasState,
    flushOpenHistoryTransactions,
    readHistorySnapshot
  ]);

  const undoCanvas = useCallback(() => {
    restoreHistory("undo");
  }, [restoreHistory]);

  const redoCanvas = useCallback(() => {
    restoreHistory("redo");
  }, [restoreHistory]);

  const copyPressed = useKeyPress(["Control+c", "Meta+c"], {
    target: typeof document === "undefined" ? null : document,
    actInsideInputWithModifier: false,
    preventDefault: true
  });
  const pastePressed = useKeyPress(["Control+v", "Meta+v"], {
    target: typeof document === "undefined" ? null : document,
    actInsideInputWithModifier: false,
    preventDefault: true
  });
  const undoPressed = useKeyPress(["Control+z", "Meta+z"], {
    target: typeof document === "undefined" ? null : document,
    actInsideInputWithModifier: false,
    preventDefault: true
  });
  const redoPressed = useKeyPress(["Control+Shift+z", "Meta+Shift+z"], {
    target: typeof document === "undefined" ? null : document,
    actInsideInputWithModifier: false,
    preventDefault: true
  });
  const redoYPressed = useKeyPress(["Control+y", "Meta+y"], {
    target: typeof document === "undefined" ? null : document,
    actInsideInputWithModifier: false,
    preventDefault: true
  });

  useEffect(() => {
    if (!copyPressed && !pastePressed) return;
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement !== document.body &&
      !canvasRef.current?.contains(activeElement)
    ) {
      return;
    }
    if (copyPressed) {
      copyCanvasGraph();
    } else if (pastePressed) {
      pasteCanvasGraph();
    }
  }, [copyCanvasGraph, copyPressed, pasteCanvasGraph, pastePressed]);

  useEffect(() => {
    if (!undoPressed && !redoPressed && !redoYPressed) return;
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement !== document.body &&
      !canvasRef.current?.contains(activeElement)
    ) {
      return;
    }
    if (undoPressed && !redoPressed) {
      undoCanvas();
    } else if (redoPressed || redoYPressed) {
      redoCanvas();
    }
  }, [redoPressed, redoYPressed, redoCanvas, undoPressed, undoCanvas]);

  const hasActiveImageExecution = activeImageExecutionsRef.current.size > 0;
  const historyAvailability = useMemo(() => ({
    canUndo: historyRef.current?.canUndo ?? false,
    canRedo: historyRef.current?.canRedo ?? false
  }), [historyRevision]);
  const currentPersistedFingerprint = useMemo(
    () => getCreatorCanvasPersistedStateFingerprint(
      canvasDocument,
      imageComposerDrafts,
      videoComposerDrafts
    ),
    [canvasDocument, imageComposerDrafts, videoComposerDrafts]
  );
  const hasPersistableContent =
    canvasDocument.nodes.length > 0 ||
    canvasDocument.edges.length > 0 ||
    imageComposerDrafts.size > 0 ||
    videoComposerDrafts.size > 0;
  const isCanvasDirty = savedCanvasId !== null
    ? savedCanvasFingerprint === null ||
      currentPersistedFingerprint !== savedCanvasFingerprint
    : hasPersistableContent;

  const handleSaveCanvas = useCallback(async () => {
    if (
      persistenceLoadState !== "ready" ||
      !assetToken ||
      hasActiveImageExecution ||
      persistenceSaving ||
      persistenceRenaming ||
      !isCanvasDirty
    ) {
      return;
    }

    const saveId = ++persistenceSaveIdRef.current;
    persistenceSaveControllerRef.current?.abort();
    const controller = new AbortController();
    persistenceSaveControllerRef.current = controller;
    setPersistenceSaving(true);
    setPersistenceFeedback(null);

    const document = canvasDocumentRef.current;
    const drafts = imageComposerDraftsRef.current;
    const videoDrafts = videoComposerDraftsRef.current;
    let state: ReturnType<typeof serializeCreatorCanvasPersistedState>;
    try {
      state = serializeCreatorCanvasPersistedState(document, drafts, videoDrafts);
    } catch {
      setPersistenceFeedback("error");
      setPersistenceSaving(false);
      persistenceSaveControllerRef.current = null;
      return;
    }

    const currentDocumentId = savedCanvasId;
    const currentRevision = savedCanvasRevision;
    const response = await fetch(
      currentDocumentId
        ? apiUrl(`/canvas/documents/${encodeURIComponent(currentDocumentId)}`)
        : apiUrl("/canvas/documents"),
      {
        method: currentDocumentId ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${assetToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          currentDocumentId
            ? { state, expectedRevision: currentRevision }
            : { state, title: deriveCreatorCanvasTitle(document) }
        ),
        signal: controller.signal
      }
    ).catch((error: unknown) => {
      if (
        saveId !== persistenceSaveIdRef.current ||
        controller.signal.aborted ||
        isAbortError(error)
      ) {
        return null;
      }
      setPersistenceFeedback("error");
      return null;
    });

    if (
      !response ||
      saveId !== persistenceSaveIdRef.current ||
      controller.signal.aborted
    ) {
      if (saveId === persistenceSaveIdRef.current) {
        setPersistenceSaving(false);
        persistenceSaveControllerRef.current = null;
      }
      return;
    }
    if (response.status === 409) {
      setPersistenceFeedback("conflict");
      setPersistenceSaving(false);
      persistenceSaveControllerRef.current = null;
      return;
    }
    if (!response.ok) {
      setPersistenceFeedback("error");
      setPersistenceSaving(false);
      persistenceSaveControllerRef.current = null;
      return;
    }

    try {
      const parsed = parseCanvasDocumentResponse(await response.json() as unknown);
      if (
        saveId !== persistenceSaveIdRef.current ||
        controller.signal.aborted
      ) {
        return;
      }
      setSavedCanvasId(parsed.id);
      setSavedCanvasRevision(parsed.revision);
      setSavedCanvasTitle(parsed.title);
      setSavedCanvasFingerprint(
        getCreatorCanvasPersistedStateFingerprint(
          parsed.document,
          parsed.imageComposerDrafts,
          parsed.videoComposerDrafts
        )
      );
      setPersistenceFeedback(null);
      if (currentDocumentId === null) replaceCanvasDocumentUrl(parsed.id);
    } catch {
      setPersistenceFeedback("error");
    } finally {
      if (saveId === persistenceSaveIdRef.current) {
        setPersistenceSaving(false);
        persistenceSaveControllerRef.current = null;
      }
    }
  }, [
    assetToken,
    hasActiveImageExecution,
    isCanvasDirty,
    persistenceLoadState,
    persistenceRenaming,
    persistenceSaving,
    savedCanvasId,
    savedCanvasRevision
  ]);

  const confirmDiscardChanges = useCallback(() => {
    if (!isCanvasDirty || typeof window === "undefined") return true;
    return window.confirm(t("creator.canvas.persistence.confirmDiscard"));
  }, [isCanvasDirty, t]);

  const handleNewCanvas = useCallback(() => {
    if (
      persistenceLoadState !== "ready" ||
      persistenceSaving ||
      persistenceRenaming ||
      hasActiveImageExecution ||
      !confirmDiscardChanges()
    ) {
      return;
    }
    setSavedDocumentsDialogOpen(false);
    resetCanvasSession(createInitialCreatorCanvasDocument());
    setSavedCanvasId(null);
    setSavedCanvasRevision(null);
    setSavedCanvasTitle(null);
    setSavedCanvasFingerprint(null);
    persistenceRequestedCanvasIdRef.current = null;
    setPersistenceFeedback(null);
    setPersistenceLoadState("ready");
    replaceCanvasDocumentUrl(null);
  }, [
    confirmDiscardChanges,
    hasActiveImageExecution,
    persistenceLoadState,
    persistenceRenaming,
    persistenceSaving,
    resetCanvasSession
  ]);

  const handleOpenSavedCanvas = useCallback((canvasId: string) => {
    if (
      persistenceLoadState !== "ready" ||
      persistenceSaving ||
      persistenceRenaming ||
      hasActiveImageExecution ||
      !assetToken ||
      !confirmDiscardChanges()
    ) {
      return;
    }
    clearSelectedCanvasTransientState();
    setSavedDocumentsDialogOpen(false);
    void loadPersistedCanvasDocument(canvasId, assetToken);
  }, [
    assetToken,
    clearSelectedCanvasTransientState,
    confirmDiscardChanges,
    hasActiveImageExecution,
    loadPersistedCanvasDocument,
    persistenceLoadState,
    persistenceRenaming,
    persistenceSaving
  ]);

  const handleRenameSavedCanvas = useCallback(async (
    canvasId: string,
    expectedRevision: number,
    title: string | null
  ): Promise<CreatorCanvasDocumentRenameResult> => {
    if (
      !assetToken ||
      persistenceLoadState !== "ready" ||
      persistenceSaving ||
      persistenceRenaming ||
      hasActiveImageExecution ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision <= 0
    ) {
      return { ok: false, reason: "error" };
    }

    persistenceRenameControllerRef.current?.abort();
    const renameId = ++persistenceRenameIdRef.current;
    const controller = new AbortController();
    persistenceRenameControllerRef.current = controller;
    setPersistenceRenaming(true);
    try {
      const response = await fetch(
        apiUrl(`/canvas/documents/${encodeURIComponent(canvasId)}`),
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${assetToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ expectedRevision, title }),
          signal: controller.signal
        }
      );
      if (
        renameId !== persistenceRenameIdRef.current ||
        controller.signal.aborted ||
        !isMountedRef.current
      ) {
        return { ok: false, reason: "error" };
      }
      if (response.status === 409) {
        return { ok: false, reason: "conflict" };
      }
      if (!response.ok) {
        return { ok: false, reason: "error" };
      }
      const summary = parseCanvasDocumentMetadata(
        await response.json() as unknown
      ).summary;
      if (summary.id !== canvasId) {
        return { ok: false, reason: "error" };
      }
      if (canvasId === savedCanvasId) {
        setSavedCanvasTitle(summary.title);
        setSavedCanvasRevision(summary.revision);
      }
      return { ok: true, document: summary };
    } catch (error) {
      if (
        renameId === persistenceRenameIdRef.current &&
        !controller.signal.aborted &&
        !isAbortError(error)
      ) {
        return { ok: false, reason: "error" };
      }
      return { ok: false, reason: "error" };
    } finally {
      if (renameId === persistenceRenameIdRef.current) {
        persistenceRenameControllerRef.current = null;
        setPersistenceRenaming(false);
      }
    }
  }, [
    assetToken,
    hasActiveImageExecution,
    persistenceLoadState,
    persistenceRenaming,
    persistenceSaving,
    savedCanvasId
  ]);

  const handleDeleteSavedCanvas = useCallback(async (canvasId: string) => {
    const deletingCurrentCanvas = canvasId === savedCanvasId;
    if (
      !assetToken ||
      persistenceLoadState !== "ready" ||
      persistenceSaving ||
      persistenceRenaming ||
      hasActiveImageExecution ||
      (deletingCurrentCanvas && isCanvasDirty && !confirmDiscardChanges()) ||
      (typeof window !== "undefined" &&
        !window.confirm(t("creator.canvas.persistence.confirmDelete")))
    ) {
      return false;
    }

    const response = await fetch(
      apiUrl(`/canvas/documents/${encodeURIComponent(canvasId)}`),
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${assetToken}` }
      }
    ).catch(() => null);
    if (!response || !response.ok) {
      setPersistenceFeedback("error");
      return false;
    }

    setPersistenceFeedback(null);
    if (deletingCurrentCanvas) {
      resetCanvasSession(createInitialCreatorCanvasDocument());
      setSavedCanvasId(null);
      setSavedCanvasRevision(null);
      setSavedCanvasTitle(null);
      setSavedCanvasFingerprint(null);
      persistenceRequestedCanvasIdRef.current = null;
      setPersistenceLoadState("ready");
      replaceCanvasDocumentUrl(null);
    }
    return true;
  }, [
    assetToken,
    confirmDiscardChanges,
    hasActiveImageExecution,
    isCanvasDirty,
    persistenceLoadState,
    persistenceRenaming,
    persistenceSaving,
    resetCanvasSession,
    savedCanvasId,
    t
  ]);

  const openSavedDocuments = useCallback(() => {
    if (
      persistenceLoadState !== "ready" ||
      !assetToken ||
      persistenceSaving ||
      persistenceRenaming ||
      hasActiveImageExecution
    ) {
      return;
    }
    clearSelectedCanvasTransientState();
    setSavedDocumentsDialogOpen(true);
  }, [
    assetToken,
    clearSelectedCanvasTransientState,
    hasActiveImageExecution,
    persistenceLoadState,
    persistenceRenaming,
    persistenceSaving
  ]);

  const handleViewAllCanvases = useCallback(() => {
    if (
      persistenceLoadState !== "ready" ||
      persistenceSaving ||
      persistenceRenaming ||
      hasActiveImageExecution ||
      !confirmDiscardChanges()
    ) {
      return;
    }
    setSavedDocumentsDialogOpen(false);
    router.push("/canvas/library");
  }, [
    confirmDiscardChanges,
    hasActiveImageExecution,
    persistenceLoadState,
    persistenceRenaming,
    persistenceSaving,
    router
  ]);

  const retryPersistedCanvasLoad = useCallback(() => {
    if (!assetToken || !persistenceRequestedCanvasIdRef.current) return;
    void loadPersistedCanvasDocument(
      persistenceRequestedCanvasIdRef.current,
      assetToken
    );
  }, [assetToken, loadPersistedCanvasDocument]);

  const persistenceStatusLabel = useMemo(() => {
    if (persistenceLoadState === "initializing" || persistenceLoadState === "loading") {
      return t("creator.canvas.persistence.status.loading");
    }
    if (persistenceLoadState === "auth-required") {
      return t("creator.canvas.persistence.status.loginRequired");
    }
    if (persistenceLoadState === "error") {
      return t("creator.canvas.persistence.status.loadFailed");
    }
    if (persistenceSaving) return t("creator.canvas.persistence.status.saving");
    if (persistenceFeedback === "conflict") {
      return t("creator.canvas.persistence.status.conflict");
    }
    if (persistenceFeedback === "error") {
      return t("creator.canvas.persistence.status.saveFailed");
    }
    if (savedCanvasId !== null && !isCanvasDirty) {
      return t("creator.canvas.persistence.status.saved");
    }
    return savedCanvasId === null
      ? isCanvasDirty
        ? t("creator.canvas.persistence.status.unsaved")
        : t("creator.canvas.persistence.status.notSaved")
      : t("creator.canvas.persistence.status.unsaved");
  }, [
    isCanvasDirty,
    persistenceFeedback,
    persistenceLoadState,
    persistenceSaving,
    savedCanvasId,
    t
  ]);

  useEffect(() => {
    if (
      !isCanvasDirty ||
      persistenceLoadState !== "ready" ||
      typeof window === "undefined"
    ) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isCanvasDirty, persistenceLoadState]);

  if (persistenceLoadState !== "ready") {
    const isLoading =
      persistenceLoadState === "initializing" ||
      persistenceLoadState === "loading";
    return (
      <div
        className="flex h-full min-h-0 w-full items-center justify-center bg-slate-100 px-6 dark:bg-slate-950"
        data-creator-canvas-persistence-fence={persistenceLoadState}
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {isLoading
              ? t("creator.canvas.persistence.status.loading")
              : persistenceLoadState === "auth-required"
                ? t("creator.canvas.persistence.loginRequired")
                : t("creator.canvas.persistence.status.loadFailed")}
          </p>
          {persistenceLoadState === "error" ? (
            <button
              type="button"
              className="mt-4 inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-4 text-xs font-semibold dark:border-slate-600"
              onClick={retryPersistedCanvasLoad}
              disabled={!assetToken}
              data-creator-canvas-persistence-retry="true"
            >
              {t("creator.canvas.persistence.retry")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={canvasRef}
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-slate-100 dark:bg-slate-950"
      data-creator-canvas-root="true"
      data-creator-canvas-node-count={nodes.length}
      data-creator-canvas-edge-count={edges.length}
      data-creator-canvas-semantic-empty={String(isCanvasSemanticallyEmpty)}
      data-creator-canvas-viewport={`${canvasDocument.viewport.x},${canvasDocument.viewport.y},${canvasDocument.viewport.zoom}`}
      onDoubleClickCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.classList.contains("react-flow__pane") || !reactFlow) {
          return;
        }
        event.preventDefault();
        const menuPosition = clampMenuPosition(canvasRef.current, event.clientX, event.clientY);
        setContextMenu(null);
        setCreateMenu({
          flowPosition: reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          ...menuPosition
        });
      }}
    >
      <ReactFlow<CreatorCanvasViewNode, CreatorCanvasViewEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={CREATOR_CANVAS_NODE_TYPES}
        onInit={setReactFlow}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onReconnect={handleReconnect}
        onReconnectStart={(_event, edge) => {
          reconnectingEdgeIdRef.current = edge.id;
        }}
        onReconnectEnd={() => {
          reconnectingEdgeIdRef.current = null;
        }}
        onMoveStart={handleMoveStart}
        onMoveEnd={handleMoveEnd}
        onPaneClick={() => {
          setContextMenu(null);
          setCreateMenu(null);
        }}
        onPaneContextMenu={(event) => event.preventDefault()}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          const menuPosition = clampMenuPosition(canvasRef.current, event.clientX, event.clientY, 176, 104);
          setCreateMenu(null);
          setContextMenu({ nodeId: node.id, ...menuPosition });
        }}
        nodesConnectable
        edgesReconnectable
        nodesDraggable
        elementsSelectable
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        panOnScroll
        panActivationKeyCode="Space"
        deleteKeyCode={["Backspace", "Delete"]}
        defaultViewport={canvasDocument.viewport}
        minZoom={CREATOR_CANVAS_MIN_ZOOM}
        maxZoom={CREATOR_CANVAS_MAX_ZOOM}
        aria-label={t("creator.canvas.canvasLabel")}
        ariaLabelConfig={{
          "node.a11yDescription.default": t("creator.canvas.nodeA11yDescription")
        }}
      >
        <Panel
          position="top-right"
          className="nodrag flex flex-col items-stretch gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg shadow-slate-950/10 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/30"
          aria-label={t("creator.canvas.history.toolbar")}
          data-creator-canvas-history-toolbar="true"
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="nodrag inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={t("creator.canvas.history.undo")}
              title={hasActiveImageExecution
                ? t("creator.canvas.history.disabledWhileExecution")
                : t("creator.canvas.history.undoTitle")}
              disabled={hasActiveImageExecution || !historyAvailability.canUndo}
              data-creator-canvas-history-action="undo"
              onClick={undoCanvas}
            >
              <Undo2 className="size-4" aria-hidden="true" />
              {t("creator.canvas.history.undo")}
            </button>
            <button
              type="button"
              className="nodrag inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={t("creator.canvas.history.redo")}
              title={hasActiveImageExecution
                ? t("creator.canvas.history.disabledWhileExecution")
                : t("creator.canvas.history.redoTitle")}
              disabled={hasActiveImageExecution || !historyAvailability.canRedo}
              data-creator-canvas-history-action="redo"
              onClick={redoCanvas}
            >
              <Redo2 className="size-4" aria-hidden="true" />
              {t("creator.canvas.history.redo")}
            </button>
          </div>
          <div
            className="flex items-center gap-1 border-t border-slate-200 pt-1 dark:border-slate-700"
            aria-label={t("creator.canvas.persistence.toolbar")}
            data-creator-canvas-persistence-toolbar="true"
          >
            <button
              type="button"
              className="nodrag inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={t("creator.canvas.persistence.save")}
              title={!assetToken
                ? t("creator.canvas.persistence.status.loginRequired")
                : hasActiveImageExecution
                  ? t("creator.canvas.persistence.activeExecution")
                  : t("creator.canvas.persistence.saveTitle")}
              disabled={
                !assetToken ||
                hasActiveImageExecution ||
                persistenceSaving ||
                persistenceRenaming ||
                !isCanvasDirty
              }
              data-creator-canvas-persistence-action="save"
              onClick={() => void handleSaveCanvas()}
            >
              <Save className="size-4" aria-hidden="true" />
              {t("creator.canvas.persistence.save")}
            </button>
            <button
              type="button"
              className="nodrag inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={t("creator.canvas.persistence.open")}
              title={!assetToken
                ? t("creator.canvas.persistence.status.loginRequired")
                : hasActiveImageExecution
                  ? t("creator.canvas.persistence.activeExecution")
                  : t("creator.canvas.persistence.openTitleButton")}
              disabled={
                !assetToken ||
                hasActiveImageExecution ||
                persistenceSaving ||
                persistenceRenaming
              }
              data-creator-canvas-persistence-action="open"
              onClick={openSavedDocuments}
            >
              <FolderOpen className="size-4" aria-hidden="true" />
              {t("creator.canvas.persistence.open")}
            </button>
            <button
              type="button"
              className="nodrag inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={t("creator.canvas.persistence.new")}
              title={hasActiveImageExecution
                ? t("creator.canvas.persistence.activeExecution")
                : t("creator.canvas.persistence.newTitle")}
              disabled={
                hasActiveImageExecution ||
                persistenceSaving ||
                persistenceRenaming
              }
              data-creator-canvas-persistence-action="new"
              onClick={handleNewCanvas}
            >
              <FilePlus2 className="size-4" aria-hidden="true" />
              {t("creator.canvas.persistence.new")}
            </button>
            <span
              className="ml-auto whitespace-nowrap px-1 text-[11px] font-medium text-slate-500 dark:text-slate-400"
              aria-live="polite"
              data-creator-canvas-persistence-status="true"
            >
              {persistenceStatusLabel}
            </span>
          </div>
        </Panel>
        <Background gap={24} size={1} color="#94a3b8" />
        <MiniMap<CreatorCanvasViewNode>
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(node) => CREATOR_CANVAS_NODE_DEFINITIONS[node.data.domainNode.kind].minimapColor}
          className="!border !border-slate-200 !bg-white/90 shadow-lg dark:!border-slate-700 dark:!bg-slate-900/90"
          ariaLabel={t("creator.canvas.minimapLabel")}
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          className="[&_button]:border-slate-200 [&_button]:bg-white [&_button]:text-slate-700 dark:[&_button]:border-slate-700 dark:[&_button]:bg-slate-900 dark:[&_button]:text-slate-200"
        />
      </ReactFlow>

      {selectedImageComposerContext && selectedImageComposerView && selectedWorkspaceGeometry ? (
        <CreatorNodeWorkspace
          kind="image"
          title={t("creator.canvas.imageWorkspace.title")}
          typeLabel={t("creator.canvas.node.image")}
          closeLabel={t("creator.canvas.imageWorkspace.close")}
          expandLabel={t("creator.canvas.imageWorkspace.focus")}
          focusTitle={t("creator.canvas.imageWorkspace.focusTitle")}
          focusCloseLabel={t("creator.canvas.imageWorkspace.focusClose")}
          anchorRect={selectedWorkspaceGeometry.anchorRect}
          viewportRect={selectedWorkspaceGeometry.viewportRect}
          onClose={closeSelectedNodeWorkspace}
        >
          {(mode) => (
            <CreatorImageWorkspace
              mode={mode}
              assetId={selectedImageAssetId}
              assetToken={assetToken}
              assetDisplay={selectedImageAssetDisplay}
              imageComposer={selectedImageComposerView}
              onChooseExistingImageAsset={() =>
                openAssetPicker(selectedImageComposerContext.node.id)
              }
              onReplaceExistingImageAsset={() =>
                openReplaceAssetPicker(selectedImageComposerContext.node.id)
              }
            />
          )}
        </CreatorNodeWorkspace>
      ) : null}

      {selectedVideoComposerContext && selectedVideoComposerView && selectedWorkspaceGeometry ? (
        <CreatorNodeWorkspace
          key={`video-workspace-${selectedVideoComposerContext.node.id}`}
          kind="video"
          title={t("creator.canvas.videoWorkspace.title")}
          typeLabel={t("creator.canvas.node.video")}
          closeLabel={t("creator.canvas.videoWorkspace.close")}
          expandLabel={t("creator.canvas.videoWorkspace.focus")}
          focusTitle={t("creator.canvas.videoWorkspace.focusTitle")}
          focusCloseLabel={t("creator.canvas.videoWorkspace.focusClose")}
          anchorRect={selectedWorkspaceGeometry.anchorRect}
          viewportRect={selectedWorkspaceGeometry.viewportRect}
          onClose={closeSelectedNodeWorkspace}
        >
          {(mode) => (
            <CreatorVideoWorkspace
              mode={mode}
              assetId={selectedVideoAssetId}
              assetToken={assetToken}
              assetDisplay={selectedVideoAssetDisplay}
              videoComposer={selectedVideoComposerView}
            />
          )}
        </CreatorNodeWorkspace>
      ) : null}

      {selectedTextAiContext && selectedTextAiComposerView && selectedWorkspaceGeometry ? (
        <CreatorNodeWorkspace
          kind="text"
          title={t("creator.canvas.textWorkspace.title")}
          typeLabel={t("creator.canvas.node.text")}
          closeLabel={t("creator.canvas.textWorkspace.close")}
          expandLabel={t("creator.canvas.textWorkspace.focus")}
          focusTitle={t("creator.canvas.textWorkspace.focusTitle")}
          focusCloseLabel={t("creator.canvas.textWorkspace.focusClose")}
          anchorRect={selectedWorkspaceGeometry.anchorRect}
          viewportRect={selectedWorkspaceGeometry.viewportRect}
          onClose={closeSelectedNodeWorkspace}
          onBeforeClose={() => endTextEdit(selectedTextAiContext.node.id)}
          onBeforeFocusOpen={() => endTextEdit(selectedTextAiContext.node.id)}
          onBeforeFocusClose={() => endTextEdit(selectedTextAiContext.node.id)}
        >
          {(mode) => (
            <CreatorTextWorkspace
              mode={mode}
              text={selectedTextAiContext.node.data.text}
              textAiComposer={selectedTextAiComposerView}
              onTextChange={(text) => updateText(selectedTextAiContext.node.id, text)}
              onTextEditStart={() => beginTextEditTransaction(selectedTextAiContext.node.id)}
              onTextEditEnd={() => endTextEdit(selectedTextAiContext.node.id)}
            />
          )}
        </CreatorNodeWorkspace>
      ) : null}

      {isCanvasSemanticallyEmpty ? (
        <CreatorCanvasRecipeStarter onApply={applyCreatorCanvasRecipe} />
      ) : nodes.length === 0 ? (
        <div
          className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center px-6 text-center"
          data-creator-canvas-blank-hint="true"
        >
          <div className="max-w-sm text-slate-500 dark:text-slate-400">
            <MousePointer2 className="mx-auto size-7 text-indigo-500" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t("creator.canvas.onboardingTitle")}
            </p>
            <p className="mt-1 text-xs leading-5">
              {t("creator.canvas.onboardingDescription")}
            </p>
          </div>
        </div>
      ) : null}

      <div
        className="absolute bottom-5 left-1/2 z-10 flex max-w-[calc(100%-18rem)] -translate-x-1/2 items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-xl shadow-slate-950/10 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/30"
        aria-label={t("creator.canvas.creationToolbar")}
        data-creator-canvas-creation-toolbar="true"
      >
        {CREATOR_CANVAS_NODE_KINDS.map((kind) => {
          const definition = CREATOR_CANVAS_NODE_DEFINITIONS[kind];
          const Icon = definition.icon;
          return (
            <button
              key={kind}
              type="button"
              className="nodrag inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-200 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
              onClick={() => addNodeAtViewportCenter(kind)}
              data-create-creator-node-kind={kind}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{t(definition.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {createMenu ? (
        <div
          className="absolute z-20 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-950/15 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40"
          style={{ left: createMenu.x, top: createMenu.y }}
          role="menu"
          aria-label={t("creator.canvas.createMenu")}
          data-creator-canvas-create-menu="true"
        >
          {CREATOR_CANVAS_NODE_KINDS.map((kind) => {
            const definition = CREATOR_CANVAS_NODE_DEFINITIONS[kind];
            const Icon = definition.icon;
            return (
              <button
                key={kind}
                type="button"
                role="menuitem"
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:hover:bg-slate-800"
                onClick={() => addNode(kind, createMenu.flowPosition)}
                data-menu-create-creator-node-kind={kind}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {t(definition.labelKey)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                    {t(definition.descriptionKey)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="absolute z-20 w-44 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-950/15 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label={t("creator.canvas.nodeMenu")}
          data-creator-canvas-node-menu="true"
        >
          <button
            type="button"
            role="menuitem"
            className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => duplicateNode(contextMenu.nodeId)}
            data-creator-canvas-node-action="duplicate"
          >
            <Copy className="size-4" aria-hidden="true" />
            {t("creator.canvas.duplicate")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs font-semibold text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:text-red-300 dark:hover:bg-red-950/40"
            onClick={() => deleteNode(contextMenu.nodeId)}
            data-creator-canvas-node-action="delete"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t("creator.canvas.delete")}
          </button>
        </div>
      ) : null}

      <CreatorCanvasAssetPicker
        isOpen={assetPickerIntent !== null}
        targetNodeId={assetPickerIntent?.nodeId ?? null}
        token={assetToken}
        excludedAssetId={assetPickerIntent?.mode === "replace"
          ? assetPickerIntent.expectedAssetId
          : null}
        onClose={closeAssetPicker}
        onSelectAsset={selectExistingImageAsset}
      />
      <CreatorCanvasSavedDocumentsDialog
        isOpen={savedDocumentsDialogOpen}
        token={assetToken}
        actionsDisabled={hasActiveImageExecution || persistenceSaving || persistenceRenaming}
        onClose={() => setSavedDocumentsDialogOpen(false)}
        onOpenDocument={handleOpenSavedCanvas}
        onRenameDocument={handleRenameSavedCanvas}
        onDeleteDocument={handleDeleteSavedCanvas}
        onViewAllCanvases={handleViewAllCanvases}
      />
    </div>
  );
}
