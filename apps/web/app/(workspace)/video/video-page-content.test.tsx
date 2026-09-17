// @vitest-environment jsdom

import type {
  AiAssetSummary,
  AiTaskSummary,
  PublicVideoModelSummary
} from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import { VideoPageContent } from "./video-page-content";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const videoShell = vi.hoisted(() => ({ token: "video-ui-token" }));

vi.mock("../../../components/workspace/workspace-shell-context", () => ({
  useOptionalWorkspaceShellContext: () => ({ shell: videoShell })
}));

const videoModel: PublicVideoModelSummary = {
  id: "model-video-ui",
  name: "Seedance",
  displayName: "Seedance",
  slug: "seedance",
  capability: "video",
  displaySurfaces: ["video"],
  group: "video",
  tags: ["video"],
  enabled: true,
  creditCost: 3,
  allowGuest: false,
  sortOrder: 0,
  isRecommended: true,
  videoProfile: {
    id: "seedance",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 5,
    resolution: "720p",
    aspectRatio: "16:9"
  }
};

const videoTask: AiTaskSummary = {
  id: "task-video-ui",
  userId: "user-video-ui",
  type: "video",
  status: "succeeded",
  modelId: videoModel.slug,
  prompt: "A calm ocean",
  input: { mode: "text-to-video", videoProgress: 100 },
  output: { videos: ["/assets/asset-video-ui/content"] },
  costCredits: 3,
  errorMessage: null,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:02.000Z",
  completedAt: "2026-08-14T00:00:02.000Z"
};

const videoAsset: AiAssetSummary = {
  id: "asset-video-ui",
  userId: "user-video-ui",
  taskId: videoTask.id,
  type: "video",
  url: "/assets/asset-video-ui/content",
  thumbnailUrl: null,
  title: "A calm ocean",
  metadata: { mimeType: "video/mp4" },
  createdAt: "2026-08-14T00:00:02.000Z",
  taskPrompt: videoTask.prompt
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(fetchMock: typeof fetch): Promise<void> {
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <VideoPageContent />
      </I18nContext.Provider>
    );
  });
  await settle();
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl
    });
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl
    });
  }
  originalCreateObjectUrl = undefined;
  originalRevokeObjectUrl = undefined;
});

