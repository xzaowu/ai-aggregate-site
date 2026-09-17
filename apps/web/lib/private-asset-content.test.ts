import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchImageAssetBlob,
  fetchPrivateAssetBlob,
  isPrivateAssetContentUrl,
  PrivateAssetContentError,
  type PrivateAssetContentErrorCode
} from "./private-asset-content";
import { apiUrl } from "./site-config";

const logicalUrl = "/assets/550e8400-e29b-41d4-a716-446655440000/content";
const token = "private-test-token";

function imageResponse(contentType: "image/png" | "image/jpeg" | "image/webp", size = 3): Response {
  return new Response(new Blob([new Uint8Array(size)], { type: contentType }), {
    status: 200,
    headers: { "Content-Type": contentType }
  });
}

async function expectPrivateError(
  request: Promise<unknown>,
  expectedCode: PrivateAssetContentErrorCode
): Promise<void> {
  try {
    await request;
    throw new Error("expected a private asset content error");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateAssetContentError);
    if (error instanceof PrivateAssetContentError) {
      expect(error.code).toBe(expectedCode);
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isPrivateAssetContentUrl", () => {
  it.each([
    ["recognizes UUID asset content paths", logicalUrl],
    ["recognizes cuid-style asset content paths", "/assets/cm5x7d0aa0001abc123_def/content"]
  ])("%s", (_label, value) => {
    expect(isPrivateAssetContentUrl(value)).toBe(true);
  });

  it.each([
    ["rejects an empty asset id", "/assets//content"],
    ["rejects the asset detail page path", "/assets/asset_1"],
    ["rejects browser-facing API paths", "/api/assets/asset_1/content"],
    ["rejects generated asset paths", "/generated-assets/avatar.png"],
    ["rejects provider absolute URLs", "https://provider.example/images/a.png"],
    ["rejects external URLs with a private-looking pathname", "https://provider.example/assets/asset_1/content"],
    ["rejects data URLs", "data:image/png;base64,AA=="],
    ["rejects blob URLs", "blob:https://app.example/asset_1"],
    ["rejects javascript URLs", "javascript:alert(1)"],
    ["rejects query strings", "/assets/asset_1/content?preview=1"],
    ["rejects fragments", "/assets/asset_1/content#preview"],
    ["rejects extra path segments", "/assets/asset_1/content/thumbnail"],
    ["rejects path traversal", "/assets/asset_1/../content"],
    ["rejects encoded slashes", "/assets/asset%2F1/content"],
    ["rejects empty input", ""],
    ["rejects whitespace input", "   "],
    ["rejects non-string malformed values", null]
  ])("%s", (_label, value) => {
    expect(isPrivateAssetContentUrl(value)).toBe(false);
  });
});

describe("fetchPrivateAssetBlob", () => {
  it("uses apiUrl with the required Bearer GET request contract", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse("image/png"));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    const blob = await fetchPrivateAssetBlob({ logicalUrl, token, signal });

    expect(blob.size).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const [requestUrl, requestInit] = call;
    expect(requestUrl).toBe(apiUrl(logicalUrl));
    expect(requestInit?.method).toBe("GET");
    expect(requestInit?.credentials).toBe("omit");
    expect(requestInit?.headers).toEqual({ Authorization: `Bearer ${token}` });
    expect(requestInit?.signal).toBe(signal);
    expect(String(requestUrl)).not.toContain(token);
    expect(new URL(String(requestUrl), "https://app.example").search).toBe("");
  });

  it("does not fetch an invalid private logical URL", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expectPrivateError(
      fetchPrivateAssetBlob({ logicalUrl: "/generated-assets/public.png", token }),
      "INVALID_PRIVATE_URL"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch with an empty token", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expectPrivateError(fetchPrivateAssetBlob({ logicalUrl, token: "   " }), "AUTH_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["image/png", "image/jpeg", "image/webp"] as const)("returns a non-empty %s Blob", async (contentType) => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse(contentType));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchPrivateAssetBlob({ logicalUrl, token });

    expect(blob.size).toBeGreaterThan(0);
  });

  it("rejects an empty success Blob", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse("image/png", 0));
    vi.stubGlobal("fetch", fetchMock);

    await expectPrivateError(fetchPrivateAssetBlob({ logicalUrl, token }), "UNAVAILABLE");
  });

  it("rejects non-image Content-Type values", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(new Blob(["file"]), {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expectPrivateError(fetchPrivateAssetBlob({ logicalUrl, token }), "UNAVAILABLE");
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [404, "NOT_FOUND"],
    [500, "UNAVAILABLE"]
  ] as const)("maps HTTP %i to %s without reading the response body", async (status, code) => {
    const response = new Response("private failure body", { status });
    const bodyReader = vi.spyOn(response, "text");
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await expectPrivateError(fetchPrivateAssetBlob({ logicalUrl, token }), code);

    expect(bodyReader).not.toHaveBeenCalled();
  });

  it("maps network failures to UNAVAILABLE", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(new Error("network failure"));
    vi.stubGlobal("fetch", fetchMock);

    await expectPrivateError(fetchPrivateAssetBlob({ logicalUrl, token }), "UNAVAILABLE");
  });

  it("rethrows AbortError without mapping it", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPrivateAssetBlob({ logicalUrl, token })).rejects.toBe(abortError);
  });
});

describe("fetchImageAssetBlob", () => {
  it("reads an allowed public asset without credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(imageResponse("image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchImageAssetBlob({
      logicalUrl: "https://cdn.example.test/full-size.jpg",
      token
    });

    expect(blob.size).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.test/full-size.jpg",
      expect.objectContaining({
        method: "GET",
        credentials: "omit"
      })
    );
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit && "headers" in requestInit ? requestInit.headers : undefined).toBeUndefined();
  });

  it("rejects unsupported source URLs before fetching", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expectPrivateError(
      fetchImageAssetBlob({ logicalUrl: "data:image/png;base64,AA==", token }),
      "INVALID_ASSET_URL"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
