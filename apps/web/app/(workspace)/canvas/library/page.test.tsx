import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "app/(workspace)/canvas/library/page.tsx"),
  "utf8"
);

describe("Canvas library route", () => {
  it("keeps the library route as a thin normal-workspace page", () => {
    expect(source).toContain("CreatorCanvasLibraryPageContent");
    expect(source).not.toContain("CreatorCanvasPageContent");
  });
});
