// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useResolvedAssetUrl,
  type UseResolvedAssetUrlOptions
} from "./use-resolved-asset-url";

const privateUrl = "/assets/550e8400-e29b-41d4-a716-446655440000/content";
const secondPrivateUrl = "/assets/asset_second/content";
const token = "hook-private-token";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function imageResponse(status = 200, contentType = "image/png"): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status,
    headers: { "Content-Type": contentType }
  });
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function installObjectUrlMocks(prefix = "blob:private") {
  let sequence = 0;
  const createObjectURL = vi.fn((_blob: Blob) => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  });
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

function Probe({ options }: { options: UseResolvedAssetUrlOptions }) {
  const state = useResolvedAssetUrl(options);
  return (
    <output
      data-error={state.error ?? ""}
      data-loading={String(state.loading)}
      data-private={String(state.isPrivate)}
      data-resolved={state.resolvedUrl ?? ""}
    />
  );
}

async function mount(options: UseResolvedAssetUrlOptions, strict = false): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const element = <Probe options={options} />;
  await act(async () => {
    root?.render(strict ? <React.StrictMode>{element}</React.StrictMode> : element);
  });
}

async function rerender(options: UseResolvedAssetUrlOptions): Promise<void> {
  await act(async () => {
    root?.render(<Probe options={options} />);
  });
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

function state() {
  const output = host?.querySelector("output");
  if (!output) throw new Error("hook output is not mounted");
  return {
    error: output.getAttribute("data-error"),
    loading: output.getAttribute("data-loading"),
    isPrivate: output.getAttribute("data-private"),
    resolvedUrl: output.getAttribute("data-resolved")
  };
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

describe("useResolvedAssetUrl", () => {
  it("returns an idle empty state for null src", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: null, token, enabled: true });

    expect(state()).toEqual({ error: "", loading: "false", isPrivate: "false", resolvedUrl: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["generated assets", "/generated-assets/legacy.png"],
    ["provider URLs", "https://provider.example/image.png"],
    ["data URLs", "data:image/png;base64,AA=="],
    ["Blob URLs", "blob:https://app.example/asset"]
  ])("returns %s directly without fetching or creating Blob URLs", async (_label, src) => {
    const fetchMock = vi.fn<typeof fetch>();
    const { createObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src, token, enabled: true });

    expect(state()).toEqual({ error: "", loading: "false", isPrivate: "false", resolvedUrl: src });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("returns auth without fetching for a private URL with no token", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token: "   ", enabled: true });

    expect(state()).toEqual({ error: "auth", loading: "false", isPrivate: "true", resolvedUrl: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a Blob URL and transitions from loading after a private success", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() => pending.promise);
    const { createObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });

    expect(state()).toEqual({ error: "", loading: "true", isPrivate: "true", resolvedUrl: "" });
    pending.resolve(imageResponse());
    await flushEffects();
    expect(state()).toEqual({ error: "", loading: "false", isPrivate: "true", resolvedUrl: "blob:private-1" });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "auth"],
    [404, "not-found"],
    [500, "unavailable"]
  ] as const)("maps HTTP %i to %s", async (status, error) => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse(status));
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await flushEffects();

    expect(state()).toEqual({ error, loading: "false", isPrivate: "true", resolvedUrl: "" });
  });

  it("maps a network failure to unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(new Error("network failure"));
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await flushEffects();

    expect(state()).toEqual({ error: "unavailable", loading: "false", isPrivate: "true", resolvedUrl: "" });
  });

  it("silently handles AbortError without a business error", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(abortError);
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await flushEffects();

    expect(state()).toEqual({ error: "", loading: "false", isPrivate: "true", resolvedUrl: "" });
  });

  it("aborts the old request with a mockable AbortController when src changes", async () => {
    const NativeAbortController = AbortController;
    const controllers: Array<{ abort: ReturnType<typeof vi.fn> }> = [];
    class TrackingAbortController {
      readonly signal = new NativeAbortController().signal;
      readonly abort = vi.fn();

      constructor() {
        controllers.push(this);
      }
    }
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    installObjectUrlMocks();
    vi.stubGlobal("AbortController", TrackingAbortController);
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await rerender({ src: secondPrivateUrl, token, enabled: true });

    expect(controllers).toHaveLength(2);
    expect(controllers[0]?.abort).toHaveBeenCalledTimes(1);
    second.resolve(imageResponse());
    await flushEffects();
    expect(state().resolvedUrl).toBe("blob:private-1");
  });

  it("aborts the old request when token changes", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await rerender({ src: privateUrl, token: "replacement-token", enabled: true });

    expect(abortSpy).toHaveBeenCalledTimes(1);
    second.resolve(imageResponse());
    await flushEffects();
    expect(state().resolvedUrl).toBe("blob:private-1");
  });

  it("does not fetch private URLs while disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: false });

    expect(state()).toEqual({ error: "", loading: "false", isPrivate: "true", resolvedUrl: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the old request when enabled changes", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() => pending.promise);
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await rerender({ src: privateUrl, token, enabled: false });

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ error: "", loading: "false", isPrivate: "true", resolvedUrl: "" });
  });

  it("aborts an in-flight request on unmount", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() => pending.promise);
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await unmount();

    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it("revokes a resolved Blob URL on unmount", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse());
    const { revokeObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await flushEffects();
    await unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
  });

  it("revokes the old Blob URL before resolving a new private source", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() => Promise.resolve(imageResponse()));
    const { revokeObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await flushEffects();
    await rerender({ src: secondPrivateUrl, token, enabled: true });
    await flushEffects();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
    expect(state().resolvedUrl).toBe("blob:private-2");
  });

  it("revokes a private Blob URL when switching to a public URL", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse());
    const { revokeObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await flushEffects();
    await rerender({ src: "/generated-assets/legacy.png", token, enabled: true });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
    expect(state()).toEqual({
      error: "",
      loading: "false",
      isPrivate: "false",
      resolvedUrl: "/generated-assets/legacy.png"
    });
  });

  it("revokes a private Blob URL when the token is cleared", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse());
    const { revokeObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await flushEffects();
    await rerender({ src: privateUrl, token: null, enabled: true });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
    expect(state()).toEqual({ error: "auth", loading: "false", isPrivate: "true", resolvedUrl: "" });
  });

  it("prevents an old request from replacing a newer result", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { createObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true });
    await rerender({ src: secondPrivateUrl, token, enabled: true });
    second.resolve(imageResponse());
    await flushEffects();
    first.resolve(imageResponse());
    await flushEffects();

    expect(state().resolvedUrl).toBe("blob:private-1");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("does not leak a Blob URL through Strict Mode effect replay", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() => Promise.resolve(imageResponse()));
    const { createObjectURL, revokeObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token, enabled: true }, true);
    await flushEffects();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
  });

  it("does not put the token into the DOM or browser console", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse());
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);
    const methods = ["error", "log", "warn"] as const;
    const spies = methods.map((method) => vi.spyOn(globalThis.console, method));

    await mount({ src: privateUrl, token, enabled: true });
    await flushEffects();

    expect(host?.innerHTML).not.toContain(token);
    expect(spies.flatMap((spy) => spy.mock.calls).flat().join(" ")).not.toContain(token);
  });
});
