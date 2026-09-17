import { describe, expect, it } from "vitest";
import { validateAccountNickname } from "./account-profile";

describe("account profile nickname rules", () => {
  it("trims and accepts a changed nickname", () => {
    expect(validateAccountNickname("  New name  ", "Old name")).toEqual({
      valid: true,
      value: "New name",
      changed: true
    });
  });

  it("does not persist an unchanged nickname", () => {
    expect(validateAccountNickname("  Same name ", "Same name")).toEqual({
      valid: true,
      value: "Same name",
      changed: false
    });
  });

  it("rejects blank and out-of-range nicknames", () => {
    expect(validateAccountNickname("   ", "Old")).toEqual({ valid: false, reason: "empty" });
    expect(validateAccountNickname("x", "Old")).toEqual({ valid: false, reason: "length" });
    expect(validateAccountNickname("x".repeat(31), "Old")).toEqual({ valid: false, reason: "length" });
  });
});
