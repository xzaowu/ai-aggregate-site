// @vitest-environment jsdom

import type { AiModelSummary } from "@ai-aggregate/shared";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import type {
  CreatorContentNode,
  CreatorImageNode
} from "./creator-canvas-document";
import type { CreatorImageAssetDisplayState } from "./creator-image-asset-display";
import {
  createCreatorImageComposerDraft,
  type CreatorImageComposerDraft
} from "./creator-image-composer";
import {
  CreatorImageWorkspace,
  type CreatorImageWorkspaceProps
} from "./creator-image-workspace";
import type {
  CreatorImageComposerExecutionView,
  CreatorImageComposerView
} from "./creator-image-composer-panel";
import type { CreatorNodeComposerContext } from "./creator-node-composer-context";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const model = {
  id: "image-model-id",
  name: "Canvas Image",
  displayName: "Canvas Image Pro",
  slug: "canvas-image",
  provider: "OPENAI_COMPATIBLE",
  modelId: "upstream/canvas-image",
  capability: "image",
  displaySurfaces: ["image"],
  group: "image",
  tags: ["image"],
  enabled: true,
  maxReferenceImages: 2,
  creditCost: 3,
  allowGuest: true,
  sortOrder: 0,
  isRecommended: true
} satisfies AiModelSummary;

const emptyImageNode: CreatorImageNode = {
  id: "image-target",
  kind: "image",
  position: { x: 40, y: 60 },
  data: { assetId: null }
};

const boundImageNode: CreatorImageNode = {
  ...emptyImageNode,
  data: { assetId: "asset-current" }
};

const textSource: CreatorContentNode = {
  id: "text-source",
  kind: "text",
  position: { x: 0, y: 0 },
  data: { text: "A seeded text reference" }
};

const incomingImage: CreatorImageNode = {
  id: "image-source",
  kind: "image",
  position: { x: 0, y: 0 },
  data: { assetId: "asset-source" }
};

const boundContext: CreatorNodeComposerContext = {
  node: boundImageNode,
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
      sourceNode: incomingImage,
      mediaBinding: "bound"
    }
  ]
};

const baseDraft: CreatorImageComposerDraft = {
  ...createCreatorImageComposerDraft(model.slug),
  prompt: "Seeded prompt",
  modelId: model.slug,
  aspectRatio: "16:9",
  count: 2,
  operation: "edit",
  selectedImageReferenceNodeId: boundImageNode.id,
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
  overrides: Partial<CreatorImageComposerExecutionView> = {}
): CreatorImageComposerExecutionView {
  return {
    status: "idle",
    authenticated: true,
    errorMessage: null,
    onExecute: vi.fn(),
    onResume: vi.fn(),
    ...overrides
  };
}

function createComposerView(
  overrides: Partial<CreatorImageComposerView> = {}
): CreatorImageComposerView {
  return {
    context: boundContext,
    draft: baseDraft,
    models: [model],
    modelsLoading: false,
    onPromptChange: vi.fn(),
    onPromptReset: vi.fn(),
    onTextSourceSelect: vi.fn(),
    onOperationChange: vi.fn(),
    onImageReferenceSelect: vi.fn(),
    onModelChange: vi.fn(),
    onAspectRatioChange: vi.fn(),
    onCountChange: vi.fn(),
    execution: createExecution(),
    ...overrides
  };
}

function createProps(
  overrides: Partial<CreatorImageWorkspaceProps> = {}
): CreatorImageWorkspaceProps {
  return {
    assetId: boundImageNode.data.assetId,
    assetToken: "owner-token",
    assetDisplay: {
      status: "ready",
      logicalUrl: "/assets/asset-current/content"
    },
    imageComposer: createComposerView(),
    onChooseExistingImageAsset: vi.fn(),
    onReplaceExistingImageAsset: vi.fn(),
    ...overrides
  };
}

