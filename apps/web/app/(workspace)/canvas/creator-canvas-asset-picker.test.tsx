// @vitest-environment jsdom

import type { AiAssetSummary } from "@ai-aggregate/shared";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../lib/site-config";
import {
  CreatorCanvasAssetPicker,
  filterCreatorCanvasImageAssets
} from "./creator-canvas-asset-picker";

const useResolvedAssetUrlMock = vi.hoisted(() =>
  vi.fn((options: { src?: string | null; enabled?: boolean }) => {
    const source = typeof options.src === "string" && options.src.trim().length > 0;
    const enabled = options.enabled !== false;
    return {
      resolvedUrl: source && enabled ? "blob:picker-preview" : null,
      loading: false,
      error: null,
      isPrivate: source
    };
  })
);

vi.mock("../../../hooks/use-resolved-asset-url", () => ({
  useResolvedAssetUrl: useResolvedAssetUrlMock
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const validImage: AiAssetSummary = {
  id: "image-valid",
  userId: "canvas-user",
  taskId: "task-valid",
  type: "image",
  url: "/assets/image-valid/content",
  thumbnailUrl: null,
  title: "Valid work",
  metadata: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  taskPrompt: null
};

const promptFallbackImage: AiAssetSummary = {
  ...validImage,
  id: "image-prompt",
  url: "/assets/image-prompt/content",
  title: null,
  taskPrompt: "A prompt fallback"
};

const videoAsset: AiAssetSummary = {
  ...validImage,
  id: "video-asset",
  type: "video",
  url: "/assets/video-asset/content",
  title: "Video work"
};

const unsafeImage: AiAssetSummary = {
  ...validImage,
  id: "unsafe-image",
  url: "https://provider.example/unsafe.png",
  title: "Unsafe work"
};

const malformedImage = {
  ...validImage,
  id: "malformed-image",
  createdAt: undefined
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

type TestIntersectionObserverInstance = {
  trigger: (isIntersecting: boolean) => void;
};

function installIntersectionObserverMock(): Array<TestIntersectionObserverInstance> {
  const instances: Array<TestIntersectionObserverInstance> = [];

  class TestIntersectionObserver {
    private target: Element | null = null;

    constructor(private readonly callback: IntersectionObserverCallback) {
      instances.push(this);
    }

    observe = vi.fn((target: Element) => {
      this.target = target;
    });

    disconnect = vi.fn();

    unobserve = vi.fn();

    takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

    trigger(isIntersecting: boolean) {
      if (!this.target) throw new Error("LAZY_PREVIEW_TARGET_MISSING");
      this.callback(
        [{ isIntersecting, target: this.target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      );
    }
  }

  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  return instances;
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let originalShowModal: PropertyDescriptor | undefined;
let originalClose: PropertyDescriptor | undefined;
let activeDialogMocks: ReturnType<typeof installDialogMocks> | null = null;

function installDialogMocks() {
  originalShowModal = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal"
  );
  originalClose = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close"
  );
  const showModal = vi.fn(function(this: HTMLDialogElement) {
    this.open = true;
  });
  const close = vi.fn(function(this: HTMLDialogElement) {
    this.open = false;
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: showModal
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: close
  });
  return { showModal, close };
}

function restoreDialogMocks() {
  if (originalShowModal) {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  } else {
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  }
  if (originalClose) {
    Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  } else {
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  }
}

async function mount(element: React.ReactNode): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
  await flushEffects();
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function pickerProps(
  overrides: Partial<React.ComponentProps<typeof CreatorCanvasAssetPicker>> = {}
): React.ComponentProps<typeof CreatorCanvasAssetPicker> {
  return {
    isOpen: true,
    targetNodeId: "image-target",
    token: "owner-token",
    onClose: vi.fn(),
    onSelectAsset: vi.fn(),
    ...overrides
  };
}

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof CreatorCanvasAssetPicker>> = {}
) {
  return (
    <I18nContext.Provider
      value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
    >
      <CreatorCanvasAssetPicker {...pickerProps(overrides)} />
    </I18nContext.Provider>
  );
}

function getDialog(): HTMLDialogElement {
  const dialog = host?.querySelector<HTMLDialogElement>(
    '[data-creator-canvas-asset-picker="true"]'
  );
  if (!dialog) throw new Error("ASSET_PICKER_DIALOG_MISSING");
  return dialog;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  restoreDialogMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

beforeEach(() => {
  activeDialogMocks = installDialogMocks();
  useResolvedAssetUrlMock.mockClear();
});

describe("filterCreatorCanvasImageAssets", () => {
  it("keeps only well-formed private Image assets", () => {
    expect(filterCreatorCanvasImageAssets({
      assets: [validImage, videoAsset, unsafeImage, malformedImage, null, { type: "image" }]
    })).toEqual([validImage]);
  });

  it("excludes the current Image Asset for replacement", () => {
    expect(filterCreatorCanvasImageAssets({
      assets: [validImage, promptFallbackImage]
    }, validImage.id)).toEqual([promptFallbackImage]);
  });
});

describe("CreatorCanvasAssetPicker", () => {
  it("stays closed without requesting assets", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker({ isOpen: false }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDialog().open).toBe(false);
  });

  it("does not request assets without an authenticated token", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker({ token: null }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDialog().open).toBe(true);
    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="unauthenticated"]'))
      .toBeTruthy();
    expect(host?.textContent).toContain("Login required");
  });

  it("performs the exact authenticated bounded Image GET and shows loading", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      apiUrl("/assets?type=image&limit=50"),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer owner-token" },
        signal: expect.any(AbortSignal)
      })
    );
    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="loading"]'))
      .toBeTruthy();

    await act(async () => pending.resolve(jsonResponse({ assets: [] })));
    await flushEffects();
  });

  it("uses the lazy preview seam and activates a pending card after intersection", async () => {
    const observers = installIntersectionObserverMock();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      assets: [validImage, promptFallbackImage]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await mount(renderPicker());
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="ready"]'))
      .toBeTruthy();
    expect(host?.querySelectorAll('[data-lazy-resolved-asset-image="pending"]'))
      .toHaveLength(2);
    expect(host?.querySelectorAll('[data-creator-canvas-asset-preview-loading="true"]'))
      .toHaveLength(2);
    expect(useResolvedAssetUrlMock).not.toHaveBeenCalled();
    expect(host?.querySelector('[data-lazy-resolved-asset-image="pending"]')?.className)
      .toContain("size-full");
    expect(host?.querySelector('[data-lazy-resolved-asset-image="pending"]')?.parentElement?.className)
      .toContain("aspect-[4/3]");

    const firstObserver = observers[0];
    if (!firstObserver) throw new Error("LAZY_PREVIEW_OBSERVER_MISSING");
    await act(async () => firstObserver.trigger(true));
    await flushEffects();

    expect(host?.querySelectorAll('[data-lazy-resolved-asset-image="pending"]'))
      .toHaveLength(1);
    expect(host?.querySelector('[data-lazy-resolved-asset-image="active"] img'))
      .toBeTruthy();
    expect(useResolvedAssetUrlMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("filters video, unsafe URLs, and malformed items while showing private Images", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      assets: [validImage, promptFallbackImage, videoAsset, unsafeImage, malformedImage]
    }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker());
    await flushEffects();

    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="ready"]'))
      .toBeTruthy();
    expect(host?.querySelectorAll('[data-creator-canvas-asset-item="true"]')).toHaveLength(2);
    expect(host?.textContent).toContain("Valid work");
    expect(host?.textContent).toContain("A prompt fallback");
    expect(host?.textContent).not.toContain("Video work");
    expect(host?.textContent).not.toContain("Unsafe work");
    expect(host?.querySelectorAll('[data-lazy-resolved-asset-image="active"]'))
      .toHaveLength(2);
    expect(host?.querySelectorAll("img")).toHaveLength(2);
    expect(host?.innerHTML).not.toContain("image-valid/content");
  });

  it("shows an explicit empty state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ assets: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker());
    await flushEffects();

    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="empty"]'))
      .toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-asset-picker-empty="true"]')?.textContent)
      .toContain("No image works yet");
  });

  it("shows remaining Image Assets and excludes the current Asset", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      assets: [validImage, promptFallbackImage]
    }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker({ excludedAssetId: validImage.id }));
    await flushEffects();

    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="ready"]'))
      .toBeTruthy();
    expect(host?.querySelectorAll('[data-creator-canvas-asset-item="true"]')).toHaveLength(1);
    expect(host?.textContent).not.toContain("Valid work");
    expect(host?.textContent).toContain("A prompt fallback");
  });

  it("shows a truthful no-other-work state when exclusion removes the only Image", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      assets: [validImage]
    }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker({ excludedAssetId: validImage.id }));
    await flushEffects();

    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="empty"]'))
      .toBeTruthy();
    expect(host?.querySelector('[data-creator-canvas-asset-picker-empty="true"]')?.textContent)
      .toContain("No other image works available");
    expect(host?.textContent).not.toContain("No image works yet");
  });

  it("shows an error and retries only after explicit action", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ assets: [validImage] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker());
    await flushEffects();

    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="error"]'))
      .toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const retry = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-retry="true"]'
    );
    if (!retry) throw new Error("ASSET_PICKER_RETRY_MISSING");
    await act(async () => retry.click());
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="ready"]'))
      .toBeTruthy();
  });

  it("aborts and ignores a stale request when the picker closes", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker());
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => root?.render(renderPicker({ isOpen: false })));
    await flushEffects();
    expect(signal?.aborted).toBe(true);

    await act(async () => pending.resolve(jsonResponse({ assets: [validImage] })));
    await flushEffects();
    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="ready"]'))
      .toBeNull();
    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="idle"]'))
      .toBeTruthy();
  });

  it("ignores the previous target request when the target changes", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker({ targetNodeId: "image-first" }));
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;

    await act(async () => root?.render(renderPicker({ targetNodeId: "image-second" })));
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => first.resolve(jsonResponse({ assets: [validImage] })));
    await flushEffects();
    expect(host?.querySelector('[data-creator-canvas-asset-picker-state="ready"]'))
      .toBeNull();
    await act(async () => second.resolve(jsonResponse({ assets: [promptFallbackImage] })));
    await flushEffects();
    expect(host?.textContent).toContain("A prompt fallback");
    expect(host?.textContent).not.toContain("Valid work");
  });

  it("calls the explicit select callback with the owner Asset id", async () => {
    const onSelectAsset = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      assets: [validImage]
    }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(renderPicker({ onSelectAsset }));
    await flushEffects();

    const select = host?.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-select="true"]'
    );
    if (!select) throw new Error("ASSET_PICKER_SELECT_MISSING");
    await act(async () => select.click());
    expect(onSelectAsset).toHaveBeenCalledTimes(1);
    expect(onSelectAsset).toHaveBeenCalledWith("image-valid");
  });
});

