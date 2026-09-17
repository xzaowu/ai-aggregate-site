import { describe, expect, it } from "vitest";
import { DEFAULT_DOCUMENT_TITLE, getDocumentTitle } from "./site-title";

describe("site title helpers", () => {
  it("uses configured site name when it is present", () => {
    expect(getDocumentTitle("Chat Azyk")).toBe("Chat Azyk");
  });

  it("falls back to the current default title when configured site name is empty", () => {
    expect(getDocumentTitle("")).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(getDocumentTitle("   ")).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(getDocumentTitle(undefined)).toBe(DEFAULT_DOCUMENT_TITLE);
  });
});
