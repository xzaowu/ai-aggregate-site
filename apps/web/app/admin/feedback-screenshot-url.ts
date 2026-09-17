import { validateFeedbackScreenshotUrl } from "@ai-aggregate/shared";

export function getSafeFeedbackScreenshotUrl(
  screenshotUrl: string | null | undefined
): string | null {
  const validation = validateFeedbackScreenshotUrl(screenshotUrl);
  return validation.valid ? validation.value ?? null : null;
}