describe("CreatorCanvasAssetPicker native dialog lifecycle", () => {
  function Harness() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <button type="button" data-asset-picker-opener="true" onClick={() => setIsOpen(true)}>
          Open picker
        </button>
        <I18nContext.Provider
          value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
        >
          <CreatorCanvasAssetPicker
            isOpen={isOpen}
            targetNodeId="image-target"
            token="owner-token"
            onClose={() => setIsOpen(false)}
            onSelectAsset={vi.fn()}
          />
        </I18nContext.Provider>
      </>
    );
  }

  async function openFromExactOpener(): Promise<{
    dialog: HTMLDialogElement;
    opener: HTMLButtonElement;
  }> {
    const opener = host?.querySelector<HTMLButtonElement>(
      '[data-asset-picker-opener="true"]'
    );
    if (!opener) throw new Error("ASSET_PICKER_OPENER_MISSING");
    opener.focus();
    await act(async () => opener.click());
    await flushEffects();
    return { dialog: getDialog(), opener };
  }

  it("uses showModal, focuses inside, handles Escape, and returns focus exactly", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ assets: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <Harness />
      </I18nContext.Provider>
    );
    const { dialog, opener } = await openFromExactOpener();

    expect(activeDialogMocks?.showModal).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      "creator-canvas-asset-picker-title"
    );
    expect(dialog.contains(document.activeElement)).toBe(true);

    await act(async () => {
      dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    });
    await flushEffects();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("closes from backdrop and close button, returning focus to the same opener", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ assets: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <Harness />
      </I18nContext.Provider>
    );

    const firstOpen = await openFromExactOpener();
    await act(async () => {
      firstOpen.dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushEffects();
    expect(firstOpen.dialog.open).toBe(false);
    expect(document.activeElement).toBe(firstOpen.opener);

    const secondOpen = await openFromExactOpener();
    const close = secondOpen.dialog.querySelector<HTMLButtonElement>(
      '[data-creator-canvas-asset-picker-close="true"]'
    );
    if (!close) throw new Error("ASSET_PICKER_CLOSE_MISSING");
    await act(async () => close.click());
    await flushEffects();
    expect(secondOpen.dialog.open).toBe(false);
    expect(document.activeElement).toBe(secondOpen.opener);
  });
});
