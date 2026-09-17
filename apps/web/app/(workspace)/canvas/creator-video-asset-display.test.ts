// @vitest-environment jsdom

import type { AiAssetSummary } from "@ai-aggregate/shared";
import { describe, expect, it, vi } from "vitest";
import { resolveCreatorVideoAssetDisplay } from "./creator-video-asset-display";

const videoAsset: AiAssetSummary = {
  id: "asset-video-1",
  userId: "user-1",
  taskId: "task-video-1",
  type: "video",
  url: "/assets/asset-video-1/content",
  thumbnailUrl: null,
  title: "Private video",
  metadata: { mimeType: "video/mp4" },
  createdAt: "2026-09-03T00:00:00.000Z"
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Creator Video asset display", () => {
  it("requests the owner-authenticated asset detail and accepts only a private Video URL", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({
      asset: videoAsset,
      task: null
    }));
    await expect(resolveCreatorVideoAssetDisplay({
      assetId: videoAsset.id,
      token: "owner-token",
      fetchImplementation: fetchMock
    })).resolves.toBe(videoAsset.url);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assets/asset-video-1",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer owner-token" }
      })
    );
  });

  it.each([
    ["wrong id", { asset: { ...videoAsset, id: "other" }, task: null }],
    ["image asset", { asset: { ...videoAsset, type: "image" }, task: null }],
    ["public URL", { asset: { ...videoAsset, url: "https://provider.example/video.mp4" }, task: null }],
    ["malformed response", { asset: { id: videoAsset.id }, task: null }]
  ])("rejects %s and never trusts its URL", async (_label, value) => {
    await expect(resolveCreatorVideoAssetDisplay({
      assetId: videoAsset.id,
      token: "owner-token",
      fetchImplementation: async () => response(value)
    })).rejects.toThrow("CREATOR_VIDEO_ASSET_DISPLAY_INVALID_ASSET");
  });

  it("rejects unavailable responses and invalid requests", async () => {
    await expect(resolveCreatorVideoAssetDisplay({
      assetId: videoAsset.id,
      token: "owner-token",
      fetchImplementation: async () => response({}, 404)
    })).rejects.toThrow("CREATOR_VIDEO_ASSET_DISPLAY_UNAVAILABLE");
    await expect(resolveCreatorVideoAssetDisplay({
      assetId: " ",
      token: "owner-token",
      fetchImplementation: vi.fn()
    })).rejects.toThrow("CREATOR_VIDEO_ASSET_DISPLAY_INVALID_REQUEST");
  });

  it("propagates an aborted owner request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException("aborted", "AbortError");
    });
    await expect(resolveCreatorVideoAssetDisplay({
      assetId: videoAsset.id,
      token: "owner-token",
      signal: controller.signal,
      fetchImplementation: fetchMock
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
