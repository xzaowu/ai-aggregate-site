"use client";

import type { LinkEntry } from "@ai-aggregate/shared";
import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "./site-config";

const publicWorkspaceCategories = new Set(["api", "resource", "friend"]);

export function sortPublicLinks(links: LinkEntry[]): LinkEntry[] {
  return [...links]
    .filter((link) => link.enabled)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }

      return a.title.localeCompare(b.title);
    });
}

export function publicLinksByCategory(
  links: LinkEntry[],
  categories: readonly string[]
): LinkEntry[] {
  const allowed = new Set(categories);
  return sortPublicLinks(links).filter((link) => allowed.has(link.category));
}

export function publicWorkspaceLinks(links: LinkEntry[]): LinkEntry[] {
  return sortPublicLinks(links).filter((link) =>
    publicWorkspaceCategories.has(link.category)
  );
}

export function usePublicLinks(): LinkEntry[] {
  const [links, setLinks] = useState<LinkEntry[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const response = await fetch(apiUrl("/links"));
        if (!response.ok) return;
        const data = (await response.json()) as { links?: LinkEntry[] };

        if (isMounted) {
          setLinks(sortPublicLinks(data.links ?? []));
        }
      } catch {
        // Public links are optional content.
      }
    }

    void load();
    return () => {
      isMounted = false;
    };
  }, []);

  return useMemo(() => sortPublicLinks(links), [links]);
}
