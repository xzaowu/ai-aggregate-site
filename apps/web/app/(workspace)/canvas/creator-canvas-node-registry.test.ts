import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import type {
  CreatorContentNode,
  CreatorContentNodeKind
} from "./creator-canvas-document";
import {
  CREATOR_CANVAS_NODE_DEFINITIONS,
  CREATOR_CANVAS_NODE_KINDS
} from "./creator-canvas-node-registry";
import type { CreatorImageNodeExecutionView } from "./creator-image-execution-state";
import type { CreatorVideoAssetDisplayState } from "./creator-video-asset-display";
import type { CreatorVideoNodeExecutionView } from "./creator-video-composer-panel";

vi.mock("@xyflow/react", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    Position: { Left: "left", Right: "right" },
    NodeToolbar: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
    Handle: ({
      id,
      type,
      ...props
    }: {
      id: string;
      type: string;
      [key: string]: unknown;
    }) => ReactModule.createElement("span", {
      "data-handle-id": id,
      "data-handle-type": type,
      "data-creator-canvas-handle": props["data-creator-canvas-handle"],
      "aria-label": props["aria-label"]
    })
  };
});

const domainNodes = {
  text: { id: "text", kind: "text", position: { x: 0, y: 0 }, data: { text: "hello" } },
  image: { id: "image", kind: "image", position: { x: 0, y: 0 }, data: { assetId: null } },
  video: { id: "video", kind: "video", position: { x: 0, y: 0 }, data: { assetId: null } }
} as const;

