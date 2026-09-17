import { describe, expect, it, vi } from "vitest";
import { apiUrl } from "../../../lib/site-config";
import { resolveCreatorImageAssetDisplay } from "./creator-image-asset-display";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Creator Image bound asset display resolution", () => {
  it("resolves owner metadata to a logical private URL without downloading content", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      asset: {
        id: "asset-image",
        type: "image",
        url: "/assets/asset-image/content"
      }
    }));

    await expect(resolveCreatorImageAssetDisplay({
      assetId: "asset-image",
      token: "owner-token",
      fetchImplementation
    })).resolves.toBe("/assets/asset-image/content");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledWith(
      apiUrl("/assets/asset-image"),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer owner-token" }
      })
    );
    expect(String(fetchImplementation.mock.calls[0]?.[0])).not.toContain("/content");
  });

  it("rejects unavailable, mismatched, non-image, and non-logical metadata", async () => {
    for (const response of [
      jsonResponse({}, 404),
      jsonResponse({ asset: { id: "other", type: "image", url: "/assets/other/content" } }),
      jsonResponse({ asset: { id: "asset-image", type: "video", url: "/assets/asset-image/content" } }),
      jsonResponse({ asset: { id: "asset-image", type: "image", url: "https://provider.example/image.png" } })
    ]) {
      await expect(resolveCreatorImageAssetDisplay({
        assetId: "asset-image",
        token: "owner-token",
        fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(response)
      })).rejects.toThrow();
    }
  });
});
