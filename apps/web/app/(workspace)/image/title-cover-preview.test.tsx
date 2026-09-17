// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTitleCoverCompositionKey,
  TitleCoverPreview,
  type TitleCoverPreviewLabels
} from "./title-cover-preview";
import { createTitleCoverTypographyDraft } from "./title-cover-composition";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const fetchImageAssetBlobMock = vi.hoisted(() => vi.fn());
const fetchPrivateAssetBlobMock = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/private-asset-content", () => ({
  fetchImageAssetBlob: fetchImageAssetBlobMock,
  fetchPrivateAssetBlob: fetchPrivateAssetBlobMock,
  isPrivateAssetContentUrl: (url: unknown) =>
    typeof url === "string" && url.startsWith("/assets/"),
  isAbortError: (error: unknown) =>
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}));

const labels: TitleCoverPreviewLabels = {
  preview: "Cover preview",
  previewDescription: "Live cover",
  historicalVisualBase: "Historical visual base",
  noCopy: "Copy is not stored",
  loading: "Loading",
  rendering: "Rendering",
  loadFailed: "Load failed",
  renderFailed: "Render failed",
  overflow: "Copy is too long. Shorten it before downloading.",
  download: "Download cover",
  exporting: "Exporting",
  exportFailed: "Export failed"
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function createCanvasContext() {
  const drawImage = vi.fn();
  const fillStyleHistory: string[] = [];
  const fillText = vi.fn(function (
    this: CanvasRenderingContext2D,
    _text: string,
    _x: number,
    _y: number
  ) {
    fillStyleHistory.push(String(this.fillStyle));
  });
  const context = {
    font: "",
    fillStyle: "",
    textAlign: "left",
    textBaseline: "top",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    measureText: (value: string) => ({ width: Array.from(value).length * 8 } as TextMetrics),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    clearRect: vi.fn(),
    drawImage,
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText
  } as unknown as CanvasRenderingContext2D;
  return { context, drawImage, fillText, fillStyleHistory };
}

function installBrowserMocks({
  deferToBlob = false,
  toBlobResults = [],
  sourceWidth = 1536,
  sourceHeight = 1024
}: {
  deferToBlob?: boolean;
  toBlobResults?: Array<Blob | null>;
  sourceWidth?: number;
  sourceHeight?: number;
} = {}) {
  const canvas = createCanvasContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => canvas.context
  );
  let resolveToBlob: (() => void) | null = null;
  let toBlobCallCount = 0;
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback, type) => {
      if (toBlobCallCount < toBlobResults.length) {
        callback(toBlobResults[toBlobCallCount] ?? null);
        toBlobCallCount += 1;
        return;
      }
      if (deferToBlob) {
        resolveToBlob = () =>
          callback(new Blob(["png"], { type: type ?? "image/png" }));
        return;
      }
      callback(new Blob(["png"], { type: type ?? "image/png" }));
    });

  let objectUrlIndex = 0;
  const createObjectURL = vi.fn(() => `blob:title-cover-${++objectUrlIndex}`);
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

  class MockImage {
    naturalWidth = sourceWidth;
    naturalHeight = sourceHeight;
    width = sourceWidth;
    height = sourceHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    sourceUrl = "";

    set src(value: string) {
      this.sourceUrl = value;
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", MockImage);

  const anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  return {
    canvas,
    createObjectURL,
    revokeObjectURL,
    anchorClick,
    resolveToBlob: () => resolveToBlob?.(),
    toBlob
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

let originalDocumentFontsDescriptor: PropertyDescriptor | undefined;

function setDocumentFontsReady(ready: Promise<unknown>) {
  if (originalDocumentFontsDescriptor === undefined) {
    originalDocumentFontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
  }
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready }
  });
}

