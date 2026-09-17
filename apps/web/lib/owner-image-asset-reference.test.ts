import type { AiAssetDetailResponse } from "@ai-aggregate/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "./site-config";
import {
  OwnerImageAssetReferenceError,
  resolveOwnerImageAssetReference
} from "./owner-image-asset-reference";

const assetId = "owner-image-asset";
const token = "owner-token";
const logicalUrl = `/assets/${assetId}/content`;

const detail: AiAssetDetailResponse = {
  asset: {
    id: assetId,
    userId: "user-1",
    taskId: "task-1",
    type: "image",
    url: logicalUrl,
    thumbnailUrl: null,
    title: "Reference",
    metadata: null,
    createdAt: "2026-08-23T00:00:00.000Z"
  },
  task: null
};

afterEach(() => {
  vi.restoreAllMocks();
});

async function expectResolutionError(
  request: Promise<unknown>,
  options: { code: string; terminal: boolean }
) {
  try {
    await request;
    throw new Error("expected owner image resolution to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(OwnerImageAssetReferenceError);
    expect(error).toMatchObject(options);
  }
}

describe("owner image asset reference resolution", () => {
  it("uses the authenticated owner detail endpoint and existing private Blob seam", async () => {
    const signal = new AbortController().signal;
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(detail), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const blob = new Blob(["image"], { type: "image/png" });
    const fetchPrivateAssetBlobImplementation = vi
      .fn()
      .mockResolvedValue(blob);

    const result = await resolveOwnerImageAssetReference({
      assetId,
      token,
      signal,
      fetchImplementation,
      fetchPrivateAssetBlobImplementation
    });

    expect(result).toEqual({ asset: detail.asset, task: null, blob });
    expect(fetchImplementation).toHaveBeenCalledWith(
      apiUrl(`/assets/${assetId}`),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal
      }
    );
    expect(fetchPrivateAssetBlobImplementation).toHaveBeenCalledWith({
      logicalUrl,
      token,
      signal
    });
  });

  it("fails before fetching when the asset id or token is missing", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expectResolutionError(
      resolveOwnerImageAssetReference({
        assetId: " ",
        token,
        fetchImplementation
      }),
      { code: "INVALID_REQUEST", terminal: true }
    );
    await expectResolutionError(
      resolveOwnerImageAssetReference({
        assetId,
        token: "",
        fetchImplementation
      }),
      { code: "INVALID_REQUEST", terminal: true }
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("classifies a missing owner asset as terminal", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 404 })
    );
    await expectResolutionError(
      resolveOwnerImageAssetReference({ assetId, token, fetchImplementation }),
      { code: "ASSET_UNAVAILABLE", terminal: true }
    );
  });

  it("rethrows the metadata JSON AbortError without fetching private content", async () => {
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError"
    });
    const response = new Response(JSON.stringify(detail), { status: 200 });
    vi.spyOn(response, "json").mockRejectedValue(abortError);
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response);
    const fetchPrivateAssetBlobImplementation = vi.fn();

    await expect(
      resolveOwnerImageAssetReference({
        assetId,
        token,
        fetchImplementation,
        fetchPrivateAssetBlobImplementation
      })
    ).rejects.toBe(abortError);
    expect(fetchPrivateAssetBlobImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...detail.asset, type: "video" as const }, "wrong media type"],
    [{ ...detail.asset, id: "another-asset" }, "wrong owner DTO identity"],
    [{ ...detail.asset, url: "https://cdn.example.test/image.png" }, "unusable URL"]
  ])("rejects $1", async (asset) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ asset, task: null }), { status: 200 })
    );
    const fetchPrivateAssetBlobImplementation = vi.fn();

    await expectResolutionError(
      resolveOwnerImageAssetReference({
        assetId,
        token,
        fetchImplementation,
        fetchPrivateAssetBlobImplementation
      }),
      { code: "INVALID_IMAGE_ASSET", terminal: true }
    );
    expect(fetchPrivateAssetBlobImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [new Blob([], { type: "image/png" }), "empty Blob"],
    [new Blob(["video"], { type: "video/mp4" }), "non-image Blob"]
  ])("rejects an %s returned by the private content seam", async (blob) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(detail), { status: 200 })
    );
    const fetchPrivateAssetBlobImplementation = vi.fn().mockResolvedValue(blob);

    await expectResolutionError(
      resolveOwnerImageAssetReference({
        assetId,
        token,
        fetchImplementation,
        fetchPrivateAssetBlobImplementation
      }),
      { code: "INVALID_IMAGE_CONTENT", terminal: true }
    );
  });

  it("keeps 429, server, network, and malformed DTO failures transient", async () => {
    for (const response of [
      new Response(null, { status: 429 }),
      new Response(null, { status: 503 }),
      new Response("not-json", { status: 200 })
    ]) {
      const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expectResolutionError(
        resolveOwnerImageAssetReference({ assetId, token, fetchImplementation }),
        { code: "ASSET_UNAVAILABLE", terminal: false }
      );
    }

    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network"));
    await expectResolutionError(
      resolveOwnerImageAssetReference({ assetId, token, fetchImplementation }),
      { code: "ASSET_UNAVAILABLE", terminal: false }
    );
  });
});
