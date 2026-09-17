"use client";

import React, { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getPublicFaviconUrl } from "../lib/public-branding";
import { getDocumentTitle } from "../lib/site-title";
import { usePublicSettings } from "../lib/use-public-settings";

export function updateDynamicFavicon(
  faviconUrl: string | null,
  currentLink: HTMLLinkElement | null
): HTMLLinkElement | null {
  if (currentLink) {
    currentLink.remove();
  }

  if (!faviconUrl) {
    return null;
  }

  const newLink = document.createElement("link");
  newLink.rel = "icon";
  newLink.href = faviconUrl;
  document.head.appendChild(newLink);

  return newLink;
}

export function SiteTitleUpdater() {
  const publicSettings = usePublicSettings();
  const pathname = usePathname();
  const faviconLinkRef = useRef<HTMLLinkElement | null>(null);
  const configuredSiteTitle = publicSettings?.siteName;

  useEffect(() => {
    document.title = getDocumentTitle(configuredSiteTitle);
  }, [configuredSiteTitle, pathname]);

  useEffect(() => {
    const faviconUrl = getPublicFaviconUrl(publicSettings);
    faviconLinkRef.current = updateDynamicFavicon(
      faviconUrl,
      faviconLinkRef.current
    );
  }, [publicSettings]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (faviconLinkRef.current) {
        faviconLinkRef.current.remove();
        faviconLinkRef.current = null;
      }
    };
  }, []);

  return null;
}
