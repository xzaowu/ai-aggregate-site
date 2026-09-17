import { describe, expect, it } from "vitest";
import { buildLoginRedirectUrl } from "./login-redirect";

describe("login compatibility route", () => {
  it("preserves auth mode and returnTo for the workspace shell", () => {
    expect(buildLoginRedirectUrl("?returnTo=%2Fhelp")).toBe(
      "/?auth=login&returnTo=%2Fhelp"
    );
    expect(buildLoginRedirectUrl("?auth=register&returnTo=%2Faccount")).toBe(
      "/?auth=register&returnTo=%2Faccount"
    );
  });
});
