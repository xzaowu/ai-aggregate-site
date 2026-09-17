import type {
  CreatorCanvasDocumentV1,
  CreatorCanvasViewport,
  CreatorContentNode
} from "./creator-canvas-document";
import type { CreatorImageComposerDraft } from "./creator-image-composer";
import { cloneCreatorTextAiConfig } from "./creator-text-ai";
import {
  cloneCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";

export const CREATOR_CANVAS_HISTORY_LIMIT = 100;

export type CreatorCanvasHistorySnapshot = Readonly<{
  document: CreatorCanvasDocumentV1;
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft>;
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft>;
}>;

function cloneNode(node: CreatorContentNode): CreatorContentNode {
  switch (node.kind) {
    case "text":
      return {
        id: node.id,
        kind: node.kind,
        position: { ...node.position },
        data: {
          text: node.data.text,
          ...(node.data.ai ? { ai: cloneCreatorTextAiConfig(node.data.ai) } : {})
        }
      };
    case "image":
      return {
        id: node.id,
        kind: node.kind,
        position: { ...node.position },
        data: { assetId: node.data.assetId }
      };
    case "video":
      return {
        id: node.id,
        kind: node.kind,
        position: { ...node.position },
        data: { assetId: node.data.assetId }
      };
  }
}

function cloneDocument(document: CreatorCanvasDocumentV1): CreatorCanvasDocumentV1 {
  return {
    version: document.version,
    nodes: document.nodes.map(cloneNode),
    edges: document.edges.map((edge) => ({ ...edge })),
    viewport: { ...document.viewport }
  };
}

function cloneDraft(draft: CreatorImageComposerDraft): CreatorImageComposerDraft {
  return { ...draft };
}

function cloneDrafts(
  drafts: ReadonlyMap<string, CreatorImageComposerDraft>
): Map<string, CreatorImageComposerDraft> {
  return new Map(
    Array.from(drafts, ([nodeId, draft]) => [nodeId, cloneDraft(draft)] as const)
  );
}

function cloneVideoDrafts(
  drafts: ReadonlyMap<string, CreatorVideoComposerDraft>
): Map<string, CreatorVideoComposerDraft> {
  return new Map(
    Array.from(drafts, ([nodeId, draft]) => [
      nodeId,
      cloneCreatorVideoComposerDraft(draft)
    ] as const)
  );
}

export function createCreatorCanvasHistorySnapshot(
  document: CreatorCanvasDocumentV1,
  imageComposerDrafts: ReadonlyMap<string, CreatorImageComposerDraft> = new Map(),
  videoComposerDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
): CreatorCanvasHistorySnapshot {
  return {
    document: cloneDocument(document),
    imageComposerDrafts: cloneDrafts(imageComposerDrafts),
    videoComposerDrafts: cloneVideoDrafts(videoComposerDrafts)
  };
}

function semanticSignature(snapshot: CreatorCanvasHistorySnapshot): string {
  return JSON.stringify({
    version: snapshot.document.version,
    nodes: snapshot.document.nodes,
    edges: snapshot.document.edges,
    imageComposerDrafts: Array.from(snapshot.imageComposerDrafts)
      .sort(([left], [right]) => left.localeCompare(right)),
    videoComposerDrafts: Array.from(snapshot.videoComposerDrafts)
      .sort(([left], [right]) => left.localeCompare(right))
  });
}

export function areCreatorCanvasHistorySnapshotsSemanticallyEqual(
  left: CreatorCanvasHistorySnapshot,
  right: CreatorCanvasHistorySnapshot
): boolean {
  return semanticSignature(left) === semanticSignature(right);
}

function mergeRestoredImageComposerDrafts(
  current: CreatorCanvasHistorySnapshot,
  restored: CreatorCanvasHistorySnapshot
): Map<string, CreatorImageComposerDraft> {
  const currentNodeIds = new Set(current.document.nodes.map((node) => node.id));
  const merged = new Map<string, CreatorImageComposerDraft>();
  for (const node of restored.document.nodes) {
    const draft = currentNodeIds.has(node.id)
      ? current.imageComposerDrafts.get(node.id)
      : restored.imageComposerDrafts.get(node.id);
    if (draft) merged.set(node.id, cloneDraft(draft));
  }
  return merged;
}

function mergeRestoredVideoComposerDrafts(
  current: CreatorCanvasHistorySnapshot,
  restored: CreatorCanvasHistorySnapshot
): Map<string, CreatorVideoComposerDraft> {
  const currentNodeIds = new Set(current.document.nodes.map((node) => node.id));
  const merged = new Map<string, CreatorVideoComposerDraft>();
  for (const node of restored.document.nodes) {
    if (node.kind !== "video") continue;
    const draft = currentNodeIds.has(node.id)
      ? current.videoComposerDrafts.get(node.id)
      : restored.videoComposerDrafts.get(node.id);
    if (draft) merged.set(node.id, cloneCreatorVideoComposerDraft(draft));
  }
  return merged;
}

export function restoreCreatorCanvasHistorySnapshotWithViewport(
  snapshot: CreatorCanvasHistorySnapshot,
  currentViewport: CreatorCanvasViewport,
  currentSnapshot?: CreatorCanvasHistorySnapshot
): CreatorCanvasHistorySnapshot {
  return {
    document: {
      ...snapshot.document,
      viewport: { ...currentViewport }
    },
    imageComposerDrafts: currentSnapshot
      ? mergeRestoredImageComposerDrafts(currentSnapshot, snapshot)
      : cloneDrafts(snapshot.imageComposerDrafts),
    videoComposerDrafts: currentSnapshot
      ? mergeRestoredVideoComposerDrafts(currentSnapshot, snapshot)
      : cloneVideoDrafts(snapshot.videoComposerDrafts)
  };
}

export type CreatorCanvasHistoryInterleavedMutation<T> = Readonly<{
  snapshot: CreatorCanvasHistorySnapshot;
  value: T;
}>;

export type CreatorCanvasHistoryInterleavingResult<T> = Readonly<{
  current: CreatorCanvasHistorySnapshot;
  transactionStart: CreatorCanvasHistorySnapshot;
  value: T;
  recorded: boolean;
}>;

export class CreatorCanvasHistory {
  private readonly limit: number;
  private past: CreatorCanvasHistorySnapshot[] = [];
  private future: CreatorCanvasHistorySnapshot[] = [];
  private transactionStart: CreatorCanvasHistorySnapshot | null = null;
  private transactionLatest: CreatorCanvasHistorySnapshot | null = null;

  constructor(limit = CREATOR_CANVAS_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("CREATOR_CANVAS_HISTORY_LIMIT_INVALID");
    }
    this.limit = limit;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get pastLength(): number {
    return this.past.length;
  }

  get futureLength(): number {
    return this.future.length;
  }

  get hasOpenTransaction(): boolean {
    return this.transactionStart !== null;
  }

  getOpenTransactionStart(): CreatorCanvasHistorySnapshot | null {
    return this.transactionStart
      ? createCreatorCanvasHistorySnapshot(
          this.transactionStart.document,
          this.transactionStart.imageComposerDrafts,
          this.transactionStart.videoComposerDrafts
        )
      : null;
  }

  record(
    before: CreatorCanvasHistorySnapshot,
    after: CreatorCanvasHistorySnapshot
  ): boolean {
    const beforeSnapshot = createCreatorCanvasHistorySnapshot(
      before.document,
      before.imageComposerDrafts,
      before.videoComposerDrafts
    );
    const afterSnapshot = createCreatorCanvasHistorySnapshot(
      after.document,
      after.imageComposerDrafts,
      after.videoComposerDrafts
    );
    if (areCreatorCanvasHistorySnapshotsSemanticallyEqual(beforeSnapshot, afterSnapshot)) {
      return false;
    }

    this.past.push(beforeSnapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }

  beginTransaction(snapshot: CreatorCanvasHistorySnapshot): boolean {
    if (this.transactionStart) return false;
    const initial = createCreatorCanvasHistorySnapshot(
      snapshot.document,
      snapshot.imageComposerDrafts,
      snapshot.videoComposerDrafts
    );
    this.transactionStart = initial;
    this.transactionLatest = initial;
    return true;
  }

  updateTransaction(snapshot: CreatorCanvasHistorySnapshot): boolean {
    if (!this.transactionStart) return false;
    this.transactionLatest = createCreatorCanvasHistorySnapshot(
      snapshot.document,
      snapshot.imageComposerDrafts,
      snapshot.videoComposerDrafts
    );
    return true;
  }

  commitTransaction(snapshot?: CreatorCanvasHistorySnapshot): boolean {
    if (!this.transactionStart) return false;
    const before = this.transactionStart;
    const after = snapshot ?? this.transactionLatest ?? before;
    this.transactionStart = null;
    this.transactionLatest = null;
    return this.record(before, after);
  }

  cancelTransaction(): boolean {
    if (!this.transactionStart) return false;
    this.transactionStart = null;
    this.transactionLatest = null;
    return true;
  }

  interleaveOpenTransaction<T>(
    current: CreatorCanvasHistorySnapshot,
    mutate: (
      snapshot: CreatorCanvasHistorySnapshot
    ) => CreatorCanvasHistoryInterleavedMutation<T> | null
  ): CreatorCanvasHistoryInterleavingResult<T> | null {
    if (!this.transactionStart) return null;

    const transactionStart = this.transactionStart;
    const startOutcome = mutate(transactionStart);
    if (!startOutcome) return null;

    const currentSnapshot = createCreatorCanvasHistorySnapshot(
      current.document,
      current.imageComposerDrafts,
      current.videoComposerDrafts
    );
    const currentOutcome = mutate(currentSnapshot);
    if (!currentOutcome) return null;

    const recorded = this.record(transactionStart, startOutcome.snapshot);
    const rebasedStart = createCreatorCanvasHistorySnapshot(
      startOutcome.snapshot.document,
      startOutcome.snapshot.imageComposerDrafts,
      startOutcome.snapshot.videoComposerDrafts
    );
    const rebasedLatest = createCreatorCanvasHistorySnapshot(
      currentOutcome.snapshot.document,
      currentOutcome.snapshot.imageComposerDrafts,
      currentOutcome.snapshot.videoComposerDrafts
    );
    this.transactionStart = rebasedStart;
    this.transactionLatest = rebasedLatest;
    return {
      current: rebasedLatest,
      transactionStart: rebasedStart,
      value: currentOutcome.value,
      recorded
    };
  }

  undo(current: CreatorCanvasHistorySnapshot): CreatorCanvasHistorySnapshot | null {
    const target = this.past.pop();
    if (!target) return null;
    const currentSnapshot = createCreatorCanvasHistorySnapshot(
      current.document,
      current.imageComposerDrafts,
      current.videoComposerDrafts
    );
    this.future.push(currentSnapshot);
    if (this.future.length > this.limit) this.future.shift();
    return restoreCreatorCanvasHistorySnapshotWithViewport(
      target,
      current.document.viewport,
      currentSnapshot
    );
  }

  redo(current: CreatorCanvasHistorySnapshot): CreatorCanvasHistorySnapshot | null {
    const target = this.future.pop();
    if (!target) return null;
    const currentSnapshot = createCreatorCanvasHistorySnapshot(
      current.document,
      current.imageComposerDrafts,
      current.videoComposerDrafts
    );
    this.past.push(currentSnapshot);
    if (this.past.length > this.limit) this.past.shift();
    return restoreCreatorCanvasHistorySnapshotWithViewport(
      target,
      current.document.viewport,
      currentSnapshot
    );
  }
}
