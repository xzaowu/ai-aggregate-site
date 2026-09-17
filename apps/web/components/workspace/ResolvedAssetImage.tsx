"use client";

import React, {
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type ReactNode
} from "react";
import { useResolvedAssetUrl } from "../../hooks/use-resolved-asset-url";

export interface ResolvedAssetImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null;
  token?: string | null;
  enabled?: boolean;
  fallback?: ReactNode;
  onResolvedClick?: (resolvedUrl: string) => void;
}

/**
 * Renders public asset URLs directly and private logical URLs only after Blob resolution.
 */
export function ResolvedAssetImage({
  src,
  token,
  enabled = true,
  fallback = null,
  onResolvedClick,
  ...imageProps
}: ResolvedAssetImageProps) {
  const { resolvedUrl } = useResolvedAssetUrl({ src, token, enabled });

  if (resolvedUrl === null) {
    return <>{fallback}</>;
  }

  if (!onResolvedClick) {
    return <img {...imageProps} src={resolvedUrl} />;
  }

  return (
    <img
      {...imageProps}
      src={resolvedUrl}
      onClick={(event) => {
        imageProps.onClick?.(event);
        if (!event.defaultPrevented) {
          onResolvedClick(resolvedUrl);
        }
      }}
    />
  );
}

export function LazyResolvedAssetImage({
  containerClassName = "",
  fallback = null,
  rootMargin = "320px 0px",
  src,
  ...imageProps
}: ResolvedAssetImageProps & {
  containerClassName?: string;
  rootMargin?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    if (!src || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    setIsNearViewport(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    const container = containerRef.current;
    if (container) {
      observer.observe(container);
    }

    return () => observer.disconnect();
  }, [rootMargin, src]);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      data-lazy-resolved-asset-image={isNearViewport ? "active" : "pending"}
    >
      {isNearViewport ? (
        <ResolvedAssetImage src={src} fallback={fallback} {...imageProps} />
      ) : (
        fallback
      )}
    </div>
  );
}
