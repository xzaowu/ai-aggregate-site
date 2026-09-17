export const DEFAULT_DOCUMENT_TITLE = "AI Aggregate MVP";

export function getDocumentTitle(siteName: string | null | undefined): string {
  const trimmed = siteName?.trim();
  return trimmed ? trimmed : DEFAULT_DOCUMENT_TITLE;
}
