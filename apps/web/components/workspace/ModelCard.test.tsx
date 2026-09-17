import type { AiModelSummary } from "@ai-aggregate/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModelCard } from "./ModelCard";

const model = {
  id: "model_1",
  name: "Internal Model Name",
  displayName: "Friendly Model",
  slug: "internal-model",
  provider: "SUB2API",
  modelId: "provider/internal-model-id",
  capability: "chat",
  enabled: true,
  maxReferenceImages: 1,
  creditCost: 1,
  allowGuest: true,
  sortOrder: 0,
  group: "free",
  tags: ["free"],
  shortDescription: "A test model",
  isRecommended: true
} satisfies AiModelSummary & { displayName: string };

describe("ModelCard", () => {
  it("uses displayName for frontend model display without showing the internal name as the title", () => {
    const html = renderToStaticMarkup(
      <ModelCard
        model={model}
        isSelected={false}
        creditLabel="1 credit"
        accessLabel="Guest available"
        recommendedLabel="Recommended"
        onSelect={vi.fn()}
      />
    );

    expect(html).toContain("Friendly Model");
    expect(html).not.toContain("Internal Model Name</div>");
    expect(html).not.toContain("SUB2API");
  });

  it("renders iconUrl image before text fallbacks when present", () => {
    const html = renderToStaticMarkup(
      <ModelCard
        model={{
          ...model,
          iconUrl: "https://example.com/model.png",
          iconText: "TXT"
        }}
        isSelected={false}
        creditLabel="1 credit"
        accessLabel="Guest available"
        recommendedLabel="Recommended"
        onSelect={vi.fn()}
      />
    );

    expect(html).toContain('src="https://example.com/model.png"');
    expect(html).toContain('data-model-icon="true"');
    expect(html).not.toContain(">TXT<");
  });

  it("falls back to iconText when iconUrl is missing", () => {
    const html = renderToStaticMarkup(
      <ModelCard
        model={{
          ...model,
          iconText: "DS"
        }}
        isSelected={false}
        creditLabel="1 credit"
        accessLabel="Guest available"
        recommendedLabel="Recommended"
        onSelect={vi.fn()}
      />
    );

    expect(html).toContain('data-model-icon="true"');
    expect(html).toContain('data-model-icon-text="true"');
    expect(html).toContain(">DS<");
  });

  it("renders a default avatar when icon metadata and initials are missing", () => {
    const html = renderToStaticMarkup(
      <ModelCard
        model={{
          ...model,
          name: "",
          displayName: "",
          provider: "SUB2API"
        }}
        isSelected={false}
        creditLabel="1 credit"
        accessLabel="Guest available"
        recommendedLabel="Recommended"
        onSelect={vi.fn()}
      />
    );

    expect(html).toContain('data-model-icon="true"');
    expect(html).toContain('data-model-icon-default="true"');
    expect(html).not.toContain("SUB2API");
  });

  it("shows free model usage hint without saying credits are consumed", () => {
    const html = renderToStaticMarkup(
      <ModelCard
        model={{
          ...model,
          creditCost: 0
        }}
        isSelected={false}
        creditLabel="Free"
        accessLabel="Guest available"
        usageHint="Free model, good for trial and light use"
        recommendedLabel="Recommended"
        onSelect={vi.fn()}
      />
    );

    expect(html).toContain("Free");
    expect(html).toContain("Free model, good for trial and light use");
    expect(html).not.toContain("uses credits");
    expect(html).not.toContain("consumes credits");
  });
});
