import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: redirectMock
}));

describe("pricing page", () => {
  it("redirects /pricing to /plans", async () => {
    const { default: PricingPage } = await import("./page");
    PricingPage();
    expect(redirectMock).toHaveBeenCalledWith("/plans");
  });
});
