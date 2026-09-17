// @vitest-environment jsdom

import type {
  AiAssetSummary,
  AiModelSummary,
  AiTaskStatus,
  AiTaskSummary,
  AuthUser,
  PublicVideoModelSummary
} from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useOptionalWorkspaceShellContext,
  WorkspaceShellProvider
} from "../../../components/workspace/workspace-shell-context";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import {
  CreatorCanvas,
  deriveCreatorCanvasTitle
} from "./creator-canvas";
import type { CreatorCanvasDocumentV1 } from "./creator-canvas-document";
import {
  createCreatorImageComposerDraft,
  type CreatorImageComposerDraft
} from "./creator-image-composer";
import {
  createCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";
import { serializeCreatorCanvasPersistedState } from "./creator-canvas-persistence";

const compressReferenceImageMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock })
}));

vi.mock("../../../lib/image-reference-preparation", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../lib/image-reference-preparation")
  >();
  return {
    ...actual,
    compressReferenceImage: (...args: Parameters<typeof actual.compressReferenceImage>) =>
      compressReferenceImageMock(...args)
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type MockNode = {
  id: string;
  type: string;
  data: {
    domainNode: {
      id: string;
      kind: string;
      position: { x: number; y: number };
      data: Record<string, unknown>;
    };
    actions: { onTextChange: (nodeId: string, text: string) => void };
  };
  position: { x: number; y: number };
  selected?: boolean;
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
};

type MockEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  selected?: boolean;
};

type MockConnection = {
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
};

const dialogShowModalMock = vi.fn(function(this: HTMLDialogElement) {
  this.open = true;
});
const dialogCloseMock = vi.fn(function(this: HTMLDialogElement) {
  this.open = false;
});
Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  value: dialogShowModalMock
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true,
  value: dialogCloseMock
});

type MockReactFlowProps = {
  nodes: MockNode[];
  edges: MockEdge[];
  onNodesChange: (changes: Array<Record<string, unknown>>) => void;
  onNodeDragStart: (event: unknown, node: MockNode, nodes: MockNode[]) => void;
  onNodeDragStop: (event: unknown, node: MockNode, nodes: MockNode[]) => void;
  onEdgesChange: (changes: Array<Record<string, unknown>>) => void;
  onConnect: (connection: MockConnection) => void;
  isValidConnection: (connection: MockConnection | MockEdge) => boolean;
  onReconnect: (edge: MockEdge, connection: MockConnection) => void;
  onReconnectStart: (event: unknown, edge: MockEdge) => void;
  onReconnectEnd: () => void;
  onMoveStart: (
    event: null,
    viewport: { x: number; y: number; zoom: number }
  ) => void;
  onMoveEnd: (event: null, viewport: { x: number; y: number; zoom: number }) => void;
  defaultViewport: { x: number; y: number; zoom: number };
};

let latestReactFlowProps: MockReactFlowProps | null = null;
let mockReactFlowViewport = { x: 0, y: 0, zoom: 1 };
let mockReactFlowViewportInitialized = false;
let mockCanvasBounds = {
  left: 0,
  top: 0,
  right: 1_000,
  bottom: 800,
  x: 0,
  y: 0,
  width: 1_000,
  height: 800,
  toJSON: () => ({})
};
const reactFlowSetViewportMock = vi.hoisted(() => vi.fn());
const reactFlowGetViewportForBoundsMock = vi.hoisted(() => vi.fn());

const canvasImageModel = {
  id: "canvas-model",
  name: "Internal Canvas Image",
  displayName: "Canvas Image Pro",
  slug: "canvas-image-pro",
  provider: "OPENAI_COMPATIBLE",
  modelId: "upstream/canvas-image",
  capability: "image",
  displaySurfaces: ["image"],
  group: "image",
  tags: ["image"],
  enabled: true,
  maxReferenceImages: 1,
  creditCost: 2,
  allowGuest: true,
  sortOrder: 0,
  isRecommended: true
} satisfies AiModelSummary;

const canvasImageModelTwo = {
  ...canvasImageModel,
  id: "canvas-model-two",
  name: "Internal Canvas Image Two",
  displayName: "Canvas Image Two",
  slug: "canvas-image-two",
  modelId: "upstream/canvas-image-two",
  sortOrder: 1,
  isRecommended: false
} satisfies AiModelSummary;

const canvasChatModel = {
  id: "canvas-chat-model",
  name: "Synthetic Chat Model",
  displayName: "Synthetic Chat Model",
  slug: "synthetic-chat",
  provider: "OPENAI_COMPATIBLE",
  modelId: "synthetic-chat",
  capability: "chat",
  displaySurfaces: ["chat"],
  group: "chat",
  tags: ["chat"],
  enabled: true,
  maxReferenceImages: 0,
  creditCost: 1,
  allowGuest: false,
  sortOrder: 0,
  isRecommended: true
} satisfies AiModelSummary;

const canvasChatModelTwo = {
  ...canvasChatModel,
  id: "canvas-chat-model-two",
  name: "Synthetic Chat Model Two",
  displayName: "Synthetic Chat Model Two",
  slug: "synthetic-chat-two",
  modelId: "synthetic-chat-two",
  sortOrder: 1,
  isRecommended: false
} satisfies AiModelSummary;

const canvasVideoModel: PublicVideoModelSummary = {
  id: "canvas-video-model",
  name: "Synthetic Canvas Video",
  displayName: "Synthetic Canvas Video",
  slug: "synthetic-video",
  capability: "video",
  displaySurfaces: ["video"],
  group: "video",
  tags: ["video"],
  enabled: true,
  creditCost: 6,
  allowGuest: false,
  sortOrder: 0,
  isRecommended: true,
  videoProfile: {
    id: "synthetic-video-profile",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 5,
    resolution: "1280x720",
    aspectRatio: "16:9"
  }
};

const canvasVideoModelTwo: PublicVideoModelSummary = {
  ...canvasVideoModel,
  id: "canvas-video-model-two",
  name: "Synthetic Canvas Video Two",
  displayName: "Synthetic Canvas Video Two",
  slug: "synthetic-video-two",
  sortOrder: 1,
  isRecommended: false,
  videoProfile: {
    ...canvasVideoModel.videoProfile,
    id: "synthetic-video-profile-two"
  }
};

function installCanvasFetch(models: AiModelSummary[] = [canvasImageModel]) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/models?surface=image")) {
      return new Response(JSON.stringify({ models }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.includes("/models?capability=chat&surface=chat")) {
      return new Response(JSON.stringify({ models }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.includes("/settings/public")) {
      return new Response(JSON.stringify({ settings: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.includes("/quota/me")) {
      return new Response(JSON.stringify({ remainingCredits: 20 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

vi.mock("@xyflow/react", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");

  const getNodeBounds = (nodes: MockNode[]) => {
    const rects = nodes.map((node) => ({
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? node.width ?? 0,
      height: node.measured?.height ?? node.height ?? 0
    }));
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  };

  const getViewportForBounds = (
    bounds: { x: number; y: number; width: number; height: number },
    width: number,
    height: number,
    minZoom: number,
    maxZoom: number,
    padding: string
  ) => {
    reactFlowGetViewportForBoundsMock(
      bounds,
      width,
      height,
      minZoom,
      maxZoom,
      padding
    );
    const inset = padding.endsWith("px") ? Number.parseFloat(padding) : 0;
    const zoom = Math.max(minZoom, Math.min(
      maxZoom,
      (width - inset * 2) / bounds.width,
      (height - inset * 2) / bounds.height
    ));
    return {
      x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
      zoom
    };
  };

  return {
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    SelectionMode: { Partial: "partial", Full: "full" },
    Handle: ({ id, type, ...props }: { id: string; type: string; [key: string]: unknown }) =>
      ReactModule.createElement("span", {
        "data-handle-id": id,
        "data-handle-type": type,
        "data-port-value": props["data-creator-canvas-port-value"],
        "aria-label": props["aria-label"]
      }),
    Background: () => ReactModule.createElement("div", { "data-react-flow-background": "true" }),
    Controls: () => ReactModule.createElement("div", { "data-react-flow-controls": "true" }),
    MiniMap: () => ReactModule.createElement("div", { "data-react-flow-minimap": "true" }),
    Panel: ({
      children,
      position,
      ...props
    }: {
      children?: React.ReactNode;
      position?: string;
      [key: string]: unknown;
    }) => ReactModule.createElement("div", {
      ...props,
      "data-mock-panel-position": position
    }, children),
    useKeyPress: (
      keyCode: string | string[] | null,
      options?: {
        target?: Window | Document | HTMLElement | null;
        actInsideInputWithModifier?: boolean;
        preventDefault?: boolean;
      }
    ) => {
      const [pressed, setPressed] = ReactModule.useState(false);
      ReactModule.useEffect(() => {
        const target = options?.target ?? document;
        if (!target || !("addEventListener" in target)) return;
        const keys = Array.isArray(keyCode) ? keyCode : keyCode ? [keyCode] : [];
        const matches = (event: KeyboardEvent, shortcut: string) => {
          const parts = shortcut.split("+");
          const key = parts.at(-1)?.toLowerCase();
          const activeElement = document.activeElement;
          const insideInput = activeElement?.matches?.(
            "input,textarea,select,[contenteditable='true']"
          );
          if (insideInput && options?.actInsideInputWithModifier === false) return false;
          return event.key.toLowerCase() === key &&
            event.ctrlKey === parts.includes("Control") &&
            event.metaKey === parts.includes("Meta") &&
            event.shiftKey === parts.includes("Shift");
        };
        const onKeyDown = (event: KeyboardEvent) => {
          if (!keys.some((shortcut) => matches(event, shortcut))) return;
          if (options?.preventDefault) event.preventDefault();
          setPressed(true);
        };
        const onKeyUp = () => setPressed(false);
        target.addEventListener("keydown", onKeyDown as EventListener);
        target.addEventListener("keyup", onKeyUp as EventListener);
        return () => {
          target.removeEventListener("keydown", onKeyDown as EventListener);
          target.removeEventListener("keyup", onKeyUp as EventListener);
        };
      }, [keyCode, options?.actInsideInputWithModifier, options?.preventDefault, options?.target]);
      return pressed;
    },
    getViewportForBounds,
    NodeToolbar: ({
      children,
      isVisible,
      ...props
    }: {
      children?: React.ReactNode;
      isVisible?: boolean;
      [key: string]: unknown;
    }) => isVisible
      ? ReactModule.createElement("div", {
          "data-mock-node-toolbar": "true",
          "data-creator-image-node-toolbar": props["data-creator-image-node-toolbar"],
          "data-creator-text-ai-node-toolbar": props["data-creator-text-ai-node-toolbar"]
        }, children)
      : null,
    ReactFlow: (props: MockReactFlowProps & {
      nodeTypes: Record<string, React.ComponentType<Record<string, unknown>>>;
      onInit: (instance: {
        screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number };
        flowToScreenPosition: (point: { x: number; y: number }) => { x: number; y: number };
        getNode: (nodeId: string) => MockNode | undefined;
        getNodesBounds: (nodes: MockNode[]) => {
          x: number;
          y: number;
          width: number;
          height: number;
        };
        getViewport: () => { x: number; y: number; zoom: number };
        setViewport: (
          viewport: { x: number; y: number; zoom: number },
          options: {
            duration?: number;
            interpolate?: "smooth" | "linear";
          }
        ) => Promise<boolean>;
        viewportInitialized: boolean;
      }) => void;
      onNodeContextMenu: (event: React.MouseEvent, node: MockNode) => void;
      children?: React.ReactNode;
      nodesConnectable: boolean;
      nodesDraggable: boolean;
      elementsSelectable: boolean;
      selectionOnDrag: boolean;
      panOnDrag: number[];
    }) => {
      latestReactFlowProps = props;
      if (!mockReactFlowViewportInitialized) {
        mockReactFlowViewport = { ...props.defaultViewport };
        mockReactFlowViewportInitialized = true;
      }
      ReactModule.useEffect(() => {
        props.onInit({
          screenToFlowPosition: ({ x, y }) => ({ x: x - 10, y: y - 20 }),
          flowToScreenPosition: ({ x, y }) => ({
            x: mockCanvasBounds.left + x * mockReactFlowViewport.zoom +
              mockReactFlowViewport.x,
            y: mockCanvasBounds.top + y * mockReactFlowViewport.zoom +
              mockReactFlowViewport.y
          }),
          getNode: (nodeId) => latestReactFlowProps?.nodes.find(
            (node) => node.id === nodeId
          ),
          getNodesBounds: getNodeBounds,
          getViewport: () => ({ ...mockReactFlowViewport }),
          setViewport: async (viewport, options) => {
            reactFlowSetViewportMock(viewport, options);
            mockReactFlowViewport = { ...viewport };
            latestReactFlowProps?.onMoveStart(null, viewport);
            latestReactFlowProps?.onMoveEnd(null, viewport);
            return true;
          },
          viewportInitialized: true
        });
      }, [props.onInit]);

      return ReactModule.createElement(
        "div",
        {
          className: "react-flow__pane",
          "data-mock-react-flow": "true",
          "data-node-count": String(props.nodes.length),
          "data-edge-count": String(props.edges.length),
          "data-node-positions": JSON.stringify(props.nodes.map((node) => ({
            id: node.id,
            kind: node.type,
            position: node.position,
            selected: node.selected
          }))),
          "data-edge-projection": JSON.stringify(props.edges),
          "data-domain-nodes": JSON.stringify(props.nodes.map((node) => node.data.domainNode)),
          "data-nodes-connectable": String(props.nodesConnectable),
          "data-nodes-draggable": String(props.nodesDraggable),
          "data-elements-selectable": String(props.elementsSelectable),
          "data-selection-on-drag": String(props.selectionOnDrag),
          "data-pan-on-drag": JSON.stringify(props.panOnDrag)
        },
        ...props.nodes.map((node) => {
          const Component = props.nodeTypes[node.type];
          return ReactModule.createElement(
            "div",
            {
              key: node.id,
              "data-mock-node-id": node.id,
              onContextMenu: (event: React.MouseEvent) => props.onNodeContextMenu(event, node)
            },
            Component
              ? ReactModule.createElement(Component, {
                  id: node.id,
                  data: node.data,
                  type: node.type,
                  selected: Boolean(node.selected),
                  dragging: false,
                  draggable: true,
                  selectable: true,
                  deletable: true,
                  zIndex: 0,
                  isConnectable: true,
                  positionAbsoluteX: node.position.x,
                  positionAbsoluteY: node.position.y
                })
              : null
          );
        }),
        ReactModule.createElement(
          "button",
          {
            type: "button",
            "data-test-native-select-drag": "true",
            onClick: () => props.onNodesChange(props.nodes.flatMap((node, index) => [
              { type: "select", id: node.id, selected: index < 2 },
              ...(index === 0
                ? [{ type: "position", id: node.id, position: { x: 240, y: 180 } }]
                : [])
            ]))
          },
          "Select and drag"
        ),
        ReactModule.createElement(
          "button",
          {
            type: "button",
            "data-test-native-delete": "true",
            onClick: () => {
              props.onNodesChange(
                props.nodes.filter((node) => node.selected)
                  .map((node) => ({ type: "remove", id: node.id }))
              );
              props.onEdgesChange(
                props.edges.filter((edge) => edge.selected)
                  .map((edge) => ({ type: "remove", id: edge.id }))
              );
            }
          },
          "Delete selected"
        ),
        props.children
      );
    }
  };
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let setAuthSessionForTest: ((session: { token: string; user: AuthUser }) => void) | null = null;
let logoutForTest: (() => void) | null = null;
let currentTitleForTest: string | null = null;

function AuthSessionProbe({ children }: { children: React.ReactNode }) {
  const workspaceShell = useOptionalWorkspaceShellContext();
  setAuthSessionForTest = workspaceShell?.setAuthSession ?? null;
  logoutForTest = workspaceShell?.logout ?? null;
  currentTitleForTest = workspaceShell?.currentTitle ?? null;
  return <>{children}</>;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function mount(
  props: React.ComponentProps<typeof CreatorCanvas> = {},
  options: {
    authenticated?: boolean;
    strictMode?: boolean;
    workspaceProvider?: boolean;
  } = {}
): Promise<void> {
  if (!vi.isMockFunction(globalThis.fetch)) {
    installCanvasFetch();
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  if (options.authenticated) {
    window.localStorage.setItem("ai-aggregate-token", "canvas-owner-token");
    window.localStorage.setItem("ai-aggregate-user", JSON.stringify({
      id: "canvas-user",
      email: "canvas@example.test",
      role: "USER",
      credits: 20,
      name: "Canvas User"
    }));
  }
  const canvas = <CreatorCanvas {...props} />;
  const useWorkspaceProvider = options.authenticated || options.workspaceProvider;
  const content = (
    <I18nContext.Provider
      value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
    >
      {useWorkspaceProvider ? (
        <WorkspaceShellProvider>
          <AuthSessionProbe>{canvas}</AuthSessionProbe>
        </WorkspaceShellProvider>
      ) : canvas}
    </I18nContext.Provider>
  );
  await act(async () => {
    root?.render(options.strictMode ? <React.StrictMode>{content}</React.StrictMode> : content);
  });
  await settle();
}

function getReactFlowProps(): MockReactFlowProps {
  if (!latestReactFlowProps) throw new Error("REACT_FLOW_PROPS_MISSING");
  return latestReactFlowProps;
}

function setMockCanvasBounds(width: number, height: number): void {
  mockCanvasBounds = {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    width,
    height,
    toJSON: () => ({})
  };
  const canvas = host?.querySelector<HTMLElement>(
    '[data-creator-canvas-root="true"]'
  );
  if (!canvas) throw new Error("CREATOR_CANVAS_ROOT_MISSING");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(mockCanvasBounds);
}

async function startViewportMovement(): Promise<void> {
  await act(async () => {
    getReactFlowProps().onMoveStart(null, mockReactFlowViewport);
  });
}

async function finishViewportMovement(
  viewport: { x: number; y: number; zoom: number }
): Promise<void> {
  mockReactFlowViewport = { ...viewport };
  await act(async () => {
    getReactFlowProps().onMoveEnd(null, viewport);
  });
  await settle();
}

async function moveViewport(
  viewport: { x: number; y: number; zoom: number }
): Promise<void> {
  await startViewportMovement();
  await finishViewportMovement(viewport);
}

function getMockNode(kind: string, index = 0): MockNode {
  const node = getReactFlowProps().nodes.filter((candidate) => candidate.type === kind)[index];
  if (!node) throw new Error(`MOCK_NODE_MISSING:${kind}:${index}`);
  return node;
}

function clickCreate(kind: "text" | "image" | "video"): void {
  const button = host?.querySelector<HTMLButtonElement>(`[data-create-creator-node-kind="${kind}"]`);
  if (!button) throw new Error(`CREATE_BUTTON_MISSING:${kind}`);
  button.click();
}

function setTextareaValue(element: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInputValue(element: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    element,
    value
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectOnlyNodeIds(nodeIds: readonly string[]): void {
  const selected = new Set(nodeIds);
  getReactFlowProps().onNodesChange(
    getReactFlowProps().nodes.map((node) => ({
      type: "select",
      id: node.id,
      selected: selected.has(node.id)
    }))
  );
}

async function setNodeDimensions(
  nodeId: string,
  dimensions: { width: number; height?: number }
): Promise<void> {
  await act(async () => getReactFlowProps().onNodesChange([{
    type: "dimensions",
    id: nodeId,
    dimensions
  }]));
  await settle();
}

async function setNodesDimensions(
  nodeIds: readonly string[],
  dimensions: { width: number; height: number }
): Promise<void> {
  await act(async () => getReactFlowProps().onNodesChange(nodeIds.map((nodeId) => ({
    type: "dimensions",
    id: nodeId,
    dimensions
  }))));
  await settle();
}

async function moveNode(
  nodeId: string,
  position: { x: number; y: number }
): Promise<void> {
  await act(async () => getReactFlowProps().onNodesChange([{
    type: "position",
    id: nodeId,
    position
  }]));
  await settle();
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function persistedCanvasDocumentResponse(
  id: string,
  revision: number,
  document: CreatorCanvasDocumentV1,
  drafts: ReadonlyMap<string, CreatorImageComposerDraft> = new Map(),
  title: string | null = null,
  videoDrafts: ReadonlyMap<string, CreatorVideoComposerDraft> = new Map()
) {
  return jsonResponse({
    document: {
      id,
      title,
      revision,
      state: serializeCreatorCanvasPersistedState(document, drafts, videoDrafts),
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z"
    }
  });
}

function getCanvasDocumentCalls(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  method?: string
) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    String(input).includes("/canvas/documents") &&
    (method === undefined || init?.method === method)
  );
}

function installCanvasRuntimeFetch(
  handler: (
    input: RequestInfo | URL,
    init: RequestInit | undefined
  ) => Promise<Response>,
  models: AiModelSummary[] = [canvasImageModel]
) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/models?surface=image")) {
      return jsonResponse({ models });
    }
    if (url.includes("/models?capability=chat&surface=chat")) {
      return jsonResponse({ models });
    }
    if (url.includes("/settings/public")) {
      return jsonResponse({ settings: {} });
    }
    if (url.includes("/quota/me")) {
      return jsonResponse({ remainingCredits: 20 });
    }
    return handler(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function createImageDocument({
  targetAssetId = null,
  withTextEdge = false
}: {
  targetAssetId?: string | null;
  withTextEdge?: boolean;
} = {}) {
  return {
    version: 1 as const,
    nodes: [
      ...(withTextEdge
        ? [{
            id: "text-source",
            kind: "text" as const,
            position: { x: 0, y: 0 },
            data: { text: "Canvas source prompt" }
          }]
        : []),
      {
        id: "image-target",
        kind: "image" as const,
        position: { x: 400, y: 120 },
        data: { assetId: targetAssetId }
      }
    ],
    edges: withTextEdge
      ? [{
          id: "text-edge",
          sourceNodeId: "text-source",
          targetNodeId: "image-target",
          relationship: "reference" as const
        }]
      : [],
    viewport: { x: -10, y: 15, zoom: 1 }
  };
}

function createTextAiDocument({
  instruction = "Generate a short script from the upstream content",
  modelId = canvasChatModel.modelId,
  sourceText = "Source Text A",
  targetText = "Old Text B output"
}: {
  instruction?: string;
  modelId?: string;
  sourceText?: string;
  targetText?: string;
} = {}): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "text-source",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: sourceText }
      },
      {
        id: "text-target",
        kind: "text",
        position: { x: 420, y: 0 },
        data: {
          text: targetText,
          ai: { instruction, modelId }
        }
      }
    ],
    edges: [{
      id: "text-source-target",
      sourceNodeId: "text-source",
      targetNodeId: "text-target",
      relationship: "reference"
    }],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function createGenerationTask(
  payload: Record<string, unknown>,
  status: AiTaskStatus = "succeeded",
  id = "canvas-task"
): AiTaskSummary {
  return {
    id,
    userId: "canvas-user",
    type: "image",
    status,
    modelId: typeof payload.modelId === "string" ? payload.modelId : null,
    prompt: typeof payload.prompt === "string" ? payload.prompt : "",
    input: { ...payload },
    output: status === "succeeded"
      ? { images: ["/assets/canvas-result/content"] }
      : null,
    costCredits: 2,
    errorMessage: status === "failed" ? "Safe reconciled failure" : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: status === "succeeded" || status === "failed"
      ? new Date().toISOString()
      : null
  };
}

function createGenerationAsset(
  id: string,
  taskId = "canvas-task"
): AiAssetSummary {
  return {
    id,
    userId: "canvas-user",
    taskId,
    type: "image",
    url: `/assets/${id}/content`,
    thumbnailUrl: null,
    title: id,
    metadata: null,
    createdAt: new Date().toISOString()
  };
}

function createVideoTask(
  payload: Record<string, unknown> = {},
  status: AiTaskStatus = "succeeded",
  id = "video-task-1",
  progress = status === "succeeded" ? 100 : 48
): AiTaskSummary {
  return {
    id,
    userId: "canvas-user",
    type: "video",
    status,
    modelId: typeof payload.modelId === "string" ? payload.modelId : canvasVideoModel.slug,
    prompt: typeof payload.prompt === "string" ? payload.prompt : "",
    input: { ...payload, videoProgress: progress },
    output: status === "succeeded" ? { videos: [`/assets/video-asset-1/content`] } : null,
    costCredits: canvasVideoModel.creditCost,
    errorMessage: status === "failed" ? "Synthetic failure" : null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:02.000Z",
    completedAt: status === "succeeded" || status === "failed"
      ? "2026-09-03T00:00:02.000Z"
      : null
  };
}

function createVideoAsset(
  id = "video-asset-1",
  taskId = "video-task-1"
): AiAssetSummary {
  return {
    id,
    userId: "canvas-user",
    taskId,
    type: "video",
    url: `/assets/${id}/content`,
    thumbnailUrl: null,
    title: "Synthetic Canvas video",
    metadata: { mimeType: "video/mp4" },
    createdAt: "2026-09-03T00:00:02.000Z"
  };
}

function createVideoDocument({
  targetAssetId = null,
  sourceText = "cinematic product reveal"
}: {
  targetAssetId?: string | null;
  sourceText?: string;
} = {}): CreatorCanvasDocumentV1 {
  return {
    version: 1,
    nodes: [
      {
        id: "video-text-source",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: sourceText }
      },
      {
        id: "video-target",
        kind: "video",
        position: { x: 420, y: 0 },
        data: { assetId: targetAssetId }
      }
    ],
    edges: [{
      id: "video-text-edge",
      sourceNodeId: "video-text-source",
      targetNodeId: "video-target",
      relationship: "reference"
    }],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function createExistingImageAsset(
  id = "asset-existing",
  title: string | null = "Existing owner work"
): AiAssetSummary {
  return {
    id,
    userId: "canvas-user",
    taskId: "existing-task",
    type: "image",
    url: `/assets/${id}/content`,
    thumbnailUrl: null,
    title,
    metadata: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    taskPrompt: title ? null : "Existing prompt fallback"
  };
}

function getCanvasPostCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    init?.method === "POST" && String(input).includes("/image/generate")
  );
}

function getCanvasAssetListCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    init?.method === "GET" && String(input).endsWith("/assets?type=image&limit=50")
  );
}

function readDomainEdges(): Array<{
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  selected?: boolean;
}> {
  return JSON.parse(
    host?.querySelector("[data-mock-react-flow]")
      ?.getAttribute("data-edge-projection") ?? "[]"
  );
}

function installDirectGenerationResults(
  resultsByRequest: readonly (readonly string[])[]
) {
  let requestIndex = 0;
  return installCanvasRuntimeFetch(async (input, init) => {
    if (init?.method === "POST" && String(input).includes("/image/generate")) {
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      const task = createGenerationTask(
        payload,
        "succeeded",
        `canvas-task-${requestIndex + 1}`
      );
      const assetIds = resultsByRequest[requestIndex] ?? [];
      requestIndex += 1;
      return jsonResponse({
        task,
        assets: assetIds.map((assetId) => createGenerationAsset(assetId, task.id))
      });
    }
    return new Response("not found", { status: 404 });
  });
}

function getNodeIdByAssetId(assetId: string): string {
  const nodeId = readDomainNodes().find((node) => node.data.assetId === assetId)?.id;
  if (!nodeId) throw new Error(`CREATOR_CANVAS_ASSET_NODE_MISSING:${assetId}`);
  return nodeId;
}

function getComposerPrompt(): HTMLTextAreaElement {
  const prompt = host?.querySelector<HTMLTextAreaElement>(
    '[data-creator-image-prompt="true"]'
  );
  if (!prompt) throw new Error("CREATOR_IMAGE_PROMPT_MISSING");
  return prompt;
}

function getTextAiInstruction(): HTMLTextAreaElement {
  const instruction = host?.querySelector<HTMLTextAreaElement>(
    '[data-creator-text-ai-instruction="true"]'
  );
  if (!instruction) throw new Error("CREATOR_TEXT_AI_INSTRUCTION_MISSING");
  return instruction;
}

function getTextAiModel(): HTMLSelectElement {
  const model = host?.querySelector<HTMLSelectElement>(
    '[data-creator-text-ai-model="true"]'
  );
  if (!model) throw new Error("CREATOR_TEXT_AI_MODEL_MISSING");
  return model;
}

function getTextAiExecuteButton(): HTMLButtonElement {
  const button = host?.querySelector<HTMLButtonElement>(
    '[data-creator-text-ai-execute="true"]'
  );
  if (!button) throw new Error("CREATOR_TEXT_AI_EXECUTE_MISSING");
  return button;
}

function getTextAiCompletionCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    init?.method === "POST" && String(input).includes("/chat/completions")
  );
}

function getVideoGenerationCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    init?.method === "POST" && String(input).includes("/video/generate")
  );
}

function getVideoTaskDetailCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    (init?.method === undefined || init?.method === "GET") &&
    /\/tasks\/[^?]+$/.test(String(input))
  );
}

function getVideoModelDiscoveryCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    (init?.method === undefined || init?.method === "GET") &&
    String(input).includes("/models?capability=video&surface=video")
  );
}

function getVideoPrompt(): HTMLTextAreaElement {
  const prompt = host?.querySelector<HTMLTextAreaElement>(
    '[data-creator-video-prompt="true"]'
  );
  if (!prompt) throw new Error("CREATOR_VIDEO_PROMPT_MISSING");
  return prompt;
}

function getVideoModel(): HTMLSelectElement {
  const model = host?.querySelector<HTMLSelectElement>(
    '[data-creator-video-model="true"]'
  );
  if (!model) throw new Error("CREATOR_VIDEO_MODEL_MISSING");
  return model;
}

function getVideoExecuteButton(): HTMLButtonElement {
  const button = host?.querySelector<HTMLButtonElement>(
    '[data-creator-video-execute="true"]'
  );
  if (!button) throw new Error("CREATOR_VIDEO_EXECUTE_MISSING");
  return button;
}

