// @vitest-environment jsdom

import type { PublicVideoModelSummary } from "@ai-aggregate/shared";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import type {
  CreatorContentNode,
  CreatorImageNode,
  CreatorVideoNode
} from "./creator-canvas-document";
import type { CreatorNodeComposerContext } from "./creator-node-composer-context";
import {
  createCreatorVideoComposerDraft,
  type CreatorVideoComposerDraft
} from "./creator-video-composer";
import type { CreatorVideoAssetDisplayState } from "./creator-video-asset-display";
import {
  CreatorVideoWorkspace,
  type CreatorVideoWorkspaceProps
} from "./creator-video-workspace";
import type {
  CreatorVideoComposerExecutionView,
  CreatorVideoComposerView
} from "./creator-video-composer-panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const model: PublicVideoModelSummary = {
  id: "video-model-id",
  name: "Canvas Video",
  displayName: "Canvas Video Pro",
  slug: "canvas-video",
  capability: "video",
  displaySurfaces: ["video"],
  group: "video",
  tags: ["video"],
  enabled: true,
  creditCost: 8,
  allowGuest: false,
  sortOrder: 0,
  isRecommended: true,
  videoProfile: {
    id: "video-profile-id",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    durationSeconds: 5,
    resolution: "1280x720",
    aspectRatio: "16:9"
  }
};

const videoNode: CreatorVideoNode = {
  id: "video-target",
  kind: "video",
  position: { x: 360, y: 80 },
  data: { assetId: "video-asset" }
};

const emptyVideoNode: CreatorVideoNode = {
  ...videoNode,
  data: { assetId: null }
};

const textSource: CreatorContentNode = {
  id: "text-source",
  kind: "text",
  position: { x: 0, y: 0 },
  data: { text: "A cinematic product reveal" }
};

const imageSource: CreatorImageNode = {
  id: "image-source",
  kind: "image",
  position: { x: 0, y: 160 },
  data: { assetId: "image-reference" }
};

const context: CreatorNodeComposerContext = {
  node: videoNode,
  mediaBinding: "bound",
  incomingReferences: [
    {
      edgeId: "text-edge",
      relationship: "reference",
      sourceNode: textSource,
      mediaBinding: "not-applicable"
    },
    {
      edgeId: "image-edge",
      relationship: "reference",
      sourceNode: imageSource,
      mediaBinding: "bound"
    }
  ]
};

const baseDraft: CreatorVideoComposerDraft = {
  ...createCreatorVideoComposerDraft(model.slug),
  prompt: "A cinematic product reveal",
  modelId: model.slug,
  mode: "image-to-video",
  selectedImageReferenceNodeId: imageSource.id,
  promptSeedSourceNodeId: textSource.id,
  promptDirty: false
};

function withI18n(element: React.ReactNode) {
  return (
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      {element}
    </I18nContext.Provider>
  );
}

function createExecution(
  overrides: Partial<CreatorVideoComposerExecutionView> = {}
): CreatorVideoComposerExecutionView {
  return {
    status: "idle",
    progress: null,
    taskId: null,
    errorMessage: null,
    authenticated: true,
    onExecute: vi.fn(),
    onResume: vi.fn(),
    ...overrides
  };
}

function createComposerView(
  overrides: Partial<CreatorVideoComposerView> = {}
): CreatorVideoComposerView {
  return {
    context,
    draft: baseDraft,
    models: [model],
    modelsLoading: false,
    effectiveModel: model,
    onPromptChange: vi.fn(),
    onPromptReset: vi.fn(),
    onTextSourceSelect: vi.fn(),
    onImageReferenceSelect: vi.fn(),
    onModeChange: vi.fn(),
    onModelChange: vi.fn(),
    execution: createExecution(),
    ...overrides
  };
}

function createProps(
  overrides: Partial<CreatorVideoWorkspaceProps> = {}
): CreatorVideoWorkspaceProps {
  return {
    assetId: videoNode.data.assetId,
    assetToken: "owner-token",
    assetDisplay: {
      status: "ready",
      logicalUrl: "/assets/video-asset/content"
    },
    videoComposer: createComposerView(),
    ...overrides
  };
}

