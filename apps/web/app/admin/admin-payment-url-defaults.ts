export interface RecommendedEpayUrlInput {
  appUrl?: string | null;
  currentOrigin?: string | null;
}

export interface RecommendedEpayUrls {
  notifyUrl: string;
  returnUrl: string;
}

export function getRecommendedEpayUrls({
  appUrl,
  currentOrigin
}: RecommendedEpayUrlInput): RecommendedEpayUrls {
  const origin = normalizeOrigin(appUrl) || normalizeOrigin(currentOrigin);

  return {
    notifyUrl: origin ? `${origin}/api/payments/epay/notify` : "",
    returnUrl: origin ? `${origin}/payment/result` : ""
  };
}

export function completeEpayUrlsForSave({
  enabled,
  notifyUrl,
  returnUrl,
  recommended
}: {
  enabled: boolean;
  notifyUrl: string;
  returnUrl: string;
  recommended: RecommendedEpayUrls;
}): RecommendedEpayUrls {
  return {
    notifyUrl:
      enabled && notifyUrl.trim().length === 0
        ? recommended.notifyUrl
        : notifyUrl.trim(),
    returnUrl:
      enabled && returnUrl.trim().length === 0
        ? recommended.returnUrl
        : returnUrl.trim()
  };
}

function normalizeOrigin(value?: string | null): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}