function getTextInputForNode(nodeId: string): HTMLTextAreaElement {
  const selected = getReactFlowProps().nodes.find((node) => node.id === nodeId)?.selected;
  if (!selected) throw new Error(`CREATOR_TEXT_NODE_NOT_SELECTED:${nodeId}`);
  let input = host?.querySelector<HTMLTextAreaElement>(
    '[data-creator-text-workspace-editor="true"]'
  );
  if (!input) {
    const editButton = host?.querySelector<HTMLButtonElement>(
      '[data-creator-text-workspace-view="edit"]'
    );
    if (editButton) act(() => editButton.click());
    input = host?.querySelector<HTMLTextAreaElement>(
      '[data-creator-text-workspace-editor="true"]'
    );
  }
  if (!input) throw new Error(`CREATOR_TEXT_INPUT_MISSING:${nodeId}`);
  return input;
}

function getTextAiModelDiscoveryCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    (init?.method === undefined || init?.method === "GET") &&
    String(input).includes("/models?capability=chat&surface=chat")
  );
}

function getQuotaCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes("/quota/me"));
}

function getTextNodeData(nodeId: string): {
  text?: string;
  ai?: { instruction: string; modelId: string };
} | undefined {
  return readDomainNodes().find((node) => node.id === nodeId)?.data;
}

function getExecuteButton(): HTMLButtonElement {
  const button = host?.querySelector<HTMLButtonElement>(
    "[data-creator-image-execute]"
  );
  if (!button) throw new Error("CREATOR_IMAGE_EXECUTE_MISSING");
  return button;
}

async function executeSelectedImageGeneration(
  prompt: string,
  count: "1" | "2" | "4" = "1"
): Promise<void> {
  await act(async () => {
    setTextareaValue(getComposerPrompt(), prompt);
    const countSelect = host?.querySelector<HTMLSelectElement>(
      '[data-creator-image-count="true"]'
    );
    if (!countSelect) throw new Error("CREATOR_IMAGE_COUNT_MISSING");
    setSelectValue(countSelect, count);
  });
  await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
  await act(async () => getExecuteButton().click());
}

function readDomainNodes(): Array<{
  id: string;
  kind: string;
  position: { x: number; y: number };
  data: {
    assetId?: string | null;
    text?: string;
    ai?: { instruction: string; modelId: string };
  };
}> {
  return JSON.parse(
    host?.querySelector("[data-mock-react-flow]")
      ?.getAttribute("data-domain-nodes") ?? "[]"
  );
}

function getRecipeNode(kind: string, x: number, y: number) {
  const node = readDomainNodes().find((candidate) =>
    candidate.kind === kind && candidate.position.x === x && candidate.position.y === y
  );
  if (!node) throw new Error(`CREATOR_CANVAS_RECIPE_NODE_MISSING:${kind}:${x}:${y}`);
  return node;
}

function expectRecipeTopology(): void {
  const brief = getRecipeNode("text", 0, 0);
  const creative = getRecipeNode("text", 380, 0);
  const keyframe = getRecipeNode("text", 760, -160);
  const image = getRecipeNode("image", 1140, -160);
  const motion = getRecipeNode("text", 760, 220);
  const video = getRecipeNode("video", 1140, 220);
  expect(readDomainEdges().map((edge) => [edge.source, edge.target])).toEqual([
    [brief.id, creative.id],
    [creative.id, keyframe.id],
    [keyframe.id, image.id],
    [creative.id, motion.id],
    [motion.id, video.id],
    [image.id, video.id]
  ]);
}

function getHistoryButton(action: "undo" | "redo"): HTMLButtonElement {
  const button = host?.querySelector<HTMLButtonElement>(
    `[data-creator-canvas-history-action="${action}"]`
  );
  if (!button) throw new Error(`CREATOR_CANVAS_HISTORY_${action.toUpperCase()}_MISSING`);
  return button;
}

async function clickHistory(action: "undo" | "redo"): Promise<void> {
  await act(async () => getHistoryButton(action).click());
  await settle();
}

async function pressCanvasShortcut(
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}
): Promise<boolean> {
  const eventInit = {
    bubbles: true,
    cancelable: true,
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ...modifiers
  };
  const keydownEvent = new KeyboardEvent("keydown", eventInit);
  await act(async () => {
    document.dispatchEvent(keydownEvent);
  });
  await settle();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });
  await settle();
  return keydownEvent.defaultPrevented;
}