function renderNode(
  kind: CreatorContentNodeKind,
  domainNode: CreatorContentNode = domainNodes[kind],
  imageExecution: CreatorImageNodeExecutionView | null = null,
  assetToken: string | null = null,
  videoExecution: CreatorVideoNodeExecutionView | null = null,
  selected = false,
  videoAssetDisplay?: CreatorVideoAssetDisplayState
): string {
  const Component = CREATOR_CANVAS_NODE_DEFINITIONS[kind].component;
  return renderToStaticMarkup(React.createElement(
    I18nContext.Provider,
    { value: { locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") } },
    React.createElement(Component, {
      id: domainNode.id,
      type: kind,
      data: {
        domainNode,
        actions: {
          onTextChange: vi.fn(),
          onChooseExistingImageAsset: vi.fn(),
          onReplaceExistingImageAsset: vi.fn()
        },
        assetToken,
        imageExecution,
        videoAssetDisplay,
        videoExecution
      },
      selected,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0
    })
  ));
}

describe("Creator Canvas content node registry", () => {
  it("has exactly the three content-node kinds", () => {
    expect(CREATOR_CANVAS_NODE_KINDS).toEqual(["text", "image", "video"]);
    expect(Object.isFrozen(CREATOR_CANVAS_NODE_DEFINITIONS)).toBe(true);
    for (const definition of Object.values(CREATOR_CANVAS_NODE_DEFINITIONS)) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(definition).not.toHaveProperty("providerId");
      expect(definition).not.toHaveProperty("routeId");
      expect(definition).not.toHaveProperty("runtime");
    }
  });

  it("keeps content cards compact for spatial composition", () => {
    expect(CREATOR_CANVAS_NODE_DEFINITIONS.text.defaultWidth).toBe(320);
    expect(CREATOR_CANVAS_NODE_DEFINITIONS.image.defaultWidth).toBe(320);
    expect(CREATOR_CANVAS_NODE_DEFINITIONS.video.defaultWidth).toBe(336);
  });

  it("renders Markdown-first compact Text and neutral empty Image/Video cards", () => {
    const text = renderNode("text");
    const image = renderNode("image");
    const video = renderNode("video");

    expect(text).toContain('data-creator-canvas-text-preview="true"');
    expect(text).toContain("hello");
    expect(text).toContain('data-creator-canvas-text-character-count="true"');
    expect(text).not.toContain("<textarea");
    expect(text).not.toContain("maxlength=");
    expect(text).not.toContain("overflow-y-auto");
    expect(image).toContain('data-creator-canvas-empty-state="image"');
    expect(image).toContain("Empty image");
    expect(image).not.toContain("data-creator-image-node-toolbar");
    expect(image).not.toContain("data-creator-image-composer");
    expect(video).toContain('data-creator-canvas-empty-state="video"');
    expect(video).toContain("Empty video");
    expect(`${text}${image}${video}`).not.toContain("Coming soon");
  });

  it("renders Text Markdown syntax as a bounded preview instead of source", () => {
    const text = renderNode("text", {
      ...domainNodes.text,
      data: { text: "## Heading\n\n**bold**\n\n- item" }
    });

    expect(text).toContain("<h2");
    expect(text).toContain("<strong>bold</strong>");
    expect(text).toContain("<ul>");
    expect(text).not.toContain("## Heading");
    expect(text).not.toContain("**bold**");
    expect(text).not.toContain('data-creator-canvas-text-preview-scroll="true"');
  });

  it("keeps compact Text Markdown passive for wide tables and fenced code", () => {
    const text = renderNode("text", {
      ...domainNodes.text,
      data: {
        text: [
          "| Wide heading | Another wide heading |",
          "| --- | --- |",
          "| wrapped table value | another wrapped table value |",
          "",
          "```ts",
          `const longLine = "${"x".repeat(180)}";`,
          "```"
        ].join("\n")
      }
    });

    expect(text).toContain('data-markdown-code-compact="true"');
    expect(text).not.toContain("overflow-x-auto");
    expect(text).not.toContain("overflow-y-auto");
    expect(text).not.toContain("data-markdown-copy-button");
  });

  it("keeps empty Text truthful without an editor or nested scrollbar", () => {
    const text = renderNode("text", {
      ...domainNodes.text,
      data: { text: "" }
    });

    expect(text).toContain('data-creator-canvas-text-placeholder="true"');
    expect(text).toContain("Write text");
    expect(text).not.toContain("<textarea");
    expect(text).not.toContain("overflow-y-auto");
  });

  it("keeps bind selection on EMPTY Image and exposes replace only on BOUND Image", () => {
    const empty = renderNode("image", domainNodes.image, null, "owner-token");
    const bound = renderNode("image", {
      ...domainNodes.image,
      data: { assetId: "bound-image-id" }
    }, null, "owner-token");

    expect(empty).toContain("Choose from works");
    expect(empty).toContain('data-creator-canvas-asset-picker-action="choose"');
    expect(empty).toContain("nodrag nopan nowheel");
    expect(empty).not.toContain("data-creator-image-node-toolbar");
    expect(bound).not.toContain("Choose from works");
    expect(bound).toContain("Replace work");
    expect(bound).toContain('data-creator-canvas-asset-picker-action="replace"');
    expect(bound).not.toContain('data-creator-canvas-asset-picker-action="choose"');
  });

  it("keeps the EMPTY Image action truthful when unauthenticated", () => {
    const empty = renderNode("image");

    expect(empty).toContain("Choose from works");
    expect(empty).toContain('data-creator-canvas-asset-picker-login-required="true"');
    expect(empty).toContain("Login required");
    expect(empty).toContain("disabled");
  });

  it("keeps BOUND replacement truthful when unauthenticated", () => {
    const bound = renderNode("image", {
      ...domainNodes.image,
      data: { assetId: "bound-image-id" }
    });

    expect(bound).toContain('data-creator-canvas-asset-picker-action="replace"');
    expect(bound).toContain("Login required");
    expect(bound).toContain('data-creator-canvas-asset-picker-login-required="true"');
    expect(bound).toContain("disabled");
  });

  it.each([
    ["generating", true],
    ["checking", true],
    ["unresolved", true],
    ["failed", false],
    ["idle", false]
  ] as const)("allows BOUND replace only outside active execution: %s", (status, disabled) => {
    const bound = renderNode("image", {
      ...domainNodes.image,
      data: { assetId: "bound-image-id" }
    }, status === "idle" ? null : { status });

    const replaceButton = `data-creator-canvas-asset-picker-action="replace"`;
    expect(bound).toContain(replaceButton);
    if (disabled) expect(bound).toContain("disabled");
    else expect(bound).not.toMatch(new RegExp(`${replaceButton}[^>]*disabled`));
  });

  it("does not expose replacement on Text or Video nodes", () => {
    const text = renderNode("text");
    const video = renderNode("video", {
      ...domainNodes.video,
      data: { assetId: "bound-video-id" }
    });

    expect(text).not.toContain("Replace work");
    expect(video).not.toContain("Replace work");
  });

  it("distinguishes bound media without exposing raw asset ids", () => {
    const image = renderNode("image", {
      ...domainNodes.image,
      data: { assetId: "internal-image-id" }
    });
    const video = renderNode("video", {
      ...domainNodes.video,
      data: { assetId: "internal-video-id" }
    });

    expect(image).toContain('data-creator-canvas-media-state="bound"');
    expect(image).toContain("Image attached");
    expect(image).not.toContain("internal-image-id");
    expect(video).toContain('data-creator-canvas-media-state="bound"');
    expect(video).toContain("Video attached");
    expect(video).not.toContain("internal-video-id");
  });

  it("keeps EMPTY and BOUND previews beneath a generating overlay", () => {
    const empty = renderNode("image", domainNodes.image, {
      status: "generating"
    });
    const bound = renderNode("image", {
      ...domainNodes.image,
      data: { assetId: "bound-image-id" }
    }, { status: "generating" });

    expect(empty).toContain('data-creator-canvas-media-state="empty"');
    expect(empty).toContain("Empty image");
    expect(empty).toContain('data-creator-image-node-execution="generating"');
    expect(empty).toContain("Generating…");
    expect(bound).toContain('data-creator-canvas-media-state="bound"');
    expect(bound).toContain("Image attached");
    expect(bound).toContain('data-creator-image-node-execution="generating"');
    expect(bound).not.toContain("bound-image-id");
  });

  it("renders accessible checking, unresolved, and generic failed node states", () => {
    const checking = renderNode("image", domainNodes.image, {
      status: "checking"
    });
    const unresolved = renderNode("image", domainNodes.image, {
      status: "unresolved"
    });
    const failed = renderNode("image", domainNodes.image, {
      status: "failed"
    });

    expect(checking).toContain('data-creator-image-node-execution="checking"');
    expect(checking).toContain("Checking result…");
    expect(unresolved).toContain('data-creator-image-node-execution="unresolved"');
    expect(unresolved).toContain("Needs confirmation");
    expect(unresolved).toContain('role="status"');
    expect(unresolved).not.toContain("Resume");
    expect(failed).toContain('data-creator-image-node-execution="failed"');
    expect(failed).toContain("Generation failed");
    expect(failed).not.toContain("Safe reconciled failure");
    expect(failed).not.toContain('role="alert"');
  });

  it("does not render Image execution presentation on Text or Video nodes", () => {
    const text = renderNode("text", domainNodes.text, { status: "failed" });
    const video = renderNode("video", domainNodes.video, { status: "checking" });

    expect(text).not.toContain("data-creator-image-node-execution");
    expect(video).not.toContain("data-creator-image-node-execution");
  });

  it("renders a compact Video media card without the full Composer NodeToolbar", () => {
    const videoExecution: CreatorVideoNodeExecutionView = {
      status: "checking",
      progress: 42,
      taskId: "video-task-1",
      errorMessage: null
    };
    const video = renderNode(
      "video",
      domainNodes.video,
      null,
      "owner-token",
      videoExecution
    );

    expect(video).toContain('data-creator-video-node-execution="checking"');
    expect(video).toContain("Checking video status…");
    expect(video).toContain("42%");
    expect(video).toContain('data-creator-canvas-media-state="empty"');
    expect(video).not.toContain('data-creator-video-node-toolbar="true"');
    expect(video).not.toContain('data-creator-video-composer="true"');
    expect(video).not.toContain("<textarea");
    expect(video).not.toContain("<select");
  });

  it("gates the full private Video renderer while selected and keeps the bound fallback", () => {
    const boundVideo = {
      ...domainNodes.video,
      data: { assetId: "bound-video-id" }
    };
    const display: CreatorVideoAssetDisplayState = {
      status: "ready",
      logicalUrl: "/assets/bound-video-id/content"
    };
    const deselected = renderNode(
      "video",
      boundVideo,
      null,
      "owner-token",
      null,
      false,
      display
    );
    const selected = renderNode(
      "video",
      boundVideo,
      null,
      "owner-token",
      null,
      true,
      display
    );

    expect(deselected).toContain('data-creator-canvas-video-preview="ready"');
    expect(deselected).toContain('data-creator-canvas-video-preview-renderer="full"');
    expect(selected).toContain('data-creator-canvas-video-preview="bound-fallback"');
    expect(selected).toContain('data-creator-canvas-video-preview-renderer="fallback"');
    expect(selected).toContain("Video attached");
    expect(selected).not.toContain('data-creator-video-composer="true"');
    expect(selected).not.toContain("/assets/bound-video-id/content");
  });

  it("renders accessible generic dots without visible technical port labels", () => {
    const text = renderNode("text");
    const image = renderNode("image");
    const video = renderNode("video");

    expect(text).toContain('data-handle-id="source"');
    expect(text).toContain('data-handle-id="target"');
    expect(image).toContain('data-handle-id="source"');
    expect(image).toContain('data-handle-id="target"');
    expect(video).toContain('data-handle-id="source"');
    expect(video).toContain('data-handle-id="target"');

    const all = `${text}${image}${video}`;
    expect(all).not.toContain("data-creator-canvas-port-label");
    expect(all).not.toMatch(/>\s*(PROMPT|REFERENCE|INPUT|OUTPUT)\s*</i);
    expect(all).toContain('aria-label="Connect from Text"');
    expect(all).toContain('aria-label="Connect to Image"');
  });
});
