import { readStoredAuthState } from "../components/auth-state";

export const imageCreationHandoffSchemaVersion = 1 as const;
export const imageCreationHandoffIntent = "continue-image-creation" as const;
export const imageCreationHandoffStorageKey =
  "ai-aggregate:image-creation-handoff:v1";
export const imageCreationHandoffChangeEvent =
  "ai-aggregate:image-creation-handoff-change";
export const imageCreationHandoffTtlMs = 5 * 60 * 1000;

export type ImageCreationHandoffV1 = {
  schemaVersion: typeof imageCreationHandoffSchemaVersion;
  intent: typeof imageCreationHandoffIntent;
  assetId: string;
  issuedAt: number;
};

function isValidAssetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isValidIssuedAt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function resolveAccountId(accountId: string | null | undefined): string | null {
  if (accountId !== undefined) {
    return accountId?.trim() || null;
  }

  try {
    return readStoredAuthState(window.localStorage).user?.id ?? null;
  } catch {
    return null;
  }
}

export function getImageCreationHandoffStorageKey(
  accountId?: string | null
): string {
  if (typeof window === "undefined") {
    return imageCreationHandoffStorageKey;
  }

  const resolvedAccountId = resolveAccountId(accountId);
  return resolvedAccountId
    ? `${imageCreationHandoffStorageKey}:account-${encodeURIComponent(resolvedAccountId)}`
    : imageCreationHandoffStorageKey;
}

function notifyImageCreationHandoffChange(): void {
  try {
    window.dispatchEvent(new Event(imageCreationHandoffChangeEvent));
  } catch {
    // Event dispatch is best effort; the destination page also reads on mount.
  }
}

export function parseImageCreationHandoff(
  rawValue: string | null,
  now = Date.now()
): ImageCreationHandoffV1 | null {
  if (typeof rawValue !== "string" || !Number.isFinite(now)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (
      keys.length !== 4 ||
      keys[0] !== "assetId" ||
      keys[1] !== "intent" ||
      keys[2] !== "issuedAt" ||
      keys[3] !== "schemaVersion"
    ) {
      return null;
    }

    if (
      record.schemaVersion !== imageCreationHandoffSchemaVersion ||
      record.intent !== imageCreationHandoffIntent ||
      !isValidAssetId(record.assetId) ||
      !isValidIssuedAt(record.issuedAt)
    ) {
      return null;
    }

    if (
      record.issuedAt > now + imageCreationHandoffTtlMs ||
      now - record.issuedAt >= imageCreationHandoffTtlMs
    ) {
      return null;
    }

    return {
      schemaVersion: imageCreationHandoffSchemaVersion,
      intent: imageCreationHandoffIntent,
      assetId: record.assetId,
      issuedAt: record.issuedAt
    };
  } catch {
    return null;
  }
}

export function readImageCreationHandoff(
  now = Date.now()
): ImageCreationHandoffV1 | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return parseImageCreationHandoff(
      window.sessionStorage.getItem(getImageCreationHandoffStorageKey()),
      now
    );
  } catch {
    return null;
  }
}

export function writeImageCreationHandoff(
  assetId: string,
  issuedAt = Date.now()
): boolean {
  if (!isValidAssetId(assetId) || !isValidIssuedAt(issuedAt)) {
    return false;
  }

  const descriptor: ImageCreationHandoffV1 = {
    schemaVersion: imageCreationHandoffSchemaVersion,
    intent: imageCreationHandoffIntent,
    assetId,
    issuedAt
  };

  try {
    if (typeof window === "undefined") {
      return false;
    }
    const storageKey = getImageCreationHandoffStorageKey();
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify(descriptor)
    );
    if (storageKey !== imageCreationHandoffStorageKey) {
      // Do not allow an older unscoped descriptor to be consumed by a guest.
      window.sessionStorage.removeItem(imageCreationHandoffStorageKey);
    }
    notifyImageCreationHandoffChange();
    return true;
  } catch {
    return false;
  }
}

export function clearImageCreationHandoff(accountId?: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(getImageCreationHandoffStorageKey(accountId));
    window.sessionStorage.removeItem(imageCreationHandoffStorageKey);
    notifyImageCreationHandoffChange();
  } catch {
    // Browser storage can be unavailable; clearing is best effort.
  }
}
