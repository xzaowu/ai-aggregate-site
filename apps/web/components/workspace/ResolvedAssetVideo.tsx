"use client";

import React, {
  useEffect,
  useState,
  type ReactNode,
  type VideoHTMLAttributes
} from "react";
import {
  fetchPrivateAssetBlob,
  isAbortError,
  isPrivateAssetContentUrl
} from "../../lib/private-asset-content";

export interface ResolvedAssetVideoProps
  extends Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> {
  src?: string | null;
  token?: string | null;
  enabled?: boolean;
  fallback?: ReactNode;
}

export function ResolvedAssetVideo({
  src,
  token,
  enabled = true,
  fallback = null,
  ...videoProps
}: ResolvedAssetVideoProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let objectUrl: string | null = null;

    setResolvedUrl(null);
    if (!enabled || !src || !token || !isPrivateAssetContentUrl(src)) {
      return () => controller.abort();
    }

    void fetchPrivateAssetBlob({
      logicalUrl: src,
      token,
      signal: controller.signal
    })
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      })
      .catch((error) => {
        if (!disposed && !isAbortError(error)) {
          setResolvedUrl(null);
        }
      });

    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, src, token]);

  if (!resolvedUrl) return <>{fallback}</>;
  return <video {...videoProps} src={resolvedUrl} />;
}
