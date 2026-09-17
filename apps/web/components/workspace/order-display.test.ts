import { describe, expect, it } from "vitest";
import { formatOrderPrice } from "./order-display";

describe("order display helpers", () => {
  it("formats integer-cent order amounts as yuan with two decimals", () => {
    expect(formatOrderPrice(10, "Free")).toBe("¥0.10");
    expect(formatOrderPrice(20, "Free")).toBe("¥0.20");
    expect(formatOrderPrice(990, "Free")).toBe("¥9.90");
  });

  it("keeps zero amounts using the localized free label", () => {
    expect(formatOrderPrice(0, "Free")).toBe("Free");
  });
});
