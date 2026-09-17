export type NicknameValidation =
  | { valid: true; value: string; changed: boolean }
  | { valid: false; reason: "empty" | "length" };

export function validateAccountNickname(
  draft: string,
  current: string
): NicknameValidation {
  const value = draft.trim();
  if (!value) return { valid: false, reason: "empty" };
  if (value.length < 2 || value.length > 30) {
    return { valid: false, reason: "length" };
  }
  return { valid: true, value, changed: value !== current.trim() };
}