describe("CreatorImageWorkspace", () => {
  it("renders an empty preview, shared Composer controls, and one Choose path", () => {
    const html = renderToStaticMarkup(withI18n(
      <CreatorImageWorkspace
        {...createProps({
          assetId: null,
          assetDisplay: { status: "idle", logicalUrl: null },
          imageComposer: createComposerView({
            context: {
              ...boundContext,
              node: emptyImageNode,
              mediaBinding: "empty"
            },
            draft: {
              ...baseDraft,
              operation: "generate",
              selectedImageReferenceNodeId: null
            }
          })
        })}
      />
    ));

    expect(html).toContain('data-creator-image-workspace="true"');
    expect(html).toContain('data-creator-image-workspace-mode="workspace"');
    expect(html).toContain('data-creator-image-workspace-preview-state="empty"');
    expect(html).toContain("Empty image");
    expect(html).toContain('data-creator-image-workspace-asset-picker-action="choose"');
    expect(html).not.toContain('data-creator-image-workspace-asset-picker-action="replace"');
    expect(html).toContain('data-creator-image-composer="true"');
    expect(html).toContain('data-creator-image-composer-presentation="workspace"');
    expect(html).toContain('data-creator-image-operation="generate"');
    expect(html).toContain('data-creator-image-model="true"');
    expect(html).toContain('data-creator-image-aspect="true"');
    expect(html).toContain('data-creator-image-count="true"');
    expect(html).toContain('data-creator-image-estimated-cost="6"');
    expect(html).not.toContain("data-creator-image-node-toolbar");
  });

  it("renders a bound private preview and keeps Replace behind the existing execution fence", () => {
    const html = renderToStaticMarkup(withI18n(
      <CreatorImageWorkspace {...createProps()} />
    ));

    expect(html).toContain('data-creator-image-workspace-preview-state="ready"');
    expect(html).toContain('data-creator-image-workspace-binding="bound"');
    expect(html).toContain('data-creator-image-workspace-asset-picker-action="replace"');
    expect(html).not.toContain('data-creator-image-workspace-asset-picker-action="choose"');
    expect(html).not.toContain("/assets/asset-current/content");

    const blocked = renderToStaticMarkup(withI18n(
      <CreatorImageWorkspace
        {...createProps({
          imageComposer: createComposerView({
            execution: createExecution({ status: "checking" })
          })
        })}
      />
    ));
    expect(blocked).toContain('data-creator-image-workspace-replace-unavailable="true"');
    expect(blocked).toMatch(
      /disabled=""[^>]*data-creator-image-workspace-asset-picker-action="replace"/
    );
    expect(blocked).toContain('data-creator-image-execution-status="checking"');
  });

  it("keeps Focus on the same preview, Composer view, draft values, and callbacks", () => {
    const sharedView = createComposerView();
    const focusHtml = renderToStaticMarkup(withI18n(
      <CreatorImageWorkspace
        {...createProps({ imageComposer: sharedView })}
        mode="focus"
      />
    ));

    expect(focusHtml).toContain('data-creator-image-workspace-mode="focus"');
    expect(focusHtml).toContain("aspect-[16/10]");
    expect(focusHtml).toContain('data-creator-image-composer-presentation="workspace"');
    expect(focusHtml).toContain('data-creator-image-operation="edit"');
    expect(focusHtml).toContain("Seeded prompt");
    expect(focusHtml).toContain('data-creator-image-source-chip="text"');
    expect(focusHtml).toContain('data-creator-image-source-chip="current-image"');
    expect(focusHtml).toContain('data-creator-image-source-chip="incoming-image"');

    const editedView = {
      ...sharedView,
      draft: {
        ...sharedView.draft,
        prompt: "Edited in the normal workspace",
        promptDirty: true
      }
    } satisfies CreatorImageComposerView;
    const returnedHtml = renderToStaticMarkup(withI18n(
      <CreatorImageWorkspace
        {...createProps({ imageComposer: editedView })}
      />
    ));
    expect(returnedHtml).toContain("Edited in the normal workspace");
    expect(returnedHtml).toContain("Your edited prompt is preserved");
    expect(sharedView.execution.onExecute).not.toHaveBeenCalled();
    expect(sharedView.execution.onResume).not.toHaveBeenCalled();
  });

  it("uses the existing Choose/Replace callbacks and exposes Execute/Resume states", async () => {
    const onChoose = vi.fn();
    const onReplace = vi.fn();
    const onExecute = vi.fn();
    const onResume = vi.fn();
    const view = createComposerView({
      onOperationChange: vi.fn(),
      onTextSourceSelect: vi.fn(),
      onImageReferenceSelect: vi.fn(),
      execution: createExecution({ onExecute, onResume })
    });
    const props = createProps({
      imageComposer: view,
      assetDisplay: { status: "unavailable", logicalUrl: null },
      onChooseExistingImageAsset: onChoose,
      onReplaceExistingImageAsset: onReplace
    });
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | null = createRoot(host);

    await act(async () => {
      root?.render(withI18n(<CreatorImageWorkspace {...props} />));
    });
    host.querySelector<HTMLButtonElement>(
      '[data-creator-image-workspace-asset-picker-action="replace"]'
    )?.click();
    expect(onReplace).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(withI18n(
        <CreatorImageWorkspace
          {...props}
          assetId={null}
          assetDisplay={{ status: "idle", logicalUrl: null }}
          imageComposer={createComposerView({
            context: {
              ...boundContext,
              node: emptyImageNode,
              mediaBinding: "empty"
            },
            draft: {
              ...baseDraft,
              operation: "generate",
              selectedImageReferenceNodeId: null
            },
            execution: createExecution({ onExecute, onResume })
          })}
        />
      ));
    });
    host.querySelector<HTMLButtonElement>(
      '[data-creator-image-workspace-asset-picker-action="choose"]'
    )?.click();
    host.querySelector<HTMLButtonElement>('[data-creator-image-execute="generate"]')?.click();
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(withI18n(
        <CreatorImageWorkspace
          {...props}
          imageComposer={createComposerView({
            execution: createExecution({ status: "unresolved", onExecute, onResume })
          })}
        />
      ));
    });
    host.querySelector<HTMLButtonElement>('[data-creator-image-resume="true"]')?.click();
    expect(onResume).toHaveBeenCalledTimes(1);

    await act(async () => root?.unmount());
    root = null;
    host.remove();
  });
});