describe("video Quick Creation UI", () => {
  it("keeps Quick Creation intact, uses the shared mobile switcher, and removes the inline Canvas CTA", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/models") return jsonResponse({ models: [videoModel] });
      if (url.pathname === "/api/tasks" && init?.method !== "POST") {
        return jsonResponse({ tasks: [] });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });

    await mount(fetchMock);

    expect(host?.textContent).toContain("Generate video");
    expect(host?.querySelector('[data-video-workspace-mode="quick"]')).toBeNull();
    expect(host?.querySelector('[data-video-workspace-mode="workflow"]')).toBeNull();
    expect(host?.querySelector('[data-video-professional-workspace-link="true"]')).toBeNull();
    expect(host?.querySelector('[data-video-mobile-creation-header="true"]')).toBeTruthy();
    expect(host?.querySelector('[data-creation-surface-active="video"]')).toBeTruthy();
    expect(host?.querySelector('a[href="/image"]')).toBeTruthy();
    expect(host?.querySelector('a[href="/video"]')?.getAttribute("aria-current"))
      .toBe("page");
    expect(host?.querySelector('a[href="/canvas"]')).toBeTruthy();
    expect(host?.querySelector("h1")?.closest("header")?.className).toContain("hidden md:flex");
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      new URL(String(input), "http://localhost").pathname === "/api/video/generate" &&
      init?.method === "POST"
    )).toHaveLength(0);
  });

  it("shows a truthful empty state when no usable video model is returned", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/models") return jsonResponse({ models: [] });
      if (url.pathname === "/api/tasks") return jsonResponse({ tasks: [] });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });

    await mount(fetchMock);

    expect(host?.textContent).toContain("No video model is available");
    expect(host?.querySelector('input[type="file"]')).toBeNull();
    expect(host?.querySelector('textarea')).toBeNull();
  });

  it("switches to image-to-video and requires one reference image", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/models") return jsonResponse({ models: [videoModel] });
      if (url.pathname === "/api/tasks") return jsonResponse({ tasks: [] });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });

    await mount(fetchMock);
    const modeButtons = Array.from(
      host?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ?? []
    );
    const imageToVideo = modeButtons.find((button) => button.textContent?.includes("Image to video"));
    expect(imageToVideo).toBeTruthy();

    await act(async () => imageToVideo?.click());
    expect(host?.querySelector('input[type="file"]')).toBeTruthy();
    expect(host?.textContent).toContain("Reference image");

    const prompt = host?.querySelector("textarea");
    if (!prompt) throw new Error("VIDEO_UI_PROMPT_MISSING");
    await act(async () => setValue(prompt, "Animate one reference"));
    const generate = Array.from(host?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.includes("Generate video"));
    if (!generate) throw new Error("VIDEO_UI_GENERATE_MISSING");
    await act(async () => generate.click());

    expect(host?.textContent).toContain("Upload one reference image before generating.");
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      new URL(String(input), "http://localhost").pathname === "/api/video/generate" &&
      init?.method === "POST"
    )).toHaveLength(0);
  });

  it("submits exactly once, polls the task, previews MP4, and downloads privately", async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    const postResponse = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/models") return jsonResponse({ models: [videoModel] });
      if (url.pathname === "/api/tasks" && init?.method !== "POST") {
        return jsonResponse({ tasks: [] });
      }
      if (url.pathname === "/api/video/generate") return postResponse;
      if (url.pathname === "/api/tasks/task-video-ui") {
        return jsonResponse({ task: videoTask, assets: [videoAsset] });
      }
      if (url.pathname === "/api/assets/asset-video-ui/content") {
        return new Response("video-bytes", {
          status: 200,
          headers: { "content-type": "video/mp4" }
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });

    originalCreateObjectUrl = URL.createObjectURL;
    originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn(() => "blob:video-ui");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl
    });

    await mount(fetchMock);
    const prompt = host?.querySelector("textarea");
    if (!prompt) throw new Error("VIDEO_UI_PROMPT_MISSING");
    await act(async () => setValue(prompt, "A calm ocean"));

    const generate = Array.from(host?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.includes("Generate video"));
    if (!generate) throw new Error("VIDEO_UI_GENERATE_MISSING");
    await act(async () => {
      generate.click();
      await Promise.resolve();
      generate.click();
    });

    const postCalls = fetchMock.mock.calls.filter(([input, init]) =>
      new URL(String(input), "http://localhost").pathname === "/api/video/generate" &&
      init?.method === "POST"
    );
    expect(postCalls).toHaveLength(1);
    const postInit = postCalls[0]?.[1];
    const requestBody = JSON.parse(String(postInit?.body)) as Record<string, unknown>;
    expect(requestBody).toEqual({
      modelId: "seedance",
      mode: "text-to-video",
      prompt: "A calm ocean"
    });
    expect(postInit?.headers).toMatchObject({
      Authorization: "Bearer video-ui-token",
      "Idempotency-Key": expect.any(String)
    });
    expect(requestBody).not.toHaveProperty("duration");
    expect(requestBody).not.toHaveProperty("resolution");

    resolvePost?.(jsonResponse({ status: "in_progress", taskId: videoTask.id }, 202));
    await settle();
    await settle();

    expect(fetchMock.mock.calls.some(([input]) =>
      new URL(String(input), "http://localhost").pathname === `/api/tasks/${videoTask.id}`
    )).toBe(true);
    const video = host?.querySelector<HTMLVideoElement>("video");
    expect(video).toBeTruthy();
    expect(video?.controls).toBe(true);
    expect(video?.src).toContain("blob:video-ui");
    expect(host?.querySelector("a[href=\"/assets/asset-video-ui\"]")).toBeTruthy();
    expect(host?.textContent).toContain("Video ready");

    const download = Array.from(host?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.includes("Download"));
    if (!download) throw new Error("VIDEO_UI_DOWNLOAD_MISSING");
    await act(async () => download.click());
    expect(fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), "http://localhost").pathname === "/api/assets/asset-video-ui/content"
    ).length).toBeGreaterThanOrEqual(2);
  });
});
