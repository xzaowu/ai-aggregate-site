import type { PublicSiteSettings } from "@ai-aggregate/shared";
import { siteConfig } from "./site-config";

export function getPublicSiteName(settings: PublicSiteSettings | null | undefined): string {
  return settings?.siteName?.trim() || siteConfig.siteName;
}

export function getPublicLogoText(settings: PublicSiteSettings | null | undefined): string {
  const configured = settings?.siteLogoText?.trim();

  if (configured) {
    return configured.slice(0, 8);
  }

  const siteName = getPublicSiteName(settings);
  return siteName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase() || "AI";
}

export function getSafePublicUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return trimmed.startsWith("//") ? null : trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

export function getPublicLogoUrl(settings: PublicSiteSettings | null | undefined): string | null {
  return getSafePublicUrl(settings?.siteLogoUrl);
}

export function getPublicFaviconUrl(settings: PublicSiteSettings | null | undefined): string | null {
  return getSafePublicUrl(settings?.siteFaviconUrl);
}

export function getPublicWorkspaceIconUrl(settings: PublicSiteSettings | null | undefined): string | null {
  return getSafePublicUrl(settings?.workspaceIconUrl) ?? getPublicLogoUrl(settings);
}

export function getFooterCopyright(
  settings: PublicSiteSettings | null | undefined
): string | null {
  return settings?.footerCopyright?.trim() || null;
}

export function parseFooterLinksJson(
  value: string | null | undefined
): Array<{ label: string; href: string }> {
  const raw = value?.trim();

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        !("label" in item) ||
        !("href" in item) ||
        typeof item.label !== "string" ||
        typeof item.href !== "string"
      ) {
        return [];
      }

      const href = getSafePublicUrl(item.href);
      const label = item.label.trim();

      return label && href ? [{ label, href }] : [];
    });
  } catch {
    return [];
  }
}
