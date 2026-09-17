// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import {
  calculateImagePreviewFitScale,
  clampImagePreviewScale
} from "./ImagePreviewDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let opener: HTMLButtonElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  opener?.remove();
  host = null;
  root = null;
  opener = null;
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

async function renderPreview(src: string | null, onClose = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root?.render(
      <ImagePreviewDialog
        src={src}
        alt="Preview image"
        closeLabel="Close preview"
        onClose={onClose}
      />
    );
    await Promise.resolve();
  });

  return onClose;
}

async function loadPreviewImage(options?: {
  naturalWidth?: number;
  naturalHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}) {
  const image = host?.querySelector<HTMLImageElement>(
    "[data-image-preview-image=true]"
  );
  const viewport = host?.querySelector<HTMLElement>(
    "[data-image-preview-viewport=true]"
  );
  expect(image).toBeTruthy();
  expect(viewport).toBeTruthy();

  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    value: options?.naturalWidth ?? 1200
  });
  Object.defineProperty(image, "naturalHeight", {
    configurable: true,
    value: options?.naturalHeight ?? 800
  });
  Object.defineProperty(viewport, "clientWidth", {
    configurable: true,
    value: options?.viewportWidth ?? 800
  });
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: options?.viewportHeight ?? 500
  });

  await act(async () => {
    image?.dispatchEvent(new Event("load"));
    await Promise.resolve();
  });

  return { image, viewport };
}

function dispatchPointer(
  target: HTMLElement,
  type: string,
  values: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
  }
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.entries(values).forEach(([key, value]) => {
    Object.defineProperty(event, key, { configurable: true, value });
  });
  target.dispatchEvent(event);
}

function dispatchTab(shiftKey = false) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      shiftKey
    })
  );
}

