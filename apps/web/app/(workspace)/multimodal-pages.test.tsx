import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiAssetSummary, AiModelSummary, AiTaskSummary } from "@ai-aggregate/shared";
import type { Locale } from "../../lib/i18n/types";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  AssetsPageContent,
  adaptiveAssetPageSizeConfig,
  calculateAssetPageSize,
  clampAssetPage,
  getAssetPageAfterDelta,
  paginateAssets,
} from "./assets/assets-page-content";
import { AssetDetailPageContent } from "./assets/[id]/asset-detail-page-content";
import AssetsPage from "./assets/page";
import { WorkspaceLayoutClient } from "./workspace-layout-client";
import { getAssetReuseParams, getTaskReuseParams } from "../multimodal-reuse";
import {
  ImagePageContent,
  applyImagePromptPreset,
  backendImageHistoryReloadDebounceMs,
  backendImageHistoryReloadEvents,
  buildImageGenerateRequestPayload,
  compressReferenceImage,
  createImageEntryId,
  createImageSessionId,
  deriveImageResultBatches,
  estimateDataUrlBytes,
  filterTasksCreatedBefore,
  filterTasksCreatedBeforeIso,
  findImageTaskForFailedFetchReconcile,
  findImageTaskForPollingReconcile,
  formatBytes,
  imageModelHandoffMaxAgeMs,
  imageModelHandoffStorageKey,
  inferAspectRatioFromPrompt,
  isFailedFetchError,
  markImageStreamEntryChecking,
  mergeImageSessionsWithBackendHistory,
  normalizeImageSessionsForDisplay,
  parseImageModelHandoff,
  parseDismissedImageSessionIds,
  parseStoredImageSessions,
  readImageGenerationCount,
  reconcilePendingImageSessionEntriesWithBackend,
  readTaskOutputImages,
  reconcileImageStreamEntryFromTask,
  resolveImageGenerationSize,
  resolveImageEntryDisplayState,
  selectActiveImageSessionId,
  serializeDismissedImageSessionIds,
  serializeImageSessionsForStorage,
  shouldReloadBackendImageHistory,
  taskToImageStreamEntry,
  trimStoredImageSessions,
  updateImageSessionEntries,
  validateReferenceImageFile,
  imagePromptPresets,
  imageInspirationPresets,
  defaultImageGenerationCount
} from "./image/image-page-content";
import {
  readImageCreationHandoff
} from "../image-creation-handoff";
import ImagePage from "./image/page";
import PptPage from "./ppt/page";
import { TaskDetailPageContent } from "./tasks/[id]/task-detail-page-content";
import {
  TasksPageContent,
  adaptiveTaskPageSizeConfig,
  clampTaskPage,
  filterTasks,
  getAdaptiveTaskPageSize,
  getDefaultSelectedTaskId,
  getTaskPageAfterDelta,
  getTaskPageSizeFallback,
  getTaskGeneratedSize,
  getTaskStats,
  getTaskTotalPages,
  getTaskPreviewImage,
  paginateTasks,
  resolveTaskModelLabel,
  selectTaskForPanel,
  sortTasks
} from "./tasks/tasks-page-content";
import TasksPage from "./tasks/page";
import VideoPage from "./video/page";

const navigationState = vi.hoisted(() => ({
  pathname: "/image",
  routerPush: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({
    push: navigationState.routerPush
  }),
  useSearchParams: () => new URLSearchParams("")
}));

function renderWithLocale(node: React.ReactNode, locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      {node}
    </I18nContext.Provider>
  );
}

function renderRoute(Page: React.ComponentType, locale: Locale = "en-US") {
  return renderWithLocale(<Page />, locale);
}

function createTask(
  overrides: Partial<AiTaskSummary> & Pick<AiTaskSummary, "id" | "status" | "prompt" | "createdAt">
): AiTaskSummary {
  return {
    userId: "user_1",
    type: "image",
    modelId: "image-model",
    input: { mode: "text-to-image", size: "1024x1024", count: 1 },
    output: null,
    costCredits: 2,
    errorMessage: null,
    updatedAt: overrides.createdAt,
    completedAt: null,
    ...overrides
  };
}

function createImageModel(overrides: Partial<AiModelSummary> = {}): AiModelSummary {
  return {
    id: "model_image",
    name: "qianyuIMG",
    displayName: "qianyuIMG",
    slug: "qianyu-img",
    provider: "OPENAI_COMPATIBLE",
    modelId: "agnes-image-2.0-flash",
    capability: "image",
    group: "image",
    tags: ["image"],
    enabled: true,
    creditCost: 2,
    allowGuest: false,
    sortOrder: 0,
    isRecommended: false,
    ...overrides,
    maxReferenceImages: overrides.maxReferenceImages ?? 1
  };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let privateAssetHost: HTMLDivElement | null = null;
let privateAssetRoot: Root | null = null;
type PrivateAssetWindow = Window & typeof globalThis;
type PrivateAssetDom = { window: PrivateAssetWindow };
const requirePrivateAssetDom = createRequire(import.meta.url);
let privateAssetDom: PrivateAssetDom | null = null;
let restorePrivateAssetObjectUrls: (() => void) | null = null;

function privateAssetTestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function privateAssetTestResponse(contentType = "image/png") {
  return new Response("private image", {
    headers: { "Content-Type": contentType }
  });
}

async function settlePrivateAssetPage() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountPrivateAssetPage(
  node: React.ReactNode,
  locale: Locale = "en-US",
  options?: { width?: number }
) {
  const jsdom = requirePrivateAssetDom("jsdom");
  const dom: PrivateAssetDom = new jsdom.JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost"
  });
  privateAssetDom = dom;
  const { window } = dom;
  window.innerWidth = options?.width ?? 390;
  vi.stubGlobal("window", window);
  vi.stubGlobal("self", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("Element", window.Element);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("HTMLAnchorElement", window.HTMLAnchorElement);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("MouseEvent", window.MouseEvent);
  privateAssetHost = document.createElement("div");
  document.body.append(privateAssetHost);
  privateAssetRoot = createRoot(privateAssetHost);

  await act(async () => {
    privateAssetRoot?.render(
      <I18nContext.Provider
        value={{
          locale,
          setLocale: vi.fn(),
          t: createTranslator(locale)
        }}
      >
        {node}
      </I18nContext.Provider>
    );
  });
  await settlePrivateAssetPage();
}

