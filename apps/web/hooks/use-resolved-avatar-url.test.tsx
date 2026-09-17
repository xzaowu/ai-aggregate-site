// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useResolvedAvatarUrl,
  type UseResolvedAvatarUrlOptions
} from "./use-resolved-avatar-url";

const privateUrl = "/generated-assets/images/2026/07/550e8400-e29b-41d4-a716-446655440000.png";
const replacementPrivateUrl = "/generated-assets/images/2026/07/550e8400-e29b-41d4-a716-446655440001.png";
const token = "avatar-token";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function imageResponse(status = 200, contentType = "image/png"): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status,
    headers: { "Content-Type": contentType }
  });
}

function installObjectUrlMocks() {
  let sequence = 0;
  const createObjectURL = vi.fn((_blob: Blob) => {
    sequence += 1;
    return `blob:avatar-${sequence}`;
  });
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

function Probe({ options }: { options: UseResolvedAvatarUrlOptions }) {
  const state = useResolvedAvatarUrl(options);
  return <output data-error={state.error ?? ""} data-loading={String(state.loading)} data-private={String(state.isPrivate)} data-resolved={state.resolvedUrl ?? ""} />;
}

async function mount(options: UseResolvedAvatarUrlOptions): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Probe options={options} />);
  });
}

async function rerender(options: UseResolvedAvatarUrlOptions): Promise<void> {
  await act(async () => {
    root?.render(<Probe options={options} />);
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

function state() {
  const output = host?.querySelector("output");
  if (!output) throw new Error("AVATAR_HOOK_PROBE_MISSING");
  return {
    error: output.getAttribute("data-error"),
    loading: output.getAttribute("data-loading"),
    isPrivate: output.getAttribute("data-private"),
    resolvedUrl: output.getAttribute("data-resolved")
  };
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  host = null;
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useResolvedAvatarUrl", () => {
  it("resolves legacy relative avatars through the configured API origin without fetching", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: "/generated-assets/legacy-avatar.png", token });

    expect(state()).toEqual({
      error: "",
      loading: "false",
      isPrivate: "false",
      resolvedUrl: "/api/generated-assets/legacy-avatar.png"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the authenticated API content route and creates a Blob URL for a private avatar", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(imageResponse()));
    const { createObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token });
    await settle();

    expect(state()).toEqual({
      error: "",
      loading: "false",
      isPrivate: "true",
      resolvedUrl: "blob:avatar-1"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/avatar/content",
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        headers: { Authorization: `Bearer ${token}` }
      })
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "auth"],
    [403, "unavailable"],
    [404, "not-found"]
  ] as const)("uses a fixed safe fallback for HTTP %i", async (status, error) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(imageResponse(status));
    installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token });
    await settle();

    expect(state()).toEqual({
      error,
      loading: "false",
      isPrivate: "true",
      resolvedUrl: ""
    });
  });

  it("revokes the previous Blob URL when a newly uploaded avatar has a new immutable URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(imageResponse()));
    const { revokeObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token });
    await settle();
    await rerender({ src: replacementPrivateUrl, token });
    await settle();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:avatar-1");
    expect(state().resolvedUrl).toBe("blob:avatar-2");
  });

  it("revokes the current Blob URL on unmount and never places the token in markup", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(imageResponse());
    const { revokeObjectURL } = installObjectUrlMocks();
    vi.stubGlobal("fetch", fetchMock);

    await mount({ src: privateUrl, token });
    await settle();

    expect(host?.innerHTML).not.toContain(token);
    await act(async () => {
      root?.unmount();
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:avatar-1");
  });
});