describe("ImagePreviewDialog", () => {
  it("calculates a bounded fit scale", () => {
    expect(calculateImagePreviewFitScale(1600, 900, 800, 600)).toBe(0.5);
    expect(calculateImagePreviewFitScale(400, 300, 800, 600)).toBe(1);
    expect(clampImagePreviewScale(0.1, 0.5)).toBe(0.5);
    expect(clampImagePreviewScale(8, 0.5)).toBe(4);
  });

  it("cycles only through enabled controls and refreshes the list after zoom changes", async () => {
    await renderPreview("https://cdn.example.com/large.png");
    await loadPreviewImage();

    const dialog = host?.querySelector<HTMLElement>("[data-image-preview-dialog=true]");
    const zoomIn = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-zoom-in=true]"
    );
    const fit = host?.querySelector<HTMLButtonElement>("[data-image-preview-fit=true]");
    const close = host?.querySelector<HTMLButtonElement>("[data-image-preview-close=true]");

    dialog?.focus();
    dispatchTab();
    expect(document.activeElement).toBe(zoomIn);
    dispatchTab();
    expect(document.activeElement).toBe(close);
    dispatchTab();
    expect(document.activeElement).toBe(zoomIn);
    dispatchTab(true);
    expect(document.activeElement).toBe(close);

    await act(async () => {
      zoomIn?.focus();
      zoomIn?.click();
      await Promise.resolve();
    });
    expect(fit?.disabled).toBe(false);
    dispatchTab();
    expect(document.activeElement).toBe(fit);

    await act(async () => {
      fit?.click();
      await Promise.resolve();
    });
    dispatchTab();
    expect(document.activeElement).toBe(zoomIn);
  });

  it("renders both public and already-resolved Blob URLs without owning revocation", async () => {
    const urlObject = URL as typeof URL & {
      revokeObjectURL?: (url: string) => void;
    };
    const previousRevokeObjectUrl = urlObject.revokeObjectURL;
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(urlObject, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl
    });
    await renderPreview("https://cdn.example.com/public.png");
    expect(host?.querySelector<HTMLImageElement>("[data-image-preview-image=true]")?.src).toBe(
      "https://cdn.example.com/public.png"
    );

    await act(async () => {
      root?.render(
        <ImagePreviewDialog
          src="blob:resolved-preview"
          alt="Preview image"
          closeLabel="Close preview"
          onClose={vi.fn()}
        />
      );
      await Promise.resolve();
    });
    expect(host?.querySelector<HTMLImageElement>("[data-image-preview-image=true]")?.src).toBe(
      "blob:resolved-preview"
    );

    await act(async () => {
      root?.render(null);
      await Promise.resolve();
    });
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    if (previousRevokeObjectUrl) {
      Object.defineProperty(urlObject, "revokeObjectURL", {
        configurable: true,
        value: previousRevokeObjectUrl
      });
    } else {
      Reflect.deleteProperty(urlObject, "revokeObjectURL");
    }
  });

  it("fits the image, zooms within bounds, and restores the fit", async () => {
    await renderPreview("https://cdn.example.com/large.png");
    const { viewport } = await loadPreviewImage();
    const zoomValue = () =>
      host?.querySelector<HTMLElement>("[data-image-preview-zoom-value=true]")
        ?.textContent;
    const zoomIn = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-zoom-in=true]"
    );
    const zoomOut = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-zoom-out=true]"
    );
    const fit = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-fit=true]"
    );

    expect(zoomValue()).toBe("63%");
    expect(zoomOut?.disabled).toBe(true);
    expect(zoomIn?.disabled).toBe(false);

    await act(async () => {
      zoomIn?.click();
      await Promise.resolve();
    });
    expect(zoomValue()).toBe("88%");

    await act(async () => {
      for (let index = 0; index < 20; index += 1) {
        zoomIn?.click();
      }
      await Promise.resolve();
    });
    expect(zoomValue()).toBe("400%");
    expect(zoomIn?.disabled).toBe(true);

    await act(async () => {
      viewport?.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 100,
          clientX: 400,
          clientY: 250
        })
      );
      await Promise.resolve();
    });
    expect(zoomValue()).toBe("375%");

    await act(async () => {
      fit?.click();
      await Promise.resolve();
    });
    expect(zoomValue()).toBe("63%");
    expect(fit?.disabled).toBe(true);
  });

  it("allows bounded drag only after zoom and supports touch pinch zoom", async () => {
    const onClose = await renderPreview("https://cdn.example.com/large.png");
    const { viewport } = await loadPreviewImage();
    const zoomIn = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-zoom-in=true]"
    );
    const zoomValue = () =>
      host?.querySelector<HTMLElement>("[data-image-preview-zoom-value=true]")
        ?.textContent;

    await act(async () => {
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 100,
        clientY: 100
      });
      dispatchPointer(viewport as HTMLElement, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 500,
        clientY: 400
      });
      dispatchPointer(viewport as HTMLElement, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 500,
        clientY: 400
      });
      await Promise.resolve();
    });
    expect(viewport?.getAttribute("data-image-preview-zoom")).toBe("63");
    expect(
      host?.querySelector<HTMLImageElement>("[data-image-preview-image=true]")?.style
        .transform
    ).toContain("translate3d(0px, 0px, 0)");

    await act(async () => {
      zoomIn?.click();
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 10,
        pointerType: "touch",
        clientX: 100,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointermove", {
        pointerId: 10,
        pointerType: "touch",
        clientX: 500,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointerup", {
        pointerId: 10,
        pointerType: "touch",
        clientX: 500,
        clientY: 200
      });
      viewport?.click();
      await Promise.resolve();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      host?.querySelector<HTMLImageElement>("[data-image-preview-image=true]")?.style
        .transform
    ).toContain("translate3d(125px, 0px, 0)");

    await act(async () => {
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 20,
        pointerType: "touch",
        clientX: 200,
        clientY: 250
      });
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 21,
        pointerType: "touch",
        clientX: 300,
        clientY: 250
      });
      dispatchPointer(viewport as HTMLElement, "pointermove", {
        pointerId: 21,
        pointerType: "touch",
        clientX: 400,
        clientY: 250
      });
      dispatchPointer(viewport as HTMLElement, "pointerup", {
        pointerId: 20,
        pointerType: "touch",
        clientX: 200,
        clientY: 250
      });
      dispatchPointer(viewport as HTMLElement, "pointerup", {
        pointerId: 21,
        pointerType: "touch",
        clientX: 400,
        clientY: 250
      });
      await Promise.resolve();
    });
    expect(Number.parseInt(zoomValue()?.replace("%", "") ?? "0", 10)).toBeGreaterThan(88);

    const transformAfterPinch = host?.querySelector<HTMLImageElement>(
      "[data-image-preview-image=true]"
    )?.style.transform;
    await act(async () => {
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 30,
        pointerType: "touch",
        clientX: 200,
        clientY: 250
      });
      dispatchPointer(viewport as HTMLElement, "pointermove", {
        pointerId: 30,
        pointerType: "touch",
        clientX: 300,
        clientY: 250
      });
      dispatchPointer(viewport as HTMLElement, "pointerup", {
        pointerId: 30,
        pointerType: "touch",
        clientX: 300,
        clientY: 250
      });
      await Promise.resolve();
    });
    expect(
      host?.querySelector<HTMLImageElement>("[data-image-preview-image=true]")?.style.transform
    ).not.toBe(transformAfterPinch);
  });

  it("clears a cancelled pointer before the next single-pointer drag", async () => {
    await renderPreview("https://cdn.example.com/large.png");
    const { viewport } = await loadPreviewImage();
    const zoomIn = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-zoom-in=true]"
    );

    await act(async () => {
      zoomIn?.click();
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 100,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointercancel", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 100,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 200,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointermove", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 300,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointerup", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 300,
        clientY: 200
      });
      await Promise.resolve();
    });

    expect(viewport?.getAttribute("data-image-preview-zoom")).toBe("88");
  });

  it("clears lost pointer capture before the next single-pointer drag", async () => {
    await renderPreview("https://cdn.example.com/large.png");
    const { viewport } = await loadPreviewImage();
    const zoomIn = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-zoom-in=true]"
    );

    await act(async () => {
      zoomIn?.click();
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 100,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "lostpointercapture", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 100,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 200,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointermove", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 300,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointerup", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 300,
        clientY: 200
      });
      await Promise.resolve();
    });

    expect(viewport?.getAttribute("data-image-preview-zoom")).toBe("88");
  });

  it("resets drag click suppression when no browser click follows the gesture", async () => {
    const onClose = await renderPreview("https://cdn.example.com/large.png");
    const { viewport } = await loadPreviewImage();
    const zoomIn = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-zoom-in=true]"
    );

    await act(async () => {
      zoomIn?.click();
      dispatchPointer(viewport as HTMLElement, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 100,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 300,
        clientY: 200
      });
      dispatchPointer(viewport as HTMLElement, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 300,
        clientY: 200
      });
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    const backdrop = host?.querySelector<HTMLElement>("[data-image-preview-dialog=true]");
    await act(async () => {
      backdrop?.click();
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles image failure and restores focus when the parent closes it", async () => {
    opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = await renderPreview("https://cdn.example.com/broken.png");
    const image = host?.querySelector<HTMLImageElement>(
      "[data-image-preview-image=true]"
    );
    await act(async () => {
      image?.dispatchEvent(new Event("error"));
      await Promise.resolve();
    });
    expect(host?.querySelector("[data-image-preview-load-state=failed]")?.textContent).toBe(
      "Image could not be loaded"
    );

    const close = host?.querySelector<HTMLButtonElement>(
      "[data-image-preview-close=true]"
    );
    const dialog = host?.querySelector<HTMLElement>("[data-image-preview-dialog=true]");
    dialog?.focus();
    dispatchTab();
    expect(document.activeElement).toBe(close);
    dispatchTab(true);
    expect(document.activeElement).toBe(close);
    await act(async () => {
      close?.click();
      root?.render(null);
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it("keeps focus and the scroll lock across source changes, then restores the opener on close", async () => {
    opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    await renderPreview("https://cdn.example.com/first.png");
    await loadPreviewImage();

    const dialog = host?.querySelector<HTMLElement>("[data-image-preview-dialog=true]");
    dialog?.focus();
    await act(async () => {
      root?.render(
        <ImagePreviewDialog
          src="https://cdn.example.com/second.png"
          alt="Preview image"
          closeLabel="Close preview"
          onClose={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).not.toBe(opener);
    expect(
      host?.querySelector<HTMLElement>("[data-image-preview-viewport=true]")?.getAttribute(
        "data-image-preview-zoom"
      )
    ).toBe("100");

    await act(async () => {
      root?.render(null);
      await Promise.resolve();
    });
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
  });

  it("locks and restores body scrolling, closes from Escape, backdrop, and button", async () => {
    const onClose = await renderPreview("https://cdn.example.com/public.png");

    expect(document.body.style.overflow).toBe("hidden");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = host?.querySelector<HTMLElement>("[data-image-preview-dialog=true]");
    await act(async () => {
      backdrop?.click();
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    const viewport = host?.querySelector<HTMLElement>(
      "[data-image-preview-viewport=true]"
    );
    await act(async () => {
      viewport?.click();
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(3);

    await act(async () => {
      root?.render(
        <ImagePreviewDialog
          src={null}
          alt="Preview image"
          closeLabel="Close preview"
          onClose={onClose}
        />
      );
      await Promise.resolve();
    });
    expect(document.body.style.overflow).toBe("");
    expect(host?.querySelector("[data-image-preview-dialog=true]")).toBeNull();
  });
});