async function waitForCanvas(assertion: () => void): Promise<void> {
  await act(async () => {
    await vi.waitFor(assertion, { timeout: 3000, interval: 10 });
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  setAuthSessionForTest = null;
  logoutForTest = null;
  currentTitleForTest = null;
  latestReactFlowProps = null;
  mockReactFlowViewport = { x: 0, y: 0, zoom: 1 };
  mockReactFlowViewportInitialized = false;
  mockCanvasBounds = {
    left: 0,
    top: 0,
    right: 1_000,
    bottom: 800,
    x: 0,
    y: 0,
    width: 1_000,
    height: 800,
    toJSON: () => ({})
  };
  reactFlowSetViewportMock.mockReset();
  reactFlowGetViewportForBoundsMock.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/canvas");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  compressReferenceImageMock.mockReset();
  dialogShowModalMock.mockClear();
  dialogCloseMock.mockClear();
  routerPushMock.mockReset();
});

describe("CreatorCanvas", () => {
  it("derives a bounded title from the first usable Text node only", () => {
    const document: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [
        {
          id: "blank-text",
          kind: "text",
          position: { x: 0, y: 0 },
          data: { text: "   \n\t" }
        },
        {
          id: "first-text",
          kind: "text",
          position: { x: 40, y: 40 },
          data: {
            text: "  Please help me:   draft   a   launch   plan   for   Q4. Another sentence.  "
          }
        },
        {
          id: "later-text",
          kind: "text",
          position: { x: 80, y: 80 },
          data: { text: "A later title must not win" }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };

    expect(deriveCreatorCanvasTitle(document)).toBe("draft a launch plan for Q4");
    expect(deriveCreatorCanvasTitle({
      ...document,
      nodes: []
    })).toBeNull();
    expect(deriveCreatorCanvasTitle({
      ...document,
      nodes: [{
        id: "long-text",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "x".repeat(250) }
      }]
    })?.length).toBeLessThanOrEqual(200);
  });

  it("starts blank with the recipe starter and the existing Text, Image, and Video toolbar", async () => {
    const fetchMock = installCanvasFetch();
    await mount();

    expect(host?.querySelector('[data-creator-canvas-node-count="0"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-edge-count="0"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-semantic-empty="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-recipe-starter="true"]')).toBeTruthy();
    expect(host?.textContent).toContain("Product Ad Short Video");
    expect(host?.querySelectorAll("[data-create-creator-node-kind]")).toHaveLength(3);
    expect(Array.from(
      host?.querySelectorAll("[data-create-creator-node-kind]") ?? [],
      (element) => element.textContent?.trim()
    )).toEqual(["Text", "Image", "Video"]);
    expect(host?.textContent).not.toContain("Reference Image");
    expect(host?.textContent).not.toContain("Video Generate");
    expect(host?.textContent).not.toContain("Video Asset");
    expect(host?.querySelector("[data-react-flow-background]")).toBeTruthy();
    expect(host?.querySelector("[data-react-flow-controls]")).toBeTruthy();
    expect(host?.querySelector("[data-react-flow-minimap]")).toBeTruthy();
    expect(host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-nodes-connectable")).toBe("true");
    expect(host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-selection-on-drag")).toBe("true");
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/models?surface=image")
    )).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([input, init]) =>
      init?.method === "POST" || String(input).includes("/image/generate")
    )).toBe(false);
  });

  it("applies the recipe only from an empty Canvas and keeps the application local", async () => {
    const fetchMock = installCanvasFetch([canvasImageModel, canvasChatModel]);
    await mount({ initialModels: [canvasImageModel, canvasChatModel] });
    const beforeApply = fetchMock.mock.calls.length;
    const apply = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-recipe-apply="product-ad-short-video"]'
    );
    if (!apply) throw new Error("CREATOR_CANVAS_RECIPE_APPLY_MISSING");

    await act(async () => apply.click());
    await settle();

    expect(readDomainNodes()).toHaveLength(6);
    expect(readDomainEdges()).toHaveLength(6);
    expectRecipeTopology();
    expect(host?.querySelector('[data-creator-canvas-recipe-starter="true"]')).toBeNull();
    expect(host?.querySelector('[data-creator-canvas-semantic-empty="false"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-persistence-status="true"]')?.textContent)
      .toContain("Unsaved");
    expect(getHistoryButton("undo").disabled).toBe(true);
    expect(getHistoryButton("redo").disabled).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(beforeApply);
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(0);
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([input, init]) =>
      init?.method === "POST" && String(input).includes("/canvas/documents")
    )).toBe(false);

    const brief = getRecipeNode("text", 0, 0);
    await act(async () => selectOnlyNodeIds([brief.id]));
    const briefInput = getTextInputForNode(brief.id);
    await act(async () => {
      briefInput.focus();
      setTextareaValue(briefInput, "A compact tea launch");
      briefInput.blur();
    });
    await waitForCanvas(() => expect(getHistoryButton("undo").disabled).toBe(false));
    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(6);
    expect(getRecipeNode("text", 0, 0).data.text).toBe("");
    expect(getHistoryButton("undo").disabled).toBe(true);
  });

  it("hides the starter as soon as any semantic node exists", async () => {
    await mount();
    await act(async () => clickCreate("text"));
    expect(host?.querySelector('[data-creator-canvas-recipe-starter="true"]')).toBeNull();
    expect(host?.querySelector('[data-creator-canvas-semantic-empty="false"]')).toBeTruthy();
  });

  it("reconciles the recipe against the currently enabled model fixtures", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input) => {
      if (String(input).includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModelTwo] });
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModelTwo, canvasChatModelTwo]);
    await mount({
      initialModels: [canvasImageModel, canvasChatModel]
    });
    await act(async () => host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-recipe-apply="product-ad-short-video"]'
    )?.click());

    const creative = getRecipeNode("text", 380, 0);
    expect(creative.data.ai?.modelId).toBe("");
    await act(async () => selectOnlyNodeIds([creative.id]));
    await waitForCanvas(() => expect(getTextAiModel().value).toBe(canvasChatModelTwo.modelId));
    expect(getTextNodeData(creative.id)?.ai?.modelId).toBe("");

    const image = getRecipeNode("image", 1140, -160);
    await act(async () => selectOnlyNodeIds([image.id]));
    await waitForCanvas(() => expect(host?.querySelector<HTMLSelectElement>(
      '[data-creator-image-model="true"]'
    )?.value).toBe(canvasImageModelTwo.slug));

    const video = getRecipeNode("video", 1140, 220);
    await act(async () => selectOnlyNodeIds([video.id]));
    await waitForCanvas(() => expect(getVideoModel().value).toBe(canvasVideoModelTwo.slug));
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(0);
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(0);
  });

  it("saves and reopens the recipe topology, Text AI configs, and Video I2V draft", async () => {
    type SavedRecipeState = {
      document: CreatorCanvasDocumentV1;
      imageComposerDrafts: Record<string, unknown>;
      videoComposerDrafts: Record<string, Record<string, unknown>>;
    };
    let savedState: SavedRecipeState | null = null;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/canvas/documents")) {
        const body = JSON.parse(String(init.body)) as {
          state: SavedRecipeState;
          title: string | null;
        };
        savedState = body.state;
        const videoNode = body.state.document.nodes.find((node) => node.kind === "video");
        if (!videoNode) throw new Error("RECIPE_VIDEO_NODE_NOT_SAVED");
        expect(body.title).toBe(deriveCreatorCanvasTitle(body.state.document));
        expect(Object.keys(body.state.imageComposerDrafts)).toHaveLength(0);
        expect(body.state.videoComposerDrafts[videoNode.id]).toMatchObject({
          prompt: "",
          modelId: "",
          mode: "image-to-video",
          selectedImageReferenceNodeId: null,
          promptSeedSourceNodeId: null,
          promptDirty: false
        });
        return jsonResponse({
          document: {
            id: "saved-recipe-canvas",
            title: body.title,
            revision: 1,
            state: body.state,
            createdAt: "2026-09-04T10:00:00.000Z",
            updatedAt: "2026-09-04T10:00:00.000Z"
          }
        });
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({
          documents: [{
            id: "saved-recipe-canvas",
            title: "Recipe Canvas",
            revision: 1,
            createdAt: "2026-09-04T10:00:00.000Z",
            updatedAt: "2026-09-04T10:00:00.000Z"
          }]
        });
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents/saved-recipe-canvas")) {
        if (!savedState) throw new Error("RECIPE_STATE_NOT_SAVED");
        return jsonResponse({
          document: {
            id: "saved-recipe-canvas",
            title: "Recipe Canvas",
            revision: 1,
            state: savedState,
            createdAt: "2026-09-04T10:00:00.000Z",
            updatedAt: "2026-09-04T10:00:00.000Z"
          }
        });
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });

    const apply = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-recipe-apply="product-ad-short-video"]'
    );
    if (!apply) throw new Error("RECIPE_SAVE_APPLY_MISSING");
    await act(async () => apply.click());
    const brief = getRecipeNode("text", 0, 0);
    await act(async () => selectOnlyNodeIds([brief.id]));
    const briefInput = getTextInputForNode(brief.id);
    await act(async () => {
      briefInput.focus();
      setTextareaValue(briefInput, "Premium tea launch");
      briefInput.blur();
    });

    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!save || !open) throw new Error("RECIPE_SAVE_OPEN_ACTION_MISSING");
    await waitForCanvas(() => expect(save.disabled).toBe(false));
    await act(async () => save.click());
    await waitForCanvas(() => expect(savedState).not.toBeNull());
    expect(getCanvasDocumentCalls(fetchMock, "POST")).toHaveLength(1);
    expect(window.location.search).toBe("?canvasId=saved-recipe-canvas");

    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-list="true"]'
    )).toBeTruthy());
    const openSaved = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-open="true"]'
    );
    if (!openSaved) throw new Error("RECIPE_SAVED_OPEN_ACTION_MISSING");
    await act(async () => openSaved.click());
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(6));
    expectRecipeTopology();
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeNull();
    expect(host?.querySelector('[data-creator-canvas-persistence-status="true"]')?.textContent)
      .toContain("Saved");
    expect(currentTitleForTest).toBe("Recipe Canvas");

    const video = getRecipeNode("video", 1140, 220);
    await act(async () => selectOnlyNodeIds([video.id]));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-video-mode="image-to-video"][aria-pressed="true"]'
    )).toBeTruthy());
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps Image prompt seeding on the existing sole incoming Text behavior", async () => {
    const fetchMock = installCanvasFetch([canvasImageModel]);
    await mount({ initialModels: [canvasImageModel] });
    const apply = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-recipe-apply="product-ad-short-video"]'
    );
    if (!apply) throw new Error("RECIPE_IMAGE_SEED_APPLY_MISSING");
    await act(async () => apply.click());

    const image = getRecipeNode("image", 1140, -160);
    await act(async () => selectOnlyNodeIds([image.id]));
    expect(getComposerPrompt().value).toBe("");

    const keyframe = getRecipeNode("text", 760, -160);
    await act(async () => selectOnlyNodeIds([keyframe.id]));
    const keyframeInput = getTextInputForNode(keyframe.id);
    await act(async () => {
      keyframeInput.focus();
      setTextareaValue(keyframeInput, "A generation-ready keyframe of the tea bottle");
      keyframeInput.blur();
    });
    await act(async () => selectOnlyNodeIds([image.id]));
    await waitForCanvas(() => expect(getComposerPrompt().value)
      .toBe("A generation-ready keyframe of the tea bottle"));
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps Video I2V prompt seeding and bound-image reconciliation on existing behavior", async () => {
    const selectedAsset = createExistingImageAsset("recipe-keyframe-asset", "Recipe keyframe");
    const fetchMock = installCanvasRuntimeFetch(async (input) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (url.endsWith("/assets?type=image&limit=50")) {
        return jsonResponse({ assets: [selectedAsset] });
      }
      if (url.endsWith(`/assets/${selectedAsset.id}`)) {
        return jsonResponse({ asset: selectedAsset, task: null });
      }
      if (url.endsWith(selectedAsset.url)) {
        return new Response("recipe-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    const apply = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-recipe-apply="product-ad-short-video"]'
    );
    if (!apply) throw new Error("RECIPE_VIDEO_RECONCILIATION_APPLY_MISSING");
    await act(async () => apply.click());

    const motion = getRecipeNode("text", 760, 220);
    await act(async () => selectOnlyNodeIds([motion.id]));
    const motionInput = getTextInputForNode(motion.id);
    await act(async () => {
      motionInput.focus();
      setTextareaValue(motionInput, "The bottle rotates slowly as sunlight moves across the table");
      motionInput.blur();
    });

    const video = getRecipeNode("video", 1140, 220);
    await act(async () => selectOnlyNodeIds([video.id]));
    await waitForCanvas(() => {
      expect(getVideoPrompt().value)
        .toBe("The bottle rotates slowly as sunlight moves across the table");
      expect(host?.querySelector('[data-creator-video-mode="image-to-video"][aria-pressed="true"]'))
        .toBeTruthy();
      expect(host?.querySelector('[data-creator-video-image-references]')?.textContent)
        .toContain("No bound incoming image");
    });

    const image = getRecipeNode("image", 1140, -160);
    await act(async () => selectOnlyNodeIds([image.id]));
    const choose = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="choose"]'
    );
    if (!choose) throw new Error("RECIPE_IMAGE_CHOOSE_MISSING");
    await act(async () => choose.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-asset-picker-state="ready"]'
    )).toBeTruthy());
    const select = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-select="true"]'
    );
    if (!select) throw new Error("RECIPE_IMAGE_ASSET_SELECT_MISSING");
    await act(async () => select.click());
    await waitForCanvas(() => expect(readDomainNodes().find((node) => node.id === image.id)
      ?.data.assetId).toBe(selectedAsset.id));

    await act(async () => selectOnlyNodeIds([video.id]));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-video-source-chip="image"][data-selected="true"]'
    )).toBeTruthy());
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(0);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(0);
  });

  it("creates multiple nodes, edits Text locally, duplicates content with an offset, and deletes only the target", async () => {
    const fetchMock = installCanvasFetch();
    await mount();

    for (const kind of ["text", "text", "image", "video"] as const) {
      await act(async () => clickCreate(kind));
    }

    expect(host?.querySelectorAll('[data-creator-canvas-node-kind="text"]')).toHaveLength(2);
    expect(host?.querySelectorAll('[data-creator-canvas-node-kind="image"]')).toHaveLength(1);
    expect(host?.querySelectorAll('[data-creator-canvas-node-kind="video"]')).toHaveLength(1);

    const initialPositions = JSON.parse(
      host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-node-positions") ?? "[]"
    ) as Array<{ position: { x: number; y: number } }>;
    expect(new Set(initialPositions.map((node) => `${node.position.x}:${node.position.y}`)).size).toBe(4);
    expect(Math.abs((initialPositions[1]?.position.x ?? 0) - (initialPositions[0]?.position.x ?? 0)))
      .toBeGreaterThanOrEqual(380);
    expect(Math.abs((initialPositions[2]?.position.y ?? 0) - (initialPositions[0]?.position.y ?? 0)))
      .toBeGreaterThanOrEqual(240);

    const firstTextId = getReactFlowProps().nodes
      .filter((node) => node.type === "text")[0]?.id;
    if (!firstTextId) throw new Error("CANVAS_TEXT_NODE_MISSING");
    await act(async () => selectOnlyNodeIds([firstTextId]));
    const firstText = getTextInputForNode(firstTextId);
    await act(async () => setTextareaValue(firstText, "A local text"));

    const textNode = host?.querySelector<HTMLElement>(
      `[data-mock-node-id="${firstTextId}"]`
    );
    if (!textNode) throw new Error("PROMPT_NODE_WRAPPER_MISSING");
    await act(async () => {
      textNode.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 180
      }));
    });
    const duplicate = host?.querySelector<HTMLButtonElement>('[data-creator-canvas-node-action="duplicate"]');
    if (!duplicate) throw new Error("DUPLICATE_ACTION_MISSING");
    await act(async () => duplicate.click());

    const textInputs = Array.from(host?.querySelectorAll<HTMLTextAreaElement>(
      '[data-creator-text-workspace-editor="true"]'
    ) ?? []);
    expect(textInputs).toHaveLength(1);
    expect(textInputs[0]?.value).toBe("A local text");
    expect(host?.querySelectorAll('[data-creator-canvas-node-kind="text"] textarea'))
      .toHaveLength(0);
    expect(readDomainNodes().filter((node) => node.kind === "text" && node.data.text === "A local text"))
      .toHaveLength(2);
    const serializedDomainNodes = host?.querySelector("[data-mock-react-flow]")
      ?.getAttribute("data-domain-nodes") ?? "";
    expect(serializedDomainNodes).toContain("A local text");
    expect(serializedDomainNodes).not.toContain("onTextChange");

    const positions = JSON.parse(
      host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-node-positions") ?? "[]"
    ) as Array<{ id: string; kind: string; position: { x: number; y: number } }>;
    const originalPosition = positions.find((node) => node.id === textNode.dataset.mockNodeId)?.position;
    const duplicatePosition = positions.filter((node) => node.kind === "text").at(-1)?.position;
    expect(duplicatePosition).toEqual({
      x: (originalPosition?.x ?? 0) + 32,
      y: (originalPosition?.y ?? 0) + 32
    });

    const duplicatedNodeId = positions.filter((node) => node.kind === "text").at(-1)?.id;
    const duplicatedNode = host?.querySelector<HTMLElement>(`[data-mock-node-id="${duplicatedNodeId}"]`);
    if (!duplicatedNode) throw new Error("DUPLICATED_NODE_MISSING");
    await act(async () => {
      duplicatedNode.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 240,
        clientY: 220
      }));
    });
    const deleteAction = host?.querySelector<HTMLButtonElement>('[data-creator-canvas-node-action="delete"]');
    if (!deleteAction) throw new Error("DELETE_ACTION_MISSING");
    await act(async () => deleteAction.click());

    expect(host?.querySelectorAll('[data-creator-canvas-node-kind="text"]')).toHaveLength(2);
    expect(host?.querySelector('[data-creator-canvas-node-kind="image"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-node-kind="video"]')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input, init]) =>
      init?.method === "POST" || String(input).includes("/image/generate")
    )).toBe(false);
  });

  it("uses native change lifecycle for selection, drag, and keyboard-style deletion", async () => {
    await mount();
    await act(async () => {
      clickCreate("text");
      clickCreate("image");
      clickCreate("video");
    });

    const selectionProbe = host?.querySelector<HTMLButtonElement>("[data-test-native-select-drag]");
    if (!selectionProbe) throw new Error("SELECTION_PROBE_MISSING");
    await act(async () => selectionProbe.click());

    const positions = JSON.parse(
      host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-node-positions") ?? "[]"
    ) as Array<{ selected: boolean; position: { x: number; y: number } }>;
    expect(positions.filter((node) => node.selected)).toHaveLength(2);
    expect(positions[0]?.position).toEqual({ x: 240, y: 180 });

    const deleteProbe = host?.querySelector<HTMLButtonElement>("[data-test-native-delete]");
    if (!deleteProbe) throw new Error("DELETE_PROBE_MISSING");
    await act(async () => deleteProbe.click());
    expect(host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-node-count")).toBe("1");
  });

  it("records add, duplicate, and delete as atomic history steps and clears redo on a new mutation", async () => {
    await mount();

    expect(getHistoryButton("undo").disabled).toBe(true);
    expect(getHistoryButton("redo").disabled).toBe(true);

    await act(async () => clickCreate("text"));
    const originalId = getMockNode("text").id;
    expect(getHistoryButton("undo").disabled).toBe(false);
    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(0);
    expect(getHistoryButton("redo").disabled).toBe(false);
    await clickHistory("redo");
    expect(readDomainNodes()).toHaveLength(1);

    const originalWrapper = host?.querySelector<HTMLElement>(
      `[data-mock-node-id="${originalId}"]`
    );
    if (!originalWrapper) throw new Error("ORIGINAL_NODE_WRAPPER_MISSING");
    await act(async () => originalWrapper.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 120
    })));
    const duplicate = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-node-action="duplicate"]'
    );
    if (!duplicate) throw new Error("DUPLICATE_HISTORY_ACTION_MISSING");
    await act(async () => duplicate.click());
    expect(readDomainNodes()).toHaveLength(2);
    await clickHistory("undo");
    expect(readDomainNodes().map((node) => node.id)).toEqual([originalId]);
    await clickHistory("redo");
    expect(readDomainNodes()).toHaveLength(2);

    const duplicatedId = readDomainNodes().find((node) => node.id !== originalId)?.id;
    if (!duplicatedId) throw new Error("DUPLICATED_HISTORY_NODE_MISSING");
    const duplicatedWrapper = host?.querySelector<HTMLElement>(
      `[data-mock-node-id="${duplicatedId}"]`
    );
    if (!duplicatedWrapper) throw new Error("DUPLICATED_NODE_WRAPPER_MISSING");
    await act(async () => duplicatedWrapper.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 140,
      clientY: 140
    })));
    const deleteAction = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-node-action="delete"]'
    );
    if (!deleteAction) throw new Error("DELETE_HISTORY_ACTION_MISSING");
    await act(async () => deleteAction.click());
    expect(readDomainNodes().map((node) => node.id)).toEqual([originalId]);
    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(2);

    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(1);
    await act(async () => clickCreate("image"));
    expect(getHistoryButton("redo").disabled).toBe(true);
  });

  it("coalesces focused Text edits and keeps native focused-form undo outside Canvas history", async () => {
    const initialDocument = {
      version: 1 as const,
      nodes: [{
        id: "text-history",
        kind: "text" as const,
        position: { x: 20, y: 30 },
        data: { text: "before" }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    await mount({ initialDocument });
    await act(async () => selectOnlyNodeIds(["text-history"]));
    const text = getTextInputForNode("text-history");

    await act(async () => text.focus());
    await act(async () => setTextareaValue(text, "a"));
    await act(async () => setTextareaValue(text, "ab"));
    await act(async () => setTextareaValue(text, "after focus"));
    await act(async () => text.blur());
    await settle();
    expect(readDomainNodes()[0]?.data.text).toBe("after focus");

    await clickHistory("undo");
    expect(readDomainNodes()[0]?.data.text).toBe("before");
    expect(getHistoryButton("undo").disabled).toBe(true);
    await clickHistory("redo");
    expect(readDomainNodes()[0]?.data.text).toBe("after focus");

    await act(async () => text.focus());
    await pressCanvasShortcut("z", { ctrlKey: true });
    expect(readDomainNodes()[0]?.data.text).toBe("after focus");
    expect(getHistoryButton("redo").disabled).toBe(true);
    await act(async () => text.blur());
  });

  it("coalesces single-node and multi-node React Flow drag lifecycles into one step each", async () => {
    const initialDocument = {
      version: 1 as const,
      nodes: [
        { id: "drag-a", kind: "text" as const, position: { x: 0, y: 0 }, data: { text: "A" } },
        { id: "drag-b", kind: "text" as const, position: { x: 200, y: 0 }, data: { text: "B" } }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    await mount({ initialDocument });
    const dragA = getMockNode("text", 0);
    const dragB = getMockNode("text", 1);

    await act(async () => {
      getReactFlowProps().onNodeDragStart(null, dragA, [dragA]);
      getReactFlowProps().onNodesChange([{
        type: "position",
        id: dragA.id,
        position: { x: 10, y: 20 },
        dragging: true
      }]);
      getReactFlowProps().onNodesChange([{
        type: "position",
        id: dragA.id,
        position: { x: 40, y: 50 },
        dragging: true
      }]);
      getReactFlowProps().onNodeDragStop(null, dragA, [dragA]);
    });
    await settle();
    expect(readDomainNodes().find((node) => node.id === dragA.id)?.position)
      .toEqual({ x: 40, y: 50 });
    await clickHistory("undo");
    expect(readDomainNodes().find((node) => node.id === dragA.id)?.position)
      .toEqual({ x: 0, y: 0 });
    expect(readDomainNodes().find((node) => node.id === dragB.id)?.position)
      .toEqual({ x: 200, y: 0 });
    await clickHistory("redo");

    await act(async () => {
      getReactFlowProps().onNodeDragStart(null, dragA, [dragA, dragB]);
      getReactFlowProps().onNodesChange([
        {
          type: "position",
          id: dragA.id,
          position: { x: 80, y: 90 },
          dragging: true
        },
        {
          type: "position",
          id: dragB.id,
          position: { x: 260, y: 30 },
          dragging: true
        }
      ]);
      getReactFlowProps().onNodesChange([
        {
          type: "position",
          id: dragA.id,
          position: { x: 100, y: 110 },
          dragging: false
        },
        {
          type: "position",
          id: dragB.id,
          position: { x: 280, y: 50 },
          dragging: false
        }
      ]);
      getReactFlowProps().onNodeDragStop(null, dragA, [dragA, dragB]);
    });
    await settle();
    expect(readDomainNodes().find((node) => node.id === dragA.id)?.position)
      .toEqual({ x: 100, y: 110 });
    expect(readDomainNodes().find((node) => node.id === dragB.id)?.position)
      .toEqual({ x: 280, y: 50 });
    await clickHistory("undo");
    expect(readDomainNodes().find((node) => node.id === dragA.id)?.position)
      .toEqual({ x: 40, y: 50 });
    expect(readDomainNodes().find((node) => node.id === dragB.id)?.position)
      .toEqual({ x: 200, y: 0 });
  });

  it("keeps the current viewport while undoing semantic Text changes", async () => {
    const initialDocument = {
      version: 1 as const,
      nodes: [{
        id: "viewport-history-text",
        kind: "text" as const,
        position: { x: 0, y: 0 },
        data: { text: "before" }
      }],
      edges: [],
      viewport: { x: -10, y: 15, zoom: 1 }
    };
    await mount({ initialDocument });
    await act(async () => selectOnlyNodeIds(["viewport-history-text"]));
    const text = getTextInputForNode("viewport-history-text");
    await act(async () => {
      text.focus();
      setTextareaValue(text, "after");
      text.blur();
    });
    await settle();
    await moveViewport({ x: 90, y: -40, zoom: 0.75 });
    const currentViewport = host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport");
    expect(currentViewport).toBe("90,-40,0.75");

    await clickHistory("undo");
    expect(readDomainNodes()[0]?.data.text).toBe("before");
    expect(host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport")).toBe(currentViewport);
    await clickHistory("redo");
    expect(readDomainNodes()[0]?.data.text).toBe("after");
    expect(host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport")).toBe(currentViewport);
  });

  it("restores Image Composer drafts when an Image node is deleted and undone", async () => {
    const secondModel = {
      ...canvasImageModel,
      id: "canvas-history-second-model",
      displayName: "Canvas History Ultra",
      slug: "canvas-history-ultra",
      sortOrder: 1
    };
    installCanvasFetch([canvasImageModel, secondModel]);
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel, secondModel]
    });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    const prompt = getComposerPrompt();
    const model = host?.querySelector<HTMLSelectElement>('[data-creator-image-model="true"]');
    const aspect = host?.querySelector<HTMLSelectElement>('[data-creator-image-aspect="true"]');
    const count = host?.querySelector<HTMLSelectElement>('[data-creator-image-count="true"]');
    const edit = host?.querySelector<HTMLButtonElement>('[data-creator-image-operation="edit"]');
    if (!model || !aspect || !count || !edit) throw new Error("DRAFT_HISTORY_CONTROLS_MISSING");
    await act(async () => {
      prompt.focus();
      setTextareaValue(prompt, "Draft survives deletion");
      prompt.blur();
      setSelectValue(model, secondModel.slug);
      setSelectValue(aspect, "16:9");
      setSelectValue(count, "4");
      edit.click();
    });
    await settle();
    expect(prompt.value).toBe("Draft survives deletion");
    expect(model.value).toBe(secondModel.slug);
    expect(aspect.value).toBe("16:9");
    expect(count.value).toBe("4");
    expect(edit.getAttribute("aria-pressed")).toBe("true");

    const nodeWrapper = host?.querySelector<HTMLElement>('[data-mock-node-id="image-target"]');
    if (!nodeWrapper) throw new Error("DRAFT_HISTORY_NODE_MISSING");
    await act(async () => nodeWrapper.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100
    })));
    const deleteAction = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-node-action="delete"]'
    );
    if (!deleteAction) throw new Error("DRAFT_HISTORY_DELETE_MISSING");
    await act(async () => deleteAction.click());
    expect(readDomainNodes()).toEqual([]);

    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(1);
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await settle();
    expect(getComposerPrompt().value).toBe("Draft survives deletion");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-model="true"]')?.value)
      .toBe(secondModel.slug);
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-aspect="true"]')?.value)
      .toBe("16:9");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-count="true"]')?.value)
      .toBe("4");
    expect(host?.querySelector('[data-creator-image-operation="edit"]')
      ?.getAttribute("aria-pressed")).toBe("true");
  });

  it("preserves a later draft for a surviving Image across structural undo and redo", async () => {
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Draft A"));

    await act(async () => clickCreate("text"));
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Draft B"));
    expect(getComposerPrompt().value).toBe("Draft B");

    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(1);
    expect(readDomainNodes()[0]?.kind).toBe("image");
    expect(getComposerPrompt().value).toBe("Draft B");

    await clickHistory("redo");
    expect(readDomainNodes()).toHaveLength(2);
    expect(getComposerPrompt().value).toBe("Draft B");

    await clickHistory("undo");
    expect(getHistoryButton("redo").disabled).toBe(false);
    await act(async () => setTextareaValue(getComposerPrompt(), "Draft C"));
    await act(async () => clickCreate("text"));
    expect(getHistoryButton("redo").disabled).toBe(true);
    await act(async () => selectOnlyNodeIds(["image-target"]));
    expect(getComposerPrompt().value).toBe("Draft C");
  });

  it("restores an edited Image draft when Add Image is undone and redone", async () => {
    await mount({ initialModels: [canvasImageModel] });
    await act(async () => clickCreate("image"));
    const imageId = getMockNode("image").id;
    const model = host?.querySelector<HTMLSelectElement>('[data-creator-image-model="true"]');
    const aspect = host?.querySelector<HTMLSelectElement>('[data-creator-image-aspect="true"]');
    const count = host?.querySelector<HTMLSelectElement>('[data-creator-image-count="true"]');
    const edit = host?.querySelector<HTMLButtonElement>('[data-creator-image-operation="edit"]');
    if (!model || !aspect || !count || !edit) throw new Error("ADD_IMAGE_DRAFT_CONTROLS_MISSING");
    await act(async () => {
      setTextareaValue(getComposerPrompt(), "Resurrect this draft");
      setSelectValue(model, canvasImageModel.slug);
      setSelectValue(aspect, "16:9");
      setSelectValue(count, "4");
      edit.click();
    });
    await settle();

    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(0);
    await clickHistory("redo");
    expect(readDomainNodes().map((node) => node.id)).toEqual([imageId]);
    await act(async () => selectOnlyNodeIds([imageId]));
    await settle();
    expect(getComposerPrompt().value).toBe("Resurrect this draft");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-aspect="true"]')?.value)
      .toBe("16:9");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-count="true"]')?.value)
      .toBe("4");
    expect(host?.querySelector('[data-creator-image-operation="edit"]')
      ?.getAttribute("aria-pressed")).toBe("true");
  });

  it("records connect, reconnect, and edge delete atomically", async () => {
    const initialDocument = {
      version: 1 as const,
      nodes: [
        { id: "edge-source-a", kind: "text" as const, position: { x: 0, y: 0 }, data: { text: "A" } },
        { id: "edge-source-b", kind: "text" as const, position: { x: 0, y: 120 }, data: { text: "B" } },
        { id: "edge-target", kind: "image" as const, position: { x: 400, y: 0 }, data: { assetId: null } }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    await mount({ initialDocument });
    const firstConnection: MockConnection = {
      source: "edge-source-a",
      sourceHandle: "source",
      target: "edge-target",
      targetHandle: "target"
    };
    await act(async () => getReactFlowProps().onConnect(firstConnection));
    const edgeId = readDomainEdges()[0]?.id;
    if (!edgeId) throw new Error("HISTORY_EDGE_MISSING");
    await clickHistory("undo");
    expect(readDomainEdges()).toEqual([]);
    await clickHistory("redo");
    expect(readDomainEdges()).toHaveLength(1);

    await act(async () => getReactFlowProps().onReconnect(
      getReactFlowProps().edges[0]!,
      {
        source: "edge-source-b",
        sourceHandle: "source",
        target: "edge-target",
        targetHandle: "target"
      }
    ));
    expect(readDomainEdges()[0]).toMatchObject({
      id: edgeId,
      source: "edge-source-b",
      target: "edge-target"
    });
    await clickHistory("undo");
    expect(readDomainEdges()[0]).toMatchObject({ id: edgeId, source: "edge-source-a" });
    await clickHistory("redo");

    await act(async () => getReactFlowProps().onEdgesChange([{
      type: "remove",
      id: edgeId
    }]));
    expect(readDomainEdges()).toEqual([]);
    await clickHistory("undo");
    expect(readDomainEdges()[0]).toMatchObject({
      id: edgeId,
      source: "edge-source-b",
      target: "edge-target"
    });
  });

  it("disables history while an Image execution is active and ignores the keyboard shortcut", async () => {
    const pendingPost = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).endsWith("/image/generate")) {
        return pendingPost.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-active-history" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => clickCreate("text"));
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("history fence");
    await waitForCanvas(() => {
      expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
      expect(host?.querySelector('[data-creator-image-node-execution="generating"]'))
        .toBeTruthy();
    });
    expect(getHistoryButton("undo").disabled).toBe(true);
    expect(getHistoryButton("redo").disabled).toBe(true);
    expect(getHistoryButton("undo").title).toContain("Unavailable");

    document.body.focus();
    await pressCanvasShortcut("z", { ctrlKey: true });
    expect(readDomainNodes()).toHaveLength(2);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);

    await act(async () => pendingPost.resolve(jsonResponse({ assets: [] })));
    await settle();
  });

  it("makes successful Result Application undoable locally without another request", async () => {
    const fetchMock = installDirectGenerationResults([["history-result-a", "history-result-b"]]);
    const initialDocument = createImageDocument({ withTextEdge: true });
    await mount({
      initialDocument,
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("result history", "2");
    await waitForCanvas(() => {
      const nodes = readDomainNodes();
      expect(nodes).toHaveLength(3);
      expect(nodes.find((node) => node.id === "image-target")?.data.assetId)
        .toBe("history-result-a");
      expect(nodes.some((node) => node.data.assetId === "history-result-b")).toBe(true);
    });
    const resultEdges = readDomainEdges();
    expect(resultEdges).toHaveLength(1);
    expect(resultEdges[0]).toMatchObject({
      id: "text-edge",
      source: "text-source",
      target: "image-target"
    });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);

    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(2);
    expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
      .toBeNull();
    expect(readDomainEdges()).toEqual(resultEdges);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);

    await clickHistory("redo");
    expect(readDomainNodes()).toHaveLength(3);
    expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
      .toBe("history-result-a");
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("supports Canvas undo and redo shortcuts outside form controls", async () => {
    await mount();
    await act(async () => clickCreate("text"));
    expect(readDomainNodes()).toHaveLength(1);
    document.body.focus();
    await pressCanvasShortcut("z", { ctrlKey: true });
    expect(readDomainNodes()).toHaveLength(0);
    await pressCanvasShortcut("z", { ctrlKey: true, shiftKey: true });
    expect(readDomainNodes()).toHaveLength(1);
    await pressCanvasShortcut("z", { ctrlKey: true });
    expect(readDomainNodes()).toHaveLength(0);
    await pressCanvasShortcut("y", { ctrlKey: true });
    expect(readDomainNodes()).toHaveLength(1);
    expect(getHistoryButton("undo").disabled).toBe(false);
    expect(getHistoryButton("redo").disabled).toBe(true);
  });

  it("copies and pastes a selected graph with fresh IDs, internal edges, selection, history, and cascade placement", async () => {
    const initialDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [
        {
          id: "copy-text",
          kind: "text",
          position: { x: 0, y: 0 },
          data: { text: "Copy text" }
        },
        {
          id: "copy-image",
          kind: "image",
          position: { x: 180, y: 90 },
          data: { assetId: "copy-image-asset" }
        },
        {
          id: "copy-video",
          kind: "video",
          position: { x: 400, y: 210 },
          data: { assetId: "copy-video-asset" }
        },
        {
          id: "outside-image",
          kind: "image",
          position: { x: 650, y: 20 },
          data: { assetId: "outside-image-asset" }
        }
      ],
      edges: [
        {
          id: "copy-edge-text-image",
          sourceNodeId: "copy-text",
          targetNodeId: "copy-image",
          relationship: "reference"
        },
        {
          id: "copy-edge-image-video",
          sourceNodeId: "copy-image",
          targetNodeId: "copy-video",
          relationship: "reference"
        },
        {
          id: "copy-edge-external-inbound",
          sourceNodeId: "outside-image",
          targetNodeId: "copy-video",
          relationship: "reference"
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = installCanvasFetch();
    await mount({ initialDocument });
    await act(async () => selectOnlyNodeIds(["copy-text", "copy-image", "copy-video"]));
    const originalNodeIds = new Set(getReactFlowProps().nodes.map((node) => node.id));
    const originalEdgeIds = new Set(getReactFlowProps().edges.map((edge) => edge.id));
    const statusBeforeCopy = host?.querySelector(
      '[data-creator-canvas-persistence-status="true"]'
    )?.textContent;

    document.body.focus();
    expect(await pressCanvasShortcut("c", { ctrlKey: true })).toBe(true);
    expect(getReactFlowProps().nodes.filter((node) => node.selected).map((node) => node.id))
      .toEqual(["copy-text", "copy-image", "copy-video"]);
    expect(getHistoryButton("undo").disabled).toBe(true);
    expect(host?.querySelector(
      '[data-creator-canvas-persistence-status="true"]'
    )?.textContent).toBe(statusBeforeCopy);

    await pressCanvasShortcut("v", { ctrlKey: true });
    const firstPasteNodes = getReactFlowProps().nodes.filter(
      (node) => !originalNodeIds.has(node.id)
    );
    const firstPasteEdges = getReactFlowProps().edges.filter(
      (edge) => !originalEdgeIds.has(edge.id)
    );
    expect(firstPasteNodes).toHaveLength(3);
    expect(new Set(firstPasteNodes.map((node) => node.id)).size).toBe(3);
    expect(firstPasteEdges).toHaveLength(2);
    expect(firstPasteEdges.every((edge) =>
      firstPasteNodes.some((node) => node.id === edge.source) &&
      firstPasteNodes.some((node) => node.id === edge.target)
    )).toBe(true);
    expect(firstPasteNodes.every((node) => node.selected)).toBe(true);
    expect(getReactFlowProps().edges.every((edge) => !edge.selected)).toBe(true);
    expect(getHistoryButton("undo").disabled).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);

    const firstPastePositions = firstPasteNodes.map((node) => ({
      x: node.position.x,
      y: node.position.y
    }));
    await clickHistory("undo");
    expect(getReactFlowProps().nodes.map((node) => node.id)).toEqual([...originalNodeIds]);
    await clickHistory("redo");
    expect(getReactFlowProps().nodes.filter((node) => !originalNodeIds.has(node.id)))
      .toHaveLength(3);

    await pressCanvasShortcut("v", { ctrlKey: true });
    const secondPasteNodes = getReactFlowProps().nodes.filter(
      (node) => !originalNodeIds.has(node.id) &&
        !firstPasteNodes.some((firstNode) => firstNode.id === node.id)
    );
    expect(secondPasteNodes).toHaveLength(3);
    expect(new Set([
      ...firstPasteNodes.map((node) => node.id),
      ...secondPasteNodes.map((node) => node.id)
    ]).size).toBe(6);
    expect(secondPasteNodes.map((node) => node.position.x - (firstPastePositions[secondPasteNodes.indexOf(node)]?.x ?? 0)))
      .toEqual([32, 32, 32]);
    expect(secondPasteNodes.map((node) => node.position.y - (firstPastePositions[secondPasteNodes.indexOf(node)]?.y ?? 0)))
      .toEqual([32, 32, 32]);
    expect(getReactFlowProps().nodes.filter((node) => node.selected).map((node) => node.id))
      .toEqual(secondPasteNodes.map((node) => node.id));
    expect(getReactFlowProps().edges.every((edge) => !edge.selected)).toBe(true);

    await clickHistory("undo");
    expect(getReactFlowProps().nodes.filter((node) => !originalNodeIds.has(node.id)))
      .toHaveLength(3);
    await clickHistory("undo");
    expect(getReactFlowProps().nodes.map((node) => node.id)).toEqual([...originalNodeIds]);
    await clickHistory("redo");
    expect(getReactFlowProps().nodes.filter((node) => !originalNodeIds.has(node.id)))
      .toHaveLength(3);
    await clickHistory("redo");
    expect(getReactFlowProps().nodes.filter((node) => !originalNodeIds.has(node.id)))
      .toHaveLength(6);
  });

  it("keeps an empty Copy/Paste a no-op when no node is selected", async () => {
    await mount();
    document.body.focus();
    expect(await pressCanvasShortcut("c", { ctrlKey: true })).toBe(true);
    expect(await pressCanvasShortcut("v", { ctrlKey: true })).toBe(true);
    expect(readDomainNodes()).toEqual([]);
    expect(getReactFlowProps().nodes.filter((node) => node.selected)).toEqual([]);
    expect(getHistoryButton("undo").disabled).toBe(true);
  });

  it("supports Meta Copy/Paste on the desktop Editor", async () => {
    await mount();
    await act(async () => clickCreate("text"));
    document.body.focus();
    expect(await pressCanvasShortcut("c", { metaKey: true })).toBe(true);
    expect(await pressCanvasShortcut("v", { metaKey: true })).toBe(true);
    expect(readDomainNodes()).toHaveLength(2);
    expect(getReactFlowProps().nodes.filter((node) => node.selected)).toHaveLength(1);
    expect(getHistoryButton("undo").disabled).toBe(false);
  });

  it("clones Composer drafts through Paste and persists the pasted graph with the existing Save path", async () => {
    const savedDocument = createImageDocument({
      targetAssetId: "copy-paste-source-asset",
      withTextEdge: true
    });
    type SavedCanvasState = {
      document: CreatorCanvasDocumentV1;
      imageComposerDrafts: Record<string, CreatorImageComposerDraft>;
    };
    let savedState: SavedCanvasState | null = null;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/canvas/documents")) {
        const body = JSON.parse(String(init.body)) as {
          state: {
            document: CreatorCanvasDocumentV1;
            imageComposerDrafts: Record<string, CreatorImageComposerDraft>;
          };
        };
        savedState = body.state;
        return jsonResponse({
          document: {
            id: "copy-paste-saved",
            title: null,
            revision: 1,
            state: body.state,
            createdAt: "2026-09-02T10:00:00.000Z",
            updatedAt: "2026-09-02T10:00:00.000Z"
          }
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: savedDocument,
      initialModels: [canvasImageModel]
    }, { authenticated: true });

    await act(async () => selectOnlyNodeIds(["image-target"]));
    await settle();
    const edit = host?.querySelector<HTMLButtonElement>('[data-creator-image-operation="edit"]');
    if (!edit) throw new Error("COPY_PASTE_DRAFT_OPERATION_MISSING");
    await act(async () => edit.click());
    await settle();
    const currentImageChip = host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-source-chip="current-image"]'
    );
    const textSourceChip = host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-source-chip="text"]'
    );
    if (!currentImageChip || !textSourceChip) {
      throw new Error("COPY_PASTE_DRAFT_SOURCE_CONTROLS_MISSING");
    }
    await act(async () => {
      textSourceChip.click();
      currentImageChip.click();
      setTextareaValue(getComposerPrompt(), "Copied Composer draft");
    });
    await settle();

    await act(async () => selectOnlyNodeIds(["text-source", "image-target"]));
    document.body.focus();
    await pressCanvasShortcut("c", { ctrlKey: true });
    expect(getHistoryButton("undo").disabled).toBe(true);
    await pressCanvasShortcut("v", { ctrlKey: true });

    const pastedText = getReactFlowProps().nodes.find(
      (node) => node.id !== "text-source" && node.type === "text"
    );
    const pastedImage = getReactFlowProps().nodes.find(
      (node) => node.id !== "image-target" && node.type === "image"
    );
    if (!pastedText || !pastedImage) throw new Error("COPY_PASTE_NODES_MISSING");
    expect(getHistoryButton("undo").disabled).toBe(false);
    expect(getReactFlowProps().nodes.filter((node) => node.selected).map((node) => node.id))
      .toEqual([pastedText.id, pastedImage.id]);

    await act(async () => selectOnlyNodeIds([pastedImage.id]));
    await settle();
    expect(getComposerPrompt().value).toBe("Copied Composer draft");
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-source-chip="current-image"]'
    )?.getAttribute("data-selected")).toBe("true");
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-source-chip="text"]'
    )?.getAttribute("data-selected")).toBe("true");

    await clickHistory("undo");
    expect(readDomainNodes().map((node) => node.id)).toEqual(["text-source", "image-target"]);
    await clickHistory("redo");
    expect(readDomainNodes()).toHaveLength(4);

    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    if (!save) throw new Error("COPY_PASTE_SAVE_BUTTON_MISSING");
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await waitForCanvas(() => expect(savedState).not.toBeNull());
    const persistedState = savedState as unknown as SavedCanvasState;
    expect(persistedState.document.nodes.map((node) => node.id)).toContain(pastedText.id);
    expect(persistedState.document.nodes.map((node) => node.id)).toContain(pastedImage.id);
    const savedDraft = pastedImage.id
      ? persistedState.imageComposerDrafts[pastedImage.id]
      : undefined;
    expect(savedDraft).toMatchObject({
      prompt: "Copied Composer draft",
      selectedImageReferenceNodeId: pastedImage.id,
      promptSeedSourceNodeId: pastedText.id
    });
    expect(JSON.stringify(savedState)).not.toContain("data:image");
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
  });

  it("leaves native Text and Image Composer clipboard shortcuts untouched", async () => {
    const fetchMock = installCanvasFetch();
    await mount({
      initialDocument: createImageDocument({
        targetAssetId: "native-clipboard-asset",
        withTextEdge: true
      }),
      initialModels: [canvasImageModel]
    });
    await act(async () => selectOnlyNodeIds(["text-source"]));
    const textInput = getTextInputForNode("text-source");
    const initialNodeCount = readDomainNodes().length;

    await act(async () => textInput.focus());
    expect(await pressCanvasShortcut("c", { ctrlKey: true })).toBe(false);
    expect(await pressCanvasShortcut("v", { ctrlKey: true })).toBe(false);
    expect(readDomainNodes()).toHaveLength(initialNodeCount);
    await act(async () => textInput.blur());

    await act(async () => selectOnlyNodeIds(["text-source"]));
    document.body.focus();
    await pressCanvasShortcut("c", { ctrlKey: true });
    const selectedTextInput = getTextInputForNode("text-source");
    await act(async () => selectedTextInput.focus());
    expect(await pressCanvasShortcut("v", { ctrlKey: true })).toBe(false);
    expect(readDomainNodes()).toHaveLength(initialNodeCount);
    await act(async () => selectedTextInput.blur());

    await act(async () => selectOnlyNodeIds(["image-target"]));
    await settle();
    const prompt = getComposerPrompt();
    await act(async () => prompt.focus());
    expect(await pressCanvasShortcut("c", { ctrlKey: true })).toBe(false);
    expect(await pressCanvasShortcut("v", { ctrlKey: true })).toBe(false);
    expect(readDomainNodes()).toHaveLength(initialNodeCount);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });

  it("blocks Paste during an active synthetic Image execution without aborting it", async () => {
    const pendingPost = createDeferred<Response>();
    let generationSignal: AbortSignal | undefined;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).endsWith("/image/generate")) {
        generationSignal = init.signal ?? undefined;
        return pendingPost.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    document.body.focus();
    await pressCanvasShortcut("c", { ctrlKey: true });
    await executeSelectedImageGeneration("Paste must wait");
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(1));
    const nodesBeforePaste = readDomainNodes();

    await pressCanvasShortcut("v", { ctrlKey: true });
    expect(readDomainNodes()).toEqual(nodesBeforePaste);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
    expect(generationSignal?.aborted).toBe(false);

    await act(async () => pendingPost.resolve(jsonResponse({ assets: [] })));
    await settle();
  });

  it("clears the graph clipboard when New resets the Canvas and when another saved Canvas opens", async () => {
    const currentDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "temporary-copy-text",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "Temporary copy" }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const openedDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "opened-copy-text",
        kind: "text",
        position: { x: 300, y: 100 },
        data: { text: "Opened Canvas" }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({ documents: [{
          id: "opened-copy-canvas",
          title: "Opened Copy Canvas",
          revision: 1,
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-02T10:00:00.000Z"
        }] });
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents/opened-copy-canvas")) {
        return persistedCanvasDocumentResponse(
          "opened-copy-canvas",
          1,
          openedDocument,
          new Map(),
          "Opened Copy Canvas"
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount({
      initialDocument: currentDocument,
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["temporary-copy-text"]));
    document.body.focus();
    await pressCanvasShortcut("c", { ctrlKey: true });

    const newCanvas = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="new"]'
    );
    if (!newCanvas) throw new Error("COPY_PASTE_NEW_BUTTON_MISSING");
    await act(async () => newCanvas.click());
    expect(readDomainNodes()).toEqual([]);
    await pressCanvasShortcut("v", { ctrlKey: true });
    expect(readDomainNodes()).toEqual([]);

    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!open) throw new Error("COPY_PASTE_OPEN_BUTTON_MISSING");
    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-list="true"]'
    )).toBeTruthy());
    const openSaved = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-open="true"]'
    );
    if (!openSaved) throw new Error("COPY_PASTE_SAVED_OPEN_MISSING");
    await act(async () => openSaved.click());
    await waitForCanvas(() => expect(readDomainNodes()[0]?.id).toBe("opened-copy-text"));
    await pressCanvasShortcut("v", { ctrlKey: true });
    expect(readDomainNodes().map((node) => node.id)).toEqual(["opened-copy-text"]);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });

  it("clears the graph clipboard across authenticated identity changes and logout", async () => {
    const initialDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "identity-copy-text",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "Private copy" }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = installCanvasRuntimeFetch(async () =>
      new Response("not found", { status: 404 })
    );
    await mount({ initialDocument }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["identity-copy-text"]));
    document.body.focus();
    await pressCanvasShortcut("c", { ctrlKey: true });
    if (!setAuthSessionForTest || !logoutForTest) {
      throw new Error("COPY_PASTE_AUTH_PROBES_MISSING");
    }

    await act(async () => setAuthSessionForTest?.({
      token: "copy-user-b-token",
      user: {
        id: "copy-user-b",
        email: "copy-user-b@example.test",
        role: "USER",
        credits: 20,
        name: "Copy User B"
      }
    }));
    await settle();
    await pressCanvasShortcut("v", { ctrlKey: true });
    expect(readDomainNodes().map((node) => node.id)).toEqual(["identity-copy-text"]);

    await act(async () => selectOnlyNodeIds(["identity-copy-text"]));
    await pressCanvasShortcut("c", { ctrlKey: true });
    await act(async () => logoutForTest?.());
    await settle();
    await pressCanvasShortcut("v", { ctrlKey: true });
    expect(readDomainNodes().map((node) => node.id)).toEqual(["identity-copy-text"]);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
  });

  it("does not leak the graph clipboard from an unmounted Editor into a remounted Editor", async () => {
    const initialDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "unmount-copy-text",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "Unmounted copy" }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    await mount({ initialDocument });
    await act(async () => selectOnlyNodeIds(["unmount-copy-text"]));
    document.body.focus();
    await pressCanvasShortcut("c", { ctrlKey: true });
    await act(async () => root?.unmount());
    host?.remove();
    latestReactFlowProps = null;

    await mount();
    await pressCanvasShortcut("v", { ctrlKey: true });
    expect(readDomainNodes()).toEqual([]);
  });

  it("opens Image Workspace only for one selected Image node", async () => {
    await mount();
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();

    await act(async () => clickCreate("image"));
    const image = getMockNode("image");
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-image-workspace="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-image-node-toolbar="true"]')).toBeNull();
    expect(host?.querySelector('[data-mock-node-toolbar="true"]')).toBeNull();

    await act(async () => clickCreate("text"));
    const text = getMockNode("text");
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();

    await act(async () => clickCreate("video"));
    const video = getMockNode("video");
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();

    await act(async () => selectOnlyNodeIds([]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();

    await act(async () => selectOnlyNodeIds([image.id]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-image-workspace="true"]')).toBeTruthy();

    await act(async () => selectOnlyNodeIds([image.id, text.id]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();

    await act(async () => selectOnlyNodeIds([video.id]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();

    await act(async () => {
      getReactFlowProps().onConnect({
        source: text.id,
        sourceHandle: "source",
        target: image.id,
        targetHandle: "target"
      });
    });
    const edgeId = getReactFlowProps().edges[0]?.id;
    if (!edgeId) throw new Error("EDGE_ONLY_SELECTION_FIXTURE_MISSING");
    await act(async () => {
      selectOnlyNodeIds([]);
      getReactFlowProps().onEdgesChange([
        { type: "select", id: edgeId, selected: true }
      ]);
    });
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();
  });

  it("opens the picker from an EMPTY Image and binds an existing private work to the same node", async () => {
    const selectedAsset = createExistingImageAsset();
    const videoAsset = {
      ...selectedAsset,
      id: "asset-video",
      type: "video" as const,
      url: "/assets/asset-video/content",
      title: "Video work"
    };
    const unsafeAsset = {
      ...selectedAsset,
      id: "asset-unsafe",
      url: "https://provider.example/unsafe.png",
      title: "Unsafe work"
    };
    const fetchMock = installCanvasRuntimeFetch(async (input) => {
      const url = String(input);
      if (url.endsWith("/assets?type=image&limit=50")) {
        return jsonResponse({ assets: [selectedAsset, videoAsset, unsafeAsset] });
      }
      if (url.endsWith(`/assets/${selectedAsset.id}`)) {
        return jsonResponse({ asset: selectedAsset, task: null });
      }
      if (url.endsWith(selectedAsset.url)) {
        return new Response("existing-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response("not found", { status: 404 });
    });
    const initialDocument = createImageDocument({ withTextEdge: true });
    await mount({
      initialDocument,
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));

    const beforeNodes = readDomainNodes();
    const beforeEdges = readDomainEdges();
    const beforeViewport = host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport");
    const choose = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="choose"]'
    );
    if (!choose) throw new Error("CREATOR_CANVAS_ASSET_PICKER_ACTION_MISSING");
    expect(choose.disabled).toBe(false);

    await act(async () => choose.click());
    await waitForCanvas(() => {
      expect(host?.querySelector<HTMLDialogElement>(
        '[data-creator-canvas-asset-picker="true"]'
      )?.open).toBe(true);
      expect(getCanvasAssetListCalls(fetchMock)).toHaveLength(1);
      expect(host?.querySelector('[data-creator-canvas-asset-picker-state="ready"]'))
        .toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/assets?type=image&limit=50"),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer canvas-owner-token" }
      })
    );
    expect(host?.querySelectorAll('[data-creator-canvas-asset-item="true"]')).toHaveLength(1);
    expect(host?.textContent).toContain("Existing owner work");
    expect(host?.textContent).not.toContain("Video work");
    expect(host?.textContent).not.toContain("Unsafe work");

    const select = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-select="true"]'
    );
    if (!select) throw new Error("CREATOR_CANVAS_ASSET_SELECT_MISSING");
    await act(async () => select.click());
    await waitForCanvas(() => {
      expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
        .toBe(selectedAsset.id);
      expect(host?.querySelector('[data-creator-canvas-image-preview="ready"]'))
        .toBeTruthy();
      expect(host?.querySelector('[data-creator-image-workspace-preview-state="ready"]'))
        .toBeTruthy();
    });

    const afterNodes = readDomainNodes();
    expect(afterNodes).toHaveLength(beforeNodes.length);
    expect(afterNodes.find((node) => node.id === "image-target")?.position)
      .toEqual(beforeNodes.find((node) => node.id === "image-target")?.position);
    expect(afterNodes.map((node) => node.id)).toEqual(beforeNodes.map((node) => node.id));
    expect(readDomainEdges()).toEqual(beforeEdges);
    expect(host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport")).toBe(beforeViewport);
    expect(getMockNode("image").selected).toBe(true);
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeTruthy();

    const edit = host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-operation="edit"]'
    );
    if (!edit) throw new Error("CREATOR_CANVAS_EDIT_OPERATION_MISSING");
    await act(async () => edit.click());
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-source-chip="current-image"]'
    )?.disabled).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith(`/assets/${selectedAsset.id}/content`)
    )).toBe(true);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([, init]) =>
      init?.method === "PUT" || init?.method === "PATCH" || init?.method === "DELETE"
    )).toBe(false);
  });

  it("replaces a bound Image with another owner work on the same node and keeps its draft", async () => {
    const assetA = createExistingImageAsset("asset-a", "Asset A");
    const assetB = createExistingImageAsset("asset-b", "Asset B");
    const videoAsset = {
      ...assetA,
      id: "asset-video-replace",
      type: "video" as const,
      url: "/assets/asset-video-replace/content",
      title: "Video replacement fixture"
    };
    const unsafeAsset = {
      ...assetA,
      id: "asset-unsafe-replace",
      url: "https://provider.example/unsafe-replace.png",
      title: "Unsafe replacement fixture"
    };
    const fetchMock = installCanvasRuntimeFetch(async (input) => {
      const url = String(input);
      if (url.endsWith("/assets?type=image&limit=50")) {
        return jsonResponse({ assets: [assetA, assetB, videoAsset, unsafeAsset] });
      }
      for (const asset of [assetA, assetB]) {
        if (url.endsWith(`/assets/${asset.id}`)) {
          return jsonResponse({ asset, task: null });
        }
        if (url.endsWith(asset.url)) {
          return new Response(`${asset.id}-image`, {
            status: 200,
            headers: { "content-type": "image/png" }
          });
        }
      }
      return new Response("not found", { status: 404 });
    });
    const initialDocument = createImageDocument({ withTextEdge: true });
    await mount({
      initialDocument,
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));

    const choose = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="choose"]'
    );
    if (!choose) throw new Error("CREATOR_CANVAS_ASSET_PICKER_CHOOSE_MISSING");
    await act(async () => choose.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-asset-picker-state="ready"]'
    )).toBeTruthy());
    const bindSelect = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-select="true"]'
    );
    if (!bindSelect) throw new Error("CREATOR_CANVAS_ASSET_BIND_SELECT_MISSING");
    await act(async () => bindSelect.click());
    await waitForCanvas(() => {
      expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
        .toBe(assetA.id);
      expect(host?.querySelector('[data-creator-canvas-image-preview="ready"]'))
        .toBeTruthy();
    });

    const beforeNodes = readDomainNodes();
    const beforeEdges = readDomainEdges();
    const beforeViewport = host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport");
    const beforeModel = host?.querySelector<HTMLSelectElement>(
      '[data-creator-image-model="true"]'
    );
    const beforeAspect = host?.querySelector<HTMLSelectElement>(
      '[data-creator-image-aspect="true"]'
    );
    const beforeCount = host?.querySelector<HTMLSelectElement>(
      '[data-creator-image-count="true"]'
    );
    if (!beforeModel || !beforeAspect || !beforeCount) {
      throw new Error("CREATOR_CANVAS_COMPOSER_FIELDS_MISSING");
    }
    await act(async () => {
      setTextareaValue(getComposerPrompt(), "Keep this replacement draft");
      setSelectValue(beforeModel, canvasImageModel.slug);
      setSelectValue(beforeAspect, "16:9");
      setSelectValue(beforeCount, "2");
      const edit = host?.querySelector<HTMLButtonElement>(
        '[data-creator-image-operation="edit"]'
      );
      if (!edit) throw new Error("CREATOR_CANVAS_EDIT_OPERATION_MISSING");
      edit.click();
    });
    expect(getComposerPrompt().value).toBe("Keep this replacement draft");
    expect(beforeModel.value).toBe(canvasImageModel.slug);
    expect(beforeAspect.value).toBe("16:9");
    expect(beforeCount.value).toBe("2");
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-source-chip="current-image"]'
    )?.getAttribute("data-selected")).toBe("true");

    const replace = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="replace"]'
    );
    if (!replace) throw new Error("CREATOR_CANVAS_ASSET_REPLACE_MISSING");
    expect(replace.disabled).toBe(false);
    await act(async () => replace.click());
    await waitForCanvas(() => {
      expect(getCanvasAssetListCalls(fetchMock)).toHaveLength(2);
      expect(host?.querySelector('[data-creator-canvas-asset-picker-state="ready"]'))
        .toBeTruthy();
    });
    expect(host?.querySelectorAll('[data-creator-canvas-asset-item="true"]')).toHaveLength(1);
    expect(host?.textContent).not.toContain("Asset A");
    expect(host?.textContent).toContain("Asset B");
    expect(host?.textContent).not.toContain("Video replacement fixture");
    expect(host?.textContent).not.toContain("Unsafe replacement fixture");

    const replacementSelect = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-select="true"]'
    );
    if (!replacementSelect) throw new Error("CREATOR_CANVAS_ASSET_REPLACEMENT_SELECT_MISSING");
    await act(async () => replacementSelect.click());
    await waitForCanvas(() => {
      expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
        .toBe(assetB.id);
      expect(host?.querySelector('[data-creator-canvas-image-preview="ready"]'))
        .toBeTruthy();
    });

    const afterNodes = readDomainNodes();
    expect(afterNodes).toHaveLength(beforeNodes.length);
    expect(afterNodes.map((node) => node.id)).toEqual(beforeNodes.map((node) => node.id));
    expect(afterNodes.find((node) => node.id === "image-target")?.position)
      .toEqual(beforeNodes.find((node) => node.id === "image-target")?.position);
    expect(readDomainEdges()).toEqual(beforeEdges);
    expect(host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport")).toBe(beforeViewport);
    expect(getMockNode("image").selected).toBe(true);
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeTruthy();
    expect(getComposerPrompt().value).toBe("Keep this replacement draft");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-model="true"]')?.value)
      .toBe(canvasImageModel.slug);
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-aspect="true"]')?.value)
      .toBe("16:9");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-count="true"]')?.value)
      .toBe("2");
    expect(host?.querySelector('[data-creator-image-operation="edit"]')
      ?.getAttribute("aria-pressed")).toBe("true");
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-source-chip="current-image"]'
    )?.getAttribute("data-selected")).toBe("true");
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-source-chip="current-image"]'
    )?.disabled).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith(`/assets/${assetB.id}/content`)
    )).toBe(true);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([, init]) =>
      init?.method === "PUT" || init?.method === "PATCH" || init?.method === "DELETE"
    )).toBe(false);
  });

  it("keeps the selected Image Workspace on one shared draft across Focus and selection fences", async () => {
    const fetchMock = installCanvasRuntimeFetch(async () =>
      new Response("not found", { status: 404 }),
    [canvasImageModel]);
    await mount({
      initialDocument: createImageDocument({ withTextEdge: true }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);

    await act(async () => selectOnlyNodeIds(["image-target"]));
    const workspace = () => host?.querySelector<HTMLElement>(
      '[data-creator-node-workspace="true"]'
    );
    const imageWorkspace = () => document.body.querySelector<HTMLElement>(
      '[data-creator-image-workspace="true"]'
    );
    expect(workspace()).toBeTruthy();
    expect(imageWorkspace()?.dataset.creatorImageWorkspaceMode).toBe("workspace");
    expect(host?.querySelector('[data-creator-image-node-toolbar="true"]')).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);

    await act(async () => setTextareaValue(getComposerPrompt(), "Shared Image draft"));
    await settle();
    const expand = host?.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-expand="true"]'
    );
    if (!expand) throw new Error("CREATOR_IMAGE_WORKSPACE_EXPAND_MISSING");
    await act(async () => expand.click());
    const focusWorkspace = document.body.querySelector<HTMLElement>(
      '[data-creator-image-workspace="true"]'
    );
    expect(focusWorkspace?.dataset.creatorImageWorkspaceMode).toBe("focus");
    expect(document.body.querySelector<HTMLTextAreaElement>(
      '[data-creator-image-prompt="true"]'
    )?.value).toBe("Shared Image draft");
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);

    const closeFocus = document.body.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-focus-close="true"]'
    );
    if (!closeFocus) throw new Error("CREATOR_IMAGE_FOCUS_CLOSE_MISSING");
    await act(async () => closeFocus.click());
    expect(imageWorkspace()?.dataset.creatorImageWorkspaceMode).toBe("workspace");
    expect(getComposerPrompt().value).toBe("Shared Image draft");

    await act(async () => selectOnlyNodeIds(["text-source", "image-target"]));
    expect(imageWorkspace()).toBeNull();
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => getReactFlowProps().onEdgesChange([{
      type: "select",
      id: "text-edge",
      selected: true
    }]));
    expect(imageWorkspace()).toBeNull();
    await act(async () => getReactFlowProps().onEdgesChange([{
      type: "select",
      id: "text-edge",
      selected: false
    }]));
    expect(imageWorkspace()).toBeTruthy();

    await act(async () => selectOnlyNodeIds(["text-source"]));
    expect(imageWorkspace()).toBeNull();
    expect(host?.querySelector('[data-creator-text-workspace="true"]')).toBeTruthy();

    await act(async () => clickCreate("video"));
    expect(imageWorkspace()).toBeNull();

    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: "image-target"
    }]));
    await settle();
    expect(imageWorkspace()).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });

  it("opens one shared Video Workspace, keeps Focus side-effect free, and closes on selection fences", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input) => {
      if (String(input).includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await waitForCanvas(() => expect(getVideoModelDiscoveryCalls(fetchMock)).toHaveLength(1));

    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoPrompt().value).toBe("cinematic product reveal"));
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-video-composer-presentation="workspace"]'))
      .toBeTruthy();
    expect(host?.querySelector('[data-creator-video-node-toolbar="true"]')).toBeNull();
    expect(host?.querySelector('[data-mock-node-toolbar="true"]')).toBeNull();
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/tasks?type=video")))
      .toBe(false);

    await act(async () => setTextareaValue(getVideoPrompt(), "Shared Video draft"));
    await settle();
    const expand = host?.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-expand="true"]'
    );
    if (!expand) throw new Error("CREATOR_VIDEO_WORKSPACE_EXPAND_MISSING");
    await act(async () => expand.click());
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeNull();
    expect(document.body.querySelector('[data-creator-video-workspace-mode="focus"]'))
      .toBeTruthy();
    expect(document.body.querySelector<HTMLTextAreaElement>(
      '[data-creator-video-prompt="true"]'
    )?.value).toBe("Shared Video draft");
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(0);

    const closeFocus = document.body.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-focus-close="true"]'
    );
    if (!closeFocus) throw new Error("CREATOR_VIDEO_FOCUS_CLOSE_MISSING");
    await act(async () => closeFocus.click());
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeTruthy();
    expect(getVideoPrompt().value).toBe("Shared Video draft");

    await act(async () => selectOnlyNodeIds([]));
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeNull();
    await act(async () => selectOnlyNodeIds(["video-target", "video-text-source"]));
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeNull();
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await act(async () => getReactFlowProps().onEdgesChange([{
      type: "select",
      id: "video-text-edge",
      selected: true
    }]));
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeNull();
    await act(async () => getReactFlowProps().onEdgesChange([{
      type: "select",
      id: "video-text-edge",
      selected: false
    }]));
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeTruthy();

    await act(async () => selectOnlyNodeIds(["video-text-source"]));
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeNull();
    expect(host?.querySelector('[data-creator-text-workspace="true"]')).toBeTruthy();

    await act(async () => selectOnlyNodeIds(["video-target"]));
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: "video-target"
    }]));
    await settle();
    expect(host?.querySelector('[data-creator-video-workspace="true"]')).toBeNull();
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(0);
  });

  it("closes the picker without selection and leaves the Canvas document unchanged", async () => {
    const existingAsset = createExistingImageAsset("asset-close");
    const fetchMock = installCanvasRuntimeFetch(async (input) => {
      const url = String(input);
      if (url.endsWith("/assets?type=image&limit=50")) {
        return jsonResponse({ assets: [existingAsset] });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });
    await act(async () => clickCreate("image"));
    const beforeNodes = readDomainNodes();
    const beforeEdges = readDomainEdges();
    const beforeViewport = host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport");
    const choose = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="choose"]'
    );
    if (!choose) throw new Error("CREATOR_CANVAS_ASSET_PICKER_ACTION_MISSING");
    await act(async () => choose.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-asset-picker-state="ready"]'
    )).toBeTruthy());

    const close = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-close="true"]'
    );
    if (!close) throw new Error("CREATOR_CANVAS_ASSET_PICKER_CLOSE_MISSING");
    await act(async () => close.click());
    await waitForCanvas(() => expect(host?.querySelector<HTMLDialogElement>(
      '[data-creator-canvas-asset-picker="true"]'
    )?.open).toBe(false));
    expect(readDomainNodes()).toEqual(beforeNodes);
    expect(readDomainEdges()).toEqual(beforeEdges);
    expect(host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport")).toBe(beforeViewport);
    expect(getCanvasAssetListCalls(fetchMock)).toHaveLength(1);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
  });

  it("does not recreate a target deleted while the picker is open", async () => {
    const pendingList = createDeferred<Response>();
    const selectedAsset = createExistingImageAsset("asset-stale-delete");
    const fetchMock = installCanvasRuntimeFetch(async (input) => {
      if (String(input).endsWith("/assets?type=image&limit=50")) {
        return pendingList.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });
    await act(async () => clickCreate("image"));
    const targetId = getMockNode("image").id;
    const choose = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="choose"]'
    );
    if (!choose) throw new Error("CREATOR_CANVAS_ASSET_PICKER_ACTION_MISSING");
    await act(async () => choose.click());
    await waitForCanvas(() => expect(getCanvasAssetListCalls(fetchMock)).toHaveLength(1));
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: targetId
    }]));
    await act(async () => pendingList.resolve(jsonResponse({ assets: [selectedAsset] })));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-asset-picker-state="ready"]'
    )).toBeTruthy());
    const select = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-select="true"]'
    );
    if (!select) throw new Error("CREATOR_CANVAS_ASSET_SELECT_MISSING");
    await act(async () => select.click());
    await settle();

    expect(readDomainNodes()).toEqual([]);
    expect(host?.querySelector<HTMLDialogElement>(
      '[data-creator-canvas-asset-picker="true"]'
    )?.open).toBe(false);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
  });

  it("does not overwrite a target bound by another Canvas action while the picker is open", async () => {
    const selectedAsset = createExistingImageAsset("asset-stale-selection");
    const generatedAsset = createGenerationAsset("asset-bound-while-open");
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/assets?type=image&limit=50")) {
        return jsonResponse({ assets: [selectedAsset] });
      }
      if (init?.method === "POST" && url.endsWith("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({ task, assets: [generatedAsset] });
      }
      if (url.endsWith(`/assets/${generatedAsset.id}`)) {
        return jsonResponse({ asset: generatedAsset, task: null });
      }
      if (url.endsWith(`/assets/${generatedAsset.id}/content`)) {
        return new Response("generated-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (url.endsWith(selectedAsset.url)) {
        return new Response("selected-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => clickCreate("image"));
    await act(async () => setTextareaValue(getComposerPrompt(), "Bind this before stale select"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    const choose = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="choose"]'
    );
    if (!choose) throw new Error("CREATOR_CANVAS_ASSET_PICKER_ACTION_MISSING");
    await act(async () => choose.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-asset-picker-state="ready"]'
    )).toBeTruthy());

    await act(async () => getExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes()[0]?.data.assetId)
      .toBe(generatedAsset.id));
    const select = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-select="true"]'
    );
    if (!select) throw new Error("CREATOR_CANVAS_ASSET_SELECT_MISSING");
    await act(async () => select.click());
    await settle();

    expect(readDomainNodes()[0]?.data.assetId).toBe(generatedAsset.id);
    expect(readDomainNodes()).toHaveLength(1);
    expect(host?.querySelector<HTMLDialogElement>(
      '[data-creator-canvas-asset-picker="true"]'
    )?.open).toBe(false);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("does not recreate a BOUND target deleted while Replace is open", async () => {
    const pendingList = createDeferred<Response>();
    const assetA = createExistingImageAsset("asset-replace-delete-a", "Asset A");
    const assetB = createExistingImageAsset("asset-replace-delete-b", "Asset B");
    const fetchMock = installCanvasRuntimeFetch(async (input) => {
      const url = String(input);
      if (url.endsWith("/assets?type=image&limit=50")) return pendingList.promise;
      if (url.endsWith(`/assets/${assetA.id}`)) {
        return jsonResponse({ asset: assetA, task: null });
      }
      if (url.endsWith(assetA.url)) {
        return new Response("asset-a-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: assetA.id }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    const replace = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="replace"]'
    );
    if (!replace) throw new Error("CREATOR_CANVAS_ASSET_REPLACE_MISSING");
    await act(async () => replace.click());
    await waitForCanvas(() => expect(getCanvasAssetListCalls(fetchMock)).toHaveLength(1));
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: "image-target"
    }]));
    await act(async () => pendingList.resolve(jsonResponse({ assets: [assetB] })));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-asset-picker-state="ready"]'
    )).toBeTruthy());
    const select = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-select="true"]'
    );
    if (!select) throw new Error("CREATOR_CANVAS_ASSET_REPLACEMENT_SELECT_MISSING");
    await act(async () => select.click());
    await settle();

    expect(readDomainNodes()).toEqual([]);
    expect(host?.querySelector<HTMLDialogElement>(
      '[data-creator-canvas-asset-picker="true"]'
    )?.open).toBe(false);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps Replace disabled during active Image execution and makes no picker request", async () => {
    const pendingPost = createDeferred<Response>();
    const assetA = createExistingImageAsset("asset-active-replace", "Active Asset");
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/image/generate")) {
        return pendingPost.promise;
      }
      if (url.endsWith(`/assets/${assetA.id}`)) {
        return jsonResponse({ asset: assetA, task: null });
      }
      if (url.endsWith(assetA.url)) {
        return new Response("active-asset-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: assetA.id }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Do not replace while running");
    await waitForCanvas(() => {
      expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
      expect(host?.querySelector('[data-creator-image-node-execution="generating"]'))
        .toBeTruthy();
    });

    const replace = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-action="replace"]'
    );
    if (!replace) throw new Error("CREATOR_CANVAS_ASSET_REPLACE_MISSING");
    expect(replace.disabled).toBe(true);
    expect(host?.querySelector('[data-creator-canvas-asset-picker="true"]')?.getAttribute("open"))
      .toBeNull();
    expect(getCanvasAssetListCalls(fetchMock)).toHaveLength(0);

    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: "image-target"
    }]));
    await act(async () => pendingPost.resolve(jsonResponse({ assets: [] })));
    await settle();
  });

  it("preserves separate per-Image-node drafts across deselection and reselection", async () => {
    const secondModel = {
      ...canvasImageModel,
      id: "canvas-model-second",
      displayName: "Canvas Image Ultra",
      slug: "canvas-image-ultra",
      creditCost: 5,
      sortOrder: 1
    };
    installCanvasFetch([canvasImageModel, secondModel]);
    await mount();

    await act(async () => clickCreate("image"));
    const firstImage = getMockNode("image", 0);
    const firstPrompt = host?.querySelector<HTMLTextAreaElement>(
      '[data-creator-image-prompt="true"]'
    );
    if (!firstPrompt) throw new Error("FIRST_IMAGE_PROMPT_MISSING");
    await act(async () => setTextareaValue(firstPrompt, "First image draft"));

    const firstModel = host?.querySelector<HTMLSelectElement>(
      '[data-creator-image-model="true"]'
    );
    const firstAspect = host?.querySelector<HTMLSelectElement>(
      '[data-creator-image-aspect="true"]'
    );
    const firstCount = host?.querySelector<HTMLSelectElement>(
      '[data-creator-image-count="true"]'
    );
    if (!firstModel || !firstAspect || !firstCount) {
      throw new Error("FIRST_IMAGE_CONTROLS_MISSING");
    }
    expect(firstModel.value).toBe("canvas-image-pro");
    expect(firstAspect.value).toBe("auto");
    expect(firstCount.value).toBe("1");
    await act(async () => {
      setSelectValue(firstModel, "canvas-image-ultra");
      setSelectValue(firstAspect, "16:9");
      setSelectValue(firstCount, "4");
    });
    expect(host?.querySelector('[data-creator-image-estimated-cost="20"]')).toBeTruthy();

    await act(async () => clickCreate("image"));
    const secondImage = getMockNode("image", 1);
    const secondPrompt = host?.querySelector<HTMLTextAreaElement>(
      '[data-creator-image-prompt="true"]'
    );
    if (!secondPrompt) throw new Error("SECOND_IMAGE_PROMPT_MISSING");
    expect(secondPrompt.value).toBe("");
    await act(async () => setTextareaValue(secondPrompt, "Second image draft"));

    await act(async () => selectOnlyNodeIds([]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();
    await act(async () => selectOnlyNodeIds([firstImage.id]));
    expect(host?.querySelector<HTMLTextAreaElement>('[data-creator-image-prompt="true"]')?.value)
      .toBe("First image draft");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-model="true"]')?.value)
      .toBe("canvas-image-ultra");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-aspect="true"]')?.value)
      .toBe("16:9");
    expect(host?.querySelector<HTMLSelectElement>('[data-creator-image-count="true"]')?.value)
      .toBe("4");

    await act(async () => selectOnlyNodeIds([secondImage.id]));
    expect(host?.querySelector<HTMLTextAreaElement>('[data-creator-image-prompt="true"]')?.value)
      .toBe("Second image draft");
  });

  it("shows the 4000-character validation without silently truncating the prompt", async () => {
    await mount();
    await act(async () => clickCreate("image"));
    const prompt = host?.querySelector<HTMLTextAreaElement>(
      '[data-creator-image-prompt="true"]'
    );
    if (!prompt) throw new Error("IMAGE_PROMPT_VALIDATION_FIXTURE_MISSING");
    await act(async () => setTextareaValue(prompt, "x".repeat(4001)));
    expect(prompt.value).toHaveLength(4001);
    expect(prompt.getAttribute("aria-invalid")).toBe("true");
    expect(host?.querySelector('[data-creator-image-prompt-validation="too-long"]')?.textContent)
      .toContain("4001/4000");
  });

  it("renders context-driven source chips and enforces one executable Edit image", async () => {
    const initialDocument = {
      version: 1 as const,
      nodes: [
        { id: "text-source", kind: "text" as const, position: { x: 0, y: 0 }, data: { text: "A seeded dawn" } },
        { id: "image-bound", kind: "image" as const, position: { x: 0, y: 160 }, data: { assetId: "asset-bound" } },
        { id: "image-empty", kind: "image" as const, position: { x: 0, y: 320 }, data: { assetId: null } },
        { id: "image-target", kind: "image" as const, position: { x: 400, y: 0 }, data: { assetId: "asset-current" } }
      ],
      edges: [
        { id: "edge-text", sourceNodeId: "text-source", targetNodeId: "image-target", relationship: "reference" as const },
        { id: "edge-bound", sourceNodeId: "image-bound", targetNodeId: "image-target", relationship: "reference" as const },
        { id: "edge-empty", sourceNodeId: "image-empty", targetNodeId: "image-target", relationship: "reference" as const }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    await mount({ initialDocument });
    await act(async () => selectOnlyNodeIds(["image-target"]));

    expect(host?.querySelector<HTMLTextAreaElement>('[data-creator-image-prompt="true"]')?.value)
      .toBe("A seeded dawn");
    expect(host?.querySelectorAll('[data-creator-image-source-chip="text"]')).toHaveLength(1);
    expect(host?.querySelectorAll('[data-creator-image-source-chip="incoming-image"]')).toHaveLength(2);
    const incomingImageChips = host?.querySelectorAll<HTMLButtonElement>(
      '[data-creator-image-source-chip="incoming-image"]'
    );
    expect(incomingImageChips?.[0]?.disabled).toBe(true);
    expect(incomingImageChips?.[1]?.disabled).toBe(true);

    const editButton = host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-operation="edit"]'
    );
    if (!editButton) throw new Error("EDIT_OPERATION_MISSING");
    await act(async () => editButton.click());
    const editImageChips = host?.querySelectorAll<HTMLButtonElement>(
      '[data-creator-image-source-chip="incoming-image"]'
    );
    expect(editImageChips?.[0]?.disabled).toBe(false);
    expect(editImageChips?.[1]?.disabled).toBe(true);
    expect(host?.querySelector('[data-creator-image-edit-validation="choose-one"]')).toBeTruthy();
    expect(host?.querySelectorAll('[data-creator-image-source-chip][data-selected="true"]'))
      .toHaveLength(1);
    expect(host?.querySelector('[data-creator-image-source-chip="text"][data-selected="true"]'))
      .toBeTruthy();

    const boundIncoming = host?.querySelectorAll<HTMLButtonElement>(
      '[data-creator-image-source-chip="incoming-image"]'
    )[0];
    if (!boundIncoming) throw new Error("BOUND_INCOMING_IMAGE_MISSING");
    await act(async () => boundIncoming.click());
    expect(host?.querySelector('[data-creator-image-edit-validation="valid"]')).toBeTruthy();
    expect(host?.querySelectorAll(
      '[data-creator-image-source-chip="incoming-image"][data-selected="true"], [data-creator-image-source-chip="current-image"][data-selected="true"]'
    )).toHaveLength(1);

    const composerText = host?.querySelector('[data-creator-image-composer="true"]')?.textContent ?? "";
    expect(composerText).not.toContain("asset-bound");
    expect(composerText).not.toContain("asset-current");
    expect(composerText).not.toContain("edge-bound");
    expect(host?.querySelector('button[data-creator-image-generate]')).toBeNull();
  });

  it("opens a pane double-click menu and creates the selected kind at the converted flow position", async () => {
    await mount();
    const pane = host?.querySelector<HTMLElement>(".react-flow__pane");
    if (!pane) throw new Error("REACT_FLOW_PANE_MISSING");

    await act(async () => {
      pane.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300
      }));
    });

    expect(host?.querySelector('[data-creator-canvas-create-menu="true"]')).toBeTruthy();
    expect(host?.querySelectorAll("[data-menu-create-creator-node-kind]")).toHaveLength(3);
    expect(Array.from(
      host?.querySelectorAll("[data-menu-create-creator-node-kind]") ?? [],
      (element) => element.querySelector("span span")?.textContent?.trim()
    )).toEqual(["Text", "Image", "Video"]);

    const createImage = host?.querySelector<HTMLButtonElement>(
      '[data-menu-create-creator-node-kind="image"]'
    );
    if (!createImage) throw new Error("REFERENCE_MENU_ITEM_MISSING");
    await act(async () => createImage.click());

    const positions = JSON.parse(
      host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-node-positions") ?? "[]"
    ) as Array<{ kind: string; position: { x: number; y: number } }>;
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      kind: "image",
      position: { x: 390, y: 280 },
      selected: true
    });
  });

  it("renders generic handles, supports fan-out and multiple incoming references, and rejects incompatible connections", async () => {
    const fetchMock = installCanvasFetch();
    await mount();
    for (const kind of [
      "text",
      "text",
      "image",
      "video",
      "video"
    ] as const) {
      await act(async () => clickCreate(kind));
    }

    expect(host?.querySelectorAll('[data-handle-id="source"][data-handle-type="source"]'))
      .toHaveLength(5);
    expect(host?.querySelectorAll('[data-handle-id="target"][data-handle-type="target"]'))
      .toHaveLength(5);
    expect(host?.querySelector("[data-creator-canvas-port-label]")).toBeNull();

    const textA = getMockNode("text", 0);
    const textB = getMockNode("text", 1);
    const reference = getMockNode("image");
    const generateA = getMockNode("video", 0);
    const generateB = getMockNode("video", 1);
    const connections: MockConnection[] = [
      {
        source: textA.id,
        sourceHandle: "source",
        target: generateA.id,
        targetHandle: "target"
      },
      {
        source: textA.id,
        sourceHandle: "source",
        target: generateB.id,
        targetHandle: "target"
      },
      {
        source: reference.id,
        sourceHandle: "source",
        target: generateA.id,
        targetHandle: "target"
      },
      {
        source: reference.id,
        sourceHandle: "source",
        target: generateB.id,
        targetHandle: "target"
      }
    ];

    for (const connection of connections) {
      expect(getReactFlowProps().isValidConnection(connection)).toBe(true);
      await act(async () => getReactFlowProps().onConnect(connection));
    }
    expect(getReactFlowProps().edges).toHaveLength(4);
    expect(host?.querySelector('[data-creator-canvas-edge-count="4"]')).toBeTruthy();

    const additionalIncoming: MockConnection = {
      source: textB.id,
      sourceHandle: "source",
      target: generateA.id,
      targetHandle: "target"
    };
    const incompatible: MockConnection = {
      source: generateA.id,
      sourceHandle: "source",
      target: reference.id,
      targetHandle: "target"
    };
    expect(getReactFlowProps().isValidConnection(additionalIncoming)).toBe(true);
    expect(getReactFlowProps().isValidConnection(incompatible)).toBe(false);
    await act(async () => {
      getReactFlowProps().onConnect(additionalIncoming);
      getReactFlowProps().onConnect(incompatible);
    });
    expect(getReactFlowProps().edges).toHaveLength(5);
    expect(fetchMock.mock.calls.some(([input, init]) =>
      init?.method === "POST" || String(input).includes("/image/generate")
    )).toBe(false);
  });

  it("reconnects valid edges with stable IDs and preserves invalid reconnects", async () => {
    await mount();
    for (const kind of ["text", "text", "video", "video"] as const) {
      await act(async () => clickCreate(kind));
    }
    const textA = getMockNode("text", 0);
    const textB = getMockNode("text", 1);
    const generateA = getMockNode("video", 0);
    const generateB = getMockNode("video", 1);
    const originalConnection: MockConnection = {
      source: textA.id,
      sourceHandle: "source",
      target: generateA.id,
      targetHandle: "target"
    };
    await act(async () => getReactFlowProps().onConnect(originalConnection));
    const originalEdge = getReactFlowProps().edges[0];
    if (!originalEdge) throw new Error("ORIGINAL_EDGE_MISSING");

    getReactFlowProps().onReconnectStart({}, originalEdge);
    const validReconnect: MockConnection = {
      source: textB.id,
      sourceHandle: "source",
      target: generateA.id,
      targetHandle: "target"
    };
    expect(getReactFlowProps().isValidConnection(validReconnect)).toBe(true);
    await act(async () => getReactFlowProps().onReconnect(originalEdge, validReconnect));
    getReactFlowProps().onReconnectEnd();
    expect(getReactFlowProps().edges[0]).toMatchObject({
      id: originalEdge.id,
      source: textB.id,
      sourceHandle: "source",
      target: generateA.id,
      targetHandle: "target"
    });

    const stableEdge = getReactFlowProps().edges[0];
    if (!stableEdge) throw new Error("STABLE_EDGE_MISSING");
    const invalidReconnect: MockConnection = {
      source: generateB.id,
      sourceHandle: "source",
      target: textA.id,
      targetHandle: "target"
    };
    await act(async () => getReactFlowProps().onReconnect(stableEdge, invalidReconnect));
    expect(getReactFlowProps().edges[0]).toMatchObject({
      id: originalEdge.id,
      source: textB.id,
      target: generateA.id,
      targetHandle: "target"
    });
  });

  it("deletes edges independently and cascades incident edges when deleting nodes", async () => {
    await mount();
    await act(async () => {
      clickCreate("text");
      clickCreate("video");
    });
    const text = getMockNode("text");
    const generate = getMockNode("video");
    const connection: MockConnection = {
      source: text.id,
      sourceHandle: "source",
      target: generate.id,
      targetHandle: "target"
    };
    await act(async () => getReactFlowProps().onConnect(connection));
    const firstEdge = getReactFlowProps().edges[0];
    if (!firstEdge) throw new Error("FIRST_EDGE_MISSING");
    await act(async () => getReactFlowProps().onEdgesChange([
      { type: "remove", id: firstEdge.id }
    ]));
    expect(getReactFlowProps().edges).toHaveLength(0);
    expect(getReactFlowProps().nodes).toHaveLength(2);

    await act(async () => getReactFlowProps().onConnect(connection));
    expect(getReactFlowProps().edges).toHaveLength(1);
    await act(async () => getReactFlowProps().onNodesChange([
      { type: "remove", id: generate.id }
    ]));
    expect(getReactFlowProps().nodes).toHaveLength(1);
    expect(getReactFlowProps().edges).toHaveLength(0);
  });

  it("synchronizes drag positions and final viewport into the domain projection", async () => {
    await mount();
    await act(async () => clickCreate("text"));
    const text = getMockNode("text");

    await act(async () => getReactFlowProps().onNodesChange([{
      type: "position",
      id: text.id,
      position: { x: 512, y: 288 }
    }]));
    expect(getMockNode("text").data.domainNode.position).toEqual({ x: 512, y: 288 });

    await act(async () => getReactFlowProps().onMoveEnd(null, { x: -90, y: 45, zoom: 1.5 }));
    expect(host?.querySelector('[data-creator-canvas-viewport="-90,45,1.5"]')).toBeTruthy();
  });

  it("executes direct Generate once and binds one authoritative asset to an EMPTY Image", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({
          task,
          assets: [createGenerationAsset("asset-direct", task.id)]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Direct Canvas image"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());

    await waitForCanvas(() => {
      expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
        .toBe("asset-direct");
    });
    const postCalls = getCanvasPostCalls(fetchMock);
    expect(postCalls).toHaveLength(1);
    const request = JSON.parse(String(postCalls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      prompt: "Direct Canvas image",
      modelId: "canvas-image-pro",
      mode: "text-to-image",
      count: 1,
      size: "1024x1024"
    });
    expect(request.clientEntryId).toEqual(expect.any(String));
    expect(String(request.clientEntryId)).not.toBe("image-target");
    expect(new Headers(postCalls[0]?.[1]?.headers).get("Idempotency-Key"))
      .toEqual(expect.any(String));
    expect(readDomainNodes()).toHaveLength(1);
  });

  it("keeps generating visible on a deselected EMPTY Image and clears it on success", async () => {
    const pendingPost = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        return pendingPost.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Slow Canvas image"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());

    await waitForCanvas(() => {
      expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
      expect(host?.querySelector(
        '[data-creator-image-node-execution="generating"]'
      )).toBeTruthy();
    });
    expect(host?.querySelector(
      '[data-creator-canvas-node-id="image-target"] [data-creator-canvas-media-state="empty"]'
    )).toBeTruthy();

    await act(async () => selectOnlyNodeIds([]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();
    expect(host?.querySelector(
      '[data-creator-image-node-execution="generating"]'
    )).toBeTruthy();

    const postCall = getCanvasPostCalls(fetchMock)[0];
    const payload = JSON.parse(String(postCall?.[1]?.body)) as Record<string, unknown>;
    const task = createGenerationTask(payload);
    await act(async () => pendingPost.resolve(jsonResponse({
      task,
      assets: [createGenerationAsset("asset-slow-success", task.id)]
    })));
    await waitForCanvas(() => {
      expect(readDomainNodes()[0]?.data.assetId).toBe("asset-slow-success");
      expect(host?.querySelector("[data-creator-image-node-execution]")).toBeNull();
    });
    expect(host?.querySelector(
      '[data-creator-canvas-node-id="image-target"] [data-creator-canvas-media-state="bound"]'
    )).toBeTruthy();
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("maps EMPTY multi-results to the target then ordered siblings without changing edges", async () => {
    const initialDocument = createImageDocument({ withTextEdge: true });
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({
          task,
          assets: [
            createGenerationAsset("asset-first", task.id),
            createGenerationAsset("asset-second", task.id)
          ]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => {
      setTextareaValue(getComposerPrompt(), "Two Canvas images");
      const count = host?.querySelector<HTMLSelectElement>(
        '[data-creator-image-count="true"]'
      );
      if (!count) throw new Error("CREATOR_IMAGE_COUNT_MISSING");
      setSelectValue(count, "2");
    });
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));
    expect(readDomainNodes().filter((node) => node.kind === "image").map(
      (node) => node.data.assetId
    )).toEqual(["asset-first", "asset-second"]);
    expect(getReactFlowProps().edges).toHaveLength(1);
    expect(getReactFlowProps().edges[0]).toMatchObject({
      source: "text-source",
      target: "image-target"
    });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("preserves a BOUND target and creates every generated result as a sibling", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({
          task,
          assets: [
            createGenerationAsset("asset-new-a", task.id),
            createGenerationAsset("asset-new-b", task.id)
          ]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Keep original"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));
    expect(readDomainNodes().map((node) => node.data.assetId)).toEqual([
      "asset-original",
      "asset-new-a",
      "asset-new-b"
    ]);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("uses measured Image geometry for a compact BOUND 2x2 group and preserves the right corridor", async () => {
    const assetIds = ["asset-a", "asset-b", "asset-c", "asset-d"];
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({
          task,
          assets: assetIds.map((assetId) => createGenerationAsset(assetId, task.id))
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await setNodeDimensions("image-target", { width: 320, height: 282 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Four compact results", "4");

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(5));
    const nodes = readDomainNodes();
    expect(nodes.map((node) => node.data.assetId)).toEqual([
      "asset-original",
      ...assetIds
    ]);
    expect(nodes.slice(1).map((node) => node.position)).toEqual([
      { x: 32, y: 450 },
      { x: 32, y: 780 },
      { x: 400, y: 450 },
      { x: 400, y: 780 }
    ]);
    expect(nodes[0]?.position).toEqual({ x: 400, y: 120 });
    expect(nodes.slice(1).every((node) => node.position.x + 320 <= 720)).toBe(true);
    expect(host?.querySelector("[data-creator-image-node-execution]")).toBeNull();
    expect(host?.querySelector('[data-creator-canvas-viewport="-10,15,1"]')).toBeTruthy();

    await act(async () => selectOnlyNodeIds([]));
    await act(async () => selectOnlyNodeIds(["image-target"]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeTruthy();
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("creates a non-overlapping one-column BOUND group for two ordered results", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({
          task,
          assets: ["asset-a", "asset-b"].map((assetId) =>
            createGenerationAsset(assetId, task.id)
          )
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Two vertical results", "2");

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));
    const siblings = readDomainNodes().slice(1);
    expect(siblings.map((node) => node.data.assetId)).toEqual(["asset-a", "asset-b"]);
    expect(siblings.map((node) => node.position)).toEqual([
      { x: 400, y: 488 },
      { x: 400, y: 856 }
    ]);
    expect(siblings[1]!.position.y - (siblings[0]!.position.y + 320)).toBe(48);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("binds the first EMPTY result and places the remaining three in a compact group", async () => {
    const initialDocument = createImageDocument({ withTextEdge: true });
    const originalEdges = initialDocument.edges;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({
          task,
          assets: ["asset-a", "asset-b", "asset-c", "asset-d"].map((assetId) =>
            createGenerationAsset(assetId, task.id)
          )
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Bind one and group three", "4");

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(5));
    const nodes = readDomainNodes();
    expect(nodes.find((node) => node.id === "image-target")?.data.assetId).toBe("asset-a");
    expect(nodes.slice(-3).map((node) => node.data.assetId)).toEqual([
      "asset-b",
      "asset-c",
      "asset-d"
    ]);
    expect(nodes.slice(-3).map((node) => node.position)).toEqual([
      { x: 32, y: 488 },
      { x: 32, y: 856 },
      { x: 400, y: 488 }
    ]);
    expect(getReactFlowProps().edges).toHaveLength(originalEdges.length);
    expect(getReactFlowProps().edges[0]).toMatchObject({
      id: originalEdges[0]?.id,
      source: originalEdges[0]?.sourceNodeId,
      target: originalEdges[0]?.targetNodeId
    });
    expect(host?.querySelector('[data-creator-canvas-viewport="-10,15,1"]')).toBeTruthy();
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("avoids an existing node using its measured application-time rectangle", async () => {
    const initialDocument: CreatorCanvasDocumentV1 = {
      ...createImageDocument({ targetAssetId: "asset-original" }),
      nodes: [
        ...createImageDocument({ targetAssetId: "asset-original" }).nodes,
        {
          id: "text-blocker",
          kind: "text",
          position: { x: 400, y: 450 },
          data: { text: "Below blocker" }
        }
      ]
    };
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({ task, assets: [createGenerationAsset("asset-new", task.id)] });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    await setNodeDimensions("image-target", { width: 320, height: 282 });
    await setNodeDimensions("text-blocker", { width: 320, height: 150 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Avoid measured blocker");

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));
    expect(readDomainNodes().find((node) => node.data.assetId === "asset-new")?.position)
      .toEqual({ x: 32, y: 120 });
    expect(readDomainNodes().find((node) => node.id === "text-blocker")?.position)
      .toEqual({ x: 400, y: 450 });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("keeps Text and async Result Application as separate history steps", async () => {
    const pendingPost = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        return pendingPost.promise;
      }
      if (String(input).endsWith("/assets/asset-interleaved-result/content")) {
        return new Response("result-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({
        targetAssetId: "asset-original",
        withTextEdge: true
      }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Interleave Text and Result");
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(1));
    expect(getHistoryButton("undo").disabled).toBe(true);

    await act(async () => selectOnlyNodeIds(["text-source"]));
    const text = getTextInputForNode("text-source");
    await act(async () => {
      text.focus();
      setTextareaValue(text, "ab");
    });

    const postCall = getCanvasPostCalls(fetchMock)[0];
    const payload = JSON.parse(String(postCall?.[1]?.body)) as Record<string, unknown>;
    const task = createGenerationTask(payload);
    await act(async () => pendingPost.resolve(jsonResponse({
      task,
      assets: [createGenerationAsset("asset-interleaved-result", task.id)]
    })));
    await waitForCanvas(() => {
      expect(readDomainNodes()).toHaveLength(3);
      expect(readDomainNodes().find((node) => node.data.assetId === "asset-interleaved-result"))
        .toBeTruthy();
    });

    const textAfterResult = getTextInputForNode("text-source");
    await act(async () => setTextareaValue(textAfterResult, "abc"));
    await act(async () => textAfterResult.blur());
    await settle();
    expect(readDomainNodes().find((node) => node.id === "text-source")?.data.text).toBe("abc");
    expect(readDomainNodes()).toHaveLength(3);

    await clickHistory("undo");
    expect(readDomainNodes().find((node) => node.id === "text-source")?.data.text)
      .toBe("Canvas source prompt");
    expect(readDomainNodes()).toHaveLength(3);
    expect(readDomainNodes().some((node) => node.data.assetId === "asset-interleaved-result"))
      .toBe(true);

    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(2);
    expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
      .toBe("asset-original");

    await clickHistory("redo");
    expect(readDomainNodes()).toHaveLength(3);
    expect(readDomainNodes().some((node) => node.data.assetId === "asset-interleaved-result"))
      .toBe(true);
    await clickHistory("redo");
    expect(readDomainNodes().find((node) => node.id === "text-source")?.data.text).toBe("abc");
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("coalesces a target drag around async Result Application without geometry drift", async () => {
    const pendingPost = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        return pendingPost.promise;
      }
      if (String(input).endsWith("/assets/asset-drag-result/content")) {
        return new Response("result-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Interleave target drag");
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(1));

    const dragNode = getMockNode("image");
    await act(async () => {
      getReactFlowProps().onNodeDragStart(null, dragNode, [dragNode]);
      getReactFlowProps().onNodesChange([{
        type: "position",
        id: dragNode.id,
        position: { x: 640, y: 160 },
        dragging: true
      }]);
    });

    const postCall = getCanvasPostCalls(fetchMock)[0];
    const payload = JSON.parse(String(postCall?.[1]?.body)) as Record<string, unknown>;
    const task = createGenerationTask(payload);
    await act(async () => pendingPost.resolve(jsonResponse({
      task,
      assets: [createGenerationAsset("asset-drag-result", task.id)]
    })));
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    const siblingAtResult = readDomainNodes().find(
      (node) => node.data.assetId === "asset-drag-result"
    )?.position;
    if (!siblingAtResult) throw new Error("INTERLEAVED_DRAG_SIBLING_MISSING");

    await act(async () => {
      getReactFlowProps().onNodesChange([{
        type: "position",
        id: dragNode.id,
        position: { x: 720, y: 240 },
        dragging: true
      }]);
      getReactFlowProps().onNodeDragStop(null, dragNode, [dragNode]);
    });
    await settle();
    expect(readDomainNodes().find((node) => node.id === "image-target")?.position)
      .toEqual({ x: 720, y: 240 });

    await clickHistory("undo");
    expect(readDomainNodes().find((node) => node.id === "image-target")?.position)
      .toEqual({ x: 400, y: 120 });
    const siblingAfterDragUndo = readDomainNodes().find(
      (node) => node.data.assetId === "asset-drag-result"
    )?.position;
    expect(siblingAfterDragUndo).toBeDefined();
    expect(siblingAfterDragUndo).not.toEqual(siblingAtResult);

    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(1);
    expect(readDomainNodes()[0]?.data.assetId).toBe("asset-original");
    await clickHistory("redo");
    expect(readDomainNodes()).toHaveLength(2);
    await clickHistory("redo");
    expect(readDomainNodes().find((node) => node.id === "image-target")?.position)
      .toEqual({ x: 720, y: 240 });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("uses the latest target position when generation completes after a drag", async () => {
    const pendingPost = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        return pendingPost.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Move target while pending");
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(1));
    await moveNode("image-target", { x: 900, y: 700 });

    const postCall = getCanvasPostCalls(fetchMock)[0];
    const payload = JSON.parse(String(postCall?.[1]?.body)) as Record<string, unknown>;
    const task = createGenerationTask(payload);
    await act(async () => pendingPost.resolve(jsonResponse({
      task,
      assets: [createGenerationAsset("asset-after-drag", task.id)]
    })));

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    expect(readDomainNodes().find((node) => node.id === "image-target")?.position)
      .toEqual({ x: 900, y: 700 });
    expect(readDomainNodes().find((node) => node.data.assetId === "asset-after-drag")?.position)
      .toEqual({ x: 900, y: 1_068 });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("uses the latest position of another node for collision checks", async () => {
    const baseDocument = createImageDocument({ targetAssetId: "asset-original" });
    const initialDocument: CreatorCanvasDocumentV1 = {
      ...baseDocument,
      nodes: [
        ...baseDocument.nodes,
        {
          id: "moving-blocker",
          kind: "text",
          position: { x: 1_500, y: 1_500 },
          data: { text: "Moving blocker" }
        }
      ]
    };
    const pendingPost = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        return pendingPost.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Move blocker while pending");
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(1));
    await moveNode("moving-blocker", { x: 400, y: 488 });

    const postCall = getCanvasPostCalls(fetchMock)[0];
    const payload = JSON.parse(String(postCall?.[1]?.body)) as Record<string, unknown>;
    const task = createGenerationTask(payload);
    await act(async () => pendingPost.resolve(jsonResponse({
      task,
      assets: [createGenerationAsset("asset-avoids-moved-node", task.id)]
    })));

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));
    expect(readDomainNodes().find(
      (node) => node.data.assetId === "asset-avoids-moved-node"
    )?.position).toEqual({ x: 32, y: 120 });
    expect(readDomainNodes().find((node) => node.id === "moving-blocker")?.position)
      .toEqual({ x: 400, y: 488 });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("falls back conservatively when measured height is missing and still applies results", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({ task, assets: [createGenerationAsset("asset-fallback", task.id)] });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await setNodeDimensions("image-target", { width: 300 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Fallback geometry");

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    expect(readDomainNodes().find((node) => node.data.assetId === "asset-fallback")?.position)
      .toEqual({ x: 400, y: 488 });
    expect(host?.querySelector("[data-creator-image-node-execution]")).toBeNull();
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("scans beyond a dense local cluster without dropping the authoritative result", async () => {
    const baseDocument = createImageDocument({ targetAssetId: "asset-original" });
    const initialDocument: CreatorCanvasDocumentV1 = {
      ...baseDocument,
      nodes: [
        ...baseDocument.nodes,
        {
          id: "below-blocker",
          kind: "text",
          position: { x: 400, y: 488 },
          data: { text: "Below" }
        },
        {
          id: "left-blocker",
          kind: "video",
          position: { x: 32, y: 120 },
          data: { assetId: null }
        },
        {
          id: "above-blocker",
          kind: "image",
          position: { x: 400, y: -248 },
          data: { assetId: null }
        }
      ]
    };
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({ task, assets: [createGenerationAsset("asset-dense", task.id)] });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Dense cluster");

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(5));
    expect(readDomainNodes().find((node) => node.data.assetId === "asset-dense")?.position)
      .toEqual({ x: 400, y: 856 });
    expect(readDomainNodes().slice(0, 4).map((node) => node.position)).toEqual(
      initialDocument.nodes.map((node) => node.position)
    );
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("does not queue or reveal an EMPTY single result that binds in place", async () => {
    const fetchMock = installDirectGenerationResults([["asset-empty-single"]]);
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Bind without reveal");

    await waitForCanvas(() => {
      expect(readDomainNodes()).toHaveLength(1);
      expect(readDomainNodes()[0]?.data.assetId).toBe("asset-empty-single");
    });
    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
    expect(host?.querySelector('[data-creator-canvas-viewport="-10,15,1"]')).toBeTruthy();
  });

  it("does not move the viewport when a measured BOUND sibling is fully visible", async () => {
    installDirectGenerationResults([["asset-visible"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 200 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Visible sibling");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    await setNodeDimensions(getNodeIdByAssetId("asset-visible"), {
      width: 320,
      height: 200
    });

    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
    expect(reactFlowGetViewportForBoundsMock).not.toHaveBeenCalled();
  });

  it("reveals one offscreen BOUND sibling with one same-zoom minimal pan", async () => {
    installDirectGenerationResults([["asset-offscreen"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Offscreen sibling");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    await setNodeDimensions(getNodeIdByAssetId("asset-offscreen"), {
      width: 320,
      height: 320
    });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    expect(reactFlowSetViewportMock).toHaveBeenCalledWith(
      { x: -10, y: -56, zoom: 1 },
      { duration: 250, interpolate: "linear" }
    );
    expect(reactFlowGetViewportForBoundsMock).not.toHaveBeenCalled();
    expect(host?.querySelector('[data-creator-canvas-viewport="-10,-56,1"]')).toBeTruthy();
    expect(readDomainNodes().find((node) => node.data.assetId === "asset-offscreen")?.position)
      .toEqual({ x: 400, y: 488 });
  });

  it("does not reveal an EMPTY count-four group already inside the safe viewport", async () => {
    const initialDocument = {
      ...createImageDocument(),
      viewport: { x: 100, y: 0, zoom: 0.5 }
    };
    installDirectGenerationResults([[
      "asset-visible-a",
      "asset-visible-b",
      "asset-visible-c",
      "asset-visible-d"
    ]]);
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Visible empty group", "4");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(4));
    await setNodesDimensions(
      ["asset-visible-b", "asset-visible-c", "asset-visible-d"].map(
        getNodeIdByAssetId
      ),
      { width: 320, height: 320 }
    );

    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
    expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
      .toBe("asset-visible-a");
  });

  it("reveals a partially offscreen BOUND count-four group exactly once", async () => {
    const assetIds = ["asset-four-a", "asset-four-b", "asset-four-c", "asset-four-d"];
    installDirectGenerationResults([assetIds]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Four offscreen results", "4");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(5));
    await setNodesDimensions(assetIds.map(getNodeIdByAssetId), {
      width: 320,
      height: 320
    });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    const viewport = reactFlowSetViewportMock.mock.calls[0]?.[0];
    expect(viewport).toMatchObject({ zoom: 1 });
    expect(reactFlowGetViewportForBoundsMock).not.toHaveBeenCalled();
    expect(readDomainNodes().slice(1).map((node) => node.position)).toEqual([
      { x: 32, y: 488 },
      { x: 32, y: 856 },
      { x: 400, y: 488 },
      { x: 400, y: 856 }
    ]);
  });

  it("excludes a huge unrelated graph region from local reveal bounds", async () => {
    const initialDocument: CreatorCanvasDocumentV1 = {
      ...createImageDocument({ targetAssetId: "asset-original" }),
      nodes: [
        ...createImageDocument({ targetAssetId: "asset-original" }).nodes,
        {
          id: "far-text",
          kind: "text",
          position: { x: 100_000, y: 100_000 },
          data: { text: "Far unrelated graph" }
        }
      ]
    };
    installDirectGenerationResults([["asset-local-only"]]);
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Local only");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));
    await setNodeDimensions(getNodeIdByAssetId("asset-local-only"), {
      width: 320,
      height: 320
    });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    expect(reactFlowSetViewportMock.mock.calls[0]?.[0]).toEqual({
      x: -10,
      y: -56,
      zoom: 1
    });
    expect(readDomainNodes().find((node) => node.id === "far-text")?.position)
      .toEqual({ x: 100_000, y: 100_000 });
  });

  it("uses bounded local zoom-out without zooming in", async () => {
    const initialDocument = {
      ...createImageDocument({ targetAssetId: "asset-original" }),
      viewport: { x: -10, y: 15, zoom: 1.5 }
    };
    const assetIds = ["asset-zoom-a", "asset-zoom-b", "asset-zoom-c", "asset-zoom-d"];
    installDirectGenerationResults([assetIds]);
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 300, height: 250 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Bounded zoom", "4");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(5));
    await setNodesDimensions(assetIds.map(getNodeIdByAssetId), {
      width: 300,
      height: 250
    });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    const viewport = reactFlowSetViewportMock.mock.calls[0]?.[0] as {
      x: number;
      y: number;
      zoom: number;
    };
    expect(viewport.zoom).toBeLessThanOrEqual(1.5);
    expect(viewport.zoom).toBeGreaterThanOrEqual(1.2);
    expect(reactFlowSetViewportMock.mock.calls[0]?.[1]).toEqual({
      duration: 250,
      interpolate: "linear"
    });
    const boundsCall = reactFlowGetViewportForBoundsMock.mock.calls[0];
    expect(boundsCall?.[0]).toEqual({ x: 52, y: 418, width: 648, height: 548 });
    expect(boundsCall?.slice(1, 3)).toEqual([1_000, 800]);
    expect(boundsCall?.[3]).toBeCloseTo(1.2);
    expect(boundsCall?.slice(4)).toEqual([1.5, "48px"]);
  });

  it("never zooms below the Canvas minimum zoom floor", async () => {
    const initialDocument = {
      ...createImageDocument({ targetAssetId: "asset-original" }),
      viewport: { x: -10, y: 15, zoom: 0.3 }
    };
    const assetIds = ["asset-floor-a", "asset-floor-b", "asset-floor-c", "asset-floor-d"];
    installDirectGenerationResults([assetIds]);
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 4_000, height: 4_000 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Minimum zoom floor", "4");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(5));
    await setNodesDimensions(assetIds.map(getNodeIdByAssetId), {
      width: 4_000,
      height: 4_000
    });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    expect(reactFlowSetViewportMock.mock.calls[0]?.[0]).toMatchObject({ zoom: 0.25 });
    expect(reactFlowGetViewportForBoundsMock.mock.calls[0]?.[3]).toBe(0.25);
    expect(reactFlowGetViewportForBoundsMock.mock.calls[0]?.[4]).toBe(0.3);
  });

  it("prioritizes created-only bounds when target context exceeds the zoom cap", async () => {
    installDirectGenerationResults([["asset-created-priority"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 600);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Created priority");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    await setNodeDimensions(getNodeIdByAssetId("asset-created-priority"), {
      width: 320,
      height: 320
    });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    expect(reactFlowSetViewportMock.mock.calls[0]?.[0]).toEqual({
      x: -10,
      y: -256,
      zoom: 1
    });
    expect(reactFlowGetViewportForBoundsMock).not.toHaveBeenCalled();
  });

  it("suppresses reveal when the user pans after generation starts", async () => {
    const pendingPost = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        return pendingPost.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("User navigation wins");
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(1));
    await moveViewport({ x: -200, y: -100, zoom: 1 });

    const payload = JSON.parse(String(getCanvasPostCalls(fetchMock)[0]?.[1]?.body));
    const task = createGenerationTask(payload);
    await act(async () => pendingPost.resolve(jsonResponse({
      task,
      assets: [createGenerationAsset("asset-suppressed", task.id)]
    })));
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    await setNodeDimensions(getNodeIdByAssetId("asset-suppressed"), {
      width: 320,
      height: 320
    });

    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
    expect(host?.querySelector('[data-creator-canvas-viewport="-200,-100,1"]')).toBeTruthy();
  });

  it("suppresses reveal when generation starts during active viewport movement", async () => {
    installDirectGenerationResults([["asset-active-pan"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await startViewportMovement();
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Started during pan");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    await finishViewportMovement({ x: -100, y: -50, zoom: 1 });
    await setNodeDimensions(getNodeIdByAssetId("asset-active-pan"), {
      width: 320,
      height: 320
    });

    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
  });

  it("suppresses reveal when the user pans after commit but before measurement", async () => {
    installDirectGenerationResults([["asset-before-measure"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Pan before measure");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    await moveViewport({ x: -120, y: -80, zoom: 1 });
    await setNodeDimensions(getNodeIdByAssetId("asset-before-measure"), {
      width: 320,
      height: 320
    });

    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
  });

  it("keeps parallel generation concurrent and reveals FIFO only once", async () => {
    const firstPost = createDeferred<Response>();
    const secondPost = createDeferred<Response>();
    let postIndex = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        postIndex += 1;
        return postIndex === 1 ? firstPost.promise : secondPost.promise;
      }
      return new Response("not found", { status: 404 });
    });
    const initialDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [
        {
          id: "image-a",
          kind: "image",
          position: { x: 400, y: 120 },
          data: { assetId: "asset-original-a" }
        },
        {
          id: "image-b",
          kind: "image",
          position: { x: 1_800, y: 120 },
          data: { assetId: "asset-original-b" }
        }
      ],
      edges: [],
      viewport: { x: -10, y: 15, zoom: 1 }
    };
    await mount({ initialDocument, initialModels: [canvasImageModel] }, {
      authenticated: true
    });
    setMockCanvasBounds(1_000, 800);
    await setNodesDimensions(["image-a", "image-b"], { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-a"]));
    await executeSelectedImageGeneration("Parallel A");
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(1));
    await act(async () => selectOnlyNodeIds(["image-b"]));
    await executeSelectedImageGeneration("Parallel B");
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(2));

    const posts = getCanvasPostCalls(fetchMock);
    const firstPayload = JSON.parse(String(posts[0]?.[1]?.body));
    const secondPayload = JSON.parse(String(posts[1]?.[1]?.body));
    const firstTask = createGenerationTask(firstPayload, "succeeded", "parallel-a");
    const secondTask = createGenerationTask(secondPayload, "succeeded", "parallel-b");
    await act(async () => firstPost.resolve(jsonResponse({
      task: firstTask,
      assets: [createGenerationAsset("asset-parallel-a", firstTask.id)]
    })));
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));
    await act(async () => secondPost.resolve(jsonResponse({
      task: secondTask,
      assets: [createGenerationAsset("asset-parallel-b", secondTask.id)]
    })));
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(4));
    await setNodesDimensions([
      getNodeIdByAssetId("asset-parallel-a"),
      getNodeIdByAssetId("asset-parallel-b")
    ], { width: 320, height: 320 });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    expect(reactFlowSetViewportMock.mock.calls[0]?.[0]).toEqual({
      x: -10,
      y: -56,
      zoom: 1
    });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(2);
  });

  it("cancels a pending reveal when its target is deleted", async () => {
    installDirectGenerationResults([["asset-target-deleted"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Delete target before reveal");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    const createdNodeId = getNodeIdByAssetId("asset-target-deleted");
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: "image-target"
    }]));
    await setNodeDimensions(createdNodeId, { width: 320, height: 320 });

    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
  });

  it("cancels a pending reveal when any created sibling is deleted", async () => {
    installDirectGenerationResults([["asset-sibling-deleted"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Delete sibling before reveal");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    const createdNodeId = getNodeIdByAssetId("asset-sibling-deleted");
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: createdNodeId
    }]));
    await settle();

    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
    expect(readDomainNodes()).toHaveLength(1);
  });

  it("performs at most one viewport operation per token under Strict Mode replay", async () => {
    installDirectGenerationResults([["asset-strict"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true, strictMode: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Strict reveal");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    await setNodeDimensions(getNodeIdByAssetId("asset-strict"), {
      width: 320,
      height: 320
    });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    await settle();
    expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the viewport after unmount with a reveal waiting for measurement", async () => {
    installDirectGenerationResults([["asset-unmounted-reveal"]]);
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Unmount before measurement");
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));

    await act(async () => root?.unmount());
    root = null;
    await settle();
    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
  });

  it("reuses EXEC-0C for 202 list/detail reconciliation with no second POST", async () => {
    let submittedPayload: Record<string, unknown> | null = null;
    let listCalls = 0;
    let detailCalls = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/image/generate")) {
        submittedPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          status: "in_progress",
          taskId: "canvas-reconciled-task",
          retryAfterMs: 2500
        }, 202);
      }
      if (url.includes("/tasks?type=image&limit=20")) {
        listCalls += 1;
        return jsonResponse({
          tasks: [createGenerationTask(
            submittedPayload ?? {},
            "succeeded",
            "canvas-reconciled-task"
          )]
        });
      }
      if (url.includes("/tasks/canvas-reconciled-task")) {
        detailCalls += 1;
        const task = createGenerationTask(
          submittedPayload ?? {},
          "succeeded",
          "canvas-reconciled-task"
        );
        return jsonResponse({
          task,
          assets: [createGenerationAsset("asset-reconciled", task.id)]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Recover Canvas image"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());

    await waitForCanvas(() => {
      expect(readDomainNodes()[0]?.data.assetId).toBe("asset-reconciled");
    });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
    expect(listCalls).toBe(1);
    expect(detailCalls).toBe(1);
  });

  it("keeps checking visible while deselected until 202 polling applies the result", async () => {
    let submittedPayload: Record<string, unknown> = {};
    let listCalls = 0;
    let detailCalls = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/image/generate")) {
        submittedPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({ status: "in_progress", retryAfterMs: 2500 }, 202);
      }
      if (url.includes("/tasks?type=image&limit=20")) {
        listCalls += 1;
        return jsonResponse({
          tasks: listCalls === 1
            ? []
            : [createGenerationTask(
                submittedPayload,
                "succeeded",
                "canvas-checking-task"
              )]
        });
      }
      if (url.includes("/tasks/canvas-checking-task")) {
        detailCalls += 1;
        const task = createGenerationTask(
          submittedPayload,
          "succeeded",
          "canvas-checking-task"
        );
        return jsonResponse({
          task,
          assets: [createGenerationAsset("asset-after-checking", task.id)]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Check Canvas image"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    vi.useFakeTimers();
    await act(async () => getExecuteButton().click());
    await settle();
    expect(host?.querySelector(
      '[data-creator-image-node-execution="checking"]'
    )).toBeTruthy();

    await act(async () => selectOnlyNodeIds([]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();
    expect(host?.querySelector(
      '[data-creator-image-node-execution="checking"]'
    )).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await waitForCanvas(() => {
      expect(readDomainNodes()[0]?.data.assetId).toBe("asset-after-checking");
      expect(host?.querySelector("[data-creator-image-node-execution]")).toBeNull();
    });
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
    expect(listCalls).toBe(2);
    expect(detailCalls).toBe(1);
  });

  it("retains the original viewport baseline across unresolved Resume", async () => {
    let postCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/image/generate")) {
        postCount += 1;
        if (postCount === 1) {
          return jsonResponse({
            status: "in_progress",
            taskId: null,
            retryAfterMs: 2500
          }, 202);
        }
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload, "succeeded", "resumed-reveal-task");
        return jsonResponse({
          task,
          assets: [createGenerationAsset("asset-resumed-reveal", task.id)]
        });
      }
      if (url.includes("/tasks?type=image&limit=20")) {
        return jsonResponse({ tasks: [] });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Resume baseline"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    vi.useFakeTimers();
    await act(async () => getExecuteButton().click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(host?.querySelector(
      '[data-creator-image-execution-status="unresolved"]'
    )).toBeTruthy();

    await moveViewport({ x: -10, y: 15, zoom: 1 });
    const resume = host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-resume="true"]'
    );
    if (!resume) throw new Error("CREATOR_IMAGE_RESUME_MISSING");
    await act(async () => resume.click());
    await settle();
    expect(readDomainNodes()).toHaveLength(2);
    await setNodeDimensions(getNodeIdByAssetId("asset-resumed-reveal"), {
      width: 320,
      height: 320
    });

    expect(reactFlowSetViewportMock).not.toHaveBeenCalled();
    const postCalls = getCanvasPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(new Headers(postCalls[1]?.[1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(postCalls[0]?.[1]?.headers).get("Idempotency-Key"));
  });

  it("captures a fresh viewport baseline for a terminal new retry", async () => {
    let postCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        postCount += 1;
        if (postCount === 1) {
          return jsonResponse({
            code: "IMAGE_GENERATION_FAILED",
            message: "Retry after navigation",
            retryable: false
          }, 500);
        }
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload, "succeeded", "new-retry-task");
        return jsonResponse({
          task,
          assets: [createGenerationAsset("asset-new-retry-reveal", task.id)]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    setMockCanvasBounds(1_000, 800);
    await setNodeDimensions("image-target", { width: 320, height: 320 });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await executeSelectedImageGeneration("Fresh retry baseline");
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-image-execution-status="failed"]'
    )).toBeTruthy());
    await moveViewport({ x: -10, y: 15, zoom: 1 });

    await act(async () => getExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    await setNodeDimensions(getNodeIdByAssetId("asset-new-retry-reveal"), {
      width: 320,
      height: 320
    });

    await waitForCanvas(() => expect(reactFlowSetViewportMock).toHaveBeenCalledTimes(1));
    const postCalls = getCanvasPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(new Headers(postCalls[1]?.[1]?.headers).get("Idempotency-Key"))
      .not.toBe(new Headers(postCalls[0]?.[1]?.headers).get("Idempotency-Key"));
  });

  it("exhausts polling and resumes with the exact frozen attempt", async () => {
    let postCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/image/generate")) {
        postCount += 1;
        return postCount === 1
          ? jsonResponse({
              status: "in_progress",
              taskId: null,
              retryAfterMs: 2500
            }, 202)
          : jsonResponse({
              code: "IMAGE_GENERATION_FAILED",
              message: "Safe terminal retry result",
              retryable: false
            }, 500);
      }
      if (url.includes("/tasks?type=image&limit=20")) {
        return jsonResponse({ tasks: [] });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Frozen Canvas attempt"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    vi.useFakeTimers();
    await act(async () => getExecuteButton().click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(host?.querySelector(
      '[data-creator-image-node-execution="unresolved"]'
    )).toBeTruthy();
    const imageCard = host?.querySelector(
      '[data-creator-canvas-node-id="image-target"]'
    );
    expect(imageCard?.querySelector('[data-creator-image-resume="true"]')).toBeNull();
    await act(async () => selectOnlyNodeIds([]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();
    expect(host?.querySelector(
      '[data-creator-image-node-execution="unresolved"]'
    )).toBeTruthy();
    await act(async () => selectOnlyNodeIds(["image-target"]));
    const resume = host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-resume="true"]'
    );
    expect(resume).toBeTruthy();
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      init?.method !== "POST" && String(input).includes("/tasks?type=image&limit=20")
    )).toHaveLength(9);

    const firstPost = getCanvasPostCalls(fetchMock)[0];
    if (!resume || !firstPost) throw new Error("RESUME_FIXTURE_MISSING");
    await act(async () => resume.click());
    await settle();
    const postCalls = getCanvasPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(postCalls[1]?.[1]?.body).toBe(firstPost[1]?.body);
    expect(new Headers(postCalls[1]?.[1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(firstPost[1]?.headers).get("Idempotency-Key"));
    expect(JSON.parse(String(postCalls[1]?.[1]?.body)).clientEntryId)
      .toBe(JSON.parse(String(firstPost[1]?.body)).clientEntryId);
  });

  it("keeps terminal failure safe and creates a new key on explicit retry", async () => {
    let postCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        postCount += 1;
        if (postCount === 1) {
          return jsonResponse({
            code: "IMAGE_GENERATION_FAILED",
            message: "Safe Canvas failure",
            retryable: false
          }, 500);
        }
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({
          task,
          assets: [createGenerationAsset("asset-after-retry", task.id)]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Retry Canvas image"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());
    await waitForCanvas(() => {
      expect(host?.querySelector('[data-creator-image-execution-status="failed"]')?.textContent)
        .toContain("Safe Canvas failure");
    });
    const failedCard = host?.querySelector(
      '[data-creator-canvas-node-id="image-target"]'
    );
    expect(failedCard?.querySelector(
      '[data-creator-image-node-execution="failed"]'
    )?.textContent).toContain("Generation failed");
    expect(failedCard?.textContent).not.toContain("Safe Canvas failure");
    await act(async () => selectOnlyNodeIds([]));
    expect(host?.querySelector('[data-creator-image-composer="true"]')).toBeNull();
    expect(host?.querySelector(
      '[data-creator-image-node-execution="failed"]'
    )).toBeTruthy();
    await act(async () => selectOnlyNodeIds(["image-target"]));
    expect(host?.querySelector('[data-creator-image-execution-status="failed"]')?.textContent)
      .toContain("Safe Canvas failure");

    await act(async () => getExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes()[0]?.data.assetId)
      .toBe("asset-after-retry"));
    const postCalls = getCanvasPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(new Headers(postCalls[0]?.[1]?.headers).get("Idempotency-Key"))
      .not.toBe(new Headers(postCalls[1]?.[1]?.headers).get("Idempotency-Key"));
    expect(JSON.parse(String(postCalls[0]?.[1]?.body)).clientEntryId)
      .not.toBe(JSON.parse(String(postCalls[1]?.[1]?.body)).clientEntryId);
  });

  it("aborts a pending execution when its target node is deleted", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Delete while running"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());
    await waitForCanvas(() => {
      expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
      expect(host?.querySelector(
        '[data-creator-image-node-execution="generating"]'
      )).toBeTruthy();
    });

    await act(async () => getReactFlowProps().onNodesChange([
      { type: "remove", id: "image-target" }
    ]));
    await settle();
    expect(readDomainNodes()).toEqual([]);
    expect(host?.querySelector("[data-creator-image-node-execution]")).toBeNull();
    expect(host?.querySelector('[data-creator-image-execution-status="failed"]')).toBeNull();
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("aborts every pending execution when the Canvas unmounts", async () => {
    let aborted = false;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/image/generate")) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    await act(async () => setTextareaValue(getComposerPrompt(), "Unmount while running"));
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());
    await waitForCanvas(() => expect(getCanvasPostCalls(fetchMock)).toHaveLength(1));

    await act(async () => root?.unmount());
    root = null;
    expect(aborted).toBe(true);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(1);
  });

  it("prepares a selected owner Image for Edit without persisting request bytes", async () => {
    compressReferenceImageMock.mockResolvedValue({
      dataUrl: "data:image/jpeg;base64,Y2FudmFzLWVkaXQ=",
      compressedBytes: 11,
      sourceWidth: 1600,
      sourceHeight: 900
    });
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/assets/asset-original")) {
        return jsonResponse({
          asset: {
            ...createGenerationAsset("asset-original", "source-task"),
            url: "/assets/asset-original/content",
            title: "Owner source"
          },
          task: null
        });
      }
      if (url.endsWith("/assets/asset-original/content")) {
        return new Response("original-image", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (init?.method === "POST" && url.includes("/image/generate")) {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createGenerationTask(payload);
        return jsonResponse({
          task,
          assets: [createGenerationAsset("asset-edited", task.id)]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createImageDocument({ targetAssetId: "asset-original" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["image-target"]));
    const edit = host?.querySelector<HTMLButtonElement>(
      '[data-creator-image-operation="edit"]'
    );
    if (!edit) throw new Error("CREATOR_IMAGE_EDIT_MISSING");
    await act(async () => {
      edit.click();
      setTextareaValue(getComposerPrompt(), "Edit the owner image");
    });
    await waitForCanvas(() => expect(getExecuteButton().disabled).toBe(false));
    await act(async () => getExecuteButton().click());

    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(2));
    const postCalls = getCanvasPostCalls(fetchMock);
    expect(postCalls).toHaveLength(1);
    const payload = JSON.parse(String(postCalls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      mode: "image-to-image",
      size: "1280x720",
      referenceImage: {
        dataUrl: "data:image/jpeg;base64,Y2FudmFzLWVkaXQ=",
        mimeType: "image/jpeg",
        name: "Owner source",
        compressedBytes: 11
      }
    });
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/assets/asset-original")
    )).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/assets/asset-original/content")
    )).toBe(true);
    expect(readDomainNodes().map((node) => node.data.assetId)).toEqual([
      "asset-original",
      "asset-edited"
    ]);
    expect(JSON.stringify(readDomainNodes())).not.toContain("data:image");
    expect(JSON.stringify(readDomainNodes())).not.toContain("referenceImage");
  });

  it("keeps temporary guest Canvas available while Save and Open stay disabled", async () => {
    const fetchMock = installCanvasFetch();
    await mount();

    expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeTruthy();
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    )?.disabled).toBe(true);
    expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    )?.disabled).toBe(true);
    expect(getCanvasDocumentCalls(fetchMock)).toHaveLength(0);
  });

  it("waits for same-page authentication before loading a private Canvas and loads it once", async () => {
    const savedDocument = createImageDocument({ targetAssetId: "private-asset" });
    const savedDraft = createCreatorImageComposerDraft(canvasImageModel.slug);
    savedDraft.prompt = "Private restored prompt";
    const pendingDetail = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/canvas/documents/private-doc")) {
        return pendingDetail.promise;
      }
      return new Response("not found", { status: 404 });
    });
    window.history.replaceState({}, "", "/canvas?canvasId=private-doc");

    await mount({ initialModels: [canvasImageModel] }, { workspaceProvider: true });
    expect(host?.querySelector('[data-creator-canvas-persistence-fence="auth-required"]'))
      .toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeNull();
    expect(getCanvasDocumentCalls(fetchMock, "GET")).toHaveLength(0);
    if (!setAuthSessionForTest) throw new Error("AUTH_SESSION_PROBE_MISSING");

    await act(async () => setAuthSessionForTest?.({
      token: "private-canvas-token",
      user: {
        id: "canvas-user",
        email: "canvas@example.test",
        role: "USER",
        credits: 20,
        name: "Canvas User"
      }
    }));
    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "GET"))
      .toHaveLength(1));
    expect(host?.querySelector('[data-creator-canvas-persistence-fence="loading"]'))
      .toBeTruthy();

    await act(async () => pendingDetail.resolve(
      persistedCanvasDocumentResponse(
        "private-doc",
        4,
        savedDocument,
        new Map([["image-target", savedDraft]])
      )
    ));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-root="true"]'
    )).toBeTruthy());
    expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
      .toBe("private-asset");
    expect(getHistoryButton("undo").disabled).toBe(true);
    expect(getHistoryButton("redo").disabled).toBe(true);

    await act(async () => setAuthSessionForTest?.({
      token: "private-canvas-token",
      user: {
        id: "canvas-user",
        email: "canvas@example.test",
        role: "USER",
        credits: 20,
        name: "Canvas User"
      }
    }));
    await settle();
    expect(getCanvasDocumentCalls(fetchMock, "GET")).toHaveLength(1);
    expect(host?.querySelector('[data-creator-canvas-persistence-fence]')).toBeNull();
  });

  it("fences the previous owner's private Canvas when authenticated identity changes", async () => {
    const userADocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "user-a-private-text",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "User A private Canvas content" }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const pendingUserBDetail = createDeferred<Response>();
    const detailAuthorizationHeaders: string[] = [];
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/canvas/documents/private-doc")) {
        detailAuthorizationHeaders.push(
          new Headers(init.headers).get("Authorization") ?? ""
        );
        const authorization = detailAuthorizationHeaders.at(-1);
        if (authorization === "Bearer user-a-token") {
          return persistedCanvasDocumentResponse(
            "private-doc",
            7,
            userADocument,
            new Map(),
            "User A Private Canvas"
          );
        }
        if (authorization === "Bearer user-b-token") {
          return pendingUserBDetail.promise;
        }
      }
      return new Response("not found", { status: 404 });
    });
    window.localStorage.setItem("ai-aggregate-token", "user-a-token");
    window.localStorage.setItem("ai-aggregate-user", JSON.stringify({
      id: "user-a",
      email: "user-a@example.test",
      role: "USER",
      credits: 20,
      name: "User A"
    }));
    window.history.replaceState({}, "", "/canvas?canvasId=private-doc");

    await mount({ initialModels: [canvasImageModel] }, { workspaceProvider: true });
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-root="true"]'
    )).toBeTruthy());
    await waitForCanvas(() => expect(currentTitleForTest).toBe("User A Private Canvas"));
    expect(readDomainNodes().find((node) => node.id === "user-a-private-text")?.data.text)
      .toBe("User A private Canvas content");
    expect(getCanvasDocumentCalls(fetchMock, "GET")).toHaveLength(1);
    expect(detailAuthorizationHeaders).toEqual(["Bearer user-a-token"]);

    if (!setAuthSessionForTest) throw new Error("AUTH_SESSION_PROBE_MISSING");
    await act(async () => setAuthSessionForTest?.({
      token: "user-b-token",
      user: {
        id: "user-b",
        email: "user-b@example.test",
        role: "USER",
        credits: 20,
        name: "User B"
      }
    }));

    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "GET"))
      .toHaveLength(2));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-persistence-fence="loading"]'
    )).toBeTruthy());
    expect(detailAuthorizationHeaders).toEqual([
      "Bearer user-a-token",
      "Bearer user-b-token"
    ]);
    expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeNull();
    expect(currentTitleForTest).toBeNull();
    expect(host?.querySelector('[data-creator-canvas-saved-documents-dialog="true"]'))
      .toBeNull();
    expect(host?.textContent).not.toContain("User A Private Canvas");
    expect(host?.textContent).not.toContain("User A private Canvas content");

    await act(async () => pendingUserBDetail.resolve(
      new Response("not found", { status: 404 })
    ));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-persistence-fence="error"]'
    )).toBeTruthy());
    expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeNull();
    expect(currentTitleForTest).toBeNull();
    expect(host?.textContent).not.toContain("User A Private Canvas");
    expect(host?.textContent).not.toContain("User A private Canvas content");
    expect(getCanvasDocumentCalls(fetchMock, "GET")).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });

  it("fences a loaded private Canvas on logout and reloads it once after same-page re-authentication", async () => {
    const savedDocument = createImageDocument({ targetAssetId: "private-asset" });
    let detailRequestCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/canvas/documents/private-doc")) {
        detailRequestCount += 1;
        return persistedCanvasDocumentResponse(
          "private-doc",
          4,
          savedDocument,
          new Map(),
          detailRequestCount === 1 ? "Account One Canvas" : "Account Two Canvas"
        );
      }
      return new Response("not found", { status: 404 });
    });
    window.history.replaceState({}, "", "/canvas?canvasId=private-doc");

    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-root="true"]'
    )).toBeTruthy());
    expect(getCanvasDocumentCalls(fetchMock, "GET")).toHaveLength(1);
    expect(currentTitleForTest).toBe("Account One Canvas");
    if (!logoutForTest || !setAuthSessionForTest) {
      throw new Error("AUTH_SESSION_PROBE_MISSING");
    }

    await act(async () => logoutForTest?.());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-persistence-fence="auth-required"]'
    )).toBeTruthy());
    expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeNull();
    expect(getCanvasDocumentCalls(fetchMock, "GET")).toHaveLength(1);
    expect(currentTitleForTest).toBeNull();

    await act(async () => setAuthSessionForTest?.({
      token: "private-canvas-token-2",
      user: {
        id: "canvas-user-2",
        email: "canvas-two@example.test",
        role: "USER",
        credits: 20,
        name: "Canvas User Two"
      }
    }));
    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "GET"))
      .toHaveLength(2));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-root="true"]'
    )).toBeTruthy());
    await settle();
    expect(getCanvasDocumentCalls(fetchMock, "GET")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/canvas/documents/private-doc")
    ).at(-1)?.[1]).toEqual(expect.objectContaining({
      headers: { Authorization: "Bearer private-canvas-token-2" }
    }));
    expect(currentTitleForTest).toBe("Account Two Canvas");
  });

  it("uses a loading fence and restores a saved document, drafts, viewport, and empty history", async () => {
    const savedDocument = createImageDocument({
      targetAssetId: "saved-asset",
      withTextEdge: true
    });
    const savedDraft = createCreatorImageComposerDraft(canvasImageModel.slug);
    savedDraft.prompt = "Persisted Composer prompt";
    savedDraft.aspectRatio = "16:9";
    savedDraft.count = 4;
    savedDraft.operation = "edit";
    savedDraft.selectedImageReferenceNodeId = "text-source";
    savedDraft.promptDirty = true;
    const pendingDetail = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/canvas/documents/saved-doc")) {
        return pendingDetail.promise;
      }
      return new Response("not found", { status: 404 });
    });
    window.history.replaceState({}, "", "/canvas?canvasId=saved-doc");

    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });
    expect(host?.querySelector('[data-creator-canvas-persistence-fence="loading"]'))
      .toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeNull();
    expect(getCanvasDocumentCalls(fetchMock, "GET")).toHaveLength(1);
    expect(fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/canvas/documents/saved-doc")
    )?.[1]).toEqual(expect.objectContaining({
      headers: { Authorization: "Bearer canvas-owner-token" },
      signal: expect.any(AbortSignal)
    }));

    await act(async () => pendingDetail.resolve(
      persistedCanvasDocumentResponse(
        "saved-doc",
        3,
        savedDocument,
        new Map([["image-target", savedDraft]]),
        "Restored Canvas"
      )
    ));
    await waitForCanvas(() => {
      expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeTruthy();
      expect(readDomainNodes().find((node) => node.id === "image-target")?.data.assetId)
        .toBe("saved-asset");
    });

    expect(readDomainNodes()).toHaveLength(2);
    expect(readDomainEdges()).toEqual([expect.objectContaining({
      id: "text-edge",
      source: "text-source",
      sourceHandle: "source",
      target: "image-target",
      targetHandle: "target",
      selected: false
    })]);
    expect(host?.querySelector('[data-creator-canvas-root="true"]')
      ?.getAttribute("data-creator-canvas-viewport")).toBe("-10,15,1");
    expect(getHistoryButton("undo").disabled).toBe(true);
    expect(getHistoryButton("redo").disabled).toBe(true);
    expect(host?.querySelector('[data-creator-canvas-persistence-status="true"]')
      ?.textContent).toContain("Saved");
    expect(currentTitleForTest).toBe("Restored Canvas");
    await act(async () => selectOnlyNodeIds(["image-target"]));
    expect(getComposerPrompt().value).toBe("Persisted Composer prompt");
  });

  it("creates then patches one saved Canvas document without clearing history", async () => {
    let nextRevision = 1;
    const persistenceId = "saved-from-create";
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/canvas/documents")) {
        const body = JSON.parse(String(init.body)) as {
          state: { document: CreatorCanvasDocumentV1 };
          title: string | null;
        };
        expect(body.title).toBe("Saved text");
        return persistedCanvasDocumentResponse(
          persistenceId,
          nextRevision,
          body.state.document,
          new Map(),
          body.title
        );
      }
      if (init?.method === "PATCH" && url.endsWith(`/canvas/documents/${persistenceId}`)) {
        const body = JSON.parse(String(init.body)) as {
          state: { document: CreatorCanvasDocumentV1 };
          expectedRevision: number;
          title?: string | null;
        };
        expect(body.expectedRevision).toBe(1);
        expect(Object.prototype.hasOwnProperty.call(body, "title")).toBe(false);
        nextRevision = 2;
        return persistedCanvasDocumentResponse(
          persistenceId,
          nextRevision,
          body.state.document,
          new Map(),
          "Saved text"
        );
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });

    await act(async () => clickCreate("text"));
    const textInput = getTextInputForNode(getMockNode("text").id);
    await act(async () => setTextareaValue(textInput, "Saved text"));
    await act(async () => textInput.blur());
    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    if (!save) throw new Error("CANVAS_SAVE_BUTTON_MISSING");
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "POST"))
      .toHaveLength(1));
    expect(window.location.search).toBe(`?canvasId=${persistenceId}`);
    expect(host?.querySelector('[data-creator-canvas-persistence-status="true"]')
      ?.textContent).toContain("Saved");
    expect(currentTitleForTest).toBe("Saved text");

    await act(async () => setTextareaValue(textInput, "Saved text changed"));
    await act(async () => textInput.blur());
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "PATCH"))
      .toHaveLength(1));
    expect(readDomainNodes().find((node) => node.kind === "text")?.data.text)
      .toBe("Saved text changed");
    expect(getHistoryButton("undo").disabled).toBe(false);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
  });

  it("renames the current Canvas without replacing dirty work and saves with the new revision", async () => {
    let revision = 1;
    let persistedTitle = "";
    let persistedDocument: CreatorCanvasDocumentV1 | null = null;
    const persistenceId = "dirty-rename-canvas";
    const responseForCurrentDocument = () => {
      if (!persistedDocument) throw new Error("PERSISTED_CANVAS_DOCUMENT_MISSING");
      return persistedCanvasDocumentResponse(
        persistenceId,
        revision,
        persistedDocument,
        new Map(),
        persistedTitle || null
      );
    };
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/canvas/documents")) {
        const body = JSON.parse(String(init.body)) as {
          state: { document: CreatorCanvasDocumentV1 };
          title: string | null;
        };
        persistedDocument = body.state.document;
        persistedTitle = body.title ?? "";
        return responseForCurrentDocument();
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({
          documents: [{
            id: persistenceId,
            title: persistedTitle || null,
            revision,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-02T10:00:00.000Z"
          }]
        });
      }
      if (init?.method === "PATCH" && url.endsWith(`/canvas/documents/${persistenceId}`)) {
        const body = JSON.parse(String(init.body)) as {
          expectedRevision: number;
          state?: { document: CreatorCanvasDocumentV1 };
          title?: string | null;
        };
        if (body.title !== undefined) {
          expect(body.expectedRevision).toBe(1);
          expect(body.state).toBeUndefined();
          persistedTitle = body.title ?? "";
          revision = 2;
        } else {
          expect(body.expectedRevision).toBe(2);
          expect(body.state).toBeDefined();
          persistedDocument = body.state?.document ?? null;
          revision = 3;
        }
        return responseForCurrentDocument();
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });

    await act(async () => clickCreate("text"));
    const textInput = getTextInputForNode(getMockNode("text").id);
    await act(async () => setTextareaValue(textInput, "Initial saved text"));
    await act(async () => textInput.blur());
    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    if (!save) throw new Error("CANVAS_SAVE_BUTTON_MISSING");
    await act(async () => save.click());
    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "POST"))
      .toHaveLength(1));
    expect(currentTitleForTest).toBe("Initial saved text");

    await act(async () => setTextareaValue(textInput, "Dirty local work"));
    await act(async () => textInput.blur());
    expect(save.disabled).toBe(false);
    const undoDisabledBeforeRename = getHistoryButton("undo").disabled;

    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!open) throw new Error("CANVAS_OPEN_BUTTON_MISSING");
    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-list="true"]'
    )).toBeTruthy());
    const rename = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename="true"]'
    );
    if (!rename) throw new Error("CANVAS_SAVED_DOCUMENT_RENAME_MISSING");
    await act(async () => rename.click());
    const renameInput = host?.querySelector<HTMLInputElement>(
      '[data-creator-canvas-saved-document-rename-input="true"]'
    );
    const renameSave = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-rename-save="true"]'
    );
    if (!renameInput || !renameSave) throw new Error("CANVAS_RENAME_FORM_MISSING");
    await act(async () => setInputValue(renameInput, "Renamed current Canvas"));
    await act(async () => renameSave.click());
    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "PATCH"))
      .toHaveLength(1));
    await waitForCanvas(() => expect(host?.textContent).toContain("Renamed current Canvas"));

    expect(readDomainNodes().find((node) => node.kind === "text")?.data.text)
      .toBe("Dirty local work");
    expect(currentTitleForTest).toBe("Renamed current Canvas");
    expect(getHistoryButton("undo").disabled).toBe(undoDisabledBeforeRename);
    expect(save.disabled).toBe(false);

    const close = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-documents-close="true"]'
    );
    if (!close) throw new Error("CANVAS_SAVED_DOCUMENT_CLOSE_MISSING");
    await act(async () => close.click());
    await settle();
    await act(async () => save.click());
    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "PATCH"))
      .toHaveLength(2));

    expect(readDomainNodes().find((node) => node.kind === "text")?.data.text)
      .toBe("Dirty local work");
    expect(currentTitleForTest).toBe("Renamed current Canvas");
    expect(getHistoryButton("undo").disabled).toBe(undoDisabledBeforeRename);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });

  it("guards View all canvases with the existing dirty-work discard confirmation", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "GET" && String(input).endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({ documents: [] });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });

    await act(async () => clickCreate("text"));
    const textInput = getTextInputForNode(getMockNode("text").id);
    await act(async () => setTextareaValue(textInput, "Unsaved library navigation work"));
    await act(async () => textInput.blur());

    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!open) throw new Error("CANVAS_OPEN_BUTTON_MISSING");
    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-state="empty"]'
    )).toBeTruthy());

    const viewAll = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-documents-view-all="true"]'
    );
    if (!viewAll) throw new Error("CANVAS_VIEW_ALL_MISSING");
    const confirmMock = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await act(async () => viewAll.click());
    expect(confirmMock).toHaveBeenCalledWith("Discard unsaved Canvas changes?");
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(readDomainNodes().find((node) => node.kind === "text")?.data.text)
      .toBe("Unsaved library navigation work");

    await act(async () => viewAll.click());
    expect(routerPushMock).toHaveBeenCalledWith("/canvas/library");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate")))
      .toBe(false);
  });

  it("keeps local state dirty after a stale PATCH conflict", async () => {
    let patchCalled = false;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/canvas/documents")) {
        const body = JSON.parse(String(init.body)) as {
          state: { document: CreatorCanvasDocumentV1 };
        };
        return persistedCanvasDocumentResponse(
          "conflict-canvas",
          1,
          body.state.document
        );
      }
      if (init?.method === "PATCH" && url.endsWith("/canvas/documents/conflict-canvas")) {
        patchCalled = true;
        return jsonResponse({
          code: "CANVAS_DOCUMENT_REVISION_CONFLICT",
          message: "canvas document was updated elsewhere"
        }, 409);
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });
    await act(async () => clickCreate("text"));
    const textInput = getTextInputForNode(getMockNode("text").id);
    await act(async () => setTextareaValue(textInput, "Conflict baseline"));
    await act(async () => textInput.blur());
    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    if (!save) throw new Error("CANVAS_SAVE_BUTTON_MISSING");
    await act(async () => save.click());
    await waitForCanvas(() => expect(window.location.search).toContain("conflict-canvas"));
    await act(async () => setTextareaValue(textInput, "Local conflict text"));
    await act(async () => textInput.blur());
    await act(async () => save.click());
    await waitForCanvas(() => expect(patchCalled).toBe(true));
    expect(readDomainNodes().find((node) => node.kind === "text")?.data.text)
      .toBe("Local conflict text");
    expect(host?.querySelector('[data-creator-canvas-persistence-status="true"]')
      ?.textContent).toContain("Save conflict");
    expect(save.disabled).toBe(false);
  });

  it("keeps Text manually editable, discovers chat models, and hides the Text composer for non-Text selection", async () => {
    const fetchMock = installCanvasRuntimeFetch(async () =>
      new Response("not found", { status: 404 }),
    [canvasImageModel, canvasChatModel, canvasChatModelTwo]);
    await mount({
      initialDocument: createTextAiDocument({ instruction: "", modelId: "" }),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });

    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-text-ai-composer="true"]'
    )).toBeTruthy());
    expect(getTextAiModelDiscoveryCalls(fetchMock)).toHaveLength(1);
    expect(getTextAiModel().options).toHaveLength(2);
    expect(Array.from(getTextAiModel().options, (option) => option.value))
      .toEqual([canvasChatModel.modelId, canvasChatModelTwo.modelId]);

    await act(async () => selectOnlyNodeIds(["text-source"]));
    const sourceInput = getTextInputForNode("text-source");
    await act(async () => setTextareaValue(sourceInput, "Manual Text A"));
    await act(async () => sourceInput.blur());
    expect(getTextNodeData("text-source")?.text).toBe("Manual Text A");
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(0);

    await act(async () => clickCreate("image"));
    const imageNode = getReactFlowProps().nodes.find((node) => node.type === "image");
    if (!imageNode) throw new Error("CANVAS_IMAGE_NODE_MISSING");
    await act(async () => selectOnlyNodeIds([imageNode.id]));
    expect(host?.querySelector('[data-creator-text-ai-composer="true"]')).toBeNull();
    expect(host?.querySelector('[data-creator-image-workspace="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creator-image-node-toolbar="true"]')).toBeNull();
  });

  it("only renders the Text Workspace for one node with no selected edge and closes on selection changes", async () => {
    installCanvasFetch([canvasImageModel, canvasChatModel]);
    await mount({ initialDocument: createTextAiDocument() });
    setMockCanvasBounds(1_000, 800);

    await act(async () => selectOnlyNodeIds(["text-target"]));
    const workspace = () => host?.querySelector<HTMLElement>(
      '[data-creator-node-workspace="true"]'
    );
    expect(workspace()).toBeTruthy();
    const initialSize = workspace()?.getAttribute("data-creator-node-workspace-size");
    await moveViewport({ x: 120, y: -40, zoom: 0.5 });
    expect(workspace()?.getAttribute("data-creator-node-workspace-size")).toBe(initialSize);

    await act(async () => selectOnlyNodeIds(["text-source", "text-target"]));
    expect(workspace()).toBeNull();

    await act(async () => selectOnlyNodeIds(["text-target"]));
    await act(async () => getReactFlowProps().onEdgesChange([{
      type: "select",
      id: "text-source-target",
      selected: true
    }]));
    expect(workspace()).toBeNull();

    await act(async () => getReactFlowProps().onEdgesChange([{
      type: "select",
      id: "text-source-target",
      selected: false
    }]));
    await act(async () => selectOnlyNodeIds(["text-target"]));
    expect(workspace()).toBeTruthy();
    await act(async () => selectOnlyNodeIds([]));
    expect(workspace()).toBeNull();

    await act(async () => selectOnlyNodeIds(["text-target"]));
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: "text-target"
    }]));
    await settle();
    expect(workspace()).toBeNull();
    expect(getTextNodeData("text-target")).toBeUndefined();
  });

  it("finishes the existing Text history transaction when the Workspace closes", async () => {
    installCanvasFetch([canvasImageModel, canvasChatModel]);
    await mount({ initialDocument: createTextAiDocument({ targetText: "before close" }) });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    const editor = getTextInputForNode("text-target");
    await act(async () => {
      editor.focus();
      setTextareaValue(editor, "after close");
    });
    expect(getTextNodeData("text-target")?.text).toBe("after close");

    const close = host?.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-close="true"]'
    );
    if (!close) throw new Error("CREATOR_WORKSPACE_CLOSE_MISSING");
    await act(async () => close.click());
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeNull();
    await clickHistory("undo");
    expect(getTextNodeData("text-target")?.text).toBe("before close");
  });

  it("keeps one Text AI execution identity when the selected Workspace enters Focus", async () => {
    const pendingCompletion = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));

    const expand = host?.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-expand="true"]'
    );
    if (!expand) throw new Error("CREATOR_WORKSPACE_EXPAND_MISSING");
    await act(async () => expand.click());
    const focusExecute = document.body.querySelector<HTMLButtonElement>(
      '[data-creator-text-ai-execute="true"]'
    );
    if (!focusExecute) throw new Error("CREATOR_FOCUS_TEXT_AI_EXECUTE_MISSING");
    await act(async () => focusExecute.click());
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);

    await act(async () => pendingCompletion.resolve(
      jsonResponse({ content: "Focused AI result" })
    ));
    await waitForCanvas(() => expect(getTextNodeData("text-target")?.text)
      .toBe("Focused AI result"));
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);

    const closeFocus = document.body.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-focus-close="true"]'
    );
    if (!closeFocus) throw new Error("CREATOR_FOCUS_CLOSE_MISSING");
    await act(async () => closeFocus.click());
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeTruthy();
    expect(getTextNodeData("text-target")?.text).toBe("Focused AI result");
  });

  it("closes the selected Workspace when New resets the Canvas", async () => {
    installCanvasFetch([canvasImageModel]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount({ initialDocument: createTextAiDocument() });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeTruthy();

    const newCanvas = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="new"]'
    );
    if (!newCanvas) throw new Error("CANVAS_NEW_BUTTON_MISSING");
    await act(async () => newCanvas.click());
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeNull();
    expect(readDomainNodes()).toHaveLength(0);
  });

  it("closes the selected Workspace as soon as Open opens the saved-document surface", async () => {
    installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "GET" && String(input).endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({ documents: [] });
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({ initialDocument: createTextAiDocument() }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeTruthy();

    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!open) throw new Error("CANVAS_OPEN_BUTTON_MISSING");
    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-state="empty"]'
    )).toBeTruthy());
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeNull();
  });

  it("closes Workspace and Focus after an authenticated identity transition", async () => {
    installCanvasFetch([canvasImageModel, canvasChatModel]);
    await mount({ initialDocument: createTextAiDocument() }, { authenticated: true });
    if (!setAuthSessionForTest) throw new Error("AUTH_SESSION_PROBE_MISSING");
    await act(async () => selectOnlyNodeIds(["text-target"]));
    const expand = host?.querySelector<HTMLButtonElement>(
      '[data-creator-node-workspace-expand="true"]'
    );
    if (!expand) throw new Error("CREATOR_WORKSPACE_EXPAND_MISSING");
    await act(async () => expand.click());
    expect(document.body.querySelector('[data-creator-node-workspace-focus="true"]'))
      .toBeTruthy();

    await act(async () => setAuthSessionForTest?.({
      token: "identity-transition-token",
      user: {
        id: "identity-transition-user",
        email: "identity-transition@example.test",
        role: "USER",
        credits: 20,
        name: "Identity Transition"
      }
    }));
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-node-workspace="true"]'
    )).toBeNull());
    expect(document.body.querySelector('[data-creator-node-workspace-focus="true"]'))
      .toBeNull();
  });

  it("persists Text AI instruction and explicit model changes while reconciling stale models at runtime", async () => {
    const document = createTextAiDocument({
      instruction: "Existing instruction",
      modelId: "stale-chat-model"
    });
    const fetchMock = installCanvasRuntimeFetch(async () =>
      new Response("not found", { status: 404 }),
    [canvasImageModel, canvasChatModel, canvasChatModelTwo]);
    await mount({
      initialDocument: document,
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiModel().value).toBe(canvasChatModel.modelId));
    expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "Existing instruction",
      modelId: "stale-chat-model"
    });

    await act(async () => setTextareaValue(
      getTextAiInstruction(),
      "  Rewrite the source as a short script  "
    ));
    await waitForCanvas(() => expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "  Rewrite the source as a short script  ",
      modelId: "stale-chat-model"
    }));

    await act(async () => setSelectValue(getTextAiModel(), canvasChatModelTwo.modelId));
    await waitForCanvas(() => expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "  Rewrite the source as a short script  ",
      modelId: canvasChatModelTwo.modelId
    }));
    expect(getTextNodeData("text-target")?.text).toBe("Old Text B output");
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(0);
  });

  it("blocks Text execution for blank instructions, missing chat models, and guests", async () => {
    const blankFetch = installCanvasRuntimeFetch(async () =>
      new Response("not found", { status: 404 }),
    [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument({ instruction: "", modelId: "" }),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiModel().value).toBe(canvasChatModel.modelId));
    expect(getTextAiExecuteButton().disabled).toBe(true);
    await act(async () => getTextAiExecuteButton().click());
    expect(getTextAiCompletionCalls(blankFetch)).toHaveLength(0);

    await act(async () => root?.unmount());
    host?.remove();
    latestReactFlowProps = null;
    window.localStorage.clear();
    const noModelFetch = installCanvasRuntimeFetch(async () =>
      new Response("not found", { status: 404 }),
    [canvasImageModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiModel().disabled).toBe(true));
    expect(getTextAiExecuteButton().disabled).toBe(true);
    expect(getTextAiCompletionCalls(noModelFetch)).toHaveLength(0);

    await act(async () => root?.unmount());
    host?.remove();
    latestReactFlowProps = null;
    window.localStorage.clear();
    const guestFetch = installCanvasRuntimeFetch(async () =>
      new Response("not found", { status: 404 }),
    [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiModel().value).toBe(canvasChatModel.modelId));
    expect(getTextAiExecuteButton().disabled).toBe(true);
    expect(host?.querySelector('[data-creator-text-ai-error="true"]')).toBeNull();
    expect(getTextAiCompletionCalls(guestFetch)).toHaveLength(0);
  });

  it("executes one stateless Text completion, preserves config, refreshes quota, and makes one undoable output step", async () => {
    let completionBody: Record<string, unknown> | null = null;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        completionBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({ content: "  Generated Text B output  " });
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    const quotaCallsBefore = getQuotaCalls(fetchMock).length;

    await act(async () => getTextAiExecuteButton().click());
    await waitForCanvas(() => expect(getTextNodeData("text-target")?.text)
      .toBe("Generated Text B output"));
    await waitForCanvas(() => expect(getQuotaCalls(fetchMock).length)
      .toBeGreaterThan(quotaCallsBefore));

    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
    expect(completionBody).toMatchObject({
      stateless: true,
      model: canvasChatModel.modelId,
      messages: [{
        role: "user",
        content: "context:\n[1]\nSource Text A\n\ninstruction:\nGenerate a short script from the upstream content"
      }]
    });
    expect(completionBody).not.toHaveProperty("sessionId");
    const completionCall = getTextAiCompletionCalls(fetchMock)[0];
    expect(new Headers(completionCall?.[1]?.headers).get("Authorization"))
      .toBe("Bearer canvas-owner-token");
    expect(getTextNodeData("text-source")?.text).toBe("Source Text A");
    expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "Generate a short script from the upstream content",
      modelId: canvasChatModel.modelId
    });
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes("/image/generate") || String(input).includes("/video/generate")
    )).toBe(false);

    await clickHistory("undo");
    expect(getTextNodeData("text-target")?.text).toBe("Old Text B output");
    expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "Generate a short script from the upstream content",
      modelId: canvasChatModel.modelId
    });
    await clickHistory("redo");
    expect(getTextNodeData("text-target")?.text).toBe("Generated Text B output");
    expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "Generate a short script from the upstream content",
      modelId: canvasChatModel.modelId
    });
  });

  it("interleaves a pending Text AI result with an open Text edit transaction", async () => {
    const pendingCompletion = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument({
        sourceText: "a",
        targetText: "Old AI output"
      }),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });

    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());

    await act(async () => selectOnlyNodeIds(["text-source"]));
    const manualInput = getTextInputForNode("text-source");
    await act(async () => {
      manualInput.focus();
      setTextareaValue(manualInput, "ab");
    });

    await act(async () => pendingCompletion.resolve(
      jsonResponse({ content: "Generated AI output" })
    ));
    await waitForCanvas(() => expect(getTextNodeData("text-target")?.text)
      .toBe("Generated AI output"));
    expect(getTextNodeData("text-source")?.text).toBe("ab");

    const manualInputAfterResult = getTextInputForNode("text-source");
    await act(async () => setTextareaValue(manualInputAfterResult, "abc"));
    await act(async () => manualInputAfterResult.blur());
    await settle();

    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    expect(getTextNodeData("text-source")?.text).toBe("abc");
    expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "Generate a short script from the upstream content",
      modelId: canvasChatModel.modelId
    });

    await clickHistory("undo");
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    expect(getTextNodeData("text-source")?.text).toBe("a");
    await clickHistory("undo");
    expect(getTextNodeData("text-target")?.text).toBe("Old AI output");
    expect(getTextNodeData("text-source")?.text).toBe("a");

    await clickHistory("redo");
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    expect(getTextNodeData("text-source")?.text).toBe("a");
    await clickHistory("redo");
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    expect(getTextNodeData("text-source")?.text).toBe("abc");
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
  });

  it("rebases a same-target Text edit around a pending AI result without splitting history", async () => {
    const pendingCompletion = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument({
        targetText: "Old AI output"
      }),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });

    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());

    const targetInput = getTextInputForNode("text-target");
    await act(async () => {
      targetInput.focus();
      setTextareaValue(targetInput, "Manual target draft");
    });

    await act(async () => pendingCompletion.resolve(
      jsonResponse({ content: "Generated AI output" })
    ));
    await waitForCanvas(() => expect(getTextNodeData("text-target")?.text)
      .toBe("Generated AI output"));

    const targetInputAfterResult = getTextInputForNode("text-target");
    await act(async () => setTextareaValue(
      targetInputAfterResult,
      "Generated AI output continued"
    ));
    await act(async () => targetInputAfterResult.blur());
    await settle();

    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output continued");
    expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "Generate a short script from the upstream content",
      modelId: canvasChatModel.modelId
    });
    await clickHistory("undo");
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    expect(getTextNodeData("text-target")?.ai).toEqual({
      instruction: "Generate a short script from the upstream content",
      modelId: canvasChatModel.modelId
    });
    await clickHistory("undo");
    expect(getTextNodeData("text-target")?.text).toBe("Old AI output");
    await clickHistory("redo");
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    await clickHistory("redo");
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output continued");
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
  });

  it("interleaves a pending Text AI result with an active Text drag transaction", async () => {
    const pendingCompletion = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument({ targetText: "Old AI output" }),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });

    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());
    const dragNode = getReactFlowProps().nodes.find((node) => node.id === "text-target");
    if (!dragNode) throw new Error("TEXT_DRAG_NODE_MISSING");
    await act(async () => {
      getReactFlowProps().onNodeDragStart(null, dragNode, [dragNode]);
      getReactFlowProps().onNodesChange([{
        type: "position",
        id: dragNode.id,
        position: { x: 640, y: 160 },
        dragging: true
      }]);
    });

    await act(async () => pendingCompletion.resolve(
      jsonResponse({ content: "Generated AI output" })
    ));
    await waitForCanvas(() => expect(getTextNodeData("text-target")?.text)
      .toBe("Generated AI output"));
    await act(async () => {
      getReactFlowProps().onNodesChange([{
        type: "position",
        id: dragNode.id,
        position: { x: 720, y: 240 },
        dragging: true
      }]);
      getReactFlowProps().onNodeDragStop(null, dragNode, [dragNode]);
    });
    await settle();

    expect(getReactFlowProps().nodes.find((node) => node.id === "text-target")?.position)
      .toEqual({ x: 720, y: 240 });
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    await clickHistory("undo");
    expect(getReactFlowProps().nodes.find((node) => node.id === "text-target")?.position)
      .toEqual({ x: 420, y: 0 });
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    await clickHistory("undo");
    expect(getReactFlowProps().nodes.find((node) => node.id === "text-target")?.position)
      .toEqual({ x: 420, y: 0 });
    expect(getTextNodeData("text-target")?.text).toBe("Old AI output");
    await clickHistory("redo");
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    await clickHistory("redo");
    expect(getReactFlowProps().nodes.find((node) => node.id === "text-target")?.position)
      .toEqual({ x: 720, y: 240 });
    expect(getTextNodeData("text-target")?.text).toBe("Generated AI output");
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
  });

  it.each([
    ["non-ok", () => new Response("failure", { status: 502 })],
    ["malformed", () => jsonResponse({ choices: [] })],
    ["blank", () => jsonResponse({ content: "   " })]
  ])("leaves the previous Text output unchanged for a %s completion", async (_label, response) => {
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return response();
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-text-ai-error="true"]'
    )).toBeTruthy());
    expect(getTextNodeData("text-target")?.text).toBe("Old Text B output");
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
  });

  it("does not issue parallel Text completions after a rapid double Execute", async () => {
    const pendingCompletion = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    const execute = getTextAiExecuteButton();
    await act(async () => {
      execute.click();
      execute.click();
    });
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
    expect(getTextAiExecuteButton().disabled).toBe(true);
    await act(async () => pendingCompletion.resolve(jsonResponse({ content: "Generated once" })));
    await waitForCanvas(() => expect(getTextNodeData("text-target")?.text)
      .toBe("Generated once"));
  });

  it("saves and reopens Text output and AI configuration through the existing Canvas persistence path", async () => {
    let savedDocument: CreatorCanvasDocumentV1 | null = null;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/canvas/documents")) {
        const body = JSON.parse(String(init.body)) as {
          state: { document: CreatorCanvasDocumentV1 };
        };
        savedDocument = body.state.document;
        expect(savedDocument.nodes.find((node) => node.id === "text-target"))
          .toMatchObject({
            data: {
              text: "Old Text B output",
              ai: {
                instruction: "Generate a short script from the upstream content",
                modelId: canvasChatModel.modelId
              }
            }
          });
        return persistedCanvasDocumentResponse(
          "saved-text-ai",
          1,
          body.state.document,
          new Map(),
          "Saved Text AI Canvas"
        );
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({
          documents: [{
            id: "saved-text-ai",
            title: "Saved Text AI Canvas",
            revision: 1,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-02T10:00:00.000Z"
          }]
        });
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents/saved-text-ai")) {
        if (!savedDocument) throw new Error("SAVED_TEXT_AI_DOCUMENT_MISSING");
        return persistedCanvasDocumentResponse(
          "saved-text-ai",
          1,
          savedDocument,
          new Map(),
          "Saved Text AI Canvas"
        );
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!save || !open) throw new Error("CANVAS_PERSISTENCE_ACTION_MISSING");
    await act(async () => save.click());
    await waitForCanvas(() => expect(getCanvasDocumentCalls(fetchMock, "POST"))
      .toHaveLength(1));
    expect(window.location.search).toBe("?canvasId=saved-text-ai");

    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-list="true"]'
    )).toBeTruthy());
    const openSaved = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-open="true"]'
    );
    if (!openSaved) throw new Error("SAVED_TEXT_AI_OPEN_MISSING");
    await act(async () => openSaved.click());
    await waitForCanvas(() => expect(currentTitleForTest).toBe("Saved Text AI Canvas"));
    expect(getTextNodeData("text-target")).toEqual({
      text: "Old Text B output",
      ai: {
        instruction: "Generate a short script from the upstream content",
        modelId: canvasChatModel.modelId
      }
    });
  });

  it("copies Text to Text edges with AI config and duplicates a Text node without sharing semantic data", async () => {
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    });
    await act(async () => selectOnlyNodeIds(["text-source", "text-target"]));
    expect(await pressCanvasShortcut("c", { ctrlKey: true })).toBe(true);
    expect(await pressCanvasShortcut("v", { ctrlKey: true })).toBe(true);
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(4));
    const originalIds = new Set(["text-source", "text-target"]);
    const pastedNodes = readDomainNodes().filter((node) => !originalIds.has(node.id));
    expect(pastedNodes).toHaveLength(2);
    const pastedTarget = pastedNodes.find((node) => node.data.text === "Old Text B output");
    if (!pastedTarget) throw new Error("PASTED_TEXT_TARGET_MISSING");
    expect(pastedTarget.data.ai).toEqual({
      instruction: "Generate a short script from the upstream content",
      modelId: canvasChatModel.modelId
    });
    const pastedEdge = readDomainEdges().find((edge) =>
      edge.source === pastedNodes.find((node) => node.data.text === "Source Text A")?.id &&
      edge.target === pastedTarget.id
    );
    expect(pastedEdge).toMatchObject({
      sourceHandle: "source",
      targetHandle: "target"
    });

    await act(async () => selectOnlyNodeIds(["text-target"]));
    const originalTarget = host?.querySelector<HTMLElement>(
      '[data-mock-node-id="text-target"]'
    );
    if (!originalTarget) throw new Error("ORIGINAL_TEXT_TARGET_MISSING");
    await act(async () => originalTarget.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 180
    })));
    const duplicate = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-node-action="duplicate"]'
    );
    if (!duplicate) throw new Error("TEXT_DUPLICATE_ACTION_MISSING");
    await act(async () => duplicate.click());
    const duplicatedNode = readDomainNodes().find((node) =>
      node.id !== "text-source" &&
      node.id !== "text-target" &&
      !pastedNodes.some((pasted) => pasted.id === node.id) &&
      node.data.text === "Old Text B output"
    );
    expect(duplicatedNode?.data.ai).toEqual({
      instruction: "Generate a short script from the upstream content",
      modelId: canvasChatModel.modelId
    });
  });

  it("ignores a pending Text result after the target is deleted", async () => {
    const pendingCompletion = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: "text-target"
    }]));
    expect(getTextNodeData("text-target")).toBeUndefined();
    await act(async () => pendingCompletion.resolve(jsonResponse({ content: "Must be ignored" })));
    await settle();
    expect(getTextNodeData("text-target")).toBeUndefined();
    expect(readDomainNodes()).toEqual([expect.objectContaining({
      id: "text-source",
      data: { text: "Source Text A" }
    })]);
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
  });

  it("ignores a pending Text result after New resets the Canvas", async () => {
    const pendingCompletion = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());
    const newCanvas = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="new"]'
    );
    if (!newCanvas) throw new Error("CANVAS_NEW_BUTTON_MISSING");
    await act(async () => newCanvas.click());
    expect(confirmMock).toHaveBeenCalledWith("Discard unsaved Canvas changes?");
    expect(readDomainNodes()).toEqual([]);
    await act(async () => pendingCompletion.resolve(jsonResponse({ content: "Must be ignored" })));
    await settle();
    expect(readDomainNodes()).toEqual([]);
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
  });

  it("ignores a pending Text result after opening another Canvas", async () => {
    const pendingCompletion = createDeferred<Response>();
    const loadedDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "loaded-text",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "Loaded other Canvas" }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({ documents: [{
          id: "other-canvas",
          title: "Other Canvas",
          revision: 1,
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-02T10:00:00.000Z"
        }] });
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents/other-canvas")) {
        return persistedCanvasDocumentResponse(
          "other-canvas",
          1,
          loadedDocument,
          new Map(),
          "Other Canvas"
        );
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());
    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!open) throw new Error("CANVAS_OPEN_BUTTON_MISSING");
    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-list="true"]'
    )).toBeTruthy());
    const openSaved = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-open="true"]'
    );
    if (!openSaved) throw new Error("OTHER_CANVAS_OPEN_MISSING");
    await act(async () => openSaved.click());
    await waitForCanvas(() => expect(getTextNodeData("loaded-text")?.text)
      .toBe("Loaded other Canvas"));
    expect(confirmMock).toHaveBeenCalledWith("Discard unsaved Canvas changes?");
    await act(async () => pendingCompletion.resolve(jsonResponse({ content: "Must be ignored" })));
    await settle();
    expect(getTextNodeData("loaded-text")?.text).toBe("Loaded other Canvas");
    expect(getTextNodeData("text-target")).toBeUndefined();
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
  });

  it("fences pending Text results across user changes and logout", async () => {
    const firstPendingCompletion = createDeferred<Response>();
    const secondPendingCompletion = createDeferred<Response>();
    let completionRequestIndex = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        const pending = completionRequestIndex++ === 0
          ? firstPendingCompletion
          : secondPendingCompletion;
        if (!pending) throw new Error("UNEXPECTED_TEXT_AI_RETRY");
        return pending.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    if (!setAuthSessionForTest || !logoutForTest) throw new Error("AUTH_SESSION_PROBE_MISSING");
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());
    await act(async () => setAuthSessionForTest?.({
      token: "user-b-token",
      user: {
        id: "user-b",
        email: "user-b@example.test",
        role: "USER",
        credits: 20,
        name: "User B"
      }
    }));
    expect(host?.querySelector('[data-creator-node-workspace="true"]')).toBeNull();
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => firstPendingCompletion.resolve(
      jsonResponse({ content: "User A result must be ignored" })
    ));
    await settle();
    expect(getTextNodeData("text-target")?.text).toBe("Old Text B output");

    await act(async () => getTextAiExecuteButton().click());
    await act(async () => logoutForTest?.());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-node-workspace="true"]'
    )).toBeNull());
    await act(async () => secondPendingCompletion.resolve(
      jsonResponse({ content: "Logged-out result must be ignored" })
    ));
    await settle();
    expect(getTextNodeData("text-target")?.text).toBe("Old Text B output");
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(2);
  });

  it("does not apply a pending Text result after the Canvas unmounts", async () => {
    const pendingCompletion = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/chat/completions")) {
        return pendingCompletion.promise;
      }
      return new Response("not found", { status: 404 });
    }, [canvasImageModel, canvasChatModel]);
    await mount({
      initialDocument: createTextAiDocument(),
      initialModels: [canvasImageModel, canvasChatModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["text-target"]));
    await waitForCanvas(() => expect(getTextAiExecuteButton().disabled).toBe(false));
    await act(async () => getTextAiExecuteButton().click());
    await act(async () => root?.unmount());
    await act(async () => pendingCompletion.resolve(jsonResponse({ content: "Must be ignored" })));
    await settle();
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(1);
    expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeNull();
  });

  it("discovers Video models, submits one T2V request, and polls only its returned task", async () => {
    let videoPayload: Record<string, unknown> = {};
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        videoPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          status: "in_progress",
          taskId: "video-task-1",
          retryAfterMs: 0
        }, 202);
      }
      if (init?.method === "GET" && url.endsWith("/tasks/video-task-1")) {
        return jsonResponse({
          task: createVideoTask(videoPayload, "succeeded"),
          assets: [createVideoAsset()]
        });
      }
      if (init?.method === "GET" && url.endsWith("/assets/video-asset-1")) {
        return jsonResponse({ asset: createVideoAsset(), task: createVideoTask(videoPayload) });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await waitForCanvas(() => expect(getVideoModelDiscoveryCalls(fetchMock)).toHaveLength(1));
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoPrompt().value).toBe("cinematic product reveal"));
    expect(getVideoModel().value).toBe(canvasVideoModel.slug);

    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1"));

    const postCalls = getVideoGenerationCalls(fetchMock);
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(String(postCalls[0]?.[1]?.body))).toEqual({
      modelId: canvasVideoModel.slug,
      mode: "text-to-video",
      prompt: "cinematic product reveal"
    });
    expect(new Headers(postCalls[0]?.[1]?.headers).get("Authorization"))
      .toBe("Bearer canvas-owner-token");
    expect(new Headers(postCalls[0]?.[1]?.headers).get("Idempotency-Key"))
      .toEqual(expect.any(String));
    expect(getVideoTaskDetailCalls(fetchMock).map(([input]) => String(input)))
      .toEqual(["/api/tasks/video-task-1"]);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/tasks?type=video"))).toBe(false);
    expect(getCanvasPostCalls(fetchMock)).toHaveLength(0);
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate"))).toBe(false);
    expect(getTextNodeData("video-text-source")?.text).toBe("cinematic product reveal");
  });

  it("keeps one Video submission active on rapid repeated Execute and leaves failures bound unchanged", async () => {
    const pending = createDeferred<Response>();
    let submitCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        submitCount += 1;
        return pending.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument({ targetAssetId: "old-video" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => {
      getVideoExecuteButton().click();
      getVideoExecuteButton().click();
    });
    await waitForCanvas(() => expect(submitCount).toBe(1));
    expect(getVideoExecuteButton().disabled).toBe(true);
    await act(async () => pending.resolve(jsonResponse({
      task: createVideoTask({}, "failed"),
      assets: []
    })));
    await settle();
    expect(submitCount).toBe(1);
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");
  });

  it("retains a bound Video attempt after POST transport uncertainty and resumes with the same key and body", async () => {
    let postCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        postCount += 1;
        if (postCount === 1) throw new TypeError("Failed to fetch");
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          task: createVideoTask(payload, "succeeded"),
          assets: [createVideoAsset()]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument({ targetAssetId: "old-video" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    const quotaBefore = getQuotaCalls(fetchMock).length;
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(
      host?.querySelector('[data-creator-video-execution-status="unresolved"]')
    ).toBeTruthy());

    const firstPost = getVideoGenerationCalls(fetchMock)[0];
    if (!firstPost) throw new Error("VIDEO_TRANSPORT_FIRST_POST_MISSING");
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");
    expect(getVideoExecuteButton().textContent).toContain("Check / Resume");
    expect(getQuotaCalls(fetchMock)).toHaveLength(quotaBefore);

    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));
    const postCalls = getVideoGenerationCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(postCalls[1]?.[1]?.body).toBe(firstPost[1]?.body);
    expect(new Headers(postCalls[1]?.[1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(firstPost[1]?.headers).get("Idempotency-Key"));
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");
    expect(getQuotaCalls(fetchMock).length).toBeGreaterThan(quotaBefore);
  });

  it.each([502, 504])(
    "retains a Video attempt for explicit submission uncertainty (%s) and replays the same uncertain response",
    async (status) => {
      let postCount = 0;
      const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
        const url = String(input);
        if (url.includes("/models?capability=video&surface=video")) {
          return jsonResponse({ models: [canvasVideoModel] });
        }
        if (init?.method === "POST" && url.endsWith("/video/generate")) {
          postCount += 1;
          return jsonResponse({
            code: "VIDEO_SUBMISSION_UNCERTAIN",
            message: "Provider outcome is not known"
          }, status);
        }
        return new Response("not found", { status: 404 });
      });
      await mount({
        initialDocument: createVideoDocument({ targetAssetId: "old-video" }),
        initialModels: [canvasImageModel]
      }, { authenticated: true });
      await act(async () => selectOnlyNodeIds(["video-target"]));
      await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
      const quotaBefore = getQuotaCalls(fetchMock).length;

      await act(async () => getVideoExecuteButton().click());
      await waitForCanvas(() => expect(
        host?.querySelector('[data-creator-video-execution-status="unresolved"]')
      ).toBeTruthy());
      const firstPost = getVideoGenerationCalls(fetchMock)[0];
      if (!firstPost) throw new Error("VIDEO_EXPLICIT_UNCERTAIN_FIRST_POST_MISSING");
      expect(postCount).toBe(1);
      expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
        .toBe("old-video");
      expect(getVideoExecuteButton().textContent).toContain("Check / Resume");
      expect(getQuotaCalls(fetchMock)).toHaveLength(quotaBefore);

      await act(async () => getVideoExecuteButton().click());
      await waitForCanvas(() => expect(postCount).toBe(2));
      await waitForCanvas(() => expect(
        host?.querySelector('[data-creator-video-execution-status="unresolved"]')
      ).toBeTruthy());
      const postCalls = getVideoGenerationCalls(fetchMock);
      expect(postCalls).toHaveLength(2);
      expect(postCalls[1]?.[1]?.body).toBe(firstPost[1]?.body);
      expect(new Headers(postCalls[1]?.[1]?.headers).get("Idempotency-Key"))
        .toBe(new Headers(firstPost[1]?.headers).get("Idempotency-Key"));
      expect(readDomainNodes()).toHaveLength(2);
      expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
        .toBe("old-video");
      expect(getQuotaCalls(fetchMock)).toHaveLength(quotaBefore);
    }
  );

  it("keeps an authoritative Video provider failure terminal instead of unresolved", async () => {
    let postCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        postCount += 1;
        return jsonResponse({
          code: "VIDEO_PROVIDER_FAILED",
          message: "Provider failed"
        }, 502);
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument({ targetAssetId: "old-video" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));

    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(
      host?.querySelector('[data-creator-video-execution-status="failed"]')
    ).toBeTruthy());
    expect(postCount).toBe(1);
    expect(host?.querySelector('[data-creator-video-execution-status="unresolved"]'))
      .toBeNull();
    expect(getVideoExecuteButton().textContent).not.toContain("Check / Resume");
    expect(readDomainNodes()).toHaveLength(2);
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");
  });

  it("treats a malformed accepted Video response as unresolved and replays the same attempt", async () => {
    let postCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        postCount += 1;
        if (postCount === 1) {
          return jsonResponse({ status: "in_progress", retryAfterMs: 0 }, 202);
        }
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          status: "in_progress",
          taskId: "video-task-replayed",
          retryAfterMs: 0,
          payload
        }, 202);
      }
      if (init?.method === "GET" && url.endsWith("/tasks/video-task-replayed")) {
        return jsonResponse({
          task: createVideoTask({}, "succeeded", "video-task-replayed"),
          assets: [createVideoAsset("video-asset-replayed", "video-task-replayed")]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(
      host?.querySelector('[data-creator-video-execution-status="unresolved"]')
    ).toBeTruthy());
    const firstPost = getVideoGenerationCalls(fetchMock)[0];
    if (!firstPost) throw new Error("VIDEO_MALFORMED_FIRST_POST_MISSING");
    expect(getVideoExecuteButton().textContent).toContain("Check / Resume");

    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes().find(
      (node) => node.data.assetId === "video-asset-replayed"
    )).toBeTruthy());
    const postCalls = getVideoGenerationCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(postCalls[1]?.[1]?.body).toBe(firstPost[1]?.body);
    expect(new Headers(postCalls[1]?.[1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(firstPost[1]?.headers).get("Idempotency-Key"));
    expect(getVideoTaskDetailCalls(fetchMock)).toHaveLength(1);
  });

  it("retains a known task after GET transport uncertainty and serializes rapid Resume to one check", async () => {
    let taskGetCount = 0;
    const secondTaskResponse = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return jsonResponse({
          status: "in_progress",
          taskId: "video-task-known",
          retryAfterMs: 0
        }, 202);
      }
      if (init?.method === "GET" && url.endsWith("/tasks/video-task-known")) {
        taskGetCount += 1;
        if (taskGetCount === 1) throw new TypeError("Failed to fetch");
        if (taskGetCount === 2) return secondTaskResponse.promise;
        return jsonResponse({
          task: createVideoTask({}, "succeeded", "video-task-known"),
          assets: [createVideoAsset("video-asset-known", "video-task-known")]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    const quotaBefore = getQuotaCalls(fetchMock).length;
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(
      host?.querySelector('[data-creator-video-execution-status="unresolved"]')
    ).toBeTruthy());
    expect(taskGetCount).toBe(1);
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
    expect(getQuotaCalls(fetchMock)).toHaveLength(quotaBefore);

    const resume = getVideoExecuteButton();
    await act(async () => {
      resume.click();
      resume.click();
    });
    await waitForCanvas(() => expect(taskGetCount).toBe(2));
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
    await act(async () => secondTaskResponse.resolve(jsonResponse({
      task: createVideoTask({}, "succeeded", "video-task-known"),
      assets: [createVideoAsset("video-asset-known", "video-task-known")]
    })));
    await waitForCanvas(() => expect(readDomainNodes().find(
      (node) => node.data.assetId === "video-asset-known"
    )).toBeTruthy());
    expect(taskGetCount).toBe(2);
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
    expect(getQuotaCalls(fetchMock).length).toBeGreaterThan(quotaBefore);
  });

  it("keeps the same known task through non-OK and malformed GET observations", async () => {
    let taskGetCount = 0;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return jsonResponse({
          status: "in_progress",
          taskId: "video-task-errors",
          retryAfterMs: 0
        }, 202);
      }
      if (init?.method === "GET" && url.endsWith("/tasks/video-task-errors")) {
        taskGetCount += 1;
        if (taskGetCount === 1) return new Response("temporarily unavailable", { status: 503 });
        if (taskGetCount === 2) return new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" }
        });
        return jsonResponse({
          task: createVideoTask({}, "succeeded", "video-task-errors"),
          assets: [createVideoAsset("video-asset-errors", "video-task-errors")]
        });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument({ targetAssetId: "old-video" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(
      host?.querySelector('[data-creator-video-execution-status="unresolved"]')
    ).toBeTruthy());
    expect(taskGetCount).toBe(1);
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");

    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(taskGetCount).toBe(2));
    await waitForCanvas(() => expect(
      host?.querySelector('[data-creator-video-execution-status="unresolved"]')
    ).toBeTruthy());
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");

    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes().find(
      (node) => node.data.assetId === "video-asset-errors"
    )).toBeTruthy());
    expect(taskGetCount).toBe(3);
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");
  });

  it("prepares an owner-private I2V Image reference and never generates an Image", async () => {
    const initialDocument: CreatorCanvasDocumentV1 = {
      ...createVideoDocument(),
      nodes: [
        {
          id: "image-reference",
          kind: "image",
          position: { x: 0, y: 0 },
          data: { assetId: "source-image" }
        },
        {
          id: "video-target",
          kind: "video",
          position: { x: 420, y: 0 },
          data: { assetId: null }
        }
      ],
      edges: [{
        id: "image-video-edge",
        sourceNodeId: "image-reference",
        targetNodeId: "video-target",
        relationship: "reference"
      }]
    };
    compressReferenceImageMock.mockResolvedValue({
      dataUrl: "data:image/jpeg;base64,COMPRESSED",
      compressedBytes: 80,
      sourceWidth: 640,
      sourceHeight: 480
    });
    let videoPayload: Record<string, unknown> = {};
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "GET" && url.endsWith("/assets/source-image")) {
        return jsonResponse({
          asset: createExistingImageAsset("source-image", "source.png"),
          task: null
        });
      }
      if (init?.method === "GET" && url.endsWith("/assets/source-image/content")) {
        return new Response("png", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        videoPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const task = createVideoTask(videoPayload, "succeeded");
        return jsonResponse({ task, assets: [createVideoAsset()] });
      }
      if (init?.method === "GET" && url.endsWith("/assets/video-asset-1")) {
        return jsonResponse({ asset: createVideoAsset(), task: createVideoTask(videoPayload) });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument, initialModels: [canvasImageModel] }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoPrompt()).toBeTruthy());
    await act(async () => {
      const mode = host?.querySelector<HTMLButtonElement>(
        '[data-creator-video-mode="image-to-video"]'
      );
      if (!mode) throw new Error("I2V_MODE_MISSING");
      mode.click();
      setTextareaValue(getVideoPrompt(), "Animate the source image");
    });
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1"));
    expect(videoPayload).toMatchObject({
      modelId: canvasVideoModel.slug,
      mode: "image-to-video",
      prompt: "Animate the source image",
      referenceImage: {
        dataUrl: "data:image/jpeg;base64,COMPRESSED",
        mimeType: "image/jpeg",
        name: "source.png",
        compressedBytes: 80
      }
    });
    expect(videoPayload).not.toHaveProperty("reference");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/image/generate"))).toBe(false);
    expect(getTextAiCompletionCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps Video results separate from an open Text edit transaction with exact Undo/Redo ordering", async () => {
    const pending = createDeferred<Response>();
    const initialDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [
        {
          id: "manual-text",
          kind: "text",
          position: { x: 0, y: 0 },
          data: { text: "a" }
        },
        {
          id: "video-target",
          kind: "video",
          position: { x: 420, y: 0 },
          data: { assetId: null }
        }
      ],
      edges: [{
        id: "manual-video-edge",
        sourceNodeId: "manual-text",
        targetNodeId: "video-target",
        relationship: "reference"
      }],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return pending.promise;
      }
      if (init?.method === "GET" && url.endsWith("/assets/video-asset-1")) {
        return jsonResponse({ asset: createVideoAsset(), task: createVideoTask() });
      }
      return new Response("not found", { status: 404 });
    });

    await mount({ initialDocument, initialModels: [canvasImageModel] }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1));

    await act(async () => selectOnlyNodeIds(["manual-text"]));
    const manualText = getTextInputForNode("manual-text");
    await act(async () => {
      manualText.focus();
      setTextareaValue(manualText, "ab");
    });
    expect(manualText.value).toBe("ab");

    await act(async () => pending.resolve(jsonResponse({
      task: createVideoTask({}, "succeeded"),
      assets: [createVideoAsset()]
    })));
    await waitForCanvas(() => expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1"));

    await act(async () => setTextareaValue(manualText, "abc"));
    await act(async () => manualText.blur());
    await waitForCanvas(() => expect(getTextInputForNode("manual-text").value).toBe("abc"));

    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1");
    await clickHistory("undo");
    expect(getTextInputForNode("manual-text").value).toBe("a");
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1");
    await clickHistory("undo");
    expect(getTextInputForNode("manual-text").value).toBe("a");
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBeNull();
    await clickHistory("redo");
    expect(getTextInputForNode("manual-text").value).toBe("a");
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1");
    await clickHistory("redo");
    expect(getTextInputForNode("manual-text").value).toBe("abc");
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1");
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
    expect(getVideoTaskDetailCalls(fetchMock)).toHaveLength(0);
  });

  it("interleaves a Video result with an active drag transaction without splitting the drag", async () => {
    const pending = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return pending.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1));

    const textNode = getMockNode("text");
    await act(async () => {
      getReactFlowProps().onNodeDragStart(null, textNode, [textNode]);
      getReactFlowProps().onNodesChange([{
        type: "position",
        id: "video-text-source",
        position: { x: 180, y: 40 },
        dragging: true
      }]);
    });
    await act(async () => pending.resolve(jsonResponse({
      task: createVideoTask({}, "succeeded"),
      assets: [createVideoAsset()]
    })));
    await waitForCanvas(() => expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1"));
    await act(async () => {
      getReactFlowProps().onNodesChange([{
        type: "position",
        id: "video-text-source",
        position: { x: 240, y: 80 },
        dragging: true
      }]);
      getReactFlowProps().onNodeDragStop(null, textNode, [textNode]);
    });
    await settle();

    expect(readDomainNodes().find((node) => node.id === "video-text-source")?.position)
      .toEqual({ x: 240, y: 80 });
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1");
    await clickHistory("undo");
    expect(readDomainNodes().find((node) => node.id === "video-text-source")?.position)
      .toEqual({ x: 0, y: 0 });
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1");
    await clickHistory("undo");
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBeNull();
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
  });

  it("keeps a bound Video target and restores the same generated sibling through Undo/Redo", async () => {
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return jsonResponse({
          task: createVideoTask({}, "succeeded"),
          assets: [createVideoAsset()]
        });
      }
      if (init?.method === "GET" && url.endsWith("/assets/video-asset-1")) {
        return jsonResponse({ asset: createVideoAsset(), task: createVideoTask() });
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument({ targetAssetId: "old-video" }),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(readDomainNodes()).toHaveLength(3));

    const firstResult = readDomainNodes().find((node) => node.data.assetId === "video-asset-1");
    if (!firstResult) throw new Error("VIDEO_RESULT_SIBLING_MISSING");
    const originalEdges = readDomainEdges();
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");
    expect(originalEdges).toHaveLength(1);
    expect(readDomainEdges()).toEqual(originalEdges);
    await clickHistory("undo");
    expect(readDomainNodes()).toHaveLength(2);
    expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("old-video");
    await clickHistory("redo");
    expect(readDomainNodes()).toHaveLength(3);
    const redoneResult = readDomainNodes().find((node) => node.data.assetId === "video-asset-1");
    expect(redoneResult?.id).toBe(firstResult.id);
    expect(redoneResult?.position).toEqual(firstResult.position);
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
  });

  it("allows Save while a Video task is pending and serializes only V2 semantic state", async () => {
    const pending = createDeferred<Response>();
    let savedState: Record<string, unknown> | null = null;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return pending.promise;
      }
      if (init?.method === "POST" && url.endsWith("/canvas/documents")) {
        const body = JSON.parse(String(init.body)) as { state: Record<string, unknown> };
        savedState = body.state;
        return jsonResponse({
          document: {
            id: "saved-video-canvas",
            title: "Saved Video Canvas",
            revision: 1,
            state: body.state,
            createdAt: "2026-09-03T00:00:00.000Z",
            updatedAt: "2026-09-03T00:00:00.000Z"
          }
        }, 201);
      }
      return new Response("not found", { status: 404 });
    });
    await mount({
      initialDocument: createVideoDocument(),
      initialModels: [canvasImageModel]
    }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => setTextareaValue(getVideoPrompt(), "Save this while running"));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1));

    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    if (!save) throw new Error("CANVAS_SAVE_BUTTON_MISSING");
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await waitForCanvas(() => expect(savedState).not.toBeNull());
    const runningState = savedState as unknown as Record<string, unknown>;
    expect(runningState.schemaVersion).toBe(2);
    expect(runningState).toHaveProperty("document");
    expect(runningState).toHaveProperty("imageComposerDrafts");
    expect(runningState).toHaveProperty("videoComposerDrafts.video-target");
    expect(JSON.stringify(runningState)).not.toContain("video-task-1");
    expect(JSON.stringify(runningState)).not.toContain("Idempotency-Key");
    expect(JSON.stringify(runningState)).not.toContain("submitting");

    await act(async () => pending.resolve(jsonResponse({
      task: createVideoTask({}, "succeeded"),
      assets: [createVideoAsset()]
    })));
    await waitForCanvas(() => expect(readDomainNodes().find((node) => node.id === "video-target")?.data.assetId)
      .toBe("video-asset-1"));
    expect(save.disabled).toBe(false);
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
  });

  it("opens exact V1 state cleanly and writes normalized V2 after a real edit", async () => {
    const legacyDocument: CreatorCanvasDocumentV1 = {
      version: 1,
      nodes: [{
        id: "legacy-text",
        kind: "text",
        position: { x: 0, y: 0 },
        data: { text: "legacy canvas text" }
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    let savedState: Record<string, unknown> | null = null;
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/canvas/documents/legacy-canvas")) {
        return jsonResponse({
          document: {
            id: "legacy-canvas",
            title: "Legacy Canvas",
            revision: 1,
            state: {
              schemaVersion: 1,
              document: legacyDocument,
              imageComposerDrafts: {}
            },
            createdAt: "2026-09-03T00:00:00.000Z",
            updatedAt: "2026-09-03T00:00:00.000Z"
          }
        });
      }
      if (init?.method === "PATCH" && url.endsWith("/canvas/documents/legacy-canvas")) {
        const body = JSON.parse(String(init.body)) as { state: Record<string, unknown> };
        savedState = body.state;
        return jsonResponse({
          document: {
            id: "legacy-canvas",
            title: "Legacy Canvas",
            revision: 2,
            state: body.state,
            createdAt: "2026-09-03T00:00:00.000Z",
            updatedAt: "2026-09-03T00:00:01.000Z"
          }
        });
      }
      return new Response("not found", { status: 404 });
    });
    window.history.replaceState({}, "", "/canvas?canvasId=legacy-canvas");
    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["legacy-text"]));
    await waitForCanvas(() => expect(getTextInputForNode("legacy-text").value)
      .toBe("legacy canvas text"));
    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    if (!save) throw new Error("CANVAS_SAVE_BUTTON_MISSING");
    expect(save.disabled).toBe(true);
    expect(host?.textContent).toContain("Video");

    const text = getTextInputForNode("legacy-text");
    await act(async () => {
      text.focus();
      setTextareaValue(text, "edited legacy canvas text");
      text.blur();
    });
    await waitForCanvas(() => expect(save.disabled).toBe(false));
    await act(async () => save.click());
    await waitForCanvas(() => expect(savedState).not.toBeNull());
    const normalizedState = savedState as unknown as Record<string, unknown>;
    expect(normalizedState.schemaVersion).toBe(2);
    expect(normalizedState.videoComposerDrafts).toEqual({});
    expect(getCanvasDocumentCalls(fetchMock, "PATCH")).toHaveLength(1);
  });

  it("invalidates a pending Video result when New resets the Canvas", async () => {
    const pending = createDeferred<Response>();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return pending.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument: createVideoDocument() }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1));

    const newCanvas = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="new"]'
    );
    if (!newCanvas) throw new Error("CANVAS_NEW_BUTTON_MISSING");
    await act(async () => newCanvas.click());
    expect(readDomainNodes()).toEqual([]);
    await act(async () => pending.resolve(jsonResponse({
      task: createVideoTask({}, "succeeded"),
      assets: [createVideoAsset()]
    })));
    await settle();
    expect(readDomainNodes()).toEqual([]);
    expect(confirmMock).toHaveBeenCalled();
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
  });

  it("ignores a pending Video result after target deletion", async () => {
    const pending = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return pending.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument: createVideoDocument() }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1));
    await act(async () => getReactFlowProps().onNodesChange([{
      type: "remove",
      id: "video-target"
    }]));
    await act(async () => pending.resolve(jsonResponse({
      task: createVideoTask({}, "succeeded"),
      assets: [createVideoAsset()]
    })));
    await settle();
    expect(readDomainNodes().some((node) => node.id === "video-target")).toBe(false);
    expect(readDomainNodes().some((node) => node.data.assetId === "video-asset-1")).toBe(false);
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
  });

  it("does not apply a pending Video result after the Canvas unmounts", async () => {
    const pending = createDeferred<Response>();
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("/models?capability=video&surface=video")) {
        return jsonResponse({ models: [canvasVideoModel] });
      }
      if (init?.method === "POST" && url.endsWith("/video/generate")) {
        return pending.promise;
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialDocument: createVideoDocument() }, { authenticated: true });
    await act(async () => selectOnlyNodeIds(["video-target"]));
    await waitForCanvas(() => expect(getVideoExecuteButton().disabled).toBe(false));
    await act(async () => getVideoExecuteButton().click());
    await waitForCanvas(() => expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1));
    await act(async () => root?.unmount());
    root = null;
    await act(async () => pending.resolve(jsonResponse({
      task: createVideoTask({}, "succeeded"),
      assets: [createVideoAsset()]
    })));
    await settle();
    expect(getVideoGenerationCalls(fetchMock)).toHaveLength(1);
    expect(host?.querySelector('[data-creator-canvas-root="true"]')).toBeNull();
  });

  it("opens saved documents and starts a new temporary Canvas without deleting the old record", async () => {
    const savedDocument = createImageDocument({ targetAssetId: "opened-asset" });
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({
          documents: [{
            id: "opened-canvas",
            title: "Opened Canvas",
            revision: 1,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-02T10:00:00.000Z"
          }]
        });
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents/opened-canvas")) {
        return persistedCanvasDocumentResponse(
          "opened-canvas",
          1,
          savedDocument,
          new Map(),
          "Opened Canvas"
        );
      }
      return new Response("not found", { status: 404 });
    });
    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });
    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!open) throw new Error("CANVAS_OPEN_BUTTON_MISSING");
    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-list="true"]'
    )).toBeTruthy());
    const openSaved = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-open="true"]'
    );
    if (!openSaved) throw new Error("CANVAS_SAVED_DOCUMENT_OPEN_MISSING");
    await act(async () => openSaved.click());
    await waitForCanvas(() => expect(readDomainNodes()[0]?.data.assetId)
      .toBe("opened-asset"));
    expect(window.location.search).toBe("?canvasId=opened-canvas");
    expect(currentTitleForTest).toBe("Opened Canvas");

    const newCanvas = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="new"]'
    );
    if (!newCanvas) throw new Error("CANVAS_NEW_BUTTON_MISSING");
    await act(async () => newCanvas.click());
    expect(readDomainNodes()).toEqual([]);
    expect(window.location.pathname).toBe("/canvas");
    expect(currentTitleForTest).toBeNull();
    expect(getCanvasDocumentCalls(fetchMock, "DELETE")).toHaveLength(0);
  });

  it("does not discard dirty current work when deleting a non-current saved Canvas", async () => {
    const currentDocument = {
      version: 1 as const,
      nodes: [{
        id: "current-text",
        kind: "text" as const,
        position: { x: 40, y: 50 },
        data: { text: "saved-current" }
      }],
      edges: [],
      viewport: { x: -12, y: 8, zoom: 1.1 }
    };
    const deletedIds: string[] = [];
    const fetchMock = installCanvasRuntimeFetch(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/canvas/documents/current-canvas")) {
        return persistedCanvasDocumentResponse(
          "current-canvas",
          2,
          currentDocument,
          new Map(),
          "Current Canvas"
        );
      }
      if (init?.method === "GET" && url.endsWith("/canvas/documents?limit=50")) {
        return jsonResponse({
          documents: [
            {
              id: "current-canvas",
              title: "Current Canvas",
              revision: 2,
              createdAt: "2026-09-01T10:00:00.000Z",
              updatedAt: "2026-09-02T10:00:00.000Z"
            },
            {
              id: "other-canvas",
              title: "Other Canvas",
              revision: 1,
              createdAt: "2026-09-01T10:00:00.000Z",
              updatedAt: "2026-09-01T10:00:00.000Z"
            }
          ]
        });
      }
      if (init?.method === "DELETE" && url.includes("/canvas/documents/")) {
        deletedIds.push(url.split("/").at(-1) ?? "");
        return jsonResponse({ ok: true });
      }
      return new Response("not found", { status: 404 });
    });
    window.history.replaceState({}, "", "/canvas?canvasId=current-canvas");
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    await mount({ initialModels: [canvasImageModel] }, { authenticated: true });
    expect(currentTitleForTest).toBe("Current Canvas");
    await act(async () => selectOnlyNodeIds(["current-text"]));
    const textInput = getTextInputForNode("current-text");
    await act(async () => setTextareaValue(textInput, "dirty-local"));
    await act(async () => textInput.blur());
    const save = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    );
    if (!save) throw new Error("CANVAS_SAVE_BUTTON_MISSING");
    expect(save.disabled).toBe(false);

    const open = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="open"]'
    );
    if (!open) throw new Error("CANVAS_OPEN_BUTTON_MISSING");
    await act(async () => open.click());
    await waitForCanvas(() => expect(host?.querySelector(
      '[data-creator-canvas-saved-documents-list="true"]'
    )).toBeTruthy());

    const deleteButtons = Array.from(host?.querySelectorAll<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-delete="true"]'
    ) ?? []);
    const otherDelete = deleteButtons.find((button) =>
      button.closest('[data-creator-canvas-saved-document-item="true"]')
        ?.textContent?.includes("Other Canvas")
    );
    if (!otherDelete) throw new Error("OTHER_CANVAS_DELETE_MISSING");
    await act(async () => otherDelete.click());
    await waitForCanvas(() => expect(deletedIds).toEqual(["other-canvas"]));
    expect(confirmMock.mock.calls).toEqual([[
      "Delete this saved Canvas document?"
    ]]);
    expect(readDomainNodes()[0]?.data.text).toBe("dirty-local");
    expect(save.disabled).toBe(false);
    expect(window.location.search).toBe("?canvasId=current-canvas");

    const currentDelete = Array.from(host?.querySelectorAll<HTMLButtonElement>(
      '[data-creator-canvas-saved-document-delete="true"]'
    ) ?? []).find((button) =>
      button.closest('[data-creator-canvas-saved-document-item="true"]')
        ?.textContent?.includes("Current Canvas")
    );
    if (!currentDelete) throw new Error("CURRENT_CANVAS_DELETE_MISSING");
    await act(async () => currentDelete.click());
    await waitForCanvas(() => expect(deletedIds).toEqual([
      "other-canvas",
      "current-canvas"
    ]));
    expect(confirmMock.mock.calls).toEqual([
      ["Delete this saved Canvas document?"],
      ["Discard unsaved Canvas changes?"],
      ["Delete this saved Canvas document?"]
    ]);
    expect(readDomainNodes()).toEqual([]);
    expect(window.location.pathname).toBe("/canvas");
    expect(currentTitleForTest).toBeNull();
    await waitForCanvas(() => expect(host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-persistence-action="save"]'
    )?.disabled).toBe(true));
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      init?.method === "DELETE" && String(input).includes("/canvas/documents/")
    )).toHaveLength(2);
  });
});
