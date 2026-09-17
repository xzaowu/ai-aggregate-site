"use client";

import { useEffect, useState } from "react";

export type ResponsiveWorkspaceMode = "desktop" | "mobile";

/**
 * Keeps responsive workspace variants from mounting two copies of private
 * asset images. The null initial state is intentional so SSR and hydration
 * render the same bounded loading shell before the viewport is known.
 */
export function useResponsiveWorkspaceMode(): ResponsiveWorkspaceMode | null {
  const [mode, setMode] = useState<ResponsiveWorkspaceMode | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      const update = () => {
        setMode(window.innerWidth < 768 ? "mobile" : "desktop");
      };

      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const update = () => {
      setMode(mediaQuery.matches ? "desktop" : "mobile");
    };

    update();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", update);
    } else {
      mediaQuery.addListener(update);
    }
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", update);
      } else {
        mediaQuery.removeListener(update);
      }
    };
  }, []);

  return mode;
}
