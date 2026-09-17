import {
  isSafePublicImagePromptCardUrl,
  type PublicSiteSettings
} from "@ai-aggregate/shared";

export interface WorkspacePromptCard {
  title: string;
  description: string;
  prompt: string;
}

export interface ImagePromptCard extends WorkspacePromptCard {
  imageUrl?: string;
}

export function parseWorkspacePromptCards(
  value: string | undefined,
  fallback: WorkspacePromptCard[]
): WorkspacePromptCard[] {
  const raw = value?.trim();

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const cards = parsed
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const title = stringValue(item.title);
        const description = stringValue(item.description);
        const prompt = stringValue(item.prompt);

        if (!title || !description || !prompt) {
          return null;
        }

        return { title, description, prompt };
      })
      .filter((item): item is WorkspacePromptCard => item !== null);

    return cards.length > 0 && cards.length === parsed.length ? cards : fallback;
  } catch {
    return fallback;
  }
}

export function parseImagePromptCards(
  value: string | undefined,
  fallback: WorkspacePromptCard[]
): ImagePromptCard[] {
  const raw = value?.trim();

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const cards = parsed
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const title = stringValue(item.title);
        const description = stringValue(item.description);
        const prompt = stringValue(item.prompt);
        const rawImageUrl = item.imageUrl;
        const imageUrl = stringValue(rawImageUrl);

        if (
          !title ||
          !description ||
          !prompt ||
          (rawImageUrl !== undefined &&
            (typeof rawImageUrl !== "string" ||
              (imageUrl.length > 0 && !isSafePublicImagePromptCardUrl(imageUrl))))
        ) {
          return null;
        }

        return imageUrl ? { title, description, prompt, imageUrl } : { title, description, prompt };
      })
      .filter((item): item is ImagePromptCard => item !== null);

    return cards.length === parsed.length ? cards : fallback;
  } catch {
    return fallback;
  }
}

export function resolveWorkspaceHero(
  settings: Pick<
    PublicSiteSettings,
    "workspaceTitle" | "workspaceSubtitle" | "workspaceHeroTitle" | "workspaceHeroSubtitle"
  > | null | undefined,
  fallback: { title: string; subtitle: string }
) {
  const title =
    settings?.workspaceTitle?.trim() || settings?.workspaceHeroTitle?.trim();
  const subtitle =
    settings?.workspaceSubtitle?.trim() ||
    settings?.workspaceHeroSubtitle?.trim();

  return {
    title: title || fallback.title,
    subtitle: subtitle || fallback.subtitle
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