describe("CreatorVideoWorkspace", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("renders an empty private preview and the existing T2V Composer controls", () => {
    const html = renderToStaticMarkup(withI18n(
      <CreatorVideoWorkspace
        {...createProps({
          assetId: emptyVideoNode.data.assetId,
          assetDisplay: { status: "idle", logicalUrl: null },
          videoComposer: createComposerView({
            context: {
              ...context,
              node: emptyVideoNode,
              mediaBinding: "empty"
            },
            draft: {
              ...baseDraft,
              mode: "text-to-video",
              selectedImageReferenceNodeId: null
            }
          })
        })}
      />
    ));

    expect(html).toContain('data-creator-video-workspace="true"');
    expect(html).toContain('data-creator-video-workspace-mode="workspace"');
    expect(html).toContain('data-creator-video-workspace-preview-state="empty"');
    expect(html).toContain("Empty video");
    expect(html).toContain('data-creator-video-composer="true"');
    expect(html).toContain('data-creator-video-composer-presentation="workspace"');
    expect(html).toContain('data-creator-video-mode="text-to-video"');
    expect(html).toContain('data-creator-video-prompt="true"');
    expect(html).toContain('data-creator-video-model="true"');
    expect(html).toContain('data-creator-video-model-profile="true"');
    expect(html).toContain('data-creator-video-estimated-cost="8"');
    expect(html).not.toContain("/assets/video-asset/content");
  });

  it("renders the owner-private bound preview without exposing its logical URL", () => {
    const html = renderToStaticMarkup(withI18n(
      <CreatorVideoWorkspace {...createProps()} />
    ));

    expect(html).toContain('data-creator-video-workspace-preview-state="ready"');
    expect(html).toContain('data-creator-video-workspace-binding="bound"');
    expect(html).toContain("Video attached");
    expect(html).not.toContain("/assets/video-asset/content");

    const stale = renderToStaticMarkup(withI18n(
      <CreatorVideoWorkspace
        {...createProps({
          assetId: "video-next",
          assetDisplay: {
            status: "ready",
            logicalUrl: "/assets/video-asset/content"
          }
        })}
      />
    ));
    expect(stale).toContain('data-creator-video-workspace-preview-state="loading"');
    expect(stale).not.toContain("/assets/video-asset/content");
  });

  it("keeps Focus on the same private preview, Composer view, draft and callbacks", () => {
    const sharedView = createComposerView();
    const focusHtml = renderToStaticMarkup(withI18n(
      <CreatorVideoWorkspace
        {...createProps({ videoComposer: sharedView })}
        mode="focus"
      />
    ));

    expect(focusHtml).toContain('data-creator-video-workspace-mode="focus"');
    expect(focusHtml).toContain("aspect-video min-h-64");
    expect(focusHtml).toContain('data-creator-video-composer-presentation="workspace"');
    expect(focusHtml).toContain("A cinematic product reveal");
    expect(focusHtml).toContain('data-creator-video-source-chip="text"');
    expect(focusHtml).toContain('data-creator-video-source-chip="image"');

    const editedView = createComposerView({
      draft: {
        ...baseDraft,
        prompt: "Edited in the Video Workspace",
        promptDirty: true
      }
    });
    const returnedHtml = renderToStaticMarkup(withI18n(
      <CreatorVideoWorkspace {...createProps({ videoComposer: editedView })} />
    ));
    expect(returnedHtml).toContain("Edited in the Video Workspace");
    expect(sharedView.execution.onExecute).not.toHaveBeenCalled();
    expect(sharedView.execution.onResume).not.toHaveBeenCalled();
  });

  it("keeps execution status, progress, Execute and Resume on the same view", async () => {
    const onExecute = vi.fn();
    const onResume = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withI18n(
        <CreatorVideoWorkspace
          {...createProps({
            videoComposer: createComposerView({
              execution: createExecution({ onExecute, onResume })
            })
          })}
        />
      ));
    });
    host.querySelector<HTMLButtonElement>('[data-creator-video-execute="true"]')?.click();
    expect(onExecute).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(withI18n(
        <CreatorVideoWorkspace
          {...createProps({
            videoComposer: createComposerView({
              execution: createExecution({
                status: "unresolved",
                progress: 42,
                taskId: "video-task",
                onExecute,
                onResume
              })
            })
          })}
        />
      ));
    });
    expect(host.querySelector('[data-creator-video-execution-status="unresolved"]'))
      .toBeTruthy();
    expect(host.textContent).toContain("42%");
    host.querySelector<HTMLButtonElement>('[data-creator-video-execute="true"]')?.click();
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
