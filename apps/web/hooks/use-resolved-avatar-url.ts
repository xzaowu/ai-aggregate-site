"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPrivateAvatarBlob,
  isAbortError,
  isPrivateAvatarContentUrl,
  PrivateAvatarContentError,
  resolvePublicAvatarUrl
} from "../lib/private-avatar-content";

export type ResolvedAvatarUrlError = "auth" | "not-found" | "unavailable" | null;

export interface UseResolvedAvatarUrlOptions {
  src?: string | null;
  token?: string | null;
  enabled?: boolean;
}

export interface ResolvedAvatarUrlState {
  resolvedUrl: string | null;
  loading: boolean;
  error: ResolvedAvatarUrlError;
  isPrivate: boolean;
}

interface PrivateResolutionState {
  logicalUrl: string | null;
  token: string | null;
  resolvedUrl: string | null;
  loading: boolean;
  error: ResolvedAvatarUrlError;
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

function mapPrivateAvatarError(error: unknown): Exclude<ResolvedAvatarUrlError, null> {
  if (error instanceof PrivateAvatarContentError) {
    if (error.code === "AUTH_REQUIRED") return "auth";
    if (error.code === "NOT_FOUND") return "not-found";
  }

  return "unavailable";
}

/**
 * Resolves current-user private StorageObject avatar URLs through an
 * authenticated Blob request. Every Blob URL is revoked on replacement and
 * unmount; public/legacy avatars retain direct image delivery.
 */
export function useResolvedAvatarUrl({
  src,
  token,
  enabled = true
}: UseResolvedAvatarUrlOptions): ResolvedAvatarUrlState {
  const source = typeof src === "string" && src.trim().length > 0 ? src : null;
  const isPrivate = isPrivateAvatarContentUrl(source);
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
    if (!isPrivate || !enabled || !usableToken || source === null) {
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

    void fetchPrivateAvatarBlob({ token, signal: abortController.signal })
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

        setPrivateResolution({
          logicalUrl: source,
          token,
          resolvedUrl: null,
          loading: false,
          error: isAbortError(error) ? null : mapPrivateAvatarError(error)
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
    return {
      resolvedUrl: resolvePublicAvatarUrl(source),
      loading: false,
      error: null,
      isPrivate: false
    };
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
