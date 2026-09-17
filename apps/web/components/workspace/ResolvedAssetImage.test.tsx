// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyResolvedAssetImage, ResolvedAssetImage } from "./ResolvedAssetImage";

const privateUrl = "/assets/550e8400-e29b-41d4-a716-446655440000/content";
const token = "component-private-token";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function imageResponse(status = 200): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status,
    headers: { "Content-Type": "image/png" }
  });
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function installObjectUrlMocks() {
  let sequence = 0;
  const createObjectURL = vi.fn((_blob: Blob) => {
    sequence += 1;
    return `blob:component-${sequence}`;
  });
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

async function mount(element: React.ReactNode): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(element);
  });
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

async function unmount(): Promise<void> {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  host = null;
  root = null;
}

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ResolvedAssetImage", () => {
  it("renders public URLs directly and preserves safe image props", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const onClick = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await mount(
      <ResolvedAssetImage
        alt="Public asset"
        className="rounded-image"
        loading="lazy"
        onClick={onClick}
        src="/generated-assets/legacy.png"
        token={token}
      />
    );

    const image = host?.querySelector<HTMLImageElement>("img");
    expect(image?.getAttribute("src")).toBe("/generated-assets/legacy.png");
    expect(image?.getAttribute("alt")).toBe("Public asset");
    expect(image?.className).toBe("rounded-image");
    expect(image?.getAttribute("loading")).toBe("lazy");
    await act(async () => {
      image?.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a resolved Blob URL for a private asset", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse());
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount(<ResolvedAssetImage alt="Private asset" src={privateUrl} token={token} />);
    await flushEffects();

    expect(host?.querySelector("img")?.getAttribute("src")).toBe("blob:component-1");
  });

  it("uses fallback while a private asset is loading without rendering its logical URL", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() => pending.promise);
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount(
      <ResolvedAssetImage
        alt="Private asset"
        fallback={<span>Loading private asset</span>}
        src={privateUrl}
        token={token}
      />
    );

    expect(host?.textContent).toContain("Loading private asset");
    expect(host?.querySelector("img")).toBeNull();
    expect(host?.innerHTML).not.toContain(privateUrl);
  });

  it("uses fallback on a private error without rendering its logical URL", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse(500));
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount(
      <ResolvedAssetImage
        alt="Private asset"
        fallback={<span>Private asset unavailable</span>}
        src={privateUrl}
        token={token}
      />
    );
    await flushEffects();

    expect(host?.textContent).toContain("Private asset unavailable");
    expect(host?.querySelector("img")).toBeNull();
    expect(host?.innerHTML).not.toContain(privateUrl);
  });

  it("does not put the token into image markup or text", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse());
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount(<ResolvedAssetImage alt="Private asset" src={privateUrl} token={token} />);
    await flushEffects();

    expect(host?.innerHTML).not.toContain(token);
    expect(host?.textContent).not.toContain(token);
  });

  it("revokes the resolved Blob URL on unmount", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse());
    const { revokeObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount(<ResolvedAssetImage alt="Private asset" src={privateUrl} token={token} />);
    await flushEffects();
    await unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:component-1");
  });

  it("defers private Blob loading until the card is near the viewport", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse());
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    let callback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    const observe = vi.fn();
    class TestIntersectionObserver {
      constructor(next: (entries: Array<{ isIntersecting: boolean }>) => void) {
        callback = next;
      }

      observe = observe;
      disconnect = vi.fn();
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

    await mount(
      <LazyResolvedAssetImage
        alt="Deferred private asset"
        containerClassName="h-full w-full"
        fallback={<span>Deferred private asset</span>}
        src={privateUrl}
        token={token}
      />
    );

    expect(host?.dataset).toBeDefined();
    expect(host?.querySelector('[data-lazy-resolved-asset-image="pending"]')).toBeTruthy();
    expect(host?.textContent).toContain("Deferred private asset");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledTimes(1);

    await act(async () => {
      callback?.([{ isIntersecting: true }]);
      await Promise.resolve();
    });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[data-lazy-resolved-asset-image="active"] img')).toBeTruthy();
  });

  it.each([
    ["provider URL", "https://provider.example/image.png"],
    ["legacy generated asset", "/generated-assets/legacy.png"]
  ])("does not fetch a %s", async (_label, src) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await mount(<ResolvedAssetImage alt="Public asset" src={src} token={token} />);

    expect(host?.querySelector("img")?.getAttribute("src")).toBe(src);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
