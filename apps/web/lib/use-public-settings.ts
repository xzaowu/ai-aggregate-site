"use client";

import type { PublicSiteSettings } from "@ai-aggregate/shared";
import { useEffect, useState } from "react";
import { apiUrl } from "./site-config";

export function usePublicSettings() {
  const [settings, setSettings] = useState<PublicSiteSettings | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const response = await fetch(apiUrl("/settings/public"), { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          settings?: PublicSiteSettings;
        };

        if (isMounted) {
          setSettings(data.settings ?? null);
        }
      } catch {
        if (isMounted) {
          setSettings(null);
        }
      }
    }

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  return settings;
}
