import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CanvasPage from "./page";

vi.mock("./creator-canvas-page-content", () => ({
  CreatorCanvasPageContent: () => (
    <main data-existing-b2-b-canvas-foundation="true" />
  )
}));

describe("CanvasPage", () => {
  it("renders the existing B2-B Canvas foundation at the canonical route", () => {
    const html = renderToStaticMarkup(<CanvasPage />);

    expect(html).toContain('data-existing-b2-b-canvas-foundation="true"');
  });
});
