"use client";

import type { AiAssetDetailResponse } from "@ai-aggregate/shared";
import { useEffect, useState } from "react";
import { isAbortError, isPrivateAssetContentUrl } from "../../../lib/private-asset-content";
import { apiUrl } from "../../../lib/site-config";

export type CreatorImageAssetDisplayState =
  | { status: "idle"; logicalUrl: null }
  | { status: "loading"; logicalUrl: null }
  | { status: "ready"; logicalUrl: string }
  | { status: "unavailable"; logicalUrl: null };

export interface ResolveCreatorImageAssetDisplayOptions {
  assetId: string;
  token: string;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
}

export async function resolveCreatorImageAssetDisplay({
  assetId,
  token,
  signal,
  fetchImplementation = fetch
}: ResolveCreatorImageAssetDisplayOptions): Promise<string> {
  if (!assetId.trim() || !token.trim()) {
    throw new Error("CREATOR_IMAGE_ASSET_DISPLAY_INVALID_REQUEST");
  }
  const response = await fetchImplementation(apiUrl(`/assets/${assetId}`), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal
  });
  if (!response.ok) {
    throw new Error("CREATOR_IMAGE_ASSET_DISPLAY_UNAVAILABLE");
  }
  const data = (await response.json()) as Partial<AiAssetDetailResponse>;
  const asset = data.asset;
  if (
    !asset ||
    asset.id !== assetId ||
    asset.type !== "image" ||
    !isPrivateAssetContentUrl(asset.url)
  ) {
    throw new Error("CREATOR_IMAGE_ASSET_DISPLAY_INVALID_ASSET");
  }
  return asset.url;
}

export function useCreatorImageAssetDisplay({
  assetId,
  token,
  enabled
}: {
  assetId: string | null;
  token: string | null;
  enabled: boolean;
}): CreatorImageAssetDisplayState {
  const [state, setState] = useState<CreatorImageAssetDisplayState>({
    status: "idle",
    logicalUrl: null
  });

  useEffect(() => {
    if (!enabled || !assetId || !token) {
      setState({ status: "idle", logicalUrl: null });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading", logicalUrl: null });
    void resolveCreatorImageAssetDisplay({
      assetId,
      token,
      signal: controller.signal
    })
      .then((logicalUrl) => {
        if (active) setState({ status: "ready", logicalUrl });
      })
      .catch((error: unknown) => {
        if (active && !isAbortError(error)) {
          setState({ status: "unavailable", logicalUrl: null });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [assetId, enabled, token]);

  return state;
}