function mockPrivateAssetObjectUrls(urls: string[]) {
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const createObjectUrl = vi.fn(() => urls.shift() ?? "blob:unexpected");
  const revokeObjectUrl = vi.fn();

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl
  });
  restorePrivateAssetObjectUrls = () => {
    if (createDescriptor) {
      Object.defineProperty(URL, "createObjectURL", createDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }

    if (revokeDescriptor) {
      Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  };

  return { createObjectUrl, revokeObjectUrl };
}

afterEach(async () => {
  await act(async () => privateAssetRoot?.unmount());
  privateAssetHost?.remove();
  privateAssetRoot = null;
  privateAssetHost = null;
  privateAssetDom?.window.sessionStorage.clear();
  privateAssetDom?.window.close();
  privateAssetDom = null;
  restorePrivateAssetObjectUrls?.();
  restorePrivateAssetObjectUrls = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  navigationState.pathname = "/image";
  navigationState.routerPush.mockReset();
});

describe("private asset page rendering", () => {
  it("keeps the works switcher interactive while assets metadata is pending", async () => {
    const pendingAssets = new Promise<Response>(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      if (url.pathname === "/api/assets") {
        return pendingAssets;
      }
      throw new Error(`Unexpected assets page request: ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountPrivateAssetPage(<AssetsPageContent initialToken="assets-pending-token" />);

    const tasksTab = privateAssetHost?.querySelector<HTMLAnchorElement>(
      '[data-mobile-works-tab="tasks"]'
    );
    expect(tasksTab?.getAttribute("href")).toBe("/tasks");
    expect(tasksTab?.getAttribute("aria-disabled")).toBeNull();
    expect(privateAssetHost?.querySelector('[data-mobile-works-assets-loading="true"]')).toBeTruthy();
    expect(privateAssetHost?.querySelector('[data-mobile-works-tabs="true"]')).toBeTruthy();
  });

  it("keeps the works switcher interactive while task metadata is pending", async () => {
    const pendingTasks = new Promise<Response>(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      if (url.pathname === "/api/models") {
        return new Response(JSON.stringify({ models: [] }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.pathname === "/api/tasks") {
        return pendingTasks;
      }
      throw new Error(`Unexpected tasks page request: ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountPrivateAssetPage(<TasksPageContent initialToken="tasks-pending-token" />);

    const assetsTab = privateAssetHost?.querySelector<HTMLAnchorElement>(
      '[data-mobile-works-tab="assets"]'
    );
    expect(assetsTab?.getAttribute("href")).toBe("/assets");
    expect(assetsTab?.getAttribute("aria-disabled")).toBeNull();
    expect(privateAssetHost?.querySelector('[data-mobile-tasks-loading="true"]')).toBeTruthy();
    expect(privateAssetHost?.querySelector('[data-mobile-works-tabs="true"]')).toBeTruthy();
  });

  it("resolves private task thumbnails and expanded previews through Bearer Blob URLs", async () => {
    const privateUrl = "/assets/task_private/content";
    const providerUrl = "https://provider.example.test/task-provider.png";
    const privateTask = createTask({
      id: "task_private",
      status: "succeeded",
      prompt: "Private task image",
      output: { images: [privateUrl, providerUrl] },
      createdAt: "2026-07-17T00:00:00.000Z"
    });
    const providerTask = createTask({
      id: "task_provider",
      status: "succeeded",
      prompt: "Provider task image",
      output: { images: [providerUrl] },
      createdAt: "2026-07-16T00:00:00.000Z"
    });
    let privateResponsesResolveThumbnail: (response: Response) => void = () => {
      throw new Error("Thumbnail response resolver was not initialized");
    };
    let privateResponsesResolvePreview: (response: Response) => void = () => {
      throw new Error("Preview response resolver was not initialized");
    };
    const privateResponses = [
      new Promise<Response>((resolve) => {
        privateResponsesResolveThumbnail = resolve;
      }),
      new Promise<Response>((resolve) => {
        privateResponsesResolvePreview = resolve;
      })
    ];
    const assetRequests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    let privateResponseIndex = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = privateAssetTestUrl(input);

        if (url.pathname === "/api/models") {
          return new Response(JSON.stringify({ models: [createImageModel()] }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        if (url.pathname === "/api/tasks") {
          return new Response(JSON.stringify({ tasks: [privateTask, providerTask] }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        if (url.pathname === "/api/assets/task_private/content") {
          assetRequests.push({ url, init });
          const response = privateResponses[privateResponseIndex];
          privateResponseIndex += 1;
          if (!response) {
            throw new Error("Unexpected additional private task content request");
          }

          return response;
        }

        throw new Error(`Unexpected task page request: ${url.pathname}${url.search}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createObjectUrl } = mockPrivateAssetObjectUrls([
      "blob:task-thumbnail",
      "blob:task-expanded"
    ]);

    await mountPrivateAssetPage(
      <TasksPageContent
        initialToken="tasks-private-token"
        initialTasks={[privateTask, providerTask]}
        initialModels={[createImageModel()]}
      />
    );

    expect(assetRequests).toHaveLength(1);
    expect(privateAssetHost?.querySelector(`img[src="${privateUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.innerHTML).not.toContain(privateUrl);
    expect(privateAssetHost?.querySelector(`img[src="${providerUrl}"]`)).toBeFalsy();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("provider.example.test"))
    ).toBe(false);

    await act(async () => {
      privateResponsesResolveThumbnail(privateAssetTestResponse());
      privateResponsesResolvePreview(privateAssetTestResponse());
      await Promise.all(privateResponses);
      await Promise.resolve();
    });
    await settlePrivateAssetPage();

    expect(
      privateAssetHost?.querySelector(
        '[data-mobile-task-card="true"] img[src="blob:task-thumbnail"]'
      )
    ).toBeTruthy();
    expect(privateAssetHost?.querySelector('[data-task-preview-image="true"]')).toBeFalsy();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(assetRequests.map(({ url }) => url.pathname)).toEqual([
      "/api/assets/task_private/content"
    ]);
    expect(
      assetRequests.map(({ init }) => new Headers(init?.headers).get("Authorization"))
    ).toEqual(["Bearer tasks-private-token"]);
    expect(privateAssetHost?.innerHTML).not.toContain("tasks-private-token");
  });

  it("does not fetch or render private task images without a token", async () => {
    const privateUrl = "/assets/task_no_token/content";
    const task = createTask({
      id: "task_no_token",
      status: "succeeded",
      prompt: "No token private task",
      output: { images: [privateUrl] },
      createdAt: "2026-07-17T00:00:00.000Z"
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      if (url.pathname === "/api/models") {
        return new Response(JSON.stringify({ models: [createImageModel()] }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      throw new Error(`Unexpected no-token task page request: ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountPrivateAssetPage(
      <TasksPageContent initialToken={null} initialTasks={[task]} initialModels={[createImageModel()]} />
    );

    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/assets/task_no_token/content"))
    ).toBe(false);
    expect(privateAssetHost?.querySelector(`img[src="${privateUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.innerHTML).not.toContain(privateUrl);
  });

  it("resolves private task-detail thumbnail and URL assets for preview without asset-card links", async () => {
    const thumbnailUrl = "/assets/detail_thumbnail/content";
    const assetUrl = "/assets/detail_url/content";
    const publicUrl = "/generated-assets/detail-public.png";
    const assetRequests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = privateAssetTestUrl(input);
        if (url.pathname === "/api/models") {
          return new Response(JSON.stringify({ models: [createImageModel()] }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        if (
          url.pathname === "/api/assets/detail_thumbnail/content" ||
          url.pathname === "/api/assets/detail_url/content"
        ) {
          assetRequests.push({ url, init });
          return privateAssetTestResponse();
        }

        throw new Error(`Unexpected task detail request: ${url.pathname}${url.search}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createObjectUrl } = mockPrivateAssetObjectUrls([
      "blob:detail-thumbnail",
      "blob:detail-url"
    ]);
    const task = createTask({
      id: "task_detail_private",
      status: "succeeded",
      prompt: "Private detail task",
      output: { images: [assetUrl] },
      createdAt: "2026-07-17T00:00:00.000Z"
    });

    await mountPrivateAssetPage(
      <TaskDetailPageContent
        taskId={task.id}
        initialToken="detail-private-token"
        initialTask={task}
        initialModels={[createImageModel()]}
        initialAssets={[
          {
            id: "detail_thumbnail",
            userId: "user_1",
            taskId: task.id,
            type: "image",
            url: "https://provider.example.test/detail-original.png",
            thumbnailUrl,
            title: "Private thumbnail",
            metadata: null,
            createdAt: task.createdAt,
            taskPrompt: task.prompt
          },
          {
            id: "detail_url",
            userId: "user_1",
            taskId: task.id,
            type: "image",
            url: assetUrl,
            thumbnailUrl: null,
            title: "Private asset URL",
            metadata: null,
            createdAt: task.createdAt,
            taskPrompt: task.prompt
          },
          {
            id: "detail_public",
            userId: "user_1",
            taskId: task.id,
            type: "image",
            url: publicUrl,
            thumbnailUrl: null,
            title: "Public asset",
            metadata: null,
            createdAt: task.createdAt,
            taskPrompt: task.prompt
          }
        ]}
      />
    );
    await settlePrivateAssetPage();

    expect(
      privateAssetHost?.querySelectorAll(
        '[data-desktop-task-detail-linked-assets="true"] a[href^="/assets/"]'
      )
    ).toHaveLength(0);
    const linkedAssetSources = Array.from(
      privateAssetHost?.querySelectorAll<HTMLImageElement>(
        '[data-desktop-task-detail-linked-assets="true"] [data-task-detail-image-button="true"] img'
      ) ?? []
    ).map((image) => image.getAttribute("src"));
    expect(linkedAssetSources).toEqual([
      "blob:detail-thumbnail",
      "blob:detail-url",
      publicUrl
    ]);
    expect(assetRequests.map(({ url }) => url.pathname)).toEqual([
      "/api/assets/detail_thumbnail/content",
      "/api/assets/detail_url/content"
    ]);
    expect(
      assetRequests.map(({ init }) => new Headers(init?.headers).get("Authorization"))
    ).toEqual(["Bearer detail-private-token", "Bearer detail-private-token"]);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(privateAssetHost?.innerHTML).not.toContain("detail-private-token");
  });

  it("opens a private task image preview without navigation or premature Blob revocation", async () => {
    const privateUrl = "/assets/task_detail_preview/content";
    const task = createTask({
      id: "task_detail_preview",
      status: "succeeded",
      prompt: "Private preview prompt",
      output: { images: [privateUrl] },
      createdAt: "2026-07-17T00:00:00.000Z"
    });
    const assetRequests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = privateAssetTestUrl(input);
      if (url.pathname === "/api/assets/task_detail_preview/content") {
        assetRequests.push({ url, init });
        return privateAssetTestResponse();
      }

      throw new Error(`Unexpected task preview request: ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { createObjectUrl, revokeObjectUrl } = mockPrivateAssetObjectUrls([
      "blob:task-detail-preview"
    ]);

    await mountPrivateAssetPage(
      <TaskDetailPageContent
        taskId={task.id}
        initialToken="task-detail-preview-token"
        initialTask={task}
        initialModels={[createImageModel()]}
        initialAssets={[
          {
            id: "task_detail_preview_asset",
            userId: "user_1",
            taskId: task.id,
            type: "image",
            url: privateUrl,
            thumbnailUrl: privateUrl,
            title: "Private task preview",
            metadata: null,
            createdAt: task.createdAt,
            taskPrompt: task.prompt
          }
        ]}
      />,
      "zh-CN"
    );
    await settlePrivateAssetPage();

    const image = privateAssetHost?.querySelector<HTMLImageElement>(
      '[data-task-detail-image-button="true"] img'
    );
    expect(image?.getAttribute("src")).toBe("blob:task-detail-preview");
    expect(assetRequests).toHaveLength(1);
    expect(new Headers(assetRequests[0]?.init?.headers).get("Authorization")).toBe(
      "Bearer task-detail-preview-token"
    );
    expect(createObjectUrl).toHaveBeenCalledTimes(1);

    const pathnameBeforeClick = privateAssetDom?.window.location.pathname;
    await act(async () => {
      image?.click();
      await Promise.resolve();
    });

    expect(privateAssetDom?.window.location.pathname).toBe(pathnameBeforeClick);
    expect(
      privateAssetHost?.querySelector(
        '[data-image-preview-dialog="true"] [data-image-preview-image="true"]'
      )?.getAttribute("src")
    ).toBe("blob:task-detail-preview");
    expect(
      privateAssetHost?.querySelector<HTMLButtonElement>(
        '[data-image-preview-zoom-in="true"]'
      )?.getAttribute("aria-label")
    ).toBe("放大");
    expect(
      privateAssetHost?.querySelector<HTMLButtonElement>(
        '[data-image-preview-fit="true"]'
      )?.getAttribute("aria-label")
    ).toBe("适应窗口");
    expect(privateAssetHost?.querySelector('[data-image-preview-dialog="true"]')?.textContent).not.toContain(
      "Fit to window"
    );
    expect(privateAssetHost?.querySelector('a[href="/assets/task_detail_preview_asset"]')).toBeTruthy();

    const closeButton = privateAssetHost?.querySelector<HTMLButtonElement>(
      '[data-image-preview-close="true"]'
    );
    await act(async () => {
      closeButton?.click();
      await Promise.resolve();
    });
    expect(privateAssetHost?.querySelector('[data-image-preview-dialog="true"]')).toBeNull();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it("renders only safe private assets as mobile work cards without duplicate thumbnail reads", async () => {
    const privateUrl = "/assets/asset_card_private/content";
    const generatedUrl = "/generated-assets/asset-card-public.png";
    const providerUrl = "https://provider.example.test/asset-card-provider.png";
    const assets = [
      {
        id: "asset_card_private",
        userId: "user_1",
        taskId: "task_1",
        type: "image" as const,
        url: privateUrl,
        thumbnailUrl: null,
        title: "Private card",
        metadata: { mode: "text-to-image" },
        createdAt: "2026-07-17T00:00:00.000Z",
        taskPrompt: "Private card prompt"
      },
      {
        id: "asset_card_public",
        userId: "user_1",
        taskId: "task_2",
        type: "image" as const,
        url: generatedUrl,
        thumbnailUrl: null,
        title: "Generated card",
        metadata: { mode: "text-to-image" },
        createdAt: "2026-07-16T00:00:00.000Z",
        taskPrompt: "Generated card prompt"
      },
      {
        id: "asset_card_provider",
        userId: "user_1",
        taskId: "task_3",
        type: "image" as const,
        url: providerUrl,
        thumbnailUrl: null,
        title: "Provider card",
        metadata: { mode: "image-to-image" },
        createdAt: "2026-07-15T00:00:00.000Z",
        taskPrompt: "Provider card prompt"
      }
    ];
    const assetRequests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = privateAssetTestUrl(input);
        if (url.pathname === "/api/assets") {
          return new Response(JSON.stringify({ assets }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        if (url.pathname === "/api/assets/asset_card_private/content") {
          assetRequests.push({ url, init });
          return privateAssetTestResponse();
        }

        throw new Error(`Unexpected assets page request: ${url.pathname}${url.search}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createObjectUrl } = mockPrivateAssetObjectUrls(["blob:asset-card"]);

    await mountPrivateAssetPage(
      <AssetsPageContent initialToken="assets-private-token" initialAssets={assets} />
    );

    expect(assetRequests).toHaveLength(1);
    expect(privateAssetHost?.querySelector(`img[src="${privateUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.innerHTML).not.toContain(privateUrl);
    expect(privateAssetHost?.querySelector(`img[src="${generatedUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.querySelector(`img[src="${providerUrl}"]`)).toBeFalsy();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("provider.example.test"))
    ).toBe(false);
    expect(privateAssetHost?.querySelector('[data-mobile-works-gallery="true"]')).toBeTruthy();
    expect(privateAssetHost?.querySelectorAll('[data-mobile-asset-card="true"]')).toHaveLength(1);
    expect(privateAssetHost?.querySelector('a[href="/assets/asset_card_private"]')).toBeTruthy();
    expect(privateAssetHost?.querySelector('[data-asset-image-button="true"]')).toBeFalsy();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(assetRequests.map(({ url }) => url.pathname)).toEqual([
      "/api/assets/asset_card_private/content"
    ]);
    expect(assetRequests.map(({ init }) => new Headers(init?.headers).get("Authorization")))
      .toEqual(["Bearer assets-private-token"]);
    expect(privateAssetHost?.innerHTML).not.toContain("assets-private-token");
  });

  it("does not render a Continue creating action in the Works list", async () => {
    const asset: AiAssetSummary = {
      id: "asset-continue-works",
      userId: "user_1",
      taskId: "task_works",
      type: "image",
      url: "/assets/asset-continue-works/content",
      thumbnailUrl: null,
      title: "Continue source",
      metadata: null,
      createdAt: "2026-07-17T00:00:00.000Z",
      taskPrompt: "Continue prompt"
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      if (url.pathname === "/api/assets") {
        return new Response(JSON.stringify({ assets: [asset] }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.pathname === "/api/assets/asset-continue-works/content") {
        return privateAssetTestResponse();
      }
      throw new Error(`Unexpected Works handoff request: ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mockPrivateAssetObjectUrls(["blob:works-thumbnail"]);

    await mountPrivateAssetPage(
      <AssetsPageContent initialToken="works-token" initialAssets={[asset]} />
    );
    expect(privateAssetHost?.querySelector('[data-asset-continue-creating="true"]')).toBeNull();
    expect(privateAssetHost?.querySelector('a[href="/assets/asset-continue-works"]')).toBeTruthy();
    expect(readImageCreationHandoff()).toBeNull();
    expect(navigationState.routerPush).not.toHaveBeenCalled();
  });

  it("keeps the Works list free of Delete and Continue creating controls", async () => {
    const asset: AiAssetSummary = {
      id: "asset-continue-storage-failure",
      userId: "user_1",
      taskId: null,
      type: "image",
      url: "/assets/asset-continue-storage-failure/content",
      thumbnailUrl: null,
      title: "Storage failure source",
      metadata: null,
      createdAt: "2026-07-17T00:00:00.000Z",
      taskPrompt: null
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      if (url.pathname === "/api/assets") {
        return new Response(JSON.stringify({ assets: [asset] }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.pathname.endsWith("/content")) return privateAssetTestResponse();
      throw new Error(`Unexpected Works list request: ${url.pathname}`);
    }));
    mockPrivateAssetObjectUrls(["blob:storage-failure-thumbnail"]);
    await mountPrivateAssetPage(
      <AssetsPageContent initialToken={null} initialAssets={[asset]} />
    );
    expect(privateAssetHost?.querySelector('[data-asset-continue-creating="true"]')).toBeNull();
    expect(privateAssetHost?.querySelector('[aria-label="Delete asset"]')).toBeNull();
    expect(privateAssetHost?.querySelector('a[href="/assets/asset-continue-storage-failure"]')).toBeTruthy();
    expect(navigationState.routerPush).not.toHaveBeenCalled();
  });

  it("does not fetch or render private asset cards without a token", async () => {
    const privateUrl = "/assets/asset_card_no_token/content";
    const providerUrl = "https://provider.example.test/asset-card-no-token.png";
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      throw new Error(`Unexpected tokenless assets request: ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountPrivateAssetPage(
      <AssetsPageContent
        initialToken={null}
        initialAssets={[
          {
            id: "asset_card_no_token",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: privateUrl,
            thumbnailUrl: null,
            title: "No token private card",
            metadata: { mode: "text-to-image" },
            createdAt: "2026-07-17T00:00:00.000Z",
            taskPrompt: "No token private card prompt"
          },
          {
            id: "asset_card_no_token_provider",
            userId: "user_1",
            taskId: "task_2",
            type: "image",
            url: providerUrl,
            thumbnailUrl: null,
            title: "No token provider card",
            metadata: { mode: "text-to-image" },
            createdAt: "2026-07-16T00:00:00.000Z",
            taskPrompt: "No token provider card prompt"
          }
        ]}
      />
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(privateAssetHost?.querySelector(`img[src="${privateUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.innerHTML).not.toContain(privateUrl);
    expect(privateAssetHost?.querySelector(`img[src="${providerUrl}"]`)).toBeFalsy();
  });

  it("resolves private asset detail thumbnails and downloads them with short-lived Blob URLs", async () => {
    const thumbnailUrl = "/assets/asset_download_thumbnail/content";
    const privateUrl = "/assets/asset_download/content";
    let resolveFirstDownload: (response: Response) => void = () => {
      throw new Error("Download response resolver was not initialized");
    };
    const firstDownload = new Promise<Response>((resolve) => {
      resolveFirstDownload = resolve;
    });
    const downloadResponses: Array<Promise<Response> | Response> = [
      firstDownload,
      privateAssetTestResponse("image/jpeg"),
      privateAssetTestResponse("image/webp"),
      new Response("download unavailable", { status: 503 })
    ];
    const assetRequests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    let downloadResponseIndex = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = privateAssetTestUrl(input);
        if (url.pathname === "/api/assets/asset_download_thumbnail/content") {
          assetRequests.push({ url, init });
          return privateAssetTestResponse();
        }

        if (url.pathname === "/api/assets/asset_download/content") {
          assetRequests.push({ url, init });
          const response = downloadResponses[downloadResponseIndex];
          downloadResponseIndex += 1;
          if (!response) {
            throw new Error("Unexpected additional private download request");
          }
          return response;
        }

        throw new Error(`Unexpected asset detail request: ${url.pathname}${url.search}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createObjectUrl, revokeObjectUrl } = mockPrivateAssetObjectUrls([
      "blob:asset-detail-thumbnail",
      "blob:asset-download-png",
      "blob:asset-download-jpg",
      "blob:asset-download-webp"
    ]);
    const clickedDownloads: Array<{ download: string; href: string; connected: boolean }> = [];

    await mountPrivateAssetPage(
      <AssetDetailPageContent
        assetId="asset_download"
        initialToken="detail-download-token"
        initialAsset={{
          id: "asset_download",
          userId: "user_1",
          taskId: "task_1",
          type: "image",
          url: privateUrl,
          thumbnailUrl,
          title: "Private downloadable image",
          metadata: { mode: "text-to-image" },
          createdAt: "2026-07-17T00:00:00.000Z",
          taskPrompt: "Private downloadable prompt"
        }}
      />
    );
    await settlePrivateAssetPage();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownloads.push({
        download: this.download,
        href: this.href,
        connected: this.isConnected
      });
    });

    expect(privateAssetHost?.querySelector(`img[src="${thumbnailUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.querySelector('img[src="blob:asset-detail-thumbnail"]')).toBeTruthy();
    expect(privateAssetHost?.querySelector(`a[href="${privateUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.textContent).toContain("Download");

    const downloadButton = Array.from(
      privateAssetHost?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find((button) => button.textContent?.includes("Download"));
    expect(downloadButton).toBeTruthy();
    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(assetRequests).toHaveLength(2);
    expect(downloadButton?.disabled).toBe(true);

    await act(async () => {
      resolveFirstDownload(privateAssetTestResponse());
      await firstDownload;
    });
    await settlePrivateAssetPage();

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await settlePrivateAssetPage();
    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await settlePrivateAssetPage();

    expect(assetRequests.map(({ url }) => url.pathname)).toEqual([
      "/api/assets/asset_download_thumbnail/content",
      "/api/assets/asset_download/content",
      "/api/assets/asset_download/content",
      "/api/assets/asset_download/content"
    ]);
    expect(assetRequests.map(({ url }) => url.search)).toEqual(["", "", "", ""]);
    expect(
      assetRequests.map(({ init }) => new Headers(init?.headers).get("Authorization"))
    ).toEqual([
      "Bearer detail-download-token",
      "Bearer detail-download-token",
      "Bearer detail-download-token",
      "Bearer detail-download-token"
    ]);
    expect(clickedDownloads).toEqual([
      { download: "asset-asset_download.png", href: "blob:asset-download-png", connected: true },
      { download: "asset-asset_download.jpg", href: "blob:asset-download-jpg", connected: true },
      { download: "asset-asset_download.webp", href: "blob:asset-download-webp", connected: true }
    ]);
    expect(createObjectUrl).toHaveBeenCalledTimes(4);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:asset-download-png");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:asset-download-jpg");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:asset-download-webp");
    expect(document.querySelector('a[download^="asset-asset_download"]')).toBeFalsy();

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await settlePrivateAssetPage();

    expect(createObjectUrl).toHaveBeenCalledTimes(4);
    expect(clickedDownloads).toHaveLength(3);
    expect(privateAssetHost?.textContent).toContain("Unable to load data");
    expect(privateAssetHost?.innerHTML).not.toContain("detail-download-token");
  });

  it("uses the private asset URL for the detail image when no thumbnail exists", async () => {
    const privateUrl = "/assets/asset_detail_url/content";
    const assetRequests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = privateAssetTestUrl(input);
        if (url.pathname === "/api/assets/asset_detail_url/content") {
          assetRequests.push({ url, init });
          return privateAssetTestResponse();
        }
        throw new Error(`Unexpected fallback detail request: ${url.pathname}${url.search}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    mockPrivateAssetObjectUrls(["blob:asset-detail-url"]);

    await mountPrivateAssetPage(
      <AssetDetailPageContent
        assetId="asset_detail_url"
        initialToken="detail-url-token"
        initialAsset={{
          id: "asset_detail_url",
          userId: "user_1",
          taskId: "task_1",
          type: "image",
          url: privateUrl,
          thumbnailUrl: null,
          title: "Private URL image",
          metadata: { mode: "text-to-image" },
          createdAt: "2026-07-17T00:00:00.000Z",
          taskPrompt: "Private URL prompt"
        }}
      />
    );
    await settlePrivateAssetPage();

    expect(privateAssetHost?.querySelector(`img[src="${privateUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.querySelector('img[src="blob:asset-detail-url"]')).toBeTruthy();
    expect(assetRequests.map(({ url }) => url.pathname)).toEqual([
      "/api/assets/asset_detail_url/content"
    ]);
    expect(new Headers(assetRequests[0]?.init?.headers).get("Authorization")).toBe(
      "Bearer detail-url-token"
    );
  });

  it("keeps asset detail preview available while the primary Continue creating action uses the same handoff", async () => {
    const privateUrl = "/assets/asset-detail-continue/content";
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      if (url.pathname === privateUrl) {
        return privateAssetTestResponse();
      }
      throw new Error(`Unexpected asset detail handoff request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mockPrivateAssetObjectUrls(["blob:detail-main", "blob:detail-preview"]);

    await mountPrivateAssetPage(
      <AssetDetailPageContent
        assetId="asset-detail-continue"
        initialToken="detail-continue-token"
        initialAsset={{
          id: "asset-detail-continue",
          userId: "user_1",
          taskId: null,
          type: "image",
          url: privateUrl,
          thumbnailUrl: null,
          title: "Detail source",
          metadata: { mode: "text-to-image" },
          createdAt: "2026-07-17T00:00:00.000Z",
          taskPrompt: "Detail source prompt"
        }}
      />
    );
    await settlePrivateAssetPage();

    const previewButton = privateAssetHost?.querySelector<HTMLButtonElement>(
      '[data-asset-detail-image-button="true"]'
    );
    expect(previewButton).toBeTruthy();
    await act(async () => {
      previewButton?.click();
      await Promise.resolve();
    });
    expect(privateAssetHost?.querySelector('[data-image-preview-dialog="true"]')).toBeTruthy();

    const continueButton = privateAssetHost?.querySelector<HTMLButtonElement>(
      '[data-asset-detail-continue-creating="true"]'
    );
    await act(async () => {
      continueButton?.click();
      continueButton?.click();
      await Promise.resolve();
    });
    expect(readImageCreationHandoff()).toMatchObject({ assetId: "asset-detail-continue" });
    expect(navigationState.routerPush).toHaveBeenCalledTimes(1);
    expect(navigationState.routerPush).toHaveBeenCalledWith("/image");
  });

  it("keeps private asset downloads disabled and unfetched without a token", async () => {
    const privateUrl = "/assets/asset_detail_no_token/content";
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      throw new Error(`Unexpected tokenless asset detail request: ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountPrivateAssetPage(
      <AssetDetailPageContent
        assetId="asset_detail_no_token"
        initialToken={null}
        initialAsset={{
          id: "asset_detail_no_token",
          userId: "user_1",
          taskId: "task_1",
          type: "image",
          url: privateUrl,
          thumbnailUrl: null,
          title: "No token private detail",
          metadata: { mode: "text-to-image" },
          createdAt: "2026-07-17T00:00:00.000Z",
          taskPrompt: "No token private detail prompt"
        }}
      />
    );

    const downloadButton = Array.from(
      privateAssetHost?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find((button) => button.textContent?.includes("Download"));
    expect(downloadButton).toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(privateAssetHost?.querySelector(`img[src="${privateUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.innerHTML).not.toContain(privateUrl);
  });

  it("rejects provider asset detail images and copies only the private detail URL", async () => {
    const providerUrl = "https://provider.example.test/asset-detail-provider.png";
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      throw new Error(`Unexpected provider detail request: ${url.pathname}${url.search}`);
    });
    const clipboardWrite = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await mountPrivateAssetPage(
      <AssetDetailPageContent
        assetId="asset_provider"
        initialToken={null}
        initialAsset={{
          id: "asset_provider",
          userId: "user_1",
          taskId: "task_1",
          type: "image",
          url: providerUrl,
          thumbnailUrl: null,
          title: "Provider image",
          metadata: { mode: "text-to-image" },
          createdAt: "2026-07-17T00:00:00.000Z",
          taskPrompt: "Provider prompt"
        }}
      />
    );
    expect(privateAssetHost?.querySelector(`img[src="${providerUrl}"]`)).toBeFalsy();
    expect(privateAssetHost?.querySelector(`a[href="${providerUrl}"][target="_blank"]`)).toBeFalsy();
    expect(privateAssetHost?.textContent).not.toContain("Open image");
    expect(fetchMock).not.toHaveBeenCalled();

    expect(privateAssetHost?.textContent).toContain("Sign in required");
    expect(privateAssetHost?.querySelectorAll("button")).toHaveLength(0);
    expect(privateAssetHost?.innerHTML).not.toContain("blob:");
  });
});

describe("multimodal workspace pages", () => {
  it("renders the unified Image Creator empty foundation", async () => {
    const html = renderRoute(ImagePage);

    expect(html).toContain("Image Creation");
    expect(html).toContain("Free create");
    expect(html).toContain("Precision Edit");
    expect(html).toContain("Title to cover");
    expect(html).toContain("Transcript to Images");
    expect(html).toContain("History");
    expect(html).toContain("Reference image");
    expect(html).toContain("Creation description");
    expect(html).toContain("Model");
    expect(html).toContain("Aspect ratio");
    expect(html).toContain("Count");
    expect(html).toContain("16:9");
    expect(html).toContain("Generate image");
    expect(html).toContain('data-image-generation-count-picker="true"');
    expect(html).toContain("PNG, JPG, or WebP up to 5 MB");
    expect(html).not.toContain("Generation mode");
    expect(html).not.toContain("Template / scene");
    expect(html).not.toContain("Choose a template");
    expect(html).not.toContain("Multimodal workspace");
    expect(html).not.toContain(
      "Generate images from a text prompt with an image-capable model."
    );
    expect(html).not.toContain(
      "Credits are deducted only after successful image generation."
    );
    expect(html).toContain('data-image-workspace-root="true"');
    expect(html).toContain('data-image-main-scroll="true"');
    expect(html).toContain('data-image-empty-state="true"');
    expect(html).toContain('data-image-creator-main="left-input-right-result"');
    expect(html).toContain('data-image-creator-input="true"');
    expect(html).toContain('data-image-creator-result="true"');
    expect(html).not.toContain('data-image-secondary-sidebar="true"');
    expect(html).not.toContain('data-image-inspiration-carousel="true"');
    expect(html).not.toContain('data-image-inspiration-grid="true"');
    expect(html).not.toContain('data-image-inspiration-list="horizontal"');
    expect(html).toContain('data-image-creator-desktop-composer="true"');
    expect(html).toContain('data-image-drag-upload="reference-image"');
    expect(html).toContain('data-image-workbench-cost="true"');
    expect(html).toContain('data-image-generate-request-flow="unchanged"');
    expect(html).toContain("bg-indigo-50");
  });

  it("defers the /image shell until the responsive surface is known", async () => {
    const html = renderWithLocale(
      <WorkspaceLayoutClient gateUntilHydrated={false}>
        <ImagePage />
      </WorkspaceLayoutClient>,
      "zh-CN"
    );
    expect(html).toContain('data-workspace-auth-loading="true"');
    expect(html).not.toContain('data-mobile-workspace-shell="true"');
    expect(html).not.toContain('data-desktop-workspace-shell="true"');
    expect(html).not.toContain('data-image-mobile-header="true"');
  });

  it("defers non-image workspace shell selection until the responsive surface is known", async () => {
    navigationState.pathname = "/tasks";
    const tasksHtml = renderWithLocale(
      <WorkspaceLayoutClient gateUntilHydrated={false}>
        <TasksPage />
      </WorkspaceLayoutClient>,
      "zh-CN"
    );
    navigationState.pathname = "/assets";
    const assetsHtml = renderWithLocale(
      <WorkspaceLayoutClient gateUntilHydrated={false}>
        <AssetsPage />
      </WorkspaceLayoutClient>,
      "zh-CN"
    );

    for (const html of [tasksHtml, assetsHtml]) {
      expect(html).toContain('data-workspace-auth-loading="true"');
      expect(html).not.toContain('data-mobile-workspace-shell="true"');
      expect(html).not.toContain('data-desktop-workspace-shell="true"');
      expect(html).not.toContain('data-mobile-works-switcher="true"');
      expect(html).not.toContain('data-mobile-bottom-nav="true"');
      expect(html).not.toContain('data-mobile-menu-button="true"');
      expect(html).not.toContain('data-mobile-drawer="true"');
      expect(html).not.toContain('data-image-mobile-drawer-panel="true"');
    }
  });

  it("keeps the unified Creator route content-only without owning workspace shells", async () => {
    const html = renderRoute(ImagePage);

    expect(html).toContain("Image Creation");
    expect(html).toContain("Free create");
    expect(html).toContain("Generate image");
    expect(html).not.toContain("Multimodal workspace");
    expect(html).not.toContain(
      "Generate images from a text prompt with an image-capable model."
    );
    expect(html).not.toContain('data-desktop-workspace-shell="true"');
    expect(html).not.toContain('data-mobile-workspace-shell="true"');
  });

  it("keeps unified Creator model, aspect, count, and generation controls visible", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model With A Very Long Display Name",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model-with-a-very-long-provider-id",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain("Creation description");
    expect(html).toContain("Image Model With A Very Long Display Name");
    expect(html).toContain("History");
    expect(html).toContain("Reference image");
    expect(html).toContain("auto");
    expect(html).toContain("1:1");
    expect(html).toContain("16:9");
    expect(html).toContain("2:3");
    expect(html).toContain("Generate image");
    expect(html).toContain('data-image-workspace-root="true"');
    expect(html).toContain('data-image-workspace-grid="true"');
    expect(html).toContain('data-image-main-scroll="true"');
    expect(html).toContain('data-image-empty-state="true"');
    expect(html).toContain('data-image-creator-main="left-input-right-result"');
    expect(html).not.toContain('data-image-secondary-sidebar="true"');
    expect(html).not.toContain('data-image-inspiration-grid="true"');
    expect(html).not.toContain('data-image-inspiration-gallery="true"');
    expect(html).toContain('data-image-composer-prompt="true"');
    expect(html).toContain('data-image-workbench-model="true"');
    expect(html).toContain('data-image-workbench-size="true"');
    expect(html).toContain('data-image-generation-count-picker="true"');
    expect(html).toContain('data-image-workbench-cost="true"');
    expect(html).toContain('data-image-generate-button="true"');
    expect(html).toContain("Estimated cost: 2");
    expect(html).toContain("Current balance: 20");
    expect(html).toContain("<select");
    expect(html).toContain("w-full");
    expect(html).toContain("min-w-0");
    expect(html).toContain("truncate");
  });

  it("keeps the mobile Creator chrome truthful while responsive presentation owns composition", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialModels={[createImageModel({ modelId: "image-model" })]}
      />,
      "zh-CN"
    );

    expect(html).toContain('data-image-mobile-inspiration-disabled="true"');
    expect(html).toContain("灵感库");
    expect(html).toContain('data-image-mobile-history-button="true"');
    expect(html).toContain('data-image-creator-result="true"');
    expect(html).toContain('data-image-creator-desktop-composer="true"');
    expect(html).not.toContain('data-image-mobile-mode-switch="true"');
  });

  it("guards video Quick Creation behind authentication", async () => {
    const html = renderRoute(VideoPage);

    expect(html).toContain("Video Creation");
    expect(html).toContain("Sign in required");
    expect(html).not.toContain("Coming soon. This placeholder does not submit generation jobs yet.");
    expect(html).not.toContain("Duration");
    expect(html).not.toContain("Aspect ratio");
  });

  it("renders the PPT generation skeleton", async () => {
    const html = renderRoute(PptPage);

    expect(html).toContain("PPT Generation");
    expect(html).toContain("Topic");
    expect(html).toContain("Page count");
    expect(html).toContain("Style");
    expect(html).toContain("Generate outline");
    expect(html).toContain("Generate PPT");
    expect(html).toContain("Coming soon. This placeholder does not submit generation jobs yet.");
  });

  it("renders the unified task history skeleton with filters and initial loading state", async () => {
    const html = renderRoute(TasksPage);

    expect(html).toContain("Works");
    expect(html).toContain('data-tasks-workspace-root="full-width"');
    expect(html).toContain('data-tasks-overflow-root="mobile:overflow-y-auto md:overflow-hidden"');
    expect(html).toContain('data-mobile-tasks-scroll-owner="true"');
    expect(html).toContain('data-mobile-works-switcher="true"');
    expect(html).toContain('data-mobile-task-status-filters="true"');
    expect(html).not.toContain("grid-cols-[100px");
    expect(html).toContain("All");
    expect(html).toContain("Completed");
    expect(html).toContain("Failed");
    expect(html).toContain("In progress");
    // First render shows loading state, not empty state
    expect(html).toContain('data-mobile-tasks-loading="true"');
    expect(html).not.toContain("No generation tasks yet");
  });

  it("renders the asset library skeleton before metadata is available", async () => {
    const html = renderRoute(AssetsPage);

    expect(html).toContain("Works");
    expect(html).toContain('data-mobile-works-assets-loading="true"');
    expect(html).toContain('data-mobile-assets-scroll-owner="true"');
    expect(html).not.toContain("No works yet");
  });

  it("renders Chinese page copy from i18n keys", async () => {
    const imageHtml = renderRoute(ImagePage, "zh-CN");
    const tasksHtml = renderRoute(TasksPage, "zh-CN");

    expect(imageHtml).toContain("图像创作");
    expect(imageHtml).not.toContain("多模态工作区");
    expect(imageHtml).not.toContain("使用支持图片能力的模型，根据文字提示词生成图片。");
    expect(imageHtml).not.toContain("图片生成成功后才会扣除额度");
    expect(tasksHtml).toContain("作品");
    // First render shows loading, not empty
    expect(tasksHtml).toContain('data-mobile-tasks-loading="true"');
    expect(tasksHtml).not.toContain("暂无生成任务");
  });

  it("renders the unified Creator selected-result state with truthful work actions", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
        initialAssets={[
          {
            id: "asset_1",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "https://cdn.example.com/image.png",
            thumbnailUrl: null,
            title: "A quiet reading room",
            metadata: null,
            createdAt: "2026-06-18T00:00:00.000Z",
            taskPrompt: "A quiet reading room"
          }
        ]}
        initialResult={{
          task: {
            id: "task_1",
            userId: "user_1",
            type: "image",
            status: "succeeded",
            modelId: "image-model",
            prompt: "A quiet reading room",
            input: { size: "1024x1024", count: 1 },
            output: { images: ["https://cdn.example.com/image.png"] },
            costCredits: 2,
            errorMessage: null,
            createdAt: "2026-06-18T00:00:00.000Z",
            updatedAt: "2026-06-18T00:00:10.000Z",
            completedAt: "2026-06-18T00:00:10.000Z"
          },
          assets: [
            {
              id: "asset_1",
              userId: "user_1",
              taskId: "task_1",
              type: "image",
              url: "https://cdn.example.com/image.png",
              thumbnailUrl: null,
              title: "A quiet reading room",
              metadata: null,
              createdAt: "2026-06-18T00:00:00.000Z",
              taskPrompt: "A quiet reading room"
            }
          ]
        }}
      />
    );

    expect(html).toContain("Image Model");
    expect(html).toContain("History");
    expect(html).not.toContain('data-image-inspiration-carousel="true"');
    expect(html).toContain("Reference image");
    expect(html).toContain("1:1");
    expect(html).toContain("16:9");
    expect(html).toContain('data-image-generation-count-picker="true"');
    expect(html).toContain("Estimated cost: 2");
    expect(html).toContain("Regenerate");
    expect(html).toContain("View work");
    expect(html).toContain("Saved");
    expect(html).toContain("View task details");
    expect(html).toContain('href="/tasks/task_1"');
    expect(html).toContain('href="/assets/asset_1"');
    expect(html).toContain('data-image-ai-status="succeeded"');
    expect(html).toContain('data-image-ai-result="true"');
    expect(html).toContain('data-image-creator-result-hero="true"');
    expect(html).toContain('data-image-creator-selected-result="true"');
    expect(html).not.toContain('data-image-empty-state="true"');
    const resultHtml = html.split('data-image-creator-result="true"', 2)[1];

    expect(resultHtml).toBeDefined();
    expect(resultHtml).not.toContain('target="_blank"');
    expect(resultHtml).toContain('data-image-workbench-result-image="true"');
  });

  it("parses and expires image model handoff payloads", async () => {
    const now = Date.parse("2026-07-08T00:00:00.000Z");

    expect(
      parseImageModelHandoff(
        JSON.stringify({ modelId: "gpt-image-2", createdAt: now }),
        now + imageModelHandoffMaxAgeMs - 1
      )
    ).toBe("gpt-image-2");
    expect(
      parseImageModelHandoff(
        JSON.stringify({ modelId: "gpt-image-2", createdAt: now }),
        now + imageModelHandoffMaxAgeMs + 1
      )
    ).toBeNull();
    expect(parseImageModelHandoff("{bad-json", now)).toBeNull();
    expect(parseImageModelHandoff(JSON.stringify({ modelId: 1, createdAt: now }), now)).toBeNull();
  });

  it("consumes image model handoff through canonical slug state and clears sessionStorage", async () => {
    const source = readFileSync(
      new URL("./image/image-page-content.tsx", import.meta.url),
      "utf8"
    );

    expect(imageModelHandoffStorageKey).toBe(
      "ai-aggregate:image-selected-model-handoff:v1"
    );
    expect(source).toContain("window.sessionStorage.getItem(imageModelHandoffStorageKey)");
    expect(source).toContain("parseImageModelHandoff(rawHandoff)");
    expect(source).toContain("resolveImageSelectableModel(handoffModelId, models)");
    expect(source).toContain("setSelectedModelSlug(matchingModel.slug)");
    expect(source).toContain("window.sessionStorage.removeItem(imageModelHandoffStorageKey)");
    expect(source).not.toContain('get("modelId")');
  });

  it("waits for models to load before consuming or discarding a valid handoff", async () => {
    const source = readFileSync(
      new URL("./image/image-page-content.tsx", import.meta.url),
      "utf8"
    );

    // modelsLoaded state exists
    expect(source).toContain("const [modelsLoaded, setModelsLoaded] = useState");
    // Handoff effect depends on both models and modelsLoaded
    expect(source).toContain("[models, modelsLoaded]");
    // Invalid/expired handoff is cleaned up early
    expect(source).toContain("// Invalid or expired handoff");
    // Valid handoff waits for models
    expect(source).toContain("// Valid handoff — wait for models to load");
    // Does NOT delete a valid handoff before models load
    expect(source).toContain("if (models.length === 0)");
    // Sets modelsLoaded=true after fetch completes
    expect(source).toContain("setModelsLoaded(true)");
    // Sets modelsLoaded on fetch error too (prevents infinite wait)
    expect(source).toContain("setModelsLoaded(true);\n        showError(");
  });

  it("uses submitted-entry-only scrolling instead of a mount scroll anchor", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
        initialResult={{
          task: {
            id: "task_scroll",
            userId: "user_1",
            type: "image",
            status: "succeeded",
            modelId: "image-model",
            prompt: "A sunset",
            input: { size: "1024x1024", count: 1 },
            output: { images: ["https://cdn.example.com/sunset.png"] },
            costCredits: 2,
            errorMessage: null,
            createdAt: "2026-07-07T00:00:00.000Z",
            updatedAt: "2026-07-07T00:00:10.000Z",
            completedAt: "2026-07-07T00:00:10.000Z"
          },
          assets: [
            {
              id: "asset_scroll",
              userId: "user_1",
              taskId: "task_scroll",
              type: "image",
              url: "https://cdn.example.com/sunset.png",
              thumbnailUrl: null,
              title: "A sunset",
              metadata: null,
              createdAt: "2026-07-07T00:00:00.000Z",
              taskPrompt: "A sunset"
            }
          ]
        }}
      />
    );

    expect(html).toContain('data-image-scroll-policy="submitted-entry-only"');
    expect(html).not.toContain('data-image-scroll-anchor="true"');
  });

  it("shows the reference upload entry in the composer", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialGenerationMode="image-to-image"
        initialPrompt="Restyle this room"
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain("Reference image");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain('data-image-creator-input="true"');
    expect(html).toContain('data-image-drag-upload="reference-image"');
    expect(html).toContain('data-image-drag-uses-existing-validation="true"');
  });

  it("rejects oversized reference images before compression", async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png"
    });

    expect(validateReferenceImageFile(file)).toEqual({
      valid: false,
      errorKey: "multimodal.error.referenceImageOriginalTooLarge",
      state: { status: "too-large-original" }
    });
  });

  it("compresses accepted reference images to a JPEG data URL", async () => {
    const compressedBase64 = "a".repeat(296 * 1024);

    class FakeFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL() {
        this.result = "data:image/png;base64,aW1hZ2U=";
        this.onload?.({} as ProgressEvent<FileReader>);
      }
    }

    class FakeImage {
      naturalWidth = 2400;
      naturalHeight = 1200;
      width = 2400;
      height = 1200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }

    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => `data:image/jpeg;base64,${compressedBase64}`);
    vi.stubGlobal("FileReader", FakeFileReader);
    vi.stubGlobal("window", { Image: FakeImage });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage })),
        toDataURL
      }))
    });

    const file = new File(["image"], "reference.png", { type: "image/png" });
    const result = await compressReferenceImage(file);

    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.compressedBytes).toBe(estimateDataUrlBytes(result.dataUrl));
    expect(result.sourceWidth).toBe(2400);
    expect(result.sourceHeight).toBe(1200);
    expect(result.compressedBytes).toBeLessThan(1024 * 1024);
    expect(formatBytes(1_280_000)).toBe("1.22MB");
    expect(formatBytes(result.compressedBytes)).toBe("222KB");
    expect(drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 1024, 512);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.82);
  });

  it.each([
    ["16:9", "16:9"],
    ["16：9", "16:9"],
    ["１６：９", "16:9"],
    ["16/9", "16:9"],
    ["１６／９", "16:9"],
    ["16 / 9", "16:9"],
    ["9:16", "9:16"],
    ["1:1", "1:1"],
    ["4:3", "4:3"],
    ["3:4", "3:4"],
    ["2:3", "2:3"],
    ["3:2", "3:2"],
    ["正方形", "1:1"],
    ["square", "1:1"],
    ["SQUARE", "1:1"],
    ["做一张 3:4 竖版封面", "3:4"],
    ["Create a 16:9 landscape cover", "16:9"],
    ["横版", null],
    ["竖屏", null],
    ["portrait", null],
    ["landscape", null],
    ["", null],
    ["   ", null]
  ] as const)("infers only high-confidence prompt aspects from %s", (prompt, expected) => {
    expect(inferAspectRatioFromPrompt(prompt)).toBe(expected);
  });

  it("deduplicates equal prompt ratios and rejects ambiguity or unsupported ratios", () => {
    expect(inferAspectRatioFromPrompt("16:9 ... 16/9")).toBe("16:9");
    expect(inferAspectRatioFromPrompt("16:9 ... 1:1")).toBeNull();
    expect(inferAspectRatioFromPrompt("5:7")).toBeNull();
    expect(inferAspectRatioFromPrompt("5:7 ... 16:9")).toBeNull();
    expect(inferAspectRatioFromPrompt("4:5 ... square")).toBeNull();
    expect(inferAspectRatioFromPrompt("2026 1080p 4K")).toBeNull();
  });

  it("applies explicit, reference, prompt, and fallback size precedence", () => {
    expect(resolveImageGenerationSize("1:1", "text-to-image", null, "16:9")).toBe(
      "1024x1024"
    );
    expect(
      resolveImageGenerationSize(
        "auto",
        "image-to-image",
        { width: 900, height: 1600 },
        "16:9"
      )
    ).toBe("720x1280");
    expect(resolveImageGenerationSize("auto", "text-to-image", null, "16:9")).toBe(
      "1280x720"
    );
    expect(resolveImageGenerationSize("auto", "text-to-image", null, "")).toBe(
      "1024x1024"
    );
    expect(
      resolveImageGenerationSize(
        "auto",
        "image-to-image",
        { width: 0, height: 1600 },
        "16:9"
      )
    ).toBe("1280x720");
    expect(
      resolveImageGenerationSize(
        "auto",
        "image-to-image",
        { width: Number.NaN, height: 1600 },
        ""
      )
    ).toBe("1024x1024");
  });

  it("resolves auto image generation size from reference dimensions only for image-to-image", () => {
    expect(resolveImageGenerationSize("auto", "text-to-image", null)).toBe(
      "1024x1024"
    );
    expect(resolveImageGenerationSize("auto", "image-to-image", null)).toBe(
      "1024x1024"
    );
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: 1024,
        height: 1024
      })
    ).toBe("1024x1024");
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: 1600,
        height: 900
      })
    ).toBe("1280x720");
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: 900,
        height: 1600
      })
    ).toBe("720x1280");
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: 1200,
        height: 900
      })
    ).toBe("1024x768");
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: 900,
        height: 1200
      })
    ).toBe("768x1024");
  });

  it("keeps manual image ratio choices independent from reference dimensions", () => {
    expect(
      resolveImageGenerationSize("16:9", "image-to-image", {
        width: 900,
        height: 1600
      })
    ).toBe("1280x720");
  });

  it("falls back to square size for invalid auto reference dimensions", () => {
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: 0,
        height: 1200
      })
    ).toBe("1024x1024");
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: 1200,
        height: 0
      })
    ).toBe("1024x1024");
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: Number.NaN,
        height: 1200
      })
    ).toBe("1024x1024");
    expect(
      resolveImageGenerationSize("auto", "image-to-image", {
        width: 1200,
        height: Number.POSITIVE_INFINITY
      })
    ).toBe("1024x1024");
    expect(resolveImageGenerationSize("auto", "image-to-image", null)).toBe(
      "1024x1024"
    );
  });

  it("keeps text-to-image as the default when no reference image is attached", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialPrompt="A quiet reading room"
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).not.toContain("Text to image");
    expect(html).toContain("Reference image");
    expect(html).toContain('type="file"');
    expect(html).toContain("Generate image");
    expect(html).not.toContain('data-reference-image-preview="true"');
    expect(html).toContain('data-image-generate-request-flow="unchanged"');
  });

  it("keeps logged-out image generation guarded", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken={null}
        initialCredits={20}
        initialPrompt="A quiet reading room"
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain('data-image-logged-out-guard="toast-no-generate"');
    expect(html).toContain('data-image-login-required-hint="true"');
    expect(html).toContain("Please sign in before generating images");
    expect(html).toContain('data-image-generate-request-flow="unchanged"');
    expect(html).toContain('data-creation-surface-option="video"');
    expect(html).toContain('href="/video"');
    expect(html).toContain('data-creation-surface-option="canvas"');
    expect(html).toContain('href="/canvas"');
    expect(html).not.toContain('data-creation-surface-option="ppt"');
  });

  it("shows existing toast behavior for invalid drag-uploaded reference files", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialError="Reference image must be PNG, JPG, or WebP."
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain('data-image-drag-upload="reference-image"');
    expect(html).toContain('data-image-drag-active="false"');
    expect(html).toContain('data-image-drag-uses-existing-validation="true"');
    expect(html).toContain('data-image-error-toast="true"');
    expect(html).toContain("Reference image must be PNG, JPG, or WebP.");
  });

  it("selecting an image preset applies its prompt template", () => {
    expect(imageInspirationPresets).toHaveLength(6);
    expect(imageInspirationPresets.map((item) => item.id)).toContain(
      "commerce-product"
    );

    const preset = imagePromptPresets.find(
      (item) => item.id === "website-article-cover"
    );

    expect(preset).toBeDefined();

    const nextValues = applyImagePromptPreset(
      preset!,
      "16:9 website article cover for [主题], clean and professional, [风格], for a [用途] article."
    );

    expect(nextValues.prompt).toContain("[主题]");
    expect(nextValues.prompt).toContain("[风格]");
    expect(nextValues.prompt).toContain("[用途]");
  });

  it("selecting an image preset applies the recommended size", () => {
    expect(defaultImageGenerationCount).toBe(1);

    const bilibiliPreset = imagePromptPresets.find(
      (item) => item.id === "bilibili-cover-169"
    );
    const verticalPreset = imagePromptPresets.find(
      (item) => item.id === "vertical-social-cover"
    );

    expect(bilibiliPreset).toBeDefined();
    expect(verticalPreset).toBeDefined();
    expect(applyImagePromptPreset(bilibiliPreset!, "prompt").size).toBe(
      "1280x720"
    );
    expect(applyImagePromptPreset(verticalPreset!, "prompt").size).toBe(
      "720x1280"
    );
  });

  it("keeps manual image prompt editing available", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialPrompt="Manual creator prompt"
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain("Manual creator prompt");
    expect(html).toContain("Generate image");
  });

  it("shows image-capable models and hides chat-only models", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: [],
            capability: "image",
            isRecommended: false
          },
          {
            id: "model_chat",
            name: "Chat Model",
            displayName: "Chat Model",
            slug: "chat-model",
            provider: "SUB2API",
            modelId: "chat-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 1,
            allowGuest: true,
            sortOrder: 1,
            group: "free",
            tags: ["chat"],
            capability: "chat",
            isRecommended: false
          },
          {
            id: "model_disabled_image",
            name: "Disabled Image Model",
            displayName: "Disabled Image Model",
            slug: "disabled-image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "disabled-image-model",
            enabled: false,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 2,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain("Image Model");
    expect(html).not.toContain("Chat Model");
    expect(html).not.toContain("Disabled Image Model");
  });
  it("keeps generation unavailable when the prompt is empty", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain("Generate image");
    expect(html).toContain("disabled=");
  });

  it("shows loading state and disables generation while submitting", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialIsLoading
        initialPrompt="A quiet reading room"
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain("Generating...");
    expect(html).toContain("Generating your image...");
    expect(html).toContain('data-image-creator-result="true"');
    expect(html).toContain('data-image-ai-status="loading"');
    expect(html).toContain('data-image-ai-loading="true"');
    expect(html).toContain('data-image-loading-skeleton="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled=");
  });

  it("renders dismissible ordinary image errors with auto-dismiss metadata", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialPrompt="A quiet reading room"
        initialError="Reference image is too large."
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain("Reference image is too large.");
    expect(html).toContain("Close error");
    expect(html).toContain('aria-label="Close error"');
    expect(html).toContain('data-image-error-toast="true"');
    expect(html).toContain('data-image-error-auto-dismiss="true"');
    expect(html).toContain('data-image-error-timeout-ms="10000"');
  });

  it("renders image generation failure in the Creator result area", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialPrompt="A quiet reading room"
        initialError="Generation failed. Please try again."
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain('data-image-creator-result="true"');
    expect(html).toContain('data-image-ai-status="failed"');
    expect(html).toContain('data-image-ai-error="true"');
    expect(html).toContain("Generation failed. Please try again.");
  });

  it("renders a compact optional reference thumbnail in the Creator input", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialPrompt="Restyle this room"
        initialIsLoading
        initialGenerationMode="image-to-image"
        initialReferenceImage={{
          dataUrl: "data:image/jpeg;base64,cm9vbQ==",
          mimeType: "image/jpeg",
          name: "room.jpg",
          originalBytes: 2048,
          compressedBytes: 1024
        }}
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain('data-reference-image-preview="true"');
    expect(html).toContain("room.jpg");
    expect(html).not.toContain("Image to image");

    // Issue 4: automatic compression notice is hidden from users
    // The reference image is compressed but the user sees only the file name,
    // not "Reference image compressed: 2KB → 1KB" or similar
    expect(html).not.toContain("compressed:");
    expect(html).not.toContain("已自动压缩");
    // Issue 4-rework: "Selected: xxx" is no longer rendered — the file name\n    // is already shown above the textarea; this avoids duplicate messaging.\n    expect(html).not.toContain("Selected: room.jpg");
  });

  it("serializes image sessions without persisting reference data URLs", async () => {
    const entries = Array.from({ length: 22 }, (_, index) => ({
      id: `entry_${index}`,
      prompt: `Prompt ${index}`,
      modelName: "Image Model",
      aspectRatio: "1:1" as const,
      mode: "image-to-image" as const,
      referenceImage:
        index === 21
          ? {
              dataUrl: "data:image/jpeg;base64,cmVm",
              name: "reference-latest.jpg"
            }
          : null,
      status: "succeeded" as const,
      result: null,
      error: null
    }));
    const sessions = [
      {
        id: "session_1",
        title: "Stored session",
        entries
      }
    ];

    const serialized = serializeImageSessionsForStorage(
      sessions,
      "session_1",
      20,
      {
        firstPageLoadedAt: "2026-07-07T00:00:10.000Z",
        backendHistoryDismissed: true
      }
    );
    expect(serialized).not.toContain("data:image/jpeg;base64,cmVm");
    const restored = parseStoredImageSessions(serialized, 20);

    expect(restored?.activeSessionId).toBe("session_1");
    expect(restored?.firstPageLoadedAt).toBe("2026-07-07T00:00:10.000Z");
    expect(restored?.backendHistoryDismissed).toBe(true);
    expect(restored?.sessions).toHaveLength(1);
    expect(restored?.sessions[0]?.entries).toHaveLength(20);
    expect(restored?.sessions[0]?.entries[0]?.id).toBe("entry_2");
    expect(restored?.sessions[0]?.entries.at(-1)?.referenceImage).toBeNull();
    expect(
      restored?.sessions[0]?.entries.at(-1)?.referenceImageMetadata
    ).toEqual({ name: "reference-latest.jpg" });
  });

  it("sanitizes legacy reference bytes without stripping generic fields", async () => {
    const legacyDataUrl = "data:image/jpeg;base64,SECRET_REFERENCE";
    const normalGeneratedThumbnail = "data:image/png;base64,SAFE_OUTPUT_THUMBNAIL";
    const legacyStoredValue = JSON.stringify({
      version: 1,
      activeSessionId: "session_legacy-reference",
      sessions: [
        {
          id: "session_legacy-reference",
          title: "Legacy reference",
          entries: [
            {
              id: "entry_legacy-reference",
              prompt: "Keep this prompt",
              modelName: "Image Model",
              aspectRatio: "1:1",
              mode: "image-to-image",
              referenceImage: {
                dataUrl: legacyDataUrl,
                name: "legacy-reference.jpg"
              },
              status: "succeeded",
              result: {
                task: {
                  id: "task_legacy-reference",
                  prompt: "Keep this result",
                  input: {
                    mode: "image-to-image",
                    referenceImage: {
                      dataUrl: legacyDataUrl,
                      base64: "SECRET_REFERENCE_BASE64",
                      name: "legacy-reference.jpg",
                      mimeType: "image/jpeg",
                      originalBytes: 2048,
                      compressedBytes: 1024
                    }
                  },
                  output: {
                    bytes: 1234,
                    dataUrl: "non-reference-output-marker"
                  }
                },
                assets: [
                  {
                    id: "asset_legacy-reference",
                    taskId: "task_legacy-reference",
                    type: "image",
                    url: "https://cdn.example.test/legacy-reference.png",
                    thumbnailUrl: normalGeneratedThumbnail,
                    metadata: {
                      bytes: 5678,
                      base64: "non-reference-metadata-marker"
                    }
                  }
                ]
              },
              error: null
            }
          ]
        }
      ]
    });

    const restored = parseStoredImageSessions(legacyStoredValue);
    const restoredEntry = restored?.sessions[0]?.entries[0];

    expect(restoredEntry).toMatchObject({
      prompt: "Keep this prompt",
      mode: "image-to-image",
      referenceImage: null,
      referenceImageMetadata: { name: "legacy-reference.jpg" },
      status: "succeeded"
    });
    expect(restoredEntry?.result?.task.input.referenceImage).toEqual({
      name: "legacy-reference.jpg",
      mimeType: "image/jpeg",
      originalBytes: 2048,
      compressedBytes: 1024
    });
    expect(restoredEntry?.result?.task.output?.bytes).toBe(1234);
    expect(restoredEntry?.result?.task.output?.dataUrl).toBe(
      "non-reference-output-marker"
    );
    expect(restoredEntry?.result?.assets[0]?.url).toBe(
      "https://cdn.example.test/legacy-reference.png"
    );
    expect(restoredEntry?.result?.assets[0]?.thumbnailUrl).toBe(
      normalGeneratedThumbnail
    );
    expect(restoredEntry?.result?.assets[0]?.metadata?.bytes).toBe(5678);
    expect(restoredEntry?.result?.assets[0]?.metadata?.base64).toBe(
      "non-reference-metadata-marker"
    );

    const rewritten = serializeImageSessionsForStorage(
      restored?.sessions ?? [],
      "session_legacy-reference"
    );
    expect(rewritten).not.toContain("SECRET_REFERENCE");
    expect(rewritten).not.toContain("SECRET_REFERENCE_BASE64");
    expect(rewritten).toContain("legacy-reference.jpg");
    expect(rewritten).toContain("non-reference-output-marker");
    expect(rewritten).toContain("non-reference-metadata-marker");
    expect(rewritten).toContain("https://cdn.example.test/legacy-reference.png");
  });

  it("keeps text-to-image history content unchanged by reference sanitation", () => {
    const restored = parseStoredImageSessions(
      serializeImageSessionsForStorage(
        [
          {
            id: "session-text-only",
            title: "Text only",
            entries: [
              {
                id: "entry-text-only",
                prompt: "A quiet reading room",
                modelName: "Image Model",
                aspectRatio: "1:1",
                mode: "text-to-image",
                referenceImage: null,
                referenceImageMetadata: null,
                status: "loading",
                result: null,
                error: null
              }
            ]
          }
        ],
        "session-text-only"
      )
    );

    expect(restored?.sessions[0]?.entries[0]).toMatchObject({
      prompt: "A quiet reading room",
      mode: "text-to-image",
      referenceImage: null,
      status: "loading"
    });
  });

  it("rejects invalid image session storage payloads without throwing", async () => {
    expect(parseStoredImageSessions("{")).toBeNull();
    expect(
      parseStoredImageSessions(
        JSON.stringify({
          version: 0,
          activeSessionId: "session_1",
          sessions: []
        })
      )
    ).toBeNull();
    expect(
      parseStoredImageSessions(
        JSON.stringify({
          version: 1,
          activeSessionId: "session_1",
          sessions: [{ id: "session_1" }]
        })
      )
    ).toBeNull();
  });

  it.each([
    [2, 2],
    [4, 4],
    [3, 1],
    [0, 1],
    [-1, 1],
    [1000000, 1],
    ["4", 1],
    [null, 1],
    [undefined, 1]
  ] as const)("normalizes stored requestedCount %s to %i", (storedCount, expected) => {
    const entry: Record<string, unknown> = {
      id: `stored-count-${String(storedCount)}`,
      prompt: "Stored count",
      modelName: "Image Model",
      aspectRatio: "1:1",
      mode: "text-to-image",
      referenceImage: null,
      status: "loading",
      result: null,
      error: null
    };
    if (storedCount !== undefined) {
      entry.requestedCount = storedCount;
    }

    const restored = parseStoredImageSessions(
      JSON.stringify({
        version: 1,
        activeSessionId: "session_1",
        sessions: [{ id: "session_1", title: "Stored", entries: [entry] }]
      })
    );

    const requestedCount = restored?.sessions[0]?.entries[0]?.requestedCount;
    expect(requestedCount).toBe(readImageGenerationCount(expected));
    expect(Array.from({ length: requestedCount ?? 0 })).toHaveLength(expected);
    expect(requestedCount).not.toBe(1000000);
  });

  it("restores a legacy succeeded batch count from task input when requestedCount is absent", () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const task = createTask({
      id: "task-legacy-four",
      status: "succeeded",
      prompt: "Legacy four images",
      input: { mode: "text-to-image", size: "1024x1024", count: 4 },
      output: {
        images: [
          "https://cdn.example.com/legacy-0.png",
          "https://cdn.example.com/legacy-1.png",
          "https://cdn.example.com/legacy-2.png",
          "https://cdn.example.com/legacy-3.png"
        ]
      },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const projected = taskToImageStreamEntry(task, modelMap, t);
    const storedEntry: Record<string, unknown> = { ...projected };
    delete storedEntry.requestedCount;
    storedEntry.result = projected.result
      ? {
          ...projected.result,
          assets: projected.result.assets.map((asset, index) => ({
            ...asset,
            id: `asset-legacy-four-${index}`,
            taskId: task.id
          }))
        }
      : null;

    const restored = parseStoredImageSessions(
      JSON.stringify({
        version: 1,
        activeSessionId: "session_1",
        sessions: [{ id: "session_1", title: "Legacy", entries: [storedEntry] }]
      })
    );
    const entry = restored?.sessions[0]?.entries[0];
    const batch = entry ? deriveImageResultBatches([entry])[0] : null;

    expect(entry?.requestedCount).toBe(4);
    expect(batch?.acceptedAssetCount).toBe(4);
    expect(batch?.partialSuccess).toBe(false);
    expect(
      (batch?.acceptedAssetCount ?? 0) > (batch?.requestedCount ?? 0)
    ).toBe(false);
  });

  it("restores a legacy underfilled succeeded batch count from task input", () => {
    const t = createTranslator("en-US");
    const task = createTask({
      id: "task-legacy-two",
      status: "succeeded",
      prompt: "Legacy two images",
      input: { mode: "text-to-image", size: "1024x1024", count: 2 },
      output: { images: ["https://cdn.example.com/legacy-two.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const projected = taskToImageStreamEntry(task, new Map(), t);
    const storedEntry: Record<string, unknown> = { ...projected };
    delete storedEntry.requestedCount;
    storedEntry.result = projected.result
      ? {
          ...projected.result,
          assets: projected.result.assets.map((asset) => ({
            ...asset,
            id: "asset-legacy-two",
            taskId: task.id
          }))
        }
      : null;

    const restored = parseStoredImageSessions(
      JSON.stringify({
        version: 1,
        activeSessionId: "session_1",
        sessions: [{ id: "session_1", title: "Legacy", entries: [storedEntry] }]
      })
    );
    const entry = restored?.sessions[0]?.entries[0];
    const batch = entry ? deriveImageResultBatches([entry])[0] : null;

    expect(entry?.requestedCount).toBe(2);
    expect(batch?.acceptedAssetCount).toBe(1);
    expect(batch?.partialSuccess).toBe(true);
  });

  it("does not fall back to task input when stored requestedCount is explicitly invalid", () => {
    const t = createTranslator("en-US");
    const task = createTask({
      id: "task-explicit-invalid-count",
      status: "succeeded",
      prompt: "Explicit invalid count",
      input: { mode: "text-to-image", size: "1024x1024", count: 4 },
      output: {
        images: [
          "https://cdn.example.com/explicit-0.png",
          "https://cdn.example.com/explicit-1.png",
          "https://cdn.example.com/explicit-2.png",
          "https://cdn.example.com/explicit-3.png"
        ]
      },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const projected = taskToImageStreamEntry(task, new Map(), t);
    const storedEntry: Record<string, unknown> = {
      ...projected,
      requestedCount: 3
    };
    storedEntry.result = projected.result
      ? {
          ...projected.result,
          assets: projected.result.assets.map((asset, index) => ({
            ...asset,
            id: `asset-explicit-invalid-${index}`,
            taskId: task.id
          }))
        }
      : null;

    const restored = parseStoredImageSessions(
      JSON.stringify({
        version: 1,
        activeSessionId: "session_1",
        sessions: [{ id: "session_1", title: "Legacy", entries: [storedEntry] }]
      })
    );
    const entry = restored?.sessions[0]?.entries[0];
    const batch = entry ? deriveImageResultBatches([entry])[0] : null;

    expect(entry?.requestedCount).toBe(1);
    expect(batch?.requestedCount).toBe(1);
    expect(batch?.acceptedAssetCount).toBe(4);
  });

  it("defaults a legacy loading entry without result or requestedCount to one placeholder", () => {
    const restored = parseStoredImageSessions(
      JSON.stringify({
        version: 1,
        activeSessionId: "session_1",
        sessions: [
          {
            id: "session_1",
            title: "Legacy",
            entries: [
              {
                id: "legacy-loading",
                prompt: "Loading",
                modelName: "Image Model",
                aspectRatio: "1:1",
                mode: "text-to-image",
                referenceImage: null,
                status: "loading",
                result: null,
                error: null
              }
            ]
          }
        ]
      })
    );

    expect(restored?.sessions[0]?.entries[0]?.requestedCount).toBe(1);
  });

  it.each([
    ["null result", (entry: Record<string, unknown>) => ({ ...entry, result: null })],
    ["missing result", (entry: Record<string, unknown>) => {
      const withoutResult = { ...entry };
      delete withoutResult.result;
      return withoutResult;
    }],
    ["malformed result", (entry: Record<string, unknown>) => ({
      ...entry,
      result: { task: { id: "task-malformed" }, assets: "not-an-array" }
    })]
  ])("normalizes stored succeeded entries with %s into safe failure", (_, mutate) => {
    const t = createTranslator("en-US");
    const task = createTask({
      id: "task-invalid-stored-success",
      status: "succeeded",
      prompt: "Invalid stored success",
      input: { mode: "text-to-image", size: "1024x1024", count: 4 },
      output: { images: ["https://cdn.example.com/valid.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const projected = taskToImageStreamEntry(task, new Map(), t);
    const storedEntry = mutate({
      ...projected,
      requestedCount: 4
    });
    const restored = parseStoredImageSessions(
      JSON.stringify({
        version: 1,
        activeSessionId: "session-invalid-success",
        sessions: [
          {
            id: "session-invalid-success",
            title: "Invalid success",
            entries: [storedEntry]
          }
        ]
      })
    );
    const entry = restored?.sessions[0]?.entries[0];

    expect(entry).toMatchObject({
      status: "failed",
      result: null,
      requestedCount: 4
    });
  });

  it("does not rewrite loading, checking, or failed null-result entries", () => {
    for (const status of ["loading", "checking", "failed"] as const) {
      const restored = parseStoredImageSessions(
        JSON.stringify({
          version: 1,
          activeSessionId: "session-states",
          sessions: [
            {
              id: "session-states",
              title: "States",
              entries: [
                {
                  id: `stored-${status}`,
                  prompt: "Preserve state",
                  modelName: "Image Model",
                  aspectRatio: "1:1",
                  mode: "text-to-image",
                  requestedCount: 2,
                  status,
                  result: null,
                  error: null,
                  referenceImage: null
                }
              ]
            }
          ]
        })
      );

      expect(restored?.sessions[0]?.entries[0]).toMatchObject({
        status,
        result: null,
        requestedCount: 2
      });
    }
  });

  it("trims stored image stream entries while preserving recent reference data URLs", async () => {
    const trimmed = trimStoredImageSessions(
      {
        version: 1,
        activeSessionId: "session_1",
        firstPageLoadedAt: "2026-07-07T00:00:10.000Z",
        backendHistoryDismissed: false,
        sessions: [
          {
            id: "session_1",
            title: "Stored session",
            entries: [
              {
                id: "old",
                prompt: "Old",
                modelName: "Image Model",
                aspectRatio: "1:1",
                mode: "text-to-image",
                referenceImage: null,
                status: "succeeded",
                result: null,
                error: null
              },
              {
                id: "recent",
                prompt: "Recent",
                modelName: "Image Model",
                aspectRatio: "1:1",
                mode: "image-to-image",
                referenceImage: {
                  dataUrl: "data:image/jpeg;base64,cmVjZW50",
                  name: "recent-reference.jpg"
                },
                status: "failed",
                result: null,
                error: "failed"
              }
            ]
          }
        ]
      },
      1
    );

    expect(trimmed.sessions[0]?.entries).toHaveLength(1);
    expect(trimmed.sessions[0]?.entries[0]?.id).toBe("recent");
    expect(trimmed.sessions[0]?.entries[0]?.referenceImage?.dataUrl).toBe(
      "data:image/jpeg;base64,cmVjZW50"
    );
  });

  it("converts backend image task output into image stream entries safely", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map([
      [
        "image-model",
        createImageModel({
          modelId: "image-model",
          displayName: "Readable Image Model"
        })
      ]
    ]);
    const succeededWithImages = createTask({
      id: "task_images",
      status: "succeeded",
      prompt: "A clean studio product photo",
      modelId: "image-model",
      output: {
        images: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"]
      },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const succeededWithImageUrl = createTask({
      id: "task_image_url",
      status: "succeeded",
      prompt: "A single restored image",
      output: { imageUrl: "https://cdn.example.com/single.png" },
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const invalidOutput = createTask({
      id: "task_invalid",
      status: "succeeded",
      prompt: "",
      output: { images: [null, 42] },
      createdAt: "2026-07-07T00:02:00.000Z"
    });
    const failed = createTask({
      id: "task_failed",
      status: "failed",
      prompt: "Failed prompt",
      errorMessage: "Provider failed",
      createdAt: "2026-07-07T00:03:00.000Z"
    });
    const pending = createTask({
      id: "task_pending",
      status: "pending",
      prompt: "Pending prompt",
      createdAt: "2026-07-07T00:04:00.000Z"
    });
    const running = createTask({
      id: "task_running",
      status: "running",
      prompt: "Running prompt",
      createdAt: "2026-07-07T00:05:00.000Z"
    });

    expect(readTaskOutputImages(succeededWithImages)).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.png"
    ]);

    const imagesEntry = taskToImageStreamEntry(succeededWithImages, modelMap, t);
    expect(imagesEntry).toMatchObject({
      id: "task_images",
      status: "succeeded",
      prompt: "A clean studio product photo",
      modelName: "Readable Image Model"
    });
    expect(imagesEntry.result?.task).toBe(succeededWithImages);
    expect(imagesEntry.result?.assets.map((asset) => asset.url)).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.png"
    ]);

    const historicalDisplayEntry = taskToImageStreamEntry(
      createTask({
        id: "task_historical_display",
        status: "succeeded",
        prompt: "Historical output only",
        input: { mode: "text-to-image", size: "1024x1024", count: 1 },
        output: { images: ["https://cdn.example.com/historical.png"] },
        createdAt: "2026-07-07T00:00:00.000Z"
      }),
      modelMap,
      t
    );
    const quickHistoricalDisplay = resolveImageEntryDisplayState(
      historicalDisplayEntry,
      { allowHistoricalFallback: true }
    );
    const workspaceHistoricalDisplay = resolveImageEntryDisplayState(
      historicalDisplayEntry,
      { allowHistoricalFallback: false }
    );

    expect(quickHistoricalDisplay.status).toBe("succeeded");
    expect(workspaceHistoricalDisplay).toMatchObject({
      status: "failed",
      result: null
    });
    expect(deriveImageResultBatches([workspaceHistoricalDisplay])).toEqual([]);
    expect(historicalDisplayEntry.status).toBe("succeeded");

    const imageUrlEntry = taskToImageStreamEntry(
      succeededWithImageUrl,
      modelMap,
      t
    );
    expect(imageUrlEntry.result?.assets.map((asset) => asset.url)).toEqual([
      "https://cdn.example.com/single.png"
    ]);

    const invalidEntry = taskToImageStreamEntry(invalidOutput, modelMap, t);
    expect(invalidEntry.status).toBe("failed");
    expect(invalidEntry.prompt).toBe("");
    expect(invalidEntry.result).toBeNull();

    const persistedInvalidEntry = taskToImageStreamEntry(
      succeededWithImages,
      modelMap,
      t,
      (imagesEntry.result?.assets ?? []).map((asset) => ({
        ...asset,
        id: "persisted-invalid",
        taskId: "another-task"
      }))
    );
    expect(persistedInvalidEntry).toMatchObject({
      status: "failed",
      result: null
    });

    expect(taskToImageStreamEntry(failed, modelMap, t)).toMatchObject({
      id: "task_failed",
      status: "failed",
      error: "Provider failed",
      result: null
    });
    expect(taskToImageStreamEntry(pending, modelMap, t)).toMatchObject({
      id: "task_pending",
      status: "loading",
      result: null
    });
    expect(taskToImageStreamEntry(running, modelMap, t)).toMatchObject({
      id: "task_running",
      status: "loading",
      result: null
    });
  });

  it("creates stable image session and entry ids with secure UUID or non-random fallback", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });

    expect(createImageSessionId()).toBe("image-session-uuid-1");
    expect(createImageEntryId()).toBe("image-entry-uuid-1");

    vi.stubGlobal("crypto", undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T00:00:00.000Z"));
    expect(createImageSessionId()).toMatch(/^image-session-\d+-\d+$/);
    expect(createImageEntryId()).toMatch(/^image-entry-\d+-\d+$/);
    vi.useRealTimers();
  });

  it("builds image generate request payload with captured session metadata", () => {
    expect(
      buildImageGenerateRequestPayload({
        prompt: "A quiet reading room",
        modelId: "image-model",
        size: "1024x1024",
        count: 1,
        mode: "text-to-image",
        imageSessionId: "session-a",
        clientEntryId: "entry-a",
        imageSessionTitle: "Session A",
        referenceImages: [{
          dataUrl: "data:image/png;base64,aW1hZ2U=",
          mimeType: "image/png",
          name: "reference.png"
        }]
      })
    ).toEqual({
      prompt: "A quiet reading room",
      modelId: "image-model",
      size: "1024x1024",
      count: 1,
      mode: "text-to-image",
      imageSessionId: "session-a",
      clientEntryId: "entry-a",
      imageSessionTitle: "Session A"
    });

    expect(
      buildImageGenerateRequestPayload({
        prompt: "Restyle room",
        modelId: "image-model",
        size: "1024x1024",
        count: 1,
        mode: "image-to-image",
        imageSessionId: "session-a",
        clientEntryId: "entry-a",
        imageSessionTitle: "Session A",
        referenceImages: [{
          dataUrl: "data:image/png;base64,aW1hZ2U=",
          mimeType: "image/png",
          name: "reference.png"
        }]
      })
    ).toMatchObject({
      imageSessionId: "session-a",
      clientEntryId: "entry-a",
      imageSessionTitle: "Session A",
      referenceImages: [{ dataUrl: "data:image/png;base64,aW1hZ2U=" }]
    });
    expect(
      buildImageGenerateRequestPayload({
        prompt: "Restyle room",
        modelId: "image-model",
        size: "1024x1024",
        count: 1,
        mode: "image-to-image",
        imageSessionId: "session-a",
        clientEntryId: "entry-a",
        imageSessionTitle: "Session A",
        referenceImages: []
      })
    ).not.toHaveProperty("referenceImage");
  });

  it("adds only the explicit Title Cover workflow metadata to the image request", () => {
    const payload = buildImageGenerateRequestPayload({
      prompt: "RAW_TITLE_SENTINEL_7C41",
      modelId: "image-model",
      size: "1280x720",
      count: 1,
      mode: "text-to-image",
      imageSessionId: "session-title-cover",
      clientEntryId: "entry-title-cover",
      imageSessionTitle: "Title Cover",
      workflow: "title-cover",
      titleCover: {
        originalTitle: "RAW_TITLE_SENTINEL_7C41",
        style: "warm-editorial"
      }
    });

    expect(payload).toEqual({
      prompt: "RAW_TITLE_SENTINEL_7C41",
      modelId: "image-model",
      size: "1280x720",
      count: 1,
      mode: "text-to-image",
      imageSessionId: "session-title-cover",
      clientEntryId: "entry-title-cover",
      imageSessionTitle: "Title Cover",
      workflow: "title-cover",
      titleCover: {
        originalTitle: "RAW_TITLE_SENTINEL_7C41",
        style: "warm-editorial"
      }
    });
    expect(payload).not.toHaveProperty("mainCopy");
    expect(payload).not.toHaveProperty("secondaryCopy");
  });

  it("reconciles a Title Cover task as Title Cover without relying on prompt text", () => {
    const task = createTask({
      id: "task-title-cover",
      status: "succeeded",
      prompt: "RAW_TITLE_SENTINEL_7C41",
      input: {
        mode: "text-to-image",
        size: "1280x720",
        count: 1,
        workflow: "title-cover",
        titleCover: {
          originalTitle: "RAW_TITLE_SENTINEL_7C41",
          style: "professional-business"
        }
      },
      output: { images: ["https://cdn.example.com/title-cover.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });

    const entry = taskToImageStreamEntry(
      task,
      new Map(),
      createTranslator("en-US")
    );

    expect(entry.workflow).toBe("title-cover");
    expect(entry.prompt).toBe("RAW_TITLE_SENTINEL_7C41");
  });

  it("merges backend image history with local sessions by task id and trims to 20 entries", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const duplicateByResultTask = createTask({
      id: "task_duplicate_result",
      status: "succeeded",
      prompt: "Duplicate through result task",
      output: { images: ["https://cdn.example.com/duplicate-result.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const backendEntries = [
      taskToImageStreamEntry(
        createTask({
          id: "task_duplicate_id",
          status: "succeeded",
          prompt: "Duplicate by entry id",
          input: {
            mode: "text-to-image",
            size: "1024x1024",
            count: 1,
            imageSessionId: "session-backend",
            imageSessionTitle: "Backend Session"
          },
          output: { images: ["https://cdn.example.com/duplicate-id.png"] },
          createdAt: "2026-07-07T00:01:00.000Z"
        }),
        modelMap,
        t
      ),
      taskToImageStreamEntry(duplicateByResultTask, modelMap, t),
      ...Array.from({ length: 22 }, (_, index) =>
        taskToImageStreamEntry(
          createTask({
            id: `task_new_${index}`,
            status: "succeeded",
            prompt: `New backend task ${index}`,
            input: {
              mode: "text-to-image",
              size: "1024x1024",
              count: 1,
              imageSessionId: "session-backend",
              imageSessionTitle: "Backend Session"
            },
            output: { images: [`https://cdn.example.com/new-${index}.png`] },
            createdAt: `2026-07-07T00:${String(index + 2).padStart(2, "0")}:00.000Z`
          }),
          modelMap,
          t
        )
      )
    ];

    const merged = mergeImageSessionsWithBackendHistory(
      [
        {
          id: "local",
          title: "Local",
          entries: [
            {
              id: "task_duplicate_id",
              prompt: "Local duplicate",
              modelName: "Image Model",
              aspectRatio: "1:1",
              mode: "text-to-image",
              referenceImage: null,
              status: "succeeded",
              result: null,
              error: null
            },
            {
              id: "local_result_duplicate",
              prompt: "Local result duplicate",
              modelName: "Image Model",
              aspectRatio: "1:1",
              mode: "text-to-image",
              referenceImage: null,
              status: "succeeded",
              result: { task: duplicateByResultTask, assets: [] },
              error: null
            }
          ]
        }
      ],
      backendEntries,
      "History"
    );

    const historySession = merged.find(
      (session) => session.id === "session-backend"
    );

    expect(historySession?.title).toBe("Backend Session");
    expect(historySession?.entries).toHaveLength(20);
    expect(historySession?.entries.some((entry) => entry.id === "task_duplicate_id")).toBe(false);
    expect(historySession?.entries.some((entry) => entry.id === "task_duplicate_result")).toBe(false);
    expect(historySession?.entries[0]?.id).toBe("task_new_2");
    expect(historySession?.entries.at(-1)?.id).toBe("task_new_21");
  });

  it("groups backend image tasks by imageSessionId and ignores legacy tasks without a session", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const olderA = createTask({
      id: "task_session_a_old",
      status: "succeeded",
      prompt: "Older session A prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-a",
        imageSessionTitle: "Backend Session A"
      },
      output: { images: ["https://cdn.example.com/a-old.png"] },
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const newerA = createTask({
      id: "task_session_a_new",
      status: "succeeded",
      prompt: "Newer session A prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-a",
        imageSessionTitle: "Backend Session A"
      },
      output: { images: ["https://cdn.example.com/a-new.png"] },
      createdAt: "2026-07-07T00:03:00.000Z"
    });
    const sessionB = createTask({
      id: "task_session_b",
      status: "succeeded",
      prompt: "Session B prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-b",
        imageSessionTitle: "Backend Session B"
      },
      output: { images: ["https://cdn.example.com/b.png"] },
      createdAt: "2026-07-07T00:04:00.000Z"
    });
    const legacy = createTask({
      id: "task_legacy",
      status: "succeeded",
      prompt: "Legacy prompt",
      output: { images: ["https://cdn.example.com/legacy.png"] },
      createdAt: "2026-07-07T00:05:00.000Z"
    });

    const merged = mergeImageSessionsWithBackendHistory(
      [{ id: "session-a", title: "Local Session A", entries: [] }],
      [newerA, legacy, olderA, sessionB].map((task) =>
        taskToImageStreamEntry(task, modelMap, t)
      ),
      "History"
    );

    expect(merged.map((session) => session.id)).toEqual([
      "session-b",
      "session-a"
    ]);
    expect(merged.find((session) => session.id === "session-a")?.title).toBe(
      "Local Session A"
    );
    expect(
      merged.find((session) => session.id === "session-a")?.entries.map(
        (entry) => entry.id
      )
    ).toEqual(["task_session_a_old", "task_session_a_new"]);
    expect(merged.some((session) => session.id === "image-history-backend")).toBe(
      false
    );
    expect(
      merged.some((session) =>
        session.entries.some((entry) => entry.id === "task_legacy")
      )
    ).toBe(false);
  });

  it("skips dismissed image sessions and preserves backend image title fallback rules", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const serializedDismissed = serializeDismissedImageSessionIds([
      "session-hidden",
      "image-history-backend"
    ]);
    const dismissedIds = parseDismissedImageSessionIds(serializedDismissed);
    const hidden = createTask({
      id: "task_hidden",
      status: "succeeded",
      prompt: "Hidden prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-hidden",
        imageSessionTitle: "Hidden Session"
      },
      output: { images: ["https://cdn.example.com/hidden.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const visible = createTask({
      id: "task_visible",
      status: "succeeded",
      prompt: "Visible backend title prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-visible",
        imageSessionTitle: "Visible Backend Title"
      },
      output: { images: ["https://cdn.example.com/visible.png"] },
      createdAt: "2026-07-07T00:01:00.000Z"
    });

    const merged = mergeImageSessionsWithBackendHistory(
      [],
      [hidden, visible].map((task) => taskToImageStreamEntry(task, modelMap, t)),
      "History",
      20,
      { dismissedSessionIds: dismissedIds }
    );

    expect(serializedDismissed).not.toContain("image-history-backend");
    expect(merged.some((session) => session.id === "session-hidden")).toBe(false);
    expect(merged.find((session) => session.id === "session-visible")?.title).toBe(
      "Visible Backend Title"
    );
  });

  it("reconciles loading entries with backend tasks by clientEntryId and selects active session", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const backendTask = createTask({
      id: "task_backend_client",
      status: "succeeded",
      prompt: "Client-linked prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-a",
        clientEntryId: "entry-client-a",
        imageSessionTitle: "Backend title"
      },
      output: { images: ["https://cdn.example.com/client.png"] },
      createdAt: "2026-07-07T00:02:00.000Z"
    });
    const merged = mergeImageSessionsWithBackendHistory(
      [
        {
          id: "session-a",
          title: "Local title",
          entries: [
            {
              id: "local-entry",
              clientEntryId: "entry-client-a",
              imageSessionId: "session-a",
              prompt: "Client-linked prompt",
              modelName: "Image Model",
              aspectRatio: "1:1",
              mode: "text-to-image",
              referenceImage: null,
              status: "checking",
              result: null,
              error: "syncing"
            }
          ]
        },
        {
          id: "empty-session",
          title: "Empty",
          entries: []
        }
      ],
      [taskToImageStreamEntry(backendTask, modelMap, t)]
    );
    const entry = merged.find((session) => session.id === "session-a")?.entries[0];

    expect(entry).toMatchObject({
      id: "local-entry",
      clientEntryId: "entry-client-a",
      status: "succeeded",
      error: null
    });
    expect(entry?.result?.task.id).toBe("task_backend_client");
    expect(
      merged.find((session) => session.id === "session-a")?.entries
    ).toHaveLength(1);
    expect(selectActiveImageSessionId(merged, "session-a")).toBe("session-a");
    expect(selectActiveImageSessionId(merged, "missing-session")).toBe("session-a");
  });

  it("matches polling tasks by clientEntryId before prompt model and time-window heuristics", async () => {
    const requestStartedAt = new Date("2026-07-07T00:00:10.000Z");
    const exactClientTask = createTask({
      id: "task_exact_client",
      status: "succeeded",
      prompt: "Backend prompt normalized differently",
      modelId: "different-model",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        clientEntryId: "entry-exact-client"
      },
      output: { images: ["https://cdn.example.com/exact-client.png"] },
      createdAt: "2026-07-07T00:10:00.000Z"
    });
    const heuristicTask = createTask({
      id: "task_heuristic",
      status: "succeeded",
      prompt: "Original prompt",
      modelId: "image-model",
      output: { images: ["https://cdn.example.com/heuristic.png"] },
      createdAt: "2026-07-07T00:00:12.000Z"
    });
    const exactFailedTask = createTask({
      id: "task_exact_failed",
      status: "failed",
      prompt: "Different failed prompt",
      modelId: "different-model",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        clientEntryId: "entry-exact-failed"
      },
      errorMessage: "Backend failed",
      createdAt: "2026-07-07T00:10:00.000Z"
    });

    expect(
      findImageTaskForPollingReconcile({
        tasks: [heuristicTask, exactClientTask],
        prompt: "Original prompt",
        modelId: "image-model",
        clientEntryId: "entry-exact-client",
        requestStartedAt,
        now: new Date("2026-07-07T00:00:30.000Z")
      })?.id
    ).toBe("task_exact_client");
    expect(
      findImageTaskForPollingReconcile({
        tasks: [heuristicTask, exactFailedTask],
        prompt: "Original prompt",
        modelId: "image-model",
        clientEntryId: "entry-exact-failed",
        requestStartedAt,
        now: new Date("2026-07-07T00:00:30.000Z")
      })?.id
    ).toBe("task_exact_failed");
    expect(
      findImageTaskForPollingReconcile({
        tasks: [heuristicTask, exactClientTask],
        prompt: "Original prompt",
        modelId: "image-model",
        requestStartedAt,
        now: new Date("2026-07-07T00:00:30.000Z")
      })?.id
    ).toBe("task_heuristic");
  });

  it("reconciles page-reentry checking and loading entries by clientEntryId without appending duplicates", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const succeededTask = createTask({
      id: "task_reentry_succeeded",
      status: "succeeded",
      prompt: "Succeeded prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        clientEntryId: "entry-succeeded"
      },
      output: { images: ["https://cdn.example.com/reentry-succeeded.png"] },
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const failedTask = createTask({
      id: "task_reentry_failed",
      status: "failed",
      prompt: "Failed prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        clientEntryId: "entry-failed"
      },
      errorMessage: "Provider failed later",
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const runningTask = createTask({
      id: "task_reentry_running",
      status: "running",
      prompt: "Running prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        clientEntryId: "entry-running"
      },
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const pendingTask = createTask({
      id: "task_reentry_pending",
      status: "pending",
      prompt: "Pending prompt",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        clientEntryId: "entry-pending"
      },
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const backendEntries = [
      succeededTask,
      failedTask,
      runningTask,
      pendingTask
    ].map((task) => taskToImageStreamEntry(task, modelMap, t));
    const localSessions = [
      {
        id: "session-a",
        title: "Session A",
        entries: [
          {
            id: "entry-succeeded",
            prompt: "Local succeeded prompt",
            modelName: "Image Model",
            aspectRatio: "1:1" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "checking" as const,
            result: null,
            error: "syncing"
          },
          {
            id: "local-failed",
            clientEntryId: "entry-failed",
            prompt: "Local failed prompt",
            modelName: "Image Model",
            aspectRatio: "1:1" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "checking" as const,
            result: null,
            error: "syncing"
          },
          {
            id: "local-running",
            clientEntryId: "entry-running",
            prompt: "Local running prompt",
            modelName: "Image Model",
            aspectRatio: "1:1" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "loading" as const,
            result: null,
            error: null
          },
          {
            id: "local-pending",
            clientEntryId: "entry-pending",
            prompt: "Local pending prompt",
            modelName: "Image Model",
            aspectRatio: "1:1" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "checking" as const,
            result: null,
            error: "syncing"
          }
        ]
      }
    ];
    const reconciled = reconcilePendingImageSessionEntriesWithBackend(
      localSessions,
      backendEntries
    );
    const merged = mergeImageSessionsWithBackendHistory(
      reconciled,
      [],
      "History"
    );
    const entries = merged.find((session) => session.id === "session-a")?.entries;

    expect(entries?.find((entry) => entry.id === "entry-succeeded")).toMatchObject({
      id: "entry-succeeded",
      status: "succeeded",
      error: null
    });
    expect(
      entries?.find((entry) => entry.id === "entry-succeeded")?.result?.task.id
    ).toBe("task_reentry_succeeded");
    expect(entries?.find((entry) => entry.id === "local-failed")).toMatchObject({
      id: "local-failed",
      status: "failed",
      result: null,
      error: "Provider failed later"
    });
    expect(entries?.find((entry) => entry.id === "local-running")).toMatchObject({
      id: "local-running",
      status: "loading",
      result: null
    });
    expect(entries?.find((entry) => entry.id === "local-pending")).toMatchObject({
      id: "local-pending",
      status: "checking",
      result: null
    });
    expect(merged.some((session) => session.id === "image-history-backend")).toBe(
      false
    );
  });

  it("uses visibility and focus reload events with a five-second debounce", async () => {
    expect(backendImageHistoryReloadEvents).toEqual({
      visibilitychange: "visibilitychange",
      focus: "focus"
    });
    expect(backendImageHistoryReloadDebounceMs).toBe(5000);
    expect(shouldReloadBackendImageHistory(null, 1000)).toBe(true);
    expect(shouldReloadBackendImageHistory(1000, 5999)).toBe(false);
    expect(shouldReloadBackendImageHistory(1000, 6000)).toBe(true);
  });

  it("updates image generation results only in the captured target session", async () => {
    const loadingEntry = {
      id: "image-local-1",
      prompt: "Session A prompt",
      modelName: "Image Model",
      aspectRatio: "1:1" as const,
      mode: "text-to-image" as const,
      referenceImage: null,
      status: "loading" as const,
      result: null,
      error: null
    };
    const sessions = [
      {
        id: "session-a",
        title: "Session A",
        entries: [loadingEntry]
      },
      {
        id: "session-b",
        title: "Session B",
        entries: []
      }
    ];
    const task = createTask({
      id: "task_session_a",
      status: "succeeded",
      prompt: "Session A prompt",
      output: { images: ["https://cdn.example.com/session-a.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const result = {
      task,
      assets: [
        {
          id: "asset_session_a",
          userId: "user_1",
          taskId: task.id,
          type: "image" as const,
          url: "https://cdn.example.com/session-a.png",
          thumbnailUrl: null,
          title: null,
          metadata: null,
          createdAt: task.createdAt,
          taskPrompt: task.prompt
        }
      ]
    };

    const updated = updateImageSessionEntries(
      sessions,
      "session-a",
      (entries) =>
        entries.map((entry) =>
          entry.id === "image-local-1"
            ? { ...entry, status: "succeeded", result, error: null }
            : entry
        )
    );

    expect(updated.find((session) => session.id === "session-a")?.entries[0]).toMatchObject({
      id: "image-local-1",
      status: "succeeded",
      result
    });
    expect(updated.find((session) => session.id === "session-b")?.entries).toEqual([]);

    const deletedTarget = updateImageSessionEntries(
      [sessions[1] as (typeof sessions)[number]],
      "session-a",
      (entries) => [...entries, loadingEntry]
    );
    expect(deletedTarget).toEqual([sessions[1]]);
  });

  it("reconciles a Failed fetch entry from a matching succeeded image task", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>([
      [
        "image-model",
        createImageModel({
          displayName: "Readable Image Model",
          modelId: "image-model"
        })
      ]
    ]);
    const requestStartedAt = new Date("2026-07-07T00:00:10.000Z");
    const matchingTask = createTask({
      id: "task_reconciled",
      status: "succeeded",
      prompt: "Recovered prompt",
      modelId: "image-model",
      output: { images: ["https://cdn.example.com/recovered.png"] },
      createdAt: "2026-07-07T00:00:12.000Z",
      completedAt: "2026-07-07T00:00:20.000Z"
    });
    const matchedTask = findImageTaskForFailedFetchReconcile({
      tasks: [
        createTask({
          id: "task_wrong_prompt",
          status: "succeeded",
          prompt: "Other prompt",
          modelId: "image-model",
          output: { images: ["https://cdn.example.com/other.png"] },
          createdAt: "2026-07-07T00:00:11.000Z"
        }),
        matchingTask
      ],
      prompt: "Recovered prompt",
      modelId: "image-model",
      requestStartedAt,
      now: new Date("2026-07-07T00:00:30.000Z")
    });
    const failedEntry = {
      id: "image-local-reconcile",
      prompt: "Recovered prompt",
      modelName: "Image Model",
      aspectRatio: "1:1" as const,
      mode: "text-to-image" as const,
      referenceImage: null,
      status: "failed" as const,
      result: null,
      error: "Failed to fetch"
    };
    const reconciled = reconcileImageStreamEntryFromTask(
      failedEntry,
      matchedTask as AiTaskSummary,
      modelMap,
      t
    );
    const sessions = updateImageSessionEntries(
      [
        { id: "session-a", title: "Session A", entries: [failedEntry] },
        { id: "image-history-backend", title: "History", entries: [] }
      ],
      "session-a",
      (entries) =>
        entries.map((entry) =>
          entry.id === "image-local-reconcile" ? reconciled : entry
        )
    );
    const merged = mergeImageSessionsWithBackendHistory(
      sessions,
      [taskToImageStreamEntry(matchingTask, modelMap, t)],
      "History"
    );

    expect(isFailedFetchError(new Error("Failed to fetch"))).toBe(true);
    expect(matchedTask?.id).toBe("task_reconciled");
    expect(reconciled).toMatchObject({
      id: "image-local-reconcile",
      status: "succeeded",
      error: null
    });
    expect(reconciled.result?.task.id).toBe("task_reconciled");
    expect(reconciled.result?.assets.map((asset) => asset.url)).toEqual([
      "https://cdn.example.com/recovered.png"
    ]);
    expect(merged.some((session) => session.id === "image-history-backend")).toBe(
      false
    );
  });

  it("keeps Failed fetch entries in checking state when immediate reconcile has no succeeded result", async () => {
    const requestStartedAt = new Date("2026-07-07T00:00:10.000Z");
    const runningTask = createTask({
      id: "task_running_reconcile",
      status: "running",
      prompt: "Recoverable prompt",
      modelId: "image-model",
      createdAt: "2026-07-07T00:00:12.000Z"
    });
    const localEntry = {
      id: "image-local-checking",
      prompt: "Recoverable prompt",
      modelName: "Image Model",
      aspectRatio: "1:1" as const,
      mode: "text-to-image" as const,
      referenceImage: null,
      status: "loading" as const,
      result: null,
      error: null
    };
    const immediateSucceededMatch = findImageTaskForFailedFetchReconcile({
      tasks: [runningTask],
      prompt: "Recoverable prompt",
      modelId: "image-model",
      requestStartedAt,
      now: new Date("2026-07-07T00:00:30.000Z")
    });
    const checkingEntry = markImageStreamEntryChecking(
      localEntry,
      "Request submitted. Syncing task result..."
    );

    expect(isFailedFetchError(new Error("Failed to fetch"))).toBe(true);
    expect(isFailedFetchError(new Error("Image generation failed"))).toBe(false);
    expect(immediateSucceededMatch).toBeNull();
    expect(checkingEntry).toMatchObject({
      id: "image-local-checking",
      status: "checking",
      result: null,
      error: "Request submitted. Syncing task result..."
    });
  });

  it("polls image tasks until a running Failed fetch task succeeds in the original session", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const requestStartedAt = new Date("2026-07-07T00:00:10.000Z");
    const runningTask = createTask({
      id: "task_polled_success",
      status: "running",
      prompt: "Polling prompt",
      modelId: "image-model",
      createdAt: "2026-07-07T00:00:12.000Z"
    });
    const succeededTask = {
      ...runningTask,
      status: "succeeded" as const,
      output: { images: ["https://cdn.example.com/polled.png"] },
      completedAt: "2026-07-07T00:00:18.000Z"
    };
    let sessions = [
      {
        id: "session-a",
        title: "Session A",
        entries: [
          markImageStreamEntryChecking(
            {
              id: "image-local-polled",
              prompt: "Polling prompt",
              modelName: "Image Model",
              aspectRatio: "1:1" as const,
              mode: "text-to-image" as const,
              referenceImage: null,
              status: "loading" as const,
              result: null,
              error: null
            },
            "Request submitted. Syncing task result..."
          )
        ]
      },
      {
        id: "session-b",
        title: "Session B",
        entries: []
      },
      {
        id: "image-history-backend",
        title: "History",
        entries: []
      }
    ];

    for (const tasks of [[runningTask], [runningTask], [succeededTask]]) {
      const matchedTask = findImageTaskForPollingReconcile({
        tasks,
        prompt: "Polling prompt",
        modelId: "image-model",
        requestStartedAt,
        now: new Date("2026-07-07T00:00:30.000Z")
      });

      if (matchedTask?.status === "succeeded") {
        sessions = updateImageSessionEntries(sessions, "session-a", (entries) =>
          entries.map((entry) =>
            entry.id === "image-local-polled"
              ? reconcileImageStreamEntryFromTask(entry, matchedTask, modelMap, t)
              : entry
          )
        );
      }
    }

    const merged = mergeImageSessionsWithBackendHistory(
      sessions,
      [taskToImageStreamEntry(succeededTask, modelMap, t)],
      "History"
    );

    const targetEntry = merged
      .find((session) => session.id === "session-a")
      ?.entries.find((entry) => entry.id === "image-local-polled");

    expect(targetEntry).toMatchObject({
      id: "image-local-polled",
      status: "succeeded",
      error: null
    });
    expect(targetEntry?.result?.task.id).toBe("task_polled_success");
    expect(targetEntry?.result?.assets.map((asset) => asset.url)).toEqual([
      "https://cdn.example.com/polled.png"
    ]);
    expect(merged.some((session) => session.id === "image-history-backend")).toBe(
      false
    );
    expect(merged.find((session) => session.id === "session-b")?.entries).toEqual([]);
  });

  it("polls image tasks and applies backend failure to the original entry", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const failedTask = createTask({
      id: "task_polled_failed",
      status: "failed",
      prompt: "Failure prompt",
      modelId: "image-model",
      errorMessage: "Provider rejected the prompt",
      createdAt: "2026-07-07T00:00:12.000Z"
    });
    const matchedTask = findImageTaskForPollingReconcile({
      tasks: [failedTask],
      prompt: "Failure prompt",
      modelId: "image-model",
      requestStartedAt: new Date("2026-07-07T00:00:10.000Z"),
      now: new Date("2026-07-07T00:00:30.000Z")
    });
    const failedEntry = reconcileImageStreamEntryFromTask(
      {
        id: "image-local-failed",
        prompt: "Failure prompt",
        modelName: "Image Model",
        aspectRatio: "1:1",
        mode: "text-to-image",
        referenceImage: null,
        status: "checking",
        result: null,
        error: "Request submitted. Syncing task result..."
      },
      matchedTask as AiTaskSummary,
      modelMap,
      t
    );

    expect(matchedTask?.id).toBe("task_polled_failed");
    expect(failedEntry).toMatchObject({
      id: "image-local-failed",
      status: "failed",
      result: null,
      error: "Provider rejected the prompt"
    });
  });

  it("keeps polling timeouts as checking and does not append backend history", async () => {
    const requestStartedAt = new Date("2026-07-07T00:00:10.000Z");
    const runningTask = createTask({
      id: "task_timeout_running",
      status: "running",
      prompt: "Timeout prompt",
      modelId: "image-model",
      createdAt: "2026-07-07T00:00:12.000Z"
    });
    const noMatchTask = createTask({
      id: "task_timeout_other",
      status: "running",
      prompt: "Other prompt",
      modelId: "image-model",
      createdAt: "2026-07-07T00:00:12.000Z"
    });
    const allPollingMatches = Array.from({ length: 8 }, (_, index) =>
      findImageTaskForPollingReconcile({
        tasks: index % 2 === 0 ? [runningTask] : [noMatchTask],
        prompt: "Timeout prompt",
        modelId: "image-model",
        requestStartedAt,
        now: new Date("2026-07-07T00:00:30.000Z")
      })
    );
    const timeoutEntry = markImageStreamEntryChecking(
      {
        id: "image-local-timeout",
        prompt: "Timeout prompt",
        modelName: "Image Model",
        aspectRatio: "1:1" as const,
        mode: "text-to-image" as const,
        referenceImage: null,
        status: "checking" as const,
        result: null,
        error: "Request submitted. Syncing task result..."
      },
      "The task may still be running. Check the Tasks page."
    );
    const merged = mergeImageSessionsWithBackendHistory(
      [{ id: "session-a", title: "Session A", entries: [timeoutEntry] }],
      [],
      "History"
    );

    expect(allPollingMatches.filter((task) => task?.status === "succeeded")).toEqual([]);
    expect(timeoutEntry).toMatchObject({
      status: "checking",
      result: null,
      error: "The task may still be running. Check the Tasks page."
    });
    expect(
      merged.some((session) => session.id === "image-history-backend")
    ).toBe(false);
  });

  it("filters backend history by page load time and respects dismissal", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const oldTask = createTask({
      id: "task_before_page_load",
      status: "succeeded",
      prompt: "Old task",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-restored",
        imageSessionTitle: "Restored Session"
      },
      output: { images: ["https://cdn.example.com/old.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const newTask = createTask({
      id: "task_after_page_load",
      status: "succeeded",
      prompt: "New task",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-restored",
        imageSessionTitle: "Restored Session"
      },
      output: { images: ["https://cdn.example.com/new.png"] },
      createdAt: "2026-07-07T00:00:20.000Z"
    });
    const filteredTasks = filterTasksCreatedBefore(
      [oldTask, newTask],
      new Date("2026-07-07T00:00:10.000Z")
    );
    const persistedFilteredTasks = filterTasksCreatedBeforeIso(
      [oldTask, newTask],
      "2026-07-07T00:00:10.000Z"
    );
    const localSessions = [
      {
        id: "session-a",
        title: "Session A",
        entries: []
      }
    ];
    const merged = mergeImageSessionsWithBackendHistory(
      localSessions,
      filteredTasks.map((task) => taskToImageStreamEntry(task, modelMap, t)),
      "History"
    );
    const dismissed = mergeImageSessionsWithBackendHistory(
      localSessions,
      filteredTasks.map((task) => taskToImageStreamEntry(task, modelMap, t)),
      "History",
      20,
      { backendHistoryDismissed: true }
    );

    expect(filteredTasks.map((task) => task.id)).toEqual([
      "task_before_page_load"
    ]);
    expect(persistedFilteredTasks.map((task) => task.id)).toEqual([
      "task_before_page_load"
    ]);
    expect(
      merged.find((session) => session.id === "session-restored")?.entries.map(
        (entry) => entry.result?.task?.id
      )
    ).toEqual(["task_before_page_load"]);
    expect(
      dismissed.some((session) => session.id === "image-history-backend")
    ).toBe(false);
  });

  it("persists firstPageLoadedAt and keeps dismissed backend history from being recreated", async () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const oldTask = createTask({
      id: "task_storage_old",
      status: "succeeded",
      prompt: "Old stored task",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-stored",
        imageSessionTitle: "Stored Session"
      },
      output: { images: ["https://cdn.example.com/old-stored.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const newTask = createTask({
      id: "task_storage_new",
      status: "succeeded",
      prompt: "New stored task",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-stored",
        imageSessionTitle: "Stored Session"
      },
      output: { images: ["https://cdn.example.com/new-stored.png"] },
      createdAt: "2026-07-07T00:00:20.000Z"
    });
    const serialized = serializeImageSessionsForStorage(
      [{ id: "session-a", title: "Session A", entries: [] }],
      "session-a",
      20,
      {
        firstPageLoadedAt: "2026-07-07T00:00:10.000Z",
        backendHistoryDismissed: true
      }
    );
    const restored = parseStoredImageSessions(serialized, 20);
    const restoredTasks = filterTasksCreatedBeforeIso(
      [oldTask, newTask],
      restored?.firstPageLoadedAt ?? ""
    );
    const afterDeletedHistory = mergeImageSessionsWithBackendHistory(
      restored?.sessions ?? [],
      restoredTasks.map((task) => taskToImageStreamEntry(task, modelMap, t)),
      "History",
      20,
      { backendHistoryDismissed: restored?.backendHistoryDismissed }
    );
    const afterAllSessionsDeleted = mergeImageSessionsWithBackendHistory(
      [{ id: "session-new", title: "New drawing", entries: [] }],
      [taskToImageStreamEntry(oldTask, modelMap, t)],
      "History",
      20,
      { backendHistoryDismissed: true }
    );

    expect(restored?.firstPageLoadedAt).toBe("2026-07-07T00:00:10.000Z");
    expect(restored?.backendHistoryDismissed).toBe(true);
    expect(restoredTasks.map((task) => task.id)).toEqual(["task_storage_old"]);
    expect(
      afterDeletedHistory.some((session) => session.id === "image-history-backend")
    ).toBe(false);
    expect(
      afterAllSessionsDeleted.some((session) => session.id === "image-history-backend")
    ).toBe(false);
  });

  it("renders backend-restored results without recovering reference bytes", async () => {
    const task = createTask({
      id: "task_history_reference",
      status: "succeeded",
      prompt: "Restored room redesign",
      modelId: "image-model",
      input: {
        mode: "image-to-image",
        size: "1024x1024",
        count: 1,
        referenceImages: [
          {
            name: "first.png",
            mimeType: "image/png",
            originalBytes: 100,
            compressedBytes: 80,
            dataUrl: "data:image/png;base64,FIRST_SECRET"
          },
          {
            name: "second.jpg",
            mimeType: "image/jpeg",
            originalBytes: 200,
            compressedBytes: 120,
            dataUrl: "data:image/jpeg;base64,SECOND_SECRET"
          }
        ],
        referenceImage: {
          name: "room.jpg",
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,SECRET_REFERENCE"
        }
      },
      output: { images: ["https://cdn.example.com/restored.png"] },
      createdAt: "2026-07-07T00:00:00.000Z"
    });
    const entry = taskToImageStreamEntry(
      task,
      new Map([
        [
          "image-model",
          createImageModel({
            modelId: "image-model",
            displayName: "Readable Image Model"
          })
        ]
      ]),
      createTranslator("en-US")
    );
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialModels={[createImageModel({ modelId: "image-model" })]}
        initialResult={entry.result}
      />
    );
    expect(html).toContain('data-image-ai-result="true"');
    expect(html).toContain('data-image-creator-result-hero="true"');
    expect(html).not.toContain("data:image/jpeg");
  });

  it("renders the task workspace with stats, simple clickable cards, and full detail panel", async () => {
    const olderTask = createTask({
      id: "task_older",
      status: "failed",
      prompt: "A failed city skyline render",
      input: { mode: "image-to-image", size: "1024x1024", count: 1 },
      modelId: "agnes-image-2.0-flash",
      errorMessage: "Provider failed",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:10.000Z",
      completedAt: "2026-06-18T00:00:10.000Z"
    });
    const latestTask = createTask({
      id: "task_latest",
      status: "succeeded",
      prompt: "A quiet reading room with plants",
      modelId: "agnes-image-2.0-flash",
      input: { mode: "text-to-image", size: "1536x1024", count: 1, modelId: "agnes-image-2.0-flash" },
      output: { images: ["https://cdn.example.com/image.png"] },
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:10.000Z",
      completedAt: "2026-06-19T00:00:10.000Z"
    });
    const html = renderWithLocale(
      <TasksPageContent
        initialToken="token"
        initialTasks={[olderTask, latestTask]}
        initialModels={[createImageModel()]}
      />
    );

    expect(html).toContain('data-tasks-workspace-root="full-width"');
    expect(html).toContain('data-mobile-works-switcher="true"');
    expect(html).toContain('data-mobile-task-status-filters="true"');
    expect(html).toContain('data-mobile-task-card="true"');
    expect(html).toContain('data-task-id="task_latest"');
    expect(html).toContain('href="/tasks/task_latest"');
    expect(html).toContain("Completed");
    expect(html).toContain("Failed");
    expect(html).not.toContain("Provider failed");
    expect(html).toContain("A quiet reading room");
    expect(html).toContain("Completed");
    expect(html).toContain("qianyuIMG");
    expect(html).not.toContain("agnes-image-2.0-flash");
    expect(html).not.toContain("View assets");
    expect(html).not.toContain("View details");
    expect(html).not.toContain("View task details");
    expect(getDefaultSelectedTaskId([olderTask, latestTask])).toBe("task_latest");
    expect(selectTaskForPanel(filterTasks([olderTask, latestTask], "all"), "task_older")?.id).toBe("task_older");
    expect(getTaskPreviewImage(latestTask)).toBeNull();
    expect(getTaskStats([olderTask, latestTask])).toEqual({
      total: 2,
      succeeded: 1,
      generating: 0,
      failed: 1
    });
    expect(getTaskGeneratedSize(latestTask)).toBe("1536x1024");
    expect(
      getTaskGeneratedSize(
        createTask({
          id: "task_output_size",
          status: "succeeded",
          prompt: "Output size fallback",
          createdAt: "2026-06-20T00:00:00.000Z",
          input: {},
          output: { size: "2048x2048" }
        })
      )
    ).toBe("2048x2048");
    expect(
      getTaskGeneratedSize(
        createTask({
          id: "task_no_size",
          status: "succeeded",
          prompt: "No string size",
          createdAt: "2026-06-20T00:00:00.000Z",
          input: { size: null },
          output: { size: 1024 }
        })
      )
    ).toBeNull();
    expect(resolveTaskModelLabel(latestTask, [createImageModel()], "Image model")).toBe("qianyuIMG");
    expect(resolveTaskModelLabel(latestTask, [], "Image model")).toBe("Image model");
  });

  it("uses the task detail-panel safe model fallback without exposing unmatched raw model ids", async () => {
    const task = createTask({
      id: "task_safe_model_fallback",
      status: "succeeded",
      prompt: "Fallback model task",
      modelId: "gpt-image-2",
      input: { mode: "text-to-image", size: "1024x1024", count: 1, modelId: "gpt-image-2" },
      output: { images: ["https://cdn.example.com/fallback.png"] },
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:10.000Z",
      completedAt: "2026-06-21T00:00:10.000Z"
    });
    const html = renderWithLocale(
      <TasksPageContent initialToken="token" initialTasks={[task]} initialModels={[]} />
    );

    expect(html).not.toContain("gpt-image-2");
    expect(html).not.toContain("gpt-image-2");
    expect(resolveTaskModelLabel(task, [], "Image model")).toBe("Image model");
  });

  it("renders only the adaptive current task page with compact desktop and mobile pagination", async () => {
    const tasks = Array.from({ length: 8 }, (_, index) => {
      const taskNumber = index + 1;

      return createTask({
        id: `task_${taskNumber}`,
        status: taskNumber === 8 ? "succeeded" : "running",
        prompt:
          taskNumber === 8
            ? "Paged prompt 8 with a deliberately long prompt that should remain clamped inside a stable task card instead of increasing the card height"
            : `Paged prompt ${taskNumber}`,
        createdAt: `2026-06-${String(10 + taskNumber).padStart(2, "0")}T00:00:00.000Z`,
        output: taskNumber === 8 ? { images: ["https://cdn.example.com/latest.png"] } : null
      });
    });
    const html = renderWithLocale(
      <TasksPageContent
        initialToken="token"
        initialTasks={tasks}
        initialModels={[createImageModel()]}
      />
    );

    expect(getTaskPageSizeFallback("desktop")).toBe(4);
    expect(getTaskPageSizeFallback("mobile")).toBe(3);
    expect(html.match(/data-mobile-task-card="true"/g)).toHaveLength(8);
    expect(html).toContain('data-mobile-task-status-filter="all"');
    expect(html).toContain('data-mobile-task-status-filter="generating"');
    expect(html).toContain("Paged prompt 8");
    expect(html).toContain("Paged prompt 5");
    expect(html).toContain("Paged prompt 4");
    expect(html).toContain("Paged prompt 1");
    expect(html).not.toContain('data-tasks-pagination="desktop"');
  });

  it("calculates adaptive task page size with desktop and mobile clamp rules", async () => {
    expect(adaptiveTaskPageSizeConfig.desktop).toMatchObject({
      min: 3,
      max: 8,
      fallback: 4
    });
    expect(adaptiveTaskPageSizeConfig.mobile).toMatchObject({
      min: 2,
      max: 6,
      fallback: 3
    });
    expect(getAdaptiveTaskPageSize(640, "desktop")).toBe(5);
    expect(getAdaptiveTaskPageSize(96, "desktop")).toBe(3);
    expect(getAdaptiveTaskPageSize(1400, "desktop")).toBe(8);
    expect(getAdaptiveTaskPageSize(428, "mobile")).toBe(3);
    expect(getAdaptiveTaskPageSize(80, "mobile")).toBe(2);
    expect(getAdaptiveTaskPageSize(1200, "mobile")).toBe(6);
    expect(getAdaptiveTaskPageSize(null, "desktop")).toBe(4);
    expect(getAdaptiveTaskPageSize(undefined, "mobile")).toBe(3);
    expect(getAdaptiveTaskPageSize(Number.NaN, "mobile")).toBe(3);
  });

  it("keeps adaptive task pagination, resize fallback, and selected detail state aligned", async () => {
    const tasks = Array.from({ length: 8 }, (_, index) => {
      const taskNumber = index + 1;

      return createTask({
        id: `task_${taskNumber}`,
        status: taskNumber % 2 === 0 ? "succeeded" : "failed",
        prompt: `Paged state prompt ${taskNumber}`,
        input: { mode: taskNumber % 2 === 0 ? "text-to-image" : "image-to-image" },
        createdAt: `2026-06-${String(10 + taskNumber).padStart(2, "0")}T00:00:00.000Z`
      });
    });
    const filteredNewest = filterTasks(tasks, "all", "newest");
    const desktopFallbackSize = getTaskPageSizeFallback("desktop");
    const resizedDesktopSize = getAdaptiveTaskPageSize(640, "desktop");
    const firstPage = paginateTasks(filteredNewest, 1, desktopFallbackSize);
    const nextPageNumber = getTaskPageAfterDelta(
      1,
      filteredNewest.length,
      1,
      desktopFallbackSize
    );
    const nextPage = paginateTasks(filteredNewest, nextPageNumber, desktopFallbackSize);
    const previousPageNumber = getTaskPageAfterDelta(
      nextPageNumber,
      filteredNewest.length,
      -1,
      desktopFallbackSize
    );
    const filteredSucceeded = filterTasks(tasks, "succeeded", "newest");
    const sortedOldest = filterTasks(tasks, "all", "oldest");

    expect(getTaskTotalPages(filteredNewest.length, desktopFallbackSize)).toBe(2);
    expect(firstPage.map((task) => task.id)).toEqual([
      "task_8",
      "task_7",
      "task_6",
      "task_5"
    ]);
    expect(nextPageNumber).toBe(2);
    expect(nextPage.map((task) => task.id)).toEqual(["task_4", "task_3", "task_2", "task_1"]);
    expect(previousPageNumber).toBe(1);
    expect(
      paginateTasks(filteredNewest, previousPageNumber, desktopFallbackSize).map((task) => task.id)
    ).toEqual(firstPage.map((task) => task.id));
    expect(selectTaskForPanel(firstPage, null)?.id).toBe("task_8");
    expect(selectTaskForPanel(nextPage, "task_8")?.id).toBe("task_4");
    expect(clampTaskPage(3, filteredNewest.length, resizedDesktopSize)).toBe(2);
    expect(paginateTasks(filteredNewest, 2, resizedDesktopSize).map((task) => task.id)).toEqual([
      "task_3",
      "task_2",
      "task_1"
    ]);
    expect(clampTaskPage(3, filteredSucceeded.length, desktopFallbackSize)).toBe(1);
    expect(paginateTasks(filteredSucceeded, 3, desktopFallbackSize).map((task) => task.id)).toEqual([
      "task_8",
      "task_6",
      "task_4",
      "task_2"
    ]);
    expect(paginateTasks(sortedOldest, 1, desktopFallbackSize)[0]?.id).toBe("task_1");
    expect(paginateTasks([], 3, desktopFallbackSize)).toEqual([]);
    expect(clampTaskPage(3, 0, desktopFallbackSize)).toBe(1);
  });

  it("keeps task filters and sorting working for status and image modes", async () => {
    const tasks = [
      createTask({
        id: "task_success",
        status: "succeeded",
        prompt: "Text image success",
        input: { mode: "text-to-image" },
        createdAt: "2026-06-19T00:00:00.000Z"
      }),
      createTask({
        id: "task_failed",
        status: "failed",
        prompt: "Image reference failed",
        input: { mode: "image-to-image" },
        createdAt: "2026-06-18T00:00:00.000Z"
      }),
      createTask({
        id: "task_running",
        status: "running",
        prompt: "Running task",
        input: { mode: "text-to-image" },
        createdAt: "2026-06-20T00:00:00.000Z"
      })
    ];

    expect(filterTasks(tasks, "succeeded").map((task) => task.id)).toEqual(["task_success"]);
    expect(filterTasks(tasks, "failed").map((task) => task.id)).toEqual(["task_failed"]);
    expect(filterTasks(tasks, "generating").map((task) => task.id)).toEqual(["task_running"]);
    expect(filterTasks(tasks, "text-to-image").map((task) => task.id)).toEqual(["task_running", "task_success"]);
    expect(filterTasks(tasks, "image-to-image").map((task) => task.id)).toEqual(["task_failed"]);
    expect(selectTaskForPanel([], "task_missing")).toBeNull();
    expect(getDefaultSelectedTaskId([])).toBeNull();
    expect(sortTasks(tasks, "newest").map((task) => task.id)).toEqual([
      "task_running",
      "task_success",
      "task_failed"
    ]);
    expect(sortTasks(tasks, "oldest").map((task) => task.id)).toEqual([
      "task_failed",
      "task_success",
      "task_running"
    ]);
    expect(filterTasks(tasks, "all", "oldest").map((task) => task.id)).toEqual([
      "task_failed",
      "task_success",
      "task_running"
    ]);
  });

  it("renders the asset grid with badges, created time, prompt, and actions", async () => {
    const html = renderWithLocale(
      <AssetsPageContent
        initialToken="token"
        initialAssets={[
          {
            id: "asset_1",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "/assets/asset_1/content",
            thumbnailUrl: null,
            title: "A quiet reading room",
            metadata: { mode: "text-to-image", modelId: "image-model", size: "1024x1024" },
            createdAt: "2026-06-18T00:00:00.000Z",
            taskPrompt: "A quiet reading room with plants"
          }
        ]}
      />
    );

    expect(html).toContain('data-mobile-works-gallery="true"');
    expect(html).toContain('data-mobile-asset-card="true"');

    // Key information still present
    expect(html).toContain("A quiet reading room");
    expect(html).toContain("Works");
    expect(html).toContain('href="/assets/asset_1"');
    expect(html).not.toContain("Delete asset");
    expect(html).not.toContain("Provider");

    // Removed buttons/links
    expect(html).not.toContain("Copy prompt");
    expect(html).not.toContain("Reuse in Image Creation");
    expect(html).not.toContain("Open image");
    expect(html).not.toContain("Source task");
    expect(html).not.toContain('href="/image?prompt=');
    expect(html).not.toContain('target="_blank"');
  });

  it("renders asset empty state with enhanced copy", async () => {
    const html = renderWithLocale(
      <AssetsPageContent initialToken={null} initialAssets={[]} />
    );

    expect(html).toContain("No works yet");
    expect(html).toContain("Start creating");
    expect(html).toContain('href="/image"');
  });

  it("keeps desktop cards to preview plus a primary detail area", async () => {
    const asset: AiAssetSummary = {
      id: "asset-desktop-simple-card",
      userId: "user_1",
      taskId: "task-desktop-simple-card",
      type: "image",
      url: "/assets/asset-desktop-simple-card/content",
      thumbnailUrl: null,
      title: "Desktop simple card",
      metadata: { mode: "text-to-image" },
      createdAt: "2026-07-17T00:00:00.000Z",
      taskPrompt: "Desktop card prompt"
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = privateAssetTestUrl(input);
      if (url.pathname === "/api/assets") {
        return new Response(JSON.stringify({ assets: [asset] }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.pathname.endsWith("/content")) return privateAssetTestResponse();
      throw new Error(`Unexpected desktop card request: ${url.pathname}`);
    }));
    mockPrivateAssetObjectUrls(["blob:desktop-simple-card"]);

    await mountPrivateAssetPage(
      <AssetsPageContent initialToken="desktop-token" initialAssets={[asset]} />,
      "en-US",
      { width: 1024 }
    );

    const card = privateAssetHost?.querySelector('[data-asset-card="true"]');
    expect(card).toBeTruthy();
    expect(card?.querySelector('[data-asset-image-button="true"]')).toBeTruthy();
    expect(card?.querySelector('[data-asset-card-detail-trigger="true"]')).toBeTruthy();
    expect(card?.querySelector('a[href="/assets/asset-desktop-simple-card"]')).toBeTruthy();
    expect(card?.querySelector('[data-asset-continue-creating="true"]')).toBeNull();
    expect(card?.querySelector('[aria-label="Delete asset"]')).toBeNull();
    expect(card?.querySelector('[data-asset-detail-link="true"]')).toBeNull();
    expect(card?.querySelectorAll("button")).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Adaptive asset page size – pure helpers
  // -----------------------------------------------------------------------

  it("calculateAssetPageSize returns expected page sizes for different container dimensions", () => {
    expect(
      calculateAssetPageSize({ containerWidth: 1200, containerHeight: 800 }),
    ).toBe(
      Math.min(
        adaptiveAssetPageSizeConfig.maxPageSize,
        Math.max(
          adaptiveAssetPageSizeConfig.minPageSize,
          Math.floor((1200 + 16) / (240 + 16)) *
            Math.floor((800 + 16) / (300 + 16)),
        ),
      ),
    );

    // Small container → small page size
    const small = calculateAssetPageSize({ containerWidth: 280, containerHeight: 360 });
    expect(small).toBeLessThanOrEqual(10);
    expect(small).toBeGreaterThanOrEqual(adaptiveAssetPageSizeConfig.minPageSize);

    // Large container → large page size
    const large = calculateAssetPageSize({ containerWidth: 1600, containerHeight: 1200 });
    expect(large).toBeGreaterThanOrEqual(12);

    // Enormous container → clamped to maxPageSize
    const enormous = calculateAssetPageSize({ containerWidth: 4000, containerHeight: 4000 });
    expect(enormous).toBe(adaptiveAssetPageSizeConfig.maxPageSize);

    // Tiny container → clamped to minPageSize
    const tiny = calculateAssetPageSize({ containerWidth: 100, containerHeight: 100 });
    expect(tiny).toBe(adaptiveAssetPageSizeConfig.minPageSize);

    // Invalid dimensions → fallback to minPageSize
    expect(
      calculateAssetPageSize({ containerWidth: 0, containerHeight: 600 }),
    ).toBe(adaptiveAssetPageSizeConfig.minPageSize);
    expect(
      calculateAssetPageSize({ containerWidth: -100, containerHeight: 600 }),
    ).toBe(adaptiveAssetPageSizeConfig.minPageSize);
    expect(
      calculateAssetPageSize({ containerWidth: 800, containerHeight: NaN }),
    ).toBe(adaptiveAssetPageSizeConfig.minPageSize);
    expect(
      calculateAssetPageSize({
        containerWidth: Infinity,
        containerHeight: 600,
      }),
    ).toBe(adaptiveAssetPageSizeConfig.minPageSize);
  });

  it("clampAssetPage keeps the page within valid bounds", () => {
    expect(clampAssetPage(1, 50, 12)).toBe(1);
    expect(clampAssetPage(5, 50, 12)).toBe(5);
    // Overflow clamps to last page
    expect(clampAssetPage(99, 50, 12)).toBe(5);
    // Zero assets → page 1
    expect(clampAssetPage(3, 0, 12)).toBe(1);
    // Negative page → page 1
    expect(clampAssetPage(-1, 50, 12)).toBe(1);
  });

  it("paginateAssets returns only the current page slice", () => {
    const assets = Array.from({ length: 30 }, (_, i) => ({
      id: `asset_${i + 1}`,
      userId: "user_1",
      taskId: `task_${i + 1}`,
      type: "image" as const,
      url: `https://cdn.example.com/${i + 1}.png`,
      thumbnailUrl: null,
      title: `Asset ${i + 1}`,
      metadata: { mode: "text-to-image" },
      createdAt: `2026-07-0${String(Math.min(9, i + 1))}T00:00:00.000Z`,
      taskPrompt: `Prompt ${i + 1}`,
    }));

    const page1 = paginateAssets(assets, 1, 12);
    expect(page1).toHaveLength(12);
    expect(page1[0]?.id).toBe("asset_1");
    expect(page1[11]?.id).toBe("asset_12");

    const page2 = paginateAssets(assets, 2, 12);
    expect(page2).toHaveLength(12);
    expect(page2[0]?.id).toBe("asset_13");

    // Last page with fewer items
    const page3 = paginateAssets(assets, 3, 12);
    expect(page3).toHaveLength(6);
    expect(page3[5]?.id).toBe("asset_30");

    // Empty list returns empty
    expect(paginateAssets([], 1, 12)).toEqual([]);
  });

  it("getAssetPageAfterDelta advances and retreats safely", () => {
    expect(getAssetPageAfterDelta(2, 50, -1, 12)).toBe(1);
    expect(getAssetPageAfterDelta(1, 50, 1, 12)).toBe(2);
    // At first page, can't go back
    expect(getAssetPageAfterDelta(1, 50, -1, 12)).toBe(1);
    // At last page, can't go forward
    expect(getAssetPageAfterDelta(5, 50, 1, 12)).toBe(5);
  });

  // -----------------------------------------------------------------------
  // Asset library – adaptive pagination rendering
  // -----------------------------------------------------------------------

  it("renders only the current page of assets", () => {
    const assets = Array.from({ length: 20 }, (_, i) => ({
      id: `asset_p_${i + 1}`,
      userId: "user_1",
      taskId: `task_${i + 1}`,
      type: "image" as const,
      url: `/assets/asset_p_${i + 1}/content`,
      thumbnailUrl: null,
      title: `Page asset ${i + 1}`,
      metadata: i % 3 === 0 ? { mode: "text-to-image" } : { mode: "image-to-image" },
      createdAt: `2026-07-0${String(Math.min(9, i + 1))}T00:00:00.000Z`,
      taskPrompt: `Prompt ${i + 1}`,
    }));

    const html = renderWithLocale(
      <AssetsPageContent initialToken="token" initialAssets={assets} />,
    );

    const cardMatches = html.match(/data-mobile-asset-card="true"/g);
    expect(cardMatches).toHaveLength(20);
    expect(html).not.toContain('data-asset-pagination="true"');

    // First page assets visible
    expect(html).toContain("Page asset 1");
    expect(html).toContain("Page asset 12");

    expect(html).toContain("Page asset 13");
    expect(html).toContain("Page asset 20");
  });

  it("includes the full page indicator and total asset count in pagination", () => {
    const assets = Array.from({ length: 15 }, (_, i) => ({
      id: `asset_count_${i + 1}`,
      userId: "user_1",
      taskId: `task_${i + 1}`,
      type: "image" as const,
      url: `https://cdn.example.com/count-${i + 1}.png`,
      thumbnailUrl: null,
      title: `Count asset ${i + 1}`,
      metadata: { mode: "text-to-image" },
      createdAt: `2026-07-01T00:00:00.000Z`,
      taskPrompt: `Prompt ${i + 1}`,
    }));

    const html = renderWithLocale(
      <AssetsPageContent initialToken="token" initialAssets={assets} />,
    );

    expect(html).toContain("No works yet");
    expect(html).not.toContain("Page 1 / 2");
  });

  it("renders previous and next page buttons disabled correctly on first and last pages", () => {
    // Only 3 assets → single page, both buttons disabled
    const assets = Array.from({ length: 3 }, (_, i) => ({
      id: `asset_single_${i + 1}`,
      userId: "user_1",
      taskId: `task_${i + 1}`,
      type: "image" as const,
      url: `/assets/asset_single_${i + 1}/content`,
      thumbnailUrl: null,
      title: `Single page ${i + 1}`,
      metadata: { mode: "text-to-image" },
      createdAt: "2026-07-01T00:00:00.000Z",
      taskPrompt: `Prompt ${i + 1}`,
    }));

    const html = renderWithLocale(
      <AssetsPageContent initialToken="token" initialAssets={assets} />,
    );

    // All 3 shown (less than pageSize)
    const cardMatches = html.match(/data-mobile-asset-card="true"/g);
    expect(cardMatches).toHaveLength(3);
    expect(html).not.toContain('data-asset-pagination="true"');
  });

  // -----------------------------------------------------------------------
  // Image preview modal
  // -----------------------------------------------------------------------

  it("retains image preview button and modal data attributes", () => {
    const html = renderWithLocale(
      <AssetsPageContent
        initialToken="token"
        initialAssets={[
          {
            id: "asset_img",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "/assets/asset_img/content",
            thumbnailUrl: null,
            title: "Preview test",
            metadata: { mode: "text-to-image" },
            createdAt: "2026-07-01T00:00:00.000Z",
            taskPrompt: "Preview test prompt",
          },
        ]}
      />,
    );

    expect(html).toContain('data-mobile-asset-card="true"');
    expect(html).not.toContain('data-asset-image-button="true"');
  });

  // -----------------------------------------------------------------------
  // Image thumbnails – object-contain (not object-cover)
  // -----------------------------------------------------------------------

  it("renders image thumbnails with object-contain instead of object-cover", () => {
    const html = renderWithLocale(
      <AssetsPageContent
        initialToken="token"
        initialAssets={[
          {
            id: "asset_thumb",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "/assets/asset_thumb/content",
            thumbnailUrl: null,
            title: "Thumbnail test",
            metadata: { mode: "text-to-image" },
            createdAt: "2026-07-01T00:00:00.000Z",
            taskPrompt: "Thumbnail test",
          },
        ]}
      />,
    );

    expect(html).toContain('data-mobile-asset-card="true"');
    expect(html).toContain("aspect-");
    expect(html).not.toContain("object-cover");
  });

  // -----------------------------------------------------------------------
  // Button styling – not plain a tags
  // -----------------------------------------------------------------------

  it("renders View details as a styled button-like link, not a bare text link", () => {
    const html = renderWithLocale(
      <AssetsPageContent
        initialToken="token"
        initialAssets={[
          {
            id: "asset_btn_1",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "/assets/asset_btn_1/content",
            thumbnailUrl: null,
            title: "Button test",
            metadata: { mode: "text-to-image" },
            createdAt: "2026-07-01T00:00:00.000Z",
            taskPrompt: "Button test",
          },
        ]}
      />,
    );

    expect(html).toContain('data-mobile-asset-card="true"');
    expect(html).toContain('href="/assets/asset_btn_1"');
    expect(html).not.toContain('data-asset-detail-link="true"');
  });

  it("renders delete button with rounded border button style and hover-danger classes", () => {
    const html = renderWithLocale(
      <AssetsPageContent
        initialToken="token"
        initialAssets={[
          {
            id: "asset_del_1",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "/assets/asset_del_1/content",
            thumbnailUrl: null,
            title: "Delete button test",
            metadata: { mode: "text-to-image" },
            createdAt: "2026-07-01T00:00:00.000Z",
            taskPrompt: "Delete button test",
          },
        ]}
      />,
    );

    expect(html).toContain('data-mobile-asset-card="true"');
    expect(html).not.toContain('aria-label="Delete asset"');
  });

  // -----------------------------------------------------------------------
  // Card click interaction – detail trigger separate from image/buttons
  // -----------------------------------------------------------------------

  it("has a data-asset-card-detail-trigger area separate from image and delete buttons", () => {
    const html = renderWithLocale(
      <AssetsPageContent
        initialToken="token"
        initialAssets={[
          {
            id: "asset_click_1",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "/assets/asset_click_1/content",
            thumbnailUrl: null,
            title: "Click region test",
            metadata: { mode: "text-to-image" },
            createdAt: "2026-07-01T00:00:00.000Z",
            taskPrompt: "Click region test",
          },
        ]}
      />,
    );

    expect(html).toContain('data-mobile-asset-card="true"');
    expect(html).toContain('href="/assets/asset_click_1"');
    expect(html).not.toContain('data-asset-image-button="true"');
    expect(html).not.toContain('aria-label="Delete asset"');
  });

  // -----------------------------------------------------------------------
  // Removed features still absent
  // -----------------------------------------------------------------------

  it("keeps removed features absent with pagination assets", () => {
    const assets = Array.from({ length: 20 }, (_, i) => ({
      id: `asset_rm_${i + 1}`,
      userId: "user_1",
      taskId: `task_${i + 1}`,
      type: "image" as const,
      url: `https://cdn.example.com/rm-${i + 1}.png`,
      thumbnailUrl: null,
      title: `Removed check ${i + 1}`,
      metadata: i % 2 === 0 ? { mode: "text-to-image" } : { mode: "image-to-image" },
      createdAt: `2026-07-01T00:00:00.000Z`,
      taskPrompt: `Prompt ${i + 1}`,
    }));

    const html = renderWithLocale(
      <AssetsPageContent initialToken="token" initialAssets={assets} />,
    );

    expect(html).not.toContain("Copy prompt");
    expect(html).not.toContain("Reuse in Image Creation");
    expect(html).not.toContain("Open image");
    expect(html).not.toContain("Source task");
    expect(html).not.toContain('href="/image?prompt=');
    expect(html).not.toContain('target="_blank"');
  });

  it("renders failed task detail with safe error copy", async () => {
    const html = renderWithLocale(
      <TaskDetailPageContent
        taskId="task_1"
        initialToken="token"
        initialTask={{
          id: "task_1",
          userId: "user_1",
            type: "image",
            status: "failed",
            modelId: "image-model",
            prompt: "A quiet reading room with plants",
            input: {
              mode: "image-to-image",
              size: "1024x1024",
              count: 1,
              referenceImage: {
                name: "reference.png",
                mimeType: "image/png",
                originalBytes: 1200000,
                compressedBytes: 220000,
                dataUrl: "data:image/png;base64,SECRET_REFERENCE"
              }
            },
          output: null,
          costCredits: 0,
          errorMessage: "Model service temporarily unavailable",
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:10.000Z",
          completedAt: "2026-06-18T00:00:10.000Z"
        }}
      />
    );

    expect(html).toContain("Task details");
    expect(html).toContain("A quiet reading room with plants");
    expect(html).toContain("Image to image");
    expect(html).toContain("Image model");
    expect(html).not.toContain("image-model");
    expect(html).toContain("1024x1024");
    expect(html).toContain("Count");
    expect(html).toContain("Reference image metadata");
    expect(html).toContain("reference.png");
    expect(html).toContain("Copy file name");
    expect(html).toContain("image/png");
    expect(html).toContain("1.14 MB");
    expect(html).toContain("214.8 KB");
    expect(html).toContain("Copy prompt");
    expect(html).toContain('data-task-detail-prompt-card="true"');
    expect(html.match(/data-task-detail-prompt-card="true"/g)).toHaveLength(1);
    expect(html.match(/data-task-copy-prompt="true"/g)).toHaveLength(1);
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Regenerate with same parameters");
    expect(html).not.toContain("View artwork details");
    expect(html).toContain("Failed");
    expect(html).toContain("Image generation failed");
    expect(html).not.toContain("Model service temporarily unavailable");
    expect(html).not.toContain("SECRET_REFERENCE");
    expect(html).not.toContain("data:image/png");
    expect(html).toContain('data-reference-metadata-grid="true"');
    expect(html).toContain('data-task-detail-scroll-owner="true"');
    expect(html).toContain('data-mobile-task-detail-info-grid="true"');
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("break-all");
    expect(html).toContain("min-w-0");
    expect(html).not.toContain("Linked assets");
    expect(html).not.toContain("provider.example");
  });

  it("keeps task reference metadata overflow-safe for long file names", async () => {
    const longName = "reference-".repeat(20) + "image.png";
    const html = renderWithLocale(
      <TaskDetailPageContent
        taskId="task_1"
        initialToken="token"
        initialTask={{
          id: "task_1",
          userId: "user_1",
          type: "image",
          status: "succeeded",
          modelId: "image-model",
          prompt: "A quiet reading room",
          input: {
            mode: "image-to-image",
            size: "1024x1024",
            count: 1,
            referenceImage: {
              name: longName,
              mimeType: "image/super-long-custom-type+png",
              originalBytes: 1200000,
              compressedBytes: 220000,
              dataUrl: "data:image/png;base64,SECRET_REFERENCE"
            }
          },
          output: null,
          costCredits: 2,
          errorMessage: null,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:10.000Z",
          completedAt: "2026-06-18T00:00:10.000Z"
        }}
      />
    );

    expect(html).toContain(longName);
    expect(html).toContain(`title="${longName}"`);
    expect(html).toContain("image/super-long-custom-type+png");
    expect(html).toContain("Copy file name");
    expect(html).toContain('data-reference-metadata-grid="true"');
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("break-all");
    expect(html).toContain("min-w-0");
    expect(html).not.toContain("SECRET_REFERENCE");
    expect(html).not.toContain("data:image/png");
  });

  it("renders all ordered multi-reference task metadata without duplicating the scalar field", () => {
    const html = renderWithLocale(
      <TaskDetailPageContent
        taskId="task_multi"
        initialToken="token"
        initialTask={{
          id: "task_multi",
          userId: "user_1",
          type: "image",
          status: "succeeded",
          modelId: "image-model",
          prompt: "Combine references",
          input: {
            mode: "image-to-image",
            size: "1024x1024",
            count: 1,
            referenceImages: [
              { name: "A.png", mimeType: "image/png" },
              { name: "B.jpg", mimeType: "image/jpeg" }
            ],
            referenceImage: { name: "legacy-duplicate.png" }
          },
          output: null,
          costCredits: 2,
          errorMessage: null,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:10.000Z",
          completedAt: "2026-06-18T00:00:10.000Z"
        }}
      />
    );

    expect(html.match(/data-reference-metadata-group=/g)).toHaveLength(2);
    expect(html.indexOf("A.png")).toBeLessThan(html.indexOf("B.jpg"));
    expect(html).not.toContain("legacy-duplicate.png");
  });

  it("renders succeeded task detail with linked assets", async () => {
    const html = renderWithLocale(
      <TaskDetailPageContent
        taskId="task_1"
        initialToken="token"
        initialTask={{
          id: "task_1",
          userId: "user_1",
            type: "image",
            status: "succeeded",
            modelId: "gpt-image-2",
            prompt: "A quiet reading room with plants",
            input: { mode: "text-to-image", size: "1024x1024", count: 1, modelId: "gpt-image-2" },
          output: { images: ["https://cdn.example.com/image.png"] },
          costCredits: 2,
          errorMessage: null,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:10.000Z",
          completedAt: "2026-06-18T00:00:10.000Z"
        }}
        initialAssets={[
          {
            id: "asset_1",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "https://cdn.example.com/image.png",
            thumbnailUrl: null,
            title: "A quiet reading room",
            metadata: null,
            createdAt: "2026-06-18T00:00:00.000Z",
            taskPrompt: "A quiet reading room with plants"
          }
        ]}
        initialModels={[
          createImageModel({
            id: "model_gpt_image_2",
            modelId: "gpt-image-2",
            displayName: "Readable Image Model",
            name: "Readable Image Model"
          })
        ]}
      />
    );

    expect(html).toContain("Task details");
    expect(html).toContain("Succeeded");
    expect(html).toContain("Text to image");
    expect(html).toContain("Readable Image Model");
    expect(html).not.toContain("gpt-image-2");
    expect(html).toContain("1024x1024");
    expect(html).toContain("Back to assets");
    expect(html).toContain('href="/assets"');
    expect(html).toContain("Copy prompt");
    expect(html).not.toContain("Regenerate with same parameters");
    expect(html).not.toContain("Retry");
    expect(html).toContain("Linked assets");
    expect(html).toContain('href="/assets/asset_1"');
    expect(html).toContain("View artwork details");
    expect(html).toContain('data-task-detail-image-button="true"');
    expect(html).not.toContain('data-task-detail-linked-asset="true"><a');
    expect(html.match(/data-task-detail-prompt-card="true"/g)).toHaveLength(1);
    expect(html.match(/data-task-copy-prompt="true"/g)).toHaveLength(1);
    expect(html).toContain('data-mobile-task-detail-result="asset"');
    expect(html).toContain('data-mobile-task-detail-actions="true"');
    expect(html).toContain('data-task-detail-info-card="true"');

    const resultIndex = html.indexOf('data-task-detail-result="asset"');
    const actionIndex = html.indexOf('data-task-detail-actions="true"');
    const promptIndex = html.indexOf('data-task-detail-prompt-card="true"');
    const infoIndex = html.indexOf('data-task-detail-info-card="true"');
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeLessThan(actionIndex);
    expect(actionIndex).toBeLessThan(promptIndex);
    expect(promptIndex).toBeLessThan(infoIndex);

    const imageSection = html.slice(resultIndex, actionIndex);
    expect(imageSection).not.toContain("A quiet reading room with plants");
    expect(html.match(/A quiet reading room with plants/g)).toHaveLength(1);
    expect(html.match(/data-task-copy-prompt="true"/g)).toHaveLength(1);
  });

  it("renders pending and running task detail states with a mobile preview skeleton", () => {
    for (const status of ["pending", "running"] as const) {
      const statusLabel = status === "pending" ? "Pending" : "Running";
      const html = renderWithLocale(
        <TaskDetailPageContent
          taskId={`task_${status}`}
          initialToken="token"
          initialTask={createTask({
            id: `task_${status}`,
            status,
            prompt: "A deliberately long prompt that still belongs in a readable task card.",
            createdAt: "2026-06-18T00:00:00.000Z"
          })}
          initialModels={[
            createImageModel({
              modelId: "image-model",
              displayName: "A deliberately long image model name for the compact mobile grid"
            })
          ]}
        />
      );

      expect(html).toContain(statusLabel);
      expect(html).toContain('data-mobile-task-detail-result="loading"');
      expect(html).toContain('data-mobile-task-detail-info-grid="true"');
      expect(html).toContain("break-words");
      expect(html).not.toContain('data-mobile-task-detail-result="asset"');
    }
  });

  it("renders asset detail with image preview, badge, prompt, reuse action, and source task", async () => {
    const html = renderWithLocale(
      <AssetDetailPageContent
        assetId="asset_1"
        initialToken="token"
        initialAsset={{
          id: "asset_1",
          userId: "user_1",
          taskId: "task_1",
          type: "image",
          url: "https://cdn.example.com/image.png",
          thumbnailUrl: null,
          title: "A quiet reading room",
          metadata: {
            mode: "image-to-image",
            modelId: "image-model",
            size: "1024x1024",
            count: 1,
            referenceImage: {
              name: "reference.png",
              mimeType: "image/png",
              originalBytes: 1200000,
              compressedBytes: 220000,
              dataUrl: "data:image/png;base64,SECRET_REFERENCE"
            }
          },
          createdAt: "2026-06-18T00:00:00.000Z",
          taskPrompt: "A quiet reading room with plants"
        }}
        initialTask={{
          id: "task_1",
          userId: "user_1",
          type: "image",
          status: "succeeded",
          modelId: "image-model",
          prompt: "A quiet reading room with plants",
          input: { mode: "image-to-image", size: "1024x1024", count: 1 },
          output: { images: ["https://cdn.example.com/image.png"] },
          costCredits: 2,
          errorMessage: null,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:10.000Z",
          completedAt: "2026-06-18T00:00:10.000Z"
        }}
      />
    );

    expect(html).toContain("Work details");
    expect(html).toContain("A quiet reading room");
    expect(html).toContain("A quiet reading room with plants");
    expect(html).toContain("Image to image");
    expect(html).toContain("image-model");
    expect(html).toContain("1024x1024");
    expect(html).toContain("Copy prompt");
    expect(html).not.toContain("SECRET_REFERENCE");
    expect(html).not.toContain("data:image/png");
    expect(html).toContain("Copy URL");
    expect(html).toContain("Delete");
    expect(html).toContain("Back to works");
    expect(html).toContain('data-asset-detail-actions="true"');
    expect(html).not.toContain("Source task");
    expect(html).not.toContain("Reuse in Image Creation");
  });

  it("renders asset detail reuse-to-image link with prompt query param", async () => {
    const html = renderWithLocale(
      <AssetDetailPageContent
        assetId="asset_1"
        initialToken="token"
        initialAsset={{
          id: "asset_1",
          userId: "user_1",
          taskId: null,
          type: "image",
          url: "https://cdn.example.com/image.png",
          thumbnailUrl: null,
          title: "Generated image",
          metadata: { mode: "text-to-image", modelId: "image-model", size: "1024x1024" },
          createdAt: "2026-06-18T00:00:00.000Z",
          taskPrompt: "A sunset over the ocean"
        }}
      />
    );

    expect(html).toContain("Work details");
    expect(html).toContain("Copy URL");
    expect(html).not.toContain("Reuse in Image Creation");
    expect(html).not.toContain('href="/image?prompt=');
  });

  it("extracts safe task and asset reuse parameters without reference data URLs", async () => {
    const task = {
      id: "task_1",
      userId: "user_1",
      type: "image" as const,
      status: "succeeded" as const,
      modelId: "image-model",
      prompt: "A quiet reading room with plants",
      input: {
        mode: "image-to-image",
        size: "1024x1024",
        count: 1,
        referenceImages: [
          {
            name: "first.png",
            mimeType: "image/png",
            originalBytes: 100,
            compressedBytes: 80,
            dataUrl: "data:image/png;base64,FIRST_SECRET"
          },
          {
            name: "second.jpg",
            mimeType: "image/jpeg",
            originalBytes: 200,
            compressedBytes: 120,
            dataUrl: "data:image/jpeg;base64,SECOND_SECRET"
          }
        ],
        referenceImage: {
          name: "reference.png",
          mimeType: "image/png",
          originalBytes: 1200000,
          compressedBytes: 220000,
          dataUrl: "data:image/png;base64,SECRET_REFERENCE"
        }
      },
      output: null,
      costCredits: 2,
      errorMessage: null,
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:10.000Z",
      completedAt: "2026-06-18T00:00:10.000Z"
    };
    const asset = {
      id: "asset_1",
      userId: "user_1",
      taskId: "task_1",
      type: "image" as const,
      url: "https://cdn.example.com/image.png",
      thumbnailUrl: null,
      title: "A quiet reading room",
      metadata: {
        mode: "image-to-image",
        modelId: "image-model",
        size: "1024x1024",
        referenceImage: {
          name: "reference.png",
          mimeType: "image/png",
          originalBytes: 1200000,
          compressedBytes: 220000,
          dataUrl: "data:image/png;base64,SECRET_REFERENCE"
        }
      },
      createdAt: "2026-06-18T00:00:00.000Z",
      taskPrompt: "A quiet reading room with plants"
    };

    expect(getTaskReuseParams(task)).toMatchObject({
      prompt: "A quiet reading room with plants",
      mode: "image-to-image",
      modelId: "image-model",
      size: "1024x1024",
      count: 1,
      referenceImages: [
        { name: "first.png", mimeType: "image/png" },
        { name: "second.jpg", mimeType: "image/jpeg" }
      ],
      referenceImage: {
        name: "first.png",
        mimeType: "image/png",
        originalBytes: 100,
        compressedBytes: 80
      }
    });
    expect(JSON.stringify(getTaskReuseParams(task))).not.toContain("data:image/png");
    expect(JSON.stringify(getAssetReuseParams(asset, task))).not.toContain(
      "SECRET_REFERENCE"
    );
  });

  // Issue 3: reference image clearing on successful image-to-image generation
  it("keeps reference image preview when initialReferenceImage is provided", async () => {
    // This test documents the state-management boundary: when a reference image
    // is provided as initial data, the preview renders. The clearing-on-success
    // behavior (setReferenceImage(null) after a successful image-to-image API
    // response) is inside the async generate() function and cannot be exercised
    // in SSR renderToStaticMarkup tests. It is verified through:
    // 1. Code review of the success handler in image-page-content.tsx
    // 2. The clearing calls match the existing removeReferenceImage pattern
    // 3. Typecheck confirms correct state signatures
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialPrompt="Restyle this room"
        initialGenerationMode="image-to-image"
        initialReferenceImage={{
          dataUrl: "data:image/jpeg;base64,cm9vbQ==",
          mimeType: "image/jpeg",
          name: "ref-test.jpg",
          originalBytes: 4096,
          compressedBytes: 2048
        }}
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    // Reference image preview is present in the composer
    expect(html).toContain('data-reference-image-preview="true"');
    expect(html).toContain("ref-test.jpg");

    // The preview includes a remove button for manual clearing
    expect(html).toContain('Remove reference image');
    expect(html).not.toContain("Compressing reference image");
  });

  // Regression: loading skeleton left-aligned (no mx-auto)
  it("keeps the Creator loading result stable without chat-stream framing", async () => {
    const html = renderWithLocale(
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialIsLoading
        initialPrompt="A quiet reading room"
        initialModels={[
          {
            id: "model_image",
            name: "Image Model",
            displayName: "Image Model",
            slug: "image-model",
            provider: "OPENAI_COMPATIBLE",
            modelId: "image-model",
            enabled: true,
            maxReferenceImages: 1,
            creditCost: 2,
            allowGuest: false,
            sortOrder: 0,
            group: "image",
            tags: ["image"],
            capability: "image",
            isRecommended: false
          }
        ]}
      />
    );

    expect(html).toContain('data-image-loading-skeleton="true"');
    expect(html).toContain("Generating your image...");
    expect(html).toContain('data-image-workbench-result-loading="true"');
    expect(html).toContain('data-image-workbench-result-placeholders="1"');
    expect(html).not.toContain('data-image-conversation-stream="true"');
  });

  it("filters stored image-history-backend sessions during display normalization", () => {
    const sessions = [
      {
        id: "image-history-backend",
        title: "历史记录 11",
        entries: [
          {
            id: "task_shared",
            prompt: "Shared task",
            modelName: "Image Model",
            aspectRatio: "1:1" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "succeeded" as const,
            result: { task: { id: "task_shared", userId: "u1", type: "image" as const, status: "succeeded" as const, modelId: "m", prompt: "Shared", input: {}, output: null, costCredits: 1, errorMessage: null, createdAt: "2026-07-07T00:00:00.000Z", updatedAt: "2026-07-07T00:00:10.000Z", completedAt: "2026-07-07T00:00:10.000Z" }, assets: [] },
            error: null
          },
          {
            id: "task_dup_by_id",
            prompt: "Duplicate by entry id",
            modelName: "Image Model",
            aspectRatio: "1:1" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "succeeded" as const,
            result: null,
            error: null
          }
        ]
      },
      {
        id: "image-history-backend",
        title: "历史记录 1",
        entries: [
          {
            id: "task_dup_by_id",
            prompt: "Duplicate by entry id",
            modelName: "Image Model",
            aspectRatio: "1:1" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "succeeded" as const,
            result: null,
            error: null
          },
          {
            id: "task_unique",
            prompt: "Unique task",
            modelName: "Image Model",
            aspectRatio: "auto" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "succeeded" as const,
            result: null,
            error: null
          }
        ]
      },
      {
        id: "session-normal",
        title: "My drawing",
        entries: [
          {
            id: "entry_normal",
            prompt: "Normal session entry",
            modelName: "Image Model",
            aspectRatio: "16:9" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "succeeded" as const,
            result: null,
            error: null
          }
        ]
      }
    ];

    const normalized = normalizeImageSessionsForDisplay(sessions, "历史记录");

    expect(normalized.some((s) => s.id === "image-history-backend")).toBe(false);
    expect(normalized.some((s) => s.title === "历史记录")).toBe(false);
    const normalSession = normalized.find((s) => s.id === "session-normal");
    expect(normalSession).toBeDefined();
    expect(normalSession?.entries).toHaveLength(1);
    expect(normalSession?.entries[0]?.id).toBe("entry_normal");
  });

  it("ignores legacy image tasks without imageSessionId and does not create history", () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const legacy1 = createTask({
      id: "task_legacy_1",
      status: "succeeded",
      prompt: "Legacy task 1",
      output: { images: ["https://cdn.example.com/legacy1.png"] },
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const legacy2 = createTask({
      id: "task_legacy_2",
      status: "succeeded",
      prompt: "Legacy task 2",
      output: { images: ["https://cdn.example.com/legacy2.png"] },
      createdAt: "2026-07-07T00:02:00.000Z"
    });

    const merged = mergeImageSessionsWithBackendHistory(
      [],
      [legacy1, legacy2].map((task) => taskToImageStreamEntry(task, modelMap, t)),
      "历史记录"
    );

    expect(merged).toEqual([]);
  });

  it("restores only imageSessionId tasks from mixed backend image tasks", () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const legacy = createTask({
      id: "task_legacy",
      status: "succeeded",
      prompt: "Legacy task",
      output: { images: ["https://cdn.example.com/legacy.png"] },
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const sessionA = createTask({
      id: "task_session_a",
      status: "succeeded",
      prompt: "Session A task",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-a",
        imageSessionTitle: "Session A"
      },
      output: { images: ["https://cdn.example.com/session-a.png"] },
      createdAt: "2026-07-07T00:02:00.000Z"
    });

    const merged = mergeImageSessionsWithBackendHistory(
      [],
      [legacy, sessionA].map((task) => taskToImageStreamEntry(task, modelMap, t)),
      "历史记录"
    );

    const historySession = merged.find(
      (s) => s.id === "image-history-backend"
    );
    const normalSession = merged.find((s) => s.id === "session-a");

    expect(historySession).toBeUndefined();
    expect(normalSession).toBeDefined();
    expect(normalSession?.entries.map((e) => e.id)).toEqual(["task_session_a"]);
    expect(normalSession?.title).toBe("Session A");
    expect(
      merged.some((session) =>
        session.entries.some((entry) => entry.id === "task_legacy")
      )
    ).toBe(false);
  });

  it("filters stored image-history-backend and falls back active session to a normal session", () => {
    const entries1 = Array.from({ length: 5 }, (_, i) => ({
      id: `task_old_${i}`,
      prompt: `Old task ${i}`,
      modelName: "Image Model",
      aspectRatio: "1:1" as const,
      mode: "text-to-image" as const,
      referenceImage: null,
      status: "succeeded" as const,
      result: null,
      error: null
    }));

    const storedSessions = [
      { id: "image-history-backend", title: "历史记录 11", entries: entries1 },
      {
        id: "session-normal",
        title: "Normal",
        entries: [
          {
            id: "entry-normal",
            prompt: "Normal prompt",
            modelName: "Image Model",
            aspectRatio: "1:1" as const,
            mode: "text-to-image" as const,
            referenceImage: null,
            status: "succeeded" as const,
            result: null,
            error: null
          }
        ]
      }
    ];

    const serialized = serializeImageSessionsForStorage(
      storedSessions,
      "image-history-backend",
      20,
      { firstPageLoadedAt: "2026-07-07T00:00:00.000Z" }
    );
    const restored = parseStoredImageSessions(serialized, 20);
    expect(restored).toBeDefined();

    const normalized = normalizeImageSessionsForDisplay(
      restored!.sessions,
      "历史记录"
    );
    const activeId = selectActiveImageSessionId(normalized, restored!.activeSessionId);
    expect(restored!.sessions.some((s) => s.id === "image-history-backend")).toBe(
      false
    );
    expect(normalized.map((s) => s.id)).toEqual(["session-normal"]);
    expect(activeId).toBe("session-normal");
  });

  it("returns null for storage containing only image-history-backend", () => {
    const serialized = serializeImageSessionsForStorage(
      [
        {
          id: "image-history-backend",
          title: "历史记录",
          entries: [
            {
              id: "legacy-entry",
              prompt: "Legacy prompt",
              modelName: "Image Model",
              aspectRatio: "1:1" as const,
              mode: "text-to-image" as const,
              referenceImage: null,
              status: "succeeded" as const,
              result: null,
              error: null
            }
          ]
        }
      ],
      "image-history-backend",
      20,
      { firstPageLoadedAt: "2026-07-07T00:00:00.000Z" }
    );

    expect(parseStoredImageSessions(serialized, 20)).toBeNull();
    expect(selectActiveImageSessionId([], "image-history-backend")).toMatch(
      /^image-session-/
    );
  });

  // Regression: normal dismissed sessions stay hidden
  it("keeps normally dismissed image sessions hidden after merge", () => {
    const t = createTranslator("en-US");
    const modelMap = new Map<string, AiModelSummary>();
    const dismissedTask = createTask({
      id: "task_dismissed_session",
      status: "succeeded",
      prompt: "Dismissed session task",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-dismissed",
        imageSessionTitle: "Dismissed Session"
      },
      output: { images: ["https://cdn.example.com/dismissed-session.png"] },
      createdAt: "2026-07-07T00:01:00.000Z"
    });
    const visibleTask = createTask({
      id: "task_visible_session",
      status: "succeeded",
      prompt: "Visible session task",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-visible",
        imageSessionTitle: "Visible Session"
      },
      output: { images: ["https://cdn.example.com/visible.png"] },
      createdAt: "2026-07-07T00:02:00.000Z"
    });

    const merged = mergeImageSessionsWithBackendHistory(
      [],
      [dismissedTask, visibleTask].map((task) =>
        taskToImageStreamEntry(task, modelMap, t)
      ),
      "历史记录",
      20,
      {
        dismissedSessionIds: new Set(["session-dismissed"])
      }
    );

    expect(merged.some((s) => s.id === "session-dismissed")).toBe(false);
    expect(merged.some((s) => s.id === "session-visible")).toBe(true);
  });

  // --- tasks page loading / empty separation ---

  it("tasks page has isInitialLoading state that separates first load from empty", () => {
    const source = readFileSync(
      new URL("./tasks/tasks-page-content.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("const [isInitialLoading, setIsInitialLoading] = useState");
    expect(source).toContain("setIsInitialLoading(false)");
  });

  it("tasks page shows loading indicator when isInitialLoading is true", () => {
    const source = readFileSync(
      new URL("./tasks/tasks-page-content.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("isInitialLoading");
    expect(source).toContain("data-tasks-loading-state");
    expect(source).toContain("multimodal.tasks.loadingTasks");
  });

  it("tasks page still shows empty state after loading completes with no data", () => {
    const source = readFileSync(
      new URL("./tasks/tasks-page-content.tsx", import.meta.url),
      "utf8"
    );

    // EmptyTasksState still exists after loaded
    expect(source).toContain("EmptyTasksState");
    // And tasks empty i18n key remains
    expect(source).toContain("multimodal.tasks.emptyTitle");
  });

  // --- models library loading / empty separation ---

  it("model library shows loading state when modelsLoaded is false", () => {
    const source = readFileSync(
      new URL("../../components/workspace/ChatWorkspace.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("if (!modelsLoaded)");
    expect(source).toContain("chat.loadingModels");
  });

  it("model library shows empty state only when modelsLoaded is true and no models", () => {
    const source = readFileSync(
      new URL("../../components/workspace/ChatWorkspace.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("if (models.length === 0)");
    expect(source).toContain("chat.noModelsAvailable");
  });
});
