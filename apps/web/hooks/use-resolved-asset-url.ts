"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPrivateAssetBlob,
  isAbortError,
  isPrivateAssetContentUrl,
  PrivateAssetContentError
} from "../lib/private-asset-content";

export type ResolvedAssetUrlError = "auth" | "not-found" | "unavailable" | null;

export interface UseResolvedAssetUrlOptions {
  src?: string | null;
  token?: string | null;
  enabled?: boolean;
}

export interface ResolvedAssetUrlState {
  resolvedUrl: string | null;
  loading: boolean;
  error: ResolvedAssetUrlError;
  isPrivate: boolean;
}

interface PrivateResolutionState {
  logicalUrl: string | null;
  token: string | null;
  resolvedUrl: string | null;
  loading: boolean;
  error: ResolvedAssetUrlError;
}

const emptyPrivateResolution: PrivateResolutionState = {
  logicalUrl: null,
  token: null,
  resolvedUrl: null,
  loading: false,
  error: null
};

function hasUsableToken(token: string | null | undefined): token is string {
  return typeof token === "string" && token.trim().length > 0;
}

function mapPrivateAssetError(error: unknown): Exclude<ResolvedAssetUrlError, null> {
  if (error instanceof PrivateAssetContentError) {
    if (error.code === "AUTH_REQUIRED") return "auth";
    if (error.code === "NOT_FOUND") return "not-found";
  }

  return "unavailable";
}

/**
 * Resolves persisted private logical asset URLs into short-lived browser Blob URLs.
 * Public, provider, data, and existing generated-asset URLs remain untouched.
 */
export function useResolvedAssetUrl({
  src,
  token,
  enabled = true
}: UseResolvedAssetUrlOptions): ResolvedAssetUrlState {
  const source = typeof src === "string" && src.trim().length > 0 ? src : null;
  const isPrivate = isPrivateAssetContentUrl(source);
  const usableToken = hasUsableToken(token);
  const blobUrlRef = useRef<string | null>(null);
  const [privateResolution, setPrivateResolution] = useState<PrivateResolutionState>(emptyPrivateResolution);

  const revokeBlobUrl = useCallback(() => {
    const blobUrl = blobUrlRef.current;
    if (blobUrl !== null) {
      URL.revokeObjectURL(blobUrl);
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isPrivate) {
      revokeBlobUrl();
      setPrivateResolution(emptyPrivateResolution);
      return;
    }

    if (!enabled) {
      revokeBlobUrl();
      setPrivateResolution(emptyPrivateResolution);
      return;
    }

    if (!usableToken || source === null) {
      revokeBlobUrl();
      setPrivateResolution(emptyPrivateResolution);
      return;
    }

    const abortController = new AbortController();
    let active = true;
    revokeBlobUrl();
    setPrivateResolution({
      logicalUrl: source,
      token,
      resolvedUrl: null,
      loading: true,
      error: null
    });

    void fetchPrivateAssetBlob({
      logicalUrl: source,
      token,
      signal: abortController.signal
    })
      .then((blob) => {
        if (!active) return;

        revokeBlobUrl();
        const resolvedUrl = URL.createObjectURL(blob);
        blobUrlRef.current = resolvedUrl;
        setPrivateResolution({
          logicalUrl: source,
          token,
          resolvedUrl,
          loading: false,
          error: null
        });
      })
      .catch((error: unknown) => {
        if (!active) return;

        if (isAbortError(error)) {
          setPrivateResolution({
            logicalUrl: source,
            token,
            resolvedUrl: null,
            loading: false,
            error: null
          });
          return;
        }

        setPrivateResolution({
          logicalUrl: source,
          token,
          resolvedUrl: null,
          loading: false,
          error: mapPrivateAssetError(error)
        });
      });

    return () => {
      active = false;
      abortController.abort();
      revokeBlobUrl();
    };
  }, [enabled, isPrivate, revokeBlobUrl, source, token, usableToken]);

  if (source === null) {
    return { resolvedUrl: null, loading: false, error: null, isPrivate: false };
  }

  if (!isPrivate) {
    return { resolvedUrl: source, loading: false, error: null, isPrivate: false };
  }

  if (!enabled) {
    return { resolvedUrl: null, loading: false, error: null, isPrivate: true };
  }

  if (!usableToken) {
    return { resolvedUrl: null, loading: false, error: "auth", isPrivate: true };
  }

  if (privateResolution.logicalUrl !== source || privateResolution.token !== token) {
    return { resolvedUrl: null, loading: true, error: null, isPrivate: true };
  }

  return {
    resolvedUrl: privateResolution.resolvedUrl,
    loading: privateResolution.loading,
    error: privateResolution.error,
    isPrivate: true
  };
}