function restoreDocumentFonts() {
  if (originalDocumentFontsDescriptor) {
    Object.defineProperty(document, "fonts", originalDocumentFontsDescriptor);
  } else {
    Reflect.deleteProperty(document, "fonts");
  }
  originalDocumentFontsDescriptor = undefined;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderPreview(overrides: Partial<React.ComponentProps<typeof TitleCoverPreview>> = {}) {
  host = host ?? document.createElement("div");
  root = createRoot(host);
  act(() => {
    root?.render(
      <TitleCoverPreview
        sourceUrl="/assets/visual-a/content"
        sourceIdentity="visual-a"
        token="token"
        mainCopy="精确主文案 AI 2026"
        secondaryCopy="副文案"
        originalTitle="原始标题"
        targetSize="1280x720"
        labels={labels}
        {...overrides}
      />
    );
  });
}

function rerenderPreview(
  overrides: Partial<React.ComponentProps<typeof TitleCoverPreview>> = {}
) {
  act(() => {
    root?.render(
      <TitleCoverPreview
        sourceUrl="/assets/visual-a/content"
        sourceIdentity="visual-a"
        token="token"
        mainCopy="精确主文案 AI 2026"
        secondaryCopy="副文案"
        originalTitle="原始标题"
        targetSize="1280x720"
        labels={labels}
        {...overrides}
      />
    );
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreDocumentFonts();
});

describe("TitleCoverPreview", () => {
  it("includes every typography value in the composition key", () => {
    const clean = createTitleCoverTypographyDraft("clean-light");
    const bold = createTitleCoverTypographyDraft("bold-yellow");

    expect(
      createTitleCoverCompositionKey("source", "main", "secondary", clean)
    ).not.toBe(
      createTitleCoverCompositionKey("source", "main", "secondary", bold)
    );
    expect(
      createTitleCoverCompositionKey("source", "main", "secondary", {
        ...clean,
        mainColor: "#ff0000"
      })
    ).not.toBe(
      createTitleCoverCompositionKey("source", "main", "secondary", clean)
    );
    expect(
      createTitleCoverCompositionKey("source", "main", "secondary", clean, "1280x720")
    ).not.toBe(
      createTitleCoverCompositionKey("source", "main", "secondary", clean, "1024x768")
    );
  });

  it("loads a private visual base, renders at the selected target dimensions, and enables local PNG export", async () => {
    const browser = installBrowserMocks();
    fetchImageAssetBlobMock.mockResolvedValue(
      new Blob(["visual"], { type: "image/png" })
    );
    renderPreview();
    await settle();

    const canvas = host?.querySelector<HTMLCanvasElement>("[data-image-title-cover-canvas=true]");
    const download = host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]");
    expect(fetchImageAssetBlobMock).toHaveBeenCalledWith(
      expect.objectContaining({ logicalUrl: "/assets/visual-a/content", token: "token" })
    );
    expect(fetchPrivateAssetBlobMock).not.toHaveBeenCalled();
    expect(canvas?.width).toBe(1280);
    expect(canvas?.height).toBe(720);
    const drawImageCall = browser.canvas.drawImage.mock.calls[0];
    expect(drawImageCall?.[1]).toBe(0);
    expect(drawImageCall?.[2]).toBe(0);
    expect(drawImageCall?.[3]).toBe(1536);
    expect(drawImageCall?.[4]).toBe(1024);
    expect(drawImageCall?.[5]).toBeCloseTo(0);
    expect(drawImageCall?.[6]).toBeCloseTo(-66.66666666666667);
    expect(drawImageCall?.[7]).toBeCloseTo(1280);
    expect(drawImageCall?.[8]).toBeCloseTo(853.3333333333334);
    expect(browser.canvas.fillText.mock.calls[0]?.[1]).toBeCloseTo(96);
    expect(browser.canvas.fillText.mock.calls[0]?.[2]).toBeCloseTo(194.4);
    expect(download?.disabled).toBe(false);
    expect(host?.querySelector('[data-image-title-cover-composition-state="ready"]')).toBeTruthy();

    await act(async () => download?.click());
    expect(browser.anchorClick).toHaveBeenCalledTimes(1);
    expect(browser.createObjectURL).toHaveBeenCalledTimes(2);
    expect(browser.revokeObjectURL).toHaveBeenCalled();
    expect(download?.disabled).toBe(false);
    expect(canvas?.toBlob).toBeDefined();
  });

  it("rerenders locally when the typography preset changes", async () => {
    const browser = installBrowserMocks();
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    const fillTextCallsBefore = browser.canvas.fillText.mock.calls.length;
    rerenderPreview({ typography: createTitleCoverTypographyDraft("bold-yellow") });
    await settle();

    expect(fetchImageAssetBlobMock).toHaveBeenCalledTimes(1);
    expect(browser.canvas.fillText.mock.calls.length).toBeGreaterThan(fillTextCallsBefore);
    expect(browser.canvas.fillStyleHistory).toContain("#facc15");
  });

  it("rerenders locally for both custom color overrides", async () => {
    const browser = installBrowserMocks();
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    const beforeMainColor = browser.canvas.fillText.mock.calls.length;
    rerenderPreview({
      typography: {
        ...createTitleCoverTypographyDraft(),
        mainColor: "#ff0000"
      }
    });
    await settle();
    expect(browser.canvas.fillText.mock.calls.length).toBeGreaterThan(beforeMainColor);
    expect(browser.canvas.fillStyleHistory).toContain("#ff0000");

    const beforeSecondaryColor = browser.canvas.fillText.mock.calls.length;
    rerenderPreview({
      typography: {
        ...createTitleCoverTypographyDraft(),
        secondaryColor: "#00ff00"
      }
    });
    await settle();
    expect(browser.canvas.fillText.mock.calls.length).toBeGreaterThan(beforeSecondaryColor);
    expect(browser.canvas.fillStyleHistory).toContain("rgba(0, 255, 0, 0.86)");
  });

  it("exports the latest typography state after a local style change", async () => {
    const browser = installBrowserMocks();
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    rerenderPreview({
      typography: {
        ...createTitleCoverTypographyDraft(),
        mainColor: "#ff0000"
      }
    });
    await settle();
    expect(browser.canvas.fillStyleHistory).toContain("#ff0000");

    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.click();
    });
    await settle();

    expect(browser.toBlob).toHaveBeenCalledTimes(1);
    expect(browser.anchorClick).toHaveBeenCalledTimes(1);
  });

  it("fences an in-flight export when typography changes", async () => {
    const browser = installBrowserMocks({ deferToBlob: true });
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.click();
    });
    expect(browser.toBlob).toHaveBeenCalledTimes(1);

    rerenderPreview({ typography: createTitleCoverTypographyDraft("cyan-tech") });
    await settle();
    await act(async () => {
      browser.resolveToBlob();
      await Promise.resolve();
    });
    await settle();

    expect(browser.anchorClick).not.toHaveBeenCalled();
  });

  it("keeps Download enabled when a current rendered composition export fails", async () => {
    installBrowserMocks({ toBlobResults: [null] });
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    const download = host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]");
    await act(async () => download?.click());
    await settle();

    expect(host?.querySelector('[data-image-title-cover-composition-error=true]')?.textContent).toContain(labels.exportFailed);
    expect(download?.disabled).toBe(false);
  });

  it("retries an export failure without rerendering the current composition", async () => {
    const browser = installBrowserMocks({ toBlobResults: [null] });
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    const download = host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]");
    await act(async () => download?.click());
    await settle();
    expect(download?.disabled).toBe(false);
    expect(host?.querySelector('[data-image-title-cover-composition-error=true]')).toBeTruthy();

    await act(async () => download?.click());
    await settle();

    expect(browser.anchorClick).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[data-image-title-cover-composition-state="ready"]')).toBeTruthy();
    expect(host?.querySelector('[data-image-title-cover-composition-error=true]')).toBeNull();
    expect(download?.disabled).toBe(false);
  });

  it("invalidates an export-failed composition immediately when the copy changes", async () => {
    installBrowserMocks({ toBlobResults: [null] });
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    const download = host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]");
    await act(async () => download?.click());
    await settle();
    expect(download?.disabled).toBe(false);

    const pendingFonts = deferred<void>();
    setDocumentFontsReady(pendingFonts.promise);
    rerenderPreview({ mainCopy: "精确主文案 B" });
    expect(download?.disabled).toBe(true);

    pendingFonts.resolve();
    await settle();
    expect(download?.disabled).toBe(false);
  });

  it("invalidates an export-failed composition immediately when the visual base changes", async () => {
    installBrowserMocks({ toBlobResults: [null] });
    const pendingB = deferred<Blob>();
    fetchImageAssetBlobMock.mockImplementation(({ logicalUrl }: { logicalUrl: string }) =>
      logicalUrl.includes("visual-a")
        ? Promise.resolve(new Blob(["A"], { type: "image/png" }))
        : pendingB.promise
    );
    renderPreview();
    await settle();

    const download = host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]");
    await act(async () => download?.click());
    await settle();
    expect(download?.disabled).toBe(false);

    rerenderPreview({
      sourceUrl: "/assets/visual-b/content",
      sourceIdentity: "visual-b"
    });
    await settle();
    expect(download?.disabled).toBe(true);

    pendingB.resolve(new Blob(["B"], { type: "image/png" }));
    await settle();
    expect(download?.disabled).toBe(false);
    expect(host?.querySelector('[data-image-title-cover-composition-state="ready"]')).toBeTruthy();
  });

  it("keeps an oversized exact copy in overflow and disables Download", async () => {
    installBrowserMocks();
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview({ mainCopy: "超长文案".repeat(1000) });
    await settle();

    expect(host?.querySelector('[data-image-title-cover-overflow=true]')).toBeTruthy();
    expect(host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.disabled).toBe(true);
    expect(host?.textContent).toContain(labels.overflow);
  });

  it("disables Download immediately while a newly selected visual base is unresolved", async () => {
    installBrowserMocks();
    const pendingB = deferred<Blob>();
    fetchImageAssetBlobMock.mockImplementation(({ logicalUrl }: { logicalUrl: string }) =>
      logicalUrl.includes("visual-a")
        ? Promise.resolve(new Blob(["A"], { type: "image/png" }))
        : pendingB.promise
    );
    renderPreview();
    await settle();

    const download = () =>
      host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]");
    expect(download()?.disabled).toBe(false);

    rerenderPreview({
      sourceUrl: "/assets/visual-b/content",
      sourceIdentity: "visual-b"
    });
    await settle();
    expect(download()?.disabled).toBe(true);
    expect(host?.querySelector('[data-image-title-cover-composition-state="loading"]')).toBeTruthy();

    pendingB.resolve(new Blob(["B"], { type: "image/png" }));
    await settle();
    expect(download()?.disabled).toBe(false);
    expect(host?.querySelector('[data-image-title-cover-composition-state="ready"]')).toBeTruthy();
  });

  it("disables Download immediately while a changed copy is waiting for its render", async () => {
    installBrowserMocks();
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();
    expect(host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.disabled).toBe(false);

    const pendingFonts = deferred<void>();
    setDocumentFontsReady(pendingFonts.promise);
    rerenderPreview({ mainCopy: "精确主文案 B" });
    expect(host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.disabled).toBe(true);
    expect(host?.querySelector('[data-image-title-cover-composition-state="rendering"]')).toBeTruthy();

    pendingFonts.resolve();
    await settle();
    expect(host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.disabled).toBe(false);
    expect(host?.querySelector('[data-image-title-cover-composition-state="ready"]')).toBeTruthy();
  });

  it("does not fake a final cover for a history entry without structured main copy", async () => {
    installBrowserMocks();
    fetchPrivateAssetBlobMock.mockResolvedValue(
      new Blob(["visual"], { type: "image/png" })
    );
    renderPreview({ mainCopy: "", secondaryCopy: "" });
    await settle();

    expect(fetchImageAssetBlobMock).not.toHaveBeenCalled();
    expect(fetchPrivateAssetBlobMock).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[data-image-title-cover-historical-visual-base=true]')).toBeTruthy();
    expect(host?.querySelector('[data-image-title-cover-download=true]')).toBeNull();
  });

  it("ignores a stale visual-base load after the selected result changes", async () => {
    const browser = installBrowserMocks();
    const pendingA: { resolve: (blob: Blob) => void } = {
      resolve: () => undefined
    };
    const pendingB: { resolve: (blob: Blob) => void } = {
      resolve: () => undefined
    };
    fetchImageAssetBlobMock.mockImplementation(({ logicalUrl }: { logicalUrl: string }) => {
      if (logicalUrl.includes("visual-a")) {
        return new Promise<Blob>((resolve) => {
          pendingA.resolve = resolve;
        });
      }
      return new Promise<Blob>((resolve) => {
        pendingB.resolve = resolve;
      });
    });
    renderPreview();
    await settle();
    await act(async () => {
      root?.render(
        <TitleCoverPreview
          sourceUrl="/assets/visual-b/content"
          sourceIdentity="visual-b"
          token="token"
          mainCopy="精确主文案 AI 2026"
          secondaryCopy="副文案"
          originalTitle="原始标题"
          targetSize="1280x720"
          labels={labels}
        />
      );
    });
    await settle();
    pendingA.resolve(new Blob(["A"], { type: "image/png" }));
    await settle();
    expect(host?.querySelector('[data-image-title-cover-composition-state="loading"]')).toBeTruthy();
    pendingB.resolve(new Blob(["B"], { type: "image/png" }));
    await settle();
    expect(host?.querySelector('[data-image-title-cover-composition-state="ready"]')).toBeTruthy();
    expect(browser.revokeObjectURL).toHaveBeenCalled();
  });

  it("ignores an old deferred export after the selected result changes", async () => {
    const browser = installBrowserMocks({ deferToBlob: true });
    const pendingB = deferred<Blob>();
    fetchImageAssetBlobMock.mockImplementation(({ logicalUrl }: { logicalUrl: string }) =>
      logicalUrl.includes("visual-a")
        ? Promise.resolve(new Blob(["A"], { type: "image/png" }))
        : pendingB.promise
    );
    renderPreview();
    await settle();

    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.click();
    });
    expect(browser.toBlob).toHaveBeenCalledTimes(1);

    rerenderPreview({
      sourceUrl: "/assets/visual-b/content",
      sourceIdentity: "visual-b"
    });
    await settle();
    await act(async () => {
      browser.resolveToBlob();
      await Promise.resolve();
    });
    await settle();

    expect(browser.anchorClick).not.toHaveBeenCalled();
    expect(host?.querySelector('[data-image-title-cover-composition-state="ready"]')).toBeNull();
    expect(host?.querySelector('[data-image-title-cover-composition-error=true]')).toBeNull();
    await act(async () => {
      pendingB.resolve(new Blob(["B"], { type: "image/png" }));
      await Promise.resolve();
    });
  });

  it("ignores a deferred export after the preview unmounts", async () => {
    const browser = installBrowserMocks({ deferToBlob: true });
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    await act(async () => {
      host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.click();
    });
    expect(browser.toBlob).toHaveBeenCalledTimes(1);

    await act(async () => root?.unmount());
    root = null;
    await act(async () => {
      browser.resolveToBlob();
      await Promise.resolve();
    });
    await settle();

    expect(browser.anchorClick).not.toHaveBeenCalled();
  });

  it("allows only one export when Download is clicked twice before toBlob resolves", async () => {
    const browser = installBrowserMocks({ deferToBlob: true });
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview();
    await settle();

    const download = host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]");
    await act(async () => {
      download?.click();
      download?.click();
    });
    expect(browser.toBlob).toHaveBeenCalledTimes(1);

    await act(async () => {
      browser.resolveToBlob();
      await Promise.resolve();
    });
    await settle();
    expect(browser.anchorClick).toHaveBeenCalledTimes(1);
  });

  it("starts the compositor fetch when history visual-only copy is re-entered", async () => {
    installBrowserMocks();
    fetchPrivateAssetBlobMock.mockResolvedValue(new Blob(["history"], { type: "image/png" }));
    fetchImageAssetBlobMock.mockResolvedValue(new Blob(["visual"], { type: "image/png" }));
    renderPreview({ mainCopy: "", secondaryCopy: "" });
    await settle();

    expect(fetchImageAssetBlobMock).not.toHaveBeenCalled();
    expect(fetchPrivateAssetBlobMock).toHaveBeenCalledTimes(1);

    rerenderPreview({ mainCopy: "重新填写的主文案", secondaryCopy: "" });
    await settle();

    expect(fetchImageAssetBlobMock).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[data-image-title-cover-composition-state="ready"]')).toBeTruthy();
    expect(host?.querySelector<HTMLButtonElement>("[data-image-title-cover-download=true]")?.disabled).toBe(false);
  });
});
