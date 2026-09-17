import { describe, expect, it } from "vitest";
import {
  formatPlanCentsForDisplay,
  formatPlanCentsForInput,
  parsePlanYuanInputToCents
} from "./admin-plan-price";

describe("admin plan price helpers", () => {
  it("parses yuan input into integer cents", () => {
    expect(parsePlanYuanInputToCents("0.01")).toBe(1);
    expect(parsePlanYuanInputToCents("9.90")).toBe(990);
  });

  it("formats integer cents back to yuan input and display text", () => {
    expect(formatPlanCentsForInput(990)).toBe("9.90");
    expect(formatPlanCentsForDisplay(990, "Free")).toBe("¥9.90");
    expect(formatPlanCentsForDisplay(0, "Free")).toBe("Free");
  });

  it("rejects invalid or sub-cent yuan input", () => {
    expect(parsePlanYuanInputToCents("-1")).toBeNull();
    expect(parsePlanYuanInputToCents("0.001")).toBeNull();
    expect(parsePlanYuanInputToCents("abc")).toBeNull();
  });
});
