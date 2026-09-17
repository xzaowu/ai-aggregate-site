const yuanPattern = /^\d+(?:\.\d{1,2})?$/;

export function parsePlanYuanInputToCents(value: string): number | null {
  const trimmed = value.trim();

  if (!yuanPattern.test(trimmed)) {
    return null;
  }

  const [yuanPart, centPart = ""] = trimmed.split(".");
  const yuan = Number(yuanPart);

  if (!Number.isSafeInteger(yuan)) {
    return null;
  }

  const cents = Number(centPart.padEnd(2, "0"));
  const total = yuan * 100 + cents;

  return Number.isSafeInteger(total) ? total : null;
}

export function formatPlanCentsForInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatPlanCentsForDisplay(
  cents: number,
  freeLabel: string
): string {
  return cents === 0 ? freeLabel : `¥${formatPlanCentsForInput(cents)}`;
}
